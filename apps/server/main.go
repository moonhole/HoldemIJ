package main

import (
	"log"
	"net/http"

	"holdem-lite/apps/server/internal/auth"
	"holdem-lite/apps/server/internal/gateway"
	"holdem-lite/apps/server/internal/lobby"
)

func main() {
	lby := lobby.New()
	authService, authMode, err := auth.NewServiceFromEnv()
	if err != nil {
		log.Fatalf("[Server] Failed to init auth manager: %v", err)
	}
	defer authService.Close()
	gw := gateway.New(lby, authService)
	authHTTP := auth.NewHTTPHandler(authService)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", gw.HandleWebSocket)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	authHTTP.RegisterRoutes(mux)

	addr := ":8080"
	log.Printf("[Server] Auth mode: %s", authMode)
	log.Printf("[Server] Starting WebSocket server on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[Server] Failed to start: %v", err)
	}
}
