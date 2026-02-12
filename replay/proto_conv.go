package replay

import (
	"fmt"
	"sort"
	"strings"

	pb "holdem-lite/apps/server/gen"
	"holdem-lite/card"
	"holdem-lite/holdem"
)

func parsePhaseName(raw string) (holdem.Phase, error) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "PREFLOP":
		return holdem.PhaseTypePreflop, nil
	case "FLOP":
		return holdem.PhaseTypeFlop, nil
	case "TURN":
		return holdem.PhaseTypeTurn, nil
	case "RIVER":
		return holdem.PhaseTypeRiver, nil
	default:
		return 0, fmt.Errorf("unsupported phase %q", raw)
	}
}

func phaseName(phase holdem.Phase) string {
	switch phase {
	case holdem.PhaseTypePreflop:
		return "PREFLOP"
	case holdem.PhaseTypeFlop:
		return "FLOP"
	case holdem.PhaseTypeTurn:
		return "TURN"
	case holdem.PhaseTypeRiver:
		return "RIVER"
	case holdem.PhaseTypeShowdown:
		return "SHOWDOWN"
	default:
		return "UNSPECIFIED"
	}
}

func parseActionName(raw string) (holdem.ActionType, error) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "CHECK":
		return holdem.PlayerActionTypeCheck, nil
	case "BET":
		return holdem.PlayerActionTypeBet, nil
	case "CALL":
		return holdem.PlayerActionTypeCall, nil
	case "RAISE":
		return holdem.PlayerActionTypeRaise, nil
	case "FOLD":
		return holdem.PlayerActionTypeFold, nil
	case "ALLIN", "ALL_IN":
		return holdem.PlayerActionTypeAllin, nil
	default:
		return 0, fmt.Errorf("unsupported action type %q", raw)
	}
}

func actionName(a holdem.ActionType) string {
	if name, ok := holdem.PlayerActionTypeDictionary[a]; ok {
		return name
	}
	return "UNKNOWN"
}

func heroHoleCards(snap holdem.Snapshot, heroChair uint16) []card.Card {
	for _, ps := range snap.Players {
		if ps.Chair == heroChair {
			return append([]card.Card{}, ps.HandCards...)
		}
	}
	return nil
}

func toTableSnapshot(snap holdem.Snapshot, ns normalizedSpec) *pb.TableSnapshot {
	out := &pb.TableSnapshot{
		Config: &pb.TableConfig{
			MaxPlayers: uint32(ns.table.MaxPlayers),
			SmallBlind: ns.table.SB,
			BigBlind:   ns.table.BB,
			Ante:       ns.table.Ante,
			MinBuyIn:   0,
			MaxBuyIn:   0,
		},
		Phase:           phaseToProto(snap.Phase),
		Round:           uint32(snap.Round),
		DealerChair:     uint32(snap.DealerChair),
		SmallBlindChair: uint32(snap.SmallBlindChair),
		BigBlindChair:   uint32(snap.BigBlindChair),
		ActionChair:     uint32(snap.ActionChair),
		CurBet:          snap.CurBet,
		MinRaiseDelta:   snap.MinRaiseDelta,
		CommunityCards:  cardsToProto(snap.CommunityCards),
		Pots:            potsToProto(snap.Pots),
	}
	for _, ps := range snap.Players {
		meta := ns.seatByChair[ps.Chair]
		player := &pb.PlayerState{
			UserId:     meta.userID,
			Chair:      uint32(ps.Chair),
			Nickname:   meta.name,
			Stack:      ps.Stack,
			Bet:        ps.Bet,
			Folded:     ps.Folded,
			AllIn:      ps.AllIn,
			LastAction: actionToProto(ps.LastAction),
			HasCards:   len(ps.HandCards) > 0,
		}
		if ps.Chair == ns.heroChair {
			player.HandCards = cardsToProto(ps.HandCards)
		}
		out.Players = append(out.Players, player)
	}
	return out
}

func cardsToProto(cards []card.Card) []*pb.Card {
	out := make([]*pb.Card, 0, len(cards))
	for _, c := range cards {
		out = append(out, &pb.Card{
			Suit: suitToProto(c.Suit()),
			Rank: rankToProto(c.Rank()),
		})
	}
	return out
}

func potsToProto(pots []holdem.PotSnapshot) []*pb.Pot {
	out := make([]*pb.Pot, 0, len(pots))
	for _, pot := range pots {
		eligible := append([]uint16{}, pot.EligiblePlayers...)
		sort.Slice(eligible, func(i, j int) bool { return eligible[i] < eligible[j] })
		pp := &pb.Pot{Amount: pot.Amount}
		for _, c := range eligible {
			pp.EligibleChairs = append(pp.EligibleChairs, uint32(c))
		}
		out = append(out, pp)
	}
	return out
}

func buildShowdown(result *holdem.SettlementResult, snap holdem.Snapshot) *pb.Showdown {
	net := buildNetResults(result, snap)
	showdown := &pb.Showdown{
		ExcessRefund: toExcessRefund(result),
		NetResults:   net,
	}
	for _, pr := range result.PotResults {
		winners := make([]*pb.Winner, 0, len(pr.Winners))
		for i, chair := range pr.Winners {
			amount := int64(0)
			if i < len(pr.WinAmounts) {
				amount = pr.WinAmounts[i]
			}
			winners = append(winners, &pb.Winner{
				Chair:     uint32(chair),
				WinAmount: amount,
			})
		}
		showdown.PotResults = append(showdown.PotResults, &pb.PotResult{
			PotAmount: pr.Amount,
			Winners:   winners,
		})
	}
	for _, pr := range result.PlayerResults {
		if pr.HandType == 0 {
			continue
		}
		showdown.Hands = append(showdown.Hands, &pb.ShowdownHand{
			Chair:     uint32(pr.Chair),
			HoleCards: cardsToProto(pr.HandCards),
			BestFive:  cardsToProto(pr.BestFiveCards),
			Rank:      handRankToProto(pr.HandType),
		})
	}
	if len(showdown.Hands) == 0 && len(showdown.PotResults) == 0 && len(showdown.NetResults) == 0 && showdown.ExcessRefund == nil {
		return nil
	}
	return showdown
}

func buildWinByFold(result *holdem.SettlementResult) *pb.WinByFold {
	var winnerChair uint16
	var winnerAmount int64
	var found bool
	for _, pr := range result.PlayerResults {
		if pr.IsWinner {
			winnerChair = pr.Chair
			winnerAmount = pr.WinAmount
			found = true
			break
		}
	}
	if !found {
		return nil
	}
	potTotal := totalPotResultAmount(result)
	if potTotal == 0 {
		potTotal = winnerAmount
	}
	return &pb.WinByFold{
		WinnerChair:  uint32(winnerChair),
		PotTotal:     potTotal,
		ExcessRefund: toExcessRefund(result),
	}
}

func buildStackDeltas(snap holdem.Snapshot, handStartStack map[uint16]int64) []*pb.StackDelta {
	out := make([]*pb.StackDelta, 0, len(snap.Players))
	for _, ps := range snap.Players {
		start, ok := handStartStack[ps.Chair]
		if !ok {
			start = ps.Stack
		}
		out = append(out, &pb.StackDelta{
			Chair:    uint32(ps.Chair),
			Delta:    ps.Stack - start,
			NewStack: ps.Stack,
		})
	}
	return out
}

func buildNetResults(result *holdem.SettlementResult, snap holdem.Snapshot) []*pb.NetResult {
	perChair := make(map[uint16]holdem.ShowdownPlayerResult, len(result.PlayerResults))
	for _, pr := range result.PlayerResults {
		perChair[pr.Chair] = pr
	}
	out := make([]*pb.NetResult, 0, len(snap.Players))
	for _, ps := range snap.Players {
		nr := &pb.NetResult{Chair: uint32(ps.Chair)}
		if pr, ok := perChair[ps.Chair]; ok {
			nr.WinAmount = pr.WinAmount
			nr.IsWinner = pr.IsWinner
		}
		out = append(out, nr)
	}
	return out
}

func toExcessRefund(result *holdem.SettlementResult) *pb.ExcessRefund {
	if result.ExcessAmount <= 0 || result.ExcessChair == holdem.InvalidChair {
		return nil
	}
	return &pb.ExcessRefund{
		Chair:  uint32(result.ExcessChair),
		Amount: result.ExcessAmount,
	}
}

func hasShowdownHands(result *holdem.SettlementResult) bool {
	for _, pr := range result.PlayerResults {
		if pr.HandType > 0 {
			return true
		}
	}
	return false
}

func totalCollectedPotAmount(snap holdem.Snapshot) int64 {
	var total int64
	for _, pot := range snap.Pots {
		total += pot.Amount
	}
	return total
}

func totalPotResultAmount(result *holdem.SettlementResult) int64 {
	var total int64
	for _, pot := range result.PotResults {
		total += pot.Amount
	}
	return total
}

func potsChanged(before, after []holdem.PotSnapshot) bool {
	if len(before) != len(after) {
		return true
	}
	for i := range before {
		if before[i].Amount != after[i].Amount {
			return true
		}
		if len(before[i].EligiblePlayers) != len(after[i].EligiblePlayers) {
			return true
		}
		a := append([]uint16{}, before[i].EligiblePlayers...)
		b := append([]uint16{}, after[i].EligiblePlayers...)
		sort.Slice(a, func(x, y int) bool { return a[x] < a[y] })
		sort.Slice(b, func(x, y int) bool { return b[x] < b[y] })
		for j := range a {
			if a[j] != b[j] {
				return true
			}
		}
	}
	return false
}

func evaluateMyHand(snap holdem.Snapshot, chair uint16) (pb.HandRank, uint32, bool) {
	if len(snap.CommunityCards) != 5 {
		return pb.HandRank_HAND_RANK_UNSPECIFIED, 0, false
	}
	var hole []card.Card
	for _, ps := range snap.Players {
		if ps.Chair == chair {
			hole = ps.HandCards
			break
		}
	}
	if len(hole) != 2 {
		return pb.HandRank_HAND_RANK_UNSPECIFIED, 0, false
	}
	all := make([]card.Card, 0, 7)
	all = append(all, hole...)
	all = append(all, snap.CommunityCards...)
	eval := holdem.EvalBestOf7(all)
	if eval == nil {
		return pb.HandRank_HAND_RANK_UNSPECIFIED, 0, false
	}
	return handRankToProto(eval.HandType), eval.Score, true
}

func phaseToProto(p holdem.Phase) pb.Phase {
	switch p {
	case holdem.PhaseTypeAnte:
		return pb.Phase_PHASE_ANTE
	case holdem.PhaseTypePreflop:
		return pb.Phase_PHASE_PREFLOP
	case holdem.PhaseTypeFlop:
		return pb.Phase_PHASE_FLOP
	case holdem.PhaseTypeTurn:
		return pb.Phase_PHASE_TURN
	case holdem.PhaseTypeRiver:
		return pb.Phase_PHASE_RIVER
	case holdem.PhaseTypeShowdown:
		return pb.Phase_PHASE_SHOWDOWN
	default:
		return pb.Phase_PHASE_UNSPECIFIED
	}
}

func actionToProto(a holdem.ActionType) pb.ActionType {
	switch a {
	case holdem.PlayerActionTypeCheck:
		return pb.ActionType_ACTION_CHECK
	case holdem.PlayerActionTypeBet:
		return pb.ActionType_ACTION_BET
	case holdem.PlayerActionTypeCall:
		return pb.ActionType_ACTION_CALL
	case holdem.PlayerActionTypeRaise:
		return pb.ActionType_ACTION_RAISE
	case holdem.PlayerActionTypeFold:
		return pb.ActionType_ACTION_FOLD
	case holdem.PlayerActionTypeAllin:
		return pb.ActionType_ACTION_ALLIN
	default:
		return pb.ActionType_ACTION_UNSPECIFIED
	}
}

func handRankToProto(r byte) pb.HandRank {
	switch r {
	case holdem.HandHighCard:
		return pb.HandRank_HAND_RANK_HIGH_CARD
	case holdem.HandOnePair:
		return pb.HandRank_HAND_RANK_ONE_PAIR
	case holdem.HandTwoPair:
		return pb.HandRank_HAND_RANK_TWO_PAIR
	case holdem.HandThreeOfKind:
		return pb.HandRank_HAND_RANK_THREE_OF_KIND
	case holdem.HandStraight:
		return pb.HandRank_HAND_RANK_STRAIGHT
	case holdem.HandFlush:
		return pb.HandRank_HAND_RANK_FLUSH
	case holdem.HandFullHouse:
		return pb.HandRank_HAND_RANK_FULL_HOUSE
	case holdem.HandFourOfKind:
		return pb.HandRank_HAND_RANK_FOUR_OF_KIND
	case holdem.HandStraightFlush:
		return pb.HandRank_HAND_RANK_STRAIGHT_FLUSH
	case holdem.HandRoyalFlush:
		return pb.HandRank_HAND_RANK_ROYAL_FLUSH
	default:
		return pb.HandRank_HAND_RANK_UNSPECIFIED
	}
}

func suitToProto(s card.Suit) pb.Suit {
	switch s {
	case card.Spade:
		return pb.Suit_SUIT_SPADE
	case card.Heart:
		return pb.Suit_SUIT_HEART
	case card.Club:
		return pb.Suit_SUIT_CLUB
	case card.Diamond:
		return pb.Suit_SUIT_DIAMOND
	default:
		return pb.Suit_SUIT_UNSPECIFIED
	}
}

func rankToProto(r byte) pb.Rank {
	switch r {
	case 1:
		return pb.Rank_RANK_A
	case 2:
		return pb.Rank_RANK_2
	case 3:
		return pb.Rank_RANK_3
	case 4:
		return pb.Rank_RANK_4
	case 5:
		return pb.Rank_RANK_5
	case 6:
		return pb.Rank_RANK_6
	case 7:
		return pb.Rank_RANK_7
	case 8:
		return pb.Rank_RANK_8
	case 9:
		return pb.Rank_RANK_9
	case 10:
		return pb.Rank_RANK_10
	case 11:
		return pb.Rank_RANK_J
	case 12:
		return pb.Rank_RANK_Q
	case 13:
		return pb.Rank_RANK_K
	default:
		return pb.Rank_RANK_UNSPECIFIED
	}
}
