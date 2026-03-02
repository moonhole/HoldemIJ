package npc

import (
	"math/rand"
	"time"
)

// RuleBrain is a thin runtime adapter: provider -> guard -> core engine.
type RuleBrain struct {
	Persona *NPCPersona

	rng      *rand.Rand
	provider RuleProvider
	engine   CorePolicyEngine
	guard    PolicyGuard
	runtime  PolicyRuntime
}

// NewRuleBrain creates a RuleBrain from a persona definition.
func NewRuleBrain(persona *NPCPersona, seed int64) *RuleBrain {
	return NewRuleBrainWithDeps(
		persona,
		seed,
		NewDefaultRuleProvider(),
		NewDeterministicCorePolicyEngine(),
		NewDefaultPolicyGuard(),
	)
}

// NewRuleBrainWithDeps is used by manager/tests to inject core components.
func NewRuleBrainWithDeps(
	persona *NPCPersona,
	seed int64,
	provider RuleProvider,
	engine CorePolicyEngine,
	guard PolicyGuard,
) *RuleBrain {
	if provider == nil {
		provider = NewDefaultRuleProvider()
	}
	if engine == nil {
		engine = NewDeterministicCorePolicyEngine()
	}
	if guard == nil {
		guard = NewDefaultPolicyGuard()
	}

	rng := rand.New(rand.NewSource(seed))
	basePlan := provider.BuildPlan(persona, GameView{})
	if err := guard.Validate(basePlan); err != nil {
		basePlan = PolicyPlan{
			BetSizeFractions:     []float64{0.33, 0.66, 1.0},
			RaiseSizeMultipliers: []float64{2.0, 2.75, 3.5},
			MaxBluffFreq:         0.25,
			MaxAllInFreq:         0.15,
		}
	}
	basePlan = guard.Clamp(basePlan, PolicyDelta{})

	profile := PersonalityProfile{}
	if persona != nil {
		profile = persona.Brain
	}

	return &RuleBrain{
		Persona:  persona,
		rng:      rng,
		provider: provider,
		engine:   engine,
		guard:    guard,
		runtime: PolicyRuntime{
			Plan:       basePlan,
			Profile:    profile,
			Provider:   "rule",
			Level:      BrainLevelMechanical,
			LastUpdate: time.Now().UTC(),
			Rand:       rng,
		},
	}
}

func (b *RuleBrain) Name() string {
	if b.Persona == nil || b.Persona.Name == "" {
		return "RULE_BRAIN"
	}
	return b.Persona.Name
}

// Decide implements BrainDecider.
func (b *RuleBrain) Decide(view GameView) Decision {
	if b.provider != nil {
		plan := b.provider.BuildPlan(b.Persona, view)
		if b.guard != nil {
			if err := b.guard.Validate(plan); err == nil {
				b.runtime.Plan = b.guard.Clamp(plan, PolicyDelta{})
			}
		} else {
			b.runtime.Plan = plan
		}
	}

	if b.Persona != nil {
		b.runtime.Profile = b.Persona.Brain
	}
	b.runtime.Rand = b.rng
	b.runtime.LastUpdate = time.Now().UTC()

	if b.engine == nil {
		return Decision{}
	}
	return b.engine.Decide(view, b.runtime)
}
