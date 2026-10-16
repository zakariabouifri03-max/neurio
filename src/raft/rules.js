export const SAVE_KEY = 'drift-survival-v1';
export const TILE_SIZE = 2.15;
export const MAX_TILES = 64;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const ITEMS = {
  wood: { name: 'Driftwood', icon: 'wood', description: 'Weathered by the sea. The beginning of something good.' },
  plastic: { name: 'Plastic', icon: 'plastic', description: 'A little less in the ocean. A little more for your raft.' },
  leaf: { name: 'Palm leaf', icon: 'leaf', description: 'Weave into rope, or save for a wind-catching sail.' },
  rope: { name: 'Rope', icon: 'rope', description: 'Keeps your little world together.' },
  scrap: { name: 'Scrap metal', icon: 'scrap', description: 'A useful bit of something that used to be a ship.' },
  water: { name: 'Fresh water', icon: 'cup', description: 'A cool drink. Restores 32 thirst.' },
  food: { name: 'Coconut', icon: 'coconut', description: 'A taste of the islands. Restores 28 hunger.' },
};

export const RECIPES = {
  foundation: { name: 'Foundation', category: 'Building', icon: 'foundation', description: 'A little more room to call your own.', cost: { wood: 4, plastic: 2 }, place: 'edge' },
  rope: { name: 'Woven rope', category: 'Essentials', icon: 'rope', description: 'Twist two palm leaves into one sturdy rope.', cost: { leaf: 2 }, gives: { rope: 1 } },
  purifier: { name: 'Water purifier', category: 'Survival', icon: 'purifier', description: 'Turns seawater into a fresh drink every 60 seconds.', cost: { wood: 5, plastic: 4, rope: 2 }, place: 'deck', interval: 60, produces: 'water' },
  grill: { name: 'Little grill', category: 'Survival', icon: 'grill', description: 'Cook your coconuts for 42 hunger instead of 28.', cost: { wood: 6, scrap: 3, rope: 1 }, place: 'deck' },
  garden: { name: 'Growing bed', category: 'Survival', icon: 'garden', description: 'A small coconut palm. Grows food every 80 seconds.', cost: { wood: 4, leaf: 4, rope: 1 }, place: 'deck', interval: 80, produces: 'food' },
  sail: { name: 'Palm sail', category: 'Building', icon: 'sail', description: 'A little shade. A little adventure.', cost: { wood: 8, leaf: 8, rope: 3 }, place: 'deck' },
};

export const HOTBAR = [
  { id: 'hook', name: 'Scrap hook', icon: 'hook', key: '1', hint: 'Click floating supplies to reel them in' },
  { id: 'hammer', name: 'Building hammer', icon: 'hammer', key: '2', hint: 'Click a highlighted edge to add a foundation' },
  { id: 'paddle', name: 'Wooden paddle', icon: 'paddle', key: '3', hint: 'Hold W A S D to steer your raft' },
  { id: 'spear', name: 'Wooden spear', icon: 'spear', key: '4', hint: 'Click the shark or press E to defend your raft' },
  { id: 'cup', name: 'Fresh water', icon: 'cup', key: '5', item: 'water', hint: 'Click or press E to take a drink' },
  { id: 'coconut', name: 'Coconut', icon: 'coconut', key: '6', item: 'food', hint: 'Click or press E to have a bite' },
];

export function newGame() {
  const tiles = [];
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) tiles.push({ x, z });
  return {
    version: 1,
    inventory: { wood: 8, plastic: 6, leaf: 4, rope: 2, scrap: 1, water: 3, food: 3 },
    stats: { health: 100, thirst: 86, hunger: 78 },
    tiles,
    structures: [{ type: 'sail', x: -1, z: -1, progress: 0 }, { type: 'storage', x: 1, z: -1, progress: 0 }],
    gathered: { wood: 0, plastic: 0, leaf: 0, barrels: 0 },
    built: 0,
    crafted: {},
    elapsed: 0,
    travel: { x: 0, z: 0 },
    discovered: [],
    raftHealth: 100,
    settings: { sound: false, quality: 'high', sea: 'rolling', view: 'orbit' },
  };
}

const finite = (value, fallback, min = 0, max = 1e9) => Number.isFinite(value) ? clamp(value, min, max) : fallback;

// Saves are untrusted input: reject disconnected/duplicate tiles and invalid recipes.
export function sanitizeSave(input) {
  const state = newGame();
  if (!input || input.version !== 1) return state;
  for (const key of Object.keys(ITEMS)) state.inventory[key] = Math.floor(finite(input.inventory?.[key], state.inventory[key], 0, 999));
  for (const key of Object.keys(state.stats)) state.stats[key] = finite(input.stats?.[key], state.stats[key], 0, 100);
  for (const key of Object.keys(state.gathered)) state.gathered[key] = Math.floor(finite(input.gathered?.[key], 0));
  state.elapsed = finite(input.elapsed, 0);
  state.built = Math.floor(finite(input.built, 0));
  state.raftHealth = finite(input.raftHealth, 100, 1, 100);
  state.discovered = Array.isArray(input.discovered) ? [...new Set(input.discovered.filter(x => [-20, -91, 61].includes(x)))] : [];
  for (const key of ['x', 'z']) state.travel[key] = finite(input.travel?.[key], 0, -100000, 100000);
  if (Array.isArray(input.tiles)) {
    const pending = input.tiles.slice(0, MAX_TILES * 4).filter(tile => tile && Number.isInteger(tile.x) && Number.isInteger(tile.z) && Math.abs(tile.x) <= MAX_TILES && Math.abs(tile.z) <= MAX_TILES);
    const connected = [{ x: 0, z: 0 }];
    let changed = true;
    while (changed && connected.length < MAX_TILES) {
      changed = false;
      for (const tile of pending) {
        if (connected.length >= MAX_TILES) break;
        if (!connected.some(t => t.x === tile.x && t.z === tile.z) && connected.some(t => Math.abs(t.x - tile.x) + Math.abs(t.z - tile.z) === 1)) {
          connected.push({ x: tile.x, z: tile.z }); changed = true;
        }
      }
    }
    if (connected.length > 1) state.tiles = connected;
  }
  if (Array.isArray(input.structures)) {
    state.structures = [];
    for (const structure of input.structures.slice(0, MAX_TILES)) {
      if (!structure || !(RECIPES[structure.type]?.place === 'deck' || structure.type === 'storage')) continue;
      if (!state.tiles.some(t => t.x === structure.x && t.z === structure.z)) continue;
      if (state.structures.some(s => s.x === structure.x && s.z === structure.z)) continue;
      state.structures.push({ type: structure.type, x: structure.x, z: structure.z, progress: finite(structure.progress, 0, 0, 80) });
    }
  }
  for (const key of Object.keys(RECIPES)) state.crafted[key] = Math.floor(finite(input.crafted?.[key], 0));
  state.settings.sound = input.settings?.sound === true;
  state.settings.quality = input.settings?.quality === 'low' ? 'low' : 'high';
  state.settings.sea = ['calm', 'rolling', 'rough'].includes(input.settings?.sea) ? input.settings.sea : 'rolling';
  state.settings.view = input.settings?.view === 'deck' ? 'deck' : 'orbit';
  return state;
}

export function loadGame(storage) {
  try {
    const saved = storage.getItem(SAVE_KEY);
    return saved ? sanitizeSave(JSON.parse(saved)) : newGame();
  } catch { return newGame(); }
}

export function saveGame(storage, state) {
  try { storage.setItem(SAVE_KEY, JSON.stringify(state)); return true; }
  catch { return false; }
}

export function canAfford(state, cost) {
  return Object.entries(cost).every(([key, amount]) => (state.inventory[key] || 0) >= amount);
}

export function spend(state, cost) {
  if (!canAfford(state, cost)) return false;
  for (const [key, amount] of Object.entries(cost)) state.inventory[key] -= amount;
  return true;
}

export function give(state, contents) {
  for (const [key, amount] of Object.entries(contents)) {
    if (Object.hasOwn(ITEMS, key) && Number.isFinite(amount) && amount > 0) state.inventory[key] = Math.min(999, state.inventory[key] + Math.floor(amount));
  }
}

export function collectResource(state, kind) {
  const contents = kind === 'barrel'
    ? { wood: 3, plastic: 2, leaf: 1, scrap: 2, food: 1 }
    : kind === 'crate' ? { wood: 2, rope: 1, scrap: 1, water: 1 }
    : kind === 'wood' ? { wood: 2 }
    : kind === 'leaf' ? { leaf: 2 }
    : { plastic: 2 };
  give(state, contents);
  for (const key of ['wood', 'leaf', 'plastic']) state.gathered[key] += contents[key] || 0;
  if (kind === 'barrel' || kind === 'crate') state.gathered.barrels++;
  return contents;
}

export function foundationSpots(state) {
  const occupied = new Set(state.tiles.map(t => `${t.x},${t.z}`));
  const spots = new Map();
  for (const tile of state.tiles) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = tile.x + dx, z = tile.z + dz, key = `${x},${z}`;
    if (!occupied.has(key)) spots.set(key, { x, z });
  }
  return [...spots.values()];
}

export function canPlace(state, type, x, z) {
  if (!Number.isInteger(x) || !Number.isInteger(z)) return false;
  if (type === 'foundation') return state.tiles.length < MAX_TILES && foundationSpots(state).some(t => t.x === x && t.z === z);
  if (RECIPES[type]?.place !== 'deck') return false;
  return state.tiles.some(t => t.x === x && t.z === z) && !state.structures.some(s => s.x === x && s.z === z);
}

export function craft(state, type, x, z) {
  if (!Object.hasOwn(RECIPES, type)) return { ok: false, reason: 'Unknown recipe.' };
  const recipe = RECIPES[type];
  if (recipe.place && !canPlace(state, type, x, z)) return { ok: false, reason: type === 'foundation' ? 'Choose an empty edge of your raft.' : 'Choose an empty foundation on your raft.' };
  if (!spend(state, recipe.cost)) return { ok: false, reason: 'Not enough supplies. Keep an eye on the tide.' };
  if (type === 'foundation') { state.tiles.push({ x, z }); state.built++; }
  else if (recipe.place) state.structures.push({ type, x, z, progress: 0 });
  else give(state, recipe.gives);
  state.crafted[type] = (state.crafted[type] || 0) + 1;
  return { ok: true, name: recipe.name };
}

export function consume(state, item) {
  if (!['water', 'food'].includes(item)) return { ok: false, reason: 'You cannot eat that.' };
  if (!state.inventory[item]) return { ok: false, reason: item === 'water' ? 'No fresh water. Search barrels or build a purifier.' : 'Out of food. Search barrels or plant a growing bed.' };
  const stat = item === 'water' ? 'thirst' : 'hunger';
  if (state.stats[stat] >= 99) return { ok: false, reason: item === 'water' ? 'You’re already well hydrated.' : 'You’re already full.' };
  state.inventory[item]--;
  const amount = item === 'water' ? 32 : state.structures.some(s => s.type === 'grill') ? 42 : 28;
  state.stats[stat] = Math.min(100, state.stats[stat] + amount);
  return { ok: true, reason: item === 'water' ? 'A fresh start. +32 thirst' : `A little taste of home. +${amount} hunger` };
}

export function tick(state, dt) {
  const events = [];
  if (state.stats.health <= 0 || !Number.isFinite(dt)) return events;
  dt = clamp(dt, 0, 1);
  state.elapsed += dt;
  state.stats.thirst = Math.max(0, state.stats.thirst - dt * 0.055);
  state.stats.hunger = Math.max(0, state.stats.hunger - dt * 0.035);
  if (state.stats.thirst <= 0 || state.stats.hunger <= 0) state.stats.health = Math.max(0, state.stats.health - dt * 1.6);
  else if (state.stats.thirst > 60 && state.stats.hunger > 60) state.stats.health = Math.min(100, state.stats.health + dt * 0.3);
  for (const structure of state.structures) {
    const recipe = RECIPES[structure.type];
    if (!recipe?.produces) continue;
    structure.progress += dt;
    if (structure.progress >= recipe.interval) {
      structure.progress -= recipe.interval;
      give(state, { [recipe.produces]: 1 });
      events.push({ type: 'produced', item: recipe.produces });
    }
  }
  return events;
}

export function objective(state) {
  if (state.gathered.wood < 6 || state.built < 1) return {
    chapter: '01', name: 'A little more room', description: 'Every great escape starts small.',
    tasks: [{ label: 'Collect driftwood', current: Math.min(6, state.gathered.wood), goal: 6 }, { label: 'Build a foundation', current: Math.min(1, state.built), goal: 1 }],
  };
  if (!state.crafted.purifier || state.gathered.barrels < 2) return {
    chapter: '02', name: 'The simple things', description: 'Fresh water. A place to belong.',
    tasks: [{ label: 'Salvage barrels & crates', current: Math.min(2, state.gathered.barrels), goal: 2 }, { label: 'Build a water purifier', current: Math.min(1, state.crafted.purifier || 0), goal: 1 }],
  };
  if (state.tiles.length < 15 || !state.crafted.garden) return {
    chapter: '03', name: 'Put down roots', description: 'Home is a thing you make.',
    tasks: [{ label: 'Expand to 15 foundations', current: Math.min(15, state.tiles.length), goal: 15 }, { label: 'Plant a growing bed', current: Math.min(1, state.crafted.garden || 0), goal: 1 }],
  };
  return { chapter: '04', name: 'Your own little world', description: 'No finish line. Just a new horizon.', tasks: [{ label: 'A self-sufficient home', current: 1, goal: 1 }, { label: 'Keep exploring', current: 1, goal: 1 }] };
}
