import { G } from './state.js';
import { clamp } from './util.js';

// ══════════════════════════════════════════════════════════════
//  INPUT — twin virtual sticks (left = move, right = aim + fire)
//  plus buttons, and full keyboard/mouse support on desktop.
//  Touch is handled with pointer events so one code path works
//  for fingers, mice and styluses.
// ══════════════════════════════════════════════════════════════

export const IN = {
  move: { x: 0, z: 0 },          // normalised wish direction (camera space)
  aim: { x: 0, z: 0 },
  firing: false,
  aimingDown: false,
  jump: false, crouch: false, pick: false, med: false, nar: false, reload: false,
  lookDX: 0, lookDY: 0,
  sens: 1,
  touch: false,
};

const keys = Object.create(null);
let stickL = null, stickR = null;
let knobL = null, knobR = null;
const pidL = new Map(), pidR = new Map();
let btnFireHeld = false;
let mouseDown = false;
let lastMouse = null;
let pointerLocked = false;

export function initInput(ui) {
  stickL = document.getElementById('stickL');
  stickR = document.getElementById('stickR');
  knobL = stickL.querySelector('i');
  knobR = stickR.querySelector('i');

  // ── sticks ───────────────────────────────────────────────────
  const bindStick = (el, knob, store, onEnd) => {
    const R = () => el.clientWidth * 0.5;
    const start = (ev) => {
      IN.touch = true;
      const r = el.getBoundingClientRect();
      const id = ev.pointerId;
      store.set(id, { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 });
      el.setPointerCapture(id);
      move(id, ev);
      ev.preventDefault();
    };
    const move = (id, ev) => {
      const s = store.get(id);
      if (!s) return;
      let dx = ev.clientX - s.cx, dy = ev.clientY - s.cy;
      const d = Math.hypot(dx, dy);
      const max = s.r * 0.82;
      if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      store.x = dx / max; store.y = dy / max;
      ev.preventDefault && ev.preventDefault();
    };
    const end = (ev) => {
      const id = ev.pointerId;
      if (!store.has(id)) return;
      store.delete(id);
      knob.style.transform = 'translate(0,0)';
      store.x = 0; store.y = 0;
      onEnd && onEnd();
    };
    el.addEventListener('pointerdown', start, { passive: false });
    el.addEventListener('pointermove', (ev) => move(ev.pointerId, ev), { passive: false });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    store.x = 0; store.y = 0;
  };
  bindStick(stickL, knobL, pidL);
  bindStick(stickR, knobR, pidR, () => { IN.firing = false; });

  // ── action buttons ───────────────────────────────────────────
  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); IN.touch = true; on(); }, { passive: false });
    const up = (ev) => { ev.preventDefault(); ev.stopPropagation(); off && off(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => off && off());
  };
  hold('bFire', () => { btnFireHeld = true; IN.firing = true; }, () => { btnFireHeld = false; if (!pidR.x && !pidR.y) IN.firing = false; });
  hold('bJump', () => { IN.jump = true; });
  hold('bProne', () => { IN.aimingDown = !IN.aimingDown; document.getElementById('bProne').classList.toggle('on', IN.aimingDown); });
  hold('bPick', () => { IN.pick = true; });

  const tap = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); IN.touch = true; fn(); }, { passive: false });
  };
  tap('itMed', () => { IN.med = true; });
  tap('itNar', () => { IN.nar = true; });

  // ── keyboard ─────────────────────────────────────────────────
  addEventListener('keydown', (ev) => {
    const k = ev.key.toLowerCase();
    keys[k] = true;
    if (k === ' ') { IN.jump = true; ev.preventDefault(); }
    if (k === 'r') IN.reload = true;
    if (k === 'f') IN.pick = true;
    if (k === 'q') IN.med = true;
    if (k === 'e') IN.nar = true;
    if (k === 'c' || k === 'control') IN.crouch = !IN.crouch;
    if (k === 'shift') IN.sprint = true;
    if (k === 'p' || k === 'escape') { ui.togglePause && ui.togglePause(); ev.preventDefault(); }
    if (k === 'm') ui.toggleSound && ui.toggleSound();
  });
  addEventListener('keyup', (ev) => {
    const k = ev.key.toLowerCase();
    keys[k] = false;
    if (k === 'shift') IN.sprint = false;
  });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });

  // ── mouse look (desktop) ─────────────────────────────────────
  const cv = document.getElementById('gl');
  cv.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'touch') return;
    mouseDown = true; lastMouse = { x: ev.clientX, y: ev.clientY };
    cv.setPointerCapture(ev.pointerId);
    if (!pointerLocked && cv.requestPointerLock) { try { cv.requestPointerLock(); } catch (e) {} }
  });
  cv.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    if (pointerLocked) {
      IN.lookDX += ev.movementX; IN.lookDY += ev.movementY;
      return;
    }
    if (!mouseDown || !lastMouse) return;
    IN.lookDX += ev.clientX - lastMouse.x;
    IN.lookDY += ev.clientY - lastMouse.y;
    lastMouse = { x: ev.clientX, y: ev.clientY };
  });
  const up = (ev) => {
    if (ev.pointerType === 'touch') return;
    mouseDown = false; IN.firing = false;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === cv;
  });
  // right-click = aim down sights, left = fire
  cv.addEventListener('mousedown', (ev) => {
    if (ev.pointerType === 'touch') return;
    if (ev.button === 0) IN.firing = true;
    if (ev.button === 2) IN.aimingDown = true;
  });
  cv.addEventListener('mouseup', (ev) => {
    if (ev.button === 2) IN.aimingDown = false;
  });
  // wheel = zoom
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    G.zoomBias = clamp((G.zoomBias || 0) + Math.sign(ev.deltaY) * 0.6, -2.5, 6);
  }, { passive: false });
}

/** build the wish vector for this frame, in world space */
export function readWish(camYaw) {
  let mx = 0, mz = 0;
  // keyboard
  if (keys['w'] || keys['arrowup']) mz += 1;
  if (keys['s'] || keys['arrowdown']) mz -= 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  // left stick (screen up = forward)
  if (pidL.x || pidL.y) { mx += pidL.x; mz += -pidL.y; }
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  else if (l > 0.001) { /* keep analogue magnitude */ }

  // rotate by camera yaw so "up" is always away from the camera
  const c = Math.cos(camYaw), s = Math.sin(camYaw);
  IN.move.x = mx * c + mz * s;
  IN.move.z = -mx * s + mz * c;

  // firing: right stick pushed OR fire button OR mouse
  const stickAim = Math.hypot(pidR.x || 0, pidR.y || 0) > 0.22;
  IN.firing = btnFireHeld || mouseDown || stickAim || keys['f'] === 'hold';
  IN.aiming = IN.aimingDown;

  // right stick steers the camera
  if (stickAim) {
    IN.lookDX += (pidR.x || 0) * 3.0 * IN.sens;
    IN.lookDY += (pidR.y || 0) * 1.5 * IN.sens;
  }
  IN.sprint = !!keys['shift'] || (l > 0.94 && !IN.aiming);
  return IN.move;
}

export function consumeLook() {
  const d = { x: IN.lookDX, y: IN.lookDY };
  IN.lookDX = 0; IN.lookDY = 0;
  return d;
}

export function consumeFlags() {
  const f = {
    jump: IN.jump, pick: IN.pick, med: IN.med, nar: IN.nar,
    reload: IN.reload || keys['r'], crouch: IN.crouch,
  };
  IN.jump = IN.pick = IN.med = IN.nar = IN.reload = false;
  return f;
}

export const isTouch = () => IN.touch;
