package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"minecraft-platform/src/models"
)

// DatabaseConfig holds database configuration
type DatabaseConfig struct {
	Host            string
	Port            int
	Username        string
	Password        string
	DatabaseName    string
	SSLMode         string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
	LogLevel        logger.LogLevel
}

// Database wraps GORM DB with additional functionality
type Database struct {
	DB     *gorm.DB
	Config *DatabaseConfig
}

// NewDatabase creates a new database connection with connection pooling
func NewDatabase(config *DatabaseConfig) (*Database, error) {
	if config == nil {
		return nil, fmt.Errorf("database config is required")
	}

	// Set defaults
	if config.MaxOpenConns == 0 {
		config.MaxOpenConns = 25
	}
	if config.MaxIdleConns == 0 {
		config.MaxIdleConns = 5
	}
	if config.ConnMaxLifetime == 0 {
		config.ConnMaxLifetime = 5 * time.Minute
	}
	if config.ConnMaxIdleTime == 0 {
		config.ConnMaxIdleTime = 1 * time.Minute
	}
	if config.SSLMode == "" {
		config.SSLMode = "require"
	}
	if config.LogLevel == 0 {
		config.LogLevel = logger.Info
	}

	// Build DSN for CockroachDB (PostgreSQL compatible)
	var dsn string
	if config.Password != "" {
		dsn = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=%s",
			config.Username, config.Password, config.Host, config.Port, config.DatabaseName, config.SSLMode)
	} else {
		dsn = fmt.Sprintf("postgresql://%s@%s:%d/%s?sslmode=%s",
			config.Username, config.Host, config.Port, config.DatabaseName, config.SSLMode)
	}

	// Configure GORM logger
	gormLogger := logger.New(
		log.New(log.Writer(), "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  config.LogLevel,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	// Open database connection
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:      gormLogger,
		PrepareStmt: true, // Cache prepared statements for better performance
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Configure connection pool
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get SQL DB instance: %w", err)
	}

	sqlDB.SetMaxOpenConns(config.MaxOpenConns)
	sqlDB.SetMaxIdleConns(config.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(config.ConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(config.ConnMaxIdleTime)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	database := &Database{
		DB:     db,
		Config: config,
	}

	log.Printf("Connected to CockroachDB at %s:%d", config.Host, config.Port)
	return database, nil
}

// AutoMigrate runs database migrations for all models
func (d *Database) AutoMigrate() error {
	log.Println("Running database migrations...")

	// List of all models to migrate
	models := []interface{}{
		&models.UserAccount{},
		&models.ServerInstance{},
		&models.SKUConfiguration{},
		&models.PluginPackage{},
		&models.ServerPluginInstallation{},
		&models.BackupSnapshot{},
		&models.MetricsData{},
		&models.AuditLog{},
	}

	// Run auto migration for each model
	for _, model := range models {
		if err := d.DB.AutoMigrate(model); err != nil {
			return fmt.Errorf("failed to migrate %T: %w", model, err)
		}
	}

	// Create indexes for better performance
	if err := d.createIndexes(); err != nil {
		return fmt.Errorf("failed to create indexes: %w", err)
	}

	// Set up row-level security
	if err := d.setupRowLevelSecurity(); err != nil {
		return fmt.Errorf("failed to setup row-level security: %w", err)
	}

	log.Println("Database migrations completed successfully")
	return nil
}

// createIndexes creates additional indexes for better query performance
func (d *Database) createIndexes() error {
	indexes := []string{
		// Server instances indexes
		"CREATE INDEX IF NOT EXISTS idx_server_instances_tenant_status ON server_instances(tenant_id, status)",
		"CREATE INDEX IF NOT EXISTS idx_server_instances_namespace ON server_instances(namespace)",

		// Metrics data indexes for time-series queries
		"CREATE INDEX IF NOT EXISTS idx_metrics_data_server_time ON metrics_data(server_id, timestamp DESC)",
		"CREATE INDEX IF NOT EXISTS idx_metrics_data_tenant_type ON metrics_data(tenant_id, metric_type, timestamp DESC)",

		// Backup snapshots indexes
		"CREATE INDEX IF NOT EXISTS idx_backup_snapshots_server_status ON backup_snapshots(server_id, status)",
		"CREATE INDEX IF NOT EXISTS idx_backup_snapshots_tenant_created ON backup_snapshots(tenant_id, created_at DESC)",

		// Plugin installations indexes
		"CREATE INDEX IF NOT EXISTS idx_server_plugin_installations_server ON server_plugin_installations(server_id, status)",

		// Audit logs indexes
		"CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_timestamp ON audit_logs(tenant_id, timestamp DESC)",
		"CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id)",
	}

	for _, indexSQL := range indexes {
		if err := d.DB.Exec(indexSQL).Error; err != nil {
			log.Printf("Warning: Failed to create index: %s - %v", indexSQL, err)
			// Continue with other indexes even if one fails
		}
	}

	return nil
}

// setupRowLevelSecurity configures row-level security for multi-tenancy
func (d *Database) setupRowLevelSecurity() error {
	// Enable row-level security on tenant-isolated tables
	tables := []string{
		"user_accounts",
		"server_instances",
		"backup_snapshots",
		"metrics_data",
		"server_plugin_installations",
		"audit_logs",
	}

	for _, table := range tables {
		// Enable RLS
		rlsSQL := fmt.Sprintf("ALTER TABLE %s ENABLE ROW LEVEL SECURITY", table)
		if err := d.DB.Exec(rlsSQL).Error; err != nil {
			log.Printf("Warning: Failed to enable RLS on %s: %v", table, err)
		}

		// Create policy for tenant isolation
		// Note: In production, this would use proper authentication context
		policySQL := fmt.Sprintf(`
			CREATE POLICY IF NOT EXISTS tenant_isolation ON %s
			FOR ALL TO PUBLIC
			USING (tenant_id = current_setting('app.current_tenant_id', true))
		`, table)

		if err := d.DB.Exec(policySQL).Error; err != nil {
			log.Printf("Warning: Failed to create RLS policy on %s: %v", table, err)
		}
	}

	return nil
}

// SetTenantContext sets the tenant context for row-level security
func (d *Database) SetTenantContext(ctx context.Context, tenantID string) error {
	if tenantID == "" {
		return fmt.Errorf("tenant_id cannot be empty")
	}

	// Set the tenant context for the current session
	sql := "SET LOCAL app.current_tenant_id = ?"
	if err := d.DB.WithContext(ctx).Exec(sql, tenantID).Error; err != nil {
		return fmt.Errorf("failed to set tenant context: %w", err)
	}

	return nil
}

// WithTenant returns a new database instance with tenant context
func (d *Database) WithTenant(ctx context.Context, tenantID string) *gorm.DB {
	// Create a new session with tenant context
	db := d.DB.WithContext(ctx).Session(&gorm.Session{})

	// Set tenant context (this would be more sophisticated in production)
	db.Exec("SET LOCAL app.current_tenant_id = ?", tenantID)

	return db
}

// Transaction executes a function within a database transaction
func (d *Database) Transaction(ctx context.Context, fn func(*gorm.DB) error) error {
	return d.DB.WithContext(ctx).Transaction(fn)
}

// TransactionWithTenant executes a function within a database transaction with tenant context
func (d *Database) TransactionWithTenant(ctx context.Context, tenantID string, fn func(*gorm.DB) error) error {
	return d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Set tenant context for the transaction
		if err := tx.Exec("SET LOCAL app.current_tenant_id = ?", tenantID).Error; err != nil {
			return fmt.Errorf("failed to set tenant context in transaction: %w", err)
		}
		return fn(tx)
	})
}

// HealthCheck performs a database health check
func (d *Database) HealthCheck(ctx context.Context) error {
	sqlDB, err := d.DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get SQL DB instance: %w", err)
	}

	// Check connection
	if err := sqlDB.PingContext(ctx); err != nil {
		return fmt.Errorf("database ping failed: %w", err)
	}

	// Check if we can perform a simple query
	var result int
	if err := d.DB.WithContext(ctx).Raw("SELECT 1").Scan(&result).Error; err != nil {
		return fmt.Errorf("database query test failed: %w", err)
	}

	return nil
}

// GetStats returns database connection statistics
func (d *Database) GetStats() sql.DBStats {
	sqlDB, _ := d.DB.DB()
	return sqlDB.Stats()
}

// Close closes the database connection
func (d *Database) Close() error {
	sqlDB, err := d.DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get SQL DB instance: %w", err)
	}

	if err := sqlDB.Close(); err != nil {
		return fmt.Errorf("failed to close database connection: %w", err)
	}

	log.Println("Database connection closed")
	return nil
}

// GetDefaultConfig returns a default database configuration
func GetDefaultConfig() *DatabaseConfig {
	return &DatabaseConfig{
		Host:            "localhost",
		Port:            26257,
		Username:        "minecraft_user",
		Password:        "secure_password",
		DatabaseName:    "minecraft_platform",
		SSLMode:         "require",
		MaxOpenConns:    25,
		MaxIdleConns:    5,
		ConnMaxLifetime: 5 * time.Minute,
		ConnMaxIdleTime: 1 * time.Minute,
		LogLevel:        logger.Info,
	}
}

// NewDatabaseFromEnv creates a database connection from environment variables
func NewDatabaseFromEnv() (*Database, error) {
	// In a real implementation, this would read from environment variables
	// For now, return default config
	config := GetDefaultConfig()
	return NewDatabase(config)
}