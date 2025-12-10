package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"minecraft-platform/src/events"
	"minecraft-platform/src/models"
)

// SyncService maintains consistency between DB and K8s state
type SyncService struct {
	db              *sql.DB
	eventBus        *events.EventBus
	wsManager       WebSocketBroadcaster
	reconcileQueue  chan string // serverIDs that need reconciliation
	mutex           sync.RWMutex
	serverCache     map[string]*CachedServerState
	ctx             context.Context
	cancel          context.CancelFunc
}

// CachedServerState holds recent server state for quick access
type CachedServerState struct {
	ServerID     string
	TenantID     string
	DBStatus     string
	K8sPhase     string
	ExternalIP   string
	ExternalPort int
	PlayerCount  int
	LastSyncedAt time.Time
	IsSynced     bool
}

// WebSocketBroadcaster interface for broadcasting to WebSocket clients
type WebSocketBroadcaster interface {
	SendServerStatusUpdate(serverID, tenantID, status, message string, metadata map[string]interface{})
	SendMetricsUpdate(serverID, tenantID string, metrics map[string]interface{})
}

// SyncServiceConfig configuration for SyncService
type SyncServiceConfig struct {
	ReconcileInterval   time.Duration
	SyncTimeout         time.Duration
	CacheExpiry         time.Duration
	ReconcileQueueSize  int
}

// DefaultSyncServiceConfig returns default configuration
func DefaultSyncServiceConfig() *SyncServiceConfig {
	return &SyncServiceConfig{
		ReconcileInterval:  30 * time.Second,
		SyncTimeout:        10 * time.Second,
		CacheExpiry:        5 * time.Minute,
		ReconcileQueueSize: 100,
	}
}

// NewSyncService creates a new sync service
func NewSyncService(db *sql.DB, eventBus *events.EventBus, wsManager WebSocketBroadcaster, config *SyncServiceConfig) *SyncService {
	if config == nil {
		config = DefaultSyncServiceConfig()
	}

	ctx, cancel := context.WithCancel(context.Background())

	ss := &SyncService{
		db:             db,
		eventBus:       eventBus,
		wsManager:      wsManager,
		reconcileQueue: make(chan string, config.ReconcileQueueSize),
		serverCache:    make(map[string]*CachedServerState),
		ctx:            ctx,
		cancel:         cancel,
	}

	return ss
}

// Start starts the sync service
func (ss *SyncService) Start() error {
	// Subscribe to K8s state events from operator
	if err := ss.eventBus.SubscribeK8sState(ss.handleK8sStateEvent); err != nil {
		return fmt.Errorf("failed to subscribe to K8s state events: %w", err)
	}

	// Subscribe to server events from API
	eventTypes := []string{
		events.EventServerCreated,
		events.EventServerUpdated,
		events.EventServerDeleted,
		events.EventServerStatusChanged,
	}

	for _, eventType := range eventTypes {
		if err := ss.eventBus.Subscribe(eventType, ss.handleServerEvent); err != nil {
			return fmt.Errorf("failed to subscribe to %s: %w", eventType, err)
		}
	}

	// Start background reconciliation loop
	go ss.reconcileLoop()

	// Start reconcile queue processor
	go ss.processReconcileQueue()

	log.Println("SyncService started")
	return nil
}

// Stop stops the sync service
func (ss *SyncService) Stop() {
	ss.cancel()
	close(ss.reconcileQueue)
	log.Println("SyncService stopped")
}

// handleK8sStateEvent handles state updates from the K8s operator
func (ss *SyncService) handleK8sStateEvent(event *events.K8sStateEvent) error {
	log.Printf("Received K8s state event: server=%s, phase=%s", event.ServerID, event.Phase)

	// Update cache
	ss.updateCache(event)

	// Sync to database
	if err := ss.syncK8sStateToDatabase(event); err != nil {
		log.Printf("Failed to sync K8s state to DB: %v", err)
		// Queue for reconciliation
		ss.queueReconcile(event.ServerID)
		return err
	}

	// Broadcast to WebSocket clients
	ss.broadcastStateChange(event)

	return nil
}

// handleServerEvent handles events from the API
func (ss *SyncService) handleServerEvent(event *events.ServerEvent) error {
	log.Printf("Received server event: type=%s, server=%s", event.Type, event.ServerID)

	switch event.Type {
	case events.EventServerCreated:
		// Server created in DB, K8s resource will be created by API
		ss.updateCacheFromAPIEvent(event)

	case events.EventServerStatusChanged:
		// Status changed via API (e.g., start/stop request)
		// The operator will pick this up and update the actual state
		ss.updateCacheFromAPIEvent(event)

	case events.EventServerDeleted:
		// Server deleted, remove from cache
		ss.removeFromCache(event.ServerID)
	}

	return nil
}

// syncK8sStateToDatabase syncs K8s state to the database
func (ss *SyncService) syncK8sStateToDatabase(event *events.K8sStateEvent) error {
	ctx, cancel := context.WithTimeout(ss.ctx, 10*time.Second)
	defer cancel()

	// Map K8s phase to DB status
	dbStatus := ss.mapK8sPhaseToDBStatus(event.Phase)

	// Build update query
	query := `
		UPDATE server_instances
		SET status = $1,
		    current_players = $2,
		    updated_at = NOW()
		WHERE id = $3
	`

	result, err := ss.db.ExecContext(ctx, query, dbStatus, event.PlayerCount, event.ServerID)
	if err != nil {
		return fmt.Errorf("failed to update server status: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("server not found in database: %s", event.ServerID)
	}

	log.Printf("Synced K8s state to DB: server=%s, status=%s, players=%d",
		event.ServerID, dbStatus, event.PlayerCount)
	return nil
}

// mapK8sPhaseToDBStatus maps K8s phase to DB status
func (ss *SyncService) mapK8sPhaseToDBStatus(phase string) models.ServerStatus {
	switch phase {
	case "Running":
		return models.ServerStatusRunning
	case "Starting":
		return models.ServerStatusDeploying
	case "Stopped":
		return models.ServerStatusStopped
	case "Error", "Failed":
		return models.ServerStatusFailed
	default:
		return models.ServerStatusDeploying
	}
}

// broadcastStateChange broadcasts state change to WebSocket clients
func (ss *SyncService) broadcastStateChange(event *events.K8sStateEvent) {
	if ss.wsManager == nil {
		return
	}

	metadata := map[string]interface{}{
		"external_ip":     event.ExternalIP,
		"external_port":   event.ExternalPort,
		"player_count":    event.PlayerCount,
		"ready_replicas":  event.ReadyReplicas,
		"desired_replicas": event.DesiredReplicas,
	}

	ss.wsManager.SendServerStatusUpdate(
		event.ServerID,
		event.TenantID,
		event.Phase,
		event.Message,
		metadata,
	)
}

// updateCache updates the server state cache
func (ss *SyncService) updateCache(event *events.K8sStateEvent) {
	ss.mutex.Lock()
	defer ss.mutex.Unlock()

	state, exists := ss.serverCache[event.ServerID]
	if !exists {
		state = &CachedServerState{
			ServerID: event.ServerID,
			TenantID: event.TenantID,
		}
		ss.serverCache[event.ServerID] = state
	}

	state.K8sPhase = event.Phase
	state.ExternalIP = event.ExternalIP
	state.ExternalPort = event.ExternalPort
	state.PlayerCount = event.PlayerCount
	state.LastSyncedAt = time.Now()
	state.IsSynced = true
}

// updateCacheFromAPIEvent updates cache from API event
func (ss *SyncService) updateCacheFromAPIEvent(event *events.ServerEvent) {
	ss.mutex.Lock()
	defer ss.mutex.Unlock()

	state, exists := ss.serverCache[event.ServerID]
	if !exists {
		state = &CachedServerState{
			ServerID: event.ServerID,
			TenantID: event.TenantID,
		}
		ss.serverCache[event.ServerID] = state
	}

	if newStatus, ok := event.Data["new_status"].(string); ok {
		state.DBStatus = newStatus
	}
	state.LastSyncedAt = time.Now()
}

// removeFromCache removes server from cache
func (ss *SyncService) removeFromCache(serverID string) {
	ss.mutex.Lock()
	defer ss.mutex.Unlock()
	delete(ss.serverCache, serverID)
}

// queueReconcile queues a server for reconciliation
func (ss *SyncService) queueReconcile(serverID string) {
	select {
	case ss.reconcileQueue <- serverID:
	default:
		log.Printf("Reconcile queue full, dropping server: %s", serverID)
	}
}

// reconcileLoop periodically reconciles all servers
func (ss *SyncService) reconcileLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ss.ctx.Done():
			return
		case <-ticker.C:
			ss.reconcileAllServers()
		}
	}
}

// processReconcileQueue processes the reconcile queue
func (ss *SyncService) processReconcileQueue() {
	for {
		select {
		case <-ss.ctx.Done():
			return
		case serverID, ok := <-ss.reconcileQueue:
			if !ok {
				return
			}
			if err := ss.reconcileServer(serverID); err != nil {
				log.Printf("Reconcile failed for %s: %v", serverID, err)
			}
		}
	}
}

// reconcileAllServers reconciles all servers
func (ss *SyncService) reconcileAllServers() {
	ctx, cancel := context.WithTimeout(ss.ctx, 30*time.Second)
	defer cancel()

	// Get all active servers from DB
	query := `SELECT id FROM server_instances WHERE status NOT IN ('terminating')`
	rows, err := ss.db.QueryContext(ctx, query)
	if err != nil {
		log.Printf("Failed to query servers for reconciliation: %v", err)
		return
	}
	defer rows.Close()

	var serverIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		serverIDs = append(serverIDs, id)
	}

	log.Printf("Reconciling %d servers", len(serverIDs))

	for _, id := range serverIDs {
		if err := ss.reconcileServer(id); err != nil {
			log.Printf("Reconcile error for %s: %v", id, err)
		}
	}
}

// reconcileServer reconciles a single server
func (ss *SyncService) reconcileServer(serverID string) error {
	ss.mutex.RLock()
	cached, exists := ss.serverCache[serverID]
	ss.mutex.RUnlock()

	if !exists {
		// No cached state, request sync from operator
		return ss.requestSyncFromOperator(serverID)
	}

	// Check if states are in sync
	if cached.DBStatus != "" && cached.K8sPhase != "" {
		expectedDBStatus := string(ss.mapK8sPhaseToDBStatus(cached.K8sPhase))
		if cached.DBStatus != expectedDBStatus {
			log.Printf("State mismatch for %s: DB=%s, K8s=%s", serverID, cached.DBStatus, cached.K8sPhase)
			// K8s is source of truth for running state
			return ss.syncK8sStateToDatabase(&events.K8sStateEvent{
				ServerID:    serverID,
				TenantID:    cached.TenantID,
				Phase:       cached.K8sPhase,
				PlayerCount: cached.PlayerCount,
			})
		}
	}

	return nil
}

// requestSyncFromOperator publishes event to request sync from operator
func (ss *SyncService) requestSyncFromOperator(serverID string) error {
	return ss.eventBus.Publish(&events.ServerEvent{
		Type:      events.EventSyncRequired,
		ServerID:  serverID,
		Timestamp: time.Now(),
		Source:    "sync-service",
	})
}

// GetServerState returns the current cached state for a server
func (ss *SyncService) GetServerState(serverID string) (*CachedServerState, bool) {
	ss.mutex.RLock()
	defer ss.mutex.RUnlock()
	state, exists := ss.serverCache[serverID]
	if !exists {
		return nil, false
	}
	// Return a copy
	stateCopy := *state
	return &stateCopy, true
}

// GetAllServerStates returns all cached server states
func (ss *SyncService) GetAllServerStates() []*CachedServerState {
	ss.mutex.RLock()
	defer ss.mutex.RUnlock()

	states := make([]*CachedServerState, 0, len(ss.serverCache))
	for _, state := range ss.serverCache {
		stateCopy := *state
		states = append(states, &stateCopy)
	}
	return states
}

// HealthCheck returns sync service health status
func (ss *SyncService) HealthCheck() map[string]interface{} {
	ss.mutex.RLock()
	cachedCount := len(ss.serverCache)
	ss.mutex.RUnlock()

	return map[string]interface{}{
		"status":           "healthy",
		"cached_servers":   cachedCount,
		"queue_size":       len(ss.reconcileQueue),
		"event_bus_connected": ss.eventBus.IsConnected(),
	}
}

// SyncServerFromDB creates a K8s resource from DB state (for initial deployment)
func (ss *SyncService) SyncServerFromDB(ctx context.Context, serverID uuid.UUID) error {
	// Query server from DB
	query := `
		SELECT id, tenant_id, name, minecraft_version, resource_limits,
		       server_properties, kubernetes_namespace, max_players
		FROM server_instances WHERE id = $1
	`

	var server struct {
		ID                  string
		TenantID            string
		Name                string
		MinecraftVersion    string
		ResourceLimits      json.RawMessage
		ServerProperties    json.RawMessage
		KubernetesNamespace string
		MaxPlayers          int
	}

	err := ss.db.QueryRowContext(ctx, query, serverID).Scan(
		&server.ID,
		&server.TenantID,
		&server.Name,
		&server.MinecraftVersion,
		&server.ResourceLimits,
		&server.ServerProperties,
		&server.KubernetesNamespace,
		&server.MaxPlayers,
	)
	if err != nil {
		return fmt.Errorf("failed to query server: %w", err)
	}

	// Publish event for operator to create K8s resource
	return ss.eventBus.Publish(&events.ServerEvent{
		Type:      events.EventServerCreated,
		ServerID:  server.ID,
		TenantID:  server.TenantID,
		Timestamp: time.Now(),
		Source:    "sync-service",
		Data: map[string]interface{}{
			"name":                 server.Name,
			"minecraft_version":   server.MinecraftVersion,
			"resource_limits":     server.ResourceLimits,
			"server_properties":   server.ServerProperties,
			"kubernetes_namespace": server.KubernetesNamespace,
			"max_players":         server.MaxPlayers,
		},
	})
}
