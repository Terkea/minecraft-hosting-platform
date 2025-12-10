# Minecraft Server Hosting Platform Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-09-13

## Active Technologies

**Backend**: Go 1.21+, Gin web framework, CockroachDB (PostgreSQL compatible)
**Frontend**: Svelte with TypeScript, Tailwind CSS
**Infrastructure**: Kubernetes 1.28+, Kubebuilder operators, Helm charts
**Storage**: Kubernetes Persistent Volumes, CockroachDB for metadata
**Testing**: Go testing + Testcontainers, k6 load testing, Ginkgo/Gomega
**Monitoring**: Prometheus + Grafana + Jaeger, NATS for real-time events

## Project Structure

```
backend/
├── cmd/
│   ├── api-server/           # Main HTTP API server
│   └── operator/            # Kubernetes operator
├── pkg/
│   ├── server-lifecycle/    # Deploy, start, stop, delete servers
│   ├── plugin-manager/      # Install, configure, remove plugins
│   ├── backup-service/      # Create, restore, schedule backups
│   ├── metrics-collector/   # Gather and expose server metrics
│   ├── config-manager/      # Zero-downtime configuration updates
│   └── models/              # Data models and database schema
└── tests/
    ├── contract/            # API contract tests (OpenAPI validation)
    ├── integration/         # Real dependencies with Testcontainers
    └── unit/               # Library unit tests

frontend/
├── src/
│   ├── components/         # Reusable UI components
│   ├── pages/             # Server dashboard, monitoring, settings
│   └── services/          # API client, WebSocket handlers
└── tests/
    ├── component/         # Component testing
    └── e2e/              # End-to-end user flows

k8s/
├── operator/             # Kubebuilder-generated operator
├── crds/                 # MinecraftServer custom resource definitions
└── manifests/           # Deployment configurations
```

## Commands

**Backend (Go)**:

```bash
# Development
go mod tidy                    # Update dependencies
go run cmd/api-server/main.go  # Start API server
go run cmd/operator/main.go    # Start Kubernetes operator

# Testing (TDD - tests must fail first!)
go test ./... -v              # Run all tests
go test -tags=integration     # Integration tests with real dependencies
k6 run tests/load/api.js     # Load testing

# Building
go build -o bin/api-server cmd/api-server/
go build -o bin/operator cmd/operator/

# Libraries (each exposes CLI)
./bin/server-lifecycle --help    # Server management commands
./bin/plugin-manager --version   # Plugin operations
./bin/backup-service --format=json # Backup utilities
```

**Frontend (Svelte)**:

```bash
# Development
npm install                   # Install dependencies
npm run dev                  # Start dev server with hot reload
npm run build                # Production build
npm run preview              # Preview production build

# Testing
npm run test                 # Component tests
npm run test:e2e            # End-to-end tests
```

**Kubernetes**:

```bash
# Operator development
make generate               # Generate CRD and deepcopy code
make manifests             # Update CRD manifests
make install               # Install CRDs
make run                   # Run operator locally

# Deployment
helm upgrade --install minecraft-platform ./charts/
kubectl apply -f k8s/crds/ # Install custom resources
```

## Code Style

**Go Standards**:

- Use gofmt, golint, go vet
- Structured logging with correlation IDs
- Error handling with context
- Test-first development (TDD mandatory)
- Direct framework usage (no unnecessary abstractions)

**Svelte/TypeScript**:

- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- Component naming: PascalCase
- Real-time updates via WebSockets
- Minimal bundle size optimization

## Recent Changes

**001-create-a-cloud** (2025-09-13): Initial platform architecture

- Added Go + Gin API backend with CockroachDB
- Added Svelte frontend with real-time monitoring
- Added Kubebuilder Kubernetes operator for server lifecycle
- Added comprehensive API contracts and data model
- Added TDD testing strategy with Testcontainers

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
