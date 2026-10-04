// ── Procedural canvas textures (forest-town realism) ────────────────────────
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function makeCanvas(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function rep(t, rx = 1, ry = 1) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

export function grassTexture() {
  const r = mulberry32(7);
  return makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#4a6b35'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const t = r();
      g.fillStyle = t < 0.33 ? 'rgba(58,92,40,0.5)' : t < 0.66 ? 'rgba(96,128,60,0.45)' : 'rgba(120,140,70,0.35)';
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
    }
    // dry patches
    for (let i = 0; i < 26; i++) {
      g.fillStyle = 'rgba(150,140,90,0.16)';
      g.beginPath(); g.ellipse(r() * w, r() * h, 8 + r() * 22, 6 + r() * 14, r() * 3, 0, 7); g.fill();
    }
  });
}

export function dirtTexture() {
  const r = mulberry32(11);
  return makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#8a7355'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(110,90,64,0.5)' : 'rgba(160,140,105,0.4)';
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = 'rgba(90,75,55,0.7)';
      g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 2.2, 0, 7); g.fill();
    }
  });
}

export function roadTexture() {
  const r = mulberry32(3);
  const t = makeCanvas(256, 512, (g, w, h) => {
    g.fillStyle = '#3b3d42'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '20,20,22' : '120,122,126'},${0.05 + r() * 0.08})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 3);
    }
    // cracks
    g.strokeStyle = 'rgba(25,25,28,0.5)';
    for (let i = 0; i < 7; i++) {
      g.beginPath(); let x = r() * w, y = 0; g.moveTo(x, y);
      while (y < h) { y += 20 + r() * 30; x += (r() - 0.5) * 26; g.lineTo(x, y); }
      g.stroke();
    }
    // tire wear
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(w * 0.16, 0, 22, h); g.fillRect(w * 0.72, 0, 22, h);
    // edge lines
    g.fillStyle = '#cfcfc4'; g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
    // center dashed yellow
    g.fillStyle = '#d8a531';
    for (let y = 0; y < 8; y++) g.fillRect(w / 2 - 3, y * 64 + 10, 6, 36);
  });
  return t;
}

export function woodSidingTexture(base = '#8d6e4e', dark = '#6d5439') {
  const r = mulberry32(base.length * 13);
  return makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) {
      g.fillStyle = y % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      g.fillRect(0, y * 32, w, 16);
      g.fillStyle = dark; g.fillRect(0, y * 32 + 30, w, 3);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(60,42,26,${0.04 + r() * 0.08})`;
      g.fillRect(r() * w, r() * h, 2 + r() * 8, 1);
    }
  });
}

export function roofTexture() {
  const r = mulberry32(21);
  return makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#5a5f66'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = `rgba(${70 + r() * 40 | 0},${74 + r() * 40 | 0},${80 + r() * 40 | 0},1)`;
      g.beginPath(); g.roundRect(x * 32 + ((y % 2) * 16 - 8), y * 32, 30, 30, [0, 0, 14, 14]); g.fill();
    }
  });
}

export function wallpaperTexture() {
  const r = mulberry32(31);
  return makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#7d8f72'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(r() * w, r() * h, 2, 2); }
    // floral motif grid
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const cx = x * 64 + 32, cy = y * 64 + 32;
      g.fillStyle = 'rgba(236,238,220,0.75)';
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        g.beginPath(); g.ellipse(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, 5, 3, a, 0, 7); g.fill();
      }
      g.fillStyle = '#c9a24a'; g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.fill();
      g.strokeStyle = 'rgba(90,110,80,0.5)';
      g.beginPath(); g.arc(cx, cy, 15, 0, 7); g.stroke();
    }
  });
}

export function woodFloorTexture() {
  const r = mulberry32(41);
  return makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#9a7648'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,230,180,0.08)' : 'rgba(60,35,15,0.12)';
      g.fillRect(i * 32, 0, 32, h);
      g.fillStyle = 'rgba(50,30,12,0.8)'; g.fillRect(i * 32, 0, 2, h);
    }
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(70,45,20,${0.05 + r() * 0.08})`;
      g.fillRect(r() * w, r() * h, 1, 3 + r() * 10);
    }
  });
}

export function carpetTexture() {
  const r = mulberry32(51);
  return makeCanvas(128, 128, (g, w, h) => {
    g.fillStyle = '#8f9196'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,122,128,0.5)' : 'rgba(70,72,78,0.5)';
      g.fillRect(r() * w, r() * h, 1, 1);
    }
  });
}

export function awningTexture(c1 = '#e8b53a', c2 = '#d8452f') {
  return makeCanvas(256, 64, (g, w, h) => {
    for (let x = 0; x < 8; x++) { g.fillStyle = x % 2 ? c1 : c2; g.fillRect(x * 32, 0, 32, h); }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, h - 10, w, 10);
  });
}

export function signTexture(text, bg = '#243040', fg = '#f5d76e', sub = '') {
  return makeCanvas(512, 160, (g, w, h) => {
    g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 14); g.fill();
    g.strokeStyle = fg; g.lineWidth = 6; g.beginPath(); g.roundRect(10, 10, w - 20, h - 20, 10); g.stroke();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 62px Arial';
    g.fillText(text, w / 2, sub ? h / 2 - 18 : h / 2);
    if (sub) { g.font = 'bold 34px Arial'; g.fillText(sub, w / 2, h / 2 + 38); }
  });
}

export function posterTexture(emoji, bg) {
  return makeCanvas(128, 160, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.font = '72px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, w / 2, h / 2);
  });
}

export function faceTexture(kind) {
  return makeCanvas(64, 64, (g, w, h) => {
    g.fillStyle = '#f2c799'; g.beginPath(); g.arc(32, 32, 32, 0, 7); g.fill();
    g.fillStyle = '#222';
    g.beginPath(); g.arc(22, 26, 4, 0, 7); g.fill();
    g.beginPath(); g.arc(42, 26, 4, 0, 7); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 3;
    if (kind === 0) { g.beginPath(); g.arc(32, 38, 10, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
    else if (kind === 1) { g.beginPath(); g.arc(32, 46, 8, 1.1 * Math.PI, 1.9 * Math.PI); g.stroke(); }
    else { g.beginPath(); g.moveTo(24, 42); g.lineTo(40, 42); g.stroke(); }
  });
}

export function cloudTexture() {
  const r = mulberry32(61);
  return makeCanvas(256, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = 30 + r() * (w - 60), y = 40 + r() * (h - 70), rad = 14 + r() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
  });
}

export function lakeTexture() {
  const r = mulberry32(71);
  const t = makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#2e5d6b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 130; i++) {
      g.strokeStyle = `rgba(190,225,230,${0.05 + r() * 0.1})`;
      g.lineWidth = 1 + r() * 2;
      const y = r() * h;
      g.beginPath(); g.moveTo(r() * w, y); g.lineTo(r() * w + 30, y + (r() - 0.5) * 4); g.stroke();
    }
  });
  return t;
}

export function screenGlowTexture() {
  return makeCanvas(64, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#3d6fd8'); grd.addColorStop(1, '#27407c');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

export function windowTex(lit = false) {
  return makeCanvas(64, 64, (g, w, h) => {
    g.fillStyle = lit ? '#ffd98a' : '#20262e';
    g.fillRect(0, 0, w, h);
    if (!lit) {
      g.fillStyle = 'rgba(160,200,220,0.25)';
      g.beginPath(); g.moveTo(6, 58); g.lineTo(58, 6); g.lineTo(58, 24); g.lineTo(24, 58); g.fill();
    }
    g.strokeStyle = '#101418'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
    g.beginPath(); g.moveTo(32, 0); g.lineTo(32, h); g.moveTo(0, 32); g.lineTo(w, 32); g.stroke();
  });
}

export const TEX = {};
export function buildTextures() {
  TEX.grass = rep(grassTexture(), 60, 60);
  TEX.dirt = rep(dirtTexture(), 4, 4);
  TEX.road = roadTexture();
  TEX.roof = rep(roofTexture(), 3, 3);
  TEX.wallpaper = rep(wallpaperTexture(), 3, 2);
  TEX.woodFloor = rep(woodFloorTexture(), 4, 4);
  TEX.carpet = rep(carpetTexture(), 3, 3);
  TEX.lake = rep(lakeTexture(), 8, 8);
  TEX.screen = screenGlowTexture();
}
