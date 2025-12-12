import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  Wifi,
  WifiOff,
  Eye,
  Square,
  Play,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { createServer, deleteServer, listServers, stopServer, startServer } from './api';
import type {
  Server as ServerType,
  CreateServerRequest,
  ServerType as ServerTypeEnum,
  LevelType,
} from './types';

interface ServerListProps {
  servers: ServerType[];
  connected: boolean;
  setServers: React.Dispatch<React.SetStateAction<ServerType[]>>;
}

export function ServerList({ servers, connected, setServers }: ServerListProps) {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedServer, setCopiedServer] = useState<string | null>(null);

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const data = await listServers();
      setServers(data);
      setError(null);
    } catch {
      setError('Failed to refresh servers');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete server "${name}"?`)) {
      return;
    }

    try {
      await deleteServer(name);
      setServers((prev) => prev.filter((s) => s.name !== name));
    } catch (err) {
      setError(`Failed to delete server: ${err}`);
    }
  };

  const handleStop = async (name: string) => {
    try {
      await stopServer(name);
      setServers((prev) => prev.map((s) => (s.name === name ? { ...s, phase: 'Stopping' } : s)));
    } catch (err) {
      setError(`Failed to stop server: ${err}`);
    }
  };

  const handleStart = async (name: string) => {
    try {
      await startServer(name);
      setServers((prev) => prev.map((s) => (s.name === name ? { ...s, phase: 'Starting' } : s)));
    } catch (err) {
      setError(`Failed to start server: ${err}`);
    }
  };

  const copyConnectionInfo = (server: ServerType) => {
    const connectionString =
      server.externalIP && server.port ? `${server.externalIP}:${server.port}` : 'Not available';

    void navigator.clipboard.writeText(connectionString);
    setCopiedServer(server.name);
    setTimeout(() => setCopiedServer(null), 2000);
  };

  const getStatusColor = (phase: string) => {
    switch (phase?.toLowerCase()) {
      case 'running':
        return 'bg-green-500';
      case 'pending':
      case 'starting':
        return 'bg-yellow-500 animate-pulse';
      case 'stopping':
        return 'bg-orange-500 animate-pulse';
      case 'error':
      case 'failed':
        return 'bg-red-500';
      case 'stopped':
        return 'bg-gray-500';
      default:
        return 'bg-blue-500';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="bg-gray-800/50 backdrop-blur border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-600 rounded-lg">
                <Server className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Minecraft Server Platform</h1>
                <p className="text-sm text-gray-400">Manage your Minecraft servers</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                  connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}
              >
                {connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                {connected ? 'Connected' : 'Disconnected'}
              </div>

              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              >
                <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>

              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
                New Server
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
            {error}
            <button onClick={() => setError(null)} className="ml-4 text-red-300 hover:text-red-200">
              Dismiss
            </button>
          </div>
        )}

        {servers.length === 0 ? (
          <div className="text-center py-20">
            <Server className="w-16 h-16 mx-auto text-gray-600 mb-4" />
            <h2 className="text-xl font-semibold text-gray-400 mb-2">No servers yet</h2>
            <p className="text-gray-500 mb-6">Create your first Minecraft server to get started</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              Create Server
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {servers.map((server) => (
              <div
                key={server.name}
                className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-5 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{server.name}</h3>
                    <p className="text-sm text-gray-400">{server.version || 'Unknown version'}</p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(server.phase)}`}
                  >
                    {server.phase || 'Unknown'}
                  </span>
                </div>

                {server.message && <p className="text-sm text-gray-500 mb-4">{server.message}</p>}

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Players</span>
                    <span className="text-white">
                      {server.playerCount || 0} / {server.maxPlayers || 20}
                    </span>
                  </div>

                  {server.externalIP && server.port && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400">Address</span>
                      <button
                        onClick={() => copyConnectionInfo(server)}
                        className="flex items-center gap-1.5 text-green-400 hover:text-green-300 transition-colors"
                      >
                        {server.externalIP}:{server.port}
                        {copiedServer === server.name ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-4 border-t border-gray-700">
                  <button
                    onClick={() => navigate(`/servers/${server.name}`)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  {server.phase?.toLowerCase() === 'stopped' ? (
                    <button
                      onClick={() => handleStart(server.name)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors"
                    >
                      <Play className="w-4 h-4" />
                      Start
                    </button>
                  ) : server.phase?.toLowerCase() === 'starting' ||
                    server.phase?.toLowerCase() === 'pending' ? (
                    <button
                      disabled
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg opacity-50 cursor-not-allowed"
                    >
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Starting...
                    </button>
                  ) : server.phase?.toLowerCase() === 'stopping' ? (
                    <button
                      disabled
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-orange-500/20 text-orange-400 rounded-lg opacity-50 cursor-not-allowed"
                    >
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Stopping...
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStop(server.name)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg transition-colors"
                    >
                      <Square className="w-4 h-4" />
                      Stop
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(server.name)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Server Modal */}
      {showCreateModal && (
        <CreateServerModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(server) => {
            setServers((prev) => [...prev, server]);
            setShowCreateModal(false);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

interface CreateServerModalProps {
  onClose: () => void;
  onCreated: (server: ServerType) => void;
  onError: (error: string) => void;
}

// Server type options
const SERVER_TYPES: { value: ServerTypeEnum; label: string; description: string }[] = [
  { value: 'VANILLA', label: 'Vanilla', description: 'Official Minecraft server' },
  { value: 'PAPER', label: 'Paper', description: 'High-performance with plugins' },
  { value: 'SPIGOT', label: 'Spigot', description: 'CraftBukkit fork with plugins' },
  { value: 'PURPUR', label: 'Purpur', description: 'Paper fork with extra features' },
  { value: 'FORGE', label: 'Forge', description: 'Most popular mod loader' },
  { value: 'FABRIC', label: 'Fabric', description: 'Lightweight mod loader' },
  { value: 'QUILT', label: 'Quilt', description: 'Fabric fork' },
  { value: 'NEOFORGE', label: 'NeoForge', description: 'Community Forge fork' },
];

const LEVEL_TYPES: { value: LevelType; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'flat', label: 'Flat' },
  { value: 'largeBiomes', label: 'Large Biomes' },
  { value: 'amplified', label: 'Amplified' },
  { value: 'singleBiome', label: 'Single Biome' },
];

// Pinned Minecraft versions (stable releases only)
const MINECRAFT_VERSIONS = [
  // 1.21.x (2024-2025) - Game Drops era
  { value: '1.21.11', label: '1.21.11', note: 'Latest' },
  { value: '1.21.10', label: '1.21.10', note: 'Mounts of Mayhem prep' },
  { value: '1.21.9', label: '1.21.9', note: 'Bug Fixes' },
  { value: '1.21.8', label: '1.21.8', note: 'Bug Fixes' },
  { value: '1.21.7', label: '1.21.7', note: 'Bug Fixes' },
  { value: '1.21.6', label: '1.21.6', note: 'Bug Fixes' },
  { value: '1.21.5', label: '1.21.5', note: 'The Copper Age' },
  { value: '1.21.4', label: '1.21.4', note: 'The Garden Awakens' },
  { value: '1.21.3', label: '1.21.3', note: 'Bundles of Bravery' },
  { value: '1.21.2', label: '1.21.2', note: 'Bug Fixes' },
  { value: '1.21.1', label: '1.21.1', note: 'Bug Fixes' },
  { value: '1.21', label: '1.21', note: 'Tricky Trials' },
  // 1.20.x (2023-2024)
  { value: '1.20.6', label: '1.20.6', note: 'Bug Fixes' },
  { value: '1.20.5', label: '1.20.5', note: 'Armored Paws' },
  { value: '1.20.4', label: '1.20.4', note: 'Bug Fixes' },
  { value: '1.20.3', label: '1.20.3', note: 'Bug Fixes' },
  { value: '1.20.2', label: '1.20.2', note: 'Bug Fixes' },
  { value: '1.20.1', label: '1.20.1', note: 'Bug Fixes' },
  { value: '1.20', label: '1.20', note: 'Trails & Tales' },
  // 1.19.x (2022-2023)
  { value: '1.19.4', label: '1.19.4', note: 'Bug Fixes' },
  { value: '1.19.3', label: '1.19.3', note: 'Bug Fixes' },
  { value: '1.19.2', label: '1.19.2', note: 'Bug Fixes' },
  { value: '1.19.1', label: '1.19.1', note: 'Bug Fixes' },
  { value: '1.19', label: '1.19', note: 'The Wild Update' },
  // 1.18.x (2021-2022)
  { value: '1.18.2', label: '1.18.2', note: 'Bug Fixes' },
  { value: '1.18.1', label: '1.18.1', note: 'Bug Fixes' },
  { value: '1.18', label: '1.18', note: 'Caves & Cliffs Part 2' },
  // 1.17.x (2021)
  { value: '1.17.1', label: '1.17.1', note: 'Bug Fixes' },
  { value: '1.17', label: '1.17', note: 'Caves & Cliffs Part 1' },
  // 1.16.x (2020) - Nether Update
  { value: '1.16.5', label: '1.16.5', note: 'Bug Fixes' },
  { value: '1.16.4', label: '1.16.4', note: 'Bug Fixes' },
  { value: '1.16.3', label: '1.16.3', note: 'Bug Fixes' },
  { value: '1.16.2', label: '1.16.2', note: 'Bug Fixes' },
  { value: '1.16.1', label: '1.16.1', note: 'Bug Fixes' },
  { value: '1.16', label: '1.16', note: 'Nether Update' },
  // Legacy versions (popular for mods/PvP)
  { value: '1.12.2', label: '1.12.2', note: 'Popular modding version' },
  { value: '1.8.9', label: '1.8.9', note: 'PvP favorite' },
  { value: '1.7.10', label: '1.7.10', note: 'Classic modding version' },
];

function CreateServerModal({ onClose, onCreated, onError }: CreateServerModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formData, setFormData] = useState<CreateServerRequest>({
    name: '',
    serverType: 'VANILLA',
    version: '1.21.11',
    memory: '2G',
    maxPlayers: 20,
    gamemode: 'survival',
    difficulty: 'normal',
    motd: 'A Minecraft Server',
    playerIdleTimeout: 0,
    // World settings
    levelName: 'world',
    levelSeed: '',
    levelType: 'default',
    spawnProtection: 16,
    viewDistance: 10,
    simulationDistance: 10,
    maxWorldSize: 29999984,
    // Resource pack
    resourcePack: '',
    resourcePackSha1: '',
    resourcePackEnforce: false,
    // Server icon
    serverIcon: '',
    // Gameplay
    pvp: true,
    allowFlight: false,
    enableCommandBlock: true,
    forceGamemode: false,
    hardcoreMode: false,
    announcePlayerAchievements: true,
    // Mob spawning
    spawnAnimals: true,
    spawnMonsters: true,
    spawnNpcs: true,
    // World gen
    generateStructures: true,
    allowNether: true,
    // Security
    whiteList: false,
    onlineMode: false,
    // Initial player management
    ops: [],
    initialWhitelist: [],
  });
  const [opsInput, setOpsInput] = useState('');
  const [whitelistInput, setWhitelistInput] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      onError('Server name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const server = await createServer(formData);
      onCreated(server);
    } catch (err: any) {
      onError(err.message || 'Failed to create server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateForm = <K extends keyof CreateServerRequest>(
    key: K,
    value: CreateServerRequest[K]
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Create New Server</h2>
          <p className="text-sm text-gray-400 mt-1">Configure your Minecraft server</p>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Basic Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
              Basic Settings
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Server Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateForm('name', e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                placeholder="my-server"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Server Type</label>
                <select
                  value={formData.serverType}
                  onChange={(e) => updateForm('serverType', e.target.value as ServerTypeEnum)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                >
                  {SERVER_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label} - {type.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Version</label>
                <select
                  value={formData.version}
                  onChange={(e) => updateForm('version', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                >
                  {MINECRAFT_VERSIONS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label} - {v.note}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Memory</label>
                <select
                  value={formData.memory}
                  onChange={(e) => updateForm('memory', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                >
                  <option value="1G">1 GB</option>
                  <option value="2G">2 GB</option>
                  <option value="4G">4 GB</option>
                  <option value="8G">8 GB</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Gamemode</label>
                <select
                  value={formData.gamemode}
                  onChange={(e) => updateForm('gamemode', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                >
                  <option value="survival">Survival</option>
                  <option value="creative">Creative</option>
                  <option value="adventure">Adventure</option>
                  <option value="spectator">Spectator</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Difficulty</label>
                <select
                  value={formData.difficulty}
                  onChange={(e) => updateForm('difficulty', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                >
                  <option value="peaceful">Peaceful</option>
                  <option value="easy">Easy</option>
                  <option value="normal">Normal</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Max Players</label>
                <input
                  type="number"
                  value={formData.maxPlayers}
                  onChange={(e) => updateForm('maxPlayers', parseInt(e.target.value) || 20)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                  min="1"
                  max="1000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">MOTD</label>
                <input
                  type="text"
                  value={formData.motd}
                  onChange={(e) => updateForm('motd', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                  placeholder="A Minecraft Server"
                />
              </div>
            </div>
          </div>

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            {showAdvanced ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Advanced Settings
          </button>

          {showAdvanced && (
            <>
              {/* World Settings */}
              <div className="space-y-4 p-4 bg-gray-700/30 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
                  World Settings
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      World Name
                    </label>
                    <input
                      type="text"
                      value={formData.levelName}
                      onChange={(e) => updateForm('levelName', e.target.value)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                      placeholder="world"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      World Seed
                    </label>
                    <input
                      type="text"
                      value={formData.levelSeed}
                      onChange={(e) => updateForm('levelSeed', e.target.value)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                      placeholder="Leave empty for random"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      World Type
                    </label>
                    <select
                      value={formData.levelType}
                      onChange={(e) => updateForm('levelType', e.target.value as LevelType)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                    >
                      {LEVEL_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      View Distance
                    </label>
                    <input
                      type="number"
                      value={formData.viewDistance}
                      onChange={(e) => updateForm('viewDistance', parseInt(e.target.value) || 10)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                      min="3"
                      max="32"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Spawn Protection
                    </label>
                    <input
                      type="number"
                      value={formData.spawnProtection}
                      onChange={(e) => updateForm('spawnProtection', parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                      min="0"
                      max="1000"
                    />
                  </div>
                </div>
              </div>

              {/* Gameplay Settings */}
              <div className="space-y-4 p-4 bg-gray-700/30 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
                  Gameplay
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.pvp}
                      onChange={(e) => updateForm('pvp', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Enable PVP</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allowFlight}
                      onChange={(e) => updateForm('allowFlight', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Allow Flight</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.enableCommandBlock}
                      onChange={(e) => updateForm('enableCommandBlock', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Command Blocks</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.forceGamemode}
                      onChange={(e) => updateForm('forceGamemode', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Force Gamemode</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.hardcoreMode}
                      onChange={(e) => updateForm('hardcoreMode', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Hardcore Mode</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allowNether}
                      onChange={(e) => updateForm('allowNether', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Allow Nether</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.generateStructures}
                      onChange={(e) => updateForm('generateStructures', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Generate Structures</span>
                  </label>
                </div>
              </div>

              {/* Mob Spawning */}
              <div className="space-y-4 p-4 bg-gray-700/30 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
                  Mob Spawning
                </h3>

                <div className="grid grid-cols-3 gap-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.spawnAnimals}
                      onChange={(e) => updateForm('spawnAnimals', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Animals</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.spawnMonsters}
                      onChange={(e) => updateForm('spawnMonsters', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">Monsters</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.spawnNpcs}
                      onChange={(e) => updateForm('spawnNpcs', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-300">NPCs (Villagers)</span>
                  </label>
                </div>
              </div>

              {/* Security */}
              <div className="space-y-4 p-4 bg-gray-700/30 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
                  Security
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.onlineMode}
                      onChange={(e) => updateForm('onlineMode', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <div>
                      <span className="text-sm text-gray-300">Online Mode</span>
                      <p className="text-xs text-gray-500">Require Microsoft account</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.whiteList}
                      onChange={(e) => updateForm('whiteList', e.target.checked)}
                      className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                    />
                    <div>
                      <span className="text-sm text-gray-300">Whitelist</span>
                      <p className="text-xs text-gray-500">Only allow approved players</p>
                    </div>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Idle Timeout (minutes)
                  </label>
                  <input
                    type="number"
                    value={formData.playerIdleTimeout}
                    onChange={(e) => updateForm('playerIdleTimeout', parseInt(e.target.value) || 0)}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                    min="0"
                    placeholder="0 = disabled"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Kick idle players after X minutes (0 = disabled)
                  </p>
                </div>
              </div>

              {/* Server Appearance */}
              <div className="space-y-4 p-4 bg-gray-700/30 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
                  Server Appearance
                </h3>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Server Icon URL
                  </label>
                  <input
                    type="text"
                    value={formData.serverIcon}
                    onChange={(e) => updateForm('serverIcon', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                    placeholder="https://example.com/icon.png"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    URL to a 64x64 PNG image (auto-scaled)
                  </p>
                </div>
              </div>

              {/* Resource Pack */}
              <div className="space-y-4 p-4 bg-gray-700/30 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
                  Resource Pack
                </h3>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Resource Pack URL
                  </label>
                  <input
                    type="text"
                    value={formData.resourcePack}
                    onChange={(e) => updateForm('resourcePack', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                    placeholder="https://example.com/resourcepack.zip"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Resource Pack SHA1
                  </label>
                  <input
                    type="text"
                    value={formData.resourcePackSha1}
                    onChange={(e) => updateForm('resourcePackSha1', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                    placeholder="Optional checksum for verification"
                  />
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.resourcePackEnforce}
                    onChange={(e) => updateForm('resourcePackEnforce', e.target.checked)}
                    className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-green-500 focus:ring-green-500"
                  />
                  <div>
                    <span className="text-sm text-gray-300">Force Resource Pack</span>
                    <p className="text-xs text-gray-500">Disconnect players who decline</p>
                  </div>
                </label>
              </div>

              {/* Player Management */}
              <div className="space-y-4 p-4 bg-gray-700/30 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
                  Initial Player Management
                </h3>

                {/* Operators */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Server Operators (Admins)
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={opsInput}
                      onChange={(e) => setOpsInput(e.target.value)}
                      className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                      placeholder="Enter username"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (opsInput.trim() && !formData.ops?.includes(opsInput.trim())) {
                            updateForm('ops', [...(formData.ops || []), opsInput.trim()]);
                            setOpsInput('');
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (opsInput.trim() && !formData.ops?.includes(opsInput.trim())) {
                          updateForm('ops', [...(formData.ops || []), opsInput.trim()]);
                          setOpsInput('');
                        }
                      }}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                    >
                      Add
                    </button>
                  </div>
                  {formData.ops && formData.ops.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.ops.map((op) => (
                        <span
                          key={op}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-orange-500/20 text-orange-400 rounded-full text-sm"
                        >
                          {op}
                          <button
                            type="button"
                            onClick={() =>
                              updateForm('ops', formData.ops?.filter((o) => o !== op) || [])
                            }
                            className="hover:text-orange-200"
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Players with full server admin access
                  </p>
                </div>

                {/* Initial Whitelist */}
                {formData.whiteList && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Initial Whitelist
                    </label>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        value={whitelistInput}
                        onChange={(e) => setWhitelistInput(e.target.value)}
                        className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                        placeholder="Enter username"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (
                              whitelistInput.trim() &&
                              !formData.initialWhitelist?.includes(whitelistInput.trim())
                            ) {
                              updateForm('initialWhitelist', [
                                ...(formData.initialWhitelist || []),
                                whitelistInput.trim(),
                              ]);
                              setWhitelistInput('');
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            whitelistInput.trim() &&
                            !formData.initialWhitelist?.includes(whitelistInput.trim())
                          ) {
                            updateForm('initialWhitelist', [
                              ...(formData.initialWhitelist || []),
                              whitelistInput.trim(),
                            ]);
                            setWhitelistInput('');
                          }
                        }}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                      >
                        Add
                      </button>
                    </div>
                    {formData.initialWhitelist && formData.initialWhitelist.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {formData.initialWhitelist.map((player) => (
                          <span
                            key={player}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm"
                          >
                            {player}
                            <button
                              type="button"
                              onClick={() =>
                                updateForm(
                                  'initialWhitelist',
                                  formData.initialWhitelist?.filter((p) => p !== player) || []
                                )
                              }
                              className="hover:text-green-200"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Players allowed to join (whitelist mode only)
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </form>

        <div className="p-6 border-t border-gray-700 bg-gray-800">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Server'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
