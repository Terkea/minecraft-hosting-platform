package models

import (
	"time"

	"gorm.io/gorm"
)

// MetricsData represents time-series metrics storage for server monitoring
type MetricsData struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	ServerID     string    `gorm:"not null;index" json:"server_id"`
	MetricType   string    `gorm:"not null;index" json:"metric_type"`
	MetricName   string    `gorm:"not null;index" json:"metric_name"`
	Value        float64   `gorm:"not null" json:"value"`
	Unit         string    `gorm:"not null" json:"unit"`
	Tags         string    `gorm:"type:text" json:"tags"` // JSON string for flexible tagging
	Timestamp    time.Time `gorm:"not null;index" json:"timestamp"`
	TenantID     string    `gorm:"not null;index" json:"tenant_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// MetricType constants for validation
const (
	MetricTypePerformance = "performance"
	MetricTypeResource    = "resource"
	MetricTypePlayer      = "player"
	MetricTypeSystem      = "system"
	MetricTypeCustom      = "custom"
)

// MetricUnit constants for validation
const (
	MetricUnitBytes       = "bytes"
	MetricUnitPercent     = "percent"
	MetricUnitCount       = "count"
	MetricUnitMillisecond = "ms"
	MetricUnitSecond      = "s"
	MetricUnitTPS         = "tps"
	MetricUnitMBPS        = "mbps"
)

// BeforeCreate validates the metrics data before creation
func (m *MetricsData) BeforeCreate(tx *gorm.DB) error {
	if m.TenantID == "" {
		return ErrTenantIDRequired
	}
	if m.ServerID == "" {
		return ErrServerIDRequired
	}
	if m.MetricType == "" {
		return ErrMetricTypeRequired
	}
	if m.MetricName == "" {
		return ErrMetricNameRequired
	}
	if m.Unit == "" {
		return ErrMetricUnitRequired
	}
	if m.Timestamp.IsZero() {
		m.Timestamp = time.Now()
	}
	return nil
}

// BeforeUpdate validates the metrics data before update
func (m *MetricsData) BeforeUpdate(tx *gorm.DB) error {
	if m.TenantID == "" {
		return ErrTenantIDRequired
	}
	if m.ServerID == "" {
		return ErrServerIDRequired
	}
	if m.MetricType == "" {
		return ErrMetricTypeRequired
	}
	if m.MetricName == "" {
		return ErrMetricNameRequired
	}
	if m.Unit == "" {
		return ErrMetricUnitRequired
	}
	return nil
}

// IsValidMetricType checks if the metric type is valid
func (m *MetricsData) IsValidMetricType() bool {
	validTypes := []string{
		MetricTypePerformance,
		MetricTypeResource,
		MetricTypePlayer,
		MetricTypeSystem,
		MetricTypeCustom,
	}
	for _, validType := range validTypes {
		if m.MetricType == validType {
			return true
		}
	}
	return false
}

// IsValidUnit checks if the metric unit is valid
func (m *MetricsData) IsValidUnit() bool {
	validUnits := []string{
		MetricUnitBytes,
		MetricUnitPercent,
		MetricUnitCount,
		MetricUnitMillisecond,
		MetricUnitSecond,
		MetricUnitTPS,
		MetricUnitMBPS,
	}
	for _, validUnit := range validUnits {
		if m.Unit == validUnit {
			return true
		}
	}
	return false
}

// TableName returns the table name for GORM
func (MetricsData) TableName() string {
	return "metrics_data"
}