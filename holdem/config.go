package holdem

import (
	"fmt"
	"time"
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
	return nil
}

