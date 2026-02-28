package npc

import (
	"testing"

	"holdem-lite/card"
	"holdem-lite/holdem"
)

func TestRuleBrainPassivePreflopRaiseRateCapped(t *testing.T) {
	persona := &NPCPersona{
		ID:   "passive_test",
		Name: "PASSIVE_TEST",
		Brain: PersonalityProfile{
			Aggression: 0.20,
			Tightness:  0.20,
			Bluffing:   0.10,
			Positional: 0.30,
			Randomness: 0.0,
		},
	}
	brain := NewRuleBrain(persona, 42)

	view := GameView{
		Street:       0,
		HoleCards:    []card.Card{card.CardSpadeT, card.CardHeart9},
		Pot:          450,
		CurrentBet:   200,
		MyBet:        100,
		MyStack:      20000,
		MinRaise:     400,
		LegalActions: []holdem.ActionType{holdem.PlayerActionTypeFold, holdem.PlayerActionTypeCall, holdem.PlayerActionTypeRaise},
	}

	const rounds = 4000
	raises := 0
	for i := 0; i < rounds; i++ {
		decision := brain.Decide(view)
		if decision.Action == holdem.PlayerActionTypeRaise {
			raises++
		}
	}

	rate := float64(raises) / float64(rounds)
	if rate > 0.20 {
		t.Fatalf("passive profile raise rate too high: got %.3f, want <= 0.20", rate)
	}
}

func TestRuleBrainLAGPreflopRaiseRateModerated(t *testing.T) {
	persona := &NPCPersona{
		ID:   "lag_test",
		Name: "LAG_TEST",
		Brain: PersonalityProfile{
			Aggression: 0.75,
			Tightness:  0.30,
			Bluffing:   0.55,
			Positional: 0.50,
			Randomness: 0.0,
		},
	}
	brain := NewRuleBrain(persona, 99)

	view := GameView{
		Street:       0,
		HoleCards:    []card.Card{card.CardSpadeT, card.CardHeart9},
		Pot:          450,
		CurrentBet:   200,
		MyBet:        100,
		MyStack:      20000,
		MinRaise:     400,
		LegalActions: []holdem.ActionType{holdem.PlayerActionTypeFold, holdem.PlayerActionTypeCall, holdem.PlayerActionTypeRaise},
	}

	const rounds = 4000
	raises := 0
	calls := 0
	for i := 0; i < rounds; i++ {
		decision := brain.Decide(view)
		switch decision.Action {
		case holdem.PlayerActionTypeRaise:
			raises++
		case holdem.PlayerActionTypeCall:
			calls++
		}
	}

	rate := float64(raises) / float64(rounds)
	if rate < 0.10 || rate > 0.45 {
		t.Fatalf("LAG profile raise rate out of expected range: got %.3f, want [0.10, 0.45]", rate)
	}
	if raises >= calls {
		t.Fatalf("LAG profile still too raise-heavy: raises=%d calls=%d", raises, calls)
	}
}
