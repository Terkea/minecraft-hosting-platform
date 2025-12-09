package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"minecraft-platform/src/services"
)

// PluginsHandler handles plugin-related API endpoints (T032)
type PluginsHandler struct {
	pluginManager *services.PluginManagerService
}

// NewPluginsHandler creates a new plugins handler
func NewPluginsHandler(pluginManager *services.PluginManagerService) *PluginsHandler {
	return &PluginsHandler{
		pluginManager: pluginManager,
	}
}

// RegisterRoutes registers all plugin-related routes
func (h *PluginsHandler) RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api")

	// Plugin marketplace endpoints
	api.GET("/plugins", h.BrowsePlugins)
	api.GET("/plugins/:id", h.GetPlugin)

	// Server plugin management endpoints
	api.GET("/servers/:server_id/plugins", h.ListServerPlugins)
	api.POST("/servers/:server_id/plugins/:plugin_id", h.InstallPlugin)
	api.DELETE("/servers/:server_id/plugins/:plugin_id", h.RemovePlugin)
	api.PATCH("/servers/:server_id/plugins/:plugin_id", h.ConfigurePlugin)
}

// BrowsePlugins handles GET /plugins - browse plugin marketplace
func (h *PluginsHandler) BrowsePlugins(c *gin.Context) {
	// Parse pagination parameters
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "20"))

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 50 {
		perPage = 20
	}

	// Parse filters
	filters := map[string]interface{}{
		"category":    c.Query("category"),
		"search":      c.Query("search"),
		"version":     c.Query("version"),
		"author":      c.Query("author"),
		"sort_by":     c.DefaultQuery("sort_by", "popularity"),
		"sort_order":  c.DefaultQuery("sort_order", "desc"),
		"approved_only": c.DefaultQuery("approved_only", "true") == "true",
	}

	req := &services.PluginBrowseRequest{
		Page:     page,
		PerPage:  perPage,
		Filters:  filters,
	}

	result, err := h.pluginManager.BrowsePlugins(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "browse_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetPlugin handles GET /plugins/:id - get plugin details
func (h *PluginsHandler) GetPlugin(c *gin.Context) {
	pluginID := c.Param("id")
	if pluginID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "plugin_id is required",
		})
		return
	}

	plugin, err := h.pluginManager.GetPlugin(c.Request.Context(), pluginID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "plugin_not_found",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, plugin)
}

// ListServerPlugins handles GET /servers/:server_id/plugins - list installed plugins
func (h *PluginsHandler) ListServerPlugins(c *gin.Context) {
	serverID := c.Param("server_id")
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
		"status":   c.Query("status"),
		"category": c.Query("category"),
		"enabled":  c.Query("enabled"),
	}

	req := &services.ServerPluginListRequest{
		ServerID: serverID,
		TenantID: tenantID,
		Filters:  filters,
	}

	plugins, err := h.pluginManager.ListServerPlugins(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "list_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"plugins": plugins,
		"total":   len(plugins),
	})
}

// InstallPlugin handles POST /servers/:server_id/plugins/:plugin_id - install plugin
func (h *PluginsHandler) InstallPlugin(c *gin.Context) {
	serverID := c.Param("server_id")
	pluginID := c.Param("plugin_id")

	if serverID == "" || pluginID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id and plugin_id are required",
		})
		return
	}

	var req services.PluginInstallRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": err.Error(),
		})
		return
	}

	// Set IDs and tenant ID
	req.ServerID = serverID
	req.PluginID = pluginID
	req.TenantID = c.GetString("tenant_id")
	if req.TenantID == "" {
		req.TenantID = "default-tenant" // Mock tenant for development
	}

	result, err := h.pluginManager.InstallPlugin(c.Request.Context(), &req)
	if err != nil {
		// Determine appropriate HTTP status based on error type
		status := http.StatusInternalServerError
		errorCode := "install_failed"

		// You could check for specific error types here
		// For now, using generic error handling

		c.JSON(status, gin.H{
			"error":   errorCode,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusAccepted, result)
}

// RemovePlugin handles DELETE /servers/:server_id/plugins/:plugin_id - remove plugin
func (h *PluginsHandler) RemovePlugin(c *gin.Context) {
	serverID := c.Param("server_id")
	pluginID := c.Param("plugin_id")

	if serverID == "" || pluginID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id and plugin_id are required",
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
	cleanupData := c.Query("cleanup_data") != "false" // Default to true

	req := &services.PluginRemoveRequest{
		ServerID:    serverID,
		PluginID:    pluginID,
		TenantID:    tenantID,
		Force:       force,
		CleanupData: cleanupData,
	}

	result, err := h.pluginManager.RemovePlugin(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "remove_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ConfigurePlugin handles PATCH /servers/:server_id/plugins/:plugin_id - configure plugin
func (h *PluginsHandler) ConfigurePlugin(c *gin.Context) {
	serverID := c.Param("server_id")
	pluginID := c.Param("plugin_id")

	if serverID == "" || pluginID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "server_id and plugin_id are required",
		})
		return
	}

	var req services.PluginConfigureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": err.Error(),
		})
		return
	}

	// Set IDs and tenant ID
	req.ServerID = serverID
	req.PluginID = pluginID
	req.TenantID = c.GetString("tenant_id")
	if req.TenantID == "" {
		req.TenantID = "default-tenant" // Mock tenant for development
	}

	result, err := h.pluginManager.ConfigurePlugin(c.Request.Context(), &req)
	if err != nil {
		// Determine appropriate status based on result
		status := http.StatusInternalServerError
		if err.Error() == "validation_failed" {
			status = http.StatusBadRequest
		}

		c.JSON(status, gin.H{
			"error":   "configure_failed",
			"message": err.Error(),
		})
		return
	}

	// Return appropriate status based on result
	status := http.StatusOK
	if result != nil {
		if resultMap, ok := result.(map[string]interface{}); ok {
			if statusStr, exists := resultMap["status"]; exists {
				if statusStr == "validation_failed" {
					status = http.StatusBadRequest
				} else if statusStr == "failed" {
					status = http.StatusInternalServerError
				}
			}
		}
	}

	c.JSON(status, result)
}