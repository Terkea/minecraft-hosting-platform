# Minecraft Hosting Platform - Root Makefile

.PHONY: help dev-up dev-down dev-status build-operator build-api test clean

# Default target
help:
	@echo "Minecraft Hosting Platform"
	@echo ""
	@echo "Local Development:"
	@echo "  make dev-up      - Start local development environment (minikube)"
	@echo "  make dev-down    - Stop local development environment"
	@echo "  make dev-status  - Show status of local environment"
	@echo "  make dev-logs    - Show operator logs"
	@echo ""
	@echo "Build:"
	@echo "  make build       - Build all components"
	@echo "  make build-operator - Build operator binary and image"
	@echo "  make build-api   - Build API server binary and image"
	@echo ""
	@echo "Testing:"
	@echo "  make test        - Run all tests"
	@echo "  make test-backend - Run backend tests"
	@echo "  make test-operator - Run operator tests"
	@echo ""
	@echo "Kubernetes:"
	@echo "  make install-crds - Install CRDs to cluster"
	@echo "  make deploy      - Deploy all components"
	@echo "  make example     - Create example Minecraft server"

# Local development
dev-up:
	./scripts/local-dev.sh up

dev-down:
	./scripts/local-dev.sh down

dev-status:
	./scripts/local-dev.sh status

dev-logs:
	./scripts/local-dev.sh logs

dev-example:
	./scripts/local-dev.sh example

# Build targets
build: build-operator build-api

build-operator:
	cd k8s/operator && go build -o bin/operator main.go
	@echo "Operator binary built at k8s/operator/bin/operator"

build-api:
	cd backend && go build -o bin/api-server cmd/api-server/main.go
	@echo "API server binary built at backend/bin/api-server"

# Docker builds (requires minikube docker-env)
docker-build: docker-build-operator docker-build-api

docker-build-operator:
	cd k8s/operator && docker build -t minecraft-platform-operator:latest .

docker-build-api:
	cd backend && docker build -t minecraft-platform-api:latest .

# Testing
test: test-backend test-operator

test-backend:
	cd backend && go test ./... -v

test-operator:
	cd k8s/operator && go test ./... -v

test-contract:
	cd backend && go test ./tests/contract/... -v

# Kubernetes operations
install-crds:
	kubectl apply -f k8s/operator/config/crd/

uninstall-crds:
	kubectl delete -f k8s/operator/config/crd/

deploy:
	kubectl apply -f k8s/manifests/dev/

undeploy:
	kubectl delete -f k8s/manifests/dev/

example:
	kubectl apply -f k8s/manifests/dev/example-server.yaml

# Dependencies
deps:
	cd backend && go mod tidy
	cd k8s/operator && go mod tidy

# Generate
generate:
	cd k8s/operator && go generate ./...

# Clean
clean:
	rm -rf backend/bin
	rm -rf k8s/operator/bin
