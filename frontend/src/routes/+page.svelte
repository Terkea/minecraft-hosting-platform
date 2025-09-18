<script>
	import { onMount } from 'svelte';
	import LogsModal from '../components/LogsModal.svelte';
	import BackupModal from '../components/BackupModal.svelte';
	import CreateServerModal from '../components/CreateServerModal.svelte';

	let servers = [];
	let healthStatus = 'checking...';
	let loadingOperations = new Set();
	let wsConnection = null;
	let wsConnectionStatus = 'disconnected';

	// Modal states
	let logsModalOpen = false;
	let backupModalOpen = false;
	let createServerModalOpen = false;
	let selectedServerId = '';
	let selectedServerName = '';

	const TENANT_ID = '00000000-0000-0000-0000-000000000000';

	onMount(async () => {
		await loadServers();
		await checkBackendHealth();
		setupWebSocket();
	});

	function setupWebSocket() {
		try {
			wsConnection = new WebSocket(`ws://localhost:8080/ws?tenant_id=${TENANT_ID}`);

			wsConnection.onopen = () => {
				console.log('WebSocket connected');
				wsConnectionStatus = 'connected';
			};

			wsConnection.onmessage = (event) => {
				try {
					if (!event.data || event.data.trim() === '') {
						console.warn('Empty WebSocket message received');
						return;
					}

					const message = JSON.parse(event.data);
					console.log('WebSocket message:', message);

					if (message.type === 'server_status_update') {
						// Update the specific server in our servers array
						servers = servers.map(server =>
							server.id === message.server_id
								? { ...server, status: message.status, updated_at: message.timestamp }
								: server
						);
					}
				} catch (error) {
					console.error('Failed to parse WebSocket message:', error);
					console.error('Raw message data:', event.data);
				}
			};

			wsConnection.onclose = () => {
				console.log('WebSocket disconnected');
				wsConnectionStatus = 'disconnected';
				// Attempt to reconnect after 3 seconds
				setTimeout(setupWebSocket, 3000);
			};

			wsConnection.onerror = (error) => {
				console.error('WebSocket error:', error);
				wsConnectionStatus = 'error';
			};

		} catch (error) {
			console.error('Failed to setup WebSocket:', error);
			wsConnectionStatus = 'error';
		}
	}

	async function checkBackendHealth() {
		try {
			const healthResponse = await fetch('http://localhost:8080/health', {
				headers: { 'X-Tenant-ID': TENANT_ID }
			});
			const health = await healthResponse.json();
			healthStatus = health.status;
		} catch (error) {
			console.error('Failed to connect to backend:', error);
			healthStatus = 'error';
		}
	}

	async function loadServers() {
		try {
			const serversResponse = await fetch('http://localhost:8080/api/servers', {
				headers: { 'X-Tenant-ID': TENANT_ID }
			});
			const data = await serversResponse.json();
			servers = data.servers;
		} catch (error) {
			console.error('Failed to load servers:', error);
		}
	}

	async function updateServerStatus(serverId, newStatus) {
		const operationKey = `${serverId}-${newStatus}`;
		loadingOperations.add(operationKey);
		loadingOperations = loadingOperations; // Trigger reactivity

		try {
			const response = await fetch(`http://localhost:8080/api/servers/${serverId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'X-Tenant-ID': TENANT_ID
				},
				body: JSON.stringify({ status: newStatus })
			});

			if (response.ok) {
				// Update local server status
				servers = servers.map(server =>
					server.id === serverId
						? { ...server, status: newStatus, updated_at: new Date().toISOString() }
						: server
				);
			} else {
				console.error('Failed to update server status');
			}
		} catch (error) {
			console.error('Error updating server:', error);
		} finally {
			loadingOperations.delete(operationKey);
			loadingOperations = loadingOperations; // Trigger reactivity
		}
	}

	async function startServer(serverId) {
		await updateServerStatus(serverId, 'running');
	}

	async function stopServer(serverId) {
		await updateServerStatus(serverId, 'stopped');
	}

	async function restartServer(serverId) {
		await updateServerStatus(serverId, 'pending');
		// After a brief delay, set to running to simulate restart
		setTimeout(() => updateServerStatus(serverId, 'running'), 2000);
	}

	function getStatusColor(status) {
		switch (status) {
			case 'running': return 'text-green-600 bg-green-50';
			case 'stopped': return 'text-red-600 bg-red-50';
			case 'pending': return 'text-yellow-600 bg-yellow-50';
			default: return 'text-gray-600 bg-gray-50';
		}
	}

	function getStatusIcon(status) {
		switch (status) {
			case 'running': return '🟢';
			case 'stopped': return '🔴';
			case 'pending': return '🟡';
			default: return '⚪';
		}
	}

	function isLoading(serverId, operation) {
		return loadingOperations.has(`${serverId}-${operation}`);
	}

	function openLogsModal(serverId, serverName) {
		selectedServerId = serverId;
		selectedServerName = serverName;
		logsModalOpen = true;
	}

	function closeLogsModal() {
		logsModalOpen = false;
		selectedServerId = '';
		selectedServerName = '';
	}

	function openBackupModal(serverId, serverName) {
		selectedServerId = serverId;
		selectedServerName = serverName;
		backupModalOpen = true;
	}

	function closeBackupModal() {
		backupModalOpen = false;
		selectedServerId = '';
		selectedServerName = '';
	}

	function openCreateServerModal() {
		createServerModalOpen = true;
	}

	function closeCreateServerModal() {
		createServerModalOpen = false;
	}

	function handleServerCreated(event) {
		// Refresh the server list when a new server is created
		loadServers();
		closeCreateServerModal();
	}
</script>

<div class="container mx-auto px-4 py-8">
	<header class="mb-8">
		<h1 class="text-4xl font-bold text-gray-900 mb-2">
			🎮 Minecraft Server Platform
		</h1>
		<p class="text-gray-600">Cloud-native Minecraft server hosting and management</p>

		<div class="mt-4 flex items-center space-x-4">
			<div class="flex items-center space-x-2">
				<div class="w-3 h-3 rounded-full {healthStatus === 'healthy' ? 'bg-green-500' : healthStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'}"></div>
				<span class="text-sm font-medium">Backend: {healthStatus}</span>
			</div>
			<div class="flex items-center space-x-2">
				<div class="w-3 h-3 rounded-full {wsConnectionStatus === 'connected' ? 'bg-green-500' : wsConnectionStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'}"></div>
				<span class="text-sm font-medium">WebSocket: {wsConnectionStatus}</span>
			</div>
		</div>
	</header>

	<main>
		<section class="bg-white rounded-lg shadow-md p-6 mb-8">
			<div class="flex items-center justify-between mb-6">
				<h2 class="text-2xl font-semibold">Server Dashboard</h2>
				<div class="flex space-x-3">
					<button
						on:click={loadServers}
						class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
					>
						🔄 Refresh
					</button>
					<button
						on:click={openCreateServerModal}
						class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
					>
						➕ Deploy Server
					</button>
				</div>
			</div>

			{#if servers.length === 0}
				<div class="text-center py-8">
					<div class="text-gray-400 text-6xl mb-4">🏗️</div>
					<h3 class="text-lg font-medium text-gray-900 mb-2">No servers yet</h3>
					<p class="text-gray-600 mb-4">Deploy your first Minecraft server to get started</p>
					<button
						on:click={openCreateServerModal}
						class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
					>
						Deploy Server
					</button>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{#each servers as server}
						<div class="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
							<!-- Server Header -->
							<div class="p-4 border-b border-gray-100">
								<div class="flex items-center justify-between">
									<h3 class="text-lg font-semibold text-gray-900">{server.name}</h3>
									<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {getStatusColor(server.status)}">
										{getStatusIcon(server.status)} {server.status}
									</span>
								</div>
								<p class="text-sm text-gray-500 mt-1">Minecraft {server.minecraft_version}</p>
							</div>

							<!-- Server Details -->
							<div class="p-4 space-y-3">
								<div class="grid grid-cols-2 gap-4 text-sm">
									<div>
										<span class="text-gray-500">Players:</span>
										<span class="ml-1 font-medium">{server.current_players}/{server.max_players}</span>
									</div>
									<div>
										<span class="text-gray-500">Port:</span>
										<span class="ml-1 font-medium">{server.external_port}</span>
									</div>
								</div>

								{#if server.resource_limits}
									<div class="text-sm">
										<span class="text-gray-500">Resources:</span>
										<span class="ml-1 font-medium">
											{server.resource_limits.cpu_cores} CPU, {server.resource_limits.memory_gb}GB RAM
										</span>
									</div>
								{/if}

								<div class="text-xs text-gray-400">
									Updated: {new Date(server.updated_at).toLocaleString()}
								</div>
							</div>

							<!-- Server Actions -->
							<div class="p-4 bg-gray-50 border-t border-gray-100 rounded-b-lg">
								<div class="flex space-x-2">
									{#if server.status === 'stopped' || server.status === 'pending'}
										<button
											on:click={() => startServer(server.id)}
											disabled={isLoading(server.id, 'running')}
											class="flex-1 bg-green-600 text-white text-sm py-2 px-3 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
										>
											{#if isLoading(server.id, 'running')}
												<span class="inline-flex items-center">
													<svg class="animate-spin -ml-1 mr-2 h-3 w-3" fill="none" viewBox="0 0 24 24">
														<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
														<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
													</svg>
													Starting...
												</span>
											{:else}
												▶️ Start
											{/if}
										</button>
									{/if}

									{#if server.status === 'running'}
										<button
											on:click={() => stopServer(server.id)}
											disabled={isLoading(server.id, 'stopped')}
											class="flex-1 bg-red-600 text-white text-sm py-2 px-3 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
										>
											{#if isLoading(server.id, 'stopped')}
												<span class="inline-flex items-center">
													<svg class="animate-spin -ml-1 mr-2 h-3 w-3" fill="none" viewBox="0 0 24 24">
														<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
														<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
													</svg>
													Stopping...
												</span>
											{:else}
												⏹️ Stop
											{/if}
										</button>

										<button
											on:click={() => restartServer(server.id)}
											disabled={isLoading(server.id, 'pending')}
											class="flex-1 bg-blue-600 text-white text-sm py-2 px-3 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
										>
											{#if isLoading(server.id, 'pending')}
												<span class="inline-flex items-center">
													<svg class="animate-spin -ml-1 mr-2 h-3 w-3" fill="none" viewBox="0 0 24 24">
														<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
														<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
													</svg>
													Restarting...
												</span>
											{:else}
												🔄 Restart
											{/if}
										</button>
									{/if}
								</div>

								<!-- Secondary Actions -->
								<div class="flex space-x-2 mt-2">
									<button class="flex-1 bg-gray-200 text-gray-700 text-xs py-1.5 px-3 rounded-md hover:bg-gray-300 transition-colors">
										⚙️ Configure
									</button>
									<button
										on:click={() => openLogsModal(server.id, server.name)}
										class="flex-1 bg-gray-200 text-gray-700 text-xs py-1.5 px-3 rounded-md hover:bg-gray-300 transition-colors"
									>
										📋 Logs
									</button>
									<button
										on:click={() => openBackupModal(server.id, server.name)}
										class="flex-1 bg-gray-200 text-gray-700 text-xs py-1.5 px-3 rounded-md hover:bg-gray-300 transition-colors"
									>
										💾 Backup
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section class="grid grid-cols-1 md:grid-cols-3 gap-6">
			<div class="bg-white rounded-lg shadow-md p-6">
				<h3 class="text-lg font-semibold mb-2">🚀 Quick Actions</h3>
				<div class="space-y-2">
					<button class="w-full text-left px-3 py-2 rounded-md bg-gray-50 hover:bg-gray-100 transition-colors">
						Deploy New Server
					</button>
					<button class="w-full text-left px-3 py-2 rounded-md bg-gray-50 hover:bg-gray-100 transition-colors">
						Browse Plugins
					</button>
					<button class="w-full text-left px-3 py-2 rounded-md bg-gray-50 hover:bg-gray-100 transition-colors">
						View Backups
					</button>
				</div>
			</div>

			<div class="bg-white rounded-lg shadow-md p-6">
				<h3 class="text-lg font-semibold mb-2">📊 Platform Status</h3>
				<div class="space-y-2 text-sm">
					<div class="flex justify-between">
						<span>Total Servers:</span>
						<span class="font-medium">{servers.length}</span>
					</div>
					<div class="flex justify-between">
						<span>Active Players:</span>
						<span class="font-medium">0</span>
					</div>
					<div class="flex justify-between">
						<span>API Status:</span>
						<span class="font-medium {healthStatus === 'healthy' ? 'text-green-600' : 'text-red-600'}">{healthStatus}</span>
					</div>
				</div>
			</div>

			<div class="bg-white rounded-lg shadow-md p-6">
				<h3 class="text-lg font-semibold mb-2">🔗 Links</h3>
				<div class="space-y-2 text-sm">
					<a href="http://localhost:8080/health" target="_blank" class="block text-blue-600 hover:text-blue-800">
						Backend Health Check
					</a>
					<a href="http://localhost:3000" target="_blank" class="block text-blue-600 hover:text-blue-800">
						Grafana Dashboard
					</a>
					<a href="http://localhost:9090" target="_blank" class="block text-blue-600 hover:text-blue-800">
						Prometheus Metrics
					</a>
					<a href="http://localhost:8081" target="_blank" class="block text-blue-600 hover:text-blue-800">
						CockroachDB Admin
					</a>
				</div>
			</div>
		</section>
	</main>
</div>

<!-- Modals -->
<LogsModal
	bind:isOpen={logsModalOpen}
	serverId={selectedServerId}
	serverName={selectedServerName}
	on:close={closeLogsModal}
/>

<BackupModal
	bind:isOpen={backupModalOpen}
	serverId={selectedServerId}
	serverName={selectedServerName}
	on:close={closeBackupModal}
/>

<CreateServerModal
	bind:isOpen={createServerModalOpen}
	on:close={closeCreateServerModal}
	on:serverCreated={handleServerCreated}
/>