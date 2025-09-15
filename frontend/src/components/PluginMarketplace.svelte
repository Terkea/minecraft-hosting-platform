<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';

  // Types
  interface Plugin {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    category: string;
    downloads: number;
    rating: number;
    compatible_versions: string[];
    dependencies: string[];
    image_url?: string;
    download_url: string;
    documentation_url?: string;
    source_url?: string;
    approved: boolean;
    tags: string[];
    last_updated: string;
  }

  interface InstalledPlugin {
    id: string;
    name: string;
    version: string;
    status: 'installing' | 'installed' | 'enabled' | 'disabled' | 'error';
    enabled: boolean;
    server_id: string;
    config?: { [key: string]: any };
  }

  // Props
  export let serverId: string = '';
  export let tenantId: string = 'default-tenant';

  // State
  let availablePlugins = writable<Plugin[]>([]);
  let installedPlugins = writable<InstalledPlugin[]>([]);
  let loading = writable(true);
  let error = writable<string | null>(null);
  let searchQuery = writable('');
  let selectedCategory = writable('all');
  let selectedPlugin = writable<Plugin | null>(null);

  // UI State
  let activeTab = 'marketplace'; // 'marketplace' | 'installed'
  let showPluginModal = false;
  let showConfigModal = false;
  let installingPlugins = new Set<string>();

  // Filters and Search
  $: filteredPlugins = $availablePlugins.filter(plugin => {
    const matchesSearch = plugin.name.toLowerCase().includes($searchQuery.toLowerCase()) ||
                         plugin.description.toLowerCase().includes($searchQuery.toLowerCase()) ||
                         plugin.author.toLowerCase().includes($searchQuery.toLowerCase()) ||
                         plugin.tags.some(tag => tag.toLowerCase().includes($searchQuery.toLowerCase()));

    const matchesCategory = $selectedCategory === 'all' || plugin.category === $selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // Get unique categories
  $: categories = [...new Set($availablePlugins.map(p => p.category))];

  // API Functions
  async function fetchAvailablePlugins() {
    try {
      const response = await fetch('/api/plugins', {
        headers: {
          'X-Tenant-ID': tenantId
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      availablePlugins.set(data.plugins || []);
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to fetch plugins');
      console.error('Error fetching plugins:', err);
    }
  }

  async function fetchInstalledPlugins() {
    if (!serverId) return;

    try {
      const response = await fetch(`/api/servers/${serverId}/plugins`, {
        headers: {
          'X-Tenant-ID': tenantId
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      installedPlugins.set(data.plugins || []);
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to fetch installed plugins');
      console.error('Error fetching installed plugins:', err);
    }
  }

  async function installPlugin(plugin: Plugin) {
    if (!serverId) {
      error.set('No server selected');
      return;
    }

    try {
      installingPlugins.add(plugin.id);
      installingPlugins = installingPlugins; // Trigger reactivity

      const response = await fetch(`/api/servers/${serverId}/plugins/${plugin.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({
          version: plugin.version,
          enabled: true
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to install plugin: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Plugin installation initiated:', result);

      // Refresh installed plugins list
      await fetchInstalledPlugins();

      error.set(null);
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to install plugin');
    } finally {
      installingPlugins.delete(plugin.id);
      installingPlugins = installingPlugins; // Trigger reactivity
    }
  }

  async function uninstallPlugin(pluginId: string) {
    if (!serverId) return;

    if (!confirm('Are you sure you want to uninstall this plugin?')) {
      return;
    }

    try {
      const response = await fetch(`/api/servers/${serverId}/plugins/${pluginId}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': tenantId
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to uninstall plugin: ${response.statusText}`);
      }

      // Refresh installed plugins list
      await fetchInstalledPlugins();
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to uninstall plugin');
    }
  }

  async function togglePlugin(pluginId: string, enabled: boolean) {
    if (!serverId) return;

    try {
      const response = await fetch(`/api/servers/${serverId}/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({
          enabled
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to ${enabled ? 'enable' : 'disable'} plugin: ${response.statusText}`);
      }

      // Refresh installed plugins list
      await fetchInstalledPlugins();
    } catch (err) {
      error.set(err instanceof Error ? err.message : `Failed to ${enabled ? 'enable' : 'disable'} plugin`);
    }
  }

  // Utility Functions
  function isPluginInstalled(pluginId: string): boolean {
    return $installedPlugins.some(p => p.id === pluginId);
  }

  function isPluginInstalling(pluginId: string): boolean {
    return installingPlugins.has(pluginId);
  }

  function getPluginStatusColor(status: string): string {
    switch (status) {
      case 'enabled': return 'text-green-600 bg-green-100';
      case 'disabled': return 'text-gray-600 bg-gray-100';
      case 'installing': return 'text-blue-600 bg-blue-100';
      case 'error': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  }

  function getCategoryColor(category: string): string {
    const colors = {
      'gameplay': 'bg-purple-100 text-purple-800',
      'admin': 'bg-blue-100 text-blue-800',
      'economy': 'bg-green-100 text-green-800',
      'chat': 'bg-yellow-100 text-yellow-800',
      'world': 'bg-indigo-100 text-indigo-800',
      'utility': 'bg-gray-100 text-gray-800'
    };
    return colors[category.toLowerCase()] || 'bg-gray-100 text-gray-800';
  }

  function checkCompatibility(plugin: Plugin, serverVersion: string = '1.20.1'): boolean {
    return plugin.compatible_versions.includes(serverVersion);
  }

  // Lifecycle
  onMount(async () => {
    loading.set(true);
    try {
      await Promise.all([
        fetchAvailablePlugins(),
        fetchInstalledPlugins()
      ]);
    } finally {
      loading.set(false);
    }
  });
</script>

<div class="plugin-marketplace p-6 bg-gray-50 min-h-screen">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-3xl font-bold text-gray-900">Plugin Marketplace</h1>
      <p class="text-gray-600 mt-1">Enhance your server with powerful plugins</p>
    </div>

    <!-- Tabs -->
    <div class="flex space-x-1 bg-gray-200 rounded-lg p-1">
      <button
        on:click={() => activeTab = 'marketplace'}
        class="px-4 py-2 rounded-md font-medium transition-colors {activeTab === 'marketplace' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}"
      >
        Marketplace
      </button>
      <button
        on:click={() => activeTab = 'installed'}
        class="px-4 py-2 rounded-md font-medium transition-colors {activeTab === 'installed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}"
      >
        Installed ({$installedPlugins.length})
      </button>
    </div>
  </div>

  <!-- Error Display -->
  {#if $error}
    <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
      <strong>Error:</strong> {$error}
      <button on:click={() => error.set(null)} class="float-right text-red-500">×</button>
    </div>
  {/if}

  <!-- Server Selection Notice -->
  {#if !serverId}
    <div class="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-6">
      <strong>Notice:</strong> Please select a server to manage plugins.
    </div>
  {/if}

  <!-- Marketplace Tab -->
  {#if activeTab === 'marketplace'}
    <!-- Search and Filters -->
    <div class="bg-white rounded-lg p-6 mb-6 shadow-sm">
      <div class="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4">
        <!-- Search -->
        <div class="flex-1">
          <input
            type="text"
            bind:value={$searchQuery}
            placeholder="Search plugins..."
            class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <!-- Category Filter -->
        <select
          bind:value={$selectedCategory}
          class="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Categories</option>
          {#each categories as category}
            <option value={category}>{category.charAt(0).toUpperCase() + category.slice(1)}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- Loading State -->
    {#if $loading}
      <div class="flex justify-center items-center py-12">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <span class="ml-3 text-gray-600">Loading plugins...</span>
      </div>
    {:else}
      <!-- Plugin Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {#each filteredPlugins as plugin (plugin.id)}
          <div class="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-6">
            <!-- Plugin Header -->
            <div class="flex items-start justify-between mb-4">
              <div class="flex-1">
                <h3 class="text-lg font-semibold text-gray-900 mb-1">{plugin.name}</h3>
                <p class="text-sm text-gray-600">by {plugin.author}</p>
              </div>
              <span class="px-2 py-1 rounded-full text-xs font-medium {getCategoryColor(plugin.category)}">
                {plugin.category}
              </span>
            </div>

            <!-- Plugin Description -->
            <p class="text-gray-700 text-sm mb-4 line-clamp-3">{plugin.description}</p>

            <!-- Plugin Stats -->
            <div class="flex items-center space-x-4 mb-4 text-sm text-gray-500">
              <span>⭐ {plugin.rating.toFixed(1)}</span>
              <span>📥 {plugin.downloads.toLocaleString()}</span>
              <span>📦 v{plugin.version}</span>
            </div>

            <!-- Tags -->
            {#if plugin.tags.length > 0}
              <div class="flex flex-wrap gap-1 mb-4">
                {#each plugin.tags.slice(0, 3) as tag}
                  <span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">{tag}</span>
                {/each}
                {#if plugin.tags.length > 3}
                  <span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">+{plugin.tags.length - 3}</span>
                {/if}
              </div>
            {/if}

            <!-- Compatibility Notice -->
            {#if !checkCompatibility(plugin)}
              <div class="bg-yellow-50 border border-yellow-200 rounded p-2 mb-4">
                <p class="text-xs text-yellow-700">⚠️ May not be compatible with your server version</p>
              </div>
            {/if}

            <!-- Dependencies -->
            {#if plugin.dependencies.length > 0}
              <div class="mb-4">
                <p class="text-xs text-gray-600 mb-1">Dependencies:</p>
                <div class="text-xs text-gray-500">
                  {plugin.dependencies.join(', ')}
                </div>
              </div>
            {/if}

            <!-- Actions -->
            <div class="flex space-x-2">
              <button
                on:click={() => {selectedPlugin.set(plugin); showPluginModal = true;}}
                class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded font-medium transition-colors text-sm"
              >
                View Details
              </button>

              {#if isPluginInstalled(plugin.id)}
                <button
                  disabled
                  class="bg-green-100 text-green-700 py-2 px-4 rounded font-medium text-sm cursor-not-allowed"
                >
                  Installed
                </button>
              {:else if isPluginInstalling(plugin.id)}
                <button
                  disabled
                  class="bg-blue-100 text-blue-700 py-2 px-4 rounded font-medium text-sm cursor-not-allowed"
                >
                  Installing...
                </button>
              {:else}
                <button
                  on:click={() => installPlugin(plugin)}
                  disabled={!serverId || !checkCompatibility(plugin)}
                  class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white py-2 px-4 rounded font-medium transition-colors text-sm"
                >
                  Install
                </button>
              {/if}
            </div>
          </div>
        {/each}

        <!-- Empty State -->
        {#if filteredPlugins.length === 0}
          <div class="col-span-full text-center py-12">
            <div class="text-gray-400 text-6xl mb-4">🔍</div>
            <h3 class="text-xl font-semibold text-gray-700 mb-2">No plugins found</h3>
            <p class="text-gray-600">Try adjusting your search or filters</p>
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <!-- Installed Tab -->
    <div class="bg-white rounded-lg shadow-sm">
      {#if $installedPlugins.length === 0}
        <div class="text-center py-12">
          <div class="text-gray-400 text-6xl mb-4">📦</div>
          <h3 class="text-xl font-semibold text-gray-700 mb-2">No plugins installed</h3>
          <p class="text-gray-600 mb-4">Browse the marketplace to find and install plugins</p>
          <button
            on:click={() => activeTab = 'marketplace'}
            class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Browse Marketplace
          </button>
        </div>
      {:else}
        <div class="divide-y divide-gray-200">
          {#each $installedPlugins as plugin (plugin.id)}
            <div class="p-6 flex items-center justify-between">
              <div class="flex-1">
                <div class="flex items-center space-x-3 mb-2">
                  <h3 class="text-lg font-semibold text-gray-900">{plugin.name}</h3>
                  <span class="px-2 py-1 rounded-full text-xs font-medium {getPluginStatusColor(plugin.status)}">
                    {plugin.status.toUpperCase()}
                  </span>
                </div>
                <p class="text-sm text-gray-600">Version {plugin.version}</p>
              </div>

              <div class="flex items-center space-x-3">
                <!-- Toggle Enable/Disable -->
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    on:change={(e) => togglePlugin(plugin.id, e.target.checked)}
                    class="sr-only peer"
                  />
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>

                <!-- Configure Button -->
                <button
                  on:click={() => {selectedPlugin.set(plugin); showConfigModal = true;}}
                  class="bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded font-medium transition-colors"
                >
                  Configure
                </button>

                <!-- Uninstall Button -->
                <button
                  on:click={() => uninstallPlugin(plugin.id)}
                  class="bg-red-100 hover:bg-red-200 text-red-700 py-2 px-4 rounded font-medium transition-colors"
                >
                  Uninstall
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Plugin Details Modal -->
  {#if showPluginModal && $selectedPlugin}
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between mb-4">
          <div>
            <h2 class="text-2xl font-bold">{$selectedPlugin.name}</h2>
            <p class="text-gray-600">by {$selectedPlugin.author}</p>
          </div>
          <button
            on:click={() => showPluginModal = false}
            class="text-gray-400 hover:text-gray-600"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="space-y-6">
          <div>
            <h3 class="font-semibold mb-2">Description</h3>
            <p class="text-gray-700">{$selectedPlugin.description}</p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <h3 class="font-semibold mb-2">Version</h3>
              <p>{$selectedPlugin.version}</p>
            </div>
            <div>
              <h3 class="font-semibold mb-2">Downloads</h3>
              <p>{$selectedPlugin.downloads.toLocaleString()}</p>
            </div>
            <div>
              <h3 class="font-semibold mb-2">Rating</h3>
              <p>⭐ {$selectedPlugin.rating.toFixed(1)}/5.0</p>
            </div>
            <div>
              <h3 class="font-semibold mb-2">Last Updated</h3>
              <p>{new Date($selectedPlugin.last_updated).toLocaleDateString()}</p>
            </div>
          </div>

          {#if $selectedPlugin.compatible_versions.length > 0}
            <div>
              <h3 class="font-semibold mb-2">Compatible Versions</h3>
              <div class="flex flex-wrap gap-1">
                {#each $selectedPlugin.compatible_versions as version}
                  <span class="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded">{version}</span>
                {/each}
              </div>
            </div>
          {/if}

          {#if $selectedPlugin.dependencies.length > 0}
            <div>
              <h3 class="font-semibold mb-2">Dependencies</h3>
              <div class="flex flex-wrap gap-1">
                {#each $selectedPlugin.dependencies as dependency}
                  <span class="px-2 py-1 bg-blue-100 text-blue-700 text-sm rounded">{dependency}</span>
                {/each}
              </div>
            </div>
          {/if}

          <div class="flex space-x-3">
            <button
              on:click={() => showPluginModal = false}
              class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 px-4 rounded font-medium transition-colors"
            >
              Close
            </button>
            {#if !isPluginInstalled($selectedPlugin.id)}
              <button
                on:click={() => {installPlugin($selectedPlugin); showPluginModal = false;}}
                disabled={!serverId}
                class="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-2 px-4 rounded font-medium transition-colors"
              >
                Install Plugin
              </button>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .plugin-marketplace {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .line-clamp-3 {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
</style>