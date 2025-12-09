package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"minecraft-platform/src/kubernetes"
)

// MVPServersHandler handles server operations directly against Kubernetes
// This bypasses the service layer for MVP simplicity
type MVPServersHandler struct {
	k8sClient *kubernetes.Client
	namespace string
}

// NewMVPServersHandler creates a new MVP servers handler
func NewMVPServersHandler(k8sClient *kubernetes.Client, namespace string) *MVPServersHandler {
	if namespace == "" {
		namespace = "minecraft-servers"
	}
	return &MVPServersHandler{
		k8sClient: k8sClient,
		namespace: namespace,
	}
}

// RegisterMVPRoutes registers MVP API routes
func (h *MVPServersHandler) RegisterMVPRoutes(r *gin.Engine) {
	// CORS middleware for frontend
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	api := r.Group("/api/v1")
	{
		api.POST("/servers", h.CreateServer)
		api.GET("/servers", h.ListServers)
		api.GET("/servers/:name", h.GetServer)
		api.DELETE("/servers/:name", h.DeleteServer)
		api.POST("/servers/:name/start", h.StartServer)
		api.POST("/servers/:name/stop", h.StopServer)
	}
}

// CreateServerRequest represents a request to create a Minecraft server
type CreateServerRequest struct {
	Name       string `json:"name" binding:"required"`
	Version    string `json:"version"`
	MaxPlayers int    `json:"maxPlayers"`
	Gamemode   string `json:"gamemode"`
	Difficulty string `json:"difficulty"`
	MOTD       string `json:"motd"`
	Memory     string `json:"memory"`
}

// ServerResponse represents a server in API responses
type ServerResponse struct {
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	Message     string    `json:"message,omitempty"`
	Version     string    `json:"version"`
	ExternalIP  string    `json:"externalIP,omitempty"`
	Port        int32     `json:"port,omitempty"`
	PlayerCount int       `json:"playerCount"`
	MaxPlayers  int       `json:"maxPlayers"`
	CreatedAt   time.Time `json:"createdAt"`
}

// CreateServer handles POST /api/v1/servers
func (h *MVPServersHandler) CreateServer(c *gin.Context) {
	var req CreateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": err.Error(),
		})
		return
	}

	// Set defaults
	if req.Version == "" {
		req.Version = "LATEST"
	}
	if req.MaxPlayers == 0 {
		req.MaxPlayers = 20
	}
	if req.Gamemode == "" {
		req.Gamemode = "survival"
	}
	if req.Difficulty == "" {
		req.Difficulty = "normal"
	}
	if req.MOTD == "" {
		req.MOTD = "A Minecraft Server"
	}
	if req.Memory == "" {
		req.Memory = "2G"
	}

	// Sanitize server name for Kubernetes (lowercase, alphanumeric with hyphens)
	name := sanitizeK8sName(req.Name)

	// Generate unique server ID
	serverID := uuid.New().String()[:8]

	// Build the MinecraftServer spec
	spec := &kubernetes.MinecraftServerSpec{
		Name:      name,
		Namespace: h.namespace,
		ServerID:  serverID,
		TenantID:  "default-tenant",
		Image:     "itzg/minecraft-server:latest",
		Version:   req.Version,
		Resources: kubernetes.ResourceSpec{
			CPURequest:    "500m",
			CPULimit:      "2000m",
			MemoryRequest: "1Gi",
			MemoryLimit:   req.Memory + "i", // Convert 2G to 2Gi
			Memory:        req.Memory,
			Storage:       "10Gi",
		},
		Config: kubernetes.ServerConfig{
			MaxPlayers:         req.MaxPlayers,
			Gamemode:           req.Gamemode,
			Difficulty:         req.Difficulty,
			LevelName:          "world",
			MOTD:               req.MOTD,
			WhiteList:          false,
			OnlineMode:         false, // Allows cracked clients for testing
			PVP:                true,
			EnableCommandBlock: true,
		},
	}

	// Create the MinecraftServer in Kubernetes
	ctx := c.Request.Context()
	if err := h.k8sClient.CreateMinecraftServer(ctx, spec); err != nil {
		// Check if it already exists
		if strings.Contains(err.Error(), "already exists") {
			c.JSON(http.StatusConflict, gin.H{
				"error":   "server_exists",
				"message": fmt.Sprintf("Server '%s' already exists", name),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "creation_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Server creation initiated",
		"server": ServerResponse{
			Name:       name,
			Status:     "Pending",
			Message:    "Server is being created",
			Version:    req.Version,
			MaxPlayers: req.MaxPlayers,
			CreatedAt:  time.Now(),
		},
	})
}

// ListServers handles GET /api/v1/servers
func (h *MVPServersHandler) ListServers(c *gin.Context) {
	ctx := c.Request.Context()

	servers, err := h.k8sClient.ListMinecraftServers(ctx, h.namespace)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "list_failed",
			"message": err.Error(),
		})
		return
	}

	// Convert to response format
	response := make([]ServerResponse, 0, len(servers))
	for _, s := range servers {
		response = append(response, ServerResponse{
			Name:        s.Name,
			Status:      s.Phase,
			Message:     s.Message,
			Version:     s.Version,
			ExternalIP:  s.ExternalIP,
			Port:        s.Port,
			PlayerCount: s.PlayerCount,
			MaxPlayers:  s.MaxPlayers,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"servers": response,
		"total":   len(response),
	})
}

// GetServer handles GET /api/v1/servers/:name
func (h *MVPServersHandler) GetServer(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server name is required",
		})
		return
	}

	ctx := c.Request.Context()
	status, err := h.k8sClient.GetMinecraftServer(ctx, h.namespace, name)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "not_found",
				"message": fmt.Sprintf("Server '%s' not found", name),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "get_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, ServerResponse{
		Name:        name,
		Status:      status.Phase,
		Message:     status.Message,
		Version:     status.Version,
		ExternalIP:  status.ExternalIP,
		Port:        status.Port,
		PlayerCount: status.PlayerCount,
		MaxPlayers:  status.MaxPlayers,
	})
}

// DeleteServer handles DELETE /api/v1/servers/:name
func (h *MVPServersHandler) DeleteServer(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server name is required",
		})
		return
	}

	ctx := c.Request.Context()
	force := c.Query("force") == "true"

	opts := &kubernetes.DeleteOptions{
		Force: force,
	}

	if err := h.k8sClient.DeleteMinecraftServer(ctx, h.namespace, name, opts); err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "not_found",
				"message": fmt.Sprintf("Server '%s' not found", name),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "delete_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Server '%s' deletion initiated", name),
	})
}

// StartServer handles POST /api/v1/servers/:name/start
func (h *MVPServersHandler) StartServer(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server name is required",
		})
		return
	}

	// For MVP, starting means the server already exists and K8s will keep it running
	// This is a placeholder for more sophisticated start/stop logic
	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Server '%s' start requested", name),
	})
}

// StopServer handles POST /api/v1/servers/:name/stop
func (h *MVPServersHandler) StopServer(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server name is required",
		})
		return
	}

	// For MVP, we'll scale the pod to 0
	// This is a placeholder - real implementation would update the CR
	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Server '%s' stop requested", name),
	})
}

// WatchServers provides a SSE endpoint for real-time server updates
func (h *MVPServersHandler) WatchServers(c *gin.Context) {
	ctx := c.Request.Context()

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")

	// Create a ticker for polling
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	// Send initial data
	h.sendServerList(c)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.sendServerList(c)
		}
	}
}

func (h *MVPServersHandler) sendServerList(c *gin.Context) {
	servers, err := h.k8sClient.ListMinecraftServers(context.Background(), h.namespace)
	if err != nil {
		return
	}

	response := make([]ServerResponse, 0, len(servers))
	for _, s := range servers {
		response = append(response, ServerResponse{
			Status:      s.Phase,
			Message:     s.Message,
			Version:     s.Version,
			ExternalIP:  s.ExternalIP,
			Port:        s.Port,
			PlayerCount: s.PlayerCount,
			MaxPlayers:  s.MaxPlayers,
		})
	}

	c.SSEvent("servers", response)
	c.Writer.Flush()
}

// sanitizeK8sName converts a name to be Kubernetes-compatible
func sanitizeK8sName(name string) string {
	// Convert to lowercase
	result := strings.ToLower(name)

	// Replace spaces and underscores with hyphens
	result = strings.ReplaceAll(result, " ", "-")
	result = strings.ReplaceAll(result, "_", "-")

	// Remove any characters that aren't alphanumeric or hyphens
	var cleaned strings.Builder
	for _, r := range result {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			cleaned.WriteRune(r)
		}
	}
	result = cleaned.String()

	// Ensure it doesn't start or end with a hyphen
	result = strings.Trim(result, "-")

	// Limit length to 63 characters (K8s limit)
	if len(result) > 63 {
		result = result[:63]
	}

	// If empty after sanitization, generate a default name
	if result == "" {
		result = "minecraft-server"
	}

	return result
}
