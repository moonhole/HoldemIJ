package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"holdem-lite/apps/server/internal/auth"
	"holdem-lite/apps/server/internal/gateway"
	"holdem-lite/apps/server/internal/ledger"
	"holdem-lite/apps/server/internal/lobby"
	"holdem-lite/apps/server/internal/story"
	"holdem-lite/holdem/npc"
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
	storyService, storyMode, err := story.NewServiceFromEnv(authMode)
	if err != nil {
		log.Fatalf("[Server] Failed to init story service: %v", err)
	}
	defer storyService.Close()

	// Initialize NPC subsystem
	npcRegistry := npc.NewRegistry()
	personaPaths := []string{"data/npc_personas.json", "../../data/npc_personas.json"}
	personasLoaded := false
	for _, p := range personaPaths {
		if err := npcRegistry.LoadFromFile(p); err == nil {
			log.Printf("[Server] NPC personas loaded from %s: %d personas", p, npcRegistry.Count())
			personasLoaded = true
			break
		}
	}
	if !personasLoaded {
		log.Printf("[Server] NPC personas not found (non-fatal), tried: %v", personaPaths)
	}
	npcManager := npc.NewManager(npcRegistry)

	// Load story chapters
	chapterRegistry := npc.NewChapterRegistry()
	chapterPaths := []string{"data/story_chapters.json", "../../data/story_chapters.json"}
	for _, p := range chapterPaths {
		if err := chapterRegistry.LoadFromFile(p); err == nil {
			log.Printf("[Server] Story chapters loaded from %s: %d chapters", p, chapterRegistry.Count())
			break
		}
	}

	lby := lobby.New(ledgerService, storyService, npcManager)
	lby.SetChapterRegistry(chapterRegistry)
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

	addr := strings.TrimSpace(os.Getenv("SERVER_ADDR"))
	if addr == "" {
		addr = ":18080"
	}
	log.Printf("[Server] Auth mode: %s", authMode)
	log.Printf("[Server] Ledger mode: %s", ledgerMode)
	log.Printf("[Server] Story mode: %s", storyMode)
	log.Printf("[Server] Starting WebSocket server on %s", addr)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatalf("[Server] Failed to start: %v", err)
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
