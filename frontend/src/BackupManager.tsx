import { useState, useEffect } from 'react';
import {
  Archive,
  Plus,
  RefreshCw,
  Download,
  RotateCcw,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  HardDrive,
  Calendar,
  Tag,
  Settings,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import {
  listBackups,
  createBackup,
  deleteBackup,
  restoreBackup,
  getBackupSchedule,
  setBackupSchedule,
  type Backup,
  type BackupSchedule,
} from './api';

interface BackupManagerProps {
  serverName: string;
  isRunning: boolean;
}

// Format bytes to human-readable
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

// Format date to relative time
const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Format date to full timestamp
const formatFullDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleString();
};

// Status badge component
const StatusBadge = ({ status }: { status: Backup['status'] }) => {
  const config = {
    pending: { icon: Clock, color: 'text-yellow-400 bg-yellow-500/20', label: 'Pending' },
    in_progress: { icon: Loader2, color: 'text-blue-400 bg-blue-500/20', label: 'In Progress' },
    completed: { icon: CheckCircle, color: 'text-green-400 bg-green-500/20', label: 'Completed' },
    failed: { icon: XCircle, color: 'text-red-400 bg-red-500/20', label: 'Failed' },
  }[status];

  const Icon = config.icon;
  const isSpinning = status === 'in_progress';

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
    >
      <Icon className={`w-3 h-3 ${isSpinning ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  );
};

export function BackupManager({ serverName, isRunning }: BackupManagerProps) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Create backup modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [backupName, setBackupName] = useState('');
  const [backupDescription, setBackupDescription] = useState('');

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'restore' | 'delete';
    backup: Backup;
  } | null>(null);

  // Schedule settings state
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState(24);
  const [scheduleRetention, setScheduleRetention] = useState(7);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await listBackups(serverName);
      setBackups(response.backups);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSchedule = async () => {
    try {
      const scheduleData = await getBackupSchedule(serverName);
      setSchedule(scheduleData);
      setScheduleEnabled(scheduleData.enabled);
      setScheduleInterval(scheduleData.intervalHours);
      setScheduleRetention(scheduleData.retentionCount);
    } catch (err) {
      console.error('Failed to fetch schedule:', err);
    }
  };

  // Initial data fetch
  useEffect(() => {
    fetchBackups();
    fetchSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverName]);

  // Poll for updates only when there are pending/in_progress backups
  const hasPendingBackups = backups.some(
    (b) => b.status === 'pending' || b.status === 'in_progress'
  );
  useEffect(() => {
    if (!hasPendingBackups) return;

    const interval = setInterval(fetchBackups, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverName, hasPendingBackups]);

  const showSuccessMessage = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 5000);
  };

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      setError(null);
      await createBackup(serverName, {
        name: backupName || undefined,
        description: backupDescription || undefined,
      });
      showSuccessMessage('Backup creation started');
      setShowCreateModal(false);
      setBackupName('');
      setBackupDescription('');
      await fetchBackups();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (backup: Backup) => {
    try {
      setActionInProgress(backup.id);
      setError(null);
      await restoreBackup(backup.id);
      showSuccessMessage(`Restore from "${backup.name}" initiated`);
      setConfirmAction(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (backup: Backup) => {
    try {
      setActionInProgress(backup.id);
      setError(null);
      await deleteBackup(backup.id);
      showSuccessMessage(`Backup "${backup.name}" deleted`);
      setConfirmAction(null);
      await fetchBackups();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDownload = (backup: Backup) => {
    // Open download URL directly - bypasses Vite proxy buffering for large files
    window.open(`http://localhost:8080/api/v1/backups/${backup.id}/download`, '_blank');
    showSuccessMessage(`Download started for "${backup.name}"`);
  };

  const handleSaveSchedule = async () => {
    try {
      setSavingSchedule(true);
      setError(null);
      await setBackupSchedule(serverName, {
        enabled: scheduleEnabled,
        intervalHours: scheduleInterval,
        retentionCount: scheduleRetention,
      });
      await fetchSchedule();
      showSuccessMessage(`Auto-backup ${scheduleEnabled ? 'enabled' : 'disabled'}`);
      setShowScheduleModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  const openScheduleModal = () => {
    if (schedule) {
      setScheduleEnabled(schedule.enabled);
      setScheduleInterval(schedule.intervalHours);
      setScheduleRetention(schedule.retentionCount);
    }
    setShowScheduleModal(true);
  };

  return (
    <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Archive className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">Backups</h2>
          <span className="text-sm text-gray-400">({backups.length})</span>
          {schedule?.enabled && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">
              <Clock className="w-3 h-3" />
              Auto: Every {schedule.intervalHours}h
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchBackups}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={openScheduleModal}
            className="flex items-center gap-2 px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="Auto-backup settings"
          >
            <Settings className="w-4 h-4" />
            Schedule
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Backup
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="mx-6 mt-4 p-3 bg-green-500/20 border border-green-500/30 rounded-lg flex items-center gap-2 text-green-400">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {!isRunning && (
        <div className="mx-6 mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-2 text-yellow-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">Server must be running to create new backups</span>
        </div>
      )}

      {/* Content */}
      <div className="p-6">
        {loading && backups.length === 0 ? (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 text-gray-500 animate-spin mx-auto mb-3" />
            <p className="text-gray-400">Loading backups...</p>
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-12">
            <Archive className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 mb-2">No backups yet</p>
            <p className="text-sm text-gray-500">
              Create your first backup to protect your server data
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Size</th>
                  <th className="pb-3 font-medium">Created</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {backups.map((backup) => (
                  <tr key={backup.id} className="group hover:bg-gray-700/30">
                    <td className="py-3">
                      <div>
                        <div className="font-medium text-white">{backup.name}</div>
                        {backup.description && (
                          <div className="text-xs text-gray-500 mt-0.5">{backup.description}</div>
                        )}
                      </div>
                    </td>
                    <td className="py-3">
                      <StatusBadge status={backup.status} />
                      {backup.errorMessage && (
                        <div className="text-xs text-red-400 mt-1">{backup.errorMessage}</div>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5 text-gray-300">
                        <HardDrive className="w-4 h-4 text-gray-500" />
                        {backup.status === 'completed' ? formatBytes(backup.sizeBytes) : '-'}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5 text-gray-300">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <span title={formatFullDate(backup.startedAt)}>
                          {formatRelativeTime(backup.startedAt)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                          backup.isAutomatic
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {backup.isAutomatic ? (
                          <>
                            <Clock className="w-3 h-3" />
                            Auto
                          </>
                        ) : (
                          <>
                            <Tag className="w-3 h-3" />
                            Manual
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-1">
                        {backup.status === 'completed' && (
                          <>
                            <button
                              onClick={() => setConfirmAction({ type: 'restore', backup })}
                              disabled={actionInProgress === backup.id}
                              className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 rounded transition-colors"
                              title="Restore"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDownload(backup)}
                              disabled={actionInProgress === backup.id}
                              className="p-1.5 text-green-400 hover:text-green-300 hover:bg-green-500/20 rounded transition-colors"
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setConfirmAction({ type: 'delete', backup })}
                          disabled={
                            actionInProgress === backup.id || backup.status === 'in_progress'
                          }
                          className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Backup Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Archive className="w-5 h-5 text-blue-400" />
                Create Backup
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-gray-400 hover:text-white"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Backup Name (optional)
                </label>
                <input
                  type="text"
                  value={backupName}
                  onChange={(e) => setBackupName(e.target.value)}
                  placeholder={`backup-${Date.now()}`}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={backupDescription}
                  onChange={(e) => setBackupDescription(e.target.value)}
                  placeholder="e.g., Before installing new mods"
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-400 text-sm">
                <strong>Note:</strong> Creating a backup will temporarily pause the server to ensure
                data consistency.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateBackup}
                  disabled={creating}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4" />
                      Create Backup
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Action Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center gap-3 mb-4">
              {confirmAction.type === 'restore' ? (
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <RotateCcw className="w-6 h-6 text-blue-400" />
                </div>
              ) : (
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <Trash2 className="w-6 h-6 text-red-400" />
                </div>
              )}
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {confirmAction.type === 'restore' ? 'Restore Backup' : 'Delete Backup'}
                </h3>
                <p className="text-sm text-gray-400">{confirmAction.backup.name}</p>
              </div>
            </div>

            <p className="text-gray-300 mb-6">
              {confirmAction.type === 'restore' ? (
                <>
                  Are you sure you want to restore from this backup? This will{' '}
                  <span className="text-yellow-400 font-medium">stop the server</span> and replace
                  all current data.
                </>
              ) : (
                <>
                  Are you sure you want to delete this backup? This action{' '}
                  <span className="text-red-400 font-medium">cannot be undone</span>.
                </>
              )}
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmAction.type === 'restore') {
                    handleRestore(confirmAction.backup);
                  } else {
                    handleDelete(confirmAction.backup);
                  }
                }}
                disabled={actionInProgress === confirmAction.backup.id}
                className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors ${
                  confirmAction.type === 'restore'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {actionInProgress === confirmAction.backup.id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {confirmAction.type === 'restore' ? 'Restoring...' : 'Deleting...'}
                  </>
                ) : (
                  <>
                    {confirmAction.type === 'restore' ? (
                      <>
                        <RotateCcw className="w-4 h-4" />
                        Restore
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </>
                    )}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Settings Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-400" />
                Auto-Backup Settings
              </h3>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="p-1 text-gray-400 hover:text-white"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                <div>
                  <div className="font-medium text-white">Enable Auto-Backup</div>
                  <div className="text-sm text-gray-400">Automatically backup your server</div>
                </div>
                <button onClick={() => setScheduleEnabled(!scheduleEnabled)} className="text-2xl">
                  {scheduleEnabled ? (
                    <ToggleRight className="w-10 h-10 text-green-400" />
                  ) : (
                    <ToggleLeft className="w-10 h-10 text-gray-500" />
                  )}
                </button>
              </div>

              {/* Interval Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Backup Interval
                </label>
                <select
                  value={scheduleInterval}
                  onChange={(e) => setScheduleInterval(Number(e.target.value))}
                  disabled={!scheduleEnabled}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white disabled:opacity-50 focus:outline-none focus:border-blue-500"
                >
                  <option value={1}>Every hour</option>
                  <option value={6}>Every 6 hours</option>
                  <option value={12}>Every 12 hours</option>
                  <option value={24}>Daily (every 24 hours)</option>
                  <option value={48}>Every 2 days</option>
                  <option value={168}>Weekly</option>
                </select>
              </div>

              {/* Retention Count */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Keep Last N Backups
                </label>
                <select
                  value={scheduleRetention}
                  onChange={(e) => setScheduleRetention(Number(e.target.value))}
                  disabled={!scheduleEnabled}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white disabled:opacity-50 focus:outline-none focus:border-blue-500"
                >
                  <option value={3}>3 backups</option>
                  <option value={5}>5 backups</option>
                  <option value={7}>7 backups</option>
                  <option value={14}>14 backups</option>
                  <option value={30}>30 backups</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Older automatic backups will be deleted to save space
                </p>
              </div>

              {/* Schedule Info */}
              {schedule?.nextBackupAt && scheduleEnabled && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-400 text-sm">
                  <strong>Next backup:</strong> {new Date(schedule.nextBackupAt).toLocaleString()}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowScheduleModal(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveSchedule}
                  disabled={savingSchedule}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                >
                  {savingSchedule ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Save Settings
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
