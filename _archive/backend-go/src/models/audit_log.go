package models

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// AuditAction represents the type of action performed
type AuditAction string

const (
	// User Account Actions
	AuditActionUserAccountCreated AuditAction = "user_account.created"
	AuditActionUserAccountUpdated AuditAction = "user_account.updated"
	AuditActionUserAccountDeleted AuditAction = "user_account.deleted"

	// Server Instance Actions
	AuditActionServerCreated        AuditAction = "server.created"
	AuditActionServerUpdated        AuditAction = "server.updated"
	AuditActionServerDeleted        AuditAction = "server.deleted"
	AuditActionServerStarted        AuditAction = "server.started"
	AuditActionServerStopped        AuditAction = "server.stopped"
	AuditActionServerRestarted      AuditAction = "server.restarted"
	AuditActionServerConfigUpdated  AuditAction = "server.config_updated"

	// Plugin Actions
	AuditActionPluginInstalled   AuditAction = "plugin.installed"
	AuditActionPluginUninstalled AuditAction = "plugin.uninstalled"
	AuditActionPluginUpdated     AuditAction = "plugin.updated"
	AuditActionPluginConfigured  AuditAction = "plugin.configured"

	// Backup Actions
	AuditActionBackupCreated  AuditAction = "backup.created"
	AuditActionBackupDeleted  AuditAction = "backup.deleted"
	AuditActionBackupRestored AuditAction = "backup.restored"

	// SKU Actions
	AuditActionSKUCreated     AuditAction = "sku.created"
	AuditActionSKUUpdated     AuditAction = "sku.updated"
	AuditActionSKUDeactivated AuditAction = "sku.deactivated"

	// Authentication Actions
	AuditActionLogin        AuditAction = "auth.login"
	AuditActionLogout       AuditAction = "auth.logout"
	AuditActionLoginFailed  AuditAction = "auth.login_failed"
	AuditActionPasswordReset AuditAction = "auth.password_reset"

	// System Actions
	AuditActionSystemMaintenanceStarted AuditAction = "system.maintenance_started"
	AuditActionSystemMaintenanceEnded   AuditAction = "system.maintenance_ended"
	AuditActionSystemBackup             AuditAction = "system.backup"
	AuditActionSystemRestore            AuditAction = "system.restore"
)

// IsValid checks if the audit action is valid
func (aa AuditAction) IsValid() bool {
	validActions := []AuditAction{
		// User Account Actions
		AuditActionUserAccountCreated, AuditActionUserAccountUpdated, AuditActionUserAccountDeleted,
		// Server Actions
		AuditActionServerCreated, AuditActionServerUpdated, AuditActionServerDeleted,
		AuditActionServerStarted, AuditActionServerStopped, AuditActionServerRestarted, AuditActionServerConfigUpdated,
		// Plugin Actions
		AuditActionPluginInstalled, AuditActionPluginUninstalled, AuditActionPluginUpdated, AuditActionPluginConfigured,
		// Backup Actions
		AuditActionBackupCreated, AuditActionBackupDeleted, AuditActionBackupRestored,
		// SKU Actions
		AuditActionSKUCreated, AuditActionSKUUpdated, AuditActionSKUDeactivated,
		// Authentication Actions
		AuditActionLogin, AuditActionLogout, AuditActionLoginFailed, AuditActionPasswordReset,
		// System Actions
		AuditActionSystemMaintenanceStarted, AuditActionSystemMaintenanceEnded, AuditActionSystemBackup, AuditActionSystemRestore,
	}

	for _, validAction := range validActions {
		if aa == validAction {
			return true
		}
	}
	return false
}

// GetCategory returns the category of the audit action
func (aa AuditAction) GetCategory() string {
	parts := strings.Split(string(aa), ".")
	if len(parts) > 0 {
		return parts[0]
	}
	return "unknown"
}

// IsSensitive returns true if the action is considered sensitive (security-related)
func (aa AuditAction) IsSensitive() bool {
	sensitiveActions := []AuditAction{
		AuditActionUserAccountDeleted,
		AuditActionServerDeleted,
		AuditActionLoginFailed,
		AuditActionPasswordReset,
		AuditActionSystemMaintenanceStarted,
		AuditActionSystemRestore,
	}

	for _, sensitive := range sensitiveActions {
		if aa == sensitive {
			return true
		}
	}
	return false
}

// AuditLevel represents the severity level of an audit event
type AuditLevel string

const (
	AuditLevelInfo     AuditLevel = "info"
	AuditLevelWarning  AuditLevel = "warning"
	AuditLevelError    AuditLevel = "error"
	AuditLevelCritical AuditLevel = "critical"
)

// IsValid checks if the audit level is valid
func (al AuditLevel) IsValid() bool {
	switch al {
	case AuditLevelInfo, AuditLevelWarning, AuditLevelError, AuditLevelCritical:
		return true
	default:
		return false
	}
}

// AuditContext represents additional context information for an audit event
type AuditContext map[string]interface{}

// AuditLog represents audit trail entries for tracking all system activities
type AuditLog struct {
	ID           uuid.UUID     `json:"id" db:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TenantID     uuid.UUID     `json:"tenant_id" db:"tenant_id" gorm:"type:uuid;not null;index" validate:"required"`
	UserID       *uuid.UUID    `json:"user_id,omitempty" db:"user_id" gorm:"type:uuid;index"`
	Action       AuditAction   `json:"action" db:"action" gorm:"not null;index" validate:"required"`
	ResourceType string        `json:"resource_type" db:"resource_type" gorm:"not null;index" validate:"required"`
	ResourceID   *uuid.UUID    `json:"resource_id,omitempty" db:"resource_id" gorm:"type:uuid;index"`
	Level        AuditLevel    `json:"level" db:"level" gorm:"not null;index" validate:"required"`
	Message      string        `json:"message" db:"message" gorm:"not null" validate:"required"`
	Context      AuditContext  `json:"context" db:"context" gorm:"type:jsonb"`
	IPAddress    string        `json:"ip_address,omitempty" db:"ip_address" gorm:"index"`
	UserAgent    string        `json:"user_agent,omitempty" db:"user_agent"`
	SessionID    string        `json:"session_id,omitempty" db:"session_id" gorm:"index"`
	RequestID    string        `json:"request_id,omitempty" db:"request_id" gorm:"index"`
	Success      bool          `json:"success" db:"success" gorm:"not null;default:true;index"`
	Duration     *int64        `json:"duration,omitempty" db:"duration"` // Duration in milliseconds
	CreatedAt    time.Time     `json:"created_at" db:"created_at" gorm:"autoCreateTime;index"`

	// Relationships (loaded separately)
	User *UserAccount `json:"user,omitempty" gorm:"foreignKey:UserID"`
}

// AuditLogRepository defines the interface for Audit Log data operations
type AuditLogRepository interface {
	Create(ctx context.Context, log *AuditLog) error
	GetByID(ctx context.Context, id uuid.UUID) (*AuditLog, error)
	GetByTenant(ctx context.Context, tenantID uuid.UUID, filters *AuditLogFilters, limit, offset int) ([]*AuditLog, error)
	GetByUser(ctx context.Context, userID uuid.UUID, filters *AuditLogFilters, limit, offset int) ([]*AuditLog, error)
	GetByResource(ctx context.Context, resourceType string, resourceID uuid.UUID, limit, offset int) ([]*AuditLog, error)
	GetByAction(ctx context.Context, action AuditAction, tenantID uuid.UUID, limit, offset int) ([]*AuditLog, error)
	GetSecurityEvents(ctx context.Context, tenantID uuid.UUID, since time.Time, limit int) ([]*AuditLog, error)
	GetFailedActions(ctx context.Context, tenantID uuid.UUID, since time.Time, limit int) ([]*AuditLog, error)
	DeleteOld(ctx context.Context, before time.Time) (int, error)
	GetAuditStats(ctx context.Context, tenantID uuid.UUID, since time.Time) (*AuditStats, error)
}

// AuditLogFilters represents filters for querying audit logs
type AuditLogFilters struct {
	Actions      []AuditAction `json:"actions,omitempty"`
	Levels       []AuditLevel  `json:"levels,omitempty"`
	ResourceType *string       `json:"resource_type,omitempty"`
	IPAddress    *string       `json:"ip_address,omitempty"`
	Success      *bool         `json:"success,omitempty"`
	Since        *time.Time    `json:"since,omitempty"`
	Until        *time.Time    `json:"until,omitempty"`
}

// AuditStats represents audit statistics for a tenant
type AuditStats struct {
	TotalEvents        int64              `json:"total_events"`
	SuccessfulEvents   int64              `json:"successful_events"`
	FailedEvents       int64              `json:"failed_events"`
	SecurityEvents     int64              `json:"security_events"`
	EventsByAction     map[string]int64   `json:"events_by_action"`
	EventsByLevel      map[string]int64   `json:"events_by_level"`
	EventsByHour       map[string]int64   `json:"events_by_hour"`
	TopUsers           []UserActivityStat `json:"top_users"`
	TopIPAddresses     []IPActivityStat   `json:"top_ip_addresses"`
	AverageDuration    *float64           `json:"average_duration,omitempty"`
}

// UserActivityStat represents user activity statistics
type UserActivityStat struct {
	UserID      uuid.UUID `json:"user_id"`
	UserEmail   string    `json:"user_email,omitempty"`
	EventCount  int64     `json:"event_count"`
	LastActivity time.Time `json:"last_activity"`
}

// IPActivityStat represents IP address activity statistics
type IPActivityStat struct {
	IPAddress   string    `json:"ip_address"`
	EventCount  int64     `json:"event_count"`
	LastActivity time.Time `json:"last_activity"`
}

// TableName returns the table name for GORM
func (AuditLog) TableName() string {
	return "audit_logs"
}

// Validate performs comprehensive validation on the AuditLog
func (al *AuditLog) Validate() error {
	if al.TenantID == uuid.Nil {
		return errors.New("tenant_id is required")
	}

	if !al.Action.IsValid() {
		return fmt.Errorf("invalid audit action: %s", al.Action)
	}

	if al.ResourceType == "" {
		return errors.New("resource_type is required")
	}

	if len(al.ResourceType) > 50 {
		return errors.New("resource_type must be 50 characters or less")
	}

	if !isValidResourceType(al.ResourceType) {
		return fmt.Errorf("invalid resource_type: %s", al.ResourceType)
	}

	if !al.Level.IsValid() {
		return fmt.Errorf("invalid audit level: %s", al.Level)
	}

	if al.Message == "" {
		return errors.New("message is required")
	}

	if len(al.Message) > 1000 {
		return errors.New("message must be 1000 characters or less")
	}

	// Validate IP address if provided
	if al.IPAddress != "" && !isValidIPAddress(al.IPAddress) {
		return fmt.Errorf("invalid IP address: %s", al.IPAddress)
	}

	// Validate user agent length
	if len(al.UserAgent) > 500 {
		return errors.New("user_agent must be 500 characters or less")
	}

	// Validate session ID format
	if al.SessionID != "" && !isValidSessionID(al.SessionID) {
		return errors.New("invalid session_id format")
	}

	// Validate request ID format
	if al.RequestID != "" && !isValidRequestID(al.RequestID) {
		return errors.New("invalid request_id format")
	}

	// Validate duration
	if al.Duration != nil && *al.Duration < 0 {
		return errors.New("duration must be non-negative")
	}

	// Validate context if provided
	if al.Context != nil {
		if err := al.validateContext(); err != nil {
			return fmt.Errorf("context validation failed: %w", err)
		}
	}

	return nil
}

// validateContext validates audit context
func (al *AuditLog) validateContext() error {
	if len(al.Context) > 50 {
		return errors.New("too many context entries (max 50)")
	}

	for key, value := range al.Context {
		if key == "" {
			return errors.New("context key cannot be empty")
		}

		if len(key) > 100 {
			return fmt.Errorf("context key '%s' too long (max 100 characters)", key)
		}

		// Validate value types and size
		switch v := value.(type) {
		case nil, bool, int, int32, int64, float32, float64:
			// Valid basic types
		case string:
			if len(v) > 1000 {
				return fmt.Errorf("context string value for key '%s' too long (max 1000 characters)", key)
			}
		case []interface{}, map[string]interface{}:
			// Valid complex types, but don't allow deeply nested structures
		default:
			return fmt.Errorf("context value for key '%s' has unsupported type: %T", key, v)
		}
	}

	return nil
}

// BeforeCreate is called before creating a new AuditLog
func (al *AuditLog) BeforeCreate() error {
	if al.ID == uuid.Nil {
		al.ID = uuid.New()
	}

	al.CreatedAt = time.Now().UTC()

	// Normalize data
	al.Message = strings.TrimSpace(al.Message)
	al.UserAgent = strings.TrimSpace(al.UserAgent)

	// Set default level if not specified
	if al.Level == "" {
		al.Level = AuditLevelInfo
	}

	return al.Validate()
}

// AddContextValue adds a context value
func (al *AuditLog) AddContextValue(key string, value interface{}) {
	if al.Context == nil {
		al.Context = make(AuditContext)
	}
	al.Context[key] = value
}

// GetContextValue returns a context value by key
func (al *AuditLog) GetContextValue(key string) (interface{}, bool) {
	if al.Context == nil {
		return nil, false
	}
	value, exists := al.Context[key]
	return value, exists
}

// RemoveContextValue removes a context value
func (al *AuditLog) RemoveContextValue(key string) {
	if al.Context != nil {
		delete(al.Context, key)
	}
}

// IsSecurityEvent returns true if this is a security-related event
func (al *AuditLog) IsSecurityEvent() bool {
	return al.Action.IsSensitive() || al.Level == AuditLevelCritical || al.Level == AuditLevelError
}

// GetFormattedDuration returns the duration in human-readable format
func (al *AuditLog) GetFormattedDuration() string {
	if al.Duration == nil {
		return ""
	}

	duration := time.Duration(*al.Duration) * time.Millisecond
	if duration < time.Second {
		return fmt.Sprintf("%dms", *al.Duration)
	}
	return duration.String()
}

// SetDuration sets the duration in milliseconds
func (al *AuditLog) SetDuration(duration time.Duration) {
	durationMs := duration.Milliseconds()
	al.Duration = &durationMs
}

// Value implements the driver.Valuer interface for AuditContext
func (ac AuditContext) Value() (driver.Value, error) {
	if ac == nil {
		return nil, nil
	}
	return json.Marshal(ac)
}

// Scan implements the sql.Scanner interface for AuditContext
func (ac *AuditContext) Scan(value interface{}) error {
	if value == nil {
		*ac = nil
		return nil
	}

	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, ac)
	case string:
		return json.Unmarshal([]byte(v), ac)
	default:
		return fmt.Errorf("cannot scan %T into AuditContext", value)
	}
}

// CreateAuditLogTable returns the SQL DDL for creating the audit_logs table
func CreateAuditLogTable() string {
	return `
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    level VARCHAR(20) NOT NULL DEFAULT 'info',
    message VARCHAR(1000) NOT NULL,
    context JSONB DEFAULT '{}',
    ip_address INET,
    user_agent VARCHAR(500),
    session_id VARCHAR(100),
    request_id VARCHAR(100),
    success BOOLEAN NOT NULL DEFAULT true,
    duration BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Foreign key constraints
    FOREIGN KEY (tenant_id) REFERENCES user_accounts(tenant_id),
    FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE SET NULL,

    -- Constraints
    CONSTRAINT chk_level_valid CHECK (level IN ('info', 'warning', 'error', 'critical')),
    CONSTRAINT chk_duration_non_negative CHECK (duration IS NULL OR duration >= 0),

    -- Indexes for performance and analytics
    INDEX idx_audit_logs_tenant_id (tenant_id),
    INDEX idx_audit_logs_user_id (user_id),
    INDEX idx_audit_logs_action (action),
    INDEX idx_audit_logs_resource_type (resource_type),
    INDEX idx_audit_logs_resource_id (resource_id),
    INDEX idx_audit_logs_level (level),
    INDEX idx_audit_logs_success (success),
    INDEX idx_audit_logs_ip_address (ip_address),
    INDEX idx_audit_logs_session_id (session_id),
    INDEX idx_audit_logs_request_id (request_id),
    INDEX idx_audit_logs_created_at (created_at DESC),

    -- Composite indexes for common query patterns
    INDEX idx_audit_logs_tenant_created (tenant_id, created_at DESC),
    INDEX idx_audit_logs_user_created (user_id, created_at DESC),
    INDEX idx_audit_logs_resource_created (resource_type, resource_id, created_at DESC),
    INDEX idx_audit_logs_action_tenant (action, tenant_id, created_at DESC),
    INDEX idx_audit_logs_security_events (tenant_id, level, success, created_at DESC)
        WHERE level IN ('error', 'critical') OR success = false
);

-- Partial index for failed events (security monitoring)
CREATE INDEX idx_audit_logs_failed_events ON audit_logs (tenant_id, action, created_at DESC)
WHERE success = false;

-- GIN index for full-text search on message
CREATE INDEX idx_audit_logs_message_search ON audit_logs
USING GIN (to_tsvector('english', message));

-- Partitioning by month for large audit log tables (optional)
-- This would be set up separately based on expected volume

-- Row-level security for multi-tenant isolation
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own tenant's audit logs
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
`
}

// DropAuditLogTable returns the SQL DDL for dropping the audit_logs table
func DropAuditLogTable() string {
	return `
DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;
DROP INDEX IF EXISTS idx_audit_logs_message_search;
DROP INDEX IF EXISTS idx_audit_logs_failed_events;
DROP TABLE IF EXISTS audit_logs CASCADE;
`
}

// isValidResourceType validates resource type format
func isValidResourceType(resourceType string) bool {
	// Resource types should be lowercase with underscores
	validResourceTypeRegex := regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	return validResourceTypeRegex.MatchString(resourceType)
}

// isValidIPAddress validates IP address format (IPv4 or IPv6)
func isValidIPAddress(ip string) bool {
	return net.ParseIP(ip) != nil
}

// isValidSessionID validates session ID format
func isValidSessionID(sessionID string) bool {
	// Session ID should be alphanumeric with hyphens, 20-100 characters
	if len(sessionID) < 20 || len(sessionID) > 100 {
		return false
	}
	sessionIDRegex := regexp.MustCompile(`^[a-zA-Z0-9\-_]+$`)
	return sessionIDRegex.MatchString(sessionID)
}

// isValidRequestID validates request ID format
func isValidRequestID(requestID string) bool {
	// Request ID should be alphanumeric with hyphens, 10-100 characters
	if len(requestID) < 10 || len(requestID) > 100 {
		return false
	}
	requestIDRegex := regexp.MustCompile(`^[a-zA-Z0-9\-_]+$`)
	return requestIDRegex.MatchString(requestID)
}

// AuditLogCreateRequest represents the request payload for creating an audit log entry
type AuditLogCreateRequest struct {
	UserID       *uuid.UUID    `json:"user_id,omitempty"`
	Action       AuditAction   `json:"action" validate:"required"`
	ResourceType string        `json:"resource_type" validate:"required,max=50"`
	ResourceID   *uuid.UUID    `json:"resource_id,omitempty"`
	Level        AuditLevel    `json:"level,omitempty"`
	Message      string        `json:"message" validate:"required,max=1000"`
	Context      AuditContext  `json:"context,omitempty"`
	IPAddress    string        `json:"ip_address,omitempty"`
	UserAgent    string        `json:"user_agent,omitempty"`
	SessionID    string        `json:"session_id,omitempty"`
	RequestID    string        `json:"request_id,omitempty"`
	Success      bool          `json:"success,omitempty"`
	Duration     *int64        `json:"duration,omitempty"`
}

// ToAuditLog converts the create request to an AuditLog model
func (r *AuditLogCreateRequest) ToAuditLog(tenantID uuid.UUID) *AuditLog {
	level := r.Level
	if level == "" {
		level = AuditLevelInfo
	}

	return &AuditLog{
		TenantID:     tenantID,
		UserID:       r.UserID,
		Action:       r.Action,
		ResourceType: r.ResourceType,
		ResourceID:   r.ResourceID,
		Level:        level,
		Message:      r.Message,
		Context:      r.Context,
		IPAddress:    r.IPAddress,
		UserAgent:    r.UserAgent,
		SessionID:    r.SessionID,
		RequestID:    r.RequestID,
		Success:      r.Success,
		Duration:     r.Duration,
	}
}

// AuditLogResponse represents the response payload for audit log operations
type AuditLogResponse struct {
	ID              uuid.UUID     `json:"id"`
	TenantID        uuid.UUID     `json:"tenant_id"`
	UserID          *uuid.UUID    `json:"user_id,omitempty"`
	Action          AuditAction   `json:"action"`
	ActionCategory  string        `json:"action_category"`
	ResourceType    string        `json:"resource_type"`
	ResourceID      *uuid.UUID    `json:"resource_id,omitempty"`
	Level           AuditLevel    `json:"level"`
	Message         string        `json:"message"`
	Context         AuditContext  `json:"context"`
	IPAddress       string        `json:"ip_address,omitempty"`
	UserAgent       string        `json:"user_agent,omitempty"`
	SessionID       string        `json:"session_id,omitempty"`
	RequestID       string        `json:"request_id,omitempty"`
	Success         bool          `json:"success"`
	Duration        *int64        `json:"duration,omitempty"`
	FormattedDuration string      `json:"formatted_duration,omitempty"`
	CreatedAt       time.Time     `json:"created_at"`
	IsSecurityEvent bool          `json:"is_security_event"`

	// Embedded related objects (when requested)
	User *UserAccountResponse `json:"user,omitempty"`
}

// FromAuditLog converts an AuditLog model to a response payload
func (r *AuditLogResponse) FromAuditLog(log *AuditLog) {
	r.ID = log.ID
	r.TenantID = log.TenantID
	r.UserID = log.UserID
	r.Action = log.Action
	r.ActionCategory = log.Action.GetCategory()
	r.ResourceType = log.ResourceType
	r.ResourceID = log.ResourceID
	r.Level = log.Level
	r.Message = log.Message
	r.Context = log.Context
	r.IPAddress = log.IPAddress
	r.UserAgent = log.UserAgent
	r.SessionID = log.SessionID
	r.RequestID = log.RequestID
	r.Success = log.Success
	r.Duration = log.Duration
	r.FormattedDuration = log.GetFormattedDuration()
	r.CreatedAt = log.CreatedAt
	r.IsSecurityEvent = log.IsSecurityEvent()

	// Include related objects if they're loaded
	if log.User != nil {
		r.User = NewUserAccountResponse(log.User)
	}
}

// NewAuditLogResponse creates a new AuditLogResponse from an AuditLog
func NewAuditLogResponse(log *AuditLog) *AuditLogResponse {
	response := &AuditLogResponse{}
	response.FromAuditLog(log)
	return response
}

// AuditLogListResponse represents the response for listing audit logs
type AuditLogListResponse struct {
	Logs       []*AuditLogResponse `json:"logs"`
	Total      int                 `json:"total"`
	Page       int                 `json:"page"`
	PageSize   int                 `json:"page_size"`
	TotalPages int                 `json:"total_pages"`
	Stats      *AuditStats         `json:"stats,omitempty"`
}

// NewAuditLogListResponse creates a paginated response for audit logs
func NewAuditLogListResponse(logs []*AuditLog, total, page, pageSize int, stats *AuditStats) *AuditLogListResponse {
	responses := make([]*AuditLogResponse, len(logs))
	for i, log := range logs {
		responses[i] = NewAuditLogResponse(log)
	}

	totalPages := (total + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}

	return &AuditLogListResponse{
		Logs:       responses,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		Stats:      stats,
	}
}