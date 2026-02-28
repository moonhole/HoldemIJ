package npc

import (
	"math/rand"

	"holdem-lite/holdem"
)

// RuleBrain makes decisions based on a PersonalityProfile with tunable parameters.
type RuleBrain struct {
	Persona *NPCPersona
	rng     *rand.Rand
}

// NewRuleBrain creates a RuleBrain from a persona definition.
func NewRuleBrain(persona *NPCPersona, seed int64) *RuleBrain {
	return &RuleBrain{
		Persona: persona,
		rng:     rand.New(rand.NewSource(seed)),
	}
}

func (b *RuleBrain) Name() string { return b.Persona.Name }

// Decide implements BrainDecider.
func (b *RuleBrain) Decide(view GameView) Decision {
	p := b.Persona.Brain

	// Add controlled noise so personas feel less robotic.
	aggression := clamp01(p.Aggression + (b.rng.Float64()-0.5)*p.Randomness*0.4)
	tightness := clamp01(p.Tightness + (b.rng.Float64()-0.5)*p.Randomness*0.3)

	legal := view.LegalActions
	if len(legal) == 0 {
		return Decision{Action: holdem.PlayerActionTypeFold}
	}

	canFold := contains(legal, holdem.PlayerActionTypeFold)
	canCheck := contains(legal, holdem.PlayerActionTypeCheck)
	canCall := contains(legal, holdem.PlayerActionTypeCall)
	canBet := contains(legal, holdem.PlayerActionTypeBet)
	canRaise := contains(legal, holdem.PlayerActionTypeRaise)
	canAllIn := contains(legal, holdem.PlayerActionTypeAllin)

	strength := b.estimateHandStrength(view)

	// Preflop: tighter personas fold marginal opens.
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

	// Strong hands should often be aggressive, but not always raise.
	if aggressivePlay {
		if canRaise && b.rng.Float64() < b.raiseChance(view, aggression, strength) {
			raiseAmount := b.calcRaiseAmount(view, aggression)
			return Decision{Action: holdem.PlayerActionTypeRaise, Amount: raiseAmount}
		}
		if canBet && b.rng.Float64() < b.betChance(view, aggression, strength) {
			betAmount := b.calcBetAmount(view, aggression)
			return Decision{Action: holdem.PlayerActionTypeBet, Amount: betAmount}
		}
	}

	// Bluff attempts are probabilistic and usually prefer betting to raising.
	bluffChance := p.Bluffing * (0.2 + (1.0-tightness)*0.15)
	if !aggressivePlay && b.rng.Float64() < bluffChance {
		bluffBetChance := clampRange(0.35+p.Bluffing*0.25, 0.1, 0.65)
		if canBet && b.rng.Float64() < bluffBetChance {
			betAmount := b.calcBetAmount(view, 0.35+aggression*0.3)
			return Decision{Action: holdem.PlayerActionTypeBet, Amount: betAmount}
		}

		bluffRaiseChance := 0.08 + p.Bluffing*0.15 + aggression*0.08
		if view.Street == 0 {
			bluffRaiseChance *= 0.7
		}
		if canRaise && b.rng.Float64() < clampRange(bluffRaiseChance, 0.03, 0.45) {
			raiseAmount := b.calcRaiseAmount(view, 0.3+aggression*0.25)
			return Decision{Action: holdem.PlayerActionTypeRaise, Amount: raiseAmount}
		}
	}

	if canCheck {
		return Decision{Action: holdem.PlayerActionTypeCheck}
	}
	if canCall {
		callThreshold := tightness * 0.4
		if strength > callThreshold || b.rng.Float64() < (1.0-tightness)*0.5 {
			return Decision{Action: holdem.PlayerActionTypeCall, Amount: view.CurrentBet}
		}
		if canFold {
			return Decision{Action: holdem.PlayerActionTypeFold}
		}
		return Decision{Action: holdem.PlayerActionTypeCall, Amount: view.CurrentBet}
	}

	// All-in as last resort if no lower-variance line is available.
	if canAllIn {
		if strength > 0.6 || b.rng.Float64() < aggression*0.2 {
			return Decision{Action: holdem.PlayerActionTypeAllin, Amount: view.MyStack + view.MyBet}
		}
		if canFold {
			return Decision{Action: holdem.PlayerActionTypeFold}
		}
		return Decision{Action: holdem.PlayerActionTypeAllin, Amount: view.MyStack + view.MyBet}
	}

	return Decision{Action: legal[0]}
}

// estimateHandStrength returns a 0.0..1.0 heuristic by hole cards and street.
func (b *RuleBrain) estimateHandStrength(view GameView) float64 {
	if len(view.HoleCards) < 2 {
		return 0.3
	}
	c0 := view.HoleCards[0]
	c1 := view.HoleCards[1]

	rank0 := int(c0.Rank())
	rank1 := int(c1.Rank())

	// Normalize raw rank values into a rough 0..1 scale.
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

	// Add slight postflop variance (placeholder for richer equity logic).
	if view.Street > 0 {
		strength += (b.rng.Float64() - 0.5) * 0.2
	}

	return clamp01(strength)
}

// calcBetAmount determines bet sizing based on aggression.
func (b *RuleBrain) calcBetAmount(view GameView, aggression float64) int64 {
	// Bet between 0.33x and 1.0x pot based on aggression.
	fraction := 0.33 + aggression*0.67
	bet := int64(float64(view.Pot) * fraction)
	if bet < view.MinRaise {
		bet = view.MinRaise
	}
	if bet > view.MyStack+view.MyBet {
		bet = view.MyStack + view.MyBet
	}
	return bet
}

// calcRaiseAmount determines raise sizing.
func (b *RuleBrain) calcRaiseAmount(view GameView, aggression float64) int64 {
	// Raise between min raise and about 3x current bet.
	multiplier := 2.0 + aggression*1.5
	raise := int64(float64(view.CurrentBet) * multiplier)
	if raise < view.MinRaise {
		raise = view.MinRaise
	}
	if raise > view.MyStack+view.MyBet {
		raise = view.MyStack + view.MyBet
	}
	return raise
}

func (b *RuleBrain) raiseChance(view GameView, aggression float64, strength float64) float64 {
	base := 0.07
	switch view.Street {
	case 0: // preflop
		base = 0.03
	case 1: // flop
		base = 0.07
	case 2: // turn
		base = 0.09
	case 3: // river
		base = 0.08
	}
	chance := base + aggression*0.22 + maxFloat(0, strength-0.62)*0.5
	return clampRange(chance, 0.02, 0.65)
}

func (b *RuleBrain) betChance(view GameView, aggression float64, strength float64) float64 {
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

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func clampRange(v float64, lo float64, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func maxFloat(a float64, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func contains(actions []holdem.ActionType, target holdem.ActionType) bool {
	for _, a := range actions {
		if a == target {
			return true
		}
	}
	return false
}
