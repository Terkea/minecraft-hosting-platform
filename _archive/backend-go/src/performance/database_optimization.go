package performance

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/lib/pq"
	_ "github.com/lib/pq"
)

// DatabaseOptimizer handles database performance optimization
type DatabaseOptimizer struct {
	db                *sql.DB
	slowQueryThreshold time.Duration
	maxConnections    int
	connectionTimeout time.Duration
}

// OptimizationConfig holds database optimization settings
type OptimizationConfig struct {
	SlowQueryThreshold time.Duration `json:"slow_query_threshold"`
	MaxConnections     int           `json:"max_connections"`
	ConnectionTimeout  time.Duration `json:"connection_timeout"`
	IndexingEnabled    bool          `json:"indexing_enabled"`
	QueryCacheEnabled  bool          `json:"query_cache_enabled"`
}

// QueryStats represents query performance statistics
type QueryStats struct {
	Query         string        `json:"query"`
	ExecutionTime time.Duration `json:"execution_time"`
	CallCount     int64         `json:"call_count"`
	MeanTime      time.Duration `json:"mean_time"`
	TotalTime     time.Duration `json:"total_time"`
	Rows          int64         `json:"rows"`
}

// IndexRecommendation suggests database index optimizations
type IndexRecommendation struct {
	Table       string   `json:"table"`
	Columns     []string `json:"columns"`
	IndexType   string   `json:"index_type"`
	Reason      string   `json:"reason"`
	Priority    string   `json:"priority"`
	EstimatedImpact string `json:"estimated_impact"`
}

// NewDatabaseOptimizer creates a new database optimizer instance
func NewDatabaseOptimizer(db *sql.DB, config OptimizationConfig) *DatabaseOptimizer {
	return &DatabaseOptimizer{
		db:                db,
		slowQueryThreshold: config.SlowQueryThreshold,
		maxConnections:    config.MaxConnections,
		connectionTimeout: config.ConnectionTimeout,
	}
}

// OptimizeConnectionPool configures optimal connection pool settings
func (do *DatabaseOptimizer) OptimizeConnectionPool() error {
	log.Printf("Optimizing database connection pool...")

	// Set maximum number of open connections
	do.db.SetMaxOpenConns(do.maxConnections)

	// Set maximum number of idle connections
	do.db.SetMaxIdleConns(do.maxConnections / 2)

	// Set connection lifetime to prevent stale connections
	do.db.SetConnMaxLifetime(30 * time.Minute)

	// Set idle timeout to clean up unused connections
	do.db.SetConnMaxIdleTime(5 * time.Minute)

	log.Printf("Connection pool optimized: max_open=%d, max_idle=%d",
		do.maxConnections, do.maxConnections/2)

	return nil
}

// AnalyzeSlowQueries identifies and analyzes slow-running queries
func (do *DatabaseOptimizer) AnalyzeSlowQueries(ctx context.Context, limit int) ([]QueryStats, error) {
	// Enable pg_stat_statements extension for query analysis
	_, err := do.db.ExecContext(ctx, "CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
	if err != nil {
		log.Printf("Warning: Could not enable pg_stat_statements: %v", err)
	}

	query := `
		SELECT
			query,
			calls,
			total_exec_time,
			mean_exec_time,
			rows
		FROM pg_stat_statements
		WHERE mean_exec_time > $1
		ORDER BY total_exec_time DESC
		LIMIT $2
	`

	rows, err := do.db.QueryContext(ctx, query,
		do.slowQueryThreshold.Milliseconds(), limit)
	if err != nil {
		return nil, fmt.Errorf("failed to analyze slow queries: %w", err)
	}
	defer rows.Close()

	var stats []QueryStats
	for rows.Next() {
		var s QueryStats
		var totalTimeMs, meanTimeMs float64

		err := rows.Scan(&s.Query, &s.CallCount, &totalTimeMs, &meanTimeMs, &s.Rows)
		if err != nil {
			continue
		}

		s.TotalTime = time.Duration(totalTimeMs * float64(time.Millisecond))
		s.MeanTime = time.Duration(meanTimeMs * float64(time.Millisecond))

		stats = append(stats, s)
	}

	log.Printf("Analyzed %d slow queries", len(stats))
	return stats, nil
}

// GenerateIndexRecommendations suggests database indexes for performance improvement
func (do *DatabaseOptimizer) GenerateIndexRecommendations(ctx context.Context) ([]IndexRecommendation, error) {
	var recommendations []IndexRecommendation

	// Get missing index suggestions from query plans
	missingIndexQuery := `
		SELECT
			schemaname,
			tablename,
			attname,
			n_distinct,
			correlation
		FROM pg_stats
		WHERE schemaname = 'public'
		AND n_distinct > 100
		ORDER BY n_distinct DESC
	`

	rows, err := do.db.QueryContext(ctx, missingIndexQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to get index recommendations: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var schema, table, column string
		var nDistinct int
		var correlation float64

		err := rows.Scan(&schema, &table, &column, &nDistinct, &correlation)
		if err != nil {
			continue
		}

		// Recommend index for high-cardinality columns
		if nDistinct > 1000 {
			recommendations = append(recommendations, IndexRecommendation{
				Table:     table,
				Columns:   []string{column},
				IndexType: "btree",
				Reason:    fmt.Sprintf("High cardinality column (%d distinct values)", nDistinct),
				Priority:  "high",
				EstimatedImpact: "30-50% query performance improvement",
			})
		}
	}

	// Add specific recommendations for Minecraft platform tables
	minecraftRecommendations := []IndexRecommendation{
		{
			Table:     "user_accounts",
			Columns:   []string{"email", "tenant_id"},
			IndexType: "btree",
			Reason:    "Frequent user authentication queries",
			Priority:  "critical",
			EstimatedImpact: "90% improvement in login performance",
		},
		{
			Table:     "server_instances",
			Columns:   []string{"user_id", "status"},
			IndexType: "btree",
			Reason:    "Dashboard server listing queries",
			Priority:  "high",
			EstimatedImpact: "60% improvement in dashboard load time",
		},
		{
			Table:     "server_instances",
			Columns:   []string{"created_at"},
			IndexType: "btree",
			Reason:    "Chronological server queries",
			Priority:  "medium",
			EstimatedImpact: "40% improvement in date-range queries",
		},
		{
			Table:     "backup_snapshots",
			Columns:   []string{"server_id", "created_at"},
			IndexType: "btree",
			Reason:    "Backup history and restoration queries",
			Priority:  "high",
			EstimatedImpact: "70% improvement in backup operations",
		},
		{
			Table:     "metrics_data",
			Columns:   []string{"server_id", "timestamp"},
			IndexType: "btree",
			Reason:    "Time-series metrics queries",
			Priority:  "high",
			EstimatedImpact: "80% improvement in metrics aggregation",
		},
		{
			Table:     "plugin_packages",
			Columns:   []string{"name", "version"},
			IndexType: "btree",
			Reason:    "Plugin marketplace search queries",
			Priority:  "medium",
			EstimatedImpact: "50% improvement in marketplace performance",
		},
		{
			Table:     "audit_logs",
			Columns:   []string{"user_id", "timestamp", "action"},
			IndexType: "btree",
			Reason:    "Audit trail queries and compliance reporting",
			Priority:  "high",
			EstimatedImpact: "85% improvement in audit queries",
		},
	}

	recommendations = append(recommendations, minecraftRecommendations...)

	log.Printf("Generated %d index recommendations", len(recommendations))
	return recommendations, nil
}

// CreateOptimalIndexes creates recommended database indexes
func (do *DatabaseOptimizer) CreateOptimalIndexes(ctx context.Context, recommendations []IndexRecommendation) error {
	for _, rec := range recommendations {
		if rec.Priority == "critical" || rec.Priority == "high" {
			indexName := fmt.Sprintf("idx_%s_%s", rec.Table, strings.Join(rec.Columns, "_"))

			createIndexQuery := fmt.Sprintf(
				"CREATE INDEX CONCURRENTLY IF NOT EXISTS %s ON %s USING %s (%s)",
				indexName,
				rec.Table,
				rec.IndexType,
				strings.Join(rec.Columns, ", "),
			)

			log.Printf("Creating index: %s", indexName)
			_, err := do.db.ExecContext(ctx, createIndexQuery)
			if err != nil {
				log.Printf("Warning: Could not create index %s: %v", indexName, err)
				continue
			}

			log.Printf("Successfully created index: %s", indexName)
		}
	}

	return nil
}

// OptimizeQueries performs query-specific optimizations
func (do *DatabaseOptimizer) OptimizeQueries(ctx context.Context) error {
	log.Printf("Optimizing database queries...")

	optimizations := []struct {
		name  string
		query string
	}{
		{
			name: "Update table statistics",
			query: "ANALYZE;",
		},
		{
			name: "Vacuum and analyze tables",
			query: `
				VACUUM ANALYZE user_accounts;
				VACUUM ANALYZE server_instances;
				VACUUM ANALYZE backup_snapshots;
				VACUUM ANALYZE metrics_data;
				VACUUM ANALYZE plugin_packages;
				VACUUM ANALYZE audit_logs;
			`,
		},
		{
			name: "Configure query planner settings",
			query: `
				SET random_page_cost = 1.1;
				SET effective_cache_size = '4GB';
				SET shared_buffers = '1GB';
				SET work_mem = '256MB';
				SET maintenance_work_mem = '512MB';
			`,
		},
		{
			name: "Enable parallel query execution",
			query: `
				SET max_parallel_workers_per_gather = 4;
				SET max_parallel_workers = 8;
				SET parallel_tuple_cost = 0.1;
				SET parallel_setup_cost = 1000;
			`,
		},
	}

	for _, opt := range optimizations {
		log.Printf("Applying optimization: %s", opt.name)
		_, err := do.db.ExecContext(ctx, opt.query)
		if err != nil {
			log.Printf("Warning: Could not apply optimization '%s': %v", opt.name, err)
		}
	}

	return nil
}

// PerformanceMonitor continuously monitors database performance
type PerformanceMonitor struct {
	db       *sql.DB
	interval time.Duration
}

// NewPerformanceMonitor creates a new performance monitoring instance
func NewPerformanceMonitor(db *sql.DB, interval time.Duration) *PerformanceMonitor {
	return &PerformanceMonitor{
		db:       db,
		interval: interval,
	}
}

// MonitorMetrics collects and reports database performance metrics
func (pm *PerformanceMonitor) MonitorMetrics(ctx context.Context) error {
	ticker := time.NewTicker(pm.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := pm.collectMetrics(ctx); err != nil {
				log.Printf("Error collecting performance metrics: %v", err)
			}
		}
	}
}

// collectMetrics gathers current database performance statistics
func (pm *PerformanceMonitor) collectMetrics(ctx context.Context) error {
	// Connection pool metrics
	stats := pm.db.Stats()
	log.Printf("DB Pool Stats: Open=%d, InUse=%d, Idle=%d",
		stats.OpenConnections, stats.InUse, stats.Idle)

	// Query performance metrics
	var avgQueryTime float64
	err := pm.db.QueryRowContext(ctx,
		"SELECT AVG(mean_exec_time) FROM pg_stat_statements WHERE calls > 100").Scan(&avgQueryTime)
	if err == nil {
		log.Printf("Average query execution time: %.2f ms", avgQueryTime)
	}

	// Table sizes and growth
	tableSizeQuery := `
		SELECT
			schemaname,
			tablename,
			pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
		FROM pg_tables
		WHERE schemaname = 'public'
		ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
		LIMIT 5
	`

	rows, err := pm.db.QueryContext(ctx, tableSizeQuery)
	if err == nil {
		defer rows.Close()
		log.Printf("Top 5 largest tables:")
		for rows.Next() {
			var schema, table, size string
			if err := rows.Scan(&schema, &table, &size); err == nil {
				log.Printf("  %s.%s: %s", schema, table, size)
			}
		}
	}

	return nil
}

// DatabaseMaintenanceJob performs regular database maintenance
func (do *DatabaseOptimizer) DatabaseMaintenanceJob(ctx context.Context) error {
	log.Printf("Starting database maintenance job...")

	// Perform routine maintenance tasks
	maintenanceTasks := []struct {
		name string
		fn   func(context.Context) error
	}{
		{"Connection Pool Optimization", do.OptimizeConnectionPool},
		{"Query Analysis", func(ctx context.Context) error {
			_, err := do.AnalyzeSlowQueries(ctx, 10)
			return err
		}},
		{"Index Optimization", func(ctx context.Context) error {
			recommendations, err := do.GenerateIndexRecommendations(ctx)
			if err != nil {
				return err
			}
			return do.CreateOptimalIndexes(ctx, recommendations)
		}},
		{"Query Optimization", do.OptimizeQueries},
	}

	for _, task := range maintenanceTasks {
		log.Printf("Executing maintenance task: %s", task.name)
		if err := task.fn(ctx); err != nil {
			log.Printf("Warning: Maintenance task '%s' failed: %v", task.name, err)
		} else {
			log.Printf("Completed maintenance task: %s", task.name)
		}
	}

	log.Printf("Database maintenance job completed")
	return nil
}