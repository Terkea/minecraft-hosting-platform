package models

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
)

// ServerStatus represents the lifecycle state of a Minecraft server
type ServerStatus string

const (
	ServerStatusDeploying   ServerStatus = "deploying"
	ServerStatusRunning     ServerStatus = "running"
	ServerStatusStopped     ServerStatus = "stopped"
	ServerStatusFailed      ServerStatus = "failed"
	ServerStatusTerminating ServerStatus = "terminating"
)

// Valid returns true if the server status is valid
func (s ServerStatus) Valid() bool {
	switch s {
	case ServerStatusDeploying, ServerStatusRunning, ServerStatusStopped, ServerStatusFailed, ServerStatusTerminating:
		return true
	default:
		return false
	}
}

// String implements the Stringer interface
func (s ServerStatus) String() string {
	return string(s)
}

// ServerProperties represents Minecraft server.properties settings
type ServerProperties map[string]interface{}

// ResourceLimits represents CPU, memory, and storage limits
type ResourceLimits struct {
	CPUCores  float64 `json:"cpu_cores"`
	MemoryGB  int     `json:"memory_gb"`
	StorageGB int     `json:"storage_gb"`
}

// ServerInstance represents a deployed Minecraft server with resources, configurations, and lifecycle state
type ServerInstance struct {
	ID                  uuid.UUID        `json:"id" db:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	TenantID            uuid.UUID        `json:"tenant_id" db:"tenant_id" gorm:"type:uuid;not null;index" validate:"required"`
	Name                string           `json:"name" db:"name" gorm:"not null;index" validate:"required,min=1,max=50,alphanum_hyphen"`
	SkuID               uuid.UUID        `json:"sku_id" db:"sku_id" gorm:"column:sku_id;type:uuid;not null" validate:"required"`
	Status              ServerStatus     `json:"status" db:"status" gorm:"not null" validate:"required"`
	MinecraftVersion    string           `json:"minecraft_version" db:"minecraft_version" gorm:"not null" validate:"required,minecraft_version"`
	ServerProperties    ServerProperties `json:"server_properties" db:"server_properties" gorm:"type:jsonb"`
	ResourceLimits      ResourceLimits   `json:"resource_limits" db:"resource_limits" gorm:"type:jsonb;not null"`
	KubernetesNamespace string           `json:"kubernetes_namespace" db:"kubernetes_namespace" gorm:"not null"`
	ExternalPort        int              `json:"external_port" db:"external_port" gorm:"not null;uniqueIndex:idx_tenant_port" validate:"min=1024,max=65535"`
	CurrentPlayers      int              `json:"current_players" db:"current_players" gorm:"default:0" validate:"min=0"`
	MaxPlayers          int              `json:"max_players" db:"max_players" gorm:"not null" validate:"required,min=1,max=100"`
	LastBackupAt        *time.Time       `json:"last_backup_at" db:"last_backup_at"`
	CreatedAt           time.Time        `json:"created_at" db:"created_at" gorm:"autoCreateTime"`
	UpdatedAt           time.Time        `json:"updated_at" db:"updated_at" gorm:"autoUpdateTime"`
}

// ServerInstanceRepository defines the interface for Server Instance data operations
type ServerInstanceRepository interface {
	Create(ctx context.Context, server *ServerInstance) error
	GetByID(ctx context.Context, id uuid.UUID) (*ServerInstance, error)
	GetByTenant(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]*ServerInstance, error)
	GetByStatus(ctx context.Context, tenantID uuid.UUID, status ServerStatus) ([]*ServerInstance, error)
	Update(ctx context.Context, server *ServerInstance) error
	Delete(ctx context.Context, id uuid.UUID) error
	ExistsWithName(ctx context.Context, tenantID uuid.UUID, name string) (bool, error)
	GetByExternalPort(ctx context.Context, tenantID uuid.UUID, port int) (*ServerInstance, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status ServerStatus) error
	UpdatePlayerCount(ctx context.Context, id uuid.UUID, currentPlayers int) error
	UpdateLastBackupAt(ctx context.Context, id uuid.UUID, backupTime time.Time) error
}

// TableName returns the table name for GORM
func (ServerInstance) TableName() string {
	return "server_instances"
}

// Validate performs comprehensive validation on the ServerInstance
func (s *ServerInstance) Validate() error {
	if s.TenantID == uuid.Nil {
		return errors.New("tenant_id is required")
	}

	if s.Name == "" {
		return errors.New("name is required")
	}

	if !isValidServerName(s.Name) {
		return errors.New("name can only contain alphanumeric characters and hyphens, and must be 1-50 characters")
	}

	if s.SkuID == uuid.Nil {
		return errors.New("sku_id is required")
	}

	if !s.Status.Valid() {
		return errors.New("status must be one of: deploying, running, stopped, failed, terminating")
	}

	if s.MinecraftVersion == "" {
		return errors.New("minecraft_version is required")
	}

	if !isValidMinecraftVersion(s.MinecraftVersion) {
		return errors.New("minecraft_version must be a valid version format (e.g., '1.20.1')")
	}

	if s.ExternalPort < 1024 || s.ExternalPort > 65535 {
		return errors.New("external_port must be between 1024 and 65535")
	}

	if s.CurrentPlayers < 0 {
		return errors.New("current_players must be non-negative")
	}

	if s.MaxPlayers < 1 || s.MaxPlayers > 100 {
		return errors.New("max_players must be between 1 and 100")
	}

	if s.CurrentPlayers > s.MaxPlayers {
		return errors.New("current_players cannot exceed max_players")
	}

	if err := s.ResourceLimits.Validate(); err != nil {
		return fmt.Errorf("resource_limits validation failed: %w", err)
	}

	return nil
}

// Validate validates ResourceLimits
func (rl *ResourceLimits) Validate() error {
	if rl.CPUCores <= 0 {
		return errors.New("cpu_cores must be positive")
	}

	if rl.MemoryGB <= 0 {
		return errors.New("memory_gb must be positive")
	}

	if rl.StorageGB <= 0 {
		return errors.New("storage_gb must be positive")
	}

	// Reasonable limits for Minecraft servers
	if rl.CPUCores > 16 {
		return errors.New("cpu_cores cannot exceed 16")
	}

	if rl.MemoryGB > 64 {
		return errors.New("memory_gb cannot exceed 64")
	}

	if rl.StorageGB > 1000 {
		return errors.New("storage_gb cannot exceed 1000")
	}

	return nil
}

// BeforeCreate is called before creating a new ServerInstance
func (s *ServerInstance) BeforeCreate() error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}

	if s.Status == "" {
		s.Status = ServerStatusDeploying
	}

	if s.KubernetesNamespace == "" {
		s.KubernetesNamespace = fmt.Sprintf("minecraft-%s", s.TenantID.String()[:8])
	}

	now := time.Now().UTC()
	s.CreatedAt = now
	s.UpdatedAt = now

	return s.Validate()
}

// BeforeUpdate is called before updating a ServerInstance
func (s *ServerInstance) BeforeUpdate() error {
	s.UpdatedAt = time.Now().UTC()
	return s.Validate()
}

// CanTransitionTo checks if the server can transition to the target status
func (s *ServerInstance) CanTransitionTo(targetStatus ServerStatus) bool {
	switch s.Status {
	case ServerStatusDeploying:
		return targetStatus == ServerStatusRunning || targetStatus == ServerStatusFailed
	case ServerStatusRunning:
		return targetStatus == ServerStatusStopped || targetStatus == ServerStatusTerminating
	case ServerStatusStopped:
		return targetStatus == ServerStatusDeploying || targetStatus == ServerStatusTerminating
	case ServerStatusFailed:
		return targetStatus == ServerStatusDeploying || targetStatus == ServerStatusTerminating
	case ServerStatusTerminating:
		// Terminal state - no transitions allowed
		return false
	default:
		return false
	}
}

// TransitionTo transitions the server to a new status if valid
func (s *ServerInstance) TransitionTo(targetStatus ServerStatus) error {
	if !s.CanTransitionTo(targetStatus) {
		return fmt.Errorf("cannot transition from %s to %s", s.Status, targetStatus)
	}

	s.Status = targetStatus
	s.UpdatedAt = time.Now().UTC()
	return nil
}

// IsRunning returns true if the server is in running state
func (s *ServerInstance) IsRunning() bool {
	return s.Status == ServerStatusRunning
}

// IsStopped returns true if the server is in stopped state
func (s *ServerInstance) IsStopped() bool {
	return s.Status == ServerStatusStopped
}

// IsTerminating returns true if the server is being deleted
func (s *ServerInstance) IsTerminating() bool {
	return s.Status == ServerStatusTerminating
}

// CanStart returns true if the server can be started
func (s *ServerInstance) CanStart() bool {
	return s.Status == ServerStatusStopped || s.Status == ServerStatusFailed
}

// CanStop returns true if the server can be stopped
func (s *ServerInstance) CanStop() bool {
	return s.Status == ServerStatusRunning
}

// CanDelete returns true if the server can be deleted
func (s *ServerInstance) CanDelete() bool {
	return s.Status == ServerStatusStopped || s.Status == ServerStatusFailed
}

// GetServerAddress returns the external address for connecting to the server
func (s *ServerInstance) GetServerAddress() string {
	// This would typically be the load balancer or ingress IP
	// For now, return a placeholder format
	return fmt.Sprintf("minecraft-%s.servers.example.com:%d", s.ID.String()[:8], s.ExternalPort)
}

// Value implements the driver.Valuer interface for ServerProperties
func (sp ServerProperties) Value() (driver.Value, error) {
	if sp == nil {
		return nil, nil
	}
	return json.Marshal(sp)
}

// Scan implements the sql.Scanner interface for ServerProperties
func (sp *ServerProperties) Scan(value interface{}) error {
	if value == nil {
		*sp = nil
		return nil
	}

	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, sp)
	case string:
		return json.Unmarshal([]byte(v), sp)
	default:
		return fmt.Errorf("cannot scan %T into ServerProperties", value)
	}
}

// Value implements the driver.Valuer interface for ResourceLimits
func (rl ResourceLimits) Value() (driver.Value, error) {
	return json.Marshal(rl)
}

// Scan implements the sql.Scanner interface for ResourceLimits
func (rl *ResourceLimits) Scan(value interface{}) error {
	if value == nil {
		return nil
	}

	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, rl)
	case string:
		return json.Unmarshal([]byte(v), rl)
	default:
		return fmt.Errorf("cannot scan %T into ResourceLimits", value)
	}
}

// CreateServerInstanceTable returns the SQL DDL for creating the server_instances table
func CreateServerInstanceTable() string {
	return `
CREATE TABLE IF NOT EXISTS server_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(50) NOT NULL,
    sku_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL,
    minecraft_version VARCHAR(20) NOT NULL,
    server_properties JSONB DEFAULT '{}',
    resource_limits JSONB NOT NULL,
    kubernetes_namespace VARCHAR(100) NOT NULL,
    external_port INTEGER NOT NULL,
    current_players INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL,
    last_backup_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT chk_status CHECK (status IN ('deploying', 'running', 'stopped', 'failed', 'terminating')),
    CONSTRAINT chk_external_port CHECK (external_port BETWEEN 1024 AND 65535),
    CONSTRAINT chk_current_players CHECK (current_players >= 0),
    CONSTRAINT chk_max_players CHECK (max_players BETWEEN 1 AND 100),
    CONSTRAINT chk_current_vs_max_players CHECK (current_players <= max_players),

    -- Indexes for performance
    INDEX idx_server_instances_tenant_id (tenant_id),
    INDEX idx_server_instances_name (name),
    INDEX idx_server_instances_status (status),
    INDEX idx_server_instances_created_at (created_at),
    UNIQUE INDEX idx_tenant_name (tenant_id, name),
    UNIQUE INDEX idx_tenant_port (tenant_id, external_port)
);

-- Row-level security for multi-tenant isolation
ALTER TABLE server_instances ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own tenant's servers
CREATE POLICY server_instances_tenant_isolation ON server_instances
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER update_server_instances_updated_at
    BEFORE UPDATE ON server_instances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
`
}

// DropServerInstanceTable returns the SQL DDL for dropping the server_instances table
func DropServerInstanceTable() string {
	return `
DROP TRIGGER IF EXISTS update_server_instances_updated_at ON server_instances;
DROP POLICY IF EXISTS server_instances_tenant_isolation ON server_instances;
DROP TABLE IF EXISTS server_instances CASCADE;
`
}

// isValidServerName validates server name format
func isValidServerName(name string) bool {
	if len(name) < 1 || len(name) > 50 {
		return false
	}
	// Alphanumeric characters and hyphens only
	serverNameRegex := regexp.MustCompile(`^[a-zA-Z0-9\-]+$`)
	return serverNameRegex.MatchString(name)
}

// isValidMinecraftVersion validates Minecraft version format
func isValidMinecraftVersion(version string) bool {
	// Match format like "1.20.1", "1.19", "1.20.1-pre1", etc.
	versionRegex := regexp.MustCompile(`^\d+\.\d+(\.\d+)?(-\w+)?$`)
	return versionRegex.MatchString(version)
}

// ServerInstanceCreateRequest represents the request payload for creating a server instance
type ServerInstanceCreateRequest struct {
	Name             string           `json:"name" validate:"required,min=1,max=50"`
	SkuID            uuid.UUID        `json:"sku_id" validate:"required"`
	MinecraftVersion string           `json:"minecraft_version" validate:"required"`
	ServerProperties ServerProperties `json:"server_properties,omitempty"`
	MaxPlayers       int              `json:"max_players,omitempty" validate:"omitempty,min=1,max=100"`
}

// ToServerInstance converts the create request to a ServerInstance model
func (r *ServerInstanceCreateRequest) ToServerInstance(tenantID uuid.UUID, resourceLimits ResourceLimits, externalPort int) *ServerInstance {
	maxPlayers := r.MaxPlayers
	if maxPlayers == 0 {
		maxPlayers = 20 // Default Minecraft server max players
	}

	return &ServerInstance{
		TenantID:         tenantID,
		Name:             r.Name,
		SkuID:            r.SkuID,
		MinecraftVersion: r.MinecraftVersion,
		ServerProperties: r.ServerProperties,
		ResourceLimits:   resourceLimits,
		ExternalPort:     externalPort,
		MaxPlayers:       maxPlayers,
		Status:           ServerStatusDeploying,
	}
}

// ServerInstanceUpdateRequest represents the request payload for updating a server instance
type ServerInstanceUpdateRequest struct {
	Name             *string           `json:"name,omitempty" validate:"omitempty,min=1,max=50"`
	MinecraftVersion *string           `json:"minecraft_version,omitempty" validate:"omitempty"`
	ServerProperties *ServerProperties `json:"server_properties,omitempty"`
	MaxPlayers       *int              `json:"max_players,omitempty" validate:"omitempty,min=1,max=100"`
}

// ApplyTo applies the update request to an existing ServerInstance
func (r *ServerInstanceUpdateRequest) ApplyTo(server *ServerInstance) {
	if r.Name != nil {
		server.Name = *r.Name
	}
	if r.MinecraftVersion != nil {
		server.MinecraftVersion = *r.MinecraftVersion
	}
	if r.ServerProperties != nil {
		server.ServerProperties = *r.ServerProperties
	}
	if r.MaxPlayers != nil {
		server.MaxPlayers = *r.MaxPlayers
	}
}

// ServerInstanceResponse represents the response payload for server instance operations
type ServerInstanceResponse struct {
	ID                  uuid.UUID        `json:"id"`
	TenantID            uuid.UUID        `json:"tenant_id"`
	Name                string           `json:"name"`
	SkuID               uuid.UUID        `json:"sku_id"`
	Status              ServerStatus     `json:"status"`
	MinecraftVersion    string           `json:"minecraft_version"`
	ServerProperties    ServerProperties `json:"server_properties"`
	ResourceLimits      ResourceLimits   `json:"resource_limits"`
	KubernetesNamespace string           `json:"kubernetes_namespace"`
	ExternalPort        int              `json:"external_port"`
	CurrentPlayers      int              `json:"current_players"`
	MaxPlayers          int              `json:"max_players"`
	ServerAddress       string           `json:"server_address"`
	LastBackupAt        *time.Time       `json:"last_backup_at"`
	CreatedAt           time.Time        `json:"created_at"`
	UpdatedAt           time.Time        `json:"updated_at"`
}

// FromServerInstance converts a ServerInstance model to a response payload
func (r *ServerInstanceResponse) FromServerInstance(server *ServerInstance) {
	r.ID = server.ID
	r.TenantID = server.TenantID
	r.Name = server.Name
	r.SkuID = server.SkuID
	r.Status = server.Status
	r.MinecraftVersion = server.MinecraftVersion
	r.ServerProperties = server.ServerProperties
	r.ResourceLimits = server.ResourceLimits
	r.KubernetesNamespace = server.KubernetesNamespace
	r.ExternalPort = server.ExternalPort
	r.CurrentPlayers = server.CurrentPlayers
	r.MaxPlayers = server.MaxPlayers
	r.ServerAddress = server.GetServerAddress()
	r.LastBackupAt = server.LastBackupAt
	r.CreatedAt = server.CreatedAt
	r.UpdatedAt = server.UpdatedAt
}

// NewServerInstanceResponse creates a new ServerInstanceResponse from a ServerInstance
func NewServerInstanceResponse(server *ServerInstance) *ServerInstanceResponse {
	response := &ServerInstanceResponse{}
	response.FromServerInstance(server)
	return response
}