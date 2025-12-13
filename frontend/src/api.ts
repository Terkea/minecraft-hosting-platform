import { Server, CreateServerRequest, UpdateServerRequest, ApiResponse } from './types';

const API_BASE = '/api/v1';
const TOKEN_KEY = 'auth_token';

/**
 * Get auth token from localStorage
 */
function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Get headers with auth token
 */
function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Handle 401 responses by redirecting to login
 */
function handleUnauthorized(response: Response): void {
  if (response.status === 401) {
    // Clear token and redirect to login
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login';
  }
}

export async function listServers(): Promise<Server[]> {
  const response = await fetch(`${API_BASE}/servers`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to fetch servers');
  }
  const data: ApiResponse<Server> = await response.json();
  return data.servers || [];
}

export async function createServer(request: CreateServerRequest): Promise<Server> {
  const response = await fetch(`${API_BASE}/servers`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(request),
  });

  handleUnauthorized(response);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to create server');
  }

  return data.server;
}

export async function getServer(name: string): Promise<Server> {
  const response = await fetch(`${API_BASE}/servers/${name}`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Server not found');
  }
  return response.json();
}

export async function deleteServer(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${name}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  handleUnauthorized(response);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to delete server');
  }
}

export async function getServerLogs(name: string, lines: number = 100): Promise<string[]> {
  const response = await fetch(`${API_BASE}/servers/${name}/logs?lines=${lines}`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to fetch logs');
  }
  const data = await response.json();
  return data.logs || [];
}

// Log files types and functions
export interface LogFile {
  name: string;
  size: string;
  sizeBytes: number;
  modified: string;
  type: 'file' | 'directory';
}

export interface LogFilesResponse {
  serverName: string;
  files: LogFile[];
  count: number;
}

export async function getLogFiles(name: string): Promise<LogFilesResponse> {
  const response = await fetch(`${API_BASE}/servers/${name}/logs/files`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to fetch log files');
  }
  return response.json();
}

export async function getLogFileContent(
  name: string,
  filename: string,
  lines: number = 500
): Promise<string[]> {
  const response = await fetch(
    `${API_BASE}/servers/${name}/logs/files/${encodeURIComponent(filename)}?lines=${lines}`,
    { headers: getAuthHeaders() }
  );
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to fetch log file content');
  }
  const data = await response.json();
  return data.content || [];
}

export interface ServerMetricsResponse {
  serverName: string;
  metrics: {
    cpu?: { usage: string; usageNano: number; limit?: string; limitNano?: number };
    memory?: { usage: string; usageBytes: number; limit?: string; limitBytes?: number };
    uptime?: number;
    uptimeFormatted?: string;
    restartCount: number;
    ready: boolean;
    startTime?: string;
  };
}

export async function getServerMetrics(name: string): Promise<ServerMetricsResponse> {
  const response = await fetch(`${API_BASE}/servers/${name}/metrics`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to fetch metrics');
  }
  return response.json();
}

export interface PodStatus {
  phase: string;
  ready: boolean;
  restartCount: number;
  nodeName?: string;
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
}

export async function getPodStatus(name: string): Promise<PodStatus> {
  const response = await fetch(`${API_BASE}/servers/${name}/pod`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to fetch pod status');
  }
  return response.json();
}

export async function executeCommand(name: string, command: string): Promise<string> {
  const response = await fetch(`${API_BASE}/servers/${name}/console`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ command }),
  });

  handleUnauthorized(response);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to execute command');
  }

  const data = await response.json();
  return data.result;
}

export async function stopServer(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${name}/stop`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to stop server');
  }
}

export async function startServer(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${name}/start`, {
    method: 'POST',
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to start server');
  }
}

// Player data types
export interface MinecraftItem {
  id: string;
  count: number;
  slot: number;
  customName?: string;
  damage?: number;
  enchantments?: Record<string, number>;
}

export interface EquipmentItem {
  id: string;
  count: number;
  customName?: string;
  damage?: number;
  enchantments?: Record<string, number>;
}

export interface PlayerEquipment {
  head: EquipmentItem | null;
  chest: EquipmentItem | null;
  legs: EquipmentItem | null;
  feet: EquipmentItem | null;
  offhand: EquipmentItem | null;
}

export interface PlayerData {
  name: string;
  health: number;
  maxHealth: number;
  foodLevel: number;
  foodSaturation: number;
  xpLevel: number;
  xpTotal: number;
  gameMode: number;
  gameModeName: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  dimension: string;
  rotation: {
    yaw: number;
    pitch: number;
  };
  air: number;
  fire: number;
  onGround: boolean;
  isFlying: boolean;
  inventory: MinecraftItem[];
  equipment: PlayerEquipment;
  enderItems: MinecraftItem[];
  selectedSlot: number;
  abilities: {
    invulnerable: boolean;
    mayFly: boolean;
    instabuild: boolean;
    flying: boolean;
    walkSpeed: number;
    flySpeed: number;
  };
}

export interface PlayersResponse {
  online: number;
  max: number;
  players: PlayerData[];
}

// Basic player info for list view
export interface PlayerSummary {
  name: string;
  health: number;
  maxHealth: number;
  gameMode: number;
  gameModeName: string;
}

export interface PlayersListResponse {
  online: number;
  max: number;
  players: PlayerSummary[];
}

// Get list of online players (basic info only)
export async function getServerPlayers(name: string): Promise<PlayersListResponse> {
  const response = await fetch(`${API_BASE}/servers/${name}/players`);
  if (!response.ok) {
    throw new Error('Failed to fetch players');
  }
  return response.json();
}

// Get detailed data for a specific player
export async function getPlayerDetails(
  serverName: string,
  playerName: string
): Promise<PlayerData> {
  const response = await fetch(
    `${API_BASE}/servers/${serverName}/players/${encodeURIComponent(playerName)}`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch player details');
  }
  return response.json();
}

export async function updateServer(name: string, updates: UpdateServerRequest): Promise<Server> {
  const response = await fetch(`${API_BASE}/servers/${name}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to update server');
  }

  return data.server;
}

// ==================== Player Management ====================

export interface WhitelistResponse {
  enabled: boolean;
  count: number;
  players: string[];
}

export async function getWhitelist(serverName: string): Promise<WhitelistResponse> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/whitelist`);
  if (!response.ok) {
    throw new Error('Failed to fetch whitelist');
  }
  return response.json();
}

export async function addToWhitelist(serverName: string, player: string): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/whitelist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to add player to whitelist');
  }
}

export async function removeFromWhitelist(serverName: string, player: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/servers/${serverName}/whitelist/${encodeURIComponent(player)}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to remove player from whitelist');
  }
}

export async function toggleWhitelist(serverName: string, enabled: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/whitelist/toggle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to toggle whitelist');
  }
}

export async function grantOp(serverName: string, player: string): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to grant operator status');
  }
}

export async function revokeOp(serverName: string, player: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/servers/${serverName}/ops/${encodeURIComponent(player)}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to revoke operator status');
  }
}

export interface BanListResponse {
  count: number;
  players: string[];
}

export async function getBanList(serverName: string): Promise<BanListResponse> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/bans`);
  if (!response.ok) {
    throw new Error('Failed to fetch ban list');
  }
  return response.json();
}

export async function banPlayer(
  serverName: string,
  player: string,
  reason?: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/bans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player, reason }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to ban player');
  }
}

export async function unbanPlayer(serverName: string, player: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/servers/${serverName}/bans/${encodeURIComponent(player)}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to unban player');
  }
}

export async function kickPlayer(
  serverName: string,
  player: string,
  reason?: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/kick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player, reason }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to kick player');
  }
}

export interface IpBanListResponse {
  count: number;
  ips: string[];
}

export async function getIpBanList(serverName: string): Promise<IpBanListResponse> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/bans/ips`);
  if (!response.ok) {
    throw new Error('Failed to fetch IP ban list');
  }
  return response.json();
}

export async function banIp(serverName: string, ip: string, reason?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/bans/ips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, reason }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to ban IP');
  }
}

export async function unbanIp(serverName: string, ip: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/servers/${serverName}/bans/ips/${encodeURIComponent(ip)}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to unban IP');
  }
}

// ==================== Live Settings (RCON) ====================

export interface CommandResult {
  command: string;
  result: string;
  serverName: string;
}

export async function setDifficulty(
  serverName: string,
  difficulty: string
): Promise<CommandResult> {
  return executeCommand(serverName, `difficulty ${difficulty}`).then((result) => ({
    command: `difficulty ${difficulty}`,
    result,
    serverName,
  }));
}

export async function setDefaultGamemode(
  serverName: string,
  gamemode: string
): Promise<CommandResult> {
  return executeCommand(serverName, `defaultgamemode ${gamemode}`).then((result) => ({
    command: `defaultgamemode ${gamemode}`,
    result,
    serverName,
  }));
}

export async function setWeather(
  serverName: string,
  weather: string,
  duration?: number
): Promise<CommandResult> {
  const cmd = duration ? `weather ${weather} ${duration}` : `weather ${weather}`;
  return executeCommand(serverName, cmd).then((result) => ({
    command: cmd,
    result,
    serverName,
  }));
}

export async function setTime(serverName: string, time: string): Promise<CommandResult> {
  return executeCommand(serverName, `time set ${time}`).then((result) => ({
    command: `time set ${time}`,
    result,
    serverName,
  }));
}

export async function setGamerule(
  serverName: string,
  rule: string,
  value: string | boolean
): Promise<CommandResult> {
  const val = typeof value === 'boolean' ? value.toString() : value;
  return executeCommand(serverName, `gamerule ${rule} ${val}`).then((result) => ({
    command: `gamerule ${rule} ${val}`,
    result,
    serverName,
  }));
}

export async function getGamerule(serverName: string, rule: string): Promise<string> {
  const result = await executeCommand(serverName, `gamerule ${rule}`);
  // Parse "Gamerule ruleName is currently set to: value"
  const match = result.match(/is currently set to:\s*(\S+)/i) || result.match(/=\s*(\S+)/);
  return match ? match[1] : result;
}

export async function setWorldBorder(
  serverName: string,
  size: number,
  time?: number
): Promise<CommandResult> {
  const cmd = time ? `worldborder set ${size} ${time}` : `worldborder set ${size}`;
  return executeCommand(serverName, cmd).then((result) => ({
    command: cmd,
    result,
    serverName,
  }));
}

export async function sayMessage(serverName: string, message: string): Promise<CommandResult> {
  return executeCommand(serverName, `say ${message}`).then((result) => ({
    command: `say ${message}`,
    result,
    serverName,
  }));
}

// Player-specific commands
export async function setPlayerGamemode(
  serverName: string,
  player: string,
  gamemode: string
): Promise<CommandResult> {
  return executeCommand(serverName, `gamemode ${gamemode} ${player}`).then((result) => ({
    command: `gamemode ${gamemode} ${player}`,
    result,
    serverName,
  }));
}

export async function teleportPlayer(
  serverName: string,
  player: string,
  x: number,
  y: number,
  z: number
): Promise<CommandResult> {
  return executeCommand(serverName, `tp ${player} ${x} ${y} ${z}`).then((result) => ({
    command: `tp ${player} ${x} ${y} ${z}`,
    result,
    serverName,
  }));
}

export async function givePlayerEffect(
  serverName: string,
  player: string,
  effect: string,
  duration: number = 30,
  amplifier: number = 0
): Promise<CommandResult> {
  return executeCommand(
    serverName,
    `effect give ${player} ${effect} ${duration} ${amplifier}`
  ).then((result) => ({
    command: `effect give ${player} ${effect} ${duration} ${amplifier}`,
    result,
    serverName,
  }));
}

export async function clearPlayerEffects(
  serverName: string,
  player: string
): Promise<CommandResult> {
  return executeCommand(serverName, `effect clear ${player}`).then((result) => ({
    command: `effect clear ${player}`,
    result,
    serverName,
  }));
}

export async function healPlayer(serverName: string, player: string): Promise<CommandResult> {
  // Give instant health effect at high level to fully heal
  return executeCommand(serverName, `effect give ${player} instant_health 1 100`).then(
    (result) => ({
      command: `effect give ${player} instant_health 1 100`,
      result,
      serverName,
    })
  );
}

export async function feedPlayer(serverName: string, player: string): Promise<CommandResult> {
  // Give saturation effect to fully feed
  return executeCommand(serverName, `effect give ${player} saturation 1 100`).then((result) => ({
    command: `effect give ${player} saturation 1 100`,
    result,
    serverName,
  }));
}

// ============== Backup API ==============

export interface Backup {
  id: string;
  serverId: string;
  tenantId: string;
  name: string;
  description?: string;
  sizeBytes: number;
  compressionFormat: string;
  storagePath: string;
  checksum: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  minecraftVersion: string;
  worldSize: number;
  isAutomatic: boolean;
  tags: string[];
  errorMessage?: string;
  // Google Drive integration
  driveFileId?: string;
  driveWebLink?: string;
}

export interface BackupListResponse {
  backups: Backup[];
  total: number;
}

export interface CreateBackupRequest {
  name?: string;
  description?: string;
  tags?: string[];
}

export async function listBackups(serverName: string): Promise<BackupListResponse> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/backups`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to fetch backups');
  }
  return response.json();
}

export async function createBackup(
  serverName: string,
  options?: CreateBackupRequest
): Promise<{ message: string; backup: Backup }> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/backups`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(options || {}),
  });

  handleUnauthorized(response);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to create backup');
  }

  return response.json();
}

export async function getBackup(backupId: string): Promise<Backup> {
  const response = await fetch(`${API_BASE}/backups/${backupId}`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Backup not found');
  }
  return response.json();
}

export async function deleteBackup(backupId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/backups/${backupId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  handleUnauthorized(response);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to delete backup');
  }
}

export async function restoreBackup(backupId: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/backups/${backupId}/restore`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });

  handleUnauthorized(response);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to restore backup');
  }

  return response.json();
}

export async function downloadBackup(backupId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/backups/${backupId}/download`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to download backup');
  }
  return response.blob();
}

// ============== Backup Schedule API ==============

export interface BackupSchedule {
  serverId: string;
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
  lastBackupAt?: string;
  nextBackupAt?: string;
}

export async function getBackupSchedule(serverName: string): Promise<BackupSchedule> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/backups/schedule`, {
    headers: getAuthHeaders(),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error('Failed to fetch backup schedule');
  }
  return response.json();
}

export async function setBackupSchedule(
  serverName: string,
  config: { enabled: boolean; intervalHours: number; retentionCount: number }
): Promise<{ message: string; schedule: BackupSchedule }> {
  const response = await fetch(`${API_BASE}/servers/${serverName}/backups/schedule`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(config),
  });

  handleUnauthorized(response);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to set backup schedule');
  }

  return response.json();
}
