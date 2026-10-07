// Procedural motion library: premade clips, poses, baking into editable keyframes, motion generation.
// Conventions (character faces +X): rotations are degrees, positive = clockwise on screen.
// For a hanging limb, swinging FORWARD (toward +X) is a NEGATIVE angle; raising an arm sideways outward is
// positive for the character's right arm (screen-left) and negative for the left arm.
import { clamp, lerp } from './util.js';
import { S, fps } from './state.js';
import { setKey, evalTrack, trackIndex, layerProp, layerBase, hasKeys, ease } from './anim.js';
import { roleMap } from './rig.js';

export const ARM_ROLES = ['upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR'];
export const ALL_ROLES = ['root', 'body', 'head', 'hair', 'eyes', 'mouth', ...ARM_ROLES, 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const mirrorRole = (r) => r.replace(/L$/, '#').replace(/R$/, 'L').replace(/#$/, 'R');
export const mirrorPose = (p) => { const o = {}; for (const [k, v] of Object.entries(p)) o[k === '_' ? k : mirrorRole(k)] = v; return o; };
const sc = (p, k) => { const o = {}; for (const [r, v] of Object.entries(p)) { if (r === '_') { o[r] = v; continue; } o[r] = { ...v }; if ('r' in v) o[r].r = v.r * k; } return o; };

// ───────── poses: { role: { r, x, y, sx, sy }, _: { dy, dx, rot, flip } } ─────────
export const POSES = {
  neutral: {},
  standing: {},
  running: { root: { y: -14 }, body: { r: 14 }, head: { r: -6 }, upperArmL: { r: -50 }, foreArmL: { r: -90 }, upperArmR: { r: 40 }, foreArmR: { r: -90 }, thighR: { r: -48 }, shinR: { r: 12 }, thighL: { r: 32 }, shinL: { r: 85 }, footL: { r: 20 } },
  jumping: { root: { y: -6 }, body: { r: 0, sy: 1.04 }, head: { r: -6 }, upperArmL: { r: -150 }, upperArmR: { r: 150 }, foreArmL: { r: -10 }, foreArmR: { r: 10 }, thighL: { r: -10 }, shinL: { r: 40 }, thighR: { r: 18 }, shinR: { r: 20 }, _: { dy: -0.3 } },
  sitting: { root: { y: 8 }, body: { r: 0 }, thighL: { r: -86 }, thighR: { r: -86 }, shinL: { r: 88 }, shinR: { r: 88 }, upperArmL: { r: -12 }, foreArmL: { r: -62 }, upperArmR: { r: -12 }, foreArmR: { r: -62 }, head: { r: 0 }, _: { dy: 0.1 } },
  fighting: { body: { r: 8 }, head: { r: -5 }, upperArmR: { r: 40 }, foreArmR: { r: -110 }, upperArmL: { r: -70 }, foreArmL: { r: 120 }, thighR: { r: -32 }, shinR: { r: 22 }, thighL: { r: 26 }, shinL: { r: 14 }, root: { y: 10 } },
  waving: { upperArmR: { r: 125 }, foreArmR: { r: -10 }, head: { r: -4 }, body: { r: -2 } },
  dancing: { root: { y: 8 }, body: { r: -8 }, head: { r: 8 }, upperArmR: { r: 150 }, foreArmR: { r: -25 }, upperArmL: { r: -30 }, foreArmL: { r: 40 }, thighL: { r: -12 }, shinL: { r: 20 }, thighR: { r: 14 }, shinR: { r: 6 } },
  surprised: { body: { r: -7 }, head: { r: -8 }, upperArmL: { r: -100 }, foreArmL: { r: 50 }, upperArmR: { r: 100 }, foreArmR: { r: -50 }, thighL: { r: 6 }, thighR: { r: -6 }, root: { y: -6 }, _: { dy: -0.03 } },
  sleeping: { head: { r: 6 }, body: { r: 0 }, upperArmL: { r: -8 }, upperArmR: { r: 8 }, _: { dy: 0.4, rot: -90 } },
  pointing: { upperArmR: { r: -88 }, foreArmR: { r: 0 }, body: { r: 4 }, head: { r: 3 }, upperArmL: { r: -4 } },
  thinking: { upperArmR: { r: -25 }, foreArmR: { r: -135 }, handR: { r: 10 }, head: { r: 8 }, body: { r: 2 } },
  happy: { head: { r: -5 }, upperArmL: { r: -35 }, upperArmR: { r: 35 }, foreArmL: { r: 30 }, foreArmR: { r: -30 }, root: { y: -4 } },
  sad: { head: { r: 16 }, body: { r: 8 }, upperArmL: { r: 4 }, upperArmR: { r: -4 }, root: { y: 4 } },
  crouching: { root: { y: 34 }, body: { r: 10, sy: 0.95 }, thighL: { r: -45 }, thighR: { r: -45 }, shinL: { r: 70 }, shinR: { r: 70 }, upperArmL: { r: 25 }, upperArmR: { r: -25 }, _: { dy: 0.01 } },
};
export const POSE_ALIASES = {
  run: 'running', running: 'running', sprint: 'running', jump: 'jumping', jumping: 'jumping', leap: 'jumping', sit: 'sitting', sitting: 'sitting', seated: 'sitting', fight: 'fighting', fighting: 'fighting', 'fighting pose': 'fighting', 'fight pose': 'fighting', battle: 'fighting', punch: 'fighting',
  wave: 'waving', waving: 'waving', hello: 'waving', dance: 'dancing', dancing: 'dancing', surprised: 'surprised', surprise: 'surprised', shocked: 'surprised', astonished: 'surprised', sleep: 'sleeping', sleeping: 'sleeping', asleep: 'sleeping',
  point: 'pointing', pointing: 'pointing', think: 'thinking', thinking: 'thinking', happy: 'happy', joy: 'happy', sad: 'sad', crouch: 'crouching', crouching: 'crouching', stand: 'standing', standing: 'standing', idle: 'standing', neutral: 'standing',
};
export function findPose(text) {
  const t = text.toLowerCase().trim();
  if (POSE_ALIASES[t]) return POSE_ALIASES[t];
  for (const k of Object.keys(POSE_ALIASES).sort((a, b) => b.length - a.length)) if (t.includes(k)) return POSE_ALIASES[k];
  return null;
}

// ───────── clips ─────────
const K = (t, pose, e) => ({ t, pose, e });
function walkKeys(o) {
  const a = o.amp, run = o.run;
  const contact = run
    ? { root: { y: 4 }, body: { r: 14 }, head: { r: -4 }, thighR: { r: -48 }, shinR: { r: 12 }, thighL: { r: 32 }, shinL: { r: 85 }, footL: { r: 20 }, upperArmL: { r: -50 }, foreArmL: { r: -90 }, upperArmR: { r: 40 }, foreArmR: { r: -90 } }
    : { root: { y: 6 }, body: { r: 3 }, thighR: { r: -26 }, shinR: { r: 4 }, thighL: { r: 20 }, shinL: { r: 14 }, footL: { r: 12 }, upperArmL: { r: -24 }, foreArmL: { r: -20 }, upperArmR: { r: 24 }, foreArmR: { r: -10 } };
  const pass = run
    ? { root: { y: -22 }, body: { r: 14 }, head: { r: -4 }, thighR: { r: 5 }, shinR: { r: 60 }, thighL: { r: -30 }, shinL: { r: 40 }, upperArmL: { r: -10 }, foreArmL: { r: -90 }, upperArmR: { r: 10 }, foreArmR: { r: -90 } }
    : { root: { y: -8 }, body: { r: 3 }, thighL: { r: -10 }, shinL: { r: 55 }, thighR: { r: 0 }, shinR: { r: 0 }, upperArmL: { r: 0 }, upperArmR: { r: 0 }, foreArmL: { r: -12 }, foreArmR: { r: -12 } };
  const c1 = sc(contact, a), p1 = sc(pass, a), c2 = mirrorWithRoot(c1), p2 = mirrorWithRoot(p1);
  return [K(0, c1), K(0.25, p1), K(0.5, c2), K(0.75, p2), K(1, c1)];
}
const mirrorWithRoot = (p) => { const m = mirrorPose(p); if (p.root) m.root = { ...p.root }; if (p.body) m.body = { ...p.body }; if (p.head) m.head = { ...p.head }; return m; };

export const CLIPS = {
  walk: { label: 'Walk', loop: true, cycle: 1.0, move: 'walk', tags: ['locomotion'], gen: (o) => walkKeys({ amp: o.amp ?? 1, run: false }) },
  run: { label: 'Run', loop: true, cycle: 0.55, move: 'run', tags: ['locomotion'], gen: (o) => walkKeys({ amp: o.amp ?? 1, run: true }) },
  idle: { label: 'Idle', loop: true, cycle: 2.4, tags: ['basic'], gen: () => [K(0, { body: { sy: 1 }, head: { r: 0 }, upperArmL: { r: 0 }, upperArmR: { r: 0 } }), K(0.5, { body: { sy: 1.018 }, head: { r: 1.5 }, upperArmL: { r: -2.5 }, upperArmR: { r: 2.5 }, root: { y: -1 } }), K(1, { body: { sy: 1 }, head: { r: 0 }, upperArmL: { r: 0 }, upperArmR: { r: 0 } })] },
  jump: {
    label: 'Jump', loop: false, seconds: 1.0, tags: ['action'],
    gen: () => [
      K(0, {}, 'easeInOut'),
      K(0.18, { root: { y: 34 }, body: { r: 8, sy: 0.93, sx: 1.04 }, thighL: { r: -42 }, thighR: { r: -42 }, shinL: { r: 66 }, shinR: { r: 66 }, upperArmL: { r: 38 }, upperArmR: { r: -38 }, head: { r: 4 } }, 'easeOut'), // anticipation / squash
      K(0.3, { root: { y: -4 }, body: { r: 0, sy: 1.07, sx: 0.95 }, thighL: { r: 4 }, thighR: { r: 4 }, shinL: { r: 6 }, shinR: { r: 6 }, upperArmL: { r: -150 }, upperArmR: { r: 150 }, head: { r: -6 }, _: { dy: 0 } }, 'easeOut'), // launch / stretch
      K(0.5, { root: { y: 0 }, body: { sy: 1, sx: 1 }, thighL: { r: -24 }, thighR: { r: 12 }, shinL: { r: 46 }, shinR: { r: 36 }, upperArmL: { r: -125 }, upperArmR: { r: 125 }, _: { dy: -1 } }, 'easeIn'), // peak
      K(0.7, { root: { y: -2 }, body: { sy: 1.04, sx: 0.97 }, thighL: { r: -10 }, thighR: { r: -6 }, shinL: { r: 8 }, shinR: { r: 6 }, upperArmL: { r: -40 }, upperArmR: { r: 40 }, _: { dy: 0 } }, 'easeOut'), // fall → contact
      K(0.8, { root: { y: 30 }, body: { r: 6, sy: 0.92, sx: 1.05 }, thighL: { r: -46 }, thighR: { r: -46 }, shinL: { r: 72 }, shinR: { r: 72 }, upperArmL: { r: 20 }, upperArmR: { r: -20 } }, 'easeOut'), // landing squash
      K(1, {}, 'easeInOut'), // recovery
    ],
  },
  wave: {
    label: 'Wave', loop: false, seconds: 2.0, tags: ['gesture'], params: ['hand'],
    gen: (o) => {
      const s = o.hand === 'L' ? -1 : 1; const R = (o.hand === 'L' ? 'L' : 'R');
      const n = Math.max(2, Math.round((o.seconds || 2) * 2.6)); const keys = [K(0, {}, 'easeOut')];
      const up = { ['upperArm' + R]: { r: s * 128 }, ['foreArm' + R]: { r: s * -12 }, head: { r: -s * 4 }, body: { r: -s * 2 } };
      keys.push(K(0.14, up, 'easeInOut'));
      for (let i = 0; i < n; i++) keys.push(K(0.14 + ((i + 1) / (n + 1)) * 0.72, { ...up, ['foreArm' + R]: { r: s * (i % 2 === 0 ? 34 : -42) }, ['hand' + R]: { r: s * (i % 2 === 0 ? 14 : -14) } }, 'easeInOut'));
      keys.push(K(0.88, up, 'easeInOut')); keys.push(K(1, {}, 'easeInOut'));
      return keys;
    },
  },
  sit: { label: 'Sit', loop: false, seconds: 0.9, hold: true, tags: ['action'], gen: () => [K(0, {}, 'easeInOut'), K(0.5, { root: { y: 14 }, body: { r: -4 }, thighL: { r: -50 }, thighR: { r: -50 }, shinL: { r: 40 }, shinR: { r: 40 }, upperArmL: { r: -8 }, upperArmR: { r: 8 }, _: { dy: 0.05 } }, 'easeOut'), K(1, POSES.sitting, 'easeOut')] },
  stand: { label: 'Stand Up', loop: false, seconds: 0.9, tags: ['action'], gen: () => [K(0, null), K(0.35, { root: { y: 16 }, body: { r: 10 }, thighL: { r: -70 }, thighR: { r: -70 }, shinL: { r: 60 }, shinR: { r: 60 }, upperArmL: { r: 10 }, upperArmR: { r: -10 }, _: { dy: 0.08 } }, 'easeOut'), K(1, {}, 'easeInOut')] },
  dance: {
    label: 'Dance', loop: true, cycle: 1.0, tags: ['action'],
    gen: () => { const a = POSES.dancing; const b = mirrorWithRoot(a); const a2 = { ...a, root: { y: -6 } }; const b2 = { ...b, root: { y: -6 } }; return [K(0, a), K(0.25, { ...a2, body: { r: 0 }, head: { r: 0 } }), K(0.5, b), K(0.75, { ...b2, body: { r: 0 }, head: { r: 0 } }), K(1, a)]; },
  },
  point: { label: 'Point', loop: false, seconds: 1.4, tags: ['gesture'], gen: (o) => { const R = o.hand === 'L' ? 'L' : 'R'; return [K(0, {}, 'easeOut'), K(0.25, { ['upperArm' + R]: { r: -88 }, body: { r: 4 }, head: { r: 3 } }, 'easeInOut'), K(0.7, { ['upperArm' + R]: { r: -90 }, ['foreArm' + R]: { r: -4 }, body: { r: 4 }, head: { r: 3 } }, 'easeInOut'), K(1, {}, 'easeInOut')]; } },
  talk: {
    label: 'Talk', loop: true, cycle: 1.2, tags: ['gesture'], mouth: true,
    gen: () => [K(0, { head: { r: 0 } }), K(0.2, { head: { r: 3 }, upperArmR: { r: -22 }, foreArmR: { r: -35 }, body: { r: 1 } }), K(0.45, { head: { r: -2 }, upperArmR: { r: -30 }, foreArmR: { r: -48 }, upperArmL: { r: -8 } }), K(0.7, { head: { r: 3 }, upperArmR: { r: -18 }, foreArmR: { r: -30 }, upperArmL: { r: -16 }, foreArmL: { r: -22 } }), K(1, { head: { r: 0 } })],
  },
  turn: { label: 'Turn Around', loop: false, seconds: 0.6, tags: ['action'], flip: true, gen: () => [K(0, {}, 'easeInOut'), K(0.5, { head: { r: 5 }, _: { flip: 0.5 } }, 'easeInOut'), K(1, {}, 'easeInOut')] },
  lookAround: { label: 'Look Around', loop: false, seconds: 2.4, tags: ['gesture'], gen: () => [K(0, {}, 'easeInOut'), K(0.22, { head: { r: -24 }, body: { r: -3 } }, 'easeInOut'), K(0.42, { head: { r: -24 }, body: { r: -3 } }, 'easeInOut'), K(0.66, { head: { r: 24 }, body: { r: 3 } }, 'easeInOut'), K(0.82, { head: { r: 24 }, body: { r: 3 } }, 'easeInOut'), K(1, {}, 'easeInOut')] },
  nod: { label: 'Nod', loop: false, seconds: 0.9, tags: ['gesture'], gen: () => [K(0, {}), K(0.25, { head: { r: 12 } }), K(0.5, { head: { r: -2 } }), K(0.75, { head: { r: 10 } }), K(1, {})] },
  shake: { label: 'Shake Head', loop: false, seconds: 0.9, tags: ['gesture'], gen: () => [K(0, {}), K(0.2, { head: { r: -14 } }), K(0.45, { head: { r: 14 } }), K(0.7, { head: { r: -10 } }), K(1, {})] },
  sleep: { label: 'Fall Asleep', loop: false, seconds: 1.4, hold: true, tags: ['action'], gen: () => [K(0, {}, 'easeInOut'), K(1, POSES.sleeping, 'easeInOut')] },
  surprise: { label: 'Surprised', loop: false, seconds: 0.9, tags: ['gesture'], gen: () => [K(0, {}, 'easeOut'), K(0.2, { ...POSES.surprised, root: { y: -10 } }, 'easeOut'), K(0.7, POSES.surprised, 'easeInOut'), K(1, {}, 'easeInOut')] },
};
export const CLIP_LIST = ['walk', 'run', 'jump', 'idle', 'wave', 'sit', 'stand', 'dance', 'point', 'talk', 'turn'];

/** Expand a clip into absolute-time keys for `seconds`. Returns { seconds, keys:[{t, pose, e}], roles:Set } */
export function expandClip(name, o = {}) {
  const clip = CLIPS[name];
  if (!clip) throw new Error('Unknown clip: ' + name);
  const speed = o.speed || 1;
  let seconds = o.seconds || clip.seconds || clip.cycle || 1;
  let keys = [];
  if (clip.loop) {
    const cycle = (o.cycle || clip.cycle) / speed;
    const n = Math.max(1, Math.round(seconds / cycle));
    seconds = n * cycle;
    const base = clip.gen({ ...o, seconds });
    for (let i = 0; i < n; i++) for (const k of base) { if (i > 0 && k.t === 0) continue; keys.push({ t: (i + k.t) * cycle, pose: k.pose, e: k.e }); }
    // return to neutral at the end
    keys[keys.length - 1] = { t: seconds, pose: clip.hold ? keys[keys.length - 1].pose : {}, e: 'easeInOut' };
  } else {
    seconds = (o.seconds || clip.seconds) / speed;
    keys = clip.gen({ ...o, seconds }).map((k) => ({ t: k.t * seconds, pose: k.pose, e: k.e }));
  }
  const roles = new Set();
  for (const k of keys) if (k.pose) for (const r of Object.keys(k.pose)) roles.add(r);
  return { seconds, keys, roles, clip };
}

export function charHeight(layer) {
  if (!layer.char) return 300;
  let minY = 1e9, maxY = -1e9;
  for (const b of layer.char.bones) if (b.img) { minY = Math.min(minY, b.img.y); maxY = Math.max(maxY, b.img.y + b.img.h); }
  if (maxY < minY) return 300;
  return (maxY - minY) * Math.abs(layerBase(layer, 'scaleY'));
}

const PROP_MAP = { r: 'rot', x: 'x', y: 'y', sx: 'sx', sy: 'sy' };
function trackNameFor(layer, role, p) {
  const b = roleMap(layer.char)[role];
  if (!b) return null;
  return `b.${b.id}.${PROP_MAP[p]}`;
}
const getVal = (layer, name, f) => layerProp(layer, name, f);

/** Overwrite a range on a track then write keys. The start is anchored with the pre-existing value. */
export function bakeTrack(layer, name, start, end, points, anchorValue) {
  layer.tracks = layer.tracks || {};
  const tr = (layer.tracks[name] = layer.tracks[name] || []);
  const startVal = anchorValue !== undefined ? anchorValue : evalTrack(tr, start, layerBase(layer, name));
  for (let i = tr.length - 1; i >= 0; i--) if (tr[i].f >= start && tr[i].f <= end) tr.splice(i, 1);
  if (!tr.length && start > 0) setKey(tr, 0, layerBase(layer, name), 'easeInOut');
  setKey(tr, start, startVal, 'easeInOut');
  for (const p of points) if (p.f > start || p.force) setKey(tr, p.f, p.v, p.e);
  return tr;
}

/**
 * Bake an expanded clip onto a character layer starting at frame `start`.
 * o: { y0 (ground y), scaleX0, flipTo, noLead }.  Returns { endFrame, tracks }.
 */
export function bakeClip(layer, exp, start, o = {}) {
  const fr = fps();
  const lead = exp.clip.loop && !o.noLead ? Math.min(0.12, exp.seconds * 0.2) : 0;
  const end = start + Math.max(1, Math.round((exp.seconds + lead) * fr));
  const per = {};
  const add = (name, f, v, e) => { (per[name] = per[name] || []).push({ f, v, e }); };
  const cH = charHeight(layer);
  const y0 = o.y0 !== undefined ? o.y0 : layerProp(layer, 'y', start);
  const s0 = o.scaleX0 !== undefined ? o.scaleX0 : layerProp(layer, 'scaleX', start);
  const hasL = (prop) => exp.keys.some((k) => k.pose && k.pose._ && prop in k.pose._);
  const used = {};
  for (const k of exp.keys) if (k.pose) for (const [role, p] of Object.entries(k.pose)) { if (role === '_') continue; used[role] = used[role] || new Set(); for (const pr of Object.keys(p)) used[role].add(pr); }
  exp.keys.forEach((k, idx) => {
    if (idx === 0 && k.pose === null) return; // "start from current"
    const f = start + Math.round((k.t + lead) * fr);
    const pose = k.pose || {}; const e = k.e || 'easeInOut';
    for (const [role, props] of Object.entries(used)) for (const prop of props) {
      const name = trackNameFor(layer, role, prop); if (!name) continue;
      const p = pose[role] || {}; const dv = prop === 'sx' || prop === 'sy' ? 1 : 0;
      add(name, f, p[prop] !== undefined ? p[prop] : dv, e);
    }
    const L = pose._ || {};
    if (hasL('dy')) add('y', f, y0 + (L.dy || 0) * cH, e);
    if (hasL('rot')) add('rotation', f, L.rot !== undefined ? L.rot : 0, e);
    if (hasL('flip')) add('scaleX', f, L.flip === 0.5 ? 0.001 : (k.t >= exp.seconds - 1e-6 ? (o.flipTo ?? -s0) : s0), e);
  });
  const tracks = [];
  for (const [name, pts0] of Object.entries(per)) {
    const pts = pts0.sort((a, b) => a.f - b.f);
    const dedup = []; for (const p of pts) { if (dedup.length && dedup[dedup.length - 1].f === p.f) dedup[dedup.length - 1] = p; else dedup.push(p); }
    const anchor = name === 'y' ? undefined : name === 'scaleX' ? s0 : undefined;
    bakeTrack(layer, name, start, Math.max(end, dedup[dedup.length - 1].f), dedup, anchor);
    tracks.push(name);
  }
  return { endFrame: end, tracks, lead };
}

/** Write a full pose (all rig roles) at frame f. */
export function setPoseAt(layer, f, pose, o = {}) {
  const rm = roleMap(layer.char);
  const ease0 = o.ease || 'easeInOut';
  for (const role of ALL_ROLES) {
    const b = rm[role]; if (!b) continue;
    const p = pose[role] || {};
    for (const prop of ['r', 'x', 'y', 'sx', 'sy']) {
      const name = `b.${b.id}.${PROP_MAP[prop]}`;
      const dv = prop === 'sx' || prop === 'sy' ? 1 : 0;
      const v = p[prop] !== undefined ? p[prop] : dv;
      const tr = (layer.tracks[name] = layer.tracks[name] || []);
      if (!tr.length && f > 0 && o.anchor0 !== false) setKey(tr, 0, layerBase(layer, name), ease0);
      setKey(tr, f, v, ease0);
    }
  }
  if (pose._ && o.layerLevel) {
    const cH = charHeight(layer);
    if ('dy' in pose._) { const tr = (layer.tracks.y = layer.tracks.y || []); if (!tr.length && f > 0) setKey(tr, 0, layerBase(layer, 'y'), ease0); setKey(tr, f, (o.y0 ?? layerProp(layer, 'y', f)) + pose._.dy * cH, ease0); }
    if ('rot' in pose._) { const tr = (layer.tracks.rotation = layer.tracks.rotation || []); if (!tr.length && f > 0) setKey(tr, 0, layerBase(layer, 'rotation'), ease0); setKey(tr, f, pose._.rot, ease0); }
  }
}
/** Read the current pose of a character at frame f as a pose object (role → {r,x,y,sx,sy}). */
export function readPoseAt(layer, f) {
  const out = {};
  for (const b of layer.char.bones) {
    if (!b.role) continue;
    const g = (p) => layerProp(layer, `b.${b.id}.${p}`, f);
    out[b.role] = { r: g('rot'), x: g('x'), y: g('y'), sx: g('sx'), sy: g('sy') };
  }
  return out;
}
export function samplePose(a, b, t, e = 'easeInOut', over = 0) {
  const tt = ease(t, e);
  const out = {};
  const roles = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const r of roles) {
    if (r === '_') continue;
    const pa = a[r] || {}, pb = b[r] || {}; const o = {};
    for (const p of ['r', 'x', 'y', 'sx', 'sy']) {
      const dv = p === 'sx' || p === 'sy' ? 1 : 0; const va = pa[p] ?? dv, vb = pb[p] ?? dv;
      o[p] = lerp(va, vb, tt) + (p === 'r' ? over * Math.sin(Math.PI * t) * (vb - va) : 0);
    }
    out[r] = o;
  }
  return out;
}
/** Generate Motion: poseA at f0 → poseB at f1 with generated in-between keys (every `step` frames), staggered follow-through. */
export function generateMotion(layer, poseA, poseB, f0, f1, o = {}) {
  const step = Math.max(1, o.step || Math.max(1, Math.round((f1 - f0) / 8)));
  const e = o.ease || 'easeInOut';
  const stagger = o.followThrough ?? 0.12; // fraction of duration by which extremities lag
  const depth = (role) => (/hand|foot/.test(role) ? 2 : /foreArm|shin|head|hair/.test(role) ? 1 : 0);
  const frames = []; for (let f = f0; f < f1; f += step) frames.push(f); frames.push(f1);
  for (const f of frames) {
    const t = (f - f0) / Math.max(1, f1 - f0);
    const pose = {};
    for (const r of new Set([...Object.keys(poseA), ...Object.keys(poseB)])) {
      if (r === '_') continue;
      const lag = clamp(t - stagger * depth(r) * 0.5 * (1 - t) , 0, 1);
      const s = samplePose({ [r]: poseA[r] || {} }, { [r]: poseB[r] || {} }, f === f1 ? 1 : (f === f0 ? 0 : lag), e, o.overshoot || 0);
      pose[r] = s[r];
    }
    setPoseAt(layer, f, pose, { ease: 'easeInOut', anchor0: false });
  }
  return frames;
}
