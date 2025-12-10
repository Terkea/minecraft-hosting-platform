package models

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// PluginCategory represents the category of a plugin/mod package
type PluginCategory string

const (
	PluginCategoryUtility     PluginCategory = "utility"
	PluginCategoryGameplay    PluginCategory = "gameplay"
	PluginCategoryAdmin       PluginCategory = "admin"
	PluginCategoryPerformance PluginCategory = "performance"
)

// IsValid checks if the plugin category is valid
func (pc PluginCategory) IsValid() bool {
	switch pc {
	case PluginCategoryUtility, PluginCategoryGameplay, PluginCategoryAdmin, PluginCategoryPerformance:
		return true
	default:
		return false
	}
}

// Dependencies represents plugin dependencies as a map of plugin names to version requirements
type Dependencies map[string]string

// PluginPackage represents installable server extensions with version information and dependencies
type PluginPackage struct {
	ID                 uuid.UUID         `json:"id" db:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name               string            `json:"name" db:"name" gorm:"not null;index" validate:"required,min=1,max=100"`
	Version            string            `json:"version" db:"version" gorm:"not null" validate:"required,semantic_version"`
	MinecraftVersions  []string          `json:"minecraft_versions" db:"minecraft_versions" gorm:"type:text[]" validate:"required,min=1,dive,minecraft_version"`
	Description        string            `json:"description" db:"description" gorm:"type:text"`
	DownloadURL        string            `json:"download_url" db:"download_url" gorm:"not null" validate:"required,url,https"`
	FileHash           string            `json:"file_hash" db:"file_hash" gorm:"not null" validate:"required,min=32,max=128"`
	Dependencies       Dependencies      `json:"dependencies" db:"dependencies" gorm:"type:jsonb"`
	Category           PluginCategory    `json:"category" db:"category" gorm:"not null" validate:"required"`
	IsApproved         bool              `json:"is_approved" db:"is_approved" gorm:"default:false"`
	CreatedAt          time.Time         `json:"created_at" db:"created_at" gorm:"autoCreateTime"`
	UpdatedAt          time.Time         `json:"updated_at" db:"updated_at" gorm:"autoUpdateTime"`
}

// PluginPackageRepository defines the interface for Plugin Package data operations
type PluginPackageRepository interface {
	Create(ctx context.Context, plugin *PluginPackage) error
	GetByID(ctx context.Context, id uuid.UUID) (*PluginPackage, error)
	GetByNameAndVersion(ctx context.Context, name, version string) (*PluginPackage, error)
	GetAll(ctx context.Context, category *PluginCategory, approvedOnly bool, limit, offset int) ([]*PluginPackage, error)
	GetByMinecraftVersion(ctx context.Context, mcVersion string, approvedOnly bool, limit, offset int) ([]*PluginPackage, error)
	SearchByName(ctx context.Context, namePattern string, limit, offset int) ([]*PluginPackage, error)
	Update(ctx context.Context, plugin *PluginPackage) error
	Delete(ctx context.Context, id uuid.UUID) error
	SetApprovalStatus(ctx context.Context, id uuid.UUID, approved bool) error
	ExistsWithNameAndVersion(ctx context.Context, name, version string) (bool, error)
}

// TableName returns the table name for GORM
func (PluginPackage) TableName() string {
	return "plugin_packages"
}

// Validate performs comprehensive validation on the PluginPackage
func (p *PluginPackage) Validate() error {
	if p.Name == "" {
		return errors.New("name is required")
	}

	if len(p.Name) < 1 || len(p.Name) > 100 {
		return errors.New("name must be between 1 and 100 characters")
	}

	if p.Version == "" {
		return errors.New("version is required")
	}

	if !isValidSemanticVersion(p.Version) {
		return errors.New("version must follow semantic versioning (e.g., 1.2.3, 2.0.0-beta.1)")
	}

	if len(p.MinecraftVersions) == 0 {
		return errors.New("at least one minecraft version is required")
	}

	for _, mcVersion := range p.MinecraftVersions {
		if !isValidMinecraftVersion(mcVersion) {
			return fmt.Errorf("invalid minecraft version: %s", mcVersion)
		}
	}

	if p.DownloadURL == "" {
		return errors.New("download_url is required")
	}

	if !isValidHTTPSURL(p.DownloadURL) {
		return errors.New("download_url must be a valid HTTPS URL")
	}

	if p.FileHash == "" {
		return errors.New("file_hash is required")
	}

	if len(p.FileHash) < 32 || len(p.FileHash) > 128 {
		return errors.New("file_hash must be between 32 and 128 characters")
	}

	if !p.Category.IsValid() {
		return fmt.Errorf("category must be one of: %s, %s, %s, %s",
			PluginCategoryUtility, PluginCategoryGameplay, PluginCategoryAdmin, PluginCategoryPerformance)
	}

	// Validate dependencies
	if p.Dependencies != nil {
		if err := p.validateDependencies(); err != nil {
			return fmt.Errorf("dependencies validation failed: %w", err)
		}
	}

	return nil
}

// validateDependencies validates the plugin dependencies
func (p *PluginPackage) validateDependencies() error {
	for pluginName, versionSpec := range p.Dependencies {
		if pluginName == "" {
			return errors.New("dependency plugin name cannot be empty")
		}

		if len(pluginName) > 100 {
			return errors.New("dependency plugin name cannot exceed 100 characters")
		}

		if versionSpec == "" {
			return errors.New("dependency version specification cannot be empty")
		}

		// Version spec can be exact version, range, or constraint
		// Examples: "1.2.3", ">=1.0.0", "^1.2.0", "~1.2.3", "1.0.0 - 2.0.0"
		if !isValidVersionSpec(versionSpec) {
			return fmt.Errorf("invalid version specification for dependency %s: %s", pluginName, versionSpec)
		}

		// Prevent self-dependency
		if pluginName == p.Name {
			return errors.New("plugin cannot depend on itself")
		}
	}

	return nil
}

// BeforeCreate is called before creating a new PluginPackage
func (p *PluginPackage) BeforeCreate() error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}

	now := time.Now().UTC()
	p.CreatedAt = now
	p.UpdatedAt = now

	// Normalize data
	p.Name = strings.TrimSpace(p.Name)
	p.Version = strings.TrimSpace(p.Version)
	p.Description = strings.TrimSpace(p.Description)

	return p.Validate()
}

// BeforeUpdate is called before updating a PluginPackage
func (p *PluginPackage) BeforeUpdate() error {
	p.UpdatedAt = time.Now().UTC()

	// Normalize data
	p.Name = strings.TrimSpace(p.Name)
	p.Version = strings.TrimSpace(p.Version)
	p.Description = strings.TrimSpace(p.Description)

	return p.Validate()
}

// IsCompatibleWith checks if this plugin is compatible with the given Minecraft version
func (p *PluginPackage) IsCompatibleWith(minecraftVersion string) bool {
	for _, mcVersion := range p.MinecraftVersions {
		if mcVersion == minecraftVersion {
			return true
		}
	}
	return false
}

// GetDependencyNames returns a list of dependency plugin names
func (p *PluginPackage) GetDependencyNames() []string {
	if p.Dependencies == nil {
		return nil
	}

	names := make([]string, 0, len(p.Dependencies))
	for name := range p.Dependencies {
		names = append(names, name)
	}
	return names
}

// HasDependencies returns true if the plugin has any dependencies
func (p *PluginPackage) HasDependencies() bool {
	return p.Dependencies != nil && len(p.Dependencies) > 0
}

// GetUniqueKey returns a unique identifier for this plugin (name + version)
func (p *PluginPackage) GetUniqueKey() string {
	return fmt.Sprintf("%s@%s", p.Name, p.Version)
}

// Value implements the driver.Valuer interface for Dependencies
func (d Dependencies) Value() (driver.Value, error) {
	if d == nil {
		return nil, nil
	}
	return json.Marshal(d)
}

// Scan implements the sql.Scanner interface for Dependencies
func (d *Dependencies) Scan(value interface{}) error {
	if value == nil {
		*d = nil
		return nil
	}

	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, d)
	case string:
		return json.Unmarshal([]byte(v), d)
	default:
		return fmt.Errorf("cannot scan %T into Dependencies", value)
	}
}

// CreatePluginPackageTable returns the SQL DDL for creating the plugin_packages table
func CreatePluginPackageTable() string {
	return `
CREATE TABLE IF NOT EXISTS plugin_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    version VARCHAR(50) NOT NULL,
    minecraft_versions TEXT[] NOT NULL,
    description TEXT DEFAULT '',
    download_url TEXT NOT NULL,
    file_hash VARCHAR(128) NOT NULL,
    dependencies JSONB DEFAULT '{}',
    category VARCHAR(20) NOT NULL,
    is_approved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT chk_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 100),
    CONSTRAINT chk_version_length CHECK (char_length(version) >= 1 AND char_length(version) <= 50),
    CONSTRAINT chk_minecraft_versions_not_empty CHECK (array_length(minecraft_versions, 1) > 0),
    CONSTRAINT chk_download_url_https CHECK (download_url LIKE 'https://%'),
    CONSTRAINT chk_file_hash_length CHECK (char_length(file_hash) >= 32 AND char_length(file_hash) <= 128),
    CONSTRAINT chk_category_valid CHECK (category IN ('utility', 'gameplay', 'admin', 'performance')),

    -- Unique constraint on name + version combination
    UNIQUE(name, version),

    -- Indexes for performance
    INDEX idx_plugin_packages_name (name),
    INDEX idx_plugin_packages_category (category),
    INDEX idx_plugin_packages_is_approved (is_approved),
    INDEX idx_plugin_packages_minecraft_versions (minecraft_versions),
    INDEX idx_plugin_packages_created_at (created_at)
);

-- GIN index for full-text search on name and description
CREATE INDEX idx_plugin_packages_search ON plugin_packages
USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER update_plugin_packages_updated_at
    BEFORE UPDATE ON plugin_packages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert sample plugin packages for development/testing
INSERT INTO plugin_packages (name, version, minecraft_versions, description, download_url, file_hash, dependencies, category, is_approved) VALUES
('EssentialsX', '2.20.1', ARRAY['1.20.1', '1.20.2'], 'The essential plugin suite for Minecraft servers', 'https://github.com/EssentialsX/Essentials/releases/download/2.20.1/EssentialsX-2.20.1.jar', 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456', '{}', 'utility', true),
('WorldEdit', '7.2.15', ARRAY['1.19.4', '1.20.1', '1.20.2'], 'Fast world editing for builders, large builds and terraforming', 'https://dev.bukkit.org/projects/worldedit/files/4586090/download', 'b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567a', '{}', 'utility', true),
('Vault', '1.7.3', ARRAY['1.19.4', '1.20.1', '1.20.2'], 'Economy API for permissions and chat formatting', 'https://github.com/MilkBowl/Vault/releases/download/1.7.3/Vault.jar', 'c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab2', '{}', 'utility', true),
('LuckPerms', '5.4.102', ARRAY['1.19.4', '1.20.1', '1.20.2'], 'Advanced permissions plugin with web editor', 'https://download.luckperms.net/1515/bukkit/loader/LuckPerms-Bukkit-5.4.102.jar', 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab2c3', '{}', 'admin', true),
('ClearLag', '3.2.2', ARRAY['1.19.4', '1.20.1', '1.20.2'], 'Reduce lag by automatically clearing items and entities', 'https://dev.bukkit.org/projects/clearlagg/files/4456089/download', 'e5f6789012345678901234567890abcdef1234567890abcdef1234567ab2c3d4', '{}', 'performance', true)
ON CONFLICT (name, version) DO NOTHING;
`
}

// DropPluginPackageTable returns the SQL DDL for dropping the plugin_packages table
func DropPluginPackageTable() string {
	return `
DROP TRIGGER IF EXISTS update_plugin_packages_updated_at ON plugin_packages;
DROP INDEX IF EXISTS idx_plugin_packages_search;
DROP TABLE IF EXISTS plugin_packages CASCADE;
`
}

// isValidSemanticVersion validates semantic version format
func isValidSemanticVersion(version string) bool {
	// Semantic versioning regex: X.Y.Z with optional pre-release and build metadata
	semanticVersionRegex := regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$`)
	return semanticVersionRegex.MatchString(version)
}

// isValidVersionSpec validates version specification format (for dependencies)
func isValidVersionSpec(spec string) bool {
	// Version specifications can be:
	// - Exact: "1.2.3"
	// - Range: ">=1.0.0", "^1.2.0", "~1.2.3"
	// - Complex: ">=1.0.0 <2.0.0"

	// Simple patterns for common version specs
	patterns := []string{
		`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`,                                    // Exact version
		`^[><=~^]+\s*(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`,                       // Constraint
		`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\s*-\s*(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`, // Range
	}

	for _, pattern := range patterns {
		if matched, _ := regexp.MatchString(pattern, spec); matched {
			return true
		}
	}

	return false
}

// isValidHTTPSURL validates that a URL is HTTPS
func isValidHTTPSURL(urlStr string) bool {
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return false
	}
	return parsedURL.Scheme == "https" && parsedURL.Host != ""
}

// PluginPackageCreateRequest represents the request payload for creating a plugin package
type PluginPackageCreateRequest struct {
	Name               string            `json:"name" validate:"required,min=1,max=100"`
	Version            string            `json:"version" validate:"required,semantic_version"`
	MinecraftVersions  []string          `json:"minecraft_versions" validate:"required,min=1,dive,minecraft_version"`
	Description        string            `json:"description,omitempty"`
	DownloadURL        string            `json:"download_url" validate:"required,url,https"`
	FileHash           string            `json:"file_hash" validate:"required,min=32,max=128"`
	Dependencies       Dependencies      `json:"dependencies,omitempty"`
	Category           PluginCategory    `json:"category" validate:"required"`
}

// ToPluginPackage converts the create request to a PluginPackage model
func (r *PluginPackageCreateRequest) ToPluginPackage() *PluginPackage {
	return &PluginPackage{
		Name:               r.Name,
		Version:            r.Version,
		MinecraftVersions:  r.MinecraftVersions,
		Description:        r.Description,
		DownloadURL:        r.DownloadURL,
		FileHash:           r.FileHash,
		Dependencies:       r.Dependencies,
		Category:           r.Category,
		IsApproved:         false, // Default to false, requires admin approval
	}
}

// PluginPackageUpdateRequest represents the request payload for updating a plugin package
type PluginPackageUpdateRequest struct {
	Name               *string            `json:"name,omitempty" validate:"omitempty,min=1,max=100"`
	Version            *string            `json:"version,omitempty" validate:"omitempty,semantic_version"`
	MinecraftVersions  *[]string          `json:"minecraft_versions,omitempty" validate:"omitempty,min=1,dive,minecraft_version"`
	Description        *string            `json:"description,omitempty"`
	DownloadURL        *string            `json:"download_url,omitempty" validate:"omitempty,url,https"`
	FileHash           *string            `json:"file_hash,omitempty" validate:"omitempty,min=32,max=128"`
	Dependencies       *Dependencies      `json:"dependencies,omitempty"`
	Category           *PluginCategory    `json:"category,omitempty" validate:"omitempty"`
	IsApproved         *bool              `json:"is_approved,omitempty"`
}

// ApplyTo applies the update request to an existing PluginPackage
func (r *PluginPackageUpdateRequest) ApplyTo(plugin *PluginPackage) {
	if r.Name != nil {
		plugin.Name = *r.Name
	}
	if r.Version != nil {
		plugin.Version = *r.Version
	}
	if r.MinecraftVersions != nil {
		plugin.MinecraftVersions = *r.MinecraftVersions
	}
	if r.Description != nil {
		plugin.Description = *r.Description
	}
	if r.DownloadURL != nil {
		plugin.DownloadURL = *r.DownloadURL
	}
	if r.FileHash != nil {
		plugin.FileHash = *r.FileHash
	}
	if r.Dependencies != nil {
		plugin.Dependencies = *r.Dependencies
	}
	if r.Category != nil {
		plugin.Category = *r.Category
	}
	if r.IsApproved != nil {
		plugin.IsApproved = *r.IsApproved
	}
}

// PluginPackageResponse represents the response payload for plugin package operations
type PluginPackageResponse struct {
	ID                 uuid.UUID         `json:"id"`
	Name               string            `json:"name"`
	Version            string            `json:"version"`
	MinecraftVersions  []string          `json:"minecraft_versions"`
	Description        string            `json:"description"`
	DownloadURL        string            `json:"download_url"`
	FileHash           string            `json:"file_hash"`
	Dependencies       Dependencies      `json:"dependencies"`
	Category           PluginCategory    `json:"category"`
	IsApproved         bool              `json:"is_approved"`
	HasDependencies    bool              `json:"has_dependencies"`
	UniqueKey          string            `json:"unique_key"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

// FromPluginPackage converts a PluginPackage model to a response payload
func (r *PluginPackageResponse) FromPluginPackage(plugin *PluginPackage) {
	r.ID = plugin.ID
	r.Name = plugin.Name
	r.Version = plugin.Version
	r.MinecraftVersions = plugin.MinecraftVersions
	r.Description = plugin.Description
	r.DownloadURL = plugin.DownloadURL
	r.FileHash = plugin.FileHash
	r.Dependencies = plugin.Dependencies
	r.Category = plugin.Category
	r.IsApproved = plugin.IsApproved
	r.HasDependencies = plugin.HasDependencies()
	r.UniqueKey = plugin.GetUniqueKey()
	r.CreatedAt = plugin.CreatedAt
	r.UpdatedAt = plugin.UpdatedAt
}

// NewPluginPackageResponse creates a new PluginPackageResponse from a PluginPackage
func NewPluginPackageResponse(plugin *PluginPackage) *PluginPackageResponse {
	response := &PluginPackageResponse{}
	response.FromPluginPackage(plugin)
	return response
}