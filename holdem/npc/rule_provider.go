package npc

// DefaultRuleProvider emits a deterministic baseline plan from persona style.
type DefaultRuleProvider struct{}

func NewDefaultRuleProvider() *DefaultRuleProvider {
	return &DefaultRuleProvider{}
}

func (p *DefaultRuleProvider) BuildPlan(persona *NPCPersona, _ GameView) PolicyPlan {
	profile := PersonalityProfile{}
	if persona != nil {
		profile = persona.Brain
	}

	aggression := clamp01(profile.Aggression)
	tightness := clamp01(profile.Tightness)
	bluffing := clamp01(profile.Bluffing)

	// Keep baseline shape stable. Style is applied in runtime by the core engine.
	return PolicyPlan{
		OpenRaiseByPos:       map[string]float64{},
		ThreeBetByPos:        map[string]float64{},
		CBetByStreet:         map[int]float64{1: 0.55, 2: 0.45, 3: 0.35},
		BarrelByStreet:       map[int]float64{2: 0.35, 3: 0.25},
		CheckRaiseByStreet:   map[int]float64{1: 0.15, 2: 0.12, 3: 0.08},
		BetSizeFractions:     []float64{0.33, 0.66, 1.0},
		RaiseSizeMultipliers: []float64{2.0, 2.75, 3.5},
		MaxBluffFreq:         clampRange(bluffing*(0.2+(1.0-tightness)*0.15), 0.03, 0.65),
		MaxAllInFreq:         clampRange(0.05+aggression*0.2, 0.05, 0.35),
	}
}
