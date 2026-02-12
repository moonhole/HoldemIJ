package ledger

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"holdem-lite/apps/server/internal/auth"
)

type HTTPHandler struct {
	auth   auth.Service
	ledger Service
}

type errorResponse struct {
	Error string `json:"error"`
}

type upsertReplayHandRequest struct {
	Events  []EventItem    `json:"events"`
	Summary map[string]any `json:"summary"`
}

func NewHTTPHandler(authService auth.Service, ledgerService Service) *HTTPHandler {
	return &HTTPHandler{
		auth:   authService,
		ledger: ledgerService,
	}
}

func (h *HTTPHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/audit/live/recent", h.handleRecent(SourceLive))
	mux.HandleFunc("/api/audit/replay/recent", h.handleRecent(SourceReplay))
	mux.HandleFunc("/api/audit/live/hands/", h.handleHands(SourceLive))
	mux.HandleFunc("/api/audit/replay/hands/", h.handleHands(SourceReplay))
}

func (h *HTTPHandler) handleRecent(source Source) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		userID, ok := h.resolveUserID(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid session token")
			return
		}

		limit := parseLimit(r.URL.Query().Get("limit"))
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		items, err := h.ledger.ListRecent(ctx, userID, source, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "query recent hands failed")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"items": items,
		})
	}
}

func (h *HTTPHandler) handleHands(source Source) http.HandlerFunc {
	prefix := "/api/audit/" + string(source) + "/hands/"
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := h.resolveUserID(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid session token")
			return
		}

		path := strings.TrimPrefix(r.URL.Path, prefix)
		path = strings.TrimSpace(path)
		if path == "" {
			writeError(w, http.StatusNotFound, "not found")
			return
		}

		parts := strings.Split(path, "/")
		handID := strings.TrimSpace(parts[0])
		if handID == "" {
			writeError(w, http.StatusBadRequest, "missing hand id")
			return
		}

		if len(parts) == 1 {
			if source == SourceReplay && r.Method == http.MethodPost {
				h.handleUpsertReplayHand(w, r, userID, handID)
				return
			}
			if r.Method != http.MethodGet {
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			h.handleGetHand(w, r, userID, source, handID)
			return
		}

		if len(parts) == 2 && parts[1] == "save" {
			switch r.Method {
			case http.MethodPost:
				h.handleSetSaved(w, r, userID, source, handID, true)
			case http.MethodDelete:
				h.handleSetSaved(w, r, userID, source, handID, false)
			default:
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			}
			return
		}

		writeError(w, http.StatusNotFound, "not found")
	}
}

func (h *HTTPHandler) handleGetHand(w http.ResponseWriter, r *http.Request, userID uint64, source Source, handID string) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	events, err := h.ledger.GetHandEvents(ctx, userID, source, handID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusNotFound, "hand not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "query hand events failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hand_id": handID,
		"source":  source,
		"events":  events,
	})
}

func (h *HTTPHandler) handleSetSaved(w http.ResponseWriter, r *http.Request, userID uint64, source Source, handID string, saved bool) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	err := h.ledger.SetSaved(ctx, userID, source, handID, saved)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			writeError(w, http.StatusNotFound, "hand not found")
		case errors.Is(err, ErrSavedLimitReach):
			writeError(w, http.StatusConflict, "saved hand limit reached")
		default:
			writeError(w, http.StatusInternalServerError, "update save state failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hand_id":  handID,
		"source":   source,
		"is_saved": saved,
	})
}

func (h *HTTPHandler) handleUpsertReplayHand(w http.ResponseWriter, r *http.Request, userID uint64, handID string) {
	var req upsertReplayHandRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if err := h.ledger.UpsertReplayHand(ctx, userID, handID, req.Events, req.Summary); err != nil {
		writeError(w, http.StatusInternalServerError, "upsert replay hand failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hand_id": handID,
		"source":  SourceReplay,
		"saved":   true,
	})
}

func (h *HTTPHandler) resolveUserID(r *http.Request) (uint64, bool) {
	token := bearerToken(r.Header.Get("Authorization"))
	if token == "" {
		return 0, false
	}
	userID, _, ok := h.auth.ResolveSession(token)
	if !ok {
		return 0, false
	}
	return userID, true
}

func parseLimit(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 20
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 20
	}
	if n > 100 {
		return 100
	}
	return n
}

func bearerToken(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(raw, "Bearer "))
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorResponse{Error: msg})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
