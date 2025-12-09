import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { K8sClient, MinecraftServerSpec, MinecraftServerStatus } from './k8s-client.js';
import { SyncService } from './services/sync-service.js';
import { BackupService } from './services/backup-service.js';
import { MetricsService, ServerMetrics } from './services/metrics-service.js';
import { getEventBus, EventType } from './events/event-bus.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Configuration
const PORT = process.env.PORT || 8080;
const K8S_NAMESPACE = process.env.K8S_NAMESPACE || 'minecraft-servers';

// Initialize K8s client and services
const k8sClient = new K8sClient(K8S_NAMESPACE);
const syncService = new SyncService(k8sClient);
const backupService = new BackupService(K8S_NAMESPACE);
const metricsService = new MetricsService(K8S_NAMESPACE);
const eventBus = getEventBus();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', async (_req: Request, res: Response) => {
  const k8sHealthy = await k8sClient.healthCheck();
  res.json({
    status: 'healthy',
    kubernetes: k8sHealthy,
    namespace: K8S_NAMESPACE,
    timestamp: new Date().toISOString(),
  });
});

// API Routes

// List all servers
app.get('/api/v1/servers', async (_req: Request, res: Response) => {
  try {
    const servers = await k8sClient.listMinecraftServers();
    res.json({
      servers,
      total: servers.length,
    });
  } catch (error: any) {
    console.error('Failed to list servers:', error);
    res.status(500).json({
      error: 'list_failed',
      message: error.message,
    });
  }
});

// Create a new server
interface CreateServerBody {
  name: string;
  version?: string;
  maxPlayers?: number;
  gamemode?: string;
  difficulty?: string;
  motd?: string;
  memory?: string;
}

app.post('/api/v1/servers', async (req: Request<{}, {}, CreateServerBody>, res: Response) => {
  try {
    const { name, version, maxPlayers, gamemode, difficulty, motd, memory } = req.body;

    if (!name) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Server name is required',
      });
    }

    const spec: Partial<MinecraftServerSpec> = {
      version: version || 'LATEST',
      config: {
        maxPlayers: maxPlayers || 20,
        gamemode: gamemode || 'survival',
        difficulty: difficulty || 'normal',
        levelName: 'world',
        motd: motd || 'A Minecraft Server',
        whiteList: false,
        onlineMode: false,
        pvp: true,
        enableCommandBlock: true,
      },
      resources: {
        cpuRequest: '500m',
        cpuLimit: '2000m',
        memoryRequest: '1Gi',
        memoryLimit: (memory || '2G') + 'i',
        memory: memory || '2G',
        storage: '10Gi',
      },
    };

    const server = await k8sClient.createMinecraftServer(name, spec);

    // Broadcast to WebSocket clients
    broadcastServerUpdate('created', server);

    res.status(201).json({
      message: 'Server creation initiated',
      server,
    });
  } catch (error: any) {
    console.error('Failed to create server:', error);

    if (error.message.includes('already exists')) {
      return res.status(409).json({
        error: 'server_exists',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'creation_failed',
      message: error.message,
    });
  }
});

// Get a specific server
app.get('/api/v1/servers/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const server = await k8sClient.getMinecraftServer(name);

    if (!server) {
      return res.status(404).json({
        error: 'not_found',
        message: `Server '${name}' not found`,
      });
    }

    res.json(server);
  } catch (error: any) {
    console.error('Failed to get server:', error);
    res.status(500).json({
      error: 'get_failed',
      message: error.message,
    });
  }
});

// Delete a server
app.delete('/api/v1/servers/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    await k8sClient.deleteMinecraftServer(name);

    // Broadcast to WebSocket clients
    broadcastServerUpdate('deleted', { name, namespace: K8S_NAMESPACE, phase: 'Deleted' });

    res.json({
      message: `Server '${name}' deletion initiated`,
    });
  } catch (error: any) {
    console.error('Failed to delete server:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'not_found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'delete_failed',
      message: error.message,
    });
  }
});

// Get server logs
app.get('/api/v1/servers/:name/logs', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const lines = parseInt(req.query.lines as string) || 100;
    const logs = await k8sClient.getServerLogs(name, lines);

    res.json({
      logs: logs.split('\n'),
      serverName: name,
    });
  } catch (error: any) {
    console.error('Failed to get server logs:', error);
    res.status(500).json({
      error: 'logs_failed',
      message: error.message,
    });
  }
});

// Update server configuration
interface UpdateServerBody {
  version?: string;
  maxPlayers?: number;
  gamemode?: string;
  difficulty?: string;
  motd?: string;
}

app.patch('/api/v1/servers/:name', async (req: Request<{ name: string }, {}, UpdateServerBody>, res: Response) => {
  try {
    const { name } = req.params;
    const { version, maxPlayers, gamemode, difficulty, motd } = req.body;

    const updates: Partial<MinecraftServerSpec> = {};

    if (version) {
      updates.version = version;
    }

    if (maxPlayers || gamemode || difficulty || motd) {
      updates.config = {} as any;
      if (maxPlayers) updates.config!.maxPlayers = maxPlayers;
      if (gamemode) updates.config!.gamemode = gamemode;
      if (difficulty) updates.config!.difficulty = difficulty;
      if (motd) updates.config!.motd = motd;
    }

    const server = await k8sClient.updateMinecraftServer(name, updates);

    broadcastServerUpdate('updated', server);

    res.json({
      message: 'Server update initiated',
      server,
    });
  } catch (error: any) {
    console.error('Failed to update server:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'not_found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'update_failed',
      message: error.message,
    });
  }
});

// Scale server resources
interface ScaleServerBody {
  cpuLimit?: string;
  memoryLimit?: string;
  memory?: string;
}

app.post('/api/v1/servers/:name/scale', async (req: Request<{ name: string }, {}, ScaleServerBody>, res: Response) => {
  try {
    const { name } = req.params;
    const { cpuLimit, memoryLimit, memory } = req.body;

    const server = await k8sClient.scaleMinecraftServer(name, {
      cpuLimit,
      memoryLimit,
      memory,
    });

    broadcastServerUpdate('scaled', server);

    res.json({
      message: 'Server scaling initiated',
      server,
    });
  } catch (error: any) {
    console.error('Failed to scale server:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'not_found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'scale_failed',
      message: error.message,
    });
  }
});

// Stop a server (scale StatefulSet to 0)
app.post('/api/v1/servers/:name/stop', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    await k8sClient.stopServer(name);

    broadcastServerUpdate('stopped', { name, namespace: K8S_NAMESPACE, phase: 'Stopped' });

    res.json({
      message: `Server '${name}' stop initiated`,
      server: { name, phase: 'Stopping' },
    });
  } catch (error: any) {
    console.error('Failed to stop server:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'not_found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'stop_failed',
      message: error.message,
    });
  }
});

// Start a server (scale StatefulSet to 1)
app.post('/api/v1/servers/:name/start', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    await k8sClient.startServer(name);

    broadcastServerUpdate('started', { name, namespace: K8S_NAMESPACE, phase: 'Starting' });

    res.json({
      message: `Server '${name}' start initiated`,
      server: { name, phase: 'Starting' },
    });
  } catch (error: any) {
    console.error('Failed to start server:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'not_found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'start_failed',
      message: error.message,
    });
  }
});

// Get pod status
app.get('/api/v1/servers/:name/pod', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const podStatus = await k8sClient.getPodStatus(name);

    if (!podStatus) {
      return res.status(404).json({
        error: 'not_found',
        message: `Pod for server '${name}' not found`,
      });
    }

    res.json(podStatus);
  } catch (error: any) {
    console.error('Failed to get pod status:', error);
    res.status(500).json({
      error: 'pod_status_failed',
      message: error.message,
    });
  }
});

// Get server metrics
app.get('/api/v1/servers/:name/metrics', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const metrics = metricsService.getServerMetrics(name);

    if (!metrics) {
      return res.status(404).json({
        error: 'not_found',
        message: `Metrics for server '${name}' not found`,
      });
    }

    res.json({
      serverName: name,
      metrics: {
        cpu: metrics.pod?.cpu,
        memory: metrics.pod?.memory,
        uptime: metrics.uptime,
        uptimeFormatted: metrics.uptime ? MetricsService.formatUptime(metrics.uptime) : undefined,
        restartCount: metrics.restartCount,
        ready: metrics.ready,
        startTime: metrics.startTime,
      },
    });
  } catch (error: any) {
    console.error('Failed to get server metrics:', error);
    res.status(500).json({
      error: 'metrics_failed',
      message: error.message,
    });
  }
});

// Get all metrics
app.get('/api/v1/metrics', async (_req: Request, res: Response) => {
  try {
    const allMetrics = metricsService.getAllMetrics();
    const metricsObj: Record<string, any> = {};

    allMetrics.forEach((metrics, serverName) => {
      metricsObj[serverName] = {
        cpu: metrics.pod?.cpu,
        memory: metrics.pod?.memory,
        uptime: metrics.uptime,
        uptimeFormatted: metrics.uptime ? MetricsService.formatUptime(metrics.uptime) : undefined,
        restartCount: metrics.restartCount,
        ready: metrics.ready,
        startTime: metrics.startTime,
      };
    });

    res.json({
      metrics: metricsObj,
      serverCount: allMetrics.size,
    });
  } catch (error: any) {
    console.error('Failed to get all metrics:', error);
    res.status(500).json({
      error: 'metrics_failed',
      message: error.message,
    });
  }
});

// Execute console command (RCON)
interface ExecuteCommandBody {
  command: string;
}

app.post('/api/v1/servers/:name/console', async (req: Request<{ name: string }, {}, ExecuteCommandBody>, res: Response) => {
  try {
    const { name } = req.params;
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Command is required',
      });
    }

    const result = await k8sClient.executeCommand(name, command);

    res.json({
      command,
      result,
      serverName: name,
    });
  } catch (error: any) {
    console.error('Failed to execute command:', error);
    res.status(500).json({
      error: 'command_failed',
      message: error.message,
    });
  }
});

// ==================== BACKUP ENDPOINTS ====================

// Create a backup
interface CreateBackupBody {
  name?: string;
  description?: string;
  tags?: string[];
}

app.post('/api/v1/servers/:name/backups', async (req: Request<{ name: string }, {}, CreateBackupBody>, res: Response) => {
  try {
    const { name: serverName } = req.params;
    const { name, description, tags } = req.body;

    const backup = await backupService.createBackup({
      serverId: serverName,
      tenantId: 'default-tenant', // TODO: Get from auth
      name,
      description,
      tags,
      isAutomatic: false,
    });

    res.status(201).json({
      message: 'Backup creation initiated',
      backup,
    });
  } catch (error: any) {
    console.error('Failed to create backup:', error);
    res.status(500).json({
      error: 'backup_failed',
      message: error.message,
    });
  }
});

// List backups for a server
app.get('/api/v1/servers/:name/backups', async (req: Request, res: Response) => {
  try {
    const { name: serverName } = req.params;
    const backups = backupService.listBackups(serverName);

    res.json({
      backups,
      total: backups.length,
    });
  } catch (error: any) {
    console.error('Failed to list backups:', error);
    res.status(500).json({
      error: 'list_backups_failed',
      message: error.message,
    });
  }
});

// Get a specific backup
app.get('/api/v1/backups/:backupId', async (req: Request, res: Response) => {
  try {
    const { backupId } = req.params;
    const backup = backupService.getBackup(backupId);

    if (!backup) {
      return res.status(404).json({
        error: 'not_found',
        message: `Backup '${backupId}' not found`,
      });
    }

    res.json(backup);
  } catch (error: any) {
    console.error('Failed to get backup:', error);
    res.status(500).json({
      error: 'get_backup_failed',
      message: error.message,
    });
  }
});

// Delete a backup
app.delete('/api/v1/backups/:backupId', async (req: Request, res: Response) => {
  try {
    const { backupId } = req.params;
    const deleted = await backupService.deleteBackup(backupId);

    if (!deleted) {
      return res.status(404).json({
        error: 'not_found',
        message: `Backup '${backupId}' not found`,
      });
    }

    res.json({
      message: `Backup '${backupId}' deleted`,
    });
  } catch (error: any) {
    console.error('Failed to delete backup:', error);
    res.status(500).json({
      error: 'delete_backup_failed',
      message: error.message,
    });
  }
});

// Restore a backup
app.post('/api/v1/backups/:backupId/restore', async (req: Request, res: Response) => {
  try {
    const { backupId } = req.params;
    await backupService.restoreBackup(backupId);

    res.json({
      message: `Restore from backup '${backupId}' initiated`,
    });
  } catch (error: any) {
    console.error('Failed to restore backup:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'not_found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'restore_failed',
      message: error.message,
    });
  }
});

// WebSocket handling
const wsClients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  console.log('WebSocket client connected');
  wsClients.add(ws);

  // Send current server list on connect
  k8sClient.listMinecraftServers().then(servers => {
    ws.send(JSON.stringify({
      type: 'initial',
      servers,
    }));
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    wsClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
  });
});

function broadcastServerUpdate(event: string, data: any) {
  const message = JSON.stringify({
    type: event,
    server: data,
    timestamp: new Date().toISOString(),
  });

  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastMetricsUpdate(metrics: Map<string, ServerMetrics>) {
  const metricsObj: Record<string, any> = {};
  metrics.forEach((value, key) => {
    metricsObj[key] = {
      cpu: value.pod?.cpu,
      memory: value.pod?.memory,
      uptime: value.uptime,
      restartCount: value.restartCount,
      ready: value.ready,
    };
  });

  const message = JSON.stringify({
    type: 'metrics_update',
    metrics: metricsObj,
    timestamp: new Date().toISOString(),
  });

  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Register sync service callbacks for real-time updates
syncService.registerCallback({
  onServerUpdate: (serverStatus, eventType) => {
    broadcastServerUpdate(eventType.toLowerCase(), serverStatus);
  },
  onSyncComplete: (servers) => {
    const message = JSON.stringify({
      type: 'status_update',
      servers,
      timestamp: new Date().toISOString(),
    });

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  },
});

// Subscribe to event bus for logging/metrics
eventBus.subscribe('*', (event) => {
  console.log(`[Event] ${event.type}: ${event.id}`);
});

// Start server and initialize sync service
server.listen(PORT, async () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       Minecraft Hosting Platform - API Server              ║
╠════════════════════════════════════════════════════════════╣
║  HTTP API:    http://localhost:${PORT}                       ║
║  WebSocket:   ws://localhost:${PORT}/ws                      ║
║  Health:      http://localhost:${PORT}/health                ║
║  Namespace:   ${K8S_NAMESPACE.padEnd(42)}║
╚════════════════════════════════════════════════════════════╝

API Endpoints:
  Servers:
    GET    /api/v1/servers              - List all servers
    POST   /api/v1/servers              - Create a new server
    GET    /api/v1/servers/:name        - Get server details
    PATCH  /api/v1/servers/:name        - Update server config
    DELETE /api/v1/servers/:name        - Delete a server
    GET    /api/v1/servers/:name/logs   - Get server logs
    GET    /api/v1/servers/:name/pod    - Get pod status
    POST   /api/v1/servers/:name/scale  - Scale server resources
    POST   /api/v1/servers/:name/stop   - Stop a server
    POST   /api/v1/servers/:name/start  - Start a server
    POST   /api/v1/servers/:name/console - Execute RCON command

  Backups:
    POST   /api/v1/servers/:name/backups - Create a backup
    GET    /api/v1/servers/:name/backups - List server backups
    GET    /api/v1/backups/:backupId     - Get backup details
    DELETE /api/v1/backups/:backupId     - Delete a backup
    POST   /api/v1/backups/:id/restore   - Restore from backup
`);

  // Start the sync service (K8s watch or polling)
  try {
    await syncService.startWatch();
    console.log('[Startup] Sync service initialized');
  } catch (error) {
    console.error('[Startup] Failed to initialize sync service:', error);
  }

  // Start metrics collection with WebSocket broadcast
  metricsService.setMetricsCallback((metrics) => {
    broadcastMetricsUpdate(metrics);
  });
  metricsService.startPolling(5000); // Poll every 5 seconds
  console.log('[Startup] Metrics service initialized');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM received, shutting down...');
  syncService.stopWatch();
  metricsService.stopPolling();
  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Shutdown] SIGINT received, shutting down...');
  syncService.stopWatch();
  metricsService.stopPolling();
  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });
});
