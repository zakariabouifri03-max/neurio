'use strict';
/**
 * Persistent settings (plain JSON, human editable, atomic writes).
 * Defaults are tuned for gaming: hardware GPU, 4 cores, 4 GB RAM, keyboard on.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  version: 1,
  language: 'ar',            // 'ar' | 'en'
  theme: 'neon',
  root: null,                // null = auto (%LOCALAPPDATA%\NeurioDroid)
  gpu: 'host',               // host | auto | angle_indirect | swiftshader_indirect | off
  accel: 'auto',             // on | off | auto
  cores: 4,
  ramMB: 4096,
  dataPartitionGB: 12,
  dns: '1.1.1.1,8.8.8.8',
  noBootAnim: true,
  metrics: false,
  previewFps: 3,             // 0 = disabled (in-app live preview via screencap)
  audio: true,
  basePort: 5554,
  maxInstances: 4,
  closeAction: 'ask',        // ask | minimize | quit
  snapshotsOnExit: true,
  keymap: { enabled: true, engine: 'uiohook', holdMs: 60, repeatMs: 90 },
  downloads: { mirror: 'auto', concurrent: 2, keepInstallers: false },
  window: { width: 1280, height: 820, maximized: false },
  onboarding: { done: false },
};

class Settings {
  constructor(file, log) {
    this.file = file;
    this.log = log;
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = mergeDeep(JSON.parse(JSON.stringify(DEFAULTS)), raw);
      }
    } catch (err) {
      if (this.log) this.log.warn('settings.load failed, using defaults', { err: String(err.message || err) });
      try {
        const bak = this.file + '.corrupt-' + Date.now();
        fs.copyFileSync(this.file, bak);
      } catch (_) {}
    }
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      return true;
    } catch (err) {
      if (this.log) this.log.error('settings.save failed', { err: String(err.message || err) });
      return false;
    }
  }

  get() { return this.data; }

  set(patch) {
    if (!patch || typeof patch !== 'object') return this.data;
    this.data = mergeDeep(this.data, patch);
    this.save();
    return this.data;
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this.save();
    return this.data;
  }
}

function mergeDeep(base, patch) {
  for (const key of Object.keys(patch || {})) {
    const v = patch[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      base[key] = mergeDeep(base[key], v);
    } else if (v !== undefined) {
      base[key] = v;
    }
  }
  return base;
}

module.exports = { Settings, DEFAULTS, mergeDeep };
