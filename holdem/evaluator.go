package holdem

import "holdem-lite/card"

type bestHandResult struct {
	Score     uint32 // Larger is stronger.
	HandType  byte
	BestIndex [5]int // Best 5 cards indices in original 7 cards.
}

// Cactus Kev prime list for ranks: 2..A => 0..12.
var kevPrimes = [...]int{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41}

const kevMaxHandRank = 7462 // 1 is best (royal flush), 7462 is worst.

// EvalBestOf7 evaluates the best 5-card hand from 7 cards.
func EvalBestOf7(cards card.CardList) *bestHandResult {
	if len(cards) != 7 {
		return nil
	}

	var best *bestHandResult
	idx := [5]int{}

	for a := 0; a < 3; a++ {
		for b := a + 1; b < 4; b++ {
			for c := b + 1; c < 5; c++ {
				for d := c + 1; d < 6; d++ {
					for e := d + 1; e < 7; e++ {
						idx[0], idx[1], idx[2], idx[3], idx[4] = a, b, c, d, e
						score, handType := eval5(cards[a], cards[b], cards[c], cards[d], cards[e])
						if best == nil || score > best.Score {
							best = &bestHandResult{
								Score:     score,
								HandType:  handType,
								BestIndex: idx,
							}
						}
					}
				}
			}
		}
	}
	return best
}

func eval5(a, b, c, d, e card.Card) (score uint32, handType byte) {
	cards := [5]card.Card{a, b, c, d, e}
	suit0 := cards[0].Suit()
	flush := true
	bitmask := 0
	product := 1

	for _, cc := range cards {
		rankIdx := rankToIndex(cc)
		bitmask |= 1 << rankIdx
		product *= kevPrimes[rankIdx]
		if cc.Suit() != suit0 {
			flush = false
		}
	}

	var handRank int
	if flush {
		handRank = kevFlushesTable[bitmask]
	} else if v, ok := kevUnique5Table[bitmask]; ok {
		handRank = v
	} else {
		handRank = kevProductsTable[product]
	}
	if handRank == 0 {
		return 0, 0
	}

	// Convert Kev rank (1 best .. 7462 worst) to "bigger is better".
	score = uint32(kevMaxHandRank + 1 - handRank)
	handType = handTypeFromKevRank(handRank)
	return score, handType
}

func handTypeFromKevRank(rank int) byte {
	switch {
	case rank == 1:
		return HandRoyalFlush
	case rank >= 1 && rank <= 10:
		return HandStraightFlush
	case rank <= 166:
		return HandFourOfKind
	case rank <= 322:
		return HandFullHouse
	case rank <= 1599:
		return HandFlush
	case rank <= 1609:
		return HandStraight
	case rank <= 2467:
		return HandThreeOfKind
	case rank <= 3325:
		return HandTwoPair
	case rank <= 6185:
		return HandOnePair
	default:
		return HandHighCard
	}
}

func rankToIndex(c card.Card) int {
	// card.Rank(): A=1, 2..K => 2..13
	r := int(c.Rank())
	if r == 1 {
		return 12 // Ace
	}
	return r - 2 // 2=>0 ... K=>11
}
