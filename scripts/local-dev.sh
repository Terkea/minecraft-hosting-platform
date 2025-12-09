#!/bin/bash
# Local Development Environment Setup for Minecraft Hosting Platform
# Requires: minikube, kubectl, docker

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    local missing=()

    command -v minikube >/dev/null 2>&1 || missing+=("minikube")
    command -v kubectl >/dev/null 2>&1 || missing+=("kubectl")
    command -v docker >/dev/null 2>&1 || missing+=("docker")
    command -v go >/dev/null 2>&1 || missing+=("go")

    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing[*]}"
        exit 1
    fi

    log_success "All prerequisites found"
}

# Start minikube if not running
start_minikube() {
    log_info "Checking minikube status..."

    if minikube status | grep -q "Running"; then
        log_success "Minikube is already running"
    else
        log_info "Starting minikube..."
        minikube start --memory=8192 --cpus=4 --driver=docker
        log_success "Minikube started"
    fi

    # Point docker to minikube's docker daemon
    eval $(minikube docker-env)
    log_success "Docker configured to use minikube"
}

# Build Docker images
build_images() {
    log_info "Building Docker images..."

    # Build operator image
    log_info "Building operator image..."
    cd "$PROJECT_ROOT/k8s/operator"
    docker build -t minecraft-platform-operator:latest .

    # Build API server image (if Dockerfile exists)
    if [ -f "$PROJECT_ROOT/backend/Dockerfile" ]; then
        log_info "Building API server image..."
        cd "$PROJECT_ROOT/backend"
        docker build -t minecraft-platform-api:latest .
    else
        log_warn "No backend Dockerfile found, skipping API server image build"
    fi

    cd "$PROJECT_ROOT"
    log_success "Docker images built"
}

# Install CRDs
install_crds() {
    log_info "Installing CRDs..."
    kubectl apply -f "$PROJECT_ROOT/k8s/operator/config/crd/"
    log_success "CRDs installed"
}

# Deploy infrastructure
deploy_infrastructure() {
    log_info "Deploying infrastructure..."

    # Create namespaces first
    kubectl apply -f "$PROJECT_ROOT/k8s/manifests/dev/namespace.yaml"

    # Deploy CockroachDB
    kubectl apply -f "$PROJECT_ROOT/k8s/manifests/dev/cockroachdb.yaml"

    # Deploy Redis
    kubectl apply -f "$PROJECT_ROOT/k8s/manifests/dev/redis.yaml"

    # Wait for CockroachDB to be ready
    log_info "Waiting for CockroachDB to be ready..."
    kubectl wait --for=condition=ready pod -l app=cockroachdb -n minecraft-system --timeout=300s || true

    # Wait for database init job
    log_info "Waiting for database initialization..."
    sleep 10
    kubectl wait --for=condition=complete job/cockroachdb-init -n minecraft-system --timeout=120s || true

    log_success "Infrastructure deployed"
}

# Deploy operator
deploy_operator() {
    log_info "Deploying operator..."
    kubectl apply -f "$PROJECT_ROOT/k8s/manifests/dev/operator.yaml"

    log_info "Waiting for operator to be ready..."
    kubectl wait --for=condition=available deployment/minecraft-operator -n minecraft-system --timeout=120s || true

    log_success "Operator deployed"
}

# Deploy API server
deploy_api_server() {
    log_info "Deploying API server..."
    kubectl apply -f "$PROJECT_ROOT/k8s/manifests/dev/api-server.yaml"

    log_info "Waiting for API server to be ready..."
    kubectl wait --for=condition=available deployment/api-server -n minecraft-system --timeout=120s || true

    log_success "API server deployed"
}

# Show status
show_status() {
    log_info "Current status:"
    echo ""
    echo "=== Pods ==="
    kubectl get pods -n minecraft-system
    echo ""
    echo "=== Services ==="
    kubectl get svc -n minecraft-system
    echo ""
    echo "=== MinecraftServers ==="
    kubectl get minecraftservers -A 2>/dev/null || echo "No MinecraftServers found"
    echo ""
}

# Port forward for local access
port_forward() {
    log_info "Setting up port forwarding..."

    # Kill any existing port-forwards
    pkill -f "kubectl port-forward" 2>/dev/null || true

    # API Server
    kubectl port-forward svc/api-server 8080:8080 -n minecraft-system &
    log_info "API Server: http://localhost:8080"

    # CockroachDB UI
    kubectl port-forward svc/cockroachdb 8081:8080 -n minecraft-system &
    log_info "CockroachDB UI: http://localhost:8081"

    log_success "Port forwarding configured"
}

# Create example server
create_example_server() {
    log_info "Creating example Minecraft server..."
    kubectl apply -f "$PROJECT_ROOT/k8s/manifests/dev/example-server.yaml"
    log_success "Example server created. Check status with: kubectl get minecraftservers -n minecraft-servers"
}

# Teardown
teardown() {
    log_info "Tearing down local development environment..."

    # Delete example server
    kubectl delete -f "$PROJECT_ROOT/k8s/manifests/dev/example-server.yaml" 2>/dev/null || true

    # Delete deployments
    kubectl delete -f "$PROJECT_ROOT/k8s/manifests/dev/api-server.yaml" 2>/dev/null || true
    kubectl delete -f "$PROJECT_ROOT/k8s/manifests/dev/operator.yaml" 2>/dev/null || true
    kubectl delete -f "$PROJECT_ROOT/k8s/manifests/dev/redis.yaml" 2>/dev/null || true
    kubectl delete -f "$PROJECT_ROOT/k8s/manifests/dev/cockroachdb.yaml" 2>/dev/null || true

    # Delete CRDs
    kubectl delete -f "$PROJECT_ROOT/k8s/operator/config/crd/" 2>/dev/null || true

    # Delete namespaces
    kubectl delete -f "$PROJECT_ROOT/k8s/manifests/dev/namespace.yaml" 2>/dev/null || true

    # Kill port forwards
    pkill -f "kubectl port-forward" 2>/dev/null || true

    log_success "Teardown complete"
}

# Print usage
usage() {
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  up          Start the local development environment"
    echo "  down        Tear down the local development environment"
    echo "  status      Show current status"
    echo "  build       Build Docker images only"
    echo "  deploy      Deploy all components (assumes minikube is running)"
    echo "  example     Create an example Minecraft server"
    echo "  forward     Set up port forwarding"
    echo "  logs        Show operator logs"
    echo ""
}

# Main
case "${1:-}" in
    up)
        check_prerequisites
        start_minikube
        build_images
        install_crds
        deploy_infrastructure
        deploy_operator
        # deploy_api_server  # Uncomment when API server Dockerfile is ready
        show_status
        port_forward
        echo ""
        log_success "Local development environment is ready!"
        echo ""
        echo "Next steps:"
        echo "  1. Create a test server: $0 example"
        echo "  2. Check status: $0 status"
        echo "  3. View operator logs: $0 logs"
        ;;
    down)
        teardown
        ;;
    status)
        show_status
        ;;
    build)
        eval $(minikube docker-env)
        build_images
        ;;
    deploy)
        eval $(minikube docker-env)
        install_crds
        deploy_infrastructure
        deploy_operator
        show_status
        ;;
    example)
        create_example_server
        ;;
    forward)
        port_forward
        ;;
    logs)
        kubectl logs -f deployment/minecraft-operator -n minecraft-system
        ;;
    *)
        usage
        exit 1
        ;;
esac
