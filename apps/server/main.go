package main

import (
	"log"
	"net/http"

	"holdem-lite/apps/server/internal/auth"
	"holdem-lite/apps/server/internal/gateway"
	"holdem-lite/apps/server/internal/ledger"
	"holdem-lite/apps/server/internal/lobby"
)

func main() {
	authService, authMode, err := auth.NewServiceFromEnv()
	if err != nil {
		log.Fatalf("[Server] Failed to init auth manager: %v", err)
	}
	defer authService.Close()
	ledgerService, ledgerMode, err := ledger.NewServiceFromEnv(authMode)
	if err != nil {
		log.Fatalf("[Server] Failed to init ledger service: %v", err)
	}
	defer ledgerService.Close()

	lby := lobby.New(ledgerService)
	gw := gateway.New(lby, authService)
	authHTTP := auth.NewHTTPHandler(authService)
	auditHTTP := ledger.NewHTTPHandler(authService, ledgerService)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", gw.HandleWebSocket)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	authHTTP.RegisterRoutes(mux)
	auditHTTP.RegisterRoutes(mux)

	addr := ":8080"
	log.Printf("[Server] Auth mode: %s", authMode)
	log.Printf("[Server] Ledger mode: %s", ledgerMode)
	log.Printf("[Server] Starting WebSocket server on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[Server] Failed to start: %v", err)
	}
}
