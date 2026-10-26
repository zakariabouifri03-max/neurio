// ── Content database: cars, drivers, maps, themes, rivals, economy ──────────

export const REWARDS = {
  coinsByPlace: [600, 400, 280, 180, 120, 90],
  gemsByPlace: [3, 2, 1, 0, 0, 0],
  champPoints: [10, 8, 6, 4, 2, 1],
  seasonRaces: 10,
  champReward: { coins: 1500, gems: 6, trophies: 3 },
  coinPickup: 5,
};

export const UPGRADES = {
  max: 5,
  meta: {
    spd: { label: 'Top Speed', icon: '🚀' },
    acc: { label: 'Acceleration', icon: '⚡' },
    hnd: { label: 'Handling', icon: '🌀' },
  },
  cost(level) { return Math.round(280 * Math.pow(level + 1, 1.35)); }, // level 0→1 costs 280
};

// ── Paint shop ───────────────────────────────────────────────────────────────
export const PAINTS = [
  { c: '#e63946', n: 'Racing Red' }, { c: '#f97316', n: 'Sunset' },
  { c: '#ffd23f', n: 'Banana' }, { c: '#84cc16', n: 'Lime' },
  { c: '#06d6a0', n: 'Mint' }, { c: '#22d3ee', n: 'Cyan' },
  { c: '#3b82f6', n: 'Ocean Blue' }, { c: '#8b5cf6', n: 'Grape' },
  { c: '#ff70a6', n: 'Hot Pink', price: 300 }, { c: '#111827', n: 'Midnight', price: 300 },
  { c: '#f8fafc', n: 'Pearl', price: 300 }, { c: '#ffd700', n: 'Solid Gold', price: 300 },
  { c: '#94a3b8', n: 'Chrome', price: 300 }, { c: '#78350f', n: 'Choco', price: 300 },
  { c: '#0d9488', n: 'Abyss Teal', price: 300 }, { c: '#e11d48', n: 'Cherry Bomb', price: 300 },
];

export const WHEELS = ['#23262e', '#f4f4f5', '#ffd23f', '#ef4444', '#38bdf8', '#84cc16', '#f472b6', '#a16207'];

export const HORNS = [
  { n: 'Classic Beep' }, { n: 'Clown Honk', price: 200 },
  { n: 'Fiesta Melody', price: 200 }, { n: 'Cop Siren', price: 200 },
];

// ── Car archetypes (visual + physics params) ────────────────────────────────
export const ARCH = {
  mini:    { label: 'Micro',    L: 3.1, W: 1.8, bodyH: 0.55, clear: 0.34, wheelR: 0.40, wheelRr: 0.44, wheelW: 0.30, track: 0.82, wb: 1.05, cab: 'bubble', spoiler: false, engine: false, cage: false },
  buggy:   { label: 'Buggy',    L: 4.2, W: 2.1, bodyH: 0.50, clear: 0.44, wheelR: 0.50, wheelRr: 0.64, wheelW: 0.38, track: 0.98, wb: 1.45, cab: 'open',    spoiler: false, engine: true,  cage: true  },
  convert: { label: 'Cruiser',  L: 4.5, W: 2.0, bodyH: 0.55, clear: 0.30, wheelR: 0.48, wheelRr: 0.48, wheelW: 0.32, track: 0.90, wb: 1.55, cab: 'convert', spoiler: false, engine: false, cage: false },
  truck:   { label: 'Truck',    L: 4.6, W: 2.15, bodyH: 0.78, clear: 0.42, wheelR: 0.58, wheelRr: 0.58, wheelW: 0.40, track: 0.96, wb: 1.55, cab: 'truck',  spoiler: false, engine: false, cage: false },
  muscle:  { label: 'Muscle',   L: 4.7, W: 2.1, bodyH: 0.52, clear: 0.28, wheelR: 0.50, wheelRr: 0.55, wheelW: 0.38, track: 0.93, wb: 1.62, cab: 'fastback', spoiler: true, engine: false, cage: false },
  monster: { label: 'Monster',  L: 4.8, W: 2.5, bodyH: 0.85, clear: 1.05, wheelR: 0.95, wheelRr: 0.95, wheelW: 0.62, track: 1.15, wb: 1.60, cab: 'truck',  spoiler: false, engine: false, cage: false },
  hotrod:  { label: 'Hotrod',   L: 4.5, W: 2.0, bodyH: 0.48, clear: 0.30, wheelR: 0.48, wheelRr: 0.66, wheelW: 0.40, track: 0.92, wb: 1.55, cab: 'open',   spoiler: false, engine: true,  cage: false },
  sport:   { label: 'Sport',    L: 4.4, W: 2.0, bodyH: 0.42, clear: 0.24, wheelR: 0.48, wheelRr: 0.52, wheelW: 0.40, track: 0.92, wb: 1.50, cab: 'sports', spoiler: true, engine: false, cage: false },
};

// ── 50 cars: [name, arch, paint, accent, spd, acc, hnd, coins | {gems:n}] ───
const RAW_CARS = [
  ['Nutter', 'mini', '#7ec8e3', '#ffffff', 58, 86, 90, 0],
  ['Peanut', 'mini', '#ffd23f', '#fff8e1', 60, 87, 89, 350],
  ['Sardine', 'mini', '#9ae6b4', '#effff3', 62, 88, 88, 700],
  ['Bubble', 'mini', '#f9a8d4', '#ffffff', 64, 89, 87, 1100],
  ['Tadpole', 'mini', '#86efac', '#f0fdf4', 66, 90, 86, 1600],
  ['Button', 'mini', '#fca5a5', '#fff1f2', 68, 90, 85, 2200],
  ['Pixel', 'mini', '#c4b5fd', '#f5f3ff', 71, 91, 86, 3100],
  ['Sand Flea', 'buggy', '#f97316', '#1f2937', 64, 78, 80, 450],
  ['Dune Dancer', 'buggy', '#eab308', '#422006', 66, 79, 79, 950],
  ['Crab Cake', 'buggy', '#ef4444', '#fee2e2', 68, 80, 78, 1500],
  ['Beach Comber', 'buggy', '#14b8a6', '#042f2e', 71, 81, 77, 2300],
  ['Hopper', 'buggy', '#84cc16', '#1a2e05', 74, 82, 76, 3200],
  ['Scorpion', 'buggy', '#dc2626', '#fef08a', 77, 83, 75, 4300],
  ['Sunny Side', 'convert', '#fde047', '#b45309', 66, 66, 72, 800],
  ['Lazy Sunday', 'convert', '#fca5a5', '#7f1d1d', 68, 67, 71, 1300],
  ['Vice Wave', 'convert', '#67e8f9', '#155e75', 70, 68, 70, 1900],
  ['Flamingo', 'convert', '#fb7185', '#fff1f2', 72, 69, 69, 2700],
  ['Big Poppa', 'convert', '#a78bfa', '#2e1065', 74, 70, 69, 3600],
  ['Golden Oldie', 'convert', '#fbbf24', '#7c2d12', 76, 71, 68, 4700],
  ['Mud Puppy', 'truck', '#a16207', '#fef3c7', 64, 63, 62, 900],
  ['Pickup Stix', 'truck', '#65a30d', '#ecfccb', 66, 64, 61, 1400],
  ['Haymaker', 'truck', '#d97706', '#451a03', 68, 65, 60, 2000],
  ['Bison', 'truck', '#78716c', '#e7e5e4', 70, 66, 60, 2900],
  ['Grizzly', 'truck', '#854d0e', '#fef9c3', 73, 67, 59, 3800],
  ['Avalanche', 'truck', '#cbd5e1', '#1e293b', 75, 68, 60, 5000],
  ['Street Shark', 'muscle', '#0ea5e9', '#082f49', 76, 70, 58, 2100],
  ['Bandit', 'muscle', '#1f2937', '#fbbf24', 78, 71, 57, 3000],
  ['Venom', 'muscle', '#16a34a', '#052e16', 80, 72, 56, 3900],
  ['Outlaw', 'muscle', '#b91c1c', '#fecaca', 82, 73, 56, 4900],
  ['Barracuda', 'muscle', '#7c3aed', '#ede9fe', 84, 74, 55, 6200],
  ['Warhawk', 'muscle', '#374151', '#f87171', 86, 75, 55, 7500],
  ['Lil Squish', 'monster', '#f472b6', '#fdf2f8', 68, 64, 54, 2600],
  ['Mud Gulp', 'monster', '#a16207', '#fef3c7', 70, 65, 53, 3400],
  ['Sandworm', 'monster', '#ca8a04', '#451a03', 72, 66, 52, 4300],
  ['Big Mo', 'monster', '#dc2626', '#fee2e2', 74, 67, 52, 5400],
  ['Riptide', 'monster', '#0891b2', '#ecfeff', 76, 68, 52, 6600],
  ['King Krush', 'monster', '#4d7c0f', '#fef08a', 78, 69, 52, 8000],
  ['Lil Ember', 'hotrod', '#f97316', '#431407', 78, 77, 60, 4200],
  ['Pipe Dream', 'hotrod', '#eab308', '#27272a', 80, 78, 59, 5300],
  ['Rustbucket', 'hotrod', '#78350f', '#fbbf24', 82, 79, 58, 6400],
  ['Afterburner', 'hotrod', '#991b1b', '#fdba74', 84, 80, 57, 7600],
  ['Fueled Up', 'hotrod', '#0f766e', '#ccfbf1', 86, 81, 56, 8800],
  ['Night Smoke', 'hotrod', '#111827', '#6d28d9', 88, 82, 56, 9900],
  ['Zip Zap', 'sport', '#22d3ee', '#164e63', 84, 74, 72, 5800],
  ['Slipstream', 'sport', '#818cf8', '#1e1b4b', 86, 75, 73, 7000],
  ['Stingray', 'sport', '#38bdf8', '#082f49', 88, 76, 74, 8400],
  ['Neptune', 'sport', '#0891b2', '#fef08a', 90, 77, 75, 9500],
  ['Phantom', 'sport', '#6d28d9', '#c4b5fd', 92, 79, 76, { gems: 12 }],
  ['Solar Flare', 'sport', '#f59e0b', '#7c2d12', 94, 80, 77, { gems: 20 }],
  ['Golden Gull', 'sport', '#ffd700', '#713f12', 96, 82, 78, { gems: 35 }],
];

export const CARS = RAW_CARS.map((r, i) => ({
  id: 'c' + String(i + 1).padStart(2, '0'),
  name: r[0], arch: r[1], paint: r[2], accent: r[3],
  spd: r[4], acc: r[5], hnd: r[6],
  coins: typeof r[7] === 'number' ? r[7] : null,
  gems: r[7] && r[7].gems ? r[7].gems : null,
}));

export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];

// ── 16 Drivers ───────────────────────────────────────────────────────────────
const RAW_DRIVERS = [
  ['Zaid', '😎', 'goggles', '#f2c891', '#e63946', '#1d3557', 0],
  ['Roxie', '😜', 'pigtails', '#ffd9b3', '#ff70a6', '#7b2cbf', 300],
  ['Shelly', '😊', 'flower', '#f2c891', '#ffd166', '#06d6a0', 350],
  ['Tiki', '🤠', 'straw', '#c98f5e', '#06d6a0', '#8a5a2b', 450],
  ['Bubbles', '🐰', 'bunny', '#f8e1d3', '#a0c4ff', '#ffc6ff', 600],
  ['Grom', '😋', 'frog', '#a98467', '#80ed99', '#344e41', 800],
  ['Blaze', '😤', 'mohawk', '#f2c891', '#ff5d8f', '#2b2d42', 1000],
  ['McSkid', '🤡', 'clown', '#f8e1d3', '#f4f1de', '#e07a5f', 1200],
  ['Coco', '🥥', 'bandana', '#c98f5e', '#9d6b53', '#495057', 1400],
  ['Luna', '😴', 'nightcap', '#ffd9b3', '#7b2cbf', '#3c096c', 1600],
  ['Finn', '🦈', 'fin', '#f2c891', '#48cae4', '#023e8a', 1800],
  ['Captain Clutch', '☠️', 'pirate', '#e0aa83', '#343a40', '#6f1d1b', 2200],
  ['Rusty', '🤖', 'antenna', '#ffd9b3', '#adb5bd', '#343a40', 2600],
  ['Coral', '🧜', 'mermaid', '#ffd9b3', '#ff8fa3', '#0d9488', { gems: 10 }],
  ['Pearl', '👑', 'crown', '#f8e1d3', '#fff3b0', '#e5b8f4', { gems: 12 }],
  ['Nova', '👽', 'alien', '#b9fbc0', '#3a86ff', '#081c15', { gems: 20 }],
];

export const DRIVERS = RAW_DRIVERS.map((r, i) => ({
  id: 'dr' + String(i + 1).padStart(2, '0'),
  name: r[0], emoji: r[1], hat: r[2], skin: r[3], shirt: r[4], pants: r[5],
  coins: typeof r[6] === 'number' ? r[6] : null,
  gems: r[6] && r[6].gems ? r[6].gems : null,
}));

export const driverById = (id) => DRIVERS.find((d) => d.id === id) || DRIVERS[0];

// ── Rival racers (the AI league) ─────────────────────────────────────────────
export const RIVALS = [
  { name: 'Roxie', driverId: 'dr02', arch: 'mini', paint: '#ff70a6', skill: 0.86 },
  { name: 'Tiki', driverId: 'dr04', arch: 'buggy', paint: '#06d6a0', skill: 0.90 },
  { name: 'McSkid', driverId: 'dr08', arch: 'muscle', paint: '#e07a5f', skill: 0.94 },
  { name: 'Captain Clutch', driverId: 'dr12', arch: 'truck', paint: '#343a40', skill: 0.97 },
  { name: 'Nova', driverId: 'dr16', arch: 'sport', paint: '#8be9d8', skill: 1.00 },
];

export const POWERUPS = {
  boost: { emoji: '🔥', label: 'Turbo Boost' },
  rocket: { emoji: '🚀', label: 'Homing Rocket' },
  shield: { emoji: '🛡️', label: 'Bubble Shield' },
};

// ── 10 track themes ──────────────────────────────────────────────────────────
export const THEMES = [
  { // 0 Beach
    name: 'Beach', sky: ['#2f9be8', '#9fdcff', '#fff3c4'], sun: ['#fff2c0', 1.35],
    hemi: ['#bfe3f5', '#e8d291'], fog: ['#bfe3f5', 150, 700], ground: ['#ecd9a0', '#dfc287'],
    water: '#1e90c8', road: { type: 'sand', base: '#e8d291', edge: '#f7ecc8', line: '#c9b070' },
    dust: '#d9c28a', decor: ['palm', 'rock', 'cabin', 'surf'],
  },
  { // 1 Jungle
    name: 'Jungle', sky: ['#3d9bd6', '#b7e4c7', '#eafbe0'], sun: ['#fff6c9', 1.1],
    hemi: ['#c9e7c0', '#4d7c2a'], fog: ['#b7d9a8', 110, 520], ground: ['#4d7c2a', '#3a5f22'],
    water: null, road: { type: 'mud', base: '#8a6a45', edge: '#a08257', line: '#6f5738' },
    dust: '#7a6248', decor: ['bigtree', 'fern', 'totem', 'rockmoss'],
  },
  { // 2 Desert
    name: 'Desert', sky: ['#e88f4a', '#f7b267', '#fdead0'], sun: ['#ffdf9e', 1.5],
    hemi: ['#f7d9a8', '#e3b365'], fog: ['#f7cf9e', 150, 720], ground: ['#e3b365', '#d69f4e'],
    water: null, road: { type: 'sand', base: '#d8a95e', edge: '#eccf95', line: '#b98a44' },
    dust: '#d8a95e', decor: ['cactus', 'bones', 'rockred', 'tumbleweed'],
  },
  { // 3 Town (sunset, like the screenshots!)
    name: 'Town', sky: ['#7f7fd5', '#ff9d76', '#ffd9a0'], sun: ['#ffbf80', 1.15],
    hemi: ['#ffd9b8', '#b8a88f'], fog: ['#f7c9a0', 140, 640], ground: ['#b8a88f', '#a5937a'],
    water: null, road: { type: 'cobble', base: '#b7a58c', edge: '#d6c9ae', line: '#8f8168' },
    dust: '#b7a58c', decor: ['house', 'awning', 'lantern', 'crate'],
  },
  { // 4 Snow
    name: 'Snow', sky: ['#7fb2e5', '#cfe8ff', '#ffffff'], sun: ['#ffffff', 1.2],
    hemi: ['#e8f2fb', '#f4f8ff'], fog: ['#e8f2fb', 130, 620], ground: ['#f4f8ff', '#dfe9f5'],
    water: null, road: { type: 'ice', base: '#cfe0ee', edge: '#ffffff', line: '#a8c4dd' },
    dust: '#ffffff', decor: ['pine', 'icerock', 'snowman', 'candycane'],
  },
  { // 5 Volcano
    name: 'Volcano', sky: ['#3a2b3f', '#8f3b3b', '#ff7b3b'], sun: ['#ff9950', 0.95],
    hemi: ['#7a4a4a', '#3a2f2f'], fog: ['#5a3a3a', 90, 460], ground: ['#4a3b3b', '#352a2a'],
    water: '#ff5a1e', road: { type: 'basalt', base: '#5c4a45', edge: '#7a625c', line: '#3a2f2a' },
    dust: '#5c4a45', decor: ['basalt', 'deadtree', 'lavavent', 'obsidian'],
  },
  { // 6 Swamp
    name: 'Swamp', sky: ['#4e6e58', '#9dbb8c', '#e9f2c5'], sun: ['#f0ffbe', 0.9],
    hemi: ['#b8cba0', '#48572f'], fog: ['#9dbb8c', 80, 420], ground: ['#5a6b3c', '#48572f'],
    water: '#4f7d4a', road: { type: 'mud', base: '#6b5d3f', edge: '#87794f', line: '#4f4730' },
    dust: '#6b5d3f', decor: ['mangrove', 'mushroom', 'logwood', 'cattail'],
  },
  { // 7 Canyon
    name: 'Canyon', sky: ['#5aa9e6', '#ffd8a8', '#ffeecf'], sun: ['#ffe2b0', 1.3],
    hemi: ['#ffd8a8', '#c96f4a'], fog: ['#f0c9a0', 150, 700], ground: ['#c96f4a', '#b25a3a'],
    water: null, road: { type: 'sand', base: '#cf7d52', edge: '#e8a377', line: '#a85c38' },
    dust: '#c96f4a', decor: ['mesa', 'arch', 'cactus', 'rockred'],
  },
  { // 8 Farm
    name: 'Farm', sky: ['#62b6e8', '#bfe6ff', '#fffbe0'], sun: ['#fff2c0', 1.25],
    hemi: ['#cfe8ff', '#7cb350'], fog: ['#cfe8d8', 140, 640], ground: ['#7cb350', '#639439'],
    water: null, road: { type: 'dirt', base: '#9c7b54', edge: '#b99771', line: '#7a5f3f' },
    dust: '#9c7b54', decor: ['barn', 'hay', 'windmill', 'sunflower'],
  },
  { // 9 Stardust Night
    name: 'Night', sky: ['#0b1035', '#1d2b64', '#3a4a8f'], sun: ['#b0c4de', 0.55],
    hemi: ['#2b3a6e', '#1c2540'], fog: ['#1d2b64', 80, 430], ground: ['#2f3d5c', '#26334e'],
    water: null, road: { type: 'night', base: '#46587e', edge: '#6d83b8', line: '#8be9d8' },
    dust: '#46587e', decor: ['glowshroom', 'crystal', 'pinedark', 'starpole'], night: true,
  },
];

// ── 50 maps ──────────────────────────────────────────────────────────────────
const RAW_MAPS = [
  // Beach
  ['Turtle Bay', 0], ['Sunny Shores', 0], ['Crab Cove', 0], ['Palm Paradise', 0], ['Lazy Lagoon', 0],
  // Jungle
  ['Mango Tangle', 1], ['Monkey Mayhem', 1], ['Mudslide Pass', 1], ['Tiki Tumble', 1], ['Jaguar Jumps', 1],
  // Desert
  ['Dusty Dunes', 2], ['Scorcher Sands', 2], ['Mirage Mile', 2], ['Boneshaker Basin', 2], ['Prickly Plains', 2],
  // Town
  ['Cobblestone Circus', 3], ['Fiesta Village', 3], ['Sunset Square', 3], ['Windmill Wharf', 3], ['Balloon Borough', 3],
  // Snow
  ['Frosty Fjord', 4], ['Snowcone Summit', 4], ['Penguin Pass', 4], ['Glacier Glide', 4], ['Icicle Alley', 4],
  // Volcano
  ['Lava Loop', 5], ['Ember Ridge', 5], ['Ashfall Arena', 5], ['Magma Mayhem', 5], ["Dragon's Breath", 5],
  // Swamp
  ['Mossy Marsh', 6], ['Gator Gulch', 6], ['Firefly Fen', 6], ['Boggy Bottoms', 6], ['Mirefire Maze', 6],
  // Canyon
  ['Red Rock Rally', 7], ['Mesa Madness', 7], ['Gulch Run', 7], ['Coyote Cliffs', 7], ['Rattlesnake Ridge', 7],
  // Farm
  ['Haybale Highway', 8], ['Barnyard Bash', 8], ['Tractor Trail', 8], ['Cornfield Cruise', 8], ['Sunflower Sprint', 8],
  // Night
  ['Starlight Speedway', 9], ['Neon Nook', 9], ['Glowworm Grove', 9], ['Moonbeam Mile', 9], ['Aurora Drive', 9],
];

export const MAPS = RAW_MAPS.map((m, i) => ({
  id: i, name: m[0], theme: m[1], seed: i * 777 + 1337,
  laps: 2,
}));
