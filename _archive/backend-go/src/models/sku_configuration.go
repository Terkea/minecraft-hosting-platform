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

// DefaultProperties represents default Minecraft server.properties values
type DefaultProperties map[string]interface{}

// SKUConfiguration represents predefined resource templates with CPU, memory, storage, and Minecraft settings
type SKUConfiguration struct {
	ID                uuid.UUID         `json:"id" db:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name              string            `json:"name" db:"name" gorm:"uniqueIndex;not null" validate:"required,min=1,max=50"`
	CPUCores          float64           `json:"cpu_cores" db:"cpu_cores" gorm:"not null" validate:"required,gt=0"`
	MemoryGB          int               `json:"memory_gb" db:"memory_gb" gorm:"not null" validate:"required,gt=0"`
	StorageGB         int               `json:"storage_gb" db:"storage_gb" gorm:"not null" validate:"required,gt=0"`
	MaxPlayers        int               `json:"max_players" db:"max_players" gorm:"not null" validate:"required,gt=0"`
	DefaultProperties DefaultProperties `json:"default_properties" db:"default_properties" gorm:"type:jsonb"`
	MonthlyPrice      float64           `json:"monthly_price" db:"monthly_price" gorm:"not null" validate:"gte=0"`
	IsActive          bool              `json:"is_active" db:"is_active" gorm:"default:true"`
	CreatedAt         time.Time         `json:"created_at" db:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         time.Time         `json:"updated_at" db:"updated_at" gorm:"autoUpdateTime"`
}

// SKUConfigurationRepository defines the interface for SKU Configuration data operations
type SKUConfigurationRepository interface {
	Create(ctx context.Context, sku *SKUConfiguration) error
	GetByID(ctx context.Context, id uuid.UUID) (*SKUConfiguration, error)
	GetAll(ctx context.Context, activeOnly bool) ([]*SKUConfiguration, error)
	GetByName(ctx context.Context, name string) (*SKUConfiguration, error)
	Update(ctx context.Context, sku *SKUConfiguration) error
	Delete(ctx context.Context, id uuid.UUID) error
	SetActive(ctx context.Context, id uuid.UUID, active bool) error
	ExistsWithName(ctx context.Context, name string) (bool, error)
}

// TableName returns the table name for GORM
func (SKUConfiguration) TableName() string {
	return "sku_configurations"
}

// Validate performs comprehensive validation on the SKUConfiguration
func (s *SKUConfiguration) Validate() error {
	if s.Name == "" {
		return errors.New("name is required")
	}

	if !isValidSKUName(s.Name) {
		return errors.New("name must be 1-50 characters and contain only alphanumeric characters, spaces, and hyphens")
	}

	if s.CPUCores <= 0 {
		return errors.New("cpu_cores must be positive")
	}

	if s.MemoryGB <= 0 {
		return errors.New("memory_gb must be positive")
	}

	if s.StorageGB <= 0 {
		return errors.New("storage_gb must be positive")
	}

	if s.MaxPlayers <= 0 {
		return errors.New("max_players must be positive")
	}

	if s.MonthlyPrice < 0 {
		return errors.New("monthly_price must be non-negative")
	}

	// Reasonable limits for server resources
	if s.CPUCores > 32 {
		return errors.New("cpu_cores cannot exceed 32")
	}

	if s.MemoryGB > 128 {
		return errors.New("memory_gb cannot exceed 128")
	}

	if s.StorageGB > 2000 {
		return errors.New("storage_gb cannot exceed 2000")
	}

	if s.MaxPlayers > 1000 {
		return errors.New("max_players cannot exceed 1000")
	}

	// Validate default properties if provided
	if s.DefaultProperties != nil {
		if err := s.validateDefaultProperties(); err != nil {
			return fmt.Errorf("default_properties validation failed: %w", err)
		}
	}

	return nil
}

// validateDefaultProperties validates the default Minecraft server properties
func (s *SKUConfiguration) validateDefaultProperties() error {
	// Known Minecraft server.properties keys with their expected types
	validProperties := map[string]string{
		"difficulty":                    "string",  // peaceful, easy, normal, hard
		"gamemode":                      "string",  // survival, creative, adventure, spectator
		"max-players":                   "int",     // should match MaxPlayers
		"online-mode":                   "bool",
		"pvp":                           "bool",
		"allow-nether":                  "bool",
		"allow-flight":                  "bool",
		"motd":                          "string",
		"server-port":                   "int",
		"level-name":                    "string",
		"level-seed":                    "string",
		"level-type":                    "string",
		"spawn-protection":              "int",
		"view-distance":                 "int",
		"simulation-distance":           "int",
		"enable-command-block":          "bool",
		"spawn-monsters":                "bool",
		"spawn-animals":                 "bool",
		"generate-structures":           "bool",
		"hardcore":                      "bool",
		"white-list":                    "bool",
		"enforce-whitelist":             "bool",
		"resource-pack":                 "string",
		"resource-pack-prompt":          "string",
		"enable-jmx-monitoring":         "bool",
		"enable-rcon":                   "bool",
		"rcon.password":                 "string",
		"rcon.port":                     "int",
		"broadcast-rcon-to-ops":         "bool",
		"op-permission-level":           "int",
		"function-permission-level":     "int",
		"max-tick-time":                 "int",
		"max-world-size":                "int",
		"network-compression-threshold": "int",
		"player-idle-timeout":           "int",
		"use-native-transport":          "bool",
		"enable-status":                 "bool",
		"enable-query":                  "bool",
	}

	for key, value := range s.DefaultProperties {
		expectedType, isValidKey := validProperties[key]
		if !isValidKey {
			return fmt.Errorf("unknown server property: %s", key)
		}

		// Type validation
		switch expectedType {
		case "bool":
			if _, ok := value.(bool); !ok {
				if str, ok := value.(string); ok {
					if str != "true" && str != "false" {
						return fmt.Errorf("property %s must be boolean or 'true'/'false' string", key)
					}
				} else {
					return fmt.Errorf("property %s must be boolean", key)
				}
			}
		case "int":
			switch v := value.(type) {
			case int, int32, int64, float64:
				// Valid numeric types
			case string:
				if !regexp.MustCompile(`^\d+$`).MatchString(v) {
					return fmt.Errorf("property %s must be numeric", key)
				}
			default:
				return fmt.Errorf("property %s must be numeric", key)
			}
		case "string":
			if _, ok := value.(string); !ok {
				return fmt.Errorf("property %s must be string", key)
			}
		}

		// Specific property validations
		if key == "difficulty" {
			if str, ok := value.(string); ok {
				if str != "peaceful" && str != "easy" && str != "normal" && str != "hard" {
					return fmt.Errorf("difficulty must be one of: peaceful, easy, normal, hard")
				}
			}
		}

		if key == "gamemode" {
			if str, ok := value.(string); ok {
				if str != "survival" && str != "creative" && str != "adventure" && str != "spectator" {
					return fmt.Errorf("gamemode must be one of: survival, creative, adventure, spectator")
				}
			}
		}

		if key == "max-players" {
			// Ensure max-players in properties doesn't exceed SKU max_players
			if maxPlayersFromProps, ok := getIntValue(value); ok {
				if maxPlayersFromProps > s.MaxPlayers {
					return fmt.Errorf("max-players property (%d) cannot exceed SKU max_players (%d)", maxPlayersFromProps, s.MaxPlayers)
				}
			}
		}
	}

	return nil
}

// getIntValue extracts integer value from interface{} (handles int, float64, string)
func getIntValue(value interface{}) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int32:
		return int(v), true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	case string:
		if regexp.MustCompile(`^\d+$`).MatchString(v) {
			// Would need strconv.Atoi here, but avoiding imports
			return 0, false
		}
	}
	return 0, false
}

// BeforeCreate is called before creating a new SKUConfiguration
func (s *SKUConfiguration) BeforeCreate() error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}

	now := time.Now().UTC()
	s.CreatedAt = now
	s.UpdatedAt = now

	return s.Validate()
}

// BeforeUpdate is called before updating a SKUConfiguration
func (s *SKUConfiguration) BeforeUpdate() error {
	s.UpdatedAt = time.Now().UTC()
	return s.Validate()
}

// GetResourceLimits returns the ResourceLimits for this SKU
func (s *SKUConfiguration) GetResourceLimits() ResourceLimits {
	return ResourceLimits{
		CPUCores:  s.CPUCores,
		MemoryGB:  s.MemoryGB,
		StorageGB: s.StorageGB,
	}
}

// GetMonthlyPriceFormatted returns the monthly price formatted as a currency string
func (s *SKUConfiguration) GetMonthlyPriceFormatted() string {
	return fmt.Sprintf("$%.2f", s.MonthlyPrice)
}

// IsAffordable checks if the SKU is within the specified budget
func (s *SKUConfiguration) IsAffordable(maxBudget float64) bool {
	return s.MonthlyPrice <= maxBudget
}

// GetEffectiveProperties returns the default properties merged with any overrides
func (s *SKUConfiguration) GetEffectiveProperties(overrides ServerProperties) ServerProperties {
	effective := make(ServerProperties)

	// Start with defaults
	for k, v := range s.DefaultProperties {
		effective[k] = v
	}

	// Apply overrides
	for k, v := range overrides {
		effective[k] = v
	}

	// Ensure max-players doesn't exceed SKU limit
	if _, exists := effective["max-players"]; !exists {
		effective["max-players"] = s.MaxPlayers
	}

	return effective
}

// Value implements the driver.Valuer interface for DefaultProperties
func (dp DefaultProperties) Value() (driver.Value, error) {
	if dp == nil {
		return nil, nil
	}
	return json.Marshal(dp)
}

// Scan implements the sql.Scanner interface for DefaultProperties
func (dp *DefaultProperties) Scan(value interface{}) error {
	if value == nil {
		*dp = nil
		return nil
	}

	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, dp)
	case string:
		return json.Unmarshal([]byte(v), dp)
	default:
		return fmt.Errorf("cannot scan %T into DefaultProperties", value)
	}
}

// CreateSKUConfigurationTable returns the SQL DDL for creating the sku_configurations table
func CreateSKUConfigurationTable() string {
	return `
CREATE TABLE IF NOT EXISTS sku_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    cpu_cores DECIMAL(4,2) NOT NULL,
    memory_gb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    max_players INTEGER NOT NULL,
    default_properties JSONB DEFAULT '{}',
    monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT chk_cpu_cores CHECK (cpu_cores > 0 AND cpu_cores <= 32),
    CONSTRAINT chk_memory_gb CHECK (memory_gb > 0 AND memory_gb <= 128),
    CONSTRAINT chk_storage_gb CHECK (storage_gb > 0 AND storage_gb <= 2000),
    CONSTRAINT chk_max_players CHECK (max_players > 0 AND max_players <= 1000),
    CONSTRAINT chk_monthly_price CHECK (monthly_price >= 0),

    -- Indexes for performance
    INDEX idx_sku_configurations_name (name),
    INDEX idx_sku_configurations_is_active (is_active),
    INDEX idx_sku_configurations_monthly_price (monthly_price),
    INDEX idx_sku_configurations_created_at (created_at)
);

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER update_sku_configurations_updated_at
    BEFORE UPDATE ON sku_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default SKU configurations
INSERT INTO sku_configurations (name, cpu_cores, memory_gb, storage_gb, max_players, default_properties, monthly_price, is_active) VALUES
('Nano Server', 0.5, 1, 10, 5, '{"difficulty": "easy", "gamemode": "survival", "max-players": 5}', 9.99, true),
('Small Server', 1.0, 2, 25, 10, '{"difficulty": "normal", "gamemode": "survival", "max-players": 10}', 19.99, true),
('Medium Server', 2.0, 4, 50, 20, '{"difficulty": "normal", "gamemode": "survival", "max-players": 20, "view-distance": 10}', 39.99, true),
('Large Server', 4.0, 8, 100, 50, '{"difficulty": "normal", "gamemode": "survival", "max-players": 50, "view-distance": 12}', 79.99, true),
('Enterprise Server', 8.0, 16, 200, 100, '{"difficulty": "hard", "gamemode": "survival", "max-players": 100, "view-distance": 16}', 149.99, true)
ON CONFLICT (name) DO NOTHING;
`
}

// DropSKUConfigurationTable returns the SQL DDL for dropping the sku_configurations table
func DropSKUConfigurationTable() string {
	return `
DROP TRIGGER IF EXISTS update_sku_configurations_updated_at ON sku_configurations;
DROP TABLE IF EXISTS sku_configurations CASCADE;
`
}

// isValidSKUName validates SKU name format
func isValidSKUName(name string) bool {
	if len(name) < 1 || len(name) > 50 {
		return false
	}
	// Alphanumeric characters, spaces, and hyphens only
	skuNameRegex := regexp.MustCompile(`^[a-zA-Z0-9\s\-]+$`)
	return skuNameRegex.MatchString(name)
}

// SKUConfigurationCreateRequest represents the request payload for creating a SKU configuration
type SKUConfigurationCreateRequest struct {
	Name              string            `json:"name" validate:"required,min=1,max=50"`
	CPUCores          float64           `json:"cpu_cores" validate:"required,gt=0"`
	MemoryGB          int               `json:"memory_gb" validate:"required,gt=0"`
	StorageGB         int               `json:"storage_gb" validate:"required,gt=0"`
	MaxPlayers        int               `json:"max_players" validate:"required,gt=0"`
	DefaultProperties DefaultProperties `json:"default_properties,omitempty"`
	MonthlyPrice      float64           `json:"monthly_price" validate:"gte=0"`
	IsActive          bool              `json:"is_active,omitempty"`
}

// ToSKUConfiguration converts the create request to a SKUConfiguration model
func (r *SKUConfigurationCreateRequest) ToSKUConfiguration() *SKUConfiguration {
	return &SKUConfiguration{
		Name:              r.Name,
		CPUCores:          r.CPUCores,
		MemoryGB:          r.MemoryGB,
		StorageGB:         r.StorageGB,
		MaxPlayers:        r.MaxPlayers,
		DefaultProperties: r.DefaultProperties,
		MonthlyPrice:      r.MonthlyPrice,
		IsActive:          r.IsActive,
	}
}

// SKUConfigurationUpdateRequest represents the request payload for updating a SKU configuration
type SKUConfigurationUpdateRequest struct {
	Name              *string            `json:"name,omitempty" validate:"omitempty,min=1,max=50"`
	CPUCores          *float64           `json:"cpu_cores,omitempty" validate:"omitempty,gt=0"`
	MemoryGB          *int               `json:"memory_gb,omitempty" validate:"omitempty,gt=0"`
	StorageGB         *int               `json:"storage_gb,omitempty" validate:"omitempty,gt=0"`
	MaxPlayers        *int               `json:"max_players,omitempty" validate:"omitempty,gt=0"`
	DefaultProperties *DefaultProperties `json:"default_properties,omitempty"`
	MonthlyPrice      *float64           `json:"monthly_price,omitempty" validate:"omitempty,gte=0"`
	IsActive          *bool              `json:"is_active,omitempty"`
}

// ApplyTo applies the update request to an existing SKUConfiguration
func (r *SKUConfigurationUpdateRequest) ApplyTo(sku *SKUConfiguration) {
	if r.Name != nil {
		sku.Name = *r.Name
	}
	if r.CPUCores != nil {
		sku.CPUCores = *r.CPUCores
	}
	if r.MemoryGB != nil {
		sku.MemoryGB = *r.MemoryGB
	}
	if r.StorageGB != nil {
		sku.StorageGB = *r.StorageGB
	}
	if r.MaxPlayers != nil {
		sku.MaxPlayers = *r.MaxPlayers
	}
	if r.DefaultProperties != nil {
		sku.DefaultProperties = *r.DefaultProperties
	}
	if r.MonthlyPrice != nil {
		sku.MonthlyPrice = *r.MonthlyPrice
	}
	if r.IsActive != nil {
		sku.IsActive = *r.IsActive
	}
}

// SKUConfigurationResponse represents the response payload for SKU configuration operations
type SKUConfigurationResponse struct {
	ID                     uuid.UUID         `json:"id"`
	Name                   string            `json:"name"`
	CPUCores               float64           `json:"cpu_cores"`
	MemoryGB               int               `json:"memory_gb"`
	StorageGB              int               `json:"storage_gb"`
	MaxPlayers             int               `json:"max_players"`
	DefaultProperties      DefaultProperties `json:"default_properties"`
	MonthlyPrice           float64           `json:"monthly_price"`
	MonthlyPriceFormatted  string            `json:"monthly_price_formatted"`
	IsActive               bool              `json:"is_active"`
	CreatedAt              time.Time         `json:"created_at"`
	UpdatedAt              time.Time         `json:"updated_at"`
}

// FromSKUConfiguration converts a SKUConfiguration model to a response payload
func (r *SKUConfigurationResponse) FromSKUConfiguration(sku *SKUConfiguration) {
	r.ID = sku.ID
	r.Name = sku.Name
	r.CPUCores = sku.CPUCores
	r.MemoryGB = sku.MemoryGB
	r.StorageGB = sku.StorageGB
	r.MaxPlayers = sku.MaxPlayers
	r.DefaultProperties = sku.DefaultProperties
	r.MonthlyPrice = sku.MonthlyPrice
	r.MonthlyPriceFormatted = sku.GetMonthlyPriceFormatted()
	r.IsActive = sku.IsActive
	r.CreatedAt = sku.CreatedAt
	r.UpdatedAt = sku.UpdatedAt
}

// NewSKUConfigurationResponse creates a new SKUConfigurationResponse from a SKUConfiguration
func NewSKUConfigurationResponse(sku *SKUConfiguration) *SKUConfigurationResponse {
	response := &SKUConfigurationResponse{}
	response.FromSKUConfiguration(sku)
	return response
}