package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"../models"
)

// PluginManager handles plugin installation, configuration, and lifecycle management
type PluginManager interface {
	// Plugin installation and removal
	InstallPlugin(ctx context.Context, request *PluginInstallRequest) (*PluginInstallResult, error)
	UninstallPlugin(ctx context.Context, serverID, pluginID uuid.UUID, options *PluginUninstallOptions) error
	UpdatePlugin(ctx context.Context, serverID, pluginID uuid.UUID, newVersion string) (*PluginUpdateResult, error)

	// Plugin configuration
	ConfigurePlugin(ctx context.Context, serverID, pluginID uuid.UUID, config models.ConfigOverrides) error
	GetPluginConfig(ctx context.Context, serverID, pluginID uuid.UUID) (models.ConfigOverrides, error)

	// Plugin discovery and validation
	SearchPlugins(ctx context.Context, query *PluginSearchQuery) (*PluginSearchResult, error)
	GetCompatiblePlugins(ctx context.Context, minecraftVersion string, serverID *uuid.UUID) ([]*models.PluginPackage, error)
	ValidatePluginCompatibility(ctx context.Context, pluginID uuid.UUID, serverID uuid.UUID) (*CompatibilityResult, error)

	// Dependency management
	ResolveDependencies(ctx context.Context, pluginIDs []uuid.UUID, minecraftVersion string) (*DependencyGraph, error)
	GetInstallOrder(ctx context.Context, dependencies *DependencyGraph) ([]uuid.UUID, error)
	CheckDependencyConflicts(ctx context.Context, serverID uuid.UUID, newPluginIDs []uuid.UUID) (*ConflictAnalysis, error)

	// Plugin status and monitoring
	GetPluginStatus(ctx context.Context, serverID, pluginID uuid.UUID) (*PluginStatusResult, error)
	GetServerPlugins(ctx context.Context, serverID uuid.UUID, filters *PluginFilters) ([]*models.ServerPluginInstallation, error)
	MonitorPluginInstallation(ctx context.Context, installationID uuid.UUID) <-chan *PluginInstallUpdate

	// Bulk operations
	BulkInstallPlugins(ctx context.Context, serverID uuid.UUID, plugins []BulkPluginRequest) (*BulkInstallResult, error)
	BulkUninstallPlugins(ctx context.Context, serverID uuid.UUID, pluginIDs []uuid.UUID) (*BulkUninstallResult, error)
}

// PluginInstallRequest represents a request to install a plugin
type PluginInstallRequest struct {
	ServerID        uuid.UUID                 `json:"server_id" validate:"required"`
	PluginID        uuid.UUID                 `json:"plugin_id" validate:"required"`
	ConfigOverrides models.ConfigOverrides    `json:"config_overrides,omitempty"`
	AutoDependencies bool                     `json:"auto_dependencies"`
	Force           bool                      `json:"force,omitempty"`
}

// PluginInstallResult represents the result of a plugin installation
type PluginInstallResult struct {
	InstallationID    uuid.UUID                            `json:"installation_id"`
	Status            models.InstallationStatus            `json:"status"`
	EstimatedTime     time.Duration                        `json:"estimated_time"`
	Dependencies      []uuid.UUID                          `json:"dependencies,omitempty"`
	RequiredRestart   bool                                 `json:"required_restart"`
}

// PluginUninstallOptions represents options for plugin uninstallation
type PluginUninstallOptions struct {
	RemoveConfig     bool   `json:"remove_config"`
	RemoveData       bool   `json:"remove_data"`
	Force            bool   `json:"force,omitempty"`
	SkipDependencies bool   `json:"skip_dependencies,omitempty"`
}

// PluginUpdateResult represents the result of a plugin update
type PluginUpdateResult struct {
	OldVersion      string                    `json:"old_version"`
	NewVersion      string                    `json:"new_version"`
	Status          models.InstallationStatus `json:"status"`
	RequiredRestart bool                      `json:"required_restart"`
	BreakingChanges []string                  `json:"breaking_changes,omitempty"`
}

// PluginSearchQuery represents search criteria for plugins
type PluginSearchQuery struct {
	Query            string                   `json:"query,omitempty"`
	Category         *models.PluginCategory   `json:"category,omitempty"`
	MinecraftVersion string                   `json:"minecraft_version,omitempty"`
	ApprovedOnly     bool                     `json:"approved_only"`
	SortBy           PluginSortBy             `json:"sort_by,omitempty"`
	SortOrder        SortOrder                `json:"sort_order,omitempty"`
	Limit            int                      `json:"limit,omitempty"`
	Offset           int                      `json:"offset,omitempty"`
}

// PluginSortBy represents plugin sorting options
type PluginSortBy string

const (
	PluginSortByName        PluginSortBy = "name"
	PluginSortByPopularity  PluginSortBy = "popularity"
	PluginSortByRating      PluginSortBy = "rating"
	PluginSortByUpdated     PluginSortBy = "updated"
	PluginSortByCreated     PluginSortBy = "created"
)

// SortOrder represents sort order
type SortOrder string

const (
	SortOrderAsc  SortOrder = "asc"
	SortOrderDesc SortOrder = "desc"
)

// PluginSearchResult represents plugin search results
type PluginSearchResult struct {
	Plugins    []*models.PluginPackage `json:"plugins"`
	Total      int                     `json:"total"`
	Page       int                     `json:"page"`
	PageSize   int                     `json:"page_size"`
	TotalPages int                     `json:"total_pages"`
}

// CompatibilityResult represents plugin compatibility check result
type CompatibilityResult struct {
	Compatible       bool              `json:"compatible"`
	Reason           string            `json:"reason,omitempty"`
	MinecraftCompat  bool              `json:"minecraft_compatible"`
	DependencyIssues []DependencyIssue `json:"dependency_issues,omitempty"`
	ResourceConflicts []ResourceConflict `json:"resource_conflicts,omitempty"`
}

// DependencyIssue represents a dependency-related issue
type DependencyIssue struct {
	Type         DependencyIssueType `json:"type"`
	PluginName   string              `json:"plugin_name"`
	RequiredVersion string           `json:"required_version,omitempty"`
	CurrentVersion  string           `json:"current_version,omitempty"`
	Message      string              `json:"message"`
}

// DependencyIssueType represents types of dependency issues
type DependencyIssueType string

const (
	DependencyIssueMissing    DependencyIssueType = "missing"
	DependencyIssueVersion    DependencyIssueType = "version_mismatch"
	DependencyIssueConflict   DependencyIssueType = "conflict"
	DependencyIssueCircular   DependencyIssueType = "circular"
)

// ResourceConflict represents a resource conflict
type ResourceConflict struct {
	Type        ResourceConflictType `json:"type"`
	Resource    string               `json:"resource"`
	ConflictWith string              `json:"conflict_with"`
	Message     string               `json:"message"`
}

// ResourceConflictType represents types of resource conflicts
type ResourceConflictType string

const (
	ResourceConflictCommand   ResourceConflictType = "command"
	ResourceConflictFile      ResourceConflictType = "file"
	ResourceConflictPermission ResourceConflictType = "permission"
	ResourceConflictPort      ResourceConflictType = "port"
)

// DependencyGraph represents plugin dependency relationships
type DependencyGraph struct {
	Nodes []DependencyNode `json:"nodes"`
	Edges []DependencyEdge `json:"edges"`
}

// DependencyNode represents a plugin in the dependency graph
type DependencyNode struct {
	PluginID uuid.UUID `json:"plugin_id"`
	Name     string    `json:"name"`
	Version  string    `json:"version"`
	Required bool      `json:"required"`
}

// DependencyEdge represents a dependency relationship
type DependencyEdge struct {
	From             uuid.UUID `json:"from"`
	To               uuid.UUID `json:"to"`
	VersionConstraint string   `json:"version_constraint"`
	Optional         bool      `json:"optional"`
}

// ConflictAnalysis represents analysis of plugin conflicts
type ConflictAnalysis struct {
	HasConflicts      bool                    `json:"has_conflicts"`
	Conflicts         []PluginConflict        `json:"conflicts"`
	Recommendations   []ConflictRecommendation `json:"recommendations"`
}

// PluginConflict represents a conflict between plugins
type PluginConflict struct {
	Type        ConflictType `json:"type"`
	Plugin1     string       `json:"plugin1"`
	Plugin2     string       `json:"plugin2"`
	Description string       `json:"description"`
	Severity    ConflictSeverity `json:"severity"`
}

// ConflictType represents types of plugin conflicts
type ConflictType string

const (
	ConflictTypeIncompatible  ConflictType = "incompatible"
	ConflictTypeDuplicate     ConflictType = "duplicate"
	ConflictTypeResource      ConflictType = "resource"
	ConflictTypeDependency    ConflictType = "dependency"
)

// ConflictSeverity represents conflict severity levels
type ConflictSeverity string

const (
	ConflictSeverityLow      ConflictSeverity = "low"
	ConflictSeverityMedium   ConflictSeverity = "medium"
	ConflictSeverityHigh     ConflictSeverity = "high"
	ConflictSeverityCritical ConflictSeverity = "critical"
)

// ConflictRecommendation represents a recommendation to resolve conflicts
type ConflictRecommendation struct {
	Type        RecommendationType `json:"type"`
	Description string             `json:"description"`
	PluginID    *uuid.UUID         `json:"plugin_id,omitempty"`
	Action      string             `json:"action"`
}

// RecommendationType represents types of recommendations
type RecommendationType string

const (
	RecommendationRemove  RecommendationType = "remove"
	RecommendationReplace RecommendationType = "replace"
	RecommendationUpdate  RecommendationType = "update"
	RecommendationConfig  RecommendationType = "configure"
)

// PluginStatusResult represents plugin status information
type PluginStatusResult struct {
	Installation     *models.ServerPluginInstallation `json:"installation"`
	RuntimeStatus    PluginRuntimeStatus              `json:"runtime_status"`
	ConfigStatus     ConfigValidationStatus           `json:"config_status"`
	DependencyStatus DependencyStatus                 `json:"dependency_status"`
	UpdateAvailable  bool                             `json:"update_available"`
	LatestVersion    string                           `json:"latest_version,omitempty"`
}

// PluginRuntimeStatus represents runtime status of a plugin
type PluginRuntimeStatus struct {
	Loaded    bool      `json:"loaded"`
	Enabled   bool      `json:"enabled"`
	Error     string    `json:"error,omitempty"`
	LastSeen  time.Time `json:"last_seen"`
	LoadTime  time.Duration `json:"load_time,omitempty"`
}

// ConfigValidationStatus represents configuration validation status
type ConfigValidationStatus struct {
	Valid   bool     `json:"valid"`
	Errors  []string `json:"errors,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

// DependencyStatus represents dependency status
type DependencyStatus struct {
	Satisfied    bool                `json:"satisfied"`
	Missing      []string            `json:"missing,omitempty"`
	Outdated     []OutdatedDependency `json:"outdated,omitempty"`
}

// OutdatedDependency represents an outdated dependency
type OutdatedDependency struct {
	Name           string `json:"name"`
	CurrentVersion string `json:"current_version"`
	RequiredVersion string `json:"required_version"`
}

// PluginFilters represents filters for querying server plugins
type PluginFilters struct {
	Status   *models.InstallationStatus `json:"status,omitempty"`
	Category *models.PluginCategory     `json:"category,omitempty"`
	Enabled  *bool                      `json:"enabled,omitempty"`
}

// PluginInstallUpdate represents real-time installation updates
type PluginInstallUpdate struct {
	InstallationID uuid.UUID                 `json:"installation_id"`
	Status         models.InstallationStatus `json:"status"`
	Progress       int                       `json:"progress"` // 0-100
	Message        string                    `json:"message"`
	Error          error                     `json:"error,omitempty"`
	Timestamp      time.Time                 `json:"timestamp"`
}

// BulkPluginRequest represents a plugin in a bulk operation
type BulkPluginRequest struct {
	PluginID        uuid.UUID                 `json:"plugin_id" validate:"required"`
	ConfigOverrides models.ConfigOverrides    `json:"config_overrides,omitempty"`
}

// BulkInstallResult represents the result of a bulk installation
type BulkInstallResult struct {
	TotalPlugins     int                       `json:"total_plugins"`
	SuccessfulInstalls []uuid.UUID             `json:"successful_installs"`
	FailedInstalls   []BulkOperationFailure    `json:"failed_installs"`
	EstimatedTime    time.Duration             `json:"estimated_time"`
}

// BulkUninstallResult represents the result of a bulk uninstallation
type BulkUninstallResult struct {
	TotalPlugins       int                    `json:"total_plugins"`
	SuccessfulRemovals []uuid.UUID            `json:"successful_removals"`
	FailedRemovals     []BulkOperationFailure `json:"failed_removals"`
}

// BulkOperationFailure represents a failure in bulk operations
type BulkOperationFailure struct {
	PluginID uuid.UUID `json:"plugin_id"`
	Error    string    `json:"error"`
}

// pluginManager implements PluginManager
type pluginManager struct {
	pluginRepo       models.PluginPackageRepository
	installationRepo models.ServerPluginInstallationRepository
	serverRepo       models.ServerInstanceRepository
	serverLifecycle  ServerLifecycleService
	k8sClient        KubernetesClient
	auditService     AuditService

	// Installation monitoring
	installUpdates   map[uuid.UUID][]chan *PluginInstallUpdate
	installMutex     sync.RWMutex

	// Configuration
	config *PluginManagerConfig
}

// PluginManagerConfig represents plugin manager configuration
type PluginManagerConfig struct {
	MaxConcurrentInstalls int           `json:"max_concurrent_installs"`
	InstallTimeout        time.Duration `json:"install_timeout"`
	EnableDependencyCheck bool          `json:"enable_dependency_check"`
	AllowUnapproved       bool          `json:"allow_unapproved"`
	DefaultRetentionDays  int           `json:"default_retention_days"`
}

// NewPluginManager creates a new plugin manager
func NewPluginManager(
	pluginRepo models.PluginPackageRepository,
	installationRepo models.ServerPluginInstallationRepository,
	serverRepo models.ServerInstanceRepository,
	serverLifecycle ServerLifecycleService,
	k8sClient KubernetesClient,
	auditService AuditService,
	config *PluginManagerConfig,
) PluginManager {
	return &pluginManager{
		pluginRepo:       pluginRepo,
		installationRepo: installationRepo,
		serverRepo:       serverRepo,
		serverLifecycle:  serverLifecycle,
		k8sClient:        k8sClient,
		auditService:     auditService,
		installUpdates:   make(map[uuid.UUID][]chan *PluginInstallUpdate),
		config:          config,
	}
}

// InstallPlugin implements plugin installation
func (pm *pluginManager) InstallPlugin(ctx context.Context, request *PluginInstallRequest) (*PluginInstallResult, error) {
	// Validate request
	if err := pm.validateInstallRequest(request); err != nil {
		return nil, fmt.Errorf("invalid install request: %w", err)
	}

	// Get server and plugin information
	server, err := pm.serverRepo.GetByID(ctx, request.ServerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	plugin, err := pm.pluginRepo.GetByID(ctx, request.PluginID)
	if err != nil {
		return nil, fmt.Errorf("failed to get plugin: %w", err)
	}

	// Check if plugin is already installed
	existing, err := pm.installationRepo.GetByServerAndPlugin(ctx, request.ServerID, request.PluginID)
	if err == nil && existing != nil {
		if existing.IsInstalled() {
			return nil, fmt.Errorf("plugin %s is already installed", plugin.Name)
		}
		if existing.IsInProgress() {
			return nil, fmt.Errorf("plugin %s installation is already in progress", plugin.Name)
		}
	}

	// Validate compatibility
	compatibility, err := pm.ValidatePluginCompatibility(ctx, request.PluginID, request.ServerID)
	if err != nil {
		return nil, fmt.Errorf("failed to validate compatibility: %w", err)
	}

	if !compatibility.Compatible && !request.Force {
		return nil, fmt.Errorf("plugin is not compatible: %s", compatibility.Reason)
	}

	// Resolve dependencies if auto-dependencies is enabled
	var dependencies []uuid.UUID
	if request.AutoDependencies {
		depGraph, err := pm.ResolveDependencies(ctx, []uuid.UUID{request.PluginID}, server.MinecraftVersion)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve dependencies: %w", err)
		}

		installOrder, err := pm.GetInstallOrder(ctx, depGraph)
		if err != nil {
			return nil, fmt.Errorf("failed to determine install order: %w", err)
		}

		// Remove the main plugin from dependencies list
		for _, depID := range installOrder {
			if depID != request.PluginID {
				dependencies = append(dependencies, depID)
			}
		}
	}

	// Create installation record
	installation := &models.ServerPluginInstallation{
		ServerID:        request.ServerID,
		PluginID:        request.PluginID,
		Status:          models.InstallationStatusInstalling,
		ConfigOverrides: request.ConfigOverrides,
	}

	if err := pm.installationRepo.Create(ctx, installation); err != nil {
		return nil, fmt.Errorf("failed to create installation record: %w", err)
	}

	// Install dependencies first
	if len(dependencies) > 0 {
		for _, depID := range dependencies {
			depRequest := &PluginInstallRequest{
				ServerID:        request.ServerID,
				PluginID:        depID,
				AutoDependencies: false, // Avoid recursive dependency resolution
				Force:           request.Force,
			}

			if _, err := pm.InstallPlugin(ctx, depRequest); err != nil {
				log.Printf("Failed to install dependency %s: %v", depID, err)
				// Continue with main plugin installation even if dependency fails
			}
		}
	}

	// Start installation process
	go pm.performInstallation(context.Background(), installation, plugin)

	// Audit log
	pm.auditService.LogServerAction(ctx, models.AuditActionPluginInstalled, request.ServerID, map[string]interface{}{
		"plugin_name":    plugin.Name,
		"plugin_version": plugin.Version,
		"dependencies":   dependencies,
	})

	// Build result
	result := &PluginInstallResult{
		InstallationID:  installation.ID,
		Status:          installation.Status,
		EstimatedTime:   pm.estimateInstallTime(plugin),
		Dependencies:    dependencies,
		RequiredRestart: pm.requiresRestart(plugin),
	}

	return result, nil
}

// UninstallPlugin implements plugin uninstallation
func (pm *pluginManager) UninstallPlugin(ctx context.Context, serverID, pluginID uuid.UUID, options *PluginUninstallOptions) error {
	installation, err := pm.installationRepo.GetByServerAndPlugin(ctx, serverID, pluginID)
	if err != nil {
		return fmt.Errorf("failed to get installation: %w", err)
	}

	if !installation.IsInstalled() {
		return fmt.Errorf("plugin is not installed")
	}

	plugin, err := pm.pluginRepo.GetByID(ctx, pluginID)
	if err != nil {
		return fmt.Errorf("failed to get plugin: %w", err)
	}

	// Check for dependent plugins if not skipping dependencies
	if options == nil || !options.SkipDependencies {
		dependents, err := pm.findDependentPlugins(ctx, serverID, pluginID)
		if err != nil {
			return fmt.Errorf("failed to check dependents: %w", err)
		}

		if len(dependents) > 0 && (options == nil || !options.Force) {
			return fmt.Errorf("cannot uninstall plugin: %d other plugins depend on it", len(dependents))
		}
	}

	// Update installation status
	installation.Status = models.InstallationStatusRemoving
	if err := pm.installationRepo.Update(ctx, installation); err != nil {
		return fmt.Errorf("failed to update installation status: %w", err)
	}

	// Perform uninstallation
	go pm.performUninstallation(context.Background(), installation, plugin, options)

	// Audit log
	pm.auditService.LogServerAction(ctx, models.AuditActionPluginUninstalled, serverID, map[string]interface{}{
		"plugin_name":    plugin.Name,
		"plugin_version": plugin.Version,
		"options":        options,
	})

	return nil
}

// UpdatePlugin implements plugin updates
func (pm *pluginManager) UpdatePlugin(ctx context.Context, serverID, pluginID uuid.UUID, newVersion string) (*PluginUpdateResult, error) {
	installation, err := pm.installationRepo.GetByServerAndPlugin(ctx, serverID, pluginID)
	if err != nil {
		return nil, fmt.Errorf("failed to get installation: %w", err)
	}

	if !installation.IsInstalled() {
		return nil, fmt.Errorf("plugin is not installed")
	}

	currentPlugin, err := pm.pluginRepo.GetByID(ctx, pluginID)
	if err != nil {
		return nil, fmt.Errorf("failed to get current plugin: %w", err)
	}

	// Find new version
	newPlugin, err := pm.pluginRepo.GetByNameAndVersion(ctx, currentPlugin.Name, newVersion)
	if err != nil {
		return nil, fmt.Errorf("failed to find new version: %w", err)
	}

	// Validate compatibility
	compatibility, err := pm.ValidatePluginCompatibility(ctx, newPlugin.ID, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to validate compatibility: %w", err)
	}

	if !compatibility.Compatible {
		return nil, fmt.Errorf("new version is not compatible: %s", compatibility.Reason)
	}

	// Update installation record
	installation.PluginID = newPlugin.ID
	installation.Status = models.InstallationStatusInstalling
	if err := pm.installationRepo.Update(ctx, installation); err != nil {
		return nil, fmt.Errorf("failed to update installation: %w", err)
	}

	// Perform update
	go pm.performUpdate(context.Background(), installation, currentPlugin, newPlugin)

	// Audit log
	pm.auditService.LogServerAction(ctx, models.AuditActionPluginUpdated, serverID, map[string]interface{}{
		"plugin_name":   currentPlugin.Name,
		"old_version":   currentPlugin.Version,
		"new_version":   newPlugin.Version,
	})

	result := &PluginUpdateResult{
		OldVersion:      currentPlugin.Version,
		NewVersion:      newPlugin.Version,
		Status:          installation.Status,
		RequiredRestart: pm.requiresRestart(newPlugin),
		BreakingChanges: pm.getBreakingChanges(currentPlugin, newPlugin),
	}

	return result, nil
}

// ConfigurePlugin implements plugin configuration
func (pm *pluginManager) ConfigurePlugin(ctx context.Context, serverID, pluginID uuid.UUID, config models.ConfigOverrides) error {
	installation, err := pm.installationRepo.GetByServerAndPlugin(ctx, serverID, pluginID)
	if err != nil {
		return fmt.Errorf("failed to get installation: %w", err)
	}

	if !installation.IsInstalled() {
		return fmt.Errorf("plugin is not installed")
	}

	// Validate configuration
	plugin, err := pm.pluginRepo.GetByID(ctx, pluginID)
	if err != nil {
		return fmt.Errorf("failed to get plugin: %w", err)
	}

	if err := pm.validatePluginConfig(plugin, config); err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}

	// Update configuration
	installation.ConfigOverrides = config
	if err := pm.installationRepo.Update(ctx, installation); err != nil {
		return fmt.Errorf("failed to update configuration: %w", err)
	}

	// Apply configuration to running server
	if err := pm.applyPluginConfig(ctx, serverID, pluginID, config); err != nil {
		return fmt.Errorf("failed to apply configuration: %w", err)
	}

	// Audit log
	pm.auditService.LogServerAction(ctx, models.AuditActionPluginConfigured, serverID, map[string]interface{}{
		"plugin_name": plugin.Name,
		"config":      config,
	})

	return nil
}

// GetPluginConfig returns plugin configuration
func (pm *pluginManager) GetPluginConfig(ctx context.Context, serverID, pluginID uuid.UUID) (models.ConfigOverrides, error) {
	installation, err := pm.installationRepo.GetByServerAndPlugin(ctx, serverID, pluginID)
	if err != nil {
		return nil, fmt.Errorf("failed to get installation: %w", err)
	}

	return installation.ConfigOverrides, nil
}

// SearchPlugins implements plugin search
func (pm *pluginManager) SearchPlugins(ctx context.Context, query *PluginSearchQuery) (*PluginSearchResult, error) {
	// Set defaults
	if query.Limit == 0 {
		query.Limit = 50
	}
	if query.SortBy == "" {
		query.SortBy = PluginSortByPopularity
	}
	if query.SortOrder == "" {
		query.SortOrder = SortOrderDesc
	}

	// Execute search based on query parameters
	var plugins []*models.PluginPackage
	var err error

	if query.Query != "" {
		plugins, err = pm.pluginRepo.SearchByName(ctx, query.Query, query.Limit, query.Offset)
	} else if query.MinecraftVersion != "" {
		plugins, err = pm.pluginRepo.GetByMinecraftVersion(ctx, query.MinecraftVersion, query.ApprovedOnly, query.Limit, query.Offset)
	} else {
		plugins, err = pm.pluginRepo.GetAll(ctx, query.Category, query.ApprovedOnly, query.Limit, query.Offset)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to search plugins: %w", err)
	}

	// Apply sorting
	pm.sortPlugins(plugins, query.SortBy, query.SortOrder)

	// Calculate pagination
	total := len(plugins) // In a real implementation, this would be a separate count query
	totalPages := (total + query.Limit - 1) / query.Limit
	page := (query.Offset / query.Limit) + 1

	result := &PluginSearchResult{
		Plugins:    plugins,
		Total:      total,
		Page:       page,
		PageSize:   query.Limit,
		TotalPages: totalPages,
	}

	return result, nil
}

// GetCompatiblePlugins returns plugins compatible with the given Minecraft version
func (pm *pluginManager) GetCompatiblePlugins(ctx context.Context, minecraftVersion string, serverID *uuid.UUID) ([]*models.PluginPackage, error) {
	plugins, err := pm.pluginRepo.GetByMinecraftVersion(ctx, minecraftVersion, true, 1000, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to get compatible plugins: %w", err)
	}

	// If server ID is provided, filter out already installed plugins
	if serverID != nil {
		installed, err := pm.installationRepo.GetByServer(ctx, *serverID, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to get installed plugins: %w", err)
		}

		installedMap := make(map[uuid.UUID]bool)
		for _, inst := range installed {
			if inst.IsInstalled() {
				installedMap[inst.PluginID] = true
			}
		}

		var filtered []*models.PluginPackage
		for _, plugin := range plugins {
			if !installedMap[plugin.ID] {
				filtered = append(filtered, plugin)
			}
		}
		plugins = filtered
	}

	return plugins, nil
}

// ValidatePluginCompatibility checks if a plugin is compatible with a server
func (pm *pluginManager) ValidatePluginCompatibility(ctx context.Context, pluginID uuid.UUID, serverID uuid.UUID) (*CompatibilityResult, error) {
	plugin, err := pm.pluginRepo.GetByID(ctx, pluginID)
	if err != nil {
		return nil, fmt.Errorf("failed to get plugin: %w", err)
	}

	server, err := pm.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	result := &CompatibilityResult{
		Compatible:      true,
		MinecraftCompat: plugin.IsCompatibleWith(server.MinecraftVersion),
	}

	// Check Minecraft version compatibility
	if !result.MinecraftCompat {
		result.Compatible = false
		result.Reason = fmt.Sprintf("Plugin requires Minecraft versions %v, server is running %s",
			plugin.MinecraftVersions, server.MinecraftVersion)
	}

	// Check if plugin is approved
	if !plugin.IsApproved && !pm.config.AllowUnapproved {
		result.Compatible = false
		result.Reason = "Plugin is not approved for installation"
	}

	// Check dependencies
	if plugin.HasDependencies() {
		depIssues, err := pm.checkDependencyIssues(ctx, serverID, plugin)
		if err != nil {
			return nil, fmt.Errorf("failed to check dependencies: %w", err)
		}

		if len(depIssues) > 0 {
			result.DependencyIssues = depIssues
			for _, issue := range depIssues {
				if issue.Type == DependencyIssueMissing || issue.Type == DependencyIssueVersion {
					result.Compatible = false
					if result.Reason == "" {
						result.Reason = "Dependency issues detected"
					}
				}
			}
		}
	}

	// Check resource conflicts
	conflicts, err := pm.checkResourceConflicts(ctx, serverID, plugin)
	if err != nil {
		return nil, fmt.Errorf("failed to check resource conflicts: %w", err)
	}

	if len(conflicts) > 0 {
		result.ResourceConflicts = conflicts
		result.Compatible = false
		if result.Reason == "" {
			result.Reason = "Resource conflicts detected"
		}
	}

	return result, nil
}

// ResolveDependencies builds a dependency graph for the given plugins
func (pm *pluginManager) ResolveDependencies(ctx context.Context, pluginIDs []uuid.UUID, minecraftVersion string) (*DependencyGraph, error) {
	graph := &DependencyGraph{
		Nodes: []DependencyNode{},
		Edges: []DependencyEdge{},
	}

	visited := make(map[uuid.UUID]bool)

	for _, pluginID := range pluginIDs {
		if err := pm.buildDependencyGraph(ctx, pluginID, minecraftVersion, graph, visited); err != nil {
			return nil, fmt.Errorf("failed to build dependency graph: %w", err)
		}
	}

	return graph, nil
}

// GetInstallOrder determines the correct order to install plugins based on dependencies
func (pm *pluginManager) GetInstallOrder(ctx context.Context, dependencies *DependencyGraph) ([]uuid.UUID, error) {
	// Topological sort to determine install order
	inDegree := make(map[uuid.UUID]int)
	adjacency := make(map[uuid.UUID][]uuid.UUID)

	// Initialize in-degree count
	for _, node := range dependencies.Nodes {
		inDegree[node.PluginID] = 0
		adjacency[node.PluginID] = []uuid.UUID{}
	}

	// Build adjacency list and calculate in-degrees
	for _, edge := range dependencies.Edges {
		adjacency[edge.From] = append(adjacency[edge.From], edge.To)
		inDegree[edge.To]++
	}

	// Kahn's algorithm
	queue := []uuid.UUID{}
	for pluginID, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, pluginID)
		}
	}

	var result []uuid.UUID
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		result = append(result, current)

		for _, neighbor := range adjacency[current] {
			inDegree[neighbor]--
			if inDegree[neighbor] == 0 {
				queue = append(queue, neighbor)
			}
		}
	}

	// Check for circular dependencies
	if len(result) != len(dependencies.Nodes) {
		return nil, errors.New("circular dependencies detected")
	}

	return result, nil
}

// CheckDependencyConflicts analyzes potential conflicts when installing new plugins
func (pm *pluginManager) CheckDependencyConflicts(ctx context.Context, serverID uuid.UUID, newPluginIDs []uuid.UUID) (*ConflictAnalysis, error) {
	analysis := &ConflictAnalysis{
		HasConflicts:    false,
		Conflicts:       []PluginConflict{},
		Recommendations: []ConflictRecommendation{},
	}

	// Get currently installed plugins
	installed, err := pm.installationRepo.GetByServer(ctx, serverID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get installed plugins: %w", err)
	}

	installedPlugins := make([]*models.PluginPackage, 0)
	for _, inst := range installed {
		if inst.IsInstalled() {
			plugin, err := pm.pluginRepo.GetByID(ctx, inst.PluginID)
			if err == nil {
				installedPlugins = append(installedPlugins, plugin)
			}
		}
	}

	// Get new plugins
	newPlugins := make([]*models.PluginPackage, 0)
	for _, pluginID := range newPluginIDs {
		plugin, err := pm.pluginRepo.GetByID(ctx, pluginID)
		if err == nil {
			newPlugins = append(newPlugins, plugin)
		}
	}

	// Check for conflicts between installed and new plugins
	for _, installed := range installedPlugins {
		for _, newPlugin := range newPlugins {
			conflicts := pm.detectPluginConflicts(installed, newPlugin)
			analysis.Conflicts = append(analysis.Conflicts, conflicts...)
		}
	}

	// Check for conflicts among new plugins
	for i, plugin1 := range newPlugins {
		for j, plugin2 := range newPlugins {
			if i != j {
				conflicts := pm.detectPluginConflicts(plugin1, plugin2)
				analysis.Conflicts = append(analysis.Conflicts, conflicts...)
			}
		}
	}

	analysis.HasConflicts = len(analysis.Conflicts) > 0

	// Generate recommendations
	if analysis.HasConflicts {
		analysis.Recommendations = pm.generateConflictRecommendations(analysis.Conflicts)
	}

	return analysis, nil
}

// Helper methods

func (pm *pluginManager) validateInstallRequest(request *PluginInstallRequest) error {
	if request.ServerID == uuid.Nil {
		return errors.New("server_id is required")
	}

	if request.PluginID == uuid.Nil {
		return errors.New("plugin_id is required")
	}

	return nil
}

func (pm *pluginManager) estimateInstallTime(plugin *models.PluginPackage) time.Duration {
	// Base installation time
	baseTime := 30 * time.Second

	// Add time for dependencies
	if plugin.HasDependencies() {
		baseTime += time.Duration(len(plugin.GetDependencyNames())) * 15 * time.Second
	}

	return baseTime
}

func (pm *pluginManager) requiresRestart(plugin *models.PluginPackage) bool {
	// In a real implementation, this would check plugin metadata
	// For now, assume certain plugin types require restart
	return plugin.Category == models.PluginCategoryPerformance
}

func (pm *pluginManager) performInstallation(ctx context.Context, installation *models.ServerPluginInstallation, plugin *models.PluginPackage) {
	// Simulate installation process
	pm.notifyInstallUpdate(installation.ID, &PluginInstallUpdate{
		InstallationID: installation.ID,
		Status:         models.InstallationStatusInstalling,
		Progress:       10,
		Message:        "Starting installation...",
		Timestamp:      time.Now().UTC(),
	})

	// Download plugin
	time.Sleep(2 * time.Second)
	pm.notifyInstallUpdate(installation.ID, &PluginInstallUpdate{
		InstallationID: installation.ID,
		Status:         models.InstallationStatusInstalling,
		Progress:       50,
		Message:        "Downloading plugin...",
		Timestamp:      time.Now().UTC(),
	})

	// Install plugin
	time.Sleep(2 * time.Second)
	pm.notifyInstallUpdate(installation.ID, &PluginInstallUpdate{
		InstallationID: installation.ID,
		Status:         models.InstallationStatusInstalling,
		Progress:       80,
		Message:        "Installing plugin...",
		Timestamp:      time.Now().UTC(),
	})

	// Complete installation
	installation.Status = models.InstallationStatusInstalled
	now := time.Now().UTC()
	installation.InstalledAt = &now

	if err := pm.installationRepo.Update(ctx, installation); err != nil {
		log.Printf("Failed to update installation status: %v", err)
		installation.Status = models.InstallationStatusFailed
		installation.ErrorMessage = err.Error()
		pm.installationRepo.Update(ctx, installation)
	}

	pm.notifyInstallUpdate(installation.ID, &PluginInstallUpdate{
		InstallationID: installation.ID,
		Status:         installation.Status,
		Progress:       100,
		Message:        "Installation completed",
		Timestamp:      time.Now().UTC(),
	})
}

func (pm *pluginManager) performUninstallation(ctx context.Context, installation *models.ServerPluginInstallation, plugin *models.PluginPackage, options *PluginUninstallOptions) {
	// Simulate uninstallation process
	time.Sleep(1 * time.Second)

	// Remove plugin
	if err := pm.installationRepo.Delete(ctx, installation.ID); err != nil {
		log.Printf("Failed to delete installation record: %v", err)
		installation.Status = models.InstallationStatusFailed
		installation.ErrorMessage = err.Error()
		pm.installationRepo.Update(ctx, installation)
	}
}

func (pm *pluginManager) performUpdate(ctx context.Context, installation *models.ServerPluginInstallation, oldPlugin, newPlugin *models.PluginPackage) {
	// Simulate update process
	time.Sleep(3 * time.Second)

	installation.Status = models.InstallationStatusInstalled
	now := time.Now().UTC()
	installation.InstalledAt = &now

	if err := pm.installationRepo.Update(ctx, installation); err != nil {
		log.Printf("Failed to update installation status: %v", err)
		installation.Status = models.InstallationStatusFailed
		installation.ErrorMessage = err.Error()
		pm.installationRepo.Update(ctx, installation)
	}
}

func (pm *pluginManager) validatePluginConfig(plugin *models.PluginPackage, config models.ConfigOverrides) error {
	// Basic validation - in a real implementation, this would be more comprehensive
	if len(config) > 100 {
		return errors.New("too many configuration options")
	}

	return nil
}

func (pm *pluginManager) applyPluginConfig(ctx context.Context, serverID, pluginID uuid.UUID, config models.ConfigOverrides) error {
	// In a real implementation, this would apply configuration to the running server
	// For now, just return success
	return nil
}

func (pm *pluginManager) sortPlugins(plugins []*models.PluginPackage, sortBy PluginSortBy, order SortOrder) {
	sort.Slice(plugins, func(i, j int) bool {
		var result bool

		switch sortBy {
		case PluginSortByName:
			result = plugins[i].Name < plugins[j].Name
		case PluginSortByUpdated:
			result = plugins[i].UpdatedAt.Before(plugins[j].UpdatedAt)
		case PluginSortByCreated:
			result = plugins[i].CreatedAt.Before(plugins[j].CreatedAt)
		default:
			// Default to name sorting
			result = plugins[i].Name < plugins[j].Name
		}

		if order == SortOrderDesc {
			result = !result
		}

		return result
	})
}

func (pm *pluginManager) checkDependencyIssues(ctx context.Context, serverID uuid.UUID, plugin *models.PluginPackage) ([]DependencyIssue, error) {
	var issues []DependencyIssue

	if !plugin.HasDependencies() {
		return issues, nil
	}

	// Get installed plugins
	installed, err := pm.installationRepo.GetByServer(ctx, serverID, nil)
	if err != nil {
		return nil, err
	}

	installedMap := make(map[string]*models.ServerPluginInstallation)
	for _, inst := range installed {
		if inst.IsInstalled() {
			p, err := pm.pluginRepo.GetByID(ctx, inst.PluginID)
			if err == nil {
				installedMap[p.Name] = inst
			}
		}
	}

	// Check each dependency
	for depName, versionSpec := range plugin.Dependencies {
		if inst, exists := installedMap[depName]; exists {
			// Check version compatibility
			depPlugin, err := pm.pluginRepo.GetByID(ctx, inst.PluginID)
			if err == nil {
				if !pm.isVersionCompatible(depPlugin.Version, versionSpec) {
					issues = append(issues, DependencyIssue{
						Type:            DependencyIssueVersion,
						PluginName:      depName,
						RequiredVersion: versionSpec,
						CurrentVersion:  depPlugin.Version,
						Message:         fmt.Sprintf("Installed version %s does not satisfy requirement %s", depPlugin.Version, versionSpec),
					})
				}
			}
		} else {
			// Missing dependency
			issues = append(issues, DependencyIssue{
				Type:            DependencyIssueMissing,
				PluginName:      depName,
				RequiredVersion: versionSpec,
				Message:         fmt.Sprintf("Required dependency %s is not installed", depName),
			})
		}
	}

	return issues, nil
}

func (pm *pluginManager) checkResourceConflicts(ctx context.Context, serverID uuid.UUID, plugin *models.PluginPackage) ([]ResourceConflict, error) {
	// In a real implementation, this would check for resource conflicts
	// For now, return empty slice
	return []ResourceConflict{}, nil
}

func (pm *pluginManager) buildDependencyGraph(ctx context.Context, pluginID uuid.UUID, minecraftVersion string, graph *DependencyGraph, visited map[uuid.UUID]bool) error {
	if visited[pluginID] {
		return nil
	}

	plugin, err := pm.pluginRepo.GetByID(ctx, pluginID)
	if err != nil {
		return err
	}

	// Add node to graph
	graph.Nodes = append(graph.Nodes, DependencyNode{
		PluginID: plugin.ID,
		Name:     plugin.Name,
		Version:  plugin.Version,
		Required: true,
	})

	visited[pluginID] = true

	// Process dependencies
	if plugin.HasDependencies() {
		for depName, versionSpec := range plugin.Dependencies {
			// Find dependency plugin (this is simplified - in reality we'd need better lookup)
			deps, err := pm.pluginRepo.SearchByName(ctx, depName, 1, 0)
			if err != nil || len(deps) == 0 {
				continue
			}

			dep := deps[0]

			// Add edge
			graph.Edges = append(graph.Edges, DependencyEdge{
				From:             plugin.ID,
				To:               dep.ID,
				VersionConstraint: versionSpec,
				Optional:         false,
			})

			// Recursively process dependency
			if err := pm.buildDependencyGraph(ctx, dep.ID, minecraftVersion, graph, visited); err != nil {
				return err
			}
		}
	}

	return nil
}

func (pm *pluginManager) findDependentPlugins(ctx context.Context, serverID uuid.UUID, pluginID uuid.UUID) ([]uuid.UUID, error) {
	// Get target plugin name
	targetPlugin, err := pm.pluginRepo.GetByID(ctx, pluginID)
	if err != nil {
		return nil, err
	}

	// Get all installed plugins
	installed, err := pm.installationRepo.GetByServer(ctx, serverID, nil)
	if err != nil {
		return nil, err
	}

	var dependents []uuid.UUID
	for _, inst := range installed {
		if inst.IsInstalled() && inst.PluginID != pluginID {
			plugin, err := pm.pluginRepo.GetByID(ctx, inst.PluginID)
			if err == nil {
				// Check if this plugin depends on the target plugin
				if plugin.HasDependencies() {
					if _, depends := plugin.Dependencies[targetPlugin.Name]; depends {
						dependents = append(dependents, plugin.ID)
					}
				}
			}
		}
	}

	return dependents, nil
}

func (pm *pluginManager) detectPluginConflicts(plugin1, plugin2 *models.PluginPackage) []PluginConflict {
	var conflicts []PluginConflict

	// Check for same plugin, different versions
	if plugin1.Name == plugin2.Name && plugin1.Version != plugin2.Version {
		conflicts = append(conflicts, PluginConflict{
			Type:        ConflictTypeDuplicate,
			Plugin1:     fmt.Sprintf("%s v%s", plugin1.Name, plugin1.Version),
			Plugin2:     fmt.Sprintf("%s v%s", plugin2.Name, plugin2.Version),
			Description: "Multiple versions of the same plugin",
			Severity:    ConflictSeverityHigh,
		})
	}

	// In a real implementation, this would check for other types of conflicts
	// such as resource conflicts, incompatible plugins, etc.

	return conflicts
}

func (pm *pluginManager) generateConflictRecommendations(conflicts []PluginConflict) []ConflictRecommendation {
	var recommendations []ConflictRecommendation

	for _, conflict := range conflicts {
		switch conflict.Type {
		case ConflictTypeDuplicate:
			recommendations = append(recommendations, ConflictRecommendation{
				Type:        RecommendationRemove,
				Description: "Remove older version of the plugin",
				Action:      "Remove conflicting plugin version",
			})
		}
	}

	return recommendations
}

func (pm *pluginManager) isVersionCompatible(currentVersion, requiredSpec string) bool {
	// Simplified version compatibility check
	// In a real implementation, this would parse semantic version constraints
	return currentVersion >= requiredSpec
}

func (pm *pluginManager) getBreakingChanges(oldPlugin, newPlugin *models.PluginPackage) []string {
	// In a real implementation, this would analyze plugin metadata for breaking changes
	var changes []string

	// Simple heuristic: major version change indicates breaking changes
	if len(oldPlugin.Version) > 0 && len(newPlugin.Version) > 0 {
		if oldPlugin.Version[0] != newPlugin.Version[0] {
			changes = append(changes, "Major version change - potential breaking changes")
		}
	}

	return changes
}

func (pm *pluginManager) notifyInstallUpdate(installationID uuid.UUID, update *PluginInstallUpdate) {
	pm.installMutex.RLock()
	channels := pm.installUpdates[installationID]
	pm.installMutex.RUnlock()

	for _, ch := range channels {
		select {
		case ch <- update:
		default:
			// Channel is full, skip this update
		}
	}
}

// GetPluginStatus returns detailed plugin status
func (pm *pluginManager) GetPluginStatus(ctx context.Context, serverID, pluginID uuid.UUID) (*PluginStatusResult, error) {
	installation, err := pm.installationRepo.GetByServerAndPlugin(ctx, serverID, pluginID)
	if err != nil {
		return nil, fmt.Errorf("failed to get installation: %w", err)
	}

	plugin, err := pm.pluginRepo.GetByID(ctx, pluginID)
	if err != nil {
		return nil, fmt.Errorf("failed to get plugin: %w", err)
	}

	result := &PluginStatusResult{
		Installation: installation,
		RuntimeStatus: PluginRuntimeStatus{
			Loaded:   installation.IsInstalled(),
			Enabled:  installation.IsInstalled(),
			LastSeen: installation.UpdatedAt,
		},
		ConfigStatus: ConfigValidationStatus{
			Valid: true, // Would validate configuration
		},
		DependencyStatus: DependencyStatus{
			Satisfied: true, // Would check dependencies
		},
		UpdateAvailable: false,   // Would check for updates
		LatestVersion:   plugin.Version,
	}

	return result, nil
}

// GetServerPlugins returns all plugins installed on a server
func (pm *pluginManager) GetServerPlugins(ctx context.Context, serverID uuid.UUID, filters *PluginFilters) ([]*models.ServerPluginInstallation, error) {
	var status *models.InstallationStatus
	if filters != nil {
		status = filters.Status
	}

	installations, err := pm.installationRepo.GetByServer(ctx, serverID, status)
	if err != nil {
		return nil, fmt.Errorf("failed to get server plugins: %w", err)
	}

	// Apply additional filters
	if filters != nil {
		var filtered []*models.ServerPluginInstallation
		for _, inst := range installations {
			include := true

			// Filter by enabled status
			if filters.Enabled != nil {
				enabled := inst.IsInstalled()
				if *filters.Enabled != enabled {
					include = false
				}
			}

			// Filter by category (would require loading plugin details)
			if filters.Category != nil {
				plugin, err := pm.pluginRepo.GetByID(ctx, inst.PluginID)
				if err == nil && plugin.Category != *filters.Category {
					include = false
				}
			}

			if include {
				filtered = append(filtered, inst)
			}
		}
		installations = filtered
	}

	return installations, nil
}

// MonitorPluginInstallation returns a channel for installation updates
func (pm *pluginManager) MonitorPluginInstallation(ctx context.Context, installationID uuid.UUID) <-chan *PluginInstallUpdate {
	ch := make(chan *PluginInstallUpdate, 10)

	pm.installMutex.Lock()
	pm.installUpdates[installationID] = append(pm.installUpdates[installationID], ch)
	pm.installMutex.Unlock()

	// Clean up when context is done
	go func() {
		<-ctx.Done()
		pm.installMutex.Lock()
		defer pm.installMutex.Unlock()

		if channels, exists := pm.installUpdates[installationID]; exists {
			for i, c := range channels {
				if c == ch {
					close(ch)
					pm.installUpdates[installationID] = append(channels[:i], channels[i+1:]...)
					break
				}
			}
		}
	}()

	return ch
}

// BulkInstallPlugins installs multiple plugins at once
func (pm *pluginManager) BulkInstallPlugins(ctx context.Context, serverID uuid.UUID, plugins []BulkPluginRequest) (*BulkInstallResult, error) {
	result := &BulkInstallResult{
		TotalPlugins:       len(plugins),
		SuccessfulInstalls: []uuid.UUID{},
		FailedInstalls:     []BulkOperationFailure{},
		EstimatedTime:      time.Duration(len(plugins)) * 30 * time.Second,
	}

	for _, pluginReq := range plugins {
		request := &PluginInstallRequest{
			ServerID:        serverID,
			PluginID:        pluginReq.PluginID,
			ConfigOverrides: pluginReq.ConfigOverrides,
			AutoDependencies: true,
		}

		if _, err := pm.InstallPlugin(ctx, request); err != nil {
			result.FailedInstalls = append(result.FailedInstalls, BulkOperationFailure{
				PluginID: pluginReq.PluginID,
				Error:    err.Error(),
			})
		} else {
			result.SuccessfulInstalls = append(result.SuccessfulInstalls, pluginReq.PluginID)
		}
	}

	return result, nil
}

// BulkUninstallPlugins removes multiple plugins at once
func (pm *pluginManager) BulkUninstallPlugins(ctx context.Context, serverID uuid.UUID, pluginIDs []uuid.UUID) (*BulkUninstallResult, error) {
	result := &BulkUninstallResult{
		TotalPlugins:       len(pluginIDs),
		SuccessfulRemovals: []uuid.UUID{},
		FailedRemovals:     []BulkOperationFailure{},
	}

	for _, pluginID := range pluginIDs {
		if err := pm.UninstallPlugin(ctx, serverID, pluginID, nil); err != nil {
			result.FailedRemovals = append(result.FailedRemovals, BulkOperationFailure{
				PluginID: pluginID,
				Error:    err.Error(),
			})
		} else {
			result.SuccessfulRemovals = append(result.SuccessfulRemovals, pluginID)
		}
	}

	return result, nil
}