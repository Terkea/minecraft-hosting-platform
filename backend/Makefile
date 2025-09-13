.PHONY: help build run test test-integration test-load clean deps fmt lint

# Default target
help:
	@echo "Available commands:"
	@echo "  deps              Install Go dependencies"
	@echo "  build             Build the application"
	@echo "  run               Run the application in development mode"
	@echo "  test              Run unit tests"
	@echo "  test-integration  Run integration tests (requires Testcontainers)"
	@echo "  test-load         Run load tests"
	@echo "  fmt               Format Go code"
	@echo "  lint              Run linter"
	@echo "  clean             Clean build artifacts"

# Install dependencies
deps:
	go mod download
	go mod tidy

# Build the application
build:
	go build -o bin/api-server ./cmd/api-server

# Run in development mode
run:
	go run ./cmd/api-server

# Run unit tests
test:
	go test -v ./src/... -short

# Run integration tests with real dependencies
test-integration:
	go test -v ./tests/integration/... -tags=integration

# Run contract tests
test-contract:
	go test -v ./tests/contract/... -tags=contract

# Run load tests
test-load:
	go test -v ./tests/load/... -tags=load

# Run all tests
test-all: test test-contract test-integration

# Format code
fmt:
	go fmt ./...
	goimports -w .

# Run linter
lint:
	golangci-lint run

# Generate OpenAPI documentation
docs:
	swag init -g ./cmd/api-server/main.go -o ./docs

# Clean build artifacts
clean:
	rm -rf bin/
	rm -rf docs/
	go clean -testcache

# Development setup
setup: deps
	cp .env.example .env
	@echo "Backend setup complete. Edit .env file with your configuration."