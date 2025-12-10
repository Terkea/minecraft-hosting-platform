import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { K8sClient, MinecraftServerSpec } from './k8s-client.js';
import { SyncService } from './services/sync-service.js';
import { BackupService } from './services/backup-service.js';
import { MetricsService, ServerMetrics } from './services/metrics-service.js';
import { getEventBus } from './events/event-bus.js';

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

app.patch(
  '/api/v1/servers/:name',
  async (req: Request<{ name: string }, {}, UpdateServerBody>, res: Response) => {
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
  }
);

// Scale server resources
interface ScaleServerBody {
  cpuLimit?: string;
  memoryLimit?: string;
  memory?: string;
}

app.post(
  '/api/v1/servers/:name/scale',
  async (req: Request<{ name: string }, {}, ScaleServerBody>, res: Response) => {
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
  }
);

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

// Get online players with detailed data
app.get('/api/v1/servers/:name/players', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    // First check if server exists and is running
    const server = await k8sClient.getMinecraftServer(name);
    if (!server) {
      return res.status(404).json({
        error: 'not_found',
        message: `Server '${name}' not found`,
      });
    }

    if (server.phase?.toLowerCase() !== 'running') {
      return res.json({
        online: 0,
        max: server.maxPlayers || 20,
        players: [],
      });
    }

    // Get player list using RCON
    const listResult = await k8sClient.executeCommand(name, 'list');

    // Parse "There are X of a max of Y players online: player1, player2"
    const listMatch = listResult.match(
      /There are (\d+) of a max of (\d+) players online[:\s]*(.*)?/i
    );

    if (!listMatch) {
      // No players or couldn't parse
      return res.json({
        online: 0,
        max: server.maxPlayers || 20,
        players: [],
      });
    }

    const online = parseInt(listMatch[1], 10);
    const max = parseInt(listMatch[2], 10);
    const playerNames = listMatch[3]
      ? listMatch[3]
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n)
      : [];

    if (playerNames.length === 0) {
      return res.json({
        online,
        max,
        players: [],
      });
    }

    // Check if detailed data is requested (default: true)
    const detailed = req.query.detailed !== 'false';

    let players: any[];

    if (detailed && playerNames.length > 0) {
      // Fetch detailed data for all players in parallel with timeout
      // Query specific fields separately to avoid truncation of the large NBT output
      const playerPromises = playerNames.map(async (playerName) => {
        try {
          // Add timeout of 10 seconds per player
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 10000)
          );

          // Fetch data in parallel - query specific fields to avoid truncation
          const dataPromises = [
            k8sClient.executeCommand(name, `data get entity ${playerName} Health`),
            k8sClient.executeCommand(name, `data get entity ${playerName} foodLevel`),
            k8sClient.executeCommand(name, `data get entity ${playerName} Pos`),
            k8sClient.executeCommand(name, `data get entity ${playerName} Dimension`),
            k8sClient.executeCommand(name, `data get entity ${playerName} playerGameType`),
            k8sClient.executeCommand(name, `data get entity ${playerName} Inventory`),
            k8sClient.executeCommand(name, `data get entity ${playerName} XpLevel`),
            k8sClient.executeCommand(name, `data get entity ${playerName} SelectedItemSlot`),
            k8sClient.executeCommand(name, `data get entity ${playerName} equipment`),
          ];

          const results = (await Promise.race([
            Promise.all(dataPromises),
            timeoutPromise,
          ])) as string[];

          return parsePlayerDataFromFields(playerName, results);
        } catch (err) {
          // Return minimal data if we can't get full data
          console.error(`Error fetching player data for ${playerName}:`, err);
          return getMinimalPlayerData(playerName);
        }
      });

      players = await Promise.all(playerPromises);
    } else {
      // Return minimal data for each player (fast)
      players = playerNames.map((playerName) => getMinimalPlayerData(playerName));
    }

    res.json({
      online,
      max,
      players,
    });
  } catch (error: any) {
    console.error('Failed to get players:', error);
    res.status(500).json({
      error: 'players_failed',
      message: error.message,
    });
  }
});

// Parse player data from individual field queries
function parsePlayerDataFromFields(playerName: string, results: string[]): any {
  const player: any = {
    name: playerName,
    health: 20,
    maxHealth: 20,
    foodLevel: 20,
    foodSaturation: 5,
    xpLevel: 0,
    xpTotal: 0,
    gameMode: 0,
    gameModeName: 'Survival',
    position: { x: 0, y: 64, z: 0 },
    dimension: 'overworld',
    rotation: { yaw: 0, pitch: 0 },
    air: 300,
    fire: -20,
    onGround: true,
    isFlying: false,
    inventory: [],
    equipment: {
      head: null,
      chest: null,
      legs: null,
      feet: null,
      mainhand: null,
      offhand: null,
    },
    enderItems: [],
    selectedSlot: 0,
    abilities: {
      invulnerable: false,
      mayFly: false,
      instabuild: false,
      flying: false,
      walkSpeed: 0.1,
      flySpeed: 0.05,
    },
  };

  try {
    // Results are: [Health, foodLevel, Pos, Dimension, playerGameType, Inventory, XpLevel, SelectedItemSlot, equipment]
    const [healthStr, foodStr, posStr, dimStr, gameTypeStr, invStr, xpStr, slotStr, equipStr] =
      results;

    // Parse Health - format: "Player has the following entity data: 20.0f"
    const healthMatch = healthStr.match(/([\d.]+)f?$/);
    if (healthMatch) player.health = parseFloat(healthMatch[1]);

    // Parse foodLevel - format: "Player has the following entity data: 20"
    const foodMatch = foodStr.match(/(\d+)$/);
    if (foodMatch) player.foodLevel = parseInt(foodMatch[1], 10);

    // Parse Pos - format: "Player has the following entity data: [123.0d, 64.0d, -456.0d]"
    const posMatch = posStr.match(/\[([-\d.]+)d?,\s*([-\d.]+)d?,\s*([-\d.]+)d?\]/);
    if (posMatch) {
      player.position = {
        x: parseFloat(posMatch[1]),
        y: parseFloat(posMatch[2]),
        z: parseFloat(posMatch[3]),
      };
    }

    // Parse Dimension - format: "Player has the following entity data: "minecraft:overworld""
    const dimMatch = dimStr.match(/"([^"]+)"$/);
    if (dimMatch) player.dimension = dimMatch[1].replace('minecraft:', '');

    // Parse playerGameType - format: "Player has the following entity data: 0"
    const gameMatch = gameTypeStr.match(/(\d+)$/);
    if (gameMatch) {
      player.gameMode = parseInt(gameMatch[1], 10);
      player.gameModeName =
        ['Survival', 'Creative', 'Adventure', 'Spectator'][player.gameMode] || 'Unknown';
    }

    // Parse Inventory - format: "Player has the following entity data: [{...}, {...}]"
    const invArrayMatch = invStr.match(/\[(.+)\]$/s);
    if (invArrayMatch) {
      player.inventory = parseInventoryItems(invArrayMatch[1]);
    }

    // Parse XpLevel
    const xpMatch = xpStr.match(/(\d+)$/);
    if (xpMatch) player.xpLevel = parseInt(xpMatch[1], 10);

    // Parse SelectedItemSlot
    const slotMatch = slotStr.match(/(\d+)$/);
    if (slotMatch) player.selectedSlot = parseInt(slotMatch[1], 10);

    // Parse equipment - format: "Player has the following entity data: {head: {...}, chest: {...}, ...}"
    if (equipStr) {
      // Parse head slot
      const headMatch = equipStr.match(/head:\s*\{([^}]+)\}/);
      if (headMatch) {
        const idMatch = headMatch[1].match(/id:\s*"([^"]+)"/);
        if (idMatch) player.equipment.head = { id: idMatch[1], count: 1 };
      }

      // Parse chest slot
      const chestMatch = equipStr.match(/chest:\s*\{([^}]+)\}/);
      if (chestMatch) {
        const idMatch = chestMatch[1].match(/id:\s*"([^"]+)"/);
        if (idMatch) player.equipment.chest = { id: idMatch[1], count: 1 };
      }

      // Parse legs slot
      const legsMatch = equipStr.match(/legs:\s*\{([^}]+)\}/);
      if (legsMatch) {
        const idMatch = legsMatch[1].match(/id:\s*"([^"]+)"/);
        if (idMatch) player.equipment.legs = { id: idMatch[1], count: 1 };
      }

      // Parse feet slot
      const feetMatch = equipStr.match(/feet:\s*\{([^}]+)\}/);
      if (feetMatch) {
        const idMatch = feetMatch[1].match(/id:\s*"([^"]+)"/);
        if (idMatch) player.equipment.feet = { id: idMatch[1], count: 1 };
      }

      // Parse mainhand slot
      const mainhandMatch = equipStr.match(/mainhand:\s*\{([^}]+)\}/);
      if (mainhandMatch) {
        const idMatch = mainhandMatch[1].match(/id:\s*"([^"]+)"/);
        if (idMatch) player.equipment.mainhand = { id: idMatch[1], count: 1 };
      }

      // Parse offhand slot
      const offhandMatch = equipStr.match(/offhand:\s*\{([^}]+)\}/);
      if (offhandMatch) {
        const idMatch = offhandMatch[1].match(/id:\s*"([^"]+)"/);
        if (idMatch) player.equipment.offhand = { id: idMatch[1], count: 1 };
      }
    }
  } catch (parseError) {
    console.error('Error parsing player field data:', parseError);
  }

  return player;
}

// Return minimal player data (when detailed fetch fails or is disabled)
function getMinimalPlayerData(playerName: string): any {
  return {
    name: playerName,
    health: 20,
    maxHealth: 20,
    foodLevel: 20,
    foodSaturation: 5,
    xpLevel: 0,
    xpTotal: 0,
    gameMode: 0,
    gameModeName: 'Survival',
    position: { x: 0, y: 64, z: 0 },
    dimension: 'overworld',
    rotation: { yaw: 0, pitch: 0 },
    air: 300,
    fire: -20,
    onGround: true,
    isFlying: false,
    inventory: [],
    equipment: {
      head: null,
      chest: null,
      legs: null,
      feet: null,
      mainhand: null,
      offhand: null,
    },
    enderItems: [],
    selectedSlot: 0,
    abilities: {
      invulnerable: false,
      mayFly: false,
      instabuild: false,
      flying: false,
      walkSpeed: 0.1,
      flySpeed: 0.05,
    },
  };
}

// Parse player NBT data from "data get entity" command
function _parsePlayerData(playerName: string, nbtString: string): any {
  const player: any = {
    name: playerName,
    health: 20,
    maxHealth: 20,
    foodLevel: 20,
    foodSaturation: 5,
    xpLevel: 0,
    xpTotal: 0,
    gameMode: 0,
    gameModeName: 'Survival',
    position: { x: 0, y: 64, z: 0 },
    dimension: 'overworld',
    rotation: { yaw: 0, pitch: 0 },
    air: 300,
    fire: -20,
    onGround: true,
    isFlying: false,
    inventory: [],
    enderItems: [],
    selectedSlot: 0,
    abilities: {
      invulnerable: false,
      mayFly: false,
      instabuild: false,
      flying: false,
      walkSpeed: 0.1,
      flySpeed: 0.05,
    },
  };

  try {
    // Parse Health
    const healthMatch = nbtString.match(/Health:\s*([\d.]+)f/);
    if (healthMatch) player.health = parseFloat(healthMatch[1]);

    // Parse foodLevel
    const foodMatch = nbtString.match(/foodLevel:\s*(\d+)/);
    if (foodMatch) player.foodLevel = parseInt(foodMatch[1], 10);

    // Parse foodSaturationLevel
    const satMatch = nbtString.match(/foodSaturationLevel:\s*([\d.]+)f/);
    if (satMatch) player.foodSaturation = parseFloat(satMatch[1]);

    // Parse XpLevel
    const xpLevelMatch = nbtString.match(/XpLevel:\s*(\d+)/);
    if (xpLevelMatch) player.xpLevel = parseInt(xpLevelMatch[1], 10);

    // Parse XpTotal
    const xpTotalMatch = nbtString.match(/XpTotal:\s*(\d+)/);
    if (xpTotalMatch) player.xpTotal = parseInt(xpTotalMatch[1], 10);

    // Parse playerGameType
    const gameModeMatch = nbtString.match(/playerGameType:\s*(\d+)/);
    if (gameModeMatch) {
      player.gameMode = parseInt(gameModeMatch[1], 10);
      player.gameModeName =
        ['Survival', 'Creative', 'Adventure', 'Spectator'][player.gameMode] || 'Unknown';
    }

    // Parse Pos
    const posMatch = nbtString.match(/Pos:\s*\[([-\d.]+)d,\s*([-\d.]+)d,\s*([-\d.]+)d\]/);
    if (posMatch) {
      player.position = {
        x: parseFloat(posMatch[1]),
        y: parseFloat(posMatch[2]),
        z: parseFloat(posMatch[3]),
      };
    }

    // Parse Dimension
    const dimMatch = nbtString.match(/Dimension:\s*"([^"]+)"/);
    if (dimMatch) {
      player.dimension = dimMatch[1].replace('minecraft:', '');
    }

    // Parse Rotation
    const rotMatch = nbtString.match(/Rotation:\s*\[([-\d.]+)f,\s*([-\d.]+)f\]/);
    if (rotMatch) {
      player.rotation = {
        yaw: parseFloat(rotMatch[1]),
        pitch: parseFloat(rotMatch[2]),
      };
    }

    // Parse Air
    const airMatch = nbtString.match(/Air:\s*(\d+)s/);
    if (airMatch) player.air = parseInt(airMatch[1], 10);

    // Parse Fire
    const fireMatch = nbtString.match(/Fire:\s*([-\d]+)s/);
    if (fireMatch) player.fire = parseInt(fireMatch[1], 10);

    // Parse OnGround
    const groundMatch = nbtString.match(/OnGround:\s*(\d)b/);
    if (groundMatch) player.onGround = groundMatch[1] === '1';

    // Parse SelectedItemSlot
    const slotMatch = nbtString.match(/SelectedItemSlot:\s*(\d+)/);
    if (slotMatch) player.selectedSlot = parseInt(slotMatch[1], 10);

    // Parse abilities
    const abilitiesMatch = nbtString.match(/abilities:\s*\{([^}]+)\}/);
    if (abilitiesMatch) {
      const abilitiesStr = abilitiesMatch[1];
      const invMatch = abilitiesStr.match(/invulnerable:\s*(\d)b/);
      if (invMatch) player.abilities.invulnerable = invMatch[1] === '1';
      const flyMatch = abilitiesStr.match(/mayfly:\s*(\d)b/);
      if (flyMatch) player.abilities.mayFly = flyMatch[1] === '1';
      const buildMatch = abilitiesStr.match(/instabuild:\s*(\d)b/);
      if (buildMatch) player.abilities.instabuild = buildMatch[1] === '1';
      const flyingMatch = abilitiesStr.match(/flying:\s*(\d)b/);
      if (flyingMatch) {
        player.abilities.flying = flyingMatch[1] === '1';
        player.isFlying = player.abilities.flying;
      }
      const walkMatch = abilitiesStr.match(/walkSpeed:\s*([\d.]+)f/);
      if (walkMatch) player.abilities.walkSpeed = parseFloat(walkMatch[1]);
      const flySpeedMatch = abilitiesStr.match(/flySpeed:\s*([\d.]+)f/);
      if (flySpeedMatch) player.abilities.flySpeed = parseFloat(flySpeedMatch[1]);
    }

    // Parse Inventory - extract the array contents between Inventory: [ and the matching ]
    const invMatch = extractNbtArray(nbtString, 'Inventory');
    if (invMatch) {
      player.inventory = parseInventoryItems(invMatch);
    }

    // Parse EnderItems
    const enderMatch = extractNbtArray(nbtString, 'EnderItems');
    if (enderMatch) {
      player.enderItems = parseInventoryItems(enderMatch);
    }
  } catch (parseError) {
    console.error('Error parsing player NBT data:', parseError);
  }

  return player;
}

// Extract NBT array contents by finding matching brackets
function extractNbtArray(nbtString: string, arrayName: string): string | null {
  const startPattern = new RegExp(`${arrayName}:\\s*\\[`);
  const match = startPattern.exec(nbtString);
  if (!match) return null;

  const startIdx = match.index + match[0].length;
  let depth = 1;
  let endIdx = startIdx;

  for (let i = startIdx; i < nbtString.length && depth > 0; i++) {
    if (nbtString[i] === '[') depth++;
    else if (nbtString[i] === ']') depth--;
    endIdx = i;
  }

  return nbtString.slice(startIdx, endIdx);
}

// Parse inventory items from NBT string
function parseInventoryItems(invString: string): any[] {
  const items: any[] = [];

  // Split by top-level item objects - look for patterns like {Slot: Nb, ...}
  // NBT format: {Slot: 0b, id: "minecraft:stone", count: 64}
  // or newer format: {Slot: 0b, count: 64, id: "minecraft:stone"}

  // Find all item blocks by matching balanced braces
  let depth = 0;
  let itemStart = -1;

  for (let i = 0; i < invString.length; i++) {
    if (invString[i] === '{') {
      if (depth === 0) itemStart = i;
      depth++;
    } else if (invString[i] === '}') {
      depth--;
      if (depth === 0 && itemStart !== -1) {
        const itemStr = invString.slice(itemStart, i + 1);
        const item = parseInventoryItem(itemStr);
        if (item) items.push(item);
        itemStart = -1;
      }
    }
  }

  return items;
}

// Parse a single inventory item NBT object
function parseInventoryItem(itemStr: string): any | null {
  // Extract slot number - format: Slot: Nb (where N is the slot number)
  const slotMatch = itemStr.match(/Slot:\s*(-?\d+)b/);
  if (!slotMatch) return null;

  // Extract item ID - format: id: "minecraft:item_name"
  const idMatch = itemStr.match(/id:\s*"([^"]+)"/);
  if (!idMatch) return null;

  // Extract count - format: count: N or Count: N
  const countMatch = itemStr.match(/(?:count|Count):\s*(\d+)/);
  const count = countMatch ? parseInt(countMatch[1], 10) : 1;

  return {
    slot: parseInt(slotMatch[1], 10),
    id: idMatch[1],
    count,
  };
}

// Execute console command (RCON)
interface ExecuteCommandBody {
  command: string;
}

app.post(
  '/api/v1/servers/:name/console',
  async (req: Request<{ name: string }, {}, ExecuteCommandBody>, res: Response) => {
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
  }
);

// ==================== BACKUP ENDPOINTS ====================

// Create a backup
interface CreateBackupBody {
  name?: string;
  description?: string;
  tags?: string[];
}

app.post(
  '/api/v1/servers/:name/backups',
  async (req: Request<{ name: string }, {}, CreateBackupBody>, res: Response) => {
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
  }
);

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
  void k8sClient.listMinecraftServers().then((servers) => {
    ws.send(
      JSON.stringify({
        type: 'initial',
        servers,
      })
    );
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

  wsClients.forEach((client) => {
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

  wsClients.forEach((client) => {
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

    wsClients.forEach((client) => {
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
    GET    /api/v1/servers/:name/players - Get online players
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
