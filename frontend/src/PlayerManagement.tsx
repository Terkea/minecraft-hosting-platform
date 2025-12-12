import { useState, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldX,
  UserPlus,
  UserMinus,
  RefreshCw,
  AlertTriangle,
  X,
  Crown,
  Ban,
  LogOut,
  Trash2,
  Globe,
} from 'lucide-react';
import {
  getWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  toggleWhitelist,
  grantOp,
  revokeOp,
  getBanList,
  banPlayer,
  unbanPlayer,
  kickPlayer,
  getIpBanList,
  banIp,
  unbanIp,
  WhitelistResponse,
  BanListResponse,
  IpBanListResponse,
} from './api';

interface PlayerManagementProps {
  serverName: string;
  isRunning: boolean;
}

type ManagementTab = 'whitelist' | 'ops' | 'bans' | 'ip-bans';

export function PlayerManagement({ serverName, isRunning }: PlayerManagementProps) {
  const [activeTab, setActiveTab] = useState<ManagementTab>('whitelist');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Whitelist state
  const [whitelist, setWhitelist] = useState<WhitelistResponse | null>(null);
  const [whitelistInput, setWhitelistInput] = useState('');
  const [whitelistEnabled, setWhitelistEnabled] = useState(true);

  // Ops state
  const [opInput, setOpInput] = useState('');
  const [opPlayers, setOpPlayers] = useState<string[]>([]);

  // Ban state
  const [banList, setBanList] = useState<BanListResponse | null>(null);
  const [banInput, setBanInput] = useState('');
  const [banReason, setBanReason] = useState('');

  // IP Ban state
  const [ipBanList, setIpBanList] = useState<IpBanListResponse | null>(null);
  const [ipBanInput, setIpBanInput] = useState('');
  const [ipBanReason, setIpBanReason] = useState('');

  // Kick state
  const [kickInput, setKickInput] = useState('');
  const [kickReason, setKickReason] = useState('');
  const [showKickModal, setShowKickModal] = useState(false);

  useEffect(() => {
    if (isRunning) {
      void loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverName, activeTab, isRunning]);

  const loadData = async () => {
    if (!isRunning) return;

    setLoading(true);
    setError(null);

    try {
      switch (activeTab) {
        case 'whitelist': {
          const wl = await getWhitelist(serverName);
          setWhitelist(wl);
          break;
        }
        case 'bans': {
          const bl = await getBanList(serverName);
          setBanList(bl);
          break;
        }
        case 'ip-bans': {
          const ipbl = await getIpBanList(serverName);
          setIpBanList(ipbl);
          break;
        }
        case 'ops':
          // Ops list can't be fetched directly, maintain locally
          break;
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const showSuccessMessage = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  // Whitelist handlers
  const handleAddToWhitelist = async () => {
    if (!whitelistInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await addToWhitelist(serverName, whitelistInput.trim());
      showSuccessMessage(`Added ${whitelistInput.trim()} to whitelist`);
      setWhitelistInput('');
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFromWhitelist = async (player: string) => {
    setLoading(true);
    setError(null);
    try {
      await removeFromWhitelist(serverName, player);
      showSuccessMessage(`Removed ${player} from whitelist`);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleWhitelist = async () => {
    setLoading(true);
    setError(null);
    try {
      await toggleWhitelist(serverName, !whitelistEnabled);
      setWhitelistEnabled(!whitelistEnabled);
      showSuccessMessage(`Whitelist ${!whitelistEnabled ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Op handlers
  const handleGrantOp = async () => {
    if (!opInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await grantOp(serverName, opInput.trim());
      showSuccessMessage(`Granted operator to ${opInput.trim()}`);
      setOpPlayers((prev) => [...prev, opInput.trim()]);
      setOpInput('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeOp = async (player: string) => {
    setLoading(true);
    setError(null);
    try {
      await revokeOp(serverName, player);
      showSuccessMessage(`Revoked operator from ${player}`);
      setOpPlayers((prev) => prev.filter((p) => p !== player));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Ban handlers
  const handleBanPlayer = async () => {
    if (!banInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await banPlayer(serverName, banInput.trim(), banReason || undefined);
      showSuccessMessage(`Banned ${banInput.trim()}`);
      setBanInput('');
      setBanReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnbanPlayer = async (player: string) => {
    setLoading(true);
    setError(null);
    try {
      await unbanPlayer(serverName, player);
      showSuccessMessage(`Unbanned ${player}`);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // IP Ban handlers
  const handleBanIp = async () => {
    if (!ipBanInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await banIp(serverName, ipBanInput.trim(), ipBanReason || undefined);
      showSuccessMessage(`Banned IP ${ipBanInput.trim()}`);
      setIpBanInput('');
      setIpBanReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnbanIp = async (ip: string) => {
    setLoading(true);
    setError(null);
    try {
      await unbanIp(serverName, ip);
      showSuccessMessage(`Unbanned IP ${ip}`);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Kick handler
  const handleKickPlayer = async () => {
    if (!kickInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await kickPlayer(serverName, kickInput.trim(), kickReason || undefined);
      showSuccessMessage(`Kicked ${kickInput.trim()}`);
      setKickInput('');
      setKickReason('');
      setShowKickModal(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isRunning) {
    return (
      <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-6">
        <div className="text-center py-8">
          <Shield className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">Server is not running</p>
          <p className="text-sm text-gray-500 mt-1">Start the server to manage players</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl">
      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        {[
          { id: 'whitelist', label: 'Whitelist', icon: Shield },
          { id: 'ops', label: 'Operators', icon: Crown },
          { id: 'bans', label: 'Bans', icon: Ban },
          { id: 'ip-bans', label: 'IP Bans', icon: Globe },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as ManagementTab)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-green-500 text-green-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
        {/* Kick button in header */}
        <div className="ml-auto flex items-center px-4">
          <button
            onClick={() => setShowKickModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Kick Player
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="mx-4 mt-4 p-3 bg-green-500/20 border border-green-500/30 rounded-lg flex items-center gap-2 text-green-400">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {/* Whitelist Tab */}
        {activeTab === 'whitelist' && (
          <div className="space-y-4">
            {/* Toggle and Add */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleToggleWhitelist}
                  disabled={loading}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    whitelistEnabled
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                  }`}
                >
                  {whitelistEnabled ? (
                    <ShieldCheck className="w-4 h-4" />
                  ) : (
                    <ShieldX className="w-4 h-4" />
                  )}
                  Whitelist {whitelistEnabled ? 'On' : 'Off'}
                </button>
              </div>

              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={whitelistInput}
                  onChange={(e) => setWhitelistInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddToWhitelist()}
                  placeholder="Player username"
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                />
                <button
                  onClick={handleAddToWhitelist}
                  disabled={loading || !whitelistInput.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  Add
                </button>
              </div>

              <button
                onClick={loadData}
                disabled={loading}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Player List */}
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-gray-700/50 border-b border-gray-700">
                <span className="text-sm text-gray-400">
                  {whitelist?.count ?? 0} whitelisted players
                </span>
              </div>
              <div className="max-h-64 overflow-auto">
                {loading && !whitelist ? (
                  <div className="p-4 text-center text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading...
                  </div>
                ) : whitelist?.players.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">No players on whitelist</div>
                ) : (
                  <div className="divide-y divide-gray-700">
                    {whitelist?.players.map((player) => (
                      <div
                        key={player}
                        className="flex items-center justify-between px-4 py-2 hover:bg-gray-700/50"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={`https://mc-heads.net/avatar/${player}/32`}
                            alt={player}
                            className="w-8 h-8 rounded"
                            style={{ imageRendering: 'pixelated' }}
                          />
                          <span className="text-white">{player}</span>
                        </div>
                        <button
                          onClick={() => handleRemoveFromWhitelist(player)}
                          disabled={loading}
                          className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded transition-colors"
                          title="Remove from whitelist"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Operators Tab */}
        {activeTab === 'ops' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Grant or revoke operator (admin) status for players. Operators can run server
              commands.
            </p>

            {/* Add Op */}
            <div className="flex gap-2">
              <input
                type="text"
                value={opInput}
                onChange={(e) => setOpInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGrantOp()}
                placeholder="Player username"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
              />
              <button
                onClick={handleGrantOp}
                disabled={loading || !opInput.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-600/50 text-white rounded-lg transition-colors"
              >
                <Crown className="w-4 h-4" />
                Grant OP
              </button>
            </div>

            {/* Recent Ops */}
            {opPlayers.length > 0 && (
              <div className="border border-gray-700 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-gray-700/50 border-b border-gray-700">
                  <span className="text-sm text-gray-400">
                    Recently opped players (this session)
                  </span>
                </div>
                <div className="divide-y divide-gray-700">
                  {opPlayers.map((player) => (
                    <div
                      key={player}
                      className="flex items-center justify-between px-4 py-2 hover:bg-gray-700/50"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={`https://mc-heads.net/avatar/${player}/32`}
                          alt={player}
                          className="w-8 h-8 rounded"
                          style={{ imageRendering: 'pixelated' }}
                        />
                        <span className="text-white">{player}</span>
                        <Crown className="w-4 h-4 text-yellow-500" />
                      </div>
                      <button
                        onClick={() => handleRevokeOp(player)}
                        disabled={loading}
                        className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded transition-colors"
                        title="Revoke operator"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
              <strong>Note:</strong> The operator list cannot be fetched live from the server. Use
              the console to run <code className="bg-gray-800 px-1 rounded">op &lt;player&gt;</code>{' '}
              or <code className="bg-gray-800 px-1 rounded">deop &lt;player&gt;</code> for full
              control.
            </div>
          </div>
        )}

        {/* Bans Tab */}
        {activeTab === 'bans' && (
          <div className="space-y-4">
            {/* Ban Form */}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={banInput}
                onChange={(e) => setBanInput(e.target.value)}
                placeholder="Player username"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
              />
              <input
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Reason (optional)"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
              />
              <button
                onClick={handleBanPlayer}
                disabled={loading || !banInput.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
              >
                <Ban className="w-4 h-4" />
                Ban
              </button>
              <button
                onClick={loadData}
                disabled={loading}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Ban List */}
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-gray-700/50 border-b border-gray-700">
                <span className="text-sm text-gray-400">{banList?.count ?? 0} banned players</span>
              </div>
              <div className="max-h-64 overflow-auto">
                {loading && !banList ? (
                  <div className="p-4 text-center text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading...
                  </div>
                ) : banList?.players.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">No banned players</div>
                ) : (
                  <div className="divide-y divide-gray-700">
                    {banList?.players.map((player) => (
                      <div
                        key={player}
                        className="flex items-center justify-between px-4 py-2 hover:bg-gray-700/50"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={`https://mc-heads.net/avatar/${player}/32`}
                            alt={player}
                            className="w-8 h-8 rounded grayscale"
                            style={{ imageRendering: 'pixelated' }}
                          />
                          <span className="text-white">{player}</span>
                          <Ban className="w-4 h-4 text-red-500" />
                        </div>
                        <button
                          onClick={() => handleUnbanPlayer(player)}
                          disabled={loading}
                          className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                        >
                          Unban
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* IP Bans Tab */}
        {activeTab === 'ip-bans' && (
          <div className="space-y-4">
            {/* IP Ban Form */}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={ipBanInput}
                onChange={(e) => setIpBanInput(e.target.value)}
                placeholder="IP address (e.g., 192.168.1.1)"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
              />
              <input
                type="text"
                value={ipBanReason}
                onChange={(e) => setIpBanReason(e.target.value)}
                placeholder="Reason (optional)"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
              />
              <button
                onClick={handleBanIp}
                disabled={loading || !ipBanInput.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
              >
                <Globe className="w-4 h-4" />
                Ban IP
              </button>
              <button
                onClick={loadData}
                disabled={loading}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* IP Ban List */}
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-gray-700/50 border-b border-gray-700">
                <span className="text-sm text-gray-400">{ipBanList?.count ?? 0} banned IPs</span>
              </div>
              <div className="max-h-64 overflow-auto">
                {loading && !ipBanList ? (
                  <div className="p-4 text-center text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading...
                  </div>
                ) : ipBanList?.ips.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">No banned IPs</div>
                ) : (
                  <div className="divide-y divide-gray-700">
                    {ipBanList?.ips.map((ip) => (
                      <div
                        key={ip}
                        className="flex items-center justify-between px-4 py-2 hover:bg-gray-700/50"
                      >
                        <div className="flex items-center gap-3">
                          <Globe className="w-6 h-6 text-gray-500" />
                          <span className="text-white font-mono">{ip}</span>
                          <Ban className="w-4 h-4 text-red-500" />
                        </div>
                        <button
                          onClick={() => handleUnbanIp(ip)}
                          disabled={loading}
                          className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                        >
                          Unban
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
              <strong>Warning:</strong> IP bans may affect multiple players if they share an IP
              address (e.g., household members, VPN users).
            </div>
          </div>
        )}
      </div>

      {/* Kick Modal */}
      {showKickModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <LogOut className="w-5 h-5 text-yellow-500" />
                Kick Player
              </h3>
              <button
                onClick={() => setShowKickModal(false)}
                className="p-1 text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Player Username
                </label>
                <input
                  type="text"
                  value={kickInput}
                  onChange={(e) => setKickInput(e.target.value)}
                  placeholder="Enter username"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={kickReason}
                  onChange={(e) => setKickReason(e.target.value)}
                  placeholder="Enter reason"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowKickModal(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleKickPlayer}
                  disabled={loading || !kickInput.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-600/50 text-white rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  {loading ? 'Kicking...' : 'Kick'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
