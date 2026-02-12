package replay

import (
	"fmt"

	pb "holdem-lite/apps/server/gen"
)

type ReplayError struct {
	StepIndex int32          `json:"step_index"`
	Reason    string         `json:"reason"`
	Message   string         `json:"message"`
	Expected  *ExpectedState `json:"expected,omitempty"`
}

type ExpectedState struct {
	ActionChair  uint16          `json:"action_chair"`
	LegalActions []pb.ActionType `json:"legal_actions,omitempty"`
	MinRaiseTo   int64           `json:"min_raise_to,omitempty"`
	CallAmount   int64           `json:"call_amount,omitempty"`
	Phase        string          `json:"phase,omitempty"`
}

func (e *ReplayError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("replay error(step=%d reason=%s): %s", e.StepIndex, e.Reason, e.Message)
}
