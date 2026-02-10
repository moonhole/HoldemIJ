package holdem

import "holdem-lite/card"

type Player struct {
	ID    uint64
	Chair uint16
	Robot bool

	stack int64
	bet   int64

	allIn      bool
	folded     bool
	lastAction ActionType

	handCards card.CardList
	evalRes   *bestHandResult
}

func (p *Player) ChairID() uint16 { return p.Chair }
func (p *Player) IsRobot() bool   { return p.Robot }

func (p *Player) Stack() int64 { return p.stack }
func (p *Player) Bet() int64   { return p.bet }
func (p *Player) AllIn() bool  { return p.allIn }
func (p *Player) Folded() bool { return p.folded }
func (p *Player) Hand() []card.Card {
	return p.handCards
}

func (p *Player) ResetForNewHand() {
	p.bet = 0
	p.allIn = false
	p.folded = false
	p.lastAction = PlayerActionTypeNone
	p.handCards = make([]card.Card, 0, 2)
	p.evalRes = nil
}

func (p *Player) AddHandCard(cards ...card.Card) {
	p.handCards = append(p.handCards, cards...)
}

func (p *Player) SetHandCard(cards card.CardList) {
	p.handCards = cards
}

func (p *Player) HandCards() card.CardList { return p.handCards }

func (p *Player) setLastAction(a ActionType) { p.lastAction = a }
func (p *Player) getLastAction() ActionType  { return p.lastAction }

func (p *Player) placeBet(amount int64) {
	if amount <= 0 {
		return
	}
	if p.stack <= amount {
		p.allIn = true
		amount = p.stack
	}
	p.stack -= amount
	p.bet += amount
}

func (p *Player) addBet(amount int64) {
	p.bet += amount
}

func (p *Player) resetBet() {
	p.bet = 0
}

func (p *Player) addStack(amount int64) {
	p.stack += amount
}

func (p *Player) setFolded(v bool) { p.folded = v }

func (p *Player) setEvalResult(r *bestHandResult) { p.evalRes = r }
func (p *Player) getEvalResult() *bestHandResult  { return p.evalRes }

type PlayerNode struct {
	Player  *Player
	ChairID uint16
	Next    *PlayerNode
}

func (n *PlayerNode) getPlayer() *Player {
	if n == nil {
		return nil
	}
	return n.Player
}

func (n *PlayerNode) getChairID() uint16 {
	if n == nil {
		return 0
	}
	return n.ChairID
}

// WalkOnce 遍历链表一圈（可从任意 start 开始），支持 break。
// fn 返回 true 表示“找到/停止”，false 表示继续。
func (n *PlayerNode) WalkOnce(fn func(*PlayerNode) bool) *PlayerNode {
	if n == nil {
		return nil
	}
	cur := n
	for {
		if fn(cur) {
			return cur
		}
		cur = cur.Next
		if cur == nil || cur == n {
			break
		}
	}
	return nil
}

// WalkAll 遍历一圈，不中断
func (n *PlayerNode) WalkAll(fn func(cur *PlayerNode)) {
	n.WalkOnce(func(cur *PlayerNode) bool {
		fn(cur)
		return false
	})
}
