<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';

  // Types
  interface Server {
    id: string;
    name: string;
    status: 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
    playerCount: number;
    maxPlayers: number;
    version: string;
    externalIP?: string;
    port?: number;
    lastUpdated: string;
    resources?: {
      cpu: string;
      memory: string;
      storage: string;
    };
  }

  interface MetricsData {
    cpu_usage: number;
    memory_usage: number;
    player_count: number;
    tps: number;
    timestamp: string;
  }

  // Props
  export let tenantId: string = 'default-tenant';

  // State
  let servers = writable<Server[]>([]);
  let selectedServer = writable<Server | null>(null);
  let metrics = writable<{[serverId: string]: MetricsData}>({});
  let loading = writable(true);
  let error = writable<string | null>(null);
  let wsConnection: WebSocket | null = null;

  // UI State
  let showCreateModal = false;
  let showConfigModal = false;
  let newServerForm = {
    name: '',
    version: '1.20.1',
    maxPlayers: 20,
    gamemode: 'survival',
    difficulty: 'normal',
    memory: '2G',
    cpuLimit: '1000m',
    memoryLimit: '2Gi',
    storage: '10Gi'
  };

  // WebSocket Management
  function connectWebSocket() {
    const wsUrl = `ws://localhost:8080/ws?tenant_id=${tenantId}`;
    wsConnection = new WebSocket(wsUrl);

    wsConnection.onopen = () => {
      console.log('WebSocket connected');
      // Subscribe to all server updates
      wsConnection?.send(JSON.stringify({
        type: 'all',
        server_id: ''
      }));
    };

    wsConnection.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    };

    wsConnection.onclose = () => {
      console.log('WebSocket disconnected, attempting to reconnect...');
      setTimeout(connectWebSocket, 3000);
    };

    wsConnection.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  function handleWebSocketMessage(message: any) {
    switch (message.type) {
      case 'server_status_update':
        updateServerStatus(message.server_id, message.data);
        break;
      case 'metrics_update':
        updateServerMetrics(message.server_id, message.data);
        break;
      case 'subscription_confirmed':
        console.log('Subscription confirmed:', message.data);
        break;
    }
  }

  function updateServerStatus(serverId: string, data: any) {
    servers.update(serverList => {
      const index = serverList.findIndex(s => s.id === serverId);
      if (index >= 0) {
        serverList[index] = {
          ...serverList[index],
          status: data.status,
          lastUpdated: new Date().toISOString(),
          ...data.metadata
        };
      }
      return serverList;
    });
  }

  function updateServerMetrics(serverId: string, data: MetricsData) {
    metrics.update(metricsData => {
      metricsData[serverId] = data;
      return metricsData;
    });

    // Update server player count from metrics
    servers.update(serverList => {
      const index = serverList.findIndex(s => s.id === serverId);
      if (index >= 0) {
        serverList[index].playerCount = data.player_count;
      }
      return serverList;
    });
  }

  // API Functions
  async function fetchServers() {
    try {
      loading.set(true);
      const response = await fetch('/api/servers', {
        headers: {
          'X-Tenant-ID': tenantId
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      servers.set(data.servers || []);
      error.set(null);
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to fetch servers');
      console.error('Error fetching servers:', err);
    } finally {
      loading.set(false);
    }
  }

  async function createServer() {
    try {
      const response = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({
          name: newServerForm.name,
          version: newServerForm.version,
          config: {
            maxPlayers: newServerForm.maxPlayers,
            gamemode: newServerForm.gamemode,
            difficulty: newServerForm.difficulty
          },
          resources: {
            memory: newServerForm.memory,
            cpuLimit: newServerForm.cpuLimit,
            memoryLimit: newServerForm.memoryLimit,
            storage: newServerForm.storage
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create server: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Server creation initiated:', result);

      // Reset form and close modal
      newServerForm = {
        name: '',
        version: '1.20.1',
        maxPlayers: 20,
        gamemode: 'survival',
        difficulty: 'normal',
        memory: '2G',
        cpuLimit: '1000m',
        memoryLimit: '2Gi',
        storage: '10Gi'
      };
      showCreateModal = false;

      // Refresh server list
      await fetchServers();
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to create server');
    }
  }

  async function deleteServer(serverId: string) {
    if (!confirm('Are you sure you want to delete this server? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/servers/${serverId}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': tenantId
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to delete server: ${response.statusText}`);
      }

      // Refresh server list
      await fetchServers();
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to delete server');
    }
  }

  // Utility Functions
  function getStatusColor(status: string): string {
    switch (status) {
      case 'running': return 'text-green-600 bg-green-100';
      case 'starting': case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'stopping': return 'text-orange-600 bg-orange-100';
      case 'stopped': return 'text-gray-600 bg-gray-100';
      case 'error': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  }

  function formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  // Lifecycle
  onMount(() => {
    fetchServers();
    connectWebSocket();
  });

  onDestroy(() => {
    if (wsConnection) {
      wsConnection.close();
    }
  });
</script>

<div class="server-dashboard p-6 bg-gray-50 min-h-screen">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-3xl font-bold text-gray-900">Server Dashboard</h1>
      <p class="text-gray-600 mt-1">Manage your Minecraft servers</p>
    </div>
    <button
      on:click={() => showCreateModal = true}
      class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
    >
      Create New Server
    </button>
  </div>

  <!-- Error Display -->
  {#if $error}
    <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
      <strong>Error:</strong> {$error}
      <button on:click={() => error.set(null)} class="float-right text-red-500">×</button>
    </div>
  {/if}

  <!-- Loading State -->
  {#if $loading}
    <div class="flex justify-center items-center py-12">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      <span class="ml-3 text-gray-600">Loading servers...</span>
    </div>
  {:else}
    <!-- Server Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each $servers as server (server.id)}
        <div class="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
          <!-- Server Header -->
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-xl font-semibold text-gray-900">{server.name}</h3>
            <span class="px-3 py-1 rounded-full text-sm font-medium {getStatusColor(server.status)}">
              {server.status.toUpperCase()}
            </span>
          </div>

          <!-- Server Info -->
          <div class="space-y-3">
            <div class="flex justify-between">
              <span class="text-gray-600">Version:</span>
              <span class="font-medium">{server.version}</span>
            </div>

            <div class="flex justify-between">
              <span class="text-gray-600">Players:</span>
              <span class="font-medium">{server.playerCount}/{server.maxPlayers}</span>
            </div>

            {#if server.externalIP}
              <div class="flex justify-between">
                <span class="text-gray-600">Address:</span>
                <span class="font-mono text-sm">{server.externalIP}:{server.port || 25565}</span>
              </div>
            {/if}

            <div class="text-sm text-gray-500">
              Updated: {formatTimestamp(server.lastUpdated)}
            </div>
          </div>

          <!-- Metrics (if available) -->
          {#if $metrics[server.id]}
            <div class="mt-4 p-3 bg-gray-50 rounded">
              <h4 class="font-medium text-gray-700 mb-2">Performance</h4>
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div>CPU: {$metrics[server.id].cpu_usage.toFixed(1)}%</div>
                <div>RAM: {$metrics[server.id].memory_usage.toFixed(1)}%</div>
                <div>TPS: {$metrics[server.id].tps.toFixed(1)}</div>
                <div class="col-span-2">Players: {$metrics[server.id].player_count}</div>
              </div>
            </div>
          {/if}

          <!-- Actions -->
          <div class="mt-6 flex space-x-2">
            <button
              on:click={() => selectedServer.set(server)}
              class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded font-medium transition-colors"
            >
              Configure
            </button>
            <button
              on:click={() => deleteServer(server.id)}
              class="bg-red-100 hover:bg-red-200 text-red-700 py-2 px-4 rounded font-medium transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      {/each}

      <!-- Empty State -->
      {#if $servers.length === 0}
        <div class="col-span-full text-center py-12">
          <div class="text-gray-400 text-6xl mb-4">🎮</div>
          <h3 class="text-xl font-semibold text-gray-700 mb-2">No servers yet</h3>
          <p class="text-gray-600 mb-4">Create your first Minecraft server to get started</p>
          <button
            on:click={() => showCreateModal = true}
            class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Create Server
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Create Server Modal -->
  {#if showCreateModal}
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 class="text-2xl font-bold mb-4">Create New Server</h2>

        <form on:submit|preventDefault={createServer} class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Server Name</label>
            <input
              type="text"
              bind:value={newServerForm.name}
              required
              class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="My Minecraft Server"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Version</label>
              <select
                bind:value={newServerForm.version}
                class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1.20.1">1.20.1</option>
                <option value="1.19.4">1.19.4</option>
                <option value="1.18.2">1.18.2</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Max Players</label>
              <input
                type="number"
                bind:value={newServerForm.maxPlayers}
                min="1"
                max="100"
                class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Gamemode</label>
              <select
                bind:value={newServerForm.gamemode}
                class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="survival">Survival</option>
                <option value="creative">Creative</option>
                <option value="adventure">Adventure</option>
                <option value="spectator">Spectator</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
              <select
                bind:value={newServerForm.difficulty}
                class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="peaceful">Peaceful</option>
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Memory Allocation</label>
            <select
              bind:value={newServerForm.memory}
              class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1G">1GB</option>
              <option value="2G">2GB</option>
              <option value="4G">4GB</option>
              <option value="8G">8GB</option>
            </select>
          </div>

          <div class="flex space-x-3 pt-4">
            <button
              type="button"
              on:click={() => showCreateModal = false}
              class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 px-4 rounded font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded font-medium transition-colors"
            >
              Create Server
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Tailwind CSS classes - in a real project, these would be imported */
  .server-dashboard {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  /* Custom scrollbar for better UX */
  .server-dashboard ::-webkit-scrollbar {
    width: 6px;
  }

  .server-dashboard ::-webkit-scrollbar-track {
    background: #f1f5f9;
  }

  .server-dashboard ::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 3px;
  }

  .server-dashboard ::-webkit-scrollbar-thumb:hover {
    background: #94a3b8;
  }
</style>