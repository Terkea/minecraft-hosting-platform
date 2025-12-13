import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { K8sClient, MinecraftServerSpec } from './k8s-client.js';
import { SyncService } from './services/sync-service.js';
import { BackupService } from './services/backup-service.js';
import { MetricsService, ServerMetrics } from './services/metrics-service.js';
import { getEventBus } from './events/event-bus.js';
import { userStore } from './models/user.js';
import { GoogleDriveService } from './services/google-drive-service.js';
import { closePool } from './db/connection.js';
import {
  requireAuth,
  optionalAuth,
  generateToken,
  verifyToken,
  AuthenticatedRequest,
} from './middleware/auth.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Validate required environment variables
const requiredEnvVars = [
  'PORT',
  'K8S_NAMESPACE',
  'CORS_ALLOWED_ORIGINS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'JWT_SECRET',
];
// Note: RCON_PASSWORD is optional - each server now has its own unique password
const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please set these in your .env file or environment');
  process.exit(1);
}

// Initialize Google OAuth client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Frontend URL for OAuth redirect
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Configuration - all values from environment (validated above)
const PORT = process.env.PORT as string;
const K8S_NAMESPACE = process.env.K8S_NAMESPACE as string;

// Initialize K8s client and services
const k8sClient = new K8sClient(K8S_NAMESPACE);
const syncService = new SyncService(k8sClient);
const backupService = new BackupService(K8S_NAMESPACE);
const metricsService = new MetricsService(K8S_NAMESPACE);
const eventBus = getEventBus();

/**
 * Helper to verify server ownership.
 * Returns the server if owned by user, or sends 404/403 response and returns null.
 */
async function verifyServerOwnership(
  req: AuthenticatedRequest,
  res: Response,
  serverName: string
): Promise<any | null> {
  const server = await k8sClient.getMinecraftServer(serverName);

  if (!server) {
    res.status(404).json({
      error: 'not_found',
      message: `Server '${serverName}' not found`,
    });
    return null;
  }

  // Check ownership - server's tenantId must match authenticated user
  if (server.tenantId !== req.userId) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this server',
    });
    return null;
  }

  return server;
}

/**
 * Validate Minecraft player name format.
 * Player names must be 2-16 alphanumeric characters or underscores.
 * Returns true if valid, sends 400 response and returns false if invalid.
 */
function validatePlayerName(res: Response, player: string): boolean {
  const PLAYER_NAME_REGEX = /^[a-zA-Z0-9_]{2,16}$/;
  if (!player || !PLAYER_NAME_REGEX.test(player)) {
    res.status(400).json({
      error: 'invalid_player_name',
      message:
        'Invalid player name. Must be 2-16 characters, only letters, numbers, and underscores allowed.',
    });
    return false;
  }
  return true;
}

/**
 * Sanitize server object to remove sensitive fields before returning to client.
 * SECURITY: Never expose rconPassword in API responses.
 */
function sanitizeServer(server: any): any {
  if (!server) return server;
  const { rconPassword, ...sanitized } = server;
  return sanitized;
}

/**
 * Sanitize an array of servers.
 */
function sanitizeServers(servers: any[]): any[] {
  return servers.map(sanitizeServer);
}

// Middleware
// Configure CORS with allowed origins from environment (validated at startup)
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS as string).split(',');
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
  })
);
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

// ==================== AUTH ENDPOINTS ====================

// Initiate Google OAuth flow
app.get('/api/v1/auth/google', (_req: Request, res: Response) => {
  const scopes = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to always get refresh token
  });

  console.log('[Auth] Redirecting to Google OAuth');
  res.redirect(authUrl);
});

// Handle Google OAuth callback
app.get('/api/v1/auth/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    console.error('[Auth] OAuth error:', error);
    return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(error as string)}`);
  }

  if (!code || typeof code !== 'string') {
    console.error('[Auth] No authorization code received');
    return res.redirect(`${FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Failed to get tokens from Google');
    }

    // Get user info from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfoResponse = await oauth2.userinfo.get();
    const googleUser = userInfoResponse.data;

    if (!googleUser.id || !googleUser.email) {
      throw new Error('Failed to get user info from Google');
    }

    console.log(`[Auth] Google user: ${googleUser.email} (${googleUser.id})`);

    // Find or create user
    let user = await userStore.getUserByGoogleId(googleUser.id);

    if (!user) {
      // Create new user
      user = await userStore.createUser({
        googleId: googleUser.id,
        email: googleUser.email,
        name: googleUser.name || googleUser.email,
        pictureUrl: googleUser.picture || undefined,
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
      });

      // Create MinecraftBackups folder in user's Google Drive
      try {
        const driveService = new GoogleDriveService();
        driveService.setUserCredentials(tokens.access_token, tokens.refresh_token);
        const folderId = await driveService.createOrGetBackupFolder();
        user = (await userStore.updateUser(user.id, { driveFolderId: folderId }))!;
        console.log(`[Auth] Created Drive folder for user: ${folderId}`);
      } catch (driveError: any) {
        console.error('[Auth] Failed to create Drive folder:', driveError.message);
        // Continue anyway - folder will be created on first backup
      }
    } else {
      // Update existing user's tokens
      user = (await userStore.updateUser(user.id, {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token || user.googleRefreshToken,
        tokenExpiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
        pictureUrl: googleUser.picture || undefined,
        name: googleUser.name || user.name,
      }))!;
      console.log(`[Auth] Updated tokens for user: ${user.email}`);
    }

    // Generate JWT for session
    const jwtToken = generateToken(user);

    // Redirect to frontend with token
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${jwtToken}`);
  } catch (error: any) {
    console.error('[Auth] OAuth callback error:', error.message);
    res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(error.message)}`);
  }
});

// Get current authenticated user
app.get('/api/v1/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    pictureUrl: user.pictureUrl,
    driveConnected: !!user.driveFolderId,
    createdAt: user.createdAt,
  });
});

// Logout (client-side token removal, but we log it)
app.post('/api/v1/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  console.log(`[Auth] User logged out: ${req.user!.email}`);
  res.json({ message: 'Logged out successfully' });
});

// Get Google Drive connection status
app.get(
  '/api/v1/auth/drive/status',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;

    try {
      if (!user.driveFolderId) {
        return res.json({
          connected: false,
          message: 'Google Drive folder not set up',
        });
      }

      const driveService = new GoogleDriveService();
      driveService.setUserCredentials(user.googleAccessToken, user.googleRefreshToken);

      // Verify connection by listing folder contents
      const backups = await driveService.listBackups(user.driveFolderId);
      const quota = await driveService.getStorageQuota();

      res.json({
        connected: true,
        folderId: user.driveFolderId,
        backupCount: backups.length,
        storageUsed: quota.used,
        storageLimit: quota.limit,
      });
    } catch (error: any) {
      console.error('[Auth] Drive status check failed:', error.message);
      res.json({
        connected: false,
        error: error.message,
      });
    }
  }
);

// ==================== API ROUTES ====================

// API Routes

// List all servers (filtered by user)
app.get('/api/v1/servers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const servers = await k8sClient.listMinecraftServers();
    // Filter to only user's servers and sanitize (remove sensitive fields)
    const userServers = sanitizeServers(servers.filter((s) => s.tenantId === req.userId));
    res.json({
      servers: userServers,
      total: userServers.length,
    });
  } catch (error: any) {
    console.error('Failed to list servers:', error);
    res.status(500).json({
      error: 'list_failed',
      message: error.message,
    });
  }
});

// Server types supported
type ServerType =
  | 'VANILLA'
  | 'PAPER'
  | 'SPIGOT'
  | 'BUKKIT'
  | 'FORGE'
  | 'FABRIC'
  | 'PURPUR'
  | 'QUILT'
  | 'NEOFORGE';

// Create a new server
interface CreateServerBody {
  name: string;
  serverType?: ServerType;
  version?: string;
  memory?: string;

  // Config options (all optional with defaults)
  maxPlayers?: number;
  gamemode?: string;
  difficulty?: string;
  motd?: string;

  // World settings
  levelName?: string;
  levelSeed?: string;
  levelType?: 'default' | 'flat' | 'largeBiomes' | 'amplified' | 'singleBiome';
  spawnProtection?: number;
  viewDistance?: number;
  simulationDistance?: number;

  // Gameplay settings
  pvp?: boolean;
  allowFlight?: boolean;
  enableCommandBlock?: boolean;
  forceGamemode?: boolean;
  hardcoreMode?: boolean;

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
}

app.post(
  '/api/v1/servers',
  requireAuth,
  async (req: AuthenticatedRequest & { body: CreateServerBody }, res: Response) => {
    try {
      const body = req.body;
      const { name, serverType, version, memory } = body;

      if (!name) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'Server name is required',
        });
      }

      // Build config from request body with defaults
      const config: Partial<MinecraftServerSpec['config']> = {};

      // Player settings
      if (body.maxPlayers !== undefined) config.maxPlayers = body.maxPlayers;
      if (body.gamemode !== undefined) config.gamemode = body.gamemode;
      if (body.difficulty !== undefined) config.difficulty = body.difficulty;
      if (body.forceGamemode !== undefined) config.forceGamemode = body.forceGamemode;
      if (body.hardcoreMode !== undefined) config.hardcoreMode = body.hardcoreMode;

      // World settings
      if (body.levelName !== undefined) config.levelName = body.levelName;
      if (body.levelSeed !== undefined) config.levelSeed = body.levelSeed;
      if (body.levelType !== undefined) config.levelType = body.levelType;
      if (body.spawnProtection !== undefined) config.spawnProtection = body.spawnProtection;
      if (body.viewDistance !== undefined) config.viewDistance = body.viewDistance;
      if (body.simulationDistance !== undefined)
        config.simulationDistance = body.simulationDistance;
      if (body.generateStructures !== undefined)
        config.generateStructures = body.generateStructures;
      if (body.allowNether !== undefined) config.allowNether = body.allowNether;

      // Server display
      if (body.motd !== undefined) config.motd = body.motd;

      // Gameplay settings
      if (body.pvp !== undefined) config.pvp = body.pvp;
      if (body.allowFlight !== undefined) config.allowFlight = body.allowFlight;
      if (body.enableCommandBlock !== undefined)
        config.enableCommandBlock = body.enableCommandBlock;

      // Mob spawning
      if (body.spawnAnimals !== undefined) config.spawnAnimals = body.spawnAnimals;
      if (body.spawnMonsters !== undefined) config.spawnMonsters = body.spawnMonsters;
      if (body.spawnNpcs !== undefined) config.spawnNpcs = body.spawnNpcs;

      // Security settings
      if (body.whiteList !== undefined) config.whiteList = body.whiteList;
      if (body.onlineMode !== undefined) config.onlineMode = body.onlineMode;

      const spec: Partial<MinecraftServerSpec> = {
        tenantId: req.userId!, // Associate server with authenticated user
        serverType: serverType || 'VANILLA',
        version: version || 'LATEST',
        config: config as MinecraftServerSpec['config'],
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

      // Note: Don't broadcast here - K8s watcher will send 'added' event
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
  }
);

// Get a specific server
app.get('/api/v1/servers/:name', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = req.params;
    const server = await verifyServerOwnership(req, res, name);
    if (!server) return;

    // Sanitize to remove sensitive fields like rconPassword
    res.json(sanitizeServer(server));
  } catch (error: any) {
    console.error('Failed to get server:', error);
    res.status(500).json({
      error: 'get_failed',
      message: error.message,
    });
  }
});

// Delete a server
app.delete(
  '/api/v1/servers/:name',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      await k8sClient.deleteMinecraftServer(name);

      // Broadcast to WebSocket clients
      broadcastServerUpdate('deleted', { name, namespace: K8S_NAMESPACE, phase: 'Deleted' });

      res.json({
        message: `Server '${name}' deletion initiated`,
      });
    } catch (error: any) {
      console.error('Failed to delete server:', error);
      res.status(500).json({
        error: 'delete_failed',
        message: error.message,
      });
    }
  }
);

// Get server logs (live/latest)
app.get(
  '/api/v1/servers/:name/logs',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

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
  }
);

// List log files from the server's logs directory
app.get(
  '/api/v1/servers/:name/logs/files',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      // Execute ls command in the pod to list log files
      const result = await k8sClient.execInPod(name, [
        'sh',
        '-c',
        'ls -la /data/logs/ 2>/dev/null || echo "No logs directory"',
      ]);

      // Parse the ls output into structured data
      const lines = result
        .trim()
        .split('\n')
        .filter((line) => line && !line.startsWith('total'));
      const files: Array<{
        name: string;
        size: string;
        sizeBytes: number;
        modified: string;
        type: 'file' | 'directory';
      }> = [];

      for (const line of lines) {
        if (line === 'No logs directory') continue;

        // Parse ls -la output: -rw-r--r-- 1 root root 12345 Dec 12 10:30 filename.log
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const permissions = parts[0];
          const sizeBytes = parseInt(parts[4], 10);
          const month = parts[5];
          const day = parts[6];
          const time = parts[7];
          const fileName = parts.slice(8).join(' ');

          // Skip . and ..
          if (fileName === '.' || fileName === '..') continue;

          // Format size
          let size = `${sizeBytes} B`;
          if (sizeBytes >= 1024 * 1024) {
            size = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
          } else if (sizeBytes >= 1024) {
            size = `${(sizeBytes / 1024).toFixed(1)} KB`;
          }

          files.push({
            name: fileName,
            size,
            sizeBytes,
            modified: `${month} ${day} ${time}`,
            type: permissions.startsWith('d') ? 'directory' : 'file',
          });
        }
      }

      // Sort by modified date (newest first) - log files with dates in name
      files.sort((a, b) => {
        // latest.log should be first
        if (a.name === 'latest.log') return -1;
        if (b.name === 'latest.log') return 1;
        // Otherwise sort by name descending (newer dates come later alphabetically for dated logs)
        return b.name.localeCompare(a.name);
      });

      res.json({
        serverName: name,
        files,
        count: files.length,
      });
    } catch (error: any) {
      console.error('Failed to list log files:', error);
      res.status(500).json({
        error: 'log_files_failed',
        message: error.message,
      });
    }
  }
);

// Get content of a specific log file
app.get(
  '/api/v1/servers/:name/logs/files/:filename',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, filename } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const lines = parseInt(req.query.lines as string) || 500;

      // Sanitize filename to prevent path traversal
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
      if (sanitizedFilename !== filename) {
        return res.status(400).json({
          error: 'invalid_filename',
          message: 'Invalid filename',
        });
      }

      // Check if it's a gzipped file
      const isGzipped = filename.endsWith('.gz');

      let command: string;
      if (isGzipped) {
        // Use zcat for gzipped files
        command = `zcat /data/logs/${sanitizedFilename} 2>/dev/null | tail -n ${lines}`;
      } else {
        command = `tail -n ${lines} /data/logs/${sanitizedFilename} 2>/dev/null`;
      }

      const result = await k8sClient.execInPod(name, ['sh', '-c', command]);

      res.json({
        serverName: name,
        filename: sanitizedFilename,
        content: result.split('\n'),
        lines: result.split('\n').length,
      });
    } catch (error: any) {
      console.error('Failed to get log file:', error);
      res.status(500).json({
        error: 'log_file_failed',
        message: error.message,
      });
    }
  }
);

// Update server configuration
interface UpdateServerBody {
  serverType?: ServerType;
  version?: string;

  // Config options (all optional)
  maxPlayers?: number;
  gamemode?: string;
  difficulty?: string;
  motd?: string;

  // World settings
  levelName?: string;
  levelSeed?: string;
  levelType?: 'default' | 'flat' | 'largeBiomes' | 'amplified' | 'singleBiome';
  spawnProtection?: number;
  viewDistance?: number;
  simulationDistance?: number;

  // Gameplay settings
  pvp?: boolean;
  allowFlight?: boolean;
  enableCommandBlock?: boolean;
  forceGamemode?: boolean;
  hardcoreMode?: boolean;

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
}

app.patch(
  '/api/v1/servers/:name',
  requireAuth,
  async (req: AuthenticatedRequest & { body: UpdateServerBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const body = req.body;

      const updates: Partial<MinecraftServerSpec> = {};

      // Update server type if provided
      if (body.serverType) {
        updates.serverType = body.serverType;
      }

      // Update version if provided
      if (body.version) {
        updates.version = body.version;
      }

      // Build config updates
      const configUpdates: Partial<MinecraftServerSpec['config']> = {};
      let hasConfigUpdates = false;

      // Player settings
      if (body.maxPlayers !== undefined) {
        configUpdates.maxPlayers = body.maxPlayers;
        hasConfigUpdates = true;
      }
      if (body.gamemode !== undefined) {
        configUpdates.gamemode = body.gamemode;
        hasConfigUpdates = true;
      }
      if (body.difficulty !== undefined) {
        configUpdates.difficulty = body.difficulty;
        hasConfigUpdates = true;
      }
      if (body.forceGamemode !== undefined) {
        configUpdates.forceGamemode = body.forceGamemode;
        hasConfigUpdates = true;
      }
      if (body.hardcoreMode !== undefined) {
        configUpdates.hardcoreMode = body.hardcoreMode;
        hasConfigUpdates = true;
      }

      // World settings
      if (body.levelName !== undefined) {
        configUpdates.levelName = body.levelName;
        hasConfigUpdates = true;
      }
      if (body.levelSeed !== undefined) {
        configUpdates.levelSeed = body.levelSeed;
        hasConfigUpdates = true;
      }
      if (body.levelType !== undefined) {
        configUpdates.levelType = body.levelType;
        hasConfigUpdates = true;
      }
      if (body.spawnProtection !== undefined) {
        configUpdates.spawnProtection = body.spawnProtection;
        hasConfigUpdates = true;
      }
      if (body.viewDistance !== undefined) {
        configUpdates.viewDistance = body.viewDistance;
        hasConfigUpdates = true;
      }
      if (body.simulationDistance !== undefined) {
        configUpdates.simulationDistance = body.simulationDistance;
        hasConfigUpdates = true;
      }
      if (body.generateStructures !== undefined) {
        configUpdates.generateStructures = body.generateStructures;
        hasConfigUpdates = true;
      }
      if (body.allowNether !== undefined) {
        configUpdates.allowNether = body.allowNether;
        hasConfigUpdates = true;
      }

      // Server display
      if (body.motd !== undefined) {
        configUpdates.motd = body.motd;
        hasConfigUpdates = true;
      }

      // Gameplay settings
      if (body.pvp !== undefined) {
        configUpdates.pvp = body.pvp;
        hasConfigUpdates = true;
      }
      if (body.allowFlight !== undefined) {
        configUpdates.allowFlight = body.allowFlight;
        hasConfigUpdates = true;
      }
      if (body.enableCommandBlock !== undefined) {
        configUpdates.enableCommandBlock = body.enableCommandBlock;
        hasConfigUpdates = true;
      }

      // Mob spawning
      if (body.spawnAnimals !== undefined) {
        configUpdates.spawnAnimals = body.spawnAnimals;
        hasConfigUpdates = true;
      }
      if (body.spawnMonsters !== undefined) {
        configUpdates.spawnMonsters = body.spawnMonsters;
        hasConfigUpdates = true;
      }
      if (body.spawnNpcs !== undefined) {
        configUpdates.spawnNpcs = body.spawnNpcs;
        hasConfigUpdates = true;
      }

      // Security settings
      if (body.whiteList !== undefined) {
        configUpdates.whiteList = body.whiteList;
        hasConfigUpdates = true;
      }
      if (body.onlineMode !== undefined) {
        configUpdates.onlineMode = body.onlineMode;
        hasConfigUpdates = true;
      }

      if (hasConfigUpdates) {
        updates.config = configUpdates as MinecraftServerSpec['config'];
      }

      const updatedServer = await k8sClient.updateMinecraftServer(name, updates);

      broadcastServerUpdate('updated', updatedServer);

      res.json({
        message: 'Server update initiated',
        server: updatedServer,
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
  requireAuth,
  async (req: AuthenticatedRequest & { body: ScaleServerBody }, res: Response) => {
    try {
      const { name } = req.params;
      const serverCheck = await verifyServerOwnership(req, res, name);
      if (!serverCheck) return;

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
      res.status(500).json({
        error: 'scale_failed',
        message: error.message,
      });
    }
  }
);

// Configure auto-stop settings
interface AutoStopBody {
  enabled: boolean;
  idleTimeoutMinutes?: number;
}

app.put(
  '/api/v1/servers/:name/auto-stop',
  requireAuth,
  async (req: AuthenticatedRequest & { body: AutoStopBody }, res: Response) => {
    try {
      const { name } = req.params;
      const serverCheck = await verifyServerOwnership(req, res, name);
      if (!serverCheck) return;

      const { enabled, idleTimeoutMinutes } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'enabled (boolean) is required',
        });
      }

      const server = await k8sClient.configureAutoStop(name, {
        enabled,
        idleTimeoutMinutes,
      });

      broadcastServerUpdate('auto_stop_configured', server);

      res.json({
        message: `Auto-stop ${enabled ? 'enabled' : 'disabled'} for server '${name}'`,
        server,
      });
    } catch (error: any) {
      console.error('Failed to configure auto-stop:', error);
      res.status(500).json({
        error: 'auto_stop_config_failed',
        message: error.message,
      });
    }
  }
);

// Configure auto-start settings
interface AutoStartBody {
  enabled: boolean;
}

app.put(
  '/api/v1/servers/:name/auto-start',
  requireAuth,
  async (req: AuthenticatedRequest & { body: AutoStartBody }, res: Response) => {
    try {
      const { name } = req.params;
      const serverCheck = await verifyServerOwnership(req, res, name);
      if (!serverCheck) return;

      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'enabled (boolean) is required',
        });
      }

      const server = await k8sClient.configureAutoStart(name, {
        enabled,
      });

      broadcastServerUpdate('auto_start_configured', server);

      res.json({
        message: `Auto-start ${enabled ? 'enabled' : 'disabled'} for server '${name}'`,
        server,
      });
    } catch (error: any) {
      console.error('Failed to configure auto-start:', error);
      res.status(500).json({
        error: 'auto_start_config_failed',
        message: error.message,
      });
    }
  }
);

// Stop a server (scale StatefulSet to 0)
app.post(
  '/api/v1/servers/:name/stop',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      await k8sClient.stopServer(name);

      broadcastServerUpdate('stopped', { name, namespace: K8S_NAMESPACE, phase: 'Stopped' });

      res.json({
        message: `Server '${name}' stop initiated`,
        server: { name, phase: 'Stopping' },
      });
    } catch (error: any) {
      console.error('Failed to stop server:', error);
      res.status(500).json({
        error: 'stop_failed',
        message: error.message,
      });
    }
  }
);

// Start a server (scale StatefulSet to 1)
app.post(
  '/api/v1/servers/:name/start',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      await k8sClient.startServer(name);

      broadcastServerUpdate('started', { name, namespace: K8S_NAMESPACE, phase: 'Starting' });

      res.json({
        message: `Server '${name}' start initiated`,
        server: { name, phase: 'Starting' },
      });
    } catch (error: any) {
      console.error('Failed to start server:', error);
      res.status(500).json({
        error: 'start_failed',
        message: error.message,
      });
    }
  }
);

// Get pod status
app.get(
  '/api/v1/servers/:name/pod',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

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
  }
);

// Get server metrics
app.get(
  '/api/v1/servers/:name/metrics',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

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
          cpu: metrics.pod?.cpu
            ? {
                usage: MetricsService.formatCpu(metrics.pod.cpu.usageNano),
                usageNano: metrics.pod.cpu.usageNano,
                limit: metrics.pod.cpu.limitNano
                  ? MetricsService.formatCpu(metrics.pod.cpu.limitNano)
                  : undefined,
                limitNano: metrics.pod.cpu.limitNano,
              }
            : undefined,
          memory: metrics.pod?.memory
            ? {
                usage: MetricsService.formatBytes(metrics.pod.memory.usageBytes),
                usageBytes: metrics.pod.memory.usageBytes,
                limit: metrics.pod.memory.limitBytes
                  ? MetricsService.formatBytes(metrics.pod.memory.limitBytes)
                  : undefined,
                limitBytes: metrics.pod.memory.limitBytes,
              }
            : undefined,
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
  }
);

// Get all metrics (filtered by user's servers)
app.get('/api/v1/metrics', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Get user's servers first
    const servers = await k8sClient.listMinecraftServers();
    const userServerNames = servers.filter((s) => s.tenantId === req.userId).map((s) => s.name);

    const allMetrics = metricsService.getAllMetrics();
    const metricsObj: Record<string, any> = {};

    allMetrics.forEach((metrics, serverName) => {
      // Only include metrics for user's servers
      if (!userServerNames.includes(serverName)) return;

      metricsObj[serverName] = {
        cpu: metrics.pod?.cpu
          ? {
              usage: MetricsService.formatCpu(metrics.pod.cpu.usageNano),
              usageNano: metrics.pod.cpu.usageNano,
            }
          : undefined,
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
      serverCount: Object.keys(metricsObj).length,
    });
  } catch (error: any) {
    console.error('Failed to get all metrics:', error);
    res.status(500).json({
      error: 'metrics_failed',
      message: error.message,
    });
  }
});

// Get online players list (basic info only for performance)
app.get(
  '/api/v1/servers/:name/players',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

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

      // Fetch only basic data for list view (name, health, gamemode) - fast
      const playerPromises = playerNames.map(async (playerName) => {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 5000)
          );

          // Only fetch health and gamemode for list view
          const dataPromises = [
            k8sClient.executeCommand(name, `data get entity ${playerName} Health`),
            k8sClient.executeCommand(name, `data get entity ${playerName} playerGameType`),
          ];

          const [healthStr, gameTypeStr] = (await Promise.race([
            Promise.all(dataPromises),
            timeoutPromise,
          ])) as string[];

          // Parse health
          const healthMatch = healthStr.match(/([\d.]+)f?$/);
          const health = healthMatch ? parseFloat(healthMatch[1]) : 20;

          // Parse gamemode
          const gameMatch = gameTypeStr.match(/(\d+)$/);
          const gameMode = gameMatch ? parseInt(gameMatch[1], 10) : 0;
          const gameModeName =
            ['Survival', 'Creative', 'Adventure', 'Spectator'][gameMode] || 'Unknown';

          return {
            name: playerName,
            health,
            maxHealth: 20,
            gameMode,
            gameModeName,
          };
        } catch {
          // Return minimal data on error
          return {
            name: playerName,
            health: 20,
            maxHealth: 20,
            gameMode: 0,
            gameModeName: 'Survival',
          };
        }
      });

      const players = await Promise.all(playerPromises);

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
  }
);

// Get detailed data for a specific player
app.get(
  '/api/v1/servers/:name/players/:playerName',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, playerName } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      if (server.phase?.toLowerCase() !== 'running') {
        return res.status(400).json({
          error: 'server_not_running',
          message: 'Server is not running',
        });
      }

      // Verify player is online
      const listResult = await k8sClient.executeCommand(name, 'list');
      const listMatch = listResult.match(
        /There are (\d+) of a max of (\d+) players online[:\s]*(.*)?/i
      );

      if (!listMatch || !listMatch[3]) {
        return res.status(404).json({
          error: 'player_not_found',
          message: `Player '${playerName}' is not online`,
        });
      }

      const onlinePlayers = listMatch[3]
        .split(',')
        .map((n) => n.trim().toLowerCase())
        .filter((n) => n);

      if (!onlinePlayers.includes(playerName.toLowerCase())) {
        return res.status(404).json({
          error: 'player_not_found',
          message: `Player '${playerName}' is not online`,
        });
      }

      // Fetch detailed player data
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 10000)
      );

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

      const results = (await Promise.race([Promise.all(dataPromises), timeoutPromise])) as string[];

      const player = parsePlayerDataFromFields(playerName, results);

      res.json(player);
    } catch (error: any) {
      console.error('Failed to get player details:', error);
      res.status(500).json({
        error: 'player_details_failed',
        message: error.message,
      });
    }
  }
);

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

    // Parse equipment from the equipment command response
    // Format: "Player has the following entity data: {head: {components: {...}, count: 1, id: "..."}, ...}"
    if (equipStr) {
      const parseEquipSlot = (slotName: string): any | null => {
        // Find the start of this slot's data
        const slotPattern = new RegExp(`${slotName}:\\s*\\{`);
        const slotMatch = slotPattern.exec(equipStr);
        if (!slotMatch) return null;

        // Find matching closing brace using depth tracking
        const startIdx = slotMatch.index + slotMatch[0].length;
        let depth = 1;
        let endIdx = startIdx;

        for (let i = startIdx; i < equipStr.length && depth > 0; i++) {
          if (equipStr[i] === '{') depth++;
          else if (equipStr[i] === '}') depth--;
          endIdx = i;
        }

        const slotStr = equipStr.slice(startIdx, endIdx);

        // Extract item ID
        const idMatch = slotStr.match(/id:\s*"([^"]+)"/);
        if (!idMatch) return null;

        const item: any = {
          id: idMatch[1],
          count: 1,
        };

        // Extract count
        const countMatch = slotStr.match(/count:\s*(\d+)/);
        if (countMatch) item.count = parseInt(countMatch[1], 10);

        // Extract custom name
        const customNameMatch = slotStr.match(/"minecraft:custom_name":\s*"([^"]+)"/);
        if (customNameMatch) item.customName = customNameMatch[1];

        // Extract damage
        const damageMatch = slotStr.match(/"minecraft:damage":\s*(\d+)/);
        if (damageMatch) item.damage = parseInt(damageMatch[1], 10);

        // Extract enchantments
        const enchantMatch = slotStr.match(/"minecraft:enchantments":\s*\{([^}]+)\}/);
        if (enchantMatch) {
          const enchantments: Record<string, number> = {};
          const enchantPairs = enchantMatch[1].matchAll(/"minecraft:([^"]+)":\s*(\d+)/g);
          for (const [, enchantName, level] of enchantPairs) {
            enchantments[enchantName] = parseInt(level, 10);
          }
          if (Object.keys(enchantments).length > 0) {
            item.enchantments = enchantments;
          }
        }

        return item;
      };

      player.equipment.head = parseEquipSlot('head');
      player.equipment.chest = parseEquipSlot('chest');
      player.equipment.legs = parseEquipSlot('legs');
      player.equipment.feet = parseEquipSlot('feet');
      player.equipment.offhand = parseEquipSlot('offhand');
    }

    // Filter out equipment slots from main inventory (keep only slots 0-35)
    player.inventory = player.inventory.filter((item: any) => item.slot >= 0 && item.slot <= 35);
  } catch (parseError) {
    console.error('Error parsing player field data:', parseError);
  }

  return player;
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

// Escape special regex characters in a string
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract NBT array contents by finding matching brackets
function extractNbtArray(nbtString: string, arrayName: string): string | null {
  // Escape arrayName to prevent ReDoS if ever passed untrusted input
  // Note: arrayName is always a hardcoded string literal from internal code, not user input
  const escapedName = escapeRegex(arrayName);
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const startPattern = new RegExp(`${escapedName}:\\s*\\[`);
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

  const item: any = {
    slot: parseInt(slotMatch[1], 10),
    id: idMatch[1],
    count,
  };

  // Parse components (enchantments, custom_name, damage)
  // Format: components: {"minecraft:enchantments": {...}, "minecraft:custom_name": "...", "minecraft:damage": N}

  // Extract custom name
  const customNameMatch = itemStr.match(/"minecraft:custom_name":\s*"([^"]+)"/);
  if (customNameMatch) {
    item.customName = customNameMatch[1];
  }

  // Extract damage (durability loss)
  const damageMatch = itemStr.match(/"minecraft:damage":\s*(\d+)/);
  if (damageMatch) {
    item.damage = parseInt(damageMatch[1], 10);
  }

  // Extract enchantments
  // Format: "minecraft:enchantments": {"minecraft:protection": 4, "minecraft:unbreaking": 3}
  const enchantMatch = itemStr.match(/"minecraft:enchantments":\s*\{([^}]+)\}/);
  if (enchantMatch) {
    const enchantStr = enchantMatch[1];
    const enchantments: Record<string, number> = {};

    // Match all enchantment:level pairs
    const enchantPairs = enchantStr.matchAll(/"minecraft:([^"]+)":\s*(\d+)/g);
    for (const [, enchantName, level] of enchantPairs) {
      enchantments[enchantName] = parseInt(level, 10);
    }

    if (Object.keys(enchantments).length > 0) {
      item.enchantments = enchantments;
    }
  }

  return item;
}

// ==================== PLAYER MANAGEMENT ENDPOINTS ====================

// Get whitelist
app.get(
  '/api/v1/servers/:name/whitelist',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const result = await k8sClient.executeCommand(name, 'whitelist list');

      // Parse "There are X whitelisted players: player1, player2" or "There are no whitelisted players"
      const match = result.match(/There are (\d+) whitelisted players?:\s*(.*)/i);
      const _noPlayersMatch = result.match(/There are no whitelisted players/i);

      let players: string[] = [];
      if (match && match[2]) {
        players = match[2]
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p);
      }

      res.json({
        enabled: true, // whitelist list only works if whitelist is queryable
        count: players.length,
        players,
      });
    } catch (error: any) {
      console.error('Failed to get whitelist:', error);
      res.status(500).json({
        error: 'whitelist_failed',
        message: error.message,
      });
    }
  }
);

// Add player to whitelist
interface WhitelistAddBody {
  player: string;
}

app.post(
  '/api/v1/servers/:name/whitelist',
  requireAuth,
  async (req: AuthenticatedRequest & { body: WhitelistAddBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const { player } = req.body;

      // Validate player name format to prevent command injection
      if (!validatePlayerName(res, player)) return;

      const result = await k8sClient.executeCommand(name, `whitelist add ${player}`);

      res.json({
        message: `Player '${player}' added to whitelist`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to add to whitelist:', error);
      res.status(500).json({
        error: 'whitelist_add_failed',
        message: error.message,
      });
    }
  }
);

// Remove player from whitelist
app.delete(
  '/api/v1/servers/:name/whitelist/:player',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, player } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      // Validate player name format to prevent command injection
      if (!validatePlayerName(res, player)) return;

      const result = await k8sClient.executeCommand(name, `whitelist remove ${player}`);

      res.json({
        message: `Player '${player}' removed from whitelist`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to remove from whitelist:', error);
      res.status(500).json({
        error: 'whitelist_remove_failed',
        message: error.message,
      });
    }
  }
);

// Toggle whitelist on/off
interface WhitelistToggleBody {
  enabled: boolean;
}

app.put(
  '/api/v1/servers/:name/whitelist/toggle',
  requireAuth,
  async (req: AuthenticatedRequest & { body: WhitelistToggleBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const { enabled } = req.body;

      const command = enabled ? 'whitelist on' : 'whitelist off';
      const result = await k8sClient.executeCommand(name, command);

      res.json({
        message: `Whitelist ${enabled ? 'enabled' : 'disabled'}`,
        enabled,
        result,
      });
    } catch (error: any) {
      console.error('Failed to toggle whitelist:', error);
      res.status(500).json({
        error: 'whitelist_toggle_failed',
        message: error.message,
      });
    }
  }
);

// Get ops list
app.get(
  '/api/v1/servers/:name/ops',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      // Note: Minecraft doesn't have a direct "op list" command, we need to use /list with parse
      // However, we can check if players are opped by trying to get their op level
      // For now, we'll return empty and let frontend manage from create config

      res.json({
        count: 0,
        players: [],
        message:
          'Use server configuration to manage initial ops. Live ops can be checked per-player.',
      });
    } catch (error: any) {
      console.error('Failed to get ops:', error);
      res.status(500).json({
        error: 'ops_failed',
        message: error.message,
      });
    }
  }
);

// Grant operator status
interface OpAddBody {
  player: string;
}

app.post(
  '/api/v1/servers/:name/ops',
  requireAuth,
  async (req: AuthenticatedRequest & { body: OpAddBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const { player } = req.body;

      // Validate player name format to prevent command injection
      if (!validatePlayerName(res, player)) return;

      const result = await k8sClient.executeCommand(name, `op ${player}`);

      res.json({
        message: `Operator status granted to '${player}'`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to grant op:', error);
      res.status(500).json({
        error: 'op_failed',
        message: error.message,
      });
    }
  }
);

// Revoke operator status
app.delete(
  '/api/v1/servers/:name/ops/:player',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, player } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      // Validate player name format to prevent command injection
      if (!validatePlayerName(res, player)) return;

      const result = await k8sClient.executeCommand(name, `deop ${player}`);

      res.json({
        message: `Operator status revoked from '${player}'`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to revoke op:', error);
      res.status(500).json({
        error: 'deop_failed',
        message: error.message,
      });
    }
  }
);

// Get ban list
app.get(
  '/api/v1/servers/:name/bans',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const result = await k8sClient.executeCommand(name, 'banlist players');

      // Parse "There are X ban(s):" followed by list or "There are no bans"
      const match = result.match(/There are (\d+) ban\(s\):\s*(.*)/is);
      const _noBansMatch = result.match(/There are no bans/i);

      let players: string[] = [];
      if (match && match[2]) {
        // Each ban entry is typically "playername was banned by source: reason"
        // or just "playername" in simpler formats
        const entries = match[2].split('\n').filter((e) => e.trim());
        players = entries
          .map((entry) => {
            const nameMatch = entry.match(/^([^\s]+)/);
            return nameMatch ? nameMatch[1] : entry.trim();
          })
          .filter((p) => p);
      }

      res.json({
        count: players.length,
        players,
      });
    } catch (error: any) {
      console.error('Failed to get bans:', error);
      res.status(500).json({
        error: 'bans_failed',
        message: error.message,
      });
    }
  }
);

// Ban a player
interface BanAddBody {
  player: string;
  reason?: string;
}

app.post(
  '/api/v1/servers/:name/bans',
  requireAuth,
  async (req: AuthenticatedRequest & { body: BanAddBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const { player, reason } = req.body;

      // Validate player name format to prevent command injection
      if (!validatePlayerName(res, player)) return;

      const command = reason ? `ban ${player} ${reason}` : `ban ${player}`;
      const result = await k8sClient.executeCommand(name, command);

      res.json({
        message: `Player '${player}' has been banned`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to ban player:', error);
      res.status(500).json({
        error: 'ban_failed',
        message: error.message,
      });
    }
  }
);

// Unban a player (pardon)
app.delete(
  '/api/v1/servers/:name/bans/:player',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, player } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      // Validate player name format to prevent command injection
      if (!validatePlayerName(res, player)) return;

      const result = await k8sClient.executeCommand(name, `pardon ${player}`);

      res.json({
        message: `Player '${player}' has been unbanned`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to unban player:', error);
      res.status(500).json({
        error: 'unban_failed',
        message: error.message,
      });
    }
  }
);

// Kick a player
interface KickBody {
  player: string;
  reason?: string;
}

app.post(
  '/api/v1/servers/:name/kick',
  requireAuth,
  async (req: AuthenticatedRequest & { body: KickBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const { player, reason } = req.body;

      // Validate player name format to prevent command injection
      if (!validatePlayerName(res, player)) return;

      const command = reason ? `kick ${player} ${reason}` : `kick ${player}`;
      const result = await k8sClient.executeCommand(name, command);

      res.json({
        message: `Player '${player}' has been kicked`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to kick player:', error);
      res.status(500).json({
        error: 'kick_failed',
        message: error.message,
      });
    }
  }
);

// Get IP ban list
app.get(
  '/api/v1/servers/:name/bans/ips',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const result = await k8sClient.executeCommand(name, 'banlist ips');

      // Parse similar to player bans
      const match = result.match(/There are (\d+) ban\(s\):\s*(.*)/is);

      let ips: string[] = [];
      if (match && match[2]) {
        const entries = match[2].split('\n').filter((e) => e.trim());
        ips = entries.map((entry) => entry.trim().split(' ')[0]).filter((ip) => ip);
      }

      res.json({
        count: ips.length,
        ips,
      });
    } catch (error: any) {
      console.error('Failed to get IP bans:', error);
      res.status(500).json({
        error: 'ip_bans_failed',
        message: error.message,
      });
    }
  }
);

// Ban an IP
interface BanIpBody {
  ip: string;
  reason?: string;
}

app.post(
  '/api/v1/servers/:name/bans/ips',
  requireAuth,
  async (req: AuthenticatedRequest & { body: BanIpBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const { ip, reason } = req.body;

      if (!ip) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'IP address is required',
        });
      }

      const command = reason ? `ban-ip ${ip} ${reason}` : `ban-ip ${ip}`;
      const result = await k8sClient.executeCommand(name, command);

      res.json({
        message: `IP '${ip}' has been banned`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to ban IP:', error);
      res.status(500).json({
        error: 'ban_ip_failed',
        message: error.message,
      });
    }
  }
);

// Unban an IP
app.delete(
  '/api/v1/servers/:name/bans/ips/:ip',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, ip } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const result = await k8sClient.executeCommand(name, `pardon-ip ${ip}`);

      res.json({
        message: `IP '${ip}' has been unbanned`,
        result,
      });
    } catch (error: any) {
      console.error('Failed to unban IP:', error);
      res.status(500).json({
        error: 'unban_ip_failed',
        message: error.message,
      });
    }
  }
);

// Execute console command (RCON)
interface ExecuteCommandBody {
  command: string;
}

app.post(
  '/api/v1/servers/:name/console',
  requireAuth,
  async (req: AuthenticatedRequest & { body: ExecuteCommandBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

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
  requireAuth,
  async (req: AuthenticatedRequest & { body: CreateBackupBody }, res: Response) => {
    try {
      const { name: serverName } = req.params;
      const server = await verifyServerOwnership(req, res, serverName);
      if (!server) return;

      const { name, description, tags } = req.body;

      const backup = await backupService.createBackup({
        serverId: serverName,
        tenantId: req.userId!,
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
app.get(
  '/api/v1/servers/:name/backups',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name: serverName } = req.params;
      const server = await verifyServerOwnership(req, res, serverName);
      if (!server) return;

      // Pass both serverId AND tenantId for additional security
      const backups = await backupService.listBackups(serverName, req.userId);

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
  }
);

// Get a specific backup
app.get(
  '/api/v1/backups/:backupId',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { backupId } = req.params;
      // Pass tenantId to prevent IDOR - returns same error for not-found and unauthorized
      const backup = await backupService.getBackup(backupId, req.userId);

      if (!backup) {
        return res.status(404).json({
          error: 'not_found',
          message: `Backup not found`,
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
  }
);

// Delete a backup
app.delete(
  '/api/v1/backups/:backupId',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { backupId } = req.params;
      // Pass tenantId to prevent IDOR - returns same error for not-found and unauthorized
      const backup = await backupService.getBackup(backupId, req.userId);

      if (!backup) {
        return res.status(404).json({
          error: 'not_found',
          message: `Backup not found`,
        });
      }

      const deleted = await backupService.deleteBackup(backupId);

      if (!deleted) {
        return res.status(500).json({
          error: 'delete_failed',
          message: 'Failed to delete backup',
        });
      }

      res.json({
        message: `Backup deleted`,
      });
    } catch (error: any) {
      console.error('Failed to delete backup:', error);
      res.status(500).json({
        error: 'delete_backup_failed',
        message: error.message,
      });
    }
  }
);

// Restore a backup
app.post(
  '/api/v1/backups/:backupId/restore',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { backupId } = req.params;
      // Pass tenantId to prevent IDOR - returns same error for not-found and unauthorized
      const backup = await backupService.getBackup(backupId, req.userId);

      if (!backup) {
        return res.status(404).json({
          error: 'not_found',
          message: `Backup not found`,
        });
      }

      await backupService.restoreBackup(backupId);

      res.json({
        message: `Restore from backup initiated`,
      });
    } catch (error: any) {
      console.error('Failed to restore backup:', error);
      res.status(500).json({
        error: 'restore_failed',
        message: error.message,
      });
    }
  }
);

// Get backup schedule for a server
app.get(
  '/api/v1/servers/:name/backups/schedule',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const schedule = await backupService.getSchedule(name);

      if (!schedule) {
        // Return default schedule if none exists
        return res.json({
          serverId: name,
          enabled: false,
          intervalHours: 24,
          retentionCount: 7,
        });
      }

      res.json(schedule);
    } catch (error: any) {
      console.error('Failed to get backup schedule:', error);
      res.status(500).json({
        error: 'schedule_failed',
        message: error.message,
      });
    }
  }
);

// Set backup schedule for a server
interface SetScheduleBody {
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
}

app.put(
  '/api/v1/servers/:name/backups/schedule',
  requireAuth,
  async (req: AuthenticatedRequest & { body: SetScheduleBody }, res: Response) => {
    try {
      const { name } = req.params;
      const server = await verifyServerOwnership(req, res, name);
      if (!server) return;

      const { enabled, intervalHours, retentionCount } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'enabled must be a boolean',
        });
      }

      if (!intervalHours || intervalHours < 1) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'intervalHours must be at least 1',
        });
      }

      if (!retentionCount || retentionCount < 1) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'retentionCount must be at least 1',
        });
      }

      // Pass tenantId so scheduled backups are owned by the correct user
      const schedule = await backupService.setSchedule(name, req.userId!, {
        enabled,
        intervalHours,
        retentionCount,
      });

      res.json({
        message: `Backup schedule ${enabled ? 'enabled' : 'disabled'}`,
        schedule,
      });
    } catch (error: any) {
      console.error('Failed to set backup schedule:', error);
      res.status(500).json({
        error: 'schedule_failed',
        message: error.message,
      });
    }
  }
);

// Download a backup
app.get(
  '/api/v1/backups/:backupId/download',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { backupId } = req.params;
      // Pass tenantId to prevent IDOR - returns same error for not-found and unauthorized
      const backup = await backupService.getBackup(backupId, req.userId);

      if (!backup) {
        return res.status(404).json({
          error: 'not_found',
          message: `Backup not found`,
        });
      }

      if (backup.status !== 'completed') {
        return res.status(400).json({
          error: 'backup_not_ready',
          message: `Backup is not ready for download (status: ${backup.status})`,
        });
      }

      // Backup filename in the backup PVC
      const backupFilename = `${backup.serverId}-${backup.id}.tar.gz`;
      const downloadFilename = `${backup.serverId}-${backup.name.replace(/[^a-z0-9]/gi, '-')}.tar.gz`;

      // Backup server URL - NodePort accessible from outside cluster
      // BACKUP_SERVER_URL should be set to minikube IP + NodePort (e.g., http://192.168.49.2:30090)
      const backupServerUrl = process.env.BACKUP_SERVER_URL || 'http://192.168.49.2:30090';

      console.log(`[Backup] Downloading ${backupFilename} from ${backupServerUrl}`);

      // Fetch from backup server via NodePort
      const response = await fetch(`${backupServerUrl}/${backupFilename}`);

      if (!response.ok) {
        if (response.status === 404) {
          return res.status(404).json({
            error: 'backup_file_not_found',
            message: `Backup file not found on storage server`,
          });
        }
        throw new Error(`Backup server returned ${response.status}`);
      }

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);

      // Get content length if available
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      // Buffer and send the response
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error: any) {
      console.error('Failed to download backup:', error);
      res.status(500).json({
        error: 'download_failed',
        message: error.message,
      });
    }
  }
);

// WebSocket handling with authentication
// Track authenticated WebSocket clients with their userId
interface AuthenticatedWebSocket {
  ws: WebSocket;
  userId: string;
}
const wsClients = new Map<WebSocket, AuthenticatedWebSocket>();

wss.on('connection', (ws: WebSocket, req) => {
  // Extract JWT token from query parameter
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    console.warn('[WebSocket] Connection rejected: no token provided');
    ws.close(4001, 'Authentication required');
    return;
  }

  // Verify the JWT token and authenticate user (async)
  (async () => {
    try {
      const payload = verifyToken(token);
      const user = await userStore.getUserById(payload.userId);

      if (!user) {
        console.warn('[WebSocket] Connection rejected: user not found');
        ws.close(4001, 'User not found');
        return;
      }

      const userId = user.id;
      console.log(`[WebSocket] Client authenticated: ${user.email}`);

      // Store authenticated client
      wsClients.set(ws, { ws, userId });

      // Send current server list on connect - FILTERED BY TENANT and sanitized
      void k8sClient.listMinecraftServers().then((servers) => {
        const userServers = sanitizeServers(servers.filter((s) => s.tenantId === userId));
        ws.send(
          JSON.stringify({
            type: 'initial',
            servers: userServers,
          })
        );
      });

      ws.on('close', () => {
        console.log('[WebSocket] Client disconnected');
        wsClients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error);
        wsClients.delete(ws);
      });
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.warn('[WebSocket] Connection rejected: invalid token -', err.message);
      ws.close(4001, 'Invalid or expired token');
    }
  })();
});

function broadcastServerUpdate(event: string, data: any) {
  const serverTenantId = data.tenantId;

  wsClients.forEach((authClient, ws) => {
    // Only send to clients who own this server
    if (ws.readyState === WebSocket.OPEN && authClient.userId === serverTenantId) {
      const message = JSON.stringify({
        type: event,
        server: sanitizeServer(data),
        timestamp: new Date().toISOString(),
      });
      ws.send(message);
    }
  });
}

async function broadcastMetricsUpdate(metrics: Map<string, ServerMetrics>) {
  // Get server list to determine tenant ownership
  const servers = await k8sClient.listMinecraftServers();
  const serverTenantMap = new Map(servers.map((s) => [s.name, s.tenantId]));

  // Send filtered metrics to each client
  wsClients.forEach((authClient, ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    // Filter metrics to only include user's servers
    const userMetrics: Record<string, any> = {};
    metrics.forEach((value, serverName) => {
      if (serverTenantMap.get(serverName) === authClient.userId) {
        userMetrics[serverName] = {
          cpu: value.pod?.cpu,
          memory: value.pod?.memory,
          uptime: value.uptime,
          restartCount: value.restartCount,
          ready: value.ready,
        };
      }
    });

    // Only send if user has servers with metrics
    if (Object.keys(userMetrics).length > 0) {
      const message = JSON.stringify({
        type: 'metrics_update',
        metrics: userMetrics,
        timestamp: new Date().toISOString(),
      });
      ws.send(message);
    }
  });
}

// Register sync service callbacks for real-time updates
syncService.registerCallback({
  onServerUpdate: (serverStatus, eventType) => {
    broadcastServerUpdate(eventType.toLowerCase(), serverStatus);
  },
  onSyncComplete: (servers) => {
    // Send filtered and sanitized server list to each authenticated client
    wsClients.forEach((authClient, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      // Filter to only user's servers and sanitize
      const userServers = sanitizeServers(servers.filter((s) => s.tenantId === authClient.userId));
      const message = JSON.stringify({
        type: 'status_update',
        servers: userServers,
        timestamp: new Date().toISOString(),
      });
      ws.send(message);
    });
  },
});

// Subscribe to event bus for logging/metrics
eventBus.subscribe('*', (event) => {
  console.log(`[Event] ${event.type}: ${event.id}`);
});

// Async startup function
async function start() {
  // Initialize database connection
  try {
    await userStore.initialize();
    console.log('[Startup] Database connection established');
  } catch (error) {
    console.error('[Startup] Failed to connect to database:', error);
    process.exit(1);
  }

  // Start HTTP server
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
    PUT    /api/v1/servers/:name/auto-stop  - Configure auto-stop
    PUT    /api/v1/servers/:name/auto-start - Configure auto-start

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

    // Initialize backup service with database connection
    await backupService.initialize();

    // Start backup scheduler for auto-backups
    backupService.startScheduler();
    console.log('[Startup] Backup scheduler initialized');
  });
}

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.log(`[Shutdown] ${signal} received, shutting down...`);
  syncService.stopWatch();
  metricsService.stopPolling();
  backupService.stopScheduler();
  await closePool();
  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the server
start().catch((error) => {
  console.error('[Startup] Failed to start server:', error);
  process.exit(1);
});
