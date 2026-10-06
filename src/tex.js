/* ============================================================
   Botola 25 — tex.js
   Every texture in the game is drawn at runtime on a 2D canvas:
   zero image downloads, zero CDN, works offline.
   ============================================================ */

import * as THREE from '../vendor/three.module.js';

const cv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
};

const texOut = (c, repeat = null) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
};

/* ---------------- mowed grass with stripes ---------------- */
export function grassTexture() {
  const [c, g] = cv(1024, 1024);
  g.fillStyle = '#2f7d32';
  g.fillRect(0, 0, 1024, 1024);
  const bands = 16, bh = 1024 / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = i % 2 ? '#35893a' : '#2b7330';
    g.fillRect(0, i * bh, 1024, bh);
  }
  // mottling so it is not a flat print
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024;
    const l = 24 + Math.random() * 34;
    g.fillStyle = `rgba(${l + 20},${l + 78},${l + 24},0.16)`;
    g.fillRect(x, y, 2, 2);
  }
  return texOut(c, [6, 5]);
}

/* ---------------- the markings, on transparency ---------------- */
export function linesTexture() {
  const W = 2048, H = Math.round((W * 68) / 105);
  const [c, g] = cv(W, H);
  g.clearRect(0, 0, W, H);
  const sx = W / 105, sz = H / 68;
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = Math.max(3, sx * 0.14);
  g.strokeRect(2, 2, W - 4, H - 4);
  // halfway line + centre circle + spot
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 9.15 * sx, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, sx * 0.35, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill();
  // boxes, six-yard boxes, penalty spots, arcs — both ends
  for (const side of [0, 1]) {
    const dir = side === 0 ? 1 : -1;
    const gx = side === 0 ? 0 : W;
    // penalty area 16.5 x 40.32
    g.strokeRect(side === 0 ? 2 : W - 16.5 * sx - 2, H / 2 - 20.16 * sz, 16.5 * sx, 40.32 * sz);
    // six-yard box 5.5 x 18.32
    g.strokeRect(side === 0 ? 2 : W - 5.5 * sx - 2, H / 2 - 9.16 * sz, 5.5 * sx, 18.32 * sz);
    // penalty spot
    g.beginPath(); g.arc(gx + dir * 11 * sx, H / 2, sx * 0.3, 0, Math.PI * 2); g.fill();
    // the D
    g.beginPath();
    g.arc(gx + dir * 11 * sx, H / 2, 9.15 * sx, side === 0 ? -0.93 : Math.PI - 0.93, side === 0 ? 0.93 : Math.PI + 0.93);
    g.stroke();
    // corner arcs
    for (const cz of [0, H]) {
      g.beginPath();
      g.arc(gx, cz, 1.2 * sx, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return texOut(c);
}

/* ---------------- ball ---------------- */
export function ballTexture() {
  const [c, g] = cv(256, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#16181d';
  for (let i = 0; i < 8; i++) {
    const x = i * 32 + 16, y = 32 + (i % 2) * 32;
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
      const px = x + Math.cos(a) * 9, py = y + Math.sin(a) * 9;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < 400; i++) g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  return texOut(c);
}

/* ---------------- crowd in the stands ---------------- */
export function crowdTexture(tint = '#20242c') {
  const [c, g] = cv(256, 128);
  g.fillStyle = tint; g.fillRect(0, 0, 256, 128);
  const palette = ['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#2ecc71', '#e67e22', '#9b59b6', '#1abc9c'];
  for (let row = 0; row < 26; row++) {
    for (let i = 0; i < 60; i++) {
      const x = i * 4.3 + (row % 2) * 2 + Math.random() * 1.4;
      const y = row * 5 + 2;
      g.fillStyle = palette[(Math.random() * palette.length) | 0];
      g.globalAlpha = 0.55 + Math.random() * 0.45;
      g.beginPath(); g.arc(x, y, 1.7, 0, Math.PI * 2); g.fill();
    }
  }
  g.globalAlpha = 1;
  return texOut(c, [8, 1]);
}

/* ---------------- advertising boards ---------------- */
export function adTexture() {
  const [c, g] = cv(1024, 128);
  const brands = [
    ['BOTOLA 25', '#e63946', '#ffffff'],
    ['ATLAS AIR', '#1d3557', '#f1faee'],
    ['MAROC TELECOM', '#00a86b', '#ffffff'],
    ['DIMA KORA', '#ff9f1c', '#1b1b1b'],
    ['CASABLANCA', '#7209b7', '#ffffff'],
    ['FÈS • MEKNÈS', '#2a9d8f', '#ffffff'],
  ];
  const w = 1024 / brands.length;
  brands.forEach((b, i) => {
    g.fillStyle = b[1]; g.fillRect(i * w, 0, w, 128);
    g.fillStyle = b[2];
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(b[0], i * w + w / 2, 66);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(i * w, 0, w, 10);
  });
  return texOut(c, [8, 1]);
}

/* ---------------- goal netting ---------------- */
export function netTexture() {
  const [c, g] = cv(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  return texOut(c, [6, 3]);
}

/* ---------------- soft blob shadow ---------------- */
export function shadowTexture() {
  const [c, g] = cv(128, 128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- shirt with a number on the back ---------------- */
export function shirtTexture(hex, number) {
  const [c, g] = cv(128, 128);
  g.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(number), 64, 66);
  return texOut(c);
}
