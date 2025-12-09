module minecraft-platform

go 1.21

require (
	// Web framework
	github.com/gin-gonic/gin v1.9.1

	// Database
	gorm.io/gorm v1.25.5
	gorm.io/driver/postgres v1.5.4

	// Utilities
	github.com/google/uuid v1.4.0
	github.com/stretchr/testify v1.8.4

	// Kubernetes client
	k8s.io/api v0.28.4
	k8s.io/apimachinery v0.28.4
	k8s.io/client-go v0.28.4

	// Redis for caching
	github.com/redis/go-redis/v9 v9.3.0

	// JWT authentication
	github.com/golang-jwt/jwt/v5 v5.1.0

	// WebSocket
	github.com/gorilla/websocket v1.5.1

	// Logging
	go.uber.org/zap v1.26.0

	// Validation
	github.com/go-playground/validator/v10 v10.16.0
)
