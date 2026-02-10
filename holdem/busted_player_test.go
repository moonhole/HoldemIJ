package holdem

import (
	"testing"

	"holdem-lite/card"
)

func TestStartHand_ClearsBustedSeatCards_AndShowdownExcludesSeat(t *testing.T) {
	g, err := NewGame(Config{
		MaxPlayers: 6,
		MinPlayers: 2,
		SmallBlind: 50,
		BigBlind:   100,
		Seed:       1,
	})
	if err != nil {
		t.Fatalf("NewGame err: %v", err)
	}

	if err := g.SitDown(0, 10001, 2000, false); err != nil {
		t.Fatal(err)
	}
	if err := g.SitDown(1, 10002, 2000, false); err != nil {
		t.Fatal(err)
	}
	if err := g.SitDown(2, 10003, 0, false); err != nil {
		t.Fatal(err)
	}

	// Simulate stale cards left from previous hand on a busted seat.
	busted := g.playersByChair[2]
	busted.SetHandCard([]card.Card{HoldemCards[0], HoldemCards[1]})

	if err := g.StartHand(); err != nil {
		t.Fatalf("StartHand err: %v", err)
	}

	if got := len(g.playersByChair[2].HandCards()); got != 0 {
		t.Fatalf("expected busted seat hand cards cleared on new hand, got %d", got)
	}

	// Force a showdown evaluation context and ensure busted seat is excluded.
	board, ok := g.stockCards.PopCards(5)
	if !ok || len(board) != 5 {
		t.Fatalf("failed to draw board cards from stock")
	}
	g.communityCards = append([]card.Card{}, board...)
	g.noShowDown = false

	settlement, err := g.SettleShowdown()
	if err != nil {
		t.Fatalf("SettleShowdown err: %v", err)
	}

	for _, pr := range settlement.PlayerResults {
		if pr.Chair == 2 {
			t.Fatalf("busted seat should not appear in showdown results")
		}
	}
}
