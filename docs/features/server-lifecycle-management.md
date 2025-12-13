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

**Default Behavior**: Auto-stop is **always enabled** with a **2-minute idle timeout**. This is not user-configurable to ensure efficient resource usage across all servers.

```yaml
spec:
  autoStop:
    enabled: true
    idleTimeoutMinutes: 2 # Fixed - not user-configurable
```

**How It Works**:

1. Operator polls player count via RCON every 30 seconds
2. When playerCount = 0, `lastPlayerActivity` timestamp is set
3. If (now - lastPlayerActivity) > 2 minutes, server is stopped automatically
4. `autoStoppedAt` timestamp is recorded for tracking
5. Gate proxy shows offline MOTD when players ping the stopped server

**Operator Implementation**: Checks `server.Status.LastPlayerActivity` against the 2-minute timeout.

### 4. Offline MOTD with Dynamic Gate Routing

**Purpose**: Show a custom message in the Minecraft server list when servers are offline, prompting players to start the server from the dashboard. Gate supports multiple servers from different tenants with host-based routing.

**Architecture**:

```
Players connect to: {server-name}.local:25565
                         │
                         ▼
                 ┌──────────────┐
                 │  Gate Proxy  │ (single instance, shared)
                 │  port 25565  │
                 └──────┬───────┘
                        │ Routes based on hostname
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ Server A │  │ Server B │  │ Server C │
   │ (user 1) │  │ (user 2) │  │ (user 1) │
   └──────────┘  └──────────┘  └──────────┘
```

**How It Works**:

1. **Gate** (Minecraft proxy) runs in Lite mode with dynamic host-based routing
2. API server automatically generates Gate config with routes for each server
3. Player adds `{server-name}.local:25565` to their Minecraft server list (e.g., `mc-a78e5e3d10e3.local`)
4. Player must add a hosts file entry mapping `{server-name}.local` to `127.0.0.1`
5. Gate routes the ping to the correct backend based on hostname
6. If the backend is offline, Gate returns a custom fallback response:
   - Custom MOTD: "Server is offline / Start it from the dashboard!"
   - Custom version text: "Offline"
7. Player sees this in their server list without connecting
8. Player starts server via web dashboard, then connects

**Dynamic Gate Configuration**:

The API server automatically updates the Gate ConfigMap when servers are created or deleted. Routes are generated per-server with host-based matching.

**Generated Config Example** (`k8s/manifests/dev/gate.yaml`):

```yaml
# NOTE: This ConfigMap is auto-managed by the API server.
# Routes are dynamically generated for each Minecraft server on create/delete.
config:
  bind: 0.0.0.0:25565
  lite:
    enabled: true
    routes:
      # Route for mc-a78e5e3d10e3 (test server)
      - host: 'mc-a78e5e3d10e3.*'
        backend: mc-a78e5e3d10e3.minecraft-servers.svc.cluster.local:25565
        fallback:
          motd: |
            §ctest is offline
            §eStart it from the dashboard!
          version:
            name: '§cOffline'
            protocol: -1
      # Route for mc-b92f7c8d1e4a (production server)
      - host: 'mc-b92f7c8d1e4a.*'
        backend: mc-b92f7c8d1e4a.minecraft-servers.svc.cluster.local:25565
        fallback:
          motd: |
            §cproduction is offline
            §eStart it from the dashboard!
          version:
            name: '§cOffline'
            protocol: -1
      # Catch-all for unknown hosts
      - host: '*'
        backend: localhost:25565
        fallback:
          motd: |
            §cNo server found
            §7Add server hostname to your hosts file
          version:
            name: '§7Unknown Host'
            protocol: -1
```

**API Server Route Management** (`api-server/src/k8s-client.ts`):

```typescript
// Called on server create, delete, and API startup
async updateGateRoutes(): Promise<void> {
  const servers = await this.listMinecraftServers();

  // Generate routes for each server
  const routes = servers.map((server) => ({
    host: `${server.name}.*`,
    backend: `${server.name}.${this.namespace}.svc.cluster.local:25565`,
    fallback: {
      motd: `§c${server.displayName || server.name} is offline\n§eStart it from the dashboard!`,
      version: { name: '§cOffline', protocol: -1 },
    },
  }));

  // Update ConfigMap and restart Gate pods
  await this.coreApi.replaceNamespacedConfigMap({...});
  await this.restartGateDeployment();
}
```

**Minecraft Color Codes**:

- `§c` = Red text
- `§e` = Yellow text
- `§a` = Green text
- `§7` = Gray text

**Gate Lite Mode Limitation**: Gate Lite only handles server list pings (MOTD display). When a player clicks "Connect" on a stopped server, they will see "Disconnected" rather than a custom message. Custom disconnect messages would require Gate's full mode with more complex configuration.

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
    enabled: bool # Always true - not user-configurable
    idleTimeoutMinutes: int # Always 2 - not user-configurable

  autoStart:
    enabled: bool # Not currently implemented
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
- Gate proxy (lightweight Minecraft proxy)
- Access to hosts file for local testing

### Start the Platform

```bash
# 1. Start Kubernetes
minikube start

# 2. Create namespace
kubectl create namespace minecraft-servers

# 3. Apply CRDs
kubectl apply -f k8s/operator/config/crd/

# 4. Deploy Gate proxy (config is auto-managed by API server)
kubectl apply -f k8s/manifests/dev/gate.yaml

# 5. Start operator (local)
cd k8s/operator && RCON_PASSWORD=<your-rcon-password> ./bin/operator.exe

# 6. Deploy backup server (for backup downloads)
kubectl apply -f k8s/manifests/dev/backup-server.yaml

# 7. Port forward backup server (fixed port for local dev)
kubectl port-forward -n minecraft-servers svc/backup-server 9090:80 &

# 8. Start API server (set BACKUP_SERVER_URL in .env)
# Ensure api-server/.env contains: BACKUP_SERVER_URL=http://127.0.0.1:9090
cd api-server && npm run dev

# 9. Start frontend
cd frontend && npm run dev

# 10. Port forward Gate proxy
kubectl port-forward -n minecraft-servers svc/gate 25565:25565
```

### Testing Offline MOTD with Host-Based Routing

**Step 1: Create a server and note its name**

```bash
# Create a server via frontend dashboard or API
# Note the server's K8s resource name (e.g., mc-a78e5e3d10e3)
# This is shown in the server list and is derived from the server's UUID
```

**Step 2: Add hosts file entry for your server**

The server name follows the pattern `mc-{first-12-chars-of-uuid}`.

**Windows** (run as Administrator):

```cmd
# Edit C:\Windows\System32\drivers\etc\hosts
# Add entry:
127.0.0.1 mc-a78e5e3d10e3.local
```

**Linux/Mac**:

```bash
# Edit /etc/hosts
sudo echo "127.0.0.1 mc-a78e5e3d10e3.local" >> /etc/hosts
```

**Step 3: Stop the server and test MOTD**

```bash
# Stop the server via dashboard or API
curl -X POST http://localhost:8080/api/v1/servers/{server-uuid}/stop
```

**Step 4: Add server to Minecraft**

1. Open Minecraft Java Edition
2. Go to Multiplayer → Add Server
3. Enter server address: `mc-a78e5e3d10e3.local:25565`
4. Save and check server list

**Expected Results**:

- When server is **stopped**: MOTD shows "Server is offline / Start it from the dashboard!" in red/yellow
- When server is **running**: Normal MOTD from server, can connect and play
- When hostname **not in hosts file**: MOTD shows "No server found / Add server hostname to your hosts file"

**Step 5: Start server and connect**

1. Start server from web dashboard
2. Wait ~60s for server to initialize
3. Click "Join Server" in Minecraft

### Why Host-Based Routing?

Host-based routing enables:

- **Multi-tenant support**: Each user's server has a unique hostname
- **Resource efficiency**: One Gate instance serves all servers
- **Simple scaling**: New servers automatically get routes added
- **Isolated access**: Players can only see/connect to servers they know about

## Troubleshooting

### Server Won't Start

1. Check operator logs: `kubectl logs -f deployment/operator -n minecraft-system`
2. Check pod events: `kubectl describe pod <server-name>-0 -n minecraft-servers`
3. Verify PVC bound: `kubectl get pvc -n minecraft-servers`

### Offline MOTD Not Showing

1. **Check hosts file entry exists**:
   - Windows: `C:\Windows\System32\drivers\etc\hosts`
   - Linux/Mac: `/etc/hosts`
   - Entry should map `{server-name}.local` to `127.0.0.1`

2. **Verify server address in Minecraft matches hosts file**:
   - Address should be `mc-{uuid12}.local:25565` (e.g., `mc-a78e5e3d10e3.local:25565`)

3. **Verify Gate proxy is running**:

   ```bash
   kubectl get pods -n minecraft-servers -l app=gate
   ```

4. **Check Gate logs for routing**:

   ```bash
   kubectl logs -n minecraft-servers deployment/gate --tail=50
   ```

5. **Ensure port forwarding is active**:

   ```bash
   kubectl port-forward -n minecraft-servers svc/gate 25565:25565
   ```

6. **Verify Gate config has correct routes**:

   ```bash
   kubectl get configmap gate-config -n minecraft-servers -o yaml
   # Should show routes for each server with host patterns like "mc-xxx.*"
   ```

7. **If seeing "No server found" MOTD**:
   - The hostname isn't matching any server route
   - Verify the server name exactly matches the route pattern
   - Check if the server was created after Gate config was last updated

### Auto-Stop Not Triggering

Auto-stop is **always enabled** with a fixed 2-minute idle timeout. This is not user-configurable.

1. Verify RCON connection (operator must connect to get player count)
2. Check `lastPlayerActivity` in server status:
   ```bash
   kubectl get mcserver <name> -n minecraft-servers -o yaml | grep lastPlayerActivity
   ```
3. Ensure server is actually running (auto-stop only applies to running servers)
4. Verify no players are connected: `kubectl logs deployment/operator -n minecraft-system | grep "player count"`

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

Player Management provides comprehensive tools for managing players including online player monitoring, whitelist/ban management, operator controls, and per-player actions. Inspired by Apex Hosting and Shockbyte's player management interfaces.

## Requirements Coverage

| Requirement | Description          | Priority | Status   |
| ----------- | -------------------- | -------- | -------- |
| FR-017      | Online players list  | P0       | Complete |
| FR-018      | Whitelist management | P0       | Complete |
| FR-019      | Ban management       | P0       | Complete |
| FR-020      | OP management        | P0       | Complete |
| FR-021      | Kick player          | P0       | Complete |
| FR-022      | Player data view     | P1       | Complete |

## Technical Architecture

### Data Flow

```
Frontend (React) → API Server (Express) → RCON → Minecraft Server
                                       ↓
                              K8sClient.executeCommand()
                                       ↓
                              RCON Pool → Pod Container
```

### How Player Data is Retrieved

Player data uses Minecraft's `/data get entity` command via RCON, NOT file-based NBT parsing:

```typescript
// api-server/src/index.ts:1104-1114
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
```

**Response Format from Minecraft**:

```
Player has the following entity data: 20.0f          // Health
Player has the following entity data: 18             // foodLevel
Player has the following entity data: [100.5d, 64.0d, -200.3d]  // Pos
Player has the following entity data: "minecraft:overworld"     // Dimension
Player has the following entity data: 0              // playerGameType
```

### NBT-like String Parsing

The API parses Minecraft's NBT-like text output:

```typescript
// api-server/src/index.ts:1131-1202
function parsePlayerDataFromFields(playerName: string, results: string[]): any {
  // Parse Health - format: "Player has the following entity data: 20.0f"
  const healthMatch = healthStr.match(/([\d.]+)f?$/);
  if (healthMatch) player.health = parseFloat(healthMatch[1]);

  // Parse Pos - format: "[123.0d, 64.0d, -456.0d]"
  const posMatch = posStr.match(/\[([-\d.]+)d?,\s*([-\d.]+)d?,\s*([-\d.]+)d?\]/);
  if (posMatch) {
    player.position = {
      x: parseFloat(posMatch[1]),
      y: parseFloat(posMatch[2]),
      z: parseFloat(posMatch[3]),
    };
  }

  // Parse Dimension - format: "minecraft:overworld"
  const dimMatch = dimStr.match(/"([^"]+)"$/);
  if (dimMatch) player.dimension = dimMatch[1].replace('minecraft:', '');
}
```

### Inventory Parsing

Inventory items are parsed from NBT array format:

```typescript
// api-server/src/index.ts:1503-1550
function parseInventoryItems(invString: string): any[] {
  // NBT format: {Slot: 0b, id: "minecraft:diamond_sword", count: 1, components: {...}}
  // Find balanced braces to extract each item
  let depth = 0;
  for (let i = 0; i < invString.length; i++) {
    if (invString[i] === '{') depth++;
    else if (invString[i] === '}') {
      depth--;
      if (depth === 0) {
        const item = parseInventoryItem(itemStr);
        items.push(item);
      }
    }
  }
}

function parseInventoryItem(itemStr: string): any {
  const slotMatch = itemStr.match(/Slot:\s*(-?\d+)b/);
  const idMatch = itemStr.match(/id:\s*"([^"]+)"/);
  const countMatch = itemStr.match(/(?:count|Count):\s*(\d+)/);
  // Extract enchantments from components
  // Extract custom_name, damage for durability display
}
```

## Features

### 1. Online Players List (P0)

**API Endpoint**: `GET /api/v1/servers/{name}/players`

**Implementation** (`api-server/src/index.ts:935-1051`):

1. Execute `list` RCON command
2. Parse response: `"There are X of a max of Y players online: player1, player2"`
3. For each player, fetch basic data (health, gamemode) with 5s timeout
4. Return aggregated player list

**List View Response** (optimized - only basic fields):

```json
{
  "online": 3,
  "max": 20,
  "players": [
    { "name": "Steve", "health": 20, "maxHealth": 20, "gameMode": 0, "gameModeName": "Survival" },
    { "name": "Alex", "health": 18, "maxHealth": 20, "gameMode": 1, "gameModeName": "Creative" }
  ]
}
```

### 2. Individual Player Detail (P1)

**API Endpoint**: `GET /api/v1/servers/{name}/players/{playerName}`

**Full Response**:

```json
{
  "name": "Steve",
  "health": 20,
  "maxHealth": 20,
  "foodLevel": 18,
  "foodSaturation": 5.0,
  "xpLevel": 15,
  "xpTotal": 352,
  "gameMode": 0,
  "gameModeName": "Survival",
  "position": { "x": 100.5, "y": 64, "z": -200.3 },
  "dimension": "overworld",
  "air": 300,
  "fire": -20,
  "onGround": true,
  "selectedSlot": 0,
  "inventory": [
    { "slot": 0, "id": "minecraft:diamond_sword", "count": 1, "damage": 50, "enchantments": { "sharpness": 5 } }
  ],
  "equipment": {
    "head": { "id": "minecraft:diamond_helmet", "count": 1, "damage": 100 },
    "chest": { "id": "minecraft:diamond_chestplate", "count": 1 },
    "legs": null,
    "feet": { "id": "minecraft:diamond_boots", "count": 1 },
    "offhand": { "id": "minecraft:shield", "count": 1 }
  },
  "enderItems": [...],
  "abilities": {
    "invulnerable": false,
    "mayFly": false,
    "flying": false,
    "instabuild": false
  }
}
```

### 3. Player Actions

| Action          | Minecraft Command                           | API Endpoint                   |
| --------------- | ------------------------------------------- | ------------------------------ |
| Change Gamemode | `gamemode <mode> <player>`                  | `POST /console` with command   |
| Heal            | `effect give <player> instant_health 1 100` | `POST /console` with command   |
| Feed            | `effect give <player> saturation 1 100`     | `POST /console` with command   |
| Clear Effects   | `effect clear <player>`                     | `POST /console` with command   |
| Kick            | `kick <player> [reason]`                    | `POST /{name}/kick`            |
| Ban             | `ban <player> [reason]`                     | `POST /{name}/bans`            |
| Unban           | `pardon <player>`                           | `DELETE /{name}/bans/{player}` |
| Grant Op        | `op <player>`                               | `POST /{name}/ops`             |
| Revoke Op       | `deop <player>`                             | `DELETE /{name}/ops/{player}`  |

### 4. Whitelist Management (P0)

**Minecraft Commands Used**:

| API Action | RCON Command              | Response Parsing                             |
| ---------- | ------------------------- | -------------------------------------------- |
| List       | `whitelist list`          | `"There are X whitelisted players: a, b, c"` |
| Add        | `whitelist add <player>`  | Success/failure message                      |
| Remove     | `whitelist remove <name>` | Success/failure message                      |
| Enable     | `whitelist on`            | Confirmation                                 |
| Disable    | `whitelist off`           | Confirmation                                 |

**API Endpoints**:

| Method   | Endpoint                                    | Description          |
| -------- | ------------------------------------------- | -------------------- |
| `GET`    | `/api/v1/servers/{name}/whitelist`          | Get whitelist status |
| `POST`   | `/api/v1/servers/{name}/whitelist`          | Add player           |
| `DELETE` | `/api/v1/servers/{name}/whitelist/{player}` | Remove player        |
| `PUT`    | `/api/v1/servers/{name}/whitelist/toggle`   | Enable/disable       |

### 5. Ban Management (P0)

**Minecraft Commands Used**:

| API Action | RCON Command            | Response Parsing                   |
| ---------- | ----------------------- | ---------------------------------- |
| List       | `banlist players`       | `"There are X ban(s): player1..."` |
| Ban        | `ban <player> [reason]` | Confirmation                       |
| Unban      | `pardon <player>`       | Confirmation                       |
| List IPs   | `banlist ips`           | `"There are X ban(s): ip1..."`     |
| Ban IP     | `ban-ip <ip> [reason]`  | Confirmation                       |
| Unban IP   | `pardon-ip <ip>`        | Confirmation                       |

**API Endpoints**:

| Method   | Endpoint                               | Description     |
| -------- | -------------------------------------- | --------------- |
| `GET`    | `/api/v1/servers/{name}/bans`          | Get ban list    |
| `POST`   | `/api/v1/servers/{name}/bans`          | Ban player      |
| `DELETE` | `/api/v1/servers/{name}/bans/{player}` | Unban player    |
| `GET`    | `/api/v1/servers/{name}/bans/ips`      | Get IP ban list |
| `POST`   | `/api/v1/servers/{name}/bans/ips`      | Ban IP          |
| `DELETE` | `/api/v1/servers/{name}/bans/ips/{ip}` | Unban IP        |

### 6. Operator Management (P0)

**Note**: Minecraft has no `op list` command. Ops are tracked locally in the frontend session.

| Method   | Endpoint                              | RCON Command    |
| -------- | ------------------------------------- | --------------- |
| `POST`   | `/api/v1/servers/{name}/ops`          | `op <player>`   |
| `DELETE` | `/api/v1/servers/{name}/ops/{player}` | `deop <player>` |

## Frontend Components

### PlayerManagement.tsx

**Purpose**: Tabbed interface for whitelist, ops, bans, IP bans management.

**State Management**:

```typescript
const [activeTab, setActiveTab] = useState<'whitelist' | 'ops' | 'bans' | 'ip-bans'>('whitelist');
const [whitelist, setWhitelist] = useState<WhitelistResponse | null>(null);
const [banList, setBanList] = useState<BanListResponse | null>(null);
const [ipBanList, setIpBanList] = useState<IpBanListResponse | null>(null);
const [opPlayers, setOpPlayers] = useState<string[]>([]); // Session-only tracking
```

**Features**:

- Tab navigation with icons (Shield, Crown, Ban, Globe)
- Add/remove forms with input validation
- Player avatars from `mc-heads.net/avatar/{name}/32`
- Kick modal with reason input
- Success/error notifications with auto-dismiss

### PlayerView.tsx

**Purpose**: Detailed Minecraft-style player profile with inventory visualization.

**Minecraft-Style UI Components**:

1. **Health Bar** - SVG hearts (full, half, empty):

```typescript
const HealthBar = ({ health, maxHealth }) => {
  const hearts = Math.ceil(maxHealth / 2); // 10 hearts for 20 HP
  const fullHearts = Math.floor(health / 2);
  const halfHeart = health % 2 === 1;
  // Render red heart SVGs
};
```

2. **Hunger Bar** - Drumstick icons:

```typescript
const HungerBar = ({ food }) => {
  const drumsticks = 10;
  const fullDrumsticks = Math.floor(food / 2);
  // Render orange drumstick SVGs (reversed order like Minecraft)
};
```

3. **XP Bar** - Green progress bar with level number:

```typescript
const XPBar = ({ level, total }) => {
  const xpForLevel = (lvl) => {
    if (lvl <= 16) return lvl * lvl + 6 * lvl;
    if (lvl <= 31) return 2.5 * lvl * lvl - 40.5 * lvl + 360;
    return 4.5 * lvl * lvl - 162.5 * lvl + 2220;
  };
  // Calculate progress to next level
};
```

4. **Inventory Grid** - 9x4 slot grid with hotbar highlighting:

```typescript
// Hotbar: slots 0-8 (highlighted, larger)
// Main inventory: slots 9-35 (3 rows of 9)
const InventorySlot = ({ item, slotNumber, isSelected }) => {
  // Purple border for enchanted items
  // Durability bar for damaged items
  // Stack count overlay
  // Hover tooltip with enchantments
};
```

5. **Equipment Panel** - Armor slots + offhand:

```typescript
const EquipmentSlot = ({ item, label }) => (
  // head, chest, legs, feet, offhand
  // With durability bars and enchantment glow
);
```

### Item Icon System

**Multi-CDN Fallback** (`PlayerView.tsx:48-78`):

```typescript
const getItemIconUrl = (itemId: string): string => {
  const cleanId = itemId.replace('minecraft:', '');
  return `https://minecraft-api.vercel.app/images/items/${cleanId}.png`;
};

const getAlternativeIconUrls = (itemId: string): string[] => [
  `https://minecraft-api.vercel.app/images/blocks/${cleanId}.png`,
  `https://mc.nerothe.com/img/1.21.1/${cleanId}.png`,
  `https://minecraft.wiki/images/${wikiName}_JE1_BE1.png`,
  // ... more fallbacks
  `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures/item/${cleanId}.png`,
];
```

**Fallback Behavior**:

1. Try primary CDN
2. On error, try next URL in fallback list
3. Cache failed item IDs to avoid retry
4. Final fallback: styled div with item initials

**Durability Database** (`PlayerView.tsx:153-204`):

```typescript
const getMaxDurability = (itemId: string): number => {
  const durabilities: Record<string, number> = {
    'minecraft:diamond_sword': 1561,
    'minecraft:netherite_pickaxe': 2031,
    // ... complete durability table
  };
  return durabilities[itemId] || 0;
};
```

## URL Routes

| Route                            | View                     |
| -------------------------------- | ------------------------ |
| `/servers/:name/players`         | Online players list      |
| `/servers/:name/players/:player` | Individual player detail |
| `/servers/:name/management`      | Player management tabs   |

## Key Files

| File                                | Purpose                                 |
| ----------------------------------- | --------------------------------------- |
| `frontend/src/PlayerView.tsx`       | Player detail with inventory (1135 LOC) |
| `frontend/src/PlayerManagement.tsx` | Whitelist/ban/op tabs (751 LOC)         |
| `frontend/src/api.ts`               | API client functions                    |
| `api-server/src/index.ts:935-1994`  | All player management endpoints         |

## Troubleshooting

### Player Data Not Loading

1. Verify player is online: `list` command in console
2. Check RCON connection is working
3. Verify 10s timeout isn't being hit (slow server)
4. Check API server logs for parsing errors

### Item Icons Not Displaying

1. Primary CDN may be down - fallbacks should work
2. New 1.21+ items may not be in CDN yet
3. Check browser console for 404 errors on specific items

### Whitelist/Ban Changes Not Persisting

1. These use Minecraft's built-in persistence
2. Changes are written to `whitelist.json` and `banned-players.json`
3. Verify server has write permissions to these files

### Op List Always Empty

This is expected - Minecraft has no `op list` command. The frontend tracks ops granted in the current session only. For persistent op management, use server configuration files.

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
- `tab`: Active tab (overview, console, players, management, backups, config)
- `name`: Player name (for player detail view)

---

# 2.1 Backup System

**Status**: COMPLETE
**Related Requirements**: FR-023 to FR-028
**Last Updated**: 2025-12-12

## Overview

Backup System provides comprehensive backup management including manual one-click backups, automatic scheduled backups, backup restoration, and backup downloads. Inspired by Shockbyte and Apex Hosting backup interfaces.

## Requirements Coverage

| Requirement | Description             | Priority | Status   |
| ----------- | ----------------------- | -------- | -------- |
| FR-023      | Manual backup creation  | P0       | Complete |
| FR-024      | Backup restore          | P0       | Complete |
| FR-025      | Automatic backups       | P1       | Complete |
| FR-026      | Backup retention policy | P1       | Complete |
| FR-027      | Backup download         | P1       | Complete |
| FR-028      | Incremental backups     | P2       | Planned  |

## Technical Architecture

### Backend Service

**File**: `api-server/src/services/backup-service.ts`

```typescript
export class BackupService {
  private backups: Map<string, BackupSnapshot> = new Map();
  private schedules: Map<string, BackupSchedule> = new Map();
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;

  // Create a backup using Kubernetes Jobs
  async createBackup(options: BackupOptions): Promise<BackupSnapshot>;

  // List backups for a server
  listBackups(serverId?: string): BackupSnapshot[];

  // Restore from a backup
  async restoreBackup(backupId: string): Promise<void>;

  // Schedule management
  getSchedule(serverId: string): BackupSchedule | undefined;
  setSchedule(serverId: string, config: ScheduleConfig): BackupSchedule;
  startScheduler(): void;
  stopScheduler(): void;
}
```

### Backup Data Model

```typescript
interface BackupSnapshot {
  id: string;
  serverId: string;
  tenantId: string;
  name: string;
  description?: string;
  sizeBytes: number;
  compressionFormat: 'gzip';
  storagePath: string;
  checksum: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  minecraftVersion: string;
  worldSize: number;
  isAutomatic: boolean;
  tags: string[];
  errorMessage?: string;
}

interface BackupSchedule {
  serverId: string;
  enabled: boolean;
  intervalHours: number; // 1, 6, 12, 24, 48, 168
  retentionCount: number; // 3, 5, 7, 14, 30
  lastBackupAt?: Date;
  nextBackupAt?: Date;
}
```

### Kubernetes Job-Based Backups

Backups are executed as Kubernetes Jobs that:

1. Mount the server's PVC as read-only
2. Mount the shared backup storage PVC
3. Create a gzip-compressed tarball of `/data`
4. Store with naming pattern `{serverId}-{backupId}.tar.gz`

```typescript
const backupFilename = `${backup.serverId}-${backup.id}.tar.gz`;

const job: k8s.V1Job = {
  metadata: {
    name: `backup-${serverId}-${backupId.slice(0, 8)}`,
    labels: {
      app: 'minecraft-backup',
      'backup-id': backupId,
      'server-id': serverId,
    },
  },
  spec: {
    ttlSecondsAfterFinished: 3600,
    template: {
      spec: {
        restartPolicy: 'Never',
        containers: [
          {
            name: 'backup',
            image: 'alpine:latest',
            command: [
              '/bin/sh',
              '-c',
              [
                `echo "Starting backup for ${serverId}..."`,
                `tar -czf /backups/${backupFilename} -C /data .`,
                `ls -lh /backups/${backupFilename}`,
                `echo "Backup complete: ${backupFilename}"`,
              ].join(' && '),
            ],
            volumeMounts: [
              { name: 'minecraft-data', mountPath: '/data', readOnly: true },
              { name: 'backup-storage', mountPath: '/backups' },
            ],
          },
        ],
        volumes: [
          {
            name: 'minecraft-data',
            persistentVolumeClaim: {
              // StatefulSet PVC naming: <volumeClaimTemplate>-<pod-name>
              claimName: `minecraft-data-${serverId}-0`,
            },
          },
          {
            name: 'backup-storage',
            persistentVolumeClaim: {
              claimName: 'minecraft-backups',
            },
          },
        ],
      },
    },
  },
};
```

### Backup Storage Infrastructure

Backups are stored in a dedicated PVC and served via an nginx file server.

**Manifest**: `k8s/manifests/dev/backup-server.yaml`

```yaml
# PVC for storing all backup files
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: minecraft-backups
  namespace: minecraft-servers
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
---
# Nginx file server for backup downloads
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backup-server
  namespace: minecraft-servers
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backup-server
  template:
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          ports:
            - containerPort: 80
          volumeMounts:
            - name: backups
              mountPath: /usr/share/nginx/html
              readOnly: true
      volumes:
        - name: backups
          persistentVolumeClaim:
            claimName: minecraft-backups
---
apiVersion: v1
kind: Service
metadata:
  name: backup-server
  namespace: minecraft-servers
spec:
  selector:
    app: backup-server
  ports:
    - port: 80
      targetPort: 80
```

### Download Flow

The API server proxies backup downloads from the backup-server:

```typescript
// GET /api/v1/backups/:backupId/download
const backupFilename = `${backup.serverId}-${backup.id}.tar.gz`;

// BACKUP_SERVER_URL configurable via environment:
// - In-cluster: http://backup-server.minecraft-servers.svc.cluster.local
// - Local dev: http://127.0.0.1:9090 (via port-forward)
const backupServerUrl = process.env.BACKUP_SERVER_URL || 'http://192.168.49.2:30090';

// Fetch and buffer the backup file
const response = await fetch(`${backupServerUrl}/${backupFilename}`);

// Send to client with download headers
res.setHeader('Content-Type', 'application/gzip');
res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
const buffer = await response.arrayBuffer();
res.send(Buffer.from(buffer));
```

**Frontend Download**: The frontend opens downloads directly to the API server (port 8080) to bypass Vite proxy buffering issues with large files:

```typescript
// Opens download in new window, bypassing Vite proxy
window.open(`http://localhost:8080/api/v1/backups/${backup.id}/download`, '_blank');
```

## API Endpoints

### Backup Operations

| Method   | Endpoint                              | Description          |
| -------- | ------------------------------------- | -------------------- |
| `POST`   | `/api/v1/servers/{name}/backups`      | Create a backup      |
| `GET`    | `/api/v1/servers/{name}/backups`      | List server backups  |
| `GET`    | `/api/v1/backups/{backupId}`          | Get backup details   |
| `DELETE` | `/api/v1/backups/{backupId}`          | Delete a backup      |
| `POST`   | `/api/v1/backups/{backupId}/restore`  | Restore from backup  |
| `GET`    | `/api/v1/backups/{backupId}/download` | Download backup file |

### Schedule Operations

| Method | Endpoint                                  | Description         |
| ------ | ----------------------------------------- | ------------------- |
| `GET`  | `/api/v1/servers/{name}/backups/schedule` | Get backup schedule |
| `PUT`  | `/api/v1/servers/{name}/backups/schedule` | Set backup schedule |

### Request/Response Examples

**Create Backup**:

```json
// POST /api/v1/servers/my-server/backups
{
  "name": "pre-update-backup",
  "description": "Backup before installing mods",
  "tags": ["pre-update"]
}

// Response
{
  "message": "Backup creation initiated",
  "backup": {
    "id": "abc123",
    "serverId": "my-server",
    "name": "pre-update-backup",
    "status": "pending",
    "startedAt": "2025-12-12T10:00:00Z"
  }
}
```

**Set Schedule**:

```json
// PUT /api/v1/servers/my-server/backups/schedule
{
  "enabled": true,
  "intervalHours": 24,
  "retentionCount": 7
}

// Response
{
  "message": "Backup schedule enabled",
  "schedule": {
    "serverId": "my-server",
    "enabled": true,
    "intervalHours": 24,
    "retentionCount": 7,
    "nextBackupAt": "2025-12-13T10:00:00Z"
  }
}
```

## Frontend Component

**File**: `frontend/src/BackupManager.tsx` (742 LOC)

### Features

1. **Backup List Table**
   - Name, status, size, created date, type columns
   - Status badges (pending, in_progress, completed, failed)
   - Actions: restore, download, delete

2. **Create Backup Modal**
   - Optional name and description
   - Info note about server pause

3. **Schedule Settings Modal**
   - Enable/disable toggle
   - Interval selection (hourly to weekly)
   - Retention count (3-30 backups)
   - Next backup time display

4. **Confirmation Dialogs**
   - Restore confirmation with warning
   - Delete confirmation

### State Management

```typescript
// Backups state
const [backups, setBackups] = useState<Backup[]>([]);
const [loading, setLoading] = useState(true);

// Schedule state
const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
const [scheduleEnabled, setScheduleEnabled] = useState(false);
const [scheduleInterval, setScheduleInterval] = useState(24);
const [scheduleRetention, setScheduleRetention] = useState(7);

// Modals
const [showCreateModal, setShowCreateModal] = useState(false);
const [showScheduleModal, setShowScheduleModal] = useState(false);
const [confirmAction, setConfirmAction] = useState<{
  type: 'restore' | 'delete';
  backup: Backup;
} | null>(null);
```

### Auto-Refresh

Backups are polled every 3-5 seconds when there are pending/in_progress backups:

```typescript
useEffect(() => {
  if (backups.some((b) => b.status === 'pending' || b.status === 'in_progress')) {
    const interval = setInterval(fetchBackups, 3000);
    return () => clearInterval(interval);
  }
}, [backups]);
```

## Auto-Backup Scheduler

The BackupService includes a scheduler that:

1. Checks every minute for due backups
2. Creates automatic backups when scheduled
3. Applies retention policy after each backup
4. Deletes old backups beyond retention count

```typescript
// Scheduler started at server startup
backupService.startScheduler();

// Check every minute
this.schedulerInterval = setInterval(() => {
  this.checkScheduledBackups();
}, 60000);

// Apply retention policy
private async applyRetentionPolicy(serverId: string, retentionCount: number) {
  const autoBackups = this.listBackups(serverId)
    .filter(b => b.isAutomatic && b.status === 'completed')
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const toDelete = autoBackups.slice(retentionCount);
  for (const backup of toDelete) {
    await this.deleteBackup(backup.id);
  }
}
```

## URL Route

| Route                    | View           |
| ------------------------ | -------------- |
| `/servers/:name/backups` | Backup manager |

## Key Files

| File                                        | Purpose                          |
| ------------------------------------------- | -------------------------------- |
| `api-server/src/services/backup-service.ts` | Backup logic and scheduling      |
| `api-server/src/index.ts`                   | Backup API endpoints             |
| `frontend/src/BackupManager.tsx`            | Backup UI component              |
| `frontend/src/api.ts`                       | Backup API client functions      |
| `k8s/manifests/dev/backup-server.yaml`      | Backup storage PVC & file server |

## UI Components

### Header Bar

- Title with backup count
- Auto-backup status badge (when enabled)
- Refresh button
- Schedule button
- Create Backup button

### Backup Table Columns

| Column  | Content                                |
| ------- | -------------------------------------- |
| Name    | Backup name + description              |
| Status  | Badge with icon (spinner for progress) |
| Size    | Human-readable size (e.g., "1.2 GB")   |
| Created | Relative time (e.g., "2h ago")         |
| Type    | "Auto" or "Manual" badge               |
| Actions | Restore, Download, Delete buttons      |

### Schedule Options

| Interval       | Hours |
| -------------- | ----- |
| Every hour     | 1     |
| Every 6 hours  | 6     |
| Every 12 hours | 12    |
| Daily          | 24    |
| Every 2 days   | 48    |
| Weekly         | 168   |

| Retention  | Count |
| ---------- | ----- |
| 3 backups  | 3     |
| 5 backups  | 5     |
| 7 backups  | 7     |
| 14 backups | 14    |
| 30 backups | 30    |

## Troubleshooting

### Backup Stuck in "Pending"

1. Check if `runBackupJob` is starting: Look for `[BackupService] runBackupJob started` in API logs
2. If no log appears, the async job may have failed silently
3. Check API server for errors during backup creation

### Backup Stuck in "In Progress"

1. Check Kubernetes job status: `kubectl get jobs -n minecraft-servers -l app=minecraft-backup`
2. Check job pod status: `kubectl get pods -n minecraft-servers -l app=minecraft-backup`
3. Check job logs: `kubectl logs job/backup-<server>-<id> -n minecraft-servers`
4. Common issues:
   - PVC not found: Verify PVC name matches `minecraft-data-<server>-0`
   - Pod pending: Check if backup-storage PVC exists
   - Timeout: Job has 5 minute max wait time

### Download Returns 404 or Empty File

1. Check backup-server is running: `kubectl get pods -n minecraft-servers -l app=backup-server`
2. Verify backup file exists via HTTP: `curl http://127.0.0.1:9090/` (lists files as JSON)
3. Check API server logs for proxy errors
4. Verify backup status is "completed" before downloading
5. For local dev, ensure port-forward is running: `kubectl port-forward -n minecraft-servers svc/backup-server 9090:80`
6. Verify `BACKUP_SERVER_URL=http://127.0.0.1:9090` is set in `api-server/.env`

### Backup Pod Stuck in Pending

1. Check pod events: `kubectl describe pod <backup-pod> -n minecraft-servers`
2. Common causes:
   - `minecraft-backups` PVC not created
   - Source PVC name mismatch (should be `minecraft-data-<server>-0`)
   - Node resource constraints

### Auto-Backups Not Running

1. Verify schedule is enabled: Check "Auto" badge in header
2. Check API server logs for `[BackupService] Running scheduled backup`
3. Verify server is running (backups require running server)
4. Check scheduler started: Look for `[BackupService] Starting auto-backup scheduler`

### Retention Policy Not Deleting Old Backups

1. Only automatic backups are subject to retention
2. Manual backups are never auto-deleted
3. Check if backups are marked as `isAutomatic: true`
4. Verify retention count in schedule settings
