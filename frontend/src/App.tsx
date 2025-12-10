import { useState } from 'react';
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
} from 'lucide-react';
import { useWebSocket } from './useWebSocket';
import { createServer, deleteServer, listServers, stopServer, startServer } from './api';
import { ServerDetail } from './ServerDetail';
import type { Server as ServerType, CreateServerRequest } from './types';

function App() {
  const { servers, connected, setServers } = useWebSocket();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedServer, setCopiedServer] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);

  // If a server is selected, show the detail page
  if (selectedServer) {
    return (
      <ServerDetail
        serverName={selectedServer}
        onBack={() => setSelectedServer(null)}
        connected={connected}
      />
    );
  }

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
        return 'bg-yellow-500';
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
                    onClick={() => setSelectedServer(server.name)}
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
                  ) : (
                    <button
                      onClick={() => handleStop(server.name)}
                      disabled={
                        server.phase?.toLowerCase() === 'stopping' ||
                        server.phase?.toLowerCase() === 'starting'
                      }
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Square className="w-4 h-4" />
                      {server.phase?.toLowerCase() === 'stopping' ? 'Stopping...' : 'Stop'}
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

function CreateServerModal({ onClose, onCreated, onError }: CreateServerModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<CreateServerRequest>({
    name: '',
    version: 'LATEST',
    maxPlayers: 20,
    gamemode: 'survival',
    difficulty: 'normal',
    motd: 'A Minecraft Server',
    memory: '2G',
  });

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

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-xl font-bold text-white mb-6">Create New Server</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Server Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
              placeholder="my-server"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Version</label>
              <select
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
              >
                <option value="LATEST">Latest</option>
                <option value="1.20.4">1.20.4</option>
                <option value="1.20.2">1.20.2</option>
                <option value="1.19.4">1.19.4</option>
                <option value="1.18.2">1.18.2</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Max Players</label>
              <input
                type="number"
                value={formData.maxPlayers}
                onChange={(e) => setFormData({ ...formData, maxPlayers: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                min="1"
                max="100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Gamemode</label>
              <select
                value={formData.gamemode}
                onChange={(e) => setFormData({ ...formData, gamemode: e.target.value })}
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
                onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
              >
                <option value="peaceful">Peaceful</option>
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Memory</label>
            <select
              value={formData.memory}
              onChange={(e) => setFormData({ ...formData, memory: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
            >
              <option value="1G">1 GB</option>
              <option value="2G">2 GB</option>
              <option value="4G">4 GB</option>
              <option value="8G">8 GB</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              MOTD (Message of the Day)
            </label>
            <input
              type="text"
              value={formData.motd}
              onChange={(e) => setFormData({ ...formData, motd: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
              placeholder="Welcome to my server!"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
