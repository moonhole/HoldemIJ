package lobby

import (
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"holdem-lite/apps/server/internal/ledger"
	"holdem-lite/apps/server/internal/story"
	"holdem-lite/apps/server/internal/table"
	"holdem-lite/holdem/npc"
)

const (
	defaultIdleTableTTL    = 60 * time.Second
	defaultCleanupInterval = 30 * time.Second

	// NPC auto-fill: how many NPC seats to add for Quick Join
	npcFillSeats = 4
)

// Lobby manages all tables and player assignments
type Lobby struct {
	mu     sync.RWMutex
	tables map[string]*table.Table
	nextID uint64

	// Default table config
	defaultConfig table.TableConfig

	idleTableTTL    time.Duration
	cleanupInterval time.Duration
	done            chan struct{}
	stopOnce        sync.Once
	ledger          ledger.Service
	storyService    story.Service
	npcManager      *npc.Manager
	chapterRegistry *npc.ChapterRegistry
	storySessions   map[string]*storySession
	rng             *rand.Rand
}

// New creates a new lobby
func New(ledgerService ledger.Service, storyService story.Service, npcMgr ...*npc.Manager) *Lobby {
	l := &Lobby{
		tables: make(map[string]*table.Table),
		defaultConfig: table.TableConfig{
			MaxPlayers: 6,
			SmallBlind: 50,
			BigBlind:   100,
			Ante:       0,
			MinBuyIn:   5000,
			MaxBuyIn:   20000,
		},
		idleTableTTL:    defaultIdleTableTTL,
		cleanupInterval: defaultCleanupInterval,
		done:            make(chan struct{}),
		ledger:          ledgerService,
		storyService:    storyService,
		storySessions:   make(map[string]*storySession),
		rng:             rand.New(rand.NewSource(time.Now().UnixNano())),
	}
	if len(npcMgr) > 0 && npcMgr[0] != nil {
		l.npcManager = npcMgr[0]
	}
	go l.cleanupLoop()
	return l
}

// SetChapterRegistry sets the chapter registry for story mode.
func (l *Lobby) SetChapterRegistry(cr *npc.ChapterRegistry) {
	l.chapterRegistry = cr
}

// QuickStart finds or creates a table for the player
func (l *Lobby) QuickStart(userID uint64, broadcastFn func(userID uint64, data []byte)) (*table.Table, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Reconnect/resume path: always prefer the table where the user is already seated.
	for tableID, t := range l.tables {
		if t.IsClosed() {
			delete(l.tables, tableID)
			continue
		}
		snap := t.Snapshot()
		for _, p := range snap.Players {
			if p.ID == userID {
				log.Printf("[Lobby] QuickStart: user %d resuming existing table %s", userID, t.ID)
				return t, nil
			}
		}
	}

	// Find a table with available seats
	for tableID, t := range l.tables {
		if t.IsClosed() {
			delete(l.tables, tableID)
			continue
		}
		snap := t.Snapshot()
		if len(snap.Players) < int(l.defaultConfig.MaxPlayers) {
			log.Printf("[Lobby] QuickStart: user %d joining existing table %s", userID, t.ID)
			return t, nil
		}
	}

	// Create new table (with NPC manager if available)
	l.nextID++
	tableID := fmt.Sprintf("table_%d", l.nextID)
	t := table.New(tableID, l.defaultConfig, broadcastFn, l.ledger, l.npcManager)
	if t == nil {
		return nil, fmt.Errorf("failed to create table")
	}
	l.tables[tableID] = t

	// Auto-fill with NPCs so the table always has opponents
	l.fillTableWithNPCs(t)

	log.Printf("[Lobby] QuickStart: user %d created new table %s", userID, tableID)
	return t, nil
}

// fillTableWithNPCs seats NPCs at empty chairs until the table has enough players.
func (l *Lobby) fillTableWithNPCs(t *table.Table) {
	if l.npcManager == nil {
		return
	}
	registry := l.npcManager.Registry()
	if registry.Count() == 0 {
		return
	}

	allPersonas := registry.All()
	if len(allPersonas) == 0 {
		return
	}

	// Shuffle personas for variety
	shuffled := make([]*npc.NPCPersona, len(allPersonas))
	copy(shuffled, allPersonas)
	l.rng.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})

	buyIn := l.defaultConfig.MaxBuyIn
	filled := 0
	personaIdx := 0

	// Fill chairs 1–5 (leave chair 0 for the human player)
	for chair := uint16(1); chair < t.Config.MaxPlayers && filled < npcFillSeats; chair++ {
		if personaIdx >= len(shuffled) {
			personaIdx = 0 // wrap around if we have fewer personas than seats
		}
		persona := shuffled[personaIdx]
		personaIdx++

		if err := t.SeatNPC(persona, chair, buyIn); err != nil {
			log.Printf("[Lobby] Failed to seat NPC %s at chair %d: %v", persona.Name, chair, err)
			continue
		}
		filled++
	}
	log.Printf("[Lobby] Filled table %s with %d NPCs", t.ID, filled)
}

// GetTable returns a table by ID
func (l *Lobby) GetTable(tableID string) *table.Table {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.tables[tableID]
}

// ListTables returns all table IDs
func (l *Lobby) ListTables() []string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	ids := make([]string, 0, len(l.tables))
	for id := range l.tables {
		ids = append(ids, id)
	}
	return ids
}

func (l *Lobby) cleanupLoop() {
	ticker := time.NewTicker(l.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			l.CleanupIdleTables()
		case <-l.done:
			return
		}
	}
}

// CleanupIdleTables removes tables that have been idle beyond TTL.
func (l *Lobby) CleanupIdleTables() int {
	l.mu.Lock()
	idleTables := make([]*table.Table, 0)
	for tableID, t := range l.tables {
		if t.IsClosed() || t.IsIdleFor(l.idleTableTTL) {
			delete(l.tables, tableID)
			delete(l.storySessions, tableID)
			idleTables = append(idleTables, t)
		}
	}
	l.mu.Unlock()

	for _, t := range idleTables {
		t.Stop()
		log.Printf("[Lobby] Removed idle/closed table %s", t.ID)
	}
	return len(idleTables)
}

// Stop shuts down lobby housekeeping and all remaining tables.
func (l *Lobby) Stop() {
	l.stopOnce.Do(func() {
		close(l.done)

		l.mu.Lock()
		tables := make([]*table.Table, 0, len(l.tables))
		for _, t := range l.tables {
			tables = append(tables, t)
		}
		l.tables = make(map[string]*table.Table)
		l.storySessions = make(map[string]*storySession)
		l.mu.Unlock()

		for _, t := range tables {
			t.Stop()
		}
	})
}
