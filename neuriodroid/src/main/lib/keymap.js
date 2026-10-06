'use strict';
/**
 * Keyboard → touch mapping ("game controls"), the feature that makes an
 * emulator usable for phone games.
 *
 *   • A global low-level hook (uiohook-napi, prebuilt N-API for win32-x64)
 *     captures keys even when the emulator window has focus.
 *   • Coordinates are stored as percentages of the device screen, so a profile
 *     keeps working when you change resolution.
 *   • Commands go through ONE persistent `adb shell` session (see LiveShell),
 *     which is ~10x faster than spawning adb per key.
 *   • Optional "turbo" mode uses `sendevent` on the touch device instead of
 *     `input tap` — noticeably lower latency, marked experimental.
 *   • Optional "mouse = touch": clicks inside the emulator window are mapped to
 *     device coordinates via winbridge.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const log = require('./logger').scoped('keymap');

let uiohook = null;
let UiohookKey = null;
let KEY_NAME_BY_CODE = null;

function loadHook() {
  if (uiohook !== null) return uiohook;
  try {
    // eslint-disable-next-line global-require
    const mod = require('uiohook-napi');
    uiohook = mod.uIOhook;
    UiohookKey = mod.UiohookKey;
    KEY_NAME_BY_CODE = {};
    for (const [name, code] of Object.entries(UiohookKey || {})) KEY_NAME_BY_CODE[code] = name;
    return uiohook;
  } catch (err) {
    log.warn('uiohook-napi unavailable, keyboard mapping disabled', { err: String(err.message || err) });
    uiohook = false;
    return false;
  }
}

const ANDROID_KEYS = {
  back: 4, home: 3, recents: 187, menu: 82, power: 26,
  volumeUp: 24, volumeDown: 25, volumeMute: 164,
  dpadUp: 19, dpadDown: 20, dpadLeft: 21, dpadRight: 22, dpadCenter: 23,
  enter: 66, del: 67, tab: 61, space: 62, escape: 111,
  camera: 27, search: 84, appSwitch: 187, playPause: 85,
};

const DEFAULT_PROFILE = {
  id: 'default',
  name: 'Starter (WASD + taps)',
  description: 'WASD virtual stick, Space = centre tap, Back/Home keys.',
  targetPackage: null,
  bindings: [
    { id: 'b1', type: 'stick', keys: { up: 'W', down: 'S', left: 'A', right: 'D' }, cx: 22, cy: 72, radius: 14, duration: 260 },
    { id: 'b2', type: 'tap', key: 'Space', x: 82, y: 76 },
    { id: 'b3', type: 'keyevent', key: 'Escape', keycode: 4, label: 'Back' },
    { id: 'b4', type: 'keyevent', key: 'F1', keycode: 3, label: 'Home' },
  ],
  mouse: false,
  turbo: false,
};

class KeymapManager extends EventEmitter {
  constructor(paths, adb) {
    super();
    this.paths = paths;
    this.adb = adb;
    this.file = path.join(paths.config, 'keymaps.json');
    this.profiles = [JSON.parse(JSON.stringify(DEFAULT_PROFILE))];
    this.active = null;   // {serial, profile, screen, device}
    this.hookStarted = false;
    this.lastFire = new Map();
    this.touch = null;    // sendevent device info
    this.winbridge = null;
    this.load();
  }

  // --- storage -------------------------------------------------------------
  load() {
    try {
      if (fs.existsSync(this.file)) {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (Array.isArray(data) && data.length) this.profiles = data;
      }
    } catch (err) {
      log.warn('keymap load failed', { err: String(err.message || err) });
    }
    return this.profiles;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.profiles, null, 2), 'utf8');
      return true;
    } catch (err) { log.error('keymap save failed', { err: String(err.message || err) }); return false; }
  }

  upsertProfile(profile) {
    if (!profile || !profile.id) throw new Error('profile.id required');
    const i = this.profiles.findIndex((p) => p.id === profile.id);
    if (i >= 0) this.profiles[i] = Object.assign({}, this.profiles[i], profile);
    else this.profiles.push(Object.assign(JSON.parse(JSON.stringify(DEFAULT_PROFILE)), profile));
    this.save();
    return this.profiles.find((p) => p.id === profile.id);
  }

  removeProfile(id) {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (!this.profiles.length) this.profiles = [JSON.parse(JSON.stringify(DEFAULT_PROFILE))];
    this.save();
    return true;
  }

  getProfile(id) { return this.profiles.find((p) => p.id === id) || null; }

  // --- runtime -------------------------------------------------------------
  status() {
    return {
      hookAvailable: !!loadHook(),
      hookStarted: this.hookStarted,
      active: this.active ? { serial: this.active.serial, profileId: this.active.profile.id, profileName: this.active.profile.name, screen: this.active.screen, turbo: !!this.touch } : null,
      profiles: this.profiles,
      mouse: this.active ? !!this.active.profile.mouse : false,
    };
  }

  async start(serial, profileId, opts = {}) {
    const profile = this.getProfile(profileId) || this.profiles[0];
    const screen = await this.adb.screenInfo(serial);
    if (!screen.width) throw new Error('Could not read the device screen size — is it booted?');
    this.active = { serial, profile, screen, opts };

    if (profile.turbo) {
      this.touch = await this.discoverTouch(serial).catch(() => null);
      if (!this.touch) log.info('turbo mode requested but no touch device found — falling back to input');
    } else this.touch = null;

    const hook = loadHook();
    if (hook && !this.hookStarted) {
      this._bindHook(hook);
      try { hook.start(); this.hookStarted = true; } catch (err) { log.error('hook start failed', { err: String(err.message || err) }); }
    }
    if (profile.mouse && this.winbridge) this._bindMouse();

    this.emit('status', this.status());
    log.info('keymap started', { serial, profile: profile.id, turbo: !!this.touch });
    return this.status();
  }

  stop() {
    const hook = loadHook();
    if (hook && this.hookStarted) {
      try { hook.stop(); } catch (_) {}
      this.hookStarted = false;
    }
    this.active = null;
    this.touch = null;
    if (this.active) this.adb.dropLive(this.active.serial);
    this.emit('status', this.status());
    return this.status();
  }

  setWinBridge(b) { this.winbridge = b; }

  _bindHook(hook) {
    if (this._hookBound) return;
    this._hookBound = true;
    hook.on('keydown', (e) => this._onKey(e, true));
    hook.on('keyup', (e) => this._onKey(e, false));
    hook.on('mousedown', (e) => this._onMouse(e, true));
    hook.on('mouseup', (e) => this._onMouse(e, false));
  }

  _bindMouse() { /* handled through _onMouse; winbridge provides the window rect */ }

  _keyName(code) { return (KEY_NAME_BY_CODE && KEY_NAME_BY_CODE[code]) || `KEY_${code}`; }

  _onKey(e, down) {
    if (!this.active || !down) return;
    const name = this._keyName(e.keycode);
    const bindings = this.active.profile.bindings || [];
    for (const b of bindings) {
      if (b.type === 'stick') {
        const dir = Object.keys(b.keys || {}).find((k) => String(b.keys[k]).toUpperCase() === name.toUpperCase());
        if (dir) this._fireStick(b, dir);
      } else if (b.type === 'tap' || b.type === 'swipe' || b.type === 'keyevent' || b.type === 'text') {
        if (String(b.key || '').toUpperCase() === name.toUpperCase()) this._fire(b);
      }
    }
  }

  async _onMouse(e, down) {
    if (!this.active || !down || !this.active.profile.mouse || !this.winbridge) return;
    if (e.button !== 1) return; // left only
    const inst = this.active.instance;
    const win = await this.winbridge.emulatorWindow(inst ? inst.pid : 0, this.active.profile.windowTitle || (inst && inst.avdName));
    if (!win) return;
    const w = win.right - win.left; const h = win.bottom - win.top;
    if (w <= 0 || h <= 0) return;
    const rx = (e.x - win.left) / w; const ry = (e.y - win.top) / h;
    if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return;
    const x = rx * this.active.screen.width; const y = ry * this.active.screen.height;
    this.tap(this.active.serial, x, y);
  }

  _throttled(id, ms) {
    const now = Date.now();
    const last = this.lastFire.get(id) || 0;
    if (now - last < ms) return false;
    this.lastFire.set(id, now);
    return true;
  }

  _fire(b) {
    const s = this.active.serial;
    const { width: W, height: H } = this.active.screen;
    switch (b.type) {
      case 'tap':
        if (!this._throttled(b.id, b.minMs || 40)) return;
        this.tap(s, (b.x / 100) * W, (b.y / 100) * H);
        break;
      case 'swipe':
        if (!this._throttled(b.id, b.minMs || 120)) return;
        this.swipe(s, (b.x1 / 100) * W, (b.y1 / 100) * H, (b.x2 / 100) * W, (b.y2 / 100) * H, b.duration || 220);
        break;
      case 'keyevent': {
        if (!this._throttled(b.id, b.minMs || 60)) return;
        const code = b.keycode != null ? b.keycode : ANDROID_KEYS[b.androidKey];
        if (code != null) this.keyevent(s, code);
        break;
      }
      case 'text':
        if (b.text) this.adb.text(s, b.text);
        break;
      default: break;
    }
  }

  _fireStick(b, dir) {
    if (!this._throttled(b.id + dir, b.minMs || 60)) return;
    const { width: W, height: H } = this.active.screen;
    const cx = (b.cx / 100) * W; const cy = (b.cy / 100) * H;
    const r = (b.radius / 100) * Math.min(W, H);
    const vec = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir] || [0, 0];
    this.swipe(this.active.serial, cx, cy, cx + vec[0] * r, cy + vec[1] * r, b.duration || 240);
  }

  // --- low level -----------------------------------------------------------
  tap(serial, x, y) {
    if (this.touch) return this._turboTap(serial, x, y);
    return this.adb.tapLive(serial, x, y);
  }

  swipe(serial, x1, y1, x2, y2, ms) {
    if (this.touch) {
      // Approximate a swipe with N fast sendevent moves.
      const steps = Math.max(2, Math.min(8, Math.round(ms / 40)));
      const sh = this.adb.live(serial);
      const d = this.touch;
      const parts = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.round(x1 + (x2 - x1) * t);
        const y = Math.round(y1 + (y2 - y1) * t);
        parts.push(this._evDown(x, y, i === 0), this._evMove(x, y));
      }
      parts.push(this._evUp());
      sh.send(parts.join(';'));
      return true;
    }
    return this.adb.swipeLive(serial, x1, y1, x2, y2, ms);
  }

  keyevent(serial, code) { return this.adb.keyLive(serial, code); }

  /** Discover the multitouch input device and its coordinate ranges. */
  async discoverTouch(serial) {
    const out = await this.adb.sh(serial, 'getevent -pl');
    const text = `${out.stdout || ''}\n${out.stderr || ''}`;
    const blocks = text.split(/add device \d+:/).slice(1);
    for (const block of blocks) {
      const nameM = block.match(/^\s*(\/dev\/input\/event\d+)/);
      if (!nameM) continue;
      const dev = nameM[1];
      const xM = block.match(/ABS_MT_POSITION_X[\s\S]*?value\s+\d+,\s*min\s+(-?\d+),\s*max\s+(\d+)/);
      const yM = block.match(/ABS_MT_POSITION_Y[\s\S]*?value\s+\d+,\s*min\s+(-?\d+),\s*max\s+(\d+)/);
      if (xM && yM) {
        return { dev, xmin: parseInt(xM[1], 10), xmax: parseInt(xM[2], 10), ymin: parseInt(yM[1], 10), ymax: parseInt(yM[2], 10) };
      }
    }
    return null;
  }

  _scaleX(x) { const d = this.touch; return Math.round(d.xmin + (x / this.active.screen.width) * (d.xmax - d.xmin)); }
  _scaleY(y) { const d = this.touch; return Math.round(d.ymin + (y / this.active.screen.height) * (d.ymax - d.ymin)); }

  _evDown(x, y, first) {
    const d = this.touch.dev;
    const id = 1;
    return `sendevent ${d} 1 330 1;sendevent ${d} 3 57 ${id};sendevent ${d} 3 53 ${this._scaleX(x)};sendevent ${d} 3 54 ${this._scaleY(y)};sendevent ${d} 0 0 0`;
  }
  _evMove(x, y) {
    const d = this.touch.dev;
    return `sendevent ${d} 3 53 ${this._scaleX(x)};sendevent ${d} 3 54 ${this._scaleY(y)};sendevent ${d} 0 0 0`;
  }
  _evUp() {
    const d = this.touch.dev;
    return `sendevent ${d} 3 57 4294967295;sendevent ${d} 1 330 0;sendevent ${d} 0 0 0`;
  }

  _turboTap(serial, x, y) {
    const sh = this.adb.live(serial);
    return sh.send([this._evDown(x, y, true), this._evUp()].join(';'));
  }
}

module.exports = { KeymapManager, DEFAULT_PROFILE, ANDROID_KEYS, loadHook };
