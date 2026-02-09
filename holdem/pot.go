package holdem

import "sort"

type pot struct {
	amount          int64
	eligiblePlayers map[uint16]bool
}

type potManager struct {
	pots         []pot
	excessChair  uint16
	excessAmount int64
}

func (pm *potManager) resetPots() {
	pm.pots = make([]pot, 0)
	pm.excessChair = 0
	pm.excessAmount = 0
}

func (pm *potManager) addPot(p ...pot) {
	pm.pots = append(pm.pots, p...)
}

func (pm *potManager) calcPotsByPlayerBets(playersWithBets []*Player) {
	// 按照玩家下注金额排序
	sort.Slice(playersWithBets, func(i, j int) bool {
		return playersWithBets[i].Bet() < playersWithBets[j].Bet()
	})

	totalContributed := int64(0)
	for i, player := range playersWithBets {
		bet := player.Bet()

		// 计算这一层级的贡献额度
		contribution := bet - totalContributed
		if contribution <= 0 {
			continue
		}

		newPot := pot{
			amount:          0,
			eligiblePlayers: make(map[uint16]bool),
		}

		// 为这个边池添加参与者和金额
		for j := i; j < len(playersWithBets); j++ {
			playerJ := playersWithBets[j]
			actualContribution := contribution
			if actualContribution > playerJ.Bet()-totalContributed {
				actualContribution = playerJ.Bet() - totalContributed
			}

			newPot.amount += actualContribution
			if !playerJ.Folded() {
				newPot.eligiblePlayers[playerJ.ChairID()] = true
			}
		}

		// 检查最后一个底池是否具有相同参与者，如果是则合并金额
		merged := false
		if len(pm.pots) > 0 {
			lastPot := &pm.pots[len(pm.pots)-1]
			if len(lastPot.eligiblePlayers) == len(newPot.eligiblePlayers) {
				samePlayers := true
				for chairID := range newPot.eligiblePlayers {
					if !lastPot.eligiblePlayers[chairID] {
						samePlayers = false
						break
					}
				}
				if samePlayers {
					lastPot.amount += newPot.amount
					merged = true
				}
			}
		}

		// 如果没有与最后一个底池合并，且底池参与玩家数量大于1，则添加新边池
		if !merged && len(newPot.eligiblePlayers) > 1 {
			pm.addPot(newPot)
		}

		totalContributed += contribution
	}

	// 处理超额下注，将多余的筹码返还给玩家
	pm.excessChair = 0
	pm.excessAmount = 0
	if len(playersWithBets) > 0 {
		lastPlayer := playersWithBets[len(playersWithBets)-1]
		maxBet := lastPlayer.Bet()

		var secondMaxBet int64
		if len(playersWithBets) > 1 {
			secondMaxBet = playersWithBets[len(playersWithBets)-2].Bet()
		}

		excess := maxBet - secondMaxBet
		if excess > 0 {
			lastPlayer.addStack(excess)
			lastPlayer.addBet(-excess)

			pm.excessChair = lastPlayer.ChairID()
			pm.excessAmount = excess
		}
	}
}

