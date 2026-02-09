package table

import (
	"fmt"
	"log"
	"sync"
	"time"

	pb "holdem-lite/apps/server/gen"
	"holdem-lite/card"
	"holdem-lite/holdem"

	"google.golang.org/protobuf/proto"
)

// Table represents a single poker table with an actor model
type Table struct {
	ID     string
	Config TableConfig

	mu      sync.RWMutex
	game    *holdem.Game
	players map[uint32]*PlayerConn // userID -> connection
	seats   map[uint16]uint32      // chair -> userID
	round   uint32

	// Event channel for actor pattern
	events chan Event
	done   chan struct{}

	// Server sequence for event ordering
	serverSeq uint64

	// Callback to broadcast messages
	broadcast func(userID uint32, data []byte)
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
	UserID   uint32
	Nickname string
	Chair    uint16
	Stack    int64
	Wallet   int64 // Chips not yet at table
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
)

// Event represents a message to the table actor
type Event struct {
	Type      EventType
	UserID    uint32
	Chair     uint16
	Amount    int64
	Action    holdem.ActionType
	Timestamp time.Time
	Response  chan error
}

// New creates a new table
func New(id string, cfg TableConfig, broadcastFn func(userID uint32, data []byte)) *Table {
	t := &Table{
		ID:        id,
		Config:    cfg,
		players:   make(map[uint32]*PlayerConn),
		seats:     make(map[uint16]uint32),
		events:    make(chan Event, 256),
		done:      make(chan struct{}),
		broadcast: broadcastFn,
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
	ticker := time.NewTicker(100 * time.Millisecond)
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

	switch e.Type {
	case EventJoinTable:
		return t.handleJoinTable(e.UserID)
	case EventSitDown:
		return t.handleSitDown(e.UserID, e.Chair, e.Amount)
	case EventStandUp:
		return t.handleStandUp(e.UserID)
	case EventBuyIn:
		return t.handleBuyIn(e.UserID, e.Amount)
	case EventAction:
		return t.handleAction(e.UserID, e.Action, e.Amount)
	case EventStartHand:
		return t.handleStartHand()
	default:
		return fmt.Errorf("unknown event type: %d", e.Type)
	}
}

func (t *Table) handleJoinTable(userID uint32) error {
	if _, exists := t.players[userID]; exists {
		return nil // Already joined
	}
	t.players[userID] = &PlayerConn{
		UserID: userID,
		Chair:  holdem.InvalidChair,
	}
	log.Printf("[Table %s] Player %d joined", t.ID, userID)
	t.sendSnapshot(userID)
	return nil
}

func (t *Table) handleSitDown(userID uint32, chair uint16, buyIn int64) error {
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
	t.seats[chair] = userID

	log.Printf("[Table %s] Player %d sat down at chair %d with %d", t.ID, userID, chair, buyIn)

	// Broadcast seat update to all
	t.broadcastSeatUpdate(chair, userID, buyIn)

	// Check if we can start a hand
	t.tryStartHand()

	return nil
}

func (t *Table) handleStandUp(userID uint32) error {
	player := t.players[userID]
	if player == nil || player.Chair == holdem.InvalidChair {
		return nil
	}

	chair := player.Chair
	// TODO: Handle if player is in active hand

	delete(t.seats, chair)
	player.Chair = holdem.InvalidChair
	player.Wallet += player.Stack
	player.Stack = 0

	log.Printf("[Table %s] Player %d stood up from chair %d", t.ID, userID, chair)
	return nil
}

func (t *Table) handleBuyIn(userID uint32, amount int64) error {
	player := t.players[userID]
	if player == nil {
		return fmt.Errorf("player not in table")
	}
	// TODO: Implement pending buy-in for mid-hand
	return nil
}

func (t *Table) handleAction(userID uint32, action holdem.ActionType, amount int64) error {
	player := t.players[userID]
	if player == nil || player.Chair == holdem.InvalidChair {
		return fmt.Errorf("player not seated")
	}

	snap := t.game.Snapshot()
	if snap.ActionChair != player.Chair {
		return fmt.Errorf("not your turn")
	}

	result, err := t.game.Act(player.Chair, action, amount)
	if err != nil {
		return err
	}

	log.Printf("[Table %s] Player %d action: %v amount: %d", t.ID, userID, action, amount)

	// Broadcast action result
	t.broadcastActionResult(player.Chair, action, amount)

	// Check if hand ended
	if result != nil {
		t.handleHandEnd(result)
	} else {
		// Prompt next player
		newSnap := t.game.Snapshot()
		if newSnap.ActionChair != holdem.InvalidChair {
			t.sendActionPrompt(newSnap.ActionChair)
		}
	}

	return nil
}

func (t *Table) handleStartHand() error {
	log.Printf("[Table %s] handleStartHand called, seats=%d", t.ID, len(t.seats))
	if err := t.game.StartHand(); err != nil {
		log.Printf("[Table %s] StartHand failed: %v", t.ID, err)
		return err
	}
	t.round++

	snap := t.game.Snapshot()
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

	// Broadcast showdown/hand end
	t.broadcastHandEnd(result)

	// Schedule next hand
	time.AfterFunc(3*time.Second, func() {
		t.SubmitEvent(Event{Type: EventStartHand})
	})
}

func (t *Table) tick() {
	// TODO: Check action timeouts
}

func (t *Table) tryStartHand() {
	// Count seated players
	if len(t.seats) >= 2 {
		snap := t.game.Snapshot()
		// Start if: no hands played yet (Round==0), OR previous hand ended
		if snap.Round == 0 || snap.Ended || snap.Phase == holdem.PhaseTypeRoundEnd {
			log.Printf("[Table %s] Starting hand - seats=%d, round=%d, ended=%v, phase=%v",
				t.ID, len(t.seats), snap.Round, snap.Ended, snap.Phase)
			// Use goroutine to avoid deadlock (we're inside handleEvent)
			go func() {
				t.SubmitEvent(Event{Type: EventStartHand})
			}()
		}
	}
}

// SubmitEvent sends an event to the actor
func (t *Table) SubmitEvent(e Event) error {
	e.Timestamp = time.Now()
	if e.Response == nil {
		e.Response = make(chan error, 1)
	}
	t.events <- e
	return <-e.Response
}

// Stop shuts down the table actor
func (t *Table) Stop() {
	close(t.done)
}

// Snapshot returns current game state (thread-safe)
func (t *Table) Snapshot() holdem.Snapshot {
	return t.game.Snapshot()
}

// --- Broadcast helpers with proto encoding ---

func (t *Table) nextSeq() uint64 {
	t.serverSeq++
	return t.serverSeq
}

func (t *Table) sendToUser(userID uint32, env *pb.ServerEnvelope) {
	data, err := proto.Marshal(env)
	if err != nil {
		log.Printf("[Table %s] Failed to marshal message: %v", t.ID, err)
		return
	}
	t.broadcast(userID, data)
}

func (t *Table) broadcastToAll(env *pb.ServerEnvelope) {
	data, err := proto.Marshal(env)
	if err != nil {
		log.Printf("[Table %s] Failed to marshal message: %v", t.ID, err)
		return
	}
	for userID := range t.players {
		t.broadcast(userID, data)
	}
}

func (t *Table) sendSnapshot(userID uint32) {
	snap := t.game.Snapshot()
	log.Printf("[Table %s] Sending snapshot to %d", t.ID, userID)

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
			Chair:      uint32(ps.Chair),
			Stack:      ps.Stack,
			Bet:        ps.Bet,
			Folded:     ps.Folded,
			AllIn:      ps.AllIn,
			LastAction: actionToProto(ps.LastAction),
		}
		// Only send hole cards to the player themselves
		if ps.ID == userID {
			for _, c := range ps.HandCards {
				player.HandCards = append(player.HandCards, cardToProto(c))
			}
		}
		ts.Players = append(ts.Players, player)
	}

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload:    &pb.ServerEnvelope_TableSnapshot{TableSnapshot: ts},
	}
	t.sendToUser(userID, env)
}

func (t *Table) broadcastSeatUpdate(chair uint16, userID uint32, stack int64) {
	log.Printf("[Table %s] Broadcasting seat update: chair=%d user=%d stack=%d", t.ID, chair, userID, stack)

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_SeatUpdate{
			SeatUpdate: &pb.SeatUpdate{
				Chair: uint32(chair),
				Update: &pb.SeatUpdate_PlayerJoined{
					PlayerJoined: &pb.PlayerState{
						UserId: userID,
						Chair:  uint32(chair),
						Stack:  stack,
					},
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
	actions, minRaise, _ := t.game.LegalActions(chair)
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

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_ActionPrompt{
			ActionPrompt: &pb.ActionPrompt{
				Chair:        uint32(chair),
				LegalActions: legalActions,
				MinRaiseTo:   minRaise,
				CallAmount:   callAmount,
				TimeLimitSec: 30,
			},
		},
	}
	t.sendToUser(userID, env)
}

func (t *Table) broadcastActionResult(chair uint16, action holdem.ActionType, amount int64) {
	snap := t.game.Snapshot()
	var newStack int64
	for _, ps := range snap.Players {
		if ps.Chair == chair {
			newStack = ps.Stack
			break
		}
	}

	var potTotal int64
	for _, pot := range snap.Pots {
		potTotal += pot.Amount
	}

	env := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_ActionResult{
			ActionResult: &pb.ActionResult{
				Chair:       uint32(chair),
				Action:      actionToProto(action),
				Amount:      amount,
				NewStack:    newStack,
				NewPotTotal: potTotal,
			},
		},
	}
	t.broadcastToAll(env)
}

func (t *Table) broadcastHandEnd(result *holdem.SettlementResult) {
	log.Printf("[Table %s] Broadcasting hand end", t.ID)

	// Check if any player has a valid hand type (implies actual showdown/cards revealed)
	isShowdown := false
	for _, pr := range result.PlayerResults {
		if pr.HandType > 0 {
			isShowdown = true
			break
		}
	}

	// Always construct Showdown message if there are winners/pot results
	// This ensures clients know who won even if everyone else folded
	var showdown *pb.Showdown
	if len(result.PotResults) > 0 {
		showdown = &pb.Showdown{}

		// Pot Results
		for _, pr := range result.PotResults {
			winners := make([]*pb.Winner, len(pr.Winners))
			for i, chair := range pr.Winners {
				winners[i] = &pb.Winner{
					Chair:     uint32(chair),
					WinAmount: pr.WinAmounts[i],
				}
			}
			showdown.PotResults = append(showdown.PotResults, &pb.PotResult{
				PotAmount: pr.Amount,
				Winners:   winners,
			})
		}

		// Hands (only if actual showdown)
		if isShowdown {
			for _, pr := range result.PlayerResults {
				holeCards := make([]*pb.Card, len(pr.HandCards))
				for i, c := range pr.HandCards {
					holeCards[i] = cardToProto(c)
				}
				bestFive := make([]*pb.Card, len(pr.BestFiveCards))
				for i, c := range pr.BestFiveCards {
					bestFive[i] = cardToProto(c)
				}
				showdown.Hands = append(showdown.Hands, &pb.ShowdownHand{
					Chair:     uint32(pr.Chair),
					HoleCards: holeCards,
					BestFive:  bestFive,
					Rank:      handRankToProto(pr.HandType),
				})
			}
		}
	}

	// Construct StackDeltas from current state
	snap := t.game.Snapshot()
	var stackDeltas []*pb.StackDelta

	for _, ps := range snap.Players {
		stackDeltas = append(stackDeltas, &pb.StackDelta{
			Chair:    uint32(ps.Chair),
			NewStack: ps.Stack,
		})
	}

	// Send Showdown first if valid
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

	// Send HandEnd
	envEnd := &pb.ServerEnvelope{
		TableId:    t.ID,
		ServerSeq:  t.nextSeq(),
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_HandEnd{
			HandEnd: &pb.HandEnd{
				Round:       t.round,
				StackDeltas: stackDeltas,
			},
		},
	}
	t.broadcastToAll(envEnd)
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
