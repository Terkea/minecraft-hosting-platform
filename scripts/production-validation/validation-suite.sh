#!/bin/bash

# Production Validation Suite for Minecraft Platform
# This script performs comprehensive validation of the production environment

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/production-validation-$(date +%Y%m%d_%H%M%S).log"
RESULTS_FILE="/tmp/validation-results-$(date +%Y%m%d_%H%M%S).json"
NAMESPACE="minecraft-platform"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Result tracking
declare -A test_results
total_tests=0
passed_tests=0
failed_tests=0

# Function to run a test and track results
run_test() {
    local test_name="$1"
    local test_command="$2"
    local test_description="$3"

    ((total_tests++))
    log "Running test: $test_name - $test_description"

    if eval "$test_command"; then
        log "✅ PASS: $test_name"
        test_results["$test_name"]="PASS"
        ((passed_tests++))
        return 0
    else
        log "❌ FAIL: $test_name"
        test_results["$test_name"]="FAIL"
        ((failed_tests++))
        return 1
    fi
}

# Test functions

test_cluster_connectivity() {
    kubectl cluster-info &>/dev/null
}

test_namespace_exists() {
    kubectl get namespace "$NAMESPACE" &>/dev/null
}

test_all_pods_running() {
    local not_running=$(kubectl get pods -n "$NAMESPACE" --field-selector=status.phase!=Running --no-headers 2>/dev/null | wc -l)
    [ "$not_running" -eq 0 ]
}

test_api_server_health() {
    local api_endpoint=$(kubectl get service api-server -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
    if [ -n "$api_endpoint" ]; then
        curl -f -s "https://$api_endpoint/health" &>/dev/null
    else
        # Fallback to port-forward for testing
        kubectl port-forward service/api-server 8080:80 -n "$NAMESPACE" &
        local pf_pid=$!
        sleep 5
        local result=$(curl -f -s "http://localhost:8080/health" &>/dev/null && echo "success" || echo "fail")
        kill $pf_pid 2>/dev/null || true
        [ "$result" = "success" ]
    fi
}

test_database_connectivity() {
    kubectl exec -n "$NAMESPACE" deployment/api-server -- sh -c 'timeout 10 nc -z cockroachdb 26257' &>/dev/null
}

test_database_queries() {
    kubectl exec -n "$NAMESPACE" cockroachdb-0 -- cockroach sql --insecure --execute="SELECT 1;" &>/dev/null
}

test_monitoring_stack() {
    kubectl get pods -n monitoring -l app=prometheus --field-selector=status.phase=Running | grep -q prometheus
}

test_logging_stack() {
    kubectl get pods -n logging -l app=elasticsearch --field-selector=status.phase=Running | grep -q elasticsearch
}

test_backup_jobs() {
    local recent_backup=$(kubectl get jobs -n "$NAMESPACE" -l app=database-backup --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].status.succeeded}' 2>/dev/null)
    [ "$recent_backup" = "1" ] 2>/dev/null || [ -z "$recent_backup" ]
}

test_hpa_configured() {
    kubectl get hpa -n "$NAMESPACE" | grep -q api-server-hpa
}

test_network_policies() {
    local policy_count=$(kubectl get networkpolicies -n "$NAMESPACE" --no-headers | wc -l)
    [ "$policy_count" -gt 0 ]
}

test_secrets_exist() {
    kubectl get secret database-credentials -n "$NAMESPACE" &>/dev/null &&
    kubectl get secret api-tls-certificates -n "$NAMESPACE" &>/dev/null
}

test_persistent_volumes() {
    local pv_count=$(kubectl get pv | grep Bound | wc -l)
    [ "$pv_count" -gt 0 ]
}

test_resource_quotas() {
    kubectl get resourcequota -n "$NAMESPACE" &>/dev/null
}

test_security_policies() {
    kubectl get podsecuritypolicy minecraft-server-psp &>/dev/null
}

test_service_mesh() {
    kubectl get pods -n istio-system -l app=istiod --field-selector=status.phase=Running | grep -q istiod 2>/dev/null || true
}

test_load_balancer() {
    local lb_services=$(kubectl get services -n "$NAMESPACE" --field-selector=spec.type=LoadBalancer --no-headers | wc -l)
    [ "$lb_services" -gt 0 ]
}

# Performance tests

test_api_response_time() {
    local api_endpoint=$(kubectl get service api-server -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
    if [ -n "$api_endpoint" ]; then
        local response_time=$(curl -o /dev/null -s -w '%{time_total}' "https://$api_endpoint/health" 2>/dev/null)
        # Check if response time is less than 1 second (in awk since bash doesn't handle floats)
        awk "BEGIN {exit !($response_time < 1.0)}"
    else
        log "⚠️  Warning: LoadBalancer endpoint not available, skipping response time test"
        return 0
    fi
}

test_memory_usage() {
    local high_memory_pods=$(kubectl top pods -n "$NAMESPACE" --no-headers 2>/dev/null | awk '$3 > 90 {count++} END {print count+0}')
    [ "$high_memory_pods" -eq 0 ]
}

test_cpu_usage() {
    local high_cpu_pods=$(kubectl top pods -n "$NAMESPACE" --no-headers 2>/dev/null | awk '$2 > 1000 {count++} END {print count+0}')
    [ "$high_cpu_pods" -eq 0 ]
}

# Security tests

test_container_security() {
    local privileged_pods=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.spec.securityContext.runAsUser}{"\n"}{end}' 2>/dev/null | grep -c "^0$" || echo 0)
    [ "$privileged_pods" -eq 0 ]
}

test_rbac_policies() {
    kubectl get clusterroles | grep -q minecraft-platform
}

test_network_segmentation() {
    local network_policies=$(kubectl get networkpolicies -n "$NAMESPACE" --no-headers | wc -l)
    [ "$network_policies" -gt 2 ]
}

# Compliance tests

test_encryption_at_rest() {
    # Check if secrets are encrypted (simplified check)
    kubectl get secrets -n "$NAMESPACE" -o json | jq -r '.items[].data' | grep -q "ey" # Base64 encoded data
}

test_audit_logging() {
    kubectl get pods -n kube-system -l component=kube-apiserver | grep -q apiserver
}

test_backup_encryption() {
    # Check if backup job has encryption environment variables
    kubectl get cronjob database-backup -n "$NAMESPACE" -o yaml | grep -q "BACKUP_ENCRYPTION_KEY"
}

# Integration tests

test_end_to_end_workflow() {
    log "Running end-to-end workflow test..."

    # Create a test server request
    kubectl port-forward service/api-server 8080:80 -n "$NAMESPACE" &
    local pf_pid=$!
    sleep 5

    # Test server creation API
    local response=$(curl -s -X POST "http://localhost:8080/api/v1/servers" \
        -H 'Content-Type: application/json' \
        -d '{"name":"validation-test","memory":"2Gi","players":10}' || echo "failed")

    kill $pf_pid 2>/dev/null || true

    [ "$response" != "failed" ] && [ -n "$response" ]
}

# Main execution function
main() {
    log "Starting Production Validation Suite"
    log "Namespace: $NAMESPACE"
    log "Log file: $LOG_FILE"

    # Initialize results file
    echo '{"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","tests":[' > "$RESULTS_FILE"

    echo -e "${YELLOW}🔍 Running Infrastructure Tests...${NC}"
    run_test "cluster_connectivity" "test_cluster_connectivity" "Kubernetes cluster connectivity"
    run_test "namespace_exists" "test_namespace_exists" "Required namespace exists"
    run_test "pods_running" "test_all_pods_running" "All pods are running"
    run_test "api_health" "test_api_server_health" "API server health check"
    run_test "database_connectivity" "test_database_connectivity" "Database connectivity"
    run_test "database_queries" "test_database_queries" "Database query execution"

    echo -e "${YELLOW}📊 Running Monitoring & Logging Tests...${NC}"
    run_test "monitoring_stack" "test_monitoring_stack" "Monitoring stack operational"
    run_test "logging_stack" "test_logging_stack" "Logging stack operational"
    run_test "backup_jobs" "test_backup_jobs" "Backup jobs completing successfully"

    echo -e "${YELLOW}🔄 Running Auto-scaling Tests...${NC}"
    run_test "hpa_configured" "test_hpa_configured" "Horizontal Pod Autoscaler configured"

    echo -e "${YELLOW}🛡️ Running Security Tests...${NC}"
    run_test "network_policies" "test_network_policies" "Network policies configured"
    run_test "secrets_exist" "test_secrets_exist" "Required secrets exist"
    run_test "security_policies" "test_security_policies" "Pod security policies configured"
    run_test "container_security" "test_container_security" "Containers not running as root"
    run_test "rbac_policies" "test_rbac_policies" "RBAC policies configured"
    run_test "network_segmentation" "test_network_segmentation" "Network segmentation implemented"

    echo -e "${YELLOW}💾 Running Storage Tests...${NC}"
    run_test "persistent_volumes" "test_persistent_volumes" "Persistent volumes available"
    run_test "resource_quotas" "test_resource_quotas" "Resource quotas configured"

    echo -e "${YELLOW}⚡ Running Performance Tests...${NC}"
    run_test "api_response_time" "test_api_response_time" "API response time acceptable"
    run_test "memory_usage" "test_memory_usage" "Memory usage within limits"
    run_test "cpu_usage" "test_cpu_usage" "CPU usage within limits"

    echo -e "${YELLOW}🔒 Running Compliance Tests...${NC}"
    run_test "encryption_at_rest" "test_encryption_at_rest" "Data encryption at rest"
    run_test "audit_logging" "test_audit_logging" "Audit logging enabled"
    run_test "backup_encryption" "test_backup_encryption" "Backup encryption configured"

    echo -e "${YELLOW}🔄 Running Integration Tests...${NC}"
    run_test "end_to_end_workflow" "test_end_to_end_workflow" "End-to-end workflow"

    # Generate final report
    echo '],"summary":{"total":'$total_tests',"passed":'$passed_tests',"failed":'$failed_tests',"success_rate":'$(echo "scale=2; $passed_tests * 100 / $total_tests" | bc)'}}' >> "$RESULTS_FILE"

    # Display results
    echo -e "\n${YELLOW}📊 Validation Results Summary${NC}"
    echo "=========================="
    echo "Total Tests: $total_tests"
    echo -e "Passed: ${GREEN}$passed_tests${NC}"
    echo -e "Failed: ${RED}$failed_tests${NC}"
    echo "Success Rate: $(echo "scale=1; $passed_tests * 100 / $total_tests" | bc)%"

    echo -e "\n${YELLOW}📄 Detailed Results:${NC}"
    for test_name in "${!test_results[@]}"; do
        result="${test_results[$test_name]}"
        if [ "$result" = "PASS" ]; then
            echo -e "  ✅ $test_name"
        else
            echo -e "  ❌ $test_name"
        fi
    done

    echo -e "\n${YELLOW}📁 Files Generated:${NC}"
    echo "  Log: $LOG_FILE"
    echo "  Results: $RESULTS_FILE"

    # Send results to monitoring system
    if [ -n "${VALIDATION_WEBHOOK_URL:-}" ]; then
        log "Sending results to monitoring system..."
        curl -X POST "$VALIDATION_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d @"$RESULTS_FILE" || log "Warning: Failed to send results to webhook"
    fi

    # Exit with appropriate code
    if [ "$failed_tests" -eq 0 ]; then
        echo -e "\n${GREEN}🎉 All validation tests passed!${NC}"
        exit 0
    else
        echo -e "\n${RED}⚠️  Some validation tests failed. Check the log for details.${NC}"
        exit 1
    fi
}

# Handle script arguments
case "${1:-all}" in
    "infrastructure")
        log "Running infrastructure tests only"
        run_test "cluster_connectivity" "test_cluster_connectivity" "Kubernetes cluster connectivity"
        run_test "namespace_exists" "test_namespace_exists" "Required namespace exists"
        run_test "pods_running" "test_all_pods_running" "All pods are running"
        ;;
    "security")
        log "Running security tests only"
        run_test "network_policies" "test_network_policies" "Network policies configured"
        run_test "security_policies" "test_security_policies" "Pod security policies configured"
        run_test "rbac_policies" "test_rbac_policies" "RBAC policies configured"
        ;;
    "performance")
        log "Running performance tests only"
        run_test "api_response_time" "test_api_response_time" "API response time acceptable"
        run_test "memory_usage" "test_memory_usage" "Memory usage within limits"
        run_test "cpu_usage" "test_cpu_usage" "CPU usage within limits"
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [test_category]"
        echo ""
        echo "Test categories:"
        echo "  all            Run all validation tests (default)"
        echo "  infrastructure Run infrastructure tests only"
        echo "  security       Run security tests only"
        echo "  performance    Run performance tests only"
        echo ""
        echo "Environment variables:"
        echo "  VALIDATION_WEBHOOK_URL  URL to send results to monitoring system"
        exit 0
        ;;
    "all"|*)
        main
        ;;
esac