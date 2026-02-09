package card

import (
	"fmt"
	"strings"
)

// Card 牌枚举
//
// 编码规则:
// - 高4位: 花色 (0:Spade, 1:Heart, 2:Club, 3:Diamond)
// - 低4位: 点数 (1:A, 2..9, 10:T, 11:J, 12:Q, 13:K)
type Card byte

func (c Card) String() string {
	if c == CardInvalid {
		return "Invalid"
	}
	if c == CardRear {
		return "Rear"
	}

	// Get suit and rank
	suit := Suit(c >> 4) // 高4位表示花色
	rank := c & 0x0F     // 低4位表示点数

	// Convert rank to string
	rankStr := ""
	switch rank {
	case 1:
		rankStr = "A"
	case 10:
		rankStr = "T"
	case 11:
		rankStr = "J"
	case 12:
		rankStr = "Q"
	case 13:
		rankStr = "K"
	default:
		rankStr = fmt.Sprintf("%d", rank)
	}

	return fmt.Sprintf("%s%s", suit, rankStr)
}

// Rank 获取牌面值 1-13 (A=1, K=13)
func (c Card) Rank() byte {
	if c == CardInvalid || c == CardRear {
		return 0
	}
	return byte(c & 0x0F) // Get low 4 bits
}

// Suit 花色 (0:Spades, 1:Hearts, 2:Clubs, 3:Diamonds)
func (c Card) Suit() Suit {
	return Suit(c >> 4)
}

func (c Card) IsAce() bool {
	return c.Rank() == 1
}

// HandRealVal 返回用于比较大小的点数:
// - A 视为 14
// - 其它为原始点数
func (c Card) HandRealVal() int {
	r := int(c & 0x0F)
	if r == 1 {
		return 14
	}
	return r
}

// ThdmStrToCard 将字符串 (如 "As", "Td", "10h") 转换为 Card 常量
func ThdmStrToCard(cardStr string) (Card, error) {
	if len(cardStr) < 2 {
		return 0, fmt.Errorf("invalid card string: %s", cardStr)
	}

	// 1. 解析花色 (取最后一个字符)
	suitChar := cardStr[len(cardStr)-1]
	var suitBase Card

	switch suitChar {
	case 's', 'S':
		suitBase = 0x00 // 黑桃
	case 'h', 'H':
		suitBase = 0x10 // 红心
	case 'c', 'C':
		suitBase = 0x20 // 梅花
	case 'd', 'D':
		suitBase = 0x30 // 方块
	default:
		return 0, fmt.Errorf("invalid suit: %c", suitChar)
	}

	// 2. 解析点数
	rankStr := cardStr[:len(cardStr)-1]
	var rankVal Card

	switch strings.ToUpper(rankStr) {
	case "A":
		rankVal = 0x01
	case "2":
		rankVal = 0x02
	case "3":
		rankVal = 0x03
	case "4":
		rankVal = 0x04
	case "5":
		rankVal = 0x05
	case "6":
		rankVal = 0x06
	case "7":
		rankVal = 0x07
	case "8":
		rankVal = 0x08
	case "9":
		rankVal = 0x09
	case "T", "10":
		rankVal = 0x0A
	case "J":
		rankVal = 0x0B
	case "Q":
		rankVal = 0x0C
	case "K":
		rankVal = 0x0D
	default:
		return 0, fmt.Errorf("invalid rank: %s", rankStr)
	}

	return suitBase + rankVal, nil
}

