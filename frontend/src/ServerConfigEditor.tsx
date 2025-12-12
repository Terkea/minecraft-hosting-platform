import React, { useState, useEffect } from 'react';
import { Server, ServerConfig, ServerType, LevelType, UpdateServerRequest } from './types';
import { updateServer } from './api';
import { LiveSettings } from './LiveSettings';
import { Zap, RotateCcw, AlertTriangle } from 'lucide-react';

interface ServerConfigEditorProps {
  server: Server;
  onUpdate: (server: Server) => void;
}

type ConfigTab = 'live' | 'restart';

// Server type options with descriptions
const SERVER_TYPES: { value: ServerType; label: string; description: string }[] = [
  { value: 'VANILLA', label: 'Vanilla', description: 'Official Minecraft server' },
  { value: 'PAPER', label: 'Paper', description: 'High-performance fork with plugins' },
  { value: 'SPIGOT', label: 'Spigot', description: 'CraftBukkit fork with plugins' },
  { value: 'BUKKIT', label: 'Bukkit', description: 'Original plugin API server' },
  { value: 'PURPUR', label: 'Purpur', description: 'Paper fork with extra features' },
  { value: 'FORGE', label: 'Forge', description: 'Most popular mod loader' },
  { value: 'FABRIC', label: 'Fabric', description: 'Lightweight mod loader' },
  { value: 'QUILT', label: 'Quilt', description: 'Fabric fork' },
  { value: 'NEOFORGE', label: 'NeoForge', description: 'Community Forge fork' },
];

const GAMEMODES = [
  { value: 'survival', label: 'Survival' },
  { value: 'creative', label: 'Creative' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'spectator', label: 'Spectator' },
];

const DIFFICULTIES = [
  { value: 'peaceful', label: 'Peaceful' },
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
];

const LEVEL_TYPES: { value: LevelType; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'flat', label: 'Flat' },
  { value: 'largeBiomes', label: 'Large Biomes' },
  { value: 'amplified', label: 'Amplified' },
  { value: 'singleBiome', label: 'Single Biome' },
];

export function ServerConfigEditor({ server, onUpdate }: ServerConfigEditorProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>('live');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [serverType, setServerType] = useState<ServerType>(server.serverType || 'VANILLA');
  const [version, setVersion] = useState(server.version || 'LATEST');
  const [config, setConfig] = useState<Partial<ServerConfig>>({});

  const isRunning = server.phase?.toLowerCase() === 'running';

  // Initialize config from server
  useEffect(() => {
    if (server.config) {
      setConfig(server.config);
    }
    setServerType(server.serverType || 'VANILLA');
    setVersion(server.version || 'LATEST');
  }, [server]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const updates: UpdateServerRequest = {
        serverType,
        version,
        ...config,
      };

      const updatedServer = await updateServer(server.name, updates);
      onUpdate(updatedServer);
      setIsEditing(false);
      setSuccessMessage(
        'Configuration updated successfully. Server may need restart for some changes.'
      );
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to update configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset to server values
    if (server.config) {
      setConfig(server.config);
    }
    setServerType(server.serverType || 'VANILLA');
    setVersion(server.version || 'LATEST');
    setIsEditing(false);
    setError(null);
  };

  const updateConfig = <K extends keyof ServerConfig>(key: K, value: ServerConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // Read-only view with tabs
  if (!isEditing) {
    return (
      <div className="space-y-4">
        {/* Tab Navigation */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl">
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setActiveTab('live')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'live'
                  ? 'border-green-500 text-green-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Zap className="w-4 h-4" />
              Live Settings
              {isRunning && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                  Instant
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('restart')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'restart'
                  ? 'border-yellow-500 text-yellow-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              Server Properties
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                Restart
              </span>
            </button>
          </div>
        </div>

        {/* Live Settings Tab */}
        {activeTab === 'live' && <LiveSettings serverName={server.name} isRunning={isRunning} />}

        {/* Restart-Required Settings Tab */}
        {activeTab === 'restart' && (
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-semibold text-white">Server Properties</h3>
                <p className="text-sm text-gray-400 mt-1">
                  These settings are stored in server.properties and require a restart to apply.
                </p>
              </div>
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Edit Configuration
              </button>
            </div>

            {successMessage && (
              <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-400">
                {successMessage}
              </div>
            )}

            {/* Restart warning */}
            <div className="mb-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-400 font-medium">Restart Required</p>
                <p className="text-sm text-gray-400">
                  Changes to these settings will only take effect after restarting the server. For
                  instant changes, use the Live Settings tab.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Server Type & Version */}
              <ConfigSection title="Server Type" requiresRestart>
                <ConfigItem label="Type" value={server.serverType || 'VANILLA'} />
                <ConfigItem label="Version" value={server.version || 'LATEST'} />
              </ConfigSection>

              {/* Player Settings */}
              <ConfigSection title="Player Settings" requiresRestart>
                <ConfigItem label="Max Players" value={config.maxPlayers?.toString() || '20'} />
                <ConfigItem
                  label="Gamemode"
                  value={config.gamemode || 'survival'}
                  capitalize
                  liveChangeable
                />
                <ConfigItem
                  label="Difficulty"
                  value={config.difficulty || 'normal'}
                  capitalize
                  liveChangeable
                />
                <ConfigItem label="Force Gamemode" value={config.forceGamemode ? 'Yes' : 'No'} />
                <ConfigItem label="Hardcore" value={config.hardcoreMode ? 'Yes' : 'No'} />
              </ConfigSection>

              {/* World Settings */}
              <ConfigSection title="World Settings" requiresRestart>
                <ConfigItem label="World Name" value={config.levelName || 'world'} />
                <ConfigItem label="Seed" value={config.levelSeed || 'Random'} />
                <ConfigItem label="World Type" value={config.levelType || 'default'} capitalize />
                <ConfigItem
                  label="Spawn Protection"
                  value={`${config.spawnProtection || 16} blocks`}
                />
                <ConfigItem label="View Distance" value={`${config.viewDistance || 10} chunks`} />
                <ConfigItem
                  label="Simulation Distance"
                  value={`${config.simulationDistance || 10} chunks`}
                />
              </ConfigSection>

              {/* Display Settings */}
              <ConfigSection title="Display" requiresRestart>
                <ConfigItem label="MOTD" value={config.motd || 'A Minecraft Server'} />
              </ConfigSection>

              {/* Gameplay Settings */}
              <ConfigSection title="Gameplay" requiresRestart>
                <ConfigItem
                  label="PVP"
                  value={config.pvp !== false ? 'Enabled' : 'Disabled'}
                  liveChangeable
                />
                <ConfigItem label="Flight" value={config.allowFlight ? 'Allowed' : 'Not Allowed'} />
                <ConfigItem
                  label="Command Blocks"
                  value={config.enableCommandBlock !== false ? 'Enabled' : 'Disabled'}
                />
                <ConfigItem
                  label="Generate Structures"
                  value={config.generateStructures !== false ? 'Yes' : 'No'}
                />
                <ConfigItem
                  label="Nether"
                  value={config.allowNether !== false ? 'Enabled' : 'Disabled'}
                />
              </ConfigSection>

              {/* Mob Spawning */}
              <ConfigSection title="Mob Spawning" requiresRestart>
                <ConfigItem
                  label="Animals"
                  value={config.spawnAnimals !== false ? 'Yes' : 'No'}
                  liveChangeable
                />
                <ConfigItem
                  label="Monsters"
                  value={config.spawnMonsters !== false ? 'Yes' : 'No'}
                  liveChangeable
                />
                <ConfigItem label="NPCs" value={config.spawnNpcs !== false ? 'Yes' : 'No'} />
              </ConfigSection>

              {/* Security */}
              <ConfigSection title="Security" requiresRestart>
                <ConfigItem label="Online Mode" value={config.onlineMode ? 'Yes' : 'No'} />
                <ConfigItem label="Whitelist" value={config.whiteList ? 'Enabled' : 'Disabled'} />
              </ConfigSection>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold text-white">Edit Server Configuration</h3>
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Server Type & Version */}
        <FormSection title="Server Type">
          <SelectInput
            label="Server Type"
            value={serverType}
            onChange={(v) => setServerType(v as ServerType)}
            options={SERVER_TYPES.map((t) => ({
              value: t.value,
              label: `${t.label} - ${t.description}`,
            }))}
          />
          <TextInput
            label="Version"
            value={version}
            onChange={setVersion}
            placeholder="LATEST or specific version"
          />
        </FormSection>

        {/* Player Settings */}
        <FormSection title="Player Settings">
          <NumberInput
            label="Max Players"
            value={config.maxPlayers || 20}
            onChange={(v) => updateConfig('maxPlayers', v)}
            min={1}
            max={1000}
          />
          <SelectInput
            label="Gamemode"
            value={config.gamemode || 'survival'}
            onChange={(v) => updateConfig('gamemode', v)}
            options={GAMEMODES}
          />
          <SelectInput
            label="Difficulty"
            value={config.difficulty || 'normal'}
            onChange={(v) => updateConfig('difficulty', v)}
            options={DIFFICULTIES}
          />
          <CheckboxInput
            label="Force Gamemode"
            checked={config.forceGamemode || false}
            onChange={(v) => updateConfig('forceGamemode', v)}
            description="Force players into the default gamemode on join"
          />
          <CheckboxInput
            label="Hardcore Mode"
            checked={config.hardcoreMode || false}
            onChange={(v) => updateConfig('hardcoreMode', v)}
            description="Death = permanent ban (use with caution)"
          />
        </FormSection>

        {/* World Settings */}
        <FormSection title="World Settings">
          <TextInput
            label="World Name"
            value={config.levelName || 'world'}
            onChange={(v) => updateConfig('levelName', v)}
          />
          <TextInput
            label="World Seed"
            value={config.levelSeed || ''}
            onChange={(v) => updateConfig('levelSeed', v)}
            placeholder="Leave empty for random"
          />
          <SelectInput
            label="World Type"
            value={config.levelType || 'default'}
            onChange={(v) => updateConfig('levelType', v as LevelType)}
            options={LEVEL_TYPES}
          />
          <NumberInput
            label="Spawn Protection (blocks)"
            value={config.spawnProtection ?? 16}
            onChange={(v) => updateConfig('spawnProtection', v)}
            min={0}
            max={1000}
          />
          <NumberInput
            label="View Distance (chunks)"
            value={config.viewDistance ?? 10}
            onChange={(v) => updateConfig('viewDistance', v)}
            min={3}
            max={32}
          />
          <NumberInput
            label="Simulation Distance (chunks)"
            value={config.simulationDistance ?? 10}
            onChange={(v) => updateConfig('simulationDistance', v)}
            min={3}
            max={32}
          />
        </FormSection>

        {/* Display Settings */}
        <FormSection title="Display">
          <TextInput
            label="Message of the Day (MOTD)"
            value={config.motd || ''}
            onChange={(v) => updateConfig('motd', v)}
            placeholder="A Minecraft Server"
          />
        </FormSection>

        {/* Gameplay Settings */}
        <FormSection title="Gameplay">
          <CheckboxInput
            label="Enable PVP"
            checked={config.pvp !== false}
            onChange={(v) => updateConfig('pvp', v)}
            description="Allow players to fight each other"
          />
          <CheckboxInput
            label="Allow Flight"
            checked={config.allowFlight || false}
            onChange={(v) => updateConfig('allowFlight', v)}
            description="Allow players to fly (useful for creative mode)"
          />
          <CheckboxInput
            label="Enable Command Blocks"
            checked={config.enableCommandBlock !== false}
            onChange={(v) => updateConfig('enableCommandBlock', v)}
          />
          <CheckboxInput
            label="Generate Structures"
            checked={config.generateStructures !== false}
            onChange={(v) => updateConfig('generateStructures', v)}
            description="Villages, temples, etc."
          />
          <CheckboxInput
            label="Allow Nether"
            checked={config.allowNether !== false}
            onChange={(v) => updateConfig('allowNether', v)}
            description="Enable the Nether dimension"
          />
        </FormSection>

        {/* Mob Spawning */}
        <FormSection title="Mob Spawning">
          <CheckboxInput
            label="Spawn Animals"
            checked={config.spawnAnimals !== false}
            onChange={(v) => updateConfig('spawnAnimals', v)}
          />
          <CheckboxInput
            label="Spawn Monsters"
            checked={config.spawnMonsters !== false}
            onChange={(v) => updateConfig('spawnMonsters', v)}
          />
          <CheckboxInput
            label="Spawn NPCs"
            checked={config.spawnNpcs !== false}
            onChange={(v) => updateConfig('spawnNpcs', v)}
            description="Villagers and wandering traders"
          />
        </FormSection>

        {/* Security */}
        <FormSection title="Security">
          <CheckboxInput
            label="Online Mode"
            checked={config.onlineMode || false}
            onChange={(v) => updateConfig('onlineMode', v)}
            description="Require Microsoft account authentication"
          />
          <CheckboxInput
            label="Enable Whitelist"
            checked={config.whiteList || false}
            onChange={(v) => updateConfig('whiteList', v)}
            description="Only allow whitelisted players"
          />
        </FormSection>
      </div>
    </div>
  );
}

// Helper components
function ConfigSection({
  title,
  children,
  requiresRestart = false,
}: {
  title: string;
  children: React.ReactNode;
  requiresRestart?: boolean;
}) {
  return (
    <div className="bg-gray-700/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-medium text-gray-400">{title}</h4>
        {requiresRestart && (
          <span title="Requires restart">
            <RotateCcw className="w-3 h-3 text-yellow-500" />
          </span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ConfigItem({
  label,
  value,
  capitalize = false,
  liveChangeable = false,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
  liveChangeable?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-400 text-sm flex items-center gap-1.5">
        {label}
        {liveChangeable && (
          <span title="Can be changed live">
            <Zap className="w-3 h-3 text-green-500" />
          </span>
        )}
      </span>
      <span className={`text-white text-sm ${capitalize ? 'capitalize' : ''}`}>{value}</span>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-700/50 rounded-lg p-4">
      <h4 className="text-sm font-medium text-gray-300 mb-4">{title}</h4>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        min={min}
        max={max}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckboxInput({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 bg-gray-800 border-gray-600 rounded text-blue-500 focus:ring-blue-500"
      />
      <div>
        <label className="text-sm text-white">{label}</label>
        {description && <p className="text-xs text-gray-500">{description}</p>}
      </div>
    </div>
  );
}
