// ============================================================
// GameState.js — Central State Management & Persistence
// ============================================================

class EventEmitter {
  constructor() {
    this.events = {};
  }
  on(event, listener) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
    return () => this.off(event, listener);
  }
  off(event, listener) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(l => l !== listener);
  }
  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event].forEach(l => {
        try { l(...args); } catch (e) { console.error(`Error in event ${event}:`, e); }
      });
    }
  }
}

const STORAGE_KEY = 'STREAMER_LIFE_ZERO_TO_FAMOUS_SAVE_V1';

const DEFAULT_STATE = {
  version: 1,
  gameTime: {
    day: 1,
    hour: 8,
    minute: 30,
    timeScale: 60, // 1 real sec = 1 in-game minute
    weather: 'clear' // clear, rain, cloudy, storm
  },
  player: {
    name: 'Alex',
    cash: 15.00,
    bank: 73.00,
    needs: {
      hunger: 65,
      thirst: 70,
      energy: 85,
      hygiene: 80,
      stress: 15,
      mood: 85
    },
    holding: null, // item currently carried in hands
    isSitting: false,
    isSleeping: false,
    isShowering: false,
    apartmentTier: 1, // 1: Starter, 2: Modern, 3: Luxury, 4: Creator Mansion
    outfit: {
      shirtColor: '#2563eb',
      pantsColor: '#1e293b',
      skinTone: '#f3c59a',
      hairColor: '#3c2415'
    }
  },
  career: {
    channelName: 'ZeroToHero',
    followers: 12,
    subscribers: 1,
    totalViews: 240,
    totalRevenue: 0,
    streamsCompleted: 0,
    reputation: 50, // 0 - 100
    tierName: 'Unknown Person',
    sponsors: []
  },
  pc: {
    isOn: false,
    isCaseOpen: false,
    benchmarkScore: 850,
    hardware: {
      gpu: { id: 'gpu_basic', name: 'Nova Basic 1050', score: 600, maxRes: '720p 30fps' },
      cpu: { id: 'cpu_basic', name: 'QuadCore i3-Legacy', score: 700 },
      ram: { id: 'ram_basic', name: '8GB DDR4 Basic', score: 500 },
      cooler: { id: 'cooler_basic', name: 'Stock Buzzer Fan', score: 400 },
      storage: { id: 'ssd_basic', name: '256GB SATA SSD', score: 550 },
      mic: { id: 'mic_basic', name: 'Clip-on Plastic Mic', quality: 'Poor' },
      webcam: { id: 'cam_basic', name: '720p GrainCam', quality: 'Poor' }
    }
  },
  fridge: [
    { id: 'item_noodles_1', type: 'food', name: 'Instant Noodles', hunger: 45, thirst: -10, needsCooking: true, cooked: false },
    { id: 'item_energy_1', type: 'food', name: 'Volt Surge Energy', thirst: 45, energy: 25, hunger: 5 },
    { id: 'item_soda_1', type: 'food', name: 'Spark Cola', thirst: 40, energy: 10, hunger: 5 },
    { id: 'item_pizza_1', type: 'food', name: 'Pizza Slice', hunger: 40, thirst: -5, needsCooking: true, cooked: false },
    { id: 'item_bread_1', type: 'food', name: 'Artisan Bread', hunger: 30, thirst: -5 }
  ],
  packages: [], // delivered boxes waiting outside or inside
  installedMods: {},
  transactions: [
    { desc: 'Starting Bank Deposit', amount: 73.00, type: 'credit', time: 'Day 1 08:00' }
  ],
  notifications: [
    { title: 'MetroVault Alert', body: 'Rent is due in 6 days ($250.00). Keep your balance topped up!', time: '08:00', read: false }
  ],
  pulseFeed: [
    { id: 1, author: 'MetroNews', handle: '@MetroNews', text: 'Streaming careers are exploding across the city! Thousands try, but only the consistent reach the top.', likes: 1420, time: '2h ago' },
    { id: 2, author: 'TechBite', handle: '@TechBite', text: 'NovaMarket announces huge stock of RTX Nova 3060 and 4080 GPUs. Faster shipping available!', likes: 320, time: '3h ago' },
    { id: 3, author: 'GamePulse', handle: '@GamePulse', text: 'Velocity Rush reaches 500k active players today! Are you climbing the leaderboards?', likes: 890, time: '4h ago' }
  ]
};

class GameStateManager extends EventEmitter {
  constructor() {
    super();
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this.hasUnsavedChanges = false;
  }

  init() {
    this.load();
    // Auto-save every 45 seconds
    setInterval(() => {
      this.save();
    }, 45000);
  }

  get() {
    return this.state;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.hasUnsavedChanges = false;
      this.emit('saved');
    } catch (e) {
      console.warn('Failed to save state to localStorage:', e);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded = JSON.parse(raw);
        // Deep merge with default state to ensure schema updates work cleanly
        this.state = this._deepMerge(JSON.parse(JSON.stringify(DEFAULT_STATE)), loaded);
        this.emit('loaded', this.state);
        return true;
      }
    } catch (e) {
      console.warn('Failed to load state from localStorage:', e);
    }
    return false;
  }

  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this.emit('reset', this.state);
  }

  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (source[key] instanceof Object && !Array.isArray(source[key]) && key in target) {
        Object.assign(source[key], this._deepMerge(target[key], source[key]));
      }
    }
    Object.assign(target || {}, source);
    return target;
  }

  // --- Convenience mutations ---
  modifyNeeds(delta) {
    const n = this.state.player.needs;
    for (const k of Object.keys(delta)) {
      if (n[k] !== undefined) {
        n[k] = Math.max(0, Math.min(100, Math.round(n[k] + delta[k])));
      }
    }
    // Calculate composite mood
    const avgWellbeing = (n.hunger + n.thirst + n.energy + n.hygiene) / 4;
    n.mood = Math.max(0, Math.min(100, Math.round(avgWellbeing - (n.stress * 0.4))));
    this.emit('needsChanged', n);
  }

  addCash(amount, desc = 'Cash') {
    this.state.player.cash = Math.max(0, +(this.state.player.cash + amount).toFixed(2));
    this.emit('cashChanged', this.state.player.cash);
  }

  addBank(amount, desc = 'Income') {
    this.state.player.bank = Math.max(0, +(this.state.player.bank + amount).toFixed(2));
    const nowStr = `Day ${this.state.gameTime.day} ${String(this.state.gameTime.hour).padStart(2,'0')}:${String(this.state.gameTime.minute).padStart(2,'0')}`;
    this.state.transactions.unshift({
      desc,
      amount,
      type: amount >= 0 ? 'credit' : 'debit',
      time: nowStr
    });
    if (this.state.transactions.length > 50) this.state.transactions.pop();
    this.emit('bankChanged', this.state.player.bank);
  }

  addNotification(title, body) {
    const timeStr = `${String(this.state.gameTime.hour).padStart(2,'0')}:${String(this.state.gameTime.minute).padStart(2,'0')}`;
    const notif = { title, body, time: timeStr, read: false };
    this.state.notifications.unshift(notif);
    if (this.state.notifications.length > 25) this.state.notifications.pop();
    this.emit('notification', notif);
  }

  recalculateBenchmark() {
    const hw = this.state.pc.hardware;
    let score = 0;
    if (hw.gpu) score += (hw.gpu.score || 600) * 1.5;
    if (hw.cpu) score += (hw.cpu.score || 700) * 1.2;
    if (hw.ram) score += (hw.ram.score || 500) * 0.6;
    if (hw.cooler) score += (hw.cooler.score || 400) * 0.3;
    if (hw.storage) score += (hw.storage.score || 550) * 0.4;
    this.state.pc.benchmarkScore = Math.round(score);
    this.emit('benchmarkChanged', this.state.pc.benchmarkScore);
    return this.state.pc.benchmarkScore;
  }
}

export const gameState = new GameStateManager();
