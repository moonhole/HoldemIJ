package lobby

import (
	"fmt"
	"log"
	"sync"

	"holdem-lite/apps/server/internal/table"
)

// Lobby manages all tables and player assignments
type Lobby struct {
	mu     sync.RWMutex
	tables map[string]*table.Table
	nextID uint64

	// Default table config
	defaultConfig table.TableConfig
}

// New creates a new lobby
func New() *Lobby {
	return &Lobby{
		tables: make(map[string]*table.Table),
		defaultConfig: table.TableConfig{
			MaxPlayers: 6,
			SmallBlind: 50,
			BigBlind:   100,
			Ante:       0,
			MinBuyIn:   5000,
			MaxBuyIn:   20000,
		},
	}
}

// QuickStart finds or creates a table for the player
func (l *Lobby) QuickStart(userID uint32, broadcastFn func(userID uint32, data []byte)) (*table.Table, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Find a table with available seats
	for _, t := range l.tables {
		snap := t.Snapshot()
		if len(snap.Players) < int(l.defaultConfig.MaxPlayers) {
			log.Printf("[Lobby] QuickStart: user %d joining existing table %s", userID, t.ID)
			return t, nil
		}
	}

	// Create new table
	l.nextID++
	tableID := fmt.Sprintf("table_%d", l.nextID)
	t := table.New(tableID, l.defaultConfig, broadcastFn)
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
