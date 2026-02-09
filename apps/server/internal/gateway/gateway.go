package gateway

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	pb "holdem-lite/apps/server/gen"
	"holdem-lite/apps/server/internal/lobby"
	"holdem-lite/apps/server/internal/table"
	"holdem-lite/holdem"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // TODO: Restrict in production
	},
}

// Connection represents a WebSocket client connection
type Connection struct {
	ID       string
	UserID   uint32
	Conn     *websocket.Conn
	Send     chan []byte
	Gateway  *Gateway
	LastPing time.Time

	// Current table association
	TableID string
	Table   *table.Table
}

// Gateway manages WebSocket connections
type Gateway struct {
	mu          sync.RWMutex
	connections map[string]*Connection
	userConns   map[uint32]*Connection // userID -> connection
	nextConnID  uint64
	lobby       *lobby.Lobby
}

// New creates a new Gateway instance
func New(lby *lobby.Lobby) *Gateway {
	return &Gateway{
		connections: make(map[string]*Connection),
		userConns:   make(map[uint32]*Connection),
		lobby:       lby,
	}
}

// HandleWebSocket handles WebSocket upgrade and connection
func (g *Gateway) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Gateway] Upgrade error: %v", err)
		return
	}

	g.mu.Lock()
	g.nextConnID++
	connID := fmt.Sprintf("conn_%d", g.nextConnID)
	// For demo: assign userID based on connID (in production, use auth)
	userID := uint32(g.nextConnID)

	c := &Connection{
		ID:       connID,
		UserID:   userID,
		Conn:     conn,
		Send:     make(chan []byte, 256),
		Gateway:  g,
		LastPing: time.Now(),
	}
	g.connections[connID] = c
	g.userConns[userID] = c
	g.mu.Unlock()

	log.Printf("[Gateway] Client connected: %s (userID=%d), total: %d", connID, userID, len(g.connections))

	go c.readPump()
	go c.writePump()
}

func (c *Connection) readPump() {
	defer func() {
		c.Gateway.removeConnection(c)
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(65536)
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		c.LastPing = time.Now()
		return nil
	})

	for {
		messageType, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[Gateway] Read error: %v", err)
			}
			break
		}

		if messageType == websocket.BinaryMessage {
			c.handleMessage(message)
		}
	}
}

func (c *Connection) handleMessage(data []byte) {
	var env pb.ClientEnvelope
	if err := proto.Unmarshal(data, &env); err != nil {
		log.Printf("[Gateway] Failed to unmarshal: %v", err)
		c.sendError(1, "invalid message format")
		return
	}

	log.Printf("[Gateway] Received from user %d: table=%s, payload=%T", c.UserID, env.TableId, env.Payload)

	switch payload := env.Payload.(type) {
	case *pb.ClientEnvelope_JoinTable:
		c.handleJoinTable(&env, payload.JoinTable)
	case *pb.ClientEnvelope_SitDown:
		c.handleSitDown(&env, payload.SitDown)
	case *pb.ClientEnvelope_StandUp:
		c.handleStandUp(&env, payload.StandUp)
	case *pb.ClientEnvelope_Action:
		c.handleAction(&env, payload.Action)
	default:
		log.Printf("[Gateway] Unknown payload type: %T", env.Payload)
	}
}

func (c *Connection) handleJoinTable(env *pb.ClientEnvelope, req *pb.JoinTableRequest) {
	// Quick start: find or create a table
	t, err := c.Gateway.lobby.QuickStart(c.UserID, c.Gateway.broadcastToUser)
	if err != nil {
		c.sendError(2, err.Error())
		return
	}

	c.TableID = t.ID
	c.Table = t

	// Join the table
	t.SubmitEvent(table.Event{
		Type:   table.EventJoinTable,
		UserID: c.UserID,
	})

	log.Printf("[Gateway] User %d joined table %s", c.UserID, t.ID)
}

func (c *Connection) handleSitDown(env *pb.ClientEnvelope, req *pb.SitDownRequest) {
	if c.Table == nil {
		c.sendError(3, "not in a table")
		return
	}

	err := c.Table.SubmitEvent(table.Event{
		Type:   table.EventSitDown,
		UserID: c.UserID,
		Chair:  uint16(req.Chair),
		Amount: req.BuyInAmount,
	})
	if err != nil {
		c.sendError(4, err.Error())
	}
}

func (c *Connection) handleStandUp(env *pb.ClientEnvelope, req *pb.StandUpRequest) {
	if c.Table == nil {
		return
	}

	c.Table.SubmitEvent(table.Event{
		Type:   table.EventStandUp,
		UserID: c.UserID,
	})
}

func (c *Connection) handleAction(env *pb.ClientEnvelope, req *pb.ActionRequest) {
	if c.Table == nil {
		c.sendError(3, "not in a table")
		return
	}

	// Convert proto action to holdem action
	action := protoToAction(req.Action)

	err := c.Table.SubmitEvent(table.Event{
		Type:   table.EventAction,
		UserID: c.UserID,
		Action: action,
		Amount: req.Amount,
	})
	if err != nil {
		c.sendError(5, err.Error())
	}
}

func protoToAction(a pb.ActionType) holdem.ActionType {
	switch a {
	case pb.ActionType_ACTION_CHECK:
		return holdem.PlayerActionTypeCheck
	case pb.ActionType_ACTION_BET:
		return holdem.PlayerActionTypeBet
	case pb.ActionType_ACTION_CALL:
		return holdem.PlayerActionTypeCall
	case pb.ActionType_ACTION_RAISE:
		return holdem.PlayerActionTypeRaise
	case pb.ActionType_ACTION_FOLD:
		return holdem.PlayerActionTypeFold
	case pb.ActionType_ACTION_ALLIN:
		return holdem.PlayerActionTypeAllin
	default:
		return holdem.PlayerActionTypeNone
	}
}

func (c *Connection) sendError(code int32, msg string) {
	env := &pb.ServerEnvelope{
		TableId:    c.TableID,
		ServerSeq:  atomic.AddUint64(&c.Gateway.nextConnID, 1), // Use as simple seq
		ServerTsMs: time.Now().UnixMilli(),
		Payload: &pb.ServerEnvelope_Error{
			Error: &pb.ErrorResponse{
				Code:    code,
				Message: msg,
			},
		},
	}
	data, _ := proto.Marshal(env)
	c.Send <- data
}

func (c *Connection) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.Conn.WriteMessage(websocket.BinaryMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (g *Gateway) removeConnection(c *Connection) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.connections, c.ID)
	delete(g.userConns, c.UserID)
	log.Printf("[Gateway] Client disconnected: %s, total: %d", c.ID, len(g.connections))
}

// broadcastToUser sends a message to a specific user
func (g *Gateway) broadcastToUser(userID uint32, data []byte) {
	g.mu.RLock()
	c := g.userConns[userID]
	g.mu.RUnlock()

	if c != nil {
		select {
		case c.Send <- data:
		default:
			// Drop if buffer full
		}
	}
}

// Broadcast sends a message to all connections
func (g *Gateway) Broadcast(message []byte) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	for _, c := range g.connections {
		select {
		case c.Send <- message:
		default:
			// Drop message if buffer full
		}
	}
}
