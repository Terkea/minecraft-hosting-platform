#!/bin/bash

# Minecraft Platform Disaster Recovery Procedures
# Version: 1.0
# Last Updated: 2024-01-01

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/dr-config.yaml"
LOG_FILE="/tmp/disaster-recovery-$(date +%Y%m%d_%H%M%S).log"

# Logging functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" | tee -a "$LOG_FILE" >&2
}

log_success() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $1" | tee -a "$LOG_FILE"
}

# Disaster recovery functions

# Function: Check system status and prerequisites
check_prerequisites() {
    log "Checking disaster recovery prerequisites..."

    # Check kubectl access
    if ! kubectl cluster-info &>/dev/null; then
        log_error "kubectl cannot access Kubernetes cluster"
        return 1
    fi

    # Check required namespaces
    for ns in minecraft-platform monitoring logging; do
        if ! kubectl get namespace "$ns" &>/dev/null; then
            log_error "Namespace '$ns' not found"
            return 1
        fi
    done

    # Check backup storage access
    if ! aws s3 ls s3://minecraft-platform-backups-primary/ &>/dev/null; then
        log_error "Cannot access primary backup storage"
        return 1
    fi

    # Check secondary storage access
    if ! aws s3 ls s3://minecraft-platform-backups-secondary/ --region us-east-1 &>/dev/null; then
        log_error "Cannot access secondary backup storage"
        return 1
    fi

    log_success "All prerequisites check passed"
    return 0
}

# Function: Database disaster recovery
recover_database() {
    local backup_name="$1"
    local target_environment="${2:-disaster-recovery}"

    log "Starting database recovery with backup: $backup_name"

    # Download backup from storage
    log "Downloading database backup..."
    aws s3 cp "s3://minecraft-platform-backups-primary/database/${backup_name}.dump.gpg" \
        "/tmp/${backup_name}.dump.gpg"

    # Verify backup integrity
    if ! aws s3 cp "s3://minecraft-platform-backups-primary/database/${backup_name}.metadata.json" \
        "/tmp/${backup_name}.metadata.json"; then
        log_error "Cannot download backup metadata"
        return 1
    fi

    # Decrypt backup
    log "Decrypting database backup..."
    gpg --quiet --batch --yes --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" \
        "/tmp/${backup_name}.dump.gpg" > "/tmp/${backup_name}.dump"

    # Verify checksum
    local expected_checksum=$(jq -r '.checksum' "/tmp/${backup_name}.metadata.json")
    local actual_checksum=$(sha256sum "/tmp/${backup_name}.dump.gpg" | cut -d' ' -f1)

    if [ "$expected_checksum" != "$actual_checksum" ]; then
        log_error "Backup checksum verification failed"
        return 1
    fi

    # Create new database instance for recovery
    log "Creating recovery database instance..."
    kubectl apply -f - << EOF
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: minecraft-db-recovery
  namespace: minecraft-platform
spec:
  instances: 3
  primaryUpdateStrategy: unsupervised
  postgresql:
    parameters:
      max_connections: "200"
      shared_buffers: "256MB"
      effective_cache_size: "1GB"
  bootstrap:
    initdb:
      database: minecraft_platform
      owner: minecraft_user
      secret:
        name: database-credentials
  storage:
    size: 1Ti
    storageClass: fast-ssd
EOF

    # Wait for database to be ready
    log "Waiting for recovery database to be ready..."
    kubectl wait --for=condition=Ready cluster/minecraft-db-recovery -n minecraft-platform --timeout=600s

    # Restore database from backup
    log "Restoring database from backup..."
    kubectl exec -n minecraft-platform minecraft-db-recovery-1 -- \
        pg_restore -d minecraft_platform -v --clean --if-exists \
        "/tmp/${backup_name}.dump"

    # Verify restoration
    log "Verifying database restoration..."
    local table_count=$(kubectl exec -n minecraft-platform minecraft-db-recovery-1 -- \
        psql -d minecraft_platform -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')

    local expected_tables=$(jq -r '.tables_count' "/tmp/${backup_name}.metadata.json")

    if [ "$table_count" -ne "$expected_tables" ]; then
        log_error "Database restoration verification failed: expected $expected_tables tables, got $table_count"
        return 1
    fi

    log_success "Database recovery completed successfully"
    return 0
}

# Function: Restore persistent volumes from snapshots
restore_volumes() {
    local snapshot_timestamp="$1"

    log "Starting volume restoration from snapshots: $snapshot_timestamp"

    # Get all snapshots from the specified timestamp
    local snapshots=$(kubectl get volumesnapshots -n minecraft-platform \
        -l backup-timestamp="$snapshot_timestamp" \
        -o jsonpath='{.items[*].metadata.name}')

    if [ -z "$snapshots" ]; then
        log_error "No snapshots found for timestamp: $snapshot_timestamp"
        return 1
    fi

    # Restore each volume from snapshot
    for snapshot in $snapshots; do
        local pvc_name=$(kubectl get volumesnapshot "$snapshot" -n minecraft-platform \
            -o jsonpath='{.metadata.labels.source-pvc}')
        local restore_pvc_name="${pvc_name}-restored-$(date +%s)"

        log "Restoring PVC '$pvc_name' from snapshot '$snapshot'"

        # Create PVC from snapshot
        kubectl apply -f - << EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $restore_pvc_name
  namespace: minecraft-platform
spec:
  dataSource:
    name: $snapshot
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  storageClassName: fast-ssd
EOF

        # Wait for PVC to be bound
        kubectl wait --for=condition=Bound pvc/"$restore_pvc_name" -n minecraft-platform --timeout=300s

        log_success "PVC '$restore_pvc_name' restored from snapshot"
    done

    log_success "Volume restoration completed"
    return 0
}

# Function: Full platform recovery
full_platform_recovery() {
    local backup_timestamp="$1"

    log "Starting full platform disaster recovery for timestamp: $backup_timestamp"

    # Step 1: Check prerequisites
    if ! check_prerequisites; then
        log_error "Prerequisites check failed, aborting recovery"
        return 1
    fi

    # Step 2: Find the most recent complete backup set
    local database_backup="database_backup_${backup_timestamp}"

    # Step 3: Recover database
    if ! recover_database "$database_backup"; then
        log_error "Database recovery failed"
        return 1
    fi

    # Step 4: Restore volumes
    if ! restore_volumes "$backup_timestamp"; then
        log_error "Volume restoration failed"
        return 1
    fi

    # Step 5: Redeploy application components
    log "Redeploying application components..."
    kubectl apply -f "${SCRIPT_DIR}/../k8s/environments/production/"

    # Step 6: Wait for services to be ready
    log "Waiting for services to be ready..."
    kubectl wait --for=condition=Available deployment/api-server -n minecraft-platform --timeout=600s
    kubectl wait --for=condition=Available deployment/minecraft-operator -n minecraft-platform --timeout=600s
    kubectl wait --for=condition=Available deployment/frontend -n minecraft-platform --timeout=600s

    # Step 7: Verify system health
    log "Verifying system health..."
    if ! verify_system_health; then
        log_error "System health verification failed"
        return 1
    fi

    # Step 8: Send recovery completion notification
    curl -X POST "$DISASTER_RECOVERY_WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"type\": \"disaster_recovery_complete\",
            \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
            \"backup_timestamp\": \"$backup_timestamp\",
            \"recovery_duration\": \"$(( $(date +%s) - $RECOVERY_START_TIME ))s\",
            \"status\": \"success\"
        }"

    log_success "Full platform disaster recovery completed successfully"
    return 0
}

# Function: Verify system health after recovery
verify_system_health() {
    log "Performing post-recovery health checks..."

    # Check API server health
    if ! kubectl exec -n minecraft-platform deployment/api-server -- \
        curl -f http://localhost:8080/health; then
        log_error "API server health check failed"
        return 1
    fi

    # Check database connectivity
    if ! kubectl exec -n minecraft-platform minecraft-db-recovery-1 -- \
        pg_isready; then
        log_error "Database connectivity check failed"
        return 1
    fi

    # Check essential services
    for service in api-server minecraft-operator frontend; do
        if ! kubectl get pods -n minecraft-platform -l app="$service" \
            --field-selector=status.phase=Running | grep -q Running; then
            log_error "Service '$service' is not running properly"
            return 1
        fi
    done

    # Test basic API functionality
    local api_test_result=$(kubectl exec -n minecraft-platform deployment/api-server -- \
        curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/v1/health)

    if [ "$api_test_result" != "200" ]; then
        log_error "API functionality test failed with status: $api_test_result"
        return 1
    fi

    log_success "All health checks passed"
    return 0
}

# Function: Test disaster recovery procedures (dry run)
test_disaster_recovery() {
    log "Starting disaster recovery test (dry run)..."

    # Create test namespace
    kubectl create namespace minecraft-platform-dr-test --dry-run=client -o yaml | kubectl apply -f -

    # Get latest backup for testing
    local latest_backup=$(aws s3 ls s3://minecraft-platform-backups-primary/database/ \
        --recursive | sort | tail -n 1 | awk '{print $4}' | sed 's/.dump.gpg$//' | sed 's/database\///')

    if [ -z "$latest_backup" ]; then
        log_error "No backup found for testing"
        return 1
    fi

    log "Testing with backup: $latest_backup"

    # Test backup download and decryption
    log "Testing backup download and decryption..."
    aws s3 cp "s3://minecraft-platform-backups-primary/database/${latest_backup}.dump.gpg" \
        "/tmp/test-${latest_backup}.dump.gpg"

    gpg --quiet --batch --yes --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" \
        "/tmp/test-${latest_backup}.dump.gpg" > "/tmp/test-${latest_backup}.dump"

    # Verify backup integrity
    pg_restore --list "/tmp/test-${latest_backup}.dump" > /dev/null

    # Clean up test files
    rm -f "/tmp/test-${latest_backup}.dump.gpg" "/tmp/test-${latest_backup}.dump"

    # Clean up test namespace
    kubectl delete namespace minecraft-platform-dr-test --ignore-not-found

    log_success "Disaster recovery test completed successfully"
    return 0
}

# Main execution
main() {
    local action="$1"
    RECOVERY_START_TIME=$(date +%s)

    case "$action" in
        "check")
            check_prerequisites
            ;;
        "test")
            test_disaster_recovery
            ;;
        "recover-database")
            if [ $# -ne 2 ]; then
                log_error "Usage: $0 recover-database <backup_name>"
                exit 1
            fi
            recover_database "$2"
            ;;
        "recover-volumes")
            if [ $# -ne 2 ]; then
                log_error "Usage: $0 recover-volumes <snapshot_timestamp>"
                exit 1
            fi
            restore_volumes "$2"
            ;;
        "full-recovery")
            if [ $# -ne 2 ]; then
                log_error "Usage: $0 full-recovery <backup_timestamp>"
                exit 1
            fi
            full_platform_recovery "$2"
            ;;
        *)
            echo "Usage: $0 {check|test|recover-database|recover-volumes|full-recovery}"
            echo ""
            echo "Commands:"
            echo "  check                     - Check disaster recovery prerequisites"
            echo "  test                      - Test disaster recovery procedures (dry run)"
            echo "  recover-database <name>   - Recover database from specific backup"
            echo "  recover-volumes <time>    - Restore volumes from snapshot timestamp"
            echo "  full-recovery <time>      - Perform full platform disaster recovery"
            exit 1
            ;;
    esac
}

# Load environment variables
if [ -f "${SCRIPT_DIR}/.env" ]; then
    source "${SCRIPT_DIR}/.env"
fi

# Execute main function with all arguments
main "$@"