package npc

import (
	"holdem-lite/card"
	"holdem-lite/holdem"
)

// GameView is a read-only projection of the game state visible to the NPC.
type GameView struct {
	Phase        holdem.Phase
	HoleCards    []card.Card
	Community    []card.Card
	Pot          int64
	CurrentBet   int64
	MyBet        int64
	MyStack      int64
	LegalActions []holdem.ActionType
	MinRaise     int64
	ActiveCount  int
	Street       int // 0=preflop, 1=flop, 2=turn, 3=river
}

// Decision is what a BrainDecider returns.
type Decision struct {
	Action holdem.ActionType
	Amount int64
}

// BrainDecider is the core interface all NPC types implement.
type BrainDecider interface {
	// Decide is called when it's the NPC's turn.
	Decide(view GameView) Decision
	// Name returns a human-readable identifier for debugging.
	Name() string
}
