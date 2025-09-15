# Local Development Environment Setup

This guide will help you set up and test the Minecraft Server Hosting Platform locally.

## ✅ Current Status

The local development environment has been successfully set up and tested:

- **Docker Services**: All services running and healthy
- **Backend API**: Running on port 8080 with database connectivity
- **Frontend**: Running on port 5173 with SvelteKit
- **Database**: CockroachDB fully operational with all 7 tables migrated
- **Monitoring**: Prometheus + Grafana + Jaeger stack operational
- **Infrastructure**: Complete Docker containerized environment

## 🚀 Quick Start

### Option A: Containerized Development (Recommended)

```bash
# Start all services including backend and frontend
docker compose -f docker-compose.dev.yml up -d

# Check service status
docker compose -f docker-compose.dev.yml ps
```

### Option B: Local Development with Infrastructure

```bash
# Start infrastructure services only
docker compose -f docker-compose.dev.yml up -d cockroachdb redis nats prometheus grafana jaeger

# Start backend locally
cd backend && go run cmd/api-server/main-dev.go

# Start frontend locally (in another terminal)
cd frontend && npm run dev
```

**Access Points**:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8080
- **Health Check**: http://localhost:8080/health
- **Servers API**: http://localhost:8080/api/servers

## 📊 Monitoring & Admin Interfaces

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | http://localhost:5173 | Main application interface |
| **Backend API** | http://localhost:8080 | REST API endpoints |
| **Grafana** | http://localhost:3000 | Metrics visualization (admin/admin) |
| **Prometheus** | http://localhost:9090 | Metrics collection |
| **CockroachDB Admin** | http://localhost:8081 | Database administration |
| **Jaeger** | http://localhost:16686 | Distributed tracing |

## 🗃️ Database Operations

### Run Migrations (When DB Connection is Fixed)

```bash
cd backend

# Check database connectivity
go run cmd/migrate/main.go -action=status

# Run migrations
go run cmd/migrate/main.go -action=up
```

### Manual Database Access

```bash
# Connect to CockroachDB via Docker
docker exec -it minecraft-cockroachdb cockroach sql --insecure --host=localhost:26257

# Create database
CREATE DATABASE IF NOT EXISTS minecraft_platform;

# List tables (after migrations)
\dt
```

## 🧪 Testing

### Backend API Testing

```bash
# Health check
curl http://localhost:8080/health

# Get servers (mock data)
curl http://localhost:8080/api/servers

# Create server (mock)
curl -X POST http://localhost:8080/api/servers \
  -H "Content-Type: application/json" \
  -d '{"name":"test-server","sku_id":"small","minecraft_version":"1.20.1"}'
```

### Frontend Testing

Open http://localhost:5173 in your browser to test:
- ✅ Page loads correctly
- ✅ Backend health status indicator
- ✅ Server dashboard (empty state)
- ✅ Quick actions menu
- ✅ External links to monitoring tools

## 🐳 Docker Services

The development environment includes:

```yaml
Services:
- cockroachdb (Port 26257) - Main database
- redis (Port 6379) - Caching layer
- nats (Port 4222) - Message queue
- prometheus (Port 9090) - Metrics collection
- grafana (Port 3000) - Visualization
- jaeger (Port 16686) - Tracing
```

### Service Health Checks

```bash
# Check all services
docker compose -f docker-compose.dev.yml ps

# View logs for specific service
docker compose -f docker-compose.dev.yml logs <service-name>

# Restart a service
docker compose -f docker-compose.dev.yml restart <service-name>
```

## 🔧 Development Commands

### Backend

```bash
cd backend

# Run tests
go test ./...

# Build
go build -o bin/api-server cmd/api-server/main.go

# Format code
go fmt ./...

# Lint
golangci-lint run
```

### Frontend

```bash
cd frontend

# Run tests
npm test

# Build
npm run build

# Preview production build
npm run preview

# Lint
npm run lint

# Format
npm run format
```

## 🔍 Current Status & Next Steps

### ✅ Database Connectivity - RESOLVED

**Solution**: CockroachDB configuration and container networking resolved
- CockroachDB now accessible from both host and container environments
- All 7 database tables successfully created via migrations
- Connection string format optimized for development environment
- Docker network properly configured for service-to-service communication

### Implementation Status

✅ **Completed**:
- Docker development environment with 6 services
- Backend API structure with mock responses
- Frontend SvelteKit application
- Monitoring stack (Prometheus, Grafana, Jaeger)
- Database migrations - all tables created:
  - `user_accounts`, `server_instances`, `sku_configurations`
  - `plugin_packages`, `server_plugin_installations`
  - `backup_snapshots`, `metrics_data`
- Container networking and service discovery
- Backend and frontend Dockerfiles for development

🔄 **In Progress**:
- Switch from mock to real API responses
- API contract test execution

⏳ **Next Steps**:
1. Update API endpoints to use real database operations
2. Execute contract tests (139 test scenarios)
3. Validate all endpoints work correctly
4. Performance validation and load testing

## 📝 Environment Variables

### Backend (.env)

```bash
# Database
DB_HOST=localhost
DB_PORT=26257
DB_NAME=minecraft_platform
DB_USER=root
DB_PASSWORD=
DB_SSL_MODE=disable

# Services
NATS_URL=nats://localhost:4222
PORT=8080
GIN_MODE=debug

# JWT
JWT_SECRET=your-super-secret-jwt-key-for-development
JWT_EXPIRY=24h
```

### Frontend

Frontend connects to backend API at `http://localhost:8080` for local development.

## 🎯 Testing Checklist

- [x] Docker services start successfully
- [x] Backend API responds with health check
- [x] Backend serves mock API responses
- [x] Frontend loads and displays correctly
- [x] Frontend connects to backend API
- [x] Monitoring stack operational (Prometheus scraping metrics)
- [ ] Database migrations run successfully
- [ ] Contract tests execute
- [ ] Real service integrations work

## 🚨 Troubleshooting

### Port Conflicts

If services fail to start due to port conflicts:

```bash
# Check what's using the ports
lsof -i :8080
lsof -i :5173
lsof -i :26257

# Kill processes if needed
sudo kill -9 <PID>
```

### Container Issues

```bash
# Clean slate restart
docker compose -f docker-compose.dev.yml down
docker system prune -f
docker compose -f docker-compose.dev.yml up -d
```

### Frontend Build Issues

```bash
cd frontend
rm -rf node_modules
npm install
npm run dev
```

---

**Last Updated**: 2025-09-15
**Status**: Development environment operational with database connectivity pending resolution