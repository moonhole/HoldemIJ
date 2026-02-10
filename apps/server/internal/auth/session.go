package auth

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"
)

const (
	defaultSessionTTL = 30 * 24 * time.Hour
	tokenBytes        = 32
)

// Manager provides in-memory guest identity/session management for single-binary deployment.
// It can be swapped to persistent storage later without changing gateway/table contracts.
type Manager struct {
	mu sync.Mutex

	nextAccountID uint64
	sessionTTL    time.Duration
	sessions      map[string]sessionRecord // token -> account
}

type sessionRecord struct {
	AccountID uint64
	ExpiresAt time.Time
}

func NewManager() *Manager {
	return &Manager{
		nextAccountID: 100000, // start from a readable non-trivial range
		sessionTTL:    defaultSessionTTL,
		sessions:      make(map[string]sessionRecord),
	}
}

// ResolveOrCreateAccount returns an account ID bound to token if valid;
// otherwise it creates a new guest account and new token.
func (m *Manager) ResolveOrCreateAccount(token string) (accountID uint64, sessionToken string, reused bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	if token != "" {
		if rec, ok := m.sessions[token]; ok {
			if now.Before(rec.ExpiresAt) {
				rec.ExpiresAt = now.Add(m.sessionTTL)
				m.sessions[token] = rec
				return rec.AccountID, token, true
			}
			delete(m.sessions, token)
		}
	}

	m.nextAccountID++
	accountID = m.nextAccountID
	sessionToken = mustToken()
	m.sessions[sessionToken] = sessionRecord{
		AccountID: accountID,
		ExpiresAt: now.Add(m.sessionTTL),
	}
	return accountID, sessionToken, false
}

func mustToken() string {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}
