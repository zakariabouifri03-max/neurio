// ── all game content / economy tables ───────────────────────────────────────

export const HOUSES = [
  { id: 1, name: 'Small Studio', price: 0, rent: 0, desc: 'Where every streamer starts. Tiny, but it has a desk.', icon: '🏚️' },
  { id: 2, name: 'City Villa', price: 250000, rent: 0, desc: 'Big living room, better vibe, more viewers love the setup.', icon: '🏡', viewerBonus: 1.25 },
  { id: 3, name: 'Luxury Mansion', price: 2000000, rent: 0, desc: 'The flex. Viewers triple when they see this background.', icon: '🏰', viewerBonus: 1.8 },
];

export const PCS = [
  { id: 'pc0', name: 'Old Potato PC', price: 0, power: 1, icon: '🥔' },
  { id: 'pc1', name: 'Office Build', price: 900, power: 2, icon: '🖥️' },
  { id: 'pc2', name: 'Gamer Starter', price: 3500, power: 4, icon: '💻' },
  { id: 'pc3', name: 'RTX Beast', price: 14000, power: 8, icon: '⚡' },
  { id: 'pc4', name: 'Studio Workstation', price: 48000, power: 14, icon: '🧠' },
  { id: 'pc5', name: 'Quantum Rig', price: 220000, power: 30, icon: '🛸' },
];

export const GEAR = [
  { id: 'cam1', name: 'HD Webcam', price: 400, qual: 1, slot: 'cam', icon: '📷' },
  { id: 'cam2', name: '4K Camera', price: 4200, qual: 3, slot: 'cam', icon: '🎥' },
  { id: 'cam3', name: 'Cinema Rig', price: 26000, qual: 7, slot: 'cam', icon: '🎬' },
  { id: 'mic1', name: 'USB Mic', price: 300, qual: 1, slot: 'mic', icon: '🎤' },
  { id: 'mic2', name: 'Condenser Mic', price: 2600, qual: 3, slot: 'mic', icon: '🎙️' },
  { id: 'mic3', name: 'Broadcast Mic', price: 19000, qual: 7, slot: 'mic', icon: '📻' },
  { id: 'net1', name: 'Fiber 300Mb', price: 1200, qual: 2, slot: 'net', icon: '📶' },
  { id: 'net2', name: 'Fiber 1Gb', price: 7000, qual: 5, slot: 'net', icon: '🛰️' },
  { id: 'light1', name: 'Ring Light', price: 250, qual: 1, slot: 'light', icon: '💡' },
  { id: 'light2', name: 'RGB Studio Lights', price: 3800, qual: 4, slot: 'light', icon: '🌈' },
  { id: 'chair1', name: 'Gaming Chair', price: 1500, qual: 2, slot: 'chair', icon: '🪑' },
  { id: 'chair2', name: 'Ergo Throne', price: 9000, qual: 5, slot: 'chair', icon: '👑' },
];

export const CARS = [
  { id: 'car1', name: 'Rusty Hatchback', price: 3000, speed: 16, color: 0x9aa2a8, icon: '🚙' },
  { id: 'car2', name: 'City Sedan', price: 18000, speed: 22, color: 0x2e86de, icon: '🚗' },
  { id: 'car3', name: 'Sport Coupe', price: 90000, speed: 30, color: 0xe74c3c, icon: '🏎️' },
  { id: 'car4', name: 'Street Muscle', price: 240000, speed: 36, color: 0xf39c12, icon: '🔥' },
  { id: 'car5', name: 'Hyper GT', price: 1500000, speed: 48, color: 0x9b59b6, icon: '🚀' },
];

export const FOOD = [
  { id: 'f1', name: 'Instant Noodles', price: 8, hunger: 18, mood: 2, icon: '🍜' },
  { id: 'f2', name: 'Pizza Box', price: 45, hunger: 45, mood: 10, icon: '🍕' },
  { id: 'f3', name: 'Burger Menu', price: 60, hunger: 50, mood: 12, icon: '🍔' },
  { id: 'f4', name: 'Energy Drink', price: 25, hunger: 5, energy: 30, mood: 4, icon: '🥤' },
  { id: 'f5', name: 'Coffee', price: 15, hunger: 2, energy: 18, mood: 6, icon: '☕' },
  { id: 'f6', name: 'Healthy Bowl', price: 120, hunger: 55, mood: 18, energy: 10, icon: '🥗' },
  { id: 'f7', name: 'Tajine (homemade)', price: 95, hunger: 70, mood: 25, icon: '🍲' },
];

export const CLOTHES = [
  { id: 'c1', name: 'Basic Tee', price: 120, style: 1, icon: '👕' },
  { id: 'c2', name: 'Hoodie', price: 600, style: 3, icon: '🧥' },
  { id: 'c3', name: 'Streetwear Fit', price: 4500, style: 6, icon: '🕶️' },
  { id: 'c4', name: 'Designer Drip', price: 38000, style: 12, icon: '💎' },
  { id: 'c5', name: 'Gold Chain', price: 150000, style: 22, icon: '📿' },
];

export const FURNITURE = [
  { id: 'fu1', name: 'Neon Sign', price: 900, viewers: .05, icon: '🔆' },
  { id: 'fu2', name: 'Big Bookshelf', price: 1400, viewers: .04, icon: '📚' },
  { id: 'fu3', name: 'Aquarium', price: 5200, viewers: .09, mood: 5, icon: '🐠' },
  { id: 'fu4', name: 'Arcade Machine', price: 12000, viewers: .14, mood: 10, icon: '🕹️' },
  { id: 'fu5', name: 'Trophy Wall', price: 30000, viewers: .2, icon: '🏆' },
  { id: 'fu6', name: 'Gold Plaque 1M', price: 120000, viewers: .35, icon: '🥇' },
];

export const GAMES = [
  { id: 'g1', name: 'Dust Shooter', cat: 'FPS', hype: 1.0, fun: 6, buy: 0 },
  { id: 'g2', name: 'Baghrir Simulator', cat: 'Sim', hype: .7, fun: 4, buy: 0 },
  { id: 'g3', name: 'Kart Baqi Racing', cat: 'Racing', hype: 1.2, fun: 8, buy: 250 },
  { id: 'g4', name: 'Battle Royale X', cat: 'BR', hype: 1.6, fun: 9, buy: 900 },
  { id: 'g5', name: 'Horror Night 3', cat: 'Horror', hype: 1.4, fun: 7, buy: 700 },
  { id: 'g6', name: 'Medina Tycoon', cat: 'Strategy', hype: 1.1, fun: 6, buy: 500 },
  { id: 'g7', name: 'Space Legends MMO', cat: 'MMO', hype: 1.8, fun: 9, buy: 2500 },
  { id: 'g8', name: 'Ranked Arena 2', cat: 'MOBA', hype: 2.1, fun: 10, buy: 6000 },
];

export const STREAM_TYPES = [
  { id: 'gaming', name: '🎮 Gaming', mult: 1.0 },
  { id: 'justchat', name: '💬 Just Chatting', mult: .8, moodCost: .6 },
  { id: 'music', name: '🎵 Music', mult: .9 },
  { id: 'irl', name: '🌍 IRL Walk', mult: 1.1, outside: true },
];

// chat message pool
export const CHAT_LINES = [
  'LETS GOOO 🔥', 'first!', 'bro the setup is clean', 'W streamer', 'L take 😂', 'poggers',
  'salam from Casa 🇲🇦', 'how many subs?', 'play ranked!', 'the mic sounds bad fr', 'upgrade ur pc 💀',
  'KEKW', 'drop the discord', 'that house is huge', 'GG', 'donated 5$ love u', 'mods ban him',
  'stream 24/7 plz', 'u sleep too much', 'this game is mid', 'new PC when?', 'clip it!',
  'rtx on 😍', 'ur viewers growing fast', 'best streamer in the city', 'say hi to me pls 🙏',
];
export const DON_MSG = ['keep grinding!', 'buy a new mic 😭', 'from your biggest fan', 'for the mansion fund 🏰',
  'GG bro', 'love the stream', 'marry me', 'use it for food 🍕', 'top 1 streamer'];

export const EMAILS = [
  { from: 'SponsorHub', subj: 'Energy drink deal', body: 'We pay per stream if you keep streaming regularly. Accept in Business app.' },
  { from: 'Mom', subj: 'eat something', body: 'Wach kaytkol? Don\'t stay on the PC all night. 💙' },
  { from: 'Bank', subj: 'Account opened', body: 'Your account is ready. You can save money and take a loan at the Bank.' },
];

export const SPONSORS = [
  { id: 's1', name: 'Noodle Co.', need: 1000, pay: 300, icon: '🍜' },
  { id: 's2', name: 'ByteDrink', need: 10000, pay: 2500, icon: '🥤' },
  { id: 's3', name: 'HyperChair', need: 50000, pay: 14000, icon: '🪑' },
  { id: 's4', name: 'NovaGPU', need: 250000, pay: 90000, icon: '🎮' },
  { id: 's5', name: 'Atlas Telecom', need: 1000000, pay: 500000, icon: '📡' },
];
