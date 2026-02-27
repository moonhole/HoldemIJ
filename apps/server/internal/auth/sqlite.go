package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"golang.org/x/crypto/bcrypt"
)

const defaultLocalDBName = "holdem_local.db"

type SQLiteManager struct {
	db         *sql.DB
	sessionTTL time.Duration
}

func NewSQLiteManagerFromEnv() (*SQLiteManager, error) {
	dbPath, err := authLocalDatabasePathFromEnv()
	if err != nil {
		return nil, err
	}
	return NewSQLiteManager(dbPath, authSessionTTLFromEnv())
}

func NewSQLiteManager(dbPath string, sessionTTL time.Duration) (*SQLiteManager, error) {
	dbPath = strings.TrimSpace(dbPath)
	if dbPath == "" {
		return nil, fmt.Errorf("empty sqlite database path")
	}
	if sessionTTL <= 0 {
		sessionTTL = defaultSessionTTL
	}
	if dbPath != ":memory:" {
		parent := filepath.Dir(dbPath)
		if parent != "" && parent != "." {
			if err := os.MkdirAll(parent, 0o755); err != nil {
				return nil, err
			}
		}
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `PRAGMA busy_timeout = 5000;`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, `PRAGMA journal_mode = WAL;`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys = ON;`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ensureSQLiteAuthSchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &SQLiteManager{
		db:         db,
		sessionTTL: sessionTTL,
	}, nil
}

func (m *SQLiteManager) Close() error {
	if m == nil || m.db == nil {
		return nil
	}
	return m.db.Close()
}

func (m *SQLiteManager) Register(username, password string) (accountID uint64, sessionToken string, err error) {
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

	nowMs := time.Now().UTC().UnixMilli()
	res, err := tx.ExecContext(ctx, `
INSERT INTO accounts (
    username, display_name, status, created_at_ms, updated_at_ms, last_login_at_ms
)
VALUES (?, ?, 1, ?, ?, ?)
`, normalized, normalized, nowMs, nowMs, nowMs)
	if err != nil {
		if isSQLiteUniqueViolation(err) {
			return 0, "", ErrUsernameTaken
		}
		return 0, "", err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, "", err
	}
	accountID = uint64(id)

	if _, err := tx.ExecContext(ctx, `
INSERT INTO auth_identities (
    account_id, provider, provider_subject, password_hash, created_at_ms, updated_at_ms
)
VALUES (?, 'local', ?, ?, ?, ?)
`, accountID, normalized, string(passwordHash), nowMs, nowMs); err != nil {
		if isSQLiteUniqueViolation(err) {
			return 0, "", ErrUsernameTaken
		}
		return 0, "", err
	}

	sessionToken, err = m.issueSessionTx(ctx, tx, accountID, nowMs)
	if err != nil {
		return 0, "", err
	}
	if err := tx.Commit(); err != nil {
		return 0, "", err
	}
	return accountID, sessionToken, nil
}

func (m *SQLiteManager) Login(username, password string) (accountID uint64, sessionToken string, err error) {
	normalized := normalizeUsername(username)
	if normalized == "" || password == "" {
		return 0, "", ErrInvalidCredentials
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var passwordHash string
	err = m.db.QueryRowContext(ctx, `
SELECT account_id, password_hash
FROM auth_identities
WHERE provider = 'local'
  AND provider_subject = ?
`, normalized).Scan(&accountID, &passwordHash)
	if err != nil {
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

	nowMs := time.Now().UTC().UnixMilli()
	if _, err := tx.ExecContext(ctx, `
UPDATE accounts
SET last_login_at_ms = ?,
    updated_at_ms = ?
WHERE id = ?
`, nowMs, nowMs, accountID); err != nil {
		return 0, "", err
	}

	sessionToken, err = m.issueSessionTx(ctx, tx, accountID, nowMs)
	if err != nil {
		return 0, "", err
	}
	if err := tx.Commit(); err != nil {
		return 0, "", err
	}
	return accountID, sessionToken, nil
}

func (m *SQLiteManager) ResolveSession(token string) (accountID uint64, username string, ok bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return 0, "", false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	nowMs := time.Now().UTC().UnixMilli()
	expiresAtMs := nowMs + m.sessionTTL.Milliseconds()

	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", false
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `
UPDATE auth_sessions
SET last_seen_at_ms = ?,
    expires_at_ms = ?
WHERE token = ?
  AND revoked_at_ms IS NULL
  AND expires_at_ms > ?
`, nowMs, expiresAtMs, token, nowMs)
	if err != nil {
		return 0, "", false
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil || rowsAffected == 0 {
		return 0, "", false
	}

	err = tx.QueryRowContext(ctx, `
SELECT s.account_id, COALESCE(NULLIF(a.display_name, ''), a.username)
FROM auth_sessions AS s
JOIN accounts AS a ON a.id = s.account_id
WHERE s.token = ?
`, token).Scan(&accountID, &username)
	if err != nil {
		return 0, "", false
	}
	if err := tx.Commit(); err != nil {
		return 0, "", false
	}
	return accountID, username, true
}

func (m *SQLiteManager) Logout(token string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}
	nowMs := time.Now().UTC().UnixMilli()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = m.db.ExecContext(ctx, `
UPDATE auth_sessions
SET revoked_at_ms = ?
WHERE token = ?
  AND revoked_at_ms IS NULL
`, nowMs, token)
}

func (m *SQLiteManager) ResolveOrCreateAccount(token string) (accountID uint64, sessionToken string, reused bool) {
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

		nowMs := time.Now().UTC().UnixMilli()
		guestUsername := fmt.Sprintf("guest_%s", mustToken()[:12])
		res, err := tx.ExecContext(ctx, `
INSERT INTO accounts (
    username, display_name, status, created_at_ms, updated_at_ms
)
VALUES (?, ?, 1, ?, ?)
`, guestUsername, guestUsername, nowMs, nowMs)
		if err != nil {
			_ = tx.Rollback()
			if isSQLiteUniqueViolation(err) {
				continue
			}
			return 0, "", false
		}
		id, err := res.LastInsertId()
		if err != nil {
			_ = tx.Rollback()
			return 0, "", false
		}
		accountID = uint64(id)

		if _, err := tx.ExecContext(ctx, `
INSERT INTO auth_identities (
    account_id, provider, provider_subject, created_at_ms, updated_at_ms
)
VALUES (?, 'guest', ?, ?, ?)
`, accountID, guestUsername, nowMs, nowMs); err != nil {
			_ = tx.Rollback()
			if isSQLiteUniqueViolation(err) {
				continue
			}
			return 0, "", false
		}

		sessionToken, err = m.issueSessionTx(ctx, tx, accountID, nowMs)
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

func (m *SQLiteManager) issueSessionTx(ctx context.Context, tx *sql.Tx, accountID uint64, nowMs int64) (string, error) {
	expiresAtMs := nowMs + m.sessionTTL.Milliseconds()
	for i := 0; i < 5; i++ {
		token := mustToken()
		if _, err := tx.ExecContext(ctx, `
INSERT INTO auth_sessions (
    token, account_id, issued_at_ms, expires_at_ms, last_seen_at_ms
)
VALUES (?, ?, ?, ?, ?)
`, token, accountID, nowMs, expiresAtMs, nowMs); err != nil {
			if isSQLiteUniqueViolation(err) {
				continue
			}
			return "", err
		}
		return token, nil
	}
	return "", fmt.Errorf("failed to generate unique session token")
}

func ensureSQLiteAuthSchema(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 1,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    last_login_at_ms INTEGER
)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_username_ci ON accounts(lower(username))`,
		`
CREATE TABLE IF NOT EXISTS auth_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    password_hash TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_provider_subject ON auth_identities(provider, provider_subject)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_account_provider ON auth_identities(account_id, provider)`,
		`
CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    issued_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    revoked_at_ms INTEGER,
    last_seen_at_ms INTEGER NOT NULL,
    user_agent TEXT,
    ip TEXT,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id, expires_at_ms DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(expires_at_ms, revoked_at_ms)`,
	}

	for _, stmt := range statements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func authLocalDatabasePathFromEnv() (string, error) {
	candidates := []string{
		strings.TrimSpace(os.Getenv("AUTH_LOCAL_DATABASE_PATH")),
		strings.TrimSpace(os.Getenv("LOCAL_DATABASE_PATH")),
	}
	for _, candidate := range candidates {
		if candidate != "" {
			return filepath.Clean(candidate), nil
		}
	}

	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(userConfigDir, "HoldemIJ", defaultLocalDBName), nil
}

func isSQLiteUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint failed")
}
