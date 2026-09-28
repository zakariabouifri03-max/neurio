// ── BOOYAH FIRE — game data: weapons, characters, skins, items, maps ─────────
// Everything is data-driven so the sim / view / shop all read from one place.

// ═══════════════════════════ WEAPONS ════════════════════════════════════════
// dmg      damage per bullet at point-blank (before armor)
// rpm      rounds per minute
// mag      magazine size, reserve = mag * 4
// spread   hip-fire cone in degrees (ADS halves it)
// hs       headshot multiplier
// falloff  range (m) where damage starts dropping → 55% at maxRange
// pellets  >1 for shotguns
export const WEAPONS = {
  usp:    { name: 'USP',        icon: '🔫', kind: 'pistol',  dmg: 24, rpm: 320, mag: 12, spread: 2.6, hs: 1.8, falloff: 22, maxRange: 60,  reload: 1.5, rarity: 1, desc: 'Sidearm' },
  deagle: { name: 'DESERT EAGLE', icon: '🔫', kind: 'pistol', dmg: 62, rpm: 175, mag: 7,  spread: 3.2, hs: 2.2, falloff: 30, maxRange: 75,  reload: 1.9, rarity: 2, desc: 'Hand cannon' },
  uzi:    { name: 'UZI',        icon: '🧨', kind: 'smg',     dmg: 14, rpm: 970, mag: 26, spread: 3.4, hs: 1.5, falloff: 16, maxRange: 42,  reload: 1.6, rarity: 2, desc: 'Spray & pray' },
  mp40:   { name: 'MP40',       icon: '🧨', kind: 'smg',     dmg: 18, rpm: 690, mag: 25, spread: 2.8, hs: 1.5, falloff: 20, maxRange: 48,  reload: 1.8, rarity: 2, desc: 'Classic SMG' },
  p90:    { name: 'P90',        icon: '🧨', kind: 'smg',     dmg: 16, rpm: 850, mag: 32, spread: 2.4, hs: 1.6, falloff: 22, maxRange: 55,  reload: 2.0, rarity: 3, desc: 'Big magazine' },
  vector: { name: 'VECTOR',     icon: '🧨', kind: 'smg',     dmg: 17, rpm: 1050, mag: 22, spread: 2.2, hs: 1.6, falloff: 20, maxRange: 50,  reload: 1.7, rarity: 3, desc: 'Laser fire rate' },
  ump:    { name: 'UMP',        icon: '🧨', kind: 'smg',     dmg: 22, rpm: 610, mag: 25, spread: 2.5, hs: 1.6, falloff: 24, maxRange: 60,  reload: 1.9, rarity: 3, desc: 'Hard hitter' },
  ak:     { name: 'AK47',       icon: '💥', kind: 'ar',      dmg: 31, rpm: 555, mag: 30, spread: 3.0, hs: 1.9, falloff: 42, maxRange: 110, reload: 2.2, rarity: 3, desc: 'Heavy recoil, big damage' },
  m4a1:   { name: 'M4A1',       icon: '💥', kind: 'ar',      dmg: 27, rpm: 660, mag: 30, spread: 2.3, hs: 1.8, falloff: 45, maxRange: 115, reload: 2.1, rarity: 3, desc: 'All-rounder' },
  scar:   { name: 'SCAR',       icon: '💥', kind: 'ar',      dmg: 30, rpm: 600, mag: 30, spread: 2.5, hs: 1.8, falloff: 44, maxRange: 112, reload: 2.2, rarity: 3, desc: 'Stable and strong' },
  xm8:    { name: 'XM8',        icon: '💥', kind: 'ar',      dmg: 26, rpm: 700, mag: 30, spread: 2.2, hs: 1.8, falloff: 46, maxRange: 118, reload: 2.0, rarity: 2, desc: 'Fast AR' },
  sks:    { name: 'SKS',        icon: '🎯', kind: 'dmr',     dmg: 54, rpm: 215, mag: 10, spread: 1.5, hs: 1.8, falloff: 70, maxRange: 180, reload: 2.4, rarity: 3, desc: 'Marksman rifle' },
  kar98k: { name: 'KAR98K',     icon: '🎯', kind: 'sniper',  dmg: 92, rpm: 52,  mag: 5,  spread: 0.7, hs: 2.5, falloff: 90, maxRange: 260, reload: 3.0, rarity: 4, desc: 'One-shot body; bolt-action' },
  awm:    { name: 'AWM',        icon: '🎯', kind: 'sniper',  dmg: 120, rpm: 42, mag: 5,  spread: 0.55, hs: 2.5, falloff: 95, maxRange: 300, reload: 3.4, rarity: 5, desc: 'The king of long range' },
  m1014:  { name: 'M1014',      icon: '💫', kind: 'shotgun', dmg: 21, rpm: 95,  mag: 7,  spread: 7.5, hs: 1.4, pellets: 6, falloff: 9, maxRange: 30, reload: 2.6, rarity: 3, desc: 'Semi-auto shotgun' },
  m500:   { name: 'M500',       icon: '💫', kind: 'shotgun', dmg: 30, rpm: 62,  mag: 5,  spread: 6.5, hs: 1.4, pellets: 5, falloff: 8, maxRange: 26, reload: 3.0, rarity: 4, desc: 'Pump shotgun, huge burst' },
};

export const AMMO_BOX = 0.35;             // fraction of a full reserve per ammo pickup
export const RELOAD_MULT_EMPTY = 1.15;    // reloading from empty is slower

// ═══════════════════════════ ARMOR / ITEMS ══════════════════════════════════
export const VEST = {
  0: { red: 0,     name: 'No Vest',  color: '#6b7280' },
  1: { red: 0.20,  name: 'Vest Lv1', color: '#9ca3af' },
  2: { red: 0.35,  name: 'Vest Lv2', color: '#60a5fa' },
  3: { red: 0.50,  name: 'Vest Lv3', color: '#f59e0b' },
};
export const HELMET = {
  0: { red: 0,     name: 'No Helmet',  color: '#6b7280' },
  1: { red: 0.30,  name: 'Helmet Lv1', color: '#9ca3af' },
  2: { red: 0.50,  name: 'Helmet Lv2', color: '#60a5fa' },
  3: { red: 0.65,  name: 'Helmet Lv3', color: '#f59e0b' },
};

// ═══════════════════════════ VEHICLES ══════════════════════════════════════
// Arcade handling: topSpeed in m/s, accel in m/s², turn in rad/s at full steer.
export const VEHICLES = {
  jeep:  { id: 'jeep',  name: 'Off-Roader', icon: '🚙', topSpeed: 21, accel: 9.5,  turn: 1.55, hp: 260, seats: 4, mass: 1.0,  color: '#4b5563', water: false, size: [2.1, 1.7, 4.2] },
  buggy: { id: 'buggy', name: 'Buggy',      icon: '🛻', topSpeed: 24, accel: 12,   turn: 2.0,  hp: 190, seats: 2, mass: 0.8,  color: '#b45309', water: false, size: [1.9, 1.5, 3.4] },
  bike:  { id: 'bike',  name: 'Bike',       icon: '🏍️', topSpeed: 28, accel: 14,   turn: 2.4,  hp: 120, seats: 1, mass: 0.55, color: '#7c3aed', water: false, size: [1.0, 1.2, 2.2] },
  boat:  { id: 'boat',  name: 'Boat',       icon: '🚤', topSpeed: 19, accel: 8,    turn: 1.5,  hp: 200, seats: 3, mass: 0.9,  color: '#0ea5e9', water: true,  size: [2.0, 1.1, 4.6] },
};

// Backpacks raise how much you can carry: ammo reserve cap and consumable stacks.
export const BAG = {
  0: { name: 'No Bag',  color: '#6b7280', reserve: 3.0, carry: 1.00 },
  1: { name: 'Bag Lv1', color: '#9ca3af', reserve: 4.0, carry: 1.30 },
  2: { name: 'Bag Lv2', color: '#60a5fa', reserve: 5.5, carry: 1.70 },
  3: { name: 'Bag Lv3', color: '#f59e0b', reserve: 7.0, carry: 2.20 },
};

export const ITEMS = {
  medkit:    { name: 'Medkit',      icon: '🧰', heal: 75, useTime: 2.6, max: 3, color: '#ef4444', desc: 'Heals 75 HP' },
  firstaid:  { name: 'First Aid',   icon: '💊', heal: 40, useTime: 1.5, max: 5, color: '#f87171', desc: 'Heals 40 HP' },
  gloo:      { name: 'Gloo Wall',   icon: '🧊', useTime: 0.4, max: 3, color: '#38bdf8', desc: 'Instant ice cover' },
  grenade:   { name: 'Frag Grenade',icon: '💣', dmg: 118, radius: 7.5, fuse: 2.6, max: 3, color: '#a3e635', desc: 'Explodes, big damage' },
  smoke:     { name: 'Smoke',       icon: '💨', radius: 6.5, fuse: 1.2, dur: 14, max: 3, color: '#cbd5e1', desc: 'Blocks vision for 14s' },
  flash:     { name: 'Flashbang',   icon: '⚡', radius: 9, fuse: 1.1, max: 2, color: '#fde047', desc: 'Blinds nearby enemies' },
  ammo:      { name: 'Ammo',        icon: '📦', max: 4, color: '#fbbf24', desc: 'Refills magazines' },
};

// ═══════════════════════════ ATTACHMENTS ════════════════════════════════════
export const ATTACH = {
  muzzle: { name: 'Muzzle',  icon: '🔩', spread: -0.22, dmg: 2 },
  grip:   { name: 'Grip',    icon: '🖐️', spread: -0.30, recoil: -0.2 },
  mag:    { name: 'Ext. Mag',icon: '📏', mag: 10, reload: 0.15 },
  stock:  { name: 'Stock',   icon: '🪵', recoil: -0.35, spread: -0.12 },
  scope:  { name: 'Scope',   icon: '🔭', zoom: 0.55, spread: -0.15 },
};

// ═══════════════════════════ CHARACTERS (pets too) ══════════════════════════
// perk: hp / speed / reload / dmg multipliers, all tiny so balance stays sane
export const CHARACTERS = [
  { id: 'kelly',  name: 'Kelly',   emoji: '🏃‍♀️', rarity: 2, price: 0,     coins: 0,    skin: '#f472b6', perk: { speed: 1.08, label: 'Dash: +8% run speed' } },
  { id: 'alok',   name: 'Alok',    emoji: '🎧', rarity: 3, price: 0,     coins: 0,    skin: '#22d3ee', perk: { speed: 1.04, reload: 0.92, label: 'Drop the Beat: +4% speed, faster reload' } },
  { id: 'chrono', name: 'Chrono',  emoji: '🕶️', rarity: 4, price: 320,   coins: 2800, skin: '#38bdf8', perk: { hp: 15, label: 'Time Turner: +15 max HP' } },
  { id: 'wukong', name: 'Wukong',  emoji: '🐒', rarity: 4, price: 340,   coins: 3000, skin: '#f59e0b', perk: { speed: 1.06, hp: 10, label: '+10 HP, +6% speed' } },
  { id: 'dj',     name: 'Dimitri', emoji: '🎹', rarity: 4, price: 320,   coins: 2600, skin: '#a78bfa', perk: { hp: 20, speed: 0.97, label: '+20 max HP' } },
  { id: 'hayato', name: 'Hayato',  emoji: '⚔️', rarity: 5, price: 520,   coins: 4800, skin: '#ef4444', perk: { dmg: 1.07, hp: 10, label: 'Bushido: +7% damage, +10 HP' } },
  { id: 'frost',  name: 'Frost',   emoji: '❄️', rarity: 4, price: 300,   coins: 2400, skin: '#67e8f9', perk: { speed: 1.03, reload: 0.9, label: 'Frozen: faster reload' } },
  { id: 'skyler', name: 'Skyler',  emoji: '🎤', rarity: 5, price: 500,   coins: 4600, skin: '#f0abfc', perk: { dmg: 1.05, speed: 1.05, label: 'Gloo Wall master: +5% dmg & speed' } },
  { id: 'frank',  name: 'Frankie', emoji: '🧢', rarity: 3, price: 180,   coins: 1400, skin: '#4ade80', perk: { speed: 1.02, hp: 10, label: '+10 HP, +2% speed' } },
  { id: 'antonio',name: 'Antonio', emoji: '💪', rarity: 3, price: 160,   coins: 1200, skin: '#fb923c', perk: { hp: 25, speed: 0.96, label: '+25 max HP, a bit slower' } },
  { id: 'aurora', name: 'Aurora',  emoji: '🌈', rarity: 5, price: 700,   coins: 6000, skin: '#c084fc', perk: { hp: 15, dmg: 1.06, speed: 1.03, label: 'Legend: +15 HP, +6% dmg, +3% speed' } },
  { id: 'ninja',  name: 'Shadow',  emoji: '🥷', rarity: 5, price: 650,   coins: 5500, skin: '#334155', perk: { speed: 1.10, dmg: 1.04, label: 'Silent step: +10% speed, +4% dmg' } },
];

export const PETS = [
  { id: 'none',  name: 'No Pet',   emoji: '🚫', rarity: 1, price: 0,   coins: 0,    perk: {} },
  { id: 'cat',   name: 'Kitty',    emoji: '🐱', rarity: 2, price: 80,  coins: 600,  perk: { hp: 8, label: '+8 HP' } },
  { id: 'dog',   name: 'Puppy',    emoji: '🐶', rarity: 2, price: 90,  coins: 700,  perk: { speed: 1.03, label: '+3% speed' } },
  { id: 'panda', name: 'Panda',    emoji: '🐼', rarity: 3, price: 150, coins: 1300, perk: { dmg: 1.04, label: '+4% damage' } },
  { id: 'eagle', name: 'Eagle',    emoji: '🦅', rarity: 3, price: 170, coins: 1500, perk: { reload: 0.92, label: 'Faster reload' } },
  { id: 'falco', name: 'Falco',    emoji: '🐉', rarity: 4, price: 320, coins: 3000, perk: { hp: 12, dmg: 1.05, label: '+12 HP, +5% dmg' } },
];

// ═══════════════════════════ SKINS (costume / gun / parachute) ══════════════
export const SKINS_CHAR = [
  { id: 'cs0', name: 'Recruit',      price: 0,   coins: 0,    colors: ['#3f8f5c', '#2c6e45', '#e8c39e'] },
  { id: 'cs1', name: 'Urban Ninja',  price: 90,  coins: 800,  colors: ['#242a38', '#3b4357', '#d9a273'] },
  { id: 'cs2', name: 'Desert Fox',   price: 110, coins: 950,  colors: ['#c1a05e', '#8d7440', '#f0c9a0'] },
  { id: 'cs3', name: 'Cyber Renegade', price: 240, coins: 2100, colors: ['#12d3f0', '#0b2b4a', '#f6d6b8'] },
  { id: 'cs4', name: 'Crimson Elite', price: 260, coins: 2400, colors: ['#c0261f', '#1b1b22', '#eec2a0'] },
  { id: 'cs5', name: 'Golden Legend', price: 520, coins: 5200, colors: ['#ffd23f', '#4a3a12', '#f4c9a4'] },
  { id: 'cs6', name: 'Arctic Ghost',  price: 300, coins: 2900, colors: ['#e8f4ff', '#9fc3e0', '#f6d8bd'] },
  { id: 'cs7', name: 'Jungle Reaper', price: 200, coins: 1800, colors: ['#2f6b34', '#16240f', '#e6b98f'] },
];
export const SKINS_GUN = [
  { id: 'gs0', name: 'Factory',     price: 0,   coins: 0,    tint: '#3b3f47', accent: '#22252b' },
  { id: 'gs1', name: 'Desert Camo', price: 70,  coins: 600,  tint: '#b99a5e', accent: '#8a7440' },
  { id: 'gs2', name: 'Neon Flux',   price: 160, coins: 1400, tint: '#22d3ee', accent: '#0f172a' },
  { id: 'gs3', name: 'Gold Baron',  price: 320, coins: 3200, tint: '#ffcc33', accent: '#7a5c10' },
  { id: 'gs4', name: 'Blood Moon',  price: 260, coins: 2500, tint: '#a11d2b', accent: '#2a0f14' },
];
export const SKINS_CHUTE = [
  { id: 'ps0', name: 'Standard',  price: 0,   coins: 0,    a: '#e94f37', b: '#f6f7f9' },
  { id: 'ps1', name: 'Sky Blue',  price: 60,  coins: 500,  a: '#2f9be8', b: '#dff1ff' },
  { id: 'ps2', name: 'Hazard',    price: 120, coins: 1100, a: '#facc15', b: '#1f2937' },
  { id: 'ps3', name: 'Sunset',    price: 150, coins: 1400, a: '#fb7185', b: '#fde68a' },
  { id: 'ps4', name: 'Diamond',   price: 400, coins: 4000, a: '#a5f3fc', b: '#f0f9ff' },
];

// ═══════════════════════════ RANKS ══════════════════════════════════════════
export const RANKS = [
  { n: 'Bronze I',   xp: 0,    emoji: '🥉' },
  { n: 'Bronze II',  xp: 250,  emoji: '🥉' },
  { n: 'Bronze III', xp: 600,  emoji: '🥉' },
  { n: 'Silver I',   xp: 1150, emoji: '🥈' },
  { n: 'Silver II',  xp: 1850, emoji: '🥈' },
  { n: 'Silver III', xp: 2700, emoji: '🥈' },
  { n: 'Gold I',     xp: 3800, emoji: '🥇' },
  { n: 'Gold II',    xp: 5200, emoji: '🥇' },
  { n: 'Gold III',   xp: 6900, emoji: '🥇' },
  { n: 'Platinum I', xp: 9000, emoji: '💠' },
  { n: 'Platinum II',xp: 11600,emoji: '💠' },
  { n: 'Diamond I',  xp: 14800,emoji: '💎' },
  { n: 'Diamond II', xp: 18600,emoji: '💎' },
  { n: 'Heroic',     xp: 23400,emoji: '🔥' },
  { n: 'GRANDMASTER',xp: 30000,emoji: '👑' },
];
export function rankFor(xp) {
  let r = RANKS[0], i = 0;
  for (; i < RANKS.length; i++) if (xp >= RANKS[i].xp) r = RANKS[i]; else break;
  const next = RANKS[i] || null;
  return { rank: r, next, index: Math.max(0, i - (next ? 1 : 0)) };
}

// ═══════════════════════════ MATCH MODES ════════════════════════════════════
export const MODES = [
  { id: 'solo',   name: 'Solo',        team: 1, bots: 39, icon: '🪖' },
  { id: 'duo',    name: 'Duo',         team: 2, bots: 23, icon: '👥' },
  { id: 'squad',  name: 'Squad',       team: 4, bots: 11, icon: '🧑‍🤝‍🧑' },
];

// ═══════════════════════════ LOOT TABLES ════════════════════════════════════
// tier 1 = common floor loot · tier 2 = better · tier 3 = airdrop-grade
export const LOOT = {
  weapons: {
    1: ['usp', 'uzi', 'mp40', 'xm8', 'm1014', 'ump'],
    2: ['ak', 'm4a1', 'scar', 'vector', 'm500', 'deagle', 'sks', 'p90'],
    3: ['awm', 'kar98k', 'sks', 'm500', 'vector', 'p90'],
  },
  gear: { 1: [1, 1, 1, 2], 2: [2, 2, 2, 3], 3: [3, 3, 3] },
  items: { 1: ['firstaid', 'gloo', 'smoke', 'ammo'], 2: ['medkit', 'gloo', 'grenade', 'firstaid', 'flash'], 3: ['medkit', 'grenade', 'gloo'] },
};

// ═══════════════════════════ ISLAND THEMES ══════════════════════════════════
export const ISLANDS = [
  { id: 'bermuda',  name: 'Bermuda',        emoji: '🏝️', sky: ['#1e5fd0', '#8fc6f5', '#ffd9a1'], fog: '#cfe6ff', sun: '#fff3d0', grass: '#5d8a3c', sand: '#e0c98d', rock: '#8a8574', tree: 1.0, water: '#2f7fb8' },
  { id: 'purgatory',name: 'Purgatory',      emoji: '🌋', sky: ['#2a1e46', '#a8557a', '#ffb35c'], fog: '#ffb9a0', sun: '#ffd7a0', grass: '#6b7a44', sand: '#d8b483', rock: '#6d6259', tree: 0.7, water: '#3d5f7a' },
  { id: 'kalahari', name: 'Kalahari',       emoji: '🏜️', sky: ['#1b4fa8', '#9fc7e8', '#ffe7b0'], fog: '#f2e0b8', sun: '#fff0c8', grass: '#a89550', sand: '#e8cf95', rock: '#b09468', tree: 0.35, water: '#3f86a8' },
  { id: 'alpine',   name: 'Alpine',         emoji: '🏔️', sky: ['#2d6fd6', '#bcdcff', '#eef7ff'], fog: '#e6f2ff', sun: '#ffffff', grass: '#5f8a5a', sand: '#cbc6ad', rock: '#9aa0a8', tree: 1.2, water: '#2f6f9f' },
  { id: 'volcano',  name: 'Ashlands',       emoji: '🌋', sky: ['#341c1c', '#8a3a2a', '#ffab5c'], fog: '#e8a072', sun: '#ffc98a', grass: '#6a5a3a', sand: '#6f6257', rock: '#4a423d', tree: 0.4, water: '#5a4a3a' },
  { id: 'sunset',   name: 'Sunset Cove',    emoji: '🌅', sky: ['#2e3f8f', '#f08a5d', '#ffd8a8'], fog: '#ffd0a8', sun: '#ffe0a8', grass: '#7a8a44', sand: '#f0d9a8', rock: '#9c8a74', tree: 0.9, water: '#3a6f9f' },
  { id: 'stardust', name: 'Stardust Night', emoji: '🌌', sky: ['#070b2a', '#1b2a5e', '#4a5fa8'], fog: '#2a3a6a', sun: '#cfe0ff', grass: '#3a5a55', sand: '#8f9bb0', rock: '#585f78', tree: 0.8, water: '#1b3a5a' },
  { id: 'jungle',   name: 'Deep Jungle',    emoji: '🌴', sky: ['#1d6fa8', '#7fc7a8', '#dff5c8'], fog: '#cfeecf', sun: '#f0ffd0', grass: '#3f7a34', sand: '#cdb888', rock: '#6f7a55', tree: 1.6, water: '#2f7f7a' },
];

// ═══════════════════════════ LOBBY WHEEL (free daily spin) ══════════════════
export const WHEEL = [
  { kind: 'coins', amount: 200,  label: '200 🪙',   weight: 26 },
  { kind: 'coins', amount: 500,  label: '500 🪙',   weight: 18 },
  { kind: 'coins', amount: 900,  label: '900 🪙',   weight: 10 },
  { kind: 'diamonds', amount: 5, label: '5 💎',     weight: 16 },
  { kind: 'diamonds', amount: 15,label: '15 💎',    weight: 8 },
  { kind: 'xp', amount: 150,     label: '150 XP',   weight: 12 },
  { kind: 'skin', label: 'Gun Skin', weight: 6 },
  { kind: 'char', label: 'Character', weight: 4 },
];

// ═══════════════════════════ BOT NAMES ══════════════════════════════════════
export const BOT_NAMES = [
  'AlphaWolf', 'RageQueen', 'NoScope77', 'BushCamper', 'Headshot_Hassan', 'LaylaX', 'ZaidPro', 'Ninja_Omar',
  'AkRush', 'Sn1perKing', 'MedkitMona', 'GlooGuru', 'ZeroRecoil', 'Panda_Boss', 'Tanjiro', 'Sara_Snipz',
  'Dr0pSh0t', 'Kraken', 'FlashBang', 'M4_Master', 'GhostRider', 'Toxic_Tariq', 'BooyahBoy', 'LoneWolf',
  'QuickScope', 'SaltySam', 'IronFist', 'Neon_Nora', 'TurboTurki', 'HijabSniper', 'RocketRana', 'SilentSniper',
  'SkullCrusher', 'MissFortune', 'Kamikaze', 'DustyDan', 'ViperX', 'ClutchKing', 'PanMaster', 'TinyTerror',
  'Wraith', 'Blitz', 'Cobra', 'SaharaFox', 'Midnight_Owl', 'Frostbyte', 'ThunderNour', 'JokerJr',
  'BloodMoon', 'SkyDiver', 'Rampage', 'Cheetah', 'HotShot', 'MangoMan', 'Sniper_Salma', 'RawPower',
  'GlooWallGod', 'PanTheMan', 'AceOfAces', 'NightRaid', 'SandStorm', 'KwaiiKitty', 'BigBoss_Bilal', 'Echo',
];

// ═══════════════════════════ ECONOMY ════════════════════════════════════════
export const ECONOMY = {
  perKill: { coins: 35, xp: 30 },
  perKnock: { coins: 10, xp: 8 },
  booyah: { coins: 450, xp: 350, diamonds: 6 },
  top3: { coins: 220, xp: 180, diamonds: 2 },
  top10: { coins: 90, xp: 90, diamonds: 0 },
  perPlace: { coins: 6, xp: 5 },      // per rank above 10th
  perDamage: { coins: 0.35, xp: 0.9 },
  survival: { coinsPerSec: 0.35, xpPerSec: 0.5 },
  spinCost: 300,                       // daily spin is free once/day
};

export const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'First Blood',      desc: 'Get your first kill',            reward: 150, test: (s) => s.kills >= 1 },
  { id: 'booyah1',     name: 'BOOYAH!',          desc: 'Win your first match',           reward: 300, test: (s) => s.wins >= 1 },
  { id: 'kill10',      name: 'Sharpshooter',     desc: '10 total kills',                 reward: 250, test: (s) => s.kills >= 10 },
  { id: 'kill50',      name: 'Walking Arsenal',  desc: '50 total kills',                 reward: 600, test: (s) => s.kills >= 50 },
  { id: 'kill150',     name: 'Island Legend',    desc: '150 total kills',                reward: 1500, test: (s) => s.kills >= 150 },
  { id: 'win10',       name: 'Back-to-Back',     desc: 'Win 10 matches',                 reward: 900, test: (s) => s.wins >= 10 },
  { id: 'dmg5000',     name: 'Damage Dealer',    desc: 'Deal 5,000 total damage',        reward: 400, test: (s) => s.damage >= 5000 },
  { id: 'headshot25',  name: 'Head Hunter',      desc: '25 headshot kills',              reward: 500, test: (s) => s.headshots >= 25 },
  { id: 'survive600',  name: 'Long Haul',        desc: 'Survive 10 minutes total',       reward: 350, test: (s) => s.survival >= 600 },
  { id: 'matches10',   name: 'Regular',          desc: 'Play 10 matches',                reward: 200, test: (s) => s.matches >= 10 },
];
