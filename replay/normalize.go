package replay

import (
	"fmt"
	"math/rand"
	"sort"
	"strings"

	"holdem-lite/card"
	"holdem-lite/holdem"
)

type normalizedSeat struct {
	chair  uint16
	userID uint64
	name   string
	stack  int64
	isHero bool
	hole   []card.Card
}

type normalizedAction struct {
	phase    holdem.Phase
	chair    uint16
	action   holdem.ActionType
	amountTo int64
}

type normalizedSpec struct {
	table          TableSpec
	dealerChair    uint16
	seats          []normalizedSeat
	seatByChair    map[uint16]normalizedSeat
	heroChair      uint16
	deck           []card.Card
	actions        []normalizedAction
	handStartStack map[uint16]int64
}

func normalizeSpec(spec HandSpec) (normalizedSpec, error) {
	var out normalizedSpec
	out.table = spec.Table
	out.dealerChair = spec.DealerChair

	if spec.Variant != "" && !strings.EqualFold(spec.Variant, "NLH") {
		return out, &ReplayError{StepIndex: -1, Reason: "invalid_variant", Message: "only NLH is supported"}
	}
	if out.table.MaxPlayers == 0 {
		return out, &ReplayError{StepIndex: -1, Reason: "invalid_table", Message: "table.max_players must be > 0"}
	}
	if out.table.BB <= 0 || out.table.SB < 0 || out.table.SB > out.table.BB {
		return out, &ReplayError{StepIndex: -1, Reason: "invalid_blinds", Message: "invalid blinds configuration"}
	}
	if int(out.dealerChair) >= int(out.table.MaxPlayers) {
		return out, &ReplayError{StepIndex: -1, Reason: "invalid_dealer", Message: "dealer_chair out of range"}
	}
	if len(spec.Seats) < 2 {
		return out, &ReplayError{StepIndex: -1, Reason: "invalid_seats", Message: "at least 2 seats are required"}
	}

	out.seatByChair = make(map[uint16]normalizedSeat, len(spec.Seats))
	seenChair := make(map[uint16]struct{}, len(spec.Seats))
	heroCount := 0
	for i, seat := range spec.Seats {
		if int(seat.Chair) >= int(out.table.MaxPlayers) {
			return out, &ReplayError{StepIndex: -1, Reason: "invalid_seat", Message: fmt.Sprintf("seat %d chair out of range", i)}
		}
		if _, exists := seenChair[seat.Chair]; exists {
			return out, &ReplayError{StepIndex: -1, Reason: "duplicate_chair", Message: fmt.Sprintf("duplicate chair %d", seat.Chair)}
		}
		seenChair[seat.Chair] = struct{}{}
		if seat.Stack < 0 {
			return out, &ReplayError{StepIndex: -1, Reason: "invalid_stack", Message: fmt.Sprintf("seat %d stack must be >= 0", i)}
		}

		holeCards, err := parseHoleCards(seat.Hole)
		if err != nil {
			return out, &ReplayError{StepIndex: -1, Reason: "invalid_hole_cards", Message: err.Error()}
		}

		userID := seat.UserID
		if userID == 0 {
			userID = 100000 + uint64(seat.Chair)
		}
		name := strings.TrimSpace(seat.Name)
		if name == "" {
			name = fmt.Sprintf("P%d", seat.Chair)
		}
		ns := normalizedSeat{
			chair:  seat.Chair,
			userID: userID,
			name:   name,
			stack:  seat.Stack,
			isHero: seat.IsHero,
			hole:   holeCards,
		}
		if ns.isHero {
			heroCount++
			out.heroChair = ns.chair
		}

		out.seats = append(out.seats, ns)
		out.seatByChair[ns.chair] = ns
	}

	activeChairs := activeSeatChairs(out.seats)
	if len(activeChairs) < 2 {
		return out, &ReplayError{StepIndex: -1, Reason: "not_enough_players", Message: "at least 2 active seats (stack > 0) are required"}
	}
	if heroCount == 0 {
		out.heroChair = activeChairs[0]
	} else if heroCount > 1 {
		return out, &ReplayError{StepIndex: -1, Reason: "invalid_hero", Message: "multiple seats marked as hero"}
	}
	if !containsChair(activeChairs, out.heroChair) {
		return out, &ReplayError{StepIndex: -1, Reason: "invalid_hero", Message: "hero seat must be active"}
	}

	boardCards, err := parseBoard(spec.Board)
	if err != nil {
		return out, err
	}
	slotConstraints, err := buildSlotConstraints(activeChairs, out.dealerChair, out.seatByChair, boardCards)
	if err != nil {
		return out, err
	}

	out.deck, err = parseOrBuildDeck(spec.Deck, slotConstraints, seedFromSpec(spec.RNG))
	if err != nil {
		return out, err
	}

	out.actions = make([]normalizedAction, 0, len(spec.Actions))
	for i, a := range spec.Actions {
		phase, err := parsePhaseName(a.Phase)
		if err != nil {
			return out, &ReplayError{StepIndex: int32(i), Reason: "invalid_phase", Message: err.Error()}
		}
		action, err := parseActionName(a.Type)
		if err != nil {
			return out, &ReplayError{StepIndex: int32(i), Reason: "invalid_action", Message: err.Error()}
		}
		if _, ok := out.seatByChair[a.Chair]; !ok {
			return out, &ReplayError{StepIndex: int32(i), Reason: "invalid_action_chair", Message: fmt.Sprintf("chair %d not seated", a.Chair)}
		}
		out.actions = append(out.actions, normalizedAction{
			phase:    phase,
			chair:    a.Chair,
			action:   action,
			amountTo: a.AmountTo,
		})
	}
	return out, nil
}

func parseOrBuildDeck(deck []string, constraints map[int]card.Card, seed int64) ([]card.Card, error) {
	if len(deck) > 0 {
		if len(deck) != len(holdem.HoldemCards) {
			return nil, &ReplayError{
				StepIndex: -1,
				Reason:    "invalid_deck",
				Message:   fmt.Sprintf("deck must contain %d cards", len(holdem.HoldemCards)),
			}
		}
		out := make([]card.Card, len(deck))
		seen := make(map[card.Card]struct{}, len(deck))
		for i, s := range deck {
			c, err := card.ThdmStrToCard(strings.TrimSpace(s))
			if err != nil {
				return nil, &ReplayError{StepIndex: -1, Reason: "invalid_deck_card", Message: fmt.Sprintf("deck[%d]: %v", i, err)}
			}
			if _, ok := seen[c]; ok {
				return nil, &ReplayError{StepIndex: -1, Reason: "invalid_deck", Message: fmt.Sprintf("duplicate card in deck[%d]", i)}
			}
			seen[c] = struct{}{}
			out[i] = c
		}
		for idx, expected := range constraints {
			if out[idx] != expected {
				return nil, &ReplayError{
					StepIndex: -1,
					Reason:    "deck_constraint_mismatch",
					Message:   fmt.Sprintf("deck[%d] does not match constrained card %s", idx, expected.String()),
				}
			}
		}
		return out, nil
	}

	used := make(map[card.Card]struct{}, len(constraints))
	for _, c := range constraints {
		used[c] = struct{}{}
	}

	remaining := make([]card.Card, 0, len(holdem.HoldemCards)-len(constraints))
	for _, c := range holdem.HoldemCards {
		if _, ok := used[c]; ok {
			continue
		}
		remaining = append(remaining, c)
	}
	if seed != 0 {
		r := rand.New(rand.NewSource(seed))
		r.Shuffle(len(remaining), func(i, j int) {
			remaining[i], remaining[j] = remaining[j], remaining[i]
		})
	}

	out := make([]card.Card, len(holdem.HoldemCards))
	ri := 0
	for i := range out {
		if constrained, ok := constraints[i]; ok {
			out[i] = constrained
			continue
		}
		out[i] = remaining[ri]
		ri++
	}
	return out, nil
}

func parseHoleCards(hole []string) ([]card.Card, error) {
	if len(hole) == 0 {
		return nil, nil
	}
	if len(hole) != 2 {
		return nil, fmt.Errorf("hole cards must contain exactly 2 cards")
	}
	out := make([]card.Card, 2)
	for i := range hole {
		c, err := card.ThdmStrToCard(strings.TrimSpace(hole[i]))
		if err != nil {
			return nil, fmt.Errorf("hole[%d]: %w", i, err)
		}
		out[i] = c
	}
	if out[0] == out[1] {
		return nil, fmt.Errorf("hole cards cannot duplicate")
	}
	return out, nil
}

func parseBoard(board *BoardSpec) ([]*card.Card, error) {
	out := make([]*card.Card, 5)
	if board == nil {
		return out, nil
	}
	if len(board.Flop) != 0 && len(board.Flop) != 3 {
		return nil, &ReplayError{StepIndex: -1, Reason: "invalid_board", Message: "flop must be either empty or 3 cards"}
	}
	for i := 0; i < len(board.Flop); i++ {
		c, err := card.ThdmStrToCard(strings.TrimSpace(board.Flop[i]))
		if err != nil {
			return nil, &ReplayError{StepIndex: -1, Reason: "invalid_board_card", Message: fmt.Sprintf("flop[%d]: %v", i, err)}
		}
		cc := c
		out[i] = &cc
	}
	if board.Turn != nil {
		c, err := card.ThdmStrToCard(strings.TrimSpace(*board.Turn))
		if err != nil {
			return nil, &ReplayError{StepIndex: -1, Reason: "invalid_board_card", Message: fmt.Sprintf("turn: %v", err)}
		}
		cc := c
		out[3] = &cc
	}
	if board.River != nil {
		c, err := card.ThdmStrToCard(strings.TrimSpace(*board.River))
		if err != nil {
			return nil, &ReplayError{StepIndex: -1, Reason: "invalid_board_card", Message: fmt.Sprintf("river: %v", err)}
		}
		cc := c
		out[4] = &cc
	}
	seen := make(map[card.Card]struct{}, 5)
	for i, cc := range out {
		if cc == nil {
			continue
		}
		if _, ok := seen[*cc]; ok {
			return nil, &ReplayError{StepIndex: -1, Reason: "duplicate_cards", Message: fmt.Sprintf("duplicate board card at index %d", i)}
		}
		seen[*cc] = struct{}{}
	}
	return out, nil
}

func buildSlotConstraints(activeChairs []uint16, dealerChair uint16, seatByChair map[uint16]normalizedSeat, board []*card.Card) (map[int]card.Card, error) {
	dealOrder, err := dealOrderFromSmallBlind(activeChairs, dealerChair)
	if err != nil {
		return nil, err
	}
	constraints := make(map[int]card.Card, len(activeChairs)*2+5)
	usedCards := make(map[card.Card]struct{}, len(activeChairs)*2+5)

	seatIndex := make(map[uint16]int, len(dealOrder))
	for i, chair := range dealOrder {
		seatIndex[chair] = i
	}

	playerCount := len(dealOrder)
	for chair, seat := range seatByChair {
		if len(seat.hole) == 0 {
			continue
		}
		idx, ok := seatIndex[chair]
		if !ok {
			return nil, &ReplayError{StepIndex: -1, Reason: "invalid_hole_cards", Message: fmt.Sprintf("chair %d is not active but has hole constraints", chair)}
		}
		for round := 0; round < 2; round++ {
			slot := round*playerCount + idx
			if err := assignConstraint(constraints, usedCards, slot, seat.hole[round]); err != nil {
				return nil, err
			}
		}
	}

	boardBase := playerCount * 2
	for i, cc := range board {
		if cc == nil {
			continue
		}
		slot := boardBase + i
		if err := assignConstraint(constraints, usedCards, slot, *cc); err != nil {
			return nil, err
		}
	}
	return constraints, nil
}

func assignConstraint(constraints map[int]card.Card, used map[card.Card]struct{}, slot int, c card.Card) error {
	if existing, ok := constraints[slot]; ok && existing != c {
		return &ReplayError{
			StepIndex: -1,
			Reason:    "duplicate_constraints",
			Message:   fmt.Sprintf("conflicting cards for slot %d", slot),
		}
	}
	if _, ok := used[c]; ok {
		return &ReplayError{
			StepIndex: -1,
			Reason:    "duplicate_cards",
			Message:   fmt.Sprintf("card %s appears multiple times in constraints", c.String()),
		}
	}
	constraints[slot] = c
	used[c] = struct{}{}
	return nil
}

func activeSeatChairs(seats []normalizedSeat) []uint16 {
	active := make([]uint16, 0, len(seats))
	for _, seat := range seats {
		if seat.stack > 0 {
			active = append(active, seat.chair)
		}
	}
	sort.Slice(active, func(i, j int) bool { return active[i] < active[j] })
	return active
}

func dealOrderFromSmallBlind(activeChairs []uint16, dealer uint16) ([]uint16, error) {
	if len(activeChairs) < 2 {
		return nil, &ReplayError{StepIndex: -1, Reason: "not_enough_players", Message: "at least 2 active chairs are required"}
	}
	dealerIdx := -1
	for i, c := range activeChairs {
		if c == dealer {
			dealerIdx = i
			break
		}
	}
	if dealerIdx < 0 {
		return nil, &ReplayError{StepIndex: -1, Reason: "invalid_dealer", Message: "dealer chair is not active"}
	}

	sbIdx := dealerIdx
	if len(activeChairs) > 2 {
		sbIdx = (dealerIdx + 1) % len(activeChairs)
	}
	out := make([]uint16, len(activeChairs))
	for i := range activeChairs {
		out[i] = activeChairs[(sbIdx+i)%len(activeChairs)]
	}
	return out, nil
}

func containsChair(chairs []uint16, chair uint16) bool {
	for _, c := range chairs {
		if c == chair {
			return true
		}
	}
	return false
}

func seedFromSpec(rng *RNGSpec) int64 {
	if rng == nil {
		return 0
	}
	return rng.Seed
}
