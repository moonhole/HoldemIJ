package holdem

import (
	"strings"
	"testing"

	"holdem-lite/card"
)

func TestStartHand_UsesForcedDealerAndDeckOverride(t *testing.T) {
	forcedDealer := uint16(0)
	prefix := []card.Card{
		card.CardSpadeA, card.CardSpadeK, card.CardSpadeQ,
		card.CardSpadeJ, card.CardSpadeT, card.CardSpade9,
	}
	deck := deckWithPrefix(prefix)

	g, err := NewGame(Config{
		MaxPlayers:        3,
		MinPlayers:        2,
		SmallBlind:        50,
		BigBlind:          100,
		Seed:              1,
		ForcedDealerChair: &forcedDealer,
		DeckOverride:      deck,
	})
	if err != nil {
		t.Fatalf("NewGame err: %v", err)
	}

	if err := g.SitDown(0, 10001, 1000, false); err != nil {
		t.Fatalf("SitDown seat0 err: %v", err)
	}
	if err := g.SitDown(1, 10002, 1000, false); err != nil {
		t.Fatalf("SitDown seat1 err: %v", err)
	}
	if err := g.SitDown(2, 10003, 1000, false); err != nil {
		t.Fatalf("SitDown seat2 err: %v", err)
	}

	if err := g.StartHand(); err != nil {
		t.Fatalf("StartHand err: %v", err)
	}

	snap := g.Snapshot()
	if snap.DealerChair != forcedDealer {
		t.Fatalf("expected forced dealer %d, got %d", forcedDealer, snap.DealerChair)
	}

	holeByChair := make(map[uint16][]card.Card, len(snap.Players))
	for _, ps := range snap.Players {
		holeByChair[ps.Chair] = ps.HandCards
	}

	assertHoleCards(t, holeByChair[1], []card.Card{card.CardSpadeA, card.CardSpadeJ})
	assertHoleCards(t, holeByChair[2], []card.Card{card.CardSpadeK, card.CardSpadeT})
	assertHoleCards(t, holeByChair[0], []card.Card{card.CardSpadeQ, card.CardSpade9})
}

func TestStartHand_ForcedDealerMustBeActive(t *testing.T) {
	forcedDealer := uint16(2)
	g, err := NewGame(Config{
		MaxPlayers:        3,
		MinPlayers:        2,
		SmallBlind:        50,
		BigBlind:          100,
		ForcedDealerChair: &forcedDealer,
	})
	if err != nil {
		t.Fatalf("NewGame err: %v", err)
	}

	if err := g.SitDown(0, 10001, 1000, false); err != nil {
		t.Fatalf("SitDown seat0 err: %v", err)
	}
	if err := g.SitDown(1, 10002, 1000, false); err != nil {
		t.Fatalf("SitDown seat1 err: %v", err)
	}

	err = g.StartHand()
	if err == nil {
		t.Fatalf("expected StartHand error when forced dealer seat is inactive")
	}
	if !strings.Contains(err.Error(), "forced dealer chair") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNewGame_RejectsDuplicateDeckOverrideCards(t *testing.T) {
	deck := make([]card.Card, len(HoldemCards))
	copy(deck, HoldemCards)
	deck[1] = deck[0]

	_, err := NewGame(Config{
		MaxPlayers:   2,
		MinPlayers:   2,
		SmallBlind:   50,
		BigBlind:     100,
		DeckOverride: deck,
	})
	if err == nil {
		t.Fatalf("expected duplicate deck override validation error")
	}
	if !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func deckWithPrefix(prefix []card.Card) []card.Card {
	out := make([]card.Card, 0, len(HoldemCards))
	out = append(out, prefix...)
	seen := make(map[card.Card]struct{}, len(prefix))
	for _, c := range prefix {
		seen[c] = struct{}{}
	}
	for _, c := range HoldemCards {
		if _, ok := seen[c]; ok {
			continue
		}
		out = append(out, c)
	}
	return out
}

func assertHoleCards(t *testing.T, got []card.Card, want []card.Card) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("unexpected hole card length: got=%d want=%d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected hole card at %d: got=%v want=%v", i, got[i], want[i])
		}
	}
}
