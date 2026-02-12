package holdem

import (
	"fmt"
	"time"

	"holdem-lite/card"
)

type Config struct {
	// Table
	MaxPlayers int
	MinPlayers int

	// Blinds / Ante
	SmallBlind int64
	BigBlind   int64
	Ante       int64

	// Optional: action timeout (0 disables internal timeout)
	ActionTimeout time.Duration
	AutoTimeout   time.Duration

	// RNG seed (0 => time-based)
	Seed int64

	// Optional replay controls.
	// ForcedDealerChair pins button seat for deterministic reconstruction.
	ForcedDealerChair *uint16
	// DeckOverride pins full deck order (52 cards), consumed from index 0 upward.
	DeckOverride []card.Card
}

func (c Config) validate() error {
	if c.MaxPlayers <= 0 {
		return fmt.Errorf("MaxPlayers must be > 0")
	}
	if c.MinPlayers <= 0 {
		return fmt.Errorf("MinPlayers must be > 0")
	}
	if c.MinPlayers > c.MaxPlayers {
		return fmt.Errorf("MinPlayers must be <= MaxPlayers")
	}
	if c.SmallBlind < 0 || c.BigBlind <= 0 || c.SmallBlind > c.BigBlind {
		return fmt.Errorf("invalid blinds: sb=%d bb=%d", c.SmallBlind, c.BigBlind)
	}
	if c.Ante < 0 {
		return fmt.Errorf("Ante must be >= 0")
	}
	if c.AutoTimeout < 0 || c.ActionTimeout < 0 {
		return fmt.Errorf("timeouts must be >= 0")
	}
	if c.ForcedDealerChair != nil && int(*c.ForcedDealerChair) >= c.MaxPlayers {
		return fmt.Errorf("forced dealer chair out of range: %d", *c.ForcedDealerChair)
	}
	if err := validateDeckOverride(c.DeckOverride); err != nil {
		return err
	}
	return nil
}

func validateDeckOverride(deck []card.Card) error {
	if len(deck) == 0 {
		return nil
	}
	if len(deck) != len(HoldemCards) {
		return fmt.Errorf("deck override must contain %d cards, got %d", len(HoldemCards), len(deck))
	}

	valid := make(map[card.Card]struct{}, len(HoldemCards))
	for _, c := range HoldemCards {
		valid[c] = struct{}{}
	}
	seen := make(map[card.Card]struct{}, len(deck))
	for i, c := range deck {
		if _, ok := valid[c]; !ok {
			return fmt.Errorf("deck override contains invalid card at index %d: %v", i, c)
		}
		if _, ok := seen[c]; ok {
			return fmt.Errorf("deck override contains duplicate card at index %d: %v", i, c)
		}
		seen[c] = struct{}{}
	}
	return nil
}
