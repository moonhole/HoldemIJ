package card

func Cards2bytes(cs []Card) []byte {
	out := make([]byte, 0, len(cs))
	for _, c := range cs {
		out = append(out, byte(c))
	}
	return out
}

