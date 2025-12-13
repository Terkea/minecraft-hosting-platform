import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

// Event Types
export enum EventType {
  // Server Lifecycle
  SERVER_CREATED = 'server.created',
  SERVER_UPDATED = 'server.updated',
  SERVER_DELETED = 'server.deleted',
  SERVER_STATUS_CHANGED = 'server.status.changed',
  SERVER_METRICS = 'server.metrics',

  // Player Events
  PLAYER_JOINED = 'server.player.joined',
  PLAYER_LEFT = 'server.player.left',

  // Kubernetes Events (from operator)
  K8S_RESOURCE_CREATED = 'k8s.resource.created',
  K8S_RESOURCE_UPDATED = 'k8s.resource.updated',
  K8S_RESOURCE_DELETED = 'k8s.resource.deleted',
  K8S_POD_READY = 'k8s.pod.ready',
  K8S_POD_FAILED = 'k8s.pod.failed',

  // Sync Events
  SYNC_REQUIRED = 'sync.required',
  SYNC_COMPLETE = 'sync.complete',

  // Backup Events
  BACKUP_STARTED = 'backup.started',
  BACKUP_COMPLETED = 'backup.completed',
  BACKUP_FAILED = 'backup.failed',

  // Auth Events
  AUTH_REAUTH_REQUIRED = 'auth.reauth.required',
}

// Base Event Interface
export interface BaseEvent {
  id: string;
  type: EventType;
  timestamp: Date;
  source: 'api' | 'operator' | 'sync' | 'metrics';
  correlationId?: string;
}

// Server Event
export interface ServerEvent extends BaseEvent {
  serverId: string;
  tenantId: string;
  data: Record<string, unknown>;
}

// K8s State Event
export interface K8sStateEvent extends BaseEvent {
  serverId: string;
  tenantId: string;
  namespace: string;
  resourceName: string;
  phase: string;
  message?: string;
  externalIP?: string;
  externalPort?: number;
  playerCount?: number;
  readyReplicas?: number;
  desiredReplicas?: number;
}

// Status Change Event
export interface StatusChangeEvent extends ServerEvent {
  data: {
    oldStatus: string;
    newStatus: string;
    reason?: string;
  };
}

// Event Handler Types
export type EventHandler<T extends BaseEvent = BaseEvent> = (event: T) => void | Promise<void>;

// Event Bus Class
export class EventBus {
  private emitter: EventEmitter;
  private handlers: Map<string, Set<EventHandler<any>>>;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.handlers = new Map();
  }

  // Publish an event
  publish<T extends BaseEvent>(event: T): void {
    console.log('[EventBus] Publishing %s: %s', event.type, event.id);
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event); // Wildcard for all events
  }

  // Subscribe to an event type
  subscribe<T extends BaseEvent>(eventType: EventType | '*', handler: EventHandler<T>): () => void {
    const handlers = this.handlers.get(eventType) || new Set();
    handlers.add(handler);
    this.handlers.set(eventType, handlers);

    this.emitter.on(eventType, handler);

    // Return unsubscribe function
    return () => {
      this.emitter.off(eventType, handler);
      handlers.delete(handler);
    };
  }

  // Helper methods for common events

  publishServerCreated(
    serverId: string,
    tenantId: string,
    data: Record<string, unknown> = {}
  ): void {
    this.publish<ServerEvent>({
      id: uuidv4(),
      type: EventType.SERVER_CREATED,
      serverId,
      tenantId,
      timestamp: new Date(),
      source: 'api',
      data,
    });
  }

  publishServerStatusChanged(
    serverId: string,
    tenantId: string,
    oldStatus: string,
    newStatus: string,
    reason?: string
  ): void {
    this.publish<StatusChangeEvent>({
      id: uuidv4(),
      type: EventType.SERVER_STATUS_CHANGED,
      serverId,
      tenantId,
      timestamp: new Date(),
      source: 'api',
      data: { oldStatus, newStatus, reason },
    });
  }

  publishServerDeleted(serverId: string, tenantId: string): void {
    this.publish<ServerEvent>({
      id: uuidv4(),
      type: EventType.SERVER_DELETED,
      serverId,
      tenantId,
      timestamp: new Date(),
      source: 'api',
      data: {},
    });
  }

  publishK8sStateUpdate(event: Omit<K8sStateEvent, 'id' | 'timestamp'>): void {
    this.publish<K8sStateEvent>({
      ...event,
      id: uuidv4(),
      timestamp: new Date(),
    });
  }

  publishSyncRequired(serverId: string, tenantId: string, reason: string): void {
    this.publish<ServerEvent>({
      id: uuidv4(),
      type: EventType.SYNC_REQUIRED,
      serverId,
      tenantId,
      timestamp: new Date(),
      source: 'sync',
      data: { reason },
    });
  }

  publishSyncComplete(serverId: string, tenantId: string): void {
    this.publish<ServerEvent>({
      id: uuidv4(),
      type: EventType.SYNC_COMPLETE,
      serverId,
      tenantId,
      timestamp: new Date(),
      source: 'sync',
      data: {},
    });
  }

  // Get handler count for debugging
  getHandlerCount(eventType: EventType | '*'): number {
    return this.handlers.get(eventType)?.size || 0;
  }
}

// Singleton instance
let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus();
  }
  return eventBusInstance;
}
