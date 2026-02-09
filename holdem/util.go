package holdem

import (
	"math/rand"

	"holdem-lite/card"
)

func getMapKeys(m map[uint16]bool) []uint16 {
	keys := make([]uint16, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func randInt64(min, max int64) int64 {
	if min >= max {
		return min
	}
	return min + rand.Int63n(max-min)
}

// containsCard 工具：判断牌是否在切片里
func containsCard(cards []card.Card, c card.Card) bool {
	for _, cc := range cards {
		if cc == c {
			return true
		}
	}
	return false
}

