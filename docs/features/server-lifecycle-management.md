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
cd k8s/operator && RCON_PASSWORD=changeme ./bin/operator.exe

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
