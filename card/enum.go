package card

const (
	CardInvalid Card = 0
	CardRear    Card = 0xFF
)

// Spade 黑桃
const (
	CardSpadeA Card = iota + 0x01
	CardSpade2
	CardSpade3
	CardSpade4
	CardSpade5
	CardSpade6
	CardSpade7
	CardSpade8
	CardSpade9
	CardSpadeT
	CardSpadeJ
	CardSpadeQ
	CardSpadeK
)

// Heart 红心
const (
	CardHeartA Card = iota + 0x11
	CardHeart2
	CardHeart3
	CardHeart4
	CardHeart5
	CardHeart6
	CardHeart7
	CardHeart8
	CardHeart9
	CardHeartT
	CardHeartJ
	CardHeartQ
	CardHeartK
)

// Club 梅花
const (
	CardClubA Card = iota + 0x21
	CardClub2
	CardClub3
	CardClub4
	CardClub5
	CardClub6
	CardClub7
	CardClub8
	CardClub9
	CardClubT
	CardClubJ
	CardClubQ
	CardClubK
)

// Diamond 方块
const (
	CardDiamondA Card = iota + 0x31
	CardDiamond2
	CardDiamond3
	CardDiamond4
	CardDiamond5
	CardDiamond6
	CardDiamond7
	CardDiamond8
	CardDiamond9
	CardDiamondT
	CardDiamondJ
	CardDiamondQ
	CardDiamondK
)

