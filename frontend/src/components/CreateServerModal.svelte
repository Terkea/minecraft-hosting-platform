<script>
	import { createEventDispatcher } from 'svelte';

	export let isOpen = false;

	const dispatch = createEventDispatcher();
	const TENANT_ID = '00000000-0000-0000-0000-000000000000';

	let serverName = '';
	let minecraftVersion = '1.20.1';
	let maxPlayers = 20;
	let creating = false;
	let error = null;

	const minecraftVersions = [
		'1.20.1',
		'1.19.4',
		'1.18.2',
		'1.16.5',
		'1.12.2'
	];

	async function createServer() {
		if (!serverName.trim()) {
			error = 'Please enter a server name';
			return;
		}

		creating = true;
		error = null;

		try {
			const response = await fetch('http://localhost:8080/api/servers', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Tenant-ID': TENANT_ID
				},
				body: JSON.stringify({
					name: serverName.trim(),
					minecraft_version: minecraftVersion,
					max_players: maxPlayers,
					sku_id: '11111111-1111-1111-1111-111111111111'
				})
			});

			if (response.ok) {
				const data = await response.json();
				dispatch('serverCreated', data);
				close();
			} else {
				const errorData = await response.json();
				error = errorData.error || 'Failed to create server';
			}
		} catch (err) {
			error = 'Failed to create server: ' + err.message;
		} finally {
			creating = false;
		}
	}

	function close() {
		isOpen = false;
		serverName = '';
		minecraftVersion = '1.20.1';
		maxPlayers = 20;
		creating = false;
		error = null;
		dispatch('close');
	}

	function handleKeydown(event) {
		if (event.key === 'Enter' && !creating) {
			createServer();
		}
	}
</script>

{#if isOpen}
	<!-- Modal overlay -->
	<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" on:click={close}>
		<!-- Modal content -->
		<div class="bg-white rounded-lg shadow-xl w-full max-w-md mx-4" on:click|stopPropagation>
			<!-- Header -->
			<div class="flex items-center justify-between p-6 border-b border-gray-200">
				<h2 class="text-xl font-semibold text-gray-900">Deploy New Server</h2>
				<button
					on:click={close}
					class="text-gray-400 hover:text-gray-600 text-xl font-bold"
				>
					×
				</button>
			</div>

			<!-- Content -->
			<div class="p-6 space-y-4">
				{#if error}
					<div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
						{error}
					</div>
				{/if}

				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Server Name</label>
					<input
						type="text"
						bind:value={serverName}
						on:keydown={handleKeydown}
						placeholder="e.g., My Minecraft Server"
						class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
						disabled={creating}
					/>
				</div>

				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Minecraft Version</label>
					<select
						bind:value={minecraftVersion}
						class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
						disabled={creating}
					>
						{#each minecraftVersions as version}
							<option value={version}>{version}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Max Players</label>
					<input
						type="number"
						bind:value={maxPlayers}
						min="1"
						max="100"
						class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
						disabled={creating}
					/>
				</div>

				<div class="bg-blue-50 border border-blue-200 rounded-md p-4">
					<h4 class="text-sm font-medium text-blue-900 mb-2">Server Specifications</h4>
					<div class="text-sm text-blue-700 space-y-1">
						<div>• CPU: 1 core</div>
						<div>• Memory: 1GB RAM</div>
						<div>• Storage: 10GB SSD</div>
						<div>• Port: Auto-assigned (25565+)</div>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
				<button
					on:click={close}
					class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
					disabled={creating}
				>
					Cancel
				</button>
				<button
					on:click={createServer}
					disabled={creating || !serverName.trim()}
					class="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					{#if creating}
						<span class="inline-flex items-center">
							<svg class="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
							</svg>
							Creating...
						</span>
					{:else}
						🚀 Deploy Server
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}