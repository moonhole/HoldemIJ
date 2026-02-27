package ledger

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	pb "holdem-lite/apps/server/gen"

	_ "modernc.org/sqlite"
)

const defaultLocalDBName = "holdem_local.db"

type SQLiteService struct {
	db          *sql.DB
	recentLimit int
	savedLimit  int
}

func NewSQLiteServiceFromEnv() (*SQLiteService, error) {
	dbPath, err := ledgerLocalDatabasePathFromEnv()
	if err != nil {
		return nil, err
	}
	return NewSQLiteService(dbPath)
}

func NewSQLiteService(dbPath string) (*SQLiteService, error) {
	dbPath = strings.TrimSpace(dbPath)
	if dbPath == "" {
		return nil, fmt.Errorf("empty sqlite database path")
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
	if err := ensureSQLiteLedgerSchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &SQLiteService{
		db:          db,
		recentLimit: envIntOrDefault("AUDIT_RECENT_LIMIT_X", defaultRecentLimit),
		savedLimit:  envIntOrDefault("AUDIT_SAVED_LIMIT_Y", defaultSavedLimit),
	}, nil
}

func (s *SQLiteService) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *SQLiteService) AppendLiveEvent(handID string, env *pb.ServerEnvelope, encoded []byte) {
	if strings.TrimSpace(handID) == "" || env == nil {
		return
	}
	if encoded == nil {
		raw, err := envMarshal(env)
		if err != nil {
			log.Printf("[Ledger] marshal live event failed: hand=%s err=%v", handID, err)
			return
		}
		encoded = raw
	}

	payloadB64 := base64.StdEncoding.EncodeToString(encoded)
	eventType := envelopePayloadType(env)
	nowMs := time.Now().UTC().UnixMilli()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ledger_event_stream (
    source, scenario_id, hand_id, seq, event_type, envelope_b64, server_ts_ms, created_at_ms
)
VALUES ('live', '', ?, ?, ?, ?, ?, ?)
ON CONFLICT (source, scenario_id, hand_id, seq) DO NOTHING
`, handID, int64(env.GetServerSeq()), eventType, payloadB64, nullableInt64(env.GetServerTsMs()), nowMs)
	if err != nil {
		log.Printf("[Ledger] append live event failed: hand=%s seq=%d err=%v", handID, env.GetServerSeq(), err)
	}
}

func (s *SQLiteService) UpsertLiveHistory(userID uint64, handID string, playedAt time.Time, summary map[string]any) {
	s.upsertLiveHistoryInternal(userID, handID, playedAt, summary, nil)
}

func (s *SQLiteService) UpsertLiveHistoryWithEvents(
	userID uint64,
	handID string,
	playedAt time.Time,
	summary map[string]any,
	events []EventItem,
) {
	var tapeBlob []byte
	if len(events) > 0 {
		raw, err := json.Marshal(events)
		if err != nil {
			log.Printf("[Ledger] marshal live tape events failed: user=%d hand=%s err=%v", userID, handID, err)
		} else {
			tapeBlob = raw
		}
	}
	s.upsertLiveHistoryInternal(userID, handID, playedAt, summary, tapeBlob)
}

func (s *SQLiteService) upsertLiveHistoryInternal(
	userID uint64,
	handID string,
	playedAt time.Time,
	summary map[string]any,
	tapeBlob []byte,
) {
	if userID == 0 || strings.TrimSpace(handID) == "" {
		return
	}
	if playedAt.IsZero() {
		playedAt = time.Now().UTC()
	}
	if summary == nil {
		summary = map[string]any{}
	}
	summaryRaw, err := json.Marshal(summary)
	if err != nil {
		log.Printf("[Ledger] marshal hand summary failed: user=%d hand=%s err=%v", userID, handID, err)
		return
	}

	playedAtMs := playedAt.UTC().UnixMilli()
	nowMs := time.Now().UTC().UnixMilli()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("[Ledger] begin upsert live history tx failed: user=%d hand=%s err=%v", userID, handID, err)
		return
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
INSERT INTO audit_user_hand_history (
    user_id, source, hand_id, played_at_ms, summary_json, tape_blob, is_saved, saved_at_ms, created_at_ms, updated_at_ms
)
VALUES (?, 'live', ?, ?, ?, ?, 0, NULL, ?, ?)
ON CONFLICT (user_id, source, hand_id) DO UPDATE
SET
    played_at_ms = excluded.played_at_ms,
    summary_json = excluded.summary_json,
    tape_blob = COALESCE(excluded.tape_blob, audit_user_hand_history.tape_blob),
    updated_at_ms = excluded.updated_at_ms
`, userID, handID, playedAtMs, string(summaryRaw), nullableBytes(tapeBlob), nowMs, nowMs)
	if err != nil {
		log.Printf("[Ledger] upsert live history failed: user=%d hand=%s err=%v", userID, handID, err)
		return
	}

	if s.recentLimit > 0 {
		_, err = tx.ExecContext(ctx, `
DELETE FROM audit_user_hand_history
WHERE user_id = ?
  AND source = 'live'
  AND is_saved = 0
  AND id IN (
      SELECT id
      FROM audit_user_hand_history
      WHERE user_id = ?
        AND source = 'live'
        AND is_saved = 0
      ORDER BY played_at_ms DESC, id DESC
      LIMIT -1 OFFSET ?
  )
`, userID, userID, s.recentLimit)
		if err != nil {
			log.Printf("[Ledger] trim live history failed: user=%d err=%v", userID, err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[Ledger] commit live history failed: user=%d hand=%s err=%v", userID, handID, err)
	}
}

func (s *SQLiteService) UpsertReplayHand(
	ctx context.Context,
	userID uint64,
	handID string,
	events []EventItem,
	summary map[string]any,
) error {
	if userID == 0 || strings.TrimSpace(handID) == "" {
		return ErrNotFound
	}
	if len(events) == 0 {
		return fmt.Errorf("events is required")
	}
	if summary == nil {
		summary = map[string]any{}
	}
	if _, ok := summary["event_count"]; !ok {
		summary["event_count"] = len(events)
	}
	summaryRaw, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	if ctx == nil {
		ctx = context.Background()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	nowMs := time.Now().UTC().UnixMilli()
	for _, e := range events {
		if e.EventType == "" {
			e.EventType = "unknown"
		}
		_, err := tx.ExecContext(ctx, `
INSERT INTO ledger_event_stream (
    source, scenario_id, hand_id, seq, event_type, envelope_b64, server_ts_ms, created_at_ms
)
VALUES ('replay', '', ?, ?, ?, ?, ?, ?)
ON CONFLICT (source, scenario_id, hand_id, seq) DO UPDATE
SET
    event_type = excluded.event_type,
    envelope_b64 = excluded.envelope_b64,
    server_ts_ms = excluded.server_ts_ms
`, handID, int64(e.Seq), e.EventType, e.EnvelopeB64, nullableInt64Ptr(e.ServerTsMs), nowMs)
		if err != nil {
			return err
		}
	}

	_, err = tx.ExecContext(ctx, `
INSERT INTO audit_user_hand_history (
    user_id, source, hand_id, played_at_ms, summary_json, is_saved, saved_at_ms, created_at_ms, updated_at_ms
)
VALUES (?, 'replay', ?, ?, ?, 0, NULL, ?, ?)
ON CONFLICT (user_id, source, hand_id) DO UPDATE
SET
    played_at_ms = excluded.played_at_ms,
    summary_json = excluded.summary_json,
    updated_at_ms = excluded.updated_at_ms
`, userID, handID, nowMs, string(summaryRaw), nowMs, nowMs)
	if err != nil {
		return err
	}

	if s.recentLimit > 0 {
		_, err = tx.ExecContext(ctx, `
DELETE FROM audit_user_hand_history
WHERE user_id = ?
  AND source = 'replay'
  AND is_saved = 0
  AND id IN (
      SELECT id
      FROM audit_user_hand_history
      WHERE user_id = ?
        AND source = 'replay'
        AND is_saved = 0
      ORDER BY played_at_ms DESC, id DESC
      LIMIT -1 OFFSET ?
  )
`, userID, userID, s.recentLimit)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *SQLiteService) ListRecent(ctx context.Context, userID uint64, source Source, limit int) ([]HistoryItem, error) {
	if userID == 0 {
		return []HistoryItem{}, nil
	}
	if !isAuditSource(source) {
		return nil, fmt.Errorf("invalid source %q", source)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if ctx == nil {
		ctx = context.Background()
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT hand_id, source, played_at_ms, summary_json, is_saved, saved_at_ms, updated_at_ms
FROM audit_user_hand_history
WHERE user_id = ?
  AND source = ?
ORDER BY played_at_ms DESC, id DESC
LIMIT ?
`, userID, string(source), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]HistoryItem, 0, limit)
	for rows.Next() {
		var item HistoryItem
		var sourceRaw string
		var playedAtMs int64
		var summaryRaw []byte
		var isSaved int64
		var savedAtMs sql.NullInt64
		var updatedAtMs int64
		if err := rows.Scan(&item.HandID, &sourceRaw, &playedAtMs, &summaryRaw, &isSaved, &savedAtMs, &updatedAtMs); err != nil {
			return nil, err
		}
		item.Source = Source(sourceRaw)
		item.PlayedAt = time.UnixMilli(playedAtMs).UTC()
		item.IsSaved = isSaved == 1
		if savedAtMs.Valid {
			t := time.UnixMilli(savedAtMs.Int64).UTC()
			item.SavedAt = &t
		}
		item.UpdatedAt = time.UnixMilli(updatedAtMs).UTC()
		if len(summaryRaw) > 0 {
			_ = json.Unmarshal(summaryRaw, &item.Summary)
		}
		if item.Summary == nil {
			item.Summary = map[string]any{}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *SQLiteService) GetHandEvents(ctx context.Context, userID uint64, source Source, handID string) ([]EventItem, error) {
	if userID == 0 || strings.TrimSpace(handID) == "" {
		return nil, ErrNotFound
	}
	if !isAuditSource(source) {
		return nil, fmt.Errorf("invalid source %q", source)
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var tapeBlob []byte
	err := s.db.QueryRowContext(ctx, `
SELECT tape_blob
FROM audit_user_hand_history
WHERE user_id = ?
  AND source = ?
  AND hand_id = ?
`, userID, string(source), handID).Scan(&tapeBlob)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if len(tapeBlob) > 0 {
		var events []EventItem
		if err := json.Unmarshal(tapeBlob, &events); err == nil && len(events) > 0 {
			return events, nil
		}
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT seq, event_type, envelope_b64, server_ts_ms
FROM ledger_event_stream
WHERE source = ?
  AND scenario_id = ''
  AND hand_id = ?
ORDER BY seq ASC
`, string(source), handID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]EventItem, 0, 128)
	for rows.Next() {
		var e EventItem
		var seq int64
		var serverTs sql.NullInt64
		if err := rows.Scan(&seq, &e.EventType, &e.EnvelopeB64, &serverTs); err != nil {
			return nil, err
		}
		e.Seq = uint64(seq)
		if serverTs.Valid {
			v := serverTs.Int64
			e.ServerTsMs = &v
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(events) == 0 {
		return nil, ErrNotFound
	}
	return events, nil
}

func (s *SQLiteService) SetSaved(ctx context.Context, userID uint64, source Source, handID string, saved bool) error {
	if userID == 0 || strings.TrimSpace(handID) == "" {
		return ErrNotFound
	}
	if !isAuditSource(source) {
		return fmt.Errorf("invalid source %q", source)
	}
	if ctx == nil {
		ctx = context.Background()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var current int64
	err = tx.QueryRowContext(ctx, `
SELECT is_saved
FROM audit_user_hand_history
WHERE user_id = ?
  AND source = ?
  AND hand_id = ?
`, userID, string(source), handID).Scan(&current)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if (current == 1) == saved {
		return tx.Commit()
	}

	nowMs := time.Now().UTC().UnixMilli()
	if saved {
		var savedCount int
		if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM audit_user_hand_history
WHERE user_id = ?
  AND source = ?
  AND is_saved = 1
`, userID, string(source)).Scan(&savedCount); err != nil {
			return err
		}
		if savedCount >= s.savedLimit {
			return ErrSavedLimitReach
		}
		_, err := tx.ExecContext(ctx, `
UPDATE audit_user_hand_history
SET is_saved = 1,
    saved_at_ms = ?,
    updated_at_ms = ?
WHERE user_id = ?
  AND source = ?
  AND hand_id = ?
`, nowMs, nowMs, userID, string(source), handID)
		if err != nil {
			return err
		}
		return tx.Commit()
	}

	_, err = tx.ExecContext(ctx, `
UPDATE audit_user_hand_history
SET is_saved = 0,
    saved_at_ms = NULL,
    updated_at_ms = ?
WHERE user_id = ?
  AND source = ?
  AND hand_id = ?
`, nowMs, userID, string(source), handID)
	if err != nil {
		return err
	}

	if s.recentLimit > 0 {
		_, err = tx.ExecContext(ctx, `
DELETE FROM audit_user_hand_history
WHERE user_id = ?
  AND source = ?
  AND is_saved = 0
  AND id IN (
      SELECT id
      FROM audit_user_hand_history
      WHERE user_id = ?
        AND source = ?
        AND is_saved = 0
      ORDER BY played_at_ms DESC, id DESC
      LIMIT -1 OFFSET ?
  )
`, userID, string(source), userID, string(source), s.recentLimit)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func ensureSQLiteLedgerSchema(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`
CREATE TABLE IF NOT EXISTS ledger_event_stream (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    scenario_id TEXT NOT NULL DEFAULT '',
    hand_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    envelope_b64 TEXT NOT NULL DEFAULT '',
    server_ts_ms INTEGER,
    created_at_ms INTEGER NOT NULL,
    UNIQUE (source, scenario_id, hand_id, seq)
)`,
		`CREATE INDEX IF NOT EXISTS idx_ledger_event_stream_hand_seq ON ledger_event_stream(source, hand_id, seq)`,
		`CREATE INDEX IF NOT EXISTS idx_ledger_event_stream_created_at ON ledger_event_stream(created_at_ms)`,
		`
CREATE TABLE IF NOT EXISTS audit_user_hand_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    hand_id TEXT NOT NULL,
    played_at_ms INTEGER NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '{}',
    tape_blob BLOB,
    is_saved INTEGER NOT NULL DEFAULT 0,
    saved_at_ms INTEGER,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE (user_id, source, hand_id)
)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_user_hand_history_recent ON audit_user_hand_history(user_id, source, played_at_ms DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_user_hand_history_saved ON audit_user_hand_history(user_id, source, is_saved, saved_at_ms DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_user_hand_history_trim ON audit_user_hand_history(user_id, source, played_at_ms ASC, id ASC)`,
	}

	for _, stmt := range statements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func ledgerLocalDatabasePathFromEnv() (string, error) {
	candidates := []string{
		strings.TrimSpace(os.Getenv("LEDGER_LOCAL_DATABASE_PATH")),
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

func nullableInt64Ptr(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}
