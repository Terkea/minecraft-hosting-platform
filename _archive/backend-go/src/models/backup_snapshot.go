package models

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// BackupType represents the type of backup
type BackupType string

const (
	BackupTypeManual         BackupType = "manual"
	BackupTypeScheduled      BackupType = "scheduled"
	BackupTypePreTermination BackupType = "pre_termination"
)

// IsValid checks if the backup type is valid
func (bt BackupType) IsValid() bool {
	switch bt {
	case BackupTypeManual, BackupTypeScheduled, BackupTypePreTermination:
		return true
	default:
		return false
	}
}

// BackupStatus represents the status of a backup operation
type BackupStatus string

const (
	BackupStatusCreating  BackupStatus = "creating"
	BackupStatusCompleted BackupStatus = "completed"
	BackupStatusFailed    BackupStatus = "failed"
	BackupStatusRestoring BackupStatus = "restoring"
)

// IsValid checks if the backup status is valid
func (bs BackupStatus) IsValid() bool {
	switch bs {
	case BackupStatusCreating, BackupStatusCompleted, BackupStatusFailed, BackupStatusRestoring:
		return true
	default:
		return false
	}
}

// IsTerminal returns true if the status represents a final state
func (bs BackupStatus) IsTerminal() bool {
	return bs == BackupStatusCompleted || bs == BackupStatusFailed
}

// CanTransitionTo checks if transition to the target status is valid
func (bs BackupStatus) CanTransitionTo(target BackupStatus) bool {
	switch bs {
	case BackupStatusCreating:
		return target == BackupStatusCompleted || target == BackupStatusFailed
	case BackupStatusCompleted:
		return target == BackupStatusRestoring
	case BackupStatusFailed:
		return target == BackupStatusCreating // Allow retry
	case BackupStatusRestoring:
		return target == BackupStatusCompleted || target == BackupStatusFailed
	default:
		return false
	}
}

// CompressionType represents the compression algorithm used for backups
type CompressionType string

const (
	CompressionTypeNone CompressionType = "none"
	CompressionTypeGzip CompressionType = "gzip"
	CompressionTypeLz4  CompressionType = "lz4"
)

// IsValid checks if the compression type is valid
func (ct CompressionType) IsValid() bool {
	switch ct {
	case CompressionTypeNone, CompressionTypeGzip, CompressionTypeLz4:
		return true
	default:
		return false
	}
}

// GetFileExtension returns the appropriate file extension for the compression type
func (ct CompressionType) GetFileExtension() string {
	switch ct {
	case CompressionTypeGzip:
		return ".tar.gz"
	case CompressionTypeLz4:
		return ".tar.lz4"
	default:
		return ".tar"
	}
}

// BackupMetadata represents additional metadata about the backup
type BackupMetadata map[string]interface{}

// BackupSnapshot represents point-in-time server data captures with metadata for restoration
type BackupSnapshot struct {
	ID              uuid.UUID       `json:"id" db:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	ServerID        uuid.UUID       `json:"server_id" db:"server_id" gorm:"type:uuid;not null;index" validate:"required"`
	BackupType      BackupType      `json:"backup_type" db:"backup_type" gorm:"not null" validate:"required"`
	StoragePath     string          `json:"storage_path" db:"storage_path" gorm:"uniqueIndex;not null" validate:"required"`
	SizeBytes       int64           `json:"size_bytes" db:"size_bytes" gorm:"default:0" validate:"gte=0"`
	CompressionType CompressionType `json:"compression_type" db:"compression_type" gorm:"not null" validate:"required"`
	Status          BackupStatus    `json:"status" db:"status" gorm:"not null" validate:"required"`
	RetentionUntil  time.Time       `json:"retention_until" db:"retention_until" gorm:"index" validate:"required"`
	Metadata        BackupMetadata  `json:"metadata" db:"metadata" gorm:"type:jsonb"`
	ErrorMessage    string          `json:"error_message,omitempty" db:"error_message" gorm:"type:text"`
	CreatedAt       time.Time       `json:"created_at" db:"created_at" gorm:"autoCreateTime"`
	UpdatedAt       time.Time       `json:"updated_at" db:"updated_at" gorm:"autoUpdateTime"`

	// Relationship (loaded separately)
	Server *ServerInstance `json:"server,omitempty" gorm:"foreignKey:ServerID"`
}

// BackupSnapshotRepository defines the interface for Backup Snapshot data operations
type BackupSnapshotRepository interface {
	Create(ctx context.Context, backup *BackupSnapshot) error
	GetByID(ctx context.Context, id uuid.UUID) (*BackupSnapshot, error)
	GetByServer(ctx context.Context, serverID uuid.UUID, status *BackupStatus, limit, offset int) ([]*BackupSnapshot, error)
	GetByStoragePath(ctx context.Context, storagePath string) (*BackupSnapshot, error)
	Update(ctx context.Context, backup *BackupSnapshot) error
	UpdateStatus(ctx context.Context, id uuid.UUID, status BackupStatus, errorMessage string) error
	Delete(ctx context.Context, id uuid.UUID) error
	DeleteExpired(ctx context.Context) (int, error)
	GetExpiredBackups(ctx context.Context, before time.Time) ([]*BackupSnapshot, error)
	GetBackupStats(ctx context.Context, serverID uuid.UUID) (*BackupStats, error)
	GetStorageUsage(ctx context.Context, serverID *uuid.UUID) (int64, error)
}

// BackupStats represents backup statistics for a server
type BackupStats struct {
	TotalBackups     int           `json:"total_backups"`
	TotalSizeBytes   int64         `json:"total_size_bytes"`
	CompletedBackups int           `json:"completed_backups"`
	FailedBackups    int           `json:"failed_backups"`
	OldestBackup     *time.Time    `json:"oldest_backup"`
	NewestBackup     *time.Time    `json:"newest_backup"`
	AverageSize      int64         `json:"average_size"`
	CompressionRatio float64       `json:"compression_ratio"`
}

// TableName returns the table name for GORM
func (BackupSnapshot) TableName() string {
	return "backup_snapshots"
}

// Validate performs comprehensive validation on the BackupSnapshot
func (bs *BackupSnapshot) Validate() error {
	if bs.ServerID == uuid.Nil {
		return errors.New("server_id is required")
	}

	if !bs.BackupType.IsValid() {
		return fmt.Errorf("backup_type must be one of: %s, %s, %s",
			BackupTypeManual, BackupTypeScheduled, BackupTypePreTermination)
	}

	if bs.StoragePath == "" {
		return errors.New("storage_path is required")
	}

	if !isValidStoragePath(bs.StoragePath) {
		return errors.New("storage_path must be a valid object storage path")
	}

	if bs.SizeBytes < 0 {
		return errors.New("size_bytes must be non-negative")
	}

	if !bs.CompressionType.IsValid() {
		return fmt.Errorf("compression_type must be one of: %s, %s, %s",
			CompressionTypeNone, CompressionTypeGzip, CompressionTypeLz4)
	}

	if !bs.Status.IsValid() {
		return fmt.Errorf("status must be one of: %s, %s, %s, %s",
			BackupStatusCreating, BackupStatusCompleted, BackupStatusFailed, BackupStatusRestoring)
	}

	if bs.RetentionUntil.Before(time.Now().UTC()) {
		return errors.New("retention_until must be a future date")
	}

	// Validate metadata if provided
	if bs.Metadata != nil {
		if err := bs.validateMetadata(); err != nil {
			return fmt.Errorf("metadata validation failed: %w", err)
		}
	}

	// Validate status-specific requirements
	if bs.Status == BackupStatusFailed && bs.ErrorMessage == "" {
		return errors.New("error_message is required when status is failed")
	}

	return nil
}

// validateMetadata validates backup metadata
func (bs *BackupSnapshot) validateMetadata() error {
	if len(bs.Metadata) > 50 {
		return errors.New("too many metadata entries (max 50)")
	}

	for key, value := range bs.Metadata {
		if key == "" {
			return errors.New("metadata key cannot be empty")
		}

		if len(key) > 100 {
			return fmt.Errorf("metadata key '%s' too long (max 100 characters)", key)
		}

		// Validate value types
		switch v := value.(type) {
		case nil, bool, string, int, int32, int64, float32, float64:
			// Valid basic types
		case []interface{}, map[string]interface{}:
			// Valid complex types, but limit depth/size
			if str, ok := value.(string); ok && len(str) > 1000 {
				return fmt.Errorf("metadata string value for key '%s' too long (max 1000 characters)", key)
			}
		default:
			return fmt.Errorf("metadata value for key '%s' has unsupported type: %T", key, v)
		}
	}

	return nil
}

// BeforeCreate is called before creating a new BackupSnapshot
func (bs *BackupSnapshot) BeforeCreate() error {
	if bs.ID == uuid.Nil {
		bs.ID = uuid.New()
	}

	now := time.Now().UTC()
	bs.CreatedAt = now
	bs.UpdatedAt = now

	// Set default retention if not specified (30 days)
	if bs.RetentionUntil.IsZero() {
		bs.RetentionUntil = now.AddDate(0, 0, 30)
	}

	// Generate storage path if not provided
	if bs.StoragePath == "" {
		bs.StoragePath = bs.generateStoragePath()
	}

	return bs.Validate()
}

// BeforeUpdate is called before updating a BackupSnapshot
func (bs *BackupSnapshot) BeforeUpdate() error {
	bs.UpdatedAt = time.Now().UTC()
	return bs.Validate()
}

// generateStoragePath generates a unique storage path for the backup
func (bs *BackupSnapshot) generateStoragePath() string {
	timestamp := time.Now().UTC().Format("2006-01-02T15-04-05Z")
	filename := fmt.Sprintf("backup-%s-%s%s", bs.ServerID.String()[:8], timestamp, bs.CompressionType.GetFileExtension())
	return filepath.Join("backups", bs.ServerID.String(), filename)
}

// UpdateStatus updates the backup status with optional error message
func (bs *BackupSnapshot) UpdateStatus(status BackupStatus, errorMessage string) error {
	if !bs.Status.CanTransitionTo(status) {
		return fmt.Errorf("cannot transition from %s to %s", bs.Status, status)
	}

	bs.Status = status
	bs.ErrorMessage = errorMessage
	bs.UpdatedAt = time.Now().UTC()

	return bs.Validate()
}

// IsCompleted returns true if the backup is successfully completed
func (bs *BackupSnapshot) IsCompleted() bool {
	return bs.Status == BackupStatusCompleted
}

// IsFailed returns true if the backup failed
func (bs *BackupSnapshot) IsFailed() bool {
	return bs.Status == BackupStatusFailed
}

// IsInProgress returns true if backup creation or restoration is in progress
func (bs *BackupSnapshot) IsInProgress() bool {
	return bs.Status == BackupStatusCreating || bs.Status == BackupStatusRestoring
}

// IsExpired returns true if the backup has passed its retention period
func (bs *BackupSnapshot) IsExpired() bool {
	return time.Now().UTC().After(bs.RetentionUntil)
}

// GetAge returns the age of the backup
func (bs *BackupSnapshot) GetAge() time.Duration {
	return time.Since(bs.CreatedAt)
}

// GetTimeUntilExpiry returns the time until the backup expires
func (bs *BackupSnapshot) GetTimeUntilExpiry() time.Duration {
	return time.Until(bs.RetentionUntil)
}

// GetFormattedSize returns the backup size in human-readable format
func (bs *BackupSnapshot) GetFormattedSize() string {
	const unit = 1024
	if bs.SizeBytes < unit {
		return fmt.Sprintf("%d B", bs.SizeBytes)
	}
	div, exp := int64(unit), 0
	for n := bs.SizeBytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bs.SizeBytes)/float64(div), "KMGTPE"[exp])
}

// GetMetadataValue returns a metadata value by key
func (bs *BackupSnapshot) GetMetadataValue(key string) (interface{}, bool) {
	if bs.Metadata == nil {
		return nil, false
	}
	value, exists := bs.Metadata[key]
	return value, exists
}

// SetMetadataValue sets a metadata value
func (bs *BackupSnapshot) SetMetadataValue(key string, value interface{}) {
	if bs.Metadata == nil {
		bs.Metadata = make(BackupMetadata)
	}
	bs.Metadata[key] = value
}

// RemoveMetadataValue removes a metadata value
func (bs *BackupSnapshot) RemoveMetadataValue(key string) {
	if bs.Metadata != nil {
		delete(bs.Metadata, key)
	}
}

// ExtendRetention extends the retention period by the specified duration
func (bs *BackupSnapshot) ExtendRetention(duration time.Duration) {
	bs.RetentionUntil = bs.RetentionUntil.Add(duration)
}

// Value implements the driver.Valuer interface for BackupMetadata
func (bm BackupMetadata) Value() (driver.Value, error) {
	if bm == nil {
		return nil, nil
	}
	return json.Marshal(bm)
}

// Scan implements the sql.Scanner interface for BackupMetadata
func (bm *BackupMetadata) Scan(value interface{}) error {
	if value == nil {
		*bm = nil
		return nil
	}

	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, bm)
	case string:
		return json.Unmarshal([]byte(v), bm)
	default:
		return fmt.Errorf("cannot scan %T into BackupMetadata", value)
	}
}

// CreateBackupSnapshotTable returns the SQL DDL for creating the backup_snapshots table
func CreateBackupSnapshotTable() string {
	return `
CREATE TABLE IF NOT EXISTS backup_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL,
    backup_type VARCHAR(20) NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    compression_type VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL,
    retention_until TIMESTAMPTZ NOT NULL,
    metadata JSONB DEFAULT '{}',
    error_message TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Foreign key constraints
    FOREIGN KEY (server_id) REFERENCES server_instances(id) ON DELETE CASCADE,

    -- Constraints
    CONSTRAINT chk_backup_type_valid CHECK (backup_type IN ('manual', 'scheduled', 'pre_termination')),
    CONSTRAINT chk_compression_type_valid CHECK (compression_type IN ('none', 'gzip', 'lz4')),
    CONSTRAINT chk_status_valid CHECK (status IN ('creating', 'completed', 'failed', 'restoring')),
    CONSTRAINT chk_size_bytes_non_negative CHECK (size_bytes >= 0),
    CONSTRAINT chk_retention_future CHECK (retention_until > created_at),

    -- Indexes for performance
    INDEX idx_backup_snapshots_server_id (server_id),
    INDEX idx_backup_snapshots_status (status),
    INDEX idx_backup_snapshots_retention_until (retention_until),
    INDEX idx_backup_snapshots_backup_type (backup_type),
    INDEX idx_backup_snapshots_created_at (created_at DESC),
    INDEX idx_backup_snapshots_server_created (server_id, created_at DESC)
);

-- Index for finding expired backups efficiently
CREATE INDEX idx_backup_snapshots_expired ON backup_snapshots (retention_until, status)
WHERE status = 'completed';

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER update_backup_snapshots_updated_at
    BEFORE UPDATE ON backup_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
`
}

// DropBackupSnapshotTable returns the SQL DDL for dropping the backup_snapshots table
func DropBackupSnapshotTable() string {
	return `
DROP TRIGGER IF EXISTS update_backup_snapshots_updated_at ON backup_snapshots;
DROP INDEX IF EXISTS idx_backup_snapshots_expired;
DROP TABLE IF EXISTS backup_snapshots CASCADE;
`
}

// isValidStoragePath validates storage path format
func isValidStoragePath(path string) bool {
	if path == "" || len(path) > 500 {
		return false
	}

	// Must be a reasonable object storage path
	// Allow alphanumeric, hyphens, underscores, slashes, and dots
	validPathRegex := regexp.MustCompile(`^[a-zA-Z0-9/_.\-]+$`)
	if !validPathRegex.MatchString(path) {
		return false
	}

	// Should not start or end with slash
	if strings.HasPrefix(path, "/") || strings.HasSuffix(path, "/") {
		return false
	}

	// Should not contain double slashes
	if strings.Contains(path, "//") {
		return false
	}

	return true
}

// BackupSnapshotCreateRequest represents the request payload for creating a backup snapshot
type BackupSnapshotCreateRequest struct {
	ServerID        uuid.UUID       `json:"server_id" validate:"required,uuid"`
	BackupType      BackupType      `json:"backup_type" validate:"required"`
	CompressionType CompressionType `json:"compression_type,omitempty"`
	RetentionDays   int             `json:"retention_days,omitempty" validate:"omitempty,min=1,max=365"`
	Metadata        BackupMetadata  `json:"metadata,omitempty"`
}

// ToBackupSnapshot converts the create request to a BackupSnapshot model
func (r *BackupSnapshotCreateRequest) ToBackupSnapshot() *BackupSnapshot {
	// Set default compression if not specified
	compression := r.CompressionType
	if compression == "" {
		compression = CompressionTypeGzip
	}

	// Set default retention if not specified
	retentionDays := r.RetentionDays
	if retentionDays == 0 {
		retentionDays = 30
	}

	return &BackupSnapshot{
		ServerID:        r.ServerID,
		BackupType:      r.BackupType,
		CompressionType: compression,
		Status:          BackupStatusCreating, // Start in creating state
		RetentionUntil:  time.Now().UTC().AddDate(0, 0, retentionDays),
		Metadata:        r.Metadata,
	}
}

// BackupSnapshotUpdateRequest represents the request payload for updating a backup snapshot
type BackupSnapshotUpdateRequest struct {
	Status         *BackupStatus   `json:"status,omitempty"`
	SizeBytes      *int64          `json:"size_bytes,omitempty" validate:"omitempty,gte=0"`
	RetentionUntil *time.Time      `json:"retention_until,omitempty"`
	Metadata       *BackupMetadata `json:"metadata,omitempty"`
	ErrorMessage   *string         `json:"error_message,omitempty"`
}

// ApplyTo applies the update request to an existing BackupSnapshot
func (r *BackupSnapshotUpdateRequest) ApplyTo(backup *BackupSnapshot) error {
	if r.Status != nil {
		errorMsg := ""
		if r.ErrorMessage != nil {
			errorMsg = *r.ErrorMessage
		}
		if err := backup.UpdateStatus(*r.Status, errorMsg); err != nil {
			return err
		}
	}

	if r.SizeBytes != nil {
		backup.SizeBytes = *r.SizeBytes
	}

	if r.RetentionUntil != nil {
		backup.RetentionUntil = *r.RetentionUntil
	}

	if r.Metadata != nil {
		backup.Metadata = *r.Metadata
	}

	if r.ErrorMessage != nil {
		backup.ErrorMessage = *r.ErrorMessage
	}

	return nil
}

// BackupSnapshotResponse represents the response payload for backup snapshot operations
type BackupSnapshotResponse struct {
	ID                uuid.UUID       `json:"id"`
	ServerID          uuid.UUID       `json:"server_id"`
	BackupType        BackupType      `json:"backup_type"`
	StoragePath       string          `json:"storage_path"`
	SizeBytes         int64           `json:"size_bytes"`
	FormattedSize     string          `json:"formatted_size"`
	CompressionType   CompressionType `json:"compression_type"`
	Status            BackupStatus    `json:"status"`
	RetentionUntil    time.Time       `json:"retention_until"`
	Metadata          BackupMetadata  `json:"metadata"`
	ErrorMessage      string          `json:"error_message,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
	IsCompleted       bool            `json:"is_completed"`
	IsFailed          bool            `json:"is_failed"`
	IsInProgress      bool            `json:"is_in_progress"`
	IsExpired         bool            `json:"is_expired"`
	Age               time.Duration   `json:"age"`
	TimeUntilExpiry   time.Duration   `json:"time_until_expiry"`

	// Embedded related objects (when requested)
	Server *ServerInstanceResponse `json:"server,omitempty"`
}

// FromBackupSnapshot converts a BackupSnapshot model to a response payload
func (r *BackupSnapshotResponse) FromBackupSnapshot(backup *BackupSnapshot) {
	r.ID = backup.ID
	r.ServerID = backup.ServerID
	r.BackupType = backup.BackupType
	r.StoragePath = backup.StoragePath
	r.SizeBytes = backup.SizeBytes
	r.FormattedSize = backup.GetFormattedSize()
	r.CompressionType = backup.CompressionType
	r.Status = backup.Status
	r.RetentionUntil = backup.RetentionUntil
	r.Metadata = backup.Metadata
	r.ErrorMessage = backup.ErrorMessage
	r.CreatedAt = backup.CreatedAt
	r.UpdatedAt = backup.UpdatedAt
	r.IsCompleted = backup.IsCompleted()
	r.IsFailed = backup.IsFailed()
	r.IsInProgress = backup.IsInProgress()
	r.IsExpired = backup.IsExpired()
	r.Age = backup.GetAge()
	r.TimeUntilExpiry = backup.GetTimeUntilExpiry()

	// Include related objects if they're loaded
	if backup.Server != nil {
		r.Server = NewServerInstanceResponse(backup.Server)
	}
}

// NewBackupSnapshotResponse creates a new BackupSnapshotResponse from a BackupSnapshot
func NewBackupSnapshotResponse(backup *BackupSnapshot) *BackupSnapshotResponse {
	response := &BackupSnapshotResponse{}
	response.FromBackupSnapshot(backup)
	return response
}

// BackupSnapshotListResponse represents the response for listing backup snapshots
type BackupSnapshotListResponse struct {
	Backups      []*BackupSnapshotResponse `json:"backups"`
	Total        int                       `json:"total"`
	Page         int                       `json:"page"`
	PageSize     int                       `json:"page_size"`
	TotalPages   int                       `json:"total_pages"`
	TotalSize    int64                     `json:"total_size"`
	StorageQuota int64                     `json:"storage_quota,omitempty"`
}

// NewBackupSnapshotListResponse creates a paginated response for backup snapshots
func NewBackupSnapshotListResponse(backups []*BackupSnapshot, total, page, pageSize int, totalSize, storageQuota int64) *BackupSnapshotListResponse {
	responses := make([]*BackupSnapshotResponse, len(backups))
	for i, backup := range backups {
		responses[i] = NewBackupSnapshotResponse(backup)
	}

	totalPages := (total + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}

	return &BackupSnapshotListResponse{
		Backups:      responses,
		Total:        total,
		Page:         page,
		PageSize:     pageSize,
		TotalPages:   totalPages,
		TotalSize:    totalSize,
		StorageQuota: storageQuota,
	}
}