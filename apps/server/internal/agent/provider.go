package agent

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// ChatMessage represents a single message in the conversation.
type ChatMessage struct {
	Role    string `json:"role"`    // "system", "user", or "assistant"
	Content string `json:"content"` // message text
}

// chatCompletionsRequest is the OpenAI-compatible request body.
type chatCompletionsRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Temperature float64       `json:"temperature"`
	Stream      bool          `json:"stream"`
}

// chatCompletionsChoice is a single choice in a non-streaming response.
type chatCompletionsChoice struct {
	Message ChatMessage `json:"message"`
}

// chatCompletionsResponse is the non-streaming response body.
type chatCompletionsResponse struct {
	Choices []chatCompletionsChoice `json:"choices"`
}

// streamDelta holds a partial content token.
type streamDelta struct {
	Content string `json:"content"`
}

// streamChoice holds one choice in a streaming chunk.
type streamChoice struct {
	Delta        streamDelta `json:"delta"`
	FinishReason *string     `json:"finish_reason"`
}

// streamChunk is one SSE data payload in the streaming response.
type streamChunk struct {
	Choices []streamChoice `json:"choices"`
}

// Provider calls an OpenAI-compatible chat completions API.
type Provider struct {
	config ProviderConfig
	client *http.Client
}

// NewProvider creates a Provider from the given config.
func NewProvider(cfg ProviderConfig) *Provider {
	return &Provider{
		config: cfg,
		client: &http.Client{},
	}
}

// Complete sends a non-streaming chat completions request and returns the
// assistant response.
func (p *Provider) Complete(messages []ChatMessage) (string, error) {
	body := chatCompletionsRequest{
		Model:       p.config.Model,
		Messages:    messages,
		MaxTokens:   p.config.MaxTokens,
		Temperature: p.config.Temperature,
		Stream:      false,
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", p.config.BaseURL+"/chat/completions", bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.config.APIKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("LLM API error %d: %s", resp.StatusCode, string(respBody))
	}

	var result chatCompletionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no choices in response")
	}
	return result.Choices[0].Message.Content, nil
}

// StreamTo sends a streaming chat completions request and writes each content
// token as an SSE event to w. The response is flushed after each token.
// Returns the full accumulated response text.
func (p *Provider) StreamTo(w http.ResponseWriter, messages []ChatMessage) (string, error) {
	body := chatCompletionsRequest{
		Model:       p.config.Model,
		Messages:    messages,
		MaxTokens:   p.config.MaxTokens,
		Temperature: p.config.Temperature,
		Stream:      true,
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", p.config.BaseURL+"/chat/completions", bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.config.APIKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("LLM API error %d: %s", resp.StatusCode, string(respBody))
	}

	// Set SSE headers for the client
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		return "", fmt.Errorf("streaming not supported")
	}

	var full strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			fmt.Fprintf(w, "data: [DONE]\n\n")
			flusher.Flush()
			break
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		for _, choice := range chunk.Choices {
			token := choice.Delta.Content
			if token == "" {
				continue
			}
			full.WriteString(token)

			// Forward the token as an SSE event to the client
			tokenJSON, _ := json.Marshal(map[string]string{"token": token})
			fmt.Fprintf(w, "data: %s\n\n", tokenJSON)
			flusher.Flush()
		}
	}

	return full.String(), scanner.Err()
}
