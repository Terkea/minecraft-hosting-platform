# Google OAuth + Google Drive Backup Implementation

> **Status: IMPLEMENTED**
> This document was originally a plan. The features described here are now fully implemented.

## Overview

User authentication via Google OAuth with integrated Google Drive backup storage. Users sign in with Google, and their server backups are stored directly in their personal Google Drive.

## Key Decisions

- **Authentication**: Google OAuth (Sign in with Google)
- **Storage**: Google Drive for backup files, CockroachDB for metadata
- **Scopes**: Single OAuth flow grants both auth + Drive access

---

## Phase 1: Google Cloud Console Setup (Manual)

1. Create Google Cloud project "minecraft-hosting-platform"
2. Enable APIs: Google+ API, Google Drive API
3. Configure OAuth consent screen (External, add scopes)
4. Create OAuth 2.0 Web Client credentials
5. Add redirect URIs:
   - `http://localhost:8080/api/v1/auth/google/callback`
   - Production domain when ready

**Scopes needed:**

- `openid`, `email`, `profile`
- `https://www.googleapis.com/auth/drive.file`

---

## Phase 2: Backend Implementation

### 2.1 Install Dependencies

```bash
cd api-server
npm install google-auth-library googleapis jsonwebtoken
npm install -D @types/jsonwebtoken
```

### 2.2 New Files to Create

| File                                              | Purpose                                | Status |
| ------------------------------------------------- | -------------------------------------- | ------ |
| `api-server/src/models/user-store-db.ts`          | User model with CockroachDB storage    | Done   |
| `api-server/src/db/backup-store-db.ts`            | Backup/schedule storage in CockroachDB | Done   |
| `api-server/src/services/google-drive-service.ts` | Google Drive API client                | Done   |
| `api-server/src/middleware/auth.ts`               | JWT auth middleware                    | Done   |

### 2.3 Modify Existing Files

**`api-server/src/index.ts`:**

- Add auth endpoints: `/api/v1/auth/google`, `/api/v1/auth/google/callback`, `/api/v1/auth/me`
- Apply `requireAuth` middleware to all server/backup routes
- Filter servers by `req.userId` instead of hardcoded tenant
- Add env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`

**`api-server/src/services/backup-service.ts`:**

- Add `userId` to BackupOptions and BackupSnapshot
- After K8s Job creates tar.gz, upload to user's Google Drive
- Download backups from Drive instead of PVC
- Delete from Drive when backup deleted

**`api-server/.env.example`:**

- Add Google OAuth config vars
- Add JWT_SECRET
- Add FRONTEND_URL

---

## Phase 3: Frontend Implementation

### 3.1 New Files to Create

| File                                         | Purpose                            |
| -------------------------------------------- | ---------------------------------- |
| `frontend/src/contexts/AuthContext.tsx`      | Auth state, login/logout functions |
| `frontend/src/components/Login.tsx`          | Google sign-in page                |
| `frontend/src/components/ProtectedRoute.tsx` | Route guard component              |

### 3.2 Modify Existing Files

**`frontend/src/App.tsx`:**

- Wrap with `<AuthProvider>`
- Add `/login` route
- Wrap existing routes with `<ProtectedRoute>`

**`frontend/src/api.ts`:**

- Add `getAuthHeaders()` helper
- Include `Authorization: Bearer <token>` in all requests
- Handle 401 responses (redirect to login)

**`frontend/src/BackupManager.tsx`:**

- Show Google Drive connection status badge
- Update download to work with Drive-stored backups

---

## Phase 4: Data Models

### User Model (CockroachDB)

```typescript
interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  pictureUrl?: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  tokenExpiresAt: Date;
  driveFolderId?: string; // "MinecraftBackups" folder
  createdAt: Date;
  updatedAt: Date;
}
```

> **Implementation:** `api-server/src/models/user-store-db.ts` - Database-backed storage in CockroachDB `users` table.

### BackupSnapshot Updates

```typescript
interface BackupSnapshot {
  // ... existing fields ...
  tenantId: string; // User ID (owner)
  driveFileId?: string; // Google Drive file ID
  driveWebLink?: string; // Link to file in Drive
}
```

> **Implementation:** `api-server/src/db/backup-store-db.ts` - Database-backed storage in CockroachDB `backups` table.

---

## Phase 5: OAuth Flow

```
1. User clicks "Sign in with Google"
2. Frontend redirects to: GET /api/v1/auth/google
3. Backend redirects to Google OAuth consent
4. User authorizes (grants profile + Drive access)
5. Google redirects to: GET /api/v1/auth/google/callback?code=xxx
6. Backend:
   - Exchanges code for tokens
   - Gets user info from Google
   - Creates/updates user record
   - Creates "MinecraftBackups" folder in Drive
   - Generates JWT
   - Redirects to frontend with token
7. Frontend stores JWT in localStorage
8. All API calls include: Authorization: Bearer <jwt>
```

---

## Phase 6: Backup Flow (Updated)

```
1. User clicks "Create Backup"
2. API creates BackupSnapshot record (status: pending)
3. K8s Job runs: tar -czf /backups/{filename} -C /data .
4. API fetches tar.gz from backup server
5. API uploads to user's Google Drive MinecraftBackups folder
6. API updates BackupSnapshot with driveFileId (status: completed)
7. (Optional) Delete tar.gz from PVC

Download:
1. User clicks "Download"
2. API gets user's Drive tokens
3. API streams file from Drive to client
```

---

## Implementation Order

1. **Backend auth** - User model, auth middleware, auth endpoints
2. **Protect routes** - Add requireAuth to existing endpoints
3. **Frontend auth** - AuthContext, Login page, ProtectedRoute
4. **Update API client** - Add auth headers to all requests
5. **Google Drive service** - Create/upload/download/delete operations
6. **Integrate Drive with backups** - Modify backup-service.ts
7. **Update UI** - Drive status badge, updated download flow
8. **Testing** - End-to-end auth + backup flow

---

## Environment Variables

```env
# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/auth/google/callback

# JWT
JWT_SECRET=<random-32-byte-string>

# Frontend URL (for OAuth redirect back)
FRONTEND_URL=http://localhost:5173
```

---

## Critical Files

### Must Create:

- `api-server/src/models/user.ts`
- `api-server/src/services/google-drive-service.ts`
- `api-server/src/middleware/auth.ts`
- `frontend/src/contexts/AuthContext.tsx`
- `frontend/src/components/Login.tsx`
- `frontend/src/components/ProtectedRoute.tsx`

### Must Modify:

- `api-server/src/index.ts` - Auth endpoints + route protection
- `api-server/src/services/backup-service.ts` - Drive integration
- `api-server/.env.example` - New env vars
- `frontend/src/App.tsx` - Auth provider + routes
- `frontend/src/api.ts` - Auth headers
- `frontend/src/BackupManager.tsx` - Drive status UI

---

## Detailed Implementation Reference

### Supported Providers (Future)

| Provider     | Priority | OAuth Scope                 | API                 | Max File Size |
| ------------ | -------- | --------------------------- | ------------------- | ------------- |
| Google Drive | P0       | `drive.file` (app-only)     | Google Drive API v3 | 5TB           |
| Dropbox      | P1       | App folder access           | Dropbox API v2      | 2GB (free)    |
| OneDrive     | P2       | `Files.ReadWrite.AppFolder` | Microsoft Graph API | 250GB         |

### Database Schema (Production - CockroachDB)

```sql
-- Users table (replaces in-memory store)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  picture_url TEXT,
  google_access_token TEXT NOT NULL,
  google_refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  drive_folder_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_email ON users(email);

-- Update servers to use user_id instead of tenant_id
ALTER TABLE servers ADD COLUMN user_id UUID REFERENCES users(id);

-- Backups table with Drive integration
CREATE TABLE backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  size_bytes BIGINT DEFAULT 0,
  compression_format VARCHAR(50) DEFAULT 'gzip',
  checksum VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  drive_file_id VARCHAR(255),
  drive_web_link TEXT,
  minecraft_version VARCHAR(50),
  world_size BIGINT DEFAULT 0,
  is_automatic BOOLEAN DEFAULT FALSE,
  tags TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for backups
CREATE INDEX idx_backups_server_id ON backups(server_id);
CREATE INDEX idx_backups_user_id ON backups(user_id);
CREATE INDEX idx_backups_status ON backups(status);
CREATE INDEX idx_backups_created_at ON backups(created_at DESC);

-- Backup schedules
CREATE TABLE backup_schedules (
  server_id VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  enabled BOOLEAN DEFAULT FALSE,
  interval_hours INTEGER DEFAULT 24,
  retention_count INTEGER DEFAULT 7,
  last_backup_at TIMESTAMP WITH TIME ZONE,
  next_backup_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Backup Job Modification (K8s)

Current backup job (PVC-based):

```yaml
# Mounts PVC, writes tar.gz to /backups
volumes:
  - name: backup-storage
    persistentVolumeClaim:
      claimName: minecraft-backups
```

New backup job (cloud upload):

```yaml
# Creates tar.gz locally, uploads via API
containers:
  - name: backup
    image: our-backup-image:latest
    env:
      - name: BACKUP_ID
        value: '{{ .BackupID }}'
      - name: UPLOAD_URL
        value: 'http://api-server:8080/internal/backup/upload'
    command:
      - /bin/sh
      - -c
      - |
        # Create backup
        tar -czf /tmp/backup.tar.gz -C /data .
        # Upload via API (API handles cloud provider logic)
        curl -X POST $UPLOAD_URL \
          -F "file=@/tmp/backup.tar.gz" \
          -F "backup_id=$BACKUP_ID"
```

### Download Flow Code

```typescript
async function downloadBackup(backupId: string, res: Response) {
  const backup = await getBackup(backupId);
  const user = userStore.getUserById(backup.userId);

  if (!user || !backup.driveFileId) {
    throw new Error('Backup not found or not stored in Drive');
  }

  const driveService = new GoogleDriveService();
  driveService.setUserCredentials(user.googleAccessToken, user.googleRefreshToken);

  // Stream from Drive to client
  const stream = await driveService.getDownloadStream(backup.driveFileId);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${backup.name}.tar.gz"`);
  stream.pipe(res);
}
```

### Transition Plan

**Stage 1: Initial Deployment** - COMPLETED

- [x] Deploy auth system and Google Drive integration
- [x] New users sign in with Google, backups go to Drive
- [x] User data persisted in CockroachDB
- [x] Backup metadata persisted in CockroachDB

**Stage 2: Current State**

- All new backups stored in Google Drive
- Backup metadata stored in database (persistent)
- User accounts stored in database (persistent)
- PVC used only for temporary backup staging during K8s job execution

**Stage 3: Future Improvements (Optional)**

- Consider adding additional cloud storage providers (Dropbox, OneDrive)
- Add bulk backup download/export feature

### Tenant Isolation Benefits

User cloud storage provides **physical tenant isolation**:

- Each user's backups in their own account
- OAuth tokens per-user, encrypted at rest
- No way to accidentally access another user's backups
- Users can audit access via their cloud provider
- Users can revoke platform access anytime
- GDPR compliance easier (data in user's control)

### Error Handling & Edge Cases

| Scenario                     | Handling                                               |
| ---------------------------- | ------------------------------------------------------ |
| OAuth token expired          | Auto-refresh using refresh_token, retry upload         |
| Cloud storage full           | Fail backup, notify user, suggest cleanup              |
| User unlinks during backup   | Fail backup with clear error message                   |
| Provider API down            | Retry with exponential backoff, fail after max retries |
| Large backup (>5GB)          | Use resumable upload APIs, chunk uploads               |
| User deletes folder manually | Recreate folder on next backup                         |

### Frontend Components Reference

```tsx
// Login.tsx - Google sign-in page
function Login() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 max-w-md">
        <h1 className="text-3xl font-bold text-white mb-2">Minecraft Server Hosting</h1>
        <p className="text-gray-400 mb-8">Sign in to manage your servers</p>
        <button
          onClick={login}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-gray-800 rounded-lg"
        >
          <GoogleIcon /> Sign in with Google
        </button>
        <p className="mt-4 text-sm text-blue-400">
          Note: Signing in grants access to your Google Drive for backup storage.
        </p>
      </div>
    </div>
  );
}
```

```tsx
// AuthContext.tsx - Auth state management
interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  token: string | null;
}

// On OAuth callback, store token and fetch user
useEffect(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const callbackToken = urlParams.get('token');
  if (callbackToken) {
    localStorage.setItem('auth_token', callbackToken);
    setToken(callbackToken);
    window.history.replaceState({}, '', window.location.pathname);
  }
}, []);
```
