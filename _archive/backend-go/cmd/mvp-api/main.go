package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"
	"minecraft-platform/src/api"
	"minecraft-platform/src/kubernetes"
)

func main() {
	// Create Gin router
	r := gin.Default()

	// Get Kubernetes configuration
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

	// Initialize Kubernetes client
	k8sClient, err := kubernetes.NewClient(&kubernetes.ClientConfig{
		KubeconfigPath:   kubeconfig,
		DefaultNamespace: k8sNamespace,
	})
	if err != nil {
		log.Fatalf("Failed to connect to Kubernetes: %v", err)
	}
	log.Printf("Connected to Kubernetes cluster (namespace: %s)", k8sNamespace)

	// Initialize MVP handler
	mvpHandler := api.NewMVPServersHandler(k8sClient, k8sNamespace)
	mvpHandler.RegisterMVPRoutes(r)

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		k8sHealthy := false
		if err := k8sClient.HealthCheck(c.Request.Context()); err == nil {
			k8sHealthy = true
		}
		c.JSON(200, gin.H{
			"status":     "healthy",
			"kubernetes": k8sHealthy,
			"namespace":  k8sNamespace,
		})
	})

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting MVP Minecraft Platform API server on :%s", port)
	log.Printf("Health check: http://localhost:%s/health", port)
	log.Printf("Server API: http://localhost:%s/api/v1/servers", port)

	// Start server
	go func() {
		if err := r.Run(":" + port); err != nil {
			log.Printf("Server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	<-ctx.Done()
	log.Println("Shutting down...")
	log.Println("Shutdown complete")
}
