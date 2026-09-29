// ── procedural canvas textures: no image files anywhere in the game ──────────
import * as THREE from 'three';
import { mulberry32 } from '../../shared/util.js';

export function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = o.aniso ?? 4;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
  t.userData.canvas = c;
  return t;
}

export function carpetTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = mulberry32(7);
    g.fillStyle = '#3d1620'; g.fillRect(0, 0, w, h);
    // brass lattice
    g.strokeStyle = 'rgba(206,156,74,.20)'; g.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      g.beginPath(); g.arc(w / 2, h / 2, 12 + i * 16, 0, Math.PI * 2); g.stroke();
    }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.save(); g.translate(x * 64 + 32, y * 64 + 32); g.rotate(Math.PI / 4);
      g.fillStyle = 'rgba(224,176,92,.16)'; g.fillRect(-11, -11, 22, 22);
      g.fillStyle = 'rgba(88,26,40,.9)'; g.fillRect(-6, -6, 12, 12);
      g.restore();
    }
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = `rgba(${r() < .5 ? '255,230,210' : '30,8,14'},${0.02 + r() * 0.05})`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
  }, { repeat: [5, 5] });
}

export function wallTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = mulberry32(21);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#12303c'); gr.addColorStop(0.62, '#0d2531'); gr.addColorStop(1, '#0a1c26');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // panelling
    for (let x = 0; x < 8; x++) {
      g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(x * 64 + 8, 40, 4, h - 90);
      g.fillStyle = 'rgba(0,0,0,.20)'; g.fillRect(x * 64 + 12, 40, 3, h - 90);
    }
    g.fillStyle = 'rgba(206,156,74,.22)'; g.fillRect(0, h * 0.62, w, 4);
    for (let i = 0; i < 12000; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.02})`; g.fillRect(r() * w, r() * h, 2, 2); }
  }, { repeat: [3, 1] });
}

export function woodTex(seed = 3) {
  return canvasTex(512, 512, (g, w, h) => {
    const r = mulberry32(seed);
    g.fillStyle = '#4a2a1c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const y = r() * h;
      g.strokeStyle = `rgba(${90 + r() * 60 | 0},${48 + r() * 30 | 0},${28 + r() * 20 | 0},${0.18 + r() * 0.3})`;
      g.lineWidth = 1 + r() * 4;
      g.beginPath();
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin((x + i * 40) * 0.02) * (3 + r() * 6));
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 2;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(w / 2 + (r() - .5) * 300, h / 2 + (r() - .5) * 300, 12 + r() * 26, 0, 6.3); g.stroke(); }
  }, { repeat: [2, 2] });
}

export function plasterTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(99);
    g.fillStyle = '#132632'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8000; i++) { g.fillStyle = `rgba(${r() < .5 ? '255,240,220' : '0,0,0'},${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2, 2); }
  }, { repeat: [6, 6] });
}

export function neonSignTex(text = 'SWINDLE SQUAD', sub = 'MEMBERS ONLY') {
  return canvasTex(1024, 320, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const draw = (txt, y, size, color, blur) => {
      g.save();
      g.shadowColor = color; g.shadowBlur = blur;
      g.font = `800 ${size}px Bungee, Impact, system-ui, sans-serif`;
      g.lineWidth = 7; g.strokeStyle = color; g.strokeText(txt, w / 2, y);
      g.fillStyle = '#fff8e6';
      g.shadowBlur = blur * 0.5;
      g.fillText(txt, w / 2, y);
      g.restore();
    };
    draw(text, h * 0.4, 116, '#ff9c2e', 60);
    draw(text, h * 0.4, 116, '#ffe6b0', 18);
    g.font = '700 40px Outfit, system-ui, sans-serif';
    g.fillStyle = 'rgba(255,180,120,.9)';
    g.shadowColor = '#ff9c2e'; g.shadowBlur = 24;
    g.fillText(sub, w / 2, h * 0.82);
  });
}

export function posterTex(kind) {
  return canvasTex(512, 640, (g, w, h) => {
    g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, w, h);
    const r = mulberry32(kind.length * 13 + 5);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(90,70,40,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.fillStyle = '#20242e';
    g.fillRect(24, 24, w - 48, 96);
    g.fillStyle = '#f6e6b8';
    g.font = '800 46px Bungee, Impact, system-ui, sans-serif';
    g.textAlign = 'center';
    const head = { refunds: 'NO REFUNDS', markets: 'TONIGHT', witness: 'WANTED' }[kind] || 'NOTICE';
    g.fillText(head, w / 2, 90);
    g.fillStyle = '#2a2f3a';
    g.font = '700 30px Outfit, system-ui, sans-serif';
    const lines = {
      refunds: ['All deals final at the', 'buzzer. Crying in the', 'hallway is allowed.'],
      markets: ['Ducks up 4%', 'Envelopes flat', 'Guilt: strongly up'],
      witness: ['Anyone with info on', 'the case of the warm', 'lamps: speak softly.'],
    }[kind] || ['Please do not lean on', 'the merchandise, the', 'walls, or each other.'];
    lines.forEach((l, i) => g.fillText(l, w / 2, 200 + i * 44));
    g.strokeStyle = 'rgba(40,40,50,.35)'; g.lineWidth = 6; g.strokeRect(40, 140, w - 80, 300);
    g.save(); g.translate(w / 2, 470); g.rotate(-0.12);
    g.strokeStyle = '#b23a3a'; g.lineWidth = 8;
    g.beginPath(); g.arc(0, 0, 74, 0, 6.3); g.stroke();
    g.fillStyle = '#b23a3a'; g.font = '800 40px Bungee, Impact, sans-serif';
    g.fillText('VOID', 0, 12); g.restore();
  });
}

export function clockTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f3ead4'; g.beginPath(); g.arc(w / 2, h / 2, 120, 0, 6.3); g.fill();
    g.strokeStyle = '#2b2f3a'; g.lineWidth = 8; g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      g.strokeStyle = '#2b2f3a'; g.lineWidth = i % 3 === 0 ? 8 : 3;
      g.beginPath();
      g.moveTo(w / 2 + Math.sin(a) * 100, h / 2 - Math.cos(a) * 100);
      g.lineTo(w / 2 + Math.sin(a) * 84, h / 2 - Math.cos(a) * 84);
      g.stroke();
    }
    g.textAlign = 'center'; g.fillStyle = '#8a5b2a'; g.font = '700 20px Outfit, sans-serif';
    g.fillText('PATIENCE', w / 2, h / 2 + 60);
  });
}

export function lockerTex(n) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#2e4752'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = '#c9a15a'; g.fillRect(w / 2 - 20, 24, 40, 26);
    g.fillStyle = '#20323b'; g.font = '800 22px Outfit, sans-serif'; g.textAlign = 'center';
    g.fillText(String(n), w / 2, 45);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(w / 2 + 26, 60, 8, 22);
  });
}

/** The big reveal screen: a live canvas the UI layer paints every frame-ish. */
export class ScreenCanvas {
  constructor(w = 1024, h = 576) {
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
    this.g = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.w = w; this.h = h; this._acc = 0;
  }
  get ctx() { return this.g; }
  push() { this.tex.needsUpdate = true; }
}

export function terrazzoTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(404);
    g.fillStyle = '#dcd6c4'; g.fillRect(0, 0, w, h);
    const cols = ['#3b6b7d', '#c8613a', '#e0c268', '#5e8b6a', '#2c2f3a'];
    for (let i = 0; i < 900; i++) {
      g.fillStyle = cols[(r() * cols.length) | 0];
      g.globalAlpha = 0.5 + r() * 0.5;
      g.beginPath();
      const x = r() * w, y = r() * h, s = 1.5 + r() * 6;
      g.ellipse(x, y, s, s * (0.6 + r() * 0.8), r() * 3, 0, 6.3); g.fill();
    }
    g.globalAlpha = 1;
  }, { repeat: [2, 2] });
}
