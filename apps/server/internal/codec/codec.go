package codec

import (
	"time"

	pb "holdem-lite/apps/server/gen"
	"holdem-lite/card"
	"holdem-lite/holdem"
)

// GameSnapshotToProto converts holdem.Snapshot to proto TableSnapshot
func GameSnapshotToProto(tableID string, snap holdem.Snapshot, cfg TableConfigProto) *pb.TableSnapshot {
	ts := &pb.TableSnapshot{
		Config:          cfg.ToProto(),
		Phase:           phaseToProto(snap.Phase),
		Round:           uint32(snap.Round),
		DealerChair:     uint32(snap.DealerChair),
		SmallBlindChair: uint32(snap.SmallBlindChair),
		BigBlindChair:   uint32(snap.BigBlindChair),
		ActionChair:     uint32(snap.ActionChair),
		CurBet:          snap.CurBet,
		MinRaiseDelta:   snap.MinRaiseDelta,
	}

	// Community cards
	for _, c := range snap.CommunityCards {
		ts.CommunityCards = append(ts.CommunityCards, cardToProto(c))
	}

	// Pots
	for _, p := range snap.Pots {
		pot := &pb.Pot{Amount: p.Amount}
		for _, chair := range p.EligiblePlayers {
			pot.EligibleChairs = append(pot.EligibleChairs, uint32(chair))
		}
		ts.Pots = append(ts.Pots, pot)
	}

	// Players (Note: hand cards should be filtered per-viewer)
	for _, p := range snap.Players {
		ps := &pb.PlayerState{
			UserId:     p.ID,
			Chair:      uint32(p.Chair),
			Stack:      p.Stack,
			Bet:        p.Bet,
			Folded:     p.Folded,
			AllIn:      p.AllIn,
			LastAction: actionToProto(p.LastAction),
		}
		// HandCards are added separately per-viewer
		ts.Players = append(ts.Players, ps)
	}

	return ts
}

// TableConfigProto wraps table config for proto conversion
type TableConfigProto struct {
	MaxPlayers uint16
	SmallBlind int64
	BigBlind   int64
	Ante       int64
	MinBuyIn   int64
	MaxBuyIn   int64
}

func (c TableConfigProto) ToProto() *pb.TableConfig {
	return &pb.TableConfig{
		MaxPlayers: uint32(c.MaxPlayers),
		SmallBlind: c.SmallBlind,
		BigBlind:   c.BigBlind,
		Ante:       c.Ante,
		MinBuyIn:   c.MinBuyIn,
		MaxBuyIn:   c.MaxBuyIn,
	}
}

// WrapServerEnvelope creates a ServerEnvelope with common fields
func WrapServerEnvelope(tableID string, serverSeq uint64, payload interface{}) *pb.ServerEnvelope {
	env := &pb.ServerEnvelope{
		TableId:    tableID,
		ServerSeq:  serverSeq,
		ServerTsMs: time.Now().UnixMilli(),
	}

	switch p := payload.(type) {
	case *pb.ErrorResponse:
		env.Payload = &pb.ServerEnvelope_Error{Error: p}
	case *pb.TableSnapshot:
		env.Payload = &pb.ServerEnvelope_TableSnapshot{TableSnapshot: p}
	case *pb.SeatUpdate:
		env.Payload = &pb.ServerEnvelope_SeatUpdate{SeatUpdate: p}
	case *pb.HandStart:
		env.Payload = &pb.ServerEnvelope_HandStart{HandStart: p}
	case *pb.DealHoleCards:
		env.Payload = &pb.ServerEnvelope_DealHoleCards{DealHoleCards: p}
	case *pb.DealBoard:
		env.Payload = &pb.ServerEnvelope_DealBoard{DealBoard: p}
	case *pb.ActionPrompt:
		env.Payload = &pb.ServerEnvelope_ActionPrompt{ActionPrompt: p}
	case *pb.ActionResult:
		env.Payload = &pb.ServerEnvelope_ActionResult{ActionResult: p}
	case *pb.PotUpdate:
		env.Payload = &pb.ServerEnvelope_PotUpdate{PotUpdate: p}
	case *pb.Showdown:
		env.Payload = &pb.ServerEnvelope_Showdown{Showdown: p}
	case *pb.HandEnd:
		env.Payload = &pb.ServerEnvelope_HandEnd{HandEnd: p}
	}

	return env
}

// Helper conversion functions

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

func ProtoToAction(a pb.ActionType) holdem.ActionType {
	switch a {
	case pb.ActionType_ACTION_CHECK:
		return holdem.PlayerActionTypeCheck
	case pb.ActionType_ACTION_BET:
		return holdem.PlayerActionTypeBet
	case pb.ActionType_ACTION_CALL:
		return holdem.PlayerActionTypeCall
	case pb.ActionType_ACTION_RAISE:
		return holdem.PlayerActionTypeRaise
	case pb.ActionType_ACTION_FOLD:
		return holdem.PlayerActionTypeFold
	case pb.ActionType_ACTION_ALLIN:
		return holdem.PlayerActionTypeAllin
	default:
		return holdem.PlayerActionTypeNone
	}
}

func cardToProto(c card.Card) *pb.Card {
	return &pb.Card{
		Suit: suitToProto(c.Suit()),
		Rank: rankToProto(c.Rank()),
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
	// card.Rank() returns byte values: A=1,2,3...T=10,J=11,Q=12,K=13
	// proto Rank values: 2-14 where A=14
	switch r {
	case 1: // Ace
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

func CardsToProto(cards []card.Card) []*pb.Card {
	result := make([]*pb.Card, len(cards))
	for i, c := range cards {
		result[i] = cardToProto(c)
	}
	return result
}
