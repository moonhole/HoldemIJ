package main

import (
	"log"
	"net/http"

	"holdem-lite/apps/server/internal/gateway"
	"holdem-lite/apps/server/internal/lobby"
)

func main() {
	lby := lobby.New()
	gw := gateway.New(lby)

	http.HandleFunc("/ws", gw.HandleWebSocket)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	addr := ":8080"
	log.Printf("[Server] Starting WebSocket server on %s", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("[Server] Failed to start: %v", err)
	}
}
