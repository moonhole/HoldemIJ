//go:build js && wasm

package main

import (
	"encoding/json"
	"errors"
	"syscall/js"

	"holdem-lite/replay"
)

type initRequest struct {
	Spec replay.HandSpec `json:"spec"`
}

type initResponse struct {
	OK    bool                   `json:"ok"`
	Tape  *replay.WireReplayTape `json:"tape,omitempty"`
	Error *replay.ReplayError    `json:"error,omitempty"`
}

func main() {
	js.Global().Set("__replayInit", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) < 1 {
			return mustJSON(initResponse{
				OK:    false,
				Error: &replay.ReplayError{StepIndex: -1, Reason: "invalid_request", Message: "missing request payload"},
			})
		}
		raw := args[0].String()
		resp := handleInit(raw)
		return mustJSON(resp)
	}))

	select {}
}

func handleInit(raw string) initResponse {
	var req initRequest
	if err := json.Unmarshal([]byte(raw), &req); err != nil {
		return initResponse{
			OK:    false,
			Error: &replay.ReplayError{StepIndex: -1, Reason: "invalid_json", Message: err.Error()},
		}
	}

	tape, err := replay.GenerateReplayTape(req.Spec)
	if err != nil {
		var replayErr *replay.ReplayError
		if errors.As(err, &replayErr) {
			return initResponse{OK: false, Error: replayErr}
		}
		return initResponse{
			OK:    false,
			Error: &replay.ReplayError{StepIndex: -1, Reason: "replay_generation_failed", Message: err.Error()},
		}
	}
	return initResponse{
		OK:   true,
		Tape: replay.ToWireReplayTape(tape),
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		fallback := initResponse{
			OK:    false,
			Error: &replay.ReplayError{StepIndex: -1, Reason: "marshal_failed", Message: err.Error()},
		}
		b2, _ := json.Marshal(fallback)
		return string(b2)
	}
	return string(b)
}
