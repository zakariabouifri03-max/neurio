// ── IRONVOW — procedural texture forge ───────────────────────────────────────
// Every surface in the game is painted here at runtime: stone, timber, steel,
// mail, leather, cloth, heraldry, parchment, ground. Nothing is downloaded.
import * as THREE from 'three';
import { mulberry32, clamp01, lerp, fbm, hash2, vnoise } from './mathx.js';

const cache = new Map();

function canvas(size, h = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  return c;
}

/** Wrap a draw callback into a cached THREE.CanvasTexture. */
function tex(key, w, h, draw, opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h, mulberry32(opts.seed ?? 1337));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

// ── height → normal map (Sobel) ─────────────────────────────────────────────
function normalFromCanvas(src, strength = 2.0, key) {
  if (key && cache.has(key)) return cache.get(key);
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const sd = sctx.getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const od = octx.createImageData(w, h);
  const H = (x, y) => {
    x = (x + w) % w; y = (y + h) % h;
    const i = (y * w + x) * 4;
    return (sd[i] * 0.299 + sd[i + 1] * 0.587 + sd[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) -
                 (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) -
                 (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      od.data[i] = (nx * 0.5 + 0.5) * 255;
      od.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      od.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      od.data[i + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (key) cache.set(key, t);
  return t;
}

/** Speckle / grain coat, drawn in screen space over an existing canvas. */
function grain(g, w, h, rng, count, alpha, size = 2, dark = true) {
  for (let i = 0; i < count; i++) {
    const a = alpha * rng();
    g.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    g.fillRect(rng() * w, rng() * h, size * (0.4 + rng()), size * (0.4 + rng()));
  }
}

/** Soft blob of grime, wrapping over the tile edges. */
function blob(g, w, h, x, y, r, color, alpha) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, color.replace('ALPHA', alpha));
  grd.addColorStop(1, color.replace('ALPHA', '0'));
  for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) {
    if (Math.abs(x + ox - w / 2) > w / 2 + r + 2 || Math.abs(y + oy - h / 2) > h / 2 + r + 2) continue;
    g.save(); g.translate(ox, oy);
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  STONE — ashlar masonry / rubble / flagstones
// ════════════════════════════════════════════════════════════════════════════
function drawStone(g, w, h, rng, o) {
  const rows = o.rows, cols = o.cols;
  const bh = h / rows, bw = w / cols;
  g.fillStyle = o.mortar; g.fillRect(0, 0, w, h);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    const odd = o.jitter !== 0;
    for (let c = -1; c <= cols; c++) {
      const jx = odd ? (rng() - 0.5) * bw * (o.jitter ?? 0.12) : 0;
      const jy = odd ? (rng() - 0.5) * bh * (o.jitter ?? 0.12) : 0;
      const x = c * bw + off + jx + o.gap * 0.5;
      const y = r * bh + jy + o.gap * 0.5;
      const ww = bw - o.gap, hh = bh - o.gap;
      const tone = o.tone(rng);
      g.fillStyle = tone;
      if (o.round) { g.beginPath(); g.roundRect(x, y, ww, hh, o.round); g.fill(); }
      else g.fillRect(x, y, ww, hh);
      // lit top edge + dark bottom edge for chiselled relief
      g.fillStyle = o.hi; g.fillRect(x, y, ww, Math.max(1, o.gap * 0.7));
      g.fillStyle = o.lo; g.fillRect(x, y + hh - Math.max(1, o.gap * 0.7), ww, Math.max(1, o.gap * 0.7));
      // per-block speckle & chisel pits
      const nb = 26 * (o.detail ?? 1);
      for (let i = 0; i < nb; i++) {
        g.fillStyle = rng() > 0.55 ? o.hi : o.lo;
        g.globalAlpha = 0.05 + rng() * 0.12;
        const px = x + rng() * ww, py = y + rng() * hh, s = 1 + rng() * (o.pit ?? 4);
        g.fillRect(px, py, s, s);
      }
      g.globalAlpha = 1;
    }
  }
  // weathering blobs
  for (let i = 0; i < (o.stains ?? 14); i++) {
    blob(g, w, h, rng() * w, rng() * h, (0.06 + rng() * 0.16) * w,
      o.stainColor ?? 'rgba(40,38,34,ALPHA)', 0.06 + rng() * 0.16);
  }
  grain(g, w, h, rng, 1600 * (o.detail ?? 1), 0.05, 2);
}

const STONE_PRESETS = {
  ashlar: { rows: 7, cols: 4, mortar: '#5b554c', gap: 3.4, tone: (r) => `rgb(${(122 + r() * 34) | 0},${(118 + r() * 30) | 0},${(106 + r() * 26) | 0})`, hi: '#d8d3c4', lo: '#3b3730', round: 2, seed: 11 },
    rubble: { rows: 9, cols: 6, mortar: '#4d473f', gap: 4.2, jitter: 0.42, pit: 6, tone: (r) => `rgb(${(104 + r() * 52) | 0},${(100 + r() * 46) | 0},${(90 + r() * 40) | 0})`, hi: '#c9c4b4', lo: '#332f2a', round: 5, seed: 22 },
    dungeon: { rows: 8, cols: 5, mortar: '#3a352e', gap: 4, jitter: 0.22, tone: (r) => `rgb(${(78 + r() * 30) | 0},${(76 + r() * 26) | 0},${(70 + r() * 22) | 0})`, hi: '#8d8878', lo: '#211f1b', round: 3, stains: 26, stainColor: 'rgba(26,30,24,ALPHA)', seed: 33 },
    light: { rows: 5, cols: 3, mortar: '#6d675c', gap: 3, tone: (r) => `rgb(${(168 + r() * 30) | 0},${(162 + r() * 26) | 0},${(148 + r() * 24) | 0})`, hi: '#f2eee2', lo: '#585349', round: 2, stains: 8, seed: 44 },
};

export function stoneWallTex(variant = 'ashlar') {
  const P = STONE_PRESETS[variant] || STONE_PRESETS.ashlar;
  return tex('stone_' + variant, 512, 512, (g, w, h, rng) =>
    drawStone(g, w, h, rng, { gap: 3, detail: 1, ...P }));
}

function drawFlagstones(g, w, h, rng, o) {
  g.fillStyle = o.mortar; g.fillRect(0, 0, w, h);
  const n = o.n, cell = w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // occasionally split a flag into two slabs for a hand-laid look
    const split = rng() > 0.72;
    const parts = split ? 2 : 1;
    for (let k = 0; k < parts; k++) {
      const px = x * cell + o.gap * 0.5;
      const py = y * cell + o.gap * 0.5;
      const pw = cell - o.gap;
      const ph = (cell - o.gap) / parts;
      const yy = py + k * ph;
      g.fillStyle = o.tone(rng);
      g.beginPath(); g.roundRect(px + (rng() - 0.5) * 2, yy + (rng() - 0.5) * 2, pw, ph - 1.2, 3); g.fill();
      for (let i = 0; i < 42; i++) {
        g.globalAlpha = 0.04 + rng() * 0.1;
        g.fillStyle = rng() > 0.5 ? o.hi : o.lo;
        g.fillRect(px + rng() * pw, yy + rng() * ph, 1 + rng() * 3, 1 + rng() * 3);
      }
      g.globalAlpha = 1;
    }
  }
  for (let i = 0; i < 18; i++) {
    blob(g, w, h, rng() * w, rng() * h, (0.05 + rng() * 0.2) * w, 'rgba(30,28,24,ALPHA)', 0.05 + rng() * 0.2);
  }
  grain(g, w, h, rng, 2200, 0.05, 2);
}

export function stoneFloorTex(hall = true) {
  if (hall) {
    return tex('floor_hall', 512, 512, (g, w, h, rng) => drawFlagstones(g, w, h, rng, {
      n: 4, gap: 5, mortar: '#4a453d',
      tone: (r) => `rgb(${(126 + r() * 40) | 0},${(120 + r() * 36) | 0},${(108 + r() * 30) | 0})`,
      hi: '#cdc8b8', lo: '#3a3630',
    }));
  }
  return tex('floor_dungeon', 512, 512, (g, w, h, rng) => drawFlagstones(g, w, h, rng, {
    n: 5, gap: 6, mortar: '#2f2b26',
    tone: (r) => `rgb(${(76 + r() * 32) | 0},${(74 + r() * 28) | 0},${(68 + r() * 24) | 0})`,
    hi: '#8b8674', lo: '#1d1b18',
  }));
}
export function sandTex() {
  return tex('ground_sand', 512, 512, (g, w, h, rng) => {
    g.fillStyle = '#9c8a68'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${(150 + rng() * 70) | 0},${(134 + rng() * 60) | 0},${(100 + rng() * 50) | 0},${0.2 + rng() * 0.5})`;
      g.fillRect(rng() * w, rng() * h, 1 + rng() * 2.4, 1 + rng() * 2.4);
    }
    for (let i = 0; i < 40; i++) blob(g, w, h, rng() * w, rng() * h, rng() * 90, 'rgba(96,80,58,ALPHA)', 0.05 + rng() * 0.14);
    // raked tracking lines
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(70,58,42,${0.03 + rng() * 0.07})`;
      g.lineWidth = 1 + rng() * 3;
      g.beginPath(); const y = rng() * h;
      g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (rng() - 0.5) * 34, w * 0.7, y + (rng() - 0.5) * 34, w, y); g.stroke();
    }
    grain(g, w, h, rng, 900, 0.05, 1.6);
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  TIMBER
// ════════════════════════════════════════════════════════════════════════════
function drawWood(g, w, h, rng, o) {
  g.fillStyle = o.base; g.fillRect(0, 0, w, h);
  const planks = o.planks;
  const pw = w / planks;
  for (let p = 0; p < planks; p++) {
    const x = p * pw;
    const t = rng();
    g.fillStyle = `rgba(${o.tint[0] * (0.86 + t * 0.28) | 0},${o.tint[1] * (0.86 + t * 0.28) | 0},${o.tint[2] * (0.86 + t * 0.28) | 0},1)`;
    g.fillRect(x + 1, 0, pw - 2, h);
    // grain lines
    for (let i = 0; i < 46; i++) {
      const gx = x + 2 + rng() * (pw - 4);
      g.globalAlpha = 0.05 + rng() * 0.16;
      g.strokeStyle = rng() > 0.5 ? o.dark : o.light;
      g.lineWidth = 0.6 + rng() * 1.7;
      g.beginPath();
      let y = 0, xx = gx;
      g.moveTo(xx, y);
      while (y < h) { y += 16 + rng() * 26; xx += (rng() - 0.5) * 5; g.lineTo(xx, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
    // knots
    const nk = rng() > 0.6 ? 1 : 0;
    for (let k = 0; k < nk; k++) {
      const kx = x + 6 + rng() * (pw - 12), ky = rng() * h, kr = 4 + rng() * 9;
      for (let r = kr; r > 0; r -= 1.6) {
        g.strokeStyle = `rgba(${o.tint[0] * 0.5 | 0},${o.tint[1] * 0.45 | 0},${o.tint[2] * 0.4 | 0},${0.1 + rng() * 0.25})`;
        g.lineWidth = 1.2;
        g.beginPath(); g.ellipse(kx, ky, r, r * 0.62, rng() * 0.6, 0, Math.PI * 2); g.stroke();
      }
    }
    // plank seam
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, 0, 1.6, h);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x + 1.6, 0, 1.2, h);
  }
  if (o.beams) for (let i = 0; i < o.beams; i++) {
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, rng() * h, w, 3 + rng() * 6);
  }
  grain(g, w, h, rng, 700, 0.05, 2, false);
}

export function woodTex(kind = 'oak') {
  const P = {
    oak: { base: '#6b4b2a', tint: [122, 86, 48], dark: '#3a2614', light: '#c19a68', planks: 4 },
    dark: { base: '#42291a', tint: [84, 56, 36], dark: '#241209', light: '#8a6642', planks: 5 },
    pale: { base: '#a9865a', tint: [186, 152, 104], dark: '#6b4d2c', light: '#e4cfa8', planks: 3 },
    char: { base: '#241f1c', tint: [58, 48, 42], dark: '#120f0d', light: '#5c4f45', planks: 6 },
  }[kind];
  return tex('wood_' + kind, 512, 512, (g, w, h, rng) => drawWood(g, w, h, rng, P));
}
export function plankTex() {
  return tex('wood_planks_h', 256, 1024, (g, w, h, rng) => drawWood(g, w, h, rng, {
    base: '#5a3f24', tint: [112, 78, 44], dark: '#331f10', light: '#b98f5c', planks: 3,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
//  METAL
// ════════════════════════════════════════════════════════════════════════════
function drawMetal(g, w, h, rng, o) {
  g.fillStyle = o.base; g.fillRect(0, 0, w, h);
  // brushed streaks
  for (let i = 0; i < 900; i++) {
    const y = rng() * h, len = 20 + rng() * 180;
    g.strokeStyle = rng() > 0.5 ? `rgba(255,255,255,${rng() * 0.06})` : `rgba(0,0,0,${rng() * 0.07})`;
    g.lineWidth = 0.5 + rng() * 1.4;
    g.beginPath(); g.moveTo(rng() * w, y); g.lineTo(rng() * w + len, y + (rng() - 0.5) * 3); g.stroke();
  }
  // hammer dents
  for (let i = 0; i < (o.dents ?? 40); i++) {
    const x = rng() * w, y = rng() * h, r = 3 + rng() * 12;
    const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.10)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.05)');
    grd.addColorStop(1, 'rgba(0,0,0,0.14)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // rust blooms
  for (let i = 0; i < (o.rust ?? 10); i++) {
    blob(g, w, h, rng() * w, rng() * h, (0.03 + rng() * 0.12) * w, `rgba(${128 + rng() * 40 | 0},62,26,ALPHA)`, 0.1 + rng() * 0.4);
  }
  grain(g, w, h, rng, 600, 0.04, 1.5);
}

export function metalTex(kind = 'steel') {
  const P = {
    steel: { base: '#b9bec4', dents: 34, rust: 6 },
    iron: { base: '#8e939a', dents: 60, rust: 22 },
    black: { base: '#4a4e55', dents: 44, rust: 14 },
    brass: { base: '#c09548', dents: 22, rust: 4 },
    bronze: { base: '#a97a46', dents: 26, rust: 8 },
  }[kind];
  return tex('metal_' + kind, 256, 256, (g, w, h, rng) => drawMetal(g, w, h, rng, P));
}

export function mailTex() {
  return tex('mail', 256, 256, (g, w, h, rng) => {
    g.fillStyle = '#23262b'; g.fillRect(0, 0, w, h);
    const r = 11, step = r * 2;
    for (let y = 0; y < h / step + 1; y++) {
      for (let x = 0; x < w / step + 1; x++) {
        const cx = x * step + (y % 2 ? r : 0), cy = y * step * 0.86;
        const grd = g.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 1, cx, cy, r);
        const v = 130 + rng() * 90;
        grd.addColorStop(0, `rgb(${v + 40 | 0},${v + 44 | 0},${v + 48 | 0})`);
        grd.addColorStop(0.55, `rgb(${v | 0},${v + 2 | 0},${v + 6 | 0})`);
        grd.addColorStop(1, 'rgb(20,22,26)');
        g.strokeStyle = grd; g.lineWidth = 3.1;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1;
        g.beginPath(); g.arc(cx + 1, cy + 1, r, 3.4, 5.2); g.stroke();
      }
    }
    grain(g, w, h, rng, 300, 0.08, 2);
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  LEATHER / CLOTH / BANNER
// ════════════════════════════════════════════════════════════════════════════
export function leatherTex(kind = 'brown') {
  const base = { brown: [92, 60, 34], black: [44, 40, 38], tan: [146, 106, 62] }[kind] || [92, 60, 34];
  return tex('leather_' + kind, 256, 256, (g, w, h, rng) => {
    g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      g.fillStyle = v > 0.5 ? `rgba(${base[0] + 46},${base[1] + 40},${base[2] + 34},${0.05 + rng() * 0.16})`
                            : `rgba(${base[0] * 0.5 | 0},${base[1] * 0.5 | 0},${base[2] * 0.5 | 0},${0.05 + rng() * 0.2})`;
      const s = 1 + rng() * 2.6;
      g.fillRect(rng() * w, rng() * h, s, s * 0.8);
    }
    // pebbled pores
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.12})`;
      g.beginPath(); g.arc(rng() * w, rng() * h, 1 + rng() * 2.2, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 8; i++) blob(g, w, h, rng() * w, rng() * h, 20 + rng() * 50, 'rgba(20,10,4,ALPHA)', 0.06 + rng() * 0.14);
  });
}

export function clothTex(color = [80, 34, 30], weave = 5) {
  const key = 'cloth_' + color.join('_') + '_' + weave;
  return tex(key, 256, 256, (g, w, h, rng) => {
    g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += weave) {
      g.fillStyle = `rgba(0,0,0,${0.06 + rng() * 0.06})`; g.fillRect(0, y, w, weave * 0.45);
    }
    for (let x = 0; x < w; x += weave) {
      g.fillStyle = `rgba(255,255,255,${0.03 + rng() * 0.05})`; g.fillRect(x, 0, weave * 0.4, h);
    }
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = rng() > 0.5 ? `rgba(255,255,255,${rng() * 0.07})` : `rgba(0,0,0,${rng() * 0.09})`;
      g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
    }
    for (let i = 0; i < 10; i++) blob(g, w, h, rng() * w, rng() * h, 16 + rng() * 44, 'rgba(0,0,0,ALPHA)', 0.04 + rng() * 0.1);
  });
}

/** Heraldic banner: field + our original house sigils, drawn procedurally. */
export function bannerTex(house = 'ashcombe') {
  return tex('banner_' + house, 256, 512, (g, w, h, rng) => {
    const H = {
      ashcombe: { field: [58, 26, 24], accent: '#d8cdb4' },
      vare: { field: [26, 34, 52], accent: '#e6ddc6' },
      thorn: { field: [30, 40, 28], accent: '#d5c9a6' },
      ember: { field: [64, 34, 16], accent: '#f0e0bc' },
      rook: { field: [22, 22, 26], accent: '#cfc4a6' },
    }[house] || { field: [58, 26, 24], accent: '#d8cdb4' };
    const c = H.field;
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(0, 0, w, h);
    // weave + vertical fold shading
    for (let x = 0; x < w; x += 4) { g.fillStyle = `rgba(0,0,0,${0.04 + 0.05 * Math.abs(Math.sin(x * 0.11))})`; g.fillRect(x, 0, 2, h); }
    g.fillStyle = H.accent;
    // sigil: broken sword over chevron
    const cx = w / 2;
    g.globalAlpha = 0.92;
    // chevron
    g.beginPath();
    g.moveTo(cx - w * 0.34, h * 0.30); g.lineTo(cx, h * 0.44); g.lineTo(cx + w * 0.34, h * 0.30);
    g.lineTo(cx + w * 0.34, h * 0.40); g.lineTo(cx, h * 0.54); g.lineTo(cx - w * 0.34, h * 0.40);
    g.closePath(); g.fill();
    // blade (broken)
    g.fillRect(cx - 7, h * 0.20, 14, h * 0.30);
    g.fillRect(cx - 7, h * 0.555, 14, h * 0.10);
    // crossguard + pommel
    g.fillRect(cx - 42, h * 0.185, 84, 11);
    g.beginPath(); g.arc(cx, h * 0.145, 15, 0, Math.PI * 2); g.fill();
    // three drops (original mark)
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(cx + i * 52, h * 0.60);
      g.lineTo(cx + i * 52 + 12, h * 0.72);
      g.lineTo(cx + i * 52 - 12, h * 0.72);
      g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    // hem band + tatter
    g.fillStyle = `rgba(0,0,0,0.35)`; g.fillRect(0, h - 26, w, 26);
    g.fillStyle = H.accent; g.fillRect(0, h - 30, w, 4);
    grain(g, w, h, rng, 500, 0.07, 2);
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  PARCHMENT / UI / VIGNETTE
// ════════════════════════════════════════════════════════════════════════════
export function parchmentTex() {
  return tex('parchment', 512, 512, (g, w, h, rng) => {
    g.fillStyle = '#d9c8a4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) blob(g, w, h, rng() * w, rng() * h, 30 + rng() * 120, `rgba(${150 + rng() * 40 | 0},${126 + rng() * 30 | 0},${86 + rng() * 30 | 0},ALPHA)`, 0.1 + rng() * 0.3);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = rng() > 0.5 ? `rgba(120,96,60,${rng() * 0.10})` : `rgba(255,246,220,${rng() * 0.10})`;
      g.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3);
    }
    // fibre hairs
    for (let i = 0; i < 300; i++) {
      g.strokeStyle = `rgba(150,126,88,${0.05 + rng() * 0.12})`;
      g.lineWidth = 0.6 + rng();
      g.beginPath(); const x = rng() * w, y = rng() * h;
      g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 40, y + (rng() - 0.5) * 40); g.stroke();
    }
    // burnt edges
    const edge = 40;
    for (const [ax, ay, bx, by] of [[0, 0, w, edge], [0, h - edge, w, h], [0, 0, edge, h], [w - edge, 0, w, h]]) {
      const grd = g.createLinearGradient(ax, ay, bx, by);
      grd.addColorStop(0, 'rgba(74,48,22,0.55)'); grd.addColorStop(1, 'rgba(74,48,22,0)');
      g.fillStyle = grd; g.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) || edge, Math.abs(by - ay) || edge);
    }
  });
}

export function sigilTex(house = 'ashcombe') {
  return tex('crest_' + house, 256, 256, (g, w, h, rng) => {
    g.clearRect(0, 0, w, h);
    const H = {
      ashcombe: { field: '#3a1a18', accent: '#d8cdb4' },
      vare: { field: '#1a2234', accent: '#e6ddc6' },
      thorn: { field: '#1e281c', accent: '#d5c9a6' },
      ember: { field: '#40220f', accent: '#f0e0bc' },
      rook: { field: '#161618', accent: '#cfc4a6' },
    }[house];
    // escutcheon
    g.beginPath();
    g.moveTo(w * 0.12, h * 0.10); g.lineTo(w * 0.88, h * 0.10);
    g.lineTo(w * 0.88, h * 0.58);
    g.quadraticCurveTo(w * 0.88, h * 0.90, w * 0.5, h * 0.96);
    g.quadraticCurveTo(w * 0.12, h * 0.90, w * 0.12, h * 0.58);
    g.closePath();
    g.fillStyle = H.field; g.fill();
    g.strokeStyle = H.accent; g.lineWidth = 7; g.stroke();
    g.save(); g.clip();
    g.fillStyle = H.accent;
    g.beginPath();
    g.moveTo(w * 0.16, h * 0.34); g.lineTo(w * 0.5, h * 0.46); g.lineTo(w * 0.84, h * 0.34);
    g.lineTo(w * 0.84, h * 0.44); g.lineTo(w * 0.5, h * 0.56); g.lineTo(w * 0.16, h * 0.44);
    g.closePath(); g.fill();
    g.fillRect(w * 0.465, h * 0.24, 17, h * 0.30);
    g.fillRect(w * 0.465, h * 0.60, 17, h * 0.13);
    g.fillRect(w * 0.34, h * 0.225, 82, 12);
    g.beginPath(); g.arc(w * 0.5, h * 0.185, 15, 0, Math.PI * 2); g.fill();
    g.restore();
  });
}

/** Radial vignette + blood-spatter overlay used by the HUD. */
export function vignetteTex() {
  return tex('vig', 256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.22, w / 2, h / 2, w * 0.62);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.92)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { linear: true });
}

// ════════════════════════════════════════════════════════════════════════════
//  MATERIAL LIBRARY — ready-to-use three materials
// ════════════════════════════════════════════════════════════════════════════
const matCache = new Map();
function cached(key, make) { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); }

export function stoneMat(variant = 'ashlar', repeat = [1, 1], tint = 0xffffff) {
  const k = `stone_${variant}_${repeat}_${tint}`;
  return cached(k, () => {
    const map = stoneWallTex(variant === 'rubble' || variant === 'dungeon' || variant === 'light' ? variant : 'ashlar');
    const m = new THREE.MeshStandardMaterial({
      map, color: tint, roughness: variant === 'dungeon' ? 0.97 : 0.9, metalness: 0.02,
    });
    m.map = map.clone(); m.map.repeat.set(repeat[0], repeat[1]); m.map.needsUpdate = true;
    m.normalMap = normalFromCanvas(m.map.image, variant === 'rubble' ? 2.6 : 2.0, 'n_' + k);
    m.normalScale.set(0.85, 0.85);
    return m;
  });
}

export function floorMat(hall = true, repeat = [1, 1]) {
  const k = `floor_${hall}_${repeat}`;
  return cached(k, () => {
    const map = stoneFloorTex(hall).clone();
    map.repeat.set(repeat[0], repeat[1]); map.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0.03, color: 0xffffff });
    m.normalMap = normalFromCanvas(map.image, 1.6, 'n_' + k);
    return m;
  });
}

export function woodMat(kind = 'oak', repeat = [1, 1]) {
  const k = `wood_${kind}_${repeat}`;
  return cached(k, () => {
    const map = woodTex(kind).clone();
    map.repeat.set(repeat[0], repeat[1]); map.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.86, metalness: 0.0 });
    m.normalMap = normalFromCanvas(map.image, 0.9, 'n_' + k);
    return m;
  });
}

export function metalMat(kind = 'steel', repeat = [1, 1], rough = 0.32) {
  const k = `metal_${kind}_${repeat}_${rough}`;
  return cached(k, () => {
    const map = metalTex(kind).clone();
    map.repeat.set(repeat[0], repeat[1]); map.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0.92 });
    m.normalMap = normalFromCanvas(map.image, 1.1, 'n_' + k);
    return m;
  });
}

export function mailMat() {
  return cached('mailMat', () => {
    const map = mailTex().clone(); map.repeat.set(6, 6); map.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.36, metalness: 0.95, normalMap: normalFromCanvas(map.image, 1.4, 'n_mail') });
    return m;
  });
}

export function leatherMat(kind = 'brown', repeat = [1, 1]) {
  const k = `leather_${kind}_${repeat}`;
  return cached(k, () => {
    const map = leatherTex(kind).clone(); map.repeat.set(repeat[0], repeat[1]); map.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.74, metalness: 0.02 });
    m.normalMap = normalFromCanvas(map.image, 1.3, 'n_' + k);
    return m;
  });
}

export function clothMat(color, repeat = [1, 1]) {
  const k = `cloth_${color}_${repeat}`;
  return cached(k, () => {
    const map = clothTex(color).clone(); map.repeat.set(repeat[0], repeat[1]); map.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0.0 });
    m.normalMap = normalFromCanvas(map.image, 1.5, 'n_' + k);
    return m;
  });
}

export function bannerMat(house) {
  return cached('bannerM_' + house, () => new THREE.MeshStandardMaterial({
    map: bannerTex(house), roughness: 0.94, metalness: 0, side: THREE.DoubleSide,
  }));
}

export function parchmentMat() {
  return cached('parchM', () => new THREE.MeshStandardMaterial({ map: parchmentTex(), roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
}
export function flatMat(color, rough = 0.8, metal = 0) {
  return cached(`flat_${color}_${rough}_${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
}
export { normalFromCanvas };
