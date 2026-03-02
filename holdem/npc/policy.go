package npc

import (
	"math/rand"
	"time"
)

// BrainLevel controls how often strategy is refreshed, not how actions are emitted.
type BrainLevel string

const (
	BrainLevelMechanical  BrainLevel = "mechanical"
	BrainLevelDynamic     BrainLevel = "dynamic"
	BrainLevelIntelligent BrainLevel = "intelligent"
)

// PolicyPlan is the shared strategy shape used by all providers.
// Many fields are placeholders for later phases (Script/LLM providers).
type PolicyPlan struct {
	OpenRaiseByPos       map[string]float64
	ThreeBetByPos        map[string]float64
	CBetByStreet         map[int]float64 // 1=flop,2=turn,3=river
	BarrelByStreet       map[int]float64
	CheckRaiseByStreet   map[int]float64
	BetSizeFractions     []float64
	RaiseSizeMultipliers []float64
	MaxBluffFreq         float64
	MaxAllInFreq         float64
}

// PolicyDelta is an optional patch over a baseline plan.
// This is kept intentionally small for the first migration step.
type PolicyDelta struct {
	BetSizeFractions     []float64
	RaiseSizeMultipliers []float64
	MaxBluffFreq         *float64
	MaxAllInFreq         *float64
}

// PolicyRuntime is the effective decision context passed into the core engine.
type PolicyRuntime struct {
	Plan       PolicyPlan
	Profile    PersonalityProfile
	Provider   string
	Level      BrainLevel
	LastUpdate time.Time
	Rand       *rand.Rand
}

// CorePolicyEngine emits one final Decision from view + runtime.
type CorePolicyEngine interface {
	Decide(view GameView, runtime PolicyRuntime) Decision
}

// RuleProvider builds a deterministic baseline policy from persona/style.
type RuleProvider interface {
	BuildPlan(persona *NPCPersona, view GameView) PolicyPlan
}

// ScriptProvider and LLMProvider are placeholders for later phases.
type ScriptProvider interface {
	BuildPlan(script any, view GameView) (PolicyPlan, error)
}

type LLMProvider interface {
	ProposeDelta(view GameView, runtime PolicyRuntime) (PolicyDelta, error)
}

// PolicyGuard validates and clamps plans before execution.
type PolicyGuard interface {
	Validate(plan PolicyPlan) error
	Clamp(base PolicyPlan, delta PolicyDelta) PolicyPlan
}
