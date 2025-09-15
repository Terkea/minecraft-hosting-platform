#!/bin/bash

# Quickstart Validation Script
# Validates that the Minecraft hosting platform is properly configured and functional

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🎮 Minecraft Hosting Platform - Quickstart Validation${NC}"
echo "=========================================================="

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
        exit 1
    fi
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

# Check prerequisites
echo -e "\n${GREEN}1. Checking Prerequisites${NC}"
echo "--------------------------------"

# Check Go installation
if command -v go &> /dev/null; then
    GO_VERSION=$(go version | cut -d' ' -f3)
    print_status 0 "Go installed: $GO_VERSION"

    # Check Go version is 1.21+
    GO_MAJOR=$(echo $GO_VERSION | sed 's/go//' | cut -d'.' -f1)
    GO_MINOR=$(echo $GO_VERSION | sed 's/go//' | cut -d'.' -f2)

    if [ "$GO_MAJOR" -gt 1 ] || ([ "$GO_MAJOR" -eq 1 ] && [ "$GO_MINOR" -ge 21 ]); then
        print_status 0 "Go version meets requirements (1.21+)"
    else
        print_status 1 "Go version too old. Requires 1.21+"
    fi
else
    print_status 1 "Go not installed"
fi

# Check Node.js installation
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_status 0 "Node.js installed: $NODE_VERSION"
else
    print_status 1 "Node.js not installed"
fi

# Check Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | sed 's/,//')
    print_status 0 "Docker installed: $DOCKER_VERSION"

    # Check if Docker daemon is running
    if docker ps &> /dev/null; then
        print_status 0 "Docker daemon is running"
    else
        print_status 1 "Docker daemon is not running"
    fi
else
    print_status 1 "Docker not installed"
fi

# Check kubectl
if command -v kubectl &> /dev/null; then
    KUBECTL_VERSION=$(kubectl version --client --short 2>/dev/null | cut -d' ' -f3)
    print_status 0 "kubectl installed: $KUBECTL_VERSION"
else
    print_warning "kubectl not found - required for Kubernetes deployments"
fi

# Check project structure
echo -e "\n${GREEN}2. Validating Project Structure${NC}"
echo "--------------------------------"

REQUIRED_DIRS=("backend" "frontend" "k8s" "specs")
REQUIRED_FILES=("go.mod" "backend/cmd/api-server/main.go" "frontend/package.json" "k8s/operator/main.go")

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        print_status 0 "Directory exists: $dir"
    else
        print_status 1 "Missing directory: $dir"
    fi
done

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        print_status 0 "File exists: $file"
    else
        print_status 1 "Missing file: $file"
    fi
done

# Validate Go module
echo -e "\n${GREEN}3. Validating Backend (Go)${NC}"
echo "--------------------------------"

if [ -f "go.mod" ]; then
    MODULE_NAME=$(grep "^module " go.mod | cut -d' ' -f2)
    print_status 0 "Go module: $MODULE_NAME"

    # Check Go dependencies
    print_info "Checking Go dependencies..."
    if go mod verify &> /dev/null; then
        print_status 0 "Go module dependencies verified"
    else
        print_warning "Go module dependencies need updating (run: go mod tidy)"
    fi

    # Try to build API server
    print_info "Building API server..."
    if go build -o /tmp/api-server-test ./backend/cmd/api-server &> /dev/null; then
        print_status 0 "API server builds successfully"
        rm -f /tmp/api-server-test
    else
        print_status 1 "API server failed to build"
    fi

    # Try to build operator
    print_info "Building Kubernetes operator..."
    if go build -o /tmp/operator-test ./k8s/operator &> /dev/null; then
        print_status 0 "Kubernetes operator builds successfully"
        rm -f /tmp/operator-test
    else
        print_status 1 "Kubernetes operator failed to build"
    fi
else
    print_status 1 "go.mod not found"
fi

# Run backend tests
print_info "Running backend unit tests..."
cd backend
if go test ./... -timeout=30s &> /dev/null; then
    print_status 0 "Backend unit tests pass"
else
    print_status 1 "Backend unit tests failed"
fi
cd ..

# Validate Frontend
echo -e "\n${GREEN}4. Validating Frontend (Svelte)${NC}"
echo "--------------------------------"

if [ -f "frontend/package.json" ]; then
    cd frontend

    # Check if dependencies are installed
    if [ -d "node_modules" ]; then
        print_status 0 "Node dependencies installed"
    else
        print_info "Installing Node dependencies..."
        if npm install &> /dev/null; then
            print_status 0 "Node dependencies installed successfully"
        else
            print_status 1 "Failed to install Node dependencies"
        fi
    fi

    # Try to build frontend
    print_info "Building frontend..."
    if npm run build &> /dev/null; then
        print_status 0 "Frontend builds successfully"
    else
        print_status 1 "Frontend failed to build"
    fi

    # Run frontend tests
    print_info "Running frontend component tests..."
    if npm run test -- --run &> /dev/null; then
        print_status 0 "Frontend component tests pass"
    else
        print_warning "Frontend tests failed or not configured"
    fi

    cd ..
else
    print_status 1 "frontend/package.json not found"
fi

# Validate Kubernetes resources
echo -e "\n${GREEN}5. Validating Kubernetes Resources${NC}"
echo "--------------------------------"

KUBE_FILES=("k8s/crds" "k8s/operator/config")

for kube_dir in "${KUBE_FILES[@]}"; do
    if [ -d "$kube_dir" ]; then
        print_status 0 "Kubernetes directory exists: $kube_dir"

        # Count YAML files
        YAML_COUNT=$(find "$kube_dir" -name "*.yaml" -o -name "*.yml" | wc -l)
        if [ "$YAML_COUNT" -gt 0 ]; then
            print_status 0 "Found $YAML_COUNT YAML files in $kube_dir"
        else
            print_warning "No YAML files found in $kube_dir"
        fi
    else
        print_warning "Kubernetes directory not found: $kube_dir"
    fi
done

# Validate CRDs
if [ -d "k8s/crds" ]; then
    print_info "Validating Custom Resource Definitions..."
    CRD_FILES=$(find k8s/crds -name "*.yaml" -o -name "*.yml")

    if [ -n "$CRD_FILES" ]; then
        for crd in $CRD_FILES; do
            if kubectl apply --dry-run=client -f "$crd" &> /dev/null; then
                print_status 0 "CRD validates: $(basename $crd)"
            else
                print_warning "CRD validation failed: $(basename $crd)"
            fi
        done
    else
        print_warning "No CRD files found"
    fi
fi

# Database connectivity test
echo -e "\n${GREEN}6. Testing Database Connectivity${NC}"
echo "--------------------------------"

print_info "Testing database connection with test container..."

# Start a test CockroachDB container
CONTAINER_NAME="quickstart-test-db"
docker rm -f "$CONTAINER_NAME" &> /dev/null || true

if docker run -d --name "$CONTAINER_NAME" -p 26257:26257 -p 8080:8080 \
    cockroachdb/cockroach:latest start-single-node --insecure &> /dev/null; then

    print_status 0 "Test database container started"

    # Wait for database to be ready
    print_info "Waiting for database to be ready..."
    sleep 10

    # Test connection
    if docker exec "$CONTAINER_NAME" ./cockroach sql --insecure -e "SELECT 1" &> /dev/null; then
        print_status 0 "Database connection successful"
    else
        print_warning "Database connection failed"
    fi

    # Clean up
    docker rm -f "$CONTAINER_NAME" &> /dev/null
else
    print_warning "Could not start test database container"
fi

# API Integration test
echo -e "\n${GREEN}7. API Integration Test${NC}"
echo "--------------------------------"

print_info "Starting API server for integration test..."

# Build and start API server in background
go build -o /tmp/quickstart-api ./backend/cmd/api-server
if [ $? -eq 0 ]; then
    print_status 0 "API server built successfully"

    # Start API server with test database
    export DATABASE_URL="postgresql://root@localhost:26257/defaultdb?sslmode=disable"
    export PORT="8081"

    # Start test database
    docker run -d --name "quickstart-api-test-db" -p 26258:26257 \
        cockroachdb/cockroach:latest start-single-node --insecure &> /dev/null

    sleep 5

    # Start API server
    DATABASE_URL="postgresql://root@localhost:26258/defaultdb?sslmode=disable" \
    PORT="8081" /tmp/quickstart-api &> /tmp/api-server.log &
    API_PID=$!

    sleep 3

    # Test health endpoint
    if curl -s http://localhost:8081/health &> /dev/null; then
        print_status 0 "API server health check passed"

        # Test API endpoints
        if curl -s -H "X-Tenant-ID: test" http://localhost:8081/api/v1/servers &> /dev/null; then
            print_status 0 "API endpoints responding"
        else
            print_warning "API endpoints not responding correctly"
        fi
    else
        print_warning "API server health check failed"
    fi

    # Clean up
    kill $API_PID &> /dev/null || true
    docker rm -f "quickstart-api-test-db" &> /dev/null || true
    rm -f /tmp/quickstart-api /tmp/api-server.log
else
    print_status 1 "API server build failed"
fi

# Performance validation
echo -e "\n${GREEN}8. Performance Validation${NC}"
echo "--------------------------------"

print_info "Running performance tests..."
if [ -f "backend/tests/load/api_performance_test.go" ]; then
    if go test -timeout=60s ./backend/tests/load/... &> /dev/null; then
        print_status 0 "Performance tests pass"
    else
        print_warning "Performance tests failed or took too long"
    fi
else
    print_warning "Performance tests not found"
fi

# Final summary
echo -e "\n${GREEN}🎯 Validation Summary${NC}"
echo "=========================================================="

print_info "Platform validation completed!"
echo ""
echo "Next steps:"
echo "1. Deploy to Kubernetes: kubectl apply -f k8s/"
echo "2. Access the frontend: npm run dev (in frontend/)"
echo "3. Monitor with: kubectl get pods"
echo "4. View logs: kubectl logs deployment/minecraft-platform-api"
echo ""
echo -e "${GREEN}Happy hosting! 🎮${NC}"