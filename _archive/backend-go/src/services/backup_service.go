package services

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"minecraft-platform/src/models"
)

// BackupService handles backup creation, restoration, and management
type BackupService struct {
	serverLifecycle *ServerLifecycleService
	storageBasePath string
	maxRetentionDays int
}

// NewBackupService creates a new backup service instance
func NewBackupService(serverLifecycle *ServerLifecycleService, storageBasePath string) *BackupService {
	return &BackupService{
		serverLifecycle:  serverLifecycle,
		storageBasePath:  storageBasePath,
		maxRetentionDays: 30, // Default retention policy
	}
}

// BackupCreateRequest represents a backup creation request
type BackupCreateRequest struct {
	ServerID     string                 `json:"server_id"`
	Name         string                 `json:"name"`
	Description  string                 `json:"description,omitempty"`
	Compression  string                 `json:"compression,omitempty"` // gzip, lz4, none
	Tags         map[string]string      `json:"tags,omitempty"`
	TenantID     string                 `json:"tenant_id"`
	Options      map[string]interface{} `json:"options,omitempty"`
}

// BackupRestoreRequest represents a backup restoration request
type BackupRestoreRequest struct {
	BackupID         string                 `json:"backup_id"`
	ServerID         string                 `json:"server_id"`
	CreatePreBackup  bool                   `json:"create_pre_backup,omitempty"`
	StopServer       bool                   `json:"stop_server,omitempty"`
	TimeoutSeconds   int                    `json:"timeout_seconds,omitempty"`
	PostRestoreCommands []string            `json:"post_restore_commands,omitempty"`
	TenantID         string                 `json:"tenant_id"`
	Options          map[string]interface{} `json:"options,omitempty"`
}

// BackupCreateResult represents the result of a backup creation
type BackupCreateResult struct {
	Backup    *models.BackupSnapshot `json:"backup"`
	JobID     string                 `json:"job_id"`
	Status    string                 `json:"status"`
	Message   string                 `json:"message,omitempty"`
	StartedAt time.Time              `json:"started_at"`
}

// BackupRestoreResult represents the result of a backup restoration
type BackupRestoreResult struct {
	RestoreID     string                 `json:"restore_id"`
	BackupID      string                 `json:"backup_id"`
	ServerID      string                 `json:"server_id"`
	Status        string                 `json:"status"`
	PreBackupID   string                 `json:"pre_backup_id,omitempty"`
	Message       string                 `json:"message,omitempty"`
	StartedAt     time.Time              `json:"started_at"`
	Options       map[string]interface{} `json:"options,omitempty"`
}

// CreateBackup creates a new backup for a server
func (bs *BackupService) CreateBackup(ctx context.Context, req *BackupCreateRequest) (*BackupCreateResult, error) {
	if req.TenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if req.ServerID == "" {
		return nil, fmt.Errorf("server_id is required")
	}
	if req.Name == "" {
		return nil, fmt.Errorf("backup name is required")
	}

	// Validate compression format
	if req.Compression == "" {
		req.Compression = "gzip" // Default compression
	}
	if !bs.isValidCompression(req.Compression) {
		return nil, fmt.Errorf("invalid compression format: %s", req.Compression)
	}

	// Check server exists and is accessible to tenant
	server, err := bs.serverLifecycle.GetServer(ctx, req.ServerID, req.TenantID)
	if err != nil {
		return nil, fmt.Errorf("server not found: %w", err)
	}

	// Check if server is in a backupable state
	if !bs.isServerBackupable(server.Status) {
		return nil, fmt.Errorf("server is not in a backupable state: %s", server.Status)
	}

	// Generate backup path
	backupPath := bs.generateBackupPath(req.ServerID, req.Name)

	// Create backup record
	backup := &models.BackupSnapshot{
		Name:        req.Name,
		Description: req.Description,
		ServerID:    req.ServerID,
		StoragePath: backupPath,
		Status:      models.BackupStatusCreating,
		Compression: req.Compression,
		TenantID:    req.TenantID,
		StartedAt:   time.Now(),
	}

	// Generate job ID for tracking
	jobID := fmt.Sprintf("backup-%s-%d", req.ServerID, time.Now().Unix())

	// TODO: Start backup job asynchronously
	// This would integrate with Kubernetes jobs or background workers

	result := &BackupCreateResult{
		Backup:    backup,
		JobID:     jobID,
		Status:    "creating",
		Message:   "Backup creation initiated",
		StartedAt: backup.StartedAt,
	}

	return result, nil
}

// RestoreBackup restores a backup to a server
func (bs *BackupService) RestoreBackup(ctx context.Context, req *BackupRestoreRequest) (*BackupRestoreResult, error) {
	if req.TenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if req.BackupID == "" {
		return nil, fmt.Errorf("backup_id is required")
	}
	if req.ServerID == "" {
		return nil, fmt.Errorf("server_id is required")
	}

	// Validate timeout
	if req.TimeoutSeconds == 0 {
		req.TimeoutSeconds = 300 // Default 5 minutes
	}
	if req.TimeoutSeconds < 30 || req.TimeoutSeconds > 3600 {
		return nil, fmt.Errorf("timeout_seconds must be between 30 and 3600")
	}

	// Check backup exists and is accessible to tenant
	backup, err := bs.getBackupByID(ctx, req.BackupID, req.TenantID)
	if err != nil {
		return nil, fmt.Errorf("backup not found: %w", err)
	}

	// Validate backup belongs to the server
	if backup.ServerID != req.ServerID {
		return nil, fmt.Errorf("backup does not belong to server %s", req.ServerID)
	}

	// Check backup is complete and restorable
	if backup.Status != models.BackupStatusCompleted {
		return nil, fmt.Errorf("backup is not in completed state: %s", backup.Status)
	}

	// Check server exists and is accessible to tenant
	server, err := bs.serverLifecycle.GetServer(ctx, req.ServerID, req.TenantID)
	if err != nil {
		return nil, fmt.Errorf("server not found: %w", err)
	}

	// Generate restore ID
	restoreID := fmt.Sprintf("restore-%s-%d", req.BackupID, time.Now().Unix())

	var preBackupID string

	// Create pre-restore backup if requested
	if req.CreatePreBackup {
		preBackupReq := &BackupCreateRequest{
			ServerID:    req.ServerID,
			Name:        fmt.Sprintf("pre-restore-%s", restoreID),
			Description: fmt.Sprintf("Pre-restore backup before restoring %s", req.BackupID),
			TenantID:    req.TenantID,
		}

		preBackupResult, err := bs.CreateBackup(ctx, preBackupReq)
		if err != nil {
			return nil, fmt.Errorf("failed to create pre-restore backup: %w", err)
		}
		preBackupID = preBackupResult.Backup.ID
	}

	// TODO: Start restore job asynchronously
	// This would integrate with Kubernetes jobs or background workers

	result := &BackupRestoreResult{
		RestoreID:   restoreID,
		BackupID:    req.BackupID,
		ServerID:    req.ServerID,
		Status:      "restoring",
		PreBackupID: preBackupID,
		Message:     "Backup restoration initiated",
		StartedAt:   time.Now(),
		Options:     req.Options,
	}

	return result, nil
}

// ListBackups lists backups for a server with filtering and pagination
func (bs *BackupService) ListBackups(ctx context.Context, serverID, tenantID string, filters map[string]interface{}) ([]*models.BackupSnapshot, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if serverID == "" {
		return nil, fmt.Errorf("server_id is required")
	}

	// TODO: Implement database query with filters
	// This would query the database for backups matching criteria

	return []*models.BackupSnapshot{}, nil
}

// DeleteBackup deletes a backup and its associated storage
func (bs *BackupService) DeleteBackup(ctx context.Context, backupID, tenantID string) error {
	if tenantID == "" {
		return fmt.Errorf("tenant_id is required")
	}
	if backupID == "" {
		return fmt.Errorf("backup_id is required")
	}

	// Check backup exists and is accessible to tenant
	backup, err := bs.getBackupByID(ctx, backupID, tenantID)
	if err != nil {
		return fmt.Errorf("backup not found: %w", err)
	}

	// TODO: Delete backup files from storage
	// TODO: Update backup status to deleted

	_ = backup // Use backup to avoid unused variable error

	return nil
}

// ScheduleBackup schedules regular backups for a server
func (bs *BackupService) ScheduleBackup(ctx context.Context, serverID, tenantID, schedule string) error {
	if tenantID == "" {
		return fmt.Errorf("tenant_id is required")
	}
	if serverID == "" {
		return fmt.Errorf("server_id is required")
	}
	if schedule == "" {
		return fmt.Errorf("schedule is required")
	}

	// TODO: Implement backup scheduling with cron-like syntax
	// This would integrate with a job scheduler like Kubernetes CronJobs

	return nil
}

// Helper methods

func (bs *BackupService) isValidCompression(compression string) bool {
	validCompressions := []string{"gzip", "lz4", "none"}
	for _, valid := range validCompressions {
		if compression == valid {
			return true
		}
	}
	return false
}

func (bs *BackupService) isServerBackupable(status string) bool {
	backupableStates := []string{
		models.ServerStatusRunning,
		models.ServerStatusStopped,
		models.ServerStatusIdle,
	}
	for _, valid := range backupableStates {
		if status == valid {
			return true
		}
	}
	return false
}

func (bs *BackupService) generateBackupPath(serverID, backupName string) string {
	timestamp := time.Now().Format("2006-01-02-15-04-05")
	filename := fmt.Sprintf("%s-%s-%s.tar.gz", serverID, backupName, timestamp)
	return filepath.Join(bs.storageBasePath, "backups", serverID, filename)
}

func (bs *BackupService) getBackupByID(ctx context.Context, backupID, tenantID string) (*models.BackupSnapshot, error) {
	// TODO: Implement database query to get backup by ID and tenant
	// For now, return a mock backup
	return &models.BackupSnapshot{
		ID:       backupID,
		ServerID: "srv-12345",
		Status:   models.BackupStatusCompleted,
		TenantID: tenantID,
	}, nil
}