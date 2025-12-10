package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

// Event types for server lifecycle
const (
	EventServerCreated       = "server.created"
	EventServerUpdated       = "server.updated"
	EventServerDeleted       = "server.deleted"
	EventServerStatusChanged = "server.status.changed"
	EventServerMetrics       = "server.metrics"
	EventServerPlayerJoined  = "server.player.joined"
	EventServerPlayerLeft    = "server.player.left"

	// K8s-specific events (from operator)
	EventK8sResourceCreated = "k8s.resource.created"
	EventK8sResourceUpdated = "k8s.resource.updated"
	EventK8sResourceDeleted = "k8s.resource.deleted"
	EventK8sPodReady        = "k8s.pod.ready"
	EventK8sPodFailed       = "k8s.pod.failed"

	// Sync events
	EventSyncRequired = "sync.required"
	EventSyncComplete = "sync.complete"
)

// ServerEvent represents an event related to a Minecraft server
type ServerEvent struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	ServerID  string                 `json:"server_id"`
	TenantID  string                 `json:"tenant_id"`
	Timestamp time.Time              `json:"timestamp"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Source    string                 `json:"source"` // "api", "operator", "metrics"
}

// K8sStateEvent represents K8s state change from operator
type K8sStateEvent struct {
	Type              string    `json:"type"`
	ServerID          string    `json:"server_id"`
	TenantID          string    `json:"tenant_id"`
	Namespace         string    `json:"namespace"`
	ResourceName      string    `json:"resource_name"`
	Phase             string    `json:"phase"`             // Running, Starting, Stopped, Error
	Message           string    `json:"message"`
	ExternalIP        string    `json:"external_ip,omitempty"`
	ExternalPort      int       `json:"external_port,omitempty"`
	PlayerCount       int       `json:"player_count,omitempty"`
	ReadyReplicas     int32     `json:"ready_replicas"`
	DesiredReplicas   int32     `json:"desired_replicas"`
	Timestamp         time.Time `json:"timestamp"`
}

// EventHandler is a function that handles events
type EventHandler func(event *ServerEvent) error

// K8sStateHandler handles K8s state events
type K8sStateHandler func(event *K8sStateEvent) error

// EventBus provides pub/sub messaging using NATS
type EventBus struct {
	conn         *nats.Conn
	js           nats.JetStreamContext
	subscriptions []*nats.Subscription
	handlers     map[string][]EventHandler
	k8sHandlers  []K8sStateHandler
	mutex        sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
}

// EventBusConfig configuration for EventBus
type EventBusConfig struct {
	NATSUrl     string
	ClusterID   string
	ClientID    string
	StreamName  string
	RetryCount  int
	RetryDelay  time.Duration
}

// DefaultEventBusConfig returns default configuration
func DefaultEventBusConfig() *EventBusConfig {
	return &EventBusConfig{
		NATSUrl:    "nats://nats:4222",
		ClusterID:  "minecraft-platform",
		ClientID:   "minecraft-api",
		StreamName: "MINECRAFT_EVENTS",
		RetryCount: 5,
		RetryDelay: 2 * time.Second,
	}
}

// NewEventBus creates a new event bus with NATS connection
func NewEventBus(config *EventBusConfig) (*EventBus, error) {
	if config == nil {
		config = DefaultEventBusConfig()
	}

	ctx, cancel := context.WithCancel(context.Background())

	eb := &EventBus{
		handlers:    make(map[string][]EventHandler),
		k8sHandlers: make([]K8sStateHandler, 0),
		ctx:         ctx,
		cancel:      cancel,
	}

	// Connect to NATS with retry
	var conn *nats.Conn
	var err error

	for i := 0; i < config.RetryCount; i++ {
		conn, err = nats.Connect(config.NATSUrl,
			nats.Name(config.ClientID),
			nats.ReconnectWait(time.Second),
			nats.MaxReconnects(-1),
			nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
				log.Printf("NATS disconnected: %v", err)
			}),
			nats.ReconnectHandler(func(nc *nats.Conn) {
				log.Printf("NATS reconnected to %s", nc.ConnectedUrl())
			}),
			nats.ErrorHandler(func(nc *nats.Conn, sub *nats.Subscription, err error) {
				log.Printf("NATS error: %v", err)
			}),
		)
		if err == nil {
			break
		}
		log.Printf("Failed to connect to NATS (attempt %d/%d): %v", i+1, config.RetryCount, err)
		time.Sleep(config.RetryDelay)
	}

	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to connect to NATS after %d attempts: %w", config.RetryCount, err)
	}

	eb.conn = conn

	// Create JetStream context for persistent messaging
	js, err := conn.JetStream()
	if err != nil {
		conn.Close()
		cancel()
		return nil, fmt.Errorf("failed to create JetStream context: %w", err)
	}
	eb.js = js

	// Create or update stream for events
	_, err = js.AddStream(&nats.StreamConfig{
		Name:       config.StreamName,
		Subjects:   []string{"server.*", "k8s.*", "sync.*"},
		Retention:  nats.LimitsPolicy,
		MaxAge:     24 * time.Hour,
		MaxMsgs:    100000,
		Discard:    nats.DiscardOld,
		Storage:    nats.FileStorage,
		Replicas:   1,
	})
	if err != nil && err != nats.ErrStreamNameAlreadyInUse {
		log.Printf("Warning: Could not create/update stream: %v", err)
	}

	log.Printf("EventBus connected to NATS at %s", config.NATSUrl)
	return eb, nil
}

// Publish publishes a server event to the event bus
func (eb *EventBus) Publish(event *ServerEvent) error {
	if event.ID == "" {
		event.ID = fmt.Sprintf("%s-%d", event.Type, time.Now().UnixNano())
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	subject := event.Type
	_, err = eb.js.Publish(subject, data)
	if err != nil {
		return fmt.Errorf("failed to publish event: %w", err)
	}

	log.Printf("Published event: %s (server: %s)", event.Type, event.ServerID)
	return nil
}

// PublishK8sState publishes a K8s state event
func (eb *EventBus) PublishK8sState(event *K8sStateEvent) error {
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal K8s state event: %w", err)
	}

	subject := fmt.Sprintf("k8s.%s", event.Type)
	_, err = eb.js.Publish(subject, data)
	if err != nil {
		return fmt.Errorf("failed to publish K8s state event: %w", err)
	}

	log.Printf("Published K8s state: %s (server: %s, phase: %s)", event.Type, event.ServerID, event.Phase)
	return nil
}

// Subscribe subscribes to events of a specific type
func (eb *EventBus) Subscribe(eventType string, handler EventHandler) error {
	eb.mutex.Lock()
	defer eb.mutex.Unlock()

	eb.handlers[eventType] = append(eb.handlers[eventType], handler)

	// Create durable consumer for the event type
	sub, err := eb.js.Subscribe(eventType, func(msg *nats.Msg) {
		var event ServerEvent
		if err := json.Unmarshal(msg.Data, &event); err != nil {
			log.Printf("Failed to unmarshal event: %v", err)
			msg.Nak()
			return
		}

		eb.mutex.RLock()
		handlers := eb.handlers[eventType]
		eb.mutex.RUnlock()

		for _, h := range handlers {
			if err := h(&event); err != nil {
				log.Printf("Handler error for %s: %v", eventType, err)
			}
		}

		msg.Ack()
	}, nats.Durable(fmt.Sprintf("api-%s", eventType)), nats.ManualAck())

	if err != nil {
		return fmt.Errorf("failed to subscribe to %s: %w", eventType, err)
	}

	eb.subscriptions = append(eb.subscriptions, sub)
	log.Printf("Subscribed to event type: %s", eventType)
	return nil
}

// SubscribeK8sState subscribes to K8s state events
func (eb *EventBus) SubscribeK8sState(handler K8sStateHandler) error {
	eb.mutex.Lock()
	eb.k8sHandlers = append(eb.k8sHandlers, handler)
	eb.mutex.Unlock()

	// Subscribe to all K8s events
	sub, err := eb.js.Subscribe("k8s.*", func(msg *nats.Msg) {
		var event K8sStateEvent
		if err := json.Unmarshal(msg.Data, &event); err != nil {
			log.Printf("Failed to unmarshal K8s state event: %v", err)
			msg.Nak()
			return
		}

		eb.mutex.RLock()
		handlers := eb.k8sHandlers
		eb.mutex.RUnlock()

		for _, h := range handlers {
			if err := h(&event); err != nil {
				log.Printf("K8s state handler error: %v", err)
			}
		}

		msg.Ack()
	}, nats.Durable("api-k8s-state"), nats.ManualAck())

	if err != nil {
		return fmt.Errorf("failed to subscribe to K8s state events: %w", err)
	}

	eb.subscriptions = append(eb.subscriptions, sub)
	log.Printf("Subscribed to K8s state events")
	return nil
}

// Close closes the event bus connection
func (eb *EventBus) Close() error {
	eb.cancel()

	for _, sub := range eb.subscriptions {
		if err := sub.Unsubscribe(); err != nil {
			log.Printf("Failed to unsubscribe: %v", err)
		}
	}

	eb.conn.Close()
	log.Println("EventBus connection closed")
	return nil
}

// IsConnected returns true if connected to NATS
func (eb *EventBus) IsConnected() bool {
	return eb.conn != nil && eb.conn.IsConnected()
}

// PublishServerCreated publishes a server created event
func (eb *EventBus) PublishServerCreated(serverID, tenantID string, data map[string]interface{}) error {
	return eb.Publish(&ServerEvent{
		Type:      EventServerCreated,
		ServerID:  serverID,
		TenantID:  tenantID,
		Timestamp: time.Now(),
		Data:      data,
		Source:    "api",
	})
}

// PublishServerStatusChanged publishes a server status change event
func (eb *EventBus) PublishServerStatusChanged(serverID, tenantID, oldStatus, newStatus string) error {
	return eb.Publish(&ServerEvent{
		Type:      EventServerStatusChanged,
		ServerID:  serverID,
		TenantID:  tenantID,
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"old_status": oldStatus,
			"new_status": newStatus,
		},
		Source: "api",
	})
}

// PublishServerDeleted publishes a server deleted event
func (eb *EventBus) PublishServerDeleted(serverID, tenantID string) error {
	return eb.Publish(&ServerEvent{
		Type:      EventServerDeleted,
		ServerID:  serverID,
		TenantID:  tenantID,
		Timestamp: time.Now(),
		Source:    "api",
	})
}
