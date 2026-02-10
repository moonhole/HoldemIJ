package holdem

import "testing"

func TestSnapshot_BeforeHand_HasInvalidActionChair(t *testing.T) {
	g, err := NewGame(Config{
		MaxPlayers: 6,
		MinPlayers: 2,
		SmallBlind: 50,
		BigBlind:   100,
	})
	if err != nil {
		t.Fatalf("NewGame err: %v", err)
	}

	if err := g.SitDown(0, 10001, 1000, false); err != nil {
		t.Fatal(err)
	}
	if err := g.SitDown(1, 10002, 1000, false); err != nil {
		t.Fatal(err)
	}

	snap := g.Snapshot()
	if snap.Round != 0 {
		t.Fatalf("expected round 0 before first hand, got %d", snap.Round)
	}
	if snap.ActionChair != InvalidChair {
		t.Fatalf("expected invalid action chair before first hand, got %d", snap.ActionChair)
	}
}
