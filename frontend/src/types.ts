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
  metrics?: ServerMetrics;
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
    | 'auto_start_configured';
  servers?: Server[];
  server?: Server;
  metrics?: MetricsUpdate;
  timestamp?: string;
}
