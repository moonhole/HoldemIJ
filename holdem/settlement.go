package holdem

import (
	"holdem-lite/card"
	"sort"
)

type ShowdownPlayerResult struct {
	Chair             uint16
	HandType          byte
	HandScore         uint32
	HandCards         []card.Card // 2 张手牌
	BestFiveCards     []card.Card // 5 张最佳牌
	AllCards          []card.Card // 7 张（手牌+公共牌）
	IsWinner          bool
	WinAmount         int64
	BestFiveCardIndex [5]int
}

type PotResult struct {
	Amount     int64
	Winners    []uint16
	WinAmounts []int64
}

type SettlementResult struct {
	PlayerResults []ShowdownPlayerResult
	PotResults    []PotResult
	ExcessChair   uint16
	ExcessAmount  int64
}

// SettleShowdown 需要在 communityCards 已经补齐到 5 张之后调用
func (g *Game) SettleShowdown() (*SettlementResult, error) {
	// 无摊牌（只有 1 个未弃牌玩家）
	if g.noShowDown {
		return g.settleNoShowdown()
	}
	return g.settleByEval()
}

func (g *Game) settleByEval() (*SettlementResult, error) {
	// Evaluate all hands
	results := make(map[uint16]*ShowdownPlayerResult, 8)
	for chair, p := range g.playersByChair {
		// Only players who were actually dealt this hand can participate in showdown.
		if p == nil || p.folded || len(p.HandCards()) != 2 {
			continue
		}
		all := make(card.CardList, 0, 7)
		all = append(all, p.HandCards()...)
		all = append(all, g.communityCards...)
		if len(all) != 7 {
			return nil, ErrInvalidState("need 7 cards to evaluate")
		}
		eval := EvalBestOf7(all)
		if eval == nil {
			return nil, ErrInvalidState("eval failed")
		}
		bestFive := make([]card.Card, 0, 5)
		for _, i := range eval.BestIndex {
			bestFive = append(bestFive, all[i])
		}
		results[chair] = &ShowdownPlayerResult{
			Chair:             chair,
			HandType:          eval.HandType,
			HandScore:         eval.Score,
			HandCards:         append([]card.Card{}, p.HandCards()...),
			BestFiveCards:     bestFive,
			AllCards:          append([]card.Card{}, all...),
			BestFiveCardIndex: eval.BestIndex,
		}
	}

	// Determine winners per pot
	potWinners := make([][]uint16, 0, len(g.potManager.pots))
	for _, pot := range g.potManager.pots {
		group := make([]uint16, 0, len(pot.eligiblePlayers))
		for chair := range pot.eligiblePlayers {
			group = append(group, chair)
		}
		if len(group) == 0 {
			potWinners = append(potWinners, nil)
			continue
		}
		sort.Slice(group, func(i, j int) bool { return group[i] < group[j] })

		winners := []uint16{group[0]}
		for gi := 1; gi < len(group); gi++ {
			ch := group[gi]
			cur := results[ch]
			if cur == nil {
				continue
			}
			beatsAll := true
			drawWithAll := true
			for _, w := range winners {
				wr := results[w]
				if wr == nil {
					continue
				}
				if cur.HandScore > wr.HandScore {
					drawWithAll = false
				} else if cur.HandScore == wr.HandScore {
					beatsAll = false
				} else {
					beatsAll = false
					drawWithAll = false
				}
			}
			if beatsAll {
				winners = []uint16{ch}
			} else if drawWithAll {
				winners = append(winners, ch)
			}
		}
		potWinners = append(potWinners, winners)
	}

	// Distribute pots
	out := &SettlementResult{
		PotResults:   make([]PotResult, 0, len(g.potManager.pots)),
		ExcessChair:  g.potManager.excessChair,
		ExcessAmount: g.potManager.excessAmount,
	}

	for potIdx, pot := range g.potManager.pots {
		winners := potWinners[potIdx]
		if len(winners) == 0 || pot.amount <= 0 {
			out.PotResults = append(out.PotResults, PotResult{Amount: pot.amount})
			continue
		}

		winAmount := pot.amount / int64(len(winners))
		remainder := pot.amount % int64(len(winners))

		pr := PotResult{
			Amount:  pot.amount,
			Winners: append([]uint16{}, winners...),
		}

		for i, w := range winners {
			amt := winAmount
			if i == 0 {
				amt += remainder
			}
			pr.WinAmounts = append(pr.WinAmounts, amt)

			if p := g.playersByChair[w]; p != nil {
				p.addStack(amt)
			}
			if r := results[w]; r != nil {
				r.IsWinner = true
				r.WinAmount += amt
			}
		}
		out.PotResults = append(out.PotResults, pr)
	}

	// Flatten + stable sort
	for _, r := range results {
		out.PlayerResults = append(out.PlayerResults, *r)
	}
	sort.Slice(out.PlayerResults, func(i, j int) bool { return out.PlayerResults[i].Chair < out.PlayerResults[j].Chair })
	return out, nil
}

func (g *Game) settleNoShowdown() (*SettlementResult, error) {
	// winner = only not folded
	var winner *Player
	for _, p := range g.playersByChair {
		if p == nil {
			continue
		}
		if !p.folded {
			winner = p
			break
		}
	}
	if winner == nil {
		return nil, ErrInvalidState("no winner in no-showdown state")
	}

	// current uncollected bets
	var maxBet, secondMax int64
	for _, p := range g.playersByChair {
		if p == nil {
			continue
		}
		b := p.Bet()
		if b > maxBet {
			secondMax = maxBet
			maxBet = b
		} else if b > secondMax || b == maxBet {
			secondMax = b
		}
	}

	// refund unmatched portion of winner's bet (if any)
	excess := int64(0)
	if winner.Bet() == maxBet && maxBet > secondMax {
		excess = maxBet - secondMax
		winner.addStack(excess)
		winner.addBet(-excess)
	}

	total := int64(0)
	for _, p := range g.playersByChair {
		if p == nil {
			continue
		}
		total += p.Bet()
	}
	for _, pot := range g.potManager.pots {
		total += pot.amount
	}

	winner.addStack(total)
	for _, p := range g.playersByChair {
		if p != nil {
			p.resetBet()
		}
	}

	out := &SettlementResult{
		PlayerResults: []ShowdownPlayerResult{
			{
				Chair:     winner.ChairID(),
				IsWinner:  true,
				WinAmount: total,
			},
		},
		PotResults: []PotResult{
			{
				Amount:     total,
				Winners:    []uint16{winner.ChairID()},
				WinAmounts: []int64{total},
			},
		},
		ExcessChair:  winner.ChairID(),
		ExcessAmount: excess,
	}
	return out, nil
}
