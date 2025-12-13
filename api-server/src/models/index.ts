// Server Status State Machine
export enum ServerStatus {
  DEPLOYING = 'deploying',
  RUNNING = 'running',
  STOPPED = 'stopped',
  FAILED = 'failed',
  TERMINATING = 'terminating',
}

// Valid status transitions
export const STATUS_TRANSITIONS: Record<ServerStatus, ServerStatus[]> = {
  [ServerStatus.DEPLOYING]: [ServerStatus.RUNNING, ServerStatus.FAILED],
  [ServerStatus.RUNNING]: [ServerStatus.STOPPED, ServerStatus.TERMINATING, ServerStatus.FAILED],
  [ServerStatus.STOPPED]: [ServerStatus.DEPLOYING, ServerStatus.TERMINATING],
  [ServerStatus.FAILED]: [ServerStatus.DEPLOYING, ServerStatus.TERMINATING],
  [ServerStatus.TERMINATING]: [], // Terminal state
};

export function canTransition(from: ServerStatus, to: ServerStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// Resource Limits
export interface ResourceLimits {
  cpuCores: number;
  memoryGB: number;
  storageGB: number;
  maxPlayers: number;
}

// Server Properties (Minecraft server.properties)
export interface ServerProperties {
  maxPlayers: number;
  gamemode: 'survival' | 'creative' | 'adventure' | 'spectator';
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  levelName: string;
  motd: string;
  whiteList: boolean;
  onlineMode: boolean;
  pvp: boolean;
  enableCommandBlock: boolean;
  viewDistance?: number;
  spawnProtection?: number;
  [key: string]: string | number | boolean | undefined;
}

// Server Instance (Main entity)
export interface ServerInstance {
  id: string;
  tenantId: string;
  name: string;
  displayName?: string;
  status: ServerStatus;
  minecraftVersion: string;
  serverProperties: ServerProperties;
  resourceLimits: ResourceLimits;

  // Kubernetes details
  kubernetesNamespace: string;
  kubernetesName: string;

  // Runtime info
  externalIP?: string;
  externalPort?: number;
  currentPlayers: number;
  maxPlayers: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt?: Date;
}

// SKU Configuration (Pricing tiers)
export interface SKUConfiguration {
  id: string;
  name: string;
  tier: 'starter' | 'standard' | 'professional' | 'enterprise';
  displayName: string;
  description: string;

  // Resources
  cpuCores: number;
  memoryGB: number;
  storageGB: number;
  maxPlayers: number;

  // Pricing
  pricePerHour: number;
  pricePerMonth: number;
  currency: string;

  // Features
  features: string[];
  isActive: boolean;
}

// Default SKUs
export const DEFAULT_SKUS: SKUConfiguration[] = [
  {
    id: 'starter',
    name: 'starter',
    tier: 'starter',
    displayName: 'Starter',
    description: 'Perfect for small groups of friends',
    cpuCores: 1,
    memoryGB: 2,
    storageGB: 10,
    maxPlayers: 10,
    pricePerHour: 0.02,
    pricePerMonth: 5,
    currency: 'USD',
    features: ['Basic support', 'Daily backups'],
    isActive: true,
  },
  {
    id: 'standard',
    name: 'standard',
    tier: 'standard',
    displayName: 'Standard',
    description: 'Great for medium-sized communities',
    cpuCores: 2,
    memoryGB: 4,
    storageGB: 25,
    maxPlayers: 25,
    pricePerHour: 0.05,
    pricePerMonth: 15,
    currency: 'USD',
    features: ['Priority support', 'Hourly backups', 'Custom plugins'],
    isActive: true,
  },
  {
    id: 'professional',
    name: 'professional',
    tier: 'professional',
    displayName: 'Professional',
    description: 'For large servers with many plugins',
    cpuCores: 4,
    memoryGB: 8,
    storageGB: 50,
    maxPlayers: 50,
    pricePerHour: 0.1,
    pricePerMonth: 35,
    currency: 'USD',
    features: ['24/7 support', 'Real-time backups', 'DDoS protection', 'Custom domain'],
    isActive: true,
  },
  {
    id: 'enterprise',
    name: 'enterprise',
    tier: 'enterprise',
    displayName: 'Enterprise',
    description: 'Maximum performance for networks',
    cpuCores: 8,
    memoryGB: 16,
    storageGB: 100,
    maxPlayers: 100,
    pricePerHour: 0.25,
    pricePerMonth: 99,
    currency: 'USD',
    features: [
      'Dedicated support',
      'Continuous backups',
      'DDoS protection',
      'Custom domain',
      'Multi-server network',
    ],
    isActive: true,
  },
];

// Backup Snapshot
export interface BackupSnapshot {
  id: string;
  serverId: string;
  tenantId: string;
  name: string;
  description?: string;

  // Backup details
  sizeBytes: number;
  compressionFormat: 'gzip' | 'lz4' | 'none';
  storagePath: string;
  checksum: string;

  // Google Drive integration
  driveFileId?: string;
  driveWebLink?: string;

  // Status
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  errorMessage?: string;

  // Timing
  startedAt: Date;
  completedAt?: Date;
  expiresAt?: Date;

  // Metadata
  minecraftVersion: string;
  worldSize: number;
  isAutomatic: boolean;
  tags: string[];
}

// Audit Log
export interface AuditLog {
  id: string;
  tenantId: string;
  serverId?: string;
  userId?: string;

  action: AuditAction;
  entityType: 'server' | 'backup' | 'plugin' | 'user' | 'tenant';
  entityId: string;

  // Details
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;

  // Request context
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;

  timestamp: Date;
}

export enum AuditAction {
  SERVER_CREATED = 'server.created',
  SERVER_STARTED = 'server.started',
  SERVER_STOPPED = 'server.stopped',
  SERVER_RESTARTED = 'server.restarted',
  SERVER_DELETED = 'server.deleted',
  SERVER_CONFIG_UPDATED = 'server.config_updated',
  SERVER_SCALED = 'server.scaled',

  BACKUP_CREATED = 'backup.created',
  BACKUP_RESTORED = 'backup.restored',
  BACKUP_DELETED = 'backup.deleted',

  PLUGIN_INSTALLED = 'plugin.installed',
  PLUGIN_UPDATED = 'plugin.updated',
  PLUGIN_REMOVED = 'plugin.removed',
}

// Plugin Package
export interface PluginPackage {
  id: string;
  name: string;
  slug: string;
  description: string;
  author: string;

  // Versions
  latestVersion: string;
  versions: PluginVersion[];

  // Compatibility
  minecraftVersions: string[];
  serverTypes: ('vanilla' | 'paper' | 'spigot' | 'bukkit')[];

  // Metadata
  downloadCount: number;
  rating: number;
  categories: string[];
  tags: string[];

  // URLs
  homepage?: string;
  sourceUrl?: string;
  iconUrl?: string;
}

export interface PluginVersion {
  version: string;
  downloadUrl: string;
  checksum: string;
  releaseDate: Date;
  changelog?: string;
  minecraftVersions: string[];
}

// Server Plugin Installation
export interface ServerPluginInstallation {
  id: string;
  serverId: string;
  pluginId: string;

  installedVersion: string;
  configOverrides: Record<string, unknown>;

  status: 'pending' | 'installed' | 'failed' | 'disabled';
  errorMessage?: string;

  installedAt: Date;
  updatedAt: Date;
}

// Metrics Data
export interface MetricsData {
  serverId: string;
  tenantId: string;
  timestamp: Date;

  // Performance
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMB: number;

  // Minecraft specific
  tps: number; // Ticks per second (ideal: 20)
  playerCount: number;

  // Network
  networkInBytes: number;
  networkOutBytes: number;

  // Storage
  storageUsedGB: number;
}
