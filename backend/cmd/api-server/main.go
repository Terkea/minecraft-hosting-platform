package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	// Create Gin router
	r := gin.Default()

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "minecraft-platform-api",
			"version": "1.0.0",
		})
	})

	// API status endpoint
	r.GET("/api/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message":     "Minecraft Platform API",
			"environment": "development",
			"ready":       true,
		})
	})

	// Placeholder route that shows we're ready for server endpoints
	r.POST("/servers", func(c *gin.Context) {
		// This is a placeholder - T005 contract test expects this to return 404
		// When we implement T029, this will have proper logic
		c.JSON(http.StatusNotImplemented, gin.H{
			"error":   "not_implemented",
			"message": "Server deployment endpoint not yet implemented (TDD Phase 3.2 in progress)",
			"note":    "This endpoint will be implemented in Phase 3.3 after contract tests are complete",
		})
	})

	log.Println("Starting Minecraft Platform API server on :8080")
	log.Println("Health check: http://localhost:8080/health")
	log.Println("API status: http://localhost:8080/api/status")
	log.Fatal(r.Run(":8080"))
}