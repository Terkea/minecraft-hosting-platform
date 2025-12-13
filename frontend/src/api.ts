import { Server, CreateServerRequest, UpdateServerRequest, ApiResponse } from './types';

const API_BASE = '/api/v1';
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const TOKEN_EXPIRY_KEY = 'token_expiry';

// Refresh buffer - refresh 60 seconds before expiry
const REFRESH_BUFFER_MS = 60 * 1000;

// Track if a refresh is in progress to prevent multiple simultaneous refreshes
let refreshPromise: Promise<boolean> | null = null;

/**
 * Token storage interface for auth module
 */
export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Store tokens in localStorage
 */
export function storeTokens(data: TokenData): void {
  const expiryTime = Date.now() + data.expiresIn * 1000;
  localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
  localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
}

/**
 * Clear all tokens from localStorage
 */
export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
}

/**
 * Get access token from localStorage
 */
export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/**
 * Get refresh token from localStorage
 */
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

/**
 * Check if access token is expired or about to expire
 */
function isTokenExpired(): boolean {
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!expiry) return true;
  return Date.now() >= parseInt(expiry, 10) - REFRESH_BUFFER_MS;
}

/**
 * Refresh the access token using the refresh token
 * Returns true if successful, false otherwise
 */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // Refresh token is invalid or expired
      clearTokens();
      return false;
    }

    const data = await response.json();
    storeTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure we have a valid access token, refreshing if necessary
 * Returns the access token or null if unable to get one
 */
async function ensureValidToken(): Promise<string | null> {
  const accessToken = getAccessToken();

  // No token at all - need to login
  if (!accessToken) {
    return null;
  }

  // Token not expired - use it
  if (!isTokenExpired()) {
    return accessToken;
  }

  // Token expired - try to refresh
  // Use single promise to prevent multiple simultaneous refresh calls
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }

  const success = await refreshPromise;
  if (success) {
    return getAccessToken();
  }

  return null;
}

/**
 * Get headers with auth token
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await ensureValidToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Handle API response - retry on 401 if we can refresh the token
 */
async function handleResponse(
  response: Response,
  retryFn: () => Promise<Response>
): Promise<Response> {
  if (response.status === 401) {
    // Try to refresh the token
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // Retry the request with new token
      return retryFn();
    }
    // Refresh failed - redirect to login
    clearTokens();
    window.location.href = '/login';
  }
  return response;
}

export async function listServers(): Promise<Server[]> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch servers');
  }
  const data: ApiResponse<Server> = await response.json();
  return data.servers || [];
}

export async function createServer(request: CreateServerRequest): Promise<Server> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(request),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to create server');
  }

  return data.server;
}

export async function getServer(id: string): Promise<Server> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Server not found');
  }
  return response.json();
}

export async function deleteServer(id: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to delete server');
  }
}

export async function getServerLogs(id: string, lines: number = 100): Promise<string[]> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/logs?lines=${lines}`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
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
  serverId: string;
  files: LogFile[];
  count: number;
}

export async function getLogFiles(id: string): Promise<LogFilesResponse> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/logs/files`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch log files');
  }
  return response.json();
}

export async function getLogFileContent(
  id: string,
  filename: string,
  lines: number = 500
): Promise<string[]> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/logs/files/${encodeURIComponent(filename)}?lines=${lines}`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch log file content');
  }
  const data = await response.json();
  return data.content || [];
}

export interface ServerMetricsResponse {
  serverId: string;
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

export async function getServerMetrics(id: string): Promise<ServerMetricsResponse> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/metrics`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
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

export async function getPodStatus(id: string): Promise<PodStatus> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/pod`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch pod status');
  }
  return response.json();
}

export async function executeCommand(id: string, command: string): Promise<string> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/console`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ command }),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to execute command');
  }

  const data = await response.json();
  return data.result;
}

export async function stopServer(id: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/stop`, {
      method: 'POST',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to stop server');
  }
}

export async function startServer(id: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/start`, {
      method: 'POST',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
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
export async function getServerPlayers(id: string): Promise<PlayersListResponse> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}/players`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch players');
  }
  return response.json();
}

// Get detailed data for a specific player
export async function getPlayerDetails(serverId: string, playerName: string): Promise<PlayerData> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/players/${encodeURIComponent(playerName)}`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch player details');
  }
  return response.json();
}

export async function updateServer(id: string, updates: UpdateServerRequest): Promise<Server> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${id}`, {
      method: 'PATCH',
      headers: await getAuthHeaders(),
      body: JSON.stringify(updates),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
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

export async function getWhitelist(serverId: string): Promise<WhitelistResponse> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/whitelist`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch whitelist');
  }
  return response.json();
}

export async function addToWhitelist(serverId: string, player: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/whitelist`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ player }),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to add player to whitelist');
  }
}

export async function removeFromWhitelist(serverId: string, player: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/whitelist/${encodeURIComponent(player)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to remove player from whitelist');
  }
}

export async function toggleWhitelist(serverId: string, enabled: boolean): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/whitelist/toggle`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ enabled }),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to toggle whitelist');
  }
}

export async function grantOp(serverId: string, player: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/ops`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ player }),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to grant operator status');
  }
}

export async function revokeOp(serverId: string, player: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/ops/${encodeURIComponent(player)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to revoke operator status');
  }
}

export interface BanListResponse {
  count: number;
  players: string[];
}

export async function getBanList(serverId: string): Promise<BanListResponse> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/bans`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch ban list');
  }
  return response.json();
}

export async function banPlayer(serverId: string, player: string, reason?: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/bans`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ player, reason }),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to ban player');
  }
}

export async function unbanPlayer(serverId: string, player: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/bans/${encodeURIComponent(player)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to unban player');
  }
}

export async function kickPlayer(serverId: string, player: string, reason?: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/kick`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ player, reason }),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to kick player');
  }
}

export interface IpBanListResponse {
  count: number;
  ips: string[];
}

export async function getIpBanList(serverId: string): Promise<IpBanListResponse> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/bans/ips`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch IP ban list');
  }
  return response.json();
}

export async function banIp(serverId: string, ip: string, reason?: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/bans/ips`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ ip, reason }),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to ban IP');
  }
}

export async function unbanIp(serverId: string, ip: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/bans/ips/${encodeURIComponent(ip)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to unban IP');
  }
}

// ==================== Live Settings (RCON) ====================

export interface CommandResult {
  command: string;
  result: string;
  serverId: string;
}

export async function setDifficulty(serverId: string, difficulty: string): Promise<CommandResult> {
  return executeCommand(serverId, `difficulty ${difficulty}`).then((result) => ({
    command: `difficulty ${difficulty}`,
    result,
    serverId,
  }));
}

export async function setDefaultGamemode(
  serverId: string,
  gamemode: string
): Promise<CommandResult> {
  return executeCommand(serverId, `defaultgamemode ${gamemode}`).then((result) => ({
    command: `defaultgamemode ${gamemode}`,
    result,
    serverId,
  }));
}

export async function setWeather(
  serverId: string,
  weather: string,
  duration?: number
): Promise<CommandResult> {
  const cmd = duration ? `weather ${weather} ${duration}` : `weather ${weather}`;
  return executeCommand(serverId, cmd).then((result) => ({
    command: cmd,
    result,
    serverId,
  }));
}

export async function setTime(serverId: string, time: string): Promise<CommandResult> {
  return executeCommand(serverId, `time set ${time}`).then((result) => ({
    command: `time set ${time}`,
    result,
    serverId,
  }));
}

export async function setGamerule(
  serverId: string,
  rule: string,
  value: string | boolean
): Promise<CommandResult> {
  const val = typeof value === 'boolean' ? value.toString() : value;
  return executeCommand(serverId, `gamerule ${rule} ${val}`).then((result) => ({
    command: `gamerule ${rule} ${val}`,
    result,
    serverId,
  }));
}

export async function getGamerule(serverId: string, rule: string): Promise<string> {
  const result = await executeCommand(serverId, `gamerule ${rule}`);
  // Parse "Gamerule ruleName is currently set to: value"
  const match = result.match(/is currently set to:\s*(\S+)/i) || result.match(/=\s*(\S+)/);
  return match ? match[1] : result;
}

export async function setWorldBorder(
  serverId: string,
  size: number,
  time?: number
): Promise<CommandResult> {
  const cmd = time ? `worldborder set ${size} ${time}` : `worldborder set ${size}`;
  return executeCommand(serverId, cmd).then((result) => ({
    command: cmd,
    result,
    serverId,
  }));
}

export async function sayMessage(serverId: string, message: string): Promise<CommandResult> {
  return executeCommand(serverId, `say ${message}`).then((result) => ({
    command: `say ${message}`,
    result,
    serverId,
  }));
}

// Player-specific commands
export async function setPlayerGamemode(
  serverId: string,
  player: string,
  gamemode: string
): Promise<CommandResult> {
  return executeCommand(serverId, `gamemode ${gamemode} ${player}`).then((result) => ({
    command: `gamemode ${gamemode} ${player}`,
    result,
    serverId,
  }));
}

export async function teleportPlayer(
  serverId: string,
  player: string,
  x: number,
  y: number,
  z: number
): Promise<CommandResult> {
  return executeCommand(serverId, `tp ${player} ${x} ${y} ${z}`).then((result) => ({
    command: `tp ${player} ${x} ${y} ${z}`,
    result,
    serverId,
  }));
}

export async function givePlayerEffect(
  serverId: string,
  player: string,
  effect: string,
  duration: number = 30,
  amplifier: number = 0
): Promise<CommandResult> {
  return executeCommand(serverId, `effect give ${player} ${effect} ${duration} ${amplifier}`).then(
    (result) => ({
      command: `effect give ${player} ${effect} ${duration} ${amplifier}`,
      result,
      serverId,
    })
  );
}

export async function clearPlayerEffects(serverId: string, player: string): Promise<CommandResult> {
  return executeCommand(serverId, `effect clear ${player}`).then((result) => ({
    command: `effect clear ${player}`,
    result,
    serverId,
  }));
}

export async function healPlayer(serverId: string, player: string): Promise<CommandResult> {
  // Give instant health effect at high level to fully heal
  return executeCommand(serverId, `effect give ${player} instant_health 1 100`).then((result) => ({
    command: `effect give ${player} instant_health 1 100`,
    result,
    serverId,
  }));
}

export async function feedPlayer(serverId: string, player: string): Promise<CommandResult> {
  // Give saturation effect to fully feed
  return executeCommand(serverId, `effect give ${player} saturation 1 100`).then((result) => ({
    command: `effect give ${player} saturation 1 100`,
    result,
    serverId,
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

export async function listBackups(serverId: string): Promise<BackupListResponse> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/backups`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch backups');
  }
  return response.json();
}

export async function createBackup(
  serverId: string,
  options?: CreateBackupRequest
): Promise<{ message: string; backup: Backup }> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/backups`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(options || {}),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to create backup');
  }

  return response.json();
}

export async function getBackup(backupId: string): Promise<Backup> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/backups/${backupId}`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Backup not found');
  }
  return response.json();
}

export async function deleteBackup(backupId: string): Promise<void> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/backups/${backupId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to delete backup');
  }
}

export async function restoreBackup(backupId: string): Promise<{ message: string }> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/backups/${backupId}/restore`, {
      method: 'POST',
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to restore backup');
  }

  return response.json();
}

export async function downloadBackup(backupId: string): Promise<Blob> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/backups/${backupId}/download`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
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

export async function getBackupSchedule(serverId: string): Promise<BackupSchedule> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/backups/schedule`, {
      headers: await getAuthHeaders(),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    throw new Error('Failed to fetch backup schedule');
  }
  return response.json();
}

export async function setBackupSchedule(
  serverId: string,
  config: { enabled: boolean; intervalHours: number; retentionCount: number }
): Promise<{ message: string; schedule: BackupSchedule }> {
  const makeRequest = async () =>
    fetch(`${API_BASE}/servers/${serverId}/backups/schedule`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify(config),
    });

  const response = await handleResponse(await makeRequest(), makeRequest);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to set backup schedule');
  }

  return response.json();
}
