# UUID-Based Server Identification

## Overview

The Minecraft Hosting Platform uses UUID-based server identification to uniquely identify servers across the system. This prevents naming collisions between users and enables stable server references even if display names change.

## Architecture

### Server Identifiers

Each server has three identifiers:

| Identifier    | Format        | Purpose                              | Example                                |
| ------------- | ------------- | ------------------------------------ | -------------------------------------- |
| `id` (UUID)   | UUIDv4        | Primary identifier used in API calls | `550e8400-e29b-41d4-a716-446655440000` |
| `name`        | `mc-{uuid12}` | Kubernetes resource name             | `mc-550e8400e29b`                      |
| `displayName` | User string   | User-friendly name shown in UI       | `My Survival Server`                   |

### UUID Format

- Full UUID stored in `spec.serverId` of MinecraftServer CRD
- K8s resource name: `mc-` prefix + first 12 hex chars of UUID (dashes removed)
- Example: UUID `550e8400-e29b-41d4-a716-446655440000` becomes K8s name `mc-550e8400e29b`

### Why Remove Dashes?

K8s resource names have a 63-character limit. By removing dashes, we maximize uniqueness:

- With dashes: 11 hex digits + 1 dash = ~44 bits of entropy
- Without dashes: 12 hex digits = 48 bits = ~281 trillion unique combinations

## Data Flow

### Server Creation

```
1. User submits: { name: "My Server" }
2. API Server generates: serverId = uuidv4()
3. K8s resource created with:
   - metadata.name = "mc-" + serverId.replace(/-/g,'').substring(0,12)
   - spec.serverId = serverId
   - spec.displayName = "My Server"
4. Response includes: { id: serverId, name: "mc-xxx", displayName: "My Server" }
```

### Server Lookup

```
Frontend                    API Server                  Kubernetes
   |                            |                           |
   | GET /servers/{uuid}        |                           |
   |--------------------------->|                           |
   |                            | List MinecraftServers     |
   |                            | where spec.serverId=uuid  |
   |                            |-------------------------->|
   |                            |                           |
   |                            |<-- MinecraftServer -------|
   |                            |                           |
   |<-- { id, name, display }---|                           |
```

## API Routes

All server-specific API routes use UUID:

```
GET    /api/v1/servers/:id
DELETE /api/v1/servers/:id
PATCH  /api/v1/servers/:id
POST   /api/v1/servers/:id/start
POST   /api/v1/servers/:id/stop
GET    /api/v1/servers/:id/logs
POST   /api/v1/servers/:id/console
GET    /api/v1/servers/:id/players
GET    /api/v1/servers/:id/backups
...
```

## Frontend Routes

React Router routes use `serverId` param:

```tsx
<Route path="/servers/:serverId" element={<ServerDetail />} />
<Route path="/servers/:serverId/:tab" element={<ServerDetail />} />
<Route path="/servers/:serverId/players/:playerName" element={<ServerDetail />} />
```

## Key Files

| Layer    | File                                           | Purpose                                     |
| -------- | ---------------------------------------------- | ------------------------------------------- |
| CRD      | `k8s/operator/api/v1/minecraftserver_types.go` | DisplayName field in spec                   |
| API      | `api-server/src/k8s-client.ts`                 | UUID generation, `getMinecraftServerById()` |
| API      | `api-server/src/index.ts`                      | Routes using `:id` param                    |
| Frontend | `frontend/src/types.ts`                        | Server type with `id`, `displayName`        |
| Frontend | `frontend/src/api.ts`                          | All functions use `serverId`                |
| Frontend | `frontend/src/App.tsx`                         | Routes with `:serverId`                     |
| Frontend | `frontend/src/useWebSocket.ts`                 | Match servers by `id`                       |

## Implementation Details

### Kubernetes Client (k8s-client.ts)

```typescript
// Create server with UUID
async createMinecraftServer(displayName: string, spec: Partial<MinecraftServerSpec>) {
  const serverId = uuidv4();
  const resourceName = 'mc-' + serverId.replace(/-/g, '').substring(0, 12);

  const server = {
    metadata: { name: resourceName },
    spec: {
      serverId,
      displayName,
      ...spec
    }
  };

  return k8sApi.createNamespacedCustomObject(..., server);
}

// Lookup by UUID
async getMinecraftServerById(serverId: string): Promise<MinecraftServer | null> {
  const servers = await this.listMinecraftServers();
  return servers.find(s => s.serverId === serverId) || null;
}
```

### API Route Handler Pattern

```typescript
app.post('/api/v1/servers/:id/stop', requireAuth, async (req, res) => {
  const { id } = req.params;

  // Get server by UUID
  const server = await verifyServerOwnership(req, res, id);
  if (!server) return;

  // Use K8s resource name for operations
  await k8sClient.stopServer(server.name);

  // Use displayName for user messages
  res.json({ message: `Server '${server.displayName}' stop initiated` });
});
```

### Frontend Component Pattern

```tsx
function ServerList() {
  return servers.map((server) => (
    <ServerCard
      key={server.id} // UUID as React key
      title={server.displayName} // Show friendly name
      onClick={() => navigate(`/servers/${server.id}`)} // Route by UUID
    />
  ));
}
```

## Migration Notes

### New Installations

No action required - servers automatically get UUIDs on creation.

### Existing Servers

To migrate existing name-based servers:

1. Stop the server
2. Export server data and world
3. Delete old MinecraftServer CRD
4. Create new server (gets UUID)
5. Restore world data to new server

## Security Considerations

- UUIDs are non-guessable, preventing enumeration attacks
- Server ownership verified by matching `tenantId` with JWT claims
- K8s resource names are internal-only (not exposed to users)

## Related Documentation

- [Multi-Tenancy Architecture](./MULTI_TENANCY.md)
- [API Reference](../api/API_REFERENCE.md)
- [Kubernetes CRD Specification](../api/CRD_SPEC.md)
