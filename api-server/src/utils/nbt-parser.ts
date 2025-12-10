// NBT-like parser for Minecraft RCON data get entity responses
// The format is similar to JSON but uses different syntax for types

export interface MinecraftItem {
  id: string;
  count: number;
  slot: number;
  tag?: Record<string, any>;
}

export interface PlayerData {
  name: string;
  health: number;
  maxHealth: number;
  foodLevel: number;
  foodSaturation: number;
  xpLevel: number;
  xpTotal: number;
  gameMode: number;
  gameModeName: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  dimension: string;
  rotation: {
    yaw: number;
    pitch: number;
  };
  air: number;
  fire: number;
  onGround: boolean;
  isFlying: boolean;
  inventory: MinecraftItem[];
  enderItems: MinecraftItem[];
  selectedSlot: number;
  abilities: {
    invulnerable: boolean;
    mayFly: boolean;
    instabuild: boolean;
    flying: boolean;
    walkSpeed: number;
    flySpeed: number;
  };
}

// Game mode mapping
const GAME_MODES: Record<number, string> = {
  0: 'Survival',
  1: 'Creative',
  2: 'Adventure',
  3: 'Spectator',
};

// Parse the SNBT (Stringified NBT) format that Minecraft returns
export function parsePlayerData(name: string, rawData: string): PlayerData | null {
  try {
    // Extract the data portion after "has the following entity data:"
    const match = rawData.match(/has the following entity data: (.+)$/s);
    if (!match) return null;

    const dataStr = match[1];

    // Parse individual values using regex
    const health = parseFloat(extractValue(dataStr, 'Health', '20.0f') || '20');
    const foodLevel = parseInt(extractValue(dataStr, 'foodLevel', '20') || '20');
    const foodSaturation = parseFloat(extractValue(dataStr, 'foodSaturationLevel', '5.0f') || '5');
    const xpLevel = parseInt(extractValue(dataStr, 'XpLevel', '0') || '0');
    const xpTotal = parseInt(extractValue(dataStr, 'XpTotal', '0') || '0');
    const gameMode = parseInt(extractValue(dataStr, 'playerGameType', '0') || '0');
    const air = parseInt(extractValue(dataStr, 'Air', '300s')?.replace('s', '') || '300');
    const fire = parseInt(extractValue(dataStr, 'Fire', '-20s')?.replace('s', '') || '-20');
    const onGround = extractValue(dataStr, 'OnGround', '0b') === '1b';
    const selectedSlot = parseInt(extractValue(dataStr, 'SelectedItemSlot', '0') || '0');

    // Parse position array
    const posMatch = dataStr.match(/Pos: \[([^\]]+)\]/);
    const position = { x: 0, y: 0, z: 0 };
    if (posMatch) {
      const coords = posMatch[1].split(',').map((v) => parseFloat(v.trim().replace('d', '')));
      if (coords.length >= 3) {
        position.x = Math.round(coords[0] * 100) / 100;
        position.y = Math.round(coords[1] * 100) / 100;
        position.z = Math.round(coords[2] * 100) / 100;
      }
    }

    // Parse rotation array
    const rotMatch = dataStr.match(/Rotation: \[([^\]]+)\]/);
    const rotation = { yaw: 0, pitch: 0 };
    if (rotMatch) {
      const rots = rotMatch[1].split(',').map((v) => parseFloat(v.trim().replace('f', '')));
      if (rots.length >= 2) {
        rotation.yaw = Math.round(rots[0] * 100) / 100;
        rotation.pitch = Math.round(rots[1] * 100) / 100;
      }
    }

    // Parse dimension
    const dimMatch = dataStr.match(/Dimension: "([^"]+)"/);
    const dimension = dimMatch ? dimMatch[1].replace('minecraft:', '') : 'overworld';

    // Parse abilities
    const abilitiesMatch = dataStr.match(/abilities: \{([^}]+)\}/);
    const abilities = {
      invulnerable: false,
      mayFly: false,
      instabuild: false,
      flying: false,
      walkSpeed: 0.1,
      flySpeed: 0.05,
    };
    if (abilitiesMatch) {
      const abStr = abilitiesMatch[1];
      abilities.invulnerable = abStr.includes('invulnerable: 1b');
      abilities.mayFly = abStr.includes('mayfly: 1b');
      abilities.instabuild = abStr.includes('instabuild: 1b');
      abilities.flying = abStr.includes('flying: 1b');
      const walkMatch = abStr.match(/walkSpeed: ([\d.]+)f/);
      if (walkMatch) abilities.walkSpeed = parseFloat(walkMatch[1]);
      const flyMatch = abStr.match(/flySpeed: ([\d.]+)f/);
      if (flyMatch) abilities.flySpeed = parseFloat(flyMatch[1]);
    }

    // Parse inventory
    const inventory = parseInventory(dataStr, 'Inventory');
    const enderItems = parseInventory(dataStr, 'EnderItems');

    return {
      name,
      health,
      maxHealth: 20,
      foodLevel,
      foodSaturation,
      xpLevel,
      xpTotal,
      gameMode,
      gameModeName: GAME_MODES[gameMode] || 'Unknown',
      position,
      dimension,
      rotation,
      air,
      fire,
      onGround,
      isFlying: abilities.flying,
      inventory,
      enderItems,
      selectedSlot,
      abilities,
    };
  } catch (error) {
    console.error('Failed to parse player data:', error);
    return null;
  }
}

function extractValue(data: string, key: string, defaultVal?: string): string | null {
  // Match patterns like: key: value, or key: valuef or key: values etc
  const regex = new RegExp(`${key}: ([^,}\\]]+)`);
  const match = data.match(regex);
  return match ? match[1].trim() : defaultVal || null;
}

function parseInventory(data: string, key: string): MinecraftItem[] {
  const items: MinecraftItem[] = [];

  // Match the inventory array
  const regex = new RegExp(`${key}: \\[([^\\]]*(?:\\{[^}]*\\}[^\\]]*)*)?\\]`);
  const match = data.match(regex);
  if (!match || !match[1]) return items;

  const invStr = match[1];

  // Match each item object: {count: X, Slot: Yb, id: "minecraft:item"}
  const itemRegex = /\{([^}]+)\}/g;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(invStr)) !== null) {
    const itemStr = itemMatch[1];

    const countMatch = itemStr.match(/count: (\d+)/);
    const slotMatch = itemStr.match(/Slot: (\d+)b/);
    const idMatch = itemStr.match(/id: "([^"]+)"/);

    if (idMatch) {
      items.push({
        id: idMatch[1].replace('minecraft:', ''),
        count: countMatch ? parseInt(countMatch[1]) : 1,
        slot: slotMatch ? parseInt(slotMatch[1]) : 0,
      });
    }
  }

  return items;
}

// Parse the player list response to get player names
export function parsePlayerList(response: string): {
  online: number;
  max: number;
  players: string[];
} {
  const match = response.match(/There are (\d+) of a max of (\d+) players online[:\s]*(.*)?/);

  if (!match) {
    return { online: 0, max: 20, players: [] };
  }

  const online = parseInt(match[1]);
  const max = parseInt(match[2]);
  const playerStr = match[3] || '';

  const players = playerStr
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return { online, max, players };
}
