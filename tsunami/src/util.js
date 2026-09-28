// util.js — math, noise, procedural textures & geometry helpers
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => { const t = clamp(invLerp(a, b, v), 0, 1); return t * t * (3 - 2 * t); };
export const clamp01 = (v) => clamp(v, 0, 1);
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
/** frame-rate independent smoothing */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const dampAngle = (a, b, lambda, dt) => a + shortAngle(a, b) * (1 - Math.exp(-lambda * dt));
export function shortAngle(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
export const rand = (rng, a, b) => a + (b - a) * rng();
export const pick = (rng, arr) => arr[(rng() * arr.length) | 0];

/* ---------------------------------------------------------------- random */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- noise */
export class Noise {
  constructor(seed = 1337) {
    const rng = mulberry32(seed);
    this.p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }
  grad(hash, x, y) {
    switch (hash & 3) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; default: return -x - y;
    }
  }
  /** value noise in [-1,1] */
  n2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const p = this.p;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const h = (i) => (i / 255) * 2 - 1;
    const x1 = lerp(h(aa), h(ba), u), x2 = lerp(h(ab), h(bb), u);
    return lerp(x1, x2, v);
  }
  fbm(x, y, oct = 4, lac = 2.02, gain = 0.5) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.n2(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  ridged(x, y, oct = 4, lac = 2.05, gain = 0.5) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(this.n2(x * f, y * f))); n += a; a *= gain; f *= lac; }
    return s / n;
  }
}

/* ---------------------------------------------------------------- canvas */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
export function ctx2d(w, h) { const c = makeCanvas(w, h); return { c, x: c.getContext('2d') }; }

let MAXANISO = 4;
export function setMaxAniso(v) { MAXANISO = v; }
export function texFromCanvas(canvas, { repeat = [1, 1], srgb = false, aniso = 0, wrap = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso || MAXANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** sobel height→normal */
export function heightToNormal(srcCanvas, strength = 2.2) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const src = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const { c, x } = ctx2d(w, h);
  const out = x.createImageData(w, h);
  const at = (px, py) => src[(((py + h) % h) * w + ((px + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let px = 0; px < w; px++) {
      const dx = (at(px + 1, y) - at(px - 1, y)) * strength;
      const dy = (at(px, y + 1) - at(px, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * w + px) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  x.putImageData(out, 0, 0);
  return c;
}

/* --------------------------------------------------- material generator */
function fbmCanvas(w, h, noise, { scale = 8, oct = 5, gain = 0.5, contrast = 1, bias = 0 }) {
  const { c, x } = ctx2d(w, h);
  const img = x.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let px = 0; px < w; px++) {
    // tileable by sampling on a torus of the noise field
    const u = px / w, v = y / h;
    let n = noise.fbm(Math.cos(u * TAU) * scale, Math.sin(u * TAU) * scale, oct, 2.02, gain) * 0.5
      + noise.fbm(Math.cos(v * TAU) * scale + 31.7, Math.sin(v * TAU) * scale + 11.3, oct, 2.02, gain) * 0.5;
    n = clamp01((n * 0.5 + 0.5 + bias) * contrast);
    const i = (y * w + px) * 4;
    const g = (n * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/**
 * Procedural surface textures — returns {map, normalMap, roughnessMap}
 * kind: sand | grass | drygrass | rock | dirt | snow | asphalt | concrete | plaster | tile | wood | thatch | metal | gravel | bark
 */
export function surfaceTex(kind, seed = 7, size = 256) {
  const nz = new Noise(seed);
  const { c, x } = ctx2d(size, size);
  const rng = mulberry32(seed * 31 + 5);
  let rough = 0.85, hgt;

  const grain = (amount = 0.06, density = 0.5) => {
    const img = x.getImageData(0, 0, size, size); const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = (rng() - 0.5) * 255 * amount * (rng() < density ? 1 : 0.3);
      d[i] = clamp(d[i] + g, 0, 255); d[i + 1] = clamp(d[i + 1] + g, 0, 255); d[i + 2] = clamp(d[i + 2] + g, 0, 255);
    }
    x.putImageData(img, 0, 0);
  };
  const baseFill = (r, g, b) => { x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, size, size); };
  const blobs = (count, rMin, rMax, colors, alpha = 1) => {
    for (let i = 0; i < count; i++) {
      const cx = rng() * size, cy = rng() * size, r = rand(rng, rMin, rMax);
      const cc = pick(rng, colors);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${cc[0]},${cc[1]},${cc[2]},${alpha})`);
      g.addColorStop(1, `rgba(${cc[0]},${cc[1]},${cc[2]},0)`);
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    }
  };

  switch (kind) {
    case 'sand': {
      baseFill(214, 190, 148);
      hgt = fbmCanvas(size, size, nz, { scale: 3, oct: 5, contrast: 1.1 });
      x.globalAlpha = 0.16; x.drawImage(hgt, 0, 0); x.globalAlpha = 1;
      // ripples
      for (let i = 0; i < 26; i++) {
        x.strokeStyle = `rgba(180,152,110,${0.05 + rng() * 0.1})`; x.lineWidth = 1 + rng() * 2;
        x.beginPath();
        const y0 = rng() * size;
        for (let px = 0; px <= size; px += 8) x.lineTo(px, y0 + Math.sin(px * 0.05 + i) * 5 + nz.fbm(px * 0.03, i, 2) * 6);
        x.stroke();
      }
      grain(0.22, 0.9); rough = 0.92; break;
    }
    case 'grass': {
      baseFill(74, 96, 52);
      blobs(90, 8, 34, [[56, 78, 40], [92, 116, 60], [64, 88, 46], [110, 130, 70]], 0.6);
      hgt = fbmCanvas(size, size, nz, { scale: 10, oct: 5, contrast: 1.2 });
      x.globalAlpha = 0.25; x.drawImage(hgt, 0, 0); x.globalAlpha = 1;
      for (let i = 0; i < 2600; i++) {
        const px = rng() * size, py = rng() * size, l = 2 + rng() * 5, a = -Math.PI / 2 + (rng() - 0.5) * 1.5;
        const g = 40 + rng() * 70;
        x.strokeStyle = `rgba(${(g * 0.55) | 0},${g | 0},${(g * 0.42) | 0},0.75)`; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
      }
      rough = 0.85; break;
    }
    case 'drygrass': {
      baseFill(138, 120, 70);
      blobs(80, 8, 30, [[120, 104, 58], [160, 142, 84], [104, 96, 52], [178, 160, 100]], 0.6);
      for (let i = 0; i < 2000; i++) {
        const px = rng() * size, py = rng() * size, l = 3 + rng() * 6, a = -Math.PI / 2 + (rng() - 0.5) * 1.4;
        const g = 120 + rng() * 90;
        x.strokeStyle = `rgba(${g | 0},${(g * 0.86) | 0},${(g * 0.5) | 0},0.6)`; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
      }
      rough = 0.9; break;
    }
    case 'rock': {
      baseFill(112, 108, 104);
      hgt = fbmCanvas(size, size, nz, { scale: 6, oct: 6, contrast: 1.7 });
      x.globalAlpha = 0.75; x.drawImage(hgt, 0, 0); x.globalAlpha = 1;
      blobs(60, 6, 30, [[86, 84, 82], [140, 134, 128], [98, 96, 96]], 0.5);
      // strata cracks
      for (let i = 0; i < 22; i++) {
        x.strokeStyle = `rgba(52,50,48,${0.15 + rng() * 0.3})`; x.lineWidth = 1 + rng() * 1.5;
        x.beginPath(); let px = rng() * size, py = rng() * size;
        x.moveTo(px, py);
        for (let s = 0; s < 6; s++) { px += (rng() - 0.5) * 40; py += (rng() - 0.5) * 40; x.lineTo(px, py); }
        x.stroke();
      }
      grain(0.12, 1); rough = 0.95; break;
    }
    case 'gravel': {
      baseFill(126, 120, 112);
      for (let i = 0; i < 900; i++) {
        const px = rng() * size, py = rng() * size, r = 2 + rng() * 7, g = 90 + rng() * 90;
        x.fillStyle = `rgba(${g | 0},${(g * 0.97) | 0},${(g * 0.9) | 0},${0.35 + rng() * 0.5})`;
        x.beginPath(); x.ellipse(px, py, r, r * (0.6 + rng() * 0.6), rng() * 3, 0, TAU); x.fill();
      }
      grain(0.16, 1); rough = 0.95; break;
    }
    case 'dirt': {
      baseFill(118, 92, 66);
      blobs(70, 10, 40, [[100, 76, 52], [138, 110, 80], [86, 66, 46]], 0.6);
      hgt = fbmCanvas(size, size, nz, { scale: 4, oct: 5, contrast: 1.2 });
      x.globalAlpha = 0.3; x.drawImage(hgt, 0, 0); x.globalAlpha = 1;
      grain(0.2, 0.8); rough = 0.93; break;
    }
    case 'snow': {
      baseFill(232, 238, 246);
      blobs(50, 10, 40, [[212, 222, 238], [250, 252, 255]], 0.7);
      grain(0.05, 1); rough = 0.6; break;
    }
    case 'asphalt': {
      baseFill(62, 62, 66);
      grain(0.3, 1);
      for (let i = 0; i < 400; i++) {
        const px = rng() * size, py = rng() * size, r = 1 + rng() * 4, g = 70 + rng() * 70;
        x.fillStyle = `rgba(${g},${g},${g + 4},${0.1 + rng() * 0.25})`;
        x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
      }
      rough = 0.8; break;
    }
    case 'concrete': {
      baseFill(176, 172, 166);
      blobs(40, 12, 44, [[162, 158, 152], [190, 186, 180]], 0.6);
      grain(0.08, 1);
      for (let i = 0; i < 12; i++) { // seams
        x.strokeStyle = 'rgba(120,116,112,0.5)'; x.lineWidth = 1;
        const px = rng() * size; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, size); x.stroke();
      }
      rough = 0.88; break;
    }
    case 'plaster': {
      const tint = pick(rng, [[236, 228, 210], [226, 206, 176], [214, 196, 172], [242, 236, 224], [206, 176, 150]]);
      baseFill(tint[0], tint[1], tint[2]);
      hgt = fbmCanvas(size, size, nz, { scale: 8, oct: 5, contrast: 1.1 });
      x.globalAlpha = 0.2; x.drawImage(hgt, 0, 0); x.globalAlpha = 1;
      grain(0.09, 1);
      // stains / weathering at the bottom
      const g = x.createLinearGradient(0, size * 0.55, 0, size);
      g.addColorStop(0, 'rgba(120,110,92,0)'); g.addColorStop(1, 'rgba(104,96,78,0.35)');
      x.fillStyle = g; x.fillRect(0, 0, size, size);
      rough = 0.9; break;
    }
    case 'tile': { // moroccan roof tiles — rows of half-rounds
      baseFill(150, 84, 62);
      const rows = 8, cols = 10, rh = size / rows, cw = size / cols;
      for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
        const jitter = (rng() - 0.5) * 16;
        const rr = 128 + jitter * 2, gg = 70 + jitter, bb = 52 + jitter * 0.6;
        const g2 = x.createLinearGradient(c2 * cw, r * rh, c2 * cw + cw, r * rh);
        g2.addColorStop(0, `rgb(${clamp(rr - 40, 0, 255) | 0},${clamp(gg - 24, 0, 255) | 0},${clamp(bb - 18, 0, 255) | 0})`);
        g2.addColorStop(0.45, `rgb(${clamp(rr, 0, 255) | 0},${clamp(gg, 0, 255) | 0},${clamp(bb, 0, 255) | 0})`);
        g2.addColorStop(1, `rgb(${clamp(rr - 60, 0, 255) | 0},${clamp(gg - 40, 0, 255) | 0},${clamp(bb - 28, 0, 255) | 0})`);
        x.fillStyle = g2;
        x.beginPath();
        x.ellipse(c2 * cw + cw / 2, r * rh + rh / 2, cw * 0.46, rh * 0.62, 0, 0, TAU); x.fill();
      }
      grain(0.1, 1); rough = 0.7; break;
    }
    case 'wood': {
      baseFill(126, 92, 58);
      const planks = 6, ph = size / planks;
      for (let p2 = 0; p2 < planks; p2++) {
        const t = 100 + rng() * 50;
        x.fillStyle = `rgb(${t | 0},${(t * 0.72) | 0},${(t * 0.45) | 0})`;
        x.fillRect(0, p2 * ph + 1, size, ph - 2);
        for (let i = 0; i < 14; i++) { // grain lines
          x.strokeStyle = `rgba(${(t * 0.55) | 0},${(t * 0.36) | 0},${(t * 0.2) | 0},0.4)`; x.lineWidth = 1;
          const y0 = p2 * ph + rng() * ph;
          x.beginPath(); x.moveTo(0, y0);
          for (let px = 0; px <= size; px += 16) x.lineTo(px, y0 + Math.sin(px * 0.05 + p2) * 1.6);
          x.stroke();
        }
        for (let i = 0; i < 3; i++) if (rng() < 0.5) { // knots
          const kx = rng() * size, ky = p2 * ph + rng() * ph;
          x.fillStyle = 'rgba(80,54,32,0.65)'; x.beginPath(); x.ellipse(kx, ky, 3 + rng() * 3, 2 + rng() * 2, 0, 0, TAU); x.fill();
        }
        x.fillStyle = 'rgba(60,42,26,0.5)'; x.fillRect(0, p2 * ph, size, 2);
      }
      rough = 0.75; break;
    }
    case 'thatch': {
      baseFill(168, 140, 84);
      for (let i = 0; i < 2400; i++) {
        const px = rng() * size, py = rng() * size, l = 6 + rng() * 14, a = -Math.PI / 2 + (rng() - 0.5) * 0.9;
        const g = 120 + rng() * 90;
        x.strokeStyle = `rgba(${g | 0},${(g * 0.82) | 0},${(g * 0.45) | 0},0.55)`; x.lineWidth = 1 + rng();
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
      }
      rough = 0.95; break;
    }
    case 'metal': {
      baseFill(146, 150, 156);
      grain(0.07, 1);
      for (let i = 0; i < 60; i++) {
        x.strokeStyle = `rgba(${100 + rng() * 80},${90 + rng() * 60},${70 + rng() * 40},${0.05 + rng() * 0.12})`;
        x.lineWidth = 1 + rng() * 2; const y0 = rng() * size;
        x.beginPath(); x.moveTo(0, y0); x.lineTo(size, y0 + (rng() - 0.5) * 8); x.stroke();
      }
      rough = 0.42; break;
    }
    case 'bark': {
      baseFill(96, 74, 56);
      for (let i = 0; i < 220; i++) {
        const px = rng() * size, w2 = 2 + rng() * 8, hh = 20 + rng() * 90;
        x.fillStyle = `rgba(${60 + rng() * 60},${44 + rng() * 44},${32 + rng() * 30},${0.25 + rng() * 0.4})`;
        x.fillRect(px, rng() * size, w2, hh);
      }
      grain(0.14, 1); rough = 0.9; break;
    }
    default: { baseFill(150, 150, 150); grain(0.1, 1); }
  }

  // height reference for normal map: use the color luminance of what we drew (works well for gravel/wood/rock)
  const lum = ctx2d(size, size);
  lum.x.drawImage(c, 0, 0);
  const normalMap = heightToNormal(c, kind === 'rock' ? 1.6 : kind === 'gravel' ? 1.2 : 0.7);

  const map = texFromCanvas(c, { srgb: true });
  const nm = texFromCanvas(normalMap);
  // roughness map = desaturated contrast of color
  const rc = ctx2d(size, size);
  rc.x.drawImage(c, 0, 0);
  const rd = rc.x.getImageData(0, 0, size, size);
  for (let i = 0; i < rd.data.length; i += 4) {
    const g = (rd.data[i] * 0.3 + rd.data[i + 1] * 0.59 + rd.data[i + 2] * 0.11);
    const v = clamp((rough * 255) + (g - 128) * 0.35, 0, 255);
    rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = v;
  }
  rc.x.putImageData(rd, 0, 0);
  const rm = texFromCanvas(rc.c);
  return { map, normalMap: nm, roughnessMap: rm };
}

/* ---------------------------------------------------------------- geometry */
export function roundedBox(w, h, d, r = 0.05, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = clamp(v.x, -hx, hx), cy = clamp(v.y, -hy, hy), cz = clamp(v.z, -hz, hz);
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const l = Math.hypot(dx, dy, dz);
    if (l > 1e-6) { v.x = cx + (dx / l) * r; v.y = cy + (dy / l) * r; v.z = cz + (dz / l) * r; }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function mergeGeos(geos) {
  const valid = geos.filter(Boolean);
  if (!valid.length) return null;
  return mergeGeometries(valid.map((g) => {
    if (g.index) return g;
    const ng = g.clone();
    return ng;
  }), false);
}

/** apply a matrix to a geometry (clone) */
export function xf(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    new THREE.Vector3(scale[0], scale[1], scale[2])
  );
  const g = geo.clone();
  g.applyMatrix4(m);
  return g;
}

/** paint a geometry with a flat vertex colour */
export function colorGeo(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Camera-shake helper */
export class Shake {
  constructor() { this.trauma = 0; this.t = 0; }
  add(v) { this.trauma = clamp(this.trauma + v, 0, 1.2); }
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 0.55);
    const s = this.trauma * this.trauma;
    const n = (a, b) => Math.sin(this.t * a) * Math.cos(this.t * b);
    return { x: n(27.3, 11.1) * s, y: n(31.7, 13.9) * s, z: n(23.1, 17.3) * s, r: n(19.7, 29.3) * s * 0.6, mag: s };
  }
}
