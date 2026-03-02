package npc

import "holdem-lite/holdem"

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

func containsAction(actions []holdem.ActionType, target holdem.ActionType) bool {
	for _, a := range actions {
		if a == target {
			return true
		}
	}
	return false
}
