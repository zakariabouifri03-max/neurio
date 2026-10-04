// ---------- game data: shop catalog, houses, cars, stream categories ----------
export const CATS = [
  ['cpu', '', 'CPU'],
  ['gpu', '🎮', 'Graphics Cards'],
  ['ram', '💾', 'RAM'],
  ['hdd', '💽', 'HDD'],
  ['cooler', '❄️', 'CPU Cooler'],
  ['mon', '🖥️', 'Monitors'],
  ['mic', '🎙️', 'Microphones'],
  ['kb', '⌨️', 'Keyboards'],
  ['mouse', '🖱️', 'Mouses'],
  ['chair', '🪑', 'Computer Chairs'],
  ['desk', '🪵', 'Computer Tables'],
  ['router', '📶', 'Routers'],
  ['lamp', '💡', 'Lamps'],
];

export const ITEMS = [
  // CPUs
  { id: 'cpu_zintel_1', cat: 'cpu', name: 'Zintel AT 1.1GHz', price: 90, stars: 1, score: 2, desc: 'It works. Barely.' },
  { id: 'cpu_mzund', cat: 'cpu', name: 'Mzund Zerg 3 0.9GHz', price: 70, stars: 1, score: 1, desc: 'A potato with dreams.' },
  { id: 'cpu_ztx', cat: 'cpu', name: 'ZTX 560 X 3.8GHz', price: 450, stars: 3, score: 6, desc: 'Solid mid-range power.' },
  { id: 'cpu_coreZ', cat: 'cpu', name: 'Zintel Core iZ 4.2GHz', price: 850, stars: 4, score: 10, desc: 'Now we are talking.' },
  { id: 'cpu_ryzer', cat: 'cpu', name: 'ZAMD Ryzer 9 5GHz', price: 1500, stars: 5, score: 16, desc: 'Beast mode unlocked.' },
  // GPUs
  { id: 'gpu_ztx_low', cat: 'gpu', name: 'OldZap 2GB', price: 120, stars: 1, score: 2, desc: 'Displays pixels, technically.' },
  { id: 'gpu_ztx560', cat: 'gpu', name: 'TX 560 X 6GB', price: 520, stars: 3, score: 8, desc: 'Great 720p streaming.' },
  { id: 'gpu_vortex', cat: 'gpu', name: 'Vortex Pro X 12GB', price: 999, stars: 4, score: 12, desc: 'Smooth 1080p encode.' },
  { id: 'gpu_ultra', cat: 'gpu', name: 'UltraForce RTX Z', price: 2200, stars: 5, score: 20, desc: '4K dreams, zero lag.' },
  // RAM
  { id: 'ram_4', cat: 'ram', name: 'Corsair Ram 4GB', price: 60, stars: 2, score: 1, desc: 'Entry memory stick.' },
  { id: 'ram_8', cat: 'ram', name: 'Corsair Ram 8GB', price: 120, stars: 3, score: 2, desc: 'Comfortable multitasking.' },
  { id: 'ram_16', cat: 'ram', name: 'Zaxus Ram 16GB', price: 240, stars: 4, score: 4, desc: 'Streamer standard.' },
  { id: 'ram_32', cat: 'ram', name: 'Zaxus Ram 32GB RGB', price: 450, stars: 5, score: 6, desc: 'RGB = +10 FPS.' },
  // HDD
  { id: 'hdd_1', cat: 'hdd', name: '500GB HDD', price: 40, stars: 1, score: 1, desc: 'Clicky and slow.' },
  { id: 'hdd_2', cat: 'hdd', name: '1TB HDD', price: 80, stars: 2, score: 2, desc: 'Room for VODs.' },
  { id: 'ssd_1', cat: 'hdd', name: '1TB SSD Zaxus', price: 160, stars: 4, score: 4, desc: 'Loads before you blink.' },
  // Cooler
  { id: 'cooler_1', cat: 'cooler', name: 'Tower Air Cooler', price: 60, stars: 3, score: 2, desc: 'Keeps the potato cool.' },
  { id: 'cooler_2', cat: 'cooler', name: 'Liquid Z 240', price: 220, stars: 5, score: 4, desc: 'Ice cold performance.' },
  // Monitors
  { id: 'mon_1', cat: 'mon', name: '20" LED Screen', price: 150, stars: 2, score: 2, desc: 'A screen. It screens.' },
  { id: 'mon_zamus', cat: 'mon', name: 'Zamus Bro 24"', price: 500, stars: 3, score: 5, desc: 'Crisp and bright.' },
  { id: 'mon_leg', cat: 'mon', name: 'Legendary Monitor 27"', price: 990, stars: 4, score: 9, desc: 'Legendary. Truly.' },
  { id: 'mon_gamer', cat: 'mon', name: 'Zaxus Gamer Pro 144Hz', price: 1600, stars: 5, score: 14, desc: 'Buttery smooth pixels.' },
  // Mics
  { id: 'mic_none', cat: 'mic', name: 'No Microphone', price: 0, stars: 0, score: 0, desc: 'Silence is not golden.' },
  { id: 'mic_buzz', cat: 'mic', name: 'BuzzMic', price: 285, stars: 2, score: 2, desc: "It's an entry-level microphone." },
  { id: 'mic_clash', cat: 'mic', name: 'SoundClash', price: 339, stars: 3, score: 4, desc: 'A microphone that can produce a clean sound.' },
  { id: 'mic_fusion', cat: 'mic', name: 'ToneFusion', price: 378, stars: 3, score: 5, desc: 'A very high quality price-performance microphone.' },
  { id: 'mic_forge', cat: 'mic', name: 'VocalForge', price: 385, stars: 4, score: 6, desc: 'A quality ASMR microphone.' },
  { id: 'mic_clear', cat: 'mic', name: 'ClearVoice Pro', price: 455, stars: 4, score: 7, desc: 'A nice microphone with high-end features.' },
  { id: 'mic_crystal', cat: 'mic', name: 'CrystalSound Green', price: 520, stars: 5, score: 9, desc: 'A wonderfully designed gaming microphone.' },
  // Keyboards
  { id: 'kb_1', cat: 'kb', name: 'Office Keyboard', price: 20, stars: 1, score: 1, desc: 'Clack clack.' },
  { id: 'kb_rgb', cat: 'kb', name: 'Zaxus RGB Mech', price: 120, stars: 3, score: 2, desc: 'Thock.', },
  { id: 'kb_pro', cat: 'kb', name: 'Pro Mechanical X', price: 250, stars: 5, score: 3, desc: 'Keyboard ASMR material.' },
  // Mice
  { id: 'mouse_1', cat: 'mouse', name: 'Office Mouse', price: 15, stars: 1, score: 1, desc: 'It mouses.' },
  { id: 'mouse_g', cat: 'mouse', name: 'Gamer Mouse 8K DPI', price: 90, stars: 3, score: 2, desc: 'Flick city.' },
  { id: 'mouse_p', cat: 'mouse', name: 'Pro Wireless Ultralight', price: 180, stars: 5, score: 3, desc: 'Lighter than air.' },
  // Chairs
  { id: 'chair_1', cat: 'chair', name: 'Wooden Chair', price: 40, stars: 1, score: 1, desc: 'Your back will complain.' },
  { id: 'chair_2', cat: 'chair', name: 'Office Chair', price: 150, stars: 3, score: 3, desc: 'Acceptable comfort.' },
  { id: 'chair_g', cat: 'chair', name: 'Zaxus Gamer Throne', price: 400, stars: 5, score: 5, desc: '12-hour stream comfort.' },
  // Desks
  { id: 'desk_1', cat: 'desk', name: 'Old Desk', price: 30, stars: 1, score: 1, desc: 'Wobbly but loyal.' },
  { id: 'desk_2', cat: 'desk', name: 'Computer Table', price: 180, stars: 3, score: 2, desc: 'Sturdy workstation.' },
  { id: 'desk_g', cat: 'desk', name: 'Z Gaming Desk XL', price: 500, stars: 5, score: 4, desc: 'RGB underglow included.' },
  // Routers
  { id: 'router_1', cat: 'router', name: 'Basic Router', price: 30, stars: 2, score: 1, desc: 'One bar of hope.' },
  { id: 'router_2', cat: 'router', name: 'Zaxus Gigabit Pro', price: 140, stars: 4, score: 3, desc: 'Stable bitrate, no drops.' },
  // Lamps
  { id: 'lamp_1', cat: 'lamp', name: 'Desk Lamp', price: 45, stars: 2, score: 1, desc: 'Cozy light.' },
  { id: 'lamp_rgb', cat: 'lamp', name: 'RGB LED Strips', price: 120, stars: 4, score: 2, desc: 'Gamer ambience +200%.' },
];

export const itemById = (id) => ITEMS.find(i => i.id === id);

export const HOUSES = [
  { id: 'trailer', name: 'Starter Trailer', price: 0, pos: [-16, 64], desc: 'Where every legend begins.' },
  { id: 'cabin', name: 'Wooden Cabin', price: 1500, pos: [-26, -24], desc: 'Cozy pine cabin near town.' },
  { id: 'redhouse', name: 'Red Family House', price: 6000, pos: [26, 26], desc: 'Two floors of pure style.' },
  { id: 'villa', name: 'Big Villa', price: 15000, pos: [-34, -52], desc: 'The streamer dream house.' },
];

export const CARS = [
  { id: 'sedan_old', name: 'Old Sedan', price: 0, color: 0x6a6f74, top: 26, acc: 9, pos: [-11, 70], rot: Math.PI * 0.5 },
  { id: 'van_yellow', name: 'Dodgy Van', price: 900, color: 0xd8b21c, top: 31, acc: 11, pos: [14, -12], rot: 0 },
  { id: 'sport', name: 'Sport Z', price: 5000, color: 0xa02030, top: 46, acc: 18, pos: [20, -12], rot: 0 },
];

export const STREAM_CATS = [
  ['Just Chatting', 1.0],
  ['Gaming', 1.25],
  ['ASMR', 1.4],
  ['Music', 1.35],
  ['Cooking', 1.2],
];
