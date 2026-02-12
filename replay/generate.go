package replay

import (
	"encoding/base64"
	"fmt"

	pb "holdem-lite/apps/server/gen"
	"holdem-lite/card"
	"holdem-lite/holdem"

	"google.golang.org/protobuf/proto"
)

const defaultTableID = "replay_local"

func GenerateReplayTape(spec HandSpec) (*ReplayTape, error) {
	ns, err := normalizeSpec(spec)
	if err != nil {
		return nil, err
	}

	game, err := holdem.NewGame(holdem.Config{
		MaxPlayers:        int(ns.table.MaxPlayers),
		MinPlayers:        2,
		SmallBlind:        ns.table.SB,
		BigBlind:          ns.table.BB,
		Ante:              ns.table.Ante,
		Seed:              seedFromSpec(spec.RNG),
		ForcedDealerChair: &ns.dealerChair,
		DeckOverride:      ns.deck,
	})
	if err != nil {
		return nil, &ReplayError{StepIndex: -1, Reason: "engine_init_failed", Message: err.Error()}
	}

	for _, seat := range ns.seats {
		if err := game.SitDown(seat.chair, seat.userID, seat.stack, false); err != nil {
			return nil, &ReplayError{StepIndex: -1, Reason: "seat_init_failed", Message: err.Error()}
		}
	}

	builder := newTapeBuilder(defaultTableID, ns.heroChair)
	beforeStart := game.Snapshot()
	ns.handStartStack = make(map[uint16]int64, len(beforeStart.Players))
	for _, ps := range beforeStart.Players {
		ns.handStartStack[ps.Chair] = ps.Stack
	}
	builder.addSnapshot(toTableSnapshot(beforeStart, ns))

	if err := game.StartHand(); err != nil {
		return nil, &ReplayError{StepIndex: -1, Reason: "start_hand_failed", Message: err.Error()}
	}
	afterStart := game.Snapshot()
	builder.addHandStart(&pb.HandStart{
		Round:            uint32(afterStart.Round),
		DealerChair:      uint32(afterStart.DealerChair),
		SmallBlindChair:  uint32(afterStart.SmallBlindChair),
		BigBlindChair:    uint32(afterStart.BigBlindChair),
		SmallBlindAmount: ns.table.SB,
		BigBlindAmount:   ns.table.BB,
	})
	if heroCards := heroHoleCards(afterStart, ns.heroChair); len(heroCards) == 2 {
		builder.addHoleCards(&pb.DealHoleCards{Cards: cardsToProto(heroCards)})
	}
	if afterStart.ActionChair != holdem.InvalidChair {
		prompt, err := buildActionPrompt(game, afterStart.ActionChair)
		if err != nil {
			return nil, &ReplayError{StepIndex: -1, Reason: "prompt_build_failed", Message: err.Error()}
		}
		builder.addActionPrompt(prompt)
	}

	for stepIdx, action := range ns.actions {
		before := game.Snapshot()
		if before.ActionChair == holdem.InvalidChair {
			return nil, &ReplayError{
				StepIndex: int32(stepIdx),
				Reason:    "no_action_expected",
				Message:   "hand is already complete; no further actions are allowed",
			}
		}
		if before.Phase != action.phase {
			return nil, &ReplayError{
				StepIndex: int32(stepIdx),
				Reason:    "phase_mismatch",
				Message:   fmt.Sprintf("expected phase %s, got %s", phaseName(before.Phase), phaseName(action.phase)),
				Expected: &ExpectedState{
					ActionChair: before.ActionChair,
					Phase:       phaseName(before.Phase),
				},
			}
		}
		if before.ActionChair != action.chair {
			expected := expectedStateForChair(game, before.ActionChair)
			expected.Phase = phaseName(before.Phase)
			return nil, &ReplayError{
				StepIndex: int32(stepIdx),
				Reason:    "out_of_turn",
				Message:   fmt.Sprintf("expected action chair %d, got %d", before.ActionChair, action.chair),
				Expected:  expected,
			}
		}
		if !isLegalAction(game, action.chair, action.action) {
			expected := expectedStateForChair(game, action.chair)
			expected.Phase = phaseName(before.Phase)
			return nil, &ReplayError{
				StepIndex: int32(stepIdx),
				Reason:    "illegal_action",
				Message:   fmt.Sprintf("action %s is not legal for chair %d", actionName(action.action), action.chair),
				Expected:  expected,
			}
		}

		result, err := game.Act(action.chair, action.action, action.amountTo)
		if err != nil {
			expected := expectedStateForChair(game, action.chair)
			expected.Phase = phaseName(before.Phase)
			return nil, &ReplayError{
				StepIndex: int32(stepIdx),
				Reason:    "action_apply_failed",
				Message:   err.Error(),
				Expected:  expected,
			}
		}

		after := game.Snapshot()
		builder.addActionResult(buildActionResult(before, after, action.chair, action.action, result))
		builder.addStreetTransitions(before, after)
		if potsChanged(before.Pots, after.Pots) {
			builder.addPotUpdate(&pb.PotUpdate{Pots: potsToProto(after.Pots)})
		}

		if result != nil {
			builder.addHandEnd(result, after, ns.handStartStack)
			break
		}

		if after.ActionChair != holdem.InvalidChair {
			prompt, err := buildActionPrompt(game, after.ActionChair)
			if err != nil {
				return nil, &ReplayError{
					StepIndex: int32(stepIdx),
					Reason:    "prompt_build_failed",
					Message:   err.Error(),
				}
			}
			builder.addActionPrompt(prompt)
		}
	}

	return &ReplayTape{
		TapeVersion: 1,
		TableID:     builder.tableID,
		HeroChair:   ns.heroChair,
		Events:      builder.events,
	}, nil
}

func isLegalAction(g *holdem.Game, chair uint16, action holdem.ActionType) bool {
	actions, _, err := g.LegalActions(chair)
	if err != nil {
		return false
	}
	for _, a := range actions {
		if a == action {
			return true
		}
	}
	return false
}

func expectedStateForChair(g *holdem.Game, chair uint16) *ExpectedState {
	actions, minRaiseTo, err := g.LegalActions(chair)
	if err != nil {
		return &ExpectedState{ActionChair: chair}
	}
	snap := g.Snapshot()
	callAmount := int64(0)
	for _, ps := range snap.Players {
		if ps.Chair == chair {
			callAmount = snap.CurBet - ps.Bet
			if callAmount < 0 {
				callAmount = 0
			}
			break
		}
	}
	legal := make([]pb.ActionType, 0, len(actions))
	for _, a := range actions {
		legal = append(legal, actionToProto(a))
	}
	return &ExpectedState{
		ActionChair:  chair,
		LegalActions: legal,
		MinRaiseTo:   minRaiseTo,
		CallAmount:   callAmount,
	}
}

func buildActionPrompt(g *holdem.Game, chair uint16) (*pb.ActionPrompt, error) {
	actions, minRaiseTo, err := g.LegalActions(chair)
	if err != nil {
		return nil, err
	}
	snap := g.Snapshot()
	callAmount := int64(0)
	for _, ps := range snap.Players {
		if ps.Chair == chair {
			callAmount = snap.CurBet - ps.Bet
			if callAmount < 0 {
				callAmount = 0
			}
			break
		}
	}
	legal := make([]pb.ActionType, 0, len(actions))
	for _, a := range actions {
		legal = append(legal, actionToProto(a))
	}
	return &pb.ActionPrompt{
		Chair:            uint32(chair),
		LegalActions:     legal,
		MinRaiseTo:       minRaiseTo,
		CallAmount:       callAmount,
		TimeLimitSec:     0,
		ActionDeadlineMs: 0,
	}, nil
}

func buildActionResult(before, after holdem.Snapshot, chair uint16, action holdem.ActionType, settlement *holdem.SettlementResult) *pb.ActionResult {
	var newStack int64
	var amount int64
	for _, ps := range after.Players {
		if ps.Chair == chair {
			newStack = ps.Stack
			amount = ps.Bet
			break
		}
	}

	potTotal := totalCollectedPotAmount(after)
	if settlement != nil {
		if prevCollected := totalCollectedPotAmount(before); prevCollected > potTotal {
			potTotal = prevCollected
		}
		if settledTotal := totalPotResultAmount(settlement); settledTotal > potTotal {
			potTotal = settledTotal
		}
	}

	return &pb.ActionResult{
		Chair:       uint32(chair),
		Action:      actionToProto(action),
		Amount:      amount,
		NewStack:    newStack,
		NewPotTotal: potTotal,
	}
}

type tapeBuilder struct {
	tableID string
	hero    uint16
	seq     uint64
	events  []ReplayEvent
}

func newTapeBuilder(tableID string, hero uint16) *tapeBuilder {
	return &tapeBuilder{
		tableID: tableID,
		hero:    hero,
		events:  make([]ReplayEvent, 0, 64),
	}
}

func (b *tapeBuilder) addSnapshot(snapshot *pb.TableSnapshot) {
	b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_TableSnapshot{TableSnapshot: snapshot}})
}

func (b *tapeBuilder) addHandStart(start *pb.HandStart) {
	b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_HandStart{HandStart: start}})
}

func (b *tapeBuilder) addHoleCards(hole *pb.DealHoleCards) {
	b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_DealHoleCards{DealHoleCards: hole}})
}

func (b *tapeBuilder) addActionPrompt(prompt *pb.ActionPrompt) {
	b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_ActionPrompt{ActionPrompt: prompt}})
}

func (b *tapeBuilder) addActionResult(result *pb.ActionResult) {
	b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_ActionResult{ActionResult: result}})
}

func (b *tapeBuilder) addPotUpdate(update *pb.PotUpdate) {
	b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_PotUpdate{PotUpdate: update}})
}

func (b *tapeBuilder) addDealBoard(phase pb.Phase, cards []card.Card) {
	b.pushEnvelope(&pb.ServerEnvelope{
		Payload: &pb.ServerEnvelope_DealBoard{
			DealBoard: &pb.DealBoard{
				Phase: phase,
				Cards: cardsToProto(cards),
			},
		},
	})
}

func (b *tapeBuilder) addPhaseChange(phase holdem.Phase, board []card.Card, pots []holdem.PotSnapshot, snap holdem.Snapshot) {
	msg := &pb.PhaseChange{
		Phase:          phaseToProto(phase),
		CommunityCards: cardsToProto(board),
		Pots:           potsToProto(pots),
	}
	if len(board) == 5 {
		if rank, value, ok := evaluateMyHand(snap, b.hero); ok {
			msg.MyHandRank = &rank
			msg.MyHandValue = &value
		}
	}
	b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_PhaseChange{PhaseChange: msg}})
}

func (b *tapeBuilder) addStreetTransitions(before, after holdem.Snapshot) {
	beforeCount := len(before.CommunityCards)
	afterCount := len(after.CommunityCards)

	if beforeCount < 3 && afterCount >= 3 {
		flop := append([]card.Card{}, after.CommunityCards[:3]...)
		b.addDealBoard(pb.Phase_PHASE_FLOP, flop)
		b.addPhaseChange(holdem.PhaseTypeFlop, flop, after.Pots, after)
	}
	if beforeCount < 4 && afterCount >= 4 {
		turnCard := append([]card.Card{}, after.CommunityCards[3:4]...)
		turnBoard := append([]card.Card{}, after.CommunityCards[:4]...)
		b.addDealBoard(pb.Phase_PHASE_TURN, turnCard)
		b.addPhaseChange(holdem.PhaseTypeTurn, turnBoard, after.Pots, after)
	}
	if beforeCount < 5 && afterCount >= 5 {
		riverCard := append([]card.Card{}, after.CommunityCards[4:5]...)
		riverBoard := append([]card.Card{}, after.CommunityCards[:5]...)
		b.addDealBoard(pb.Phase_PHASE_RIVER, riverCard)
		b.addPhaseChange(holdem.PhaseTypeRiver, riverBoard, after.Pots, after)
	}
}

func (b *tapeBuilder) addHandEnd(result *holdem.SettlementResult, finalSnap holdem.Snapshot, handStartStack map[uint16]int64) {
	if hasShowdownHands(result) {
		b.addPhaseChange(holdem.PhaseTypeShowdown, finalSnap.CommunityCards, finalSnap.Pots, finalSnap)
		showdown := buildShowdown(result, finalSnap)
		if showdown != nil {
			b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_Showdown{Showdown: showdown}})
		}
	} else {
		winByFold := buildWinByFold(result)
		if winByFold != nil {
			b.pushEnvelope(&pb.ServerEnvelope{Payload: &pb.ServerEnvelope_WinByFold{WinByFold: winByFold}})
		}
	}

	b.pushEnvelope(&pb.ServerEnvelope{
		Payload: &pb.ServerEnvelope_HandEnd{
			HandEnd: &pb.HandEnd{
				Round:        uint32(finalSnap.Round),
				StackDeltas:  buildStackDeltas(finalSnap, handStartStack),
				ExcessRefund: toExcessRefund(result),
				NetResults:   buildNetResults(result, finalSnap),
			},
		},
	})
}

func (b *tapeBuilder) pushEnvelope(env *pb.ServerEnvelope) {
	b.seq++
	env.TableId = b.tableID
	env.ServerSeq = b.seq
	env.ServerTsMs = int64(b.seq)
	bin, _ := proto.Marshal(env)
	b.events = append(b.events, ReplayEvent{
		Type:        payloadType(env),
		Seq:         b.seq,
		Value:       env,
		EnvelopeB64: base64.StdEncoding.EncodeToString(bin),
	})
}

func payloadType(env *pb.ServerEnvelope) string {
	switch env.Payload.(type) {
	case *pb.ServerEnvelope_TableSnapshot:
		return "snapshot"
	case *pb.ServerEnvelope_ActionPrompt:
		return "actionPrompt"
	case *pb.ServerEnvelope_HandStart:
		return "handStart"
	case *pb.ServerEnvelope_DealHoleCards:
		return "holeCards"
	case *pb.ServerEnvelope_DealBoard:
		return "board"
	case *pb.ServerEnvelope_ActionResult:
		return "actionResult"
	case *pb.ServerEnvelope_PotUpdate:
		return "potUpdate"
	case *pb.ServerEnvelope_PhaseChange:
		return "phaseChange"
	case *pb.ServerEnvelope_Showdown:
		return "showdown"
	case *pb.ServerEnvelope_HandEnd:
		return "handEnd"
	case *pb.ServerEnvelope_WinByFold:
		return "winByFold"
	default:
		return "unknown"
	}
}
