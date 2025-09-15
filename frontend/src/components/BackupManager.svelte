<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';

  // Types
  interface Backup {
    id: string;
    name: string;
    description?: string;
    server_id: string;
    status: 'creating' | 'completed' | 'failed' | 'restoring' | 'expired';
    compression: 'gzip' | 'lz4' | 'none';
    size_bytes: number;
    created_at: string;
    completed_at?: string;
    expires_at?: string;
    tags: string[];
    storage_path: string;
    backup_type: 'manual' | 'scheduled' | 'pre_restore';
    metadata?: {
      world_size?: number;
      player_count?: number;
      plugins?: string[];
    };
  }

  interface BackupJob {
    id: string;
    backup_id?: string;
    type: 'backup' | 'restore';
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
    message: string;
    started_at: string;
    completed_at?: string;
  }

  interface BackupSchedule {
    id: string;
    name: string;
    cron_schedule: string;
    retention_days: number;
    compression: 'gzip' | 'lz4' | 'none';
    enabled: boolean;
    next_run: string;
    last_run?: string;
  }

  // Props
  export let serverId: string = '';
  export let tenantId: string = 'default-tenant';

  // State
  let backups = writable<Backup[]>([]);
  let activeJobs = writable<BackupJob[]>([]);
  let schedules = writable<BackupSchedule[]>([]);
  let loading = writable(true);
  let error = writable<string | null>(null);

  // UI State
  let activeTab = 'backups'; // 'backups' | 'schedules'
  let showCreateModal = false;
  let showRestoreModal = false;
  let showScheduleModal = false;
  let selectedBackup = writable<Backup | null>(null);

  // Form data
  let createBackupForm = {
    name: '',
    description: '',
    compression: 'gzip',
    tags: [] as string[],
    tagInput: ''
  };

  let restoreForm = {
    create_pre_backup: true,
    stop_server: false,
    timeout_seconds: 300,
    post_restore_commands: [] as string[],
    commandInput: ''
  };

  let scheduleForm = {
    name: '',
    cron_schedule: '0 2 * * *', // Daily at 2 AM
    retention_days: 7,
    compression: 'gzip',
    enabled: true
  };

  // WebSocket for real-time updates (simplified)
  let wsConnection: WebSocket | null = null;

  // API Functions
  async function fetchBackups() {
    if (!serverId) return;

    try {
      const response = await fetch(`/api/servers/${serverId}/backups`, {
        headers: {
          'X-Tenant-ID': tenantId
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      backups.set(data.backups || []);
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to fetch backups');
      console.error('Error fetching backups:', err);
    }
  }

  async function createBackup() {
    if (!serverId) return;

    try {
      const response = await fetch(`/api/servers/${serverId}/backups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({
          name: createBackupForm.name,
          description: createBackupForm.description,
          compression: createBackupForm.compression,
          tags: createBackupForm.tags
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create backup: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Backup creation initiated:', result);

      // Reset form and close modal
      createBackupForm = {
        name: '',
        description: '',
        compression: 'gzip',
        tags: [],
        tagInput: ''
      };
      showCreateModal = false;

      // Refresh backups list
      await fetchBackups();
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to create backup');
    }
  }

  async function restoreBackup(backup: Backup) {
    if (!serverId) return;

    try {
      const response = await fetch(`/api/servers/${serverId}/backups/${backup.id}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({
          create_pre_backup: restoreForm.create_pre_backup,
          stop_server: restoreForm.stop_server,
          timeout_seconds: restoreForm.timeout_seconds,
          post_restore_commands: restoreForm.post_restore_commands
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to restore backup: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Backup restoration initiated:', result);

      // Close modal and reset form
      showRestoreModal = false;
      restoreForm = {
        create_pre_backup: true,
        stop_server: false,
        timeout_seconds: 300,
        post_restore_commands: [],
        commandInput: ''
      };

      // Refresh backups list
      await fetchBackups();
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to restore backup');
    }
  }

  async function deleteBackup(backupId: string) {
    if (!confirm('Are you sure you want to delete this backup? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/servers/${serverId}/backups/${backupId}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': tenantId
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to delete backup: ${response.statusText}`);
      }

      // Refresh backups list
      await fetchBackups();
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Failed to delete backup');
    }
  }

  // Utility Functions
  function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-100';
      case 'creating': case 'restoring': return 'text-blue-600 bg-blue-100';
      case 'failed': return 'text-red-600 bg-red-100';
      case 'expired': return 'text-gray-600 bg-gray-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  }

  function getBackupTypeIcon(type: string): string {
    switch (type) {
      case 'manual': return '📁';
      case 'scheduled': return '⏰';
      case 'pre_restore': return '🔄';
      default: return '📦';
    }
  }

  function formatDateTime(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  function isBackupExpired(backup: Backup): boolean {
    return backup.expires_at ? new Date(backup.expires_at) < new Date() : false;
  }

  function canRestoreBackup(backup: Backup): boolean {
    return backup.status === 'completed' && !isBackupExpired(backup);
  }

  // Form helpers
  function addTag() {
    if (createBackupForm.tagInput.trim() && !createBackupForm.tags.includes(createBackupForm.tagInput.trim())) {
      createBackupForm.tags = [...createBackupForm.tags, createBackupForm.tagInput.trim()];
      createBackupForm.tagInput = '';
    }
  }

  function removeTag(tag: string) {
    createBackupForm.tags = createBackupForm.tags.filter(t => t !== tag);
  }

  function addCommand() {
    if (restoreForm.commandInput.trim() && !restoreForm.post_restore_commands.includes(restoreForm.commandInput.trim())) {
      restoreForm.post_restore_commands = [...restoreForm.post_restore_commands, restoreForm.commandInput.trim()];
      restoreForm.commandInput = '';
    }
  }

  function removeCommand(command: string) {
    restoreForm.post_restore_commands = restoreForm.post_restore_commands.filter(c => c !== command);
  }

  // Sort backups by creation date (newest first)
  $: sortedBackups = $backups.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Lifecycle
  onMount(async () => {
    if (!serverId) {
      error.set('No server selected');
      loading.set(false);
      return;
    }

    loading.set(true);
    try {
      await fetchBackups();
    } finally {
      loading.set(false);
    }
  });
</script>

<div class="backup-manager p-6 bg-gray-50 min-h-screen">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-3xl font-bold text-gray-900">Backup Manager</h1>
      <p class="text-gray-600 mt-1">Protect your server data with automated backups</p>
    </div>

    <div class="flex space-x-3">
      <button
        on:click={() => showScheduleModal = true}
        class="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
      >
        Schedule Backup
      </button>
      <button
        on:click={() => showCreateModal = true}
        disabled={!serverId}
        class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
      >
        Create Backup
      </button>
    </div>
  </div>

  <!-- Server Selection Notice -->
  {#if !serverId}
    <div class="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-6">
      <strong>Notice:</strong> Please select a server to manage backups.
    </div>
  {:else}
    <!-- Tabs -->
    <div class="flex space-x-1 bg-gray-200 rounded-lg p-1 mb-6 w-fit">
      <button
        on:click={() => activeTab = 'backups'}
        class="px-4 py-2 rounded-md font-medium transition-colors {activeTab === 'backups' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}"
      >
        Backups ({$backups.length})
      </button>
      <button
        on:click={() => activeTab = 'schedules'}
        class="px-4 py-2 rounded-md font-medium transition-colors {activeTab === 'schedules' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}"
      >
        Schedules
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
        <span class="ml-3 text-gray-600">Loading backups...</span>
      </div>
    {:else if activeTab === 'backups'}
      <!-- Backups List -->
      {#if sortedBackups.length === 0}
        <div class="bg-white rounded-lg p-12 text-center">
          <div class="text-gray-400 text-6xl mb-4">💾</div>
          <h3 class="text-xl font-semibold text-gray-700 mb-2">No backups yet</h3>
          <p class="text-gray-600 mb-4">Create your first backup to protect your server data</p>
          <button
            on:click={() => showCreateModal = true}
            class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Create First Backup
          </button>
        </div>
      {:else}
        <div class="space-y-4">
          {#each sortedBackups as backup (backup.id)}
            <div class="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow">
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <!-- Backup Header -->
                  <div class="flex items-center space-x-3 mb-2">
                    <span class="text-2xl">{getBackupTypeIcon(backup.backup_type)}</span>
                    <div>
                      <h3 class="text-lg font-semibold text-gray-900">{backup.name}</h3>
                      <div class="flex items-center space-x-2 text-sm text-gray-500">
                        <span>Created: {formatDateTime(backup.created_at)}</span>
                        {#if backup.completed_at}
                          <span>•</span>
                          <span>Completed: {formatDateTime(backup.completed_at)}</span>
                        {/if}
                      </div>
                    </div>
                  </div>

                  <!-- Backup Details -->
                  <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <span class="text-sm text-gray-600">Status</span>
                      <div class="mt-1">
                        <span class="px-2 py-1 rounded-full text-xs font-medium {getStatusColor(backup.status)}">
                          {backup.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span class="text-sm text-gray-600">Size</span>
                      <div class="mt-1 font-medium">{formatFileSize(backup.size_bytes)}</div>
                    </div>
                    <div>
                      <span class="text-sm text-gray-600">Compression</span>
                      <div class="mt-1 font-medium">{backup.compression.toUpperCase()}</div>
                    </div>
                    <div>
                      <span class="text-sm text-gray-600">Type</span>
                      <div class="mt-1 font-medium">{backup.backup_type.replace('_', ' ').toUpperCase()}</div>
                    </div>
                  </div>

                  <!-- Description -->
                  {#if backup.description}
                    <p class="text-gray-700 mb-3">{backup.description}</p>
                  {/if}

                  <!-- Tags -->
                  {#if backup.tags.length > 0}
                    <div class="flex flex-wrap gap-1 mb-4">
                      {#each backup.tags as tag}
                        <span class="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">{tag}</span>
                      {/each}
                    </div>
                  {/if}

                  <!-- Expiration Warning -->
                  {#if backup.expires_at}
                    <div class="text-sm text-gray-500 mb-3">
                      {#if isBackupExpired(backup)}
                        <span class="text-red-600">⚠️ Expired on {formatDateTime(backup.expires_at)}</span>
                      {:else}
                        <span>Expires on {formatDateTime(backup.expires_at)}</span>
                      {/if}
                    </div>
                  {/if}

                  <!-- Metadata -->
                  {#if backup.metadata}
                    <div class="text-xs text-gray-500 space-x-4">
                      {#if backup.metadata.world_size}
                        <span>World: {formatFileSize(backup.metadata.world_size)}</span>
                      {/if}
                      {#if backup.metadata.player_count !== undefined}
                        <span>Players: {backup.metadata.player_count}</span>
                      {/if}
                      {#if backup.metadata.plugins && backup.metadata.plugins.length > 0}
                        <span>Plugins: {backup.metadata.plugins.length}</span>
                      {/if}
                    </div>
                  {/if}
                </div>

                <!-- Actions -->
                <div class="flex flex-col space-y-2 ml-6">
                  <button
                    on:click={() => {selectedBackup.set(backup); showRestoreModal = true;}}
                    disabled={!canRestoreBackup(backup)}
                    class="bg-green-100 hover:bg-green-200 disabled:bg-gray-100 disabled:text-gray-400 text-green-700 py-2 px-4 rounded font-medium transition-colors text-sm"
                  >
                    Restore
                  </button>
                  <button
                    on:click={() => deleteBackup(backup.id)}
                    class="bg-red-100 hover:bg-red-200 text-red-700 py-2 px-4 rounded font-medium transition-colors text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- Schedules Tab -->
      <div class="bg-white rounded-lg p-6">
        <p class="text-gray-600">Backup scheduling feature coming soon...</p>
      </div>
    {/if}
  {/if}

  <!-- Create Backup Modal -->
  {#if showCreateModal}
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 class="text-2xl font-bold mb-4">Create New Backup</h2>

        <form on:submit|preventDefault={createBackup} class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Backup Name</label>
            <input
              type="text"
              bind:value={createBackupForm.name}
              required
              class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Server backup"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
            <textarea
              bind:value={createBackupForm.description}
              class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows="3"
              placeholder="Describe this backup..."
            ></textarea>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Compression</label>
            <select
              bind:value={createBackupForm.compression}
              class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="gzip">GZIP (Recommended)</option>
              <option value="lz4">LZ4 (Faster)</option>
              <option value="none">None (Largest)</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Tags</label>
            <div class="flex space-x-2 mb-2">
              <input
                type="text"
                bind:value={createBackupForm.tagInput}
                on:keydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                class="flex-1 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add tag..."
              />
              <button
                type="button"
                on:click={addTag}
                class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-2 rounded transition-colors"
              >
                Add
              </button>
            </div>
            {#if createBackupForm.tags.length > 0}
              <div class="flex flex-wrap gap-1">
                {#each createBackupForm.tags as tag}
                  <span class="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded flex items-center space-x-1">
                    <span>{tag}</span>
                    <button type="button" on:click={() => removeTag(tag)} class="text-blue-500 hover:text-blue-700">×</button>
                  </span>
                {/each}
              </div>
            {/if}
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
              Create Backup
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Restore Modal -->
  {#if showRestoreModal && $selectedBackup}
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 class="text-2xl font-bold mb-4">Restore Backup</h2>
        <p class="text-gray-600 mb-4">Restore: <strong>{$selectedBackup.name}</strong></p>

        <form on:submit|preventDefault={() => restoreBackup($selectedBackup)} class="space-y-4">
          <div class="space-y-3">
            <label class="flex items-center">
              <input
                type="checkbox"
                bind:checked={restoreForm.create_pre_backup}
                class="mr-2"
              />
              <span class="text-sm">Create backup before restore</span>
            </label>

            <label class="flex items-center">
              <input
                type="checkbox"
                bind:checked={restoreForm.stop_server}
                class="mr-2"
              />
              <span class="text-sm">Stop server before restore</span>
            </label>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Timeout (seconds)</label>
            <input
              type="number"
              bind:value={restoreForm.timeout_seconds}
              min="30"
              max="3600"
              class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div class="bg-yellow-50 border border-yellow-200 rounded p-3">
            <p class="text-sm text-yellow-800">
              <strong>⚠️ Warning:</strong> This will overwrite your current world data. Make sure you have a recent backup if needed.
            </p>
          </div>

          <div class="flex space-x-3 pt-4">
            <button
              type="button"
              on:click={() => showRestoreModal = false}
              class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 px-4 rounded font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded font-medium transition-colors"
            >
              Restore Backup
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>

<style>
  .backup-manager {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
</style>