package replay

type WireReplayTape struct {
	TapeVersion int               `json:"tapeVersion"`
	TableID     string            `json:"tableId"`
	HeroChair   uint16            `json:"heroChair"`
	Events      []WireReplayEvent `json:"events"`
}

type WireReplayEvent struct {
	Type        string `json:"type"`
	Seq         uint64 `json:"seq"`
	EnvelopeB64 string `json:"envelopeB64"`
}

func ToWireReplayTape(tape *ReplayTape) *WireReplayTape {
	if tape == nil {
		return nil
	}
	out := &WireReplayTape{
		TapeVersion: tape.TapeVersion,
		TableID:     tape.TableID,
		HeroChair:   tape.HeroChair,
		Events:      make([]WireReplayEvent, 0, len(tape.Events)),
	}
	for _, e := range tape.Events {
		out.Events = append(out.Events, WireReplayEvent{
			Type:        e.Type,
			Seq:         e.Seq,
			EnvelopeB64: e.EnvelopeB64,
		})
	}
	return out
}
