# Cloud-Native Minecraft Server Hosting Platform

A cloud-native platform for deploying, configuring, and managing Minecraft servers on Kubernetes infrastructure with full lifecycle control.

## Project Structure

### Backend (Go 1.21+)
- **API Server**: REST API with Gin framework
- **Database**: CockroachDB with multi-tenant isolation
- **Testing**: Testcontainers for integration tests

```
backend/
├── src/
│   ├── models/         # Data models and database schema
│   ├── services/       # Business logic libraries
│   ├── api/            # HTTP endpoint handlers
│   └── database/       # Database connection and migrations
├── tests/
│   ├── contract/       # API contract tests (OpenAPI validation)
│   ├── integration/    # Real dependency integration tests
│   ├── unit/           # Library unit tests
│   └── load/           # Performance and load tests
└── cmd/                # CLI interfaces for libraries
```

### Frontend (Svelte + TypeScript)
- **Dashboard**: Real-time server monitoring
- **Management**: Server lifecycle and configuration
- **Plugins**: Marketplace and installation interface

```
frontend/
├── src/
│   ├── components/     # Reusable UI components
│   ├── pages/          # Server dashboard, settings, monitoring
│   ├── services/       # API client and WebSocket handlers
│   └── lib/            # Shared utilities
└── tests/
    ├── component/      # Component unit tests
    └── e2e/            # End-to-end user flow tests
```

### Kubernetes Operator
- **Custom Resources**: MinecraftServer CRD
- **Controllers**: Server lifecycle management
- **Manifests**: Deployment configurations

```
k8s/
├── operator/
│   ├── api/v1/         # Custom resource definitions
│   ├── controllers/    # Reconciliation logic
│   ├── config/         # RBAC, CRD, manager configs
│   └── tests/          # Operator integration tests
└── manifests/
    ├── dev/            # Development environment
    ├── staging/        # Staging environment
    └── prod/           # Production environment
```

## Getting Started

### Prerequisites
- Go 1.21+
- Node.js 18+ with npm
- Kubernetes 1.28+ cluster
- CockroachDB instance

### Development Setup

1. **Backend Development**:
```bash
cd backend
go mod tidy
go run cmd/api-server/main.go
```

2. **Frontend Development**:
```bash
cd frontend
npm install
npm run dev
```

3. **Kubernetes Operator**:
```bash
cd k8s/operator
make generate
make install
make run
```

### Testing

**TDD Workflow** (Test-Driven Development):
```bash
# 1. Write tests first (they must fail)
go test ./tests/contract/...
go test ./tests/integration/...

# 2. Implement features to make tests pass
go test ./...

# 3. Run load tests for performance validation
go test -tags=load ./tests/load/...
```

## Performance Goals

- **Deployment**: <60 seconds from request to playable server
- **API Response**: <200ms for management operations
- **Configuration Updates**: <30 seconds with zero downtime
- **Scale**: 1000+ concurrent servers, 100+ simultaneous deployments

## Architecture Principles

- **Library-First**: Every feature as a standalone library with CLI interface
- **Test-First**: TDD mandatory - tests written before implementation
- **Real Dependencies**: Integration tests use actual databases and Kubernetes
- **Multi-Tenant**: Complete isolation at database, network, and storage levels
- **Observable**: Structured logging with correlation IDs and distributed tracing

## Documentation

- [Implementation Plan](specs/001-create-a-cloud/plan.md) - Technical architecture and decisions
- [Data Model](specs/001-create-a-cloud/data-model.md) - Database schema and entities
- [API Contracts](specs/001-create-a-cloud/contracts/) - OpenAPI specifications
- [Task Breakdown](specs/001-create-a-cloud/tasks.md) - Development task list
- [Quickstart Guide](specs/001-create-a-cloud/quickstart.md) - User journey validation

## Development Guidelines

See [CLAUDE.md](CLAUDE.md) for detailed development guidelines, code style, and tooling recommendations.