package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"minecraft-platform/src/api"
	"minecraft-platform/src/services"
)

func main() {
	// Create Gin router
	r := gin.Default()

	// Initialize services (with mock implementations for development)
	serverLifecycle := services.NewServerLifecycleService(nil, nil) // TODO: Inject real dependencies
	backupService := services.NewBackupService(serverLifecycle, "/var/backups")
	configManager := services.NewConfigManagerService(serverLifecycle, nil, nil) // TODO: Inject K8s client and validator
	metricsCollector := services.NewMetricsCollectorService(nil, nil) // TODO: Inject storage and NATS

	// Initialize API handlers
	serversHandler := api.NewServersHandler(serverLifecycle, backupService, configManager, metricsCollector)
	pluginsHandler := api.NewPluginsHandler(services.NewPluginManagerService(nil, nil)) // TODO: Inject real dependencies

	// Register all routes
	serversHandler.RegisterRoutes(r)
	pluginsHandler.RegisterRoutes(r)

	log.Println("Starting Minecraft Platform API server on :8080")
	log.Println("Health check: http://localhost:8080/health")
	log.Println("Server API: http://localhost:8080/api/servers")
	log.Println("Phase 3.3 Core Implementation - All endpoints integrated with services")
	log.Fatal(r.Run(":8080"))
}