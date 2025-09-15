package load

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"minecraft-platform/src/api"
	"minecraft-platform/src/database"
	"minecraft-platform/src/models"
)

const (
	maxResponseTime     = 200 * time.Millisecond
	maxConcurrentUsers  = 100
	testDurationSeconds = 30
	targetTPS           = 1000
)

type PerformanceMetrics struct {
	TotalRequests     int64
	SuccessfulReqs    int64
	FailedReqs        int64
	AvgResponseTime   time.Duration
	MaxResponseTime   time.Duration
	MinResponseTime   time.Duration
	RequestsPerSecond float64
	ErrorRate         float64
}

type LoadTestResult struct {
	Endpoint    string
	Metrics     PerformanceMetrics
	Percentiles map[string]time.Duration
	Passed      bool
}

func TestAPIPerformance(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupTestRouter(t)

	endpoints := []struct {
		name     string
		method   string
		path     string
		payload  interface{}
		expected int
	}{
		{"ListServers", "GET", "/api/v1/servers", nil, http.StatusOK},
		{"GetServer", "GET", "/api/v1/servers/test-server-1", nil, http.StatusOK},
		{"CreateServer", "POST", "/api/v1/servers", createTestServerPayload(), http.StatusCreated},
		{"UpdateServer", "PUT", "/api/v1/servers/test-server-1", updateTestServerPayload(), http.StatusOK},
		{"ListPlugins", "GET", "/api/v1/plugins", nil, http.StatusOK},
		{"InstallPlugin", "POST", "/api/v1/servers/test-server-1/plugins", installPluginPayload(), http.StatusOK},
		{"CreateBackup", "POST", "/api/v1/servers/test-server-1/backups", createBackupPayload(), http.StatusCreated},
		{"ListBackups", "GET", "/api/v1/servers/test-server-1/backups", nil, http.StatusOK},
		{"GetMetrics", "GET", "/api/v1/servers/test-server-1/metrics", nil, http.StatusOK},
		{"HealthCheck", "GET", "/health", nil, http.StatusOK},
	}

	results := make([]LoadTestResult, len(endpoints))

	for i, endpoint := range endpoints {
		t.Run(fmt.Sprintf("LoadTest_%s", endpoint.name), func(t *testing.T) {
			result := runLoadTest(t, router, endpoint.method, endpoint.path, endpoint.payload, endpoint.expected)
			results[i] = LoadTestResult{
				Endpoint:    endpoint.name,
				Metrics:     result,
				Percentiles: calculatePercentiles(result),
				Passed:      evaluatePerformance(result),
			}

			// Assert performance requirements
			if !results[i].Passed {
				t.Errorf("Performance test failed for %s: avg response time %.2fms (max allowed: %.2fms), error rate: %.2f%%",
					endpoint.name,
					float64(result.AvgResponseTime.Nanoseconds())/1000000,
					float64(maxResponseTime.Nanoseconds())/1000000,
					result.ErrorRate)
			}

			// Log performance metrics
			t.Logf("%s Performance: %.2f RPS, %.2fms avg, %.2f%% error rate",
				endpoint.name, result.RequestsPerSecond,
				float64(result.AvgResponseTime.Nanoseconds())/1000000,
				result.ErrorRate)
		})
	}

	// Generate performance report
	generatePerformanceReport(t, results)
}

func TestConcurrentUserLoad(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupTestRouter(t)

	concurrencyLevels := []int{10, 25, 50, 100}

	for _, concurrent := range concurrencyLevels {
		t.Run(fmt.Sprintf("ConcurrentUsers_%d", concurrent), func(t *testing.T) {
			result := runConcurrentUserTest(t, router, concurrent)

			if result.ErrorRate > 5.0 { // Allow 5% error rate under load
				t.Errorf("High error rate under %d concurrent users: %.2f%%", concurrent, result.ErrorRate)
			}

			if result.AvgResponseTime > maxResponseTime*2 { // Allow 2x response time under load
				t.Errorf("High response time under %d concurrent users: %.2fms",
					concurrent, float64(result.AvgResponseTime.Nanoseconds())/1000000)
			}

			t.Logf("Concurrent users %d: %.2f RPS, %.2fms avg response, %.2f%% errors",
				concurrent, result.RequestsPerSecond,
				float64(result.AvgResponseTime.Nanoseconds())/1000000,
				result.ErrorRate)
		})
	}
}

func TestMemoryLeakDetection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupTestRouter(t)

	// Measure initial memory
	var initialMemStats, finalMemStats runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&initialMemStats)

	// Simulate sustained load
	const iterations = 1000
	for i := 0; i < iterations; i++ {
		req := httptest.NewRequest("GET", "/api/v1/servers", nil)
		req.Header.Set("X-Tenant-ID", "test-tenant")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
	}

	// Force garbage collection and measure final memory
	runtime.GC()
	time.Sleep(100 * time.Millisecond) // Allow GC to complete
	runtime.ReadMemStats(&finalMemStats)

	memoryGrowth := finalMemStats.Alloc - initialMemStats.Alloc
	maxAllowedGrowth := uint64(50 * 1024 * 1024) // 50MB

	if memoryGrowth > maxAllowedGrowth {
		t.Errorf("Potential memory leak detected: memory grew by %d bytes (max allowed: %d)",
			memoryGrowth, maxAllowedGrowth)
	}

	t.Logf("Memory growth after %d requests: %d bytes", iterations, memoryGrowth)
}

func TestDatabaseConnectionPooling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupTestRouter(t)

	const concurrentConnections = 50
	const requestsPerConnection = 20

	var wg sync.WaitGroup
	errors := make(chan error, concurrentConnections)

	start := time.Now()

	for i := 0; i < concurrentConnections; i++ {
		wg.Add(1)
		go func(connID int) {
			defer wg.Done()

			for j := 0; j < requestsPerConnection; j++ {
				req := httptest.NewRequest("GET", "/api/v1/servers", nil)
				req.Header.Set("X-Tenant-ID", fmt.Sprintf("tenant-%d", connID))
				w := httptest.NewRecorder()

				router.ServeHTTP(w, req)

				if w.Code != http.StatusOK {
					errors <- fmt.Errorf("connection %d request %d failed: status %d", connID, j, w.Code)
					return
				}
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	duration := time.Since(start)
	totalRequests := concurrentConnections * requestsPerConnection
	rps := float64(totalRequests) / duration.Seconds()

	// Check for errors
	errorCount := 0
	for err := range errors {
		t.Error(err)
		errorCount++
	}

	if errorCount > 0 {
		t.Errorf("Database connection pooling test failed with %d errors", errorCount)
	}

	t.Logf("Database connection pooling: %d requests in %.2fs (%.2f RPS)",
		totalRequests, duration.Seconds(), rps)
}

func runLoadTest(t *testing.T, router *gin.Engine, method, path string, payload interface{}, expectedStatus int) PerformanceMetrics {
	var responseTimes []time.Duration
	var mutex sync.Mutex
	var wg sync.WaitGroup

	metrics := PerformanceMetrics{
		MinResponseTime: time.Hour, // Start with a large value
	}

	duration := time.Duration(testDurationSeconds) * time.Second
	start := time.Now()

	// Worker goroutines
	workers := 10
	requestChan := make(chan struct{}, 1000)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			for range requestChan {
				reqStart := time.Now()

				var req *http.Request
				if payload != nil {
					body, _ := json.Marshal(payload)
					req = httptest.NewRequest(method, path, bytes.NewBuffer(body))
					req.Header.Set("Content-Type", "application/json")
				} else {
					req = httptest.NewRequest(method, path, nil)
				}
				req.Header.Set("X-Tenant-ID", "test-tenant")

				w := httptest.NewRecorder()
				router.ServeHTTP(w, req)

				responseTime := time.Since(reqStart)

				mutex.Lock()
				metrics.TotalRequests++
				if w.Code == expectedStatus {
					metrics.SuccessfulReqs++
				} else {
					metrics.FailedReqs++
				}

				responseTimes = append(responseTimes, responseTime)
				if responseTime > metrics.MaxResponseTime {
					metrics.MaxResponseTime = responseTime
				}
				if responseTime < metrics.MinResponseTime {
					metrics.MinResponseTime = responseTime
				}
				mutex.Unlock()
			}
		}()
	}

	// Send requests for the test duration
	go func() {
		for time.Since(start) < duration {
			select {
			case requestChan <- struct{}{}:
			default:
				time.Sleep(time.Millisecond)
			}
		}
		close(requestChan)
	}()

	wg.Wait()
	elapsed := time.Since(start)

	// Calculate metrics
	if len(responseTimes) > 0 {
		var total time.Duration
		for _, rt := range responseTimes {
			total += rt
		}
		metrics.AvgResponseTime = total / time.Duration(len(responseTimes))
	}

	metrics.RequestsPerSecond = float64(metrics.TotalRequests) / elapsed.Seconds()
	if metrics.TotalRequests > 0 {
		metrics.ErrorRate = float64(metrics.FailedReqs) / float64(metrics.TotalRequests) * 100
	}

	return metrics
}

func runConcurrentUserTest(t *testing.T, router *gin.Engine, concurrentUsers int) PerformanceMetrics {
	var wg sync.WaitGroup
	var mutex sync.Mutex

	metrics := PerformanceMetrics{
		MinResponseTime: time.Hour,
	}

	start := time.Now()

	for i := 0; i < concurrentUsers; i++ {
		wg.Add(1)
		go func(userID int) {
			defer wg.Done()

			// Each user makes 10 requests
			for j := 0; j < 10; j++ {
				reqStart := time.Now()

				req := httptest.NewRequest("GET", "/api/v1/servers", nil)
				req.Header.Set("X-Tenant-ID", fmt.Sprintf("user-%d", userID))
				w := httptest.NewRecorder()

				router.ServeHTTP(w, req)

				responseTime := time.Since(reqStart)

				mutex.Lock()
				metrics.TotalRequests++
				if w.Code == http.StatusOK {
					metrics.SuccessfulReqs++
				} else {
					metrics.FailedReqs++
				}

				if responseTime > metrics.MaxResponseTime {
					metrics.MaxResponseTime = responseTime
				}
				if responseTime < metrics.MinResponseTime {
					metrics.MinResponseTime = responseTime
				}
				mutex.Unlock()
			}
		}(i)
	}

	wg.Wait()
	elapsed := time.Since(start)

	metrics.RequestsPerSecond = float64(metrics.TotalRequests) / elapsed.Seconds()
	if metrics.TotalRequests > 0 {
		metrics.ErrorRate = float64(metrics.FailedReqs) / float64(metrics.TotalRequests) * 100

		// Calculate average response time (simplified)
		if metrics.SuccessfulReqs > 0 {
			metrics.AvgResponseTime = elapsed / time.Duration(metrics.TotalRequests)
		}
	}

	return metrics
}

func setupTestRouter(t *testing.T) *gin.Engine {
	// Initialize test database
	db, err := database.NewTestDatabase()
	if err != nil {
		t.Fatalf("Failed to setup test database: %v", err)
	}

	// Create test data
	createTestData(t, db)

	// Setup router with handlers
	router := gin.New()
	api.SetupRoutes(router, db)

	return router
}

func createTestData(t *testing.T, db *database.Database) {
	// Create test tenant
	tenant := &models.UserAccount{
		ID:       "test-tenant",
		Username: "test-user",
		Email:    "test@example.com",
		TenantID: "test-tenant",
	}
	if err := db.DB.Create(tenant).Error; err != nil {
		t.Logf("Test tenant creation error (may already exist): %v", err)
	}

	// Create test server
	server := &models.ServerInstance{
		ID:               "test-server-1",
		Name:             "Test Server",
		Status:           "running",
		MinecraftVersion: "1.20.1",
		TenantID:         "test-tenant",
	}
	if err := db.DB.Create(server).Error; err != nil {
		t.Logf("Test server creation error (may already exist): %v", err)
	}
}

func calculatePercentiles(metrics PerformanceMetrics) map[string]time.Duration {
	// Simplified percentile calculation
	return map[string]time.Duration{
		"p50": metrics.AvgResponseTime,
		"p95": metrics.MaxResponseTime * 95 / 100,
		"p99": metrics.MaxResponseTime * 99 / 100,
	}
}

func evaluatePerformance(metrics PerformanceMetrics) bool {
	// Performance criteria
	if metrics.AvgResponseTime > maxResponseTime {
		return false
	}
	if metrics.ErrorRate > 1.0 { // Allow 1% error rate
		return false
	}
	if metrics.RequestsPerSecond < 10 { // Minimum 10 RPS
		return false
	}
	return true
}

func generatePerformanceReport(t *testing.T, results []LoadTestResult) {
	t.Log("=== PERFORMANCE REPORT ===")

	totalPassed := 0
	for _, result := range results {
		status := "FAIL"
		if result.Passed {
			status = "PASS"
			totalPassed++
		}

		t.Logf("%s: %s - %.2f RPS, %.2fms avg, %.2f%% errors",
			result.Endpoint, status, result.Metrics.RequestsPerSecond,
			float64(result.Metrics.AvgResponseTime.Nanoseconds())/1000000,
			result.Metrics.ErrorRate)
	}

	t.Logf("Overall: %d/%d endpoints passed performance tests", totalPassed, len(results))
}

// Test payload helpers
func createTestServerPayload() map[string]interface{} {
	return map[string]interface{}{
		"name":              "Performance Test Server",
		"minecraft_version": "1.20.1",
		"memory_limit":      "2Gi",
		"cpu_limit":         "1000m",
	}
}

func updateTestServerPayload() map[string]interface{} {
	return map[string]interface{}{
		"memory_limit": "4Gi",
		"cpu_limit":    "2000m",
	}
}

func installPluginPayload() map[string]interface{} {
	return map[string]interface{}{
		"plugin_id": "worldedit",
		"version":   "7.2.15",
	}
}

func createBackupPayload() map[string]interface{} {
	return map[string]interface{}{
		"name":        "performance-test-backup",
		"description": "Backup created during performance testing",
		"compression": "gzip",
	}
}