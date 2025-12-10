# Data Model: Minecraft Server Hosting Platform

**Date**: 2025-09-13
**Status**: Phase 1 Design

## Core Entities

### User Account

**Purpose**: Customer account with associated servers, permissions, and billing
**Fields**:

- `id`: UUID (primary key)
- `email`: string (unique, validated)
- `name`: string
- `tenant_id`: UUID (for multi-tenant isolation)
- `created_at`: timestamp
- `updated_at`: timestamp

**Validation Rules**:

- Email must be valid format and unique
- Name required, 1-100 characters
- Tenant ID required for row-level security

### Server Instance

**Purpose**: Deployed Minecraft server with resources, configurations, and lifecycle state
**Fields**:

- `id`: UUID (primary key)
- `tenant_id`: UUID (foreign key to User Account)
- `name`: string (user-defined server name)
- `sku_id`: UUID (foreign key to SKU Configuration)
- `status`: enum (deploying, running, stopped, failed, terminating)
- `minecraft_version`: string (e.g., "1.20.1")
- `server_properties`: JSONB (Minecraft server.properties settings)
- `resource_limits`: JSONB (CPU, memory, storage limits)
- `kubernetes_namespace`: string (isolated deployment namespace)
- `external_port`: integer (accessible port for players)
- `current_players`: integer (real-time player count)
- `max_players`: integer (server capacity)
- `last_backup_at`: timestamp
- `created_at`: timestamp
- `updated_at`: timestamp

**Validation Rules**:

- Name required, 1-50 characters, alphanumeric + hyphens
- Status transitions: deploying → running/failed, running → stopped/terminating
- Minecraft version must be supported version
- External port must be unique per tenant
- Max players must be positive integer

**State Transitions**:

- `deploying` → `running` (successful deployment)
- `deploying` → `failed` (deployment timeout/error)
- `running` → `stopped` (user stop action)
- `running` → `terminating` (user delete action)
- `stopped` → `deploying` (user start action)
- `stopped` → `terminating` (user delete action)

### SKU Configuration

**Purpose**: Predefined resource templates with CPU, memory, storage, and Minecraft settings
**Fields**:

- `id`: UUID (primary key)
- `name`: string (display name, e.g., "Small Server")
- `cpu_cores`: decimal (CPU allocation, e.g., 2.0)
- `memory_gb`: integer (RAM allocation in GB)
- `storage_gb`: integer (disk space in GB)
- `max_players`: integer (recommended player capacity)
- `default_properties`: JSONB (default server.properties values)
- `monthly_price`: decimal (billing amount)
- `is_active`: boolean (available for selection)
- `created_at`: timestamp

**Validation Rules**:

- Name required, unique, 1-50 characters
- CPU cores must be positive decimal
- Memory and storage must be positive integers
- Monthly price must be non-negative
- Default properties must be valid Minecraft settings

### Plugin/Mod Package

**Purpose**: Installable server extensions with version information and dependencies
**Fields**:

- `id`: UUID (primary key)
- `name`: string (plugin name)
- `version`: string (semantic version, e.g., "7.2.15")
- `minecraft_versions`: string[] (compatible MC versions)
- `description`: text (plugin description)
- `download_url`: string (secure download location)
- `file_hash`: string (integrity verification)
- `dependencies`: JSONB (required plugins and versions)
- `category`: enum (utility, gameplay, admin, performance)
- `is_approved`: boolean (security review status)
- `created_at`: timestamp
- `updated_at`: timestamp

**Validation Rules**:

- Name required, 1-100 characters
- Version must follow semantic versioning
- Minecraft versions must be valid version strings
- Download URL must be HTTPS
- File hash required for integrity
- Dependencies must reference existing plugins

### Server Plugin Installation

**Purpose**: Junction table tracking installed plugins per server
**Fields**:

- `id`: UUID (primary key)
- `server_id`: UUID (foreign key to Server Instance)
- `plugin_id`: UUID (foreign key to Plugin/Mod Package)
- `status`: enum (installing, installed, failed, removing)
- `config_overrides`: JSONB (plugin-specific configuration)
- `installed_at`: timestamp
- `updated_at`: timestamp

**Relationships**:

- Many-to-many between Server Instance and Plugin/Mod Package
- Composite unique index on (server_id, plugin_id)

### Backup Snapshot

**Purpose**: Point-in-time server data captures with metadata for restoration
**Fields**:

- `id`: UUID (primary key)
- `server_id`: UUID (foreign key to Server Instance)
- `backup_type`: enum (manual, scheduled, pre_termination)
- `storage_path`: string (object storage location)
- `size_bytes`: bigint (backup file size)
- `compression_type`: enum (gzip, lz4, none)
- `status`: enum (creating, completed, failed, restoring)
- `retention_until`: timestamp (automatic deletion date)
- `metadata`: JSONB (world info, player data summary)
- `created_at`: timestamp

**Validation Rules**:

- Server ID must exist and user must have access
- Storage path must be unique
- Size bytes must be non-negative
- Retention until must be future date
- Status transitions controlled by backup service

### Metrics Data

**Purpose**: Real-time and historical performance data
**Fields**:

- `id`: UUID (primary key)
- `server_id`: UUID (foreign key to Server Instance)
- `metric_type`: enum (cpu_usage, memory_usage, player_count, tps, disk_usage)
- `value`: decimal (metric value)
- `unit`: string (measurement unit, e.g., "percent", "count", "tps")
- `timestamp`: timestamp (when metric was collected)

**Validation Rules**:

- Server ID must exist
- Value must be non-negative for most metrics
- Timestamp must not be future date
- Unit must match metric type expectations

## Relationships

```
User Account (1) ←→ (N) Server Instance
SKU Configuration (1) ←→ (N) Server Instance
Server Instance (1) ←→ (N) Server Plugin Installation
Plugin/Mod Package (1) ←→ (N) Server Plugin Installation
Server Instance (1) ←→ (N) Backup Snapshot
Server Instance (1) ←→ (N) Metrics Data
```

## Multi-Tenant Isolation

**Row-Level Security**: All tables include `tenant_id` with RLS policies
**Namespace Isolation**: Each tenant gets dedicated Kubernetes namespace
**Storage Isolation**: Persistent volumes scoped to tenant namespace
**Network Isolation**: NetworkPolicies restrict cross-tenant communication

## Indexing Strategy

**Performance Indexes**:

- `server_instances(tenant_id, status)` - tenant server listings
- `backup_snapshots(server_id, created_at DESC)` - backup history
- `metrics_data(server_id, metric_type, timestamp DESC)` - time-series queries
- `server_plugin_installations(server_id)` - plugin lookups
- `plugins(minecraft_versions)` - compatibility filtering

**Unique Constraints**:

- `user_accounts(email)`
- `server_instances(tenant_id, external_port)`
- `sku_configurations(name)`
- `server_plugin_installations(server_id, plugin_id)`
