package npc

import (
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"holdem-lite/holdem"
)

// NPCInstance represents an active NPC seated at a table.
type NPCInstance struct {
	PlayerID   uint64
	Chair      uint16
	Persona    *NPCPersona
	Brain      BrainDecider
	ThinkDelay time.Duration
}

// Manager manages NPC lifecycle and decision-making at tables.
type Manager struct {
	registry  *PersonaRegistry
	instances map[uint64]*NPCInstance // keyed by PlayerID
	mu        sync.RWMutex
	rng       *rand.Rand
	nextID    uint64 // auto-incrementing fake player IDs for NPCs
}

// NewManager creates an NPC manager with the given persona registry.
func NewManager(registry *PersonaRegistry) *Manager {
	return &Manager{
		registry:  registry,
		instances: make(map[uint64]*NPCInstance),
		rng:       rand.New(rand.NewSource(time.Now().UnixNano())),
		nextID:    9_000_000, // NPC IDs start from 9M to avoid collision with real users
	}
}

// Registry returns the underlying PersonaRegistry.
func (m *Manager) Registry() *PersonaRegistry {
	return m.registry
}

// SpawnNPC creates and seats an NPC at a table.
// Returns the NPCInstance so the caller can integrate it into the table.
func (m *Manager) SpawnNPC(
	game *holdem.Game,
	chair uint16,
	persona *NPCPersona,
	stack int64,
) (*NPCInstance, error) {
	m.mu.Lock()
	m.nextID++
	playerID := m.nextID
	seed := m.rng.Int63()
	m.mu.Unlock()

	brain := NewRuleBrain(persona, seed)

	// Think delay: 2–5 seconds base, plus random jitter.
	// This makes NPC pacing feel natural, especially in multi-NPC sequences.
	baseMs := 2000 + int(persona.Brain.Randomness*3000)
	jitterMs := m.rng.Intn(2000)
	thinkDelay := time.Duration(baseMs+jitterMs) * time.Millisecond

	if err := game.SitDown(chair, playerID, stack, true); err != nil {
		return nil, fmt.Errorf("spawn NPC %s at chair %d: %w", persona.Name, chair, err)
	}

	inst := &NPCInstance{
		PlayerID:   playerID,
		Chair:      chair,
		Persona:    persona,
		Brain:      brain,
		ThinkDelay: thinkDelay,
	}

	m.mu.Lock()
	m.instances[playerID] = inst
	m.mu.Unlock()

	log.Printf("[NPC] Spawned %s (ID=%d) at chair %d", persona.Name, playerID, chair)
	return inst, nil
}

// OnTurn is called when it's an NPC's turn to act.
// It builds a GameView from the snapshot and asks the brain for a decision.
func (m *Manager) OnTurn(playerID uint64, snap holdem.Snapshot) Decision {
	m.mu.RLock()
	inst := m.instances[playerID]
	m.mu.RUnlock()

	if inst == nil {
		log.Printf("[NPC] OnTurn called for unknown player %d", playerID)
		return Decision{Action: holdem.PlayerActionTypeFold}
	}

	view := buildGameView(inst, snap)
	decision := inst.Brain.Decide(view)
	log.Printf("[NPC] %s decides: %v amount=%d", inst.Persona.Name, decision.Action, decision.Amount)
	return decision
}

// GetInstance returns the NPC instance for a given playerID, or nil.
func (m *Manager) GetInstance(playerID uint64) *NPCInstance {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.instances[playerID]
}

// IsNPC checks if a playerID belongs to an NPC.
func (m *Manager) IsNPC(playerID uint64) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.instances[playerID] != nil
}

// DespawnNPC removes an NPC from tracking.
func (m *Manager) DespawnNPC(playerID uint64) {
	m.mu.Lock()
	inst := m.instances[playerID]
	delete(m.instances, playerID)
	m.mu.Unlock()

	if inst != nil {
		log.Printf("[NPC] Despawned %s (ID=%d)", inst.Persona.Name, playerID)
	}
}

// GetThinkDelay returns the simulated thinking delay for an NPC.
func (m *Manager) GetThinkDelay(playerID uint64) time.Duration {
	m.mu.RLock()
	inst := m.instances[playerID]
	m.mu.RUnlock()
	if inst == nil {
		return time.Second
	}
	return inst.ThinkDelay
}

// buildGameView constructs a GameView from a snapshot for a specific NPC.
func buildGameView(inst *NPCInstance, snap holdem.Snapshot) GameView {
	view := GameView{
		Phase:      snap.Phase,
		Community:  snap.CommunityCards,
		CurrentBet: snap.CurBet,
		MinRaise:   snap.MinRaiseDelta,
	}

	// Calc pot
	for _, pot := range snap.Pots {
		view.Pot += pot.Amount
	}
	// Add live bets to pot estimate
	for _, ps := range snap.Players {
		view.Pot += ps.Bet
	}

	// Find our player data
	for _, ps := range snap.Players {
		if ps.Chair == inst.Chair {
			view.HoleCards = ps.HandCards
			view.MyBet = ps.Bet
			view.MyStack = ps.Stack
			break
		}
	}

	// Count active players
	for _, ps := range snap.Players {
		if !ps.Folded {
			view.ActiveCount++
		}
	}

	// Map phase to street number
	switch snap.Phase {
	case holdem.PhaseTypePreflop:
		view.Street = 0
	case holdem.PhaseTypeFlop:
		view.Street = 1
	case holdem.PhaseTypeTurn:
		view.Street = 2
	case holdem.PhaseTypeRiver:
		view.Street = 3
	}

	// Get legal actions
	// Note: these come from the snapshot's action chair, but we trust the caller
	// to only call OnTurn when it's actually this NPC's turn.

	return view
}
