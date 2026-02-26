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

// Decide implements BrainDecider. It selects an action based on personality
// parameters and the current game state.
func (b *RuleBrain) Decide(view GameView) Decision {
	p := b.Persona.Brain

	// Add randomness noise to parameters for this decision
	aggression := clamp01(p.Aggression + (b.rng.Float64()-0.5)*p.Randomness*0.4)
	tightness := clamp01(p.Tightness + (b.rng.Float64()-0.5)*p.Randomness*0.3)

	legal := view.LegalActions
	if len(legal) == 0 {
		return Decision{Action: holdem.PlayerActionTypeFold}
	}

	// Convenience: check what actions are available
	canFold := contains(legal, holdem.PlayerActionTypeFold)
	canCheck := contains(legal, holdem.PlayerActionTypeCheck)
	canCall := contains(legal, holdem.PlayerActionTypeCall)
	canBet := contains(legal, holdem.PlayerActionTypeBet)
	canRaise := contains(legal, holdem.PlayerActionTypeRaise)
	canAllIn := contains(legal, holdem.PlayerActionTypeAllin)

	// Estimate hand strength (simplified heuristic based on street)
	strength := b.estimateHandStrength(view)

	// Preflop: tight players fold more marginal hands
	if view.Street == 0 {
		foldThreshold := tightness * 0.6
		if strength < foldThreshold && canFold {
			// But check if we can check for free
			if canCheck {
				return Decision{Action: holdem.PlayerActionTypeCheck}
			}
			return Decision{Action: holdem.PlayerActionTypeFold}
		}
	}

	// Post-flop: evaluate whether to be aggressive or passive
	aggressivePlay := strength > (1.0-aggression)*0.5

	// Strong hand + aggressive → bet/raise
	if aggressivePlay {
		if canRaise {
			raiseAmount := b.calcRaiseAmount(view, aggression)
			return Decision{Action: holdem.PlayerActionTypeRaise, Amount: raiseAmount}
		}
		if canBet {
			betAmount := b.calcBetAmount(view, aggression)
			return Decision{Action: holdem.PlayerActionTypeBet, Amount: betAmount}
		}
	}

	// Bluff attempt
	if !aggressivePlay && b.rng.Float64() < p.Bluffing*0.3 {
		if canBet {
			betAmount := b.calcBetAmount(view, 0.4)
			return Decision{Action: holdem.PlayerActionTypeBet, Amount: betAmount}
		}
		if canRaise {
			raiseAmount := b.calcRaiseAmount(view, 0.4)
			return Decision{Action: holdem.PlayerActionTypeRaise, Amount: raiseAmount}
		}
	}

	// Marginal hand: call or check
	if canCheck {
		return Decision{Action: holdem.PlayerActionTypeCheck}
	}
	if canCall {
		// Loose players call more often; tight players fold facing bets
		callThreshold := tightness * 0.4
		if strength > callThreshold || b.rng.Float64() < (1.0-tightness)*0.5 {
			return Decision{Action: holdem.PlayerActionTypeCall, Amount: view.CurrentBet}
		}
		if canFold {
			return Decision{Action: holdem.PlayerActionTypeFold}
		}
		return Decision{Action: holdem.PlayerActionTypeCall, Amount: view.CurrentBet}
	}

	// All-in as last resort if it's the only option
	if canAllIn {
		if strength > 0.6 || b.rng.Float64() < aggression*0.2 {
			return Decision{Action: holdem.PlayerActionTypeAllin, Amount: view.MyStack + view.MyBet}
		}
		if canFold {
			return Decision{Action: holdem.PlayerActionTypeFold}
		}
		return Decision{Action: holdem.PlayerActionTypeAllin, Amount: view.MyStack + view.MyBet}
	}

	// Fallback: first legal action
	return Decision{Action: legal[0]}
}

// estimateHandStrength returns a 0.0–1.0 heuristic based on street.
// This is intentionally simple; can be replaced with a proper equity calculator later.
func (b *RuleBrain) estimateHandStrength(view GameView) float64 {
	if len(view.HoleCards) < 2 {
		return 0.3
	}
	c0 := view.HoleCards[0]
	c1 := view.HoleCards[1]

	rank0 := int(c0.Rank())
	rank1 := int(c1.Rank())

	// Normalize ranks: Ace=14 is strongest
	strength := (float64(rank0) + float64(rank1)) / 28.0

	// Pair bonus
	if rank0 == rank1 {
		strength += 0.25
	}

	// Suited bonus
	if c0.Suit() == c1.Suit() {
		strength += 0.05
	}

	// Connected bonus
	gap := rank0 - rank1
	if gap < 0 {
		gap = -gap
	}
	if gap <= 2 {
		strength += 0.05
	}

	// Post-flop: add noise — real evaluation would use community cards
	if view.Street > 0 {
		strength += (b.rng.Float64() - 0.5) * 0.2
	}

	return clamp01(strength)
}

// calcBetAmount determines bet sizing based on aggression.
func (b *RuleBrain) calcBetAmount(view GameView, aggression float64) int64 {
	// Bet between 0.33x and 1.0x pot based on aggression
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
	// Raise between min raise and 3x current bet
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

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func contains(actions []holdem.ActionType, target holdem.ActionType) bool {
	for _, a := range actions {
		if a == target {
			return true
		}
	}
	return false
}
