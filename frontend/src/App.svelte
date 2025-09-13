<script lang="ts">
  import { onMount } from 'svelte';

  let serverStatus = 'connecting...';
  let servers: any[] = [];

  // Simulate API call to backend
  onMount(async () => {
    try {
      // This will test our backend health endpoint
      const response = await fetch('http://localhost:8080/health');
      if (response.ok) {
        const data = await response.json();
        serverStatus = data.status;
      } else {
        serverStatus = 'backend unavailable';
      }
    } catch (error) {
      serverStatus = 'backend offline';
      console.log('Backend not running (expected in build test)');
    }
  });
</script>

<main class="min-h-screen bg-gray-50 p-8">
  <div class="max-w-6xl mx-auto">
    <!-- Header -->
    <header class="mb-8">
      <h1 class="minecraft-heading text-4xl text-minecraft-brown mb-2">
        Minecraft Server Platform
      </h1>
      <p class="text-gray-600">
        Cloud-native server hosting with full lifecycle control
      </p>
      <div class="mt-4 p-4 bg-white rounded-lg shadow-md">
        <div class="flex items-center">
          <span class="status-indicator {serverStatus === 'healthy' ? 'status-running' : 'status-stopped'}"></span>
          <span class="text-sm font-medium">
            Backend Status: <span class="font-bold">{serverStatus}</span>
          </span>
        </div>
      </div>
    </header>

    <!-- Dashboard Preview -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <!-- Servers Card -->
      <div class="card">
        <div class="card-header">
          <h2 class="text-xl font-semibold">Servers</h2>
        </div>
        <div class="metric-card border-none p-0 shadow-none">
          <div class="metric-value text-2xl">0</div>
          <div class="metric-label">Running Servers</div>
        </div>
      </div>

      <!-- Performance Card -->
      <div class="card">
        <div class="card-header">
          <h2 class="text-xl font-semibold">Performance</h2>
        </div>
        <div class="metric-card border-none p-0 shadow-none">
          <div class="metric-value text-2xl connection-good">20</div>
          <div class="metric-label">Average TPS</div>
        </div>
      </div>

      <!-- Players Card -->
      <div class="card">
        <div class="card-header">
          <h2 class="text-xl font-semibold">Players</h2>
        </div>
        <div class="metric-card border-none p-0 shadow-none">
          <div class="metric-value text-2xl">0</div>
          <div class="metric-label">Online Players</div>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="flex gap-4 mb-8">
      <button class="btn-primary">
        Deploy New Server
      </button>
      <button class="btn-secondary">
        View All Servers
      </button>
      <button class="btn-secondary">
        Browse Plugins
      </button>
    </div>

    <!-- Status Messages -->
    <div class="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
      <div class="flex">
        <div class="ml-3">
          <p class="text-sm text-blue-700">
            <strong>Development Preview</strong> -
            This is the Minecraft Server Platform frontend.
            Backend API is {serverStatus === 'healthy' ? 'connected' : 'not connected'}.
          </p>
          <p class="text-xs text-blue-600 mt-1">
            Phase 3.1 Complete: Project structure and dependencies configured.
            Phase 3.2 In Progress: Contract tests written, implementation pending.
          </p>
        </div>
      </div>
    </div>
  </div>
</main>

<style>
  /* Component-specific styles */
  :global(.minecraft-heading) {
    font-family: 'Courier New', monospace;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>