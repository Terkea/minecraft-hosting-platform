package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"minecraft-platform/src/models"
)

// ServerLifecycleService handles server deployment, lifecycle management, and Kubernetes integration
type ServerLifecycleService interface {
	// Server deployment and management
	DeployServer(ctx context.Context, request *ServerDeploymentRequest) (*ServerDeploymentResult, error)
	StartServer(ctx context.Context, serverID uuid.UUID, options *ServerStartOptions) error
	StopServer(ctx context.Context, serverID uuid.UUID, options *ServerStopOptions) error
	RestartServer(ctx context.Context, serverID uuid.UUID, options *ServerRestartOptions) error
	DeleteServer(ctx context.Context, serverID uuid.UUID, options *ServerDeleteOptions) error

	// Status and monitoring
	GetServerStatus(ctx context.Context, serverID uuid.UUID) (*ServerStatusResult, error)
	WaitForStatus(ctx context.Context, serverID uuid.UUID, targetStatus models.ServerStatus, timeout time.Duration) error
	PollServerStatus(ctx context.Context, serverID uuid.UUID) <-chan *ServerStatusUpdate

	// Configuration management
	UpdateServerConfig(ctx context.Context, serverID uuid.UUID, config *ServerConfigUpdate) error
	ValidateServerConfig(ctx context.Context, config *models.ServerProperties) error

	// Resource management
	ScaleServer(ctx context.Context, serverID uuid.UUID, newSKUID uuid.UUID) error
	GetResourceUsage(ctx context.Context, serverID uuid.UUID) (*ResourceUsageResult, error)

	// Health and diagnostics
	HealthCheck(ctx context.Context, serverID uuid.UUID) (*HealthCheckResult, error)
	GetServerLogs(ctx context.Context, serverID uuid.UUID, options *LogOptions) (*LogResult, error)
}

// ServerDeploymentRequest represents a request to deploy a new server
type ServerDeploymentRequest struct {
	TenantID         uuid.UUID                 `json:"tenant_id" validate:"required"`
	Name             string                    `json:"name" validate:"required,min=1,max=50,alphanum_hyphen"`
	SKUID            uuid.UUID                 `json:"sku_id" validate:"required"`
	MinecraftVersion string                    `json:"minecraft_version" validate:"required,minecraft_version"`
	ServerProperties models.ServerProperties   `json:"server_properties,omitempty"`
	InitialPlugins   []InitialPlugin           `json:"initial_plugins,omitempty"`
	BackupRestore    *BackupRestoreRequest     `json:"backup_restore,omitempty"`
}

// InitialPlugin represents a plugin to install during server deployment
type InitialPlugin struct {
	PluginID        uuid.UUID                 `json:"plugin_id" validate:"required"`
	ConfigOverrides models.ConfigOverrides    `json:"config_overrides,omitempty"`
}

// BackupRestoreRequest represents a backup to restore during deployment
type BackupRestoreRequest struct {
	BackupID uuid.UUID `json:"backup_id" validate:"required"`
}

// ServerDeploymentResult represents the result of a server deployment
type ServerDeploymentResult struct {
	ServerID          uuid.UUID `json:"server_id"`
	Status            models.ServerStatus `json:"status"`
	KubernetesName    string `json:"kubernetes_name"`
	Namespace         string `json:"namespace"`
	ExternalEndpoint  string `json:"external_endpoint,omitempty"`
	EstimatedTime     time.Duration `json:"estimated_time"`
}

// ServerStartOptions represents options for starting a server
type ServerStartOptions struct {
	WarmupScript   string        `json:"warmup_script,omitempty"`
	WarmupTimeout  time.Duration `json:"warmup_timeout,omitempty"`
	HealthCheck    bool          `json:"health_check,omitempty"`
	Force          bool          `json:"force,omitempty"`
}

// ServerStopOptions represents options for stopping a server
type ServerStopOptions struct {
	GracefulTimeout  time.Duration `json:"graceful_timeout,omitempty"`
	SaveBeforeStop   bool          `json:"save_before_stop"`
	NotifyPlayers    bool          `json:"notify_players"`
	PlayerMessage    string        `json:"player_message,omitempty"`
	Force            bool          `json:"force,omitempty"`
}

// ServerRestartOptions represents options for restarting a server
type ServerRestartOptions struct {
	StopOptions  *ServerStopOptions  `json:"stop_options,omitempty"`
	StartOptions *ServerStartOptions `json:"start_options,omitempty"`
	ConfigUpdate *ServerConfigUpdate `json:"config_update,omitempty"`
}

// ServerDeleteOptions represents options for deleting a server
type ServerDeleteOptions struct {
	CreateBackup      bool          `json:"create_backup"`
	BackupRetention   time.Duration `json:"backup_retention,omitempty"`
	ForceDelete       bool          `json:"force_delete,omitempty"`
	DeletePersistentData bool       `json:"delete_persistent_data"`
}

// ServerStatusResult represents server status information
type ServerStatusResult struct {
	Status           models.ServerStatus `json:"status"`
	CurrentPlayers   int                 `json:"current_players"`
	MaxPlayers       int                 `json:"max_players"`
	Uptime           time.Duration       `json:"uptime"`
	LastSeen         time.Time           `json:"last_seen"`
	HealthStatus     string              `json:"health_status"`
	ResourceUsage    *ResourceUsage      `json:"resource_usage,omitempty"`
	KubernetesStatus *KubernetesStatus   `json:"kubernetes_status,omitempty"`
}

// ServerStatusUpdate represents a real-time status update
type ServerStatusUpdate struct {
	ServerID      uuid.UUID           `json:"server_id"`
	Status        models.ServerStatus `json:"status"`
	PreviousStatus models.ServerStatus `json:"previous_status"`
	Timestamp     time.Time           `json:"timestamp"`
	Message       string              `json:"message,omitempty"`
	Error         error               `json:"error,omitempty"`
}

// ServerConfigUpdate represents server configuration changes
type ServerConfigUpdate struct {
	ServerProperties *models.ServerProperties `json:"server_properties,omitempty"`
	ResourceLimits   *models.ResourceLimits   `json:"resource_limits,omitempty"`
	ApplyMethod      ConfigApplyMethod        `json:"apply_method"`
	ValidateOnly     bool                     `json:"validate_only"`
}

// ConfigApplyMethod defines how configuration changes are applied
type ConfigApplyMethod string

const (
	ConfigApplyMethodHotReload ConfigApplyMethod = "hot_reload"
	ConfigApplyMethodRestart   ConfigApplyMethod = "restart"
	ConfigApplyMethodRedeploy  ConfigApplyMethod = "redeploy"
)

// ResourceUsage represents current resource usage
type ResourceUsage struct {
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryPercent float64 `json:"memory_percent"`
	StorageUsed   int64   `json:"storage_used"`
	NetworkIn     int64   `json:"network_in"`
	NetworkOut    int64   `json:"network_out"`
}

// ResourceUsageResult represents resource usage with historical data
type ResourceUsageResult struct {
	Current   *ResourceUsage     `json:"current"`
	Historical []ResourceUsage   `json:"historical,omitempty"`
	Limits    *models.ResourceLimits `json:"limits"`
}

// KubernetesStatus represents Kubernetes-specific status information
type KubernetesStatus struct {
	PodName       string            `json:"pod_name"`
	PodPhase      string            `json:"pod_phase"`
	PodReady      bool              `json:"pod_ready"`
	RestartCount  int32             `json:"restart_count"`
	NodeName      string            `json:"node_name"`
	Conditions    []PodCondition    `json:"conditions"`
}

// PodCondition represents a Kubernetes pod condition
type PodCondition struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
}

// HealthCheckResult represents server health check results
type HealthCheckResult struct {
	Healthy       bool              `json:"healthy"`
	Status        string            `json:"status"`
	Checks        []HealthCheck     `json:"checks"`
	ResponseTime  time.Duration     `json:"response_time"`
}

// HealthCheck represents an individual health check
type HealthCheck struct {
	Name    string `json:"name"`
	Healthy bool   `json:"healthy"`
	Message string `json:"message,omitempty"`
	Value   string `json:"value,omitempty"`
}

// LogOptions represents options for retrieving server logs
type LogOptions struct {
	Lines       int           `json:"lines,omitempty"`
	Since       *time.Time    `json:"since,omitempty"`
	Follow      bool          `json:"follow,omitempty"`
	Container   string        `json:"container,omitempty"`
	LevelFilter string        `json:"level_filter,omitempty"`
}

// LogResult represents server log data
type LogResult struct {
	Lines     []LogLine `json:"lines"`
	Truncated bool      `json:"truncated"`
}

// LogLine represents a single log line
type LogLine struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
}

// serverLifecycleService implements ServerLifecycleService
type serverLifecycleService struct {
	serverRepo       models.ServerInstanceRepository
	skuRepo          models.SKUConfigurationRepository
	backupService    BackupService
	k8sClient        KubernetesClient
	auditService     AuditService

	// Status tracking
	statusUpdates    map[uuid.UUID][]chan *ServerStatusUpdate
	statusMutex      sync.RWMutex

	// Configuration
	config *ServerLifecycleConfig
}

// ServerLifecycleConfig represents service configuration
type ServerLifecycleConfig struct {
	DefaultNamespace      string        `json:"default_namespace"`
	StatusPollInterval    time.Duration `json:"status_poll_interval"`
	HealthCheckInterval   time.Duration `json:"health_check_interval"`
	DeploymentTimeout     time.Duration `json:"deployment_timeout"`
	GracefulStopTimeout   time.Duration `json:"graceful_stop_timeout"`
	MaxConcurrentOps      int           `json:"max_concurrent_ops"`
	EnableAutoHealing     bool          `json:"enable_auto_healing"`
	LogRetentionDays      int           `json:"log_retention_days"`
}

// KubernetesClient interface for Kubernetes operations
type KubernetesClient interface {
	CreateMinecraftServer(ctx context.Context, spec *MinecraftServerSpec) error
	GetMinecraftServer(ctx context.Context, namespace, name string) (*MinecraftServerStatus, error)
	UpdateMinecraftServer(ctx context.Context, namespace, name string, spec *MinecraftServerSpec) error
	DeleteMinecraftServer(ctx context.Context, namespace, name string, options *DeleteOptions) error
	ScaleMinecraftServer(ctx context.Context, namespace, name string, resources *ResourceSpec) error
	GetPodLogs(ctx context.Context, namespace, podName string, options *LogOptions) (*LogResult, error)
	WatchMinecraftServer(ctx context.Context, namespace, name string) (<-chan *MinecraftServerEvent, error)
}

// MinecraftServerSpec represents Kubernetes MinecraftServer CRD specification
type MinecraftServerSpec struct {
	Name             string                    `json:"name"`
	Namespace        string                    `json:"namespace"`
	MinecraftVersion string                    `json:"minecraft_version"`
	Resources        *ResourceSpec             `json:"resources"`
	Config           models.ServerProperties   `json:"config"`
	Plugins          []PluginSpec              `json:"plugins,omitempty"`
	Backup           *BackupSpec               `json:"backup,omitempty"`
}

// ResourceSpec represents Kubernetes resource specifications
type ResourceSpec struct {
	CPURequest    string `json:"cpu_request"`
	CPULimit      string `json:"cpu_limit"`
	MemoryRequest string `json:"memory_request"`
	MemoryLimit   string `json:"memory_limit"`
	StorageSize   string `json:"storage_size"`
}

// PluginSpec represents plugin configuration for Kubernetes
type PluginSpec struct {
	Name        string                 `json:"name"`
	Version     string                 `json:"version"`
	DownloadURL string                 `json:"download_url"`
	Config      models.ConfigOverrides `json:"config,omitempty"`
}

// BackupSpec represents backup configuration for Kubernetes
type BackupSpec struct {
	RestoreFromBackup string `json:"restore_from_backup,omitempty"`
	Schedule          string `json:"schedule,omitempty"`
	RetentionPolicy   string `json:"retention_policy,omitempty"`
}

// MinecraftServerStatus represents the status from Kubernetes
type MinecraftServerStatus struct {
	Phase         string            `json:"phase"`
	Ready         bool              `json:"ready"`
	PlayerCount   int               `json:"player_count"`
	ExternalIP    string            `json:"external_ip"`
	ExternalPort  int               `json:"external_port"`
	Conditions    []StatusCondition `json:"conditions"`
	PodStatus     *PodStatus        `json:"pod_status,omitempty"`
}

// StatusCondition represents a status condition
type StatusCondition struct {
	Type               string    `json:"type"`
	Status             string    `json:"status"`
	LastUpdateTime     time.Time `json:"last_update_time"`
	LastTransitionTime time.Time `json:"last_transition_time"`
	Reason             string    `json:"reason,omitempty"`
	Message            string    `json:"message,omitempty"`
}

// PodStatus represents pod status information
type PodStatus struct {
	Name         string         `json:"name"`
	Phase        string         `json:"phase"`
	Ready        bool           `json:"ready"`
	RestartCount int32          `json:"restart_count"`
	NodeName     string         `json:"node_name"`
	Conditions   []PodCondition `json:"conditions"`
}

// MinecraftServerEvent represents a Kubernetes watch event
type MinecraftServerEvent struct {
	Type   string                 `json:"type"`
	Object *MinecraftServerStatus `json:"object"`
}

// DeleteOptions represents options for deleting Kubernetes resources
type DeleteOptions struct {
	GracePeriodSeconds *int64 `json:"grace_period_seconds,omitempty"`
	Force              bool   `json:"force,omitempty"`
}

// AuditService interface for audit logging
type AuditService interface {
	LogServerAction(ctx context.Context, action models.AuditAction, serverID uuid.UUID, details map[string]interface{}) error
}

// BackupService interface for backup operations
type BackupService interface {
	CreatePreTerminationBackup(ctx context.Context, serverID uuid.UUID) (*models.BackupSnapshot, error)
	RestoreFromBackup(ctx context.Context, serverID uuid.UUID, backupID uuid.UUID) error
}

// NewServerLifecycleService creates a new server lifecycle service
func NewServerLifecycleService(
	serverRepo models.ServerInstanceRepository,
	skuRepo models.SKUConfigurationRepository,
	backupService BackupService,
	k8sClient KubernetesClient,
	auditService AuditService,
	config *ServerLifecycleConfig,
) ServerLifecycleService {
	return &serverLifecycleService{
		serverRepo:    serverRepo,
		skuRepo:       skuRepo,
		backupService: backupService,
		k8sClient:     k8sClient,
		auditService:  auditService,
		statusUpdates: make(map[uuid.UUID][]chan *ServerStatusUpdate),
		config:        config,
	}
}

// DeployServer implements server deployment
func (s *serverLifecycleService) DeployServer(ctx context.Context, request *ServerDeploymentRequest) (*ServerDeploymentResult, error) {
	// Validate request
	if err := s.validateDeploymentRequest(request); err != nil {
		return nil, fmt.Errorf("invalid deployment request: %w", err)
	}

	// Get SKU configuration
	sku, err := s.skuRepo.GetByID(ctx, request.SKUID)
	if err != nil {
		return nil, fmt.Errorf("failed to get SKU configuration: %w", err)
	}

	if !sku.IsActive {
		return nil, errors.New("SKU configuration is not active")
	}

	// Create server instance
	server := &models.ServerInstance{
		TenantID:         request.TenantID,
		Name:             request.Name,
		SKUID:            request.SKUID,
		Status:           models.ServerStatusDeploying,
		MinecraftVersion: request.MinecraftVersion,
		ServerProperties: request.ServerProperties,
		ResourceLimits:   sku.GetResourceLimits(),
		MaxPlayers:       sku.MaxPlayers,
	}

	// Merge SKU default properties with request properties
	server.ServerProperties = sku.GetEffectiveProperties(request.ServerProperties)

	// Generate unique identifiers
	server.KubernetesNamespace = s.generateNamespace(request.TenantID)
	server.ExternalPort = s.generateExternalPort(ctx, request.TenantID)

	// Save server to database
	if err := s.serverRepo.Create(ctx, server); err != nil {
		return nil, fmt.Errorf("failed to create server record: %w", err)
	}

	// Audit log
	s.auditService.LogServerAction(ctx, models.AuditActionServerCreated, server.ID, map[string]interface{}{
		"sku_name": sku.Name,
		"minecraft_version": request.MinecraftVersion,
	})

	// Create Kubernetes specification
	k8sSpec := s.buildMinecraftServerSpec(server, sku, request)

	// Deploy to Kubernetes
	if err := s.k8sClient.CreateMinecraftServer(ctx, k8sSpec); err != nil {
		// Update server status to failed
		server.Status = models.ServerStatusFailed
		s.serverRepo.Update(ctx, server)
		return nil, fmt.Errorf("failed to deploy to Kubernetes: %w", err)
	}

	// Start status monitoring
	go s.monitorDeployment(context.Background(), server.ID)

	// Build result
	result := &ServerDeploymentResult{
		ServerID:          server.ID,
		Status:            server.Status,
		KubernetesName:    k8sSpec.Name,
		Namespace:         k8sSpec.Namespace,
		EstimatedTime:     s.estimateDeploymentTime(sku),
	}

	return result, nil
}

// StartServer implements server startup
func (s *serverLifecycleService) StartServer(ctx context.Context, serverID uuid.UUID, options *ServerStartOptions) error {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return fmt.Errorf("failed to get server: %w", err)
	}

	// Validate server can be started
	if !server.Status.CanTransitionTo(models.ServerStatusDeploying) {
		if server.Status == models.ServerStatusRunning {
			return nil // Already running
		}
		return fmt.Errorf("cannot start server in status %s", server.Status)
	}

	// Update status to deploying
	if err := server.UpdateStatus(models.ServerStatusDeploying); err != nil {
		return fmt.Errorf("failed to update server status: %w", err)
	}

	if err := s.serverRepo.Update(ctx, server); err != nil {
		return fmt.Errorf("failed to save server status: %w", err)
	}

	// Start server in Kubernetes
	k8sName := s.generateKubernetesName(server)
	k8sStatus, err := s.k8sClient.GetMinecraftServer(ctx, server.KubernetesNamespace, k8sName)
	if err != nil {
		return fmt.Errorf("failed to get Kubernetes server status: %w", err)
	}

	if k8sStatus.Phase != "Running" {
		// Server needs to be redeployed
		sku, err := s.skuRepo.GetByID(ctx, server.SKUID)
		if err != nil {
			return fmt.Errorf("failed to get SKU: %w", err)
		}

		k8sSpec := s.buildMinecraftServerSpec(server, sku, nil)
		if err := s.k8sClient.CreateMinecraftServer(ctx, k8sSpec); err != nil {
			return fmt.Errorf("failed to start server in Kubernetes: %w", err)
		}
	}

	// Audit log
	s.auditService.LogServerAction(ctx, models.AuditActionServerStarted, serverID, map[string]interface{}{
		"options": options,
	})

	// Start monitoring
	go s.monitorDeployment(context.Background(), serverID)

	return nil
}

// StopServer implements server shutdown
func (s *serverLifecycleService) StopServer(ctx context.Context, serverID uuid.UUID, options *ServerStopOptions) error {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return fmt.Errorf("failed to get server: %w", err)
	}

	// Validate server can be stopped
	if server.Status == models.ServerStatusStopped {
		return nil // Already stopped
	}

	if !server.Status.CanTransitionTo(models.ServerStatusStopped) {
		return fmt.Errorf("cannot stop server in status %s", server.Status)
	}

	// Update status
	if err := server.UpdateStatus(models.ServerStatusStopped); err != nil {
		return fmt.Errorf("failed to update server status: %w", err)
	}

	if err := s.serverRepo.Update(ctx, server); err != nil {
		return fmt.Errorf("failed to save server status: %w", err)
	}

	// Stop server in Kubernetes
	k8sName := s.generateKubernetesName(server)
	deleteOptions := &DeleteOptions{}

	if options != nil && options.GracefulTimeout > 0 {
		gracePeriod := int64(options.GracefulTimeout.Seconds())
		deleteOptions.GracePeriodSeconds = &gracePeriod
	}

	if err := s.k8sClient.DeleteMinecraftServer(ctx, server.KubernetesNamespace, k8sName, deleteOptions); err != nil {
		return fmt.Errorf("failed to stop server in Kubernetes: %w", err)
	}

	// Audit log
	s.auditService.LogServerAction(ctx, models.AuditActionServerStopped, serverID, map[string]interface{}{
		"options": options,
	})

	// Notify status subscribers
	s.notifyStatusUpdate(serverID, &ServerStatusUpdate{
		ServerID:       serverID,
		Status:         models.ServerStatusStopped,
		PreviousStatus: server.Status,
		Timestamp:      time.Now().UTC(),
		Message:        "Server stopped",
	})

	return nil
}

// RestartServer implements server restart
func (s *serverLifecycleService) RestartServer(ctx context.Context, serverID uuid.UUID, options *ServerRestartOptions) error {
	// Stop the server first
	var stopOptions *ServerStopOptions
	if options != nil && options.StopOptions != nil {
		stopOptions = options.StopOptions
	}

	if err := s.StopServer(ctx, serverID, stopOptions); err != nil {
		return fmt.Errorf("failed to stop server for restart: %w", err)
	}

	// Wait for server to be stopped
	if err := s.WaitForStatus(ctx, serverID, models.ServerStatusStopped, 30*time.Second); err != nil {
		return fmt.Errorf("timeout waiting for server to stop: %w", err)
	}

	// Apply configuration updates if provided
	if options != nil && options.ConfigUpdate != nil {
		if err := s.UpdateServerConfig(ctx, serverID, options.ConfigUpdate); err != nil {
			return fmt.Errorf("failed to update configuration during restart: %w", err)
		}
	}

	// Start the server
	var startOptions *ServerStartOptions
	if options != nil && options.StartOptions != nil {
		startOptions = options.StartOptions
	}

	if err := s.StartServer(ctx, serverID, startOptions); err != nil {
		return fmt.Errorf("failed to start server after restart: %w", err)
	}

	// Audit log
	s.auditService.LogServerAction(ctx, models.AuditActionServerRestarted, serverID, map[string]interface{}{
		"options": options,
	})

	return nil
}

// DeleteServer implements server deletion
func (s *serverLifecycleService) DeleteServer(ctx context.Context, serverID uuid.UUID, options *ServerDeleteOptions) error {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return fmt.Errorf("failed to get server: %w", err)
	}

	// Create backup if requested
	if options != nil && options.CreateBackup {
		if _, err := s.backupService.CreatePreTerminationBackup(ctx, serverID); err != nil {
			log.Printf("Warning: Failed to create pre-termination backup for server %s: %v", serverID, err)
		}
	}

	// Update status to terminating
	if err := server.UpdateStatus(models.ServerStatusTerminating); err != nil {
		return fmt.Errorf("failed to update server status: %w", err)
	}

	if err := s.serverRepo.Update(ctx, server); err != nil {
		return fmt.Errorf("failed to save server status: %w", err)
	}

	// Delete from Kubernetes
	k8sName := s.generateKubernetesName(server)
	deleteOptions := &DeleteOptions{}

	if options != nil && options.ForceDelete {
		gracePeriod := int64(0)
		deleteOptions.GracePeriodSeconds = &gracePeriod
		deleteOptions.Force = true
	}

	if err := s.k8sClient.DeleteMinecraftServer(ctx, server.KubernetesNamespace, k8sName, deleteOptions); err != nil {
		return fmt.Errorf("failed to delete server from Kubernetes: %w", err)
	}

	// Delete from database
	if err := s.serverRepo.Delete(ctx, serverID); err != nil {
		return fmt.Errorf("failed to delete server from database: %w", err)
	}

	// Audit log
	s.auditService.LogServerAction(ctx, models.AuditActionServerDeleted, serverID, map[string]interface{}{
		"options": options,
	})

	// Notify status subscribers
	s.notifyStatusUpdate(serverID, &ServerStatusUpdate{
		ServerID:       serverID,
		Status:         models.ServerStatusTerminating,
		PreviousStatus: server.Status,
		Timestamp:      time.Now().UTC(),
		Message:        "Server deleted",
	})

	// Clean up status subscriptions
	s.cleanupStatusSubscriptions(serverID)

	return nil
}

// Helper methods

func (s *serverLifecycleService) validateDeploymentRequest(request *ServerDeploymentRequest) error {
	if request.TenantID == uuid.Nil {
		return errors.New("tenant_id is required")
	}

	if request.Name == "" {
		return errors.New("server name is required")
	}

	if request.SKUID == uuid.Nil {
		return errors.New("sku_id is required")
	}

	if request.MinecraftVersion == "" {
		return errors.New("minecraft_version is required")
	}

	return nil
}

func (s *serverLifecycleService) generateNamespace(tenantID uuid.UUID) string {
	return fmt.Sprintf("minecraft-%s", tenantID.String()[:8])
}

func (s *serverLifecycleService) generateExternalPort(ctx context.Context, tenantID uuid.UUID) int {
	// Simple port allocation - in production, this would be more sophisticated
	return 25565 // Default Minecraft port for now
}

func (s *serverLifecycleService) generateKubernetesName(server *models.ServerInstance) string {
	return fmt.Sprintf("minecraft-%s", server.ID.String()[:8])
}

func (s *serverLifecycleService) buildMinecraftServerSpec(server *models.ServerInstance, sku *models.SKUConfiguration, request *ServerDeploymentRequest) *MinecraftServerSpec {
	spec := &MinecraftServerSpec{
		Name:             s.generateKubernetesName(server),
		Namespace:        server.KubernetesNamespace,
		MinecraftVersion: server.MinecraftVersion,
		Resources: &ResourceSpec{
			CPURequest:    fmt.Sprintf("%.2f", sku.CPUCores*0.5), // 50% request
			CPULimit:      fmt.Sprintf("%.2f", sku.CPUCores),
			MemoryRequest: fmt.Sprintf("%dGi", sku.MemoryGB/2), // 50% request
			MemoryLimit:   fmt.Sprintf("%dGi", sku.MemoryGB),
			StorageSize:   fmt.Sprintf("%dGi", sku.StorageGB),
		},
		Config: server.ServerProperties,
	}

	// Add initial plugins if specified
	if request != nil && len(request.InitialPlugins) > 0 {
		for _, plugin := range request.InitialPlugins {
			// In a real implementation, we would look up plugin details
			spec.Plugins = append(spec.Plugins, PluginSpec{
				Name:   plugin.PluginID.String(), // Placeholder
				Config: plugin.ConfigOverrides,
			})
		}
	}

	// Add backup restore if specified
	if request != nil && request.BackupRestore != nil {
		spec.Backup = &BackupSpec{
			RestoreFromBackup: request.BackupRestore.BackupID.String(),
		}
	}

	return spec
}

func (s *serverLifecycleService) estimateDeploymentTime(sku *models.SKUConfiguration) time.Duration {
	// Base deployment time
	baseTime := 2 * time.Minute

	// Add time based on resource requirements
	if sku.CPUCores > 4 {
		baseTime += 30 * time.Second
	}
	if sku.MemoryGB > 8 {
		baseTime += 30 * time.Second
	}

	return baseTime
}

func (s *serverLifecycleService) monitorDeployment(ctx context.Context, serverID uuid.UUID) {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		log.Printf("Failed to get server for monitoring: %v", err)
		return
	}

	ticker := time.NewTicker(s.config.StatusPollInterval)
	defer ticker.Stop()

	timeout := time.After(s.config.DeploymentTimeout)

	for {
		select {
		case <-ctx.Done():
			return
		case <-timeout:
			// Deployment timeout
			server.Status = models.ServerStatusFailed
			s.serverRepo.Update(ctx, server)
			s.notifyStatusUpdate(serverID, &ServerStatusUpdate{
				ServerID:  serverID,
				Status:    models.ServerStatusFailed,
				Timestamp: time.Now().UTC(),
				Message:   "Deployment timeout",
			})
			return
		case <-ticker.C:
			// Check Kubernetes status
			k8sName := s.generateKubernetesName(server)
			k8sStatus, err := s.k8sClient.GetMinecraftServer(ctx, server.KubernetesNamespace, k8sName)
			if err != nil {
				log.Printf("Failed to get Kubernetes status: %v", err)
				continue
			}

			// Update server status based on Kubernetes status
			var newStatus models.ServerStatus
			switch k8sStatus.Phase {
			case "Running":
				if k8sStatus.Ready {
					newStatus = models.ServerStatusRunning
				} else {
					newStatus = models.ServerStatusDeploying
				}
			case "Failed":
				newStatus = models.ServerStatusFailed
			case "Pending":
				newStatus = models.ServerStatusDeploying
			default:
				continue // Unknown status, keep polling
			}

			if newStatus != server.Status {
				previousStatus := server.Status
				server.Status = newStatus
				server.CurrentPlayers = k8sStatus.PlayerCount
				if k8sStatus.ExternalIP != "" {
					server.ExternalEndpoint = fmt.Sprintf("%s:%d", k8sStatus.ExternalIP, k8sStatus.ExternalPort)
				}

				if err := s.serverRepo.Update(ctx, server); err != nil {
					log.Printf("Failed to update server status: %v", err)
					continue
				}

				s.notifyStatusUpdate(serverID, &ServerStatusUpdate{
					ServerID:       serverID,
					Status:         newStatus,
					PreviousStatus: previousStatus,
					Timestamp:      time.Now().UTC(),
					Message:        fmt.Sprintf("Status changed to %s", newStatus),
				})

				// If deployment is complete, stop monitoring
				if newStatus == models.ServerStatusRunning || newStatus == models.ServerStatusFailed {
					return
				}
			}
		}
	}
}

func (s *serverLifecycleService) notifyStatusUpdate(serverID uuid.UUID, update *ServerStatusUpdate) {
	s.statusMutex.RLock()
	channels := s.statusUpdates[serverID]
	s.statusMutex.RUnlock()

	for _, ch := range channels {
		select {
		case ch <- update:
		default:
			// Channel is full, skip this update
		}
	}
}

func (s *serverLifecycleService) cleanupStatusSubscriptions(serverID uuid.UUID) {
	s.statusMutex.Lock()
	defer s.statusMutex.Unlock()

	if channels, exists := s.statusUpdates[serverID]; exists {
		for _, ch := range channels {
			close(ch)
		}
		delete(s.statusUpdates, serverID)
	}
}

// GetServerStatus returns current server status
func (s *serverLifecycleService) GetServerStatus(ctx context.Context, serverID uuid.UUID) (*ServerStatusResult, error) {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	result := &ServerStatusResult{
		Status:         server.Status,
		CurrentPlayers: server.CurrentPlayers,
		MaxPlayers:     server.MaxPlayers,
		LastSeen:       server.UpdatedAt,
	}

	// Get additional status from Kubernetes if running
	if server.Status == models.ServerStatusRunning || server.Status == models.ServerStatusDeploying {
		k8sName := s.generateKubernetesName(server)
		k8sStatus, err := s.k8sClient.GetMinecraftServer(ctx, server.KubernetesNamespace, k8sName)
		if err == nil {
			result.KubernetesStatus = &KubernetesStatus{
				PodName:  k8sStatus.PodStatus.Name,
				PodPhase: k8sStatus.PodStatus.Phase,
				PodReady: k8sStatus.PodStatus.Ready,
				RestartCount: k8sStatus.PodStatus.RestartCount,
				NodeName: k8sStatus.PodStatus.NodeName,
			}

			// Convert conditions
			for _, cond := range k8sStatus.PodStatus.Conditions {
				result.KubernetesStatus.Conditions = append(result.KubernetesStatus.Conditions, PodCondition{
					Type:    cond.Type,
					Status:  cond.Status,
					Reason:  cond.Reason,
					Message: cond.Message,
				})
			}
		}
	}

	return result, nil
}

// WaitForStatus waits for server to reach target status
func (s *serverLifecycleService) WaitForStatus(ctx context.Context, serverID uuid.UUID, targetStatus models.ServerStatus, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			status, err := s.GetServerStatus(ctx, serverID)
			if err != nil {
				return err
			}
			if status.Status == targetStatus {
				return nil
			}
		}
	}
}

// PollServerStatus returns a channel for status updates
func (s *serverLifecycleService) PollServerStatus(ctx context.Context, serverID uuid.UUID) <-chan *ServerStatusUpdate {
	ch := make(chan *ServerStatusUpdate, 10)

	s.statusMutex.Lock()
	s.statusUpdates[serverID] = append(s.statusUpdates[serverID], ch)
	s.statusMutex.Unlock()

	// Clean up when context is done
	go func() {
		<-ctx.Done()
		s.statusMutex.Lock()
		defer s.statusMutex.Unlock()

		if channels, exists := s.statusUpdates[serverID]; exists {
			for i, c := range channels {
				if c == ch {
					close(ch)
					s.statusUpdates[serverID] = append(channels[:i], channels[i+1:]...)
					break
				}
			}
		}
	}()

	return ch
}

// UpdateServerConfig updates server configuration
func (s *serverLifecycleService) UpdateServerConfig(ctx context.Context, serverID uuid.UUID, config *ServerConfigUpdate) error {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return fmt.Errorf("failed to get server: %w", err)
	}

	// Validate configuration
	if config.ServerProperties != nil {
		if err := s.ValidateServerConfig(ctx, config.ServerProperties); err != nil {
			return fmt.Errorf("configuration validation failed: %w", err)
		}
	}

	if config.ValidateOnly {
		return nil // Validation only, don't apply changes
	}

	// Apply configuration changes
	if config.ServerProperties != nil {
		server.ServerProperties = *config.ServerProperties
	}

	if config.ResourceLimits != nil {
		server.ResourceLimits = *config.ResourceLimits
	}

	// Save to database
	if err := s.serverRepo.Update(ctx, server); err != nil {
		return fmt.Errorf("failed to save configuration: %w", err)
	}

	// Apply to Kubernetes based on method
	switch config.ApplyMethod {
	case ConfigApplyMethodHotReload:
		// Hot reload configuration (if supported)
		// This would update ConfigMaps and trigger hot reload
		break
	case ConfigApplyMethodRestart:
		// Restart the server to apply changes
		return s.RestartServer(ctx, serverID, &ServerRestartOptions{})
	case ConfigApplyMethodRedeploy:
		// Redeploy the server with new configuration
		return s.RestartServer(ctx, serverID, &ServerRestartOptions{})
	}

	// Audit log
	s.auditService.LogServerAction(ctx, models.AuditActionServerConfigUpdated, serverID, map[string]interface{}{
		"config": config,
	})

	return nil
}

// ValidateServerConfig validates server configuration
func (s *serverLifecycleService) ValidateServerConfig(ctx context.Context, config *models.ServerProperties) error {
	// This would implement comprehensive configuration validation
	// For now, just basic checks
	if config == nil {
		return nil
	}

	// Validate max-players if specified
	if maxPlayers, exists := (*config)["max-players"]; exists {
		if mp, ok := maxPlayers.(int); ok && mp <= 0 {
			return errors.New("max-players must be positive")
		}
	}

	return nil
}

// ScaleServer scales server resources
func (s *serverLifecycleService) ScaleServer(ctx context.Context, serverID uuid.UUID, newSKUID uuid.UUID) error {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return fmt.Errorf("failed to get server: %w", err)
	}

	newSKU, err := s.skuRepo.GetByID(ctx, newSKUID)
	if err != nil {
		return fmt.Errorf("failed to get new SKU: %w", err)
	}

	if !newSKU.IsActive {
		return errors.New("target SKU is not active")
	}

	// Update server with new SKU
	server.SKUID = newSKUID
	server.ResourceLimits = newSKU.GetResourceLimits()
	server.MaxPlayers = newSKU.MaxPlayers

	if err := s.serverRepo.Update(ctx, server); err != nil {
		return fmt.Errorf("failed to update server: %w", err)
	}

	// Scale in Kubernetes
	k8sName := s.generateKubernetesName(server)
	resourceSpec := &ResourceSpec{
		CPURequest:    fmt.Sprintf("%.2f", newSKU.CPUCores*0.5),
		CPULimit:      fmt.Sprintf("%.2f", newSKU.CPUCores),
		MemoryRequest: fmt.Sprintf("%dGi", newSKU.MemoryGB/2),
		MemoryLimit:   fmt.Sprintf("%dGi", newSKU.MemoryGB),
		StorageSize:   fmt.Sprintf("%dGi", newSKU.StorageGB),
	}

	if err := s.k8sClient.ScaleMinecraftServer(ctx, server.KubernetesNamespace, k8sName, resourceSpec); err != nil {
		return fmt.Errorf("failed to scale server in Kubernetes: %w", err)
	}

	// Audit log
	s.auditService.LogServerAction(ctx, models.AuditActionServerUpdated, serverID, map[string]interface{}{
		"old_sku_id": server.SKUID,
		"new_sku_id": newSKUID,
		"action":     "scale",
	})

	return nil
}

// GetResourceUsage returns current resource usage
func (s *serverLifecycleService) GetResourceUsage(ctx context.Context, serverID uuid.UUID) (*ResourceUsageResult, error) {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	// In a real implementation, this would query metrics from Prometheus/monitoring system
	result := &ResourceUsageResult{
		Current: &ResourceUsage{
			CPUPercent:    0.0,    // Would come from metrics
			MemoryPercent: 0.0,    // Would come from metrics
			StorageUsed:   0,      // Would come from metrics
			NetworkIn:     0,      // Would come from metrics
			NetworkOut:    0,      // Would come from metrics
		},
		Limits: &server.ResourceLimits,
	}

	return result, nil
}

// HealthCheck performs server health check
func (s *serverLifecycleService) HealthCheck(ctx context.Context, serverID uuid.UUID) (*HealthCheckResult, error) {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	start := time.Now()

	result := &HealthCheckResult{
		Healthy:      true,
		Status:       "healthy",
		Checks:       []HealthCheck{},
		ResponseTime: time.Since(start),
	}

	// Basic health checks
	result.Checks = append(result.Checks, HealthCheck{
		Name:    "status",
		Healthy: server.Status == models.ServerStatusRunning,
		Message: string(server.Status),
	})

	// Check Kubernetes status if running
	if server.Status == models.ServerStatusRunning {
		k8sName := s.generateKubernetesName(server)
		k8sStatus, err := s.k8sClient.GetMinecraftServer(ctx, server.KubernetesNamespace, k8sName)
		if err != nil {
			result.Checks = append(result.Checks, HealthCheck{
				Name:    "kubernetes",
				Healthy: false,
				Message: err.Error(),
			})
			result.Healthy = false
		} else {
			result.Checks = append(result.Checks, HealthCheck{
				Name:    "kubernetes",
				Healthy: k8sStatus.Ready,
				Message: k8sStatus.Phase,
			})
			if !k8sStatus.Ready {
				result.Healthy = false
			}
		}
	}

	if !result.Healthy {
		result.Status = "unhealthy"
	}

	return result, nil
}

// GetServerLogs retrieves server logs
func (s *serverLifecycleService) GetServerLogs(ctx context.Context, serverID uuid.UUID, options *LogOptions) (*LogResult, error) {
	server, err := s.serverRepo.GetByID(ctx, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	// Get Kubernetes pod name
	k8sName := s.generateKubernetesName(server)
	k8sStatus, err := s.k8sClient.GetMinecraftServer(ctx, server.KubernetesNamespace, k8sName)
	if err != nil {
		return nil, fmt.Errorf("failed to get Kubernetes status: %w", err)
	}

	if k8sStatus.PodStatus == nil {
		return &LogResult{Lines: []LogLine{}, Truncated: false}, nil
	}

	// Get logs from Kubernetes
	return s.k8sClient.GetPodLogs(ctx, server.KubernetesNamespace, k8sStatus.PodStatus.Name, options)
}