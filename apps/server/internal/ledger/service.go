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
	"strconv"
	"strings"
	"time"

	pb "holdem-lite/apps/server/gen"

	_ "github.com/lib/pq"
	"google.golang.org/protobuf/proto"
)

const (
	defaultDatabaseDSN = "postgresql://postgres:postgres@localhost:5432/holdem_lite?sslmode=disable"
	defaultRecentLimit = 200
	defaultSavedLimit  = 50
)

type Source string

const (
	SourceLive    Source = "live"
	SourceReplay  Source = "replay"
	SourceSandbox Source = "sandbox"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrSavedLimitReach = errors.New("saved hand limit reached")
)

type Service interface {
	Close() error
	AppendLiveEvent(handID string, env *pb.ServerEnvelope, encoded []byte)
	UpsertLiveHistory(userID uint64, handID string, playedAt time.Time, summary map[string]any)
	UpsertLiveHistoryWithEvents(
		userID uint64,
		handID string,
		playedAt time.Time,
		summary map[string]any,
		events []EventItem,
	)
	UpsertReplayHand(ctx context.Context, userID uint64, handID string, events []EventItem, summary map[string]any) error
	ListRecent(ctx context.Context, userID uint64, source Source, limit int) ([]HistoryItem, error)
	GetHandEvents(ctx context.Context, userID uint64, source Source, handID string) ([]EventItem, error)
	SetSaved(ctx context.Context, userID uint64, source Source, handID string, saved bool) error
}

type HistoryItem struct {
	HandID    string         `json:"hand_id"`
	Source    Source         `json:"source"`
	PlayedAt  time.Time      `json:"played_at"`
	IsSaved   bool           `json:"is_saved"`
	SavedAt   *time.Time     `json:"saved_at,omitempty"`
	Summary   map[string]any `json:"summary"`
	UpdatedAt time.Time      `json:"updated_at"`
}

type EventItem struct {
	Seq         uint64 `json:"seq"`
	EventType   string `json:"event_type"`
	EnvelopeB64 string `json:"envelope_b64"`
	ServerTsMs  *int64 `json:"server_ts_ms,omitempty"`
}

type noopService struct{}

func (n *noopService) Close() error { return nil }

func (n *noopService) AppendLiveEvent(_ string, _ *pb.ServerEnvelope, _ []byte) {}

func (n *noopService) UpsertLiveHistory(_ uint64, _ string, _ time.Time, _ map[string]any) {}

func (n *noopService) UpsertLiveHistoryWithEvents(
	_ uint64,
	_ string,
	_ time.Time,
	_ map[string]any,
	_ []EventItem,
) {
}

func (n *noopService) UpsertReplayHand(_ context.Context, _ uint64, _ string, _ []EventItem, _ map[string]any) error {
	return nil
}

func (n *noopService) ListRecent(_ context.Context, _ uint64, _ Source, _ int) ([]HistoryItem, error) {
	return []HistoryItem{}, nil
}

func (n *noopService) GetHandEvents(_ context.Context, _ uint64, _ Source, _ string) ([]EventItem, error) {
	return []EventItem{}, nil
}

func (n *noopService) SetSaved(_ context.Context, _ uint64, _ Source, _ string, _ bool) error {
	return nil
}

type PostgresService struct {
	db          *sql.DB
	recentLimit int
	savedLimit  int
}

func NewServiceFromEnv(authMode string) (Service, string, error) {
	mode := strings.ToLower(strings.TrimSpace(authMode))
	if mode == "memory" {
		return &noopService{}, "memory-noop", nil
	}
	if mode == "local" || mode == "sqlite" {
		service, err := NewSQLiteServiceFromEnv()
		if err != nil {
			return nil, "", err
		}
		return service, "sqlite", nil
	}

	dsn := ledgerDSNFromEnv()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, "", err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, "", err
	}
	var schemaReady bool
	if err := db.QueryRowContext(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ledger_event_stream'
)`).Scan(&schemaReady); err != nil {
		_ = db.Close()
		return nil, "", err
	}
	if !schemaReady {
		_ = db.Close()
		return nil, "", fmt.Errorf("ledger schema not initialized: missing table ledger_event_stream")
	}

	return &PostgresService{
		db:          db,
		recentLimit: envIntOrDefault("AUDIT_RECENT_LIMIT_X", defaultRecentLimit),
		savedLimit:  envIntOrDefault("AUDIT_SAVED_LIMIT_Y", defaultSavedLimit),
	}, "postgres", nil
}

func (s *PostgresService) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *PostgresService) AppendLiveEvent(handID string, env *pb.ServerEnvelope, encoded []byte) {
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

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ledger_event_stream (
    source, scenario_id, hand_id, seq, event_type, envelope_b64, server_ts_ms
)
VALUES ('live', '', $1, $2, $3, $4, $5)
ON CONFLICT (source, scenario_id, hand_id, seq) DO NOTHING
`, handID, env.GetServerSeq(), eventType, payloadB64, nullableInt64(env.GetServerTsMs()))
	if err != nil {
		log.Printf("[Ledger] append live event failed: hand=%s seq=%d err=%v", handID, env.GetServerSeq(), err)
	}
}

func (s *PostgresService) UpsertLiveHistory(userID uint64, handID string, playedAt time.Time, summary map[string]any) {
	s.upsertLiveHistoryInternal(userID, handID, playedAt, summary, nil)
}

func (s *PostgresService) UpsertLiveHistoryWithEvents(
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

func (s *PostgresService) upsertLiveHistoryInternal(
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

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("[Ledger] begin upsert live history tx failed: user=%d hand=%s err=%v", userID, handID, err)
		return
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
INSERT INTO audit_user_hand_history (
    user_id, source, hand_id, played_at, summary_json, tape_blob
)
VALUES ($1, 'live', $2, $3, $4::jsonb, $5)
ON CONFLICT (user_id, source, hand_id) DO UPDATE
SET
    played_at = EXCLUDED.played_at,
    summary_json = EXCLUDED.summary_json,
    tape_blob = COALESCE(EXCLUDED.tape_blob, audit_user_hand_history.tape_blob),
    updated_at = NOW()
`, userID, handID, playedAt, string(summaryRaw), nullableBytes(tapeBlob)); err != nil {
		log.Printf("[Ledger] upsert live history failed: user=%d hand=%s err=%v", userID, handID, err)
		return
	}

	if s.recentLimit > 0 {
		if _, err := tx.ExecContext(ctx, `
DELETE FROM audit_user_hand_history
WHERE user_id = $1
  AND source = 'live'
  AND is_saved = FALSE
  AND id IN (
      SELECT id
      FROM audit_user_hand_history
      WHERE user_id = $1
        AND source = 'live'
        AND is_saved = FALSE
      ORDER BY played_at DESC, id DESC
      OFFSET $2
  )
`, userID, s.recentLimit); err != nil {
			log.Printf("[Ledger] trim live history failed: user=%d err=%v", userID, err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[Ledger] commit live history failed: user=%d hand=%s err=%v", userID, handID, err)
	}
}

func (s *PostgresService) UpsertReplayHand(
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, e := range events {
		if e.EventType == "" {
			e.EventType = "unknown"
		}
		_, err := tx.ExecContext(ctx, `
INSERT INTO ledger_event_stream (
    source, scenario_id, hand_id, seq, event_type, envelope_b64, server_ts_ms
)
VALUES ('replay', '', $1, $2, $3, $4, $5)
ON CONFLICT (source, scenario_id, hand_id, seq) DO UPDATE
SET
    event_type = EXCLUDED.event_type,
    envelope_b64 = EXCLUDED.envelope_b64,
    server_ts_ms = EXCLUDED.server_ts_ms
`, handID, e.Seq, e.EventType, e.EnvelopeB64, e.ServerTsMs)
		if err != nil {
			return err
		}
	}

	playedAt := time.Now().UTC()
	_, err = tx.ExecContext(ctx, `
INSERT INTO audit_user_hand_history (
    user_id, source, hand_id, played_at, summary_json
)
VALUES ($1, 'replay', $2, $3, $4::jsonb)
ON CONFLICT (user_id, source, hand_id) DO UPDATE
SET
    played_at = EXCLUDED.played_at,
    summary_json = EXCLUDED.summary_json,
    updated_at = NOW()
`, userID, handID, playedAt, string(summaryRaw))
	if err != nil {
		return err
	}

	if s.recentLimit > 0 {
		_, err = tx.ExecContext(ctx, `
DELETE FROM audit_user_hand_history
WHERE user_id = $1
  AND source = 'replay'
  AND is_saved = FALSE
  AND id IN (
      SELECT id
      FROM audit_user_hand_history
      WHERE user_id = $1
        AND source = 'replay'
        AND is_saved = FALSE
      ORDER BY played_at DESC, id DESC
      OFFSET $2
  )
`, userID, s.recentLimit)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *PostgresService) ListRecent(ctx context.Context, userID uint64, source Source, limit int) ([]HistoryItem, error) {
	if userID == 0 {
		return []HistoryItem{}, nil
	}
	if !isAuditSource(source) {
		return nil, fmt.Errorf("invalid source %q", source)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT hand_id, source::text, played_at, summary_json, is_saved, saved_at, updated_at
FROM audit_user_hand_history
WHERE user_id = $1
  AND source = $2
ORDER BY played_at DESC, id DESC
LIMIT $3
`, userID, string(source), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]HistoryItem, 0, limit)
	for rows.Next() {
		var item HistoryItem
		var sourceRaw string
		var summaryRaw []byte
		var savedAt sql.NullTime
		if err := rows.Scan(&item.HandID, &sourceRaw, &item.PlayedAt, &summaryRaw, &item.IsSaved, &savedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.Source = Source(sourceRaw)
		if savedAt.Valid {
			t := savedAt.Time
			item.SavedAt = &t
		}
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

func (s *PostgresService) GetHandEvents(ctx context.Context, userID uint64, source Source, handID string) ([]EventItem, error) {
	if userID == 0 || strings.TrimSpace(handID) == "" {
		return nil, ErrNotFound
	}
	if !isAuditSource(source) {
		return nil, fmt.Errorf("invalid source %q", source)
	}

	var tapeBlob []byte
	var historyExists bool
	if err := s.db.QueryRowContext(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM audit_user_hand_history
    WHERE user_id = $1
      AND source = $2
      AND hand_id = $3
), (
    SELECT tape_blob
    FROM audit_user_hand_history
    WHERE user_id = $1
      AND source = $2
      AND hand_id = $3
    LIMIT 1
)
`, userID, string(source), handID).Scan(&historyExists, &tapeBlob); err != nil {
		return nil, err
	}
	if !historyExists {
		return nil, ErrNotFound
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
WHERE source = $1
  AND scenario_id = ''
  AND hand_id = $2
ORDER BY seq ASC
`, string(source), handID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]EventItem, 0, 128)
	for rows.Next() {
		var e EventItem
		var serverTs sql.NullInt64
		if err := rows.Scan(&e.Seq, &e.EventType, &e.EnvelopeB64, &serverTs); err != nil {
			return nil, err
		}
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

func (s *PostgresService) SetSaved(ctx context.Context, userID uint64, source Source, handID string, saved bool) error {
	if userID == 0 || strings.TrimSpace(handID) == "" {
		return ErrNotFound
	}
	if !isAuditSource(source) {
		return fmt.Errorf("invalid source %q", source)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var current bool
	if err := tx.QueryRowContext(ctx, `
SELECT is_saved
FROM audit_user_hand_history
WHERE user_id = $1
  AND source = $2
  AND hand_id = $3
FOR UPDATE
`, userID, string(source), handID).Scan(&current); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if current == saved {
		return tx.Commit()
	}

	if saved {
		var savedCount int
		if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM audit_user_hand_history
WHERE user_id = $1
  AND source = $2
  AND is_saved = TRUE
`, userID, string(source)).Scan(&savedCount); err != nil {
			return err
		}
		if savedCount >= s.savedLimit {
			return ErrSavedLimitReach
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE audit_user_hand_history
SET is_saved = TRUE,
    saved_at = NOW(),
    updated_at = NOW()
WHERE user_id = $1
  AND source = $2
  AND hand_id = $3
`, userID, string(source), handID); err != nil {
			return err
		}
		return tx.Commit()
	}

	if _, err := tx.ExecContext(ctx, `
UPDATE audit_user_hand_history
SET is_saved = FALSE,
    saved_at = NULL,
    updated_at = NOW()
WHERE user_id = $1
  AND source = $2
  AND hand_id = $3
`, userID, string(source), handID); err != nil {
		return err
	}
	if s.recentLimit > 0 {
		if _, err := tx.ExecContext(ctx, `
DELETE FROM audit_user_hand_history
WHERE user_id = $1
  AND source = $2
  AND is_saved = FALSE
  AND id IN (
      SELECT id
      FROM audit_user_hand_history
      WHERE user_id = $1
        AND source = $2
        AND is_saved = FALSE
      ORDER BY played_at DESC, id DESC
      OFFSET $3
  )
`, userID, string(source), s.recentLimit); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func ledgerDSNFromEnv() string {
	if v := strings.TrimSpace(os.Getenv("LEDGER_DATABASE_DSN")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AUTH_DATABASE_DSN")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("DATABASE_URL")); v != "" {
		return v
	}
	return defaultDatabaseDSN
}

func envIntOrDefault(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func envelopePayloadType(env *pb.ServerEnvelope) string {
	switch env.GetPayload().(type) {
	case *pb.ServerEnvelope_TableSnapshot:
		return "tableSnapshot"
	case *pb.ServerEnvelope_SeatUpdate:
		return "seatUpdate"
	case *pb.ServerEnvelope_HandStart:
		return "handStart"
	case *pb.ServerEnvelope_DealHoleCards:
		return "dealHoleCards"
	case *pb.ServerEnvelope_ActionPrompt:
		return "actionPrompt"
	case *pb.ServerEnvelope_ActionResult:
		return "actionResult"
	case *pb.ServerEnvelope_DealBoard:
		return "dealBoard"
	case *pb.ServerEnvelope_PotUpdate:
		return "potUpdate"
	case *pb.ServerEnvelope_PhaseChange:
		return "phaseChange"
	case *pb.ServerEnvelope_WinByFold:
		return "winByFold"
	case *pb.ServerEnvelope_Showdown:
		return "showdown"
	case *pb.ServerEnvelope_HandEnd:
		return "handEnd"
	case *pb.ServerEnvelope_Error:
		return "error"
	case *pb.ServerEnvelope_LoginResponse:
		return "loginResponse"
	default:
		return "unknown"
	}
}

func isAuditSource(source Source) bool {
	return source == SourceLive || source == SourceReplay
}

func nullableInt64(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}

func nullableBytes(v []byte) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

func envMarshal(env *pb.ServerEnvelope) ([]byte, error) {
	return proto.Marshal(env)
}
