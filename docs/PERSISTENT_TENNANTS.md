# Persistent Data Storage

This document describes the persistent data storage architecture for the Minecraft Hosting Platform.

## Overview

All application data is stored in CockroachDB, ensuring persistence across API server restarts. The database runs as a StatefulSet in Kubernetes with persistent volumes.

## Database Schema

### Users Table

Stores Google OAuth authenticated users.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  picture_url TEXT,
  google_access_token TEXT NOT NULL,
  google_refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  drive_folder_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_email ON users(email);
```

**Migration:** `api-server/src/db/migrations/001_create_users.sql`

### Backups Table

Stores backup metadata with Google Drive integration.

```sql
CREATE TABLE backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  size_bytes BIGINT DEFAULT 0,
  compression_format VARCHAR(50) DEFAULT 'gzip',
  storage_path TEXT NOT NULL,
  checksum VARCHAR(255),
  drive_file_id VARCHAR(255),
  drive_web_link TEXT,
  status VARCHAR(50) DEFAULT 'pending' NOT NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  minecraft_version VARCHAR(50) DEFAULT 'unknown',
  world_size BIGINT DEFAULT 0,
  is_automatic BOOLEAN DEFAULT FALSE,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_backups_server_id ON backups(server_id);
CREATE INDEX idx_backups_tenant_id ON backups(tenant_id);
CREATE INDEX idx_backups_status ON backups(status);
CREATE INDEX idx_backups_started_at ON backups(started_at DESC);
```

**Migration:** `api-server/src/db/migrations/002_create_backups.sql`

### Backup Schedules Table

Stores automatic backup schedule configuration.

```sql
CREATE TABLE backup_schedules (
  server_id VARCHAR(255) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT FALSE NOT NULL,
  interval_hours INT DEFAULT 24 NOT NULL,
  retention_count INT DEFAULT 7 NOT NULL,
  last_backup_at TIMESTAMPTZ,
  next_backup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_backup_schedules_enabled ON backup_schedules(enabled) WHERE enabled = TRUE;
CREATE INDEX idx_backup_schedules_next_backup ON backup_schedules(next_backup_at) WHERE enabled = TRUE;
```

**Migration:** `api-server/src/db/migrations/002_create_backups.sql`

## Implementation Files

| File                                     | Purpose                                   |
| ---------------------------------------- | ----------------------------------------- |
| `api-server/src/db/connection.ts`        | Database connection pool with retry logic |
| `api-server/src/db/migrate.ts`           | Migration runner script                   |
| `api-server/src/models/user-store-db.ts` | Database-backed user storage              |
| `api-server/src/db/backup-store-db.ts`   | Database-backed backup/schedule storage   |

## Running Migrations

Migrations run automatically via the migration script. To run manually:

```bash
cd api-server
DATABASE_URL="postgresql://root@localhost:26257/minecraft_platform?sslmode=disable" npx tsx src/db/migrate.ts
```

## Local Development Setup

### Option 1: Port-forward from Minikube

If CockroachDB is running in Kubernetes:

```bash
kubectl port-forward svc/cockroachdb -n minecraft-system 26257:26257
```

### Option 2: Docker

```bash
# Start CockroachDB
docker run -d --name cockroachdb-dev -p 26257:26257 -p 8081:8080 \
  cockroachdb/cockroach:v23.1.11 start-single-node --insecure

# Create database
docker exec -it cockroachdb-dev cockroach sql --insecure -e "
  CREATE DATABASE IF NOT EXISTS minecraft_platform;
"
```

## Environment Configuration

```env
# Use root user for insecure mode (local dev)
DATABASE_URL=postgresql://root@localhost:26257/minecraft_platform?sslmode=disable
```

## What's Persisted

| Data               | Storage                              | Survives Restart? |
| ------------------ | ------------------------------------ | ----------------- |
| User accounts      | CockroachDB `users` table            | Yes               |
| Backup metadata    | CockroachDB `backups` table          | Yes               |
| Backup schedules   | CockroachDB `backup_schedules` table | Yes               |
| Backup files       | Google Drive (user's account)        | Yes               |
| Server definitions | Kubernetes CRDs                      | Yes               |
| Server world data  | Kubernetes PVCs                      | Yes               |

## What's NOT Persisted (Runtime Only)

| Data                  | Purpose                            |
| --------------------- | ---------------------------------- |
| Metrics cache         | Real-time metrics rebuilt from K8s |
| WebSocket connections | Active client sessions             |
| RCON connection pool  | Active server connections          |
| K8s watch state       | Rebuilt on startup                 |
