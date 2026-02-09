package holdem

import (
	"sort"

	"holdem-lite/card"
)

type bestHandResult struct {
	Score     uint32 // 越大越强（可直接用 > 比较）
	HandType  byte
	BestIndex [5]int // 最佳5张牌在原7张中的索引
}

// EvalBestOf7 评估7张牌的最佳5张组合
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
						score, handType := eval5(
							cards[a], cards[b], cards[c], cards[d], cards[e],
						)
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

	ranks := make([]int, 0, 5)
	suits := make([]card.Suit, 0, 5)
	counts := map[int]int{}

	for _, cc := range cards {
		r := cc.HandRealVal() // A => 14
		ranks = append(ranks, r)
		suits = append(suits, cc.Suit())
		counts[r]++
	}

	flush := true
	for i := 1; i < len(suits); i++ {
		if suits[i] != suits[0] {
			flush = false
			break
		}
	}

	// ranks desc
	sort.Slice(ranks, func(i, j int) bool { return ranks[i] > ranks[j] })

	unique := make([]int, 0, 5)
	seen := map[int]bool{}
	for _, r := range ranks {
		if !seen[r] {
			seen[r] = true
			unique = append(unique, r)
		}
	}

	straight := false
	straightHigh := 0
	if len(unique) == 5 {
		// wheel: A-5
		if unique[0] == 14 && unique[1] == 5 && unique[2] == 4 && unique[3] == 3 && unique[4] == 2 {
			straight = true
			straightHigh = 5
		} else if unique[0]-unique[4] == 4 {
			straight = true
			straightHigh = unique[0]
		}
	}

	// classify by counts
	type rc struct {
		rank  int
		count int
	}
	group := make([]rc, 0, len(counts))
	for r, cnt := range counts {
		group = append(group, rc{rank: r, count: cnt})
	}
	// Sort by count desc then rank desc
	sort.Slice(group, func(i, j int) bool {
		if group[i].count != group[j].count {
			return group[i].count > group[j].count
		}
		return group[i].rank > group[j].rank
	})

	encode := func(category uint32, r1, r2, r3, r4, r5 int) uint32 {
		return (category << 20) |
			(uint32(r1&0xF) << 16) |
			(uint32(r2&0xF) << 12) |
			(uint32(r3&0xF) << 8) |
			(uint32(r4&0xF) << 4) |
			uint32(r5&0xF)
	}

	// Straight Flush
	if straight && flush {
		handType = HandStraightFlush
		if straightHigh == 14 && unique[4] == 10 {
			handType = HandRoyalFlush
		}
		return encode(8, straightHigh, 0, 0, 0, 0), handType
	}

	// Four of a Kind
	if group[0].count == 4 {
		quad := group[0].rank
		kicker := 0
		for _, r := range ranks {
			if r != quad {
				kicker = r
				break
			}
		}
		return encode(7, quad, kicker, 0, 0, 0), HandFourOfKind
	}

	// Full House
	if group[0].count == 3 && group[1].count == 2 {
		return encode(6, group[0].rank, group[1].rank, 0, 0, 0), HandFullHouse
	}

	// Flush
	if flush {
		return encode(5, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]), HandFlush
	}

	// Straight
	if straight {
		return encode(4, straightHigh, 0, 0, 0, 0), HandStraight
	}

	// Three of a kind
	if group[0].count == 3 {
		trip := group[0].rank
		kickers := make([]int, 0, 2)
		for _, r := range ranks {
			if r != trip {
				kickers = append(kickers, r)
			}
		}
		return encode(3, trip, kickers[0], kickers[1], 0, 0), HandThreeOfKind
	}

	// Two Pair
	if group[0].count == 2 && group[1].count == 2 {
		highPair := group[0].rank
		lowPair := group[1].rank
		kicker := 0
		for _, r := range ranks {
			if r != highPair && r != lowPair {
				kicker = r
				break
			}
		}
		return encode(2, highPair, lowPair, kicker, 0, 0), HandTwoPair
	}

	// One Pair
	if group[0].count == 2 {
		pair := group[0].rank
		kickers := make([]int, 0, 3)
		for _, r := range ranks {
			if r != pair {
				kickers = append(kickers, r)
			}
		}
		return encode(1, pair, kickers[0], kickers[1], kickers[2], 0), HandOnePair
	}

	// High Card
	return encode(0, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]), HandHighCard
}

