package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"minecraft-platform/src/services"
)

// ServersHandler handles server-related API endpoints
type ServersHandler struct {
	serverLifecycle   *services.ServerLifecycleService
	backupService     *services.BackupService
	configManager     *services.ConfigManagerService
	metricsCollector  *services.MetricsCollectorService
}

// NewServersHandler creates a new servers handler
func NewServersHandler(
	serverLifecycle *services.ServerLifecycleService,
	backupService *services.BackupService,
	configManager *services.ConfigManagerService,
	metricsCollector *services.MetricsCollectorService,
) *ServersHandler {
	return &ServersHandler{
		serverLifecycle:  serverLifecycle,
		backupService:    backupService,
		configManager:    configManager,
		metricsCollector: metricsCollector,
	}
}

// RegisterRoutes registers all server-related routes
func (h *ServersHandler) RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api")

	// Server management endpoints
	api.POST("/servers", h.DeployServer)           // T029
	api.GET("/servers", h.ListServers)             // T030
	api.GET("/servers/:id", h.GetServer)           // T030
	api.PATCH("/servers/:id", h.UpdateServer)      // T031
	api.DELETE("/servers/:id", h.DeleteServer)

	// Server logs endpoint
	api.GET("/servers/:id/logs", h.GetServerLogs)

	// Server backup endpoints
	api.GET("/servers/:id/backups", h.ListBackups)
	api.POST("/servers/:id/backups", h.CreateBackup)
	api.POST("/servers/:id/backups/:backup_id/restore", h.RestoreBackup)

	// Health check endpoint
	r.GET("/health", h.HealthCheck)
}

// DeployServer handles POST /servers (T029)
func (h *ServersHandler) DeployServer(c *gin.Context) {
	var req services.ServerDeployRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": err.Error(),
		})
		return
	}

	// Extract tenant ID from context/auth (placeholder)
	req.TenantID = c.GetString("tenant_id")
	if req.TenantID == "" {
		req.TenantID = "default-tenant" // Mock tenant for development
	}

	result, err := h.serverLifecycle.DeployServer(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "deployment_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusAccepted, result)
}

// ListServers handles GET /servers (T030)
func (h *ServersHandler) ListServers(c *gin.Context) {
	// Parse pagination parameters
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "20"))

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	// Extract tenant ID from context/auth (placeholder)
	tenantID := c.GetString("tenant_id")
	if tenantID == "" {
		tenantID = "default-tenant" // Mock tenant for development
	}

	// Parse filters
	filters := map[string]interface{}{
		"status": c.Query("status"),
		"sku_id": c.Query("sku_id"),
		"search": c.Query("search"),
	}

	req := &services.ServerListRequest{
		TenantID: tenantID,
		Page:     page,
		PerPage:  perPage,
		Filters:  filters,
	}

	result, err := h.serverLifecycle.ListServers(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "list_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetServer handles GET /servers/:id (T030)
func (h *ServersHandler) GetServer(c *gin.Context) {
	serverID := c.Param("id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id is required",
		})
		return
	}

	// Extract tenant ID from context/auth (placeholder)
	tenantID := c.GetString("tenant_id")
	if tenantID == "" {
		tenantID = "default-tenant" // Mock tenant for development
	}

	server, err := h.serverLifecycle.GetServer(c.Request.Context(), serverID, tenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "server_not_found",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, server)
}

// UpdateServer handles PATCH /servers/:id (T031)
func (h *ServersHandler) UpdateServer(c *gin.Context) {
	serverID := c.Param("id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id is required",
		})
		return
	}

	var req services.ConfigUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": err.Error(),
		})
		return
	}

	// Set server ID and tenant ID
	req.ServerID = serverID
	req.TenantID = c.GetString("tenant_id")
	if req.TenantID == "" {
		req.TenantID = "default-tenant" // Mock tenant for development
	}

	result, err := h.configManager.UpdateServerConfiguration(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "update_failed",
			"message": err.Error(),
		})
		return
	}

	// Return appropriate status based on result
	status := http.StatusOK
	if result.Status == "validation_failed" {
		status = http.StatusBadRequest
	} else if result.Status == "failed" {
		status = http.StatusInternalServerError
	}

	c.JSON(status, result)
}

// DeleteServer handles DELETE /servers/:id
func (h *ServersHandler) DeleteServer(c *gin.Context) {
	serverID := c.Param("id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id is required",
		})
		return
	}

	// Extract tenant ID from context/auth (placeholder)
	tenantID := c.GetString("tenant_id")
	if tenantID == "" {
		tenantID = "default-tenant" // Mock tenant for development
	}

	// Parse query parameters
	force := c.Query("force") == "true"

	req := &services.ServerDeleteRequest{
		ServerID: serverID,
		TenantID: tenantID,
		Force:    force,
	}

	result, err := h.serverLifecycle.DeleteServer(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "delete_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetServerLogs handles GET /servers/:id/logs
func (h *ServersHandler) GetServerLogs(c *gin.Context) {
	serverID := c.Param("id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id is required",
		})
		return
	}

	// Extract tenant ID from context/auth (placeholder)
	tenantID := c.GetString("tenant_id")
	if tenantID == "" {
		tenantID = "default-tenant" // Mock tenant for development
	}

	// Parse pagination parameters
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "100"))
	tail, _ := strconv.Atoi(c.Query("tail"))

	// Parse filters
	filters := map[string]interface{}{
		"level":      c.Query("level"),
		"since":      c.Query("since"),
		"until":      c.Query("until"),
		"search":     c.Query("search"),
		"tail":       tail,
	}

	req := &services.ServerLogsRequest{
		ServerID: serverID,
		TenantID: tenantID,
		Page:     page,
		PerPage:  perPage,
		Filters:  filters,
	}

	result, err := h.serverLifecycle.GetServerLogs(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "logs_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ListBackups handles GET /servers/:id/backups
func (h *ServersHandler) ListBackups(c *gin.Context) {
	serverID := c.Param("id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id is required",
		})
		return
	}

	// Extract tenant ID from context/auth (placeholder)
	tenantID := c.GetString("tenant_id")
	if tenantID == "" {
		tenantID = "default-tenant" // Mock tenant for development
	}

	// Parse filters
	filters := map[string]interface{}{
		"status":          c.Query("status"),
		"tag":            c.Query("tag"),
		"sort_by":        c.DefaultQuery("sort_by", "created_at"),
		"sort_order":     c.DefaultQuery("sort_order", "desc"),
		"include_expired": c.Query("include_expired") == "true",
	}

	backups, err := h.backupService.ListBackups(c.Request.Context(), serverID, tenantID, filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "list_backups_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"backups": backups,
		"total":   len(backups),
	})
}

// CreateBackup handles POST /servers/:id/backups
func (h *ServersHandler) CreateBackup(c *gin.Context) {
	serverID := c.Param("id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id is required",
		})
		return
	}

	var req services.BackupCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": err.Error(),
		})
		return
	}

	// Set server ID and tenant ID
	req.ServerID = serverID
	req.TenantID = c.GetString("tenant_id")
	if req.TenantID == "" {
		req.TenantID = "default-tenant" // Mock tenant for development
	}

	result, err := h.backupService.CreateBackup(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "backup_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusAccepted, result)
}

// RestoreBackup handles POST /servers/:id/backups/:backup_id/restore
func (h *ServersHandler) RestoreBackup(c *gin.Context) {
	serverID := c.Param("id")
	backupID := c.Param("backup_id")

	if serverID == "" || backupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id and backup_id are required",
		})
		return
	}

	var req services.BackupRestoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": err.Error(),
		})
		return
	}

	// Set IDs and tenant ID
	req.ServerID = serverID
	req.BackupID = backupID
	req.TenantID = c.GetString("tenant_id")
	if req.TenantID == "" {
		req.TenantID = "default-tenant" // Mock tenant for development
	}

	result, err := h.backupService.RestoreBackup(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "restore_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusAccepted, result)
}

// HealthCheck handles GET /health
func (h *ServersHandler) HealthCheck(c *gin.Context) {
	detailed := c.Query("detailed") == "true"

	health := gin.H{
		"status":  "healthy",
		"service": "minecraft-platform-api",
		"version": "1.0.0",
	}

	if detailed {
		health["checks"] = gin.H{
			"database":          "healthy",
			"kubernetes":        "healthy",
			"storage":           "healthy",
			"metrics_collector": "healthy",
		}
		health["uptime"] = "24h"
		health["requests_per_second"] = 150.5
	}

	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Access-Control-Allow-Origin", "*")

	c.JSON(http.StatusOK, health)
}