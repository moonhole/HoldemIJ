package table

import (
	"testing"

	"holdem-lite/holdem"
)

func newStandUpTestTable(t *testing.T) *Table {
	t.Helper()

	cfg := TableConfig{
		MaxPlayers: 6,
		SmallBlind: 50,
		BigBlind:   100,
		MinBuyIn:   100,
		MaxBuyIn:   1000,
	}

	game, err := holdem.NewGame(holdem.Config{
		MaxPlayers: int(cfg.MaxPlayers),
		MinPlayers: 2,
		SmallBlind: cfg.SmallBlind,
		BigBlind:   cfg.BigBlind,
		Ante:       cfg.Ante,
	})
	if err != nil {
		t.Fatalf("NewGame err: %v", err)
	}

	tbl := &Table{
		ID:              "standup_test",
		Config:          cfg,
		game:            game,
		players:         make(map[uint64]*PlayerConn),
		seats:           make(map[uint16]uint64),
		handStartStacks: make(map[uint16]int64),
		pendingStandUps: make(map[uint64]bool),
		broadcast:       func(uint64, []byte) {},
	}

	for chair := uint16(0); chair < 3; chair++ {
		userID := uint64(chair + 1)
		stack := int64(1000)
		if err := tbl.game.SitDown(chair, userID, stack, false); err != nil {
			t.Fatalf("SitDown chair=%d err: %v", chair, err)
		}
		tbl.players[userID] = &PlayerConn{
			UserID: userID,
			Chair:  chair,
			Stack:  stack,
			Online: true,
		}
		tbl.seats[chair] = userID
	}

	if err := tbl.game.StartHand(); err != nil {
		t.Fatalf("StartHand err: %v", err)
	}
	return tbl
}

func foldCurrentActor(t *testing.T, tbl *Table) (uint16, *holdem.SettlementResult) {
	t.Helper()

	snap := tbl.game.Snapshot()
	if snap.ActionChair == holdem.InvalidChair {
		t.Fatalf("expected valid action chair, got invalid")
	}
	chair := snap.ActionChair
	result, err := tbl.game.Act(chair, holdem.PlayerActionTypeFold, 0)
	if err != nil {
		t.Fatalf("Act fold chair=%d err: %v", chair, err)
	}
	return chair, result
}

func TestHandleStandUp_FoldedPlayerDuringHand_DeferredWithoutError(t *testing.T) {
	tbl := newStandUpTestTable(t)

	foldedChair, result := foldCurrentActor(t, tbl)
	if result != nil {
		t.Fatalf("expected hand to continue after first fold with 3 players")
	}
	userID := tbl.seats[foldedChair]
	if userID == 0 {
		t.Fatalf("no user seated at folded chair %d", foldedChair)
	}

	if err := tbl.handleStandUp(userID); err != nil {
		t.Fatalf("handleStandUp err: %v", err)
	}

	if !tbl.pendingStandUps[userID] {
		t.Fatalf("expected pending stand-up for user %d", userID)
	}
	if tbl.players[userID].Chair != foldedChair {
		t.Fatalf("expected chair to remain %d before hand end, got %d", foldedChair, tbl.players[userID].Chair)
	}
	if got := tbl.seats[foldedChair]; got != userID {
		t.Fatalf("expected seat %d to still map to user %d, got %d", foldedChair, userID, got)
	}
}

func TestHandleHandEnd_ProcessesDeferredStandUp(t *testing.T) {
	tbl := newStandUpTestTable(t)

	foldedChair, result := foldCurrentActor(t, tbl)
	if result != nil {
		t.Fatalf("expected hand to continue after first fold with 3 players")
	}
	userID := tbl.seats[foldedChair]
	if userID == 0 {
		t.Fatalf("no user seated at folded chair %d", foldedChair)
	}

	if err := tbl.handleStandUp(userID); err != nil {
		t.Fatalf("handleStandUp err: %v", err)
	}
	if !tbl.pendingStandUps[userID] {
		t.Fatalf("expected pending stand-up for user %d", userID)
	}

	var final *holdem.SettlementResult
	for i := 0; i < 8; i++ {
		_, endResult := foldCurrentActor(t, tbl)
		if endResult != nil {
			final = endResult
			break
		}
	}
	if final == nil {
		t.Fatalf("expected hand to end after forced folds")
	}

	tbl.handleHandEnd(final)

	if tbl.pendingStandUps[userID] {
		t.Fatalf("expected pending stand-up cleared for user %d", userID)
	}
	if tbl.players[userID].Chair != holdem.InvalidChair {
		t.Fatalf("expected user %d to be stood up, chair=%d", userID, tbl.players[userID].Chair)
	}
	if _, ok := tbl.seats[foldedChair]; ok {
		t.Fatalf("expected seat %d removed after deferred stand-up", foldedChair)
	}
}
