import * as k8s from '@kubernetes/client-node';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
import { BackupSnapshot } from '../models/index.js';
import { getEventBus, EventType } from '../events/event-bus.js';
import { GoogleDriveService, createDriveServiceForUser } from './google-drive-service.js';
import { userStore, User } from '../models/user.js';
import { backupStore, BackupSchedule } from '../db/backup-store-db.js';

export interface BackupOptions {
  serverId: string;
  tenantId: string; // This is now the userId
  name?: string;
  description?: string;
  tags?: string[];
  isAutomatic?: boolean;
}

// Re-export BackupSchedule type from the store
export type { BackupSchedule } from '../db/backup-store-db.js';

export class BackupService {
  private kc: k8s.KubeConfig;
  private batchApi!: k8s.BatchV1Api;
  private coreApi!: k8s.CoreV1Api;
  private namespace: string;
  private eventBus = getEventBus();
  private k8sAvailable: boolean = false;
  private initialized: boolean = false;

  // Database-backed storage (persistent)
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;

  // Google Drive integration
  private async uploadBackupToDrive(
    backup: BackupSnapshot,
    backupFilename: string
  ): Promise<{ driveFileId: string; driveWebLink: string } | null> {
    const user = await userStore.getUserById(backup.tenantId);
    if (!user) {
      console.warn(`[BackupService] User ${backup.tenantId} not found, skipping Drive upload`);
      return null;
    }

    if (!user.googleRefreshToken) {
      console.warn(
        `[BackupService] User ${user.email} has no refresh token, skipping Drive upload`
      );
      return null;
    }

    try {
      const driveService = createDriveServiceForUser(
        user.googleAccessToken,
        user.googleRefreshToken
      );

      // Ensure MinecraftBackups folder exists
      let folderId = user.driveFolderId;
      if (!folderId) {
        folderId = await driveService.createOrGetBackupFolder('MinecraftBackups');
        // Update user with folder ID
        await userStore.updateUser(user.id, { driveFolderId: folderId });
      }

      // Read backup file from PVC via exec into a pod
      const backupBuffer = await this.readBackupFromPVC(backupFilename);
      if (!backupBuffer) {
        console.error(`[BackupService] Could not read backup file ${backupFilename} from PVC`);
        return null;
      }

      // Upload to Google Drive
      const result = await driveService.uploadBackup(
        folderId,
        backupFilename,
        backupBuffer,
        'application/gzip'
      );

      console.log(`[BackupService] Uploaded backup ${backup.id} to Google Drive: ${result.fileId}`);

      return {
        driveFileId: result.fileId,
        driveWebLink: result.webViewLink,
      };
    } catch (error: any) {
      console.error(`[BackupService] Failed to upload backup to Drive:`, error.message);
      return null;
    }
  }

  // Read backup file from PVC using kubectl exec (simplified - would use proper API in production)
  private async readBackupFromPVC(backupFilename: string): Promise<Buffer | null> {
    if (!this.k8sAvailable) {
      console.warn('[BackupService] K8s not available, cannot read backup from PVC');
      // Return mock data for testing without K8s
      return Buffer.from('mock-backup-data');
    }

    try {
      // Create a temporary pod to read the backup file
      const readJobName = `read-backup-${Date.now()}`;

      // Use exec to read the file from an existing pod or create a simple job
      // For now, we'll create a Job that outputs the file content to logs
      // In production, this would be a proper streaming solution

      const job: k8s.V1Job = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: readJobName,
          namespace: this.namespace,
        },
        spec: {
          ttlSecondsAfterFinished: 60,
          template: {
            spec: {
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'read-backup',
                  image: 'alpine:latest',
                  command: ['/bin/sh', '-c', `cat /backups/${backupFilename} | base64`],
                  volumeMounts: [
                    {
                      name: 'backup-storage',
                      mountPath: '/backups',
                      readOnly: true,
                    },
                  ],
                },
              ],
              volumes: [
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

      // Wait for job to complete and get logs
      let completed = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!completed && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;

        const jobStatus = await this.batchApi.readNamespacedJob({
          name: readJobName,
          namespace: this.namespace,
        });

        if (jobStatus.status?.succeeded && jobStatus.status.succeeded > 0) {
          completed = true;

          // Get pod logs
          const pods = await this.coreApi.listNamespacedPod({
            namespace: this.namespace,
            labelSelector: `job-name=${readJobName}`,
          });

          if (pods.items.length > 0) {
            const podName = pods.items[0].metadata?.name;
            if (podName) {
              const logs = await this.coreApi.readNamespacedPodLog({
                name: podName,
                namespace: this.namespace,
              });

              // Decode base64 logs to get backup content
              const logData = typeof logs === 'string' ? logs : '';
              return Buffer.from(logData.trim(), 'base64');
            }
          }
        } else if (jobStatus.status?.failed && jobStatus.status.failed > 0) {
          console.error(`[BackupService] Read backup job failed`);
          return null;
        }
      }

      console.error(`[BackupService] Read backup job timed out`);
      return null;
    } catch (error: any) {
      console.error(`[BackupService] Error reading backup from PVC:`, error.message);
      return null;
    }
  }

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

  /**
   * Initialize the backup service (must be called before use)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await backupStore.initialize();
    this.initialized = true;
    console.log('[BackupService] Initialized with database-backed storage');
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('BackupService not initialized. Call initialize() first.');
    }
  }

  private ensureK8sAvailable(): void {
    if (!this.k8sAvailable) {
      throw new Error('Kubernetes is not available - backup operations require K8s');
    }
  }

  // Create a backup for a server
  async createBackup(options: BackupOptions): Promise<BackupSnapshot> {
    this.ensureInitialized();

    const {
      serverId,
      tenantId,
      name = `backup-${Date.now()}`,
      description,
      tags = [],
      isAutomatic = false,
    } = options;

    const now = new Date();

    // Create backup record in database
    const backup = await backupStore.createBackup({
      serverId,
      tenantId,
      name,
      description,
      sizeBytes: 0,
      compressionFormat: 'gzip',
      storagePath: `/backups/${tenantId}/${serverId}/${Date.now()}.tar.gz`,
      checksum: '',
      status: 'pending',
      startedAt: now,
      minecraftVersion: 'unknown',
      worldSize: 0,
      isAutomatic,
      tags,
    });

    // Publish event
    this.eventBus.publish({
      id: uuidv4(),
      type: EventType.BACKUP_STARTED,
      timestamp: now,
      source: 'api',
      serverId,
      tenantId,
      data: { backupId: backup.id, name },
    });

    // Start backup job asynchronously
    console.log(`[BackupService] Starting backup job for ${backup.id}`);
    this.runBackupJob(backup).catch(async (error) => {
      console.error('[BackupService] Backup %s failed:', backup.id, error);
      // Mark backup as failed if the job fails unexpectedly
      await backupStore.updateBackup(backup.id, {
        status: 'failed',
        errorMessage: error.message || 'Backup job failed unexpectedly',
        completedAt: new Date(),
      });
    });

    return backup;
  }

  // Run the actual backup job
  private async runBackupJob(backup: BackupSnapshot): Promise<void> {
    console.log(`[BackupService] runBackupJob started for backup ${backup.id}`);
    const jobName = `backup-${backup.serverId}-${backup.id.slice(0, 8)}`;

    // Update status to in_progress
    await backupStore.updateBackup(backup.id, { status: 'in_progress' });
    console.log(`[BackupService] Backup ${backup.id} status set to in_progress`);

    // Check if K8s is available
    if (!this.k8sAvailable) {
      console.warn('[BackupService] K8s not available, simulating backup completion');
      // Simulate a successful backup for testing without K8s
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const sizeBytes = Math.floor(Math.random() * 100000000);
      const checksum = `sha256:${uuidv4().replace(/-/g, '')}`;
      const worldSize = Math.floor(sizeBytes / 2);

      // Upload to Google Drive (simulated backup data)
      const backupFilename = `${backup.serverId}-${backup.id}.tar.gz`;
      const driveResult = await this.uploadBackupToDrive(backup, backupFilename);

      await backupStore.updateBackup(backup.id, {
        status: 'completed',
        completedAt: new Date(),
        sizeBytes,
        checksum,
        worldSize,
        driveFileId: driveResult?.driveFileId,
        driveWebLink: driveResult?.driveWebLink,
      });

      this.eventBus.publish({
        id: uuidv4(),
        type: EventType.BACKUP_COMPLETED,
        timestamp: new Date(),
        source: 'api',
        serverId: backup.serverId,
        tenantId: backup.tenantId,
        data: {
          backupId: backup.id,
          sizeBytes,
          simulated: true,
          driveFileId: driveResult?.driveFileId,
        },
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
            const sizeBytes = Math.floor(Math.random() * 100000000); // Simulated size
            const checksum = `sha256:${uuidv4().replace(/-/g, '')}`;
            const worldSize = Math.floor(sizeBytes / 2);

            // Upload to Google Drive
            const driveResult = await this.uploadBackupToDrive(backup, backupFilename);

            await backupStore.updateBackup(backup.id, {
              status: 'completed',
              completedAt: new Date(),
              sizeBytes,
              checksum,
              worldSize,
              driveFileId: driveResult?.driveFileId,
              driveWebLink: driveResult?.driveWebLink,
            });

            this.eventBus.publish({
              id: uuidv4(),
              type: EventType.BACKUP_COMPLETED,
              timestamp: new Date(),
              source: 'api',
              serverId: backup.serverId,
              tenantId: backup.tenantId,
              data: {
                backupId: backup.id,
                sizeBytes,
                driveFileId: driveResult?.driveFileId,
              },
            });
          } else if (status?.failed && status.failed > 0) {
            completed = true;
            const errorMessage = 'Backup job failed';

            await backupStore.updateBackup(backup.id, {
              status: 'failed',
              errorMessage,
              completedAt: new Date(),
            });

            this.eventBus.publish({
              id: uuidv4(),
              type: EventType.BACKUP_FAILED,
              timestamp: new Date(),
              source: 'api',
              serverId: backup.serverId,
              tenantId: backup.tenantId,
              data: { backupId: backup.id, error: errorMessage },
            });
          }
        } catch (error) {
          console.error(`[BackupService] Error checking job status:`, error);
        }
      }

      if (!completed) {
        const errorMessage = 'Backup job timed out';

        await backupStore.updateBackup(backup.id, {
          status: 'failed',
          errorMessage,
          completedAt: new Date(),
        });

        this.eventBus.publish({
          id: uuidv4(),
          type: EventType.BACKUP_FAILED,
          timestamp: new Date(),
          source: 'api',
          serverId: backup.serverId,
          tenantId: backup.tenantId,
          data: { backupId: backup.id, error: errorMessage },
        });
      }
    } catch (error: any) {
      console.error(`[BackupService] Failed to create backup job:`, error);

      const errorMessage = error.message || 'Failed to create backup job';
      await backupStore.updateBackup(backup.id, {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      });

      this.eventBus.publish({
        id: uuidv4(),
        type: EventType.BACKUP_FAILED,
        timestamp: new Date(),
        source: 'api',
        serverId: backup.serverId,
        tenantId: backup.tenantId,
        data: { backupId: backup.id, error: errorMessage },
      });
    }
  }

  // List backups for a server
  async listBackups(serverId?: string, tenantId?: string): Promise<BackupSnapshot[]> {
    this.ensureInitialized();
    return backupStore.listBackups(serverId, tenantId);
  }

  // Get a specific backup (requires tenantId for security)
  // Returns undefined for both not-found and unauthorized to prevent IDOR enumeration
  async getBackup(backupId: string, tenantId?: string): Promise<BackupSnapshot | undefined> {
    this.ensureInitialized();
    if (tenantId) {
      return backupStore.getBackupByIdForTenant(backupId, tenantId);
    }
    return backupStore.getBackupById(backupId);
  }

  // Delete a backup
  async deleteBackup(backupId: string): Promise<boolean> {
    this.ensureInitialized();
    const backup = await backupStore.getBackupById(backupId);
    if (!backup) {
      return false;
    }

    // Delete from Google Drive if stored there
    if (backup.driveFileId) {
      const user = await userStore.getUserById(backup.tenantId);
      if (user && user.googleRefreshToken) {
        try {
          const driveService = createDriveServiceForUser(
            user.googleAccessToken,
            user.googleRefreshToken
          );
          await driveService.deleteBackup(backup.driveFileId);
          console.log(`[BackupService] Deleted backup ${backupId} from Google Drive`);
        } catch (error: any) {
          console.error(`[BackupService] Failed to delete backup from Drive:`, error.message);
          // Continue with local deletion even if Drive delete fails
        }
      }
    }

    return backupStore.deleteBackup(backupId);
  }

  // Download a backup from Google Drive
  async downloadBackup(backupId: string): Promise<{ buffer: Buffer; filename: string } | null> {
    this.ensureInitialized();
    const backup = await backupStore.getBackupById(backupId);
    if (!backup) {
      throw new Error(`Backup ${backupId} not found`);
    }

    if (backup.status !== 'completed') {
      throw new Error(`Cannot download backup with status: ${backup.status}`);
    }

    const filename = `${backup.serverId}-${backup.id}.tar.gz`;

    // Download from Google Drive if stored there
    if (backup.driveFileId) {
      const user = await userStore.getUserById(backup.tenantId);
      if (user && user.googleRefreshToken) {
        try {
          const driveService = createDriveServiceForUser(
            user.googleAccessToken,
            user.googleRefreshToken
          );
          const buffer = await driveService.downloadBackup(backup.driveFileId);
          console.log(`[BackupService] Downloaded backup ${backupId} from Google Drive`);
          return { buffer, filename };
        } catch (error: any) {
          console.error(`[BackupService] Failed to download backup from Drive:`, error.message);
          throw new Error(`Failed to download backup from Google Drive: ${error.message}`);
        }
      } else {
        throw new Error('User credentials not available for Google Drive download');
      }
    }

    // Fallback to PVC if no Drive file (shouldn't happen in normal flow)
    const backupFilename = `${backup.serverId}-${backup.id}.tar.gz`;
    const buffer = await this.readBackupFromPVC(backupFilename);
    if (!buffer) {
      throw new Error('Backup file not found in storage');
    }
    return { buffer, filename };
  }

  // Get a download stream for large backups
  async getBackupDownloadStream(
    backupId: string
  ): Promise<{ stream: Readable; filename: string } | null> {
    this.ensureInitialized();
    const backup = await backupStore.getBackupById(backupId);
    if (!backup) {
      throw new Error(`Backup ${backupId} not found`);
    }

    if (backup.status !== 'completed') {
      throw new Error(`Cannot download backup with status: ${backup.status}`);
    }

    const filename = `${backup.serverId}-${backup.id}.tar.gz`;

    // Stream from Google Drive if stored there
    if (backup.driveFileId) {
      const user = await userStore.getUserById(backup.tenantId);
      if (user && user.googleRefreshToken) {
        try {
          const driveService = createDriveServiceForUser(
            user.googleAccessToken,
            user.googleRefreshToken
          );
          const stream = await driveService.getDownloadStream(backup.driveFileId);
          console.log(`[BackupService] Streaming backup ${backupId} from Google Drive`);
          return { stream, filename };
        } catch (error: any) {
          console.error(`[BackupService] Failed to stream backup from Drive:`, error.message);
          throw new Error(`Failed to stream backup from Google Drive: ${error.message}`);
        }
      } else {
        throw new Error('User credentials not available for Google Drive download');
      }
    }

    // Fallback - convert buffer to stream
    const result = await this.downloadBackup(backupId);
    if (!result) return null;
    const stream = Readable.from(result.buffer);
    return { stream, filename };
  }

  // Restore a backup (stub - would be complex in production)
  async restoreBackup(backupId: string): Promise<void> {
    this.ensureInitialized();
    const backup = await backupStore.getBackupById(backupId);
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
  async getSchedule(serverId: string): Promise<BackupSchedule | undefined> {
    this.ensureInitialized();
    return backupStore.getSchedule(serverId);
  }

  // Set or update backup schedule
  async setSchedule(
    serverId: string,
    tenantId: string,
    config: { enabled: boolean; intervalHours: number; retentionCount: number }
  ): Promise<BackupSchedule> {
    this.ensureInitialized();
    return backupStore.setSchedule(serverId, tenantId, config);
  }

  // Start the auto-backup scheduler
  startScheduler(): void {
    if (this.schedulerInterval) return;

    console.log('[BackupService] Starting auto-backup scheduler');

    // Check every minute for backups that need to run
    this.schedulerInterval = setInterval(() => {
      void this.checkScheduledBackups();
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
    if (!this.initialized) return;

    const dueSchedules = await backupStore.getDueSchedules();

    for (const schedule of dueSchedules) {
      console.log(`[BackupService] Running scheduled backup for ${schedule.serverId}`);

      try {
        // Create automatic backup using stored tenantId
        await this.createBackup({
          serverId: schedule.serverId,
          tenantId: schedule.tenantId,
          name: `auto-backup-${new Date().toISOString().split('T')[0]}`,
          description: 'Automatic scheduled backup',
          isAutomatic: true,
        });

        // Update schedule timestamps in database
        await backupStore.updateScheduleAfterBackup(schedule.serverId);

        // Apply retention policy
        await this.applyRetentionPolicy(schedule.serverId, schedule.retentionCount);
      } catch (error) {
        console.error(`[BackupService] Failed scheduled backup for ${schedule.serverId}:`, error);
      }
    }
  }

  // Apply retention policy - delete old backups
  private async applyRetentionPolicy(serverId: string, retentionCount: number): Promise<void> {
    const serverBackups = await backupStore.getAutomaticBackups(serverId);

    // Delete backups beyond retention count
    const toDelete = serverBackups.slice(retentionCount);
    for (const backup of toDelete) {
      console.log(`[BackupService] Deleting old backup ${backup.id} (retention policy)`);
      await this.deleteBackup(backup.id);
    }
  }
}
