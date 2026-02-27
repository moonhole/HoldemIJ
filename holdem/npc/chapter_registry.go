package npc

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// ChapterRegistry holds all story chapter configurations.
type ChapterRegistry struct {
	mu       sync.RWMutex
	chapters map[int]*ChapterConfig
}

// NewChapterRegistry creates an empty chapter registry.
func NewChapterRegistry() *ChapterRegistry {
	return &ChapterRegistry{
		chapters: make(map[int]*ChapterConfig),
	}
}

// LoadFromFile loads chapter configs from a JSON file.
func (r *ChapterRegistry) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read chapters file: %w", err)
	}
	return r.LoadFromJSON(data)
}

// LoadFromJSON loads chapter configs from raw JSON bytes.
func (r *ChapterRegistry) LoadFromJSON(data []byte) error {
	var list []*ChapterConfig
	if err := json.Unmarshal(data, &list); err != nil {
		return fmt.Errorf("parse chapters JSON: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, ch := range list {
		if ch.ID <= 0 {
			continue
		}
		r.chapters[ch.ID] = ch
	}
	return nil
}

// Get returns a chapter config by ID.
func (r *ChapterRegistry) Get(id int) *ChapterConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.chapters[id]
}

// Count returns the total number of chapters.
func (r *ChapterRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.chapters)
}

// All returns all chapter configs sorted by ID.
func (r *ChapterRegistry) All() []*ChapterConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*ChapterConfig, 0, len(r.chapters))
	for i := 1; i <= len(r.chapters); i++ {
		if ch, ok := r.chapters[i]; ok {
			out = append(out, ch)
		}
	}
	return out
}
