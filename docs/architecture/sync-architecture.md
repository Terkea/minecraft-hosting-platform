# Event-Driven Sync Architecture

## Overview

The Minecraft Platform uses an event-driven architecture to keep the database, Kubernetes, and frontend in sync at all times. This design ensures:

- **Real-time synchronization** - State changes propagate immediately
- **Scalability** - Can handle thousands of servers
- **Maintainability** - Clear separation of concerns
- **Fault tolerance** - Automatic reconciliation on failures

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Frontend (Svelte)                                  │
│                                                                               │
│   ┌─────────────┐     WebSocket     ┌────────────────────────────────────┐   │
│   │  Dashboard  │◄──────────────────│  Real-time Status & Metrics        │   │
│   └─────────────┘                   └────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
                                         ▲
                                         │ WebSocket
                                         │
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Backend API (Go/Gin)                                 │
│                                                                               │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐   │
│   │ REST API    │     │ WebSocket   │     │      Sync Service           │   │
│   │ Handlers    │     │ Manager     │◄────│  - Subscribes to K8s events │   │
│   └──────┬──────┘     └─────────────┘     │  - Updates DB state         │   │
│          │                    ▲           │  - Broadcasts to WS         │   │
│          │                    │           └──────────────┬──────────────┘   │
│          ▼                    │                          │                   │
│   ┌─────────────┐            │                          │                   │
│   │ Event Bus   │────────────┴──────────────────────────┘                   │
│   │ Publisher   │                                                            │
│   └──────┬──────┘                                                            │
└──────────┼───────────────────────────────────────────────────────────────────┘
           │
           │ NATS JetStream
           │
┌──────────▼───────────────────────────────────────────────────────────────────┐
│                          NATS Message Bus                                     │
│                                                                               │
│   Subjects:                                                                   │
│   - server.created      - Server creation requested                          │
│   - server.updated      - Server config changed                              │
│   - server.deleted      - Server deletion requested                          │
│   - k8s.starting        - K8s pod starting                                   │
│   - k8s.running         - K8s pod running/ready                              │
│   - k8s.stopped         - K8s pod stopped                                    │
│   - k8s.error           - K8s pod error                                      │
│   - sync.required       - Reconciliation needed                              │
└──────────▲───────────────────────────────────────────────────────────────────┘
           │
           │ NATS JetStream
           │
┌──────────┴───────────────────────────────────────────────────────────────────┐
│                        Kubernetes Operator                                    │
│                                                                               │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐   │
│   │ Reconciler  │────▶│  K8s API    │     │    Event Publisher          │   │
│   │             │     │  Server     │────▶│  - Publishes state changes  │   │
│   └─────────────┘     └─────────────┘     │  - Sends on phase change    │   │
│          │                                 └─────────────────────────────┘   │
│          ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Manages: StatefulSets, Services, ConfigMaps, PVCs                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Kubernetes Cluster                                   │
│                                                                               │
│   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│   │ MC Server Pod  │  │ MC Server Pod  │  │ MC Server Pod  │  ...            │
│   │ (StatefulSet)  │  │ (StatefulSet)  │  │ (StatefulSet)  │                 │
│   └────────────────┘  └────────────────┘  └────────────────┘                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Server Creation Flow

```
User Request → API → DB (deploying) → Event → Operator → K8s → Event → DB (running) → WebSocket → Frontend
```

1. User requests server creation via REST API
2. API creates record in DB with status `deploying`
3. API publishes `server.created` event to NATS
4. Operator receives event, creates MinecraftServer CR
5. Operator creates StatefulSet, Service, ConfigMap
6. Operator watches pod status
7. When pod ready, operator publishes `k8s.running` event
8. Sync service receives event, updates DB to `running`
9. WebSocket broadcasts status to connected clients
10. Frontend displays server as running

### 2. Server Status Sync Flow

```
K8s Pod → Operator → Event → Sync Service → DB → WebSocket → Frontend
```

1. Kubernetes pod state changes (startup, crash, etc.)
2. Operator's reconciler detects change
3. Operator publishes state event to NATS
4. Sync service subscribes, receives event
5. Sync service updates database
6. WebSocket manager broadcasts to connected clients
7. Frontend receives real-time update

### 3. Reconciliation Flow

```
Sync Service (periodic) → Compare DB vs Cache → Detect Drift → Request Sync → Resolve
```

1. Sync service runs periodic reconciliation (every 30s)
2. Compares cached K8s state with DB state
3. If drift detected, requests sync from operator
4. Operator re-publishes current state
5. Database updated to match K8s reality

## Components

### Event Bus (`backend/src/events/event_bus.go`)

- NATS JetStream connection for durable messaging
- Publish/Subscribe pattern for events
- Message retention for 24 hours
- Automatic reconnection

### Sync Service (`backend/src/sync/sync_service.go`)

- Subscribes to K8s state events from operator
- Updates database when K8s state changes
- Maintains in-memory cache for quick lookups
- Periodic reconciliation to detect drift
- Broadcasts changes to WebSocket clients

### Event Publisher (`k8s/operator/pkg/events/publisher.go`)

- Operator-side NATS client
- Publishes state changes when phase changes
- Includes metadata (IP, port, player count)
- Graceful degradation if NATS unavailable

### WebSocket Manager (`backend/src/api/websocket.go`)

- Manages client connections per tenant/server
- Broadcasts real-time updates
- Supports subscriptions to specific servers
- Streams metrics every 30 seconds

## Event Types

| Event                   | Source       | Purpose                     |
| ----------------------- | ------------ | --------------------------- |
| `server.created`        | API          | New server requested        |
| `server.updated`        | API          | Server config changed       |
| `server.deleted`        | API          | Server deletion requested   |
| `server.status.changed` | API          | Status transition requested |
| `k8s.starting`          | Operator     | Pod is starting             |
| `k8s.running`           | Operator     | Pod is ready                |
| `k8s.stopped`           | Operator     | Pod is stopped              |
| `k8s.error`             | Operator     | Pod has error               |
| `sync.required`         | Sync Service | Reconciliation needed       |
| `sync.complete`         | Sync Service | Reconciliation done         |

## State Mapping

| K8s Phase    | DB Status   | Description                           |
| ------------ | ----------- | ------------------------------------- |
| Starting     | deploying   | Server is starting up                 |
| Running      | running     | Server is ready and accepting players |
| Stopped      | stopped     | Server is intentionally stopped       |
| Error/Failed | failed      | Server has encountered an error       |
| -            | terminating | Server is being deleted               |

## Fault Tolerance

### NATS Unavailable

- Operator continues to work, just without publishing
- Sync service falls back to periodic polling
- System eventually consistent

### Database Unavailable

- API returns errors to clients
- Sync service queues updates
- Resync on reconnection

### Pod Crashes

- Kubernetes restarts automatically
- Operator detects new state
- Event published, DB updated
- Frontend shows current state

## Configuration

### Environment Variables

```bash
# Backend API
DATABASE_URL=postgres://root@cockroachdb:26257/minecraft_platform?sslmode=disable
NATS_URL=nats://nats:4222

# Operator
NATS_URL=nats://nats.minecraft-system:4222
ENABLE_EVENTS=true
```

## Scaling Considerations

### Multiple API Instances

- All instances subscribe to same NATS subjects
- Load balanced WebSocket connections
- Sticky sessions recommended for WS

### Multiple Operators

- Use leader election
- Only leader publishes events
- Prevents duplicate events

### High Volume Events

- NATS JetStream handles backpressure
- Message deduplication by ID
- Consumer groups for load distribution
