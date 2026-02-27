package story

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

const defaultStoryDSN = "postgresql://postgres:postgres@localhost:5432/holdem_lite?sslmode=disable"

var ErrChapterLocked = errors.New("chapter is locked")

type Service interface {
	Close() error
	GetProgress(ctx context.Context, userID uint64, chapterCount int) (*Progress, error)
	CompleteChapter(ctx context.Context, userID uint64, chapterID int, unlocks []string, chapterCount int) (*Progress, error)
}

type Progress struct {
	UserID                  uint64
	HighestCompletedChapter int
	HighestUnlockedChapter  int
	CompletedChapters       []int
	UnlockedFeatures        []string
	UpdatedAt               time.Time
}

type memoryService struct {
	mu    sync.RWMutex
	store map[uint64]*storedProgress
}

type postgresService struct {
	db *sql.DB
}

type storedProgress struct {
	HighestCompletedChapter int
	CompletedChapters       []int
	UnlockedFeatures        []string
	UpdatedAt               time.Time
}

func NewServiceFromEnv(authMode string) (Service, string, error) {
	mode := strings.ToLower(strings.TrimSpace(authMode))
	if mode == "memory" {
		return &memoryService{
			store: make(map[uint64]*storedProgress),
		}, "memory", nil
	}
	if mode == "local" || mode == "sqlite" {
		return NewSQLiteServiceFromEnv()
	}

	dsn := storyDSNFromEnv()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, "", err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
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
      AND table_name = 'story_progress'
)`).Scan(&schemaReady); err != nil {
		_ = db.Close()
		return nil, "", err
	}
	if !schemaReady {
		_ = db.Close()
		return nil, "", fmt.Errorf("story schema not initialized: missing table story_progress")
	}

	return &postgresService{db: db}, "postgres", nil
}

func (s *memoryService) Close() error {
	return nil
}

func (s *memoryService) GetProgress(_ context.Context, userID uint64, chapterCount int) (*Progress, error) {
	if userID == 0 {
		return defaultProgress(0, chapterCount), nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sp := s.getOrCreateLocked(userID)
	return toProgress(userID, sp, chapterCount), nil
}

func (s *memoryService) CompleteChapter(
	_ context.Context,
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

	s.mu.Lock()
	defer s.mu.Unlock()

	sp := s.getOrCreateLocked(userID)
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
	return toProgress(userID, sp, chapterCount), nil
}

func (s *memoryService) getOrCreateLocked(userID uint64) *storedProgress {
	if existing := s.store[userID]; existing != nil {
		return existing
	}
	sp := &storedProgress{
		HighestCompletedChapter: 0,
		CompletedChapters:       []int{},
		UnlockedFeatures:        []string{},
		UpdatedAt:               time.Now().UTC(),
	}
	s.store[userID] = sp
	return sp
}

func (s *postgresService) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *postgresService) GetProgress(ctx context.Context, userID uint64, chapterCount int) (*Progress, error) {
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

	sp, err := s.readOrInsertLocked(ctx, tx, userID, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return toProgress(userID, sp, chapterCount), nil
}

func (s *postgresService) CompleteChapter(
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

	sp, err := s.readOrInsertLocked(ctx, tx, userID, true)
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
    highest_completed_chapter = $2,
    completed_chapters = $3::jsonb,
    unlocked_features = $4::jsonb,
    updated_at = NOW()
WHERE user_id = $1
`, userID, sp.HighestCompletedChapter, string(completedRaw), string(featuresRaw))
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return toProgress(userID, sp, chapterCount), nil
}

func (s *postgresService) readOrInsertLocked(
	ctx context.Context,
	tx *sql.Tx,
	userID uint64,
	lockForUpdate bool,
) (*storedProgress, error) {
	query := `
SELECT highest_completed_chapter, completed_chapters, unlocked_features, updated_at
FROM story_progress
WHERE user_id = $1`
	if lockForUpdate {
		query += "\nFOR UPDATE"
	}

	var completedRaw []byte
	var featuresRaw []byte
	var updatedAt time.Time
	sp := &storedProgress{}
	err := tx.QueryRowContext(ctx, query, userID).Scan(
		&sp.HighestCompletedChapter,
		&completedRaw,
		&featuresRaw,
		&updatedAt,
	)
	if err == nil {
		if len(completedRaw) > 0 {
			_ = json.Unmarshal(completedRaw, &sp.CompletedChapters)
		}
		if len(featuresRaw) > 0 {
			_ = json.Unmarshal(featuresRaw, &sp.UnlockedFeatures)
		}
		sp.CompletedChapters = sanitizeCompleted(sp.CompletedChapters)
		sp.UnlockedFeatures = sanitizeFeatures(sp.UnlockedFeatures)
		sp.UpdatedAt = updatedAt.UTC()
		return sp, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	_, err = tx.ExecContext(ctx, `
INSERT INTO story_progress (
    user_id, highest_completed_chapter, completed_chapters, unlocked_features
)
VALUES ($1, 0, '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (user_id) DO NOTHING
`, userID)
	if err != nil {
		return nil, err
	}

	err = tx.QueryRowContext(ctx, query, userID).Scan(
		&sp.HighestCompletedChapter,
		&completedRaw,
		&featuresRaw,
		&updatedAt,
	)
	if err != nil {
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
	sp.UpdatedAt = updatedAt.UTC()
	return sp, nil
}

func toProgress(userID uint64, sp *storedProgress, chapterCount int) *Progress {
	if sp == nil {
		return defaultProgress(userID, chapterCount)
	}
	completed := append([]int(nil), sp.CompletedChapters...)
	features := append([]string(nil), sp.UnlockedFeatures...)
	return &Progress{
		UserID:                  userID,
		HighestCompletedChapter: sp.HighestCompletedChapter,
		HighestUnlockedChapter:  computeHighestUnlocked(sp.HighestCompletedChapter, chapterCount),
		CompletedChapters:       completed,
		UnlockedFeatures:        features,
		UpdatedAt:               sp.UpdatedAt,
	}
}

func defaultProgress(userID uint64, chapterCount int) *Progress {
	return &Progress{
		UserID:                  userID,
		HighestCompletedChapter: 0,
		HighestUnlockedChapter:  computeHighestUnlocked(0, chapterCount),
		CompletedChapters:       []int{},
		UnlockedFeatures:        []string{},
		UpdatedAt:               time.Now().UTC(),
	}
}

func computeHighestUnlocked(highestCompleted, chapterCount int) int {
	if chapterCount <= 0 {
		return 1
	}
	unlocked := highestCompleted + 1
	if unlocked < 1 {
		unlocked = 1
	}
	if unlocked > chapterCount {
		unlocked = chapterCount
	}
	return unlocked
}

func containsInt(items []int, target int) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func mergeUniqueStrings(base []string, extras []string) []string {
	if len(extras) == 0 {
		return sanitizeFeatures(base)
	}
	set := make(map[string]struct{}, len(base)+len(extras))
	out := make([]string, 0, len(base)+len(extras))
	for _, item := range base {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := set[item]; ok {
			continue
		}
		set[item] = struct{}{}
		out = append(out, item)
	}
	for _, item := range extras {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := set[item]; ok {
			continue
		}
		set[item] = struct{}{}
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func sanitizeCompleted(items []int) []int {
	if len(items) == 0 {
		return []int{}
	}
	set := make(map[int]struct{}, len(items))
	out := make([]int, 0, len(items))
	for _, item := range items {
		if item <= 0 {
			continue
		}
		if _, ok := set[item]; ok {
			continue
		}
		set[item] = struct{}{}
		out = append(out, item)
	}
	sort.Ints(out)
	return out
}

func sanitizeFeatures(items []string) []string {
	if len(items) == 0 {
		return []string{}
	}
	set := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := set[item]; ok {
			continue
		}
		set[item] = struct{}{}
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func storyDSNFromEnv() string {
	if v := strings.TrimSpace(os.Getenv("STORY_DATABASE_DSN")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AUTH_DATABASE_DSN")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("DATABASE_URL")); v != "" {
		return v
	}
	return defaultStoryDSN
}
