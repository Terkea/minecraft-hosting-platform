import { v4 as uuidv4 } from 'uuid';
import { getPool, type Pool } from './connection.js';
import { BackupSnapshot } from '../models/index.js';

/**
 * Backup schedule configuration
 */
export interface BackupSchedule {
  serverId: string;
  tenantId: string;
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
  lastBackupAt?: Date;
  nextBackupAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Database row types (snake_case columns)
 */
interface BackupRow {
  id: string;
  server_id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  size_bytes: string; // bigint comes as string
  compression_format: string;
  storage_path: string;
  checksum: string | null;
  drive_file_id: string | null;
  drive_web_link: string | null;
  status: string;
  error_message: string | null;
  started_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  minecraft_version: string;
  world_size: string; // bigint comes as string
  is_automatic: boolean;
  tags: string[];
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface ScheduleRow {
  server_id: string;
  tenant_id: string;
  enabled: boolean;
  interval_hours: number;
  retention_count: number;
  last_backup_at: Date | null;
  next_backup_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * Database-backed backup store using CockroachDB/PostgreSQL.
 */
export class BackupStoreDB {
  private pool: Pool | null = null;

  /**
   * Initialize the database connection.
   */
  async initialize(): Promise<void> {
    this.pool = await getPool();
    console.log('[BackupStore] Database connection initialized');
  }

  private getPool(): Pool {
    if (!this.pool) {
      throw new Error('BackupStore not initialized. Call initialize() first.');
    }
    return this.pool;
  }

  /**
   * Derive K8s resource name from server UUID.
   * Format: mc-{first 12 hex chars of UUID without dashes}
   */
  private deriveServerName(serverId: string): string {
    return 'mc-' + serverId.replace(/-/g, '').substring(0, 12);
  }

  /**
   * Map database row to BackupSnapshot interface
   */
  private mapRowToBackup(row: BackupRow): BackupSnapshot {
    return {
      id: row.id,
      serverId: row.server_id,
      serverName: this.deriveServerName(row.server_id), // Derived from serverId
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description || undefined,
      sizeBytes: parseInt(row.size_bytes, 10),
      compressionFormat: row.compression_format as 'gzip' | 'lz4' | 'none',
      storagePath: row.storage_path,
      checksum: row.checksum || '',
      driveFileId: row.drive_file_id || undefined,
      driveWebLink: row.drive_web_link || undefined,
      status: row.status as 'pending' | 'in_progress' | 'completed' | 'failed',
      errorMessage: row.error_message || undefined,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      minecraftVersion: row.minecraft_version,
      worldSize: parseInt(row.world_size, 10),
      isAutomatic: row.is_automatic,
      tags: row.tags || [],
    };
  }

  /**
   * Map database row to BackupSchedule interface
   */
  private mapRowToSchedule(row: ScheduleRow): BackupSchedule {
    return {
      serverId: row.server_id,
      tenantId: row.tenant_id,
      enabled: row.enabled,
      intervalHours: row.interval_hours,
      retentionCount: row.retention_count,
      lastBackupAt: row.last_backup_at ? new Date(row.last_backup_at) : undefined,
      nextBackupAt: row.next_backup_at ? new Date(row.next_backup_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ============== Backup Operations ==============

  /**
   * Create a new backup record.
   * Note: 'serverName' is excluded because it's derived from 'serverId' when reading.
   */
  async createBackup(backup: Omit<BackupSnapshot, 'id' | 'serverName'>): Promise<BackupSnapshot> {
    const id = uuidv4();
    const now = new Date();

    const result = await this.getPool().query<BackupRow>(
      `INSERT INTO backups (
        id, server_id, tenant_id, name, description,
        size_bytes, compression_format, storage_path, checksum,
        drive_file_id, drive_web_link, status, error_message,
        started_at, completed_at, expires_at,
        minecraft_version, world_size, is_automatic, tags,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *`,
      [
        id,
        backup.serverId,
        backup.tenantId,
        backup.name,
        backup.description || null,
        backup.sizeBytes,
        backup.compressionFormat,
        backup.storagePath,
        backup.checksum || null,
        backup.driveFileId || null,
        backup.driveWebLink || null,
        backup.status,
        backup.errorMessage || null,
        backup.startedAt,
        backup.completedAt || null,
        backup.expiresAt || null,
        backup.minecraftVersion,
        backup.worldSize,
        backup.isAutomatic,
        backup.tags,
        now,
        now,
      ]
    );

    const created = this.mapRowToBackup(result.rows[0]);
    console.log(`[BackupStore] Created backup: ${created.name} (${created.id})`);
    return created;
  }

  /**
   * Get backup by ID (excludes soft-deleted records)
   */
  async getBackupById(id: string): Promise<BackupSnapshot | undefined> {
    const result = await this.getPool().query<BackupRow>(
      'SELECT * FROM backups WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return result.rows[0] ? this.mapRowToBackup(result.rows[0]) : undefined;
  }

  /**
   * Get backup by ID with tenant verification (prevents IDOR, excludes soft-deleted)
   */
  async getBackupByIdForTenant(id: string, tenantId: string): Promise<BackupSnapshot | undefined> {
    const result = await this.getPool().query<BackupRow>(
      'SELECT * FROM backups WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );
    return result.rows[0] ? this.mapRowToBackup(result.rows[0]) : undefined;
  }

  /**
   * Update a backup
   */
  async updateBackup(
    id: string,
    updates: Partial<Omit<BackupSnapshot, 'id' | 'serverId' | 'tenantId'>>
  ): Promise<BackupSnapshot | undefined> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      sizeBytes: 'size_bytes',
      compressionFormat: 'compression_format',
      storagePath: 'storage_path',
      checksum: 'checksum',
      driveFileId: 'drive_file_id',
      driveWebLink: 'drive_web_link',
      status: 'status',
      errorMessage: 'error_message',
      completedAt: 'completed_at',
      expiresAt: 'expires_at',
      minecraftVersion: 'minecraft_version',
      worldSize: 'world_size',
      isAutomatic: 'is_automatic',
      tags: 'tags',
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if ((updates as Record<string, unknown>)[key] !== undefined) {
        setClauses.push(`${dbField} = $${paramIndex++}`);
        values.push((updates as Record<string, unknown>)[key]);
      }
    }

    if (setClauses.length === 0) {
      return this.getBackupById(id);
    }

    // Always update updated_at
    setClauses.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());
    values.push(id);

    const result = await this.getPool().query<BackupRow>(
      `UPDATE backups SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows[0]) {
      const backup = this.mapRowToBackup(result.rows[0]);
      console.log(`[BackupStore] Updated backup: ${backup.name} (${backup.id})`);
      return backup;
    }
    return undefined;
  }

  /**
   * Delete a backup
   */
  async deleteBackup(id: string): Promise<boolean> {
    const result = await this.getPool().query('DELETE FROM backups WHERE id = $1 RETURNING id', [
      id,
    ]);
    if ((result.rowCount ?? 0) > 0) {
      console.log(`[BackupStore] Deleted backup: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * List backups with optional filters (excludes soft-deleted records)
   */
  async listBackups(serverId?: string, tenantId?: string): Promise<BackupSnapshot[]> {
    let query = 'SELECT * FROM backups';
    const conditions: string[] = ['deleted_at IS NULL'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (serverId) {
      conditions.push(`server_id = $${paramIndex++}`);
      values.push(serverId);
    }
    if (tenantId) {
      conditions.push(`tenant_id = $${paramIndex++}`);
      values.push(tenantId);
    }

    query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY started_at DESC';

    const result = await this.getPool().query<BackupRow>(query, values);
    return result.rows.map((row) => this.mapRowToBackup(row));
  }

  /**
   * Get automatic backups for retention policy (excludes soft-deleted)
   */
  async getAutomaticBackups(serverId: string): Promise<BackupSnapshot[]> {
    const result = await this.getPool().query<BackupRow>(
      `SELECT * FROM backups
       WHERE server_id = $1 AND is_automatic = TRUE AND status = 'completed' AND deleted_at IS NULL
       ORDER BY started_at DESC`,
      [serverId]
    );
    return result.rows.map((row) => this.mapRowToBackup(row));
  }

  // ============== Schedule Operations ==============

  /**
   * Get schedule by server ID (excludes soft-deleted)
   */
  async getSchedule(serverId: string): Promise<BackupSchedule | undefined> {
    const result = await this.getPool().query<ScheduleRow>(
      'SELECT * FROM backup_schedules WHERE server_id = $1 AND deleted_at IS NULL',
      [serverId]
    );
    return result.rows[0] ? this.mapRowToSchedule(result.rows[0]) : undefined;
  }

  /**
   * Create or update a schedule (upsert)
   */
  async setSchedule(
    serverId: string,
    tenantId: string,
    config: { enabled: boolean; intervalHours: number; retentionCount: number }
  ): Promise<BackupSchedule> {
    const now = new Date();
    const nextBackupAt = config.enabled
      ? new Date(now.getTime() + config.intervalHours * 60 * 60 * 1000)
      : null;

    const result = await this.getPool().query<ScheduleRow>(
      `INSERT INTO backup_schedules (
        server_id, tenant_id, enabled, interval_hours, retention_count, next_backup_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (server_id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        enabled = EXCLUDED.enabled,
        interval_hours = EXCLUDED.interval_hours,
        retention_count = EXCLUDED.retention_count,
        next_backup_at = EXCLUDED.next_backup_at,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        serverId,
        tenantId,
        config.enabled,
        config.intervalHours,
        config.retentionCount,
        nextBackupAt,
        now,
        now,
      ]
    );

    const schedule = this.mapRowToSchedule(result.rows[0]);
    console.log(
      `[BackupStore] Schedule ${config.enabled ? 'enabled' : 'disabled'} for ${serverId}: every ${config.intervalHours}h, keep ${config.retentionCount} backups`
    );
    return schedule;
  }

  /**
   * Update schedule after a backup completes
   */
  async updateScheduleAfterBackup(serverId: string): Promise<void> {
    const schedule = await this.getSchedule(serverId);
    if (!schedule || !schedule.enabled) return;

    const now = new Date();
    const nextBackupAt = new Date(now.getTime() + schedule.intervalHours * 60 * 60 * 1000);

    await this.getPool().query(
      `UPDATE backup_schedules SET last_backup_at = $1, next_backup_at = $2, updated_at = $3 WHERE server_id = $4`,
      [now, nextBackupAt, now, serverId]
    );
  }

  /**
   * Get all enabled schedules that need to run (excludes soft-deleted)
   */
  async getDueSchedules(): Promise<BackupSchedule[]> {
    const now = new Date();
    const result = await this.getPool().query<ScheduleRow>(
      `SELECT * FROM backup_schedules WHERE enabled = TRUE AND next_backup_at <= $1 AND deleted_at IS NULL`,
      [now]
    );
    return result.rows.map((row) => this.mapRowToSchedule(row));
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(serverId: string): Promise<boolean> {
    const result = await this.getPool().query(
      'DELETE FROM backup_schedules WHERE server_id = $1 RETURNING server_id',
      [serverId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ============== Server Cleanup Operations ==============

  /**
   * Soft-delete all backup records and schedules for a server.
   * Used when a server is deleted to preserve audit trail while hiding records.
   * Returns counts of affected records.
   */
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

    const counts = {
      backups: backupsResult.rowCount ?? 0,
      schedules: schedulesResult.rowCount ?? 0,
    };

    console.log(
      `[BackupStore] Soft-deleted records for server ${serverId}: ${counts.backups} backups, ${counts.schedules} schedules`
    );

    return counts;
  }
}

// Singleton instance
export const backupStore = new BackupStoreDB();
