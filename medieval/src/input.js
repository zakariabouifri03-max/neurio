// ── IRONVOW — input: mouse, keys, and the touch fallback ─────────────────────
// A sword is not a cursor. Everything the player does with the mouse is a
// COMMITMENT — press to wind a blow, release to let it go, hold to charge it —
// so this module just reports intent and never acts on it.
const BINDINGS = {
  KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'fwd', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'shove', KeyE: 'feint', KeyQ: 'swap', KeyR: 'guardSwap',
  KeyF: 'flash', Tab: 'lock', Escape: 'pause', KeyP: 'pause', KeyY: 'yield',
};

export class Input {
  constructor(el, opts = {}) {
    this.el = el;
    this.keys = new Set();
    this.actions = new Set();       // one-shot presses, drained every frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftDown: false, rightDown: false };
    this.look = 0;
    this.sensitivity = opts.sensitivity ?? 0.0022;
    this.invertY = opts.invertY ?? false;
    this.locked = false;
    this.enabled = true;
    this.touch = null;
    this._bind();
  }

  _bind() {
    const el = this.el;
    this.onKeyDown = (e) => {
      const a = BINDINGS[e.code];
      // unknown keys keep their raw code, so a game screen can read a letter
      // straight off the keyboard without a binding for it
      if (!this.keys.has(a || e.code)) this.actions.add(a || e.code);
      this.keys.add(a || e.code);
      if (a) e.preventDefault();
    };
    this.onKeyUp = (e) => {
      const a = BINDINGS[e.code];
      this.keys.delete(a || e.code);
    };
    this.onMouseDown = (e) => {
      if (e.button === 0) { this.mouse.left = true; if (!e.repeat) this.mouse.leftDown = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightDown = true; }
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    };
    this.onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    };
    this.onLockChange = () => {
      this.locked = document.pointerLockElement === el;
      if (this.onLock) this.onLock(this.locked);
    };
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('mousedown', this.onMouseDown);
    addEventListener('mouseup', this.onMouseUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
    // a finger on a phone is not a mouse: two zones, steer with one, fight with
    // the other, so the game is playable on a tablet as well as a desk
    el.addEventListener('touchstart', (e) => this._touchStart(e), { passive: true });
    el.addEventListener('touchmove', (e) => this._touchMove(e), { passive: true });
    el.addEventListener('touchend', (e) => this._touchEnd(e), { passive: true });
  }

  _touchStart(e) {
    if (!this.touch) this.touch = { steer: null, act: null, ox: 0, oy: 0 };
    for (const t of e.changedTouches) {
      const left = t.clientX < innerWidth * 0.5;
      if (left && this.touch.steer === null) {
        this.touch.steer = t.identifier;
        this.touch.ox = t.clientX; this.touch.oy = t.clientY;
      } else if (!left && this.touch.act === null) {
        this.touch.act = t.identifier;
        this.mouse.left = true; this.mouse.leftDown = true;
      } else if (left) {
        // a second finger on the steer side is a guard
        this.mouse.right = true; this.mouse.rightDown = true;
        if (this.onTouchBlock) this.onTouchBlock(true);
      }
    }
  }
  _touchMove(e) {
    if (!this.touch || this.touch.steer === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== this.touch.steer) continue;
      this.mouse.dx += (t.clientX - this.touch.ox) * 1.6;
      this.mouse.dy += (t.clientY - this.touch.oy) * 1.6;
      this.touch.ox = t.clientX; this.touch.oy = t.clientY;
    }
  }
  _touchEnd(e) {
    if (!this.touch) return;
    for (const t of e.changedTouches) {
      if (t.identifier === this.touch.steer) this.touch.steer = null;
      if (t.identifier === this.touch.act) { this.touch.act = null; this.mouse.left = false; }
    }
    if (!this.touch.steer && !this.touch.act) { this.mouse.right = false; this.touch = null; }
  }

  requestLock() { if (this.el.requestPointerLock) this.el.requestPointerLock(); }
  releaseLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  down(a) { return this.keys.has(a); }
  pressed(a) { return this.actions.has(a); }

  /** Look input for this frame, in radians, already scaled. */
  lookDelta() {
    const pitchSign = this.invertY ? 1 : -1;
    return {
      yaw: -this.mouse.dx * this.sensitivity,
      pitch: pitchSign * this.mouse.dy * this.sensitivity,
      dx: this.mouse.dx, dy: this.mouse.dy,
    };
  }

  /** Movement intent in local space: x = strafe, z = forward. */
  moveAxis() {
    let x = 0, z = 0;
    if (this.down('fwd')) z += 1;
    if (this.down('back')) z -= 1;
    if (this.down('right')) x += 1;
    if (this.down('left')) x -= 1;
    const l = Math.hypot(x, z);
    return l > 1 ? { x: x / l, z: z / l } : { x, z };
  }

  /** Consume the one-shot press flags. */
  endFrame() {
    this.actions.clear();
    this.mouse.leftDown = false;
    this.mouse.rightDown = false;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  }
}
