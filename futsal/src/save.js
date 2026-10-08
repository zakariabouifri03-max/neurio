// SaveManager: settings, match history and tournament progress, stored in localStorage.
// Every read is defensive: a corrupt or missing save falls back to defaults instead of breaking the game.
const KEY = 'neurio-futsal-v1';

export const DEFAULT_SETTINGS = {
  quality: 'MEDIUM',          // LOW | MEDIUM | HIGH | ULTRA
  display: 'windowed',        // windowed | borderless | fullscreen
  aspect: '16:9',             // 16:9 | 16:10
  camera: 'broadcast',        // broadcast | player | close | training
  sfxVolume: 0.7,
  crowdVolume: 0.6,
  difficulty: 'normal',       // easy | normal | hard
  halfMinutes: 3,
  showHints: true,
};

export class SaveManager {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.data = this.load();
  }

  load() {
    let raw = null;
    try { raw = this.storage ? this.storage.getItem(KEY) : null; } catch (e) { raw = null; }
    let parsed = {};
    if (raw) {
      try { parsed = JSON.parse(raw) || {}; } catch (e) { parsed = {}; }
    }
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      history: Array.isArray(parsed.history) ? parsed.history.slice(-30) : [],
      tournament: parsed.tournament || null,
      bestGoals: parsed.bestGoals || 0,
    };
  }

  save() {
    try {
      if (this.storage) this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      // storage full or disabled: keep playing with in-memory state
    }
  }

  get settings() { return this.data.settings; }

  setSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    this.data.settings[key] = value;
    this.save();
  }

  // Store a finished match summary (small subset, enough for the history list).
  addResult(summary) {
    this.data.history.push({
      date: new Date().toISOString(),
      home: summary.names[0], away: summary.names[1],
      score: summary.score.slice(),
      mode: summary.mode,
    });
    this.data.history = this.data.history.slice(-30);
    this.save();
  }

  setTournament(state) {
    this.data.tournament = state;
    this.save();
  }

  clearTournament() {
    this.data.tournament = null;
    this.save();
  }
}
