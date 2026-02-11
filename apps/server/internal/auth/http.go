package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type HTTPHandler struct {
	manager Service
}

type credentialsRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type authResponse struct {
	UserID       uint64 `json:"user_id"`
	SessionToken string `json:"session_token"`
}

type meResponse struct {
	UserID   uint64 `json:"user_id"`
	Username string `json:"username"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func NewHTTPHandler(manager Service) *HTTPHandler {
	return &HTTPHandler{manager: manager}
}

func (h *HTTPHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/auth/register", h.handleRegister)
	mux.HandleFunc("/api/auth/login", h.handleLogin)
	mux.HandleFunc("/api/auth/logout", h.handleLogout)
	mux.HandleFunc("/api/auth/me", h.handleMe)
}

func (h *HTTPHandler) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req credentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	userID, sessionToken, err := h.manager.Register(req.Username, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidUsername), errors.Is(err, ErrInvalidPassword):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrUsernameTaken):
			writeError(w, http.StatusConflict, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "register failed")
		}
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		UserID:       userID,
		SessionToken: sessionToken,
	})
}

func (h *HTTPHandler) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req credentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	userID, sessionToken, err := h.manager.Login(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, "invalid username or password")
			return
		}
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		UserID:       userID,
		SessionToken: sessionToken,
	})
}

func (h *HTTPHandler) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	token := bearerToken(r.Header.Get("Authorization"))
	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing session token")
		return
	}

	h.manager.Logout(token)
	w.WriteHeader(http.StatusNoContent)
}

func (h *HTTPHandler) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	token := bearerToken(r.Header.Get("Authorization"))
	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing session token")
		return
	}

	userID, username, ok := h.manager.ResolveSession(token)
	if !ok {
		writeError(w, http.StatusUnauthorized, "invalid session token")
		return
	}

	writeJSON(w, http.StatusOK, meResponse{
		UserID:   userID,
		Username: username,
	})
}

func decodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(dst)
}

func bearerToken(raw string) string {
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
