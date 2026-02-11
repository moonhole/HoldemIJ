package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	defaultSessionTTL = 30 * 24 * time.Hour
	tokenBytes        = 32
)

var (
	ErrInvalidUsername    = errors.New("invalid username")
	ErrInvalidPassword    = errors.New("invalid password")
	ErrUsernameTaken      = errors.New("username already exists")
	ErrInvalidCredentials = errors.New("invalid credentials")
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,31}$`)

// Manager provides in-memory account/session management for single-binary deployment.
// It can be swapped to persistent storage later without changing gateway contracts.
type Manager struct {
	mu sync.Mutex

	nextAccountID uint64
	sessionTTL    time.Duration
	sessions      map[string]sessionRecord // token -> account
	accountsByID  map[uint64]accountRecord // account -> profile
	accountsByKey map[string]uint64        // normalized username -> account
}

type sessionRecord struct {
	AccountID uint64
	ExpiresAt time.Time
}

type accountRecord struct {
	AccountID     uint64
	Username      string
	PasswordHash  []byte
	Registered    bool
	LastLoginTime time.Time
}

func NewManager() *Manager {
	return &Manager{
		nextAccountID: 100000, // start from a readable non-trivial range
		sessionTTL:    defaultSessionTTL,
		sessions:      make(map[string]sessionRecord),
		accountsByID:  make(map[uint64]accountRecord),
		accountsByKey: make(map[string]uint64),
	}
}

func normalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func validateUsername(username string) error {
	trimmed := strings.TrimSpace(username)
	if !usernamePattern.MatchString(trimmed) {
		return ErrInvalidUsername
	}
	return nil
}

func validatePassword(password string) error {
	if len(password) < 6 || len(password) > 72 {
		return ErrInvalidPassword
	}
	return nil
}

func (m *Manager) issueSessionLocked(accountID uint64, now time.Time) string {
	sessionToken := mustToken()
	m.sessions[sessionToken] = sessionRecord{
		AccountID: accountID,
		ExpiresAt: now.Add(m.sessionTTL),
	}
	return sessionToken
}

func (m *Manager) resolveSessionLocked(token string, now time.Time) (accountID uint64, username string, ok bool) {
	if token == "" {
		return 0, "", false
	}
	rec, exists := m.sessions[token]
	if !exists {
		return 0, "", false
	}
	if !now.Before(rec.ExpiresAt) {
		delete(m.sessions, token)
		return 0, "", false
	}
	rec.ExpiresAt = now.Add(m.sessionTTL)
	m.sessions[token] = rec

	profile := m.accountsByID[rec.AccountID]
	return rec.AccountID, profile.Username, true
}

// Register creates a new account and returns an authenticated session token.
func (m *Manager) Register(username, password string) (accountID uint64, sessionToken string, err error) {
	if err = validateUsername(username); err != nil {
		return 0, "", err
	}
	if err = validatePassword(password); err != nil {
		return 0, "", err
	}

	normalized := normalizeUsername(username)
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return 0, "", err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.accountsByKey[normalized]; exists {
		return 0, "", ErrUsernameTaken
	}

	m.nextAccountID++
	accountID = m.nextAccountID
	now := time.Now()
	m.accountsByID[accountID] = accountRecord{
		AccountID:     accountID,
		Username:      normalized,
		PasswordHash:  passwordHash,
		Registered:    true,
		LastLoginTime: now,
	}
	m.accountsByKey[normalized] = accountID

	sessionToken = m.issueSessionLocked(accountID, now)
	return accountID, sessionToken, nil
}

// Login validates account credentials and returns a fresh authenticated session.
func (m *Manager) Login(username, password string) (accountID uint64, sessionToken string, err error) {
	normalized := normalizeUsername(username)
	if normalized == "" || password == "" {
		return 0, "", ErrInvalidCredentials
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	accountID, exists := m.accountsByKey[normalized]
	if !exists {
		return 0, "", ErrInvalidCredentials
	}

	profile := m.accountsByID[accountID]
	if !profile.Registered || len(profile.PasswordHash) == 0 {
		return 0, "", ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword(profile.PasswordHash, []byte(password)) != nil {
		return 0, "", ErrInvalidCredentials
	}

	now := time.Now()
	profile.LastLoginTime = now
	m.accountsByID[accountID] = profile
	sessionToken = m.issueSessionLocked(accountID, now)
	return accountID, sessionToken, nil
}

// ResolveSession validates and refreshes a session token.
func (m *Manager) ResolveSession(token string) (accountID uint64, username string, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.resolveSessionLocked(token, time.Now())
}

// Logout invalidates a session token.
func (m *Manager) Logout(token string) {
	if token == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, token)
}

// ResolveOrCreateAccount returns an account ID bound to token if valid;
// otherwise it creates a new guest account and new token.
// Deprecated: keep for compatibility with legacy flows/tests.
func (m *Manager) ResolveOrCreateAccount(token string) (accountID uint64, sessionToken string, reused bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	if accountID, _, ok := m.resolveSessionLocked(token, now); ok {
		return accountID, token, true
	}

	m.nextAccountID++
	accountID = m.nextAccountID
	m.accountsByID[accountID] = accountRecord{
		AccountID: accountID,
	}
	sessionToken = m.issueSessionLocked(accountID, now)
	return accountID, sessionToken, false
}

func mustToken() string {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}
