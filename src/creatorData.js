// Creator Life Simulator data: intentionally game-balance values, not real-world rates.

export const APP_DEFS = [
  { id: 'browser', name: 'Browser', short: 'WEB', cost: 0, desc: 'Explore the island web and discover creator tools.' },
  { id: 'files', name: 'File Manager', short: 'FILES', cost: 0, desc: 'Organize clips, thumbnails, recordings and project files.' },
  { id: 'settings', name: 'Basic Settings', short: 'SET', cost: 0, desc: 'System preferences and PC hardware diagnostics.' },
  { id: 'games', name: 'Game Store', short: 'PLAY', cost: 0, desc: 'Buy games, creator gear, furniture and internet plans.' },
  { id: 'stream', name: 'Stream Desk', short: 'LIVE', cost: 35, desc: 'Go live from your PC and build a community.' },
  { id: 'editor', name: 'Cutroom Editor', short: 'EDIT', cost: 40, desc: 'Cut clips, add titles, choose thumbnails and render.' },
  { id: 'analytics', name: 'Pulse Analytics', short: 'DATA', cost: 30, desc: 'Track views, watch time, RPM and audience countries.' },
  { id: 'donations', name: 'Tip Jar', short: 'TIPS', cost: 20, desc: 'Receive and manage simulated viewer donations.' },
  { id: 'studio', name: 'Creator Studio', short: 'STUDIO', cost: 25, desc: 'Manage subscribers, uploads, channel identity and goals.' },
  { id: 'bank', name: 'Harbor Bank', short: 'BANK', cost: 15, desc: 'Review your balance, payouts and monthly costs.' },
  { id: 'messenger', name: 'Messenger', short: 'CHAT', cost: 10, desc: 'Messages from your co-player, NPCs and viewers.' },
  { id: 'cloud', name: 'Cloud Locker', short: 'CLOUD', cost: 25, desc: 'Store recordings safely and expand your project space.' },
  { id: 'music', name: 'Sound Library', short: 'MUSIC', cost: 20, desc: 'License music for vlogs and live sessions.' },
  { id: 'camera', name: 'Camera Manager', short: 'CAM', cost: 25, desc: 'Connect cameras, review footage and record clips.' },
  { id: 'task', name: 'Task Monitor', short: 'TASK', cost: 10, desc: 'Watch CPU, GPU, RAM, FPS and network usage.' },
  { id: 'calendar', name: 'Calendar', short: 'DATE', cost: 8, desc: 'Plan streams, deliveries and island events.' },
];

export const GAMES = [
  { id: 'sunny-shores', name: 'Sunny Shores', genre: 'Cozy exploration', price: 0, popularity: 42, graphics: 12, trend: 78, viewers: 9, desc: 'A free island exploration game. Your first stream starts here.' },
  { id: 'harbor-heist', name: 'Harbor Heist', genre: 'Stealth adventure', price: 18, popularity: 68, graphics: 26, trend: 61, viewers: 14, desc: 'Sneak through a neon harbor and steal back the tide charts.' },
  { id: 'driftline', name: 'Driftline', genre: 'Racing', price: 24, popularity: 74, graphics: 38, trend: 88, viewers: 19, desc: 'Precision island racing with a strong competitive audience.' },
  { id: 'deep-current', name: 'Deep Current', genre: 'Survival', price: 32, popularity: 81, graphics: 52, trend: 73, viewers: 25, desc: 'Build a raft, read the weather and survive the open sea.' },
  { id: 'neon-circuit', name: 'Neon Circuit', genre: 'Action', price: 45, popularity: 92, graphics: 71, trend: 96, viewers: 38, desc: 'A demanding cyber arena game with excellent stream potential.' },
  { id: 'tiny-chef', name: 'Tiny Chef', genre: 'Simulation', price: 16, popularity: 57, graphics: 18, trend: 66, viewers: 12, desc: 'Cook impossible dishes in a tiny kitchen under pressure.' },
  { id: 'island-builder', name: 'Island Builder', genre: 'Strategy', price: 38, popularity: 72, graphics: 43, trend: 69, viewers: 21, desc: 'Shape a living archipelago and balance every ecosystem.' },
  { id: 'moonbase-nine', name: 'Moonbase Nine', genre: 'Sci-fi', price: 64, popularity: 86, graphics: 84, trend: 82, viewers: 34, desc: 'Lead a fragile colony on a beautiful, unforgiving moon.' },
  { id: 'moss-knight', name: 'Moss Knight', genre: 'RPG', price: 29, popularity: 63, graphics: 35, trend: 59, viewers: 17, desc: 'A hand-crafted adventure beneath an ancient forest.' },
  { id: 'street-kitchen', name: 'Street Kitchen', genre: 'Co-op', price: 22, popularity: 77, graphics: 29, trend: 91, viewers: 26, desc: 'Serve a moving night market with another creator.' },
  { id: 'skyhook', name: 'Skyhook', genre: 'Platformer', price: 14, popularity: 51, graphics: 21, trend: 48, viewers: 10, desc: 'Swing between floating islands before the storm arrives.' },
  { id: 'wildlife-watch', name: 'Wildlife Watch', genre: 'Documentary', price: 26, popularity: 69, graphics: 45, trend: 76, viewers: 22, desc: 'Find rare animals and turn field notes into stories.' },
  { id: 'signal-lost', name: 'Signal Lost', genre: 'Mystery', price: 41, popularity: 79, graphics: 58, trend: 86, viewers: 29, desc: 'Decode a radio mystery hidden across a remote coast.' },
  { id: 'pixel-farm', name: 'Pixel Farm', genre: 'Relaxing', price: 12, popularity: 48, graphics: 16, trend: 53, viewers: 8, desc: 'A gentle farm life game with a surprisingly loyal audience.' },
  { id: 'overdrive-arena', name: 'Overdrive Arena', genre: 'Competitive', price: 70, popularity: 95, graphics: 91, trend: 98, viewers: 46, desc: 'High-FPS arena battles. Great content, brutal hardware needs.' },
  { id: 'paper-planes', name: 'Paper Planes', genre: 'Puzzle', price: 9, popularity: 37, graphics: 10, trend: 44, viewers: 6, desc: 'Fold, fly and solve wind puzzles over a paper ocean.' },
  { id: 'rainy-rooms', name: 'Rainy Rooms', genre: 'Narrative', price: 19, popularity: 62, graphics: 32, trend: 72, viewers: 15, desc: 'A quiet story where every room remembers a different day.' },
  { id: 'voltage-garden', name: 'Voltage Garden', genre: 'Builder', price: 47, popularity: 73, graphics: 63, trend: 79, viewers: 24, desc: 'Grow a bioluminescent garden around a power grid.' },
  { id: 'last-lighthouse', name: 'Last Lighthouse', genre: 'Horror', price: 34, popularity: 84, graphics: 49, trend: 93, viewers: 31, desc: 'Keep the light on while something moves below the cliffs.' },
  { id: 'tide-tactics', name: 'Tide Tactics', genre: 'Strategy', price: 28, popularity: 66, graphics: 40, trend: 62, viewers: 16, desc: 'Command a fleet where every wave changes the battle.' },
  { id: 'glasswing', name: 'Glasswing', genre: 'Flight', price: 56, popularity: 80, graphics: 76, trend: 75, viewers: 27, desc: 'Glide through mountain air in a world made of sunlight.' },
  { id: 'campfire-club', name: 'Campfire Club', genre: 'Social', price: 20, popularity: 59, graphics: 24, trend: 89, viewers: 18, desc: 'Tell stories, meet strangers and keep a virtual fire alive.' },
  { id: 'orbit-farmer', name: 'Orbit Farmer', genre: 'Simulation', price: 52, popularity: 71, graphics: 68, trend: 70, viewers: 23, desc: 'Harvest solar crops while your station circles a gas giant.' },
  { id: 'monsoon-run', name: 'Monsoon Run', genre: 'Racing', price: 39, popularity: 83, graphics: 57, trend: 94, viewers: 35, desc: 'Race through changing weather with a community of rivals.' },
  { id: 'quiet-giants', name: 'Quiet Giants', genre: 'Exploration', price: 44, popularity: 76, graphics: 61, trend: 67, viewers: 20, desc: 'Document enormous creatures that only appear at dusk.' },
];

export const COUNTRIES = [
  { id: 'us', name: 'United States', weight: 25, baseRpm: 0.034 },
  { id: 'ma', name: 'Morocco', weight: 18, baseRpm: 0.009 },
  { id: 'gb', name: 'United Kingdom', weight: 13, baseRpm: 0.029 },
  { id: 'ca', name: 'Canada', weight: 11, baseRpm: 0.027 },
  { id: 'de', name: 'Germany', weight: 9, baseRpm: 0.024 },
  { id: 'fr', name: 'France', weight: 8, baseRpm: 0.021 },
  { id: 'es', name: 'Spain', weight: 6, baseRpm: 0.014 },
  { id: 'jp', name: 'Japan', weight: 5, baseRpm: 0.022 },
];

export const INTERNET_PLANS = [
  { id: 'island-basic', name: 'Island Basic', speed: 12, upload: 2, ping: 82, stability: 62, monthly: 0, price: 0, desc: 'The connection already in your house. It gets the job done, barely.' },
  { id: 'coast-plus', name: 'Coast Plus', speed: 50, upload: 10, ping: 48, stability: 78, monthly: 12, price: 20, desc: 'A reliable cable plan for regular uploads and small streams.' },
  { id: 'reef-fiber', name: 'Reef Fiber', speed: 180, upload: 45, ping: 24, stability: 92, monthly: 28, price: 55, desc: 'Fast fiber service for editing, streaming and multiplayer.' },
  { id: 'deep-sea-pro', name: 'Deep Sea Pro', speed: 600, upload: 150, ping: 11, stability: 98, monthly: 55, price: 110, desc: 'Professional symmetrical fiber with the best island routing.' },
];

export const PC_PARTS = {
  cpu: [
    { id: 'cpu-basic', name: 'Celeron B1', price: 0, score: 18, spec: '2 cores · 2.1 GHz', desc: 'A tired office CPU. Fine for file management, not much else.' },
    { id: 'cpu-i3', name: 'Core i3 Coast', price: 85, score: 34, spec: '4 cores · 3.6 GHz', desc: 'A dependable first upgrade for editing and light games.' },
    { id: 'cpu-r5', name: 'Ryzen 5 Reef', price: 180, score: 58, spec: '6 cores · 4.4 GHz', desc: 'Strong all-round performance for a growing creator.' },
    { id: 'cpu-i7', name: 'Core i7 Summit', price: 360, score: 82, spec: '12 cores · 5.1 GHz', desc: 'Fast rendering and stable multitasking under a heavy workload.' },
    { id: 'cpu-r9', name: 'Ryzen 9 Deep', price: 640, score: 98, spec: '16 cores · 5.6 GHz', desc: 'Professional-grade creator performance.' },
  ],
  gpu: [
    { id: 'gpu-basic', name: 'Integrated Tide', price: 0, score: 12, spec: 'Shared memory · 720p', desc: 'The weak graphics built into your starter PC.' },
    { id: 'gpu-arc', name: 'Arc 450', price: 120, score: 35, spec: '4 GB VRAM · 1080p', desc: 'Entry-level discrete graphics for popular games.' },
    { id: 'gpu-rtx', name: 'GeForce Reef 60', price: 280, score: 63, spec: '8 GB VRAM · 1440p', desc: 'A balanced card with hardware encoding.' },
    { id: 'gpu-pro', name: 'Radeon Current X', price: 590, score: 88, spec: '16 GB VRAM · 4K', desc: 'High quality gaming and professional video previews.' },
    { id: 'gpu-ultra', name: 'GeForce Horizon', price: 1100, score: 100, spec: '24 GB VRAM · 4K HDR', desc: 'The island’s serious production card.' },
  ],
  ram: [
    { id: 'ram-basic', name: '4 GB DDR3', price: 0, score: 12, spec: '4 GB · 1600 MHz', desc: 'Barely enough for your operating system and one app.' },
    { id: 'ram-8', name: '8 GB DDR4', price: 42, score: 30, spec: '8 GB · 3200 MHz', desc: 'A comfortable starting point for editing.' },
    { id: 'ram-16', name: '16 GB DDR4', price: 88, score: 55, spec: '16 GB · 3600 MHz', desc: 'The sweet spot for streaming and multitasking.' },
    { id: 'ram-32', name: '32 GB DDR5', price: 190, score: 78, spec: '32 GB · 5600 MHz', desc: 'Keep your editor, browser and stream open together.' },
    { id: 'ram-64', name: '64 GB DDR5', price: 360, score: 98, spec: '64 GB · 6000 MHz', desc: 'A huge workspace for professional 4K projects.' },
  ],
  storage: [
    { id: 'storage-hdd', name: '160 GB HDD', price: 0, score: 12, spec: '160 GB · 5,400 RPM', desc: 'Slow and cramped, but it holds your first recordings.' },
    { id: 'storage-ssd', name: '500 GB SSD', price: 74, score: 48, spec: '500 GB · SATA', desc: 'Much faster boots, project loading and file transfers.' },
    { id: 'storage-nvme', name: '1 TB NVMe', price: 145, score: 78, spec: '1 TB · PCIe 4.0', desc: 'Fast enough to make large video projects feel responsive.' },
    { id: 'storage-pro', name: '2 TB NVMe Pro', price: 320, score: 100, spec: '2 TB · PCIe 5.0', desc: 'Huge capacity and excellent render cache performance.' },
  ],
  motherboard: [
    { id: 'board-basic', name: 'B-Board 100', price: 0, score: 20, spec: '2 DIMM · AM4', desc: 'The old board limits your starter components.' },
    { id: 'board-plus', name: 'B-Board 550', price: 110, score: 55, spec: '4 DIMM · PCIe 4', desc: 'More expansion room and a stable upgrade path.' },
    { id: 'board-pro', name: 'Creator X670', price: 290, score: 92, spec: '4 DIMM · PCIe 5', desc: 'Premium power delivery and creator-focused I/O.' },
  ],
  psu: [
    { id: 'psu-basic', name: '220 W Generic', price: 0, score: 18, spec: '220 W · 70%', desc: 'No headroom for a serious graphics card.' },
    { id: 'psu-550', name: '550 W Bronze', price: 72, score: 49, spec: '550 W · 82%', desc: 'Safe power for a mid-range build.' },
    { id: 'psu-850', name: '850 W Gold', price: 150, score: 84, spec: '850 W · 91%', desc: 'Efficient, quiet power for demanding components.' },
    { id: 'psu-1200', name: '1200 W Platinum', price: 270, score: 100, spec: '1200 W · 94%', desc: 'Professional headroom for an extreme rig.' },
  ],
  cooler: [
    { id: 'cooler-basic', name: 'Stock Cooler', price: 0, score: 15, spec: '65 W · basic fan', desc: 'Audible and hot under sustained rendering.' },
    { id: 'cooler-tower', name: 'Tower Air 120', price: 55, score: 45, spec: '180 W · 120 mm', desc: 'Quieter sustained performance.' },
    { id: 'cooler-liquid', name: 'Liquid Loop 240', price: 145, score: 86, spec: '280 W · dual fan', desc: 'Cool, quiet and ready for long renders.' },
  ],
  case: [
    { id: 'case-basic', name: 'Old Steel Case', price: 0, score: 16, spec: '2 fans · sealed side', desc: 'Scratched steel with almost no airflow.' },
    { id: 'case-air', name: 'Airflow Glass', price: 110, score: 55, spec: '5 fans · tempered glass', desc: 'Better temperatures and a clear component view.' },
    { id: 'case-studio', name: 'Studio Tower', price: 280, score: 90, spec: '8 fans · acoustic panels', desc: 'Quiet professional enclosure with room for everything.' },
  ],
};

export const PERIPHERALS = [
  { id: 'webcam-basic', kind: 'webcam', name: 'FaceCam 720', price: 75, spec: '720p · 30 FPS · fixed focus', quality: 30, desc: 'A cheap webcam with soft detail and flat lighting.' },
  { id: 'webcam-mid', kind: 'webcam', name: 'FaceCam Clear', price: 180, spec: '1080p · 60 FPS · autofocus', quality: 62, desc: 'Clearer image and better color for regular streams.' },
  { id: 'webcam-pro', kind: 'webcam', name: 'FaceCam Studio', price: 480, spec: '4K · 60 FPS · HDR autofocus', quality: 96, desc: 'Professional face camera with excellent low light.' },
  { id: 'camera-pocket', kind: 'camera', name: 'Pocket Scout', price: 140, spec: '1080p · 30 FPS · 3x zoom', details: 'lens 34 mm · AF 58 · stab 22 · low-light 19 · mic 38 · battery 68 · storage 64 GB · 0.42 kg', quality: 34, desc: 'Lightweight outdoor camera for your first island vlogs.' },
  { id: 'camera-action', kind: 'camera', name: 'Action Current', price: 310, spec: '4K · 60 FPS · stabilized', details: 'lens 20 mm · AF 72 · stab 88 · low-light 45 · mic 55 · battery 74 · storage 128 GB · 0.31 kg', quality: 61, desc: 'Rugged camera with excellent stabilization for movement.' },
  { id: 'camera-mirrorless', kind: 'camera', name: 'Mirrorless M2', price: 720, spec: '4K · 120 FPS · 8x zoom', details: 'lens 24–200 mm · AF 91 · stab 76 · low-light 82 · mic 71 · battery 61 · storage 256 GB · 0.78 kg', quality: 83, desc: 'A versatile camera with sharp lenses and strong autofocus.' },
  { id: 'camera-cinema', kind: 'camera', name: 'Cinema Reef', price: 1650, spec: '6K · 120 FPS · 12x zoom', details: 'lens 18–220 mm · AF 97 · stab 91 · low-light 96 · mic 88 · battery 58 · storage 512 GB · 2.10 kg', quality: 100, desc: 'Heavy professional camera for cinematic island stories.' },
  { id: 'mic-usb', kind: 'mic', name: 'USB Current Mic', price: 95, spec: 'Cardioid · USB · 48 kHz', quality: 42, desc: 'A clean first step up from the basic microphone.' },
  { id: 'mic-pro', kind: 'mic', name: 'Broadcast Tide', price: 340, spec: 'XLR · shock mount · 96 kHz', quality: 92, desc: 'Warm, detailed voice capture for a serious studio.' },
  { id: 'light-panel', kind: 'light', name: 'Softbox Pair', price: 120, spec: '2 × 40 W · 3200–5600 K', quality: 46, desc: 'Balanced light that makes a webcam look much better.' },
  { id: 'light-pro', kind: 'light', name: 'Keylight Pro', price: 380, spec: '150 W · CRI 96 · app control', quality: 91, desc: 'Professional controllable key light for face and product shots.' },
  { id: 'monitor-60', kind: 'monitor', name: 'Harbor 60', price: 160, spec: '24 in · 1080p · 60 Hz', quality: 35, desc: 'A sharper, calmer monitor for editing and games.' },
  { id: 'monitor-144', kind: 'monitor', name: 'Reef 144', price: 390, spec: '27 in · 1440p · 144 Hz', quality: 70, desc: 'A smooth high-refresh creator monitor.' },
  { id: 'monitor-4k', kind: 'monitor', name: 'Horizon 4K', price: 820, spec: '32 in · 4K · 144 Hz HDR', quality: 96, desc: 'Large professional display for color and timeline work.' },
  { id: 'keyboard-mech', kind: 'keyboard', name: 'Tactile Board', price: 85, spec: 'Mechanical · hot-swap', quality: 48, desc: 'A comfortable keyboard that feels good over long sessions.' },
  { id: 'mouse-precision', kind: 'mouse', name: 'Precision Mouse', price: 65, spec: '26K DPI · wireless', quality: 48, desc: 'Smooth control for editing and competitive games.' },
  { id: 'router-mesh', kind: 'router', name: 'Mesh Beacon', price: 130, spec: 'Wi-Fi 6 · 2 nodes', quality: 58, desc: 'Extends stable coverage from the house to the yard.' },
  { id: 'router-pro', kind: 'router', name: 'Fiber Hub Pro', price: 330, spec: 'Wi-Fi 7 · 4 nodes', quality: 94, desc: 'Low-latency coverage for a full creator property.' },
];

const FURNITURE_NAMES = {
  bed: ['Sleepwell Frame', 'Cove Platform Bed', 'Driftwood Bed', 'Tidal King Bed', 'Studio Daybed'],
  desk: ['Compact Creator Desk', 'Harbor Standing Desk', 'Oak Worktable', 'L-Shape Editing Desk', 'Glass Production Desk'],
  chair: ['Old Task Chair', 'Mesh Comfort Chair', 'Creator Ergo Chair', 'Leather Director Chair', 'Zero-G Studio Chair'],
  sofa: ['Two Seat Sofa', 'Lounge Sectional', 'Woven Island Sofa', 'Modular Cloud Sofa', 'Velvet Conversation Sofa'],
  shelf: ['Pine Shelf', 'Floating Display Shelf', 'Steel Gear Rack', 'Archive Cabinet', 'Glass Equipment Shelf'],
  light: ['Desk Lamp', 'Paper Lantern', 'Floor Light', 'RGB Tube', 'Film Fresnel'],
  decor: ['Coastal Print', 'Framed Map', 'Ceramic Plant', 'Potted Palm', 'Wave Sculpture'],
  kitchen: ['Compact Kettle', 'Island Toaster', 'Counter Stool', 'Mini Fridge', 'Wooden Utensil Rack'],
  bath: ['Towel Rack', 'Mirror Cabinet', 'Stone Basin', 'Shower Shelf', 'Laundry Hamper'],
  studio: ['Backdrop Stand', 'Acoustic Panel', 'Rolling Equipment Case', 'Teleprompter', 'Product Turntable'],
};
const FURNITURE_CATEGORIES = Object.keys(FURNITURE_NAMES);
export const FURNITURE = Array.from({ length: 1000 }, (_, i) => {
  const category = FURNITURE_CATEGORIES[i % FURNITURE_CATEGORIES.length];
  const names = FURNITURE_NAMES[category];
  const tier = Math.floor(i / 100);
  const name = `${names[i % names.length]} ${tier ? `V${tier + 1}` : ''}`.trim();
  const price = 18 + (i % 17) * 7 + tier * 52 + (i % 5) * 11;
  return {
    id: `furniture-${String(i + 1).padStart(4, '0')}`,
    kind: 'furniture', category, name, price,
    spec: `${category} · ${tier < 3 ? 'flat-pack' : 'premium finish'} · ${i % 2 ? 'oak' : 'ash'}`,
    desc: `A detailed ${category} piece for a more personal creator home. Item ${i + 1} of 1,000.`,
    quality: 20 + tier * 8 + (i % 7),
  };
});

export const STARTER_FURNITURE = [
  { id: 'starter-bed', category: 'bed', name: 'Bad Bed', price: 0, spec: 'single · worn mattress', desc: 'It is not comfortable, but it is yours.' },
  { id: 'starter-desk', category: 'desk', name: 'Cheap Desk', price: 0, spec: 'laminate · one drawer', desc: 'A small desk with enough space for the weak PC.' },
  { id: 'starter-chair', category: 'chair', name: 'Old Chair', price: 0, spec: 'fabric · squeaky', desc: 'The wheels stick and the back leans slightly.' },
];

export const EVENTS = [
  { name: 'Village Market', day: 1, hour: 12, desc: 'Local makers set up by the fountain.' },
  { name: 'Sunset Boat Tour', day: 1, hour: 18, desc: 'A good chance to record a scenic outdoor clip.' },
  { name: 'Forest Firefly Walk', day: 2, hour: 20, desc: 'Rare wildlife appears after dark.' },
  { name: 'Cliffside Challenge', day: 3, hour: 15, desc: 'NPC creators meet at the viewpoint.' },
];

export function pcComponentScore(save) {
  const find = (slot) => (PC_PARTS[slot] || []).find((x) => x.id === save.pc.components[slot]) || PC_PARTS[slot][0];
  const scores = ['cpu', 'gpu', 'ram', 'storage', 'motherboard', 'psu', 'cooler', 'case'].map((slot) => find(slot).score);
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function getPart(slot, id) {
  return (PC_PARTS[slot] || []).find((x) => x.id === id) || (PC_PARTS[slot] || [])[0];
}
