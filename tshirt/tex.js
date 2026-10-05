/* NEURIO Tee Studio — procedural textures & prints (zero image assets) */
import * as THREE from 'three';

/* ────────────────────────── knit bump texture ──────────────────────────
 * Tiny stockinette-knit pattern used as a bump map so the fabric catches
 * light like real jersey cotton.
 */
export function makeKnitBump(THREE_, size = 256) {
  const T = THREE_ || THREE;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');

  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);

  const cell = size / 16; // 16 knit columns per tile
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const x = col * cell, y = row * cell;
      const off = (row % 2) * cell * 0.5;
      // each stitch: a small "v" made of two soft strokes
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.lineWidth = cell * 0.28;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + off + cell * 0.18, y + cell * 0.15);
      g.lineTo(x + off + cell * 0.5, y + cell * 0.85);
      g.lineTo(x + off + cell * 0.82, y + cell * 0.15);
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.35)';
      g.lineWidth = cell * 0.12;
      g.beginPath();
      g.moveTo(x + off + cell * 0.5, y + cell * 0.9);
      g.lineTo(x + off + cell * 0.5, y + cell * 0.55);
      g.stroke();
    }
  }
  // fiber noise
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.anisotropy = 8;
  return tex;
}

/* Big, pretty knit swatch for the "Fabric" section of the page. */
export function paintKnitSwatch(canvas, hex) {
  const g = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  g.fillStyle = hex;
  g.fillRect(0, 0, w, h);

  const cell = w / 12;
  const shade = (a, light) => {
    g.strokeStyle = light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
  };
  for (let row = -1; row < h / cell + 1; row++) {
    for (let col = -1; col < w / cell + 1; col++) {
      const off = (row % 2) * cell * 0.5;
      const x = col * cell + off, y = row * cell;
      shade(0.20, true); g.lineWidth = cell * 0.30; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + cell * 0.16, y + cell * 0.12);
      g.lineTo(x + cell * 0.5, y + cell * 0.86);
      g.lineTo(x + cell * 0.84, y + cell * 0.12);
      g.stroke();
      shade(0.16, false); g.lineWidth = cell * 0.14;
      g.beginPath();
      g.moveTo(x + cell * 0.5, y + cell * 0.9);
      g.lineTo(x + cell * 0.5, y + cell * 0.5);
      g.stroke();
    }
  }
  // soft vignette
  const grad = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.75);
  grad.addColorStop(0, 'rgba(255,255,255,.08)');
  grad.addColorStop(1, 'rgba(0,0,0,.20)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

/* ────────────────────────── print designs ──────────────────────────
 * Each design is drawn onto a transparent 512px canvas in a single ink
 * color, then projected onto the chest with DecalGeometry.
 */
export const PRINTS = [
  { id: 'none', name: 'No print' },
  { id: 'bolt', name: 'Voltage' },
  { id: 'star', name: 'North Star' },
  { id: 'smile', name: 'Good Mood' },
  { id: 'word', name: 'NEURIO' },
  { id: 'peak', name: 'Summit' },
  { id: 'flame', name: 'Ember' },
];

export function drawPrint(id, ink, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size;
  g.clearRect(0, 0, s, s);
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const poly = (pts) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
    g.closePath();
  };

  switch (id) {
    case 'bolt': {
      poly([[.56, .06], [.24, .56], [.44, .56], [.36, .94], [.76, .40], [.52, .40], [.68, .06]]);
      g.fill();
      break;
    }
    case 'star': {
      g.lineWidth = s * 0.055;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.20 : 0.46;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = 0.5 + Math.cos(a) * r, y = 0.52 + Math.sin(a) * r;
        i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s);
      }
      g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(0.5 * s, 0.52 * s, s * 0.045, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'smile': {
      g.lineWidth = s * 0.05;
      g.beginPath(); g.arc(.5 * s, .5 * s, .42 * s, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(.35 * s, .4 * s, .05 * s, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(.65 * s, .4 * s, .05 * s, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(.5 * s, .5 * s, .26 * s, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      break;
    }
    case 'word': {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `800 ${s * 0.2}px Sora, Arial, sans-serif`;
      g.fillText('NEURIO', .5 * s, .46 * s);
      g.fillRect(.2 * s, .60 * s, .6 * s, s * 0.028);
      g.font = `600 ${s * 0.055}px Manrope, Arial, sans-serif`;
      g.fillText('EST · 2026 · STUDIO', .5 * s, .70 * s);
      break;
    }
    case 'peak': {
      g.lineWidth = s * 0.045;
      poly([[.14, .72], [.42, .26], [.58, .5], [.68, .36], [.9, .72]]);
      g.stroke();
      g.beginPath(); g.arc(.74 * s, .2 * s, .07 * s, 0, Math.PI * 2); g.fill();
      g.fillRect(.14 * s, .78 * s, .76 * s, s * 0.024);
      break;
    }
    case 'flame': {
      g.beginPath();
      g.moveTo(.5 * s, .08 * s);
      g.bezierCurveTo(.62 * s, .26 * s, .82 * s, .34 * s, .78 * s, .60 * s);
      g.bezierCurveTo(.75 * s, .82 * s, .60 * s, .92 * s, .5 * s, .92 * s);
      g.bezierCurveTo(.40 * s, .92 * s, .25 * s, .82 * s, .22 * s, .60 * s);
      g.bezierCurveTo(.19 * s, .44 * s, .30 * s, .38 * s, .36 * s, .26 * s);
      g.bezierCurveTo(.40 * s, .34 * s, .46 * s, .36 * s, .5 * s, .30 * s);
      g.bezierCurveTo(.52 * s, .22 * s, .48 * s, .16 * s, .5 * s, .08 * s);
      g.closePath();
      g.fill();
      break;
    }
  }
  return c;
}

/* ink color that contrasts the shirt color */
export function inkFor(hex) {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear-ish
  return lum > 0.35 ? '#15171c' : '#f3f0e8';
}

/* soft radial "contact shadow" blob under the tee */
export function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(20,22,26,.42)');
  grad.addColorStop(0.55, 'rgba(20,22,26,.16)');
  grad.addColorStop(1, 'rgba(20,22,26,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
