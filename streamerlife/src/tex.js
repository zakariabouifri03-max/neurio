// ── procedural textures (no external assets) ────────────────────────────────
import * as THREE from 'three';
import { rnd, ri } from './util.js';

const cache = new Map();
function make(key, w, h, draw, repeat = [1, 1], opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  draw(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
function noise(x, w, h, amt, dark = true) {
  const img = x.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt * (dark ? 255 : 120);
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
}

export const T = {
  asphalt: (r = 8) => make('asphalt' + r, 256, 256, (x, w, h) => {
    x.fillStyle = '#35373b'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = `rgba(${ri(20, 90)},${ri(20, 90)},${ri(22, 95)},.5)`;
      x.fillRect(rnd(w), rnd(h), rnd(3, 1), rnd(3, 1));
    }
    noise(x, w, h, .10);
  }, [r, r]),

  sidewalk: (r = 6) => make('side' + r, 256, 256, (x, w, h) => {
    x.fillStyle = '#9b9a95'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,0,0,.28)'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, h); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); }
    noise(x, w, h, .12);
  }, [r, r]),

  grass: (r = 10) => make('grass' + r, 256, 256, (x, w, h) => {
    x.fillStyle = '#3f7a35'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      x.strokeStyle = `rgba(${ri(40, 90)},${ri(90, 160)},${ri(30, 70)},.7)`;
      x.beginPath(); const px = rnd(w), py = rnd(h); x.moveTo(px, py); x.lineTo(px + rnd(2, -2), py - rnd(5, 2)); x.stroke();
    }
  }, [r, r]),

  wood: (r = 4, dark = false) => make('wood' + r + dark, 256, 256, (x, w, h) => {
    x.fillStyle = dark ? '#5a3c22' : '#b58552'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      x.strokeStyle = `rgba(${dark ? 30 : 90},${dark ? 18 : 60},10,${rnd(.22, .04)})`;
      x.lineWidth = rnd(3, .5); x.beginPath();
      const y = rnd(h); x.moveTo(0, y);
      for (let px = 0; px < w; px += 16) x.lineTo(px, y + Math.sin(px * .05 + i) * 3);
      x.stroke();
    }
    x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); }
  }, [r, r]),

  wall: (hex = '#e9e3da', r = 3) => make('wall' + hex + r, 128, 128, (x, w, h) => {
    x.fillStyle = hex; x.fillRect(0, 0, w, h); noise(x, w, h, .05);
  }, [r, r]),

  tile: (r = 5) => make('tile' + r, 256, 256, (x, w, h) => {
    x.fillStyle = '#dfe6ea'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#b3bec5'; x.lineWidth = 4;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, h); x.stroke(); x.beginPath(); x.moveTo(0, i * 32); x.lineTo(w, i * 32); x.stroke(); }
    noise(x, w, h, .04);
  }, [r, r]),

  carpet: (hex = '#7b2b3a', r = 2) => make('carpet' + hex + r, 128, 128, (x, w, h) => {
    x.fillStyle = hex; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { x.fillStyle = `rgba(255,255,255,${rnd(.08)})`; x.fillRect(rnd(w), rnd(h), 2, 2); }
  }, [r, r]),

  brick: (hex = '#8d4a3a', r = 4) => make('brick' + hex + r, 256, 256, (x, w, h) => {
    x.fillStyle = '#cfc6bb'; x.fillRect(0, 0, w, h);
    const bh = 26, bw = 60;
    for (let yy = 0, row = 0; yy < h; yy += bh, row++)
      for (let xx = (row % 2 ? -bw / 2 : 0); xx < w; xx += bw) {
        x.fillStyle = hex; x.globalAlpha = rnd(1, .78);
        x.fillRect(xx + 2, yy + 2, bw - 4, bh - 4); x.globalAlpha = 1;
      }
    noise(x, w, h, .07);
  }, [r, r]),

  // city building facade with lit windows
  facade: (seed = 1, cols = 6, rows = 10, baseHex = '#6b7280') => make('fac' + seed + cols + rows + baseHex, 256, 512, (x, w, h) => {
    x.fillStyle = baseHex; x.fillRect(0, 0, w, h);
    noise(x, w, h, .07);
    const cw = w / cols, rh = h / rows;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const lit = Math.random() < .45;
      x.fillStyle = lit ? `rgba(${ri(230, 255)},${ri(190, 235)},${ri(120, 180)},1)` : `rgba(${ri(18, 40)},${ri(22, 48)},${ri(30, 60)},1)`;
      x.fillRect(c * cw + cw * .18, r * rh + rh * .2, cw * .64, rh * .5);
      x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 2;
      x.strokeRect(c * cw + cw * .18, r * rh + rh * .2, cw * .64, rh * .5);
    }
  }, [1, 1]),

  poster: (title, hex) => make('poster' + title + hex, 256, 320, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, hex); g.addColorStop(1, '#101522');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center';
    title.split(' ').forEach((t, i) => x.fillText(t, w / 2, 120 + i * 40));
    x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
  }),

  skyGradient: () => make('sky', 64, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0b1a3a'); g.addColorStop(.45, '#3a74c4'); g.addColorStop(.75, '#9fc6e8'); g.addColorStop(1, '#e9d6b4');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }),
};

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, canvas: c, ctx: c.getContext('2d') };
}
