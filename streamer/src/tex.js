// ---------- procedural canvas textures ----------
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function ctex(size, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noise(g, s, n, alpha, cols) {
  const r = mulberry32(7);
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.globalAlpha = alpha * (0.4 + r() * 0.6);
    g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
  }
  g.globalAlpha = 1;
}

export function texGrass() {
  return ctex(256, (g, s) => {
    g.fillStyle = '#4a6b35'; g.fillRect(0, 0, s, s);
    noise(g, s, 2600, 0.35, ['#3d5c2a', '#57793f', '#5d8245', '#42612e', '#6a8f4e']);
    const r = mulberry32(3);
    for (let i = 0; i < 240; i++) {
      g.strokeStyle = r() > 0.5 ? '#39552a' : '#5f8647';
      g.globalAlpha = 0.5;
      const x = r() * s, y = r() * s;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 3); g.stroke();
    }
    g.globalAlpha = 1;
  }, 60, 60);
}

export function texAsphalt() {
  return ctex(256, (g, s) => {
    g.fillStyle = '#3a3a3e'; g.fillRect(0, 0, s, s);
    noise(g, s, 3200, 0.3, ['#2e2e32', '#46464a', '#333338', '#4d4d52']);
    // cracks
    const r = mulberry32(11);
    g.strokeStyle = '#2a2a2d'; g.globalAlpha = 0.5;
    for (let i = 0; i < 5; i++) {
      g.beginPath(); let x = r() * s, y = 0; g.moveTo(x, y);
      while (y < s) { y += 14 + r() * 20; x += (r() - 0.5) * 22; g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
    // center double yellow (texture V = along road)
    g.fillStyle = '#c8a028';
    g.fillRect(s / 2 - 7, 0, 5, s); g.fillRect(s / 2 + 2, 0, 5, s);
    // edge whites
    g.fillStyle = '#b9b9b9';
    g.fillRect(6, 0, 5, s); g.fillRect(s - 11, 0, 5, s);
  }, 1, 12);
}

export function texSidewalk() {
  return ctex(128, (g, s) => {
    g.fillStyle = '#8d8d88'; g.fillRect(0, 0, s, s);
    noise(g, s, 900, 0.25, ['#7c7c77', '#9a9a95', '#84847f']);
    g.strokeStyle = '#6e6e69'; g.lineWidth = 3;
    g.strokeRect(0, 0, s, s);
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
  }, 30, 3);
}

export function texWood(base = '#7a5a3a', plank = 26) {
  return ctex(256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const r = mulberry32(5);
    for (let y = 0; y < s; y += plank) {
      g.fillStyle = `rgba(0,0,0,${0.12 + r() * 0.12})`;
      g.fillRect(0, y, s, 2);
      g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.05})`;
      g.fillRect(0, y + 3, s, plank - 6);
      for (let i = 0; i < 30; i++) {
        g.strokeStyle = `rgba(40,20,5,${0.08 + r() * 0.1})`;
        const yy = y + r() * plank;
        g.beginPath(); g.moveTo(r() * s, yy); g.lineTo(r() * s, yy + (r() - 0.5) * 2); g.stroke();
      }
    }
    noise(g, s, 700, 0.12, ['#00000022', '#ffffff11']);
  });
}

export function texSiding(base = '#8a7f6a') {
  return ctex(256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y, s, 2);
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, y + 2, s, 6);
    }
    noise(g, s, 900, 0.1, ['#00000022', '#ffffff14']);
  });
}

export function texRoof(col = '#5a3a2a') {
  return ctex(256, (g, s) => {
    g.fillStyle = col; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 20) {
      const off = (y / 20) % 2 ? 20 : 0;
      for (let x = -20; x < s; x += 40) {
        g.fillStyle = `rgba(0,0,0,${0.1 + ((x + y) % 80) / 400})`;
        g.fillRect(x + off, y, 38, 18);
      }
    }
    noise(g, s, 800, 0.15, ['#00000033', '#ffffff11']);
  }, 3, 3);
}

export function texWallpaper() {
  return ctex(256, (g, s) => {
    g.fillStyle = '#7d8a72'; g.fillRect(0, 0, s, s);
    noise(g, s, 500, 0.08, ['#00000015', '#ffffff10']);
    const r = mulberry32(9);
    for (let y = 0; y < s; y += 64) for (let x = 0; x < s; x += 64) {
      const cx = x + 32, cy = y + 32;
      g.fillStyle = '#a8b295';
      for (let p = 0; p < 5; p++) {
        const a = p / 5 * Math.PI * 2;
        g.beginPath(); g.ellipse(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 6, 3.4, a, 0, 7); g.fill();
      }
      g.fillStyle = '#c9b26b'; g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.fill();
      g.strokeStyle = '#66755c'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx + 26, cy + 26, 8, 0, 5); g.stroke();
    }
  }, 3, 2);
}

export function texCarpet() {
  return ctex(128, (g, s) => {
    g.fillStyle = '#6d5a4a'; g.fillRect(0, 0, s, s);
    noise(g, s, 2400, 0.3, ['#5d4c3e', '#7a685a', '#665548']);
  }, 6, 6);
}

export function texSign(text, bg, fg, sub = '') {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 14; g.strokeRect(7, 7, 1010, 242);
  g.fillStyle = fg;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 108px Arial Black, Arial';
  g.fillText(text, 512, sub ? 105 : 128);
  if (sub) { g.font = 'bold 62px Arial Black, Arial'; g.fillText(sub, 512, 195); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function texRoadSign(kind = 'curve') {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.save(); g.translate(128, 128); g.rotate(Math.PI / 4);
  g.fillStyle = '#d8b511'; g.fillRect(-88, -88, 176, 176);
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 10; g.strokeRect(-88, -88, 176, 176);
  g.restore();
  g.strokeStyle = '#111'; g.lineWidth = 16; g.lineCap = 'round';
  if (kind === 'curve') {
    g.beginPath(); g.moveTo(110, 178); g.lineTo(110, 130); g.quadraticCurveTo(110, 96, 146, 96); g.lineTo(150, 96); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(150, 78); g.lineTo(176, 96); g.lineTo(150, 114); g.fill();
  } else { // pedestrian
    g.fillStyle = '#111';
    g.beginPath(); g.arc(118, 84, 14, 0, 7); g.fill();
    g.lineWidth = 12;
    g.beginPath(); g.moveTo(118, 100); g.lineTo(118, 140); g.moveTo(118, 140); g.lineTo(100, 176); g.moveTo(118, 140); g.lineTo(138, 174); g.moveTo(118, 108); g.lineTo(146, 128); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function texName(name, color = '#fff') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 10; g.strokeText(name, 256, 64);
  g.fillStyle = color; g.fillText(name, 256, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function texScreenWall(i) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 288;
  const g = c.getContext('2d');
  const pals = [
    ['#0e3a5c', '#1d6fa8', '#7ec8e3'], ['#3a0e4c', '#7a1d8a', '#e37ed4'],
    ['#0e5c2a', '#1da858', '#7ee3a4'], ['#5c3a0e', '#a86a1d', '#e3c07e'],
  ];
  const p = pals[i % pals.length];
  const gr = g.createLinearGradient(0, 0, 512, 288);
  gr.addColorStop(0, p[0]); gr.addColorStop(0.6, p[1]); gr.addColorStop(1, p[2]);
  g.fillStyle = gr; g.fillRect(0, 0, 512, 288);
  const r = mulberry32(i + 2);
  g.globalAlpha = 0.25;
  for (let m = 0; m < 5; m++) {
    g.fillStyle = p[2];
    g.beginPath();
    g.moveTo(0, 200 + m * 18 + r() * 10);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, 190 + m * 18 + Math.sin(x / 60 + m + i) * 22);
    g.lineTo(512, 288); g.lineTo(0, 288); g.fill();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
