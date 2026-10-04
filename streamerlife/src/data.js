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

// ── Zamazor component catalog (PC building, SLS2-style) ────────────────────
// perf → raw PC power · qual → stream quality (mic/cam/light/net/monitor)
export const CATS = [
  { id: 'cpu', name: 'CPU', icon: '🧠', core: true },
  { id: 'gpu', name: 'Graphics Cards', icon: '🎮', core: true },
  { id: 'ram', name: 'RAM', icon: '🧩', core: true },
  { id: 'mb', name: 'Mainboards', icon: '🔌', core: true },
  { id: 'hdd', name: 'HDD / SSD', icon: '💾', core: true },
  { id: 'monitor', name: 'Screens', icon: '🖥️' },
  { id: 'mic', name: 'Microphones', icon: '🎤' },
  { id: 'cam', name: 'Cameras', icon: '📷' },
  { id: 'light', name: 'Lamps', icon: '💡' },
  { id: 'net', name: 'Routers', icon: '📶' },
  { id: 'kb', name: 'Keyboards', icon: '⌨️' },
  { id: 'mouse', name: 'Mouses', icon: '🖱️' },
  { id: 'chair', name: 'Computer Chair', icon: '🪑' },
  { id: 'desk', name: 'Computer Tables', icon: '🪵' },
];

const C = (cat, id, name, price, perf, qual, stars, desc) => ({ cat, id, name, price, perf, qual, stars, desc });
export const COMPONENTS = [
  // CPU
  C('cpu', 'cpu1', 'Zintel A1 1.1GHz', 180, 1, 0, 1, 'Entry-level. It boots. Barely.'),
  C('cpu', 'cpu2', 'Zintel i3 3.0GHz', 650, 3, 0, 2, 'Good price/performance for starters.'),
  C('cpu', 'cpu3', 'Zyzen 5 4.2GHz', 2400, 7, 0, 3, 'Streaming + gaming without drops.'),
  C('cpu', 'cpu4', 'Zyzen 9 5.1GHz', 9800, 14, 0, 4, 'Encoding beast.'),
  C('cpu', 'cpu5', 'Zintel i9 Extreme', 32000, 26, 0, 5, 'Overkill. Exactly what you need.'),
  // GPU
  C('gpu', 'gpu1', 'TX 950 U', 300, 1, 0, 1, 'Can run 2012 games on low.'),
  C('gpu', 'gpu2', 'TX 1660 S', 1600, 4, 1, 2, 'Solid 1080p card.'),
  C('gpu', 'gpu3', 'RTZ 3070', 7200, 9, 2, 3, 'Ray tracing on, chat happy.'),
  C('gpu', 'gpu4', 'RTZ 4080 Ti', 26000, 18, 3, 4, '4K 120fps streaming.'),
  C('gpu', 'gpu5', 'RTZ 5090 Titan', 95000, 34, 5, 5, 'The flex card.'),
  // RAM
  C('ram', 'ram1', 'Zorsair 1GB', 60, 1, 0, 1, 'One tab at a time.'),
  C('ram', 'ram2', 'Zorsair 8GB', 420, 3, 0, 2, 'Normal people RAM.'),
  C('ram', 'ram3', 'Zorsair 16GB RGB', 1300, 6, 0, 3, 'RGB = +5 fps (fake).'),
  C('ram', 'ram4', 'Zorsair 32GB DDR5', 4800, 11, 0, 4, 'Editing + streaming together.'),
  C('ram', 'ram5', 'Zorsair 64GB Pro', 15000, 20, 0, 5, 'Chrome approved.'),
  // Mainboard
  C('mb', 'mb1', 'Zarus Basic AM4', 220, 1, 0, 1, 'It has slots. That is all.'),
  C('mb', 'mb2', 'Zarus Gamer AM4', 980, 3, 0, 2, 'More ports, more RGB.'),
  C('mb', 'mb3', 'Zarus Hero X670', 3600, 7, 0, 4, 'Serious build base.'),
  C('mb', 'mb4', 'Zarus Legendary', 12000, 13, 0, 5, 'Gold plated, obviously.'),
  // Storage
  C('hdd', 'hdd1', 'Mzung Zero 3 60GB', 90, 1, 0, 1, 'Loading… still loading.'),
  C('hdd', 'hdd2', 'Mzung 1TB HDD', 350, 2, 0, 2, 'Space for clips.'),
  C('hdd', 'hdd3', 'Mzung 1TB NVMe', 1400, 5, 0, 3, 'Fast boots, fast edits.'),
  C('hdd', 'hdd4', 'Mzung 4TB NVMe Pro', 6200, 10, 0, 5, 'Never delete anything again.'),
  // Monitor
  C('monitor', 'mon1', '20 LED Screen', 190, 0, 1, 1, '60Hz, 1080p… kind of.'),
  C('monitor', 'mon2', 'Zarus Gamer Pro 144Hz', 990, 1, 2, 3, 'Smooth gameplay for viewers.'),
  C('monitor', 'mon3', 'Legendary Monitor 4K', 4300, 2, 5, 5, '4K 240Hz. Chat sees everything.'),
  // Mic
  C('mic', 'mic1', 'BuzzMic USB', 285, 0, 1, 1, 'Entry-level microphone.'),
  C('mic', 'mic2', 'SoundClash XR', 1340, 0, 3, 3, 'Clean price/performance sound.'),
  C('mic', 'mic3', 'ToneFusion Studio', 7420, 0, 7, 5, 'Very high quality broadcast mic.'),
  // Cam
  C('cam', 'cam1', 'ClearVoice HD Cam', 435, 0, 1, 2, '720p webcam, honest work.'),
  C('cam', 'cam2', 'VocalForge 4K Cam', 3850, 0, 4, 4, 'Crisp facecam.'),
  C('cam', 'cam3', 'CrystalCine Rig', 18600, 0, 8, 5, 'Cinema-grade IRL setup.'),
  // Light
  C('light', 'lt1', 'Ring Light', 160, 0, 1, 2, 'No more cave look.'),
  C('light', 'lt2', 'RGB Studio Lights', 1850, 0, 3, 4, 'Vibe + color grading.'),
  // Router
  C('net', 'net1', 'ADSL Router', 120, 0, 1, 1, '3900 kbps if you are lucky.'),
  C('net', 'net2', 'Fiber 300Mb Router', 870, 0, 3, 3, 'Stable 1080p60 upload.'),
  C('net', 'net3', 'Fiber 1Gb Router', 4200, 0, 6, 5, 'Never drop a frame.'),
  // Peripherals / furniture
  C('kb', 'kb1', 'Zarus Membrane KB', 70, 0, 0, 1, 'Clack-less.'),
  C('kb', 'kb2', 'Zarus Mechanical RGB', 560, 1, 1, 4, 'ASMR clacking, chat loves it.'),
  C('mouse', 'ms1', 'Office Mouse', 45, 0, 0, 1, 'It moves the cursor.'),
  C('mouse', 'ms2', 'Zarus Pro 20K DPI', 480, 1, 1, 4, 'Aim excuse removed.'),
  C('chair', 'ch1', 'Plastic Chair', 90, 0, 0, 1, 'Your back will remember.'),
  C('chair', 'ch2', 'Gaming Chair', 1250, 0, 1, 3, 'Longer streams, less pain.'),
  C('chair', 'ch3', 'Ergo Throne', 7900, 0, 2, 5, 'The 12-hour-stream throne.'),
  C('desk', 'dsk1', 'Zarus Small Desk', 230, 0, 0, 1, 'Fits one monitor. Maybe.'),
  C('desk', 'dsk2', 'Zarus Big Desk', 1100, 0, 1, 3, 'Room for the whole setup.'),
  C('desk', 'dsk3', 'Zarus Studio Desk', 5400, 0, 2, 5, 'Streamer flex furniture.'),
];
export const compById = (id) => COMPONENTS.find(c => c.id === id);

export const STREAM_QUALITY = [
  { id: '480p', name: '480p', need: 2, mult: .7 },
  { id: '720p', name: '720p', need: 6, mult: 1 },
  { id: '1080p', name: '1080p', need: 14, mult: 1.3 },
  { id: '1440p', name: '1440p', need: 28, mult: 1.55 },
  { id: '4k', name: '4K', need: 50, mult: 1.9 },
];
export const NPC_NAMES = ['Hamid', 'Fatima', 'Youssef', 'Imane', 'Said', 'Khadija', 'Tarik', 'Nadia', 'Jamal', 'Samira'];
