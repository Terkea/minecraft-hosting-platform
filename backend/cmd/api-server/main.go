package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"gorm.io/gorm/logger"

	"minecraft-platform/src/database"
	"minecraft-platform/src/models"
)

var websocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
	},
}

type WSConnection struct {
	conn     *websocket.Conn
	tenantID string
}

var wsConnections = make(map[string]*WSConnection)
var wsConnMutex sync.RWMutex

func main() {
	// Determine mode from environment
	mode := getEnv("APP_MODE", "development")

	// Create Gin router
	r := gin.Default()

	if mode == "development" {
		log.Println("🔧 Starting in DEVELOPMENT mode with real database")
		setupDevelopmentMode(r)
	} else {
		log.Println("🚀 Starting in PRODUCTION mode")
		// TODO: Implement production mode with proper service layer
		setupDevelopmentMode(r) // For now, use development mode
	}

	port := getEnv("PORT", "8080")
	log.Printf("🚀 Starting Minecraft Platform API server on :%s", port)
	log.Printf("📊 Health check: http://localhost:%s/health", port)
	log.Printf("🎮 Server API: http://localhost:%s/api/servers", port)
	log.Printf("📈 Metrics: http://localhost:%s/metrics", port)

	log.Fatal(r.Run(":" + port))
}

func setupDevelopmentMode(r *gin.Engine) {
	// Initialize database connection
	port, err := strconv.Atoi(getEnv("DB_PORT", "26257"))
	if err != nil {
		log.Fatalf("Invalid DB_PORT: %v", err)
	}

	config := &database.DatabaseConfig{
		Host:         getEnv("DB_HOST", "localhost"),
		Port:         port,
		Username:     getEnv("DB_USER", "root"),
		Password:     getEnv("DB_PASSWORD", ""),
		DatabaseName: getEnv("DB_NAME", "minecraft_platform"),
		SSLMode:      getEnv("DB_SSL_MODE", "disable"),
		MaxOpenConns: 25,
		MaxIdleConns: 5,
		LogLevel:     logger.Info,
	}

	log.Printf("Connecting to database: %s@%s:%d/%s", config.Username, config.Host, config.Port, config.DatabaseName)

	db, err := database.NewDatabase(config)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("✅ Database connection established")

	// Run database migrations
	if err := db.AutoMigrate(); err != nil {
		log.Fatalf("Failed to run database migrations: %v", err)
	}
	log.Println("✅ Database migrations completed")

	log.Println("✅ WebSocket support initialized")

	// Add CORS middleware for development
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-ID")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	})

	// Add tenant isolation middleware
	r.Use(func(c *gin.Context) {
		// Skip tenant check for health and metrics endpoints
		if c.Request.URL.Path == "/health" || c.Request.URL.Path == "/metrics" {
			c.Next()
			return
		}

		// Extract tenant ID from headers
		tenantID := c.GetHeader("X-Tenant-ID")
		if tenantID == "" {
			// Try Authorization header as Bearer token
			if auth := c.GetHeader("Authorization"); auth != "" {
				if len(auth) > 7 && auth[:7] == "Bearer " {
					tenantID = auth[7:]
				}
			}
		}
		if tenantID == "" {
			// Try query parameter as fallback
			tenantID = c.Query("tenant_id")
		}

		if tenantID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Missing tenant identification",
				"details": "Provide tenant ID via X-Tenant-ID header, Authorization Bearer token, or tenant_id query parameter",
			})
			c.Abort()
			return
		}

		// Store tenant ID in context for use in handlers
		c.Set("tenant_id", tenantID)
		c.Next()
	})

	setupDevelopmentRoutes(r, db)
}

func setupDevelopmentRoutes(r *gin.Engine, db *database.Database) {
	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		// Test database connection
		sqlDB, err := db.DB.DB()
		dbStatus := "healthy"
		if err != nil || sqlDB.Ping() != nil {
			dbStatus = "unhealthy"
		}

		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"service":   "minecraft-platform-api",
			"version":   "development",
			"database":  dbStatus,
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// GET /api/servers - List servers for tenant
	r.GET("/api/servers", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		tenantUUID, err := uuid.Parse(tenantID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid tenant ID format",
			})
			return
		}

		var servers []models.ServerInstance

		// Get pagination parameters
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "10"))
		offset := (page - 1) * perPage

		// Count total servers for this tenant
		var total int64
		db.DB.Model(&models.ServerInstance{}).Where("tenant_id = ?", tenantUUID).Count(&total)

		// Get servers for this tenant with pagination
		result := db.DB.Where("tenant_id = ?", tenantUUID).Offset(offset).Limit(perPage).Find(&servers)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to fetch servers",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"servers": servers,
			"pagination": gin.H{
				"page":     page,
				"per_page": perPage,
				"total":    total,
			},
		})
	})

	// POST /api/servers - Create a new server for tenant
	r.POST("/api/servers", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		var server models.ServerInstance

		if err := c.ShouldBindJSON(&server); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body",
				"details": err.Error(),
			})
			return
		}

		// Parse and set tenant ID
		tenantUUID, err := uuid.Parse(tenantID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid tenant ID format",
				"details": err.Error(),
			})
			return
		}
		server.TenantID = tenantUUID
		server.Status = "pending"
		server.CurrentPlayers = 0
		server.KubernetesNamespace = "minecraft-" + server.Name

		// Set default resource limits if not provided
		if server.ResourceLimits.CPUCores == 0 {
			server.ResourceLimits = models.ResourceLimits{
				CPUCores:  1.0,
				MemoryGB:  1,
				StorageGB: 10,
			}
		}

		// Allocate unique external port (starting from 25565 for Minecraft)
		var maxPort int64
		db.DB.Model(&models.ServerInstance{}).Select("COALESCE(MAX(external_port), 25564)").Scan(&maxPort)
		if maxPort < 25565 {
			maxPort = 25564 // Ensure next port is at least 25565
		}
		server.ExternalPort = int(maxPort + 1)

		// Create server in database
		result := db.DB.Create(&server)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to create server",
				"details": result.Error.Error(),
			})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"message":   "Server created successfully",
			"server_id": server.ID,
			"server":    server,
		})
	})

	// GET /api/servers/:id - Get server by ID for tenant
	r.GET("/api/servers/:id", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		tenantUUID, err := uuid.Parse(tenantID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid tenant ID format",
			})
			return
		}

		var server models.ServerInstance
		id := c.Param("id")

		result := db.DB.Where("id = ? AND tenant_id = ?", id, tenantUUID).First(&server)
		if result.Error != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Server not found",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"server": server,
		})
	})

	// PUT /api/servers/:id - Update server for tenant
	r.PUT("/api/servers/:id", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		tenantUUID, err := uuid.Parse(tenantID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid tenant ID format",
			})
			return
		}

		var server models.ServerInstance
		id := c.Param("id")

		result := db.DB.Where("id = ? AND tenant_id = ?", id, tenantUUID).First(&server)
		if result.Error != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Server not found",
			})
			return
		}

		var updates map[string]interface{}
		if err := c.ShouldBindJSON(&updates); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body",
			})
			return
		}

		// Prevent tenant_id from being updated
		delete(updates, "tenant_id")

		// Update fields
		result = db.DB.Model(&server).Updates(updates)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to update server",
			})
			return
		}

		// Send WebSocket notification for status changes
		if statusUpdate, exists := updates["status"]; exists {
			wsConnMutex.RLock()
			for _, wsConn := range wsConnections {
				if wsConn.tenantID == server.TenantID.String() {
					wsConn.conn.WriteJSON(map[string]interface{}{
						"type":        "server_status_update",
						"server_id":   server.ID.String(),
						"server_name": server.Name,
						"status":      statusUpdate.(string),
						"message":     "Server status updated",
						"timestamp":   time.Now(),
					})
				}
			}
			wsConnMutex.RUnlock()
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "Server updated successfully",
			"server":  server,
		})
	})

	// DELETE /api/servers/:id - Delete server for tenant
	r.DELETE("/api/servers/:id", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		tenantUUID, err := uuid.Parse(tenantID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid tenant ID format",
			})
			return
		}

		var server models.ServerInstance
		id := c.Param("id")

		result := db.DB.Where("id = ? AND tenant_id = ?", id, tenantUUID).First(&server)
		if result.Error != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Server not found",
			})
			return
		}

		result = db.DB.Delete(&server)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to delete server",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "Server deleted successfully",
		})
	})

	// GET /api/servers/:id/backups - List server backups
	r.GET("/api/servers/:id/backups", func(c *gin.Context) {
		serverID := c.Param("id")

		// Query backup_snapshots table
		type BackupSnapshot struct {
			ID               string    `json:"id" db:"id"`
			ServerID         string    `json:"server_id" db:"server_id"`
			Filename         string    `json:"filename" db:"filename"`
			StoragePath      string    `json:"storage_path" db:"storage_path"`
			SizeBytes        int64     `json:"size_bytes" db:"size_bytes"`
			BackupType       string    `json:"backup_type" db:"backup_type"`
			CompressionType  string    `json:"compression_type" db:"compression_type"`
			CreatedAt        time.Time `json:"created_at" db:"created_at"`
		}

		var backups []BackupSnapshot
		result := db.DB.Where("server_id = ?", serverID).Find(&backups)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to fetch backups",
				"details": result.Error.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"backups": backups,
			"total":   len(backups),
		})
	})

	// POST /api/servers/:id/backups - Create server backup
	r.POST("/api/servers/:id/backups", func(c *gin.Context) {
		serverID := c.Param("id")

		var request struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Compression string `json:"compression"`
		}

		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body",
				"details": err.Error(),
			})
			return
		}

		// Create backup record
		backup := struct {
			ServerID        string    `json:"server_id" db:"server_id"`
			Filename        string    `json:"filename" db:"filename"`
			StoragePath     string    `json:"storage_path" db:"storage_path"`
			SizeBytes       int64     `json:"size_bytes" db:"size_bytes"`
			BackupType      string    `json:"backup_type" db:"backup_type"`
			CompressionType string    `json:"compression_type" db:"compression_type"`
			CreatedAt       time.Time `json:"created_at" db:"created_at"`
			UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
		}{
			ServerID:        serverID,
			Filename:        request.Name + ".tar.gz",
			StoragePath:     "/backups/" + serverID + "/",
			SizeBytes:       0, // Would be set after actual backup
			BackupType:      "manual",
			CompressionType: request.Compression,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}

		result := db.DB.Table("backup_snapshots").Create(&backup)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to create backup",
				"details": result.Error.Error(),
			})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"message": "Backup created successfully",
			"backup":  backup,
		})
	})

	// Simple WebSocket endpoint
	r.GET("/ws", func(c *gin.Context) {
		tenantID := c.GetHeader("X-Tenant-ID")
		if tenantID == "" {
			tenantID = c.Query("tenant_id")
		}

		conn, err := websocketUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Failed to upgrade to WebSocket",
			})
			return
		}

		// Store connection
		connID := uuid.New().String()
		wsConnMutex.Lock()
		wsConnections[connID] = &WSConnection{
			conn:     conn,
			tenantID: tenantID,
		}
		wsConnMutex.Unlock()

		log.Printf("WebSocket connected: %s (tenant: %s)", connID, tenantID)

		// Send welcome message
		conn.WriteJSON(map[string]interface{}{
			"type":      "welcome",
			"message":   "Connected to Minecraft Platform",
			"tenant_id": tenantID,
			"timestamp": time.Now(),
		})

		// Handle connection close
		defer func() {
			wsConnMutex.Lock()
			delete(wsConnections, connID)
			wsConnMutex.Unlock()
			conn.Close()
			log.Printf("WebSocket disconnected: %s", connID)
		}()

		// Keep connection alive
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	})

	// GET /api/servers/:id/logs - Stream server logs
	r.GET("/api/servers/:id/logs", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		serverID := c.Param("id")

		// TODO: Implement real Kubernetes log streaming
		// For now, return sample logs
		c.JSON(http.StatusOK, gin.H{
			"server_id": serverID,
			"tenant_id": tenantID,
			"logs": []gin.H{
				{
					"timestamp": time.Now().Add(-time.Minute * 5).Format(time.RFC3339),
					"level": "INFO",
					"message": "Starting minecraft server version 1.20.1",
					"source": "minecraft-server",
				},
				{
					"timestamp": time.Now().Add(-time.Minute * 4).Format(time.RFC3339),
					"level": "INFO",
					"message": "Loading properties",
					"source": "minecraft-server",
				},
				{
					"timestamp": time.Now().Add(-time.Minute * 3).Format(time.RFC3339),
					"level": "INFO",
					"message": "Default game type: SURVIVAL",
					"source": "minecraft-server",
				},
				{
					"timestamp": time.Now().Add(-time.Minute * 2).Format(time.RFC3339),
					"level": "INFO",
					"message": "Generating keypair",
					"source": "minecraft-server",
				},
				{
					"timestamp": time.Now().Add(-time.Minute * 1).Format(time.RFC3339),
					"level": "INFO",
					"message": "Done (3.542s)! For help, type \"help\"",
					"source": "minecraft-server",
				},
				{
					"timestamp": time.Now().Format(time.RFC3339),
					"level": "INFO",
					"message": "Server started successfully on port 25565",
					"source": "minecraft-server",
				},
			},
		})
	})

	// GET /api/servers/:id/backups - Get list of backups for server
	r.GET("/api/servers/:id/backups", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		serverID := c.Param("id")

		// TODO: Implement real backup listing from Kubernetes persistent volumes
		// For now, return sample backup data
		c.JSON(http.StatusOK, gin.H{
			"server_id": serverID,
			"tenant_id": tenantID,
			"backups": []gin.H{
				{
					"id": "backup-001",
					"name": "Manual Backup",
					"timestamp": time.Now().Add(-time.Hour * 24).Format(time.RFC3339),
					"size_mb": 145,
					"type": "manual",
					"status": "completed",
					"world_name": "world",
				},
				{
					"id": "backup-002",
					"name": "Scheduled Backup",
					"timestamp": time.Now().Add(-time.Hour * 12).Format(time.RFC3339),
					"size_mb": 162,
					"type": "scheduled",
					"status": "completed",
					"world_name": "world",
				},
				{
					"id": "backup-003",
					"name": "Pre-update Backup",
					"timestamp": time.Now().Add(-time.Hour * 2).Format(time.RFC3339),
					"size_mb": 158,
					"type": "manual",
					"status": "completed",
					"world_name": "world",
				},
			},
		})
	})

	// POST /api/servers/:id/backups - Create a new backup
	r.POST("/api/servers/:id/backups", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		serverID := c.Param("id")

		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body",
				"details": err.Error(),
			})
			return
		}

		// TODO: Implement real backup creation via Kubernetes job
		// For now, return success response
		backupID := "backup-" + fmt.Sprintf("%d", time.Now().Unix())

		c.JSON(http.StatusCreated, gin.H{
			"backup_id": backupID,
			"server_id": serverID,
			"tenant_id": tenantID,
			"name": req.Name,
			"description": req.Description,
			"status": "in_progress",
			"created_at": time.Now().Format(time.RFC3339),
			"estimated_completion": time.Now().Add(time.Minute * 5).Format(time.RFC3339),
		})
	})

	// DELETE /api/servers/:id/backups/:backup_id - Delete a backup
	r.DELETE("/api/servers/:id/backups/:backup_id", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		serverID := c.Param("id")
		backupID := c.Param("backup_id")

		// TODO: Implement real backup deletion
		// For now, return success response
		c.JSON(http.StatusOK, gin.H{
			"message": "Backup deleted successfully",
			"backup_id": backupID,
			"server_id": serverID,
			"tenant_id": tenantID,
		})
	})

	// POST /api/servers/:id/backups/:backup_id/restore - Restore from backup
	r.POST("/api/servers/:id/backups/:backup_id/restore", func(c *gin.Context) {
		tenantID := c.GetString("tenant_id")
		serverID := c.Param("id")
		backupID := c.Param("backup_id")

		// TODO: Implement real backup restoration
		// For now, return success response
		c.JSON(http.StatusAccepted, gin.H{
			"message": "Restore operation started",
			"backup_id": backupID,
			"server_id": serverID,
			"tenant_id": tenantID,
			"status": "in_progress",
			"estimated_completion": time.Now().Add(time.Minute * 10).Format(time.RFC3339),
		})
	})

	// Metrics endpoint
	r.GET("/metrics", func(c *gin.Context) {
		c.String(http.StatusOK, `# HELP minecraft_platform_up Whether the service is up
# TYPE minecraft_platform_up gauge
minecraft_platform_up 1
# HELP minecraft_platform_requests_total Total number of requests
# TYPE minecraft_platform_requests_total counter
minecraft_platform_requests_total 42
`)
	})
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}