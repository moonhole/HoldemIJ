package lobby

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	pb "holdem-lite/apps/server/gen"
	"holdem-lite/apps/server/internal/story"
	"holdem-lite/apps/server/internal/table"
	"holdem-lite/holdem"
	"holdem-lite/holdem/npc"

	"google.golang.org/protobuf/proto"
)

type storySession struct {
	mu sync.Mutex

	tableID   string
	userID    uint64
	chapterID int
	chapter   *npc.ChapterConfig

	startStack int64
	bigBlind   int64
	bossChair  uint16

	handsPlayed  int
	currentStack int64
	potWins      int
	completed    bool

	broadcastFn func(userID uint64, data []byte)
}

// StartStoryChapter creates a table configured for a specific story chapter.
// Returns the table and chapter config.
func (l *Lobby) StartStoryChapter(
	userID uint64,
	chapterID int,
	broadcastFn func(userID uint64, data []byte),
) (*table.Table, *npc.ChapterConfig, error) {
	if l.chapterRegistry == nil {
		return nil, nil, fmt.Errorf("story mode not available (no chapter registry)")
	}
	if l.npcManager == nil {
		return nil, nil, fmt.Errorf("story mode not available (no NPC manager)")
	}

	chapter := l.chapterRegistry.Get(chapterID)
	if chapter == nil {
		return nil, nil, fmt.Errorf("chapter %d not found", chapterID)
	}
	chapterCount := l.chapterRegistry.Count()

	progress, err := l.GetStoryProgress(userID)
	if err != nil {
		return nil, nil, fmt.Errorf("load story progress: %w", err)
	}
	if chapterID > progress.HighestUnlockedChapter {
		return nil, nil, fmt.Errorf(
			"chapter %d is locked (highest unlocked chapter: %d)",
			chapterID,
			progress.HighestUnlockedChapter,
		)
	}

	// Validate that all personas exist
	registry := l.npcManager.Registry()
	boss := registry.Get(chapter.BossID)
	if boss == nil {
		return nil, nil, fmt.Errorf("boss persona %q not found", chapter.BossID)
	}
	var supports []*npc.NPCPersona
	for _, sid := range chapter.SupportIDs {
		p := registry.Get(sid)
		if p == nil {
			log.Printf("[Lobby] Warning: support persona %q not found for chapter %d", sid, chapterID)
			continue
		}
		supports = append(supports, p)
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	// Create a story mode table
	l.nextID++
	tableID := fmt.Sprintf("story_ch%d_%d", chapterID, l.nextID)

	storyCfg := table.TableConfig{
		MaxPlayers: 6,
		SmallBlind: l.defaultConfig.SmallBlind,
		BigBlind:   l.defaultConfig.BigBlind,
		Ante:       l.defaultConfig.Ante,
		MinBuyIn:   l.defaultConfig.MinBuyIn,
		MaxBuyIn:   l.defaultConfig.MaxBuyIn,
	}

	t := table.New(tableID, storyCfg, broadcastFn, l.ledger, l.npcManager)
	if t == nil {
		return nil, nil, fmt.Errorf("failed to create story table")
	}
	l.tables[tableID] = t

	buyIn := storyCfg.MaxBuyIn

	// Seat boss at chair 1 (most prominent position opposite the player)
	if err := t.SeatNPC(boss, 1, buyIn); err != nil {
		log.Printf("[Lobby] Failed to seat boss %s: %v", boss.Name, err)
	}

	// Seat supports at remaining chairs (2-5)
	chair := uint16(2)
	for _, sp := range supports {
		if chair >= storyCfg.MaxPlayers {
			break
		}
		if err := t.SeatNPC(sp, chair, buyIn); err != nil {
			log.Printf("[Lobby] Failed to seat support %s at chair %d: %v", sp.Name, chair, err)
			continue
		}
		chair++
	}

	log.Printf("[Lobby] Story chapter %d (%s) started: table=%s, boss=%s, supports=%d",
		chapterID, chapter.Title, tableID, boss.Name, len(supports))

	session := &storySession{
		tableID:      tableID,
		userID:       userID,
		chapterID:    chapterID,
		chapter:      chapter,
		startStack:   storyCfg.MaxBuyIn,
		currentStack: storyCfg.MaxBuyIn,
		bigBlind:     storyCfg.BigBlind,
		bossChair:    1,
		broadcastFn:  broadcastFn,
	}
	l.storySessions[tableID] = session
	t.AddHandEndHook(func(info table.HandEndInfo) {
		l.onStoryHandEnd(session, chapterCount, info)
	})

	return t, chapter, nil
}

// ChapterRegistry returns the lobby's chapter registry (may be nil).
func (l *Lobby) ChapterRegistry() *npc.ChapterRegistry {
	return l.chapterRegistry
}

// GetStoryProgress loads persisted story progression for a user.
func (l *Lobby) GetStoryProgress(userID uint64) (*story.Progress, error) {
	chapterCount := 1
	if l.chapterRegistry != nil && l.chapterRegistry.Count() > 0 {
		chapterCount = l.chapterRegistry.Count()
	}
	if l.storyService == nil {
		return &story.Progress{
			UserID:                  userID,
			HighestCompletedChapter: 0,
			HighestUnlockedChapter:  1,
			CompletedChapters:       []int{},
			UnlockedFeatures:        []string{},
			UpdatedAt:               time.Now().UTC(),
		}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return l.storyService.GetProgress(ctx, userID, chapterCount)
}

// PushStoryProgress sends current story progress to a user through the caller-provided broadcaster.
func (l *Lobby) PushStoryProgress(
	userID uint64,
	tableID string,
	broadcastFn func(userID uint64, data []byte),
) error {
	progress, err := l.GetStoryProgress(userID)
	if err != nil {
		return err
	}
	l.sendStoryProgress(tableID, userID, progress, broadcastFn)
	return nil
}

func (l *Lobby) onStoryHandEnd(
	session *storySession,
	chapterCount int,
	info table.HandEndInfo,
) {
	if session == nil || session.chapter == nil || info.Result == nil {
		return
	}
	if info.TableID != session.tableID {
		return
	}

	session.mu.Lock()
	if session.completed {
		session.mu.Unlock()
		return
	}

	hero, heroFound := findPlayerByID(info.Snapshot, session.userID)
	if !heroFound {
		session.mu.Unlock()
		return
	}

	session.handsPlayed++
	session.currentStack = hero.Stack
	if session.chapter.Objective.Type == "win_pots" {
		session.potWins += countHeroPotWinsAgainstBoss(info.Result, hero.Chair, session.bossChair)
	}

	chapterSession := &npc.ChapterSession{
		UserID:       session.userID,
		Chapter:      session.chapterID,
		TableID:      session.tableID,
		HandsPlayed:  session.handsPlayed,
		StartStack:   session.startStack,
		CurrentStack: session.currentStack,
		PotWins:      session.potWins,
	}
	if session.chapter.Objective.Type == "eliminate" {
		chapterSession.Completed = hero.Stack > 0 && allOpponentsBusted(info.Snapshot, session.userID)
	}
	if session.chapter.Objective.Type == "most_chips" &&
		chapterSession.HandsPlayed >= session.chapter.Objective.Target {
		chapterSession.Completed = hasMostChips(info.Snapshot, session.userID)
	}

	if !chapterSession.IsChapterComplete(session.chapter.Objective, session.bigBlind) {
		session.mu.Unlock()
		return
	}
	session.mu.Unlock()

	if l.storyService == nil {
		session.mu.Lock()
		session.completed = true
		session.mu.Unlock()
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	progress, err := l.storyService.CompleteChapter(
		ctx,
		session.userID,
		session.chapterID,
		session.chapter.Unlocks,
		chapterCount,
	)
	if err != nil {
		if err == story.ErrChapterLocked {
			log.Printf("[Lobby] story completion rejected as locked: user=%d chapter=%d", session.userID, session.chapterID)
			return
		}
		log.Printf("[Lobby] persist story completion failed: user=%d chapter=%d err=%v", session.userID, session.chapterID, err)
		return
	}

	session.mu.Lock()
	if session.completed {
		session.mu.Unlock()
		return
	}
	session.completed = true
	broadcastFn := session.broadcastFn
	session.mu.Unlock()

	log.Printf("[Lobby] story chapter completed: user=%d chapter=%d unlocked=%d",
		session.userID, session.chapterID, progress.HighestUnlockedChapter)

	if broadcastFn != nil {
		l.sendStoryProgress(session.tableID, session.userID, progress, broadcastFn)
	}
}

func (l *Lobby) sendStoryProgress(
	tableID string,
	userID uint64,
	progress *story.Progress,
	broadcastFn func(userID uint64, data []byte),
) {
	if progress == nil || broadcastFn == nil {
		return
	}

	completed := make([]int32, 0, len(progress.CompletedChapters))
	for _, ch := range progress.CompletedChapters {
		completed = append(completed, int32(ch))
	}

	env := &pb.ServerEnvelope{
		TableId:    tableID,
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_StoryProgress{
			StoryProgress: &pb.StoryProgressState{
				HighestCompletedChapter: int32(progress.HighestCompletedChapter),
				HighestUnlockedChapter:  int32(progress.HighestUnlockedChapter),
				CompletedChapters:       completed,
				UnlockedFeatures:        append([]string(nil), progress.UnlockedFeatures...),
			},
		},
	}
	data, err := proto.Marshal(env)
	if err != nil {
		log.Printf("[Lobby] marshal story progress failed: user=%d err=%v", userID, err)
		return
	}
	broadcastFn(userID, data)
}

func findPlayerByID(snap holdem.Snapshot, userID uint64) (holdem.PlayerSnapshot, bool) {
	for _, ps := range snap.Players {
		if ps.ID == userID {
			return ps, true
		}
	}
	return holdem.PlayerSnapshot{}, false
}

func allOpponentsBusted(snap holdem.Snapshot, heroID uint64) bool {
	for _, ps := range snap.Players {
		if ps.ID == heroID {
			continue
		}
		if ps.Stack > 0 {
			return false
		}
	}
	return true
}

func hasMostChips(snap holdem.Snapshot, heroID uint64) bool {
	heroStack := int64(-1)
	otherMax := int64(-1)
	for _, ps := range snap.Players {
		if ps.ID == heroID {
			heroStack = ps.Stack
			continue
		}
		if ps.Stack > otherMax {
			otherMax = ps.Stack
		}
	}
	if heroStack < 0 {
		return false
	}
	return heroStack > otherMax
}

func countHeroPotWinsAgainstBoss(result *holdem.SettlementResult, heroChair uint16, bossChair uint16) int {
	if result == nil {
		return 0
	}
	bossReachedShowdown := false
	for _, pr := range result.PlayerResults {
		if pr.Chair == bossChair {
			bossReachedShowdown = true
			break
		}
	}
	if !bossReachedShowdown {
		return 0
	}

	wins := 0
	for _, pot := range result.PotResults {
		for _, winner := range pot.Winners {
			if winner == heroChair {
				wins++
				break
			}
		}
	}
	return wins
}
