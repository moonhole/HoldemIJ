package holdem

import (
	"errors"
	"testing"
)

func TestStandUp_BetweenHands(t *testing.T) {
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
	if err := g.StandUp(1); err != nil {
		t.Fatalf("StandUp err: %v", err)
	}

	snap := g.Snapshot()
	if len(snap.Players) != 1 {
		t.Fatalf("expected 1 seated player, got %d", len(snap.Players))
	}
}

func TestStandUp_DuringHandRejected(t *testing.T) {
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
	if err := g.StartHand(); err != nil {
		t.Fatalf("StartHand err: %v", err)
	}
	if err := g.StandUp(1); !errors.Is(err, ErrHandInProgress) {
		t.Fatalf("expected ErrHandInProgress, got %v", err)
	}
}

func TestStandUp_AfterHandEndAllowed(t *testing.T) {
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
	if err := g.StartHand(); err != nil {
		t.Fatalf("StartHand err: %v", err)
	}

	snap := g.Snapshot()
	if _, err := g.Act(snap.ActionChair, PlayerActionTypeFold, 0); err != nil {
		t.Fatalf("Act fold err: %v", err)
	}

	if err := g.StandUp(snap.ActionChair); err != nil {
		t.Fatalf("StandUp after hand end err: %v", err)
	}
}
