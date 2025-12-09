package logging

import (
	"bytes"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// LoggingMiddleware provides structured logging for HTTP requests
func LoggingMiddleware(logger Logger) gin.HandlerFunc {
	return gin.LoggerWithConfig(gin.LoggerConfig{
		Formatter: func(param gin.LogFormatterParams) string {
			// Create context with request information
			ctx := param.Request.Context()

			// Extract correlation ID from header or generate new one
			correlationID := param.Request.Header.Get("X-Correlation-ID")
			if correlationID == "" {
				correlationID = NewCorrelationID()
			}
			ctx = WithCorrelationID(ctx, correlationID)

			// Extract tenant ID from header
			tenantID := param.Request.Header.Get("X-Tenant-ID")
			if tenantID != "" {
				ctx = WithTenantID(ctx, tenantID)
			}

			// Extract user ID from header (set by auth middleware)
			userID := param.Request.Header.Get("X-User-ID")
			if userID != "" {
				ctx = WithUserID(ctx, userID)
			}

			// Extract request ID from header or generate new one
			requestID := param.Request.Header.Get("X-Request-ID")
			if requestID == "" {
				requestID = NewRequestID()
			}
			ctx = WithRequestID(ctx, requestID)

			// Set response headers
			param.Writer.Header().Set("X-Correlation-ID", correlationID)
			param.Writer.Header().Set("X-Request-ID", requestID)

			// Log request details
			fields := []Field{
				String("method", param.Method),
				String("path", param.Path),
				String("query", param.Request.URL.RawQuery),
				String("user_agent", param.Request.UserAgent()),
				String("client_ip", param.ClientIP),
				Int("status_code", param.StatusCode),
				Duration("latency", param.Latency),
				Int64("request_size", param.Request.ContentLength),
				Int("response_size", param.BodySize),
			}

			// Add referer if present
			if referer := param.Request.Referer(); referer != "" {
				fields = append(fields, String("referer", referer))
			}

			// Determine log level based on status code
			message := "HTTP Request"
			if param.StatusCode >= 500 {
				logger.Error(ctx, message, fields...)
			} else if param.StatusCode >= 400 {
				logger.Warn(ctx, message, fields...)
			} else {
				logger.Info(ctx, message, fields...)
			}

			// Return empty string as we handle logging ourselves
			return ""
		},
		Output: io.Discard, // Disable default gin logging
	})
}

// AuditMiddleware logs API actions for audit purposes
func AuditMiddleware(auditLogger *AuditLogger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		// Create a custom response writer to capture response body
		blw := &bodyLogWriter{body: bytes.NewBufferString(""), ResponseWriter: c.Writer}
		c.Writer = blw

		// Capture request body for audit (only for non-GET requests)
		var requestBody string
		if c.Request.Method != "GET" && c.Request.Method != "DELETE" && c.Request.ContentLength > 0 && c.Request.ContentLength < 1024*1024 { // Limit to 1MB
			if bodyBytes, err := io.ReadAll(c.Request.Body); err == nil {
				requestBody = string(bodyBytes)
				// Restore the request body for downstream handlers
				c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			}
		}

		// Process request
		c.Next()

		duration := time.Since(start)

		// Extract context information
		ctx := c.Request.Context()
		correlationID := GetCorrelationID(ctx)
		tenantID := GetTenantID(ctx)
		userID := GetUserID(ctx)

		// Determine action and resource from path and method
		action := determineAction(c.Request.Method, c.FullPath())
		resource := determineResource(c.FullPath())
		resourceID := extractResourceID(c)

		// Determine result
		result := "success"
		if c.Writer.Status() >= 400 {
			result = "error"
		}

		// Prepare audit fields
		fields := []Field{
			String("method", c.Request.Method),
			String("path", c.FullPath()),
			String("client_ip", c.ClientIP),
			String("user_agent", c.Request.UserAgent()),
			String("correlation_id", correlationID),
			Int("response_code", c.Writer.Status()),
			Duration("duration", duration),
		}

		// Add tenant and user info if available
		if tenantID != "" {
			fields = append(fields, String("tenant_id", tenantID))
		}
		if userID != "" {
			fields = append(fields, String("user_id", userID))
		}

		// Add request body for audit (sanitized)
		if requestBody != "" && shouldLogRequestBody(c.FullPath()) {
			sanitizedBody := sanitizeRequestBody(requestBody)
			fields = append(fields, String("request_body", sanitizedBody))
		}

		// Add response body for certain endpoints (sanitized)
		if shouldLogResponseBody(c.FullPath()) && blw.body.Len() > 0 && blw.body.Len() < 10240 { // Limit to 10KB
			sanitizedResponse := sanitizeResponseBody(blw.body.String())
			fields = append(fields, String("response_body", sanitizedResponse))
		}

		// Log audit event
		if shouldAudit(c.Request.Method, c.FullPath()) {
			auditLogger.LogAction(ctx, action, resource, resourceID, result, fields...)
		}
	}
}

// bodyLogWriter wraps gin.ResponseWriter to capture response body
type bodyLogWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w bodyLogWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

// determineAction extracts the action from HTTP method and path
func determineAction(method, path string) string {
	switch method {
	case "GET":
		if strings.Contains(path, "/:id") {
			return "read"
		}
		return "list"
	case "POST":
		if strings.Contains(path, "/start") {
			return "start"
		}
		if strings.Contains(path, "/stop") {
			return "stop"
		}
		if strings.Contains(path, "/restart") {
			return "restart"
		}
		if strings.Contains(path, "/backup") {
			return "backup"
		}
		if strings.Contains(path, "/restore") {
			return "restore"
		}
		return "create"
	case "PUT", "PATCH":
		return "update"
	case "DELETE":
		return "delete"
	default:
		return strings.ToLower(method)
	}
}

// determineResource extracts the resource type from the path
func determineResource(path string) string {
	if strings.Contains(path, "/servers") {
		if strings.Contains(path, "/backups") {
			return "backup"
		}
		if strings.Contains(path, "/plugins") {
			return "plugin"
		}
		return "server"
	}
	if strings.Contains(path, "/users") {
		return "user"
	}
	if strings.Contains(path, "/skus") {
		return "sku"
	}
	return "unknown"
}

// extractResourceID extracts the resource ID from URL parameters
func extractResourceID(c *gin.Context) string {
	if id := c.Param("id"); id != "" {
		return id
	}
	if serverID := c.Param("server_id"); serverID != "" {
		return serverID
	}
	if backupID := c.Param("backup_id"); backupID != "" {
		return backupID
	}
	return ""
}

// shouldAudit determines if a request should be audited
func shouldAudit(method, path string) bool {
	// Always audit non-GET requests
	if method != "GET" {
		return true
	}

	// Audit sensitive GET requests
	sensitivePatterns := []string{
		"/users",
		"/admin",
		"/config",
		"/secrets",
	}

	for _, pattern := range sensitivePatterns {
		if strings.Contains(path, pattern) {
			return true
		}
	}

	return false
}

// shouldLogRequestBody determines if request body should be logged
func shouldLogRequestBody(path string) bool {
	// Log request bodies for these endpoints
	logPatterns := []string{
		"/servers",
		"/users",
		"/config",
	}

	for _, pattern := range logPatterns {
		if strings.Contains(path, pattern) {
			return true
		}
	}

	return false
}

// shouldLogResponseBody determines if response body should be logged
func shouldLogResponseBody(path string) bool {
	// Log response bodies for these sensitive endpoints
	logPatterns := []string{
		"/auth",
		"/users",
		"/admin",
	}

	for _, pattern := range logPatterns {
		if strings.Contains(path, pattern) {
			return true
		}
	}

	return false
}

// sanitizeRequestBody removes sensitive information from request body
func sanitizeRequestBody(body string) string {
	// Remove common sensitive fields
	sensitiveFields := []string{
		"password", "token", "secret", "key", "credential",
		"private_key", "auth", "session", "cookie",
	}

	result := body
	for _, field := range sensitiveFields {
		// Simple regex replacement for JSON fields
		// In production, use proper JSON parsing for more accurate sanitization
		patterns := []string{
			`"` + field + `"\s*:\s*"[^"]*"`,
			`"` + field + `"\s*:\s*'[^']*'`,
		}

		for _, pattern := range patterns {
			result = regexp.MustCompile(pattern).ReplaceAllString(result, `"`+field+`":"[REDACTED]"`)
		}
	}

	// Limit length
	if len(result) > 1000 {
		result = result[:1000] + "...[TRUNCATED]"
	}

	return result
}

// sanitizeResponseBody removes sensitive information from response body
func sanitizeResponseBody(body string) string {
	// Similar to request sanitization but for responses
	return sanitizeRequestBody(body)
}

// ErrorLoggingMiddleware captures and logs panics
func ErrorLoggingMiddleware(logger Logger) gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
		ctx := c.Request.Context()

		fields := []Field{
			String("method", c.Request.Method),
			String("path", c.Request.URL.Path),
			String("client_ip", c.ClientIP),
			Any("panic", recovered),
		}

		logger.Error(ctx, "Panic recovered", fields...)

		c.AbortWithStatus(http.StatusInternalServerError)
	})
}

// CorrelationIDMiddleware ensures every request has a correlation ID
func CorrelationIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		correlationID := c.GetHeader("X-Correlation-ID")
		if correlationID == "" {
			correlationID = NewCorrelationID()
		}

		// Add to context
		ctx := WithCorrelationID(c.Request.Context(), correlationID)
		c.Request = c.Request.WithContext(ctx)

		// Set response header
		c.Header("X-Correlation-ID", correlationID)

		c.Next()
	}
}

// RequestIDMiddleware ensures every request has a request ID
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = NewRequestID()
		}

		// Add to context
		ctx := WithRequestID(c.Request.Context(), requestID)
		c.Request = c.Request.WithContext(ctx)

		// Set response header
		c.Header("X-Request-ID", requestID)

		c.Next()
	}
}