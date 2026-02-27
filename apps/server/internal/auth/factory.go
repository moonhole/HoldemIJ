package auth

import (
	"fmt"
	"os"
	"strings"
)

const (
	AuthModeMemory = "memory"
	AuthModeDB     = "db"
	AuthModeLocal  = "local"
)

func authModeFromEnv() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_MODE")))
	switch raw {
	case "", AuthModeDB, "postgres", "postgresql":
		return AuthModeDB
	case AuthModeLocal, "sqlite":
		return AuthModeLocal
	case AuthModeMemory, "mem":
		return AuthModeMemory
	default:
		return raw
	}
}

func NewServiceFromEnv() (Service, string, error) {
	mode := authModeFromEnv()

	switch mode {
	case AuthModeDB:
		manager, err := NewPostgresManagerFromEnv()
		if err != nil {
			return nil, mode, err
		}
		return manager, mode, nil
	case AuthModeLocal:
		manager, err := NewSQLiteManagerFromEnv()
		if err != nil {
			return nil, mode, err
		}
		return manager, mode, nil
	case AuthModeMemory:
		return NewManager(), mode, nil
	default:
		return nil, mode, fmt.Errorf("invalid AUTH_MODE %q (supported: %s, %s, %s)", mode, AuthModeMemory, AuthModeDB, AuthModeLocal)
	}
}
