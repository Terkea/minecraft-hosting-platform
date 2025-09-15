package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	// Create Gin router for development testing
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
		c.JSON(http.StatusOK, gin.H{
			"status": "healthy",
			"service": "minecraft-platform-api",
			"version": "development",
			"database": "connection-pending",
			"timestamp": "2025-09-15T21:32:00Z",
		})
	})

	// API endpoints with mock responses
	r.GET("/api/servers", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"servers": []gin.H{},
			"pagination": gin.H{
				"page": 1,
				"per_page": 10,
				"total": 0,
			},
		})
	})

	r.POST("/api/servers", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "Server deployment initiated (mock)",
			"server_id": "dev-server-001",
			"status": "deploying",
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
	log.Println("🔧 Development Mode - Mock responses enabled")

	log.Fatal(r.Run(":8080"))
}