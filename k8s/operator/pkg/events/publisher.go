package events

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

// K8sStateEvent represents K8s state change to publish
type K8sStateEvent struct {
	Type            string    `json:"type"`
	ServerID        string    `json:"server_id"`
	TenantID        string    `json:"tenant_id"`
	Namespace       string    `json:"namespace"`
	ResourceName    string    `json:"resource_name"`
	Phase           string    `json:"phase"`
	Message         string    `json:"message"`
	ExternalIP      string    `json:"external_ip,omitempty"`
	ExternalPort    int       `json:"external_port,omitempty"`
	PlayerCount     int       `json:"player_count,omitempty"`
	ReadyReplicas   int32     `json:"ready_replicas"`
	DesiredReplicas int32     `json:"desired_replicas"`
	Timestamp       time.Time `json:"timestamp"`
}

// EventPublisher publishes events to NATS
type EventPublisher struct {
	conn     *nats.Conn
	js       nats.JetStreamContext
	natsURL  string
	enabled  bool
}

// EventPublisherConfig configuration for event publisher
type EventPublisherConfig struct {
	NATSUrl    string
	StreamName string
	Enabled    bool
}

// DefaultConfig returns default configuration
func DefaultConfig() *EventPublisherConfig {
	return &EventPublisherConfig{
		NATSUrl:    "nats://nats.minecraft-system:4222",
		StreamName: "MINECRAFT_EVENTS",
		Enabled:    true,
	}
}

// NewEventPublisher creates a new event publisher
func NewEventPublisher(config *EventPublisherConfig) (*EventPublisher, error) {
	if config == nil {
		config = DefaultConfig()
	}

	if !config.Enabled {
		log.Println("EventPublisher disabled, events will not be published")
		return &EventPublisher{enabled: false, natsURL: config.NATSUrl}, nil
	}

	// Connect to NATS
	conn, err := nats.Connect(config.NATSUrl,
		nats.Name("minecraft-operator"),
		nats.ReconnectWait(time.Second),
		nats.MaxReconnects(-1),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Printf("Operator NATS disconnected: %v", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("Operator NATS reconnected to %s", nc.ConnectedUrl())
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	// Create JetStream context
	js, err := conn.JetStream()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to create JetStream context: %w", err)
	}

	// Create stream if it doesn't exist
	_, err = js.AddStream(&nats.StreamConfig{
		Name:       config.StreamName,
		Subjects:   []string{"server.*", "k8s.*", "sync.*"},
		Retention:  nats.LimitsPolicy,
		MaxAge:     24 * time.Hour,
		MaxMsgs:    100000,
		Storage:    nats.FileStorage,
	})
	if err != nil && err != nats.ErrStreamNameAlreadyInUse {
		log.Printf("Warning: Could not create stream: %v (may already exist)", err)
	}

	log.Printf("EventPublisher connected to NATS at %s", config.NATSUrl)
	return &EventPublisher{
		conn:    conn,
		js:      js,
		natsURL: config.NATSUrl,
		enabled: true,
	}, nil
}

// PublishStateChange publishes a K8s state change event
func (ep *EventPublisher) PublishStateChange(event *K8sStateEvent) error {
	if !ep.enabled || ep.conn == nil {
		return nil // Silently skip if disabled
	}

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	subject := fmt.Sprintf("k8s.%s", event.Type)
	_, err = ep.js.Publish(subject, data)
	if err != nil {
		return fmt.Errorf("failed to publish event: %w", err)
	}

	log.Printf("Published state change: %s (server: %s, phase: %s)", event.Type, event.ServerID, event.Phase)
	return nil
}

// PublishServerStarting publishes a server starting event
func (ep *EventPublisher) PublishServerStarting(serverID, tenantID, namespace, resourceName string) error {
	return ep.PublishStateChange(&K8sStateEvent{
		Type:         "starting",
		ServerID:     serverID,
		TenantID:     tenantID,
		Namespace:    namespace,
		ResourceName: resourceName,
		Phase:        "Starting",
		Message:      "Server is starting up",
		Timestamp:    time.Now(),
	})
}

// PublishServerRunning publishes a server running event
func (ep *EventPublisher) PublishServerRunning(serverID, tenantID, namespace string, externalIP string, port int, readyReplicas, desiredReplicas int32) error {
	return ep.PublishStateChange(&K8sStateEvent{
		Type:            "running",
		ServerID:        serverID,
		TenantID:        tenantID,
		Namespace:       namespace,
		Phase:           "Running",
		Message:         "Server is running and ready",
		ExternalIP:      externalIP,
		ExternalPort:    port,
		ReadyReplicas:   readyReplicas,
		DesiredReplicas: desiredReplicas,
		Timestamp:       time.Now(),
	})
}

// PublishServerStopped publishes a server stopped event
func (ep *EventPublisher) PublishServerStopped(serverID, tenantID, namespace string) error {
	return ep.PublishStateChange(&K8sStateEvent{
		Type:      "stopped",
		ServerID:  serverID,
		TenantID:  tenantID,
		Namespace: namespace,
		Phase:     "Stopped",
		Message:   "Server is stopped",
		Timestamp: time.Now(),
	})
}

// PublishServerError publishes a server error event
func (ep *EventPublisher) PublishServerError(serverID, tenantID, namespace, errorMsg string) error {
	return ep.PublishStateChange(&K8sStateEvent{
		Type:      "error",
		ServerID:  serverID,
		TenantID:  tenantID,
		Namespace: namespace,
		Phase:     "Error",
		Message:   errorMsg,
		Timestamp: time.Now(),
	})
}

// PublishPlayerCountUpdate publishes player count update
func (ep *EventPublisher) PublishPlayerCountUpdate(serverID, tenantID string, playerCount int) error {
	return ep.PublishStateChange(&K8sStateEvent{
		Type:        "player_update",
		ServerID:    serverID,
		TenantID:    tenantID,
		Phase:       "Running",
		PlayerCount: playerCount,
		Message:     fmt.Sprintf("Player count: %d", playerCount),
		Timestamp:   time.Now(),
	})
}

// Close closes the NATS connection
func (ep *EventPublisher) Close() {
	if ep.conn != nil {
		ep.conn.Close()
		log.Println("EventPublisher connection closed")
	}
}

// IsConnected returns true if connected to NATS
func (ep *EventPublisher) IsConnected() bool {
	return ep.enabled && ep.conn != nil && ep.conn.IsConnected()
}

// Reconnect attempts to reconnect to NATS
func (ep *EventPublisher) Reconnect() error {
	if ep.conn != nil && ep.conn.IsConnected() {
		return nil // Already connected
	}

	config := DefaultConfig()
	newPub, err := NewEventPublisher(config)
	if err != nil {
		return err
	}

	ep.conn = newPub.conn
	ep.js = newPub.js
	ep.enabled = newPub.enabled

	return nil
}
