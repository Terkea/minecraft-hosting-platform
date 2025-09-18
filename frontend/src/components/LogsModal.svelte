<script>
	import { onMount, createEventDispatcher } from 'svelte';

	export let serverId = '';
	export let serverName = '';
	export let isOpen = false;

	const dispatch = createEventDispatcher();
	const TENANT_ID = '00000000-0000-0000-0000-000000000000';

	let logs = [];
	let loading = true;
	let error = null;
	let autoScroll = true;
	let logContainer;

	// Mock logs for now - will be replaced with real API call
	const mockLogs = [
		{
			timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
			level: 'INFO',
			message: 'Starting minecraft server version 1.20.1',
			source: 'minecraft-server'
		},
		{
			timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
			level: 'INFO',
			message: 'Loading properties',
			source: 'minecraft-server'
		},
		{
			timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
			level: 'INFO',
			message: 'Default game type: SURVIVAL',
			source: 'minecraft-server'
		},
		{
			timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
			level: 'WARN',
			message: 'Can\'t keep up! Is the server overloaded?',
			source: 'minecraft-server'
		},
		{
			timestamp: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
			level: 'INFO',
			message: 'Done (3.542s)! For help, type "help"',
			source: 'minecraft-server'
		},
		{
			timestamp: new Date().toISOString(),
			level: 'INFO',
			message: 'Server started successfully on port 25565',
			source: 'minecraft-server'
		}
	];

	$: if (isOpen && serverId) {
		loadLogs();
	}

	async function loadLogs() {
		loading = true;
		error = null;

		try {
			// TODO: Replace with real API call when backend is ready
			// const response = await fetch(`http://localhost:8080/api/servers/${serverId}/logs`, {
			// 	headers: { 'X-Tenant-ID': TENANT_ID }
			// });
			// const data = await response.json();
			// logs = data.logs;

			// For now, use mock data
			await new Promise(resolve => setTimeout(resolve, 500)); // Simulate loading
			logs = mockLogs;

			setTimeout(() => {
				if (autoScroll && logContainer) {
					logContainer.scrollTop = logContainer.scrollHeight;
				}
			}, 50);
		} catch (err) {
			error = 'Failed to load logs: ' + err.message;
			console.error('Error loading logs:', err);
		} finally {
			loading = false;
		}
	}

	function formatTimestamp(timestamp) {
		return new Date(timestamp).toLocaleString();
	}

	function getLevelClass(level) {
		switch (level.toUpperCase()) {
			case 'ERROR': return 'text-red-600 bg-red-50';
			case 'WARN': return 'text-yellow-600 bg-yellow-50';
			case 'INFO': return 'text-blue-600 bg-blue-50';
			case 'DEBUG': return 'text-gray-600 bg-gray-50';
			default: return 'text-gray-600 bg-gray-50';
		}
	}

	function close() {
		dispatch('close');
	}

	function refresh() {
		loadLogs();
	}

	function toggleAutoScroll() {
		autoScroll = !autoScroll;
		if (autoScroll && logContainer) {
			logContainer.scrollTop = logContainer.scrollHeight;
		}
	}
</script>

{#if isOpen}
	<!-- Modal overlay -->
	<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" on:click={close}>
		<!-- Modal content -->
		<div class="bg-white rounded-lg shadow-xl w-full max-w-4xl h-3/4 flex flex-col" on:click|stopPropagation>
			<!-- Header -->
			<div class="flex items-center justify-between p-4 border-b border-gray-200">
				<div>
					<h2 class="text-xl font-semibold text-gray-900">Server Logs</h2>
					<p class="text-sm text-gray-500">{serverName}</p>
				</div>
				<div class="flex items-center space-x-2">
					<button
						on:click={refresh}
						class="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
						disabled={loading}
					>
						{loading ? '🔄' : '↻'} Refresh
					</button>
					<button
						on:click={toggleAutoScroll}
						class="px-3 py-2 text-sm rounded-md transition-colors {autoScroll ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}"
					>
						Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
					</button>
					<button
						on:click={close}
						class="text-gray-400 hover:text-gray-600 text-xl font-bold"
					>
						×
					</button>
				</div>
			</div>

			<!-- Content -->
			<div class="flex-1 flex flex-col overflow-hidden">
				{#if loading}
					<div class="flex-1 flex items-center justify-center">
						<div class="text-center">
							<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
							<p class="text-gray-500 mt-2">Loading logs...</p>
						</div>
					</div>
				{:else if error}
					<div class="flex-1 flex items-center justify-center">
						<div class="text-center text-red-600">
							<p class="text-lg">⚠️ {error}</p>
							<button
								on:click={refresh}
								class="mt-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
							>
								Try Again
							</button>
						</div>
					</div>
				{:else}
					<!-- Log entries -->
					<div
						bind:this={logContainer}
						class="flex-1 overflow-y-auto p-4 bg-gray-900 font-mono text-sm"
					>
						{#each logs as log}
							<div class="mb-1 text-white">
								<span class="text-gray-400">[{formatTimestamp(log.timestamp)}]</span>
								<span class="inline-flex px-2 py-0.5 text-xs font-medium rounded {getLevelClass(log.level)}">
									{log.level}
								</span>
								<span class="text-gray-300">[{log.source}]</span>
								<span class="text-white">{log.message}</span>
							</div>
						{/each}

						{#if logs.length === 0}
							<div class="text-gray-400 text-center py-8">
								No logs available
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="p-4 border-t border-gray-200 bg-gray-50">
				<div class="flex items-center justify-between text-sm text-gray-600">
					<span>{logs.length} log entries</span>
					<span>Last updated: {new Date().toLocaleTimeString()}</span>
				</div>
			</div>
		</div>
	</div>
{/if}