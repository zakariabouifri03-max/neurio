// ── BOOYAH FIRE — canvas textures (all procedural, no image files) ───────────
// Every helper degrades to `null` outside the browser so the game logic can be
// smoke-tested headlessly in Node.

const hasDOM = typeof document !== 'undefined';
const cache = new Map();

function canvas(w, h) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function texCanvas(key, w, h, draw) {
  if (!hasDOM) return null;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h);
  draw(c.getContext('2d'), w, h);
  const t = THREE_CanvasTexture(c);
  cache.set(key, t);
  return t;
}

// late-bound to avoid importing three in this tiny module
let THREE_CanvasTexture = function (c) { return c; };

export function bindThree(THREE) {
  THREE_CanvasTexture = function (c) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
}

// ── a rounded-rect toolbox ──────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── ground/terrain detail texture (tiling) ───────────────────────────────────
export function grassTex() {
  return texCanvas('grass', 256, 256, (g, w, h) => {
    g.fillStyle = '#5d8a3c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const s = 1 + Math.random() * 3;
      g.fillStyle = `rgba(${90 + Math.random() * 70 | 0},${120 + Math.random() * 60 | 0},${45 + Math.random() * 40 | 0},0.5)`;
      g.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(70,110,45,${0.15 + Math.random() * 0.2})`;
      g.lineWidth = 1 + Math.random() * 2;
      const x = Math.random() * w, y = Math.random() * h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30); g.stroke();
    }
  });
}

export function sandTex() {
  return texCanvas('sand', 256, 256, (g, w, h) => {
    g.fillStyle = '#e0c98d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${200 + Math.random() * 45 | 0},${180 + Math.random() * 45 | 0},${130 + Math.random() * 45 | 0},0.55)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

export function concreteTex(base = '#9aa0a6', spec = '#7d848b') {
  return texCanvas('concrete' + base, 256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6);
    }
    g.strokeStyle = spec; g.globalAlpha = 0.5; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
    }
    g.globalAlpha = 1;
  });
}

export function woodTex() {
  return texCanvas('wood', 256, 256, (g, w, h) => {
    g.fillStyle = '#a9784a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(${120 + Math.random() * 50 | 0},${80 + Math.random() * 40 | 0},${45 + Math.random() * 30 | 0},0.65)`;
      g.fillRect(0, i * 32, w, 30);
    }
    g.strokeStyle = 'rgba(80,50,25,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const y = Math.random() * h;
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y); g.stroke();
    }
  });
}

export function metalTex() {
  return texCanvas('metal', 128, 128, (g, w, h) => {
    g.fillStyle = '#8892a0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
      g.fillRect(Math.random() * w, Math.random() * h, 8, 2);
    }
    g.strokeStyle = 'rgba(40,50,60,0.45)'; g.lineWidth = 3;
    g.strokeRect(4, 4, w - 8, h - 8);
  });
}

// ── sky: vertical gradient with warm horizon + soft clouds ──────────────────
export function skyTex(top = '#2a6fd6', mid = '#8fc6f5', bottom = '#ffd9a1') {
  return texCanvas('sky' + top + bottom, 512, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, top);
    grd.addColorStop(0.55, mid);
    grd.addColorStop(1, bottom);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = h * 0.28 + Math.random() * h * 0.42;
      const r = 30 + Math.random() * 90;
      const rad = g.createRadialGradient(x, y, 0, x, y, r);
      rad.addColorStop(0, 'rgba(255,255,255,0.5)');
      rad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rad;
      g.beginPath(); g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2); g.fill();
    }
  });
}

// ── energy wall for the shrinking safe zone ─────────────────────────────────
export function zoneTex() {
  return texCanvas('zone', 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,220,255,0.95)';
    g.lineWidth = 6;
    g.beginPath();
    for (let i = 0; i <= 4; i++) {
      g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, h);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke(); }
  });
}

// ── item label sprite (emoji + name), cached per item type ──────────────────
export function itemLabelTex(emoji, label, color = '#ffcf3f') {
  return texCanvas('lbl' + emoji + label + color, 256, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '52px system-ui, "Segoe UI Emoji", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.42)';
    roundRect(g, 10, 14, w - 20, h - 28, 16); g.fill();
    g.fillStyle = color;
    g.fillText(emoji, w / 2, h / 2 - 2);
    g.font = 'bold 20px system-ui, sans-serif';
    g.fillStyle = '#fff';
    g.fillText(label, w / 2, h - 14);
  });
}

// ── minimap terrain (baked once per match) ──────────────────────────────────
export function minimapTex(heights, N, world, size = 512) {
  if (!hasDOM) return null;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = Math.min(N, Math.max(0, Math.round(((px / size) * N))));
      const j = Math.min(N, Math.max(0, Math.round(((py / size) * N))));
      const hgt = heights[j * (N + 1) + i];
      const o = (py * size + px) * 4;
      let r, gg, b;
      if (hgt <= 0.2) { r = 30; gg = 70 + Math.max(0, hgt * 8); b = 110; }
      else if (hgt < 3) { r = 200; gg = 186; b = 132; }
      else if (hgt < 12) { r = 86 + hgt * 1.4; gg = 128 + hgt; b = 62; }
      else if (hgt < 26) { r = 110 + hgt; gg = 120 + hgt * 0.6; b = 60; }
      else { r = 148 + hgt * 0.8; gg = 148 + hgt * 0.8; b = 140; }
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, ctx: g };
}

// ── gloo wall (ice/foam) pattern ────────────────────────────────────────────
export function glooTex() {
  return texCanvas('gloo', 128, 128, (g, w, h) => {
    g.fillStyle = '#8fd8ff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.4})`;
      g.lineWidth = 2 + Math.random() * 3;
      g.beginPath();
      const x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 20, y + 30, x + (Math.random() - 0.5) * 60, y + 60);
      g.stroke();
    }
    g.strokeStyle = 'rgba(40,120,180,0.55)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
}

export function smokeTex() {
  return texCanvas('smoke', 128, 128, (g, w, h) => {
    const rad = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    rad.addColorStop(0, 'rgba(255,255,255,0.9)');
    rad.addColorStop(0.45, 'rgba(220,220,220,0.45)');
    rad.addColorStop(1, 'rgba(200,200,200,0)');
    g.fillStyle = rad; g.fillRect(0, 0, w, h);
  });
}

export function sparkTex() {
  return texCanvas('spark', 64, 64, (g, w, h) => {
    const rad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    rad.addColorStop(0, 'rgba(255,250,200,1)');
    rad.addColorStop(0.4, 'rgba(255,170,60,0.7)');
    rad.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = rad; g.fillRect(0, 0, w, h);
  });
}
