# Contract Tests

This directory contains contract tests that validate API endpoints against the OpenAPI specification defined in `specs/001-create-a-cloud/contracts/api-spec.yaml`.

## TDD Phase 3.2 - Critical Requirements

**THESE TESTS MUST FAIL FIRST** before any implementation is written. This is a constitutional requirement for Test-Driven Development.

## Current Status: ❌ FAILING (EXPECTED)

All tests in this directory are designed to fail initially because:

1. No API endpoints are implemented yet
2. No route handlers are registered
3. No database connections exist
4. No authentication middleware is configured

**Expected Behavior**: All tests return `404 Not Found` until the corresponding endpoints are implemented.

## Test Files

### `servers_post_test.go`

**Status**: ✅ Written, ❌ Failing (as required)
**Endpoint**: `POST /servers`
**Purpose**: Validates server deployment request/response schemas
**Test Cases**:

- Valid request returns expected schema
- Missing required fields return 400 with error details
- Invalid SKU ID returns 404
- Duplicate server name returns 409
- Unauthorized request returns 401
- Invalid server properties return 400

## Running Tests

```bash
# Run all contract tests (will fail until implementation)
cd backend
go test ./tests/contract/... -v

# Run specific test file
go test ./tests/contract/servers_post_test.go -v

# Run with build tags
go test -tags=contract ./tests/contract/... -v
```

## Next Steps (Phase 3.3)

1. ❌ Tests are currently failing (Phase 3.2 complete)
2. ⏳ Implement API endpoints (Phase 3.3)
3. ⏳ Watch tests turn green (RED → GREEN)
4. ⏳ Refactor implementation (GREEN → REFACTOR)

## Constitutional Compliance

✅ **TDD Order**: Tests written before implementation
✅ **Real Dependencies**: Tests will use Testcontainers for database
✅ **Contract Validation**: OpenAPI schema enforcement
✅ **Failure First**: All tests designed to fail initially

## Schema Validation

These tests validate against the OpenAPI specification:

- Request schema validation (required fields, types, constraints)
- Response schema validation (structure, field types, relationships)
- Error response schema validation (consistent error format)
- HTTP status code validation (correct codes for each scenario)
