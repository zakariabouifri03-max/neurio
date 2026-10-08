// InputManager: keyboard + gamepad mapped onto football actions.
// The simulation reads it through four calls:
//   moveAxis()            -> { x, y }        left stick / WASD (y = forward)
//   aimAxis()             -> { x, y } | null right stick (null when unused)
//   held(action)          -> boolean         action currently down
//   consume(action, mode) -> boolean         press ('down', default) or release ('up') since last read;
//                                            presses are buffered briefly so a quick tap is never lost
// Menus read menuEvents(): 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'pause'.
import { KEYBINDS, PAD } from './config.js';

const BUFFER = 0.18;   // seconds a press stays available to consume()
const DEADZONE = 0.16;

// Gamepad mapping (standard layout). LT is the sprint / control modifier.
export const PAD_MAP = {
  pass: PAD.A,
  shoot: PAD.B,
  tackle: PAD.X,
  through: PAD.Y,
  switchPrev: PAD.LB,
  switchNext: PAD.RB,
  press: PAD.R3,
  skill: PAD.L3,
  gkRush: PAD.UP,
  pause: PAD.START,
  camera: PAD.BACK,
  lob: 'RT',
  sprint: 'LT',
};

// Keyboard: every binding from config.js, plus lob (F) and switch (Q).
const KEY_MAP = new Map();
for (const [action, codes] of Object.entries(KEYBINDS)) for (const c of codes) KEY_MAP.set(c, action);
KEY_MAP.set('KeyF', 'lob');
KEY_MAP.set('KeyQ', 'switch');

const MENU_KEYS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Enter: 'ok', NumpadEnter: 'ok', Space: 'ok',
  Backspace: 'back',
  Escape: 'pause',
};

export class InputManager {
  constructor(win = (typeof window !== 'undefined' ? window : null)) {
    this.rawKeys = new Set();     // KeyboardEvent.code values currently down
    this.held_ = new Set();       // actions currently down (keyboard or pad)
    this.padHeld = new Set();     // pad actions currently down
    this.pressQ = new Map();      // action -> [time]
    this.releaseQ = new Map();
    this.menuQ = [];
    this.padMenuPrev = new Set();
    this.time = 0;
    this.axes = { move: { x: 0, y: 0 }, aim: null };
    this.enabled = true;
    if (win) {
      win.addEventListener('keydown', (e) => this.onKey(e, true));
      win.addEventListener('keyup', (e) => this.onKey(e, false));
      win.addEventListener('blur', () => this.releaseAll());
    }
  }

  onKey(e, down) {
    const code = e.code;
    if (down && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) e.preventDefault();
    if (down) this.rawKeys.add(code); else this.rawKeys.delete(code);
    if (!this.enabled) return;
    if (down && !e.repeat && MENU_KEYS[code]) this.menuQ.push(MENU_KEYS[code]);
    const action = KEY_MAP.get(code);
    if (!action) return;
    if (down) {
      if (e.repeat || this.held_.has(action)) return;
      this.held_.add(action);
      this.push(this.pressQ, action);
    } else {
      if (!this.held_.has(action)) return;
      this.held_.delete(action);
      this.push(this.releaseQ, action);
    }
  }

  push(map, action) {
    let arr = map.get(action);
    if (!arr) { arr = []; map.set(action, arr); }
    arr.push(this.time);
  }

  releaseAll() {
    for (const a of this.held_) this.push(this.releaseQ, a);
    this.held_.clear();
    this.rawKeys.clear();
    this.padHeld.clear();
  }

  // Call once per frame, before the simulation step.
  poll(dt) {
    this.time += dt;
    const pad = this.activePad();
    let padMove = { x: 0, y: 0 }, aim = null;
    const nowPad = new Set();
    if (pad) {
      const pressed = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
      const analog = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      for (const [action, idx] of Object.entries(PAD_MAP)) {
        const down = idx === 'LT' ? analog(6) > 0.35 : idx === 'RT' ? analog(7) > 0.35 : pressed(idx);
        if (down) nowPad.add(action);
      }
      padMove = { x: dz(pad.axes[0] || 0), y: -dz(pad.axes[1] || 0) };
      const rx = dz(pad.axes[2] || 0), ry = -dz(pad.axes[3] || 0);
      if (rx || ry) aim = { x: rx, y: ry };
      // menu navigation from the pad (edge-triggered)
      const menuPad = { [PAD.UP]: 'up', [PAD.DOWN]: 'down', [PAD.LEFT]: 'left', [PAD.RIGHT]: 'right', [PAD.A]: 'ok', [PAD.B]: 'back', [PAD.START]: 'pause' };
      const nowMenu = new Set();
      for (const idx of Object.keys(menuPad)) if (pressed(+idx)) nowMenu.add(+idx);
      for (const idx of nowMenu) if (!this.padMenuPrev.has(idx)) this.menuQ.push(menuPad[idx]);
      this.padMenuPrev = nowMenu;
    } else {
      this.padMenuPrev = new Set();
    }
    // pad action edges
    for (const a of nowPad) if (!this.padHeld.has(a)) { this.padHeld.add(a); if (!this.held_.has(a)) { this.held_.add(a); this.push(this.pressQ, a); } }
    for (const a of Array.from(this.padHeld)) {
      if (!nowPad.has(a)) {
        this.padHeld.delete(a);
        if (this.held_.has(a)) { this.held_.delete(a); this.push(this.releaseQ, a); }
      }
    }

    // keyboard move axis (WASD and arrows)
    const kx = (this.isKey('KeyD', 'ArrowRight') ? 1 : 0) - (this.isKey('KeyA', 'ArrowLeft') ? 1 : 0);
    const ky = (this.isKey('KeyW', 'ArrowUp') ? 1 : 0) - (this.isKey('KeyS', 'ArrowDown') ? 1 : 0);
    let mx = padMove.x + kx, my = padMove.y + ky;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    this.axes.move = { x: mx, y: my };
    this.axes.aim = aim;

    // drop stale buffered edges
    for (const map of [this.pressQ, this.releaseQ]) {
      for (const [a, arr] of map) {
        while (arr.length && this.time - arr[0] > BUFFER) arr.shift();
        if (!arr.length) map.delete(a);
      }
    }
  }

  activePad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads() || [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  isKey(...codes) {
    return codes.some((c) => this.rawKeys.has(c));
  }

  moveAxis() { return this.axes.move; }
  aimAxis() { return this.axes.aim; }

  held(action) {
    return this.held_.has(action);
  }

  consume(action, mode = 'down') {
    const map = mode === 'up' ? this.releaseQ : this.pressQ;
    const arr = map.get(action);
    if (!arr || !arr.length) return false;
    arr.shift();
    if (!arr.length) map.delete(action);
    return true;
  }

  menuEvents() {
    const out = this.menuQ;
    this.menuQ = [];
    return out;
  }
}

function dz(v) {
  if (Math.abs(v) < DEADZONE) return 0;
  const s = (Math.abs(v) - DEADZONE) / (1 - DEADZONE);
  return Math.sign(v) * Math.min(1, s);
}
