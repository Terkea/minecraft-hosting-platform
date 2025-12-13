# Server Deletion & Data Cleanup

**Status**: COMPLETE
**Last Updated**: 2025-12-13

## Overview

When a user deletes a Minecraft server, the platform performs comprehensive cleanup of all associated infrastructure and data. This document details what gets deleted, what gets preserved, and how the cleanup process works.

## Deletion Behavior Summary

| Resource Type         | Cleanup Action                 | Permanent?                 |
| --------------------- | ------------------------------ | -------------------------- |
| MinecraftServer CRD   | Deleted                        | Yes                        |
| StatefulSet           | Auto-deleted (owner reference) | Yes                        |
| Pod                   | Auto-deleted (owner reference) | Yes                        |
| ConfigMap             | Auto-deleted (owner reference) | Yes                        |
| Services              | Auto-deleted (owner reference) | Yes                        |
| PVC (World Data)      | **Explicitly deleted**         | Yes                        |
| Backup Records (DB)   | **Soft-deleted**               | No (audit trail preserved) |
| Backup Schedules (DB) | **Soft-deleted**               | No (audit trail preserved) |
| Google Drive Files    | **Preserved**                  | N/A                        |

## Architecture

### Deletion Flow

```
User clicks "Delete Server" in UI
           │
           ▼
┌─────────────────────────────────────────┐
│  Frontend: Delete Confirmation Modal    │
│  - Shows what will be deleted           │
│  - User confirms deletion               │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  API Server: DELETE /api/v1/servers/:id │
│                                         │
│  1. Verify server ownership             │
│  2. Delete MinecraftServer CRD          │
│  3. Delete PVC (world data)             │
│  4. Soft-delete backup records          │
│  5. Broadcast WebSocket event           │
└─────────────────────────────────────────┘
           │
           ├──────────────────────────────┐
           ▼                              ▼
┌────────────────────┐     ┌────────────────────────┐
│ K8s Operator       │     │ Database               │
│ - Removes finalizer│     │ - Sets deleted_at      │
│ - Triggers GC      │     │ - Records preserved    │
└────────────────────┘     └────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│ Kubernetes Garbage Collection           │
│ - Deletes StatefulSet                   │
│ - Deletes Services                      │
│ - Deletes ConfigMap                     │
│ - Deletes Pod                           │
└─────────────────────────────────────────┘
```

## Implementation Details

### 1. API Delete Endpoint

**File**: `api-server/src/index.ts:571-619`

```typescript
app.delete('/api/v1/servers/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const server = await verifyServerOwnership(req, res, id);
  if (!server) return;

  console.log(`[API] Deleting server ${id} (${server.displayName})`);

  // 1. Delete the MinecraftServer CRD
  await k8sClient.deleteMinecraftServer(server.name);

  // 2. Delete the PVC (world data)
  try {
    await k8sClient.deleteServerPVC(server.name);
  } catch (pvcError) {
    console.warn(`[API] Failed to delete PVC: ${pvcError.message}`);
    // Continue anyway - PVC might not exist
  }

  // 3. Soft-delete backup records and schedules
  try {
    const deletedCounts = await backupService.softDeleteServerData(id);
    console.log(
      `[API] Soft-deleted ${deletedCounts.backups} backups, ${deletedCounts.schedules} schedules`
    );
  } catch (dbError) {
    console.warn(`[API] Failed to soft-delete backup data: ${dbError.message}`);
    // Continue anyway - CRD deletion is the critical part
  }

  // Broadcast to WebSocket clients
  broadcastServerUpdate('deleted', { id, name: server.name, phase: 'Deleted' });

  res.json({ message: `Server '${server.displayName}' and all associated data deleted` });
});
```

### 2. PVC Deletion

**File**: `api-server/src/k8s-client.ts:388-411`

The PVC is named using the pattern `minecraft-data-{server-name}-0` (StatefulSet VolumeClaimTemplate naming).

```typescript
async deleteServerPVC(name: string): Promise<boolean> {
  const pvcName = `minecraft-data-${name}-0`;
  try {
    await this.coreApi.deleteNamespacedPersistentVolumeClaim({
      name: pvcName,
      namespace: this.namespace,
    });
    console.log(`[K8sClient] Deleted PVC: ${pvcName}`);
    return true;
  } catch (error) {
    if (error.response?.statusCode === 404) {
      console.log(`[K8sClient] PVC not found (already deleted): ${pvcName}`);
      return false;
    }
    throw error;
  }
}
```

### 3. Soft Delete (Database)

**File**: `api-server/src/db/backup-store-db.ts:416-441`

Rather than hard-deleting records, we set a `deleted_at` timestamp to preserve audit history.

```typescript
async softDeleteByServerId(serverId: string): Promise<{ backups: number; schedules: number }> {
  const now = new Date();

  // Soft-delete all backups for this server
  const backupsResult = await this.getPool().query(
    'UPDATE backups SET deleted_at = $1, updated_at = $1 WHERE server_id = $2 AND deleted_at IS NULL',
    [now, serverId]
  );

  // Soft-delete the schedule for this server
  const schedulesResult = await this.getPool().query(
    'UPDATE backup_schedules SET deleted_at = $1, updated_at = $1 WHERE server_id = $2 AND deleted_at IS NULL',
    [now, serverId]
  );

  return {
    backups: backupsResult.rowCount ?? 0,
    schedules: schedulesResult.rowCount ?? 0,
  };
}
```

### 4. Database Schema

**File**: `api-server/src/db/migrations/003_add_soft_delete.sql`

```sql
-- Add soft delete support for server deletion cleanup
ALTER TABLE backups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE backup_schedules ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for filtering out deleted records efficiently
CREATE INDEX IF NOT EXISTS idx_backups_not_deleted ON backups(server_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_backup_schedules_not_deleted ON backup_schedules(server_id) WHERE deleted_at IS NULL;
```

### 5. Query Filtering

All queries that list or fetch backup data now exclude soft-deleted records:

```typescript
// List backups (excludes deleted)
async listBackups(serverId?: string, tenantId?: string): Promise<BackupSnapshot[]> {
  let query = 'SELECT * FROM backups';
  const conditions: string[] = ['deleted_at IS NULL'];  // Always filter
  // ... rest of query building
}

// Get backup by ID (excludes deleted)
async getBackupById(id: string): Promise<BackupSnapshot | undefined> {
  const result = await this.getPool().query(
    'SELECT * FROM backups WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  // ...
}

// Get due schedules (excludes deleted)
async getDueSchedules(): Promise<BackupSchedule[]> {
  const result = await this.getPool().query(
    'SELECT * FROM backup_schedules WHERE enabled = TRUE AND next_backup_at <= $1 AND deleted_at IS NULL',
    [now]
  );
  // ...
}
```

## Frontend Delete Confirmation Modal

**File**: `frontend/src/ServerList.tsx:308-387`

The delete confirmation modal clearly informs users about what will be deleted:

### UI Components

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  Delete Server                                      │
│      This action cannot be undone                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Are you sure you want to delete "My Server"?           │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  The following will be permanently deleted:      │   │
│  │                                                  │   │
│  │  🔴 World data and server files (PVC storage)   │   │
│  │  🔴 Server configuration and settings           │   │
│  │  🟡 Backup records (marked as deleted)          │   │
│  │  ─────────────────────────────────────────      │   │
│  │  🟢 Google Drive backup files will be preserved │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────┐  ┌─────────────────────────────┐      │
│  │   Cancel    │  │  🗑️  Delete Server          │      │
│  └─────────────┘  └─────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### Color Legend

| Icon | Color  | Meaning                                  |
| ---- | ------ | ---------------------------------------- |
| 🔴   | Red    | Permanently deleted, cannot be recovered |
| 🟡   | Yellow | Soft-deleted, hidden but preserved in DB |
| 🟢   | Green  | Preserved, no action taken               |

## Kubernetes Garbage Collection

Resources with owner references are automatically garbage-collected when the MinecraftServer CRD is deleted:

### Owner Reference Setup

**File**: `k8s/operator/controllers/minecraftserver_controller.go`

```go
// Set owner reference for ConfigMap
if err := controllerutil.SetControllerReference(server, configMap, r.Scheme); err != nil {
    return err
}

// Set owner reference for Services
if err := controllerutil.SetControllerReference(server, service, r.Scheme); err != nil {
    return err
}

// Set owner reference for StatefulSet
if err := controllerutil.SetControllerReference(server, statefulSet, r.Scheme); err != nil {
    return err
}
```

### What Owner References Do

When a MinecraftServer CRD is deleted, Kubernetes automatically:

1. Identifies all resources with `ownerReferences` pointing to the deleted CRD
2. Cascades the deletion to those dependent resources
3. Deletes in reverse dependency order (Pods before StatefulSet, etc.)

### Why PVCs Aren't Auto-Deleted

StatefulSet VolumeClaimTemplates have `orphanedPVCPolicy: Retain` by default. This is a safety feature - world data is precious and accidental deletion would be catastrophic.

Our platform explicitly deletes PVCs because:

1. Users are clearly warned in the confirmation modal
2. Google Drive backups are preserved for recovery
3. Orphaned PVCs would consume storage indefinitely

## Key Files

| File                                                             | Purpose                           |
| ---------------------------------------------------------------- | --------------------------------- |
| `api-server/src/index.ts:571-619`                                | Delete endpoint with full cleanup |
| `api-server/src/k8s-client.ts:388-411`                           | PVC deletion method               |
| `api-server/src/db/backup-store-db.ts:416-441`                   | Soft-delete implementation        |
| `api-server/src/db/migrations/003_add_soft_delete.sql`           | Database migration                |
| `api-server/src/services/backup-service.ts:1472-1480`            | BackupService wrapper             |
| `frontend/src/ServerList.tsx:308-387`                            | Delete confirmation modal         |
| `k8s/operator/controllers/minecraftserver_controller.go:145-159` | Operator deletion handler         |

## Why Keep Google Drive Files?

When a server is deleted, backup files stored on Google Drive are intentionally preserved:

1. **Recovery Option**: Users can manually restore from Drive if they change their mind
2. **Billing Transparency**: Drive storage is billed to the user's Google account, not our platform
3. **User Control**: Users can delete Drive files manually when ready
4. **Legal/Compliance**: Some users may need to retain data for compliance reasons

## Audit Trail

Soft-deleted records provide an audit trail:

```sql
-- Query to see deleted backups
SELECT id, server_id, name, deleted_at
FROM backups
WHERE deleted_at IS NOT NULL
ORDER BY deleted_at DESC;

-- Query to see deletion statistics by server
SELECT server_id, COUNT(*) as backup_count, MAX(deleted_at) as deleted_at
FROM backups
WHERE deleted_at IS NOT NULL
GROUP BY server_id;
```

## Error Handling

The deletion process is designed to be resilient:

1. **CRD deletion is mandatory** - If this fails, the whole operation fails
2. **PVC deletion is best-effort** - Logged warning if it fails, but continues
3. **DB soft-delete is best-effort** - Logged warning if it fails, but continues

This ensures servers can always be deleted even if secondary cleanup fails.

## Troubleshooting

### Server Stuck After Deletion

If the server appears stuck after deletion:

1. Check if CRD exists: `kubectl get mcserver -n minecraft-servers`
2. Check for finalizer issues: `kubectl get mcserver <name> -o yaml | grep finalizers`
3. Force remove finalizer if needed: `kubectl patch mcserver <name> -p '{"metadata":{"finalizers":[]}}' --type=merge`

### PVC Not Deleted

If world data PVC remains after server deletion:

1. List PVCs: `kubectl get pvc -n minecraft-servers`
2. Manually delete: `kubectl delete pvc minecraft-data-<server-name>-0 -n minecraft-servers`
3. Check API logs for deletion errors

### Backup Records Still Visible

If backups still appear in UI after server deletion:

1. Check `deleted_at` column: Records should have a timestamp
2. Verify query includes `WHERE deleted_at IS NULL`
3. Run migration if `deleted_at` column missing: Apply `003_add_soft_delete.sql`

## Related Documentation

- [Server Lifecycle Management](./server-lifecycle-management.md)
- [Backup System](./backup-system.md)
- [UUID Server Identification](../architecture/UUID_SERVER_IDENTIFICATION.md)
