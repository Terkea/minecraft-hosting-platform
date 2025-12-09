export interface Server {
  name: string;
  namespace: string;
  status: string;
  phase: string;
  message?: string;
  version?: string;
  externalIP?: string;
  port?: number;
  playerCount?: number;
  maxPlayers?: number;
}

export interface CreateServerRequest {
  name: string;
  version?: string;
  maxPlayers?: number;
  gamemode?: string;
  difficulty?: string;
  motd?: string;
  memory?: string;
}

export interface ApiResponse<T> {
  servers?: T[];
  server?: T;
  total?: number;
  message?: string;
  error?: string;
}

export interface WebSocketMessage {
  type: 'initial' | 'created' | 'deleted' | 'status_update';
  servers?: Server[];
  server?: Server;
  timestamp?: string;
}
