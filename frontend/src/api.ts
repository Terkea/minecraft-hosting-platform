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
