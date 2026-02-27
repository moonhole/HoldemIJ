package table

import (
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	pb "holdem-lite/apps/server/gen"
	"holdem-lite/apps/server/internal/ledger"
	"holdem-lite/card"
	"holdem-lite/holdem"
	"holdem-lite/holdem/npc"

	"google.golang.org/protobuf/proto"
)

// Table represents a single poker table with an actor model
type Table struct {
	ID     string
	Config TableConfig

	mu       sync.RWMutex
	game     *holdem.Game
	players  map[uint64]*PlayerConn // userID -> connection
	seats    map[uint16]uint64      // chair -> userID
	round    uint32
	closed   bool
	stopOnce sync.Once
	// Stack baseline at hand start for delta/net settlement messages.
	handStartStacks map[uint16]int64

	// Event channel for actor pattern
	events chan Event
	done   chan struct{}

	// Server sequence for event ordering
	serverSeq uint64

	// Timers and lifecycle metadata.
	actionTimeoutChair uint16
	actionDeadline     time.Time
	nextHandAt         time.Time
	emptySince         time.Time

	// Callback to broadcast messages
	broadcast    func(userID uint64, data []byte)
	ledger       ledger.Service
	handID       string
	userHandTape map[uint64][]ledger.EventItem

	// NPC support
	npcManager *npc.Manager

	// Optional callbacks invoked after each hand settles.
	handEndHooks []HandEndHook
}

// TableConfig contains table settings
type TableConfig struct {
	MaxPlayers uint16
	SmallBlind int64
	BigBlind   int64
	Ante       int64
	MinBuyIn   int64
	MaxBuyIn   int64
}

// PlayerConn represents a connected player at the table
type PlayerConn struct {
	UserID   uint64
	Nickname string
	Chair    uint16
	Stack    int64
	Wallet   int64 // Chips not yet at table
	Online   bool
	LastSeen time.Time
}

// Event types for the actor message queue
type EventType int

const (
	EventJoinTable EventType = iota
	EventSitDown
	EventStandUp
	EventBuyIn
	EventAction
	EventTimeout
	EventStartHand
	EventConnLost
	EventConnResume
	EventClose
)

// Event represents a message to the table actor
type Event struct {
	Type      EventType
	UserID    uint64
	Nickname  string
	Chair     uint16
	Amount    int64
	Action    holdem.ActionType
	Timestamp time.Time
	Response  chan error
}

// HandEndInfo is emitted when a hand settlement is finalized.
type HandEndInfo struct {
	TableID  string
	Round    uint32
	Snapshot holdem.Snapshot
	Result   *holdem.SettlementResult
}

// HandEndHook is a post-settlement callback.
type HandEndHook func(info HandEndInfo)

var ErrTableClosed = errors.New("table closed")

const (
	actionTimeLimitSec = int32(30)
	showdownHandDelay  = 8 * time.Second
	foldHandDelay      = 3 * time.Second
	offlineSeatTTL     = 30 * time.Second
)

// New creates a new table
func New(
	id string,
	cfg TableConfig,
	broadcastFn func(userID uint64, data []byte),
	ledgerService ledger.Service,
	npcMgr ...*npc.Manager,
) *Table {
	t := &Table{
		ID:                 id,
		Config:             cfg,
		players:            make(map[uint64]*PlayerConn),
		seats:              make(map[uint16]uint64),
		handStartStacks:    make(map[uint16]int64),
		events:             make(chan Event, 256),
		done:               make(chan struct{}),
		broadcast:          broadcastFn,
		ledger:             ledgerService,
		actionTimeoutChair: holdem.InvalidChair,
		emptySince:         time.Now(),
		userHandTape:       make(map[uint64][]ledger.EventItem),
	}
	if len(npcMgr) > 0 && npcMgr[0] != nil {
		t.npcManager = npcMgr[0]
	}

	// Create game engine
	game, err := holdem.NewGame(holdem.Config{
		MaxPlayers: int(cfg.MaxPlayers),
		MinPlayers: 2,
		SmallBlind: cfg.SmallBlind,
		BigBlind:   cfg.BigBlind,
		Ante:       cfg.Ante,
	})
	if err != nil {
		log.Printf("[Table %s] Failed to create game: %v", id, err)
		return nil
	}
	t.game = game

	// Start actor goroutine
	go t.run()

	log.Printf("[Table %s] Created (max=%d, blinds=%d/%d)", id, cfg.MaxPlayers, cfg.SmallBlind, cfg.BigBlind)
	return t
}

// run is the main actor loop
func (t *Table) run() {
	// Sub-second heartbeat for action timeout and inter-hand scheduling.
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case event := <-t.events:
			err := t.handleEvent(event)
			if event.Response != nil {
				event.Response <- err
			}
		case <-ticker.C:
			t.tick()
		case <-t.done:
			log.Printf("[Table %s] Actor stopped", t.ID)
			return
		}
	}
}

// handleEvent processes a single event
func (t *Table) handleEvent(e Event) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.closed && e.Type != EventClose {
		return ErrTableClosed
	}

	switch e.Type {
	case EventJoinTable:
		return t.handleJoinTable(e.UserID, e.Nickname)
	case EventSitDown:
		return t.handleSitDown(e.UserID, e.Chair, e.Amount)
	case EventStandUp:
		return t.handleStandUp(e.UserID)
	case EventBuyIn:
		return t.handleBuyIn(e.UserID, e.Amount)
	case EventAction:
		return t.handleAction(e.UserID, e.Action, e.Amount)
	case EventTimeout:
		return t.handleTimeout(e.Timestamp)
	case EventStartHand:
		return t.handleStartHand()
	case EventConnLost:
		return t.handleConnLost(e.UserID, e.Timestamp)
	case EventConnResume:
		return t.handleConnResume(e.UserID, e.Nickname, e.Timestamp)
	case EventClose:
		t.stopLocked()
		return nil
	default:
		return fmt.Errorf("unknown event type: %d", e.Type)
	}
}

func (t *Table) handleJoinTable(userID uint64, nickname string) error {
	now := time.Now()
	resolvedNickname := normalizeNickname(nickname, userID)
	if player, exists := t.players[userID]; exists {
		player.Online = true
		player.LastSeen = now
		player.Nickname = resolvedNickname
		t.sendSnapshot(userID)
		t.sendPromptIfActingUser(userID)
		return nil // Already joined
	}
	t.players[userID] = &PlayerConn{
		UserID:   userID,
		Nickname: resolvedNickname,
		Chair:    holdem.InvalidChair,
		Online:   true,
		LastSeen: now,
	}
	log.Printf("[Table %s] Player %d joined", t.ID, userID)

	// Automatic sit-down if not seated
	for i := uint16(0); i < t.Config.MaxPlayers; i++ {
		if t.seats[i] == 0 {
			// Found empty seat
			log.Printf("[Table %s] Auto-sitting player %d at chair %d", t.ID, userID, i)
			if err := t.handleSitDown(userID, i, t.Config.MaxBuyIn); err != nil {
				log.Printf("[Table %s] Auto sit-down failed for player %d: %v", t.ID, userID, err)
			}
			break
		}
	}

	t.sendSnapshot(userID)
	t.sendPromptIfActingUser(userID)
	return nil
}

func (t *Table) handleSitDown(userID uint64, chair uint16, buyIn int64) error {
	player := t.players[userID]
	if player == nil {
		return fmt.Errorf("player not in table")
	}
	if player.Chair != holdem.InvalidChair {
		return fmt.Errorf("already seated at chair %d", player.Chair)
	}
	if chair >= t.Config.MaxPlayers {
		return fmt.Errorf("invalid chair %d", chair)
	}
	if t.seats[chair] != 0 {
		return fmt.Errorf("chair %d is occupied", chair)
	}
	if buyIn < t.Config.MinBuyIn || buyIn > t.Config.MaxBuyIn {
		return fmt.Errorf("invalid buy-in amount: %d (range: %d-%d)", buyIn, t.Config.MinBuyIn, t.Config.MaxBuyIn)
	}

	// Sit down in game engine
	if err := t.game.SitDown(chair, userID, buyIn, false); err != nil {
		return err
	}

	player.Chair = chair
	player.Stack = buyIn
	player.Online = true
	player.LastSeen = time.Now()
	t.seats[chair] = userID
	t.updateEmptySinceLocked(player.LastSeen)

	log.Printf("[Table %s] Player %d sat down at chair %d with %d", t.ID, userID, chair, buyIn)

	// Broadcast seat update to all
	t.broadcastSeatUpdate(chair, userID, buyIn)

	// Check if we can start a hand
	if err := t.tryStartHand(player.LastSeen); err != nil {
		log.Printf("[Table %s] tryStartHand after sit-down failed: %v", t.ID, err)
	}

	return nil
}

func (t *Table) handleStandUp(userID uint64) error {
	player := t.players[userID]
	if player == nil || player.Chair == holdem.InvalidChair {
		return nil
	}

	chair := player.Chair
	if err := t.game.StandUp(chair); err != nil {
		return err
	}

	delete(t.seats, chair)
	player.Chair = holdem.InvalidChair
	player.Wallet += player.Stack
	player.Stack = 0
	player.LastSeen = time.Now()
	t.updateEmptySinceLocked(player.LastSeen)
	if len(t.seats) < 2 {
		t.nextHandAt = time.Time{}
	}

	log.Printf("[Table %s] Player %d stood up from chair %d", t.ID, userID, chair)
	t.broadcastSeatLeft(chair, userID)
	return nil
}

func (t *Table) handleBuyIn(userID uint64, amount int64) error {
	player := t.players[userID]
	if player == nil {
		return fmt.Errorf("player not in table")
	}
	// TODO: Implement pending buy-in for mid-hand
	return nil
}

func (t *Table) handleAction(userID uint64, action holdem.ActionType, amount int64) error {
	player := t.players[userID]
	if player == nil || player.Chair == holdem.InvalidChair {
		return fmt.Errorf("player not seated")
	}

	before := t.game.Snapshot()
	if before.ActionChair != player.Chair {
		return fmt.Errorf("not your turn")
	}
	// Client call amount may arrive as either total-to amount or delta-to-call.
	// Normalize on server so CALL always targets current street bet.
	if action == holdem.PlayerActionTypeCall {
		amount = before.CurBet
	}

	result, err := t.game.Act(player.Chair, action, amount)
	if err != nil {
		return err
	}
	if t.actionTimeoutChair == player.Chair {
		t.clearActionTimeoutLocked()
	}
	after := t.game.Snapshot()
	t.syncPlayerStacksFromSnapshot(after)

	log.Printf("[Table %s] Player %d action: %v amount: %d", t.ID, userID, action, amount)

	// Broadcast action result
	t.broadcastActionResult(player.Chair, action, before, after, result)
	t.broadcastStreetStateTransitions(before, after)
	if potsChanged(before.Pots, after.Pots) {
		t.broadcastPotUpdate(after.Pots)
	}

	// Check if hand ended
	if result != nil {
		t.handleHandEnd(result)
	} else {
		// Prompt next player
		if after.ActionChair != holdem.InvalidChair {
			t.sendActionPrompt(after.ActionChair)
		}
	}

	return nil
}

func (t *Table) handleStartHand() error {
	if t.closed {
		return ErrTableClosed
	}
	if len(t.seats) < 2 {
		return nil
	}
	t.nextHandAt = time.Time{}
	t.clearActionTimeoutLocked()

	log.Printf("[Table %s] handleStartHand called, seats=%d", t.ID, len(t.seats))
	before := t.game.Snapshot()
	t.handStartStacks = make(map[uint16]int64, len(before.Players))
	for _, ps := range before.Players {
		t.handStartStacks[ps.Chair] = ps.Stack
	}

	if err := t.game.StartHand(); err != nil {
		log.Printf("[Table %s] StartHand failed: %v", t.ID, err)
		return err
	}
	t.round++
	t.handID = t.buildHandID()
	t.userHandTape = make(map[uint64][]ledger.EventItem, len(t.seats))
	t.appendReplayBootstrapSnapshots()

	snap := t.game.Snapshot()
	t.syncPlayerStacksFromSnapshot(snap)
	log.Printf("[Table %s] Hand %d started. Dealer: %d, Action: %d", t.ID, t.round, snap.DealerChair, snap.ActionChair)

	// Broadcast hand start
	t.broadcastHandStart()

	// Send hole cards to each player
	t.sendHoleCards()

	// Send action prompt to first player
	if snap.ActionChair != holdem.InvalidChair {
		t.sendActionPrompt(snap.ActionChair)
	}

	return nil
}

func (t *Table) handleHandEnd(result *holdem.SettlementResult) {
	log.Printf("[Table %s] Hand ended. Winners: %v", t.ID, result)
	endedAt := time.Now().UTC()
	handID := t.handID

	// Broadcast showdown/hand end
	t.broadcastHandEnd(result)
	t.clearActionTimeoutLocked()
	t.persistLiveHandHistory(handID, endedAt, result)
	t.dispatchHandEndHooks(result)
	t.handID = ""

	// Schedule next hand from actor tick (no goroutine self-submit).
	if len(t.seats) >= 2 {
		delay := foldHandDelay
		if hasShowdownHands(result) {
			delay = showdownHandDelay
		}
		t.nextHandAt = time.Now().Add(delay)
	} else {
		t.nextHandAt = time.Time{}
	}
}

func (t *Table) dispatchHandEndHooks(result *holdem.SettlementResult) {
	if len(t.handEndHooks) == 0 || result == nil {
		return
	}
	info := HandEndInfo{
		TableID:  t.ID,
		Round:    t.round,
		Snapshot: t.game.Snapshot(),
		Result:   result,
	}
	hooks := append([]HandEndHook(nil), t.handEndHooks...)
	for _, hook := range hooks {
		if hook == nil {
			continue
		}
		go func(cb HandEndHook) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[Table %s] hand end hook panic: %v", t.ID, r)
				}
			}()
			cb(info)
		}(hook)
	}
}

func (t *Table) tick() {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.closed {
		return
	}
	now := time.Now()
	if err := t.handleTimeout(now); err != nil {
		log.Printf("[Table %s] timeout handler failed: %v", t.ID, err)
	}
	t.releaseOfflineSeats(now)
	if !t.nextHandAt.IsZero() && !now.Before(t.nextHandAt) {
		if err := t.tryStartHand(now); err != nil {
			log.Printf("[Table %s] delayed hand start failed: %v", t.ID, err)
		}
	}
}

func (t *Table) releaseOfflineSeats(now time.Time) {
	for userID, player := range t.players {
		if player == nil || player.Online || player.Chair == holdem.InvalidChair {
			continue
		}
		if now.Sub(player.LastSeen) < offlineSeatTTL {
			continue
		}
		if err := t.handleStandUp(userID); err != nil {
			// Throttle retries if game engine refuses stand-up in the current hand state.
			player.LastSeen = now
			log.Printf("[Table %s] auto-standup failed for offline user %d: %v", t.ID, userID, err)
			continue
		}
		log.Printf("[Table %s] Auto-stood offline user %d after %s", t.ID, userID, offlineSeatTTL)
	}
}

func (t *Table) handleTimeout(now time.Time) error {
	if t.actionTimeoutChair == holdem.InvalidChair || t.actionDeadline.IsZero() {
		return nil
	}
	if now.Before(t.actionDeadline) {
		return nil
	}

	chair := t.actionTimeoutChair
	userID := t.seats[chair]
	t.clearActionTimeoutLocked()

	if userID == 0 {
		return nil
	}
	snap := t.game.Snapshot()
	if snap.ActionChair != chair {
		return nil
	}

	autoAction, autoAmount, err := t.pickTimeoutAction(chair, snap)
	if err != nil {
		return err
	}
	log.Printf("[Table %s] Action timeout chair=%d user=%d -> auto %v amount=%d", t.ID, chair, userID, autoAction, autoAmount)
	return t.handleAction(userID, autoAction, autoAmount)
}

func (t *Table) pickTimeoutAction(chair uint16, snap holdem.Snapshot) (holdem.ActionType, int64, error) {
	legalActions, _, err := t.game.LegalActions(chair)
	if err != nil {
		return 0, 0, err
	}

	if hasAction(legalActions, holdem.PlayerActionTypeCheck) {
		return holdem.PlayerActionTypeCheck, 0, nil
	}
	if hasAction(legalActions, holdem.PlayerActionTypeFold) {
		return holdem.PlayerActionTypeFold, 0, nil
	}
	if hasAction(legalActions, holdem.PlayerActionTypeCall) {
		return holdem.PlayerActionTypeCall, snap.CurBet, nil
	}
	if hasAction(legalActions, holdem.PlayerActionTypeAllin) {
		return holdem.PlayerActionTypeAllin, snap.CurBet, nil
	}
	if len(legalActions) == 0 {
		return 0, 0, fmt.Errorf("no legal actions for timeout")
	}
	return legalActions[0], snap.CurBet, nil
}

func (t *Table) handleConnLost(userID uint64, ts time.Time) error {
	player := t.players[userID]
	if player == nil {
		return nil
	}
	if ts.IsZero() {
		ts = time.Now()
	}
	player.Online = false
	player.LastSeen = ts
	log.Printf("[Table %s] Player %d connection lost", t.ID, userID)
	return nil
}

func (t *Table) handleConnResume(userID uint64, nickname string, ts time.Time) error {
	player := t.players[userID]
	if player == nil {
		return nil
	}
	player.Nickname = normalizeNickname(nickname, userID)
	if ts.IsZero() {
		ts = time.Now()
	}
	player.Online = true
	player.LastSeen = ts
	t.sendSnapshot(userID)
	t.sendPromptIfActingUser(userID)
	log.Printf("[Table %s] Player %d connection resumed", t.ID, userID)
	return nil
}

func (t *Table) tryStartHand(now time.Time) error {
	if len(t.seats) < 2 {
		return nil
	}
	if !t.nextHandAt.IsZero() && now.Before(t.nextHandAt) {
		return nil
	}
	snap := t.game.Snapshot()
	// Start if: no hands played yet (Round==0), OR previous hand ended.
	if snap.Round == 0 || snap.Ended || snap.Phase == holdem.PhaseTypeRoundEnd {
		log.Printf("[Table %s] Starting hand - seats=%d, round=%d, ended=%v, phase=%v",
			t.ID, len(t.seats), snap.Round, snap.Ended, snap.Phase)
		return t.handleStartHand()
	}
	return nil
}

// SubmitEvent sends an event to the actor
func (t *Table) SubmitEvent(e Event) error {
	e.Timestamp = time.Now()
	if e.Response == nil {
		e.Response = make(chan error, 1)
	}

	t.mu.RLock()
	closed := t.closed
	t.mu.RUnlock()
	if closed {
		return ErrTableClosed
	}

	select {
	case t.events <- e:
	case <-t.done:
		return ErrTableClosed
	}

	select {
	case err := <-e.Response:
		return err
	case <-t.done:
		return ErrTableClosed
	}
}

// Stop shuts down the table actor
func (t *Table) Stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.stopLocked()
}

func (t *Table) stopLocked() {
	t.closed = true
	t.nextHandAt = time.Time{}
	t.clearActionTimeoutLocked()
	t.stopOnce.Do(func() {
		close(t.done)
	})
}

func (t *Table) setActionTimeoutLocked(chair uint16, now time.Time) {
	t.actionTimeoutChair = chair
	t.actionDeadline = now.Add(time.Duration(actionTimeLimitSec) * time.Second)
}

func (t *Table) clearActionTimeoutLocked() {
	t.actionTimeoutChair = holdem.InvalidChair
	t.actionDeadline = time.Time{}
}

func (t *Table) updateEmptySinceLocked(now time.Time) {
	if len(t.seats) == 0 {
		if t.emptySince.IsZero() {
			t.emptySince = now
		}
		return
	}
	t.emptySince = time.Time{}
}

func (t *Table) playerNickname(userID uint64) string {
	player := t.players[userID]
	if player != nil {
		nickname := strings.TrimSpace(player.Nickname)
		if nickname != "" {
			return nickname
		}
	}
	return fmt.Sprintf("user_%d", userID)
}

func normalizeNickname(raw string, userID uint64) string {
	nickname := strings.TrimSpace(raw)
	if nickname == "" {
		return fmt.Sprintf("user_%d", userID)
	}
	return nickname
}

func (t *Table) IsIdleFor(ttl time.Duration) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()

	if t.closed {
		return true
	}
	if len(t.seats) > 0 {
		return false
	}
	if t.emptySince.IsZero() {
		return false
	}
	return time.Since(t.emptySince) >= ttl
}

func (t *Table) IsClosed() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.closed
}

// Snapshot returns current game state (thread-safe)
func (t *Table) Snapshot() holdem.Snapshot {
	return t.game.Snapshot()
}

// AddHandEndHook registers a post-settlement callback.
func (t *Table) AddHandEndHook(hook HandEndHook) {
	if hook == nil {
		return
	}
	t.mu.Lock()
	t.handEndHooks = append(t.handEndHooks, hook)
	t.mu.Unlock()
}

// --- NPC support ---

// isNPC checks whether a userID belongs to an NPC (caller must hold t.mu).
func (t *Table) isNPC(userID uint64) bool {
	if t.npcManager == nil {
		return false
	}
	return t.npcManager.IsNPC(userID)
}

// scheduleNPCAction runs the NPC brain in a goroutine and injects the
// decision as an Event back into the actor queue. The think delay simulates
// human-like decision timing.
func (t *Table) scheduleNPCAction(chair uint16, userID uint64) {
	if t.npcManager == nil {
		return
	}

	// Get legal actions for the NPC so the brain can use them.
	legalActions, minRaise, err := t.game.LegalActions(chair)
	if err != nil {
		log.Printf("[Table %s] NPC LegalActions failed chair=%d: %v", t.ID, chair, err)
		return
	}

	snap := t.game.Snapshot()
	thinkDelay := t.npcManager.GetThinkDelay(userID)

	// Build a full GameView with legal actions included.
	inst := t.npcManager.GetInstance(userID)
	if inst == nil {
		log.Printf("[Table %s] NPC instance not found for user %d", t.ID, userID)
		return
	}

	go func() {
		// Simulate thinking
		time.Sleep(thinkDelay)

		view := npc.GameView{
			Phase:      snap.Phase,
			Community:  snap.CommunityCards,
			CurrentBet: snap.CurBet,
			MinRaise:   minRaise,
		}
		// Calc pot
		for _, pot := range snap.Pots {
			view.Pot += pot.Amount
		}
		for _, ps := range snap.Players {
			view.Pot += ps.Bet
		}
		// Find NPC's own data
		for _, ps := range snap.Players {
			if ps.Chair == chair {
				view.HoleCards = ps.HandCards
				view.MyBet = ps.Bet
				view.MyStack = ps.Stack
				break
			}
		}
		// Active count
		for _, ps := range snap.Players {
			if !ps.Folded {
				view.ActiveCount++
			}
		}
		// Street
		switch snap.Phase {
		case holdem.PhaseTypePreflop:
			view.Street = 0
		case holdem.PhaseTypeFlop:
			view.Street = 1
		case holdem.PhaseTypeTurn:
			view.Street = 2
		case holdem.PhaseTypeRiver:
			view.Street = 3
		}
		view.LegalActions = legalActions

		decision := inst.Brain.Decide(view)
		log.Printf("[Table %s] NPC %s (chair=%d) decides: %v amount=%d",
			t.ID, inst.Persona.Name, chair, decision.Action, decision.Amount)

		// Inject the decision back into the actor queue.
		_ = t.SubmitEvent(Event{
			Type:   EventAction,
			UserID: userID,
			Action: decision.Action,
			Amount: decision.Amount,
		})
	}()
}

// SeatNPC spawns an NPC at a specific chair. Must be called before hand starts.
func (t *Table) SeatNPC(persona *npc.NPCPersona, chair uint16, buyIn int64) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.npcManager == nil {
		return fmt.Errorf("NPC manager not available")
	}
	if chair >= t.Config.MaxPlayers {
		return fmt.Errorf("invalid chair %d", chair)
	}
	if t.seats[chair] != 0 {
		return fmt.Errorf("chair %d is occupied", chair)
	}

	inst, err := t.npcManager.SpawnNPC(t.game, chair, persona, buyIn)
	if err != nil {
		return err
	}

	// Register the NPC in the table's player/seat tracking
	t.players[inst.PlayerID] = &PlayerConn{
		UserID:   inst.PlayerID,
		Nickname: inst.Persona.Name,
		Chair:    chair,
		Stack:    buyIn,
		Online:   true,
		LastSeen: time.Now(),
	}
	t.seats[chair] = inst.PlayerID
	t.updateEmptySinceLocked(time.Now())

	log.Printf("[Table %s] NPC %s seated at chair %d with %d", t.ID, persona.Name, chair, buyIn)
	return nil
}

// NPCManager returns the table's NPC manager (may be nil).
func (t *Table) NPCManager() *npc.Manager {
	return t.npcManager
}

// --- Broadcast helpers with proto encoding ---

func (t *Table) nextSeq() uint64 {
	t.serverSeq++
	return t.serverSeq
}

func (t *Table) buildHandID() string {
	if t.round == 0 {
		return ""
	}
	return fmt.Sprintf("%s_r%d", t.ID, t.round)
}

func (t *Table) appendLiveLedgerEvent(env *pb.ServerEnvelope, data []byte) {
	if t.ledger == nil {
		return
	}
	handID := strings.TrimSpace(t.handID)
	if handID == "" {
		return
	}
	// Keep a stable copy to avoid accidental reuse by callers.
	encoded := make([]byte, len(data))
	copy(encoded, data)
	go t.ledger.AppendLiveEvent(handID, env, encoded)
}

func (t *Table) appendUserHandTape(userID uint64, env *pb.ServerEnvelope, data []byte) {
	if userID == 0 || env == nil || len(data) == 0 {
		return
	}
	if strings.TrimSpace(t.handID) == "" {
		return
	}
	// Ignore runtime snapshots during hand replay capture. We keep only the
	// bootstrap snapshot (seq=0) to avoid mid-hand resets in replay.
	if _, ok := env.GetPayload().(*pb.ServerEnvelope_TableSnapshot); ok && env.GetServerSeq() > 0 {
		return
	}
	serverTs := env.GetServerTsMs()
	item := ledger.EventItem{
		Seq:         env.GetServerSeq(),
		EventType:   serverEnvelopeType(env),
		EnvelopeB64: base64.StdEncoding.EncodeToString(data),
	}
	if serverTs > 0 {
		v := serverTs
		item.ServerTsMs = &v
	}
	t.userHandTape[userID] = append(t.userHandTape[userID], item)
}

func (t *Table) appendReplayBootstrapSnapshots() {
	if strings.TrimSpace(t.handID) == "" {
		return
	}
	for chair, userID := range t.seats {
		if userID == 0 || chair == holdem.InvalidChair {
			continue
		}
		snapshot := t.buildReplayBootstrapSnapshotForUser(userID)
		env := &pb.ServerEnvelope{
			TableId:    t.ID,
			ServerSeq:  0,
			ServerTsMs: time.Now().UnixMilli(),
			Payload: &pb.ServerEnvelope_TableSnapshot{
				TableSnapshot: snapshot,
			},
		}
		data, err := proto.Marshal(env)
		if err != nil {
			continue
		}
		t.appendUserHandTape(userID, env, data)
	}
}

func (t *Table) buildTableSnapshotForUser(userID uint64) *pb.TableSnapshot {
	snap := t.game.Snapshot()
	ts := &pb.TableSnapshot{
		Config: &pb.TableConfig{
			MaxPlayers: uint32(t.Config.MaxPlayers),
			SmallBlind: t.Config.SmallBlind,
			BigBlind:   t.Config.BigBlind,
			Ante:       t.Config.Ante,
			MinBuyIn:   t.Config.MinBuyIn,
			MaxBuyIn:   t.Config.MaxBuyIn,
		},
		Phase:           phaseToProto(snap.Phase),
		Round:           uint32(snap.Round),
		DealerChair:     uint32(snap.DealerChair),
		SmallBlindChair: uint32(snap.SmallBlindChair),
		BigBlindChair:   uint32(snap.BigBlindChair),
		ActionChair:     uint32(snap.ActionChair),
		CurBet:          snap.CurBet,
		MinRaiseDelta:   snap.MinRaiseDelta,
	}
	for _, c := range snap.CommunityCards {
		ts.CommunityCards = append(ts.CommunityCards, cardToProto(c))
	}
	for _, pot := range snap.Pots {
		p := &pb.Pot{Amount: pot.Amount}
		for _, chair := range pot.EligiblePlayers {
			p.EligibleChairs = append(p.EligibleChairs, uint32(chair))
		}
		ts.Pots = append(ts.Pots, p)
	}
	for _, ps := range snap.Players {
		player := &pb.PlayerState{
			UserId:     ps.ID,
			Nickname:   t.playerNickname(ps.ID),
			Chair:      uint32(ps.Chair),
			Stack:      ps.Stack,
			Bet:        ps.Bet,
			Folded:     ps.Folded,
			AllIn:      ps.AllIn,
			LastAction: actionToProto(ps.LastAction),
			HasCards:   len(ps.HandCards) > 0,
		}
		// Only expose hole cards for the current user.
		if ps.ID == userID {
			for _, c := range ps.HandCards {
				player.HandCards = append(player.HandCards, cardToProto(c))
			}
		}
		ts.Players = append(ts.Players, player)
	}
	return ts
}

func (t *Table) buildReplayBootstrapSnapshotForUser(userID uint64) *pb.TableSnapshot {
	// Bootstrap snapshot should represent pre-hand state:
	// no private cards, no live bet commitments. This prevents replay from
	// visually "dealing twice" when handStart/dealHoleCards events arrive.
	ts := t.buildTableSnapshotForUser(userID)
	for _, p := range ts.Players {
		p.HandCards = nil
		p.HasCards = false
		p.Folded = false
		p.AllIn = false
		p.Bet = 0
		if startStack, ok := t.handStartStacks[uint16(p.Chair)]; ok {
			p.Stack = startStack
		}
	}
	ts.CurBet = 0
	ts.Pots = nil
	return ts
}

func serverEnvelopeType(env *pb.ServerEnvelope) string {
	switch env.GetPayload().(type) {
	case *pb.ServerEnvelope_TableSnapshot:
		return "tableSnapshot"
	case *pb.ServerEnvelope_SeatUpdate:
		return "seatUpdate"
	case *pb.ServerEnvelope_HandStart:
		return "handStart"
	case *pb.ServerEnvelope_DealHoleCards:
		return "dealHoleCards"
	case *pb.ServerEnvelope_ActionPrompt:
		return "actionPrompt"
	case *pb.ServerEnvelope_ActionResult:
		return "actionResult"
	case *pb.ServerEnvelope_DealBoard:
		return "dealBoard"
	case *pb.ServerEnvelope_PotUpdate:
		return "potUpdate"
	case *pb.ServerEnvelope_PhaseChange:
		return "phaseChange"
	case *pb.ServerEnvelope_WinByFold:
		return "winByFold"
	case *pb.ServerEnvelope_Showdown:
		return "showdown"
	case *pb.ServerEnvelope_HandEnd:
		return "handEnd"
	case *pb.ServerEnvelope_Error:
		return "error"
	case *pb.ServerEnvelope_LoginResponse:
		return "loginResponse"
	default:
		return "unknown"
	}
}

func (t *Table) sendToUser(userID uint64, env *pb.ServerEnvelope) {
	data, err := proto.Marshal(env)
	if err != nil {
		log.Printf("[Table %s] Failed to marshal message: %v", t.ID, err)
		return
	}
	t.appendUserHandTape(userID, env, data)
	t.broadcast(userID, data)
}

func (t *Table) broadcastToAll(env *pb.ServerEnvelope) {
	data, err := proto.Marshal(env)
	if err != nil {
		log.Printf("[Table %s] Failed to marshal message: %v", t.ID, err)
		return
	}
	t.appendLiveLedgerEvent(env, data)
	for userID := range t.players {
		t.appendUserHandTape(userID, env, data)
		t.broadcast(userID, data)
	}
}

func (t *Table) sendSnapshot(userID uint64) {
	log.Printf("[Table %s] Sending snapshot to %d", t.ID, userID)
	ts := t.buildTableSnapshotForUser(userID)

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload:    &pb.ServerEnvelope_TableSnapshot{TableSnapshot: ts},
	}
	t.sendToUser(userID, env)
}

func (t *Table) broadcastSeatUpdate(chair uint16, userID uint64, stack int64) {
	log.Printf("[Table %s] Broadcasting seat update: chair=%d user=%d stack=%d", t.ID, chair, userID, stack)
	nickname := t.playerNickname(userID)

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_SeatUpdate{
			SeatUpdate: &pb.SeatUpdate{
				Chair: uint32(chair),
				Update: &pb.SeatUpdate_PlayerJoined{
					PlayerJoined: &pb.PlayerState{
						UserId:   userID,
						Nickname: nickname,
						Chair:    uint32(chair),
						Stack:    stack,
						HasCards: false,
					},
				},
			},
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) broadcastSeatLeft(chair uint16, userID uint64) {
	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_SeatUpdate{
			SeatUpdate: &pb.SeatUpdate{
				Chair: uint32(chair),
				Update: &pb.SeatUpdate_PlayerLeftUserId{
					PlayerLeftUserId: userID,
				},
			},
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) broadcastHandStart() {
	snap := t.game.Snapshot()
	log.Printf("[Table %s] Broadcasting hand start", t.ID)

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_HandStart{
			HandStart: &pb.HandStart{
				Round:            uint32(snap.Round),
				DealerChair:      uint32(snap.DealerChair),
				SmallBlindChair:  uint32(snap.SmallBlindChair),
				BigBlindChair:    uint32(snap.BigBlindChair),
				SmallBlindAmount: t.Config.SmallBlind,
				BigBlindAmount:   t.Config.BigBlind,
			},
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) sendHoleCards() {
	snap := t.game.Snapshot()
	for _, ps := range snap.Players {
		if len(ps.HandCards) > 0 {
			log.Printf("[Table %s] Sending hole cards to chair %d: %v", t.ID, ps.Chair, ps.HandCards)

			cards := make([]*pb.Card, len(ps.HandCards))
			for i, c := range ps.HandCards {
				cards[i] = cardToProto(c)
			}

			env := &pb.ServerEnvelope{
				TableId:    t.ID,
				ServerSeq:  t.nextSeq(),
				ServerTsMs: time.Now().UnixMilli(),
				Payload: &pb.ServerEnvelope_DealHoleCards{
					DealHoleCards: &pb.DealHoleCards{
						Cards: cards,
					},
				},
			}
			t.sendToUser(ps.ID, env)
		}
	}
}

func (t *Table) sendActionPrompt(chair uint16) {
	// If the player on this chair is an NPC, still broadcast the ActionPrompt
	// so the frontend shows the active-player indicator, but don't set a
	// server-side timeout (the NPC goroutine handles timing).
	userID := t.seats[chair]
	if userID != 0 && t.isNPC(userID) {
		t.sendActionPromptWithTTL(chair, actionTimeLimitSec, false) // broadcast only, no timeout
		t.scheduleNPCAction(chair, userID)
		return
	}
	t.sendActionPromptWithTTL(chair, actionTimeLimitSec, true)
}

func (t *Table) sendActionPromptWithTTL(chair uint16, timeLimitSec int32, resetTimeout bool) {
	if timeLimitSec < 1 {
		timeLimitSec = 1
	}
	if resetTimeout {
		t.setActionTimeoutLocked(chair, time.Now())
	}

	actions, minRaise, err := t.game.LegalActions(chair)
	if err != nil {
		log.Printf("[Table %s] Failed to build action prompt for chair %d: %v", t.ID, chair, err)
		return
	}
	log.Printf("[Table %s] Action prompt to chair %d: actions=%v minRaise=%d", t.ID, chair, actions, minRaise)

	// Find userID for this chair
	userID := t.seats[chair]
	if userID == 0 {
		return
	}

	// Calculate call amount from current bet and player's bet
	snap := t.game.Snapshot()
	var playerBet int64
	for _, ps := range snap.Players {
		if ps.Chair == chair {
			playerBet = ps.Bet
			break
		}
	}
	callAmount := snap.CurBet - playerBet
	if callAmount < 0 {
		callAmount = 0
	}

	legalActions := make([]pb.ActionType, len(actions))
	for i, a := range actions {
		legalActions[i] = actionToProto(a)
	}

	deadline := t.actionDeadline
	if t.actionTimeoutChair != chair || deadline.IsZero() {
		deadline = time.Now().Add(time.Duration(timeLimitSec) * time.Second)
	}

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_ActionPrompt{
			ActionPrompt: &pb.ActionPrompt{
				Chair:            uint32(chair),
				LegalActions:     legalActions,
				MinRaiseTo:       minRaise,
				CallAmount:       callAmount,
				TimeLimitSec:     timeLimitSec,
				ActionDeadlineMs: deadline.UnixMilli(),
			},
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) sendPromptIfActingUser(userID uint64) {
	player := t.players[userID]
	if player == nil || player.Chair == holdem.InvalidChair {
		return
	}

	snap := t.game.Snapshot()
	if snap.Round == 0 || snap.Ended || snap.Phase == holdem.PhaseTypeRoundEnd {
		return
	}
	if snap.ActionChair == holdem.InvalidChair || snap.ActionChair != player.Chair {
		return
	}

	timeLimit := actionTimeLimitSec
	if t.actionTimeoutChair == player.Chair && !t.actionDeadline.IsZero() {
		remainingDuration := time.Until(t.actionDeadline)
		if remainingDuration < 0 {
			remainingDuration = 0
		}
		remaining := int32((remainingDuration + time.Second - 1) / time.Second)
		if remaining < 1 {
			remaining = 1
		}
		if remaining < timeLimit {
			timeLimit = remaining
		}
	}
	t.sendActionPromptWithTTL(player.Chair, timeLimit, false)
}

func (t *Table) broadcastActionResult(
	chair uint16,
	action holdem.ActionType,
	before holdem.Snapshot,
	after holdem.Snapshot,
	result *holdem.SettlementResult,
) {
	var newStack int64
	var finalBet int64
	for _, ps := range after.Players {
		if ps.Chair == chair {
			newStack = ps.Stack
			finalBet = ps.Bet
			break
		}
	}

	potTotal := totalCollectedPotAmount(after)
	if result != nil {
		if beforeTotal := totalCollectedPotAmount(before); beforeTotal > potTotal {
			potTotal = beforeTotal
		}
		if settledTotal := totalPotResultAmount(result); settledTotal > potTotal {
			potTotal = settledTotal
		}
	}

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_ActionResult{
			ActionResult: &pb.ActionResult{
				Chair:       uint32(chair),
				Action:      actionToProto(action),
				Amount:      finalBet,
				NewStack:    newStack,
				NewPotTotal: potTotal,
			},
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) broadcastHandEnd(result *holdem.SettlementResult) {
	log.Printf("[Table %s] Broadcasting hand end", t.ID)
	snap := t.game.Snapshot()
	t.syncPlayerStacksFromSnapshot(snap)
	isShowdown := hasShowdownHands(result)
	excessRefund := toExcessRefund(result)
	netResults := buildNetResults(result, snap)
	stackDeltas := t.buildStackDeltas(snap)

	if isShowdown {
		t.broadcastPhaseChange(holdem.PhaseTypeShowdown, snap.CommunityCards, snap.Pots, snap)
		showdown := buildShowdown(result, excessRefund, netResults)
		if showdown != nil {
			envShowdown := &pb.ServerEnvelope{
				TableId:    t.ID,
				ServerSeq:  t.nextSeq(),
				ServerTsMs: time.Now().UnixMilli(),
				Payload: &pb.ServerEnvelope_Showdown{
					Showdown: showdown,
				},
			}
			t.broadcastToAll(envShowdown)
		}
	} else {
		t.broadcastWinByFold(result, excessRefund)
	}

	// Send HandEnd
	envEnd := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_HandEnd{
			HandEnd: &pb.HandEnd{
				Round:        t.round,
				StackDeltas:  stackDeltas,
				ExcessRefund: excessRefund,
				NetResults:   netResults,
			},
		},
	}
	t.broadcastToAll(envEnd)
}

func (t *Table) syncPlayerStacksFromSnapshot(snap holdem.Snapshot) {
	for _, ps := range snap.Players {
		userID := t.seats[ps.Chair]
		if userID == 0 {
			continue
		}
		if pc := t.players[userID]; pc != nil {
			pc.Stack = ps.Stack
		}
	}
}

func (t *Table) broadcastStreetStateTransitions(before, after holdem.Snapshot) {
	beforeCount := len(before.CommunityCards)
	afterCount := len(after.CommunityCards)

	if beforeCount < 3 && afterCount >= 3 {
		flop := after.CommunityCards[:3]
		t.broadcastDealBoard(pb.Phase_PHASE_FLOP, flop)
		t.broadcastPhaseChange(holdem.PhaseTypeFlop, flop, after.Pots, after)
	}
	if beforeCount < 4 && afterCount >= 4 {
		turnBoard := after.CommunityCards[:4]
		t.broadcastDealBoard(pb.Phase_PHASE_TURN, after.CommunityCards[3:4])
		t.broadcastPhaseChange(holdem.PhaseTypeTurn, turnBoard, after.Pots, after)
	}
	if beforeCount < 5 && afterCount >= 5 {
		riverBoard := after.CommunityCards[:5]
		t.broadcastDealBoard(pb.Phase_PHASE_RIVER, after.CommunityCards[4:5])
		t.broadcastPhaseChange(holdem.PhaseTypeRiver, riverBoard, after.Pots, after)
	}
}

func (t *Table) broadcastDealBoard(phase pb.Phase, cards []card.Card) {
	board := &pb.DealBoard{
		Phase: phase,
		Cards: cardsToProto(cards),
	}
	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_DealBoard{
			DealBoard: board,
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) broadcastPotUpdate(pots []holdem.PotSnapshot) {
	update := &pb.PotUpdate{
		Pots: potsToProto(pots),
	}
	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_PotUpdate{
			PotUpdate: update,
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) broadcastPhaseChange(phase holdem.Phase, board []card.Card, pots []holdem.PotSnapshot, snap holdem.Snapshot) {
	communityCards := cardsToProto(board)
	potProtos := potsToProto(pots)
	base := &pb.PhaseChange{
		Phase:          phaseToProto(phase),
		CommunityCards: communityCards,
		Pots:           potProtos,
	}

	// my_hand_rank/my_hand_value are only meaningful when 5 board cards are available.
	if len(board) < 5 {
		env := &pb.ServerEnvelope{
			TableId:    t.ID,
			ServerSeq:  t.nextSeq(),
			ServerTsMs: time.Now().UnixMilli(),
			Payload: &pb.ServerEnvelope_PhaseChange{
				PhaseChange: base,
			},
		}
		t.broadcastToAll(env)
		return
	}

	ledgerLogged := false
	for userID, pc := range t.players {
		msg := &pb.PhaseChange{
			Phase:          base.Phase,
			CommunityCards: base.CommunityCards,
			Pots:           base.Pots,
		}
		if pc != nil && pc.Chair != holdem.InvalidChair {
			if rank, value, ok := evaluateMyHand(snap, pc.Chair); ok {
				msg.MyHandRank = &rank
				msg.MyHandValue = &value
			}
		}
		env := &pb.ServerEnvelope{
			TableId:    t.ID,
			ServerSeq:  t.nextSeq(),
			ServerTsMs: time.Now().UnixMilli(),
			Payload: &pb.ServerEnvelope_PhaseChange{
				PhaseChange: msg,
			},
		}
		if !ledgerLogged {
			canonical := &pb.ServerEnvelope{
				TableId:    t.ID,
				ServerSeq:  env.ServerSeq,
				ServerTsMs: env.ServerTsMs,
				Payload: &pb.ServerEnvelope_PhaseChange{
					PhaseChange: base,
				},
			}
			data, err := proto.Marshal(canonical)
			if err == nil {
				t.appendLiveLedgerEvent(canonical, data)
			}
			ledgerLogged = true
		}
		t.sendToUser(userID, env)
	}
}

func (t *Table) broadcastWinByFold(result *holdem.SettlementResult, excessRefund *pb.ExcessRefund) {
	var winnerChair uint16
	var found bool
	var winnerWinAmount int64
	for _, pr := range result.PlayerResults {
		if pr.IsWinner {
			winnerChair = pr.Chair
			winnerWinAmount = pr.WinAmount
			found = true
			break
		}
	}
	if !found {
		return
	}
	potTotal := totalPotResultAmount(result)
	if potTotal == 0 {
		potTotal = winnerWinAmount
	}

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_WinByFold{
			WinByFold: &pb.WinByFold{
				WinnerChair:  uint32(winnerChair),
				PotTotal:     potTotal,
				ExcessRefund: excessRefund,
			},
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) buildStackDeltas(snap holdem.Snapshot) []*pb.StackDelta {
	stackDeltas := make([]*pb.StackDelta, 0, len(snap.Players))
	for _, ps := range snap.Players {
		start := ps.Stack
		if stack, ok := t.handStartStacks[ps.Chair]; ok {
			start = stack
		}
		stackDeltas = append(stackDeltas, &pb.StackDelta{
			Chair:    uint32(ps.Chair),
			Delta:    ps.Stack - start,
			NewStack: ps.Stack,
		})
	}
	return stackDeltas
}

func (t *Table) persistLiveHandHistory(handID string, playedAt time.Time, result *holdem.SettlementResult) {
	if t.ledger == nil || strings.TrimSpace(handID) == "" || result == nil {
		return
	}
	snap := t.game.Snapshot()
	perChair := make(map[uint16]holdem.ShowdownPlayerResult, len(result.PlayerResults))
	for _, pr := range result.PlayerResults {
		perChair[pr.Chair] = pr
	}

	for _, ps := range snap.Players {
		userID := t.seats[ps.Chair]
		if userID == 0 {
			continue
		}
		// Skip NPC players — their IDs don't exist in the users table.
		if t.isNPC(userID) {
			continue
		}
		startStack := ps.Stack
		if v, ok := t.handStartStacks[ps.Chair]; ok {
			startStack = v
		}
		delta := ps.Stack - startStack

		chairResult, ok := perChair[ps.Chair]
		isWinner := ok && chairResult.IsWinner
		winAmount := int64(0)
		if ok {
			winAmount = chairResult.WinAmount
		}

		summary := map[string]any{
			"table_id":    t.ID,
			"round":       t.round,
			"chair":       ps.Chair,
			"delta":       delta,
			"is_winner":   isWinner,
			"win_amount":  winAmount,
			"ended_phase": holdem.PhaseTypeDictionary[snap.Phase],
			"stack_start": startStack,
			"stack_end":   ps.Stack,
		}
		userEvents := append([]ledger.EventItem(nil), t.userHandTape[userID]...)
		go t.ledger.UpsertLiveHistoryWithEvents(userID, handID, playedAt, summary, userEvents)
	}
}

func buildShowdown(result *holdem.SettlementResult, excessRefund *pb.ExcessRefund, netResults []*pb.NetResult) *pb.Showdown {
	showdown := &pb.Showdown{
		ExcessRefund: excessRefund,
		NetResults:   netResults,
	}

	for _, pr := range result.PotResults {
		winners := make([]*pb.Winner, 0, len(pr.Winners))
		for i, chair := range pr.Winners {
			amount := int64(0)
			if i < len(pr.WinAmounts) {
				amount = pr.WinAmounts[i]
			}
			winners = append(winners, &pb.Winner{
				Chair:     uint32(chair),
				WinAmount: amount,
			})
		}
		showdown.PotResults = append(showdown.PotResults, &pb.PotResult{
			PotAmount: pr.Amount,
			Winners:   winners,
		})
	}

	for _, pr := range result.PlayerResults {
		if pr.HandType == 0 {
			continue
		}
		showdown.Hands = append(showdown.Hands, &pb.ShowdownHand{
			Chair:     uint32(pr.Chair),
			HoleCards: cardsToProto(pr.HandCards),
			BestFive:  cardsToProto(pr.BestFiveCards),
			Rank:      handRankToProto(pr.HandType),
		})
	}

	if len(showdown.PotResults) == 0 && len(showdown.Hands) == 0 && len(showdown.NetResults) == 0 && showdown.ExcessRefund == nil {
		return nil
	}
	return showdown
}

func buildNetResults(result *holdem.SettlementResult, snap holdem.Snapshot) []*pb.NetResult {
	perChair := make(map[uint16]holdem.ShowdownPlayerResult, len(result.PlayerResults))
	for _, pr := range result.PlayerResults {
		perChair[pr.Chair] = pr
	}

	netResults := make([]*pb.NetResult, 0, len(snap.Players))
	for _, ps := range snap.Players {
		net := &pb.NetResult{Chair: uint32(ps.Chair)}
		if pr, ok := perChair[ps.Chair]; ok {
			net.WinAmount = pr.WinAmount
			net.IsWinner = pr.IsWinner
		}
		netResults = append(netResults, net)
	}
	return netResults
}

func toExcessRefund(result *holdem.SettlementResult) *pb.ExcessRefund {
	if result.ExcessAmount <= 0 {
		return nil
	}
	if result.ExcessChair == holdem.InvalidChair {
		return nil
	}
	return &pb.ExcessRefund{
		Chair:  uint32(result.ExcessChair),
		Amount: result.ExcessAmount,
	}
}

func hasShowdownHands(result *holdem.SettlementResult) bool {
	for _, pr := range result.PlayerResults {
		if pr.HandType > 0 {
			return true
		}
	}
	return false
}

func totalTheoreticalPotAmount(snap holdem.Snapshot) int64 {
	var potTotal int64
	for _, pot := range snap.Pots {
		potTotal += pot.Amount
	}
	for _, ps := range snap.Players {
		potTotal += ps.Bet
	}
	return potTotal
}

func totalCollectedPotAmount(snap holdem.Snapshot) int64 {
	var potTotal int64
	for _, pot := range snap.Pots {
		potTotal += pot.Amount
	}
	return potTotal
}

func totalPotResultAmount(result *holdem.SettlementResult) int64 {
	var total int64
	for _, pot := range result.PotResults {
		total += pot.Amount
	}
	return total
}

func cardsToProto(cards []card.Card) []*pb.Card {
	protoCards := make([]*pb.Card, 0, len(cards))
	for _, c := range cards {
		protoCards = append(protoCards, cardToProto(c))
	}
	return protoCards
}

func potsToProto(pots []holdem.PotSnapshot) []*pb.Pot {
	protoPots := make([]*pb.Pot, 0, len(pots))
	for _, pot := range pots {
		p := &pb.Pot{Amount: pot.Amount}
		eligible := append([]uint16{}, pot.EligiblePlayers...)
		sort.Slice(eligible, func(i, j int) bool { return eligible[i] < eligible[j] })
		for _, chair := range eligible {
			p.EligibleChairs = append(p.EligibleChairs, uint32(chair))
		}
		protoPots = append(protoPots, p)
	}
	return protoPots
}

func evaluateMyHand(snap holdem.Snapshot, chair uint16) (pb.HandRank, uint32, bool) {
	if len(snap.CommunityCards) != 5 {
		return pb.HandRank_HAND_RANK_UNSPECIFIED, 0, false
	}
	var holeCards []card.Card
	for _, ps := range snap.Players {
		if ps.Chair == chair {
			holeCards = ps.HandCards
			break
		}
	}
	if len(holeCards) != 2 {
		return pb.HandRank_HAND_RANK_UNSPECIFIED, 0, false
	}
	allCards := make([]card.Card, 0, 7)
	allCards = append(allCards, holeCards...)
	allCards = append(allCards, snap.CommunityCards...)
	eval := holdem.EvalBestOf7(allCards)
	if eval == nil {
		return pb.HandRank_HAND_RANK_UNSPECIFIED, 0, false
	}
	return handRankToProto(eval.HandType), eval.Score, true
}

func potsChanged(before, after []holdem.PotSnapshot) bool {
	if len(before) != len(after) {
		return true
	}
	for i := range before {
		if before[i].Amount != after[i].Amount {
			return true
		}
		if len(before[i].EligiblePlayers) != len(after[i].EligiblePlayers) {
			return true
		}
		b1 := append([]uint16{}, before[i].EligiblePlayers...)
		b2 := append([]uint16{}, after[i].EligiblePlayers...)
		sort.Slice(b1, func(x, y int) bool { return b1[x] < b1[y] })
		sort.Slice(b2, func(x, y int) bool { return b2[x] < b2[y] })
		for j := range b1 {
			if b1[j] != b2[j] {
				return true
			}
		}
	}
	return false
}

func hasAction(actions []holdem.ActionType, target holdem.ActionType) bool {
	for _, action := range actions {
		if action == target {
			return true
		}
	}
	return false
}

// --- Proto conversion helpers ---

func handRankToProto(r byte) pb.HandRank {
	switch r {
	case holdem.HandHighCard:
		return pb.HandRank_HAND_RANK_HIGH_CARD
	case holdem.HandOnePair:
		return pb.HandRank_HAND_RANK_ONE_PAIR
	case holdem.HandTwoPair:
		return pb.HandRank_HAND_RANK_TWO_PAIR
	case holdem.HandThreeOfKind:
		return pb.HandRank_HAND_RANK_THREE_OF_KIND
	case holdem.HandStraight:
		return pb.HandRank_HAND_RANK_STRAIGHT
	case holdem.HandFlush:
		return pb.HandRank_HAND_RANK_FLUSH
	case holdem.HandFullHouse:
		return pb.HandRank_HAND_RANK_FULL_HOUSE
	case holdem.HandFourOfKind:
		return pb.HandRank_HAND_RANK_FOUR_OF_KIND
	case holdem.HandStraightFlush:
		return pb.HandRank_HAND_RANK_STRAIGHT_FLUSH
	case holdem.HandRoyalFlush:
		return pb.HandRank_HAND_RANK_ROYAL_FLUSH
	default:
		return pb.HandRank_HAND_RANK_UNSPECIFIED
	}
}

func phaseToProto(p holdem.Phase) pb.Phase {
	switch p {
	case holdem.PhaseTypeAnte:
		return pb.Phase_PHASE_ANTE
	case holdem.PhaseTypePreflop:
		return pb.Phase_PHASE_PREFLOP
	case holdem.PhaseTypeFlop:
		return pb.Phase_PHASE_FLOP
	case holdem.PhaseTypeTurn:
		return pb.Phase_PHASE_TURN
	case holdem.PhaseTypeRiver:
		return pb.Phase_PHASE_RIVER
	case holdem.PhaseTypeShowdown:
		return pb.Phase_PHASE_SHOWDOWN
	default:
		return pb.Phase_PHASE_UNSPECIFIED
	}
}

func actionToProto(a holdem.ActionType) pb.ActionType {
	switch a {
	case holdem.PlayerActionTypeCheck:
		return pb.ActionType_ACTION_CHECK
	case holdem.PlayerActionTypeBet:
		return pb.ActionType_ACTION_BET
	case holdem.PlayerActionTypeCall:
		return pb.ActionType_ACTION_CALL
	case holdem.PlayerActionTypeRaise:
		return pb.ActionType_ACTION_RAISE
	case holdem.PlayerActionTypeFold:
		return pb.ActionType_ACTION_FOLD
	case holdem.PlayerActionTypeAllin:
		return pb.ActionType_ACTION_ALLIN
	default:
		return pb.ActionType_ACTION_UNSPECIFIED
	}
}

func cardToProto(c card.Card) *pb.Card {
	return &pb.Card{
		Suit: suitToProto(c.Suit()),
		Rank: rankToProto(c.Rank()),
	}
}

func suitToProto(s card.Suit) pb.Suit {
	switch s {
	case card.Spade:
		return pb.Suit_SUIT_SPADE
	case card.Heart:
		return pb.Suit_SUIT_HEART
	case card.Club:
		return pb.Suit_SUIT_CLUB
	case card.Diamond:
		return pb.Suit_SUIT_DIAMOND
	default:
		return pb.Suit_SUIT_UNSPECIFIED
	}
}

func rankToProto(r byte) pb.Rank {
	switch r {
	case 1:
		return pb.Rank_RANK_A
	case 2:
		return pb.Rank_RANK_2
	case 3:
		return pb.Rank_RANK_3
	case 4:
		return pb.Rank_RANK_4
	case 5:
		return pb.Rank_RANK_5
	case 6:
		return pb.Rank_RANK_6
	case 7:
		return pb.Rank_RANK_7
	case 8:
		return pb.Rank_RANK_8
	case 9:
		return pb.Rank_RANK_9
	case 10:
		return pb.Rank_RANK_10
	case 11:
		return pb.Rank_RANK_J
	case 12:
		return pb.Rank_RANK_Q
	case 13:
		return pb.Rank_RANK_K
	default:
		return pb.Rank_RANK_UNSPECIFIED
	}
}
