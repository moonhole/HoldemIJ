package lobby

import (
	"fmt"
	"log"
	"sync"
	"time"

	"holdem-lite/apps/server/internal/ledger"
	"holdem-lite/apps/server/internal/table"
)

const (
	defaultIdleTableTTL    = 60 * time.Second
	defaultCleanupInterval = 30 * time.Second
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
}

// New creates a new lobby
func New(ledgerService ledger.Service) *Lobby {
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
	}
	go l.cleanupLoop()
	return l
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

	// Create new table
	l.nextID++
	tableID := fmt.Sprintf("table_%d", l.nextID)
	t := table.New(tableID, l.defaultConfig, broadcastFn, l.ledger)
	if t == nil {
		return nil, fmt.Errorf("failed to create table")
	}
	l.tables[tableID] = t

	log.Printf("[Lobby] QuickStart: user %d created new table %s", userID, tableID)
	return t, nil
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
		l.mu.Unlock()

		for _, t := range tables {
			t.Stop()
		}
	})
}
