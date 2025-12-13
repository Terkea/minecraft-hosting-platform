# Backup System

## Overview

Server backups are stored in users' personal Google Drive accounts. Users authenticate via Google OAuth, which grants both login and Drive access in a single flow.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │────▶│  API Server │────▶│Google Drive │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Kubernetes  │
                    │  (K8s Jobs) │
                    └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Backup PVC │
                    │ (Temporary) │
                    └─────────────┘
```

## Backup Flow

1. **Create Backup Request**: User clicks "Create Backup" in UI
2. **K8s Job Execution**: Job creates tar.gz of world data to temporary PVC
3. **Checksum Calculation**: SHA256 hash computed for integrity verification
4. **Token Refresh**: Google access token refreshed before upload
5. **Drive Upload**: Backup file uploaded to user's "MinecraftBackups" folder
6. **Metadata Storage**: Backup metadata saved to CockroachDB
7. **Completion**: UI shows success with backup size and timestamp

**Important**: Backups are only marked as "completed" if successfully uploaded to Google Drive. If Drive upload fails, the backup is marked as "failed".

## Restore Flow

1. **Initiate Restore**: User clicks "Restore" on a backup
2. **Confirmation**: Modal shows warning about data loss
3. **Progress Modal**: Live console shows each step with timestamps
4. **Verification**: SHA256 checksum verified (if valid format)
5. **Download**: Backup downloaded from Google Drive to PVC (if not already present)
6. **Server Stop**: Server stopped via MinecraftServer CRD (`spec.stopped = true`)
7. **Pod Termination**: Operator scales down StatefulSet, waits for pod to terminate
8. **Extraction**: K8s restore job extracts backup to world data PVC
9. **Server Start**: Server started via MinecraftServer CRD (`spec.stopped = false`)
10. **Completion**: Progress modal shows success, user closes manually

### Restore UI Features

- Live console with timestamped progress messages
- Warning: "Please do not close or navigate away from this page"
- Modal stays open until user explicitly closes it
- Close button disabled during active restore

## Authentication & Token Management

### OAuth Flow

```
User → "Sign in with Google" → Google OAuth Consent
                                      ↓
                              Authorize (profile + Drive)
                                      ↓
                              Callback with auth code
                                      ↓
                              Exchange for tokens
                                      ↓
                              Store in database
                                      ↓
                              Issue JWT to frontend
```

### Token Refresh

- **Automatic**: Before each backup upload, access token is refreshed
- **Storage**: New tokens saved to database after refresh
- **Failure Handling**: If refresh fails, `AUTH_REAUTH_REQUIRED` event emitted

### Re-Authentication

When tokens cannot be refreshed:

1. WebSocket broadcasts `auth_reauth_required` message
2. Frontend shows modal: "Re-authentication Required"
3. User clicks "Re-authenticate with Google"
4. Redirected to login, goes through OAuth flow
5. New tokens stored, backups resume working

## Data Storage

### CockroachDB Tables

| Table              | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `users`            | User accounts, OAuth tokens, Drive folder ID |
| `backups`          | Backup metadata, Drive file IDs, checksums   |
| `backup_schedules` | Automatic backup configuration               |

### Kubernetes PVC

| PVC                 | Size | Purpose                                 |
| ------------------- | ---- | --------------------------------------- |
| `minecraft-backups` | 20Gi | Temporary storage during backup/restore |

The PVC is used as intermediate storage:

- Backup: K8s Job writes tar.gz → API reads and uploads to Drive
- Restore: API downloads from Drive → K8s Job extracts to world data

## Error Handling

| Scenario                     | Handling                         |
| ---------------------------- | -------------------------------- |
| OAuth token expired          | Auto-refresh before upload       |
| Refresh token invalid        | Show re-auth modal               |
| Drive upload fails           | Backup marked as FAILED          |
| Cloud storage full           | Fail with clear error message    |
| Checksum mismatch            | Restore aborted with error       |
| Legacy checksum (pre-SHA256) | Skip verification, allow restore |
| Pod won't terminate          | Timeout after 2 minutes          |
| Restore job fails            | Server restarted, error shown    |

## Security

### Tenant Isolation

- Each user's backups stored in their own Google Drive
- OAuth tokens encrypted at rest in database
- No cross-tenant access possible
- Users can revoke access via Google account settings

### Scopes Required

- `openid`, `email`, `profile` - User identification
- `https://www.googleapis.com/auth/drive.file` - App-created files only

## Configuration

### Environment Variables

```env
# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/auth/google/callback

# JWT
JWT_SECRET=<random-32-byte-string>

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

## API Endpoints

| Method | Endpoint                                 | Description            |
| ------ | ---------------------------------------- | ---------------------- |
| POST   | `/api/v1/servers/:name/backups`          | Create backup          |
| GET    | `/api/v1/servers/:name/backups`          | List server backups    |
| GET    | `/api/v1/backups/:id`                    | Get backup details     |
| GET    | `/api/v1/backups/:id/download`           | Download backup file   |
| POST   | `/api/v1/backups/:id/restore`            | Restore from backup    |
| DELETE | `/api/v1/backups/:id`                    | Delete backup          |
| GET    | `/api/v1/servers/:name/backups/schedule` | Get backup schedule    |
| PUT    | `/api/v1/servers/:name/backups/schedule` | Update backup schedule |

## Caveats & Known Limitations

### Backup Creation

1. **Google Drive is Required**: Backups are only valid if uploaded to Google Drive. If the upload fails for any reason (network, quota, auth), the backup is marked as "failed".

2. **PVC Storage**: The temporary `minecraft-backups` PVC (20Gi) must have enough space for the backup. Large worlds may need PVC resizing.

3. **Token Expiry**: Google access tokens expire after 1 hour. The system auto-refreshes before each upload, but if the refresh token is revoked, user must re-authenticate.

4. **Concurrent Backups**: Only one backup job per server runs at a time. Creating a new backup while one is in progress will queue it.

### Backup Restore

1. **Data Loss Warning**: Restoring a backup **permanently overwrites** the current world. All progress since the backup was created is lost.

2. **Server Downtime**: The server must be stopped during restore. Players will be disconnected and cannot join until restore completes.

3. **CRD-Based Stop**: Restore uses the MinecraftServer CRD's `spec.stopped` field to stop the server. This ensures the operator doesn't fight against the restore process by immediately restarting the server.

4. **Pod Termination Timeout**: If the pod doesn't terminate within 2 minutes, restore fails. This can happen if the pod is stuck or unresponsive.

5. **Don't Navigate Away**: During restore, users should not close the browser tab or navigate away. The restore will continue server-side, but the progress modal will be lost.

6. **Legacy Checksums**: Backups created before SHA256 checksums were implemented have 32-character UUIDs instead of 64-character hashes. These are detected and verification is skipped (restore proceeds without integrity check).

### Token & Authentication

1. **Refresh Token Revocation**: If a user revokes the app's access via Google account settings, backup operations will fail until they re-authenticate.

2. **Re-Auth Modal**: When tokens can't be refreshed, a modal appears. Clicking "Later" dismisses it, but backups will continue to fail until re-auth is completed.

3. **Token Storage**: Tokens are stored in CockroachDB. If the database is wiped, all users must re-authenticate.

### Storage & Quotas

1. **Google Drive Quota**: Backups count against the user's Google Drive storage quota (15GB free for personal accounts). If quota is exceeded, backups fail.

2. **MinecraftBackups Folder**: All backups are stored in a folder called "MinecraftBackups" in the user's Drive root. If the user deletes this folder, it's recreated on the next backup.

3. **Backup Size**: Large worlds (10GB+) may take several minutes to backup and upload. The UI shows progress but doesn't display upload percentage.

### Kubernetes Dependencies

1. **Operator Coordination**: The backup/restore system relies on the MinecraftServer operator to manage pod lifecycle. If the operator is not running, stop/start operations will fail.

2. **PVC Access Mode**: The backup PVC uses `ReadWriteOnce` which means only one pod can mount it at a time. Backup jobs and restore jobs cannot run simultaneously.

3. **Job Cleanup**: Completed backup/restore jobs remain in the cluster. They should be cleaned up periodically (currently not automated).

## Troubleshooting

### Backup shows 0 bytes

- Google Drive upload failed - check API server logs for auth errors
- PVC read failed - verify backup file exists on PVC

### Restore stuck at "Waiting for server to stop"

- Operator may not be running - check operator pod status
- Pod may be stuck - try manually deleting the pod

### "Re-authentication Required" keeps appearing

- Refresh token is invalid - user must complete full re-auth flow
- Check if app access was revoked in Google account settings

### Checksum mismatch error

- Backup file corrupted during download from Drive
- Try downloading backup again and re-uploading
- Legacy backups with UUID checksums should not show this error

### Backup job timeout

- World is very large - increase job timeout in backup-service.ts
- PVC storage full - check PVC capacity and usage
