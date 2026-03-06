package agent

import (
	"encoding/json"
	"log"
	"net/http"
)

// HTTPHandler handles LLM agent API requests.
type HTTPHandler struct {
	provider *Provider
}

// NewHTTPHandler creates a new HTTPHandler.
func NewHTTPHandler(provider *Provider) *HTTPHandler {
	return &HTTPHandler{
		provider: provider,
	}
}

// RegisterRoutes attaches the agent endpoints to the given mux.
func (h *HTTPHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/agent/chat", h.HandleChat)
}

// chatRequest is the expected JSON payload from the frontend.
type chatRequest struct {
	AgentKind AgentKind     `json:"agentKind"`
	Messages  []ChatMessage `json:"messages"` // The full conversation history
}

// HandleChat processes an incoming chat message and streams the response via SSE.
func (h *HTTPHandler) HandleChat(w http.ResponseWriter, r *http.Request) {
	// 1. Verify provider configuration
	if !h.provider.config.IsConfigured() {
		http.Error(w, `{"error":"Agent LLM provider is not configured"}`, http.StatusServiceUnavailable)
		return
	}

	// 2. Parse request
	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request JSON"}`, http.StatusBadRequest)
		return
	}
	if len(req.Messages) == 0 {
		http.Error(w, `{"error":"Messages array cannot be empty"}`, http.StatusBadRequest)
		return
	}

	// Provide a default agent kind if none specified
	if req.AgentKind == "" {
		req.AgentKind = AgentCoach
	}

	// 3. Build the final message list for the LLM
	// We inject the system prompt as the first message.
	systemMsg := ChatMessage{
		Role:    "system",
		Content: SystemPrompt(req.AgentKind),
	}

	// Create a new slice: [SystemPrompt, ...req.Messages]
	llmMessages := make([]ChatMessage, 0, len(req.Messages)+1)
	llmMessages = append(llmMessages, systemMsg)
	llmMessages = append(llmMessages, req.Messages...)

	// 4. Call the LLM and stream the response
	// The provider's StreamTo method sets the SSE headers and writes chunks directly to w.
	_, err := h.provider.StreamTo(w, llmMessages)
	if err != nil {
		log.Printf("[Agent] Stream error: %v", err)
		// Note: We cannot send an HTTP 500 here because the headers and some data
		// might have already been sent to the client as SSE.
		// The frontend must handle the interrupted stream appropriately.
	}
}
