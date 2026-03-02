package npc

import "fmt"

// DefaultPolicyGuard enforces simple hard bounds for the first migration stage.
type DefaultPolicyGuard struct{}

func NewDefaultPolicyGuard() *DefaultPolicyGuard {
	return &DefaultPolicyGuard{}
}

func (g *DefaultPolicyGuard) Validate(plan PolicyPlan) error {
	if len(plan.BetSizeFractions) == 0 {
		return fmt.Errorf("policy guard: empty BetSizeFractions")
	}
	if len(plan.RaiseSizeMultipliers) == 0 {
		return fmt.Errorf("policy guard: empty RaiseSizeMultipliers")
	}
	for _, v := range plan.BetSizeFractions {
		if v <= 0 {
			return fmt.Errorf("policy guard: invalid bet size fraction %.4f", v)
		}
	}
	for _, v := range plan.RaiseSizeMultipliers {
		if v <= 0 {
			return fmt.Errorf("policy guard: invalid raise size multiplier %.4f", v)
		}
	}
	if plan.MaxBluffFreq < 0 || plan.MaxBluffFreq > 1 {
		return fmt.Errorf("policy guard: MaxBluffFreq out of range %.4f", plan.MaxBluffFreq)
	}
	if plan.MaxAllInFreq < 0 || plan.MaxAllInFreq > 1 {
		return fmt.Errorf("policy guard: MaxAllInFreq out of range %.4f", plan.MaxAllInFreq)
	}
	return nil
}

func (g *DefaultPolicyGuard) Clamp(base PolicyPlan, delta PolicyDelta) PolicyPlan {
	next := base
	if len(delta.BetSizeFractions) > 0 {
		next.BetSizeFractions = clampPositiveSlice(delta.BetSizeFractions)
	}
	if len(delta.RaiseSizeMultipliers) > 0 {
		next.RaiseSizeMultipliers = clampPositiveSlice(delta.RaiseSizeMultipliers)
	}
	if delta.MaxBluffFreq != nil {
		next.MaxBluffFreq = clamp01(*delta.MaxBluffFreq)
	}
	if delta.MaxAllInFreq != nil {
		next.MaxAllInFreq = clamp01(*delta.MaxAllInFreq)
	}
	if len(next.BetSizeFractions) == 0 {
		next.BetSizeFractions = []float64{0.33, 0.66, 1.0}
	}
	if len(next.RaiseSizeMultipliers) == 0 {
		next.RaiseSizeMultipliers = []float64{2.0, 2.75, 3.5}
	}
	next.MaxBluffFreq = clamp01(next.MaxBluffFreq)
	next.MaxAllInFreq = clamp01(next.MaxAllInFreq)
	return next
}

func clampPositiveSlice(values []float64) []float64 {
	out := make([]float64, 0, len(values))
	for _, v := range values {
		if v > 0 {
			out = append(out, v)
		}
	}
	return out
}
