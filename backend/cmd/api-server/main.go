package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
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

	// WebSocket endpoint for real-time updates
	r.GET("/ws", func(c *gin.Context) {
		// Basic WebSocket upgrade
		conn, err := websocketUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Failed to upgrade connection to WebSocket",
			})
			return
		}
		defer conn.Close()

		// Send welcome message
		conn.WriteJSON(gin.H{
			"type": "welcome",
			"message": "Connected to Minecraft Platform WebSocket",
			"timestamp": time.Now(),
		})

		// Keep connection alive with periodic pings
		for {
			time.Sleep(30 * time.Second)
			if err := conn.WriteJSON(gin.H{
				"type": "ping",
				"timestamp": time.Now(),
			}); err != nil {
				break
			}
		}
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