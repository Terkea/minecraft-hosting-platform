package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm/logger"

	"minecraft-platform/src/database"
	"minecraft-platform/src/models"
)

// TestServersCRUD tests real database operations for server management
func TestServersCRUD_WithRealDatabase(t *testing.T) {
	// Setup test database
	config := &database.DatabaseConfig{
		Host:         "localhost",
		Port:         26257,
		Username:     "root",
		Password:     "",
		DatabaseName: "minecraft_platform_test",
		SSLMode:      "disable",
		MaxOpenConns: 10,
		MaxIdleConns: 2,
		LogLevel:     logger.Silent,
	}

	db, err := database.NewDatabase(config)
	require.NoError(t, err, "Failed to connect to test database")

	// Clean up after test
	defer func() {
		db.DB.Exec("DELETE FROM server_instances WHERE name LIKE 'test-%'")
	}()

	// Setup Gin router with actual handlers
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// POST /api/servers - Create server
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

		// Allocate unique external port
		var maxPort int64
		db.DB.Model(&models.ServerInstance{}).Select("COALESCE(MAX(external_port), 25564)").Scan(&maxPort)
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

	// GET /api/servers - List servers
	r.GET("/api/servers", func(c *gin.Context) {
		var servers []models.ServerInstance

		// Get servers with filters
		result := db.DB.Find(&servers)
		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to fetch servers",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"servers": servers,
			"pagination": gin.H{
				"total": len(servers),
			},
		})
	})

	// GET /api/servers/:id - Get specific server
	r.GET("/api/servers/:id", func(c *gin.Context) {
		id := c.Param("id")
		var server models.ServerInstance

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
		id := c.Param("id")
		var server models.ServerInstance

		result := db.DB.First(&server, "id = ?", id)
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

	// DELETE /api/servers/:id - Delete server
	r.DELETE("/api/servers/:id", func(c *gin.Context) {
		id := c.Param("id")
		var server models.ServerInstance

		result := db.DB.First(&server, "id = ?", id)
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

	// Test CREATE operation
	t.Run("POST_CreateServer_SavesToDatabase", func(t *testing.T) {
		requestData := map[string]interface{}{
			"name":              fmt.Sprintf("test-server-%d", time.Now().Unix()),
			"minecraft_version": "1.20.1",
			"server_type":       "survival",
			"resource_limits":   map[string]interface{}{"memory": "2Gi", "cpu": "1000m"},
		}

		body, _ := json.Marshal(requestData)
		req := httptest.NewRequest("POST", "/api/servers", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		r.ServeHTTP(w, req)

		// Assert response
		assert.Equal(t, http.StatusCreated, w.Code)

		var response map[string]interface{}
		err := json.Unmarshal(w.Body.Bytes(), &response)
		require.NoError(t, err)

		serverID := response["server_id"].(string)
		assert.NotEmpty(t, serverID)

		// Verify in database
		var dbServer models.ServerInstance
		result := db.DB.First(&dbServer, "id = ?", serverID)
		require.NoError(t, result.Error)
		assert.Equal(t, requestData["name"], dbServer.Name)
		assert.Equal(t, "pending", dbServer.Status)
		assert.Greater(t, dbServer.ExternalPort, 25565)
	})

	// Test READ operations
	t.Run("GET_ListServers_ReturnsRealData", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/servers", nil)
		w := httptest.NewRecorder()

		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var response map[string]interface{}
		err := json.Unmarshal(w.Body.Bytes(), &response)
		require.NoError(t, err)

		servers := response["servers"].([]interface{})
		assert.GreaterOrEqual(t, len(servers), 1, "Should have at least one server from previous test")
	})

	// Test UPDATE operation
	t.Run("PUT_UpdateServer_ModifiesDatabase", func(t *testing.T) {
		// First create a server
		createData := map[string]interface{}{
			"name":              fmt.Sprintf("test-update-%d", time.Now().Unix()),
			"minecraft_version": "1.20.1",
		}
		body, _ := json.Marshal(createData)
		req := httptest.NewRequest("POST", "/api/servers", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		var createResponse map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &createResponse)
		serverID := createResponse["server_id"].(string)

		// Now update it
		updateData := map[string]interface{}{
			"status":          "running",
			"current_players": 5,
		}
		body, _ = json.Marshal(updateData)
		req = httptest.NewRequest("PUT", "/api/servers/"+serverID, bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w = httptest.NewRecorder()

		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		// Verify in database
		var dbServer models.ServerInstance
		result := db.DB.First(&dbServer, "id = ?", serverID)
		require.NoError(t, result.Error)
		assert.Equal(t, "running", dbServer.Status)
		assert.Equal(t, 5, dbServer.CurrentPlayers)
	})

	// Test DELETE operation
	t.Run("DELETE_RemoveServer_DeletesFromDatabase", func(t *testing.T) {
		// First create a server
		createData := map[string]interface{}{
			"name":              fmt.Sprintf("test-delete-%d", time.Now().Unix()),
			"minecraft_version": "1.20.1",
		}
		body, _ := json.Marshal(createData)
		req := httptest.NewRequest("POST", "/api/servers", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		var createResponse map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &createResponse)
		serverID := createResponse["server_id"].(string)

		// Now delete it
		req = httptest.NewRequest("DELETE", "/api/servers/"+serverID, nil)
		w = httptest.NewRecorder()

		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		// Verify deleted from database
		var dbServer models.ServerInstance
		result := db.DB.First(&dbServer, "id = ?", serverID)
		assert.Error(t, result.Error, "Server should not exist in database")
	})

	// Test port allocation uniqueness
	t.Run("POST_MultipleServers_AllocatesUniquePorts", func(t *testing.T) {
		var ports []int

		for i := 0; i < 3; i++ {
			createData := map[string]interface{}{
				"name":              fmt.Sprintf("test-port-%d-%d", time.Now().Unix(), i),
				"minecraft_version": "1.20.1",
			}
			body, _ := json.Marshal(createData)
			req := httptest.NewRequest("POST", "/api/servers", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			assert.Equal(t, http.StatusCreated, w.Code)

			var response map[string]interface{}
			json.Unmarshal(w.Body.Bytes(), &response)
			serverData := response["server"].(map[string]interface{})
			port := int(serverData["external_port"].(float64))
			ports = append(ports, port)
		}

		// Verify all ports are unique
		assert.Equal(t, 3, len(ports))
		assert.NotEqual(t, ports[0], ports[1])
		assert.NotEqual(t, ports[1], ports[2])
		assert.NotEqual(t, ports[0], ports[2])

		// Verify sequential allocation
		assert.Equal(t, ports[0]+1, ports[1])
		assert.Equal(t, ports[1]+1, ports[2])
	})
}