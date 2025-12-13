import * as k8s from '@kubernetes/client-node';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Readable, PassThrough } from 'stream';
import { BackupSnapshot } from '../models/index.js';
import { getEventBus, EventType } from '../events/event-bus.js';
import { GoogleDriveService, createDriveServiceForUser } from './google-drive-service.js';
import { userStore, User } from '../models/user.js';
import { backupStore, BackupSchedule } from '../db/backup-store-db.js';
import * as WebSocket from 'ws';

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

// MinecraftServer CRD interface for stop/start operations
interface MinecraftServerCRD {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    resourceVersion?: string;
  };
  spec: {
    stopped?: boolean;
    [key: string]: unknown;
  };
}

export class BackupService {
  private kc: k8s.KubeConfig;
  private batchApi!: k8s.BatchV1Api;
  private coreApi!: k8s.CoreV1Api;
  private appsApi!: k8s.AppsV1Api;
  private customApi!: k8s.CustomObjectsApi;
  private namespace: string;
  private eventBus = getEventBus();
  private k8sAvailable: boolean = false;
  private initialized: boolean = false;

  // CRD constants for MinecraftServer
  private readonly crdGroup = 'minecraft.platform.com';
  private readonly crdVersion = 'v1';
  private readonly crdPlural = 'minecraftservers';

  // Database-backed storage (persistent)
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;

  // Google Drive integration
  private async uploadBackupToDrive(
    backup: BackupSnapshot,
    backupFilename: string
  ): Promise<{
    driveFileId: string;
    driveWebLink: string;
    sizeBytes: number;
    checksum: string;
  } | null> {
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

      // Try to refresh the access token before uploading
      try {
        console.log(`[BackupService] Refreshing Google access token for user ${user.email}...`);
        const refreshResult = await driveService.refreshAccessToken();

        // Update user's access token in database
        await userStore.updateUser(user.id, {
          googleAccessToken: refreshResult.accessToken,
        });
        console.log(
          `[BackupService] Token refreshed successfully, expires at ${refreshResult.expiresAt}`
        );
      } catch (refreshError: any) {
        console.error(`[BackupService] Failed to refresh token:`, refreshError.message);

        // Emit event to notify frontend that re-authentication is required
        this.eventBus.publish({
          id: uuidv4(),
          type: EventType.AUTH_REAUTH_REQUIRED,
          timestamp: new Date(),
          source: 'api',
          serverId: backup.serverId,
          tenantId: backup.tenantId,
          data: {
            reason: 'Google OAuth token expired',
            message: 'Please re-authenticate with Google to continue using backups',
          },
        });

        return null;
      }

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

      // Get the actual size from the buffer (more reliable than Google Drive API response)
      const actualSizeBytes = backupBuffer.length;

      // Calculate SHA256 checksum of the backup
      const checksum = this.calculateChecksum(backupBuffer);
      console.log(`[BackupService] Backup checksum: ${checksum}`);

      // Upload to Google Drive
      const result = await driveService.uploadBackup(
        folderId,
        backupFilename,
        backupBuffer,
        'application/gzip'
      );

      console.log(
        `[BackupService] Uploaded backup ${backup.id} to Google Drive: ${result.fileId} (${actualSizeBytes} bytes)`
      );

      return {
        driveFileId: result.fileId,
        driveWebLink: result.webViewLink,
        sizeBytes: actualSizeBytes,
        checksum,
      };
    } catch (error: any) {
      console.error(`[BackupService] Failed to upload backup to Drive:`, error.message);
      return null;
    }
  }

  // Read backup file from PVC using kubectl exec with proper streaming
  private async readBackupFromPVC(backupFilename: string): Promise<Buffer | null> {
    if (!this.k8sAvailable) {
      console.warn('[BackupService] K8s not available, cannot read backup from PVC');
      // Return mock data for testing without K8s
      return Buffer.from('mock-backup-data');
    }

    const podName = `backup-reader-${Date.now()}`;

    try {
      console.log(`[BackupService] Creating temporary pod ${podName} to read backup file`);

      // Create a temporary pod that stays running so we can exec into it
      const pod: k8s.V1Pod = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: podName,
          namespace: this.namespace,
          labels: {
            app: 'backup-reader',
          },
        },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'reader',
              image: 'alpine:latest',
              command: ['/bin/sh', '-c', 'sleep 300'], // Keep running for 5 minutes
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
      };

      await this.coreApi.createNamespacedPod({ namespace: this.namespace, body: pod });

      // Wait for pod to be ready
      let podReady = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!podReady && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;

        const podStatus = await this.coreApi.readNamespacedPodStatus({
          name: podName,
          namespace: this.namespace,
        });

        if (podStatus.status?.phase === 'Running') {
          podReady = true;
          console.log(`[BackupService] Backup reader pod ${podName} is running`);
        } else if (podStatus.status?.phase === 'Failed') {
          throw new Error('Backup reader pod failed to start');
        }
      }

      if (!podReady) {
        throw new Error('Backup reader pod timed out waiting to become ready');
      }

      // Use kubectl exec to stream the file content
      console.log(`[BackupService] Streaming backup file ${backupFilename} via exec`);

      const exec = new k8s.Exec(this.kc);
      const chunks: Buffer[] = [];

      const stdoutStream = new PassThrough();
      stdoutStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      const stderrStream = new PassThrough();
      let stderrOutput = '';
      stderrStream.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      await new Promise<void>((resolve, reject) => {
        exec.exec(
          this.namespace,
          podName,
          'reader',
          ['cat', `/backups/${backupFilename}`],
          stdoutStream,
          stderrStream,
          null, // stdin
          false, // tty
          (status: k8s.V1Status) => {
            if (status.status === 'Success') {
              resolve();
            } else {
              reject(new Error(`Exec failed: ${status.message || 'Unknown error'}`));
            }
          }
        );
      });

      if (stderrOutput) {
        console.warn(`[BackupService] Exec stderr: ${stderrOutput}`);
      }

      const result = Buffer.concat(chunks);
      console.log(`[BackupService] Read ${result.length} bytes from backup file`);
      return result;
    } catch (error: any) {
      console.error(`[BackupService] Error reading backup from PVC:`, error.message);
      return null;
    } finally {
      // Clean up the temporary pod
      try {
        await this.coreApi.deleteNamespacedPod({
          name: podName,
          namespace: this.namespace,
        });
        console.log(`[BackupService] Cleaned up backup reader pod ${podName}`);
      } catch (cleanupError: any) {
        console.warn(`[BackupService] Failed to cleanup pod ${podName}:`, cleanupError.message);
      }
    }
  }

  constructor(namespace: string = 'minecraft-servers') {
    this.kc = new k8s.KubeConfig();
    this.namespace = namespace;

    try {
      this.kc.loadFromDefault();
      this.batchApi = this.kc.makeApiClient(k8s.BatchV1Api);
      this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
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

  // Calculate SHA256 checksum of a buffer
  private calculateChecksum(buffer: Buffer): string {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return `sha256:${hash}`;
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

      // Upload to Google Drive (simulated backup data)
      const backupFilename = `${backup.serverId}-${backup.id}.tar.gz`;
      const driveResult = await this.uploadBackupToDrive(backup, backupFilename);

      // Use actual size and checksum from Drive upload
      const sizeBytes = driveResult?.sizeBytes ?? 0;
      const checksum = driveResult?.checksum ?? `sha256:${uuidv4().replace(/-/g, '')}`;
      const worldSize = Math.floor(sizeBytes / 2);

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

            // Upload to Google Drive - backup is only valid if uploaded successfully
            const driveResult = await this.uploadBackupToDrive(backup, backupFilename);

            if (!driveResult) {
              // Drive upload failed - mark backup as failed
              const errorMessage = 'Failed to upload backup to Google Drive';
              console.error(`[BackupService] ${errorMessage}`);

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
            } else {
              // Drive upload succeeded
              const sizeBytes = driveResult.sizeBytes;
              const checksum = driveResult.checksum;
              const worldSize = Math.floor(sizeBytes / 2);

              await backupStore.updateBackup(backup.id, {
                status: 'completed',
                completedAt: new Date(),
                sizeBytes,
                checksum,
                worldSize,
                driveFileId: driveResult.driveFileId,
                driveWebLink: driveResult.driveWebLink,
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
                  driveFileId: driveResult.driveFileId,
                },
              });
            }
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

  // Restore a backup to the server
  async restoreBackup(backupId: string): Promise<void> {
    this.ensureInitialized();
    this.ensureK8sAvailable();

    const backup = await backupStore.getBackupById(backupId);
    if (!backup) {
      throw new Error(`Backup ${backupId} not found`);
    }

    if (backup.status !== 'completed') {
      throw new Error(`Cannot restore backup with status: ${backup.status}`);
    }

    const serverId = backup.serverId;
    const backupFilename = `${serverId}-${backup.id}.tar.gz`;

    console.log(`[BackupService] Starting restore of backup ${backupId} to server ${serverId}`);

    // Publish restore started event
    this.eventBus.publish({
      id: uuidv4(),
      type: EventType.BACKUP_STARTED, // Reusing event type for restore
      timestamp: new Date(),
      source: 'api',
      serverId,
      tenantId: backup.tenantId,
      data: { backupId, action: 'restore' },
    });

    try {
      // Step 1: Ensure backup file exists on PVC with valid checksum
      const backupExists = await this.checkBackupExistsOnPVC(backupFilename);
      if (!backupExists) {
        console.log(`[BackupService] Backup file not on PVC, downloading from Google Drive...`);
        await this.downloadBackupToPVC(backup, backupFilename);
      } else {
        // File exists, verify checksum before using it
        console.log(`[BackupService] Backup file found on PVC, verifying checksum...`);
        const checksumValid = await this.verifyBackupChecksumOnPVC(backupFilename, backup.checksum);
        if (!checksumValid) {
          console.log(`[BackupService] Checksum invalid, re-downloading from Google Drive...`);
          await this.downloadBackupToPVC(backup, backupFilename);
        }
      }

      // Step 2: Stop the server via CRD (operator will scale down StatefulSet)
      console.log(`[BackupService] Stopping server ${serverId} via CRD...`);
      await this.stopServerViaCRD(serverId);

      // Wait for pod to terminate
      await this.waitForPodTermination(serverId);

      // Step 3: Run restore job to extract backup to data PVC
      console.log(`[BackupService] Running restore job...`);
      await this.runRestoreJob(serverId, backupFilename);

      // Step 4: Start the server via CRD (operator will scale up StatefulSet)
      console.log(`[BackupService] Starting server ${serverId} via CRD...`);
      await this.startServerViaCRD(serverId);

      console.log(`[BackupService] Restore of backup ${backupId} completed successfully`);

      // Publish restore completed event
      this.eventBus.publish({
        id: uuidv4(),
        type: EventType.BACKUP_COMPLETED, // Reusing event type for restore
        timestamp: new Date(),
        source: 'api',
        serverId,
        tenantId: backup.tenantId,
        data: { backupId, action: 'restore' },
      });
    } catch (error: any) {
      console.error(`[BackupService] Restore failed:`, error.message);

      // Try to restart the server even if restore failed
      try {
        await this.startServerViaCRD(serverId);
      } catch (startError) {
        console.error(`[BackupService] Failed to restart server after failed restore`);
      }

      throw new Error(`Restore failed: ${error.message}`);
    }
  }

  // Verify checksum of backup file on PVC
  private async verifyBackupChecksumOnPVC(
    backupFilename: string,
    expectedChecksum: string
  ): Promise<boolean> {
    if (!expectedChecksum || !expectedChecksum.startsWith('sha256:')) {
      console.warn(`[BackupService] No valid checksum to verify, skipping`);
      return true; // Skip verification if no valid checksum
    }

    // Check if this is a real SHA256 hash (64 hex chars) vs legacy fake checksum (32 hex chars from UUID)
    const hashPart = expectedChecksum.replace('sha256:', '');
    if (hashPart.length !== 64) {
      console.warn(
        `[BackupService] Legacy checksum detected (${hashPart.length} chars instead of 64), skipping verification`
      );
      return true; // Skip verification for legacy backups with fake checksums
    }

    try {
      console.log(`[BackupService] Reading backup file from PVC to verify checksum...`);
      const backupBuffer = await this.readBackupFromPVC(backupFilename);

      if (!backupBuffer) {
        console.error(`[BackupService] Could not read backup file for checksum verification`);
        return false;
      }

      const actualChecksum = this.calculateChecksum(backupBuffer);
      console.log(`[BackupService] Stored checksum:     ${expectedChecksum}`);
      console.log(`[BackupService] PVC file checksum:   ${actualChecksum}`);

      if (actualChecksum !== expectedChecksum) {
        console.error(`[BackupService] Checksum mismatch for file on PVC!`);
        return false;
      }

      console.log(`[BackupService] Checksum verified successfully`);
      return true;
    } catch (error: any) {
      console.error(`[BackupService] Failed to verify checksum:`, error.message);
      return false;
    }
  }

  // Check if backup file exists on the backup PVC
  private async checkBackupExistsOnPVC(backupFilename: string): Promise<boolean> {
    const podName = `check-backup-${Date.now()}`;

    try {
      // Create a temporary pod to check if file exists
      const pod: k8s.V1Pod = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: podName,
          namespace: this.namespace,
        },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'checker',
              image: 'alpine:latest',
              command: [
                '/bin/sh',
                '-c',
                `test -f /backups/${backupFilename} && echo "EXISTS" || echo "NOT_FOUND"`,
              ],
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
      };

      await this.coreApi.createNamespacedPod({ namespace: this.namespace, body: pod });

      // Wait for pod to complete
      let completed = false;
      let attempts = 0;
      while (!completed && attempts < 15) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;

        const podStatus = await this.coreApi.readNamespacedPodStatus({
          name: podName,
          namespace: this.namespace,
        });

        if (podStatus.status?.phase === 'Succeeded' || podStatus.status?.phase === 'Failed') {
          completed = true;

          // Get logs to check result
          const logs = await this.coreApi.readNamespacedPodLog({
            name: podName,
            namespace: this.namespace,
          });

          const logOutput = typeof logs === 'string' ? logs : '';
          return logOutput.trim() === 'EXISTS';
        }
      }

      return false;
    } catch (error: any) {
      console.warn(`[BackupService] Error checking backup existence:`, error.message);
      return false;
    } finally {
      // Cleanup
      try {
        await this.coreApi.deleteNamespacedPod({ name: podName, namespace: this.namespace });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  // Download backup from Google Drive to the backup PVC with checksum verification
  private async downloadBackupToPVC(backup: BackupSnapshot, backupFilename: string): Promise<void> {
    if (!backup.driveFileId) {
      throw new Error('Backup file not available in Google Drive');
    }

    const user = await userStore.getUserById(backup.tenantId);
    if (!user || !user.googleRefreshToken) {
      throw new Error('User credentials not available for Google Drive download');
    }

    // Download from Drive
    const driveService = createDriveServiceForUser(user.googleAccessToken, user.googleRefreshToken);
    const backupBuffer = await driveService.downloadBackup(backup.driveFileId);

    console.log(`[BackupService] Downloaded ${backupBuffer.length} bytes from Google Drive`);

    // Verify checksum if we have one stored
    if (backup.checksum && backup.checksum.startsWith('sha256:')) {
      // Check if this is a real SHA256 hash (64 hex chars) vs legacy fake checksum
      const hashPart = backup.checksum.replace('sha256:', '');
      if (hashPart.length !== 64) {
        console.warn(
          `[BackupService] Legacy checksum detected (${hashPart.length} chars), skipping verification`
        );
      } else {
        const downloadedChecksum = this.calculateChecksum(backupBuffer);
        console.log(`[BackupService] Stored checksum:     ${backup.checksum}`);
        console.log(`[BackupService] Downloaded checksum: ${downloadedChecksum}`);

        if (downloadedChecksum !== backup.checksum) {
          throw new Error(
            `Checksum mismatch! Backup may be corrupted. ` +
              `Expected: ${backup.checksum}, Got: ${downloadedChecksum}`
          );
        }
        console.log(`[BackupService] Checksum verified successfully`);
      }
    } else {
      console.warn(`[BackupService] No valid checksum stored, skipping verification`);
    }

    // Write to PVC using kubectl exec
    await this.writeBackupToPVC(backupFilename, backupBuffer);
  }

  // Write backup buffer to PVC using kubectl exec
  private async writeBackupToPVC(backupFilename: string, backupBuffer: Buffer): Promise<void> {
    const podName = `write-backup-${Date.now()}`;

    try {
      // Create a temporary pod that stays running
      const pod: k8s.V1Pod = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: podName,
          namespace: this.namespace,
        },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'writer',
              image: 'alpine:latest',
              command: ['/bin/sh', '-c', 'sleep 300'],
              volumeMounts: [
                {
                  name: 'backup-storage',
                  mountPath: '/backups',
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
      };

      await this.coreApi.createNamespacedPod({ namespace: this.namespace, body: pod });

      // Wait for pod to be ready
      let podReady = false;
      let attempts = 0;
      while (!podReady && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;

        const podStatus = await this.coreApi.readNamespacedPodStatus({
          name: podName,
          namespace: this.namespace,
        });

        if (podStatus.status?.phase === 'Running') {
          podReady = true;
        }
      }

      if (!podReady) {
        throw new Error('Write pod failed to start');
      }

      // Use exec to write the file via stdin
      const exec = new k8s.Exec(this.kc);
      const stdinStream = Readable.from(backupBuffer);
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      await new Promise<void>((resolve, reject) => {
        exec.exec(
          this.namespace,
          podName,
          'writer',
          ['sh', '-c', `cat > /backups/${backupFilename}`],
          stdoutStream,
          stderrStream,
          stdinStream,
          false,
          (status: k8s.V1Status) => {
            if (status.status === 'Success') {
              resolve();
            } else {
              reject(new Error(`Write failed: ${status.message || 'Unknown error'}`));
            }
          }
        );
      });

      console.log(`[BackupService] Written backup file to PVC: ${backupFilename}`);
    } finally {
      // Cleanup
      try {
        await this.coreApi.deleteNamespacedPod({ name: podName, namespace: this.namespace });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  // Stop a server by setting spec.stopped = true on the MinecraftServer CRD
  // This triggers the operator to scale down the StatefulSet properly
  private async stopServerViaCRD(serverId: string): Promise<void> {
    console.log(`[BackupService] Stopping server ${serverId} via CRD...`);

    // Get the current MinecraftServer CRD
    const existing = await this.customApi.getNamespacedCustomObject({
      group: this.crdGroup,
      version: this.crdVersion,
      namespace: this.namespace,
      plural: this.crdPlural,
      name: serverId,
    });

    const server = existing as MinecraftServerCRD;

    // Set stopped to true
    server.spec.stopped = true;

    // Update the CRD
    await this.customApi.replaceNamespacedCustomObject({
      group: this.crdGroup,
      version: this.crdVersion,
      namespace: this.namespace,
      plural: this.crdPlural,
      name: serverId,
      body: server,
    });

    console.log(`[BackupService] Server ${serverId} marked as stopped in CRD`);
  }

  // Start a server by setting spec.stopped = false on the MinecraftServer CRD
  // This triggers the operator to scale up the StatefulSet properly
  private async startServerViaCRD(serverId: string): Promise<void> {
    console.log(`[BackupService] Starting server ${serverId} via CRD...`);

    // Get the current MinecraftServer CRD
    const existing = await this.customApi.getNamespacedCustomObject({
      group: this.crdGroup,
      version: this.crdVersion,
      namespace: this.namespace,
      plural: this.crdPlural,
      name: serverId,
    });

    const server = existing as MinecraftServerCRD;

    // Set stopped to false
    server.spec.stopped = false;

    // Update the CRD
    await this.customApi.replaceNamespacedCustomObject({
      group: this.crdGroup,
      version: this.crdVersion,
      namespace: this.namespace,
      plural: this.crdPlural,
      name: serverId,
      body: server,
    });

    console.log(`[BackupService] Server ${serverId} marked as running in CRD`);
  }

  // Scale a StatefulSet to the desired number of replicas (kept for reference but not used for restore)
  private async scaleStatefulSet(serverId: string, replicas: number): Promise<void> {
    // Get current scale, update replicas, and replace
    const currentScale = await this.appsApi.readNamespacedStatefulSetScale({
      name: serverId,
      namespace: this.namespace,
    });

    // Update the replicas count
    if (currentScale.spec) {
      currentScale.spec.replicas = replicas;
    } else {
      currentScale.spec = { replicas };
    }

    // Replace the scale
    await this.appsApi.replaceNamespacedStatefulSetScale({
      name: serverId,
      namespace: this.namespace,
      body: currentScale,
    });

    console.log(`[BackupService] Scaled StatefulSet ${serverId} to ${replicas} replicas`);
  }

  // Wait for a server's pod to terminate
  private async waitForPodTermination(serverId: string): Promise<void> {
    const podName = `${serverId}-0`;
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes max

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;

      try {
        await this.coreApi.readNamespacedPodStatus({
          name: podName,
          namespace: this.namespace,
        });
        // Pod still exists, keep waiting
      } catch (error: any) {
        if (error.code === 404) {
          // Pod is gone
          console.log(`[BackupService] Pod ${podName} terminated`);
          return;
        }
        throw error;
      }
    }

    throw new Error(`Timeout waiting for pod ${podName} to terminate`);
  }

  // Run the restore job to extract backup to data PVC
  private async runRestoreJob(serverId: string, backupFilename: string): Promise<void> {
    const jobName = `restore-${serverId}-${Date.now()}`;

    const job: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: this.namespace,
      },
      spec: {
        ttlSecondsAfterFinished: 300,
        template: {
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'restore',
                image: 'alpine:latest',
                command: [
                  '/bin/sh',
                  '-c',
                  [
                    `echo "Starting restore from ${backupFilename}..."`,
                    // Clear the data directory (except for any hidden files we want to keep)
                    `rm -rf /data/*`,
                    // Extract the backup
                    `tar -xzf /backups/${backupFilename} -C /data`,
                    `echo "Restore complete"`,
                    `ls -la /data`,
                  ].join(' && '),
                ],
                volumeMounts: [
                  {
                    name: 'minecraft-data',
                    mountPath: '/data',
                  },
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
                name: 'minecraft-data',
                persistentVolumeClaim: {
                  claimName: `minecraft-data-${serverId}-0`,
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

    // Wait for job to complete
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
          console.log(`[BackupService] Restore job completed successfully`);
        } else if (status?.failed && status.failed > 0) {
          throw new Error('Restore job failed');
        }
      } catch (error: any) {
        if (error.message === 'Restore job failed') {
          throw error;
        }
        console.error(`[BackupService] Error checking restore job status:`, error.message);
      }
    }

    if (!completed) {
      throw new Error('Restore job timed out');
    }
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
