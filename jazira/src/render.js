// الرسم: أطلس الرسومات + رسم العالم — render.js
import { TILE, T, KIND_DEF } from './world.js';
import { clamp, TAU, nightAmount, sunsetAmount, smoothstep } from './util.js';
import { hourOf } from './entities.js';

// ============================================================
//  الأطلس — كل الرسومات مرسومة بالكود (بلا صور خارجية)
// ============================================================
const CELL = 256;
const SPRITES = [
  'palm1', 'palm2', 'tree1', 'tree1r', 'tree2', 'tree2r',
  'bush', 'bushBerry', 'tuft', 'flowerA', 'flowerB', 'rockA',
  'rockB', 'pebble', 'reeds', 'campfire', 'hut', 'coop',
  'bench', 'egg', 'sprout', 'logPile',
];
export const SPRITE_W = {
  palm1: 122, palm2: 122, tree1: 142, tree1r: 142, tree2: 106, tree2r: 106,
  bush: 56, bushBerry: 56, tuft: 42, flowerA: 24, flowerB: 24, rockA: 58,
  rockB: 52, pebble: 26, reeds: 48, campfire: 58, hut: 152, coop: 106,
  bench: 76, egg: 20, sprout: 24, logPile: 56,
};

export const atlas = { canvas: null, ctx: null, entries: {} };

export function buildAtlas() {
  const cols = 5;
  const rows = Math.ceil(SPRITES.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * CELL; c.height = rows * CELL;
  const ctx = c.getContext('2d');
  SPRITES.forEach((name, i) => {
    const cx = (i % cols) * CELL, cy = Math.floor(i / cols) * CELL;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath(); ctx.rect(0, 0, CELL, CELL); ctx.clip();
    drawSpriteArt(ctx, name);
    ctx.restore();
    const e = trimBox(ctx, cx, cy);
    atlas.entries[name] = { ...e, w: SPRITE_W[name] };
  });
  atlas.canvas = c; atlas.ctx = ctx;
  return atlas;
}

function trimBox(ctx, ox, oy) {
  const img = ctx.getImageData(ox, oy, CELL, CELL).data;
  let x0 = CELL, y0 = CELL, x1 = -1, y1 = -1;
  for (let y = 0; y < CELL; y++)
    for (let x = 0; x < CELL; x++) {
      if (img[(y * CELL + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) return { sx: ox, sy: oy, sw: 4, sh: 4, gx: 0, gy: 4 };
  return { sx: ox + x0, sy: oy + y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1, gx: (x0 + x1) / 2, gy: y1 + 1 };
}

// ---- رسم الرموز (كل الرسم داخل خلية 256×256، الأرض عند y=250) ----
function drawSpriteArt(ctx, name) {
  const g = 250;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  switch (name) {
    case 'palm1': palm(ctx, g, 1, '#3f9b46', '#2f7a3a'); break;
    case 'palm2': palm(ctx, g, -1, '#4aa84f', '#2d7334'); break;
    case 'tree1': broadTree(ctx, g, false, '#3f8f45'); break;
    case 'tree1r': broadTree(ctx, g, true, '#3a8741'); break;
    case 'tree2': pine(ctx, g, false); break;
    case 'tree2r': pine(ctx, g, true); break;
    case 'bush': bush(ctx, g, false); break;
    case 'bushBerry': bush(ctx, g, true); break;
    case 'tuft': tuft(ctx, g); break;
    case 'flowerA': flower(ctx, g, '#f8668d', '#ffd75e'); break;
    case 'flowerB': flower(ctx, g, '#fdf6e3', '#f9c74f'); break;
    case 'rockA': rock(ctx, g, 78, 58); break;
    case 'rockB': rock(ctx, g, 64, 44); break;
    case 'pebble': pebble(ctx, g); break;
    case 'reeds': reeds(ctx, g); break;
    case 'campfire': campfireBase(ctx, g); break;
    case 'hut': hut(ctx, g); break;
    case 'coop': coop(ctx, g); break;
    case 'bench': bench(ctx, g); break;
    case 'egg': egg(ctx, 128, g - 16, 26); break;
    case 'sprout': sprout(ctx, g); break;
    case 'logPile': logPile(ctx, g); break;
  }
}

function palm(ctx, g, lean, c1, c2) {
  ctx.save(); ctx.translate(128, g);
  // الجذع
  const topX = 16 * lean, topY = -122;
  ctx.strokeStyle = '#a1723f'; ctx.lineWidth = 15;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(4 * lean, -66, topX, topY); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,80,40,0.55)'; ctx.lineWidth = 2.4;
  for (let i = 1; i <= 7; i++) {
    const t = i / 8, x = 4 * lean * (1 - t) * 2 * t + topX * t * t, y = -122 * t;
    ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.stroke();
  }
  // السعف
  const leaves = 8;
  for (let i = 0; i < leaves; i++) {
    const a = -Math.PI + (i / (leaves - 1)) * Math.PI + 0.12 * Math.sin(i * 2.1) * lean;
    const len = 74 + 22 * Math.sin(i * 1.7 + 1);
    const droop = 0.35 + 0.35 * Math.abs(Math.cos(a));
    leafShape(ctx, topX, topY, a * 0.72 + (i - 3.5) * 0.10, len, 15, i % 2 ? c1 : c2, droop);
  }
  // جوز الهند
  ctx.fillStyle = '#6b4423';
  ctx.beginPath(); ctx.arc(topX - 9, topY + 12, 7.5, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(topX + 8, topY + 15, 7, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(topX - 11, topY + 9, 2.4, 0, TAU); ctx.fill();
  ctx.restore();
}

function leafShape(ctx, x, y, ang, len, w, color, droop) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.55, -w * (1 - droop * 0.5), len, w * droop * 1.4);
  ctx.quadraticCurveTo(len * 0.5, w * 0.55, 0, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,60,25,0.30)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(2, 1); ctx.quadraticCurveTo(len * 0.55, w * 0.1, len, w * droop * 1.3); ctx.stroke();
  ctx.restore();
}

function broadTree(ctx, g, resin, green) {
  ctx.save(); ctx.translate(128, g);
  ctx.fillStyle = '#8a5e34';
  ctx.beginPath();
  ctx.moveTo(-11, 0); ctx.lineTo(-7, -70); ctx.lineTo(7, -70); ctx.lineTo(11, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,30,0.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-6, -70); ctx.lineTo(-6, 0); ctx.moveTo(6, -70); ctx.lineTo(6, 0); ctx.stroke();
  if (resin) {
    ctx.fillStyle = '#e0a13c';
    for (const [px, py, r] of [[-4, -34, 6], [7, -22, 4.5], [-2, -12, 3.6]]) {
      ctx.beginPath(); ctx.moveTo(px, py - r); ctx.quadraticCurveTo(px + r, py + r, px, py + r * 1.5);
      ctx.quadraticCurveTo(px - r, py + r, px, py - r); ctx.fill();
    }
  }
  const blobs = [[0, -132, 60], [-46, -104, 44], [46, -104, 44], [-26, -152, 40], [30, -152, 40], [0, -170, 34]];
  ctx.fillStyle = 'rgba(20,60,30,0.55)';
  for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, TAU); ctx.fill(); }
  for (let i = 0; i < blobs.length; i++) {
    const [x, y, r] = blobs[i];
    ctx.fillStyle = i % 3 === 0 ? green : shade(green, i % 2 ? 12 : -10);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.42, 0, TAU); ctx.fill(); }
  ctx.restore();
}

function pine(ctx, g, resin) {
  ctx.save(); ctx.translate(128, g);
  ctx.fillStyle = '#7d5733'; ctx.fillRect(-9, -40, 18, 42);
  if (resin) {
    ctx.fillStyle = '#e0a13c';
    ctx.beginPath(); ctx.arc(-2, -22, 4.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -12, 3.4, 0, TAU); ctx.fill();
  }
  const layers = [[-30, -40, -112, 62], [-40, -108, -168, 50], [-46, -156, -206, 34]];
  for (const [bx, y0, y1, w] of layers) {
    ctx.fillStyle = '#2f6b3a';
    ctx.beginPath(); ctx.moveTo(bx - w, y1); ctx.lineTo(bx, y0); ctx.lineTo(bx + w, y1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.moveTo(bx - w, y1); ctx.lineTo(bx, y0); ctx.lineTo(bx + w * 0.1, y1); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function bush(ctx, g, berries) {
  ctx.save(); ctx.translate(128, g);
  const blobs = [[-14, -14, 17], [14, -13, 16], [0, -24, 20], [-2, -6, 15]];
  ctx.fillStyle = 'rgba(20,60,30,0.5)';
  for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x, y, r + 2, 0, TAU); ctx.fill(); }
  for (let i = 0; i < blobs.length; i++) {
    const [x, y, r] = blobs[i];
    ctx.fillStyle = i % 2 ? '#3f8f45' : '#4faa52';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  if (berries) {
    ctx.fillStyle = '#e0453f';
    for (const [x, y] of [[-12, -16], [10, -20], [2, -28], [16, -8]]) { ctx.beginPath(); ctx.arc(x, y, 3.4, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

function tuft(ctx, g) {
  ctx.save(); ctx.translate(128, g);
  ctx.strokeStyle = '#6fa844'; ctx.lineWidth = 3.4;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath(); ctx.moveTo(i * 3, 0);
    ctx.quadraticCurveTo(i * 5, -18, i * 9, -30 - Math.abs(i) * -2);
    ctx.stroke();
  }
  ctx.fillStyle = '#d9c56a';
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(i * 9, -32, 3.2, 5.5, i * 0.3, 0, TAU); ctx.fill(); }
  ctx.restore();
}

function flower(ctx, g, petal, center) {
  ctx.save(); ctx.translate(128, g - 16);
  ctx.strokeStyle = '#5c9a3f'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(0, -2); ctx.stroke();
  ctx.fillStyle = '#4f9a45';
  ctx.beginPath(); ctx.ellipse(-6, 8, 6, 3.4, -0.5, 0, TAU); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.fillStyle = petal;
    ctx.beginPath(); ctx.ellipse(Math.cos(a) * 7, Math.sin(a) * 7, 6.5, 6.5, 0, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
  ctx.restore();
}

function rock(ctx, g, w, h) {
  ctx.save(); ctx.translate(128, g);
  ctx.fillStyle = '#8b8f96';
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2 + 6, -h * 0.7); ctx.lineTo(-w * 0.15, -h);
  ctx.lineTo(w * 0.25, -h * 0.92); ctx.lineTo(w / 2, -h * 0.35); ctx.lineTo(w / 2 - 4, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.moveTo(-w * 0.15, -h); ctx.lineTo(w * 0.25, -h * 0.92); ctx.lineTo(w * 0.05, -h * 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.moveTo(w / 2, -h * 0.35); ctx.lineTo(w / 2 - 4, 0); ctx.lineTo(w * 0.18, 0); ctx.lineTo(w * 0.3, -h * 0.45); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function pebble(ctx, g) {
  ctx.save(); ctx.translate(128, g - 3);
  ctx.fillStyle = '#9aa0a6';
  ctx.beginPath(); ctx.ellipse(0, 0, 11, 7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath(); ctx.ellipse(-3, -2, 4.5, 2.6, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function reeds(ctx, g) {
  ctx.save(); ctx.translate(128, g);
  ctx.strokeStyle = '#7fa64a'; ctx.lineWidth = 3.4;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath(); ctx.moveTo(i * 5, 0);
    ctx.quadraticCurveTo(i * 7 + 3, -26, i * 10 + 5, -48 - (4 - Math.abs(i)) * 5);
    ctx.stroke();
  }
  ctx.fillStyle = '#8a6b3c';
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(i * 9 + 4, -50 - (3 - Math.abs(i)) * 4, 3.2, 7, 0.2, 0, TAU); ctx.fill(); }
  ctx.restore();
}

function campfireBase(ctx, g) {
  ctx.save(); ctx.translate(128, g);
  ctx.fillStyle = '#7b7f86';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.beginPath(); ctx.ellipse(Math.cos(a) * 26, Math.sin(a) * 11 - 3, 8, 6, a, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(-16, -4); ctx.lineTo(14, -16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-14, -17); ctx.lineTo(16, -4); ctx.stroke();
  ctx.fillStyle = '#4a3220';
  ctx.beginPath(); ctx.ellipse(0, -10, 15, 8, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function hut(ctx, g) {
  ctx.save(); ctx.translate(128, g);
  // الجسم
  ctx.fillStyle = '#b58a55';
  ctx.fillRect(-52, -84, 104, 84);
  ctx.strokeStyle = 'rgba(90,60,30,0.45)'; ctx.lineWidth = 2;
  for (let y = -74; y < 0; y += 14) { ctx.beginPath(); ctx.moveTo(-52, y); ctx.lineTo(52, y); ctx.stroke(); }
  // الباب
  ctx.fillStyle = '#6b4826'; ctx.fillRect(-14, -52, 28, 52);
  ctx.fillStyle = '#c9a06a'; ctx.fillRect(-10, -46, 20, 46);
  ctx.fillStyle = '#e2c58f';
  ctx.beginPath(); ctx.arc(5, -24, 2.6, 0, TAU); ctx.fill();
  // الشرجم
  ctx.fillStyle = '#4d5c66'; ctx.fillRect(24, -66, 20, 18);
  ctx.strokeStyle = '#e2c58f'; ctx.lineWidth = 2.4; ctx.strokeRect(24, -66, 20, 18);
  // السقف (قش)
  ctx.fillStyle = '#c9a24f';
  ctx.beginPath(); ctx.moveTo(-70, -82); ctx.lineTo(0, -152); ctx.lineTo(70, -82); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,30,0.5)'; ctx.lineWidth = 2;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath(); ctx.moveTo(i * 10, -82);
    ctx.lineTo(0, -152); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,240,190,0.5)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-70, -82); ctx.lineTo(0, -152); ctx.lineTo(70, -82); ctx.stroke();
  ctx.fillStyle = '#8f6b2f'; ctx.fillRect(-70, -86, 140, 8);
  ctx.restore();
}

function coop(ctx, g) {
  ctx.save(); ctx.translate(128, g);
  ctx.fillStyle = '#c39a5f';
  ctx.fillRect(-50, -60, 100, 60);
  ctx.fillStyle = '#f2e6c9';
  ctx.fillRect(-40, -50, 80, 46);
  ctx.strokeStyle = '#a8834a'; ctx.lineWidth = 2;
  for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 10, -50); ctx.lineTo(i * 10, -4); ctx.stroke(); }
  for (let j = -4; j <= 0; j++) { ctx.beginPath(); ctx.moveTo(-40, j * 10 - 4); ctx.lineTo(40, j * 10 - 4); ctx.stroke(); }
  ctx.fillStyle = '#c39a5f';
  ctx.fillRect(-54, -64, 108, 7); ctx.fillRect(-54, -6, 108, 6);
  ctx.fillRect(-54, -64, 7, 58); ctx.fillRect(47, -64, 7, 58);
  ctx.fillStyle = '#b3823c';
  ctx.beginPath(); ctx.moveTo(-62, -62); ctx.lineTo(0, -104); ctx.lineTo(62, -62); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,80,20,0.4)'; ctx.lineWidth = 2;
  for (let i = -5; i <= 5; i++) { ctx.beginPath(); ctx.moveTo(i * 12, -62); ctx.lineTo(0, -104); ctx.stroke(); }
  // عش
  ctx.fillStyle = '#e8c66a';
  ctx.beginPath(); ctx.ellipse(0, -8, 34, 7, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function bench(ctx, g) {
  ctx.save(); ctx.translate(128, g);
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(-38, -12, 8, 12); ctx.fillRect(30, -12, 8, 12);
  ctx.fillRect(-34, -74, 6, 62); ctx.fillRect(28, -74, 6, 62);
  ctx.fillStyle = '#a5733f';
  ctx.fillRect(-44, -30, 88, 10);
  ctx.fillRect(-40, -76, 80, 10);
  ctx.strokeStyle = 'rgba(60,35,10,0.4)'; ctx.lineWidth = 2;
  ctx.strokeRect(-44, -30, 88, 10);
  // أدوات
  ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-14, -32); ctx.lineTo(-6, -44); ctx.stroke();
  ctx.fillStyle = '#8b8f96';
  ctx.beginPath(); ctx.moveTo(-10, -44); ctx.lineTo(2, -50); ctx.lineTo(4, -40); ctx.lineTo(-6, -38); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d9d2c4';
  ctx.beginPath(); ctx.ellipse(24, -36, 9, 5, 0.3, 0, TAU); ctx.fill();
  ctx.restore();
}

function egg(ctx, x, y, r) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#fdf6e3';
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.72, r, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.ellipse(r * 0.18, r * 0.12, r * 0.55, r * 0.8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.2, r * 0.28, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function sprout(ctx, g) {
  ctx.save(); ctx.translate(128, g - 8);
  ctx.strokeStyle = '#4f9a45'; ctx.lineWidth = 3.6;
  ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -8); ctx.stroke();
  ctx.fillStyle = '#63b04f';
  ctx.beginPath(); ctx.ellipse(-7, -10, 8, 5, -0.5, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(7, -12, 8, 5, 0.5, 0, TAU); ctx.fill();
  ctx.restore();
}

function logPile(ctx, g) {
  ctx.save(); ctx.translate(128, g);
  ctx.fillStyle = '#8a5e34';
  for (const [x, y] of [[-14, -8], [14, -8], [0, -22]]) {
    ctx.beginPath(); ctx.roundRect(x - 15, y - 8, 30, 16, 7); ctx.fill();
    ctx.fillStyle = '#c9a06a';
    ctx.beginPath(); ctx.ellipse(x + 14, y, 4, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5e34';
  }
  ctx.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g2 = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = clamp(r, 0, 255); g2 = clamp(g2, 0, 255); b = clamp(b, 0, 255);
  return `rgb(${r},${g2},${b})`;
}

// رسم رمز من الأطلس
export function drawSprite(ctx, name, x, y, opt = {}) {
  const e = atlas.entries[name];
  if (!e) return;
  const w = (opt.w || e.w) * (opt.scale || 1);
  const h = (w * e.sh) / e.sw;
  const flip = opt.flip ? -1 : 1;
  const alpha = opt.alpha ?? 1;
  if (alpha < 1) ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(x, y);
  if (flip === -1) ctx.scale(-1, 1);
  if (opt.rot) ctx.rotate(opt.rot);
  ctx.drawImage(atlas.canvas, e.sx, e.sy, e.sw, e.sh, -w / 2, -h, w, h);
  ctx.restore();
  if (alpha < 1) ctx.globalAlpha = 1;
}

// ============================================================
//  الأرض — رسم بالقطع (chunks) مخزّنة
// ============================================================
const CH = 8;               // 8×8 بلاطات فكل قطعة
const CHPX = CH * TILE;
const chunkCache = new Map();
let chunkStamp = 0;

export function clearChunks() { chunkCache.clear(); }
export function beginChunks(t) { chunkStamp = Math.floor(t * 60); }
export function getChunk(world, cx, cy) {
  const W = world.w / CH + 1, H = world.h / CH + 1;
  if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
  return chunkCanvas(world, cx, cy);
}

function chunkCanvas(world, cx, cy) {
  const key = cy * 1000 + cx;
  let c = chunkCache.get(key);
  if (c && c.world === world) { c.t = chunkStamp; return c.canvas; }
  const cv = document.createElement('canvas');
  cv.width = CHPX; cv.height = CHPX;
  const g = cv.getContext('2d');
  drawChunk(g, world, cx, cy);
  chunkCache.set(key, { canvas: cv, world, t: chunkStamp });
  if (chunkCache.size > 90) {
    let oldest = null, ok = null;
    for (const [k, v] of chunkCache) if (!oldest || v.t < oldest.t) { oldest = v; ok = k; }
    if (ok !== null) chunkCache.delete(ok);
  }
  return cv;
}

function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function tileColors(t, v) {
  switch (t) {
    case T.SAND: {
      const s = 1 + (v / 255 - 0.5) * 0.09;
      return [`rgb(${236 * s | 0},${216 * s | 0},${164 * s | 0})`, `rgb(${220 * s | 0},${198 * s | 0},${146 * s | 0})`];
    }
    case T.GRASS: {
      const s = 1 + (v / 255 - 0.5) * 0.11;
      return [`rgb(${124 * s | 0},${187 * s | 0},${91 * s | 0})`, `rgb(${104 * s | 0},${166 * s | 0},${78 * s | 0})`];
    }
    case T.FOREST: {
      const s = 1 + (v / 255 - 0.5) * 0.10;
      return [`rgb(${92 * s | 0},${152 * s | 0},${75 * s | 0})`, `rgb(${76 * s | 0},${132 * s | 0},${64 * s | 0})`];
    }
    case T.ROCK: {
      const s = 1 + (v / 255 - 0.5) * 0.12;
      return [`rgb(${160 * s | 0},${162 * s | 0},${168 * s | 0})`, `rgb(${140 * s | 0},${142 * s | 0},${150 * s | 0})`];
    }
    case T.FRESH: {
      const s = 1 + (v / 255 - 0.5) * 0.08;
      return [`rgb(${104 * s | 0},${186 * s | 0},${206 * s | 0})`, `rgb(${86 * s | 0},${166 * s | 0},${190 * s | 0})`];
    }
  }
  return ['#8ecb6a', '#7cbb5c'];
}

function waterColor(dist, shallowT) {
  if (shallowT) return '#63cbd0';
  const t = clamp(dist / 9, 0, 1);
  const r = 84 + (26 - 84) * t, g = 197 + (86 - 197) * t, b = 205 + (146 - 205) * t;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function drawChunk(g, world, ccx, ccy) {
  g.clearRect(0, 0, CHPX, CHPX);
  for (let ty = ccy * CH; ty < ccy * CH + CH; ty++) {
    for (let tx = ccx * CH; tx < ccx * CH + CH; tx++) {
      const t = world.tileAt(tx, ty);
      const v = world.var[world.idx(tx, ty)] || 128;
      const x = (tx - ccx * CH) * TILE, y = (ty - ccy * CH) * TILE;
      const h1 = hash2(tx, ty);
      if (t === T.DEEP || t === T.SHALLOW) {
        g.fillStyle = waterColor(world.shoreDist ? world.shoreDist[world.idx(tx, ty)] : 9, t === T.SHALLOW);
        g.fillRect(x, y, TILE + 0.5, TILE + 0.5);
        // موجات ثابتة خفيفة
        g.strokeStyle = 'rgba(255,255,255,0.16)';
        g.lineWidth = 1.6;
        for (let k = 0; k < 2; k++) {
          const wy = y + TILE * (0.25 + 0.5 * hash2(tx, ty + k * 7));
          const wx = x + TILE * hash2(tx + k * 13, ty);
          g.beginPath();
          g.moveTo(wx, wy);
          g.quadraticCurveTo(wx + 8, wy - 3, wx + 16, wy);
          g.stroke();
        }
      } else if (t === T.FRESH) {
        g.fillStyle = waterColor(0, false);
        const c = tileColors(t, v);
        g.fillStyle = c[0];
        g.fillRect(x, y, TILE + 0.5, TILE + 0.5);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x + 3, y + 4, TILE * 0.5, 2);
      } else {
        const c = tileColors(t, v);
        g.fillStyle = h1 > 0.5 ? c[0] : c[1];
        g.fillRect(x, y, TILE + 0.5, TILE + 0.5);
        // تفاصيل
        if (t === T.SAND) {
          g.fillStyle = 'rgba(255,255,255,0.30)';
          for (let i = 0; i < 2; i++) {
            const px = x + hash2(tx * 3 + i, ty) * TILE, py = y + hash2(tx, ty * 3 + i) * TILE;
            g.fillRect(px, py, 2, 2);
          }
          if (h1 > 0.93) {
            g.fillStyle = 'rgba(210,180,130,0.7)';
            g.beginPath(); g.ellipse(x + TILE * 0.5, y + TILE * 0.6, 5, 3, 0, 0, TAU); g.fill();
          }
        } else if (t === T.GRASS || t === T.FOREST) {
          g.strokeStyle = t === T.FOREST ? 'rgba(50,105,50,0.5)' : 'rgba(80,150,60,0.42)';
          g.lineWidth = 1.8;
          for (let i = 0; i < 3; i++) {
            const bx = x + 4 + hash2(tx * 5 + i, ty * 2) * (TILE - 8);
            const by = y + 6 + hash2(tx * 2, ty * 5 + i) * (TILE - 10);
            g.beginPath(); g.moveTo(bx, by + 4); g.quadraticCurveTo(bx + 2, by, bx + 1, by - 4); g.stroke();
          }
          if (h1 > 0.9) {
            g.fillStyle = t === T.FOREST ? 'rgba(60,110,55,0.6)' : 'rgba(110,165,80,0.55)';
            g.beginPath(); g.arc(x + TILE * 0.5, y + TILE * 0.55, 4, 0, TAU); g.fill();
          }
        } else if (t === T.ROCK) {
          g.strokeStyle = 'rgba(110,112,120,0.55)'; g.lineWidth = 1.6;
          g.beginPath();
          const bx = x + 6 + hash2(tx, ty) * 12, by = y + 6 + hash2(ty, tx) * 12;
          g.moveTo(bx, by); g.lineTo(bx + 12, by + 5); g.stroke();
        }
      }
      // خط الرمل
      if (t === T.SAND && world.tileAt(tx, ty + 1) === T.SHALLOW) {
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.fillRect(x, y + TILE - 3, TILE + 0.5, 3);
      }
    }
  }
}

// رشيم/موج فوق الما
export function drawFoam(ctx, world, cam, W, H, zoom, time) {
  const t0x = clamp(Math.floor((cam.x - W / 2 / zoom) / TILE) - 1, 0, world.w - 1);
  const t1x = clamp(Math.floor((cam.x + W / 2 / zoom) / TILE) + 1, 0, world.w - 1);
  const t0y = clamp(Math.floor((cam.y - H / 2 / zoom) / TILE) - 1, 0, world.h - 1);
  const t1y = clamp(Math.floor((cam.y + H / 2 / zoom) / TILE) + 1, 0, world.h - 1);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2.2;
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const t = world.tileAt(tx, ty);
      if (t === T.DEEP) {
        // موجات عامة
        const ph = hash2(tx, ty) * TAU + time * 0.9;
        const a = 0.10 + 0.10 * Math.sin(ph);
        if (a <= 0.03) continue;
        ctx.globalAlpha = a;
        const wx = tx * TILE + 6 + Math.sin(time + tx) * 3, wy = ty * TILE + 12 + Math.cos(time + tx * 0.7 + ty) * 4;
        ctx.beginPath(); ctx.moveTo(wx, wy); ctx.quadraticCurveTo(wx + 9, wy - 4, wx + 20, wy); ctx.stroke();
      } else if (t === T.SHALLOW) {
        let near = false;
        for (let i = 0; i < 4; i++) {
          const nx = tx + [1, -1, 0, 0][i], ny = ty + [0, 0, 1, -1][i];
          if (world.tileAt(nx, ny) === T.SAND) near = true;
        }
        if (!near) continue;
        const ph = (time * 1.6 + hash2(tx, ty) * 6.28) % 6.28;
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(ph);
        ctx.lineWidth = 2.6;
        const y = ty * TILE + TILE - 6 + Math.sin(ph) * 3;
        ctx.beginPath();
        ctx.moveTo(tx * TILE + 3, y);
        ctx.quadraticCurveTo(tx * TILE + TILE / 2, y - 7, tx * TILE + TILE - 3, y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// ============================================================
//  الظلال
// ============================================================
function shadow(ctx, x, y, rx, ry, a = 0.22) {
  ctx.save();
  ctx.fillStyle = `rgba(30,40,20,${a})`;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ============================================================
//  الكائنات
// ============================================================
const SPRITE_OF = {
  palm: (o) => (o.variant ? 'palm2' : 'palm1'),
  tree: (o) => (o.resin ? 'tree1r' : 'tree1'),
  tree2: (o) => (o.resin ? 'tree2r' : 'tree2'),
  bush: (o) => (o.berry ? 'bushBerry' : 'bush'),
  tuft: () => 'tuft',
  flower: (o) => (o.variant === 1 ? 'flowerB' : 'flowerA'),
  rock: (o) => (o.variant ? 'rockB' : 'rockA'),
  pebble: () => 'pebble',
  reeds: () => 'reeds',
  campfire: () => 'campfire',
  hut: () => 'hut',
  coop: () => 'coop',
  bench: () => 'bench',
  eggItem: () => 'egg',
};

export function drawObject(ctx, o, time, world) {
  const def = KIND_DEF[o.kind];
  if (!def) return;
  if (o.depleted) {
    if (o.kind === 'rock') drawSprite(ctx, 'pebble', o.x, o.y, { w: 26, alpha: 0.85 });
    else if (o.kind === 'tree' || o.kind === 'tree2' || o.kind === 'palm') {
      // الجذع اللي بقى
      ctx.save();
      ctx.fillStyle = 'rgba(30,40,20,0.18)';
      ctx.beginPath(); ctx.ellipse(o.x, o.y + 1, 9, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8a5e34';
      ctx.beginPath(); ctx.ellipse(o.x, o.y - 5, 7, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c9a06a';
      ctx.beginPath(); ctx.ellipse(o.x, o.y - 11, 7, 3.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#a07a4a';
      ctx.beginPath(); ctx.ellipse(o.x, o.y - 11, 3.4, 1.6, 0, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (o.kind === 'bush' || o.kind === 'tuft' || o.kind === 'reeds') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#4c7a35';
      ctx.beginPath(); ctx.ellipse(o.x, o.y - 2, 6, 3, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    return;
  }
  const key = (SPRITE_OF[o.kind] || (() => o.kind))(o);
  let shakeX = 0;
  if (o.shakeT > 0) shakeX = Math.sin(o.shakeT * 60) * 2.6 * Math.min(1, o.shakeT * 3);
  if (def.solid) shadow(ctx, o.x, o.y + 1, def.r * 1.05, def.r * 0.42, o.kind === 'hut' || o.kind === 'coop' ? 0.26 : 0.2);

  if (o.kind === 'boat') { drawBoat(ctx, o, time); return; }
  const sway = (o.kind === 'tree' || o.kind === 'tree2' || o.kind === 'palm') ? Math.sin(time * 1.1 + o.phase) * 1.6 : 0;
  drawSprite(ctx, key, o.x + shakeX + sway, o.y, {
    flip: o.phase > 3.1,
  });

  // نار شاعلة
  if (o.kind === 'campfire') {
    if (o.lit === false) return;
    const t = time * 6 + o.phase;
    for (let i = 0; i < 3; i++) {
      const s = 1 + 0.16 * Math.sin(t + i * 2);
      const h = 26 * s * (1 - i * 0.22), w = 15 * s * (1 - i * 0.25);
      ctx.save();
      ctx.globalAlpha = 0.85 - i * 0.2;
      ctx.fillStyle = ['#ff9a20', '#ffc63c', '#fff0a0'][i];
      ctx.beginPath();
      ctx.moveTo(o.x - w, o.y - 14);
      ctx.quadraticCurveTo(o.x - w * 0.6, o.y - 14 - h * 0.7, o.x + Math.sin(t * 0.8 + i) * 4, o.y - 14 - h);
      ctx.quadraticCurveTo(o.x + w * 0.6, o.y - 14 - h * 0.7, o.x + w, o.y - 14);
      ctx.quadraticCurveTo(o.x, o.y - 8, o.x - w, o.y - 14);
      ctx.fill();
      ctx.restore();
    }
  }
  if (o.kind === 'coop') {
    // بيض / علامة
    for (let i = 0; i < o.eggs; i++) {
      const a = (i / 15) * TAU;
      drawSprite(ctx, 'egg', o.x + Math.cos(a) * 26, o.y + 4 + Math.sin(a) * 8, { w: 13 });
    }
    if (o.incubating > 0) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#fff2c0';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🐣', o.x, o.y - 74 + Math.sin(time * 3) * 2);
      ctx.restore();
    }
  }
  if (o.kind === 'hut') {
    // لمعة النافذة بالليل
    const n = nightAmount(hourOf(world.time));
    if (n > 0.2) {
      ctx.save();
      ctx.globalAlpha = 0.75 * n;
      ctx.fillStyle = '#ffcf72';
      ctx.fillRect(o.x + 24, o.y - 66, 20, 18);
      ctx.restore();
    }
  }
}

function drawBoat(ctx, o, time) {
  const p = o.progress ?? 0;
  const x = o.x, y = o.y;
  ctx.save();
  ctx.translate(x, y);
  shadow(ctx, 0, 4, 42, 15, 0.28);
  const wood = '#a9763f', woodDark = '#7d5527';
  ctx.lineJoin = 'round';
  if (p < 0.05) {
    // البلاصة الخاوية: علامة بناء
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(0, 0, 42, 16, 0, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⛵', 0, -4);
    ctx.restore();
    return;
  }
  // البدن الأساسي
  const hull = (scale, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-46 * scale, -6);
    ctx.quadraticCurveTo(-30 * scale, 16 * scale, 0, 16 * scale);
    ctx.quadraticCurveTo(30 * scale, 16 * scale, 46 * scale, -6);
    ctx.quadraticCurveTo(0, 6, -46 * scale, -6);
    ctx.closePath(); ctx.fill();
  };
  hull(Math.min(1, p / 0.3), woodDark);
  if (p > 0.3) {
    hull(1, wood);
    ctx.strokeStyle = 'rgba(80,50,20,0.55)'; ctx.lineWidth = 1.6;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * 15, -2); ctx.quadraticCurveTo(i * 12, 8, i * 10, 13); ctx.stroke();
    }
  }
  if (p > 0.55) {
    // الدكة والعمود
    ctx.fillStyle = '#c9a06a';
    ctx.beginPath(); ctx.ellipse(0, -3, 40, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5e34';
    ctx.fillRect(-3, -96, 6, 94);
    ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(10, -3); ctx.lineTo(0, 8); ctx.closePath(); ctx.fill();
    // حبال
    ctx.strokeStyle = '#d8c08a'; ctx.lineWidth = 1.8;
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath(); ctx.moveTo(0, -92); ctx.lineTo(i * 34, -4); ctx.stroke();
    }
  }
  if (p > 0.8) {
    // الشراع
    const flap = Math.sin(time * 2.2) * 3;
    ctx.fillStyle = '#f6f1e2';
    ctx.beginPath();
    ctx.moveTo(3, -92);
    ctx.quadraticCurveTo(34 + flap, -60, 30 + flap, -10);
    ctx.lineTo(3, -8);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(150,120,80,0.55)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(3, -92); ctx.quadraticCurveTo(14, -56, 8, -10); ctx.stroke();
    ctx.fillStyle = '#2f8f3f';
    ctx.beginPath(); ctx.moveTo(-3, -96); ctx.lineTo(-30, -88); ctx.lineTo(-3, -78); ctx.closePath(); ctx.fill();
  }
  if (p < 1) {
    // شريط التقدم
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.roundRect(-40, -128, 80, 12, 6); ctx.fill();
    ctx.fillStyle = '#7ee08a';
    ctx.beginPath(); ctx.roundRect(-37, -125, 74 * clamp(p, 0, 1), 6, 3); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`⛵ البناء ${Math.round(p * 100)}%`, 0, -134);
  } else {
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('⛵ واجد للإبحار', 0, -110);
  }
  ctx.restore();
}

// ============================================================
//  اللاعب
// ============================================================
const SKIN = '#f0c090', SKIN_D = '#d9a06a', SHIRT = '#e2564a', PANTS = '#3b5b8c', HAIR = '#3a2a1e';

export function drawPlayer(ctx, p, time) {
  const flip = Math.cos(p.dir) < -0.05 ? -1 : 1;
  const moving = p.speedScale > 0.06;
  const ph = p.walkPhase;
  const bob = moving ? Math.abs(Math.sin(ph)) * 1.8 : Math.sin(time * 2.4) * 1.1;
  const x = p.x, y = p.y;
  shadow(ctx, x, y + 1, 14, 5.6, 0.24);
  ctx.save();
  ctx.translate(x, y - bob);
  ctx.scale(flip * 1.22, 1.22);

  // الرجلين
  const swing = moving ? Math.sin(ph) * 7 : Math.sin(time * 2) * 0.8;
  ctx.strokeStyle = SKIN_D; ctx.lineWidth = 5.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, -14); ctx.lineTo(-4 + swing * 0.5, -1 + Math.abs(swing) * 0.2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, -14); ctx.lineTo(4 - swing * 0.5, -1 + Math.abs(swing) * 0.2); ctx.stroke();
  // الشورط
  ctx.fillStyle = PANTS;
  ctx.beginPath(); ctx.roundRect(-8, -22, 16, 10, 3); ctx.fill();
  // الجسد
  ctx.fillStyle = SHIRT;
  ctx.beginPath(); ctx.roundRect(-9, -33, 18, 14, 4); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.roundRect(-9, -33, 6, 14, 4); ctx.fill();
  // الذراعين
  const armSw = moving ? Math.sin(ph + Math.PI) * 6 : Math.sin(time * 2 + 1) * 0.7;
  const act = p.actAnim;
  ctx.strokeStyle = SKIN; ctx.lineWidth = 4.6;
  ctx.beginPath(); ctx.moveTo(-7, -29); ctx.lineTo(-10 - armSw * 0.4, -20 + armSw * 0.3); ctx.stroke();
  ctx.save();
  ctx.translate(7, -29);
  ctx.rotate(-act * 1.5 + armSw * 0.06);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(4, 8); ctx.stroke();
  // الأداة فال يد
  if (p.tool === 'axe') {
    ctx.strokeStyle = '#8a5e34'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(4, -6); ctx.stroke();
    ctx.fillStyle = '#c9ccd2';
    ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(14, -10); ctx.lineTo(15, -2); ctx.lineTo(4, 2); ctx.closePath(); ctx.fill();
  } else if (p.tool === 'pick') {
    ctx.strokeStyle = '#8a5e34'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(4, -6); ctx.stroke();
    ctx.strokeStyle = '#b9bcc2'; ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.moveTo(-5, -7); ctx.quadraticCurveTo(4, -13, 14, -6); ctx.stroke();
  }
  ctx.restore();
  // الرأس
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(0, -39, 9.4, 0, TAU); ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath(); ctx.arc(0, -41.5, 9.6, Math.PI * 1.03, Math.PI * 2.02); ctx.fill();
  ctx.fillRect(-9.6, -41.5, 19.2, 3.4);
  // القبعة
  ctx.fillStyle = '#c98b3f';
  ctx.beginPath(); ctx.ellipse(0, -47, 12, 3.6, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -48, 7.4, Math.PI, TAU); ctx.fill();
  // العينين
  ctx.fillStyle = '#241a12';
  ctx.beginPath(); ctx.arc(3.6, -38.6, 1.5, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(-1.6, -38.6, 1.5, 0, TAU); ctx.fill();
  // خدود حمرا إذا سخون/بارد
  if (p.hurtFlash > 0) {
    ctx.globalAlpha = p.hurtFlash * 0.5;
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.arc(0, -34, 12, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // شطيح
  if (p.splash > 0.05) {
    ctx.save();
    ctx.globalAlpha = 0.5 * p.splash;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const rr = 8 + i * 6 + (time * 30 + i * 9) % 12;
      ctx.beginPath(); ctx.ellipse(x, y + 2, rr, rr * 0.4, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

// ============================================================
//  الحيوانات
// ============================================================
export function drawAnimal(ctx, a, time) {
  const bobY = Math.sin(a.bob) * (a.type === 'chicken' ? 1.4 : 1.0);
  const flip = Math.cos(a.dir) < 0 ? -1 : 1;
  ctx.save();
  shadow(ctx, a.x, a.y + 1, a.r * 0.9, a.r * 0.35, 0.22);
  ctx.translate(a.x, a.y + bobY);
  const k = a.type === 'chicken' ? 1.25 : a.type === 'crab' ? 1.15 : 1.2;
  ctx.scale(flip * k, k);
  switch (a.type) {
    case 'chicken': {
      const peck = a.state === 'wander' && Math.sin(a.t * 1.4) > 0.75 ? 4 : 0;
      const white = a.variant ? '#f3e9d2' : '#fbf6ea';
      ctx.strokeStyle = '#e0a13c'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-3.5, -6); ctx.lineTo(-3.5, 0); ctx.moveTo(3.5, -6); ctx.lineTo(3.5, 0); ctx.stroke();
      ctx.fillStyle = white;
      ctx.beginPath(); ctx.ellipse(0, -12, 10.5, 8.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.beginPath(); ctx.ellipse(-2, -11, 7, 6.4, 0, 0, TAU); ctx.fill();
      // الراس
      const hx = 7, hy = -19 + peck;
      ctx.fillStyle = white;
      ctx.beginPath(); ctx.arc(hx, hy, 5.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e0453f';
      ctx.beginPath(); ctx.arc(hx - 1, hy - 5.4, 2.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(hx + 2.4, hy - 5.2, 1.9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f2a13c';
      ctx.beginPath(); ctx.moveTo(hx + 4, hy - 0.5); ctx.lineTo(hx + 10, hy + 1.2); ctx.lineTo(hx + 4, hy + 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e0453f';
      ctx.beginPath(); ctx.ellipse(hx + 3, hy + 4.6, 2.2, 3, 0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#241a12';
      ctx.beginPath(); ctx.arc(hx + 2.6, hy - 1.6, 1.15, 0, TAU); ctx.fill();
      // الجناح
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.beginPath(); ctx.ellipse(-2, -12, 6, 4.4, 0.2, 0, TAU); ctx.fill();
      if (a.tamed) {
        ctx.fillStyle = '#e2564a';
        ctx.beginPath(); ctx.roundRect(-6, -20, 3.6, 6, 1.6); ctx.fill();
      }
      if (a.inside) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      }
      break;
    }
    case 'goat': {
      const walk = a.state === 'flee' ? Math.sin(a.bob * 1.6) * 4 : Math.sin(a.bob) * 1.6;
      ctx.strokeStyle = '#8d8577'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-8, -12); ctx.lineTo(-8 + walk, 0);
      ctx.moveTo(8, -12); ctx.lineTo(8 - walk, 0);
      ctx.moveTo(-6, -12); ctx.lineTo(-6 - walk, 0);
      ctx.moveTo(10, -12); ctx.lineTo(10 + walk, 0);
      ctx.stroke();
      ctx.fillStyle = '#f0e6d2';
      ctx.beginPath(); ctx.ellipse(0, -20, 15, 10, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.beginPath(); ctx.ellipse(-2, -19, 11, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f6efe0';
      ctx.beginPath(); ctx.ellipse(14, -26, 8, 6.6, -0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#cfc3a8';
      ctx.beginPath(); ctx.ellipse(20, -24, 4, 3.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#241a12';
      ctx.beginPath(); ctx.arc(17, -28, 1.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#b8a888'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(13, -31); ctx.quadraticCurveTo(10, -38, 15, -38); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(17, -31); ctx.quadraticCurveTo(20, -38, 24, -36); ctx.stroke();
      ctx.fillStyle = '#e8e0cc';
      ctx.beginPath(); ctx.moveTo(22, -22); ctx.lineTo(25, -17); ctx.lineTo(21, -18); ctx.closePath(); ctx.fill();
      break;
    }
    case 'boar': {
      const walk = Math.sin(a.bob * 1.5) * 3;
      ctx.strokeStyle = '#4a3a2c'; ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(-8, -12); ctx.lineTo(-8 + walk, 0);
      ctx.moveTo(8, -12); ctx.lineTo(8 - walk, 0);
      ctx.moveTo(-5, -12); ctx.lineTo(-5 - walk, 0);
      ctx.moveTo(11, -12); ctx.lineTo(11 + walk, 0);
      ctx.stroke();
      ctx.fillStyle = '#6b5340';
      ctx.beginPath(); ctx.ellipse(0, -20, 17, 11, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.ellipse(-4, -19, 12, 9, 0, 0, TAU); ctx.fill();
      // شعر ظهر
      ctx.strokeStyle = '#3d2f22'; ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 5, -29); ctx.lineTo(i * 5 + 1, -34); ctx.stroke(); }
      ctx.fillStyle = '#7a6150';
      ctx.beginPath(); ctx.ellipse(17, -18, 9, 8, 0.1, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9c8370';
      ctx.beginPath(); ctx.ellipse(25, -16, 4.6, 3.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#241a12';
      ctx.beginPath(); ctx.arc(19, -20, 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f3ecdc';
      ctx.beginPath(); ctx.moveTo(24, -13); ctx.lineTo(28, -9); ctx.lineTo(23, -10); ctx.closePath(); ctx.fill();
      if (a.state === 'chase') {
        ctx.fillStyle = '#ff4b3e';
        ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('!', 0, -42);
      }
      break;
    }
    case 'crab': {
      const sc = 1 + Math.sin(a.bob) * 0.05;
      ctx.fillStyle = '#d8452f';
      ctx.beginPath(); ctx.ellipse(0, -6, 9 * sc, 6.6 * sc, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#d8452f'; ctx.lineWidth = 2.2;
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath(); ctx.moveTo(-2 * i, -4); ctx.quadraticCurveTo(-9 * i, -2, -12 * i, 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(3 * i, -4); ctx.quadraticCurveTo(8 * i, -1, 11 * i, 2); ctx.stroke();
      }
      ctx.lineWidth = 2.4;
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath(); ctx.moveTo(6 * i, -7); ctx.quadraticCurveTo(11 * i, -12, 10 * i, -16); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(-3 * i, -14, -2 * i, -17); ctx.stroke();
      }
      ctx.fillStyle = '#e8624a';
      ctx.beginPath(); ctx.arc(-3.4, -14, 2.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(3.4, -14, 2.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#241a12';
      ctx.beginPath(); ctx.arc(-3.4, -14.6, 1.1, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(3.4, -14.6, 1.1, 0, TAU); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// ============================================================
//  العناصر المرمية
// ============================================================
export function drawItem(ctx, it, time) {
  const bob = Math.sin(time * 3 + it.x * 0.1) * 2;
  const y = it.y - 8 + bob;
  const a = clamp(it.t * 3, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  shadow(ctx, it.x, it.y + 1, 7, 3, 0.18);
  const k = it.kind;
  if (k === 'wood') {
    ctx.fillStyle = '#8a5e34';
    ctx.beginPath(); ctx.roundRect(it.x - 9, y - 5, 18, 6, 3); ctx.fill();
    ctx.fillStyle = '#6f4a28';
    ctx.beginPath(); ctx.roundRect(it.x - 7, y + 1, 15, 5, 2.5); ctx.fill();
  } else if (k === 'stone') {
    ctx.fillStyle = '#9aa0a6';
    ctx.beginPath(); ctx.moveTo(it.x - 7, y + 3); ctx.lineTo(it.x - 3, y - 6); ctx.lineTo(it.x + 5, y - 5); ctx.lineTo(it.x + 8, y + 3); ctx.closePath(); ctx.fill();
  } else if (k === 'fiber') {
    ctx.strokeStyle = '#7cae3f'; ctx.lineWidth = 2.4;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(it.x + i * 4, y + 4); ctx.quadraticCurveTo(it.x + i * 6, y - 4, it.x + i * 3, y - 8); ctx.stroke(); }
  } else if (k === 'seed') {
    ctx.fillStyle = '#e8cf6a';
    for (const [dx, dy] of [[-4, 0], [3, -2], [0, 3]]) { ctx.beginPath(); ctx.ellipse(it.x + dx, y + dy, 2.6, 3.6, 0.4, 0, TAU); ctx.fill(); }
  } else if (k === 'coconut') {
    ctx.fillStyle = '#6b4423';
    ctx.beginPath(); ctx.arc(it.x, y, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4d2f18';
    ctx.beginPath(); ctx.arc(it.x - 2, y - 2, 1.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(it.x + 2.4, y - 1, 1.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(it.x, y + 3, 1.5, 0, TAU); ctx.fill();
  } else if (k === 'meat') {
    ctx.fillStyle = '#c74a3f';
    ctx.beginPath(); ctx.ellipse(it.x - 1, y, 7, 5.4, 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f3e6cf'; ctx.lineWidth = 3.4; ctx.strokeStyle = '#f3e6cf';
    ctx.beginPath(); ctx.moveTo(it.x + 4, y + 2); ctx.lineTo(it.x + 9, y + 6); ctx.stroke();
  } else if (k === 'resin') {
    ctx.fillStyle = '#e0a13c';
    ctx.beginPath(); ctx.arc(it.x, y, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(it.x - 2, y - 2, 1.8, 0, TAU); ctx.fill();
  } else if (k === 'egg') {
    drawSprite(ctx, 'egg', it.x, y + 8, { w: 16 });
  } else if (k === 'rope') {
    ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 4; ctx.strokeStyle = '#c9a86a';
    ctx.beginPath(); ctx.arc(it.x, y, 6, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(it.x, y, 3.4, 0, TAU); ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(it.x, y, 5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ============================================================
//  الجوّ: ليل/غروب/ضوا
// ============================================================
export function drawAtmosphere(ctx, game, W, H, cam, zoom) {
  const hour = hourOf(game.world.time);
  const night = nightAmount(hour);
  const sunset = sunsetAmount(hour);

  if (sunset > 0.01) {
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(255,138,60,${0.16 * sunset})`);
    g.addColorStop(0.6, `rgba(255,90,70,${0.10 * sunset})`);
    g.addColorStop(1, `rgba(120,60,120,${0.08 * sunset})`);
    ctx.fillStyle = g;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (night > 0.01) {
    ctx.save();
    ctx.fillStyle = `rgba(12,20,48,${0.62 * night})`;
    ctx.fillRect(0, 0, W, H);
    // ضوا النار
    ctx.globalCompositeOperation = 'lighter';
    for (const fire of game.world.structs('campfire')) {
      const sx = (fire.x - cam.x) * zoom + W / 2;
      const sy = (fire.y - cam.y) * zoom + H / 2;
      const R = 200 * zoom;
      const flick = 1 + Math.sin(game.time * 8) * 0.04;
      const g = ctx.createRadialGradient(sx, sy, 10, sx, sy, R * flick);
      g.addColorStop(0, `rgba(255,170,70,${0.42 * night})`);
      g.addColorStop(0.4, `rgba(255,130,40,${0.18 * night})`);
      g.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, R * flick, 0, TAU); ctx.fill();
    }
    // ضوا الكوخ
    for (const hut of game.world.structs('hut')) {
      const sx = (hut.x - cam.x) * zoom + W / 2;
      const sy = (hut.y - cam.y) * zoom + H / 2;
      const R = 150 * zoom;
      const g = ctx.createRadialGradient(sx, sy - 20 * zoom, 6, sx, sy - 20 * zoom, R);
      g.addColorStop(0, `rgba(255,200,110,${0.22 * night})`);
      g.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy - 20 * zoom, R, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // فينييت
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  // وميض الضربة
  if (game.player.hurtFlash > 0.02) {
    ctx.save();
    ctx.fillStyle = `rgba(200,20,20,${0.30 * game.player.hurtFlash})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
