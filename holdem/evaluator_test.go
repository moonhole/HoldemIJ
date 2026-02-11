package holdem

import (
	"testing"

	"holdem-lite/card"
)

func TestEval5_RoyalFlushBeatsLowerStraightFlush(t *testing.T) {
	royalScore, royalType := eval5(
		card.CardSpadeA, card.CardSpadeK, card.CardSpadeQ, card.CardSpadeJ, card.CardSpadeT,
	)
	if royalType != HandRoyalFlush {
		t.Fatalf("expected royal flush, got %d", royalType)
	}

	sfScore, sfType := eval5(
		card.CardHeartK, card.CardHeartQ, card.CardHeartJ, card.CardHeartT, card.CardHeart9,
	)
	if sfType != HandStraightFlush {
		t.Fatalf("expected straight flush, got %d", sfType)
	}
	if royalScore <= sfScore {
		t.Fatalf("expected royal flush to beat lower straight flush: %d <= %d", royalScore, sfScore)
	}
}

func TestEval5_WheelStraightIsLowestStraight(t *testing.T) {
	wheelScore, wheelType := eval5(
		card.CardSpadeA, card.CardHeart2, card.CardClub3, card.CardDiamond4, card.CardSpade5,
	)
	if wheelType != HandStraight {
		t.Fatalf("expected straight for wheel, got %d", wheelType)
	}

	sixHighScore, sixHighType := eval5(
		card.CardSpade2, card.CardHeart3, card.CardClub4, card.CardDiamond5, card.CardSpade6,
	)
	if sixHighType != HandStraight {
		t.Fatalf("expected straight for 6-high, got %d", sixHighType)
	}
	if sixHighScore <= wheelScore {
		t.Fatalf("expected 6-high straight to beat wheel: %d <= %d", sixHighScore, wheelScore)
	}
}

func TestEvalBestOf7_PicksBestFive(t *testing.T) {
	res := EvalBestOf7(card.CardList{
		card.CardSpadeA, card.CardHeartA, // pair of A
		card.CardClubK, card.CardDiamondK, // pair of K
		card.CardSpade2, card.CardHeart3, card.CardClub4, // kicker set
	})
	if res == nil {
		t.Fatalf("expected non-nil result")
	}
	if res.HandType != HandTwoPair {
		t.Fatalf("expected two pair, got %d", res.HandType)
	}
}

func TestEval5_TableCoverage_NoMissingRank(t *testing.T) {
	if testing.Short() {
		t.Skip("skip exhaustive 5-card coverage in short mode")
	}
	cards := HoldemCards
	for a := 0; a < len(cards)-4; a++ {
		for b := a + 1; b < len(cards)-3; b++ {
			for c := b + 1; c < len(cards)-2; c++ {
				for d := c + 1; d < len(cards)-1; d++ {
					for e := d + 1; e < len(cards); e++ {
						score, handType := eval5(cards[a], cards[b], cards[c], cards[d], cards[e])
						if score == 0 || handType == 0 {
							t.Fatalf("missing table rank for combo: %v %v %v %v %v", cards[a], cards[b], cards[c], cards[d], cards[e])
						}
					}
				}
			}
		}
	}
}
