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
} from 'lucide-react';
import type { PlayerData, MinecraftItem, EquipmentItem } from './api';

interface PlayerViewProps {
  player: PlayerData;
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
  return [
    `https://minecraft-api.vercel.app/images/blocks/${cleanId}.png`,
    `https://mc.nerothe.com/img/1.21.1/${cleanId}.png`,
    `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.20.4/assets/minecraft/textures/item/${cleanId}.png`,
    `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.20.4/assets/minecraft/textures/block/${cleanId}.png`,
  ];
};

// Item icon component with multiple fallback URLs
const ItemIcon = ({ itemId, size = 32 }: { itemId: string; size?: number }) => {
  const [urlIndex, setUrlIndex] = useState(0);
  const [allFailed, setAllFailed] = useState(false);
  const cleanId = itemId.replace('minecraft:', '');

  const allUrls = [getItemIconUrl(itemId), ...getAlternativeIconUrls(itemId)];

  const handleError = () => {
    if (urlIndex < allUrls.length - 1) {
      setUrlIndex(urlIndex + 1);
    } else {
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

  return (
    <div className="flex items-center gap-2">
      <div
        className={`${slotSize} relative bg-gray-800/80 border-2 border-gray-600 rounded flex items-center justify-center group`}
        title={item ? `${item.id.replace('minecraft:', '')} x${item.count}` : `Empty ${label}`}
      >
        {item ? (
          <>
            <ItemIcon itemId={item.id} size={iconSize} />
            {item.count > 1 && (
              <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
                {item.count}
              </span>
            )}
          </>
        ) : (
          <div className="w-full h-full bg-gray-700/50 rounded-sm" />
        )}

        {/* Hover tooltip */}
        {item && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
            <div className="font-medium text-green-400">
              {item.id.replace('minecraft:', '').replace(/_/g, ' ')}
            </div>
            <div className="text-gray-400">x{item.count}</div>
          </div>
        )}
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

  return (
    <div
      className={`${slotSize} relative bg-gray-800/80 border-2 ${
        isSelected ? 'border-yellow-500' : 'border-gray-600'
      } rounded flex items-center justify-center group`}
      title={
        item
          ? `${item.id.replace('minecraft:', '')} x${item.count} (Slot ${slotNumber})`
          : `Empty (Slot ${slotNumber})`
      }
    >
      {item ? (
        <>
          <ItemIcon itemId={item.id} size={iconSize} />
          {item.count > 1 && (
            <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
              {item.count}
            </span>
          )}
        </>
      ) : (
        <div className="w-full h-full bg-gray-700/50 rounded-sm" />
      )}

      {/* Hover tooltip */}
      {item && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
          <div className="font-medium text-green-400">
            {item.id.replace('minecraft:', '').replace(/_/g, ' ')}
          </div>
          <div className="text-gray-400">x{item.count}</div>
        </div>
      )}
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

export function PlayerView({ player, onBack, onRefresh, isLoading }: PlayerViewProps) {
  const [showEnderChest, setShowEnderChest] = useState(false);

  // Organize inventory into slots (0-8 hotbar, 9-35 main inventory)
  const getItemAtSlot = (inventory: MinecraftItem[], slot: number): MinecraftItem | undefined => {
    return inventory.find((item) => item.slot === slot);
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

              {/* Held items */}
              <div className="pt-2 border-t border-gray-700 space-y-1">
                <EquipmentSlot item={player.equipment?.mainhand} label="Mainhand" />
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
