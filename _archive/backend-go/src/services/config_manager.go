package services

import (
	"context"
	"fmt"
	"time"

	"minecraft-platform/src/models"
)

// ConfigManagerService handles zero-downtime configuration updates
type ConfigManagerService struct {
	serverLifecycle   *ServerLifecycleService
	kubernetesClient  KubernetesClient // Interface for K8s operations
	validationService ConfigValidationService
	rollbackTimeout   time.Duration
	maxRollbackHistory int
}

// KubernetesClient interface for Kubernetes operations
type KubernetesClient interface {
	UpdateConfigMap(ctx context.Context, namespace, name string, data map[string]string) error
	RolloutRestart(ctx context.Context, namespace, deploymentName string) error
	WaitForRollout(ctx context.Context, namespace, deploymentName string, timeout time.Duration) error
	GetDeploymentStatus(ctx context.Context, namespace, deploymentName string) (*DeploymentStatus, error)
}

// ConfigValidationService interface for configuration validation
type ConfigValidationService interface {
	ValidateServerConfig(config *ServerConfig) error
	ValidatePluginConfig(pluginID string, config map[string]interface{}) error
	ValidateResourceLimits(config *ResourceConfig) error
}

// DeploymentStatus represents the status of a Kubernetes deployment
type DeploymentStatus struct {
	Ready     bool   `json:"ready"`
	Replicas  int    `json:"replicas"`
	Available int    `json:"available"`
	Updated   int    `json:"updated"`
	Status    string `json:"status"`
}

// NewConfigManagerService creates a new config manager service
func NewConfigManagerService(serverLifecycle *ServerLifecycleService, k8sClient KubernetesClient, validator ConfigValidationService) *ConfigManagerService {
	return &ConfigManagerService{
		serverLifecycle:    serverLifecycle,
		kubernetesClient:   k8sClient,
		validationService:  validator,
		rollbackTimeout:    5 * time.Minute,
		maxRollbackHistory: 10,
	}
}

// ConfigUpdateRequest represents a configuration update request
type ConfigUpdateRequest struct {
	ServerID      string                 `json:"server_id"`
	TenantID      string                 `json:"tenant_id"`
	ConfigChanges map[string]interface{} `json:"config_changes"`
	Reason        string                 `json:"reason,omitempty"`
	ValidateOnly  bool                   `json:"validate_only,omitempty"`
	RollbackOnError bool                 `json:"rollback_on_error,omitempty"`
	Options       map[string]interface{} `json:"options,omitempty"`
}

// ConfigUpdateResult represents the result of a configuration update
type ConfigUpdateResult struct {
	UpdateID     string                 `json:"update_id"`
	ServerID     string                 `json:"server_id"`
	Status       string                 `json:"status"`
	Message      string                 `json:"message,omitempty"`
	Changes      map[string]interface{} `json:"changes"`
	RollbackID   string                 `json:"rollback_id,omitempty"`
	ValidationErrors []string           `json:"validation_errors,omitempty"`
	StartedAt    time.Time              `json:"started_at"`
	CompletedAt  *time.Time             `json:"completed_at,omitempty"`
}

// ServerConfig represents the full server configuration
type ServerConfig struct {
	ServerProperties map[string]interface{} `json:"server_properties"`
	JVMArgs          []string               `json:"jvm_args"`
	ResourceLimits   *ResourceConfig        `json:"resource_limits"`
	PluginConfigs    map[string]interface{} `json:"plugin_configs,omitempty"`
	Environment      map[string]string      `json:"environment,omitempty"`
}

// ResourceConfig represents resource limit configuration
type ResourceConfig struct {
	CPULimit      string `json:"cpu_limit"`      // e.g., "2000m"
	MemoryLimit   string `json:"memory_limit"`   // e.g., "4Gi"
	CPURequest    string `json:"cpu_request"`    // e.g., "1000m"
	MemoryRequest string `json:"memory_request"` // e.g., "2Gi"
}

// ConfigChangeHistory represents a configuration change record
type ConfigChangeHistory struct {
	ID           string                 `json:"id"`
	ServerID     string                 `json:"server_id"`
	TenantID     string                 `json:"tenant_id"`
	Changes      map[string]interface{} `json:"changes"`
	PreviousConfig map[string]interface{} `json:"previous_config"`
	Status       string                 `json:"status"`
	Reason       string                 `json:"reason,omitempty"`
	CreatedBy    string                 `json:"created_by,omitempty"`
	CreatedAt    time.Time              `json:"created_at"`
	AppliedAt    *time.Time             `json:"applied_at,omitempty"`
	RolledBackAt *time.Time             `json:"rolled_back_at,omitempty"`
}

// UpdateServerConfiguration updates server configuration with zero downtime
func (cms *ConfigManagerService) UpdateServerConfiguration(ctx context.Context, req *ConfigUpdateRequest) (*ConfigUpdateResult, error) {
	if req.TenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if req.ServerID == "" {
		return nil, fmt.Errorf("server_id is required")
	}
	if len(req.ConfigChanges) == 0 {
		return nil, fmt.Errorf("config_changes cannot be empty")
	}

	updateID := fmt.Sprintf("config-update-%s-%d", req.ServerID, time.Now().Unix())

	// Validate server exists and is accessible to tenant
	server, err := cms.serverLifecycle.GetServer(ctx, req.ServerID, req.TenantID)
	if err != nil {
		return nil, fmt.Errorf("server not found: %w", err)
	}

	// Get current server configuration
	currentConfig, err := cms.getCurrentServerConfig(ctx, req.ServerID, req.TenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to get current config: %w", err)
	}

	// Apply changes to current configuration
	newConfig := cms.mergeConfigChanges(currentConfig, req.ConfigChanges)

	// Validate new configuration
	validationErrors := cms.validateConfiguration(newConfig)
	if len(validationErrors) > 0 {
		result := &ConfigUpdateResult{
			UpdateID:         updateID,
			ServerID:         req.ServerID,
			Status:           "validation_failed",
			Changes:          req.ConfigChanges,
			ValidationErrors: validationErrors,
			StartedAt:        time.Now(),
		}
		return result, nil
	}

	// If validate_only is true, return validation result without applying
	if req.ValidateOnly {
		result := &ConfigUpdateResult{
			UpdateID:  updateID,
			ServerID:  req.ServerID,
			Status:    "validation_passed",
			Message:   "Configuration validation passed",
			Changes:   req.ConfigChanges,
			StartedAt: time.Now(),
		}
		return result, nil
	}

	// Create configuration history record
	historyRecord := &ConfigChangeHistory{
		ID:             updateID,
		ServerID:       req.ServerID,
		TenantID:       req.TenantID,
		Changes:        req.ConfigChanges,
		PreviousConfig: cms.configToMap(currentConfig),
		Status:         "applying",
		Reason:         req.Reason,
		CreatedAt:      time.Now(),
	}

	// Apply configuration changes
	err = cms.applyConfigurationChanges(ctx, server, newConfig)
	if err != nil {
		historyRecord.Status = "failed"
		if req.RollbackOnError {
			rollbackErr := cms.rollbackConfiguration(ctx, server, currentConfig)
			if rollbackErr != nil {
				return nil, fmt.Errorf("config update failed and rollback failed: update=%w, rollback=%w", err, rollbackErr)
			}
			historyRecord.Status = "rolled_back"
		}

		result := &ConfigUpdateResult{
			UpdateID:  updateID,
			ServerID:  req.ServerID,
			Status:    historyRecord.Status,
			Message:   err.Error(),
			Changes:   req.ConfigChanges,
			StartedAt: historyRecord.CreatedAt,
		}
		return result, nil
	}

	// Wait for deployment to be ready
	err = cms.waitForConfigurationApplied(ctx, server.Namespace, server.DeploymentName)
	if err != nil {
		if req.RollbackOnError {
			rollbackErr := cms.rollbackConfiguration(ctx, server, currentConfig)
			if rollbackErr != nil {
				return nil, fmt.Errorf("config update failed and rollback failed: update=%w, rollback=%w", err, rollbackErr)
			}
			historyRecord.Status = "rolled_back"
		} else {
			historyRecord.Status = "failed"
		}

		result := &ConfigUpdateResult{
			UpdateID:  updateID,
			ServerID:  req.ServerID,
			Status:    historyRecord.Status,
			Message:   fmt.Sprintf("Configuration applied but deployment failed: %v", err),
			Changes:   req.ConfigChanges,
			StartedAt: historyRecord.CreatedAt,
		}
		return result, nil
	}

	// Mark as successfully applied
	now := time.Now()
	historyRecord.Status = "applied"
	historyRecord.AppliedAt = &now

	result := &ConfigUpdateResult{
		UpdateID:    updateID,
		ServerID:    req.ServerID,
		Status:      "applied",
		Message:     "Configuration updated successfully",
		Changes:     req.ConfigChanges,
		StartedAt:   historyRecord.CreatedAt,
		CompletedAt: &now,
	}

	return result, nil
}

// RollbackConfiguration rolls back to a previous configuration
func (cms *ConfigManagerService) RollbackConfiguration(ctx context.Context, serverID, tenantID, historyID string) (*ConfigUpdateResult, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if serverID == "" {
		return nil, fmt.Errorf("server_id is required")
	}
	if historyID == "" {
		return nil, fmt.Errorf("history_id is required")
	}

	// Get configuration history record
	historyRecord, err := cms.getConfigurationHistory(ctx, historyID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("configuration history not found: %w", err)
	}

	if historyRecord.ServerID != serverID {
		return nil, fmt.Errorf("configuration history does not belong to server %s", serverID)
	}

	// Convert previous config back to ServerConfig
	previousConfig, err := cms.mapToServerConfig(historyRecord.PreviousConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to parse previous configuration: %w", err)
	}

	// Create rollback request
	rollbackReq := &ConfigUpdateRequest{
		ServerID:      serverID,
		TenantID:      tenantID,
		ConfigChanges: historyRecord.PreviousConfig,
		Reason:        fmt.Sprintf("Rollback to configuration from %s", historyRecord.CreatedAt.Format("2006-01-02 15:04:05")),
	}

	// Apply the rollback
	result, err := cms.UpdateServerConfiguration(ctx, rollbackReq)
	if err != nil {
		return nil, err
	}

	// Mark original history record as rolled back
	now := time.Now()
	historyRecord.RolledBackAt = &now

	// Update result to indicate this was a rollback
	result.Message = fmt.Sprintf("Configuration rolled back to %s", historyRecord.CreatedAt.Format("2006-01-02 15:04:05"))

	return result, nil
}

// GetConfigurationHistory gets the configuration change history for a server
func (cms *ConfigManagerService) GetConfigurationHistory(ctx context.Context, serverID, tenantID string, limit int) ([]*ConfigChangeHistory, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if serverID == "" {
		return nil, fmt.Errorf("server_id is required")
	}

	if limit <= 0 {
		limit = 20 // Default limit
	}

	// TODO: Implement database query to get configuration history
	// For now, return empty history
	return []*ConfigChangeHistory{}, nil
}

// GetCurrentConfiguration gets the current server configuration
func (cms *ConfigManagerService) GetCurrentConfiguration(ctx context.Context, serverID, tenantID string) (*ServerConfig, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if serverID == "" {
		return nil, fmt.Errorf("server_id is required")
	}

	// Validate server exists and is accessible to tenant
	_, err := cms.serverLifecycle.GetServer(ctx, serverID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("server not found: %w", err)
	}

	return cms.getCurrentServerConfig(ctx, serverID, tenantID)
}

// Helper methods

func (cms *ConfigManagerService) getCurrentServerConfig(ctx context.Context, serverID, tenantID string) (*ServerConfig, error) {
	// TODO: Implement fetching current configuration from Kubernetes ConfigMaps
	// For now, return a mock configuration
	return &ServerConfig{
		ServerProperties: map[string]interface{}{
			"server-port": 25565,
			"max-players": 20,
			"difficulty": "normal",
		},
		JVMArgs: []string{"-Xmx2G", "-Xms1G"},
		ResourceLimits: &ResourceConfig{
			CPULimit:      "2000m",
			MemoryLimit:   "4Gi",
			CPURequest:    "1000m",
			MemoryRequest: "2Gi",
		},
	}, nil
}

func (cms *ConfigManagerService) mergeConfigChanges(current *ServerConfig, changes map[string]interface{}) *ServerConfig {
	// Create a deep copy of current configuration
	newConfig := &ServerConfig{
		ServerProperties: make(map[string]interface{}),
		JVMArgs:          make([]string, len(current.JVMArgs)),
		ResourceLimits:   &ResourceConfig{},
		PluginConfigs:    make(map[string]interface{}),
		Environment:      make(map[string]string),
	}

	// Copy current values
	for k, v := range current.ServerProperties {
		newConfig.ServerProperties[k] = v
	}
	copy(newConfig.JVMArgs, current.JVMArgs)
	if current.ResourceLimits != nil {
		*newConfig.ResourceLimits = *current.ResourceLimits
	}

	// Apply changes
	for key, value := range changes {
		switch key {
		case "server_properties":
			if props, ok := value.(map[string]interface{}); ok {
				for propKey, propValue := range props {
					newConfig.ServerProperties[propKey] = propValue
				}
			}
		case "jvm_args":
			if args, ok := value.([]string); ok {
				newConfig.JVMArgs = args
			}
		case "resource_limits":
			if limits, ok := value.(map[string]interface{}); ok {
				if cpuLimit, exists := limits["cpu_limit"]; exists {
					if str, ok := cpuLimit.(string); ok {
						newConfig.ResourceLimits.CPULimit = str
					}
				}
				if memLimit, exists := limits["memory_limit"]; exists {
					if str, ok := memLimit.(string); ok {
						newConfig.ResourceLimits.MemoryLimit = str
					}
				}
			}
		}
	}

	return newConfig
}

func (cms *ConfigManagerService) validateConfiguration(config *ServerConfig) []string {
	var errors []string

	// Validate with validation service
	if err := cms.validationService.ValidateServerConfig(config); err != nil {
		errors = append(errors, err.Error())
	}

	if config.ResourceLimits != nil {
		if err := cms.validationService.ValidateResourceLimits(config.ResourceLimits); err != nil {
			errors = append(errors, err.Error())
		}
	}

	return errors
}

func (cms *ConfigManagerService) applyConfigurationChanges(ctx context.Context, server *models.ServerInstance, config *ServerConfig) error {
	// Convert configuration to Kubernetes ConfigMap data
	configMapData := cms.serverConfigToConfigMapData(config)

	// Update ConfigMap
	err := cms.kubernetesClient.UpdateConfigMap(ctx, server.Namespace, fmt.Sprintf("%s-config", server.ID), configMapData)
	if err != nil {
		return fmt.Errorf("failed to update ConfigMap: %w", err)
	}

	// Trigger deployment restart to pick up new configuration
	err = cms.kubernetesClient.RolloutRestart(ctx, server.Namespace, server.DeploymentName)
	if err != nil {
		return fmt.Errorf("failed to restart deployment: %w", err)
	}

	return nil
}

func (cms *ConfigManagerService) rollbackConfiguration(ctx context.Context, server *models.ServerInstance, config *ServerConfig) error {
	return cms.applyConfigurationChanges(ctx, server, config)
}

func (cms *ConfigManagerService) waitForConfigurationApplied(ctx context.Context, namespace, deploymentName string) error {
	return cms.kubernetesClient.WaitForRollout(ctx, namespace, deploymentName, cms.rollbackTimeout)
}

func (cms *ConfigManagerService) serverConfigToConfigMapData(config *ServerConfig) map[string]string {
	data := make(map[string]string)

	// Convert server properties to properties file format
	// TODO: Implement proper properties file serialization
	data["server.properties"] = "# Generated configuration"
	data["jvm.args"] = fmt.Sprintf("%v", config.JVMArgs)

	return data
}

func (cms *ConfigManagerService) configToMap(config *ServerConfig) map[string]interface{} {
	return map[string]interface{}{
		"server_properties": config.ServerProperties,
		"jvm_args":          config.JVMArgs,
		"resource_limits":   config.ResourceLimits,
		"plugin_configs":    config.PluginConfigs,
		"environment":       config.Environment,
	}
}

func (cms *ConfigManagerService) mapToServerConfig(data map[string]interface{}) (*ServerConfig, error) {
	config := &ServerConfig{
		ServerProperties: make(map[string]interface{}),
		PluginConfigs:    make(map[string]interface{}),
		Environment:      make(map[string]string),
	}

	// TODO: Implement proper map to struct conversion
	// For now, return a basic configuration

	return config, nil
}

func (cms *ConfigManagerService) getConfigurationHistory(ctx context.Context, historyID, tenantID string) (*ConfigChangeHistory, error) {
	// TODO: Implement database query to get configuration history
	// For now, return a mock history record
	return &ConfigChangeHistory{
		ID:       historyID,
		TenantID: tenantID,
		Status:   "applied",
	}, nil
}