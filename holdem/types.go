package holdem

import (
	"time"

	"holdem-lite/card"
)

const InvalidChair uint16 = 65535

// Phase 游戏阶段
type Phase byte

const (
	PhaseTypeAnte     Phase = 0
	PhaseTypePreflop  Phase = 1
	PhaseTypeFlop     Phase = 2
	PhaseTypeTurn     Phase = 3
	PhaseTypeRiver    Phase = 4
	PhaseTypeShowdown Phase = 5
	PhaseTypeRoundEnd Phase = 6
)

var PhaseTypeDictionary = map[Phase]string{
	PhaseTypeAnte:     "ante",
	PhaseTypePreflop:  "preflop",
	PhaseTypeFlop:     "flop",
	PhaseTypeTurn:     "turn",
	PhaseTypeRiver:    "river",
	PhaseTypeShowdown: "showdown",
	PhaseTypeRoundEnd: "roundend",
}

// ActionType 动作类型：0-NONE 1-CHECK 2-BET 3-CALL 4-RAISE 5-FOLD 6-ALLIN
type ActionType byte

const (
	PlayerActionTypeNone  ActionType = 0
	PlayerActionTypeCheck ActionType = 1
	PlayerActionTypeBet   ActionType = 2
	PlayerActionTypeCall  ActionType = 3
	PlayerActionTypeRaise ActionType = 4
	PlayerActionTypeFold  ActionType = 5
	PlayerActionTypeAllin ActionType = 6
	PlayerActionTypeOther ActionType = 7
)

var PlayerActionTypeDictionary = map[ActionType]string{
	PlayerActionTypeNone:  "NONE",
	PlayerActionTypeCheck: "CHECK",
	PlayerActionTypeBet:   "BET",
	PlayerActionTypeCall:  "CALL",
	PlayerActionTypeRaise: "RAISE",
	PlayerActionTypeFold:  "FOLD",
	PlayerActionTypeAllin: "ALLIN",
	PlayerActionTypeOther: "OTHER",
}

const (
	nextActionTypeNextPlayer byte = 1 // 轮到下一个玩家操作
	nextActionTypeNonNext    byte = 2 // 没有操作（本轮已结束）
)

// 手牌常量定义
const (
	HandHighCard      byte = iota + 1 // 高牌
	HandOnePair                       // 一对
	HandTwoPair                       // 两对
	HandThreeOfKind                   // 三条
	HandStraight                      // 顺子
	HandFlush                         // 同花
	HandFullHouse                     // 葫芦
	HandFourOfKind                    // 四条
	HandStraightFlush                 // 同花顺
	HandRoyalFlush                    // 皇家同花顺（这里会作为同花顺的一种返回，保留常量位）
)

// Game time constants (optional)
const (
	autoRoundPlayTime time.Duration = 3 * time.Second
)

var HoldemCards = []card.Card{
	card.CardSpadeA, card.CardSpade2, card.CardSpade3, card.CardSpade4, card.CardSpade5, card.CardSpade6,
	card.CardSpade7, card.CardSpade8, card.CardSpade9, card.CardSpadeT, card.CardSpadeJ, card.CardSpadeQ, card.CardSpadeK,
	card.CardHeartA, card.CardHeart2, card.CardHeart3, card.CardHeart4, card.CardHeart5, card.CardHeart6,
	card.CardHeart7, card.CardHeart8, card.CardHeart9, card.CardHeartT, card.CardHeartJ, card.CardHeartQ, card.CardHeartK,
	card.CardClubA, card.CardClub2, card.CardClub3, card.CardClub4, card.CardClub5, card.CardClub6,
	card.CardClub7, card.CardClub8, card.CardClub9, card.CardClubT, card.CardClubJ, card.CardClubQ, card.CardClubK,
	card.CardDiamondA, card.CardDiamond2, card.CardDiamond3, card.CardDiamond4, card.CardDiamond5, card.CardDiamond6,
	card.CardDiamond7, card.CardDiamond8, card.CardDiamond9, card.CardDiamondT, card.CardDiamondJ, card.CardDiamondQ, card.CardDiamondK,
}

