// Character construction: humanoid rig builder, built-in starter characters, auto-rig from a single image,
// multi-part import by filename, PSD import, and procedural mouth shapes.
import { uid, mkCanvas, clamp, DEG } from './util.js';
import { S } from './state.js';
import { addCanvasAsset, newLayer } from './model.js';
import { VISEMES } from './rig.js';

export const ROLES = [
  ['root', 'Root'], ['body', 'Body'], ['head', 'Head'], ['hair', 'Hair'], ['eyes', 'Eyes'], ['mouth', 'Mouth'],
  ['upperArmL', 'Left Arm'], ['foreArmL', 'Left Forearm'], ['handL', 'Left Hand'], ['upperArmR', 'Right Arm'], ['foreArmR', 'Right Forearm'], ['handR', 'Right Hand'],
  ['thighL', 'Left Leg'], ['shinL', 'Left Shin'], ['footL', 'Left Foot'], ['thighR', 'Right Leg'], ['shinR', 'Right Shin'], ['footR', 'Right Foot'],
];
export const roleLabel = (r) => (ROLES.find((x) => x[0] === r) || [0, r])[1];
const PARENT_PREF = {
  body: ['root'], head: ['body', 'root'], hair: ['head', 'body'], eyes: ['head', 'body'], mouth: ['head', 'body'],
  upperArmL: ['body', 'root'], foreArmL: ['upperArmL', 'body'], handL: ['foreArmL', 'upperArmL', 'body'],
  upperArmR: ['body', 'root'], foreArmR: ['upperArmR', 'body'], handR: ['foreArmR', 'upperArmR', 'body'],
  thighL: ['root'], shinL: ['thighL', 'root'], footL: ['shinL', 'thighL', 'root'],
  thighR: ['root'], shinR: ['thighR', 'root'], footR: ['shinR', 'thighR', 'root'],
};
const Z = { thighL: 10, shinL: 11, footL: 12, thighR: 10, shinR: 11, footR: 12, body: 20, upperArmL: 24, foreArmL: 25, handL: 26, upperArmR: 24, foreArmR: 25, handR: 26, head: 30, eyes: 34, mouth: 35, hair: 40 };

/** parts: { role: { assetId, x, y, w, h } }  (rest placement in character space) */
export function buildHumanoid(parts, pelvis) {
  const have = (r) => !!parts[r];
  const bones = [];
  const P = pelvis || (have('body') ? [parts.body.x + parts.body.w / 2, parts.body.y + parts.body.h * 0.92] : [0, 0]);
  const byRole = {};
  const mk = (role, props) => { const b = { id: uid('bn'), role, name: roleLabel(role), parent: null, hx: 0, hy: 0, len: 30, a0: 90, min: null, max: null, ik: null, z: Z[role] || 20, img: null, visemes: null, ...props }; bones.push(b); byRole[role] = b; return b; };
  mk('root', { name: 'Root', hx: P[0], hy: P[1], len: 20, a0: -90 });
  const J = (role) => {
    const p = parts[role]; const cx = p.x + p.w / 2;
    switch (role) {
      case 'body': return { hx: P[0], hy: P[1], len: p.h * 0.9, a0: -90 };
      case 'head': return { hx: cx, hy: p.y + p.h * 0.93, len: p.h * 0.9, a0: -90 };
      case 'hair': case 'eyes': case 'mouth': { const h = parts.head; return h ? { hx: h.x + h.w / 2, hy: h.y + h.h * 0.93, len: h.h * 0.5, a0: -90 } : { hx: cx, hy: p.y + p.h, len: p.h, a0: -90 }; }
      case 'foot': default: break;
    }
    const top = p.y + Math.min(p.h * 0.1, 14);
    if (/^foot/.test(role)) return { hx: cx - p.w * 0.1, hy: p.y + p.h * 0.18, len: p.h * 0.5, a0: 90 };
    return { hx: cx, hy: top, len: p.h - (top - p.y), a0: 90 };
  };
  for (const role of ['body', 'head', 'hair', 'eyes', 'mouth', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']) {
    if (!have(role)) continue;
    const j = J(role);
    const b = mk(role, { ...j, img: { assetId: parts[role].assetId, x: parts[role].x, y: parts[role].y, w: parts[role].w, h: parts[role].h } });
    if (parts[role].visemes) b.visemes = parts[role].visemes;
    if (/^(eyes|mouth|hair)$/.test(role)) b.len = Math.max(10, b.len * 0.3);
    const pref = PARENT_PREF[role].find((r) => byRole[r]) || 'root';
    b.parent = byRole[pref].id;
  }
  // chain lengths: point each limb bone at the next joint
  const chain = [['upperArmL', 'foreArmL', 'handL'], ['upperArmR', 'foreArmR', 'handR'], ['thighL', 'shinL', 'footL'], ['thighR', 'shinR', 'footR']];
  for (const c of chain) for (let i = 0; i < c.length - 1; i++) {
    const a = byRole[c[i]], n = byRole[c[i + 1]]; if (!a || !n) continue;
    const dx = n.hx - a.hx, dy = n.hy - a.hy; a.len = Math.hypot(dx, dy) || a.len; a.a0 = Math.atan2(dy, dx) / DEG;
  }
  return { bones, pool: [] };
}

export function makeCharacterLayer(char, name, pelvis, scale = 1, pos) {
  const l = newLayer('character', name || 'Character');
  l.char = char; l.cat = 'character';
  const px = pelvis ? pelvis[0] : 0, py = pelvis ? pelvis[1] : 0;
  l.pivot = { x: px, y: py };
  const P = S.project;
  const at = pos || [P.width / 2, P.height * 0.72];
  l.base.x = at[0]; l.base.y = at[1]; l.base.scaleX = scale; l.base.scaleY = scale;
  return l;
}

// ─────────────── procedural mouth shapes ───────────────
export function drawMouth(shape, color = '#7a2230', inner = '#3a0d17', size = 64) {
  const c = mkCanvas(size, size * 0.65); const g = c.getContext('2d');
  const cx = c.width / 2, cy = c.height / 2, u = size / 64;
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 3 * u; g.strokeStyle = '#2a1318';
  const blob = (rx, ry, fill = inner) => { g.beginPath(); g.ellipse(cx, cy, rx * u, ry * u, 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.stroke(); };
  const tongue = (rx, ry, oy = 0) => { g.save(); g.beginPath(); g.ellipse(cx, cy + oy * u, rx * u, ry * u, 0, 0, Math.PI * 2); g.clip(); g.fillStyle = '#e8707e'; g.beginPath(); g.ellipse(cx, cy + (oy + ry * 0.7) * u, rx * u, ry * u, 0, 0, Math.PI * 2); g.fill(); g.restore(); };
  switch (shape) {
    case 'rest': g.beginPath(); g.moveTo(cx - 12 * u, cy); g.quadraticCurveTo(cx, cy + 5 * u, cx + 12 * u, cy); g.stroke(); break;
    case 'A': blob(15, 11); tongue(10, 5, 2); break;
    case 'E': g.beginPath(); g.moveTo(cx - 18 * u, cy - 1 * u); g.quadraticCurveTo(cx, cy - 6 * u, cx + 18 * u, cy - 1 * u); g.quadraticCurveTo(cx, cy + 10 * u, cx - 18 * u, cy - 1 * u); g.fillStyle = inner; g.fill(); g.stroke(); g.fillStyle = '#fff'; g.fillRect(cx - 11 * u, cy - 3 * u, 22 * u, 3.5 * u); break;
    case 'I': g.beginPath(); g.moveTo(cx - 17 * u, cy); g.quadraticCurveTo(cx, cy - 4 * u, cx + 17 * u, cy); g.quadraticCurveTo(cx, cy + 6 * u, cx - 17 * u, cy); g.fillStyle = '#fff'; g.fill(); g.stroke(); g.beginPath(); g.moveTo(cx - 14 * u, cy + 0.5 * u); g.lineTo(cx + 14 * u, cy + 0.5 * u); g.lineWidth = 1.5 * u; g.stroke(); break;
    case 'O': blob(9, 11); tongue(6, 4, 3); break;
    case 'U': blob(6, 6); break;
    case 'M': g.beginPath(); g.moveTo(cx - 13 * u, cy); g.lineTo(cx + 13 * u, cy); g.lineWidth = 4.5 * u; g.stroke(); break;
    case 'F': g.beginPath(); g.moveTo(cx - 14 * u, cy - 3 * u); g.quadraticCurveTo(cx, cy - 6 * u, cx + 14 * u, cy - 3 * u); g.quadraticCurveTo(cx, cy + 9 * u, cx - 14 * u, cy - 3 * u); g.fillStyle = inner; g.fill(); g.stroke(); g.fillStyle = '#fff'; g.fillRect(cx - 9 * u, cy - 4 * u, 18 * u, 4.5 * u); g.beginPath(); g.moveTo(cx - 9 * u, cy + 2 * u); g.quadraticCurveTo(cx, cy + 5 * u, cx + 9 * u, cy + 2 * u); g.strokeStyle = '#d96a7a'; g.lineWidth = 3 * u; g.stroke(); break;
    case 'L': blob(12, 8); g.fillStyle = '#e8707e'; g.beginPath(); g.ellipse(cx, cy - 3 * u, 5 * u, 3 * u, 0, 0, Math.PI * 2); g.fill(); break;
    default: break;
  }
  return c;
}
/** Creates the 9 mouth shape assets; returns { visemes:{shape: assetId}, w, h } */
export function makeMouthSet(size = 64, tag = '') {
  const visemes = {}; let w = 0, h = 0;
  for (const v of VISEMES) { const c = drawMouth(v, undefined, undefined, size); const a = addCanvasAsset(c, `Mouth ${v}${tag}`, { hidden: true, group: 'mouth' }); visemes[v] = a.id; w = c.width; h = c.height; }
  return { visemes, w, h };
}

// ─────────────── starter characters ───────────────
function pathCapsule(g, x1, y1, x2, y2, r) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.beginPath(); g.arc(x1, y1, r, a + Math.PI / 2, a + Math.PI * 1.5); g.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2); g.closePath();
}
export const STARTER_STYLES = {
  cartoon: { label: 'Cartoon', skin: '#f4c7a1', shirt: '#4f8cff', pants: '#2f3a52', shoes: '#1f2430', hair: '#6a3f2a', line: '#1b1f2a' },
  anime: { label: 'Anime', skin: '#ffe0cf', shirt: '#e8466f', pants: '#2b2d4a', shoes: '#ffffff', hair: '#2e2a63', line: '#241c33' },
  stick: { label: 'Stick Figure', stick: true, line: '#14161c', skin: '#ffffff' },
  robot: { label: 'Robot', skin: '#cfd8e6', shirt: '#7c8aa3', pants: '#566178', shoes: '#2a2f3b', hair: '#ffb703', line: '#202636' },
};
/** Draw the starter parts. Pelvis is the origin (0,0); returns { role: {canvas, x, y} } in pelvis-relative px (unscaled). */
function drawStarter(style) {
  const st = STARTER_STYLES[style] || STARTER_STYLES.cartoon;
  const parts = {};
  const LW = st.stick ? 7 : 4;
  const part = (role, x, y, w, h, draw) => {
    const m = LW + 4; const c = mkCanvas(Math.ceil(w + m * 2), Math.ceil(h + m * 2)); const g = c.getContext('2d');
    g.translate(m - x, m - y); g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = LW; g.strokeStyle = st.line;
    draw(g); parts[role] = { canvas: c, x: x - m, y: y - m };
  };
  const fillStroke = (g, fill) => { if (!st.stick) { g.fillStyle = fill; g.fill(); } g.stroke(); };
  const limb = (role, x1, y1, x2, y2, rw, fill) => part(role, Math.min(x1, x2) - rw, Math.min(y1, y2) - rw, Math.abs(x2 - x1) + rw * 2, Math.abs(y2 - y1) + rw * 2, (g) => {
    if (st.stick) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); } else { pathCapsule(g, x1, y1, x2, y2, rw); fillStroke(g, fill); }
  });
  // body
  part('body', -56, -160, 112, 180, (g) => {
    g.beginPath();
    if (st.stick) { g.moveTo(0, -150); g.lineTo(0, 0); g.stroke(); return; }
    g.moveTo(-44, -150); g.quadraticCurveTo(0, -164, 44, -150); g.lineTo(54, 14); g.quadraticCurveTo(0, 26, -54, 14); g.closePath(); fillStroke(g, st.shirt);
    g.beginPath(); g.moveTo(-53, 0); g.quadraticCurveTo(0, 12, 53, 0); g.lineWidth = 6; g.strokeStyle = st.pants; g.stroke();
  });
  const L = [1, -1]; // L = character's left = screen right (+x)
  const sfx = ['L', 'R'];
  L.forEach((sd, i) => {
    const s = sfx[i];
    limb('upperArm' + s, sd * 66, -130, sd * 74, -62, 13, st.shirt);
    limb('foreArm' + s, sd * 74, -62, sd * 78, 4, 11, st.skin);
    part('hand' + s, sd * 79 - 16, 0, 32, 32, (g) => { g.beginPath(); g.arc(sd * 79, 16, st.stick ? 5 : 15, 0, Math.PI * 2); fillStroke(g, st.skin); });
    limb('thigh' + s, sd * 28, 2, sd * 28, 92, 17, st.pants);
    limb('shin' + s, sd * 28, 92, sd * 28, 182, 14, st.pants);
    part('foot' + s, sd * 28 - 18, 170, 62, 34, (g) => {
      g.beginPath();
      if (st.stick) { g.moveTo(sd * 28, 184); g.lineTo(sd * 28 + 24, 190); g.stroke(); return; }
      g.moveTo(sd * 28 - 14, 172); g.lineTo(sd * 28 + 14, 172); g.quadraticCurveTo(sd * 28 + 26, 182, sd * 28 + 36, 190); g.quadraticCurveTo(sd * 28 + 40, 202, sd * 28 + 28, 202); g.lineTo(sd * 28 - 14, 202); g.quadraticCurveTo(sd * 28 - 20, 188, sd * 28 - 14, 172); g.closePath(); fillStroke(g, st.shoes);
    });
  });
  // head
  part('head', -70, -300, 140, 150, (g) => {
    if (st.stick) { g.beginPath(); g.arc(0, -214, 48, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.stroke(); g.beginPath(); g.moveTo(0, -166); g.lineTo(0, -148); g.stroke(); return; }
    g.beginPath(); g.rect(-14, -172, 28, 28); fillStroke(g, st.skin);
    g.beginPath(); g.ellipse(-62, -212, 9, 16, 0, 0, Math.PI * 2); fillStroke(g, st.skin);
    g.beginPath(); g.ellipse(62, -212, 9, 16, 0, 0, Math.PI * 2); fillStroke(g, st.skin);
    g.beginPath(); g.ellipse(0, -214, 58, 60, 0, 0, Math.PI * 2); fillStroke(g, st.skin);
    if (style === 'anime') { g.fillStyle = 'rgba(255,120,140,.35)'; g.beginPath(); g.ellipse(-34, -196, 11, 6, 0, 0, Math.PI * 2); g.ellipse(34, -196, 11, 6, 0, 0, Math.PI * 2); g.fill(); }
    if (style === 'robot') { g.beginPath(); g.moveTo(0, -274); g.lineTo(0, -292); g.stroke(); g.beginPath(); g.arc(0, -294, 6, 0, Math.PI * 2); g.fillStyle = st.hair; g.fill(); g.stroke(); }
  });
  if (!st.stick && style !== 'robot') part('hair', -70, -300, 140, 100, (g) => {
    g.beginPath();
    if (style === 'anime') { g.moveTo(-64, -200); g.quadraticCurveTo(-76, -290, 0, -284); g.quadraticCurveTo(76, -290, 64, -200); g.lineTo(52, -232); g.lineTo(34, -214); g.lineTo(14, -240); g.lineTo(-10, -216); g.lineTo(-34, -236); g.lineTo(-52, -214); g.closePath(); }
    else { g.moveTo(-60, -214); g.quadraticCurveTo(-72, -290, 0, -282); g.quadraticCurveTo(72, -290, 60, -214); g.quadraticCurveTo(40, -250, 0, -244); g.quadraticCurveTo(-40, -250, -60, -214); g.closePath(); }
    fillStroke(g, st.hair);
  });
  const eyeSep = style === 'anime' ? 25 : 23;
  part('eyes', -50, -236, 100, 40, (g) => {
    for (const sx of [-1, 1]) {
      if (st.stick) { g.beginPath(); g.arc(sx * 17, -218, 3.5, 0, Math.PI * 2); g.fillStyle = st.line; g.fill(); continue; }
      const ex = sx * eyeSep, ey = -216;
      g.lineWidth = 3; g.beginPath(); g.ellipse(ex, ey, style === 'anime' ? 11 : 10, style === 'anime' ? 15 : 13, 0, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.stroke();
      g.beginPath(); g.ellipse(ex + 2, ey + 2, style === 'anime' ? 7.5 : 5.5, style === 'anime' ? 10 : 7, 0, 0, Math.PI * 2); g.fillStyle = style === 'anime' ? '#6a5acd' : style === 'robot' ? '#00d4ff' : '#222'; g.fill();
      g.beginPath(); g.arc(ex + 4, ey - 2, 2.4, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    }
  });
  return parts;
}

/** Create a fully rigged starter character layer in the active project. */
export function createStarterCharacter(style = 'cartoon', opts = {}) {
  const P = S.project;
  const parts = drawStarter(style);
  const sc = (P.height / 720) * 0.82;
  const out = {};
  const mkAsset = (role, d) => {
    let c = d.canvas, x = d.x, y = d.y;
    const a = addCanvasAsset(c, `${style} ${roleLabel(role)}`, { hidden: true, group: 'char' });
    out[role] = { assetId: a.id, x, y, w: c.width, h: c.height };
  };
  for (const [role, d] of Object.entries(parts)) mkAsset(role, d);
  // mouth
  const ms = makeMouthSet(64, ' ' + style);
  out.mouth = { assetId: ms.visemes.rest, x: -ms.w / 2, y: -202, w: ms.w, h: ms.h, visemes: ms.visemes };
  const char = buildHumanoid(out, [0, 0]);
  // elbows/knees get sensible rotation ranges only when asked
  const l = makeCharacterLayer(char, opts.name || (STARTER_STYLES[style].label + ' Character'), [0, 0], sc, opts.pos);
  return l;
}

// ─────────────── name → role matching ───────────────
export function matchRole(name) {
  const n = name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[\s\-.]+/g, '_');
  const side = /(^|_)(l|left)(_|$)|left/.test(n) ? 'L' : /(^|_)(r|right)(_|$)|right/.test(n) ? 'R' : '';
  const has = (re) => re.test(n);
  if (has(/hair/)) return 'hair';
  if (has(/eye/)) return 'eyes';
  if (has(/mouth|lips?/)) return 'mouth';
  if (has(/head|face/)) return 'head';
  if (has(/forearm|lower_?arm|elbow/)) return side ? 'foreArm' + side : null;
  if (has(/hand|palm|fist/)) return side ? 'hand' + side : null;
  if (has(/upper_?arm|arm|shoulder/)) return side ? 'upperArm' + side : null;
  if (has(/shin|calf|lower_?leg|knee/)) return side ? 'shin' + side : null;
  if (has(/foot|feet|shoe|boot/)) return side ? 'foot' + side : null;
  if (has(/thigh|upper_?leg|leg/)) return side ? 'thigh' + side : null;
  if (has(/body|torso|chest|trunk|shirt|dress/)) return 'body';
  return null;
}

/** Assemble loose part images (no positions) around a body image. items: [{role, canvas}] */
export function assembleParts(items) {
  const by = {}; items.forEach((it) => { by[it.role] = it; });
  const out = {};
  const sz = (r) => (by[r] ? [by[r].canvas.width, by[r].canvas.height] : [0, 0]);
  const put = (r, x, y) => { if (!by[r]) return; const [w, h] = sz(r); out[r] = { canvas: by[r].canvas, x, y, w, h }; };
  const bodyRef = by.body ? sz('body') : (by.head ? [sz('head')[0] * 1.2, sz('head')[1] * 1.3] : [200, 260]);
  const [bw, bh] = bodyRef;
  put('body', -bw / 2, -bh * 0.92);
  const top = -bh * 0.92;
  if (by.head) { const [w, h] = sz('head'); put('head', -w / 2, top - h * 0.9); }
  const hd = out.head || { x: -50, y: top - 120, w: 100, h: 120 };
  if (by.hair) { const [w, h] = sz('hair'); put('hair', hd.x + hd.w / 2 - w / 2, hd.y - h * 0.05); }
  if (by.eyes) { const [w, h] = sz('eyes'); put('eyes', hd.x + hd.w / 2 - w / 2, hd.y + hd.h * 0.42 - h / 2); }
  if (by.mouth) { const [w, h] = sz('mouth'); put('mouth', hd.x + hd.w / 2 - w / 2, hd.y + hd.h * 0.72 - h / 2); }
  for (const [s, sd] of [['L', 1], ['R', -1]]) {
    let y = top + bh * 0.05; const x0 = sd * (bw / 2 + 4);
    if (by['upperArm' + s]) { const [w, h] = sz('upperArm' + s); put('upperArm' + s, sd > 0 ? x0 - w * 0.3 : x0 - w * 0.7, y); y += h * 0.92; }
    const ax = out['upperArm' + s] ? out['upperArm' + s].x + out['upperArm' + s].w / 2 : x0;
    if (by['foreArm' + s]) { const [w, h] = sz('foreArm' + s); put('foreArm' + s, ax - w / 2, y); y += h * 0.92; }
    const fx = out['foreArm' + s] ? out['foreArm' + s].x + out['foreArm' + s].w / 2 : ax;
    if (by['hand' + s]) { const [w] = sz('hand' + s); put('hand' + s, fx - w / 2, y - 4); }
    let ly = -bh * 0.02; const lx = sd * bw * 0.22;
    if (by['thigh' + s]) { const [w, h] = sz('thigh' + s); put('thigh' + s, lx - w / 2, ly); ly += h * 0.92; }
    if (by['shin' + s]) { const [w, h] = sz('shin' + s); put('shin' + s, lx - w / 2, ly); ly += h * 0.92; }
    if (by['foot' + s]) { const [w, h] = sz('foot' + s); put('foot' + s, lx - w * 0.35, ly - h * 0.1); }
  }
  return out;
}

// ─────────────── auto rig from a single image ───────────────
export function analyzeSilhouette(src, maxDim = 320) {
  const W0 = src.width || src.naturalWidth, H0 = src.height || src.naturalHeight;
  const k = Math.min(1, maxDim / Math.max(W0, H0));
  const w = Math.max(1, Math.round(W0 * k)), h = Math.max(1, Math.round(H0 * k));
  const c = mkCanvas(w, h); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const op = new Uint8Array(w * h);
  // if image is fully opaque, treat near-border colour as background
  let anyTransparent = false; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { anyTransparent = true; break; }
  const bgc = [d[0], d[1], d[2]];
  for (let i = 0; i < w * h; i++) op[i] = anyTransparent ? (d[i * 4 + 3] > 24 ? 1 : 0) : (Math.abs(d[i * 4] - bgc[0]) + Math.abs(d[i * 4 + 1] - bgc[1]) + Math.abs(d[i * 4 + 2] - bgc[2]) > 60 ? 1 : 0);
  return { w, h, k, op, W0, H0, hadAlpha: anyTransparent };
}
function bboxOf(a, x0 = 0, y0 = 0, x1 = a.w, y1 = a.h) {
  let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (a.op[y * a.w + x]) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  return maxx < 0 ? null : { x0: minx, y0: miny, x1: maxx + 1, y1: maxy + 1 };
}
/** Heuristic humanoid segmentation. Returns region rectangles in source-image pixels. */
export function segmentHumanoid(src) {
  const a = analyzeSilhouette(src);
  const bb = bboxOf(a);
  if (!bb) throw new Error('The image looks empty — no visible pixels found.');
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
  const rowW = (y, x0 = bb.x0, x1 = bb.x1) => { let n = 0; for (let x = x0; x < x1; x++) n += a.op[y * a.w + x]; return n; };
  // neck: narrowest row between 14% and 34% of the height
  let neckY = Math.round(bb.y0 + bh * 0.26), best = 1e9;
  for (let y = Math.round(bb.y0 + bh * 0.14); y <= Math.round(bb.y0 + bh * 0.34); y++) { const r = rowW(y); if (r > 0 && r < best) { best = r; neckY = y; } }
  // crotch: scanning upward from the bottom, first row where the centre column is solid
  const cx = Math.round((bb.x0 + bb.x1) / 2); let crotchY = Math.round(bb.y0 + bh * 0.58);
  const midBand = Math.max(2, Math.round(bw * 0.04));
  let found = false;
  for (let y = bb.y1 - 1; y > bb.y0 + bh * 0.4; y--) {
    let solid = 0; for (let x = cx - midBand; x <= cx + midBand; x++) solid += a.op[y * a.w + x];
    if (solid >= midBand * 2) { crotchY = y; found = true; break; }
  }
  if (!found) crotchY = Math.round(bb.y0 + bh * 0.62);
  crotchY = clamp(crotchY, Math.round(bb.y0 + bh * 0.45), Math.round(bb.y0 + bh * 0.72));
  // arms: column minimum in the torso band
  const colCount = (x) => { let n = 0; for (let y = neckY; y < crotchY; y++) n += a.op[y * a.w + x]; return n; };
  const argmin = (lo, hi) => { let bx = lo, bv = 1e9; for (let x = lo; x <= hi; x++) { const v = colCount(x); if (v < bv) { bv = v; bx = x; } } return bx; };
  const lx = argmin(Math.round(bb.x0 + bw * 0.14), Math.round(bb.x0 + bw * 0.34));
  const rx = argmin(Math.round(bb.x0 + bw * 0.66), Math.round(bb.x0 + bw * 0.86));
  const k = 1 / a.k;
  const sc = (v) => Math.round(v * k);
  const legMid = Math.round(cx);
  const R = (x0, y0, x1, y1) => ({ x: sc(x0), y: sc(y0), w: Math.max(2, sc(x1 - x0)), h: Math.max(2, sc(y1 - y0)) });
  const armBottom = Math.round(crotchY + (bb.y1 - crotchY) * 0.06);
  return {
    scale: k, bbox: R(bb.x0, bb.y0, bb.x1, bb.y1), hadAlpha: a.hadAlpha,
    head: R(bb.x0, bb.y0, bb.x1, neckY),
    body: R(lx, neckY, rx, crotchY),
    armR: R(bb.x0, neckY, lx, armBottom), armL: R(rx, neckY, bb.x1, armBottom),
    legR: R(bb.x0, crotchY, legMid, bb.y1), legL: R(legMid, crotchY, bb.x1, bb.y1),
  };
}
function cropRegion(src, r, trim = true) {
  const c = mkCanvas(r.w, r.h); const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  if (!trim) return { canvas: c, x: r.x, y: r.y };
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const t = mkCanvas(x1 - x0 + 1, y1 - y0 + 1); t.getContext('2d').drawImage(c, -x0, -y0);
  return { canvas: t, x: r.x + x0, y: r.y + y0 };
}
function removeBackground(img) {
  // flood-fill from the corners for opaque images
  const c = mkCanvas(img.width || img.naturalWidth, img.height || img.naturalHeight); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height); const d = id.data; const w = c.width, h = c.height;
  const bg = [d[0], d[1], d[2]]; const seen = new Uint8Array(w * h); const st = [0, w - 1, (h - 1) * w, h * w - 1];
  const near = (i) => Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]) < 54;
  while (st.length) { const i = st.pop(); if (seen[i] || !near(i)) continue; seen[i] = 1; d[i * 4 + 3] = 0; const x = i % w, y = (i / w) | 0; if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (y > 0) st.push(i - w); if (y < h - 1) st.push(i + w); }
  g.putImageData(id, 0, 0); return c;
}

/** Auto Rig: single character image → rigged character layer. */
export function autoRigImage(imgIn, opts = {}) {
  const P = S.project;
  let img = imgIn;
  const sil0 = analyzeSilhouette(imgIn);
  if (!sil0.hadAlpha) img = removeBackground(imgIn);
  const seg = segmentHumanoid(img);
  const split = opts.splitLimbs !== false;
  const parts = {};
  const add = (role, region) => {
    const cr = cropRegion(img, region); if (!cr) return;
    parts[role] = { canvas: cr.canvas, x: cr.x, y: cr.y };
  };
  add('head', seg.head); add('body', seg.body);
  const limb = (role1, role2, role3, r, horizontalHand) => {
    if (split) {
      const h1 = Math.round(r.h * 0.46), h2 = Math.round(r.h * 0.38);
      add(role1, { x: r.x, y: r.y, w: r.w, h: h1 });
      add(role2, { x: r.x, y: r.y + h1, w: r.w, h: h2 });
      if (role3) add(role3, { x: r.x, y: r.y + h1 + h2, w: r.w, h: r.h - h1 - h2 });
    } else add(role1, r);
  };
  limb('upperArmL', 'foreArmL', 'handL', seg.armL);
  limb('upperArmR', 'foreArmR', 'handR', seg.armR);
  const legSplit = (r1, r2, r3, r) => {
    if (split) {
      const h1 = Math.round(r.h * 0.48), h2 = Math.round(r.h * 0.38);
      add(r1, { x: r.x, y: r.y, w: r.w, h: h1 }); add(r2, { x: r.x, y: r.y + h1, w: r.w, h: h2 }); add(r3, { x: r.x, y: r.y + h1 + h2, w: r.w, h: r.h - h1 - h2 });
    } else add(r1, r);
  };
  legSplit('thighL', 'shinL', 'footL', seg.legL);
  legSplit('thighR', 'shinR', 'footR', seg.legR);
  const placed = {};
  for (const [role, p] of Object.entries(parts)) {
    const a = addCanvasAsset(p.canvas, `${roleLabel(role)}`, { hidden: true, group: 'char' });
    placed[role] = { assetId: a.id, x: p.x, y: p.y, w: p.canvas.width, h: p.canvas.height };
  }
  if (opts.mouth !== false && placed.head) {
    const hd = placed.head; const ms = clamp(hd.w * 0.28, 24, 160);
    const set = makeMouthSet(Math.round(ms), ' (auto)');
    placed.mouth = { assetId: set.visemes.rest, x: hd.x + hd.w / 2 - set.w / 2, y: hd.y + hd.h * 0.7 - set.h / 2, w: set.w, h: set.h, visemes: set.visemes };
  }
  const pelvis = [seg.body.x + seg.body.w / 2, seg.body.y + seg.body.h * 0.96];
  const char = buildHumanoid(placed, pelvis);
  const fitS = Math.min(2, (P.height * 0.7) / seg.bbox.h);
  const l = makeCharacterLayer(char, opts.name || 'Auto-Rigged Character', pelvis, fitS);
  // put feet on the ground line (72% of height)
  const sc = l.base.scaleX; const footY = seg.bbox.y + seg.bbox.h;
  l.base.y = P.height * 0.92 - (footY - pelvis[1]) * sc;
  l.base.x = P.width / 2;
  return { layer: l, detected: Object.keys(parts).length, regions: seg };
}

/** Multi-image import: [{name, canvas, x?, y?}] → character (positions kept when provided, else assembled). */
export function importPartsAsCharacter(items, opts = {}) {
  const P = S.project;
  const mapped = []; const extras = [];
  for (const it of items) { const role = matchRole(it.name); if (role && !mapped.some((m) => m.role === role)) mapped.push({ ...it, role }); else extras.push(it); }
  if (!mapped.length) return null;
  const havePos = mapped.every((m) => typeof m.x === 'number');
  let layout;
  if (havePos) { layout = {}; mapped.forEach((m) => { layout[m.role] = { canvas: m.canvas, x: m.x, y: m.y, w: m.canvas.width, h: m.canvas.height }; }); }
  else layout = assembleParts(mapped);
  const placed = {};
  for (const [role, p] of Object.entries(layout)) {
    const a = addCanvasAsset(p.canvas, roleLabel(role), { hidden: true, group: 'char' });
    placed[role] = { assetId: a.id, x: p.x, y: p.y, w: p.w, h: p.h };
  }
  if (!placed.mouth && opts.mouth !== false && placed.head) {
    const hd = placed.head; const set = makeMouthSet(Math.round(clamp(hd.w * 0.28, 24, 160)), ' (auto)');
    placed.mouth = { assetId: set.visemes.rest, x: hd.x + hd.w / 2 - set.w / 2, y: hd.y + hd.h * 0.72 - set.h / 2, w: set.w, h: set.h, visemes: set.visemes };
  }
  const bodyP = placed.body;
  const pelvis = bodyP ? [bodyP.x + bodyP.w / 2, bodyP.y + bodyP.h * 0.92] : [0, 0];
  const char = buildHumanoid(placed, pelvis);
  // extras: attach to body as free parts
  const rootB = char.bones.find((b) => b.role === 'body') || char.bones[0];
  extras.forEach((it, i) => {
    const a = addCanvasAsset(it.canvas, it.name, { hidden: true, group: 'char' });
    const x = typeof it.x === 'number' ? it.x : pelvis[0] - it.canvas.width / 2, y = typeof it.y === 'number' ? it.y : pelvis[1] - it.canvas.height * 1.2;
    char.bones.push({ id: uid('bn'), role: 'extra', name: it.name.replace(/\.[^.]+$/, ''), parent: rootB.id, hx: x + it.canvas.width / 2, hy: y + it.canvas.height / 2, len: 20, a0: 90, min: null, max: null, ik: null, z: 50 + i, img: { assetId: a.id, x, y, w: it.canvas.width, h: it.canvas.height }, visemes: null });
  });
  // fit scale
  let minY = 1e9, maxY = -1e9; for (const b of char.bones) if (b.img) { minY = Math.min(minY, b.img.y); maxY = Math.max(maxY, b.img.y + b.img.h); }
  const fit = Math.min(2, (P.height * 0.7) / (maxY - minY));
  const l = makeCharacterLayer(char, opts.name || 'Character', pelvis, fit);
  l.base.x = P.width / 2; l.base.y = P.height * 0.92 - (maxY - pelvis[1]) * fit;
  return l;
}
