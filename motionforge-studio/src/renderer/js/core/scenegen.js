// Procedural backgrounds and props (drawn with canvas, saved as normal image assets).
import { mkCanvas } from './util.js';

export const BACKGROUNDS = { room: 'Room', house: 'House (living room)', street: 'Street', school: 'School', park: 'Park', beach: 'Beach', night: 'Night city', space: 'Space', studio: 'Studio' };
export const PROPS = { chair: 'Chair', table: 'Table', ball: 'Ball', box: 'Box', tree: 'Tree', sun: 'Sun', lamp: 'Lamp', door: 'Door', bench: 'Bench' };

const grad = (g, W, y0, y1, c0, c1) => { const k = g.createLinearGradient(0, y0, 0, y1); k.addColorStop(0, c0); k.addColorStop(1, c1); g.fillStyle = k; g.fillRect(0, y0, W, y1 - y0); };
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function cloud(g, x, y, s) { g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x, y, 30 * s, 0, 7); g.arc(x + 34 * s, y - 12 * s, 38 * s, 0, 7); g.arc(x + 76 * s, y, 30 * s, 0, 7); g.fill(); }

export function drawBackground(kind, W, H) {
  const c = mkCanvas(W, H); const g = c.getContext('2d'); const gy = H * 0.74; const u = H / 720;
  const floorLine = () => { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, gy, W, 3 * u); };
  switch (kind) {
    case 'room': case 'house': {
      grad(g, W, 0, gy, kind === 'room' ? '#e9dfd0' : '#dfe7ee', kind === 'room' ? '#d8c9b3' : '#c9d6e2');
      grad(g, W, gy, H, '#a9794e', '#80573a');
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2 * u; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(W * (i / 12) - 40, H); g.lineTo(W * 0.5 + (W * (i / 12) - W * 0.5) * 0.7, gy); g.stroke(); }
      floorLine(); g.fillStyle = '#f3efe6'; g.fillRect(0, gy - 16 * u, W, 16 * u);
      // window
      const wx = W * 0.62, wy = H * 0.14, ww = W * 0.22, wh = H * 0.34;
      g.fillStyle = '#8fd0f5'; g.fillRect(wx, wy, ww, wh); cloud(g, wx + ww * 0.2, wy + wh * 0.35, 0.5 * u);
      g.strokeStyle = '#fff'; g.lineWidth = 10 * u; g.strokeRect(wx, wy, ww, wh); g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.moveTo(wx, wy + wh / 2); g.lineTo(wx + ww, wy + wh / 2); g.stroke();
      // picture
      g.fillStyle = '#5a3d2b'; g.fillRect(W * 0.14, H * 0.18, W * 0.14, H * 0.2); g.fillStyle = '#9ad1a0'; g.fillRect(W * 0.145, H * 0.19, W * 0.13, H * 0.18); g.fillStyle = '#f5d76e'; g.beginPath(); g.arc(W * 0.24, H * 0.25, 18 * u, 0, 7); g.fill();
      // rug
      g.fillStyle = 'rgba(190,70,70,.8)'; g.beginPath(); g.ellipse(W * 0.45, H * 0.9, W * 0.22, H * 0.05, 0, 0, 7); g.fill();
      break;
    }
    case 'street': {
      grad(g, W, 0, gy, '#8fcdf2', '#e4f3fb'); cloud(g, W * 0.15, H * 0.15, u); cloud(g, W * 0.6, H * 0.1, 1.3 * u);
      for (let i = 0; i < 9; i++) { const bw = W * (0.08 + ((i * 37) % 7) * 0.012), bx = i * W * 0.12 - 20, bh = H * (0.28 + ((i * 53) % 9) * 0.03); g.fillStyle = ['#7b8aa3', '#93a1b8', '#6b7a93', '#a6b2c6'][i % 4]; g.fillRect(bx, gy - bh - H * 0.06, bw, bh); g.fillStyle = 'rgba(255,240,170,.75)'; for (let y = 0; y < bh - 30 * u; y += 36 * u) for (let x = 12 * u; x < bw - 20 * u; x += 28 * u) g.fillRect(bx + x, gy - bh - H * 0.06 + 14 * u + y, 14 * u, 20 * u); }
      g.fillStyle = '#c9c9c9'; g.fillRect(0, gy - H * 0.06, W, H * 0.06); grad(g, W, gy, H, '#4a4f58', '#2d3138');
      g.fillStyle = '#f5d76e'; for (let x = 0; x < W; x += 140 * u) g.fillRect(x, H * 0.9, 80 * u, 8 * u); break;
    }
    case 'school': {
      grad(g, W, 0, gy, '#a9d8f0', '#e6f4fa'); g.fillStyle = '#c0583f'; g.fillRect(W * 0.1, H * 0.2, W * 0.8, gy - H * 0.2); g.fillStyle = '#9e4430'; g.fillRect(W * 0.08, H * 0.16, W * 0.84, H * 0.06);
      g.fillStyle = '#9ad0f0'; for (let i = 0; i < 6; i++) { g.fillRect(W * (0.14 + i * 0.13), H * 0.3, W * 0.08, H * 0.14); }
      g.fillStyle = '#5a3d2b'; g.fillRect(W * 0.46, H * 0.46, W * 0.08, gy - H * 0.46); g.fillStyle = '#fff'; g.font = `bold ${34 * u}px sans-serif`; g.textAlign = 'center'; g.fillText('SCHOOL', W / 2, H * 0.205);
      grad(g, W, gy, H, '#7fb069', '#5f8f4d'); break;
    }
    case 'park': {
      grad(g, W, 0, gy, '#8fd0f5', '#dff2fb'); cloud(g, W * 0.2, H * 0.14, u); cloud(g, W * 0.7, H * 0.2, 0.8 * u);
      g.fillStyle = '#8fc47a'; g.beginPath(); g.moveTo(0, gy); g.quadraticCurveTo(W * 0.25, gy - H * 0.18, W * 0.5, gy - H * 0.04); g.quadraticCurveTo(W * 0.8, gy - H * 0.2, W, gy - H * 0.02); g.lineTo(W, gy); g.fill();
      for (const tx of [0.12, 0.82, 0.93]) { g.fillStyle = '#6b4a30'; g.fillRect(W * tx - 10 * u, gy - H * 0.2, 20 * u, H * 0.22); g.fillStyle = '#4f9a4b'; g.beginPath(); g.arc(W * tx, gy - H * 0.26, 70 * u, 0, 7); g.arc(W * tx - 40 * u, gy - H * 0.2, 48 * u, 0, 7); g.arc(W * tx + 42 * u, gy - H * 0.2, 48 * u, 0, 7); g.fill(); }
      grad(g, W, gy, H, '#6fb35e', '#4e8f45'); break;
    }
    case 'beach': {
      grad(g, W, 0, H * 0.5, '#7fd1f7', '#dff6ff'); g.fillStyle = '#f9d65c'; g.beginPath(); g.arc(W * 0.8, H * 0.18, 56 * u, 0, 7); g.fill();
      grad(g, W, H * 0.5, gy - H * 0.04, '#2fa4d6', '#6fd0ea'); grad(g, W, gy - H * 0.04, H, '#f1dba4', '#dcc080');
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 4 * u; g.beginPath(); for (let x = 0; x <= W; x += 20) g.lineTo(x, gy - H * 0.04 + Math.sin(x / 40) * 5 * u); g.stroke(); break;
    }
    case 'night': {
      grad(g, W, 0, gy, '#0b1230', '#2a3566'); g.fillStyle = '#fff'; for (let i = 0; i < 70; i++) g.fillRect((i * 9973) % W, (i * 7919) % (gy * 0.7), 2 * u, 2 * u);
      g.fillStyle = '#f7f1d0'; g.beginPath(); g.arc(W * 0.78, H * 0.18, 44 * u, 0, 7); g.fill();
      for (let i = 0; i < 9; i++) { const bw = W * 0.1, bx = i * W * 0.115 - 10, bh = H * (0.25 + ((i * 41) % 8) * 0.035); g.fillStyle = '#161b36'; g.fillRect(bx, gy - bh, bw, bh); g.fillStyle = 'rgba(255,214,102,.85)'; for (let y = 14 * u; y < bh - 20 * u; y += 34 * u) for (let x = 10 * u; x < bw - 16 * u; x += 26 * u) if (((x + y + i) | 0) % 3) g.fillRect(bx + x, gy - bh + y, 12 * u, 16 * u); }
      grad(g, W, gy, H, '#20243a', '#12142a'); break;
    }
    case 'space': {
      grad(g, W, 0, H, '#05010f', '#1a0b3b'); g.fillStyle = '#fff'; for (let i = 0; i < 160; i++) { g.globalAlpha = 0.4 + ((i * 13) % 6) / 10; g.fillRect((i * 7919) % W, (i * 104729) % H, (1 + (i % 3)) * u, (1 + (i % 3)) * u); } g.globalAlpha = 1;
      g.fillStyle = '#d9824b'; g.beginPath(); g.arc(W * 0.8, H * 0.78, 160 * u, 0, 7); g.fill(); break;
    }
    default: { grad(g, W, 0, gy, '#eef1f6', '#cfd6e2'); grad(g, W, gy, H, '#b8c0cf', '#9aa3b6'); floorLine(); }
  }
  return c;
}

/** Returns { canvas, anchor:{x,y} } where anchor is a useful snap point (seat top / base centre). */
export function drawProp(kind, size = 200) {
  const s = size; let c, g, anchor;
  const mk = (w, h) => { c = mkCanvas(Math.ceil(w), Math.ceil(h)); g = c.getContext('2d'); g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = '#2b1d12'; };
  switch (kind) {
    case 'chair': {
      mk(s * 0.8, s * 1.15); const w = c.width, h = c.height;
      g.fillStyle = '#b5773f';
      rr(g, 6, h * 0.08, w * 0.14, h * 0.62, 6); g.fill(); g.stroke(); // back (left, character faces +x)
      rr(g, 6, h * 0.5, w * 0.92, h * 0.1, 6); g.fill(); g.stroke(); // seat
      g.fillStyle = '#8f5a2b'; rr(g, 12, h * 0.6, w * 0.12, h * 0.37, 4); g.fill(); g.stroke(); rr(g, w * 0.78, h * 0.6, w * 0.12, h * 0.37, 4); g.fill(); g.stroke();
      anchor = { x: w * 0.5, y: h * 0.5 }; break;
    }
    case 'bench': {
      mk(s * 1.6, s * 0.9); const w = c.width, h = c.height; g.fillStyle = '#a4703c';
      rr(g, 6, h * 0.1, w - 12, h * 0.12, 5); g.fill(); g.stroke(); rr(g, 6, h * 0.5, w - 12, h * 0.12, 5); g.fill(); g.stroke();
      g.fillStyle = '#3a3f4a'; g.fillRect(w * 0.1, h * 0.6, 12, h * 0.36); g.fillRect(w * 0.86, h * 0.6, 12, h * 0.36); anchor = { x: w * 0.5, y: h * 0.5 }; break;
    }
    case 'table': { mk(s * 1.5, s * 0.9); const w = c.width, h = c.height; g.fillStyle = '#c48a52'; rr(g, 6, h * 0.1, w - 12, h * 0.14, 6); g.fill(); g.stroke(); g.fillStyle = '#8f5a2b'; g.fillRect(w * 0.1, h * 0.24, 16, h * 0.7); g.fillRect(w * 0.86, h * 0.24, 16, h * 0.7); g.strokeRect(w * 0.1, h * 0.24, 16, h * 0.7); g.strokeRect(w * 0.86, h * 0.24, 16, h * 0.7); anchor = { x: w / 2, y: h * 0.1 }; break; }
    case 'ball': { mk(s * 0.4, s * 0.4); const r = c.width / 2 - 4; g.fillStyle = '#ef476f'; g.beginPath(); g.arc(c.width / 2, c.height / 2, r, 0, 7); g.fill(); g.stroke(); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(c.width * 0.36, c.height * 0.32, r * 0.25, r * 0.16, -0.6, 0, 7); g.fill(); anchor = { x: c.width / 2, y: c.height }; break; }
    case 'box': { mk(s * 0.6, s * 0.6); const w = c.width, h = c.height; g.fillStyle = '#d9a566'; g.fillRect(6, 6, w - 12, h - 12); g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(w / 2 - 8, 6, 16, h - 12); anchor = { x: w / 2, y: 6 }; break; }
    case 'tree': { mk(s * 1.1, s * 1.8); const w = c.width, h = c.height; g.fillStyle = '#6b4a30'; g.fillRect(w * 0.44, h * 0.5, w * 0.12, h * 0.5); g.fillStyle = '#4f9a4b'; g.beginPath(); g.arc(w / 2, h * 0.3, w * 0.42, 0, 7); g.arc(w * 0.28, h * 0.45, w * 0.26, 0, 7); g.arc(w * 0.72, h * 0.45, w * 0.26, 0, 7); g.fill(); anchor = { x: w / 2, y: h }; break; }
    case 'sun': { mk(s * 0.8, s * 0.8); const w = c.width; g.fillStyle = '#ffd23f'; g.strokeStyle = '#ffd23f'; g.lineWidth = 6; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * w * 0.34, w / 2 + Math.sin(a) * w * 0.34); g.lineTo(w / 2 + Math.cos(a) * w * 0.47, w / 2 + Math.sin(a) * w * 0.47); g.stroke(); } g.beginPath(); g.arc(w / 2, w / 2, w * 0.28, 0, 7); g.fill(); anchor = { x: w / 2, y: w / 2 }; break; }
    case 'lamp': { mk(s * 0.5, s * 1.4); const w = c.width, h = c.height; g.fillStyle = '#3a3f4a'; g.fillRect(w / 2 - 4, h * 0.2, 8, h * 0.76); g.fillRect(w * 0.25, h * 0.94, w * 0.5, 8); g.fillStyle = '#ffd98a'; g.beginPath(); g.moveTo(w * 0.15, h * 0.22); g.lineTo(w * 0.85, h * 0.22); g.lineTo(w * 0.68, h * 0.02); g.lineTo(w * 0.32, h * 0.02); g.closePath(); g.fill(); g.stroke(); anchor = { x: w / 2, y: h }; break; }
    case 'door': { mk(s * 0.9, s * 1.7); const w = c.width, h = c.height; g.fillStyle = '#8a5a35'; g.fillRect(6, 6, w - 12, h - 6); g.strokeRect(6, 6, w - 12, h - 6); g.strokeRect(w * 0.18, h * 0.1, w * 0.64, h * 0.34); g.strokeRect(w * 0.18, h * 0.52, w * 0.64, h * 0.38); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(w * 0.8, h * 0.55, 7, 0, 7); g.fill(); anchor = { x: w / 2, y: h }; break; }
    default: { mk(s * 0.5, s * 0.5); g.fillStyle = '#9aa3b6'; g.fillRect(6, 6, c.width - 12, c.height - 12); g.strokeRect(6, 6, c.width - 12, c.height - 12); anchor = { x: c.width / 2, y: c.height }; }
  }
  return { canvas: c, anchor };
}
