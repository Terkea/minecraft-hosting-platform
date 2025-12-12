import { useState } from 'react';
import {
  ArrowLeft,
  Heart,
  Utensils,
  Sparkles,
  Map,
  Shield,
  Wind,
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Droplets,
  Flame,
  CircleDot,
  Cookie,
  Gamepad2,
  Crown,
  Ban,
  LogOut,
  Wand2,
} from 'lucide-react';
import { notification } from 'antd';
import {
  setPlayerGamemode,
  healPlayer,
  feedPlayer,
  clearPlayerEffects,
  kickPlayer,
  banPlayer,
  grantOp,
  revokeOp,
  type PlayerData,
  type MinecraftItem,
  type EquipmentItem,
} from './api';

interface PlayerViewProps {
  player: PlayerData;
  serverName: string;
  onBack: () => void;
  onRefresh: () => void;
  isLoading: boolean;
}

// Minecraft item icon URL - try multiple CDNs for reliability
const getItemIconUrl = (itemId: string): string => {
  const cleanId = itemId.replace('minecraft:', '');
  // Primary: minecraft-api.vercel.app (most reliable)
  return `https://minecraft-api.vercel.app/images/items/${cleanId}.png`;
};

// Alternative URLs to try if primary fails
const getAlternativeIconUrls = (itemId: string): string[] => {
  const cleanId = itemId.replace('minecraft:', '');
  // Convert snake_case to Title_Case for wiki (e.g., ominous_bottle -> Ominous_Bottle)
  const wikiName = cleanId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('_');
  return [
    `https://minecraft-api.vercel.app/images/blocks/${cleanId}.png`,
    `https://mc.nerothe.com/img/1.21.1/${cleanId}.png`,
    // Minecraft Wiki direct image URLs (official wiki, has 1.21+ items)
    `https://minecraft.wiki/images/${wikiName}_JE1_BE1.png`,
    `https://minecraft.wiki/images/${wikiName}_JE1.png`,
    `https://minecraft.wiki/images/${wikiName}_JE2_BE2.png`,
    `https://minecraft.wiki/images/${wikiName}_JE3_BE3.png`,
    `https://minecraft.wiki/images/${wikiName}.png`,
    // Fandom/Wikia CDN (alternative source)
    `https://static.wikia.nocookie.net/minecraft_gamepedia/images/${wikiName}_JE1_BE1.png`,
    // GitHub minecraft-assets
    `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures/item/${cleanId}.png`,
    `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.20.4/assets/minecraft/textures/item/${cleanId}.png`,
    `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.20.4/assets/minecraft/textures/block/${cleanId}.png`,
  ];
};

// Cache for failed item IDs to avoid retrying on every render
const failedItemCache = new Set<string>();

// Item icon component with multiple fallback URLs
const ItemIcon = ({ itemId, size = 32 }: { itemId: string; size?: number }) => {
  const cleanId = itemId.replace('minecraft:', '');
  const [urlIndex, setUrlIndex] = useState(0);
  const [allFailed, setAllFailed] = useState(failedItemCache.has(cleanId));

  const allUrls = [getItemIconUrl(itemId), ...getAlternativeIconUrls(itemId)];

  const handleError = () => {
    if (urlIndex < allUrls.length - 1) {
      setUrlIndex((prev) => prev + 1);
    } else {
      failedItemCache.add(cleanId);
      setAllFailed(true);
    }
  };

  if (allFailed) {
    // Show a styled fallback with the item name
    return (
      <div
        className="flex items-center justify-center bg-gradient-to-br from-gray-600 to-gray-700 rounded border border-gray-500"
        style={{ width: size, height: size }}
        title={cleanId.replace(/_/g, ' ')}
      >
        <span className="text-[8px] text-gray-300 font-bold uppercase leading-none text-center px-0.5">
          {cleanId
            .split('_')
            .map((w) => w[0])
            .join('')
            .slice(0, 3)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={allUrls[urlIndex]}
      alt={cleanId}
      width={size}
      height={size}
      className="pixelated"
      onError={handleError}
      style={{ imageRendering: 'pixelated' }}
      title={cleanId.replace(/_/g, ' ')}
    />
  );
};

// Format item name with Title Case
const formatItemName = (id: string): string => {
  return id
    .replace('minecraft:', '')
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Format enchantment name with Title Case
const formatEnchantName = (name: string): string => {
  return name
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Get max durability for common items
const getMaxDurability = (itemId: string): number => {
  const durabilities: Record<string, number> = {
    'minecraft:diamond_helmet': 363,
    'minecraft:diamond_chestplate': 528,
    'minecraft:diamond_leggings': 495,
    'minecraft:diamond_boots': 429,
    'minecraft:diamond_sword': 1561,
    'minecraft:diamond_pickaxe': 1561,
    'minecraft:diamond_axe': 1561,
    'minecraft:diamond_shovel': 1561,
    'minecraft:diamond_hoe': 1561,
    'minecraft:netherite_helmet': 407,
    'minecraft:netherite_chestplate': 592,
    'minecraft:netherite_leggings': 555,
    'minecraft:netherite_boots': 481,
    'minecraft:netherite_sword': 2031,
    'minecraft:netherite_pickaxe': 2031,
    'minecraft:netherite_axe': 2031,
    'minecraft:netherite_shovel': 2031,
    'minecraft:netherite_hoe': 2031,
    'minecraft:iron_helmet': 165,
    'minecraft:iron_chestplate': 240,
    'minecraft:iron_leggings': 225,
    'minecraft:iron_boots': 195,
    'minecraft:iron_sword': 250,
    'minecraft:iron_pickaxe': 250,
    'minecraft:iron_axe': 250,
    'minecraft:iron_shovel': 250,
    'minecraft:iron_hoe': 250,
    'minecraft:golden_helmet': 77,
    'minecraft:golden_chestplate': 112,
    'minecraft:golden_leggings': 105,
    'minecraft:golden_boots': 91,
    'minecraft:leather_helmet': 55,
    'minecraft:leather_chestplate': 80,
    'minecraft:leather_leggings': 75,
    'minecraft:leather_boots': 65,
    'minecraft:chainmail_helmet': 165,
    'minecraft:chainmail_chestplate': 240,
    'minecraft:chainmail_leggings': 225,
    'minecraft:chainmail_boots': 195,
    'minecraft:bow': 384,
    'minecraft:crossbow': 465,
    'minecraft:shield': 336,
    'minecraft:elytra': 432,
    'minecraft:trident': 250,
    'minecraft:fishing_rod': 64,
    'minecraft:flint_and_steel': 64,
    'minecraft:shears': 238,
  };
  return durabilities[itemId] || 0;
};

// Item tooltip component
const ItemTooltip = ({
  item,
  showSlot,
  slotNumber,
}: {
  item: MinecraftItem | EquipmentItem;
  showSlot?: boolean;
  slotNumber?: number;
}) => {
  const maxDurability = getMaxDurability(item.id);
  const currentDurability =
    maxDurability > 0 && item.damage !== undefined ? maxDurability - item.damage : null;
  const durabilityPercent =
    currentDurability !== null ? (currentDurability / maxDurability) * 100 : null;

  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1.5 bg-gray-900 border border-gray-600 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none min-w-[120px]">
      {/* Custom name or item name */}
      {item.customName ? (
        <>
          <div className="font-medium text-purple-400 italic">{item.customName}</div>
          <div className="text-gray-500 text-[10px]">{formatItemName(item.id)}</div>
        </>
      ) : (
        <div className="font-medium text-white">{formatItemName(item.id)}</div>
      )}

      {/* Enchantments */}
      {item.enchantments && Object.keys(item.enchantments).length > 0 && (
        <div className="mt-1 space-y-0.5">
          {Object.entries(item.enchantments).map(([name, level]) => (
            <div key={name} className="text-cyan-400">
              {formatEnchantName(name)} {level > 1 ? toRoman(level) : ''}
            </div>
          ))}
        </div>
      )}

      {/* Durability bar */}
      {durabilityPercent !== null && (
        <div className="mt-1">
          <div className="flex items-center gap-1">
            <div className="flex-1 h-1 bg-gray-700 rounded overflow-hidden">
              <div
                className={`h-full transition-all ${
                  durabilityPercent > 50
                    ? 'bg-green-500'
                    : durabilityPercent > 25
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${durabilityPercent}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-400">
              {currentDurability}/{maxDurability}
            </span>
          </div>
        </div>
      )}

      {/* Count and slot */}
      <div className="mt-1 text-gray-400 flex justify-between">
        <span>x{item.count}</span>
        {showSlot && slotNumber !== undefined && <span>Slot {slotNumber}</span>}
      </div>
    </div>
  );
};

// Convert number to Roman numerals (for enchantment levels)
const toRoman = (num: number): string => {
  const romanNumerals: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let result = '';
  for (const [value, numeral] of romanNumerals) {
    while (num >= value) {
      result += numeral;
      num -= value;
    }
  }
  return result;
};

// Equipment slot component (for armor/held items)
const EquipmentSlot = ({
  item,
  label,
  size = 'normal',
}: {
  item: EquipmentItem | null;
  label: string;
  size?: 'normal' | 'large';
}) => {
  const slotSize = size === 'large' ? 'w-14 h-14' : 'w-11 h-11';
  const iconSize = size === 'large' ? 40 : 32;
  const hasEnchantments = item?.enchantments && Object.keys(item.enchantments).length > 0;
  const maxDurability = item ? getMaxDurability(item.id) : 0;
  const durabilityPercent =
    maxDurability > 0 && item?.damage !== undefined
      ? ((maxDurability - item.damage) / maxDurability) * 100
      : null;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`${slotSize} relative bg-gray-800/80 border-2 ${
          hasEnchantments ? 'border-purple-500/50' : 'border-gray-600'
        } rounded flex items-center justify-center group`}
      >
        {item ? (
          <>
            <ItemIcon itemId={item.id} size={iconSize} />
            {/* Enchantment glow effect */}
            {hasEnchantments && (
              <div className="absolute inset-0 bg-purple-500/10 animate-pulse rounded" />
            )}
            {item.count > 1 && (
              <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
                {item.count}
              </span>
            )}
            {/* Durability bar */}
            {durabilityPercent !== null && durabilityPercent < 100 && (
              <div className="absolute bottom-0.5 left-0.5 right-0.5 h-0.5 bg-gray-700 rounded overflow-hidden">
                <div
                  className={`h-full ${
                    durabilityPercent > 50
                      ? 'bg-green-500'
                      : durabilityPercent > 25
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${durabilityPercent}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full bg-gray-700/50 rounded-sm" />
        )}

        {/* Hover tooltip */}
        {item && <ItemTooltip item={item} />}
      </div>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
};

// Single inventory slot component
const InventorySlot = ({
  item,
  slotNumber,
  isSelected = false,
  size = 'normal',
}: {
  item?: MinecraftItem;
  slotNumber: number;
  isSelected?: boolean;
  size?: 'normal' | 'large';
}) => {
  const slotSize = size === 'large' ? 'w-14 h-14' : 'w-11 h-11';
  const iconSize = size === 'large' ? 40 : 32;
  const hasEnchantments = item?.enchantments && Object.keys(item.enchantments).length > 0;
  const maxDurability = item ? getMaxDurability(item.id) : 0;
  const durabilityPercent =
    maxDurability > 0 && item?.damage !== undefined
      ? ((maxDurability - item.damage) / maxDurability) * 100
      : null;

  return (
    <div
      className={`${slotSize} relative bg-gray-800/80 border-2 ${
        isSelected
          ? 'border-yellow-500'
          : hasEnchantments
            ? 'border-purple-500/50'
            : 'border-gray-600'
      } rounded flex items-center justify-center group`}
    >
      {item ? (
        <>
          <ItemIcon itemId={item.id} size={iconSize} />
          {/* Enchantment glow effect */}
          {hasEnchantments && (
            <div className="absolute inset-0 bg-purple-500/10 animate-pulse rounded" />
          )}
          {item.count > 1 && (
            <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
              {item.count}
            </span>
          )}
          {/* Durability bar */}
          {durabilityPercent !== null && durabilityPercent < 100 && (
            <div className="absolute bottom-0.5 left-0.5 right-0.5 h-0.5 bg-gray-700 rounded overflow-hidden">
              <div
                className={`h-full ${
                  durabilityPercent > 50
                    ? 'bg-green-500'
                    : durabilityPercent > 25
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${durabilityPercent}%` }}
              />
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full bg-gray-700/50 rounded-sm" />
      )}

      {/* Hover tooltip */}
      {item && <ItemTooltip item={item} showSlot slotNumber={slotNumber} />}
    </div>
  );
};

// Health bar component (Minecraft-style hearts)
const HealthBar = ({ health, maxHealth }: { health: number; maxHealth: number }) => {
  const hearts = Math.ceil(maxHealth / 2);
  const fullHearts = Math.floor(health / 2);
  const halfHeart = health % 2 === 1;

  return (
    <div className="flex flex-wrap gap-0.5">
      {Array.from({ length: hearts }).map((_, i) => (
        <div key={i} className="relative w-5 h-5">
          {/* Empty heart background */}
          <svg viewBox="0 0 9 9" className="w-full h-full absolute text-gray-700">
            <path
              fill="currentColor"
              d="M4.5 8.5L0.5 4.5C-0.5 3.5-0.5 1.5 1 0.5C2.5-0.5 4.5 1 4.5 1C4.5 1 6.5-0.5 8 0.5C9.5 1.5 9.5 3.5 8.5 4.5L4.5 8.5Z"
            />
          </svg>
          {/* Filled heart */}
          {i < fullHearts && (
            <svg viewBox="0 0 9 9" className="w-full h-full absolute text-red-500">
              <path
                fill="currentColor"
                d="M4.5 8.5L0.5 4.5C-0.5 3.5-0.5 1.5 1 0.5C2.5-0.5 4.5 1 4.5 1C4.5 1 6.5-0.5 8 0.5C9.5 1.5 9.5 3.5 8.5 4.5L4.5 8.5Z"
              />
            </svg>
          )}
          {/* Half heart */}
          {i === fullHearts && halfHeart && (
            <svg viewBox="0 0 9 9" className="w-full h-full absolute">
              <defs>
                <clipPath id={`half-heart-${i}`}>
                  <rect x="0" y="0" width="4.5" height="9" />
                </clipPath>
              </defs>
              <path
                fill="#ef4444"
                clipPath={`url(#half-heart-${i})`}
                d="M4.5 8.5L0.5 4.5C-0.5 3.5-0.5 1.5 1 0.5C2.5-0.5 4.5 1 4.5 1C4.5 1 6.5-0.5 8 0.5C9.5 1.5 9.5 3.5 8.5 4.5L4.5 8.5Z"
              />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
};

// Hunger bar component (Minecraft-style drumsticks)
const HungerBar = ({ food }: { food: number }) => {
  const drumsticks = 10;
  const fullDrumsticks = Math.floor(food / 2);
  const halfDrumstick = food % 2 === 1;

  return (
    <div className="flex flex-wrap gap-0.5 flex-row-reverse">
      {Array.from({ length: drumsticks }).map((_, i) => {
        const idx = drumsticks - 1 - i;
        return (
          <div key={i} className="relative w-5 h-5">
            {/* Empty drumstick background */}
            <svg viewBox="0 0 9 9" className="w-full h-full absolute text-gray-700">
              <ellipse cx="6" cy="3" rx="2.5" ry="2" fill="currentColor" />
              <rect x="1" y="5" width="4" height="2" rx="1" fill="currentColor" />
            </svg>
            {/* Filled drumstick */}
            {idx < fullDrumsticks && (
              <svg viewBox="0 0 9 9" className="w-full h-full absolute text-orange-400">
                <ellipse cx="6" cy="3" rx="2.5" ry="2" fill="currentColor" />
                <rect x="1" y="5" width="4" height="2" rx="1" fill="currentColor" />
              </svg>
            )}
            {/* Half drumstick */}
            {idx === fullDrumsticks && halfDrumstick && (
              <svg viewBox="0 0 9 9" className="w-full h-full absolute">
                <defs>
                  <clipPath id={`half-food-${i}`}>
                    <rect x="4.5" y="0" width="4.5" height="9" />
                  </clipPath>
                </defs>
                <ellipse
                  cx="6"
                  cy="3"
                  rx="2.5"
                  ry="2"
                  fill="#fb923c"
                  clipPath={`url(#half-food-${i})`}
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
};

// XP bar component
const XPBar = ({ level, total }: { level: number; total: number }) => {
  // Rough XP progress calculation
  const xpForLevel = (lvl: number) => {
    if (lvl <= 16) return lvl * lvl + 6 * lvl;
    if (lvl <= 31) return 2.5 * lvl * lvl - 40.5 * lvl + 360;
    return 4.5 * lvl * lvl - 162.5 * lvl + 2220;
  };

  const currentLevelXP = xpForLevel(level);
  const nextLevelXP = xpForLevel(level + 1);
  const progressXP = total - currentLevelXP;
  const neededXP = nextLevelXP - currentLevelXP;
  const progress = neededXP > 0 ? Math.min(1, progressXP / neededXP) : 0;

  return (
    <div className="relative">
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden border border-gray-600">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-300"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full">
        <span className="text-green-400 font-bold text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {level}
        </span>
      </div>
    </div>
  );
};

const GAMEMODES = [
  { value: 'survival', label: 'Survival', color: 'green' },
  { value: 'creative', label: 'Creative', color: 'yellow' },
  { value: 'adventure', label: 'Adventure', color: 'blue' },
  { value: 'spectator', label: 'Spectator', color: 'purple' },
];

export function PlayerView({ player, serverName, onBack, onRefresh, isLoading }: PlayerViewProps) {
  const [showEnderChest, setShowEnderChest] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Configure notification
  const [api, contextHolder] = notification.useNotification();

  // Organize inventory into slots (0-8 hotbar, 9-35 main inventory)
  const getItemAtSlot = (inventory: MinecraftItem[], slot: number): MinecraftItem | undefined => {
    return inventory.find((item) => item.slot === slot);
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

  const handleGamemodeChange = async (gamemode: string) => {
    setActionLoading(`gamemode-${gamemode}`);
    try {
      await setPlayerGamemode(serverName, player.name, gamemode);
      showSuccess('Gamemode Changed', `${player.name} is now in ${gamemode} mode`);
      onRefresh();
    } catch (err: any) {
      showError('Gamemode Change Failed', err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleHeal = async () => {
    setActionLoading('heal');
    try {
      await healPlayer(serverName, player.name);
      showSuccess('Player Healed', `${player.name} has been healed`);
      onRefresh();
    } catch (err: any) {
      showError('Heal Failed', err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleFeed = async () => {
    setActionLoading('feed');
    try {
      await feedPlayer(serverName, player.name);
      showSuccess('Player Fed', `${player.name} has been fed`);
      onRefresh();
    } catch (err: any) {
      showError('Feed Failed', err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearEffects = async () => {
    setActionLoading('clear-effects');
    try {
      await clearPlayerEffects(serverName, player.name);
      showSuccess('Effects Cleared', `All effects removed from ${player.name}`);
      onRefresh();
    } catch (err: any) {
      showError('Clear Effects Failed', err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleKick = async () => {
    if (!confirm(`Are you sure you want to kick ${player.name}?`)) return;
    setActionLoading('kick');
    try {
      await kickPlayer(serverName, player.name);
      showSuccess(`Kicked ${player.name}`);
      onBack();
    } catch (err: any) {
      showError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleBan = async () => {
    if (
      !confirm(
        `Are you sure you want to ban ${player.name}? This will permanently ban them from the server.`
      )
    )
      return;
    setActionLoading('ban');
    try {
      await banPlayer(serverName, player.name);
      showSuccess(`Banned ${player.name}`);
      onBack();
    } catch (err: any) {
      showError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGrantOp = async () => {
    setActionLoading('op');
    try {
      await grantOp(serverName, player.name);
      showSuccess(`Granted operator to ${player.name}`);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeOp = async () => {
    setActionLoading('deop');
    try {
      await revokeOp(serverName, player.name);
      showSuccess(`Revoked operator from ${player.name}`);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Players</span>
        </button>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {contextHolder}

      {/* Player Profile Header */}
      <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-6">
        <div className="flex items-start gap-6">
          {/* Player head/avatar */}
          <div className="flex-shrink-0">
            <img
              src={`https://mc-heads.net/avatar/${player.name}/100`}
              alt={player.name}
              className="w-24 h-24 rounded-lg border-4 border-gray-600 shadow-lg"
              style={{ imageRendering: 'pixelated' }}
            />
            <img
              src={`https://mc-heads.net/body/${player.name}/100`}
              alt={`${player.name}'s body`}
              className="w-24 mt-2 mx-auto"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Player info */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-3xl font-bold text-white">{player.name}</h2>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
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
            </div>

            {/* Status bars */}
            <div className="space-y-3 mt-4">
              {/* Health */}
              <div className="flex items-center gap-3">
                <Heart className="w-5 h-5 text-red-500 flex-shrink-0" />
                <HealthBar health={player.health} maxHealth={player.maxHealth} />
                <span className="text-sm text-gray-400 ml-2">
                  {player.health}/{player.maxHealth}
                </span>
              </div>

              {/* Hunger */}
              <div className="flex items-center gap-3">
                <Utensils className="w-5 h-5 text-orange-400 flex-shrink-0" />
                <HungerBar food={player.foodLevel} />
                <span className="text-sm text-gray-400 ml-2">{player.foodLevel}/20</span>
              </div>

              {/* XP */}
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-green-400 flex-shrink-0" />
                <div className="flex-1 max-w-xs">
                  <XPBar level={player.xpLevel} total={player.xpTotal} />
                </div>
                <span className="text-sm text-gray-400">Level {player.xpLevel}</span>
              </div>
            </div>

            {/* Additional stats row */}
            <div className="flex gap-3 mt-4">
              <div className="flex items-center gap-2 bg-gray-700/30 rounded px-3 py-1.5">
                <Droplets className="w-4 h-4 text-cyan-400" />
                <div>
                  <div className="text-[10px] text-gray-500">Air</div>
                  <div className="text-cyan-400 font-medium text-sm">{player.air}/300</div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-gray-700/30 rounded px-3 py-1.5">
                <Flame
                  className={`w-4 h-4 ${player.fire > 0 ? 'text-orange-400' : 'text-gray-500'}`}
                />
                <div>
                  <div className="text-[10px] text-gray-500">Fire</div>
                  <div
                    className={`font-medium text-sm ${player.fire > 0 ? 'text-orange-400' : 'text-gray-400'}`}
                  >
                    {player.fire}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-gray-700/30 rounded px-3 py-1.5">
                <CircleDot
                  className={`w-4 h-4 ${player.onGround ? 'text-green-400' : 'text-yellow-400'}`}
                />
                <div>
                  <div className="text-[10px] text-gray-500">Ground</div>
                  <div
                    className={`font-medium text-sm ${player.onGround ? 'text-green-400' : 'text-yellow-400'}`}
                  >
                    {player.onGround ? 'Yes' : 'No'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-gray-700/30 rounded px-3 py-1.5">
                <Cookie className="w-4 h-4 text-yellow-400" />
                <div>
                  <div className="text-[10px] text-gray-500">Saturation</div>
                  <div className="text-yellow-400 font-medium text-sm">
                    {player.foodSaturation.toFixed(1)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Location & Status info */}
          <div className="flex-shrink-0">
            {/* Location */}
            <div className="text-right mb-4">
              <div className="flex items-center justify-end gap-2 text-gray-400 mb-2">
                <Map className="w-4 h-4" />
                <span className="capitalize">{player.dimension}</span>
              </div>
              <div className="font-mono text-sm text-gray-500">
                <div>X: {Math.round(player.position.x)}</div>
                <div>Y: {Math.round(player.position.y)}</div>
                <div>Z: {Math.round(player.position.z)}</div>
              </div>
            </div>

            {/* Abilities badges */}
            <div className="flex flex-wrap gap-1 justify-end">
              {player.abilities.flying && (
                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs flex items-center gap-1">
                  <Wind className="w-3 h-3" /> Flying
                </span>
              )}
              {player.abilities.invulnerable && (
                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Invulnerable
                </span>
              )}
              {player.abilities.instabuild && (
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Instabuild
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Player Actions */}
      <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-purple-400" />
          Player Actions
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Gamemode */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
              <Gamepad2 className="w-4 h-4" />
              Change Gamemode
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {GAMEMODES.map(({ value, label, color }) => (
                <button
                  key={value}
                  onClick={() => handleGamemodeChange(value)}
                  disabled={actionLoading !== null}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    player.gameModeName.toLowerCase() === value
                      ? `bg-${color}-600 text-white`
                      : `bg-gray-700 hover:bg-gray-600 text-gray-300`
                  } ${actionLoading === `gamemode-${value}` ? 'opacity-50' : ''}`}
                >
                  {actionLoading === `gamemode-${value}` ? (
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    label
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Quick Actions
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleHeal}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm transition-colors"
              >
                {actionLoading === 'heal' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Heart className="w-4 h-4" />
                    Heal
                  </>
                )}
              </button>
              <button
                onClick={handleFeed}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 rounded-lg text-sm transition-colors"
              >
                {actionLoading === 'feed' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Utensils className="w-4 h-4" />
                    Feed
                  </>
                )}
              </button>
              <button
                onClick={handleClearEffects}
                disabled={actionLoading !== null}
                className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg text-sm transition-colors"
              >
                {actionLoading === 'clear-effects' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Clear Effects
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Moderation */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Moderation
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleGrantOp}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded-lg text-sm transition-colors"
              >
                {actionLoading === 'op' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Crown className="w-4 h-4" />
                    Grant OP
                  </>
                )}
              </button>
              <button
                onClick={handleRevokeOp}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-600/20 hover:bg-gray-600/30 text-gray-400 rounded-lg text-sm transition-colors"
              >
                {actionLoading === 'deop' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Crown className="w-4 h-4" />
                    Revoke OP
                  </>
                )}
              </button>
              <button
                onClick={handleKick}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded-lg text-sm transition-colors"
              >
                {actionLoading === 'kick' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <LogOut className="w-4 h-4" />
                    Kick
                  </>
                )}
              </button>
              <button
                onClick={handleBan}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm transition-colors"
              >
                {actionLoading === 'ban' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Ban className="w-4 h-4" />
                    Ban
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Minecraft-style Inventory */}
      <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">Inventory</h3>

        <div className="flex gap-8">
          {/* Main inventory section */}
          <div className="flex-1">
            {/* Hotbar (slots 0-8) - highlighted */}
            <div className="mb-4">
              <div className="text-xs text-gray-500 mb-2">Hotbar</div>
              <div className="flex gap-1 p-2 bg-gray-900/50 rounded-lg border border-gray-600">
                {Array.from({ length: 9 }).map((_, i) => (
                  <InventorySlot
                    key={`hotbar-${i}`}
                    item={getItemAtSlot(player.inventory, i)}
                    slotNumber={i}
                    isSelected={player.selectedSlot === i}
                    size="large"
                  />
                ))}
              </div>
            </div>

            {/* Main inventory (slots 9-35) */}
            <div>
              <div className="text-xs text-gray-500 mb-2">Main Inventory</div>
              <div className="p-2 bg-gray-900/50 rounded-lg border border-gray-600">
                <div className="grid grid-cols-9 gap-1">
                  {Array.from({ length: 27 }).map((_, i) => (
                    <InventorySlot
                      key={`main-${i}`}
                      item={getItemAtSlot(player.inventory, i + 9)}
                      slotNumber={i + 9}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Armor and offhand section */}
          <div className="flex-shrink-0">
            <div className="text-xs text-gray-500 mb-2">Equipment</div>
            <div className="p-2 bg-gray-900/50 rounded-lg border border-gray-600">
              {/* Armor slots */}
              <div className="space-y-1 mb-3">
                <EquipmentSlot item={player.equipment?.head} label="Helmet" />
                <EquipmentSlot item={player.equipment?.chest} label="Chestplate" />
                <EquipmentSlot item={player.equipment?.legs} label="Leggings" />
                <EquipmentSlot item={player.equipment?.feet} label="Boots" />
              </div>

              {/* Offhand */}
              <div className="pt-2 border-t border-gray-700 space-y-1">
                <EquipmentSlot item={player.equipment?.offhand} label="Offhand" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ender Chest */}
      {player.enderItems && player.enderItems.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur border border-gray-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowEnderChest(!showEnderChest)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-700/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-purple-900/50 rounded flex items-center justify-center">
                <ItemIcon itemId="ender_chest" size={24} />
              </div>
              <h3 className="text-lg font-bold text-white">Ender Chest</h3>
              <span className="text-sm text-gray-400">({player.enderItems.length} items)</span>
            </div>
            {showEnderChest ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>

          {showEnderChest && (
            <div className="p-4 pt-0">
              <div className="p-2 bg-purple-900/20 rounded-lg border border-purple-700/50">
                <div className="grid grid-cols-9 gap-1">
                  {Array.from({ length: 27 }).map((_, i) => (
                    <InventorySlot
                      key={`ender-${i}`}
                      item={getItemAtSlot(player.enderItems, i)}
                      slotNumber={i}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
