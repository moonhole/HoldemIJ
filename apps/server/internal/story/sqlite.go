package story

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const defaultLocalDBName = "holdem_local.db"

type sqliteService struct {
	db *sql.DB
}

func NewSQLiteServiceFromEnv() (Service, string, error) {
	dbPath, err := storyLocalDatabasePathFromEnv()
	if err != nil {
		return nil, "", err
	}
	service, err := NewSQLiteService(dbPath)
	if err != nil {
		return nil, "", err
	}
	return service, "sqlite", nil
}

func NewSQLiteService(dbPath string) (Service, error) {
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
	if err := ensureSQLiteStorySchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &sqliteService{db: db}, nil
}

func (s *sqliteService) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *sqliteService) GetProgress(ctx context.Context, userID uint64, chapterCount int) (*Progress, error) {
	if userID == 0 {
		return defaultProgress(0, chapterCount), nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	sp, err := s.readOrInsertLocked(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return toProgress(userID, sp, chapterCount), nil
}

func (s *sqliteService) CompleteChapter(
	ctx context.Context,
	userID uint64,
	chapterID int,
	unlocks []string,
	chapterCount int,
) (*Progress, error) {
	if userID == 0 {
		return nil, fmt.Errorf("invalid user id")
	}
	if chapterID <= 0 {
		return nil, fmt.Errorf("invalid chapter id: %d", chapterID)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	sp, err := s.readOrInsertLocked(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	if chapterID > computeHighestUnlocked(sp.HighestCompletedChapter, chapterCount) {
		return nil, ErrChapterLocked
	}

	if !containsInt(sp.CompletedChapters, chapterID) {
		sp.CompletedChapters = append(sp.CompletedChapters, chapterID)
		sort.Ints(sp.CompletedChapters)
	}
	if chapterID > sp.HighestCompletedChapter {
		sp.HighestCompletedChapter = chapterID
	}
	sp.UnlockedFeatures = mergeUniqueStrings(sp.UnlockedFeatures, unlocks)
	sp.UpdatedAt = time.Now().UTC()

	completedRaw, err := json.Marshal(sp.CompletedChapters)
	if err != nil {
		return nil, err
	}
	featuresRaw, err := json.Marshal(sp.UnlockedFeatures)
	if err != nil {
		return nil, err
	}

	_, err = tx.ExecContext(ctx, `
UPDATE story_progress
SET
    highest_completed_chapter = ?,
    completed_chapters = ?,
    unlocked_features = ?,
    updated_at_ms = ?
WHERE user_id = ?
`, sp.HighestCompletedChapter, string(completedRaw), string(featuresRaw), sp.UpdatedAt.UnixMilli(), userID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return toProgress(userID, sp, chapterCount), nil
}

func (s *sqliteService) readOrInsertLocked(ctx context.Context, tx *sql.Tx, userID uint64) (*storedProgress, error) {
	row := tx.QueryRowContext(ctx, `
SELECT highest_completed_chapter, completed_chapters, unlocked_features, updated_at_ms
FROM story_progress
WHERE user_id = ?
`, userID)

	var completedRaw []byte
	var featuresRaw []byte
	var updatedAtMs int64
	sp := &storedProgress{}
	err := row.Scan(&sp.HighestCompletedChapter, &completedRaw, &featuresRaw, &updatedAtMs)
	if err == nil {
		if len(completedRaw) > 0 {
			_ = json.Unmarshal(completedRaw, &sp.CompletedChapters)
		}
		if len(featuresRaw) > 0 {
			_ = json.Unmarshal(featuresRaw, &sp.UnlockedFeatures)
		}
		sp.CompletedChapters = sanitizeCompleted(sp.CompletedChapters)
		sp.UnlockedFeatures = sanitizeFeatures(sp.UnlockedFeatures)
		sp.UpdatedAt = time.UnixMilli(updatedAtMs).UTC()
		return sp, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	nowMs := time.Now().UTC().UnixMilli()
	_, err = tx.ExecContext(ctx, `
INSERT INTO story_progress (
    user_id, highest_completed_chapter, completed_chapters, unlocked_features, updated_at_ms
)
VALUES (?, 0, '[]', '[]', ?)
ON CONFLICT(user_id) DO NOTHING
`, userID, nowMs)
	if err != nil {
		return nil, err
	}

	row = tx.QueryRowContext(ctx, `
SELECT highest_completed_chapter, completed_chapters, unlocked_features, updated_at_ms
FROM story_progress
WHERE user_id = ?
`, userID)
	if err := row.Scan(&sp.HighestCompletedChapter, &completedRaw, &featuresRaw, &updatedAtMs); err != nil {
		return nil, err
	}
	if len(completedRaw) > 0 {
		_ = json.Unmarshal(completedRaw, &sp.CompletedChapters)
	}
	if len(featuresRaw) > 0 {
		_ = json.Unmarshal(featuresRaw, &sp.UnlockedFeatures)
	}
	sp.CompletedChapters = sanitizeCompleted(sp.CompletedChapters)
	sp.UnlockedFeatures = sanitizeFeatures(sp.UnlockedFeatures)
	sp.UpdatedAt = time.UnixMilli(updatedAtMs).UTC()
	return sp, nil
}

func ensureSQLiteStorySchema(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS story_progress (
    user_id INTEGER PRIMARY KEY,
    highest_completed_chapter INTEGER NOT NULL DEFAULT 0,
    completed_chapters TEXT NOT NULL DEFAULT '[]',
    unlocked_features TEXT NOT NULL DEFAULT '[]',
    updated_at_ms INTEGER NOT NULL
)`)
	return err
}

func storyLocalDatabasePathFromEnv() (string, error) {
	candidates := []string{
		strings.TrimSpace(os.Getenv("STORY_LOCAL_DATABASE_PATH")),
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
