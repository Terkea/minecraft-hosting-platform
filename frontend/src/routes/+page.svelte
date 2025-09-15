<script>
	import { onMount } from 'svelte';

	let servers = [];
	let healthStatus = 'checking...';

	onMount(async () => {
		try {
			// Test backend connection
			const healthResponse = await fetch('http://localhost:8080/health');
			const health = await healthResponse.json();
			healthStatus = health.status;

			// Fetch servers
			const serversResponse = await fetch('http://localhost:8080/api/servers');
			const data = await serversResponse.json();
			servers = data.servers;
		} catch (error) {
			console.error('Failed to connect to backend:', error);
			healthStatus = 'error';
		}
	});
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
		</div>
	</header>

	<main>
		<section class="bg-white rounded-lg shadow-md p-6 mb-8">
			<h2 class="text-2xl font-semibold mb-4">Server Dashboard</h2>

			{#if servers.length === 0}
				<div class="text-center py-8">
					<div class="text-gray-400 text-6xl mb-4">🏗️</div>
					<h3 class="text-lg font-medium text-gray-900 mb-2">No servers yet</h3>
					<p class="text-gray-600 mb-4">Deploy your first Minecraft server to get started</p>
					<button class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors">
						Deploy Server
					</button>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each servers as server}
						<div class="border rounded-lg p-4">
							<h3 class="font-medium">{server.name}</h3>
							<p class="text-sm text-gray-600">{server.status}</p>
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