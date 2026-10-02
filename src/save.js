// Persistence for Creator Life Simulator.
const KEY = 'creator_life_simulator_v1';

export function defaultSave() {
  return {
    version: 1,
    cash: 120,
    day: 1,
    dayTime: 8.15,
    weather: 'clear',
    subscribers: 0,
    followers: 0,
    totalViews: 0,
    totalLikes: 0,
    totalComments: 0,
    watchMinutes: 0,
    donations: 0,
    engagement: 0.04,
    installedApps: ['browser', 'files', 'settings', 'games'],
    ownedGames: ['sunny-shores'],
    selectedGame: 'sunny-shores',
    ownedGear: ['basic-mic', 'weak-router'],
    placedGear: ['basic-mic', 'weak-router'],
    cameras: [],
    webcams: [],
    furniture: ['starter-bed', 'starter-desk', 'starter-chair'],
    placedFurniture: ['starter-bed', 'starter-desk', 'starter-chair'],
    internetPlan: 'island-basic',
    router: 'weak-router',
    pc: {
      components: {
        cpu: 'cpu-basic', gpu: 'gpu-basic', ram: 'ram-basic', storage: 'storage-hdd',
        motherboard: 'board-basic', psu: 'psu-basic', cooler: 'cooler-basic', case: 'case-basic',
      },
      monitor: 'Old monitor', keyboard: 'Cheap keyboard', mouse: 'Cheap mouse', microphone: 'Basic microphone',
    },
    orders: [],
    clips: [],
    renderedVideos: [],
    history: [],
    messages: [
      { from: 'Island Network', text: 'Welcome to your new creator life. Your first free game is ready to stream.', time: 'Day 1 · 08:00', unread: true },
    ],
    music: ['harbor-morning'],
    settings: {
      quality: 'HIGH', resolution: 'native', fullscreen: false, shadows: true, reflections: true,
      motionBlur: false, depthOfField: true, fov: 62, fpsLimit: 60, volume: 65, ambience: 80,
      language: 'English', networkMode: 'online', cameraSensitivity: 1,
    },
    tutorial: { seenIntro: false, steps: 0 },
    stats: { streams: 0, videos: 0, playTime: 0, moneyEarned: 0, deliveries: 0 },
    room: { code: '', role: '' },
    lastSaved: 0,
  };
}

function merge(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return base;
  for (const [key, value] of Object.entries(incoming)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      base[key] = merge(base[key], value);
    } else if (value !== undefined) base[key] = value;
  }
  return base;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    return merge(defaultSave(), JSON.parse(raw));
  } catch (_) {
    return defaultSave();
  }
}

export function persist(save) {
  save.version = 1;
  save.lastSaved = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (_) { /* private browsing */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (_) { /* noop */ }
}

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch (_) { return false; }
}
