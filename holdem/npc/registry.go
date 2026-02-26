package npc

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// PersonaRegistry holds all NPC persona definitions.
type PersonaRegistry struct {
	mu       sync.RWMutex
	personas map[string]*NPCPersona
}

// NewRegistry creates an empty registry.
func NewRegistry() *PersonaRegistry {
	return &PersonaRegistry{
		personas: make(map[string]*NPCPersona),
	}
}

// LoadFromFile loads NPC personas from a JSON file.
func (r *PersonaRegistry) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read personas file: %w", err)
	}
	return r.LoadFromJSON(data)
}

// LoadFromJSON loads NPC personas from raw JSON bytes.
func (r *PersonaRegistry) LoadFromJSON(data []byte) error {
	var list []*NPCPersona
	if err := json.Unmarshal(data, &list); err != nil {
		return fmt.Errorf("parse personas JSON: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range list {
		if p.ID == "" {
			continue
		}
		r.personas[p.ID] = p
	}
	return nil
}

// Get returns a persona by ID.
func (r *PersonaRegistry) Get(id string) *NPCPersona {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.personas[id]
}

// All returns a snapshot of all personas.
func (r *PersonaRegistry) All() []*NPCPersona {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*NPCPersona, 0, len(r.personas))
	for _, p := range r.personas {
		out = append(out, p)
	}
	return out
}

// ByTier returns all personas of the given tier.
func (r *PersonaRegistry) ByTier(tier int) []*NPCPersona {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []*NPCPersona
	for _, p := range r.personas {
		if p.Tier == tier {
			out = append(out, p)
		}
	}
	return out
}

// ByChapter returns all personas that first appear in the given chapter.
func (r *PersonaRegistry) ByChapter(chapter int) []*NPCPersona {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []*NPCPersona
	for _, p := range r.personas {
		if p.FirstSeen == chapter {
			out = append(out, p)
		}
	}
	return out
}

// Count returns the total number of registered personas.
func (r *PersonaRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.personas)
}
