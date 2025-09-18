<script>
	import { onMount, createEventDispatcher } from 'svelte';

	export let serverId = '';
	export let serverName = '';
	export let isOpen = false;

	const dispatch = createEventDispatcher();
	const TENANT_ID = '00000000-0000-0000-0000-000000000000';

	let backups = [];
	let loading = true;
	let error = null;
	let creating = false;
	let deleting = {};
	let restoring = {};
	let newBackupName = '';
	let newBackupDescription = '';

	$: if (isOpen && serverId) {
		loadBackups();
	}

	async function loadBackups() {
		loading = true;
		error = null;

		try {
			const response = await fetch(`http://localhost:8080/api/servers/${serverId}/backups`, {
				headers: { 'X-Tenant-ID': TENANT_ID }
			});

			if (response.ok) {
				const data = await response.json();
				backups = data.backups;
			} else {
				error = 'Failed to load backups';
			}
		} catch (err) {
			error = 'Failed to load backups: ' + err.message;
			console.error('Error loading backups:', err);
		} finally {
			loading = false;
		}
	}

	async function createBackup() {
		if (!newBackupName.trim()) {
			alert('Please enter a backup name');
			return;
		}

		creating = true;
		try {
			const response = await fetch(`http://localhost:8080/api/servers/${serverId}/backups`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Tenant-ID': TENANT_ID
				},
				body: JSON.stringify({
					name: newBackupName,
					description: newBackupDescription
				})
			});

			if (response.ok) {
				newBackupName = '';
				newBackupDescription = '';
				await loadBackups(); // Refresh the list
			} else {
				error = 'Failed to create backup';
			}
		} catch (err) {
			error = 'Failed to create backup: ' + err.message;
		} finally {
			creating = false;
		}
	}

	async function deleteBackup(backupId) {
		if (!confirm('Are you sure you want to delete this backup? This action cannot be undone.')) {
			return;
		}

		deleting[backupId] = true;
		deleting = { ...deleting };

		try {
			const response = await fetch(`http://localhost:8080/api/servers/${serverId}/backups/${backupId}`, {
				method: 'DELETE',
				headers: { 'X-Tenant-ID': TENANT_ID }
			});

			if (response.ok) {
				await loadBackups(); // Refresh the list
			} else {
				error = 'Failed to delete backup';
			}
		} catch (err) {
			error = 'Failed to delete backup: ' + err.message;
		} finally {
			delete deleting[backupId];
			deleting = { ...deleting };
		}
	}

	async function restoreBackup(backupId) {
		if (!confirm('Are you sure you want to restore from this backup? This will overwrite the current server data.')) {
			return;
		}

		restoring[backupId] = true;
		restoring = { ...restoring };

		try {
			const response = await fetch(`http://localhost:8080/api/servers/${serverId}/backups/${backupId}/restore`, {
				method: 'POST',
				headers: { 'X-Tenant-ID': TENANT_ID }
			});

			if (response.ok) {
				alert('Restore operation started. This may take several minutes.');
			} else {
				error = 'Failed to start restore operation';
			}
		} catch (err) {
			error = 'Failed to restore backup: ' + err.message;
		} finally {
			delete restoring[backupId];
			restoring = { ...restoring };
		}
	}

	function formatTimestamp(timestamp) {
		return new Date(timestamp).toLocaleString();
	}

	function formatSize(sizeMb) {
		if (sizeMb < 1024) {
			return `${sizeMb} MB`;
		}
		return `${(sizeMb / 1024).toFixed(1)} GB`;
	}

	function getTypeColor(type) {
		switch (type) {
			case 'manual': return 'text-blue-600 bg-blue-50';
			case 'scheduled': return 'text-green-600 bg-green-50';
			default: return 'text-gray-600 bg-gray-50';
		}
	}

	function close() {
		dispatch('close');
	}

	function refresh() {
		loadBackups();
	}
</script>

{#if isOpen}
	<!-- Modal overlay -->
	<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" on:click={close}>
		<!-- Modal content -->
		<div class="bg-white rounded-lg shadow-xl w-full max-w-6xl h-4/5 flex flex-col" on:click|stopPropagation>
			<!-- Header -->
			<div class="flex items-center justify-between p-4 border-b border-gray-200">
				<div>
					<h2 class="text-xl font-semibold text-gray-900">Server Backups</h2>
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
							<p class="text-gray-500 mt-2">Loading backups...</p>
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
					<div class="flex-1 flex flex-col p-4 space-y-4">
						<!-- Create New Backup Section -->
						<div class="bg-gray-50 rounded-lg p-4">
							<h3 class="text-lg font-medium text-gray-900 mb-3">Create New Backup</h3>
							<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
								<div>
									<label class="block text-sm font-medium text-gray-700 mb-1">Backup Name</label>
									<input
										type="text"
										bind:value={newBackupName}
										placeholder="e.g., Pre-update backup"
										class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
									/>
								</div>
								<div>
									<label class="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
									<input
										type="text"
										bind:value={newBackupDescription}
										placeholder="e.g., Before installing new plugins"
										class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
									/>
								</div>
								<div class="flex items-end">
									<button
										on:click={createBackup}
										disabled={creating || !newBackupName.trim()}
										class="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
											💾 Create Backup
										{/if}
									</button>
								</div>
							</div>
						</div>

						<!-- Backups List -->
						<div class="flex-1 overflow-y-auto">
							<h3 class="text-lg font-medium text-gray-900 mb-3">Existing Backups</h3>
							{#if backups.length === 0}
								<div class="text-center py-8 text-gray-500">
									<div class="text-4xl mb-2">📦</div>
									<p>No backups found</p>
									<p class="text-sm">Create your first backup above</p>
								</div>
							{:else}
								<div class="space-y-3">
									{#each backups as backup}
										<div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
											<div class="flex items-start justify-between">
												<div class="flex-1">
													<div class="flex items-center space-x-2 mb-1">
														<h4 class="text-lg font-medium text-gray-900">{backup.name}</h4>
														<span class="inline-flex px-2 py-0.5 text-xs font-medium rounded {getTypeColor(backup.type)}">
															{backup.type}
														</span>
														<span class="inline-flex px-2 py-0.5 text-xs font-medium rounded text-green-600 bg-green-50">
															{backup.status}
														</span>
													</div>
													<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600">
														<div>
															<span class="font-medium">Created:</span>
															{formatTimestamp(backup.timestamp)}
														</div>
														<div>
															<span class="font-medium">Size:</span>
															{formatSize(backup.size_mb)}
														</div>
														<div>
															<span class="font-medium">World:</span>
															{backup.world_name}
														</div>
														<div>
															<span class="font-medium">ID:</span>
															{backup.id}
														</div>
													</div>
												</div>
												<div class="flex space-x-2 ml-4">
													<button
														on:click={() => restoreBackup(backup.id)}
														disabled={restoring[backup.id]}
														class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
													>
														{#if restoring[backup.id]}
															<span class="inline-flex items-center">
																<svg class="animate-spin -ml-1 mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24">
																	<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
																	<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
																</svg>
																Restoring...
															</span>
														{:else}
															🔄 Restore
														{/if}
													</button>
													<button
														on:click={() => deleteBackup(backup.id)}
														disabled={deleting[backup.id]}
														class="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
													>
														{#if deleting[backup.id]}
															<span class="inline-flex items-center">
																<svg class="animate-spin -ml-1 mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24">
																	<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
																	<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
																</svg>
																Deleting...
															</span>
														{:else}
															🗑️ Delete
														{/if}
													</button>
												</div>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="p-4 border-t border-gray-200 bg-gray-50">
				<div class="flex items-center justify-between text-sm text-gray-600">
					<span>{backups.length} backup{backups.length !== 1 ? 's' : ''} available</span>
					<span>Last updated: {new Date().toLocaleTimeString()}</span>
				</div>
			</div>
		</div>
	</div>
{/if}