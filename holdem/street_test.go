package holdem

import "testing"

// 这个用例覆盖一个非常关键的街推进规则：
// 3 人开局时，即便有人弃牌导致 activeCount 变成 2，Flop 首行动位仍应按“多人桌规则”
// 从 small blind 开始顺时针找第一个可行动玩家（对齐原始实现的 len(chairIDNodes)==2 判定）。
func TestStreetProgression_FlopFirstActionAfterBBFolds(t *testing.T) {
	g, err := NewGame(Config{
		MaxPlayers: 3,
		MinPlayers: 3,
		SmallBlind: 50,
		BigBlind:   100,
		Ante:       0,
		Seed:       1,
	})
	if err != nil {
		t.Fatalf("NewGame err: %v", err)
	}

	// 坐下 3 人
	if err := g.SitDown(0, 10001, 1000, false); err != nil {
		t.Fatal(err)
	}
	if err := g.SitDown(1, 10002, 1000, false); err != nil {
		t.Fatal(err)
	}
	if err := g.SitDown(2, 10003, 1000, false); err != nil {
		t.Fatal(err)
	}

	if err := g.StartHand(); err != nil {
		t.Fatalf("StartHand err: %v", err)
	}
	snap := g.Snapshot()
	if snap.Phase != PhaseTypePreflop {
		t.Fatalf("expected preflop, got %v", snap.Phase)
	}

	// Preflop：Dealer Call / SB Call / BB Fold
	for i := 0; i < 3; i++ {
		snap = g.Snapshot()
		switch snap.ActionChair {
		case snap.DealerChair:
			if _, err := g.Act(snap.ActionChair, PlayerActionTypeCall, snap.CurBet); err != nil {
				t.Fatalf("dealer call err: %v", err)
			}
		case snap.SmallBlindChair:
			if _, err := g.Act(snap.ActionChair, PlayerActionTypeCall, snap.CurBet); err != nil {
				t.Fatalf("sb call err: %v", err)
			}
		case snap.BigBlindChair:
			if _, err := g.Act(snap.ActionChair, PlayerActionTypeFold, 0); err != nil {
				t.Fatalf("bb fold err: %v", err)
			}
		default:
			t.Fatalf("unexpected action chair: %d", snap.ActionChair)
		}
	}

	// 进入 Flop：首行动位应是 Small Blind（如果 SB 未弃牌）
	snap = g.Snapshot()
	if snap.Phase != PhaseTypeFlop {
		t.Fatalf("expected flop, got %v", snap.Phase)
	}
	if len(snap.CommunityCards) != 3 {
		t.Fatalf("expected 3 community cards on flop, got %d", len(snap.CommunityCards))
	}
	if snap.ActionChair != snap.SmallBlindChair {
		t.Fatalf("expected flop action chair=SB(%d), got %d (dealer=%d bb=%d)",
			snap.SmallBlindChair, snap.ActionChair, snap.DealerChair, snap.BigBlindChair)
	}
}

