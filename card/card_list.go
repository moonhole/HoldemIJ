package card

import "math/rand"

type CardList []Card

func (ds *CardList) Init(cards []Card) {
	*ds = make([]Card, len(cards))
	copy(*ds, cards)
}

// Count 获取总牌数
func (ds CardList) Count() int {
	return len(ds)
}

func (ds CardList) CardsBytes() []byte {
	return Cards2bytes(ds)
}

func (ds CardList) Shuffle() {
	rand.Shuffle(len(ds), func(i, j int) {
		ds[i], ds[j] = ds[j], ds[i]
	})
}

func (ds *CardList) Add(cards ...Card) {
	*ds = append(*ds, cards...)
}

func (ds *CardList) PopCard() Card {
	totalCount := ds.Count()
	if totalCount == 0 {
		return CardInvalid
	}
	card := (*ds)[totalCount-1]
	*ds = (*ds)[:totalCount-1]
	return card
}

func (ds *CardList) PopCards(size int) ([]Card, bool) {
	if size > ds.Count() {
		return nil, false
	}
	cards := make([]Card, size)
	copy(cards, (*ds)[:size])
	*ds = (*ds)[size:]
	return cards, true
}

