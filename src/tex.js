// ── Procedural canvas textures ───────────────────────────────────────────────
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

// ── road textures per type ──
export function roadTexture(road, seed) {
  const r = mulberry32(seed);
  const tex = makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = road.base; g.fillRect(0, 0, w, h);
    if (road.type === 'cobble') {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const jx = (r() - 0.5) * 6, jy = (r() - 0.5) * 6;
        g.fillStyle = `rgba(${140 + r() * 60 | 0},${125 + r() * 50 | 0},${100 + r() * 45 | 0},1)`;
        g.beginPath();
        g.roundRect(x * 32 + 2 + jx + (y % 2) * 16 - 8, y * 32 + 2 + jy, 27, 27, 8);
        g.fill();
      }
    } else if (road.type === 'night') {
      for (let i = 0; i < 700; i++) {
        g.fillStyle = `rgba(255,255,255,${r() * 0.08})`;
        g.fillRect(r() * w, r() * h, 1.6, 1.6);
      }
    } else {
      // speckle noise for sand/mud/dirt/ice/basalt
      const tone = road.type === 'ice' || road.type === 'basalt' ? 255 : 0;
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${tone ? '255,255,255' : '60,45,30'},${0.03 + r() * 0.07})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
      }
      // tire streaks down the road
      g.fillStyle = 'rgba(0,0,0,0.07)';
      g.fillRect(w * 0.18, 0, 14, h); g.fillRect(w * 0.68, 0, 14, h);
    }
    // edges
    g.fillStyle = road.edge;
    g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
    // center dashed line
    g.fillStyle = road.line;
    for (let y = 0; y < 4; y++) g.fillRect(w / 2 - 3, y * 64 + 8, 6, 34);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function checkerTexture() {
  const t = makeCanvas(128, 64, (g, w, h) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function skyTexture(theme) {
  return makeCanvas(16, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, theme.sky[0]);
    grd.addColorStop(0.55, theme.sky[1]);
    grd.addColorStop(1, theme.sky[2]);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

export function starsTexture() {
  const r = mulberry32(42);
  return makeCanvas(1024, 512, (g, w, h) => {
    for (let i = 0; i < 420; i++) {
      const y = r() * h * 0.75;
      g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.75})`;
      const s = r() * 1.8 + 0.4;
      g.fillRect(r() * w, y, s, s);
    }
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(180,220,255,${0.5 + r() * 0.5})`;
      g.beginPath(); g.arc(r() * w, r() * h * 0.6, 1.5 + r() * 2.2, 0, 7); g.fill();
    }
  });
}

export function glowTexture(inner = 'rgba(255,255,240,1)', outer = 'rgba(255,200,80,0)') {
  return makeCanvas(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.25, inner);
    grd.addColorStop(1, outer);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

export function dustTexture() {
  return makeCanvas(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

export function cloudTexture() {
  const r = mulberry32(7);
  return makeCanvas(256, 128, (g) => {
    for (let i = 0; i < 14; i++) {
      const x = 30 + r() * 196, y = 45 + r() * 45, rad = 18 + r() * 30;
      const grd = g.createRadialGradient(x, y, 2, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
  });
}

export function itemBoxTexture() {
  return makeCanvas(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 1.6);
    grd.addColorStop(0, '#ff9ff3');
    grd.addColorStop(0.7, '#c44de0');
    grd.addColorStop(1, '#7c2cbf');
    g.fillStyle = grd;
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 26); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5;
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 26); g.stroke();
    g.font = '900 78px Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#5b1685';
    g.strokeText('?', w / 2, h / 2 + 4);
    g.fillStyle = '#ffe95e';
    g.fillText('?', w / 2, h / 2 + 4);
  });
}

export function faceTexture(emoji) {
  return makeCanvas(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '92px serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, w / 2, h / 2 + 6);
  });
}

export function balloonTexture(c1, c2) {
  return makeCanvas(256, 128, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? c1 : c2;
      g.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

export function bannerTexture(text) {
  return makeCanvas(512, 96, (g, w, h) => {
    g.fillStyle = '#1d3557'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < 32; x++) { // checkered borders
      g.fillStyle = x % 2 ? '#fff' : '#111';
      g.fillRect(x * 16, 0, 16, 10); g.fillRect(x * 16, h - 10, 16, 10);
    }
    g.font = '900 44px Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#000';
    g.strokeText(text.toUpperCase(), w / 2, h / 2 + 2);
    g.fillStyle = '#ffe95e';
    g.fillText(text.toUpperCase(), w / 2, h / 2 + 2);
  });
}

export function flagTexture() {
  return makeCanvas(128, 96, (g, w, h) => {
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  });
}
