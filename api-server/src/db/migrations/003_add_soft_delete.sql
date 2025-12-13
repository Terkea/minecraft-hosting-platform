-- Add soft delete support for server deletion cleanup
-- Records are preserved with deleted_at timestamp instead of being hard deleted

-- Add deleted_at column to backups table
ALTER TABLE backups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Add deleted_at column to backup_schedules table
ALTER TABLE backup_schedules ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for filtering out deleted records efficiently
CREATE INDEX IF NOT EXISTS idx_backups_not_deleted ON backups(server_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_backup_schedules_not_deleted ON backup_schedules(server_id) WHERE deleted_at IS NULL;
