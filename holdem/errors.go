package holdem

import "errors"

var (
	ErrHandEnded  = errors.New("hand already ended")
	ErrOutOfTurn  = errors.New("action out of turn")
)

type InvalidStateError string

func (e InvalidStateError) Error() string { return "invalid state: " + string(e) }

func ErrInvalidState(msg string) error { return InvalidStateError(msg) }

