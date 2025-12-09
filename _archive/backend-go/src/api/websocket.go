package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"minecraft-platform/src/services"
)

// WebSocketManager handles WebSocket connections and real-time updates
type WebSocketManager struct {
	connections    map[string]*WebSocketConnection // connectionID -> connection
	tenantConns    map[string][]*WebSocketConnection // tenantID -> connections
	serverConns    map[string][]*WebSocketConnection // serverID -> connections
	mutex          sync.RWMutex
	upgrader       websocket.Upgrader
	metricsService *services.MetricsCollectorService
}

// WebSocketConnection represents a single WebSocket connection
type WebSocketConnection struct {
	ID        string
	TenantID  string
	ServerID  string // Optional: if subscribing to specific server
	Conn      *websocket.Conn
	Send      chan []byte
	Manager   *WebSocketManager
	Context   context.Context
	Cancel    context.CancelFunc
}

// WebSocketMessage represents a message sent over WebSocket
type WebSocketMessage struct {
	Type      string                 `json:"type"`
	Timestamp time.Time              `json:"timestamp"`
	TenantID  string                 `json:"tenant_id,omitempty"`
	ServerID  string                 `json:"server_id,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

// WebSocketSubscription represents a subscription request
type WebSocketSubscription struct {
	Type     string `json:"type"`     // "server_status", "metrics", "logs", "all"
	ServerID string `json:"server_id,omitempty"` // Optional: for server-specific subscriptions
}

// NewWebSocketManager creates a new WebSocket manager
func NewWebSocketManager(metricsService *services.MetricsCollectorService) *WebSocketManager {
	return &WebSocketManager{
		connections: make(map[string]*WebSocketConnection),
		tenantConns: make(map[string][]*WebSocketConnection),
		serverConns: make(map[string][]*WebSocketConnection),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				// In production, implement proper origin checking
				return true
			},
		},
		metricsService: metricsService,
	}
}

// RegisterRoutes registers WebSocket routes
func (wsm *WebSocketManager) RegisterRoutes(r *gin.Engine) {
	// WebSocket endpoint for real-time updates
	r.GET("/ws", wsm.HandleWebSocket)

	// HTTP endpoint to send messages to specific tenants/servers
	api := r.Group("/api")
	api.POST("/websocket/broadcast", wsm.BroadcastMessage)
}

// HandleWebSocket handles WebSocket upgrade and connection
func (wsm *WebSocketManager) HandleWebSocket(c *gin.Context) {
	// Extract tenant ID from query params or auth context
	tenantID := c.Query("tenant_id")
	if tenantID == "" {
		tenantID = c.GetString("tenant_id")
		if tenantID == "" {
			tenantID = "default-tenant" // Fallback for development
		}
	}

	serverID := c.Query("server_id") // Optional server-specific subscription

	// Upgrade HTTP connection to WebSocket
	conn, err := wsm.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "websocket_upgrade_failed",
			"message": err.Error(),
		})
		return
	}

	// Create WebSocket connection
	ctx, cancel := context.WithCancel(context.Background())
	wsConn := &WebSocketConnection{
		ID:       fmt.Sprintf("%s-%d", tenantID, time.Now().UnixNano()),
		TenantID: tenantID,
		ServerID: serverID,
		Conn:     conn,
		Send:     make(chan []byte, 256),
		Manager:  wsm,
		Context:  ctx,
		Cancel:   cancel,
	}

	// Register connection
	wsm.RegisterConnection(wsConn)

	// Start goroutines for handling connection
	go wsConn.HandleWrite()
	go wsConn.HandleRead()

	log.Printf("WebSocket connection established: %s (tenant: %s, server: %s)", wsConn.ID, tenantID, serverID)
}

// RegisterConnection registers a new WebSocket connection
func (wsm *WebSocketManager) RegisterConnection(conn *WebSocketConnection) {
	wsm.mutex.Lock()
	defer wsm.mutex.Unlock()

	// Add to connections map
	wsm.connections[conn.ID] = conn

	// Add to tenant connections
	wsm.tenantConns[conn.TenantID] = append(wsm.tenantConns[conn.TenantID], conn)

	// Add to server connections if server-specific
	if conn.ServerID != "" {
		wsm.serverConns[conn.ServerID] = append(wsm.serverConns[conn.ServerID], conn)
	}

	log.Printf("Registered WebSocket connection: %s (total: %d)", conn.ID, len(wsm.connections))
}

// UnregisterConnection removes a WebSocket connection
func (wsm *WebSocketManager) UnregisterConnection(conn *WebSocketConnection) {
	wsm.mutex.Lock()
	defer wsm.mutex.Unlock()

	// Remove from connections map
	delete(wsm.connections, conn.ID)

	// Remove from tenant connections
	if tenantConns, exists := wsm.tenantConns[conn.TenantID]; exists {
		for i, c := range tenantConns {
			if c.ID == conn.ID {
				wsm.tenantConns[conn.TenantID] = append(tenantConns[:i], tenantConns[i+1:]...)
				break
			}
		}
		// Clean up empty tenant slice
		if len(wsm.tenantConns[conn.TenantID]) == 0 {
			delete(wsm.tenantConns, conn.TenantID)
		}
	}

	// Remove from server connections
	if conn.ServerID != "" {
		if serverConns, exists := wsm.serverConns[conn.ServerID]; exists {
			for i, c := range serverConns {
				if c.ID == conn.ID {
					wsm.serverConns[conn.ServerID] = append(serverConns[:i], serverConns[i+1:]...)
					break
				}
			}
			// Clean up empty server slice
			if len(wsm.serverConns[conn.ServerID]) == 0 {
				delete(wsm.serverConns, conn.ServerID)
			}
		}
	}

	// Cancel context and close channel
	conn.Cancel()
	close(conn.Send)

	log.Printf("Unregistered WebSocket connection: %s (remaining: %d)", conn.ID, len(wsm.connections))
}

// HandleRead handles incoming WebSocket messages
func (conn *WebSocketConnection) HandleRead() {
	defer func() {
		conn.Manager.UnregisterConnection(conn)
		conn.Conn.Close()
	}()

	// Set read deadline and pong handler
	conn.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.Conn.SetPongHandler(func(string) error {
		conn.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		select {
		case <-conn.Context.Done():
			return
		default:
			_, message, err := conn.Conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket read error: %v", err)
				}
				return
			}

			// Handle subscription messages
			var subscription WebSocketSubscription
			if err := json.Unmarshal(message, &subscription); err == nil {
				conn.handleSubscription(&subscription)
			}
		}
	}
}

// HandleWrite handles outgoing WebSocket messages
func (conn *WebSocketConnection) HandleWrite() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		conn.Conn.Close()
	}()

	for {
		select {
		case <-conn.Context.Done():
			return
		case message, ok := <-conn.Send:
			conn.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				conn.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := conn.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}

		case <-ticker.C:
			// Send ping
			conn.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleSubscription processes subscription requests
func (conn *WebSocketConnection) handleSubscription(sub *WebSocketSubscription) {
	log.Printf("WebSocket subscription: %+v from connection %s", sub, conn.ID)

	// Update connection's server ID if subscribing to specific server
	if sub.ServerID != "" && conn.ServerID != sub.ServerID {
		conn.Manager.mutex.Lock()

		// Remove from old server connections if any
		if conn.ServerID != "" {
			if serverConns, exists := conn.Manager.serverConns[conn.ServerID]; exists {
				for i, c := range serverConns {
					if c.ID == conn.ID {
						conn.Manager.serverConns[conn.ServerID] = append(serverConns[:i], serverConns[i+1:]...)
						break
					}
				}
			}
		}

		// Add to new server connections
		conn.ServerID = sub.ServerID
		conn.Manager.serverConns[sub.ServerID] = append(conn.Manager.serverConns[sub.ServerID], conn)

		conn.Manager.mutex.Unlock()
	}

	// Send confirmation
	response := WebSocketMessage{
		Type:      "subscription_confirmed",
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"subscription_type": sub.Type,
			"server_id":        sub.ServerID,
		},
	}

	if data, err := json.Marshal(response); err == nil {
		select {
		case conn.Send <- data:
		default:
			log.Printf("Failed to send subscription confirmation to %s", conn.ID)
		}
	}
}

// BroadcastToTenant sends a message to all connections for a specific tenant
func (wsm *WebSocketManager) BroadcastToTenant(tenantID string, message WebSocketMessage) {
	wsm.mutex.RLock()
	connections := make([]*WebSocketConnection, len(wsm.tenantConns[tenantID]))
	copy(connections, wsm.tenantConns[tenantID])
	wsm.mutex.RUnlock()

	if data, err := json.Marshal(message); err == nil {
		for _, conn := range connections {
			select {
			case conn.Send <- data:
			default:
				log.Printf("Failed to send message to connection %s", conn.ID)
				wsm.UnregisterConnection(conn)
			}
		}
	}
}

// BroadcastToServer sends a message to all connections for a specific server
func (wsm *WebSocketManager) BroadcastToServer(serverID string, message WebSocketMessage) {
	wsm.mutex.RLock()
	connections := make([]*WebSocketConnection, len(wsm.serverConns[serverID]))
	copy(connections, wsm.serverConns[serverID])
	wsm.mutex.RUnlock()

	if data, err := json.Marshal(message); err == nil {
		for _, conn := range connections {
			select {
			case conn.Send <- data:
			default:
				log.Printf("Failed to send message to connection %s", conn.ID)
				wsm.UnregisterConnection(conn)
			}
		}
	}
}

// BroadcastMessage handles HTTP requests to broadcast messages
func (wsm *WebSocketManager) BroadcastMessage(c *gin.Context) {
	var request struct {
		Type     string                 `json:"type" binding:"required"`
		TenantID string                 `json:"tenant_id"`
		ServerID string                 `json:"server_id"`
		Data     map[string]interface{} `json:"data"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": err.Error(),
		})
		return
	}

	message := WebSocketMessage{
		Type:      request.Type,
		Timestamp: time.Now(),
		TenantID:  request.TenantID,
		ServerID:  request.ServerID,
		Data:      request.Data,
	}

	var sentCount int

	if request.ServerID != "" {
		wsm.BroadcastToServer(request.ServerID, message)
		wsm.mutex.RLock()
		sentCount = len(wsm.serverConns[request.ServerID])
		wsm.mutex.RUnlock()
	} else if request.TenantID != "" {
		wsm.BroadcastToTenant(request.TenantID, message)
		wsm.mutex.RLock()
		sentCount = len(wsm.tenantConns[request.TenantID])
		wsm.mutex.RUnlock()
	} else {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "Either tenant_id or server_id must be specified",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "Message broadcasted successfully",
		"connections":    sentCount,
		"message_type":   request.Type,
	})
}

// SendServerStatusUpdate sends a server status update to all relevant connections
func (wsm *WebSocketManager) SendServerStatusUpdate(serverID, tenantID, status, message string, metadata map[string]interface{}) {
	wsMessage := WebSocketMessage{
		Type:      "server_status_update",
		Timestamp: time.Now(),
		TenantID:  tenantID,
		ServerID:  serverID,
		Data: map[string]interface{}{
			"status":  status,
			"message": message,
			"metadata": metadata,
		},
	}

	// Send to server-specific connections
	wsm.BroadcastToServer(serverID, wsMessage)

	// Also send to tenant connections that are not server-specific
	wsm.mutex.RLock()
	for _, conn := range wsm.tenantConns[tenantID] {
		if conn.ServerID == "" { // Only to non-server-specific connections
			if data, err := json.Marshal(wsMessage); err == nil {
				select {
				case conn.Send <- data:
				default:
					log.Printf("Failed to send server status update to connection %s", conn.ID)
				}
			}
		}
	}
	wsm.mutex.RUnlock()
}

// SendMetricsUpdate sends metrics data to relevant connections
func (wsm *WebSocketManager) SendMetricsUpdate(serverID, tenantID string, metrics map[string]interface{}) {
	wsMessage := WebSocketMessage{
		Type:      "metrics_update",
		Timestamp: time.Now(),
		TenantID:  tenantID,
		ServerID:  serverID,
		Data:      metrics,
	}

	wsm.BroadcastToServer(serverID, wsMessage)
}

// SendLogUpdate sends log data to relevant connections
func (wsm *WebSocketManager) SendLogUpdate(serverID, tenantID string, logEntries []map[string]interface{}) {
	wsMessage := WebSocketMessage{
		Type:      "log_update",
		Timestamp: time.Now(),
		TenantID:  tenantID,
		ServerID:  serverID,
		Data: map[string]interface{}{
			"entries": logEntries,
		},
	}

	wsm.BroadcastToServer(serverID, wsMessage)
}

// StartMetricsStreaming starts streaming metrics data for active servers
func (wsm *WebSocketManager) StartMetricsStreaming(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second) // Stream metrics every 30 seconds
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			wsm.streamMetricsForActiveServers()
		}
	}
}

// streamMetricsForActiveServers streams metrics for all servers with active connections
func (wsm *WebSocketManager) streamMetricsForActiveServers() {
	wsm.mutex.RLock()
	serverIDs := make([]string, 0, len(wsm.serverConns))
	for serverID := range wsm.serverConns {
		if len(wsm.serverConns[serverID]) > 0 {
			serverIDs = append(serverIDs, serverID)
		}
	}
	wsm.mutex.RUnlock()

	// Stream metrics for each active server
	for _, serverID := range serverIDs {
		// TODO: Get actual metrics from metrics service
		// For now, send mock metrics
		metrics := map[string]interface{}{
			"cpu_usage":    45.2,
			"memory_usage": 78.5,
			"player_count": 12,
			"tps":         19.8,
			"timestamp":   time.Now(),
		}

		wsm.SendMetricsUpdate(serverID, "default-tenant", metrics)
	}
}

// GetConnectionStats returns statistics about WebSocket connections
func (wsm *WebSocketManager) GetConnectionStats() map[string]interface{} {
	wsm.mutex.RLock()
	defer wsm.mutex.RUnlock()

	return map[string]interface{}{
		"total_connections":  len(wsm.connections),
		"tenant_connections": len(wsm.tenantConns),
		"server_connections": len(wsm.serverConns),
		"active_tenants":     wsm.getActiveTenants(),
		"active_servers":     wsm.getActiveServers(),
	}
}

// getActiveTenants returns list of tenants with active connections
func (wsm *WebSocketManager) getActiveTenants() []string {
	tenants := make([]string, 0, len(wsm.tenantConns))
	for tenantID := range wsm.tenantConns {
		if len(wsm.tenantConns[tenantID]) > 0 {
			tenants = append(tenants, tenantID)
		}
	}
	return tenants
}

// getActiveServers returns list of servers with active connections
func (wsm *WebSocketManager) getActiveServers() []string {
	servers := make([]string, 0, len(wsm.serverConns))
	for serverID := range wsm.serverConns {
		if len(wsm.serverConns[serverID]) > 0 {
			servers = append(servers, serverID)
		}
	}
	return servers
}