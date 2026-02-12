package replay

import (
	"reflect"
	"testing"
)

func TestGenerateReplayTape_IsDeterministic(t *testing.T) {
	spec := baseHandSpec()

	tapeA, err := GenerateReplayTape(spec)
	if err != nil {
		t.Fatalf("GenerateReplayTape A failed: %v", err)
	}
	tapeB, err := GenerateReplayTape(spec)
	if err != nil {
		t.Fatalf("GenerateReplayTape B failed: %v", err)
	}

	if !reflect.DeepEqual(tapeA, tapeB) {
		t.Fatalf("expected deterministic replay tape for the same HandSpec")
	}
	if len(tapeA.Events) == 0 {
		t.Fatalf("expected non-empty replay tape")
	}

	foundHandStart := false
	foundActionResult := false
	for _, e := range tapeA.Events {
		if e.Type == "handStart" {
			foundHandStart = true
		}
		if e.Type == "actionResult" {
			foundActionResult = true
		}
	}
	if !foundHandStart || !foundActionResult {
		t.Fatalf("expected replay tape to contain handStart and actionResult events")
	}
}

func TestGenerateReplayTape_ReturnsReplayErrorOnOutOfTurnAction(t *testing.T) {
	spec := baseHandSpec()
	spec.Actions[0].Chair = 2

	_, err := GenerateReplayTape(spec)
	if err == nil {
		t.Fatalf("expected replay generation to fail on out-of-turn action")
	}
	replayErr, ok := err.(*ReplayError)
	if !ok {
		t.Fatalf("expected ReplayError type, got %T", err)
	}
	if replayErr.Reason != "out_of_turn" {
		t.Fatalf("unexpected reason: %s", replayErr.Reason)
	}
	if replayErr.Expected == nil {
		t.Fatalf("expected replay error to include expected action state")
	}
}

func baseHandSpec() HandSpec {
	turn := "9s"
	river := "Td"
	return HandSpec{
		Variant: "NLH",
		Table: TableSpec{
			MaxPlayers: 6,
			SB:         50,
			BB:         100,
			Ante:       0,
		},
		DealerChair: 0,
		Seats: []SeatSpec{
			{Chair: 0, Name: "YOU", Stack: 11000, IsHero: true, Hole: []string{"Js", "Qc"}},
			{Chair: 2, Name: "P1", Stack: 8000, Hole: []string{"As", "Kd"}},
			{Chair: 4, Name: "P2", Stack: 12000, Hole: []string{"7h", "7c"}},
		},
		Board: &BoardSpec{
			Flop:  []string{"Ah", "7d", "2c"},
			Turn:  &turn,
			River: &river,
		},
		Actions: []ActionSpec{
			{Phase: "PREFLOP", Chair: 0, Type: "CALL", AmountTo: 100},
			{Phase: "PREFLOP", Chair: 2, Type: "CALL", AmountTo: 100},
			{Phase: "PREFLOP", Chair: 4, Type: "CHECK", AmountTo: 100},
			{Phase: "FLOP", Chair: 2, Type: "CHECK", AmountTo: 0},
			{Phase: "FLOP", Chair: 4, Type: "BET", AmountTo: 150},
			{Phase: "FLOP", Chair: 0, Type: "FOLD", AmountTo: 0},
			{Phase: "FLOP", Chair: 2, Type: "FOLD", AmountTo: 0},
		},
		RNG: &RNGSpec{Seed: 42},
	}
}
