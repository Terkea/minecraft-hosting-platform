import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Server,
  Terminal,
  Activity,
  RefreshCw,
  Cpu,
  HardDrive,
  Clock,
  RotateCcw,
  Users,
  Wifi,
  WifiOff,
  Send,
  Copy,
  Check,
  Square,
  Play,
  Heart,
  ChevronRight,
  Settings,
  Shield,
  Download,
  Search,
  Share2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  Link as LinkIcon,
  FileText,
  FolderOpen,
  Eye,
  Trash2,
} from 'lucide-react';
import {
  getServer,
  getServerLogs,
  getServerMetrics,
  getPodStatus,
  executeCommand,
  stopServer,
  startServer,
  getServerPlayers,
  getPlayerDetails,
  getLogFiles,
  getLogFileContent,
  ServerMetricsResponse,
  PodStatus,
  PlayersListResponse,
  PlayerData,
  LogFile,
} from './api';
import { PlayerView } from './PlayerView';
import { ServerConfigEditor } from './ServerConfigEditor';
import { PlayerManagement } from './PlayerManagement';
import type { Server as ServerType } from './types';

interface ServerDetailProps {
  connected: boolean;
}

type Tab = 'overview' | 'console' | 'players' | 'management' | 'config';
type LogLevel = 'all' | 'error' | 'warn' | 'info';

interface ConsoleEntry {
  type: 'log' | 'command' | 'result' | 'error';
  content: string;
  timestamp: Date;
  level?: 'error' | 'warn' | 'info' | 'debug';
}

// Classify log level based on content
const classifyLogLevel = (content: string): 'error' | 'warn' | 'info' | 'debug' => {
  const lower = content.toLowerCase();
  if (
    lower.includes('error') ||
    lower.includes('exception') ||
    lower.includes('fatal') ||
    lower.includes('failed')
  ) {
    return 'error';
  }
  if (lower.includes('warn') || lower.includes('warning')) {
    return 'warn';
  }
  if (lower.includes('debug') || lower.includes('trace')) {
    return 'debug';
  }
  return 'info';
};

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'console', label: 'Console', icon: Terminal },
  { id: 'players', label: 'Players', icon: Users },
  { id: 'management', label: 'Management', icon: Shield },
  { id: 'config', label: 'Configuration', icon: Settings },
];

export function ServerDetail({ connected }: ServerDetailProps) {
  const { serverName, tab, playerName } = useParams<{
    serverName: string;
    tab?: string;
    playerName?: string;
  }>();
  const navigate = useNavigate();

  // Determine active tab from URL
  // If playerName is in URL, we're viewing a player so tab should be 'players'
  const activeTab: Tab = playerName ? 'players' : (tab as Tab) || 'overview';
  const isValidTab = TABS.some((t) => t.id === activeTab);

  const [server, setServer] = useState<ServerType | null>(null);
  const [metrics, setMetrics] = useState<ServerMetricsResponse['metrics'] | null>(null);
  const [podStatus, setPodStatus] = useState<PodStatus | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [lastLogCount, setLastLogCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [isExecutingCommand, setIsExecutingCommand] = useState(false);
  const [isTogglingServer, setIsTogglingServer] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [playersData, setPlayersData] = useState<PlayersListResponse | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerData | null>(null);
  const [playersLoading, setPlayersLoading] = useState(false);
  const playersFetchingRef = useRef(false);
  const selectedPlayerNameRef = useRef<string | null>(null);

  // Console filtering, search, and sharing
  const [logFilter, setLogFilter] = useState<LogLevel>('all');
  const [logSearch, setLogSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);

  // Log files management
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [loadingLogFiles, setLoadingLogFiles] = useState(false);
  const [selectedLogFile, setSelectedLogFile] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string[]>([]);
  const [loadingFileContent, setLoadingFileContent] = useState(false);
  const [consoleView, setConsoleView] = useState<'live' | 'files'>('live');

  // Keep the ref in sync with the selected player
  useEffect(() => {
    selectedPlayerNameRef.current = selectedPlayer?.name || null;
  }, [selectedPlayer]);

  // Handle player selection from URL - fetch detailed data
  useEffect(() => {
    if (playerName && serverName) {
      // Fetch detailed player data when navigating to player view
      const fetchPlayerDetails = async () => {
        try {
          setPlayersLoading(true);
          const playerData = await getPlayerDetails(serverName, playerName);
          setSelectedPlayer(playerData);
        } catch (err) {
          console.error('Failed to fetch player details:', err);
          setSelectedPlayer(null);
        } finally {
          setPlayersLoading(false);
        }
      };
      void fetchPlayerDetails();
    } else if (!playerName) {
      setSelectedPlayer(null);
    }
  }, [playerName, serverName]);

  // Initial data load
  useEffect(() => {
    void loadServerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverName]);

  // Refresh metrics and logs periodically (only when not viewing a player detail)
  useEffect(() => {
    const interval = setInterval(() => {
      // Don't refresh metrics when viewing a player detail page
      if (!playerName) {
        void refreshMetrics();
      }
      if (activeTab === 'console') {
        void refreshLogs();
      }
      // Only refresh player list when on players tab but not viewing a specific player
      if (activeTab === 'players' && !playerName) {
        void fetchPlayers();
      }
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverName, activeTab, playerName]);

  // Refresh player details periodically when viewing a specific player
  useEffect(() => {
    if (!playerName || !serverName) return;

    const interval = setInterval(async () => {
      try {
        const playerData = await getPlayerDetails(serverName, playerName);
        setSelectedPlayer(playerData);
      } catch (err) {
        console.error('Failed to refresh player details:', err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [serverName, playerName]);

  // Auto-scroll console
  useEffect(() => {
    if (autoScrollRef.current && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleEntries]);

  // Redirect to valid tab if invalid
  useEffect(() => {
    if (tab && !isValidTab && serverName) {
      void navigate(`/servers/${serverName}/overview`, { replace: true });
    }
  }, [tab, isValidTab, serverName, navigate]);

  const loadServerData = async () => {
    if (!serverName) return;
    setIsLoading(true);
    try {
      const [serverData, metricsData, podData, logsData] = await Promise.all([
        getServer(serverName),
        getServerMetrics(serverName).catch(() => null),
        getPodStatus(serverName).catch(() => null),
        getServerLogs(serverName, 100).catch(() => [] as string[]),
      ]);

      setServer(serverData);
      setMetrics(metricsData?.metrics || null);
      setPodStatus(podData);

      if (logsData.length > 0) {
        setConsoleEntries(
          logsData.map((log: string) => ({
            type: 'log' as const,
            content: log,
            timestamp: new Date(),
            level: classifyLogLevel(log),
          }))
        );
        setLastLogCount(logsData.length);
      }

      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load server data');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshMetrics = async () => {
    if (!serverName) return;
    try {
      const [serverData, metricsData, podData] = await Promise.all([
        getServer(serverName),
        getServerMetrics(serverName).catch(() => null),
        getPodStatus(serverName).catch(() => null),
      ]);

      setServer(serverData);
      setMetrics(metricsData?.metrics || null);
      setPodStatus(podData);
    } catch {
      // Silently fail on refresh
    }
  };

  const MAX_LOG_ENTRIES = 500; // Keep only the last 500 entries

  const refreshLogs = async () => {
    if (!serverName) return;
    try {
      const logsData = await getServerLogs(serverName, 200);
      if (logsData.length > lastLogCount) {
        const newLogs = logsData.slice(lastLogCount);
        setConsoleEntries((prev) => {
          const updated = [
            ...prev,
            ...newLogs.map((log: string) => ({
              type: 'log' as const,
              content: log,
              timestamp: new Date(),
              level: classifyLogLevel(log),
            })),
          ];
          // Keep only the last MAX_LOG_ENTRIES
          return updated.slice(-MAX_LOG_ENTRIES);
        });
        setLastLogCount(logsData.length);
      }
    } catch {
      // Silently fail
    }
  };

  const clearLogs = () => {
    setConsoleEntries([]);
    setLastLogCount(0);
  };

  // Fetch log files list
  const fetchLogFiles = async () => {
    if (!serverName) return;
    setLoadingLogFiles(true);
    try {
      const data = await getLogFiles(serverName);
      setLogFiles(data.files);
    } catch (err) {
      console.error('Failed to fetch log files:', err);
    } finally {
      setLoadingLogFiles(false);
    }
  };

  // Fetch content of a specific log file
  const fetchLogFileContent = async (filename: string) => {
    if (!serverName) return;
    setLoadingFileContent(true);
    setSelectedLogFile(filename);
    try {
      const content = await getLogFileContent(serverName, filename, 1000);
      setSelectedFileContent(content);
    } catch (err) {
      console.error('Failed to fetch log file content:', err);
      setSelectedFileContent([]);
    } finally {
      setLoadingFileContent(false);
    }
  };

  // Download a log file
  const handleDownloadLogFile = (filename: string) => {
    const content = selectedFileContent.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fetchPlayers = async (showLoading = false) => {
    if (!serverName || playersFetchingRef.current || server?.phase?.toLowerCase() !== 'running')
      return;

    playersFetchingRef.current = true;
    if (showLoading) {
      setPlayersLoading(true);
    }

    try {
      const data = await getServerPlayers(serverName);
      setPlayersData(data);
      // Note: Selected player details are fetched separately via getPlayerDetails
    } catch {
      // Silently fail on refresh
    } finally {
      playersFetchingRef.current = false;
      if (showLoading) {
        setPlayersLoading(false);
      }
    }
  };

  const handleStopServer = async () => {
    if (!serverName) return;
    setIsTogglingServer(true);
    try {
      await stopServer(serverName);
      setServer((prev) => (prev ? { ...prev, phase: 'Stopping' } : null));
    } catch (err: any) {
      setError(err.message || 'Failed to stop server');
    } finally {
      setIsTogglingServer(false);
    }
  };

  const handleStartServer = async () => {
    if (!serverName) return;
    setIsTogglingServer(true);
    try {
      await startServer(serverName);
      setServer((prev) => (prev ? { ...prev, phase: 'Starting' } : null));
    } catch (err: any) {
      setError(err.message || 'Failed to start server');
    } finally {
      setIsTogglingServer(false);
    }
  };

  const handleExecuteCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverName || !command.trim() || isExecutingCommand) return;

    setIsExecutingCommand(true);
    const cmd = command.trim();
    setCommand('');

    // Add command entry
    setConsoleEntries((prev) => [
      ...prev,
      { type: 'command', content: cmd, timestamp: new Date() },
    ]);

    try {
      const result = await executeCommand(serverName, cmd);
      setConsoleEntries((prev) => [
        ...prev,
        {
          type: 'result',
          content: result || 'Command executed successfully',
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      setConsoleEntries((prev) => [
        ...prev,
        { type: 'error', content: err.message, timestamp: new Date() },
      ]);
    } finally {
      setIsExecutingCommand(false);
    }
  };

  const copyAddress = () => {
    if (server?.externalIP && server?.port) {
      void navigator.clipboard.writeText(`${server.externalIP}:${server.port}`);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
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

  const handlePlayerSelect = (playerName: string) => {
    // Navigate to player page - details will be fetched by useEffect
    void navigate(`/servers/${serverName}/players/${playerName}`);
  };

  const handlePlayerBack = () => {
    setSelectedPlayer(null);
    void navigate(`/servers/${serverName}/players`);
  };

  const refreshSelectedPlayer = async () => {
    if (!serverName || !playerName) return;
    setPlayersLoading(true);
    try {
      const playerData = await getPlayerDetails(serverName, playerName);
      setSelectedPlayer(playerData);
    } catch (err) {
      console.error('Failed to refresh player details:', err);
    } finally {
      setPlayersLoading(false);
    }
  };

  // Filter console entries based on level and search
  const filteredEntries = consoleEntries.filter((entry) => {
    // Always show commands and results
    if (entry.type === 'command' || entry.type === 'result') return true;

    // Filter by level
    if (logFilter !== 'all' && entry.type === 'log') {
      if (logFilter === 'error' && entry.level !== 'error') return false;
      if (logFilter === 'warn' && entry.level !== 'warn' && entry.level !== 'error') return false;
      if (logFilter === 'info' && entry.level === 'debug') return false;
    }

    // Filter by search
    if (logSearch && !entry.content.toLowerCase().includes(logSearch.toLowerCase())) {
      return false;
    }

    return true;
  });

  // Count logs by level
  const logCounts = {
    all: consoleEntries.filter((e) => e.type === 'log').length,
    error: consoleEntries.filter((e) => e.type === 'log' && e.level === 'error').length,
    warn: consoleEntries.filter(
      (e) => e.type === 'log' && (e.level === 'warn' || e.level === 'error')
    ).length,
    info: consoleEntries.filter((e) => e.type === 'log' && e.level !== 'debug').length,
  };

  // Download logs as file
  const handleDownloadLogs = () => {
    const logText = consoleEntries
      .map((entry) => {
        const time = entry.timestamp.toISOString();
        if (entry.type === 'command') return `[${time}] > ${entry.content}`;
        if (entry.type === 'result') return `[${time}] < ${entry.content}`;
        return `[${time}] ${entry.content}`;
      })
      .join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${serverName}-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Generate shareable log link (base64 encoded)
  const handleShareLogs = () => {
    const logText = filteredEntries
      .slice(-100) // Last 100 entries
      .map((entry) => entry.content)
      .join('\n');

    const encoded = btoa(encodeURIComponent(logText));
    // In a real app, this would be uploaded to a paste service
    // For now, we'll create a data URL
    const shareableUrl = `${window.location.origin}/shared-logs?data=${encoded.slice(0, 500)}`;
    setShareUrl(shareableUrl);
  };

  const copyShareUrl = () => {
    if (shareUrl) {
      void navigator.clipboard.writeText(shareUrl);
      setCopiedShareUrl(true);
      setTimeout(() => setCopiedShareUrl(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-green-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading server data...</p>
        </div>
      </div>
    );
  }

  if (error || !server) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Server className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-400 mb-4">{error || 'Server not found'}</p>
          <Link
            to="/"
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors inline-block"
          >
            Go Back
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="bg-gray-800/50 backdrop-blur border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to="/"
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-600 rounded-lg">
                  <Server className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">{server.name}</h1>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${getStatusColor(server.phase)}`}
                    >
                      {server.phase}
                    </span>
                    <span className="text-sm text-gray-400">{server.version}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                  connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}
              >
                {connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                {connected ? 'Live' : 'Offline'}
              </div>

              {server.phase?.toLowerCase() === 'stopped' ? (
                <button
                  onClick={handleStartServer}
                  disabled={isTogglingServer}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                >
                  <Play className="w-4 h-4" />
                  {isTogglingServer ? 'Starting...' : 'Start Server'}
                </button>
              ) : (
                <button
                  onClick={handleStopServer}
                  disabled={
                    isTogglingServer ||
                    server.phase?.toLowerCase() === 'stopping' ||
                    server.phase?.toLowerCase() === 'starting'
                  }
                  className="flex items-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-600/50 text-white rounded-lg transition-colors"
                >
                  <Square className="w-4 h-4" />
                  {isTogglingServer || server.phase?.toLowerCase() === 'stopping'
                    ? 'Stopping...'
                    : 'Stop Server'}
                </button>
              )}

              <button
                onClick={loadServerData}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-gray-700 bg-gray-800/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <Link
                key={id}
                to={`/servers/${serverName}/${id}`}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === id
                    ? 'border-green-500 text-green-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {activeTab === 'overview' && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Server Info Card */}
            <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Server Info</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${getStatusColor(server.phase)}`}
                  >
                    {server.phase}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Version</span>
                  <span className="text-white">{server.version || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Namespace</span>
                  <span className="text-white">{server.namespace}</span>
                </div>
                {server.externalIP && server.port && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Address</span>
                    <button
                      onClick={copyAddress}
                      className="flex items-center gap-1.5 text-green-400 hover:text-green-300 transition-colors"
                    >
                      {server.externalIP}:{server.port}
                      {copiedAddress ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                )}
                {server.message && (
                  <div className="pt-2 border-t border-gray-700">
                    <span className="text-sm text-gray-500">{server.message}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Players Card */}
            <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Players</h3>
              <div className="flex items-center gap-4">
                <Users className="w-10 h-10 text-blue-400" />
                <div>
                  <p className="text-3xl font-bold text-white">
                    {server.playerCount || 0}{' '}
                    <span className="text-lg text-gray-400">/ {server.maxPlayers || 20}</span>
                  </p>
                  <p className="text-sm text-gray-400">Online players</p>
                </div>
              </div>
            </div>

            {/* Uptime Card */}
            <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Uptime</h3>
              <div className="flex items-center gap-4">
                <Clock className="w-10 h-10 text-green-400" />
                <div>
                  <p className="text-3xl font-bold text-white">
                    {metrics?.uptimeFormatted || '---'}
                  </p>
                  <p className="text-sm text-gray-400">Server uptime</p>
                </div>
              </div>
            </div>

            {/* CPU Card */}
            <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-400 mb-4">CPU</h3>
              <div className="flex items-center gap-4">
                <Cpu className="w-10 h-10 text-yellow-400" />
                <div>
                  <p className="text-3xl font-bold text-white">{metrics?.cpu?.limit || '---'}</p>
                  <p className="text-sm text-gray-400">Allocated</p>
                </div>
              </div>
            </div>

            {/* Memory Card */}
            <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Memory</h3>
              <div className="flex items-center gap-4">
                <HardDrive className="w-10 h-10 text-purple-400" />
                <div>
                  <p className="text-3xl font-bold text-white">{metrics?.memory?.limit || '---'}</p>
                  <p className="text-sm text-gray-400">Allocated</p>
                </div>
              </div>
            </div>

            {/* Restarts Card */}
            <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Restarts</h3>
              <div className="flex items-center gap-4">
                <RotateCcw className="w-10 h-10 text-orange-400" />
                <div>
                  <p className="text-3xl font-bold text-white">
                    {metrics?.restartCount ?? podStatus?.restartCount ?? 0}
                  </p>
                  <p className="text-sm text-gray-400">Container restarts</p>
                </div>
              </div>
            </div>

            {/* Pod Conditions */}
            {podStatus?.conditions && podStatus.conditions.length > 0 && (
              <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-5 md:col-span-2 lg:col-span-3">
                <h3 className="text-sm font-medium text-gray-400 mb-4">Pod Conditions</h3>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                  {podStatus.conditions.map((condition, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-2 bg-gray-700/50 rounded-lg"
                    >
                      <div
                        className={`w-2 h-2 rounded-full ${condition.status === 'True' ? 'bg-green-500' : 'bg-red-500'}`}
                      />
                      <span className="text-sm text-white">{condition.type}</span>
                      <span
                        className={`text-xs ${condition.status === 'True' ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {condition.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'console' && (
          <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl">
            {/* Console Header with View Switcher */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-4">
                {/* View Switcher */}
                <div className="flex items-center gap-1 bg-gray-900/50 rounded-lg p-1">
                  <button
                    onClick={() => setConsoleView('live')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                      consoleView === 'live'
                        ? 'bg-green-500/20 text-green-400'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Terminal className="w-4 h-4" />
                    Live Console
                  </button>
                  <button
                    onClick={() => {
                      setConsoleView('files');
                      if (logFiles.length === 0) {
                        void fetchLogFiles();
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                      consoleView === 'files'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <FolderOpen className="w-4 h-4" />
                    Log Files
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {consoleView === 'live' && (
                  <>
                    <button
                      onClick={() => setShowSearch(!showSearch)}
                      className={`p-1.5 rounded transition-colors ${showSearch ? 'text-blue-400 bg-blue-500/20' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                      title="Search logs"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleDownloadLogs}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      title="Download logs"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleShareLogs}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      title="Share logs"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={clearLogs}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      title="Clear logs"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={refreshLogs}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      title="Refresh logs"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </>
                )}
                {consoleView === 'files' && (
                  <button
                    onClick={fetchLogFiles}
                    disabled={loadingLogFiles}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    title="Refresh file list"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingLogFiles ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            </div>

            {/* Live Console View */}
            {consoleView === 'live' && (
              <>
                {/* Filter Tabs */}
                <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-700 bg-gray-900/30">
                  {[
                    { id: 'all' as LogLevel, label: 'All', icon: Terminal, count: logCounts.all },
                    {
                      id: 'error' as LogLevel,
                      label: 'Errors',
                      icon: AlertCircle,
                      count: logCounts.error,
                    },
                    {
                      id: 'warn' as LogLevel,
                      label: 'Warnings',
                      icon: AlertTriangle,
                      count: logCounts.warn - logCounts.error,
                    },
                    {
                      id: 'info' as LogLevel,
                      label: 'Info',
                      icon: Info,
                      count: logCounts.info - logCounts.warn,
                    },
                  ].map(({ id, label, icon: Icon, count }) => (
                    <button
                      key={id}
                      onClick={() => setLogFilter(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        logFilter === id
                          ? id === 'error'
                            ? 'bg-red-500/20 text-red-400'
                            : id === 'warn'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-blue-500/20 text-blue-400'
                          : 'text-gray-400 hover:text-white hover:bg-gray-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                      {count > 0 && (
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-xs ${
                            logFilter === id ? 'bg-white/20' : 'bg-gray-700'
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Search Bar */}
                {showSearch && (
                  <div className="px-4 py-2 border-b border-gray-700 bg-gray-900/30">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <input
                        type="text"
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        placeholder="Search logs..."
                        className="w-full pl-10 pr-10 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
                        autoFocus
                      />
                      {logSearch && (
                        <button
                          onClick={() => setLogSearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {logSearch && (
                      <p className="text-xs text-gray-500 mt-1">
                        Found {filteredEntries.filter((e) => e.type === 'log').length} matching logs
                      </p>
                    )}
                  </div>
                )}

                {/* Share URL Modal */}
                {shareUrl && (
                  <div className="px-4 py-3 border-b border-gray-700 bg-blue-500/10">
                    <div className="flex items-center gap-3">
                      <LinkIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={shareUrl}
                        readOnly
                        className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                      />
                      <button
                        onClick={copyShareUrl}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
                      >
                        {copiedShareUrl ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                        {copiedShareUrl ? 'Copied!' : 'Copy'}
                      </button>
                      <button
                        onClick={() => setShareUrl(null)}
                        className="p-1.5 text-gray-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Log Content */}
                <div
                  className="h-[450px] overflow-auto p-4 font-mono text-sm"
                  onScroll={(e) => {
                    const target = e.target as HTMLDivElement;
                    const isAtBottom =
                      target.scrollHeight - target.scrollTop - target.clientHeight < 50;
                    autoScrollRef.current = isAtBottom;
                  }}
                >
                  {filteredEntries.length === 0 ? (
                    <p className="text-gray-500">
                      {consoleEntries.length === 0
                        ? 'Waiting for server logs...'
                        : 'No logs match your filter'}
                    </p>
                  ) : (
                    filteredEntries.map((entry, idx) => {
                      if (entry.type === 'log') {
                        // Highlight search matches
                        let content = entry.content;
                        if (logSearch) {
                          const regex = new RegExp(`(${logSearch})`, 'gi');
                          content = content.replace(regex, '§HIGHLIGHT§$1§/HIGHLIGHT§');
                        }

                        const levelColors = {
                          error: 'text-red-400 bg-red-500/10',
                          warn: 'text-yellow-400 bg-yellow-500/5',
                          info: 'text-gray-300',
                          debug: 'text-gray-500',
                        };

                        return (
                          <div
                            key={idx}
                            className={`whitespace-pre-wrap hover:bg-gray-700/50 px-2 py-0.5 rounded ${levelColors[entry.level || 'info']}`}
                          >
                            {logSearch
                              ? content.split('§HIGHLIGHT§').map((part, i) => {
                                  if (part.includes('§/HIGHLIGHT§')) {
                                    const [highlighted, rest] = part.split('§/HIGHLIGHT§');
                                    return (
                                      <span key={i}>
                                        <mark className="bg-yellow-500/50 text-white rounded px-0.5">
                                          {highlighted}
                                        </mark>
                                        {rest}
                                      </span>
                                    );
                                  }
                                  return <span key={i}>{part}</span>;
                                })
                              : entry.content}
                          </div>
                        );
                      } else if (entry.type === 'command') {
                        return (
                          <div
                            key={idx}
                            className="text-green-400 mt-2 px-2 py-1 bg-green-500/10 rounded"
                          >
                            <span className="text-gray-500">
                              [{entry.timestamp.toLocaleTimeString()}]
                            </span>{' '}
                            $ {entry.content}
                          </div>
                        );
                      } else if (entry.type === 'result') {
                        return (
                          <div
                            key={idx}
                            className="text-cyan-400 pl-4 whitespace-pre-wrap px-2 py-0.5"
                          >
                            {entry.content}
                          </div>
                        );
                      } else if (entry.type === 'error') {
                        return (
                          <div
                            key={idx}
                            className="text-red-400 pl-4 whitespace-pre-wrap px-2 py-0.5"
                          >
                            Error: {entry.content}
                          </div>
                        );
                      }
                      return null;
                    })
                  )}
                  <div ref={consoleEndRef} />
                </div>
              </>
            )}

            {/* Log Files View */}
            {consoleView === 'files' && (
              <div className="min-h-[500px]">
                {selectedLogFile ? (
                  // File Content Viewer
                  <div>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-900/30">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setSelectedLogFile(null);
                            setSelectedFileContent([]);
                          }}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <FileText className="w-4 h-4 text-blue-400" />
                        <span className="text-white font-medium">{selectedLogFile}</span>
                      </div>
                      <button
                        onClick={() => handleDownloadLogFile(selectedLogFile)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    </div>
                    <div className="h-[450px] overflow-auto p-4 font-mono text-sm">
                      {loadingFileContent ? (
                        <div className="flex items-center justify-center h-full">
                          <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
                        </div>
                      ) : (
                        selectedFileContent.map((line, idx) => (
                          <div
                            key={idx}
                            className={`whitespace-pre-wrap hover:bg-gray-700/50 px-2 py-0.5 rounded ${
                              line.toLowerCase().includes('error') ||
                              line.toLowerCase().includes('exception')
                                ? 'text-red-400 bg-red-500/10'
                                : line.toLowerCase().includes('warn')
                                  ? 'text-yellow-400'
                                  : 'text-gray-300'
                            }`}
                          >
                            {line}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  // File List Table
                  <div className="p-4">
                    {loadingLogFiles ? (
                      <div className="flex items-center justify-center py-12">
                        <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
                      </div>
                    ) : logFiles.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No log files found</p>
                      </div>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-gray-400 text-sm border-b border-gray-700">
                            <th className="pb-3 font-medium">File Name</th>
                            <th className="pb-3 font-medium">Size</th>
                            <th className="pb-3 font-medium">Modified</th>
                            <th className="pb-3 font-medium w-24">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logFiles.map((file) => (
                            <tr
                              key={file.name}
                              className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors"
                            >
                              <td className="py-3">
                                <div className="flex items-center gap-2">
                                  <FileText
                                    className={`w-4 h-4 ${file.name === 'latest.log' ? 'text-green-400' : 'text-gray-400'}`}
                                  />
                                  <span
                                    className={`${file.name === 'latest.log' ? 'text-green-400 font-medium' : 'text-white'}`}
                                  >
                                    {file.name}
                                  </span>
                                  {file.name === 'latest.log' && (
                                    <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                                      Current
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 text-gray-400">{file.size}</td>
                              <td className="py-3 text-gray-400">{file.modified}</td>
                              <td className="py-3">
                                <button
                                  onClick={() => fetchLogFileContent(file.name)}
                                  className="flex items-center gap-1 px-2 py-1 text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                                >
                                  <Eye className="w-4 h-4" />
                                  View
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Command Input - Only show for live console */}
            {consoleView === 'live' && (
              <form onSubmit={handleExecuteCommand} className="p-4 border-t border-gray-700">
                {server.phase?.toLowerCase() !== 'running' && (
                  <div className="mb-3 px-3 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
                    Console commands are only available when the server is running.
                    {server.phase?.toLowerCase() === 'starting' &&
                      ' Please wait for the server to finish starting.'}
                    {server.phase?.toLowerCase() === 'stopped' &&
                      ' Start the server to use console commands.'}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder={
                      server.phase?.toLowerCase() === 'running'
                        ? 'Enter command (e.g., list, say Hello, time set day)'
                        : 'Server must be running to execute commands'
                    }
                    disabled={isExecutingCommand || server.phase?.toLowerCase() !== 'running'}
                    className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled={
                      isExecutingCommand ||
                      !command.trim() ||
                      server.phase?.toLowerCase() !== 'running'
                    }
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    {isExecutingCommand ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {activeTab === 'players' && (
          <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl">
            {selectedPlayer ? (
              <div className="p-6">
                <PlayerView
                  player={selectedPlayer}
                  serverName={serverName!}
                  onBack={handlePlayerBack}
                  onRefresh={refreshSelectedPlayer}
                  isLoading={playersLoading}
                />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-medium text-gray-400">Online Players</h3>
                    {playersData && (
                      <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full text-xs">
                        {playersData.online} / {playersData.max}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => fetchPlayers(true)}
                    disabled={playersLoading}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${playersLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <div className="p-4">
                  {server.phase?.toLowerCase() !== 'running' ? (
                    <div className="text-center py-8">
                      <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-400">Server is not running</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Start the server to see online players
                      </p>
                    </div>
                  ) : !playersData ? (
                    <div className="text-center py-8">
                      <RefreshCw className="w-8 h-8 text-gray-500 animate-spin mx-auto mb-3" />
                      <p className="text-gray-400">Loading players...</p>
                    </div>
                  ) : playersData.players.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-400">No players online</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Players will appear here when they join
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {playersData.players.map((player) => (
                        <button
                          key={player.name}
                          onClick={() => handlePlayerSelect(player.name)}
                          className="flex items-center gap-4 p-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors text-left w-full"
                        >
                          <img
                            src={`https://mc-heads.net/avatar/${player.name}/48`}
                            alt={player.name}
                            className="w-12 h-12 rounded-lg border-2 border-gray-600"
                            style={{ imageRendering: 'pixelated' }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium truncate">{player.name}</p>
                            <div className="flex items-center gap-3 mt-1">
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${
                                  player.gameMode === 0
                                    ? 'bg-green-500/20 text-green-400'
                                    : player.gameMode === 1
                                      ? 'bg-yellow-500/20 text-yellow-400'
                                      : player.gameMode === 2
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-purple-500/20 text-purple-400'
                                }`}
                              >
                                {player.gameModeName}
                              </span>
                              <span className="flex items-center gap-1 text-xs text-gray-400">
                                <Heart className="w-3 h-3 text-red-400" />
                                {player.health}/{player.maxHealth}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-gray-500" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'management' && (
          <PlayerManagement
            serverName={serverName!}
            isRunning={server.phase?.toLowerCase() === 'running'}
          />
        )}

        {activeTab === 'config' && (
          <ServerConfigEditor
            server={server}
            onUpdate={(updatedServer) => setServer(updatedServer)}
          />
        )}
      </main>
    </div>
  );
}
