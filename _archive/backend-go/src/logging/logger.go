package logging

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"go.opentelemetry.io/otel/trace"
)

// LogLevel represents the severity of a log entry
type LogLevel string

const (
	DebugLevel LogLevel = "debug"
	InfoLevel  LogLevel = "info"
	WarnLevel  LogLevel = "warn"
	ErrorLevel LogLevel = "error"
	FatalLevel LogLevel = "fatal"
)

// Logger interface defines the logging contract
type Logger interface {
	Debug(ctx context.Context, msg string, fields ...Field)
	Info(ctx context.Context, msg string, fields ...Field)
	Warn(ctx context.Context, msg string, fields ...Field)
	Error(ctx context.Context, msg string, fields ...Field)
	Fatal(ctx context.Context, msg string, fields ...Field)
	WithFields(fields ...Field) Logger
	WithError(err error) Logger
}

// Field represents a structured log field
type Field struct {
	Key   string
	Value interface{}
}

// StructuredLogger implements the Logger interface with structured logging
type StructuredLogger struct {
	logger        *logrus.Logger
	baseFields    map[string]interface{}
	correlationID string
	tenantID      string
	userID        string
	component     string
}

// LogEntry represents a single log entry with all metadata
type LogEntry struct {
	Timestamp     time.Time              `json:"timestamp"`
	Level         string                 `json:"level"`
	Message       string                 `json:"message"`
	Component     string                 `json:"component"`
	CorrelationID string                 `json:"correlation_id,omitempty"`
	TenantID      string                 `json:"tenant_id,omitempty"`
	UserID        string                 `json:"user_id,omitempty"`
	TraceID       string                 `json:"trace_id,omitempty"`
	SpanID        string                 `json:"span_id,omitempty"`
	File          string                 `json:"file,omitempty"`
	Function      string                 `json:"function,omitempty"`
	Line          int                    `json:"line,omitempty"`
	Fields        map[string]interface{} `json:"fields,omitempty"`
	Error         string                 `json:"error,omitempty"`
	Stack         string                 `json:"stack,omitempty"`
}

// AuditEvent represents an audit log entry
type AuditEvent struct {
	LogEntry
	Action       string                 `json:"action"`
	Resource     string                 `json:"resource"`
	ResourceID   string                 `json:"resource_id,omitempty"`
	Result       string                 `json:"result"`
	IPAddress    string                 `json:"ip_address,omitempty"`
	UserAgent    string                 `json:"user_agent,omitempty"`
	RequestID    string                 `json:"request_id,omitempty"`
	Duration     time.Duration          `json:"duration,omitempty"`
	RequestBody  string                 `json:"request_body,omitempty"`
	ResponseCode int                    `json:"response_code,omitempty"`
	Changes      map[string]interface{} `json:"changes,omitempty"`
}

// NewLogger creates a new structured logger
func NewLogger(component string) Logger {
	logger := logrus.New()

	// Configure JSON formatter
	logger.SetFormatter(&logrus.JSONFormatter{
		TimestampFormat: time.RFC3339Nano,
		FieldMap: logrus.FieldMap{
			logrus.FieldKeyTime:  "timestamp",
			logrus.FieldKeyLevel: "level",
			logrus.FieldKeyMsg:   "message",
		},
	})

	// Set output to stdout for container logging
	logger.SetOutput(os.Stdout)

	// Set log level from environment
	level := os.Getenv("LOG_LEVEL")
	switch level {
	case "debug":
		logger.SetLevel(logrus.DebugLevel)
	case "info":
		logger.SetLevel(logrus.InfoLevel)
	case "warn":
		logger.SetLevel(logrus.WarnLevel)
	case "error":
		logger.SetLevel(logrus.ErrorLevel)
	case "fatal":
		logger.SetLevel(logrus.FatalLevel)
	default:
		logger.SetLevel(logrus.InfoLevel)
	}

	return &StructuredLogger{
		logger:     logger,
		baseFields: make(map[string]interface{}),
		component:  component,
	}
}

// Debug logs a debug message
func (l *StructuredLogger) Debug(ctx context.Context, msg string, fields ...Field) {
	l.log(ctx, logrus.DebugLevel, msg, nil, fields...)
}

// Info logs an info message
func (l *StructuredLogger) Info(ctx context.Context, msg string, fields ...Field) {
	l.log(ctx, logrus.InfoLevel, msg, nil, fields...)
}

// Warn logs a warning message
func (l *StructuredLogger) Warn(ctx context.Context, msg string, fields ...Field) {
	l.log(ctx, logrus.WarnLevel, msg, nil, fields...)
}

// Error logs an error message
func (l *StructuredLogger) Error(ctx context.Context, msg string, fields ...Field) {
	l.log(ctx, logrus.ErrorLevel, msg, nil, fields...)
}

// Fatal logs a fatal message and exits
func (l *StructuredLogger) Fatal(ctx context.Context, msg string, fields ...Field) {
	l.log(ctx, logrus.FatalLevel, msg, nil, fields...)
	os.Exit(1)
}

// WithFields returns a new logger with additional fields
func (l *StructuredLogger) WithFields(fields ...Field) Logger {
	newLogger := &StructuredLogger{
		logger:        l.logger,
		baseFields:    make(map[string]interface{}),
		correlationID: l.correlationID,
		tenantID:      l.tenantID,
		userID:        l.userID,
		component:     l.component,
	}

	// Copy existing base fields
	for k, v := range l.baseFields {
		newLogger.baseFields[k] = v
	}

	// Add new fields
	for _, field := range fields {
		newLogger.baseFields[field.Key] = field.Value
	}

	return newLogger
}

// WithError returns a new logger with error context
func (l *StructuredLogger) WithError(err error) Logger {
	return l.WithFields(Field{Key: "error", Value: err.Error()})
}

// log is the internal logging method
func (l *StructuredLogger) log(ctx context.Context, level logrus.Level, msg string, err error, fields ...Field) {
	entry := l.logger.WithFields(logrus.Fields{})

	// Add component
	if l.component != "" {
		entry = entry.WithField("component", l.component)
	}

	// Extract correlation ID from context
	if correlationID := GetCorrelationID(ctx); correlationID != "" {
		entry = entry.WithField("correlation_id", correlationID)
	} else if l.correlationID != "" {
		entry = entry.WithField("correlation_id", l.correlationID)
	}

	// Extract tenant ID from context
	if tenantID := GetTenantID(ctx); tenantID != "" {
		entry = entry.WithField("tenant_id", tenantID)
	} else if l.tenantID != "" {
		entry = entry.WithField("tenant_id", l.tenantID)
	}

	// Extract user ID from context
	if userID := GetUserID(ctx); userID != "" {
		entry = entry.WithField("user_id", userID)
	} else if l.userID != "" {
		entry = entry.WithField("user_id", l.userID)
	}

	// Add OpenTelemetry trace information
	span := trace.SpanFromContext(ctx)
	if span.SpanContext().IsValid() {
		entry = entry.WithField("trace_id", span.SpanContext().TraceID().String())
		entry = entry.WithField("span_id", span.SpanContext().SpanID().String())
	}

	// Add caller information
	if pc, file, line, ok := runtime.Caller(2); ok {
		entry = entry.WithField("file", file)
		entry = entry.WithField("line", line)
		if fn := runtime.FuncForPC(pc); fn != nil {
			entry = entry.WithField("function", fn.Name())
		}
	}

	// Add base fields
	for k, v := range l.baseFields {
		entry = entry.WithField(k, v)
	}

	// Add additional fields
	for _, field := range fields {
		entry = entry.WithField(field.Key, field.Value)
	}

	// Add error if provided
	if err != nil {
		entry = entry.WithError(err)
	}

	// Log the message
	entry.Log(level, msg)

	// Send to audit trail if it's an important action
	if level >= logrus.WarnLevel {
		l.sendToAuditTrail(ctx, level.String(), msg, err, fields...)
	}
}

// sendToAuditTrail sends important logs to the audit trail
func (l *StructuredLogger) sendToAuditTrail(ctx context.Context, level, msg string, err error, fields ...Field) {
	// This would typically send to an audit service or queue
	// For now, we'll just log with a special audit marker
	auditEntry := AuditEvent{
		LogEntry: LogEntry{
			Timestamp:     time.Now(),
			Level:         level,
			Message:       msg,
			Component:     l.component,
			CorrelationID: GetCorrelationID(ctx),
			TenantID:      GetTenantID(ctx),
			UserID:        GetUserID(ctx),
			Fields:        make(map[string]interface{}),
		},
	}

	// Add trace information
	span := trace.SpanFromContext(ctx)
	if span.SpanContext().IsValid() {
		auditEntry.TraceID = span.SpanContext().TraceID().String()
		auditEntry.SpanID = span.SpanContext().SpanID().String()
	}

	// Add fields
	for _, field := range fields {
		auditEntry.Fields[field.Key] = field.Value
	}

	// Add error
	if err != nil {
		auditEntry.Error = err.Error()
	}

	// Marshal and log as audit event
	if auditJSON, err := json.Marshal(auditEntry); err == nil {
		l.logger.WithField("audit", true).Info(string(auditJSON))
	}
}

// Helper functions for field creation
func String(key, value string) Field {
	return Field{Key: key, Value: value}
}

func Int(key string, value int) Field {
	return Field{Key: key, Value: value}
}

func Int64(key string, value int64) Field {
	return Field{Key: key, Value: value}
}

func Float64(key string, value float64) Field {
	return Field{Key: key, Value: value}
}

func Bool(key string, value bool) Field {
	return Field{Key: key, Value: value}
}

func Duration(key string, value time.Duration) Field {
	return Field{Key: key, Value: value.String()}
}

func Any(key string, value interface{}) Field {
	return Field{Key: key, Value: value}
}

func Error(err error) Field {
	return Field{Key: "error", Value: err.Error()}
}

// Context key types
type contextKey string

const (
	correlationIDKey contextKey = "correlation_id"
	tenantIDKey      contextKey = "tenant_id"
	userIDKey        contextKey = "user_id"
	requestIDKey     contextKey = "request_id"
)

// WithCorrelationID adds a correlation ID to the context
func WithCorrelationID(ctx context.Context, correlationID string) context.Context {
	return context.WithValue(ctx, correlationIDKey, correlationID)
}

// GetCorrelationID retrieves the correlation ID from context
func GetCorrelationID(ctx context.Context) string {
	if id, ok := ctx.Value(correlationIDKey).(string); ok {
		return id
	}
	return ""
}

// WithTenantID adds a tenant ID to the context
func WithTenantID(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, tenantIDKey, tenantID)
}

// GetTenantID retrieves the tenant ID from context
func GetTenantID(ctx context.Context) string {
	if id, ok := ctx.Value(tenantIDKey).(string); ok {
		return id
	}
	return ""
}

// WithUserID adds a user ID to the context
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

// GetUserID retrieves the user ID from context
func GetUserID(ctx context.Context) string {
	if id, ok := ctx.Value(userIDKey).(string); ok {
		return id
	}
	return ""
}

// WithRequestID adds a request ID to the context
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDKey, requestID)
}

// GetRequestID retrieves the request ID from context
func GetRequestID(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey).(string); ok {
		return id
	}
	return ""
}

// NewCorrelationID generates a new correlation ID
func NewCorrelationID() string {
	return uuid.New().String()
}

// NewRequestID generates a new request ID
func NewRequestID() string {
	return uuid.New().String()
}

// AuditLogger provides specialized audit logging
type AuditLogger struct {
	logger Logger
}

// NewAuditLogger creates a new audit logger
func NewAuditLogger() *AuditLogger {
	return &AuditLogger{
		logger: NewLogger("audit"),
	}
}

// LogAction logs an audit action
func (a *AuditLogger) LogAction(ctx context.Context, action, resource, resourceID, result string, fields ...Field) {
	auditFields := []Field{
		String("action", action),
		String("resource", resource),
		String("result", result),
	}

	if resourceID != "" {
		auditFields = append(auditFields, String("resource_id", resourceID))
	}

	auditFields = append(auditFields, fields...)

	a.logger.Info(ctx, fmt.Sprintf("Audit: %s %s %s", action, resource, result), auditFields...)
}

// LogServerAction logs a Minecraft server action
func (a *AuditLogger) LogServerAction(ctx context.Context, action, serverID, result string, duration time.Duration, fields ...Field) {
	auditFields := []Field{
		String("action", action),
		String("resource", "minecraft_server"),
		String("resource_id", serverID),
		String("result", result),
		Duration("duration", duration),
	}

	auditFields = append(auditFields, fields...)

	a.logger.Info(ctx, fmt.Sprintf("Server %s: %s %s", serverID, action, result), auditFields...)
}

// LogAuthEvent logs an authentication event
func (a *AuditLogger) LogAuthEvent(ctx context.Context, event, userID, result, ipAddress, userAgent string, fields ...Field) {
	auditFields := []Field{
		String("action", event),
		String("resource", "authentication"),
		String("user_id", userID),
		String("result", result),
		String("ip_address", ipAddress),
		String("user_agent", userAgent),
	}

	auditFields = append(auditFields, fields...)

	a.logger.Info(ctx, fmt.Sprintf("Auth %s: %s %s", event, userID, result), auditFields...)
}