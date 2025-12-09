package main

import (
	"context"
	"database/sql"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"minecraft-platform/src/api"
	"minecraft-platform/src/events"
	"minecraft-platform/src/kubernetes"
	"minecraft-platform/src/services"
	"minecraft-platform/src/sync"
)

func main() {
	// Create Gin router
	r := gin.Default()

	// Get configuration from environment
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://root@cockroachdb:26257/minecraft_platform?sslmode=disable"
	}
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://nats:4222"
	}

	// Connect to database
	var db *sql.DB
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("Warning: Could not connect to database: %v", err)
		db = nil
	} else {
		if err = db.Ping(); err != nil {
			log.Printf("Warning: Database ping failed: %v", err)
			db = nil
		} else {
			log.Println("Connected to CockroachDB")
			defer db.Close()
		}
	}

	// Initialize event bus
	var eventBus *events.EventBus
	eventBus, err = events.NewEventBus(&events.EventBusConfig{
		NATSUrl:    natsURL,
		ClientID:   "minecraft-api",
		StreamName: "MINECRAFT_EVENTS",
		RetryCount: 3,
	})
	if err != nil {
		log.Printf("Warning: Could not connect to NATS: %v", err)
		eventBus = nil
	} else {
		log.Println("Connected to NATS event bus")
		defer eventBus.Close()
	}

	// Initialize Kubernetes client
	kubeconfig := os.Getenv("KUBECONFIG")
	if kubeconfig == "" {
		// Try default locations
		if home := os.Getenv("HOME"); home != "" {
			kubeconfig = home + "/.kube/config"
		} else if userprofile := os.Getenv("USERPROFILE"); userprofile != "" {
			kubeconfig = userprofile + "/.kube/config"
		}
	}

	k8sNamespace := os.Getenv("K8S_NAMESPACE")
	if k8sNamespace == "" {
		k8sNamespace = "minecraft-servers"
	}

	var k8sClient *kubernetes.Client
	k8sClient, err = kubernetes.NewClient(&kubernetes.ClientConfig{
		KubeconfigPath:   kubeconfig,
		DefaultNamespace: k8sNamespace,
	})
	if err != nil {
		log.Printf("Warning: Could not connect to Kubernetes: %v", err)
		k8sClient = nil
	} else {
		log.Printf("Connected to Kubernetes cluster (namespace: %s)", k8sNamespace)
	}

	// Initialize services (with mock implementations for development)
	serverLifecycle := services.NewServerLifecycleService(nil, nil) // TODO: Inject real dependencies
	backupService := services.NewBackupService(serverLifecycle, "/var/backups")
	configManager := services.NewConfigManagerService(serverLifecycle, nil, nil) // TODO: Inject K8s client and validator
	metricsCollector := services.NewMetricsCollectorService(nil, nil)            // TODO: Inject storage and NATS

	// Initialize WebSocket manager
	wsManager := api.NewWebSocketManager(metricsCollector)
	wsManager.RegisterRoutes(r)

	// Initialize sync service if dependencies are available
	var syncService *sync.SyncService
	if db != nil && eventBus != nil {
		syncService = sync.NewSyncService(db, eventBus, wsManager, nil)
		if err := syncService.Start(); err != nil {
			log.Printf("Warning: Could not start sync service: %v", err)
			syncService = nil
		} else {
			log.Println("Sync service started - DB and K8s state will be synchronized")
		}
	}

	// Initialize API handlers
	serversHandler := api.NewServersHandler(serverLifecycle, backupService, configManager, metricsCollector)
	pluginsHandler := api.NewPluginsHandler(services.NewPluginManagerService(nil, nil)) // TODO: Inject real dependencies

	// Register all routes
	serversHandler.RegisterRoutes(r)
	pluginsHandler.RegisterRoutes(r)

	// Register MVP routes if K8s client is available
	if k8sClient != nil {
		mvpHandler := api.NewMVPServersHandler(k8sClient, k8sNamespace)
		mvpHandler.RegisterMVPRoutes(r)
		log.Println("MVP API routes registered at /api/v1/servers")
	} else {
		log.Println("Warning: MVP API routes not available - Kubernetes client not connected")
	}

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		k8sHealthy := false
		if k8sClient != nil {
			if err := k8sClient.HealthCheck(c.Request.Context()); err == nil {
				k8sHealthy = true
			}
		}
		health := gin.H{
			"status":     "healthy",
			"db":         db != nil,
			"nats":       eventBus != nil && eventBus.IsConnected(),
			"sync":       syncService != nil,
			"kubernetes": k8sHealthy,
		}
		c.JSON(200, health)
	})

	// Sync status endpoint
	r.GET("/api/sync/status", func(c *gin.Context) {
		if syncService == nil {
			c.JSON(503, gin.H{"error": "sync service not available"})
			return
		}
		c.JSON(200, syncService.HealthCheck())
	})

	// WebSocket stats endpoint
	r.GET("/api/websocket/stats", func(c *gin.Context) {
		c.JSON(200, wsManager.GetConnectionStats())
	})

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Start metrics streaming in background
	go wsManager.StartMetricsStreaming(ctx)

	log.Println("Starting Minecraft Platform API server on :8080")
	log.Println("Health check: http://localhost:8080/health")
	log.Println("Server API: http://localhost:8080/api/servers")
	log.Println("WebSocket: ws://localhost:8080/ws")
	log.Println("Sync Status: http://localhost:8080/api/sync/status")
	log.Println("Event-driven architecture enabled - real-time sync active")

	// Start server
	go func() {
		if err := r.Run(":8080"); err != nil {
			log.Printf("Server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	<-ctx.Done()
	log.Println("Shutting down...")

	if syncService != nil {
		syncService.Stop()
	}
	log.Println("Shutdown complete")
}