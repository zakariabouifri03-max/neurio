// ── STREAMER LIFE 2 — full game catalog: parts, furniture, houses, cars,
//    streamable games, food, quests, sponsors ────────────────────────────────

// PC part categories — tier 0 is whatever (usually nothing) you start with.
// power = stream quality score. Buy tiers in the shop; best owned tier counts.
export const PART_CATS = [
  { id: 'mic',      name: 'Microphone',  emoji: '🎙️', start: 0 },
  { id: 'webcam',   name: 'Webcam',      emoji: '📷', start: 0 },
  { id: 'cpu',      name: 'CPU',         emoji: '🧠', start: 1 },
  { id: 'gpu',      name: 'Graphics Card', emoji: '🎮', start: 1 },
  { id: 'ram',      name: 'RAM',         emoji: '💾', start: 1 },
  { id: 'monitor',  name: 'Monitor',     emoji: '🖥️', start: 1 },
  { id: 'keyboard', name: 'Keyboard',    emoji: '⌨️', start: 1 },
  { id: 'chair',    name: 'Gamer Chair', emoji: '🪑', start: 1 },
  { id: 'rgb',      name: 'RGB Lighting', emoji: '🌈', start: 0 },
];

export const PARTS = {
  mic: [
    { t: 1, name: 'Old Headset Mic', price: 45,   power: 3,  desc: 'Crackly but it works.' },
    { t: 2, name: 'Condenser Mic',   price: 240,  power: 9,  desc: 'Podcast-quality sound.' },
    { t: 3, name: 'SM7B Pro',        price: 560,  power: 15, desc: 'What the pros use.' },
  ],
  webcam: [
    { t: 1, name: '720p Webcam', price: 85,  power: 4,  desc: 'Chat can finally see you.' },
    { t: 2, name: '4K Cam',      price: 380, power: 10, desc: 'Crisp face-cam, instant charisma.' },
  ],
  cpu: [
    { t: 2, name: 'QuadCore 3.2',    price: 220,  power: 8,  desc: 'No more slideshow streams.' },
    { t: 3, name: 'OctaCore X',      price: 520,  power: 16, desc: 'Smooth encoding, zero lag.' },
    { t: 4, name: 'ThreadRipper 32', price: 1450, power: 26, desc: 'A CPU with a fan the size of a pizza.' },
  ],
  gpu: [
    { t: 2, name: 'GTX 1060',    price: 290,  power: 10, desc: 'Plays most games on medium.' },
    { t: 3, name: 'RTX 3070',    price: 680,  power: 20, desc: 'Now we are talking.' },
    { t: 4, name: 'RTX 4080',    price: 1350, power: 34, desc: 'Raytraced everything.' },
    { t: 5, name: 'RTX 5090 Ti', price: 2600, power: 52, desc: 'Melts frames. And wallets.' },
  ],
  ram: [
    { t: 2, name: '16GB DDR4',    price: 120, power: 5,  desc: 'Chrome tabs without fear.' },
    { t: 3, name: '32GB RGB DDR5', price: 340, power: 11, desc: 'Glows. Obviously.' },
  ],
  monitor: [
    { t: 2, name: '144Hz 27"',   price: 260, power: 6,  desc: 'But can it run 144fps?' },
    { t: 3, name: 'UltraWide 34"', price: 750, power: 12, desc: 'Chat + game + vibes, one screen.' },
  ],
  keyboard: [
    { t: 2, name: 'Mech RGB', price: 130, power: 4, desc: 'Clicky. Chat loves the ASMR.' },
  ],
  chair: [
    { t: 2, name: 'Office Chair', price: 190, power: 2, desc: 'Your back says thank you.' },
    { t: 3, name: 'Throne X',     price: 650, power: 6, desc: 'A real gamer throne, reclines 180°.' },
  ],
  rgb: [
    { t: 1, name: 'LED Strip',   price: 45,  power: 2, vibe: 3,  desc: 'Purple glow starter pack.' },
    { t: 2, name: 'Nano Panels', price: 280, power: 4, vibe: 8,  desc: 'Wall triangles of power.' },
    { t: 3, name: 'Full RGB Kit', price: 720, power: 6, vibe: 14, desc: 'Your room is now a spaceship.' },
  ],
};

export function partById(cat, t) {
  return (PARTS[cat] || []).find((p) => p.t === t) || null;
}

// ── Furniture (placed in house slots) ───────────────────────────────────────
export const FURNITURE = [
  { id: 'plant',    name: 'Potted Plant',  emoji: '🪴', price: 60,   slot: 'floor', desc: '+100 room freshness.' },
  { id: 'posterA',  name: 'Movie Poster',  emoji: '🖼️', price: 35,   slot: 'wall',  desc: 'Cult classic.' },
  { id: 'posterB',  name: 'Band Poster',   emoji: '🎸', price: 35,   slot: 'wall',  desc: 'Turn it up.' },
  { id: 'lamp',     name: 'Floor Lamp',    emoji: '💡', price: 90,   slot: 'floor', desc: 'Cozy warm light.' },
  { id: 'rug',      name: 'Fluffy Rug',    emoji: '🟣', price: 150,  slot: 'floor', desc: 'So soft.' },
  { id: 'shelf',    name: 'Gamer Shelf',   emoji: '🗄️', price: 220,  slot: 'wall',  desc: 'For your collectibles.' },
  { id: 'sofa',     name: 'Comfy Sofa',    emoji: '🛋️', price: 480,  slot: 'floor', desc: 'Nap-approved.' },
  { id: 'tv',       name: 'Big TV',        emoji: '📺', price: 700,  slot: 'floor', desc: 'Watch your own VODs in 4K.' },
  { id: 'neon',     name: 'Neon Sign',     emoji: '🔮', price: 260,  slot: 'wall',  desc: '"ON AIR" in neon.' },
  { id: 'arcade',   name: 'Arcade Cab',    emoji: '🕹️', price: 1500, slot: 'floor', desc: 'Retro cred for the stream.' },
  { id: 'disco',    name: 'Disco Ball',    emoji: '🪩', price: 420,  slot: 'wall',  desc: 'Every stream is a party.' },
  { id: 'goldpc',   name: 'Gold PC Case',  emoji: '🏆', price: 3000, slot: 'floor', desc: '24-karat flex. Purely cosmetic. Purely worth it.' },
];

// ── Food ────────────────────────────────────────────────────────────────────
export const FOOD = [
  { id: 'noodles', name: 'Instant Noodles', emoji: '🍜', price: 3,  hunger: 18, energy: 0 },
  { id: 'coffee',  name: 'Coffee',          emoji: '☕', price: 4,  hunger: 4,  energy: 22 },
  { id: 'burger',  name: 'Burger',          emoji: '🍔', price: 7,  hunger: 35, energy: 5 },
  { id: 'energy',  name: 'Energy Drink',    emoji: '🥤', price: 6,  hunger: 2,  energy: 38 },
  { id: 'pizza',   name: 'Pizza',           emoji: '🍕', price: 11, hunger: 55, energy: 8 },
  { id: 'sushi',   name: 'Sushi Set',       emoji: '🍣', price: 18, hunger: 70, energy: 12 },
  { id: 'steak',   name: 'Royal Steak',     emoji: '🥩', price: 28, hunger: 100, energy: 15 },
];

// ── Houses ──────────────────────────────────────────────────────────────────
// rent>0 → rented (daily rent). slots = furniture slot count.
export const HOUSES = [
  { id: 'room',    name: 'Rented Room',    emoji: '🚪', price: 0,      rent: 40, slots: 4,  size: [7, 6],   desc: 'A tiny room above the noodle shop. The dream starts here.' },
  { id: 'studio',  name: 'Studio Apartment', emoji: '🏢', price: 12000,  rent: 0,  slots: 8,  size: [9, 7],   desc: 'Your own place! Small, but no landlord breathing down your neck.' },
  { id: 'flat',    name: 'City Apartment', emoji: '🌆', price: 45000,  rent: 0,  slots: 12, size: [11, 8],  desc: 'Big windows, city view, room for a REAL setup.' },
  { id: 'villa',   name: 'Suburban Villa', emoji: '🏡', price: 120000, rent: 0,  slots: 16, size: [13, 10], desc: 'A whole house. The neighbors already hate your RGB.' },
  { id: 'mansion', name: 'Neon Mansion',   emoji: '🏰', price: 500000, rent: 0,  slots: 22, size: [16, 12], desc: 'The endgame. Streaming palace of legends.' },
];
export const houseById = (id) => HOUSES.find((h) => h.id === id);

// ── Cars ────────────────────────────────────────────────────────────────────
export const CARS = [
  { id: 'buggy',  name: 'Beach Buggy', emoji: '🏖️', price: 3500,   speed: 17, accel: 9,  turn: 2.6, color: 0xf2b705, desc: 'Bash Baqi approved. Sand-proof(ish).' },
  { id: 'hatch',  name: 'City Hatch',  emoji: '🚗', price: 9500,   speed: 23, accel: 11, turn: 2.3, color: 0x4f9cff, desc: 'Reliable. Has a cup holder.' },
  { id: 'sport',  name: 'Sport Coupe', emoji: '🏎️', price: 48000,  speed: 32, accel: 16, turn: 2.4, color: 0xe33b3b, desc: 'Loud. Fast. Chat will notice.' },
  { id: 'super',  name: 'Hyper GT',    emoji: '🚀', price: 155000, speed: 42, accel: 22, turn: 2.6, color: 0xb44dff, desc: 'Spaceship with plates. 0-100 in "yes".' },
];
export const carById = (id) => CARS.find((c) => c.id === id);

// ── Games you can stream ────────────────────────────────────────────────────
// minPower = required PC power score, minFol = follower requirement.
export const GAMES = [
  { id: 'blocks', name: 'Block Craft',         emoji: '🧱', minPower: 0,   minFol: 0,     hype: 1.0,  reward: 1.0 },
  { id: 'baqi',   name: 'Bash Baqi Racing',    emoji: '🏁', minPower: 18,  minFol: 0,     hype: 1.15, reward: 1.1 },
  { id: 'obby',   name: 'Mega Obby Run',       emoji: '🏃', minPower: 26,  minFol: 100,   hype: 1.1,  reward: 1.05 },
  { id: 'farm',   name: 'Valley Farm Life',    emoji: '🌾', minPower: 36,  minFol: 350,   hype: 1.2,  reward: 1.15 },
  { id: 'shoot',  name: 'Neon Strike',         emoji: '🎯', minPower: 58,  minFol: 900,   hype: 1.35, reward: 1.3 },
  { id: 'horror', name: 'Silent Basement',     emoji: '👻', minPower: 66,  minFol: 1800,  hype: 1.5,  reward: 1.4 },
  { id: 'moba',   name: 'Legends Arena',       emoji: '⚔️', minPower: 88,  minFol: 4000,  hype: 1.55, reward: 1.5 },
  { id: 'empire', name: 'Empire City Stories', emoji: '🚓', minPower: 115, minFol: 10000, hype: 1.7,  reward: 1.65 },
  { id: 'cyber',  name: 'Cyber Ronin 2077',    emoji: '🤖', minPower: 150, minFol: 25000, hype: 1.85, reward: 1.8 },
  { id: 'star',   name: 'Star Odyssey X',      emoji: '🚀', minPower: 190, minFol: 70000, hype: 2.0,  reward: 2.0 },
];

// ── Story quests (delivered by email, tracked in HUD) ──────────────────────
export const QUESTS = [
  { id: 'q1', title: 'Get a voice', goal: 'Buy any microphone', reward: 120, check: (s) => s.parts.mic >= 1 },
  { id: 'q2', title: 'First stream', goal: 'Finish your first stream', reward: 180, check: (s) => s.streams >= 1 },
  { id: 'q3', title: 'Getting noticed', goal: 'Reach 100 followers', reward: 350, check: (s) => s.followers >= 100 },
  { id: 'q4', title: 'Sponsor call', goal: 'Upgrade your GPU (tier 2+)', reward: 2200, check: (s) => s.parts.gpu >= 2, sponsor: 'soda' },
  { id: 'q5', title: 'Rising star', goal: 'Reach 1,000 followers', reward: 1600, check: (s) => s.followers >= 1000 },
  { id: 'q6', title: 'Brand deal', goal: 'Reach 10,000 followers', reward: 9000, check: (s) => s.followers >= 10000 },
  { id: 'q7', title: 'Move out', goal: 'Buy your own place', reward: 6000, check: (s) => s.ownedHouses.length > 1 },
  { id: 'q8', title: 'Verified ✔', goal: 'Reach 100,000 followers', reward: 30000, check: (s) => s.followers >= 100000 },
  { id: 'q9', title: 'LEGEND', goal: 'Own the Neon Mansion + 1M followers', reward: 250000, check: (s) => s.ownedHouses.includes('mansion') && s.followers >= 1000000 },
];

export const SPONSORS = {
  soda: { id: 'soda', name: 'Chipz Cola', emoji: '🥤', mult: 1.15, text: 'Drink Chipz. Stream 15% richer.' },
  chair: { id: 'chair', name: 'ThroneCo', emoji: '🪑', mult: 1.25, text: 'Sit like a king, earn like one.' },
  chips: { id: 'chips', name: 'Crunchy Bytes', emoji: '🍟', mult: 1.4, text: 'Crunch loudly on stream. Get paid.' },
};

// follower milestones → auto perks
export const MILESTONES = [
  { fol: 100,    msg: '💯 100 followers! You are officially a micro-influencer.' },
  { fol: 1000,   msg: '🎉 1K followers! Chat spams POGGERS.' },
  { fol: 10000,  msg: '🔥 10K followers! Brands start sliding into your DMs.' },
  { fol: 100000, msg: '⭐ 100K followers! Verified badge ✔ unlocked.' },
  { fol: 1000000, msg: '👑 1 MILLION FOLLOWERS! You are THE streamer.' },
];

export const CHAT_NAMES = ['xX_ProGamer_Xx', 'noobslayer99', 'PixelQueen', 'momo_dz', 'TurboSnail', 'SaraPlays', 'ghostviewer', 'KechuaBoy', 'LunaMoon', 'darija_dude', 'ChatMod_01', 'silent_bob', 'RGBEnjoyer', 'ClipFarmer', 'emoteOnly', 'ZaidTV', 'NightOwl', 'hypeTrain_C', 'Anas_07', 'GigaChadFan'];
export const CHAT_MSGS = ['LETS GOOO', 'first stream? nice setup!', 'W streamer', 'LOL', 'that was insane 😂', 'clip it!!', 'GG', 'from Morocco 🇲🇦', 'salam!!', 'what GPU is that?', 'F', 'POG', 'hi chat hi streamer', 'this game is so cool', 'no way', 'RIG REVEAL WHEN', 'bro really said that 💀', '+follow', 'best streamer fr', 'W', 'can we play horror next?', 'the RGB 😍', 'greetings from Casa!', '5Head play', 'L + ratio (jk)', 'KEKW', 'sheeesh', 'dont forget to hydrate 💧', 'first time here, instant follow', '🔥🔥🔥'];
export const DONATE_MSGS = ['keep it up!!', 'for the RGB fund', 'best streamer in the city', 'buy a better mic lol', 'from your biggest fan', 'said hi', 'clip that!', 'for the mansion fund 🏰'];
