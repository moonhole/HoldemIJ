// Package agent provides LLM-backed agent chat capabilities.
//
// Architecture notes:
//   - All LLM calls are proxied through the server (no direct frontend→LLM).
//   - Provider abstraction uses OpenAI-compatible chat completions protocol.
//   - Agent routing: each agent type (coach, rei, builder…) has its own
//     system prompt and context injection, sharing the same provider backend.
//   - BYOK / credits / subscription hooks are provided at the config level;
//     the current MVP uses a single server-side API key.
package agent

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// ProviderConfig holds the LLM provider connection settings.
// These are resolved from environment variables at startup.
type ProviderConfig struct {
	// BaseURL is the OpenAI-compatible API endpoint (e.g. "https://api.openai.com/v1").
	BaseURL string
	// APIKey is the default server-side API key.
	// When BYOK is implemented, per-user keys will override this.
	APIKey string
	// Model is the default model identifier (e.g. "gpt-4o-mini").
	Model string
	// MaxTokens caps the completion response length.
	MaxTokens int
	// Temperature controls randomness (0.0–2.0).
	Temperature float64
}

// DefaultProviderConfig returns a ProviderConfig populated from environment
// variables with sensible fallbacks.
//
// Environment variables:
//
//	AGENT_LLM_BASE_URL   – API endpoint           (default: https://api.openai.com/v1)
//	AGENT_LLM_API_KEY    – API key                 (required for real calls)
//	AGENT_LLM_MODEL      – Model name              (default: gpt-4o-mini)
//	AGENT_LLM_MAX_TOKENS – Max response tokens     (default: 1024)
//	AGENT_LLM_TEMPERATURE – Temperature            (default: 0.7)
func DefaultProviderConfig() ProviderConfig {
	baseURL := strings.TrimSpace(os.Getenv("AGENT_LLM_BASE_URL"))
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	baseURL = strings.TrimRight(baseURL, "/")

	apiKey := strings.TrimSpace(os.Getenv("AGENT_LLM_API_KEY"))

	model := strings.TrimSpace(os.Getenv("AGENT_LLM_MODEL"))
	if model == "" {
		model = "gpt-4o-mini"
	}

	maxTokens := 1024
	if raw := strings.TrimSpace(os.Getenv("AGENT_LLM_MAX_TOKENS")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			maxTokens = v
		}
	}

	temperature := 0.7
	if raw := strings.TrimSpace(os.Getenv("AGENT_LLM_TEMPERATURE")); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v >= 0 && v <= 2 {
			temperature = v
		}
	}

	return ProviderConfig{
		BaseURL:     baseURL,
		APIKey:      apiKey,
		Model:       model,
		MaxTokens:   maxTokens,
		Temperature: temperature,
	}
}

// Validate checks that the minimum required configuration is present.
func (c ProviderConfig) Validate() error {
	if c.APIKey == "" {
		return fmt.Errorf("AGENT_LLM_API_KEY is required")
	}
	return nil
}

// IsConfigured returns true if an API key is set (even if other defaults apply).
func (c ProviderConfig) IsConfigured() bool {
	return c.APIKey != ""
}
