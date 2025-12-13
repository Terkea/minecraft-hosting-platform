export interface ServerMetrics {
  cpu?: {
    usage: string;
    usageNano: number;
  };
  memory?: {
    usage: string;
    usageBytes: number;
  };
  uptime?: number;
  restartCount: number;
  ready: boolean;
}

// Server types supported by the platform
export type ServerType =
  | 'VANILLA'
  | 'PAPER'
  | 'SPIGOT'
  | 'BUKKIT'
  | 'FORGE'
  | 'FABRIC'
  | 'PURPUR'
  | 'QUILT'
  | 'NEOFORGE';

// Level/world types for generation
export type LevelType = 'default' | 'flat' | 'largeBiomes' | 'amplified' | 'singleBiome';

// Server configuration
export interface ServerConfig {
  // Player settings
  maxPlayers: number;
  gamemode: string;
  difficulty: string;
  forceGamemode?: boolean;
  hardcoreMode?: boolean;
  playerIdleTimeout?: number;

  // World settings
  levelName: string;
  levelSeed?: string;
  levelType?: LevelType;
  spawnProtection?: number;
  viewDistance?: number;
  simulationDistance?: number;
  generateStructures?: boolean;
  allowNether?: boolean;
  maxWorldSize?: number;
  maxBuildHeight?: number;

  // Server display
  motd: string;
  serverIcon?: string;

  // Resource pack
  resourcePack?: string;
  resourcePackSha1?: string;
  resourcePackEnforce?: boolean;

  // Gameplay settings
  pvp: boolean;
  allowFlight?: boolean;
  enableCommandBlock: boolean;
  announcePlayerAchievements?: boolean;

  // Mob spawning
  spawnAnimals?: boolean;
  spawnMonsters?: boolean;
  spawnNpcs?: boolean;

  // Security settings
  whiteList: boolean;
  onlineMode: boolean;

  // Player management (stored as arrays for UI)
  ops?: string[];
  whitelist?: string[];
  bannedPlayers?: string[];
  bannedIps?: string[];
}

export interface Server {
  name: string;
  namespace: string;
  status: string;
  phase: string;
  message?: string;
  version?: string;
  serverType?: ServerType;
  externalIP?: string;
  port?: number;
  playerCount?: number;
  maxPlayers?: number;
  metrics?: ServerMetrics;
  config?: ServerConfig;
}

export interface CreateServerRequest {
  name: string;
  serverType?: ServerType;
  version?: string;
  memory?: string;

  // Config options (all optional with defaults)
  maxPlayers?: number;
  gamemode?: string;
  difficulty?: string;
  motd?: string;
  playerIdleTimeout?: number;

  // World settings
  levelName?: string;
  levelSeed?: string;
  levelType?: LevelType;
  spawnProtection?: number;
  viewDistance?: number;
  simulationDistance?: number;
  maxWorldSize?: number;
  maxBuildHeight?: number;

  // Server display
  serverIcon?: string;

  // Resource pack
  resourcePack?: string;
  resourcePackSha1?: string;
  resourcePackEnforce?: boolean;

  // Gameplay settings
  pvp?: boolean;
  allowFlight?: boolean;
  enableCommandBlock?: boolean;
  forceGamemode?: boolean;
  hardcoreMode?: boolean;
  announcePlayerAchievements?: boolean;

  // Mob spawning
  spawnAnimals?: boolean;
  spawnMonsters?: boolean;
  spawnNpcs?: boolean;

  // World generation
  generateStructures?: boolean;
  allowNether?: boolean;

  // Security settings
  whiteList?: boolean;
  onlineMode?: boolean;

  // Initial player management
  ops?: string[];
  initialWhitelist?: string[];
}

export interface UpdateServerRequest {
  serverType?: ServerType;
  version?: string;

  // All config options (optional for updates)
  maxPlayers?: number;
  gamemode?: string;
  difficulty?: string;
  motd?: string;
  playerIdleTimeout?: number;
  levelName?: string;
  levelSeed?: string;
  levelType?: LevelType;
  spawnProtection?: number;
  viewDistance?: number;
  simulationDistance?: number;
  maxWorldSize?: number;
  maxBuildHeight?: number;
  serverIcon?: string;
  resourcePack?: string;
  resourcePackSha1?: string;
  resourcePackEnforce?: boolean;
  pvp?: boolean;
  allowFlight?: boolean;
  enableCommandBlock?: boolean;
  forceGamemode?: boolean;
  hardcoreMode?: boolean;
  announcePlayerAchievements?: boolean;
  spawnAnimals?: boolean;
  spawnMonsters?: boolean;
  spawnNpcs?: boolean;
  generateStructures?: boolean;
  allowNether?: boolean;
  whiteList?: boolean;
  onlineMode?: boolean;
}

export interface ApiResponse<T> {
  servers?: T[];
  server?: T;
  total?: number;
  message?: string;
  error?: string;
}

export interface MetricsUpdate {
  [serverName: string]: ServerMetrics;
}

export interface WebSocketMessage {
  type:
    | 'initial'
    | 'created'
    | 'deleted'
    | 'status_update'
    | 'metrics_update'
    | 'started'
    | 'stopped'
    | 'updated'
    | 'scaled'
    | 'modified'
    | 'added'
    | 'auto_stop_configured'
    | 'auto_start_configured'
    | 'auth_reauth_required';
  servers?: Server[];
  server?: Server;
  metrics?: MetricsUpdate;
  timestamp?: string;
  // Auth re-authentication fields
  reason?: string;
  message?: string;
}
