package holdem

import (
	"fmt"
	"math/rand"
	"sort"
	"sync"
	"time"

	"holdem-lite/card"
)

type Game struct {
	cfg Config
	rng *rand.Rand

	mu sync.Mutex

	// seats
	playersByChair map[uint16]*Player
	chairIDNodes   map[uint16]*PlayerNode

	// hand state
	round          uint16
	phase          Phase
	communityCards card.CardList
	stockCards     card.CardList

	dealerNode     *PlayerNode
	smallBlindNode *PlayerNode
	bigBlindNode   *PlayerNode
	curNode        *PlayerNode

	activeCount int
	allinCount  int

	// Explicit betting-round state (per workspace rule)
	NeedActionCount int    // 剩余必须表态人数
	MinRaise        int64  // 当前合法加注底线（delta）
	CurrentRaiser   uint16 // 触发轮次重置的玩家（chair）

	curBet           int64
	lastPlayerAction ActionType
	validActions     []ActionType

	noShowDown bool
	ended      bool

	potManager potManager

	lastSettlement *SettlementResult
}

func NewGame(cfg Config) (*Game, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	seed := cfg.Seed
	if seed == 0 {
		seed = time.Now().UnixNano()
	}
	g := &Game{
		cfg:            cfg,
		rng:            rand.New(rand.NewSource(seed)),
		playersByChair: make(map[uint16]*Player, cfg.MaxPlayers),
		chairIDNodes:   make(map[uint16]*PlayerNode, cfg.MaxPlayers),
		phase:          PhaseTypeAnte,
		CurrentRaiser:  InvalidChair,
	}
	g.potManager.resetPots()
	return g, nil
}

// SitDown seats a player with initial stack.
func (g *Game) SitDown(chair uint16, playerID uint64, stack int64, robot bool) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if chair >= uint16(g.cfg.MaxPlayers) {
		return fmt.Errorf("invalid chair %d", chair)
	}
	if stack < 0 {
		return fmt.Errorf("stack must be >= 0")
	}
	if g.playersByChair[chair] != nil {
		return fmt.Errorf("chair %d already occupied", chair)
	}
	g.playersByChair[chair] = &Player{
		ID:    playerID,
		Chair: chair,
		Robot: robot,
		stack: stack,
	}
	return nil
}

// StandUp removes a player from a chair between hands.
func (g *Game) StandUp(chair uint16) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if chair >= uint16(g.cfg.MaxPlayers) {
		return fmt.Errorf("invalid chair %d", chair)
	}
	if g.playersByChair[chair] == nil {
		return fmt.Errorf("chair %d is empty", chair)
	}
	// Keep gameplay state deterministic: no seat mutation during an active hand.
	if g.round > 0 && !g.ended {
		return ErrHandInProgress
	}

	delete(g.playersByChair, chair)
	delete(g.chairIDNodes, chair)

	if g.dealerNode != nil && g.dealerNode.ChairID == chair {
		g.dealerNode = nil
	}
	if g.smallBlindNode != nil && g.smallBlindNode.ChairID == chair {
		g.smallBlindNode = nil
	}
	if g.bigBlindNode != nil && g.bigBlindNode.ChairID == chair {
		g.bigBlindNode = nil
	}
	if g.curNode != nil && g.curNode.ChairID == chair {
		g.curNode = nil
	}

	return nil
}

func (g *Game) Player(chair uint16) *Player {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.playersByChair[chair]
}

// StartHand starts a new hand (single-table engine).
func (g *Game) StartHand() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.ended = false
	g.lastSettlement = nil
	g.noShowDown = false
	g.communityCards = nil

	// Build active players list (stack > 0)
	active := make([]*Player, 0, g.cfg.MaxPlayers)
	for chair := uint16(0); chair < uint16(g.cfg.MaxPlayers); chair++ {
		p := g.playersByChair[chair]
		if p == nil || p.stack <= 0 {
			continue
		}
		p.ResetForNewHand()
		active = append(active, p)
	}
	if len(active) < g.cfg.MinPlayers {
		return fmt.Errorf("not enough players: %d < %d", len(active), g.cfg.MinPlayers)
	}

	g.round++

	// Reset per-hand state
	g.potManager.resetPots()
	g.activeCount = len(active)
	g.allinCount = 0
	g.curBet = 0
	g.MinRaise = 0
	g.NeedActionCount = 0
	g.CurrentRaiser = InvalidChair
	g.lastPlayerAction = PlayerActionTypeNone

	// Rebuild ring list nodes in chair order
	g.chairIDNodes = make(map[uint16]*PlayerNode, len(active))
	var first, last *PlayerNode
	for chair := uint16(0); chair < uint16(g.cfg.MaxPlayers); chair++ {
		p := g.playersByChair[chair]
		if p == nil || p.stack <= 0 {
			continue
		}
		node := &PlayerNode{ChairID: chair, Player: p}
		g.chairIDNodes[chair] = node
		if first == nil {
			first = node
		}
		if last != nil {
			last.Next = node
		}
		last = node
	}
	if first != nil && last != nil {
		last.Next = first
	}

	// Shuffle deck
	g.shuffle()

	// Select dealer
	g.selectDealer()

	// Select blinds & first action position
	g.selectBlindsByDealer(g.dealerNode)

	// Deal hole cards
	g.dealHoleCards()

	// Antes
	g.phase = PhaseTypeAnte
	if g.autoBetAntes() {
		if err := g.advanceToShowdownLocked(); err != nil {
			return err
		}
		_, err := g.endHandLocked()
		return err
	}

	// Blinds
	if g.autoBetBlinds() {
		if err := g.advanceToShowdownLocked(); err != nil {
			return err
		}
		_, err := g.endHandLocked()
		return err
	}

	// Skip players with 0 stack (all-in)
	g.curNode = g.curNode.WalkOnce(func(cur *PlayerNode) bool {
		return cur.Player.stack > 0 && !cur.Player.folded
	})

	g.phase = PhaseTypePreflop
	g.onPhaseStartLocked()
	return nil
}

// LegalActions is a pure projection of current state.
func (g *Game) LegalActions(chair uint16) ([]ActionType, int64, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.ended {
		return nil, 0, ErrHandEnded
	}
	p := g.playersByChair[chair]
	if p == nil {
		return nil, 0, fmt.Errorf("player not found")
	}
	acts := g.calcNextValidActions(p)
	minTotalRaiseTo := g.curBet + g.MinRaise
	if g.lastPlayerAction == PlayerActionTypeNone || g.lastPlayerAction == PlayerActionTypeCheck {
		// min bet is big blind when no bet yet
		minTotalRaiseTo = g.cfg.BigBlind
	}
	return acts, minTotalRaiseTo, nil
}

// Act applies an action for the current player.
// amount 表示“该玩家在本轮的总下注额”（与原实现保持一致）。
// handEnd != nil 表示本手已结束并返回结算结果。
func (g *Game) Act(chair uint16, action ActionType, amount int64) (handEnd *SettlementResult, err error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.ended {
		return nil, ErrHandEnded
	}
	if g.curNode == nil || g.curNode.Player == nil {
		return nil, ErrInvalidState("no current player")
	}
	if chair != g.curNode.ChairID {
		return nil, ErrOutOfTurn
	}

	player := g.curNode.Player

	// Validate action against legal list (pure projection)
	legal := g.calcNextValidActions(player)
	valid := false
	for _, a := range legal {
		if a == action {
			valid = true
			break
		}
	}
	if !valid {
		return nil, fmt.Errorf("invalid action %s", PlayerActionTypeDictionary[action])
	}

	// amount normalization
	if amount < player.bet && action != PlayerActionTypeFold {
		if action != PlayerActionTypeCheck {
			return nil, fmt.Errorf("invalid amount %d < current bet %d", amount, player.bet)
		}
		amount = player.bet
	}

	// Overbet => All-in
	if amount-player.bet > player.stack {
		amount = player.stack + player.bet
		action = PlayerActionTypeAllin
	}

	originalAction := action
	// Update betting state on increase
	if amount > g.curBet {
		validRaise := true
		switch action {
		case PlayerActionTypeAllin:
			// 判断是否为有效加注的 all-in（不足最小加注不 reopen）
			if amount-g.curBet < g.MinRaise {
				validRaise = false
			}
		case PlayerActionTypeBet:
			if amount-g.curBet < g.cfg.BigBlind {
				return nil, fmt.Errorf("invalid bet amount")
			}
		case PlayerActionTypeRaise:
			if amount-g.curBet < g.MinRaise {
				return nil, fmt.Errorf("invalid raise amount")
			}
		}

		if validRaise {
			g.MinRaise = amount - g.curBet
			g.CurrentRaiser = chair
		}
		g.curBet = amount
		g.setNeedActionCountLocked()
	}

	player.setLastAction(action)
	switch action {
	case PlayerActionTypeBet, PlayerActionTypeRaise:
		player.placeBet(amount - player.bet)
	case PlayerActionTypeCall:
		if amount != g.curBet {
			available := player.stack + player.bet
			if available > g.curBet {
				amount = g.curBet
			} else {
				return nil, fmt.Errorf("invalid call amount")
			}
		}
		player.placeBet(amount - player.bet)
	case PlayerActionTypeCheck:
		// no-op
	case PlayerActionTypeFold:
		player.setFolded(true)
		g.activeCount--
		// remove from existing pots eligibility
		for i := range g.potManager.pots {
			delete(g.potManager.pots[i].eligiblePlayers, chair)
		}
		if g.activeCount <= 1 {
			g.noShowDown = true
			return g.endHandLocked()
		}
	case PlayerActionTypeAllin:
		player.placeBet(player.stack)
		g.allinCount++
		_ = originalAction
	}

	if action != PlayerActionTypeFold {
		g.lastPlayerAction = action
	}

	g.NeedActionCount--
	nextNode, bettingEnd := g.calcNextActionPosAndBettingEndLocked()
	g.curNode = nextNode

	if bettingEnd {
		g.validActions = nil
		g.collectBetsLocked()

		if g.checkDirectShowdownLocked() || g.phase == PhaseTypeRiver {
			if err := g.advanceToShowdownLocked(); err != nil {
				return nil, err
			}
			return g.endHandLocked()
		}

		// next phase
		g.phase++
		g.dealCommunityCardsLocked()
		g.onPhaseStartLocked()
		return nil, nil
	}

	// continue betting
	if g.curNode == nil || g.curNode.Player == nil {
		return nil, ErrInvalidState("next player not found")
	}
	g.validActions = g.calcNextValidActions(g.curNode.Player)
	return nil, nil
}

func (g *Game) onPhaseStartLocked() {
	// Reset per-phase betting state
	g.setNeedActionCountLocked()
	g.CurrentRaiser = InvalidChair
	for _, p := range g.playersByChair {
		if p != nil {
			p.setLastAction(PlayerActionTypeNone)
		}
	}

	switch g.phase {
	case PhaseTypePreflop:
		// blinds are treated as a bet
		g.lastPlayerAction = PlayerActionTypeBet
		// MinRaise already set by blinds (bb)
	default:
		g.lastPlayerAction = PlayerActionTypeNone
		g.MinRaise = g.cfg.BigBlind
	}

	if g.curNode != nil && g.curNode.Player != nil {
		g.validActions = g.calcNextValidActions(g.curNode.Player)
	}
}

func (g *Game) shuffle() {
	cards := make([]card.Card, len(HoldemCards))
	copy(cards, HoldemCards)
	g.rng.Shuffle(len(cards), func(i, j int) { cards[i], cards[j] = cards[j], cards[i] })
	g.stockCards.Init(cards)
}

func (g *Game) selectDealer() {
	nodes := make([]*PlayerNode, 0, len(g.chairIDNodes))
	for _, n := range g.chairIDNodes {
		nodes = append(nodes, n)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ChairID < nodes[j].ChairID })
	if len(nodes) == 0 {
		g.dealerNode = nil
		return
	}

	// first hand: random dealer
	if g.round == 1 || g.dealerNode == nil {
		g.dealerNode = nodes[g.rng.Intn(len(nodes))]
		return
	}

	// move button to next active seat (based on previous dealer chair)
	prevChair := g.dealerNode.ChairID
	if prevNode, ok := g.chairIDNodes[prevChair]; ok && prevNode.Next != nil {
		g.dealerNode = prevNode.Next
		return
	}

	// fallback
	g.dealerNode = nodes[g.rng.Intn(len(nodes))]
}

func (g *Game) selectBlindsByDealer(dealer *PlayerNode) {
	if dealer == nil {
		return
	}
	if g.activeCount == 2 {
		// Heads-Up
		g.dealerNode = dealer
		g.smallBlindNode = dealer
		g.bigBlindNode = dealer.Next
		g.curNode = dealer
	} else {
		g.dealerNode = dealer
		g.smallBlindNode = dealer.Next
		g.bigBlindNode = g.smallBlindNode.Next
		g.curNode = g.bigBlindNode.Next
	}
}

func (g *Game) dealHoleCards() {
	if g.smallBlindNode == nil {
		return
	}
	for i := 0; i < 2; i++ {
		g.smallBlindNode.WalkAll(func(cur *PlayerNode) {
			cards, ok := g.stockCards.PopCards(1)
			if !ok {
				panic("deck underflow")
			}
			cur.Player.AddHandCard(cards...)
		})
	}
}

func (g *Game) dealCommunityCardsLocked() {
	shouldDeal := 0
	switch g.phase {
	case PhaseTypeFlop:
		shouldDeal = 3
	case PhaseTypeTurn, PhaseTypeRiver:
		shouldDeal = 1
	case PhaseTypeShowdown:
		shouldDeal = 5 - len(g.communityCards)
	}
	if shouldDeal <= 0 {
		return
	}
	if cards, ok := g.stockCards.PopCards(shouldDeal); ok {
		g.communityCards = append(g.communityCards, cards...)
	}
}

func (g *Game) autoBetAntes() bool {
	if g.cfg.Ante == 0 {
		return false
	}
	notAllIn := 0
	for _, p := range g.playersByChair {
		if p == nil || p.stack <= 0 {
			continue
		}
		p.placeBet(g.cfg.Ante)
		if p.stack > 0 {
			notAllIn++
		}
	}
	g.allinCount = g.activeCount - notAllIn
	g.collectBetsLocked()
	return notAllIn <= 1
}

func (g *Game) autoBetBlinds() bool {
	if g.smallBlindNode != nil && g.smallBlindNode.Player.stack > 0 && g.cfg.SmallBlind > 0 {
		g.smallBlindNode.Player.placeBet(g.cfg.SmallBlind)
		if g.smallBlindNode.Player.stack <= 0 {
			g.allinCount++
		}
	}
	if g.bigBlindNode != nil && g.bigBlindNode.Player.stack > 0 {
		g.bigBlindNode.Player.placeBet(g.cfg.BigBlind)
		if g.bigBlindNode.Player.stack <= 0 {
			g.allinCount++
		}
	}

	if g.activeCount == g.allinCount {
		return true
	}

	g.lastPlayerAction = PlayerActionTypeBet
	g.MinRaise = g.cfg.BigBlind
	g.curBet = g.cfg.BigBlind
	return false
}

func (g *Game) collectBetsLocked() {
	playersWithBets := make([]*Player, 0, g.activeCount)
	for chair := uint16(0); chair < uint16(g.cfg.MaxPlayers); chair++ {
		p := g.playersByChair[chair]
		if p == nil {
			continue
		}
		if p.bet > 0 {
			playersWithBets = append(playersWithBets, p)
		}
	}
	g.potManager.calcPotsByPlayerBets(playersWithBets)
	for _, p := range playersWithBets {
		p.resetBet()
	}
	g.curBet = 0
}

func (g *Game) setNeedActionCountLocked() {
	g.NeedActionCount = g.activeCount - g.allinCount
}

// calcNextValidActions legalActionList 必须是当前状态的纯函数投影
func (g *Game) calcNextValidActions(nextPlayer *Player) []ActionType {
	nextValid := []ActionType{PlayerActionTypeAllin, PlayerActionTypeFold}
	canCall := false

	switch g.lastPlayerAction {
	case PlayerActionTypeCheck, PlayerActionTypeNone:
		nextValid = append(nextValid, PlayerActionTypeCheck)
		if nextPlayer.stack > g.cfg.BigBlind {
			nextValid = append(nextValid, PlayerActionTypeBet)
		}

	case PlayerActionTypeBet, PlayerActionTypeRaise, PlayerActionTypeAllin, PlayerActionTypeCall:
		available := nextPlayer.stack + nextPlayer.bet

		if nextPlayer.bet == g.curBet {
			nextValid = append(nextValid, PlayerActionTypeCheck)
		} else if available > g.curBet {
			nextValid = append(nextValid, PlayerActionTypeCall)
			canCall = true
		}

		canRaise := available > g.curBet+g.MinRaise
		isReopen := g.CurrentRaiser != nextPlayer.ChairID()
		if canRaise && isReopen && g.activeCount-g.allinCount > 1 {
			nextValid = append(nextValid, PlayerActionTypeRaise)
		}

		// remove all-in option if action is locked
		if (canCall && g.activeCount-g.allinCount <= 1) || (canRaise && !isReopen) {
			if len(nextValid) > 0 {
				nextValid = nextValid[1:]
			}
		}
	}
	return nextValid
}

// calcNextActionPosAndBettingEnd 计算下一个行动玩家和是否结束下注
func (g *Game) calcNextActionPosAndBettingEndLocked() (*PlayerNode, bool) {
	if g.NeedActionCount == 0 {
		if g.phase == PhaseTypeRiver {
			return nil, true
		}
		var first *PlayerNode
		// Heads-Up 特殊规则只取决于“开局人数”，不能用 activeCount（有人弃牌后会变 2）
		// 对齐原始实现：len(chairIDNodes)==2 才算 Heads-Up
		if len(g.chairIDNodes) == 2 {
			first = g.bigBlindNode
		} else {
			first = g.smallBlindNode
		}
		node := first.WalkOnce(func(n *PlayerNode) bool {
			return n.Player != nil && !n.Player.folded && n.Player.stack > 0
		})
		return node, true
	}

	nextNode := g.curNode.Next.WalkOnce(func(n *PlayerNode) bool {
		return n.Player != nil && !n.Player.folded && n.Player.stack > 0
	})
	if nextNode != nil {
		if nextNode.Player.bet >= g.curBet && g.NeedActionCount == 1 && g.activeCount-g.allinCount == 1 {
			return nextNode, true
		}
		return nextNode, false
	}
	return nil, true
}

func (g *Game) checkDirectShowdownLocked() bool {
	return g.allinCount >= g.activeCount-1
}

func (g *Game) advanceToShowdownLocked() error {
	g.phase = PhaseTypeShowdown
	g.dealCommunityCardsLocked()
	return nil
}

func (g *Game) endHandLocked() (*SettlementResult, error) {
	g.phase = PhaseTypeRoundEnd
	settle, err := g.SettleShowdown()
	if err != nil {
		return nil, err
	}
	g.lastSettlement = settle
	g.ended = true
	return settle, nil
}
