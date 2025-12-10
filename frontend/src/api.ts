import { Server, CreateServerRequest, ApiResponse } from './types';

const API_BASE = '/api/v1';

export async function listServers(): Promise<Server[]> {
  const response = await fetch(`${API_BASE}/servers`);
  if (!response.ok) {
    throw new Error('Failed to fetch servers');
  }
  const data: ApiResponse<Server> = await response.json();
  return data.servers || [];
}

export async function createServer(request: CreateServerRequest): Promise<Server> {
  const response = await fetch(`${API_BASE}/servers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to create server');
  }

  return data.server;
}

export async function getServer(name: string): Promise<Server> {
  const response = await fetch(`${API_BASE}/servers/${name}`);
  if (!response.ok) {
    throw new Error('Server not found');
  }
  return response.json();
}

export async function deleteServer(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/servers/${name}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to delete server');
  }
}

export async function getServerLogs(name: string, lines: number = 100): Promise<string[]> {
  const response = await fetch(`${API_BASE}/servers/${name}/logs?lines=${lines}`);
  if (!response.ok) {
    throw new Error('Failed to fetch logs');
  }
  const data = await response.json();
  return data.logs || [];
}

export interface ServerMetricsResponse {
  serverName: string;
  metrics: {
    cpu?: { usage: string; usageNano: number };
    memory?: { usage: string; usageBytes: number };
    uptime?: number;
    uptimeFormatted?: string;
    restartCount: number;
    ready: boolean;
    startTime?: string;
  };
}

export async function getServerMetrics(name: string): Promise<ServerMetricsResponse> {
  const response = await fetch(`${API_BASE}/servers/${name}/metrics`);
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
  const response = await fetch(`${API_BASE}/servers/${name}/pod`);
  if (!response.ok) {
    throw new Error('Failed to fetch pod status');
  }
  return response.json();
}

export async function executeCommand(name: string, command: string): Promise<string> {
  const response = await fetch(`${API_BASE}/servers/${name}/console`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command }),
  });

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
}

export interface EquipmentItem {
  id: string;
  count: number;
}

export interface PlayerEquipment {
  head: EquipmentItem | null;
  chest: EquipmentItem | null;
  legs: EquipmentItem | null;
  feet: EquipmentItem | null;
  mainhand: EquipmentItem | null;
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

export async function getServerPlayers(name: string): Promise<PlayersResponse> {
  const response = await fetch(`${API_BASE}/servers/${name}/players`);
  if (!response.ok) {
    throw new Error('Failed to fetch players');
  }
  return response.json();
}
