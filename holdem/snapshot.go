package holdem

import "holdem-lite/card"

type PlayerSnapshot struct {
	ID         uint64
	Chair      uint16
	Robot      bool
	Stack      int64
	Bet        int64
	Folded     bool
	AllIn      bool
	LastAction ActionType
	HandCards  []card.Card
}

type PotSnapshot struct {
	Amount          int64
	EligiblePlayers []uint16
}

type Snapshot struct {
	Round uint16
	Phase Phase
	Ended bool

	DealerChair     uint16
	SmallBlindChair uint16
	BigBlindChair   uint16
	ActionChair     uint16

	CurBet          int64
	MinRaiseDelta   int64
	NeedActionCount int
	CurrentRaiser   uint16

	CommunityCards []card.Card
	Pots           []PotSnapshot
	Players        []PlayerSnapshot

	ExcessChair  uint16
	ExcessAmount int64
}

func (g *Game) Snapshot() Snapshot {
	g.mu.Lock()
	defer g.mu.Unlock()

	s := Snapshot{
		Round:           g.round,
		Phase:           g.phase,
		Ended:           g.ended,
		CurBet:          g.curBet,
		MinRaiseDelta:   g.MinRaise,
		NeedActionCount: g.NeedActionCount,
		CurrentRaiser:   g.CurrentRaiser,
		CommunityCards:  append([]card.Card{}, g.communityCards...),
		ExcessChair:     g.potManager.excessChair,
		ExcessAmount:    g.potManager.excessAmount,
	}
	if g.dealerNode != nil {
		s.DealerChair = g.dealerNode.ChairID
	}
	if g.smallBlindNode != nil {
		s.SmallBlindChair = g.smallBlindNode.ChairID
	}
	if g.bigBlindNode != nil {
		s.BigBlindChair = g.bigBlindNode.ChairID
	}
	if g.curNode != nil {
		s.ActionChair = g.curNode.ChairID
	}

	// players
	for chair := uint16(0); chair < uint16(g.cfg.MaxPlayers); chair++ {
		p := g.playersByChair[chair]
		if p == nil {
			continue
		}
		s.Players = append(s.Players, PlayerSnapshot{
			ID:         p.ID,
			Chair:      p.Chair,
			Robot:      p.Robot,
			Stack:      p.stack,
			Bet:        p.bet,
			Folded:     p.folded,
			AllIn:      p.allIn,
			LastAction: p.lastAction,
			HandCards:  append([]card.Card{}, p.handCards...),
		})
	}

	// pots
	for _, pot := range g.potManager.pots {
		ps := PotSnapshot{
			Amount: pot.amount,
		}
		for chair := range pot.eligiblePlayers {
			ps.EligiblePlayers = append(ps.EligiblePlayers, chair)
		}
		s.Pots = append(s.Pots, ps)
	}

	return s
}
