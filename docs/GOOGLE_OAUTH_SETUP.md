# Google OAuth & Drive Setup Guide

This guide explains how to set up Google OAuth authentication and Google Drive integration for the Minecraft Hosting Platform.

## Prerequisites

- A Google account
- Access to [Google Cloud Console](https://console.cloud.google.com/)

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top of the page
3. Click **New Project**
4. Enter a project name (e.g., "Minecraft Hosting Platform")
5. Click **Create**
6. Wait for the project to be created, then select it

## Step 2: Enable Required APIs

1. Go to **APIs & Services** → **Library**
2. Search for and enable the following APIs:
   - **Google Drive API** - Required for backup storage

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type (or Internal if using Google Workspace)
3. Click **Create**
4. Fill in the required fields:
   - **App name**: Minecraft Hosting Platform
   - **User support email**: Your email
   - **Developer contact email**: Your email
5. Click **Save and Continue**

### Add Scopes

1. Click **Add or Remove Scopes**
2. Add the following scopes:
   - `openid` - Basic authentication
   - `email` - Access to user's email
   - `profile` - Access to user's name and picture
   - `https://www.googleapis.com/auth/drive.file` - Access to files created by the app
3. Click **Update**
4. Click **Save and Continue**

### Test Users (For Development)

1. Go to **APIs & Services** → **OAuth consent screen** → **Audience**
2. Under **Test users**, click **+ ADD USERS**
3. Enter your Google email address
4. Click **Save**

> Note: While in "Testing" mode, only users added here can use the OAuth flow.

## Step 4: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Fill in the form:

| Field                | Value                                               |
| -------------------- | --------------------------------------------------- |
| **Application type** | Web application                                     |
| **Name**             | Minecraft Hosting Platform (or any name you prefer) |

### Authorized JavaScript origins

Click **+ ADD URI** and add these (one per line):

```
http://localhost:3000
```

```
http://localhost:8080
```

> Note: Port 3000 is used by the frontend dev server (configured in `frontend/vite.config.ts`).

> Note: Must include `http://` - just "localhost" won't work!

### Authorized redirect URIs

Click **+ ADD URI** and add:

```
http://localhost:8080/api/v1/auth/google/callback
```

> This must match EXACTLY what's in your `.env` file for `GOOGLE_REDIRECT_URI`

4. Click **Create**
5. A popup will show your **Client ID** and **Client Secret** - copy both!

> For production, add your production URLs (e.g., `https://yourdomain.com`)

## Step 5: Configure Environment Variables

Add the following to your `api-server/.env` file:

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/auth/google/callback

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=your-generated-secret

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

### Generate JWT Secret

```bash
openssl rand -base64 32
```

## Step 6: Database Setup

The platform uses CockroachDB for persistent storage of users and backup metadata.

### Option A: Port-forward from Minikube (Recommended for local dev)

If CockroachDB is already running in Kubernetes:

```bash
# Start port-forward (run in background or separate terminal)
kubectl port-forward svc/cockroachdb -n minecraft-system 26257:26257
```

### Option B: Docker

```bash
docker run -d --name cockroachdb-dev -p 26257:26257 -p 8081:8080 \
  cockroachdb/cockroach:v23.1.11 start-single-node --insecure

docker exec -it cockroachdb-dev cockroach sql --insecure -e "
  CREATE DATABASE IF NOT EXISTS minecraft_platform;
"
```

### Run Migrations

```bash
cd api-server
DATABASE_URL="postgresql://root@localhost:26257/minecraft_platform?sslmode=disable" npx tsx src/db/migrate.ts
```

## Step 7: Test the Integration

1. Ensure CockroachDB is accessible (port-forward or Docker)

2. Start the API server:

   ```bash
   cd api-server
   npm run dev
   ```

3. Start the frontend:

   ```bash
   cd frontend
   npm run dev
   ```

4. Open http://localhost:3000
5. Click "Sign in with Google"
6. Complete the OAuth flow
7. Verify you're logged in

## Google Drive Backup Flow

Once authenticated, the platform will:

1. **Create a folder** called "MinecraftBackups" in the user's Google Drive
2. **Upload backups** to this folder when triggered
3. **Store backup metadata** including Drive file ID and web link
4. **Allow downloads** directly from Google Drive
5. **Delete from Drive** when backups are deleted

### Backup Storage Structure

```
Google Drive/
└── MinecraftBackups/
    ├── server1-backup-2024-01-15.tar.gz
    ├── server1-backup-2024-01-16.tar.gz
    └── server2-backup-2024-01-15.tar.gz
```

## Troubleshooting

### "Access blocked: This app's request is invalid"

- Verify the redirect URI matches exactly in both Google Console and `.env`
- Check that you're using the correct Client ID

### "Error 403: access_denied"

- Ensure your email is added as a test user (for apps in testing mode)
- Or publish the app for production use

### "Invalid grant" error

- The authorization code may have expired - try logging in again
- Check that your system clock is accurate

### Drive uploads failing

- Verify the Google Drive API is enabled
- Check that the `drive.file` scope was requested
- Ensure the user completed the consent screen

## Production Considerations

1. **Publish the OAuth app** - Move from "Testing" to "Production" in the OAuth consent screen
2. **Add production URLs** - Add your production domain to authorized origins and redirect URIs
3. **Enable HTTPS** - Google OAuth requires HTTPS in production
4. **Request verification** - If using sensitive scopes, submit for Google verification

## Security Notes

- The `drive.file` scope only allows access to files created by the app
- Users can revoke access at any time from their Google Account settings
- Refresh tokens are stored securely and used to maintain access
- JWT tokens expire after 7 days

## Related Files

### Backend

- `api-server/src/services/google-drive-service.ts` - Drive API integration
- `api-server/src/middleware/auth.ts` - JWT authentication
- `api-server/src/index.ts` - OAuth routes (`/api/v1/auth/google/*`)
- `api-server/src/models/user-store-db.ts` - Database-backed user storage
- `api-server/src/db/backup-store-db.ts` - Database-backed backup storage
- `api-server/src/db/connection.ts` - Database connection pool
- `api-server/src/db/migrate.ts` - Migration runner
- `api-server/src/db/migrations/` - SQL migration files

### Frontend

- `frontend/src/api.ts` - Frontend auth API calls
- `frontend/src/contexts/AuthContext.tsx` - Auth state management
