package npc

import (
	"math/rand"

	"holdem-lite/holdem"
)

// DeterministicCorePolicyEngine is the unified decision executor used by RuleBrain.
type DeterministicCorePolicyEngine struct{}

func NewDeterministicCorePolicyEngine() *DeterministicCorePolicyEngine {
	return &DeterministicCorePolicyEngine{}
}

func (e *DeterministicCorePolicyEngine) Decide(view GameView, runtime PolicyRuntime) Decision {
	legal := view.LegalActions
	if len(legal) == 0 {
		return Decision{Action: holdem.PlayerActionTypeFold}
	}

	profile := runtime.Profile
	rng := runtime.Rand

	// Apply bounded style noise to avoid robotic repetition.
	aggression := clamp01(profile.Aggression + (randFloat(rng)-0.5)*profile.Randomness*0.4)
	tightness := clamp01(profile.Tightness + (randFloat(rng)-0.5)*profile.Randomness*0.3)

	canFold := containsAction(legal, holdem.PlayerActionTypeFold)
	canCheck := containsAction(legal, holdem.PlayerActionTypeCheck)
	canCall := containsAction(legal, holdem.PlayerActionTypeCall)
	canBet := containsAction(legal, holdem.PlayerActionTypeBet)
	canRaise := containsAction(legal, holdem.PlayerActionTypeRaise)
	canAllIn := containsAction(legal, holdem.PlayerActionTypeAllin)

	strength := estimateHandStrength(view, rng)

	// Preflop: tighter styles fold more marginal hands.
	if view.Street == 0 {
		foldThreshold := tightness * 0.6
		if strength < foldThreshold && canFold {
			if canCheck {
				return Decision{Action: holdem.PlayerActionTypeCheck}
			}
			return Decision{Action: holdem.PlayerActionTypeFold}
		}
	}

	aggressivePlay := strength > (1.0-aggression)*0.5

	if aggressivePlay {
		if canRaise && randFloat(rng) < raiseChance(view, aggression, strength) {
			raiseAmount := calcRaiseAmount(view, aggression, runtime.Plan)
			return Decision{Action: holdem.PlayerActionTypeRaise, Amount: raiseAmount}
		}
		if canBet && randFloat(rng) < betChance(view, aggression, strength) {
			betAmount := calcBetAmount(view, aggression, runtime.Plan)
			return Decision{Action: holdem.PlayerActionTypeBet, Amount: betAmount}
		}
	}

	bluffChance := profile.Bluffing * (0.2 + (1.0-tightness)*0.15)
	if runtime.Plan.MaxBluffFreq > 0 {
		bluffChance = minFloat(bluffChance, runtime.Plan.MaxBluffFreq)
	}
	if !aggressivePlay && randFloat(rng) < bluffChance {
		bluffBetChance := clampRange(0.35+profile.Bluffing*0.25, 0.1, 0.65)
		if canBet && randFloat(rng) < bluffBetChance {
			betAmount := calcBetAmount(view, 0.35+aggression*0.3, runtime.Plan)
			return Decision{Action: holdem.PlayerActionTypeBet, Amount: betAmount}
		}

		bluffRaiseChance := 0.08 + profile.Bluffing*0.15 + aggression*0.08
		if view.Street == 0 {
			bluffRaiseChance *= 0.7
		}
		if canRaise && randFloat(rng) < clampRange(bluffRaiseChance, 0.03, 0.45) {
			raiseAmount := calcRaiseAmount(view, 0.3+aggression*0.25, runtime.Plan)
			return Decision{Action: holdem.PlayerActionTypeRaise, Amount: raiseAmount}
		}
	}

	if canCheck {
		return Decision{Action: holdem.PlayerActionTypeCheck}
	}

	if canCall {
		callThreshold := tightness * 0.4
		if strength > callThreshold || randFloat(rng) < (1.0-tightness)*0.5 {
			return Decision{Action: holdem.PlayerActionTypeCall, Amount: view.CurrentBet}
		}
		if canFold {
			return Decision{Action: holdem.PlayerActionTypeFold}
		}
		return Decision{Action: holdem.PlayerActionTypeCall, Amount: view.CurrentBet}
	}

	// All-in is a fallback branch under strict frequency cap.
	allInChance := aggression * 0.2
	if runtime.Plan.MaxAllInFreq > 0 {
		allInChance = minFloat(allInChance, runtime.Plan.MaxAllInFreq)
	}
	if canAllIn {
		if strength > 0.6 || randFloat(rng) < allInChance {
			return Decision{Action: holdem.PlayerActionTypeAllin, Amount: view.MyStack + view.MyBet}
		}
		if canFold {
			return Decision{Action: holdem.PlayerActionTypeFold}
		}
		return Decision{Action: holdem.PlayerActionTypeAllin, Amount: view.MyStack + view.MyBet}
	}

	return Decision{Action: legal[0]}
}

func estimateHandStrength(view GameView, rng *rand.Rand) float64 {
	if len(view.HoleCards) < 2 {
		return 0.3
	}
	c0 := view.HoleCards[0]
	c1 := view.HoleCards[1]

	rank0 := int(c0.Rank())
	rank1 := int(c1.Rank())

	strength := (float64(rank0) + float64(rank1)) / 28.0
	if rank0 == rank1 {
		strength += 0.25
	}
	if c0.Suit() == c1.Suit() {
		strength += 0.05
	}

	gap := rank0 - rank1
	if gap < 0 {
		gap = -gap
	}
	if gap <= 2 {
		strength += 0.05
	}

	if view.Street > 0 {
		strength += (randFloat(rng) - 0.5) * 0.2
	}
	return clamp01(strength)
}

func calcBetAmount(view GameView, aggression float64, plan PolicyPlan) int64 {
	fraction := 0.33 + aggression*0.67
	if len(plan.BetSizeFractions) >= 2 {
		fraction = interpolateRange(
			plan.BetSizeFractions[0],
			plan.BetSizeFractions[len(plan.BetSizeFractions)-1],
			clamp01(aggression),
		)
	}
	bet := int64(float64(view.Pot) * fraction)
	if bet < view.MinRaise {
		bet = view.MinRaise
	}
	if bet > view.MyStack+view.MyBet {
		bet = view.MyStack + view.MyBet
	}
	return bet
}

func calcRaiseAmount(view GameView, aggression float64, plan PolicyPlan) int64 {
	multiplier := 2.0 + aggression*1.5
	if len(plan.RaiseSizeMultipliers) >= 2 {
		multiplier = interpolateRange(
			plan.RaiseSizeMultipliers[0],
			plan.RaiseSizeMultipliers[len(plan.RaiseSizeMultipliers)-1],
			clamp01(aggression),
		)
	}
	raise := int64(float64(view.CurrentBet) * multiplier)
	if raise < view.MinRaise {
		raise = view.MinRaise
	}
	if raise > view.MyStack+view.MyBet {
		raise = view.MyStack + view.MyBet
	}
	return raise
}

func raiseChance(view GameView, aggression float64, strength float64) float64 {
	base := 0.07
	switch view.Street {
	case 0:
		base = 0.03
	case 1:
		base = 0.07
	case 2:
		base = 0.09
	case 3:
		base = 0.08
	}
	chance := base + aggression*0.22 + maxFloat(0, strength-0.62)*0.5
	return clampRange(chance, 0.02, 0.65)
}

func betChance(view GameView, aggression float64, strength float64) float64 {
	base := 0.18
	switch view.Street {
	case 0:
		base = 0.12
	case 1:
		base = 0.18
	case 2:
		base = 0.22
	case 3:
		base = 0.2
	}
	chance := base + aggression*0.35 + maxFloat(0, strength-0.52)*0.38
	return clampRange(chance, 0.08, 0.85)
}

func interpolateRange(lo float64, hi float64, t float64) float64 {
	norm := clamp01(t)
	return lo + (hi-lo)*norm
}

func randFloat(rng *rand.Rand) float64 {
	if rng == nil {
		return rand.Float64()
	}
	return rng.Float64()
}

func minFloat(a float64, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
