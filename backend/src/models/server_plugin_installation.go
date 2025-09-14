package models

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// InstallationStatus represents the status of a plugin installation
type InstallationStatus string

const (
	InstallationStatusInstalling InstallationStatus = "installing"
	InstallationStatusInstalled  InstallationStatus = "installed"
	InstallationStatusFailed     InstallationStatus = "failed"
	InstallationStatusRemoving   InstallationStatus = "removing"
)

// IsValid checks if the installation status is valid
func (is InstallationStatus) IsValid() bool {
	switch is {
	case InstallationStatusInstalling, InstallationStatusInstalled, InstallationStatusFailed, InstallationStatusRemoving:
		return true
	default:
		return false
	}
}

// IsTerminal returns true if the status represents a final state
func (is InstallationStatus) IsTerminal() bool {
	return is == InstallationStatusInstalled || is == InstallationStatusFailed
}

// CanTransitionTo checks if transition to the target status is valid
func (is InstallationStatus) CanTransitionTo(target InstallationStatus) bool {
	switch is {
	case InstallationStatusInstalling:
		return target == InstallationStatusInstalled || target == InstallationStatusFailed
	case InstallationStatusInstalled:
		return target == InstallationStatusRemoving || target == InstallationStatusFailed
	case InstallationStatusFailed:
		return target == InstallationStatusInstalling || target == InstallationStatusRemoving
	case InstallationStatusRemoving:
		return false // Terminal state for removal
	default:
		return false
	}
}

// ConfigOverrides represents plugin-specific configuration overrides
type ConfigOverrides map[string]interface{}

// ServerPluginInstallation represents a junction table tracking installed plugins per server
type ServerPluginInstallation struct {
	ID              uuid.UUID           `json:"id" db:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	ServerID        uuid.UUID           `json:"server_id" db:"server_id" gorm:"type:uuid;not null;index" validate:"required"`
	PluginID        uuid.UUID           `json:"plugin_id" db:"plugin_id" gorm:"type:uuid;not null;index" validate:"required"`
	Status          InstallationStatus  `json:"status" db:"status" gorm:"not null" validate:"required"`
	ConfigOverrides ConfigOverrides     `json:"config_overrides" db:"config_overrides" gorm:"type:jsonb"`
	ErrorMessage    string              `json:"error_message,omitempty" db:"error_message" gorm:"type:text"`
	InstallationLog string              `json:"installation_log,omitempty" db:"installation_log" gorm:"type:text"`
	InstalledAt     *time.Time          `json:"installed_at,omitempty" db:"installed_at"`
	UpdatedAt       time.Time           `json:"updated_at" db:"updated_at" gorm:"autoUpdateTime"`
	CreatedAt       time.Time           `json:"created_at" db:"created_at" gorm:"autoCreateTime"`

	// Relationships (loaded separately)
	Server *ServerInstance `json:"server,omitempty" gorm:"foreignKey:ServerID"`
	Plugin *PluginPackage  `json:"plugin,omitempty" gorm:"foreignKey:PluginID"`
}

// ServerPluginInstallationRepository defines the interface for Server Plugin Installation data operations
type ServerPluginInstallationRepository interface {
	Create(ctx context.Context, installation *ServerPluginInstallation) error
	GetByID(ctx context.Context, id uuid.UUID) (*ServerPluginInstallation, error)
	GetByServerAndPlugin(ctx context.Context, serverID, pluginID uuid.UUID) (*ServerPluginInstallation, error)
	GetByServer(ctx context.Context, serverID uuid.UUID, status *InstallationStatus) ([]*ServerPluginInstallation, error)
	GetByPlugin(ctx context.Context, pluginID uuid.UUID, status *InstallationStatus) ([]*ServerPluginInstallation, error)
	Update(ctx context.Context, installation *ServerPluginInstallation) error
	UpdateStatus(ctx context.Context, id uuid.UUID, status InstallationStatus, errorMessage string) error
	Delete(ctx context.Context, id uuid.UUID) error
	DeleteByServerAndPlugin(ctx context.Context, serverID, pluginID uuid.UUID) error
	Exists(ctx context.Context, serverID, pluginID uuid.UUID) (bool, error)
	GetInstallationStats(ctx context.Context, pluginID uuid.UUID) (int, error)
}

// TableName returns the table name for GORM
func (ServerPluginInstallation) TableName() string {
	return "server_plugin_installations"
}

// Validate performs comprehensive validation on the ServerPluginInstallation
func (spi *ServerPluginInstallation) Validate() error {
	if spi.ServerID == uuid.Nil {
		return errors.New("server_id is required")
	}

	if spi.PluginID == uuid.Nil {
		return errors.New("plugin_id is required")
	}

	if !spi.Status.IsValid() {
		return fmt.Errorf("status must be one of: %s, %s, %s, %s",
			InstallationStatusInstalling, InstallationStatusInstalled, InstallationStatusFailed, InstallationStatusRemoving)
	}

	// Validate config overrides if provided
	if spi.ConfigOverrides != nil {
		if err := spi.validateConfigOverrides(); err != nil {
			return fmt.Errorf("config_overrides validation failed: %w", err)
		}
	}

	// Validate status-specific requirements
	if spi.Status == InstallationStatusFailed && spi.ErrorMessage == "" {
		return errors.New("error_message is required when status is failed")
	}

	if spi.Status == InstallationStatusInstalled && spi.InstalledAt == nil {
		return errors.New("installed_at is required when status is installed")
	}

	return nil
}

// validateConfigOverrides validates plugin configuration overrides
func (spi *ServerPluginInstallation) validateConfigOverrides() error {
	// Config overrides should be a reasonable size
	if len(spi.ConfigOverrides) > 100 {
		return errors.New("too many config overrides (max 100)")
	}

	for key, value := range spi.ConfigOverrides {
		// Key validation
		if key == "" {
			return errors.New("config override key cannot be empty")
		}

		if len(key) > 100 {
			return fmt.Errorf("config override key '%s' too long (max 100 characters)", key)
		}

		// Value type validation (allow basic JSON types)
		switch value.(type) {
		case nil, bool, string, int, int32, int64, float32, float64:
			// Valid basic types
		case []interface{}, map[string]interface{}:
			// Valid complex types
		default:
			return fmt.Errorf("config override value for key '%s' has unsupported type", key)
		}
	}

	return nil
}

// BeforeCreate is called before creating a new ServerPluginInstallation
func (spi *ServerPluginInstallation) BeforeCreate() error {
	if spi.ID == uuid.Nil {
		spi.ID = uuid.New()
	}

	now := time.Now().UTC()
	spi.CreatedAt = now
	spi.UpdatedAt = now

	// Set installed_at if status is installed
	if spi.Status == InstallationStatusInstalled && spi.InstalledAt == nil {
		spi.InstalledAt = &now
	}

	return spi.Validate()
}

// BeforeUpdate is called before updating a ServerPluginInstallation
func (spi *ServerPluginInstallation) BeforeUpdate() error {
	spi.UpdatedAt = time.Now().UTC()

	// Set installed_at when transitioning to installed
	if spi.Status == InstallationStatusInstalled && spi.InstalledAt == nil {
		now := time.Now().UTC()
		spi.InstalledAt = &now
	}

	return spi.Validate()
}

// UpdateStatus updates the installation status with optional error message
func (spi *ServerPluginInstallation) UpdateStatus(status InstallationStatus, errorMessage string) error {
	if !spi.Status.CanTransitionTo(status) {
		return fmt.Errorf("cannot transition from %s to %s", spi.Status, status)
	}

	spi.Status = status
	spi.ErrorMessage = errorMessage
	spi.UpdatedAt = time.Now().UTC()

	if status == InstallationStatusInstalled && spi.InstalledAt == nil {
		now := time.Now().UTC()
		spi.InstalledAt = &now
	}

	return spi.Validate()
}

// AppendToLog appends a message to the installation log
func (spi *ServerPluginInstallation) AppendToLog(message string) {
	if spi.InstallationLog == "" {
		spi.InstallationLog = message
	} else {
		spi.InstallationLog += "\n" + message
	}
}

// IsInstalled returns true if the plugin is successfully installed
func (spi *ServerPluginInstallation) IsInstalled() bool {
	return spi.Status == InstallationStatusInstalled
}

// IsFailed returns true if the installation failed
func (spi *ServerPluginInstallation) IsFailed() bool {
	return spi.Status == InstallationStatusFailed
}

// IsInProgress returns true if installation/removal is in progress
func (spi *ServerPluginInstallation) IsInProgress() bool {
	return spi.Status == InstallationStatusInstalling || spi.Status == InstallationStatusRemoving
}

// GetInstallationDuration returns the time taken to install the plugin
func (spi *ServerPluginInstallation) GetInstallationDuration() *time.Duration {
	if spi.InstalledAt == nil {
		return nil
	}

	duration := spi.InstalledAt.Sub(spi.CreatedAt)
	return &duration
}

// GetConfigValue returns a configuration override value by key
func (spi *ServerPluginInstallation) GetConfigValue(key string) (interface{}, bool) {
	if spi.ConfigOverrides == nil {
		return nil, false
	}

	value, exists := spi.ConfigOverrides[key]
	return value, exists
}

// SetConfigValue sets a configuration override value
func (spi *ServerPluginInstallation) SetConfigValue(key string, value interface{}) {
	if spi.ConfigOverrides == nil {
		spi.ConfigOverrides = make(ConfigOverrides)
	}
	spi.ConfigOverrides[key] = value
}

// RemoveConfigValue removes a configuration override
func (spi *ServerPluginInstallation) RemoveConfigValue(key string) {
	if spi.ConfigOverrides != nil {
		delete(spi.ConfigOverrides, key)
	}
}

// Value implements the driver.Valuer interface for ConfigOverrides
func (co ConfigOverrides) Value() (driver.Value, error) {
	if co == nil {
		return nil, nil
	}
	return json.Marshal(co)
}

// Scan implements the sql.Scanner interface for ConfigOverrides
func (co *ConfigOverrides) Scan(value interface{}) error {
	if value == nil {
		*co = nil
		return nil
	}

	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, co)
	case string:
		return json.Unmarshal([]byte(v), co)
	default:
		return fmt.Errorf("cannot scan %T into ConfigOverrides", value)
	}
}

// CreateServerPluginInstallationTable returns the SQL DDL for creating the server_plugin_installations table
func CreateServerPluginInstallationTable() string {
	return `
CREATE TABLE IF NOT EXISTS server_plugin_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL,
    plugin_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL,
    config_overrides JSONB DEFAULT '{}',
    error_message TEXT DEFAULT '',
    installation_log TEXT DEFAULT '',
    installed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Foreign key constraints
    FOREIGN KEY (server_id) REFERENCES server_instances(id) ON DELETE CASCADE,
    FOREIGN KEY (plugin_id) REFERENCES plugin_packages(id) ON DELETE CASCADE,

    -- Constraints
    CONSTRAINT chk_status_valid CHECK (status IN ('installing', 'installed', 'failed', 'removing')),
    CONSTRAINT chk_installed_at_required CHECK (
        (status = 'installed' AND installed_at IS NOT NULL) OR
        (status != 'installed')
    ),

    -- Unique constraint on server + plugin combination
    UNIQUE(server_id, plugin_id),

    -- Indexes for performance
    INDEX idx_server_plugin_installations_server_id (server_id),
    INDEX idx_server_plugin_installations_plugin_id (plugin_id),
    INDEX idx_server_plugin_installations_status (status),
    INDEX idx_server_plugin_installations_installed_at (installed_at),
    INDEX idx_server_plugin_installations_created_at (created_at)
);

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER update_server_plugin_installations_updated_at
    BEFORE UPDATE ON server_plugin_installations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
`
}

// DropServerPluginInstallationTable returns the SQL DDL for dropping the server_plugin_installations table
func DropServerPluginInstallationTable() string {
	return `
DROP TRIGGER IF EXISTS update_server_plugin_installations_updated_at ON server_plugin_installations;
DROP TABLE IF EXISTS server_plugin_installations CASCADE;
`
}

// ServerPluginInstallationCreateRequest represents the request payload for installing a plugin on a server
type ServerPluginInstallationCreateRequest struct {
	ServerID        uuid.UUID       `json:"server_id" validate:"required,uuid"`
	PluginID        uuid.UUID       `json:"plugin_id" validate:"required,uuid"`
	ConfigOverrides ConfigOverrides `json:"config_overrides,omitempty"`
}

// ToServerPluginInstallation converts the create request to a ServerPluginInstallation model
func (r *ServerPluginInstallationCreateRequest) ToServerPluginInstallation() *ServerPluginInstallation {
	return &ServerPluginInstallation{
		ServerID:        r.ServerID,
		PluginID:        r.PluginID,
		Status:          InstallationStatusInstalling, // Start in installing state
		ConfigOverrides: r.ConfigOverrides,
	}
}

// ServerPluginInstallationUpdateRequest represents the request payload for updating a plugin installation
type ServerPluginInstallationUpdateRequest struct {
	Status          *InstallationStatus `json:"status,omitempty"`
	ConfigOverrides *ConfigOverrides    `json:"config_overrides,omitempty"`
	ErrorMessage    *string             `json:"error_message,omitempty"`
}

// ApplyTo applies the update request to an existing ServerPluginInstallation
func (r *ServerPluginInstallationUpdateRequest) ApplyTo(installation *ServerPluginInstallation) error {
	if r.Status != nil {
		if err := installation.UpdateStatus(*r.Status, ""); err != nil {
			return err
		}
	}

	if r.ConfigOverrides != nil {
		installation.ConfigOverrides = *r.ConfigOverrides
	}

	if r.ErrorMessage != nil {
		installation.ErrorMessage = *r.ErrorMessage
	}

	return nil
}

// ServerPluginInstallationResponse represents the response payload for plugin installation operations
type ServerPluginInstallationResponse struct {
	ID                    uuid.UUID           `json:"id"`
	ServerID              uuid.UUID           `json:"server_id"`
	PluginID              uuid.UUID           `json:"plugin_id"`
	Status                InstallationStatus  `json:"status"`
	ConfigOverrides       ConfigOverrides     `json:"config_overrides"`
	ErrorMessage          string              `json:"error_message,omitempty"`
	InstallationLog       string              `json:"installation_log,omitempty"`
	InstalledAt           *time.Time          `json:"installed_at,omitempty"`
	UpdatedAt             time.Time           `json:"updated_at"`
	CreatedAt             time.Time           `json:"created_at"`
	IsInstalled           bool                `json:"is_installed"`
	IsFailed              bool                `json:"is_failed"`
	IsInProgress          bool                `json:"is_in_progress"`
	InstallationDuration  *time.Duration      `json:"installation_duration,omitempty"`

	// Embedded related objects (when requested)
	Server *ServerInstanceResponse `json:"server,omitempty"`
	Plugin *PluginPackageResponse  `json:"plugin,omitempty"`
}

// FromServerPluginInstallation converts a ServerPluginInstallation model to a response payload
func (r *ServerPluginInstallationResponse) FromServerPluginInstallation(installation *ServerPluginInstallation) {
	r.ID = installation.ID
	r.ServerID = installation.ServerID
	r.PluginID = installation.PluginID
	r.Status = installation.Status
	r.ConfigOverrides = installation.ConfigOverrides
	r.ErrorMessage = installation.ErrorMessage
	r.InstallationLog = installation.InstallationLog
	r.InstalledAt = installation.InstalledAt
	r.UpdatedAt = installation.UpdatedAt
	r.CreatedAt = installation.CreatedAt
	r.IsInstalled = installation.IsInstalled()
	r.IsFailed = installation.IsFailed()
	r.IsInProgress = installation.IsInProgress()
	r.InstallationDuration = installation.GetInstallationDuration()

	// Include related objects if they're loaded
	if installation.Server != nil {
		r.Server = NewServerInstanceResponse(installation.Server)
	}
	if installation.Plugin != nil {
		r.Plugin = NewPluginPackageResponse(installation.Plugin)
	}
}

// NewServerPluginInstallationResponse creates a new ServerPluginInstallationResponse from a ServerPluginInstallation
func NewServerPluginInstallationResponse(installation *ServerPluginInstallation) *ServerPluginInstallationResponse {
	response := &ServerPluginInstallationResponse{}
	response.FromServerPluginInstallation(installation)
	return response
}

// ServerPluginInstallationListResponse represents the response for listing server plugin installations
type ServerPluginInstallationListResponse struct {
	Installations []*ServerPluginInstallationResponse `json:"installations"`
	Total         int                                  `json:"total"`
	Page          int                                  `json:"page"`
	PageSize      int                                  `json:"page_size"`
	TotalPages    int                                  `json:"total_pages"`
}

// NewServerPluginInstallationListResponse creates a paginated response for plugin installations
func NewServerPluginInstallationListResponse(installations []*ServerPluginInstallation, total, page, pageSize int) *ServerPluginInstallationListResponse {
	responses := make([]*ServerPluginInstallationResponse, len(installations))
	for i, installation := range installations {
		responses[i] = NewServerPluginInstallationResponse(installation)
	}

	totalPages := (total + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}

	return &ServerPluginInstallationListResponse{
		Installations: responses,
		Total:         total,
		Page:          page,
		PageSize:      pageSize,
		TotalPages:    totalPages,
	}
}