# Contract Tests Migration Plan

**Date**: 2025-09-16
**Issue**: 103 "Future assertions" across 12 contract test files need activation
**Status**: Health endpoint converted ✅, 11 files remaining

## 🎯 Migration Strategy

### **Current Problem**
All contract tests follow this anti-pattern:
```go
// Current: Only tests 404 (no endpoint)
assert.Equal(t, http.StatusNotFound, w.Code, "Expected 404 since endpoint is not implemented yet")

// Future assertions (when endpoint is implemented):
// assert.Equal(t, http.StatusOK, w.Code)
// [100+ lines of comprehensive validation logic]
```

### **Solution Approach**
1. **Phase 1**: Convert existing working endpoints (health ✅, servers CRUD)
2. **Phase 2**: Implement missing endpoints (start/stop, backups, logs)
3. **Phase 3**: Add authentication and validation middleware

## 📋 Detailed Migration Plan

### **✅ Phase 1: Working Endpoints (4 files)**

| File | Endpoint | Status | Action Required |
|------|----------|--------|-----------------|
| `health_test.go` | `GET /health` | ✅ **DONE** | Fixed - now passes |
| `servers_get_test.go` | `GET /api/servers` | 🟡 Working | Convert to real HTTP calls |
| `servers_get_by_id_test.go` | `GET /api/servers/{id}` | 🟡 Working | Convert to real HTTP calls |
| `servers_post_test.go` | `POST /api/servers` | 🟡 Working | Convert + fix validation |

**servers_put_test.go** - `PUT /api/servers/{id}` - 🟡 Working but needs validation
**servers_delete_test.go** - `DELETE /api/servers/{id}` - 🟡 Working but needs cleanup logic

### **🚧 Phase 2: Missing Endpoints (6 files)**

| File | Endpoint | Status | Implementation Needed |
|------|----------|--------|----------------------|
| `servers_start_test.go` | `POST /servers/{id}/start` | ❌ Missing | Add route + handler |
| `servers_stop_test.go` | `POST /servers/{id}/stop` | ❌ Missing | Add route + handler |
| `servers_logs_test.go` | `GET /servers/{id}/logs` | ❌ Missing | Add route + handler |
| `servers_backups_get_test.go` | `GET /servers/{id}/backups` | ❌ Missing | Add route + handler |
| `servers_backups_post_test.go` | `POST /servers/{id}/backups` | ❌ Missing | Add route + handler |
| `servers_backups_restore_test.go` | `POST /servers/{id}/backups/{backup_id}/restore` | ❌ Missing | Add route + handler |

## 🔧 Technical Implementation Steps

### **Step 1: Fix Contract Test Pattern**

**Before** (current anti-pattern):
```go
router := gin.New()
// No routes registered
w := httptest.NewRecorder()
router.ServeHTTP(w, req)
assert.Equal(t, http.StatusNotFound, w.Code)
```

**After** (real endpoint testing):
```go
client := &http.Client{}
resp, err := client.Get("http://localhost:8080/api/servers")
require.NoError(t, err)
defer resp.Body.Close()
assert.Equal(t, http.StatusOK, resp.StatusCode)
```

### **Step 2: Add Missing Routes**

**File**: `/Users/marian/PERSONAL/minecraft-hosting-platform/backend/src/api/servers.go`

Add missing routes to `RegisterRoutes()`:
```go
func RegisterRoutes(r *gin.Engine, service services.ServerLifecycleService) {
    api := r.Group("/api")

    // Existing routes...
    api.GET("/servers", handlers.GetServers)
    api.POST("/servers", handlers.CreateServer)
    api.GET("/servers/:id", handlers.GetServer)
    api.PUT("/servers/:id", handlers.UpdateServer)
    api.DELETE("/servers/:id", handlers.DeleteServer)

    // NEW ROUTES NEEDED:
    api.POST("/servers/:id/start", handlers.StartServer)
    api.POST("/servers/:id/stop", handlers.StopServer)
    api.GET("/servers/:id/logs", handlers.GetServerLogs)
    api.GET("/servers/:id/backups", handlers.GetBackups)
    api.POST("/servers/:id/backups", handlers.CreateBackup)
    api.POST("/servers/:id/backups/:backup_id/restore", handlers.RestoreBackup)
}
```

### **Step 3: Implement Missing Handlers**

Each handler should delegate to service layer:
```go
func StartServer(c *gin.Context) {
    serverID := c.Param("id")

    var request StartServerRequest
    if err := c.ShouldBindJSON(&request); err != nil {
        c.JSON(400, gin.H{"error": "Invalid request", "details": err.Error()})
        return
    }

    err := serverLifecycleService.StartServer(serverID, request)
    if err != nil {
        c.JSON(500, gin.H{"error": "Failed to start server", "details": err.Error()})
        return
    }

    c.JSON(202, gin.H{"message": "Server start initiated"})
}
```

### **Step 4: Service Layer Integration**

Services already exist but need real implementations:
```go
// /Users/marian/PERSONAL/minecraft-hosting-platform/backend/src/services/server_lifecycle.go
func (s *ServerLifecycleService) StartServer(serverID string, config StartConfig) error {
    // 1. Validate server exists and state
    // 2. Update database status to "starting"
    // 3. Create Kubernetes MinecraftServer resource
    // 4. Return (async operation)
}
```

## 📊 Expected Validation Logic

### **Authentication (Currently Missing)**
All endpoints except health require:
```go
Authorization: Bearer <jwt-token>
```

**Implementation**: Add JWT middleware to validate tenant isolation.

### **Request Validation**
Contract tests specify detailed validation:

**Server Creation**:
- `name`: required, 1-50 chars, alphanumeric + hyphens only
- `sku_id`: required, valid UUID format
- `minecraft_version`: required, valid version format (e.g., "1.20.1")
- `server_properties`: optional, validate against known properties

**Server Start/Stop**:
- `warmup_timeout`: 0-300 seconds
- `graceful_timeout`: 0-300 seconds
- `force`: boolean flag
- `save_world`: boolean flag

### **State Management**
- Prevent operations on servers in invalid states
- Return 409 Conflict for state violations
- Handle concurrent operations

### **Error Response Format**
```go
type ErrorResponse struct {
    Error     string                 `json:"error"`
    Message   string                 `json:"message"`
    Details   map[string]interface{} `json:"details,omitempty"`
    Timestamp string                 `json:"timestamp"`
}
```

## 🚀 Execution Timeline

### **Week 1: Core Endpoints (Phase 1)**
- [x] ✅ Health endpoint (DONE)
- [ ] Convert servers_get_test.go
- [ ] Convert servers_get_by_id_test.go
- [ ] Convert servers_post_test.go
- [ ] Convert servers_put_test.go
- [ ] Convert servers_delete_test.go

### **Week 2: Missing Endpoints (Phase 2)**
- [ ] Implement start/stop endpoints and tests
- [ ] Implement logs endpoint and tests
- [ ] Implement backup endpoints and tests

### **Week 3: Middleware & Validation**
- [ ] Add JWT authentication middleware
- [ ] Add request validation middleware
- [ ] Add proper error handling
- [ ] Add state management validation

## 📈 Success Criteria

**Phase 1 Complete**: 6/12 contract test files passing
**Phase 2 Complete**: 12/12 contract test files passing
**Phase 3 Complete**: All 103 "Future assertions" activated and validated

**Final Goal**:
```bash
go test ./tests/contract/... -v
# All tests pass, no more 404 assertions
# Real API validation with comprehensive coverage
```

## 🔍 Current Status

**✅ Completed**:
- Health endpoint contract test converted and passing
- API analysis complete - identified working vs missing endpoints

**🚧 In Progress**:
- Server CRUD endpoint conversion

**⏳ Pending**:
- Missing endpoint implementation
- Authentication middleware
- Validation middleware

---

**Next Action**: Convert `servers_get_test.go` to test real `GET /api/servers` endpoint.