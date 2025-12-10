package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"minecraft-platform/src/models"
)

// MetricsCollectorService handles real-time metrics gathering and storage
type MetricsCollectorService struct {
	storageService    MetricsStorageService
	natsConnection    NATSConnection // Interface for NATS messaging
	collectionInterval time.Duration
	retentionPeriod   time.Duration
}

// MetricsStorageService interface for metrics storage operations
type MetricsStorageService interface {
	StoreMetric(ctx context.Context, metric *models.MetricsData) error
	StoreMetricsBatch(ctx context.Context, metrics []*models.MetricsData) error
	QueryMetrics(ctx context.Context, query *MetricsQuery) ([]*models.MetricsData, error)
	DeleteExpiredMetrics(ctx context.Context, before time.Time) error
}

// NATSConnection interface for real-time streaming
type NATSConnection interface {
	Publish(subject string, data []byte) error
	Subscribe(subject string, handler func(data []byte)) error
	Close() error
}

// NewMetricsCollectorService creates a new metrics collector service
func NewMetricsCollectorService(storage MetricsStorageService, nats NATSConnection) *MetricsCollectorService {
	return &MetricsCollectorService{
		storageService:     storage,
		natsConnection:     nats,
		collectionInterval: 30 * time.Second, // Default collection interval
		retentionPeriod:    30 * 24 * time.Hour, // Default 30 days retention
	}
}

// MetricsQuery represents a query for historical metrics data
type MetricsQuery struct {
	ServerIDs   []string  `json:"server_ids,omitempty"`
	MetricTypes []string  `json:"metric_types,omitempty"`
	MetricNames []string  `json:"metric_names,omitempty"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	TenantID    string    `json:"tenant_id"`
	Limit       int       `json:"limit,omitempty"`
	Aggregation string    `json:"aggregation,omitempty"` // avg, sum, min, max
	GroupBy     string    `json:"group_by,omitempty"`    // time interval for grouping
}

// MetricDataPoint represents a single metric data point
type MetricDataPoint struct {
	ServerID   string                 `json:"server_id"`
	MetricType string                 `json:"metric_type"`
	MetricName string                 `json:"metric_name"`
	Value      float64                `json:"value"`
	Unit       string                 `json:"unit"`
	Tags       map[string]string      `json:"tags,omitempty"`
	Timestamp  time.Time              `json:"timestamp"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

// MetricsCollectionRequest represents a request to collect metrics
type MetricsCollectionRequest struct {
	ServerID string `json:"server_id"`
	TenantID string `json:"tenant_id"`
	Immediate bool  `json:"immediate,omitempty"` // Force immediate collection
}

// MetricsStreamEvent represents a real-time metrics event
type MetricsStreamEvent struct {
	Type      string           `json:"type"` // "metric_update", "alert", "threshold_exceeded"
	ServerID  string           `json:"server_id"`
	TenantID  string           `json:"tenant_id"`
	Metrics   []MetricDataPoint `json:"metrics,omitempty"`
	Alert     *MetricAlert     `json:"alert,omitempty"`
	Timestamp time.Time        `json:"timestamp"`
}

// MetricAlert represents a metric-based alert
type MetricAlert struct {
	ID          string                 `json:"id"`
	ServerID    string                 `json:"server_id"`
	MetricName  string                 `json:"metric_name"`
	Threshold   float64                `json:"threshold"`
	CurrentValue float64               `json:"current_value"`
	Condition   string                 `json:"condition"` // "greater_than", "less_than", "equals"
	Severity    string                 `json:"severity"`  // "low", "medium", "high", "critical"
	Message     string                 `json:"message"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// CollectMetrics collects metrics for a specific server
func (mcs *MetricsCollectorService) CollectMetrics(ctx context.Context, req *MetricsCollectionRequest) error {
	if req.TenantID == "" {
		return fmt.Errorf("tenant_id is required")
	}
	if req.ServerID == "" {
		return fmt.Errorf("server_id is required")
	}

	// Collect various metric types
	metrics := []*models.MetricsData{}

	// Collect performance metrics
	perfMetrics, err := mcs.collectPerformanceMetrics(ctx, req.ServerID, req.TenantID)
	if err != nil {
		return fmt.Errorf("failed to collect performance metrics: %w", err)
	}
	metrics = append(metrics, perfMetrics...)

	// Collect resource metrics
	resourceMetrics, err := mcs.collectResourceMetrics(ctx, req.ServerID, req.TenantID)
	if err != nil {
		return fmt.Errorf("failed to collect resource metrics: %w", err)
	}
	metrics = append(metrics, resourceMetrics...)

	// Collect player metrics
	playerMetrics, err := mcs.collectPlayerMetrics(ctx, req.ServerID, req.TenantID)
	if err != nil {
		return fmt.Errorf("failed to collect player metrics: %w", err)
	}
	metrics = append(metrics, playerMetrics...)

	// Store metrics in batch
	if len(metrics) > 0 {
		err := mcs.storageService.StoreMetricsBatch(ctx, metrics)
		if err != nil {
			return fmt.Errorf("failed to store metrics: %w", err)
		}

		// Stream metrics to real-time subscribers
		err = mcs.streamMetrics(ctx, req.ServerID, req.TenantID, metrics)
		if err != nil {
			// Log error but don't fail the collection
			fmt.Printf("Warning: failed to stream metrics: %v\n", err)
		}
	}

	return nil
}

// QueryHistoricalMetrics queries historical metrics data
func (mcs *MetricsCollectorService) QueryHistoricalMetrics(ctx context.Context, query *MetricsQuery) ([]*models.MetricsData, error) {
	if query.TenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if query.StartTime.IsZero() || query.EndTime.IsZero() {
		return nil, fmt.Errorf("start_time and end_time are required")
	}
	if query.StartTime.After(query.EndTime) {
		return nil, fmt.Errorf("start_time must be before end_time")
	}

	// Set default limit if not specified
	if query.Limit == 0 {
		query.Limit = 1000
	}

	return mcs.storageService.QueryMetrics(ctx, query)
}

// StartMetricsCollection starts periodic metrics collection for all servers
func (mcs *MetricsCollectorService) StartMetricsCollection(ctx context.Context) error {
	ticker := time.NewTicker(mcs.collectionInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			// TODO: Get list of active servers from server lifecycle service
			// For now, this is a placeholder for the collection loop
			err := mcs.collectAllServersMetrics(ctx)
			if err != nil {
				fmt.Printf("Error collecting metrics for all servers: %v\n", err)
			}
		}
	}
}

// SubscribeToMetricsStream subscribes to real-time metrics updates
func (mcs *MetricsCollectorService) SubscribeToMetricsStream(ctx context.Context, serverID, tenantID string, handler func(*MetricsStreamEvent)) error {
	if tenantID == "" {
		return fmt.Errorf("tenant_id is required")
	}

	subject := fmt.Sprintf("metrics.%s.%s", tenantID, serverID)
	return mcs.natsConnection.Subscribe(subject, func(data []byte) {
		var event MetricsStreamEvent
		if err := json.Unmarshal(data, &event); err != nil {
			fmt.Printf("Error unmarshaling metrics event: %v\n", err)
			return
		}
		handler(&event)
	})
}

// CleanupExpiredMetrics removes metrics older than the retention period
func (mcs *MetricsCollectorService) CleanupExpiredMetrics(ctx context.Context) error {
	cutoffTime := time.Now().Add(-mcs.retentionPeriod)
	return mcs.storageService.DeleteExpiredMetrics(ctx, cutoffTime)
}

// SetCollectionInterval updates the metrics collection interval
func (mcs *MetricsCollectorService) SetCollectionInterval(interval time.Duration) {
	if interval < 10*time.Second {
		interval = 10 * time.Second // Minimum 10 seconds
	}
	mcs.collectionInterval = interval
}

// SetRetentionPeriod updates the metrics retention period
func (mcs *MetricsCollectorService) SetRetentionPeriod(period time.Duration) {
	if period < 24*time.Hour {
		period = 24 * time.Hour // Minimum 1 day
	}
	mcs.retentionPeriod = period
}

// Helper methods for collecting different types of metrics

func (mcs *MetricsCollectorService) collectPerformanceMetrics(ctx context.Context, serverID, tenantID string) ([]*models.MetricsData, error) {
	now := time.Now()
	metrics := []*models.MetricsData{
		{
			ServerID:   serverID,
			MetricType: models.MetricTypePerformance,
			MetricName: "tps",
			Value:      20.0, // Mock TPS value
			Unit:       models.MetricUnitTPS,
			Timestamp:  now,
			TenantID:   tenantID,
		},
		{
			ServerID:   serverID,
			MetricType: models.MetricTypePerformance,
			MetricName: "mspt",
			Value:      25.5, // Mock milliseconds per tick
			Unit:       models.MetricUnitMillisecond,
			Timestamp:  now,
			TenantID:   tenantID,
		},
	}
	return metrics, nil
}

func (mcs *MetricsCollectorService) collectResourceMetrics(ctx context.Context, serverID, tenantID string) ([]*models.MetricsData, error) {
	now := time.Now()
	metrics := []*models.MetricsData{
		{
			ServerID:   serverID,
			MetricType: models.MetricTypeResource,
			MetricName: "cpu_usage",
			Value:      45.2, // Mock CPU usage percentage
			Unit:       models.MetricUnitPercent,
			Timestamp:  now,
			TenantID:   tenantID,
		},
		{
			ServerID:   serverID,
			MetricType: models.MetricTypeResource,
			MetricName: "memory_usage",
			Value:      2147483648, // Mock memory usage in bytes (2GB)
			Unit:       models.MetricUnitBytes,
			Timestamp:  now,
			TenantID:   tenantID,
		},
	}
	return metrics, nil
}

func (mcs *MetricsCollectorService) collectPlayerMetrics(ctx context.Context, serverID, tenantID string) ([]*models.MetricsData, error) {
	now := time.Now()
	metrics := []*models.MetricsData{
		{
			ServerID:   serverID,
			MetricType: models.MetricTypePlayer,
			MetricName: "player_count",
			Value:      15, // Mock player count
			Unit:       models.MetricUnitCount,
			Timestamp:  now,
			TenantID:   tenantID,
		},
		{
			ServerID:   serverID,
			MetricType: models.MetricTypePlayer,
			MetricName: "max_players",
			Value:      20, // Mock max players
			Unit:       models.MetricUnitCount,
			Timestamp:  now,
			TenantID:   tenantID,
		},
	}
	return metrics, nil
}

func (mcs *MetricsCollectorService) streamMetrics(ctx context.Context, serverID, tenantID string, metrics []*models.MetricsData) error {
	// Convert to data points for streaming
	dataPoints := make([]MetricDataPoint, len(metrics))
	for i, metric := range metrics {
		dataPoints[i] = MetricDataPoint{
			ServerID:   metric.ServerID,
			MetricType: metric.MetricType,
			MetricName: metric.MetricName,
			Value:      metric.Value,
			Unit:       metric.Unit,
			Timestamp:  metric.Timestamp,
		}
	}

	event := MetricsStreamEvent{
		Type:      "metric_update",
		ServerID:  serverID,
		TenantID:  tenantID,
		Metrics:   dataPoints,
		Timestamp: time.Now(),
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal metrics event: %w", err)
	}

	subject := fmt.Sprintf("metrics.%s.%s", tenantID, serverID)
	return mcs.natsConnection.Publish(subject, data)
}

func (mcs *MetricsCollectorService) collectAllServersMetrics(ctx context.Context) error {
	// TODO: Get list of active servers from database or server lifecycle service
	// For now, this is a placeholder that would iterate through all active servers
	// and collect metrics for each one
	return nil
}