module minecraft-platform

go 1.21

require (
	// Web framework - Gin with middleware
	github.com/gin-gonic/gin v1.9.1
	github.com/gin-contrib/cors v1.5.0
	github.com/gin-contrib/requestid v0.0.6
	github.com/gin-contrib/logger v0.2.6

	// Database - CockroachDB/PostgreSQL
	github.com/jackc/pgx/v5 v5.4.3
	github.com/jackc/pgxpool/v5 v5.4.3
	github.com/golang-migrate/migrate/v4 v4.16.2

	// Kubernetes client libraries
	k8s.io/client-go v0.28.3
	k8s.io/apimachinery v0.28.3
	sigs.k8s.io/controller-runtime v0.16.3

	// OpenAPI and validation
	github.com/swaggo/gin-swagger v1.6.0
	github.com/swaggo/files v1.0.1
	github.com/swaggo/swag v1.16.2
	github.com/go-playground/validator/v10 v10.15.5

	// Testing frameworks
	github.com/stretchr/testify v1.8.4
	github.com/testcontainers/testcontainers-go v0.24.1
	github.com/testcontainers/testcontainers-go/modules/cockroachdb v0.24.1

	// Load testing
	github.com/tsenart/vegeta/v12 v12.11.1

	// WebSocket support
	github.com/gorilla/websocket v1.5.1

	// Configuration and environment
	github.com/kelseyhightower/envconfig v1.4.0
	github.com/joho/godotenv v1.4.0

	// Utilities and logging
	github.com/google/uuid v1.4.0
	github.com/sirupsen/logrus v1.9.3
	github.com/rs/zerolog v1.31.0

	// Monitoring and metrics
	github.com/prometheus/client_golang v1.17.0
	go.opentelemetry.io/otel v1.19.0
	go.opentelemetry.io/otel/trace v1.19.0

	// Security
	github.com/golang-jwt/jwt/v5 v5.1.0
	golang.org/x/crypto v0.15.0

	// Message queue (NATS)
	github.com/nats-io/nats.go v1.31.0
)