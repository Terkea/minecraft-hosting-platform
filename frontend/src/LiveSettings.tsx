import { useState, useEffect } from 'react';
import {
  Zap,
  Sun,
  Cloud,
  CloudRain,
  CloudLightning,
  RefreshCw,
  Skull,
  Heart,
  Package,
  Flame,
  Clock,
  Megaphone,
  Settings,
} from 'lucide-react';
import { notification } from 'antd';
import { setWeather, setTime, setGamerule, getGamerule, sayMessage } from './api';

interface LiveSettingsProps {
  serverName: string;
  isRunning: boolean;
}

const WEATHER_OPTIONS = [
  { value: 'clear', label: 'Clear', icon: Sun },
  { value: 'rain', label: 'Rain', icon: CloudRain },
  { value: 'thunder', label: 'Thunder', icon: CloudLightning },
];

const TIME_PRESETS = [
  { value: 'day', label: 'Day', time: '1000' },
  { value: 'noon', label: 'Noon', time: '6000' },
  { value: 'sunset', label: 'Sunset', time: '12000' },
  { value: 'night', label: 'Night', time: '13000' },
  { value: 'midnight', label: 'Midnight', time: '18000' },
  { value: 'sunrise', label: 'Sunrise', time: '23000' },
];

// All gamerules available in Minecraft 1.21+ (using snake_case names)
const GAMERULES = [
  // Player rules
  {
    rule: 'keep_inventory',
    label: 'Keep Inventory',
    description: 'Players keep items on death',
    icon: Package,
  },
  { rule: 'pvp', label: 'PvP', description: 'Players can damage each other', icon: Skull },
  {
    rule: 'natural_health_regeneration',
    label: 'Natural Regen',
    description: 'Health regenerates when fed',
    icon: Heart,
  },
  {
    rule: 'immediate_respawn',
    label: 'Instant Respawn',
    description: 'Skip death screen',
    icon: Heart,
  },

  // Damage rules
  {
    rule: 'fall_damage',
    label: 'Fall Damage',
    description: 'Players take fall damage',
    icon: Heart,
  },
  {
    rule: 'fire_damage',
    label: 'Fire Damage',
    description: 'Players take fire damage',
    icon: Flame,
  },
  {
    rule: 'drowning_damage',
    label: 'Drowning Damage',
    description: 'Players take drowning damage',
    icon: Heart,
  },
  {
    rule: 'freeze_damage',
    label: 'Freeze Damage',
    description: 'Players take freeze damage',
    icon: Heart,
  },

  // World rules
  {
    rule: 'advance_time',
    label: 'Daylight Cycle',
    description: 'Time passes naturally',
    icon: Sun,
  },
  {
    rule: 'advance_weather',
    label: 'Weather Cycle',
    description: 'Weather changes naturally',
    icon: Cloud,
  },
  { rule: 'spawn_mobs', label: 'Mob Spawning', description: 'Mobs spawn naturally', icon: Skull },
  { rule: 'raids', label: 'Raids', description: 'Pillager raids can occur', icon: Skull },
  { rule: 'spawn_wardens', label: 'Spawn Wardens', description: 'Wardens can spawn', icon: Skull },
  {
    rule: 'spawn_patrols',
    label: 'Spawn Patrols',
    description: 'Pillager patrols spawn',
    icon: Skull,
  },

  // Drops & explosions
  { rule: 'mob_drops', label: 'Mob Drops', description: 'Mobs drop items on death', icon: Package },
  {
    rule: 'block_drops',
    label: 'Block Drops',
    description: 'Blocks drop items when broken',
    icon: Package,
  },
  {
    rule: 'entity_drops',
    label: 'Entity Drops',
    description: 'Entities drop items',
    icon: Package,
  },
  { rule: 'tnt_explodes', label: 'TNT Explodes', description: 'TNT can explode', icon: Flame },

  // Messages
  {
    rule: 'show_advancement_messages',
    label: 'Advancements',
    description: 'Show advancement messages',
    icon: Megaphone,
  },
  {
    rule: 'show_death_messages',
    label: 'Death Messages',
    description: 'Show death messages',
    icon: Megaphone,
  },
  {
    rule: 'send_command_feedback',
    label: 'Command Feedback',
    description: 'Show command output',
    icon: Megaphone,
  },

  // Other
  {
    rule: 'allow_entering_nether_using_portals',
    label: 'Nether Portals',
    description: 'Players can use nether portals',
    icon: Flame,
  },
  {
    rule: 'ender_pearls_vanish_on_death',
    label: 'Pearls Vanish',
    description: 'Thrown ender pearls vanish on death',
    icon: Package,
  },
  {
    rule: 'command_blocks_work',
    label: 'Command Blocks',
    description: 'Command blocks can execute',
    icon: Package,
  },
  {
    rule: 'spawner_blocks_work',
    label: 'Spawners Work',
    description: 'Mob spawners can spawn mobs',
    icon: Skull,
  },
];

export function LiveSettings({ serverName, isRunning }: LiveSettingsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [gameruleValues, setGameruleValues] = useState<Record<string, boolean>>({});
  const [loadingGamerules, setLoadingGamerules] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');

  // Configure notification placement
  const [api, contextHolder] = notification.useNotification();

  // Load current gamerule values
  useEffect(() => {
    if (isRunning) {
      void loadGamerules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverName, isRunning]);

  const loadGamerules = async () => {
    setLoadingGamerules(true);
    const values: Record<string, boolean> = {};

    for (const gr of GAMERULES) {
      try {
        const result = await getGamerule(serverName, gr.rule);
        values[gr.rule] = result.toLowerCase() === 'true';
      } catch {
        // Default to true if we can't fetch
        values[gr.rule] = true;
      }
    }

    setGameruleValues(values);
    setLoadingGamerules(false);
  };

  const showSuccess = (title: string, description?: string) => {
    api.success({
      message: title,
      description,
      placement: 'topRight',
      duration: 3,
    });
  };

  const showError = (title: string, description?: string) => {
    api.error({
      message: title,
      description,
      placement: 'topRight',
      duration: 5,
    });
  };

  const handleWeather = async (weather: string) => {
    setLoading(`weather-${weather}`);
    try {
      await setWeather(serverName, weather);
      showSuccess('Weather Changed', `Weather set to ${weather}`);
    } catch (err: any) {
      showError('Weather Change Failed', err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleTime = async (time: string, label: string) => {
    setLoading(`time-${time}`);
    try {
      await setTime(serverName, time);
      showSuccess('Time Changed', `Time set to ${label}`);
    } catch (err: any) {
      showError('Time Change Failed', err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleGamerule = async (rule: string, label: string, value: boolean) => {
    setLoading(`gamerule-${rule}`);
    try {
      await setGamerule(serverName, rule, value);
      setGameruleValues((prev) => ({ ...prev, [rule]: value }));
      showSuccess('Gamerule Updated', `${label} is now ${value ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      showError('Gamerule Update Failed', err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleBroadcast = async () => {
    if (!broadcastMessage.trim()) return;
    setLoading('broadcast');
    try {
      await sayMessage(serverName, broadcastMessage);
      showSuccess('Message Sent', 'Broadcast sent to all players');
      setBroadcastMessage('');
    } catch (err: any) {
      showError('Broadcast Failed', err.message);
    } finally {
      setLoading(null);
    }
  };

  if (!isRunning) {
    return (
      <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-6">
        <div className="text-center py-8">
          <Zap className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">Server is not running</p>
          <p className="text-sm text-gray-500 mt-1">Start the server to change live settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {contextHolder}
      {/* Header with info */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Zap className="w-5 h-5 text-blue-400 mt-0.5" />
          <div>
            <h3 className="text-blue-400 font-medium">Live Settings</h3>
            <p className="text-sm text-gray-400 mt-1">
              These settings apply instantly via RCON commands.{' '}
              <strong className="text-yellow-400">Weather and Time reset</strong> when the server
              restarts. <strong className="text-green-400">Game Rules persist</strong> as they're
              saved in world data.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weather */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <h4 className="text-white font-medium mb-3 flex items-center gap-2">
            <Cloud className="w-4 h-4 text-blue-400" />
            Weather
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {WEATHER_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => handleWeather(value)}
                disabled={loading !== null}
                className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                  loading === `weather-${value}`
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                {loading === `weather-${value}` ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Time */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <h4 className="text-white font-medium mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-400" />
            Time of Day
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {TIME_PRESETS.map(({ value, label, time }) => (
              <button
                key={value}
                onClick={() => handleTime(time, label)}
                disabled={loading !== null}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  loading === `time-${time}`
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                {loading === `time-${time}` ? (
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  label
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Broadcast Message */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 lg:col-span-2">
          <h4 className="text-white font-medium mb-3 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-purple-400" />
            Broadcast Message
          </h4>
          <div className="flex gap-2">
            <input
              type="text"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleBroadcast()}
              placeholder="Type a message to send to all players..."
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={handleBroadcast}
              disabled={loading === 'broadcast' || !broadcastMessage.trim()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg transition-colors"
            >
              {loading === 'broadcast' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Gamerules */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-white font-medium flex items-center gap-2">
            <Settings className="w-4 h-4 text-orange-400" />
            Game Rules
          </h4>
          <button
            onClick={loadGamerules}
            disabled={loadingGamerules}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loadingGamerules ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loadingGamerules ? (
          <div className="text-center py-4 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading game rules...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {GAMERULES.map(({ rule, label, description, icon: Icon }) => (
              <div
                key={rule}
                className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-gray-400" />
                  <div>
                    <span className="text-white text-sm">{label}</span>
                    <p className="text-xs text-gray-500">{description}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleGamerule(rule, label, !gameruleValues[rule])}
                  disabled={loading === `gamerule-${rule}`}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    gameruleValues[rule] ? 'bg-green-600' : 'bg-gray-600'
                  }`}
                >
                  {loading === `gamerule-${rule}` ? (
                    <RefreshCw className="w-4 h-4 animate-spin absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white" />
                  ) : (
                    <span
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        gameruleValues[rule] ? 'left-7' : 'left-1'
                      }`}
                    />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
