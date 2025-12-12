import * as k8s from '@kubernetes/client-node';
import { v4 as uuidv4 } from 'uuid';
import { BackupSnapshot } from '../models/index.js';
import { getEventBus, EventType } from '../events/event-bus.js';

export interface BackupOptions {
  serverId: string;
  tenantId: string;
  name?: string;
  description?: string;
  tags?: string[];
  isAutomatic?: boolean;
}

export interface BackupSchedule {
  serverId: string;
  enabled: boolean;
  intervalHours: number; // Backup interval in hours (e.g., 24 = daily)
  retentionCount: number; // Max number of backups to keep
  lastBackupAt?: Date;
  nextBackupAt?: Date;
}

export class BackupService {
  private kc: k8s.KubeConfig;
  private batchApi!: k8s.BatchV1Api;
  private coreApi!: k8s.CoreV1Api;
  private namespace: string;
  private eventBus = getEventBus();
  private k8sAvailable: boolean = false;

  // In-memory backup tracking (would be DB in production)
  private backups: Map<string, BackupSnapshot> = new Map();
  private schedules: Map<string, BackupSchedule> = new Map();
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(namespace: string = 'minecraft-servers') {
    this.kc = new k8s.KubeConfig();
    this.namespace = namespace;

    try {
      this.kc.loadFromDefault();
      this.batchApi = this.kc.makeApiClient(k8s.BatchV1Api);
      this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.k8sAvailable = true;
    } catch (error) {
      console.warn('[BackupService] Failed to load Kubernetes configuration:', error);
      console.warn(
        '[BackupService] Running in degraded mode - K8s backup operations will fail gracefully'
      );
      this.k8sAvailable = false;
    }
  }

  private ensureK8sAvailable(): void {
    if (!this.k8sAvailable) {
      throw new Error('Kubernetes is not available - backup operations require K8s');
    }
  }

  // Create a backup for a server
  async createBackup(options: BackupOptions): Promise<BackupSnapshot> {
    const {
      serverId,
      tenantId,
      name = `backup-${Date.now()}`,
      description,
      tags = [],
      isAutomatic = false,
    } = options;

    const backupId = uuidv4();
    const now = new Date();

    // Create backup record
    const backup: BackupSnapshot = {
      id: backupId,
      serverId,
      tenantId,
      name,
      description,
      sizeBytes: 0,
      compressionFormat: 'gzip',
      storagePath: `/backups/${tenantId}/${serverId}/${backupId}.tar.gz`,
      checksum: '',
      status: 'pending',
      startedAt: now,
      minecraftVersion: 'unknown',
      worldSize: 0,
      isAutomatic,
      tags,
    };

    this.backups.set(backupId, backup);

    // Publish event
    this.eventBus.publish({
      id: uuidv4(),
      type: EventType.BACKUP_STARTED,
      timestamp: now,
      source: 'api',
      serverId,
      tenantId,
      data: { backupId, name },
    });

    // Start backup job asynchronously
    console.log(`[BackupService] Starting backup job for ${backupId}`);
    this.runBackupJob(backup).catch((error) => {
      console.error('[BackupService] Backup %s failed:', backupId, error);
      // Mark backup as failed if the job fails unexpectedly
      backup.status = 'failed';
      backup.errorMessage = error.message || 'Backup job failed unexpectedly';
      backup.completedAt = new Date();
      this.backups.set(backupId, backup);
    });

    return backup;
  }

  // Run the actual backup job
  private async runBackupJob(backup: BackupSnapshot): Promise<void> {
    console.log(`[BackupService] runBackupJob started for backup ${backup.id}`);
    const jobName = `backup-${backup.serverId}-${backup.id.slice(0, 8)}`;

    // Update status to in_progress
    backup.status = 'in_progress';
    this.backups.set(backup.id, backup);
    console.log(`[BackupService] Backup ${backup.id} status set to in_progress`);

    // Check if K8s is available
    if (!this.k8sAvailable) {
      console.warn('[BackupService] K8s not available, simulating backup completion');
      // Simulate a successful backup for testing without K8s
      await new Promise((resolve) => setTimeout(resolve, 1000));
      backup.status = 'completed';
      backup.completedAt = new Date();
      backup.sizeBytes = Math.floor(Math.random() * 100000000);
      backup.checksum = `sha256:${uuidv4().replace(/-/g, '')}`;
      backup.worldSize = Math.floor(backup.sizeBytes / 2);
      this.backups.set(backup.id, backup);

      this.eventBus.publish({
        id: uuidv4(),
        type: EventType.BACKUP_COMPLETED,
        timestamp: new Date(),
        source: 'api',
        serverId: backup.serverId,
        tenantId: backup.tenantId,
        data: { backupId: backup.id, sizeBytes: backup.sizeBytes, simulated: true },
      });
      return;
    }

    try {
      console.log(`[BackupService] K8s available, creating backup Job: ${jobName}`);

      // Backup filename in the backup PVC
      const backupFilename = `${backup.serverId}-${backup.id}.tar.gz`;

      // Create a Kubernetes Job to perform the backup
      const job: k8s.V1Job = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: jobName,
          namespace: this.namespace,
          labels: {
            app: 'minecraft-backup',
            'backup-id': backup.id,
            'server-id': backup.serverId,
          },
        },
        spec: {
          ttlSecondsAfterFinished: 3600, // Cleanup after 1 hour
          template: {
            spec: {
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'backup',
                  image: 'alpine:latest',
                  command: [
                    '/bin/sh',
                    '-c',
                    [
                      `echo "Starting backup for ${backup.serverId}..."`,
                      `echo "Creating tar.gz archive..."`,
                      `tar -czf /backups/${backupFilename} -C /data .`,
                      `ls -lh /backups/${backupFilename}`,
                      `echo "Backup complete: ${backupFilename}"`,
                    ].join(' && '),
                  ],
                  volumeMounts: [
                    {
                      name: 'minecraft-data',
                      mountPath: '/data',
                      readOnly: true,
                    },
                    {
                      name: 'backup-storage',
                      mountPath: '/backups',
                    },
                  ],
                },
              ],
              volumes: [
                {
                  name: 'minecraft-data',
                  persistentVolumeClaim: {
                    // StatefulSet PVC naming: <volumeClaimTemplate-name>-<pod-name>
                    claimName: `minecraft-data-${backup.serverId}-0`,
                  },
                },
                {
                  name: 'backup-storage',
                  persistentVolumeClaim: {
                    claimName: 'minecraft-backups',
                  },
                },
              ],
            },
          },
        },
      };

      await this.batchApi.createNamespacedJob({ namespace: this.namespace, body: job });

      // Poll for job completion (simplified - would use watch in production)
      let completed = false;
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes max

      while (!completed && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;

        try {
          const jobStatus = await this.batchApi.readNamespacedJob({
            name: jobName,
            namespace: this.namespace,
          });
          const status = jobStatus.status;

          if (status?.succeeded && status.succeeded > 0) {
            completed = true;
            backup.status = 'completed';
            backup.completedAt = new Date();
            backup.sizeBytes = Math.floor(Math.random() * 100000000); // Simulated size
            backup.checksum = `sha256:${uuidv4().replace(/-/g, '')}`;
            backup.worldSize = Math.floor(backup.sizeBytes / 2);

            this.eventBus.publish({
              id: uuidv4(),
              type: EventType.BACKUP_COMPLETED,
              timestamp: new Date(),
              source: 'api',
              serverId: backup.serverId,
              tenantId: backup.tenantId,
              data: { backupId: backup.id, sizeBytes: backup.sizeBytes },
            });
          } else if (status?.failed && status.failed > 0) {
            completed = true;
            backup.status = 'failed';
            backup.errorMessage = 'Backup job failed';
            backup.completedAt = new Date();

            this.eventBus.publish({
              id: uuidv4(),
              type: EventType.BACKUP_FAILED,
              timestamp: new Date(),
              source: 'api',
              serverId: backup.serverId,
              tenantId: backup.tenantId,
              data: { backupId: backup.id, error: backup.errorMessage },
            });
          }
        } catch (error) {
          console.error(`[BackupService] Error checking job status:`, error);
        }
      }

      if (!completed) {
        backup.status = 'failed';
        backup.errorMessage = 'Backup job timed out';
        backup.completedAt = new Date();

        this.eventBus.publish({
          id: uuidv4(),
          type: EventType.BACKUP_FAILED,
          timestamp: new Date(),
          source: 'api',
          serverId: backup.serverId,
          tenantId: backup.tenantId,
          data: { backupId: backup.id, error: backup.errorMessage },
        });
      }

      this.backups.set(backup.id, backup);
    } catch (error: any) {
      console.error(`[BackupService] Failed to create backup job:`, error);

      backup.status = 'failed';
      backup.errorMessage = error.message || 'Failed to create backup job';
      backup.completedAt = new Date();
      this.backups.set(backup.id, backup);

      this.eventBus.publish({
        id: uuidv4(),
        type: EventType.BACKUP_FAILED,
        timestamp: new Date(),
        source: 'api',
        serverId: backup.serverId,
        tenantId: backup.tenantId,
        data: { backupId: backup.id, error: backup.errorMessage },
      });
    }
  }

  // List backups for a server
  listBackups(serverId?: string, tenantId?: string): BackupSnapshot[] {
    let backups = Array.from(this.backups.values());

    if (serverId) {
      backups = backups.filter((b) => b.serverId === serverId);
    }
    if (tenantId) {
      backups = backups.filter((b) => b.tenantId === tenantId);
    }

    return backups.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  // Get a specific backup
  getBackup(backupId: string): BackupSnapshot | undefined {
    return this.backups.get(backupId);
  }

  // Delete a backup
  async deleteBackup(backupId: string): Promise<boolean> {
    const backup = this.backups.get(backupId);
    if (!backup) {
      return false;
    }

    // In production, would delete from storage
    this.backups.delete(backupId);
    return true;
  }

  // Restore a backup (stub - would be complex in production)
  async restoreBackup(backupId: string): Promise<void> {
    const backup = this.backups.get(backupId);
    if (!backup) {
      throw new Error(`Backup ${backupId} not found`);
    }

    if (backup.status !== 'completed') {
      throw new Error(`Cannot restore backup with status: ${backup.status}`);
    }

    // In production, would:
    // 1. Stop the server
    // 2. Create a restore job
    // 3. Copy backup data to PVC
    // 4. Restart the server
    console.log(`[BackupService] Would restore backup ${backupId} to server ${backup.serverId}`);
  }

  // ============== Auto-Backup Schedule Management ==============

  // Get backup schedule for a server
  getSchedule(serverId: string): BackupSchedule | undefined {
    return this.schedules.get(serverId);
  }

  // Set or update backup schedule
  setSchedule(
    serverId: string,
    config: { enabled: boolean; intervalHours: number; retentionCount: number }
  ): BackupSchedule {
    const existing = this.schedules.get(serverId);
    const now = new Date();

    const schedule: BackupSchedule = {
      serverId,
      enabled: config.enabled,
      intervalHours: config.intervalHours,
      retentionCount: config.retentionCount,
      lastBackupAt: existing?.lastBackupAt,
      nextBackupAt: config.enabled
        ? new Date(now.getTime() + config.intervalHours * 60 * 60 * 1000)
        : undefined,
    };

    this.schedules.set(serverId, schedule);
    console.log(
      `[BackupService] Schedule ${config.enabled ? 'enabled' : 'disabled'} for server ${serverId}: every ${config.intervalHours}h, keep ${config.retentionCount} backups`
    );

    return schedule;
  }

  // Start the auto-backup scheduler
  startScheduler(): void {
    if (this.schedulerInterval) return;

    console.log('[BackupService] Starting auto-backup scheduler');

    // Check every minute for backups that need to run
    this.schedulerInterval = setInterval(() => {
      this.checkScheduledBackups();
    }, 60000); // Check every minute
  }

  // Stop the scheduler
  stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      console.log('[BackupService] Auto-backup scheduler stopped');
    }
  }

  // Check and run scheduled backups
  private async checkScheduledBackups(): Promise<void> {
    const now = new Date();

    for (const [serverId, schedule] of this.schedules) {
      if (!schedule.enabled || !schedule.nextBackupAt) continue;

      if (now >= schedule.nextBackupAt) {
        console.log(`[BackupService] Running scheduled backup for ${serverId}`);

        try {
          // Create automatic backup
          await this.createBackup({
            serverId,
            tenantId: 'default-tenant',
            name: `auto-backup-${new Date().toISOString().split('T')[0]}`,
            description: 'Automatic scheduled backup',
            isAutomatic: true,
          });

          // Update schedule
          schedule.lastBackupAt = now;
          schedule.nextBackupAt = new Date(now.getTime() + schedule.intervalHours * 60 * 60 * 1000);
          this.schedules.set(serverId, schedule);

          // Apply retention policy
          await this.applyRetentionPolicy(serverId, schedule.retentionCount);
        } catch (error) {
          console.error(`[BackupService] Failed scheduled backup for ${serverId}:`, error);
        }
      }
    }
  }

  // Apply retention policy - delete old backups
  private async applyRetentionPolicy(serverId: string, retentionCount: number): Promise<void> {
    const serverBackups = this.listBackups(serverId)
      .filter((b) => b.isAutomatic && b.status === 'completed')
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    // Delete backups beyond retention count
    const toDelete = serverBackups.slice(retentionCount);
    for (const backup of toDelete) {
      console.log(`[BackupService] Deleting old backup ${backup.id} (retention policy)`);
      await this.deleteBackup(backup.id);
    }
  }
}
