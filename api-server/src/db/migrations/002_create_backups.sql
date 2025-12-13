-- Backup snapshots table
CREATE TABLE IF NOT EXISTS backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Backup details
  size_bytes BIGINT DEFAULT 0,
  compression_format VARCHAR(50) DEFAULT 'gzip',
  storage_path TEXT NOT NULL,
  checksum VARCHAR(255),

  -- Google Drive integration
  drive_file_id VARCHAR(255),
  drive_web_link TEXT,

  -- Status
  status VARCHAR(50) DEFAULT 'pending' NOT NULL,
  error_message TEXT,

  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Metadata
  minecraft_version VARCHAR(50) DEFAULT 'unknown',
  world_size BIGINT DEFAULT 0,
  is_automatic BOOLEAN DEFAULT FALSE,
  tags TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_backups_server_id ON backups(server_id);
CREATE INDEX IF NOT EXISTS idx_backups_tenant_id ON backups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status);
CREATE INDEX IF NOT EXISTS idx_backups_started_at ON backups(started_at DESC);

-- Backup schedules table
CREATE TABLE IF NOT EXISTS backup_schedules (
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

-- Index for finding enabled schedules
CREATE INDEX IF NOT EXISTS idx_backup_schedules_enabled ON backup_schedules(enabled) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_backup_schedules_next_backup ON backup_schedules(next_backup_at) WHERE enabled = TRUE;
