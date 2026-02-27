package lobby

import (
	"fmt"
	"log"

	"holdem-lite/apps/server/internal/table"
	"holdem-lite/holdem/npc"
)

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

	return t, chapter, nil
}

// ChapterRegistry returns the lobby's chapter registry (may be nil).
func (l *Lobby) ChapterRegistry() *npc.ChapterRegistry {
	return l.chapterRegistry
}
