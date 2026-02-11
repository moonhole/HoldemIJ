package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

const (
	defaultAuthDSN = "postgresql://postgres:postgres@localhost:5432/holdem_lite?sslmode=disable"
)

type PostgresManager struct {
	db         *sql.DB
	sessionTTL time.Duration
}

func authDSNFromEnv() string {
	if v := strings.TrimSpace(os.Getenv("AUTH_DATABASE_DSN")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("DATABASE_URL")); v != "" {
		return v
	}
	return defaultAuthDSN
}

func authSessionTTLFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("AUTH_SESSION_TTL"))
	if raw == "" {
		return defaultSessionTTL
	}
	ttl, err := time.ParseDuration(raw)
	if err != nil || ttl <= 0 {
		return defaultSessionTTL
	}
	return ttl
}

func NewPostgresManagerFromEnv() (*PostgresManager, error) {
	return NewPostgresManager(authDSNFromEnv(), authSessionTTLFromEnv())
}

func NewPostgresManager(dsn string, sessionTTL time.Duration) (*PostgresManager, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, fmt.Errorf("empty postgres dsn")
	}
	if sessionTTL <= 0 {
		sessionTTL = defaultSessionTTL
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}

	var schemaReady bool
	if err := db.QueryRowContext(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
)`).Scan(&schemaReady); err != nil {
		_ = db.Close()
		return nil, err
	}
	if !schemaReady {
		_ = db.Close()
		return nil, fmt.Errorf("auth schema not initialized: missing table accounts")
	}

	return &PostgresManager{
		db:         db,
		sessionTTL: sessionTTL,
	}, nil
}

func (m *PostgresManager) Close() error {
	if m == nil || m.db == nil {
		return nil
	}
	return m.db.Close()
}

func (m *PostgresManager) Register(username, password string) (accountID uint64, sessionToken string, err error) {
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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback()

	if err := tx.QueryRowContext(ctx, `
INSERT INTO accounts (username, display_name, status, last_login_at)
VALUES ($1, $2, 1, NOW())
RETURNING id
`, normalized, normalized).Scan(&accountID); err != nil {
		if isUniqueViolation(err) {
			return 0, "", ErrUsernameTaken
		}
		return 0, "", err
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO auth_identities (account_id, provider, provider_subject, password_hash)
VALUES ($1, 'local', $2, $3)
`, accountID, normalized, string(passwordHash)); err != nil {
		if isUniqueViolation(err) {
			return 0, "", ErrUsernameTaken
		}
		return 0, "", err
	}

	sessionToken, err = m.issueSessionTx(ctx, tx, accountID)
	if err != nil {
		return 0, "", err
	}
	if err := tx.Commit(); err != nil {
		return 0, "", err
	}

	return accountID, sessionToken, nil
}

func (m *PostgresManager) Login(username, password string) (accountID uint64, sessionToken string, err error) {
	normalized := normalizeUsername(username)
	if normalized == "" || password == "" {
		return 0, "", ErrInvalidCredentials
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var passwordHash string
	if err := m.db.QueryRowContext(ctx, `
SELECT account_id, password_hash
FROM auth_identities
WHERE provider = 'local'
  AND provider_subject = $1
`, normalized).Scan(&accountID, &passwordHash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, "", ErrInvalidCredentials
		}
		return 0, "", err
	}

	if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)) != nil {
		return 0, "", ErrInvalidCredentials
	}

	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
UPDATE accounts
SET last_login_at = NOW(),
    updated_at = NOW()
WHERE id = $1
`, accountID); err != nil {
		return 0, "", err
	}

	sessionToken, err = m.issueSessionTx(ctx, tx, accountID)
	if err != nil {
		return 0, "", err
	}
	if err := tx.Commit(); err != nil {
		return 0, "", err
	}

	return accountID, sessionToken, nil
}

func (m *PostgresManager) ResolveSession(token string) (accountID uint64, username string, ok bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return 0, "", false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	expiresAt := time.Now().Add(m.sessionTTL)
	err := m.db.QueryRowContext(ctx, `
UPDATE auth_sessions AS s
SET last_seen_at = NOW(),
    expires_at = $2
FROM accounts AS a
WHERE s.token = $1
  AND s.account_id = a.id
  AND s.revoked_at IS NULL
  AND s.expires_at > NOW()
RETURNING s.account_id, a.username
`, token, expiresAt).Scan(&accountID, &username)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, "", false
		}
		return 0, "", false
	}
	return accountID, username, true
}

func (m *PostgresManager) Logout(token string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = m.db.ExecContext(ctx, `
UPDATE auth_sessions
SET revoked_at = NOW()
WHERE token = $1
  AND revoked_at IS NULL
`, token)
}

func (m *PostgresManager) ResolveOrCreateAccount(token string) (accountID uint64, sessionToken string, reused bool) {
	token = strings.TrimSpace(token)
	if token != "" {
		if accountID, _, ok := m.ResolveSession(token); ok {
			return accountID, token, true
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	for i := 0; i < 5; i++ {
		tx, err := m.db.BeginTx(ctx, nil)
		if err != nil {
			return 0, "", false
		}

		guestUsername := fmt.Sprintf("guest_%s", mustToken()[:12])
		if err := tx.QueryRowContext(ctx, `
INSERT INTO accounts (username, display_name, status)
VALUES ($1, $2, 1)
RETURNING id
`, guestUsername, guestUsername).Scan(&accountID); err != nil {
			_ = tx.Rollback()
			if isUniqueViolation(err) {
				continue
			}
			return 0, "", false
		}

		if _, err := tx.ExecContext(ctx, `
INSERT INTO auth_identities (account_id, provider, provider_subject)
VALUES ($1, 'guest', $2)
`, accountID, guestUsername); err != nil {
			_ = tx.Rollback()
			if isUniqueViolation(err) {
				continue
			}
			return 0, "", false
		}

		sessionToken, err = m.issueSessionTx(ctx, tx, accountID)
		if err != nil {
			_ = tx.Rollback()
			return 0, "", false
		}

		if err := tx.Commit(); err != nil {
			return 0, "", false
		}
		return accountID, sessionToken, false
	}

	return 0, "", false
}

func (m *PostgresManager) issueSessionTx(ctx context.Context, tx *sql.Tx, accountID uint64) (string, error) {
	expiresAt := time.Now().Add(m.sessionTTL)
	for i := 0; i < 5; i++ {
		token := mustToken()
		if _, err := tx.ExecContext(ctx, `
INSERT INTO auth_sessions (token, account_id, expires_at)
VALUES ($1, $2, $3)
`, token, accountID, expiresAt); err != nil {
			if isUniqueViolation(err) {
				continue
			}
			return "", err
		}
		return token, nil
	}
	return "", fmt.Errorf("failed to generate unique session token")
}

func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) {
		return pqErr.Code == "23505"
	}
	return false
}
