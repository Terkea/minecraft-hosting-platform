package main

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm/logger"

	"minecraft-platform/src/database"
	"minecraft-platform/src/models"
)

func main() {
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

	// Create Gin router
	r := gin.Default()

	// Add CORS middleware for development
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}

		c.Next()
	})

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
			"timestamp": "2025-09-15T21:32:00Z",
		})
	})

	// Real API endpoints with database operations

	// GET /api/servers - List all servers
	r.GET("/api/servers", func(c *gin.Context) {
		var servers []models.ServerInstance

		// Get pagination parameters
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "10"))
		offset := (page - 1) * perPage

		// Count total servers
		var total int64
		db.DB.Model(&models.ServerInstance{}).Count(&total)

		// Get servers with pagination
		result := db.DB.Offset(offset).Limit(perPage).Find(&servers)
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

	// POST /api/servers - Create a new server
	r.POST("/api/servers", func(c *gin.Context) {
		var server models.ServerInstance

		if err := c.ShouldBindJSON(&server); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body",
				"details": err.Error(),
			})
			return
		}

		// Set default values
		server.Status = "pending"
		server.CurrentPlayers = 0
		server.KubernetesNamespace = "minecraft-" + server.Name

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

	// GET /api/servers/:id - Get server by ID
	r.GET("/api/servers/:id", func(c *gin.Context) {
		var server models.ServerInstance
		id := c.Param("id")

		result := db.DB.First(&server, "id = ?", id)
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

	// PUT /api/servers/:id - Update server
	r.PUT("/api/servers/:id", func(c *gin.Context) {
		var server models.ServerInstance
		id := c.Param("id")

		// Find existing server
		result := db.DB.First(&server, "id = ?", id)
		if result.Error != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Server not found",
			})
			return
		}

		// Update with new data
		if err := c.ShouldBindJSON(&server); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body",
				"details": err.Error(),
			})
			return
		}

		// Save changes
		result = db.DB.Save(&server)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to update server",
				"details": result.Error.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "Server updated successfully",
			"server":  server,
		})
	})

	// DELETE /api/servers/:id - Delete server
	r.DELETE("/api/servers/:id", func(c *gin.Context) {
		id := c.Param("id")

		result := db.DB.Delete(&models.ServerInstance{}, "id = ?", id)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to delete server",
				"details": result.Error.Error(),
			})
			return
		}

		if result.RowsAffected == 0 {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Server not found",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "Server deleted successfully",
		})
	})

	r.GET("/metrics", func(c *gin.Context) {
		c.String(http.StatusOK, `# HELP minecraft_platform_up Whether the service is up
# TYPE minecraft_platform_up gauge
minecraft_platform_up 1
# HELP minecraft_platform_requests_total Total number of requests
# TYPE minecraft_platform_requests_total counter
minecraft_platform_requests_total 42
`)
	})

	log.Println("🚀 Starting Minecraft Platform API server on :8080")
	log.Println("📊 Health check: http://localhost:8080/health")
	log.Println("🎮 Server API: http://localhost:8080/api/servers")
	log.Println("📈 Metrics: http://localhost:8080/metrics")
	log.Println("✅ Development Mode - Real database operations enabled")

	log.Fatal(r.Run(":8080"))
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}