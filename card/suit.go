package card

type Suit byte

const (
	Spade Suit = iota // ♠️
	Heart             // ♥️
	Club              // ♣️
	Diamond           // ♦️
)

func (s Suit) String() string {
	switch s {
	case Diamond:
		return "♦️"
	case Club:
		return "♣️"
	case Heart:
		return "♥️"
	case Spade:
		return "♠️"
	}
	return "?"
}

