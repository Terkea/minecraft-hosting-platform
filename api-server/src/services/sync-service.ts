import { K8sClient, MinecraftServerStatus } from '../k8s-client.js';
import { getEventBus, EventType, K8sStateEvent } from '../events/event-bus.js';
import { ServerStatus } from '../models/index.js';

// Maps K8s phase to our internal status
function mapK8sPhaseToStatus(phase: string): ServerStatus {
  const phaseMap: Record<string, ServerStatus> = {
    'Pending': ServerStatus.DEPLOYING,
    'Creating': ServerStatus.DEPLOYING,
    'Running': ServerStatus.RUNNING,
    'Ready': ServerStatus.RUNNING,
    'Stopped': ServerStatus.STOPPED,
    'Stopping': ServerStatus.STOPPED,
    'Failed': ServerStatus.FAILED,
    'Error': ServerStatus.FAILED,
    'Terminating': ServerStatus.TERMINATING,
    'Deleting': ServerStatus.TERMINATING,
  };
  return phaseMap[phase] || ServerStatus.DEPLOYING;
}

export interface SyncCallback {
  onServerUpdate: (server: MinecraftServerStatus, eventType: string) => void;
  onSyncComplete: (servers: MinecraftServerStatus[]) => void;
}

export class SyncService {
  private k8sClient: K8sClient;
  private eventBus = getEventBus();
  private serverCache: Map<string, MinecraftServerStatus> = new Map();
  private watchAbort: (() => void) | null = null;
  private callbacks: SyncCallback[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(k8sClient: K8sClient) {
    this.k8sClient = k8sClient;
  }

  // Register callback for updates
  registerCallback(callback: SyncCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx > -1) this.callbacks.splice(idx, 1);
    };
  }

  // Start watching K8s resources
  async startWatch(): Promise<void> {
    console.log('[SyncService] Starting K8s watch...');

    // Initial sync
    await this.syncAll();

    // Start watching for changes
    try {
      this.watchAbort = await this.k8sClient.watchMinecraftServers(
        (type: string, server: MinecraftServerStatus) => {
          this.handleWatchEvent(type, server);
        }
      );
      console.log('[SyncService] K8s watch started successfully');
    } catch (error) {
      console.error('[SyncService] Failed to start watch, falling back to polling:', error);
      this.startPolling();
    }
  }

  // Stop watching
  stopWatch(): void {
    if (this.watchAbort) {
      this.watchAbort();
      this.watchAbort = null;
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    console.log('[SyncService] Watch stopped');
  }

  // Fallback polling if watch fails
  private startPolling(): void {
    console.log('[SyncService] Starting polling mode (every 5 seconds)');
    this.syncInterval = setInterval(() => {
      this.syncAll().catch(err => {
        console.error('[SyncService] Polling sync failed:', err);
      });
    }, 5000);
  }

  // Sync all servers from K8s
  async syncAll(): Promise<MinecraftServerStatus[]> {
    console.log('[SyncService] Performing full sync...');
    try {
      const servers = await this.k8sClient.listMinecraftServers();

      // Check for status changes and deletions
      const currentNames = new Set(servers.map(s => s.name));

      // Detect deleted servers
      for (const [name, oldServer] of this.serverCache) {
        if (!currentNames.has(name)) {
          this.handleWatchEvent('DELETED', oldServer);
        }
      }

      // Update cache and detect changes
      for (const server of servers) {
        const cached = this.serverCache.get(server.name);
        if (!cached) {
          this.handleWatchEvent('ADDED', server);
        } else if (cached.phase !== server.phase || cached.playerCount !== server.playerCount) {
          this.handleWatchEvent('MODIFIED', server);
        }
        this.serverCache.set(server.name, server);
      }

      // Notify callbacks
      this.callbacks.forEach(cb => cb.onSyncComplete(servers));

      return servers;
    } catch (error) {
      console.error('[SyncService] Sync failed:', error);
      throw error;
    }
  }

  // Handle watch events
  private handleWatchEvent(type: string, server: MinecraftServerStatus): void {
    console.log(`[SyncService] Watch event: ${type} for ${server.name}`);

    const oldServer = this.serverCache.get(server.name);
    const internalStatus = mapK8sPhaseToStatus(server.phase);

    // Update cache
    if (type === 'DELETED') {
      this.serverCache.delete(server.name);
    } else {
      this.serverCache.set(server.name, server);
    }

    // Publish event to event bus
    const eventType = this.getEventType(type, oldServer?.phase, server.phase);

    this.eventBus.publishK8sStateUpdate({
      type: eventType,
      source: 'operator',
      serverId: server.name,
      tenantId: 'default-tenant', // TODO: Extract from server metadata
      namespace: server.namespace,
      resourceName: server.name,
      phase: server.phase,
      message: server.message,
      externalIP: server.externalIP,
      externalPort: server.port,
      playerCount: server.playerCount,
    });

    // Notify status change if phase changed
    if (oldServer && oldServer.phase !== server.phase) {
      this.eventBus.publishServerStatusChanged(
        server.name,
        'default-tenant',
        oldServer.phase,
        server.phase,
        server.message
      );
    }

    // Notify callbacks
    this.callbacks.forEach(cb => cb.onServerUpdate(server, type));
  }

  private getEventType(watchType: string, oldPhase?: string, newPhase?: string): EventType {
    switch (watchType) {
      case 'ADDED':
        return EventType.K8S_RESOURCE_CREATED;
      case 'DELETED':
        return EventType.K8S_RESOURCE_DELETED;
      case 'MODIFIED':
        if (newPhase === 'Running' && oldPhase !== 'Running') {
          return EventType.K8S_POD_READY;
        }
        if (newPhase === 'Failed' || newPhase === 'Error') {
          return EventType.K8S_POD_FAILED;
        }
        return EventType.K8S_RESOURCE_UPDATED;
      default:
        return EventType.K8S_RESOURCE_UPDATED;
    }
  }

  // Get cached servers
  getCachedServers(): MinecraftServerStatus[] {
    return Array.from(this.serverCache.values());
  }

  // Get single cached server
  getCachedServer(name: string): MinecraftServerStatus | undefined {
    return this.serverCache.get(name);
  }
}
