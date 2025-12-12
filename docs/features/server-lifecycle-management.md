# 1.1 Server Lifecycle Management

**Status**: COMPLETE
**Related Requirements**: FR-001 to FR-006
**Last Updated**: 2025-12-12

## Overview

Server Lifecycle Management provides complete control over Minecraft server instances from creation through deletion. This includes deployment automation, start/stop controls, and resource scaling with real-time status updates.

## Requirements Coverage

| Requirement | Description                                                | Status   |
| ----------- | ---------------------------------------------------------- | -------- |
| FR-001      | Predefined SKUs for resource allocation                    | Complete |
| FR-002      | 60-second deployment to playable state                     | Complete |
| FR-003      | Server lifecycle management (start, stop, restart, delete) | Complete |
| FR-004      | Server cancellation with cleanup and final backup          | Complete |
| FR-005      | Support 1000+ concurrent servers with auto-scaling         | Complete |
| FR-006      | Handle 100+ simultaneous deployments                       | Complete |

## Architecture

### Components

```
                    +------------------+
                    |   Frontend UI    |
                    |  (React/Svelte)  |
                    +--------+---------+
                             |
                             | WebSocket + REST API
                             v
                    +------------------+
                    |   API Server     |
                    |   (Node.js)      |
                    +--------+---------+
                             |
                             | Kubernetes API
                             v
+------------+      +------------------+      +------------------+
|            |      |                  |      |                  |
|   Gate     +<---->+    Operator      +----->+ MinecraftServer  |
|  (proxy)   |      | (Go/Kubebuilder) |      |      CRD         |
+------------+      +--------+---------+      +------------------+
                             |
                             v
                    +------------------+
                    |   StatefulSet    |
                    | + PVC + Service  |
                    +------------------+
```

### Key Files

- **Operator Controller**: `k8s/operator/controllers/minecraftserver_controller.go`
- **CRD Definition**: `k8s/operator/api/v1/minecraftserver_types.go`
- **CRD Manifest**: `k8s/operator/config/crd/minecraft.platform.com_minecraftservers.yaml`
- **Gate Proxy Config**: `k8s/manifests/dev/gate.yaml`
- **Frontend Hook**: `frontend/src/useWebSocket.ts`

## Features

### 1. Server Creation (FR-001, FR-002)

**API Endpoint**: `POST /api/v1/servers`

**Request Body**:

```json
{
  "name": "my-server",
  "tenantId": "default-tenant",
  "version": "LATEST",
  "resources": {
    "cpuRequest": "500m",
    "cpuLimit": "2",
    "memoryRequest": "1Gi",
    "memoryLimit": "2Gi",
    "memory": "2G",
    "storage": "10Gi"
  },
  "config": {
    "maxPlayers": 20,
    "gamemode": "survival",
    "difficulty": "normal",
    "motd": "A Minecraft Server"
  }
}
```

**Kubernetes Resources Created**:

1. **ConfigMap** - Server configuration (server.properties)
2. **StatefulSet** - Minecraft server pod with persistent storage
3. **Service** - LoadBalancer for external access
4. **PersistentVolumeClaim** - World data storage

**Timeline**:

- 0-5s: CRD created, operator reconciles
- 5-30s: Pod scheduled and image pulled
- 30-60s: Minecraft server starts and becomes ready

### 2. Server Start/Stop (FR-003)

**Start Server**:

```bash
# API
PUT /api/v1/servers/{name}/start

# Effect: Sets spec.stopped = false, replicas = 1
```

**Stop Server**:

```bash
# API
PUT /api/v1/servers/{name}/stop

# Effect: Sets spec.stopped = true, replicas = 0
```

**Operator Reconciliation Logic** (`minecraftserver_controller.go:274-286`):

```go
replicas := int32(1)
if server.Spec.Stopped {
    // Check if autoStart is enabled and externally scaled up
    if server.Spec.AutoStart != nil && server.Spec.AutoStart.Enabled &&
        statefulSet.Spec.Replicas != nil && *statefulSet.Spec.Replicas > 0 {
        // Preserve current replicas (mc-router scaled it up)
        replicas = *statefulSet.Spec.Replicas
    } else {
        replicas = int32(0)
    }
}
```

### 3. Auto-Stop (Inactivity Shutdown)

**Purpose**: Automatically stop servers with no players to save resources.

**Configuration**:

```yaml
spec:
  autoStop:
    enabled: true
    idleTimeoutMinutes: 3 # 1-1440 minutes
```

**How It Works**:

1. Operator polls player count via RCON every 30 seconds
2. When playerCount = 0, `lastPlayerActivity` timestamp is set
3. If (now - lastPlayerActivity) > idleTimeoutMinutes, server is stopped
4. `autoStoppedAt` timestamp is recorded for wake-on-connect tracking

**Operator Implementation**: Checks `server.Status.LastPlayerActivity` against configured timeout.

### 4. Offline MOTD (Aternos-Style)

**Purpose**: Show a custom message in the Minecraft server list when servers are offline, prompting players to start the server from the dashboard.

**How It Works**:

1. **Gate** (Minecraft proxy) runs in Lite mode with fallback configuration
2. Player adds `localhost:25565` to their Minecraft server list
3. Gate forwards the status ping to the backend server
4. If the backend is offline, Gate returns a custom fallback response:
   - Custom MOTD: "Server is offline / Start it from the dashboard!"
   - Custom version text: "Offline"
   - Custom favicon (server icon)
5. Player sees this in their server list without connecting
6. Player starts server via web dashboard, then connects

**Gate Configuration** (`k8s/manifests/dev/gate.yaml`):

```yaml
config:
  bind: 0.0.0.0:25565
  lite:
    enabled: true
    routes:
      - host: '*'
        backend: hehe.minecraft-servers.svc.cluster.local:25565
        fallback:
          motd: |
            §cServer is offline
            §eStart it from the dashboard!
          version:
            name: '§cOffline'
            protocol: -1
          favicon: 'data:image/png;base64,...' # 64x64 PNG
```

**Minecraft Color Codes**:

- `§c` = Red text
- `§e` = Yellow text
- `§a` = Green text

**Note**: Unlike auto-start (wake-on-connect), this approach requires players to manually start servers from the dashboard. This is intentional to give users full control over when their servers run.

### 5. Server Deletion (FR-004)

**API Endpoint**: `DELETE /api/v1/servers/{name}`

**Cleanup Process**:

1. Operator receives delete event
2. Final backup created (if backups enabled)
3. StatefulSet deleted (pods terminated gracefully)
4. Service deleted
5. ConfigMap deleted
6. PVC deleted (world data removed)
7. CRD finalizer removed

### 6. Real-Time Status Updates

**WebSocket Events** (`useWebSocket.ts`):

| Event Type              | Trigger            | Data              |
| ----------------------- | ------------------ | ----------------- |
| `initial`               | Connection         | All servers       |
| `created`               | New server         | Server object     |
| `deleted`               | Server removed     | Server name       |
| `started`               | Server started     | Updated server    |
| `stopped`               | Server stopped     | Updated server    |
| `scaled`                | Replicas changed   | Updated server    |
| `status_update`         | Phase change       | All servers       |
| `metrics_update`        | Stats refresh      | Metrics by server |
| `auto_stop_configured`  | Auto-stop toggled  | Updated server    |
| `auto_start_configured` | Auto-start toggled | Updated server    |

**Frontend Handling**:

```typescript
ws.onmessage = (event) => {
  const message: WebSocketMessage = JSON.parse(event.data);
  switch (message.type) {
    case 'started':
    case 'stopped':
    case 'scaled':
      // Update server in list
      setServers((prev) =>
        prev.map((s) => (s.name === message.server.name ? { ...s, ...message.server } : s))
      );
      break;
  }
};
```

## Server Phases

| Phase      | Description                         |
| ---------- | ----------------------------------- |
| `Pending`  | CRD created, waiting for resources  |
| `Starting` | Pod scheduled, server initializing  |
| `Running`  | Server accepting connections        |
| `Stopping` | Graceful shutdown in progress       |
| `Stopped`  | Replicas = 0, no resources consumed |
| `Error`    | Failure state, check logs           |

## MinecraftServer CRD Schema

### Spec Fields

```yaml
spec:
  serverId: string # Unique identifier
  tenantId: string # Tenant ownership
  stopped: bool # Whether server should be stopped
  image: string # Docker image (default: itzg/minecraft-server:latest)
  version: string # Minecraft version
  storageClass: string # Storage class for PVC

  resources:
    cpuRequest: string # e.g., "500m"
    cpuLimit: string # e.g., "2"
    memoryRequest: string # e.g., "1Gi"
    memoryLimit: string # e.g., "2Gi"
    memory: string # JVM memory (e.g., "2G")
    storage: string # PVC size (e.g., "10Gi")

  config:
    maxPlayers: int
    gamemode: enum # survival, creative, adventure, spectator
    difficulty: enum # peaceful, easy, normal, hard
    levelName: string
    motd: string
    whiteList: bool
    onlineMode: bool
    pvp: bool
    enableCommandBlock: bool
    additionalProperties: map[string]string

  autoStop:
    enabled: bool
    idleTimeoutMinutes: int # 1-1440

  autoStart:
    enabled: bool
```

### Status Fields

```yaml
status:
  phase: string # Current server phase
  message: string # Status message
  lastUpdated: timestamp
  externalIP: string # LoadBalancer IP
  port: int32 # External port
  playerCount: int
  maxPlayers: int
  version: string
  lastPlayerActivity: timestamp
  autoStoppedAt: timestamp
  resourceUsage:
    cpu: quantity
    memory: quantity
    storage: quantity
```

## Local Development Setup

### Prerequisites

- Minikube or Docker Desktop Kubernetes
- kubectl configured
- mc-router deployed in `minecraft-servers` namespace

### Start the Platform

```bash
# 1. Start Kubernetes
minikube start

# 2. Create namespace
kubectl create namespace minecraft-servers

# 3. Apply CRDs
kubectl apply -f k8s/operator/config/crd/

# 4. Deploy Gate proxy
kubectl apply -f k8s/manifests/dev/gate.yaml

# 5. Start operator (local)
cd k8s/operator && RCON_PASSWORD=<your-rcon-password> ./bin/operator.exe

# 6. Start API server
cd api-server && npm run dev

# 7. Start frontend
cd frontend && npm run dev

# 8. Port forward Gate proxy
kubectl port-forward -n minecraft-servers svc/gate 25565:25565
```

### Testing Offline MOTD

```bash
# 1. Create a server
curl -X POST http://localhost:3000/api/v1/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-server",
    "autoStop": {"enabled": true, "idleTimeoutMinutes": 3}
  }'

# 2. Stop the server
curl -X PUT http://localhost:3000/api/v1/servers/test-server/stop

# 3. Add localhost:25565 to Minecraft server list
# - You'll see custom MOTD: "Server is offline / Start it from the dashboard!"
# - Server shows as "Offline" in version text
# - Custom icon displayed

# 4. Start server via API or dashboard
curl -X PUT http://localhost:3000/api/v1/servers/test-server/start

# 5. Wait ~60s for server to start, then connect
```

## Troubleshooting

### Server Won't Start

1. Check operator logs: `kubectl logs -f deployment/operator -n minecraft-system`
2. Check pod events: `kubectl describe pod <server-name>-0 -n minecraft-servers`
3. Verify PVC bound: `kubectl get pvc -n minecraft-servers`

### Offline MOTD Not Showing

1. Verify Gate proxy is running:
   ```bash
   kubectl get pods -n minecraft-servers -l app=gate
   ```
2. Check Gate logs for backend connection:
   ```bash
   kubectl logs -n minecraft-servers deployment/gate --tail=50
   ```
3. Ensure port forwarding is active:
   ```bash
   kubectl port-forward -n minecraft-servers svc/gate 25565:25565
   ```
4. Verify Gate config has correct backend address:
   ```bash
   kubectl get configmap gate-config -n minecraft-servers -o yaml
   ```

### Auto-Stop Not Triggering

1. Verify RCON connection (operator must connect to get player count)
2. Check `lastPlayerActivity` in server status:
   ```bash
   kubectl get mcserver <name> -n minecraft-servers -o yaml | grep lastPlayerActivity
   ```

---

# 1.2 Server Configuration

**Status**: COMPLETE
**Related Requirements**: FR-007 to FR-012
**Last Updated**: 2025-12-12

## Overview

Server Configuration provides both persistent configuration (requiring restart) and live settings (instant RCON commands) for Minecraft servers. The UI uses tabbed navigation with clear indicators for which changes require restarts.

## Features

### 1. Server Properties (Restart Required)

**API Endpoint**: `PATCH /api/v1/servers/{name}`

Properties that require server restart to take effect:

| Property             | Type    | Description                         |
| -------------------- | ------- | ----------------------------------- |
| `maxPlayers`         | number  | Maximum concurrent players (1-1000) |
| `gamemode`           | string  | Default gamemode for new players    |
| `difficulty`         | string  | peaceful, easy, normal, hard        |
| `motd`               | string  | Server list message                 |
| `pvp`                | boolean | Allow player vs player combat       |
| `allowFlight`        | boolean | Allow flying in survival mode       |
| `enableCommandBlock` | boolean | Enable command blocks               |
| `forceGamemode`      | boolean | Force gamemode on join              |
| `hardcoreMode`       | boolean | Enable hardcore mode                |
| `spawnAnimals`       | boolean | Spawn passive mobs                  |
| `spawnMonsters`      | boolean | Spawn hostile mobs                  |
| `spawnNpcs`          | boolean | Spawn villagers                     |
| `viewDistance`       | number  | Chunk render distance (3-32)        |
| `simulationDistance` | number  | Entity simulation distance          |
| `spawnProtection`    | number  | Spawn area protection radius        |
| `whiteList`          | boolean | Enable whitelist mode               |
| `onlineMode`         | boolean | Require Microsoft authentication    |

**Request Example**:

```json
PATCH /api/v1/servers/my-server
{
  "maxPlayers": 50,
  "difficulty": "hard",
  "pvp": true
}
```

### 2. Live Settings (Instant RCON)

Settings that apply immediately via RCON commands without restart:

#### Weather Control

**API**: `POST /api/v1/servers/{name}/console`

```json
{ "command": "weather clear" }
{ "command": "weather rain" }
{ "command": "weather thunder" }
```

#### Time Control

```json
{ "command": "time set day" }     // 1000 ticks
{ "command": "time set noon" }    // 6000 ticks
{ "command": "time set sunset" }  // 12000 ticks
{ "command": "time set night" }   // 13000 ticks
{ "command": "time set midnight" }// 18000 ticks
{ "command": "time set sunrise" } // 23000 ticks
```

#### Gamerules

Gamerules persist across restarts (stored in `level.dat`).

**Minecraft 1.21+ uses snake_case names**:

| Gamerule                              | Description                         |
| ------------------------------------- | ----------------------------------- |
| `keep_inventory`                      | Keep items on death                 |
| `pvp`                                 | Allow PvP damage                    |
| `natural_health_regeneration`         | Regen health when fed               |
| `immediate_respawn`                   | Skip death screen                   |
| `fall_damage`                         | Take fall damage                    |
| `fire_damage`                         | Take fire damage                    |
| `drowning_damage`                     | Take drowning damage                |
| `freeze_damage`                       | Take freeze damage                  |
| `advance_time`                        | Daylight cycle enabled              |
| `advance_weather`                     | Weather cycle enabled               |
| `spawn_mobs`                          | Natural mob spawning                |
| `raids`                               | Pillager raids can occur            |
| `spawn_wardens`                       | Wardens can spawn                   |
| `spawn_patrols`                       | Pillager patrols spawn              |
| `mob_drops`                           | Mobs drop items on death            |
| `block_drops`                         | Blocks drop items when broken       |
| `entity_drops`                        | Entities drop items                 |
| `tnt_explodes`                        | TNT can explode                     |
| `show_advancement_messages`           | Show advancement messages           |
| `show_death_messages`                 | Show death messages                 |
| `send_command_feedback`               | Show command output                 |
| `allow_entering_nether_using_portals` | Nether portals work                 |
| `ender_pearls_vanish_on_death`        | Thrown ender pearls vanish on death |
| `command_blocks_work`                 | Command blocks can execute          |
| `spawner_blocks_work`                 | Mob spawners can spawn mobs         |

**API for Gamerules**:

```bash
# Get current value
POST /api/v1/servers/{name}/console
{ "command": "gamerule keep_inventory" }
# Returns: "Gamerule keep_inventory is currently set to: false"

# Set value
POST /api/v1/servers/{name}/console
{ "command": "gamerule keep_inventory true" }
```

#### Broadcast Messages

```json
POST /api/v1/servers/{name}/console
{ "command": "say Hello everyone!" }
```

### 3. Frontend UI

**URL Routes**:

| Route                   | View                     |
| ----------------------- | ------------------------ |
| `/servers/:name/config` | Server configuration tab |

**Tab Layout** (`ServerConfigEditor.tsx`):

- **Live Settings** (green "Instant" badge): Weather, time, gamerules, broadcast
- **Server Properties** (yellow "Restart" badge): All persistent config options

**Key Files**:

- `frontend/src/ServerConfigEditor.tsx` - Configuration editor with tabs
- `frontend/src/LiveSettings.tsx` - Instant RCON settings component
- `frontend/src/api.ts` - API functions for config updates

---

# 1.3 Console & Logs

**Status**: COMPLETE
**Related Requirements**: FR-013 to FR-016
**Last Updated**: 2025-12-12

## Overview

Console & Logs provides real-time log streaming, command execution, log filtering/search capabilities, and historical log file access. Inspired by Shockbyte's smart console with categorized logs.

## Requirements Coverage

| Requirement | Description                  | Priority | Status   |
| ----------- | ---------------------------- | -------- | -------- |
| FR-013      | Live console log streaming   | P0       | Complete |
| FR-014      | Command execution via RCON   | P0       | Complete |
| FR-015      | Log filtering by level       | P1       | Complete |
| FR-016      | Log download/export          | P1       | Complete |
| FR-016a     | Log search within logs       | P2       | Complete |
| FR-016b     | Generate shareable log links | P2       | Complete |

## Features

### 1. Live Console (P0)

**API Endpoint**: `GET /api/v1/servers/{name}/logs?lines=100`

**Response**:

```json
{
  "serverName": "my-server",
  "logs": [
    "[12:34:56] [Server thread/INFO]: Starting minecraft server version 1.21.4",
    "[12:34:57] [Server thread/INFO]: Loading properties",
    "[12:35:01] [Server thread/WARN]: Failed to load something",
    "[12:35:05] [Server thread/ERROR]: Exception in server tick loop"
  ]
}
```

**Implementation**:

- Logs fetched every 3 seconds via polling
- New logs appended to existing entries
- Auto-scroll to bottom (disabled when user scrolls up)
- Maximum 500 log entries kept in memory to prevent browser slowdown

**Key Files**:

- `api-server/src/index.ts:178-195` - Log streaming endpoint
- `frontend/src/ServerDetail.tsx:282-306` - Log refresh logic

### 2. Command Execution (P0)

**API Endpoint**: `POST /api/v1/servers/{name}/console`

**Request Body**:

```json
{
  "command": "time set day"
}
```

**Response**:

```json
{
  "result": "Set the time to 1000"
}
```

**How It Works**:

1. Frontend sends command to API server
2. API server connects to Minecraft via RCON pool
3. Command executed and response returned
4. Command + result displayed in console with color coding

**Command Entry Types**:

| Type      | Color  | Example              |
| --------- | ------ | -------------------- |
| `command` | Green  | `$ time set day`     |
| `result`  | Cyan   | Response from server |
| `error`   | Red    | Execution errors     |
| `log`     | Varies | Server log entries   |

### 3. Log Filtering (P1)

**Filter Tabs**:

| Filter   | Matches                                   | Color  |
| -------- | ----------------------------------------- | ------ |
| All      | All log entries                           | Blue   |
| Errors   | Contains: error, exception, fatal, failed | Red    |
| Warnings | Contains: warn, warning (+ errors)        | Yellow |
| Info     | All except debug/trace                    | Blue   |

**Log Level Classification** (`ServerDetail.tsx:76-88`):

```typescript
const classifyLogLevel = (content: string): 'error' | 'warn' | 'info' | 'debug' => {
  const lower = content.toLowerCase();
  if (
    lower.includes('error') ||
    lower.includes('exception') ||
    lower.includes('fatal') ||
    lower.includes('failed')
  ) {
    return 'error';
  }
  if (lower.includes('warn') || lower.includes('warning')) {
    return 'warn';
  }
  if (lower.includes('debug') || lower.includes('trace')) {
    return 'debug';
  }
  return 'info';
};
```

**UI Features**:

- Filter tabs show count badges (e.g., "Errors 5")
- Color-coded log entries based on level
- Commands/results always shown regardless of filter

### 4. Log Download (P1)

**Download Format**: Plain text file with timestamps

**Filename Pattern**: `{serverName}-logs-{YYYY-MM-DD}.txt`

**Output Format**:

```
[2025-12-12T15:30:00.000Z] [Server thread/INFO]: Server started
[2025-12-12T15:30:01.000Z] > list
[2025-12-12T15:30:01.000Z] < There are 0 of a max of 20 players online
```

**Implementation** (`ServerDetail.tsx:517-536`):

```typescript
const handleDownloadLogs = () => {
  const logText = consoleEntries
    .map((entry) => {
      const time = entry.timestamp.toISOString();
      if (entry.type === 'command') return `[${time}] > ${entry.content}`;
      if (entry.type === 'result') return `[${time}] < ${entry.content}`;
      return `[${time}] ${entry.content}`;
    })
    .join('\n');

  const blob = new Blob([logText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  // ... download trigger
};
```

### 5. Log Search (P2)

**Features**:

- Toggle search bar with keyboard shortcut potential
- Real-time filtering as you type
- Match count displayed ("Found 12 matching logs")
- Search highlights in yellow within log entries
- Clear search button

**Search Highlighting** (`ServerDetail.tsx:1030-1064`):

- Matches wrapped in `<mark>` tags with yellow background
- Case-insensitive matching
- Works within filtered results

### 6. Log Sharing (P2)

**Current Implementation**: Client-side base64 encoding

**How It Works**:

1. Last 100 filtered log entries selected
2. Content base64 encoded
3. Shareable URL generated: `{origin}/shared-logs?data={encoded}`
4. Copy button to clipboard
5. Dismissible modal shows URL

**Note**: For production, consider uploading to a paste service or storing in database with short URLs.

### 7. Log Files Browser

**Purpose**: Browse and view historical log files including archived `.log.gz` files.

**API Endpoints**:

| Method | Endpoint                                      | Description        |
| ------ | --------------------------------------------- | ------------------ |
| `GET`  | `/api/v1/servers/{name}/logs/files`           | List all log files |
| `GET`  | `/api/v1/servers/{name}/logs/files/:filename` | Get file content   |

**List Response**:

```json
{
  "serverName": "my-server",
  "files": [
    {
      "name": "latest.log",
      "size": "1.3 MB",
      "sizeBytes": 1364796,
      "modified": "Dec 12 15:55",
      "type": "file"
    },
    {
      "name": "2025-12-12-1.log.gz",
      "size": "5.4 KB",
      "sizeBytes": 5548,
      "modified": "Dec 12 11:30",
      "type": "file"
    }
  ],
  "count": 17
}
```

**Implementation Details**:

- Uses Kubernetes Exec API to run commands in pod
- `ls -la /data/logs/` parses file metadata
- Gzipped files read with `zcat`
- Regular files read with `tail -n {lines}`

**Backend Exec Method** (`k8s-client.ts:349-389`):

```typescript
async execInPod(name: string, command: string[]): Promise<string> {
  const exec = new k8s.Exec(this.kc);
  const outputStream = new PassThrough();

  return new Promise((resolve, reject) => {
    exec.exec(
      this.namespace,
      `${name}-0`,
      this.containerName,  // 'minecraft-server'
      command,
      outputStream,  // stdout
      outputStream,  // stderr
      null,          // stdin
      false          // tty
    ).then((conn) => {
      conn.on('close', () => resolve(output));
    });
  });
}
```

**UI Features**:

- View switcher: "Live Console" / "Log Files" tabs
- Table with columns: File Name, Size, Modified, Actions
- `latest.log` highlighted with "Current" badge
- Click "View" to open file content viewer
- Download button for viewed files
- Back button to return to file list

## Frontend Components

**Key Files**:

- `frontend/src/ServerDetail.tsx` - Main console UI and logic
- `frontend/src/api.ts` - API functions for logs

**State Management**:

```typescript
// Console entries
const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);

// Filtering
const [logFilter, setLogFilter] = useState<LogLevel>('all');
const [logSearch, setLogSearch] = useState('');
const [showSearch, setShowSearch] = useState(false);

// Sharing
const [shareUrl, setShareUrl] = useState<string | null>(null);

// Log files
const [logFiles, setLogFiles] = useState<LogFile[]>([]);
const [selectedLogFile, setSelectedLogFile] = useState<string | null>(null);
const [selectedFileContent, setSelectedFileContent] = useState<string[]>([]);
const [consoleView, setConsoleView] = useState<'live' | 'files'>('live');
```

## URL Routes

| Route                    | View                    |
| ------------------------ | ----------------------- |
| `/servers/:name/console` | Console tab (live view) |

## Console Toolbar Buttons

| Button   | Icon | Action                   |
| -------- | ---- | ------------------------ |
| Search   | 🔍   | Toggle search bar        |
| Download | ⬇️   | Export logs as .txt file |
| Share    | 🔗   | Generate shareable URL   |
| Clear    | 🗑️   | Clear console entries    |
| Refresh  | 🔄   | Force refresh logs       |

## Troubleshooting

### Logs Not Loading

1. Check server is running: `kubectl get pods -n minecraft-servers`
2. Verify API server can reach pod logs
3. Check browser console for API errors

### Log Files 404 Error

1. Ensure metrics-server is enabled: `minikube addons enable metrics-server`
2. Verify pod has `/data/logs/` directory
3. Check container name matches: `kubectl get pod {name}-0 -o jsonpath='{.spec.containers[*].name}'`

### Command Execution Fails

1. Verify RCON is enabled on server
2. Check RCON password matches environment variable
3. Ensure server is in "Running" phase

---

# 1.4 Player Management

**Status**: COMPLETE
**Related Requirements**: FR-017 to FR-022
**Last Updated**: 2025-12-12

## Overview

Player Management provides comprehensive tools for managing players including online player monitoring, whitelist/ban management, operator controls, and per-player actions.

## Features

### 1. Online Players View

**API Endpoint**: `GET /api/v1/servers/{name}/players`

**Response**:

```json
{
  "online": 3,
  "max": 20,
  "players": [
    {
      "name": "Steve",
      "health": 20,
      "maxHealth": 20,
      "foodLevel": 18,
      "xpLevel": 15,
      "gameMode": 0,
      "gameModeName": "Survival",
      "position": { "x": 100.5, "y": 64, "z": -200.3 },
      "dimension": "minecraft:overworld",
      "inventory": [...],
      "equipment": {...},
      "enderItems": [...],
      "abilities": {...}
    }
  ]
}
```

**URL Route**: `/servers/:name/players`

**Individual Player View**: `/servers/:name/players/:playerName`

### 2. Player Actions

Actions available for each online player:

| Action          | API Call                                    | Description               |
| --------------- | ------------------------------------------- | ------------------------- |
| Change Gamemode | `gamemode <mode> <player>`                  | Set player's gamemode     |
| Heal            | `effect give <player> instant_health 1 100` | Fully heal player         |
| Feed            | `effect give <player> saturation 1 100`     | Restore hunger            |
| Clear Effects   | `effect clear <player>`                     | Remove all potion effects |
| Kick            | `kick <player> [reason]`                    | Disconnect player         |
| Ban             | `ban <player> [reason]`                     | Permanently ban player    |
| Grant Op        | `op <player>`                               | Give operator status      |
| Revoke Op       | `deop <player>`                             | Remove operator status    |

**API Functions** (`frontend/src/api.ts`):

```typescript
setPlayerGamemode(serverName, player, gamemode): Promise<CommandResult>
healPlayer(serverName, player): Promise<CommandResult>
feedPlayer(serverName, player): Promise<CommandResult>
clearPlayerEffects(serverName, player): Promise<CommandResult>
kickPlayer(serverName, player, reason?): Promise<void>
banPlayer(serverName, player, reason?): Promise<void>
grantOp(serverName, player): Promise<void>
revokeOp(serverName, player): Promise<void>
```

### 3. Whitelist Management

**API Endpoints**:

| Method   | Endpoint                                    | Description          |
| -------- | ------------------------------------------- | -------------------- |
| `GET`    | `/api/v1/servers/{name}/whitelist`          | Get whitelist status |
| `POST`   | `/api/v1/servers/{name}/whitelist`          | Add player           |
| `DELETE` | `/api/v1/servers/{name}/whitelist/{player}` | Remove player        |
| `PUT`    | `/api/v1/servers/{name}/whitelist/toggle`   | Enable/disable       |

**Response Example**:

```json
{
  "enabled": true,
  "count": 5,
  "players": ["Steve", "Alex", "Notch", "jeb_", "Dinnerbone"]
}
```

### 4. Ban Management

**API Endpoints**:

| Method   | Endpoint                               | Description  |
| -------- | -------------------------------------- | ------------ |
| `GET`    | `/api/v1/servers/{name}/bans`          | Get ban list |
| `POST`   | `/api/v1/servers/{name}/bans`          | Ban player   |
| `DELETE` | `/api/v1/servers/{name}/bans/{player}` | Unban player |

**IP Ban Endpoints**:

| Method   | Endpoint                               | Description     |
| -------- | -------------------------------------- | --------------- |
| `GET`    | `/api/v1/servers/{name}/bans/ips`      | Get IP ban list |
| `POST`   | `/api/v1/servers/{name}/bans/ips`      | Ban IP          |
| `DELETE` | `/api/v1/servers/{name}/bans/ips/{ip}` | Unban IP        |

### 5. Operator Management

**API Endpoints**:

| Method   | Endpoint                              | Description |
| -------- | ------------------------------------- | ----------- |
| `POST`   | `/api/v1/servers/{name}/ops`          | Grant op    |
| `DELETE` | `/api/v1/servers/{name}/ops/{player}` | Revoke op   |

### 6. Kick Player

**API Endpoint**: `POST /api/v1/servers/{name}/kick`

**Request Body**:

```json
{
  "player": "Steve",
  "reason": "AFK too long"
}
```

### 7. Frontend UI

**URL Routes**:

| Route                            | View                     |
| -------------------------------- | ------------------------ |
| `/servers/:name/players`         | Online players list      |
| `/servers/:name/players/:player` | Individual player detail |
| `/servers/:name/management`      | Player management tabs   |

**Management Tab Layout** (`PlayerManagement.tsx`):

- **Whitelist**: Add/remove players, toggle whitelist mode
- **Operators**: Grant/revoke op status
- **Bans**: Ban/unban players with reasons
- **IP Bans**: Ban/unban IP addresses

**Key Files**:

- `frontend/src/PlayerView.tsx` - Individual player detail view
- `frontend/src/PlayerManagement.tsx` - Whitelist/ban/op management
- `api-server/src/index.ts` - All player management API endpoints

### 8. Player Data Sources

Player data is fetched from the server using RCON commands and NBT data parsing:

1. **Player List**: `list` command for online players
2. **Player Data**: NBT file parsing from `world/playerdata/<uuid>.dat`
3. **Equipment**: Parsed from inventory slots
4. **Position/Dimension**: From player NBT data

---

# URL Routing Structure

**Status**: COMPLETE
**Last Updated**: 2025-12-12

## Overview

The frontend uses React Router for URL-based navigation, making all views bookmarkable and shareable.

## Routes

| URL Pattern                          | Component    | Description                  |
| ------------------------------------ | ------------ | ---------------------------- |
| `/`                                  | ServerList   | Home - all servers           |
| `/servers/:serverName`               | ServerDetail | Server detail (overview tab) |
| `/servers/:serverName/overview`      | ServerDetail | Overview tab                 |
| `/servers/:serverName/console`       | ServerDetail | Console tab                  |
| `/servers/:serverName/players`       | ServerDetail | Players list tab             |
| `/servers/:serverName/players/:name` | ServerDetail | Individual player view       |
| `/servers/:serverName/management`    | ServerDetail | Player management tab        |
| `/servers/:serverName/config`        | ServerDetail | Server configuration tab     |

## Implementation

**Key Files**:

- `frontend/src/main.tsx` - BrowserRouter setup
- `frontend/src/App.tsx` - Route definitions
- `frontend/src/ServerList.tsx` - Server list component
- `frontend/src/ServerDetail.tsx` - Server detail with tab routing

**Route Parameters**:

- `serverName`: Name of the Minecraft server
- `tab`: Active tab (overview, console, players, management, config)
- `name`: Player name (for player detail view)
