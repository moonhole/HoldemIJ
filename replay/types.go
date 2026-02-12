package replay

import pb "holdem-lite/apps/server/gen"

type HandSpec struct {
	Variant     string       `json:"variant"`
	Table       TableSpec    `json:"table"`
	DealerChair uint16       `json:"dealer_chair"`
	Seats       []SeatSpec   `json:"seats"`
	Board       *BoardSpec   `json:"board,omitempty"`
	Deck        []string     `json:"deck,omitempty"`
	Actions     []ActionSpec `json:"actions"`
	RNG         *RNGSpec     `json:"rng,omitempty"`
}

type TableSpec struct {
	MaxPlayers uint16 `json:"max_players"`
	SB         int64  `json:"sb"`
	BB         int64  `json:"bb"`
	Ante       int64  `json:"ante"`
}

type SeatSpec struct {
	Chair  uint16   `json:"chair"`
	Name   string   `json:"name,omitempty"`
	UserID uint64   `json:"user_id,omitempty"`
	Stack  int64    `json:"stack"`
	IsHero bool     `json:"is_hero,omitempty"`
	Hole   []string `json:"hole,omitempty"`
}

type BoardSpec struct {
	Flop  []string `json:"flop,omitempty"`
	Turn  *string  `json:"turn,omitempty"`
	River *string  `json:"river,omitempty"`
}

type ActionSpec struct {
	Phase    string `json:"phase"`
	Chair    uint16 `json:"chair"`
	Type     string `json:"type"`
	AmountTo int64  `json:"amount_to"`
}

type RNGSpec struct {
	Seed int64 `json:"seed"`
}

type ReplayTape struct {
	TapeVersion int           `json:"tape_version"`
	TableID     string        `json:"table_id"`
	HeroChair   uint16        `json:"hero_chair"`
	Events      []ReplayEvent `json:"events"`
}

type ReplayEvent struct {
	Type        string             `json:"type"`
	Seq         uint64             `json:"seq"`
	Value       *pb.ServerEnvelope `json:"value,omitempty"`
	EnvelopeB64 string             `json:"envelope_b64,omitempty"`
}
