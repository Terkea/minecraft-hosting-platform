package unit

import (
	"testing"
	"time"

	"minecraft-platform/src/models"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestUserAccountValidation tests UserAccount model validation rules
func TestUserAccountValidation(t *testing.T) {
	tests := []struct {
		name        string
		userAccount models.UserAccount
		expectError bool
		errorMsg    string
	}{
		{
			name: "Valid user account",
			userAccount: models.UserAccount{
				Username: "testuser",
				Email:    "test@example.com",
				TenantID: "tenant-123",
			},
			expectError: false,
		},
		{
			name: "Empty username",
			userAccount: models.UserAccount{
				Username: "",
				Email:    "test@example.com",
				TenantID: "tenant-123",
			},
			expectError: true,
			errorMsg:    "username is required",
		},
		{
			name: "Invalid email format",
			userAccount: models.UserAccount{
				Username: "testuser",
				Email:    "invalid-email",
				TenantID: "tenant-123",
			},
			expectError: true,
			errorMsg:    "invalid email format",
		},
		{
			name: "Username too short",
			userAccount: models.UserAccount{
				Username: "ab",
				Email:    "test@example.com",
				TenantID: "tenant-123",
			},
			expectError: true,
			errorMsg:    "username must be at least 3 characters",
		},
		{
			name: "Username too long",
			userAccount: models.UserAccount{
				Username: "thisusernameiswaytoolongandexceedsthemaximumlength",
				Email:    "test@example.com",
				TenantID: "tenant-123",
			},
			expectError: true,
			errorMsg:    "username must not exceed 50 characters",
		},
		{
			name: "Empty tenant ID",
			userAccount: models.UserAccount{
				Username: "testuser",
				Email:    "test@example.com",
				TenantID: "",
			},
			expectError: true,
			errorMsg:    "tenant_id is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.userAccount.Validate()
			if tt.expectError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestServerInstanceValidation tests ServerInstance model validation rules
func TestServerInstanceValidation(t *testing.T) {
	tests := []struct {
		name           string
		serverInstance models.ServerInstance
		expectError    bool
		errorMsg       string
	}{
		{
			name: "Valid server instance",
			serverInstance: models.ServerInstance{
				Name:         "test-server",
				Version:      "1.20.1",
				Status:       models.ServerStatusStopped,
				Port:         25565,
				MaxPlayers:   20,
				TenantID:     "tenant-123",
				Namespace:    "minecraft-servers",
				ResourceLimits: models.ResourceLimits{
					CPU:    "1000m",
					Memory: "2Gi",
				},
			},
			expectError: false,
		},
		{
			name: "Empty server name",
			serverInstance: models.ServerInstance{
				Name:      "",
				Version:   "1.20.1",
				Status:    models.ServerStatusStopped,
				TenantID:  "tenant-123",
				Namespace: "minecraft-servers",
			},
			expectError: true,
			errorMsg:    "server name is required",
		},
		{
			name: "Invalid port range - too low",
			serverInstance: models.ServerInstance{
				Name:      "test-server",
				Version:   "1.20.1",
				Status:    models.ServerStatusStopped,
				Port:      1023,
				TenantID:  "tenant-123",
				Namespace: "minecraft-servers",
			},
			expectError: true,
			errorMsg:    "port must be between 1024 and 65535",
		},
		{
			name: "Invalid port range - too high",
			serverInstance: models.ServerInstance{
				Name:      "test-server",
				Version:   "1.20.1",
				Status:    models.ServerStatusStopped,
				Port:      70000,
				TenantID:  "tenant-123",
				Namespace: "minecraft-servers",
			},
			expectError: true,
			errorMsg:    "port must be between 1024 and 65535",
		},
		{
			name: "Invalid max players - negative",
			serverInstance: models.ServerInstance{
				Name:       "test-server",
				Version:    "1.20.1",
				Status:     models.ServerStatusStopped,
				Port:       25565,
				MaxPlayers: -1,
				TenantID:   "tenant-123",
				Namespace:  "minecraft-servers",
			},
			expectError: true,
			errorMsg:    "max_players must be between 1 and 1000",
		},
		{
			name: "Invalid max players - too high",
			serverInstance: models.ServerInstance{
				Name:       "test-server",
				Version:    "1.20.1",
				Status:     models.ServerStatusStopped,
				Port:       25565,
				MaxPlayers: 1001,
				TenantID:   "tenant-123",
				Namespace:  "minecraft-servers",
			},
			expectError: true,
			errorMsg:    "max_players must be between 1 and 1000",
		},
		{
			name: "Invalid server status",
			serverInstance: models.ServerInstance{
				Name:      "test-server",
				Version:   "1.20.1",
				Status:    "invalid-status",
				Port:      25565,
				TenantID:  "tenant-123",
				Namespace: "minecraft-servers",
			},
			expectError: true,
			errorMsg:    "invalid server status",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.serverInstance.Validate()
			if tt.expectError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestSKUConfigurationValidation tests SKU model validation rules
func TestSKUConfigurationValidation(t *testing.T) {
	tests := []struct {
		name           string
		skuConfig      models.SKUConfiguration
		expectError    bool
		errorMsg       string
	}{
		{
			name: "Valid SKU configuration",
			skuConfig: models.SKUConfiguration{
				Name:        "basic-plan",
				DisplayName: "Basic Plan",
				CPUCores:    1,
				MemoryGB:    2,
				StorageGB:   10,
				MaxPlayers:  20,
				PricePerHour: 0.50,
				Available:   true,
			},
			expectError: false,
		},
		{
			name: "Empty SKU name",
			skuConfig: models.SKUConfiguration{
				Name:         "",
				DisplayName:  "Basic Plan",
				CPUCores:     1,
				MemoryGB:     2,
				PricePerHour: 0.50,
			},
			expectError: true,
			errorMsg:    "SKU name is required",
		},
		{
			name: "Invalid CPU cores - zero",
			skuConfig: models.SKUConfiguration{
				Name:         "basic-plan",
				DisplayName:  "Basic Plan",
				CPUCores:     0,
				MemoryGB:     2,
				PricePerHour: 0.50,
			},
			expectError: true,
			errorMsg:    "CPU cores must be between 1 and 64",
		},
		{
			name: "Invalid CPU cores - too high",
			skuConfig: models.SKUConfiguration{
				Name:         "basic-plan",
				DisplayName:  "Basic Plan",
				CPUCores:     128,
				MemoryGB:     2,
				PricePerHour: 0.50,
			},
			expectError: true,
			errorMsg:    "CPU cores must be between 1 and 64",
		},
		{
			name: "Invalid memory - zero",
			skuConfig: models.SKUConfiguration{
				Name:         "basic-plan",
				DisplayName:  "Basic Plan",
				CPUCores:     1,
				MemoryGB:     0,
				PricePerHour: 0.50,
			},
			expectError: true,
			errorMsg:    "memory must be between 1 and 128 GB",
		},
		{
			name: "Invalid price - negative",
			skuConfig: models.SKUConfiguration{
				Name:         "basic-plan",
				DisplayName:  "Basic Plan",
				CPUCores:     1,
				MemoryGB:     2,
				PricePerHour: -0.10,
			},
			expectError: true,
			errorMsg:    "price per hour must be non-negative",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.skuConfig.Validate()
			if tt.expectError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestBackupSnapshotValidation tests BackupSnapshot model validation rules
func TestBackupSnapshotValidation(t *testing.T) {
	tests := []struct {
		name           string
		backupSnapshot models.BackupSnapshot
		expectError    bool
		errorMsg       string
	}{
		{
			name: "Valid backup snapshot",
			backupSnapshot: models.BackupSnapshot{
				Name:        "daily-backup",
				ServerID:    "server-123",
				StoragePath: "/backups/server-123/daily-backup.tar.gz",
				Status:      models.BackupStatusCompleted,
				Compression: "gzip",
				TenantID:    "tenant-123",
				SizeBytes:   1024 * 1024 * 100, // 100MB
			},
			expectError: false,
		},
		{
			name: "Empty backup name",
			backupSnapshot: models.BackupSnapshot{
				Name:        "",
				ServerID:    "server-123",
				StoragePath: "/backups/server-123/backup.tar.gz",
				Status:      models.BackupStatusCompleted,
				TenantID:    "tenant-123",
			},
			expectError: true,
			errorMsg:    "backup name is required",
		},
		{
			name: "Empty server ID",
			backupSnapshot: models.BackupSnapshot{
				Name:        "daily-backup",
				ServerID:    "",
				StoragePath: "/backups/backup.tar.gz",
				Status:      models.BackupStatusCompleted,
				TenantID:    "tenant-123",
			},
			expectError: true,
			errorMsg:    "server_id is required",
		},
		{
			name: "Invalid backup status",
			backupSnapshot: models.BackupSnapshot{
				Name:        "daily-backup",
				ServerID:    "server-123",
				StoragePath: "/backups/backup.tar.gz",
				Status:      "invalid-status",
				TenantID:    "tenant-123",
			},
			expectError: true,
			errorMsg:    "invalid backup status",
		},
		{
			name: "Invalid compression format",
			backupSnapshot: models.BackupSnapshot{
				Name:        "daily-backup",
				ServerID:    "server-123",
				StoragePath: "/backups/backup.tar.gz",
				Status:      models.BackupStatusCompleted,
				Compression: "invalid-compression",
				TenantID:    "tenant-123",
			},
			expectError: true,
			errorMsg:    "invalid compression format",
		},
		{
			name: "Backup name too long",
			backupSnapshot: models.BackupSnapshot{
				Name:        "this-backup-name-is-way-too-long-and-exceeds-the-maximum-allowed-length-for-backup-names",
				ServerID:    "server-123",
				StoragePath: "/backups/backup.tar.gz",
				Status:      models.BackupStatusCompleted,
				TenantID:    "tenant-123",
			},
			expectError: true,
			errorMsg:    "backup name must not exceed 100 characters",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.backupSnapshot.Validate()
			if tt.expectError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestMetricsDataValidation tests MetricsData model validation rules
func TestMetricsDataValidation(t *testing.T) {
	tests := []struct {
		name        string
		metricsData models.MetricsData
		expectError bool
		errorMsg    string
	}{
		{
			name: "Valid metrics data",
			metricsData: models.MetricsData{
				ServerID:   "server-123",
				MetricType: models.MetricTypePerformance,
				MetricName: "cpu_usage",
				Value:      45.5,
				Unit:       models.MetricUnitPercent,
				TenantID:   "tenant-123",
				Timestamp:  time.Now(),
			},
			expectError: false,
		},
		{
			name: "Empty server ID",
			metricsData: models.MetricsData{
				ServerID:   "",
				MetricType: models.MetricTypePerformance,
				MetricName: "cpu_usage",
				Value:      45.5,
				Unit:       models.MetricUnitPercent,
				TenantID:   "tenant-123",
				Timestamp:  time.Now(),
			},
			expectError: true,
			errorMsg:    "server_id is required",
		},
		{
			name: "Invalid metric type",
			metricsData: models.MetricsData{
				ServerID:   "server-123",
				MetricType: "invalid-type",
				MetricName: "cpu_usage",
				Value:      45.5,
				Unit:       models.MetricUnitPercent,
				TenantID:   "tenant-123",
				Timestamp:  time.Now(),
			},
			expectError: true,
			errorMsg:    "invalid metric type",
		},
		{
			name: "Empty metric name",
			metricsData: models.MetricsData{
				ServerID:   "server-123",
				MetricType: models.MetricTypePerformance,
				MetricName: "",
				Value:      45.5,
				Unit:       models.MetricUnitPercent,
				TenantID:   "tenant-123",
				Timestamp:  time.Now(),
			},
			expectError: true,
			errorMsg:    "metric_name is required",
		},
		{
			name: "Invalid metric unit",
			metricsData: models.MetricsData{
				ServerID:   "server-123",
				MetricType: models.MetricTypePerformance,
				MetricName: "cpu_usage",
				Value:      45.5,
				Unit:       "invalid-unit",
				TenantID:   "tenant-123",
				Timestamp:  time.Now(),
			},
			expectError: true,
			errorMsg:    "invalid metric unit",
		},
		{
			name: "Negative value for percentage metric",
			metricsData: models.MetricsData{
				ServerID:   "server-123",
				MetricType: models.MetricTypePerformance,
				MetricName: "cpu_usage",
				Value:      -10.0,
				Unit:       models.MetricUnitPercent,
				TenantID:   "tenant-123",
				Timestamp:  time.Now(),
			},
			expectError: true,
			errorMsg:    "percentage values must be between 0 and 100",
		},
		{
			name: "Value too high for percentage metric",
			metricsData: models.MetricsData{
				ServerID:   "server-123",
				MetricType: models.MetricTypePerformance,
				MetricName: "cpu_usage",
				Value:      150.0,
				Unit:       models.MetricUnitPercent,
				TenantID:   "tenant-123",
				Timestamp:  time.Now(),
			},
			expectError: true,
			errorMsg:    "percentage values must be between 0 and 100",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.metricsData.Validate()
			if tt.expectError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestPluginPackageValidation tests PluginPackage model validation rules
func TestPluginPackageValidation(t *testing.T) {
	tests := []struct {
		name          string
		pluginPackage models.PluginPackage
		expectError   bool
		errorMsg      string
	}{
		{
			name: "Valid plugin package",
			pluginPackage: models.PluginPackage{
				Name:        "WorldEdit",
				Version:     "7.2.15",
				Author:      "sk89q",
				Category:    "world",
				Description: "In-game world editor",
				Approved:    true,
				DownloadURL: "https://example.com/worldedit.jar",
			},
			expectError: false,
		},
		{
			name: "Empty plugin name",
			pluginPackage: models.PluginPackage{
				Name:        "",
				Version:     "1.0.0",
				Author:      "author",
				Category:    "utility",
				Description: "Test plugin",
				DownloadURL: "https://example.com/plugin.jar",
			},
			expectError: true,
			errorMsg:    "plugin name is required",
		},
		{
			name: "Invalid version format",
			pluginPackage: models.PluginPackage{
				Name:        "TestPlugin",
				Version:     "invalid-version",
				Author:      "author",
				Category:    "utility",
				Description: "Test plugin",
				DownloadURL: "https://example.com/plugin.jar",
			},
			expectError: true,
			errorMsg:    "invalid version format",
		},
		{
			name: "Invalid download URL",
			pluginPackage: models.PluginPackage{
				Name:        "TestPlugin",
				Version:     "1.0.0",
				Author:      "author",
				Category:    "utility",
				Description: "Test plugin",
				DownloadURL: "invalid-url",
			},
			expectError: true,
			errorMsg:    "invalid download URL",
		},
		{
			name: "Empty author",
			pluginPackage: models.PluginPackage{
				Name:        "TestPlugin",
				Version:     "1.0.0",
				Author:      "",
				Category:    "utility",
				Description: "Test plugin",
				DownloadURL: "https://example.com/plugin.jar",
			},
			expectError: true,
			errorMsg:    "plugin author is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.pluginPackage.Validate()
			if tt.expectError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestResourceLimitsValidation tests resource limit validation
func TestResourceLimitsValidation(t *testing.T) {
	tests := []struct {
		name           string
		resourceLimits models.ResourceLimits
		expectError    bool
		errorMsg       string
	}{
		{
			name: "Valid resource limits",
			resourceLimits: models.ResourceLimits{
				CPU:    "1000m",
				Memory: "2Gi",
			},
			expectError: false,
		},
		{
			name: "Invalid CPU format",
			resourceLimits: models.ResourceLimits{
				CPU:    "invalid-cpu",
				Memory: "2Gi",
			},
			expectError: true,
			errorMsg:    "invalid CPU resource format",
		},
		{
			name: "Invalid memory format",
			resourceLimits: models.ResourceLimits{
				CPU:    "1000m",
				Memory: "invalid-memory",
			},
			expectError: true,
			errorMsg:    "invalid memory resource format",
		},
		{
			name: "CPU too high",
			resourceLimits: models.ResourceLimits{
				CPU:    "100000m", // 100 cores
				Memory: "2Gi",
			},
			expectError: true,
			errorMsg:    "CPU limit exceeds maximum allowed",
		},
		{
			name: "Memory too high",
			resourceLimits: models.ResourceLimits{
				CPU:    "1000m",
				Memory: "1000Gi", // 1TB
			},
			expectError: true,
			errorMsg:    "memory limit exceeds maximum allowed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.resourceLimits.Validate()
			if tt.expectError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestInputSanitization tests input sanitization functions
func TestInputSanitization(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Clean input",
			input:    "normal-server-name",
			expected: "normal-server-name",
		},
		{
			name:     "SQL injection attempt",
			input:    "server'; DROP TABLE servers; --",
			expected: "server DROP TABLE servers ",
		},
		{
			name:     "XSS attempt",
			input:    "<script>alert('xss')</script>",
			expected: "scriptalert('xss')script",
		},
		{
			name:     "Special characters",
			input:    "server@#$%^&*()",
			expected: "server",
		},
		{
			name:     "Unicode characters",
			input:    "server-测试",
			expected: "server-测试",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := models.SanitizeInput(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestBusinessLogicValidation tests complex business logic validation
func TestBusinessLogicValidation(t *testing.T) {
	t.Run("Server capacity validation", func(t *testing.T) {
		// Test that server capacity doesn't exceed SKU limits
		sku := models.SKUConfiguration{
			Name:       "basic-plan",
			CPUCores:   2,
			MemoryGB:   4,
			MaxPlayers: 20,
		}

		server := models.ServerInstance{
			Name:       "test-server",
			MaxPlayers: 25, // Exceeds SKU limit
			SKUID:      sku.ID,
		}

		err := models.ValidateServerAgainstSKU(&server, &sku)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "max players exceeds SKU limit")
	})

	t.Run("Backup retention validation", func(t *testing.T) {
		// Test backup retention policy validation
		backup := models.BackupSnapshot{
			Name:      "old-backup",
			CreatedAt: time.Now().AddDate(0, 0, -365), // 1 year old
		}

		expired := models.IsBackupExpired(&backup, 30) // 30 day retention
		assert.True(t, expired)

		recent := models.BackupSnapshot{
			Name:      "recent-backup",
			CreatedAt: time.Now().AddDate(0, 0, -10), // 10 days old
		}

		notExpired := models.IsBackupExpired(&recent, 30)
		assert.False(t, notExpired)
	})

	t.Run("Plugin compatibility validation", func(t *testing.T) {
		plugin := models.PluginPackage{
			Name:                "TestPlugin",
			CompatibleVersions: []string{"1.19.4", "1.20.1"},
		}

		// Test compatible version
		compatible := models.IsPluginCompatible(&plugin, "1.20.1")
		assert.True(t, compatible)

		// Test incompatible version
		incompatible := models.IsPluginCompatible(&plugin, "1.18.2")
		assert.False(t, incompatible)
	})
}

// BenchmarkValidation benchmarks validation performance
func BenchmarkValidation(b *testing.B) {
	user := models.UserAccount{
		Username: "testuser",
		Email:    "test@example.com",
		TenantID: "tenant-123",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = user.Validate()
	}
}

// TestEdgeCases tests edge cases and boundary conditions
func TestEdgeCases(t *testing.T) {
	t.Run("Empty string validation", func(t *testing.T) {
		user := models.UserAccount{
			Username: "   ", // Whitespace only
			Email:    "test@example.com",
			TenantID: "tenant-123",
		}

		err := user.Validate()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "username cannot be empty or whitespace")
	})

	t.Run("Boundary value testing", func(t *testing.T) {
		// Test exact boundary values
		server := models.ServerInstance{
			Name:       "test",
			Port:       1024, // Minimum valid port
			MaxPlayers: 1,    // Minimum valid players
		}

		err := server.Validate()
		assert.NoError(t, err)

		server.Port = 65535 // Maximum valid port
		server.MaxPlayers = 1000 // Maximum valid players

		err = server.Validate()
		assert.NoError(t, err)
	})

	t.Run("Concurrent validation", func(t *testing.T) {
		// Test validation under concurrent access
		user := models.UserAccount{
			Username: "testuser",
			Email:    "test@example.com",
			TenantID: "tenant-123",
		}

		const numGoroutines = 100
		errors := make(chan error, numGoroutines)

		for i := 0; i < numGoroutines; i++ {
			go func() {
				errors <- user.Validate()
			}()
		}

		for i := 0; i < numGoroutines; i++ {
			err := <-errors
			assert.NoError(t, err)
		}
	})
}