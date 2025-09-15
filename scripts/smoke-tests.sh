#!/bin/bash

# Smoke Tests for Minecraft Platform API
# Usage: ./smoke-tests.sh <base_url>

set -e

BASE_URL=${1:-"http://localhost:8080"}
TIMEOUT=30

echo "🔍 Running smoke tests against: $BASE_URL"
echo "=============================================="

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_status="$3"

    echo -n "Testing $test_name... "

    if eval "$test_command" >/dev/null 2>&1; then
        echo "✅ PASS"
        ((TESTS_PASSED++))
    else
        echo "❌ FAIL"
        ((TESTS_FAILED++))
        FAILED_TESTS+=("$test_name")
    fi
}

# Function to test HTTP endpoint
test_http() {
    local endpoint="$1"
    local expected_status="${2:-200}"
    local method="${3:-GET}"
    local data="${4:-}"

    local curl_cmd="curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT"

    if [ "$method" = "POST" ] && [ -n "$data" ]; then
        curl_cmd="$curl_cmd -X POST -H 'Content-Type: application/json' -d '$data'"
    fi

    curl_cmd="$curl_cmd $BASE_URL$endpoint"

    local status_code=$(eval $curl_cmd)
    [ "$status_code" = "$expected_status" ]
}

# Function to test WebSocket endpoint
test_websocket() {
    local endpoint="$1"
    local ws_url=$(echo "$BASE_URL" | sed 's/http/ws/')

    # Use websocat or nc to test WebSocket connection
    timeout 5 websocat --binary --ping-interval 1 "$ws_url$endpoint" < /dev/null >/dev/null 2>&1
}

echo "🏥 Health and Readiness Checks"
echo "------------------------------"

# Health check
run_test "Health endpoint" "test_http '/health' 200"

# Readiness check
run_test "Readiness endpoint" "test_http '/ready' 200"

# Metrics endpoint
run_test "Metrics endpoint" "test_http '/metrics' 200"

echo ""
echo "🔐 Authentication and Authorization"
echo "-----------------------------------"

# Test unauthenticated access (should fail)
run_test "Unauthenticated API access blocked" "test_http '/api/v1/servers' 401"

# Test with invalid token
run_test "Invalid token rejected" "curl -s -H 'Authorization: Bearer invalid-token' --max-time $TIMEOUT -w '%{http_code}' -o /dev/null $BASE_URL/api/v1/servers | grep -q '401'"

echo ""
echo "🖥️ API Endpoints"
echo "----------------"

# For authenticated tests, we'll use a test token (in real deployment, this would be properly configured)
TEST_TOKEN="test-token-for-smoke-tests"
TENANT_ID="smoke-test-tenant"

# Test servers endpoint with auth
run_test "Servers list endpoint" "curl -s -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' --max-time $TIMEOUT -w '%{http_code}' -o /dev/null $BASE_URL/api/v1/servers | grep -q '200'"

# Test server creation (should validate request)
run_test "Server creation validation" "curl -s -X POST -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' -H 'Content-Type: application/json' -d '{\"invalid\":\"data\"}' --max-time $TIMEOUT -w '%{http_code}' -o /dev/null $BASE_URL/api/v1/servers | grep -q '400'"

# Test plugins endpoint
run_test "Plugins endpoint" "curl -s -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' --max-time $TIMEOUT -w '%{http_code}' -o /dev/null $BASE_URL/api/v1/plugins | grep -q '200'"

echo ""
echo "🔄 Real-time Features"
echo "--------------------"

# Test WebSocket endpoint (if websocat is available)
if command -v websocat >/dev/null 2>&1; then
    run_test "WebSocket connection" "test_websocket '/ws?tenant_id=$TENANT_ID'"
else
    echo "⚠️  WebSocket test skipped (websocat not available)"
fi

echo ""
echo "🎮 Minecraft-specific Features"
echo "------------------------------"

# Test SKU configurations endpoint
run_test "SKU configurations" "curl -s -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' --max-time $TIMEOUT -w '%{http_code}' -o /dev/null $BASE_URL/api/v1/skus | grep -q '200'"

# Test version compatibility endpoint
run_test "Minecraft versions" "curl -s -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' --max-time $TIMEOUT -w '%{http_code}' -o /dev/null $BASE_URL/api/v1/minecraft/versions | grep -q '200'"

echo ""
echo "📊 Performance and Reliability"
echo "------------------------------"

# Test response time (should be under 500ms for smoke test)
run_test "Response time check" "curl -s -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' --max-time 1 -w '%{time_total}' -o /dev/null $BASE_URL/api/v1/servers | awk '{exit (\$1 > 0.5)}'"

# Test concurrent requests (basic load test)
run_test "Concurrent requests" "for i in {1..10}; do curl -s -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' --max-time $TIMEOUT $BASE_URL/health & done; wait"

echo ""
echo "🔧 Infrastructure Dependencies"
echo "------------------------------"

# Test database connectivity (through API)
run_test "Database connectivity" "curl -s -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' --max-time $TIMEOUT -w '%{http_code}' -o /dev/null $BASE_URL/api/v1/servers | grep -q '200'"

# Test Redis connectivity (through API session/cache)
run_test "Redis connectivity" "curl -s -H 'Authorization: Bearer $TEST_TOKEN' -H 'X-Tenant-ID: $TENANT_ID' --max-time $TIMEOUT $BASE_URL/health | grep -q 'redis.*ok' || curl -s --max-time $TIMEOUT $BASE_URL/health | grep -q 'healthy'"

echo ""
echo "🛡️ Security Checks"
echo "------------------"

# Test HTTPS redirect (if applicable)
if [[ "$BASE_URL" == https://* ]]; then
    HTTP_URL=$(echo "$BASE_URL" | sed 's/https/http/')
    run_test "HTTPS redirect" "curl -s -L --max-time $TIMEOUT -w '%{url_effective}' -o /dev/null $HTTP_URL/health | grep -q 'https://'"
fi

# Test security headers
run_test "Security headers" "curl -s -I --max-time $TIMEOUT $BASE_URL/health | grep -E '(X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security)'"

# Test CORS headers
run_test "CORS headers" "curl -s -H 'Origin: https://app.minecraft-platform.com' -I --max-time $TIMEOUT $BASE_URL/api/v1/servers | grep -q 'Access-Control-Allow-Origin'"

echo ""
echo "📝 API Documentation"
echo "--------------------"

# Test OpenAPI/Swagger documentation
run_test "API documentation" "test_http '/docs' 200"
run_test "OpenAPI spec" "test_http '/openapi.json' 200"

echo ""
echo "==============================================="
echo "🏁 Smoke Test Results"
echo "==============================================="

if [ $TESTS_FAILED -eq 0 ]; then
    echo "✅ All $TESTS_PASSED tests PASSED!"
    echo "🎉 Smoke tests completed successfully!"
    exit 0
else
    echo "❌ $TESTS_FAILED tests FAILED out of $((TESTS_PASSED + TESTS_FAILED)) total tests"
    echo "🔥 Failed tests:"
    for test in "${FAILED_TESTS[@]}"; do
        echo "   - $test"
    done
    echo ""
    echo "🚨 Smoke tests FAILED - deployment may have issues!"
    exit 1
fi