// neurio Craft — 100% procedural texture atlas drawn on a canvas at boot.
// 8×8 tiles of 64px → 512×512 atlas. No image files, works offline.
import * as THREE from 'three';
import { TILE } from './blocks.js';

export const ATLAS_COLS = 8, ATLAS_ROWS = 8, TILE_PX = 64;

// Small deterministic RNG so textures look identical on every machine.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

export function buildAtlas() {
  const S = TILE_PX;
  const cv = document.createElement('canvas');
  cv.width = ATLAS_COLS * S; cv.height = ATLAS_ROWS * S;
  const ctx = cv.getContext('2d');
  const origin = (t) => [(t % ATLAS_COLS) * S, Math.floor(t / ATLAS_COLS) * S];

  // Fill a tile with a base colour + per-pixel grain (2px grain → chunky MC feel).
  function grain(tile, base, vary = 0.16, seed = tile * 7919 + 13) {
    const [ox, oy] = origin(tile); const R = rng(seed);
    ctx.fillStyle = base; ctx.fillRect(ox, oy, S, S);
    for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
      ctx.fillStyle = shade(base, 1 + (R() - 0.5) * 2 * vary);
      ctx.fillRect(ox + x, oy + y, 2, 2);
    }
    return R;
  }
  function speckles(tile, colors, n, size = 3, seed = 5) {
    const [ox, oy] = origin(tile); const R = rng(seed + tile * 131);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[(R() * colors.length) | 0];
      ctx.fillRect(ox + R() * (S - size), oy + R() * (S - size), 1 + R() * size, 1 + R() * size);
    }
  }

  // ── Grass top / dirt / grass side ──────────────────────────────────────────
  grain(TILE.GRASS_TOP, '#5fa83a', 0.22);
  speckles(TILE.GRASS_TOP, ['#79c24e', '#4c8a2c', '#8fd45e', '#3f7524'], 260, 2);
  grain(TILE.DIRT, '#8a5f3c', 0.2);
  speckles(TILE.DIRT, ['#6e4a2d', '#a1744d', '#5d3d24', '#b08a5c'], 200, 4);
  {
    const [ox, oy] = origin(TILE.GRASS_SIDE); const R = rng(99);
    ctx.drawImage(cv, ...origin(TILE.DIRT), S, S, ox, oy, S, S); // dirt base
    ctx.fillStyle = '#5fa83a'; ctx.fillRect(ox, oy, S, 14);
    for (let x = 0; x < S; x += 2) { // jagged grass lip dripping down
      const d = 12 + R() * 12;
      ctx.fillStyle = shade('#5fa83a', 0.85 + R() * 0.35);
      ctx.fillRect(ox + x, oy, 2, d);
    }
    speckles(TILE.GRASS_SIDE, ['#79c24e', '#4c8a2c'], 90, 2);
  }

  // ── Stone family ───────────────────────────────────────────────────────────
  grain(TILE.STONE, '#7d7d7d', 0.1);
  speckles(TILE.STONE, ['#6a6a6a', '#8f8f8f', '#5f5f5f'], 120, 5);
  grain(TILE.COBBLE, '#6f6f6f', 0.12);
  {
    const [ox, oy] = origin(TILE.COBBLE); const R = rng(7);
    for (let i = 0; i < 26; i++) { // rounded stones with dark mortar between
      const x = ox + R() * S, y = oy + R() * S, w = 10 + R() * 14, h = 8 + R() * 10;
      ctx.fillStyle = shade('#828282', 0.8 + R() * 0.45);
      ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, R(), 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(40,40,40,.55)'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  grain(TILE.STONEBRICK, '#7a7a7a', 0.08);
  {
    const [ox, oy] = origin(TILE.STONEBRICK);
    ctx.strokeStyle = 'rgba(45,45,45,.8)'; ctx.lineWidth = 3;
    for (let r = 0; r <= 4; r++) { ctx.beginPath(); ctx.moveTo(ox, oy + r * 16); ctx.lineTo(ox + S, oy + r * 16); ctx.stroke(); }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const x = ox + ((r % 2) * 16) + c * 32;
      ctx.beginPath(); ctx.moveTo(x, oy + r * 16); ctx.lineTo(x, oy + r * 16 + 16); ctx.stroke();
    }
    speckles(TILE.STONEBRICK, ['#666', '#8a8a8a'], 60, 3);
  }
  grain(TILE.BEDROCK, '#3d3d3d', 0.25);
  speckles(TILE.BEDROCK, ['#222', '#555', '#2c2c2c', '#666'], 160, 8);

  // ── Sand / sandstone / gravel ──────────────────────────────────────────────
  grain(TILE.SAND, '#dcd29b', 0.09);
  speckles(TILE.SAND, ['#cbbf84', '#ece2b0', '#bfae72'], 160, 2);
  grain(TILE.SANDSTONE, '#d8cf9f', 0.07);
  {
    const [ox, oy] = origin(TILE.SANDSTONE);
    ctx.fillStyle = 'rgba(160,148,100,.7)';
    ctx.fillRect(ox, oy + 6, S, 3); ctx.fillRect(ox, oy + S - 9, S, 3);
  }
  grain(TILE.GRAVEL, '#8a8078', 0.18);
  speckles(TILE.GRAVEL, ['#6e655e', '#a1988d', '#5d554e', '#b5aa9c', '#7d6a55'], 240, 4);

  // ── Wood ───────────────────────────────────────────────────────────────────
  {
    const [ox, oy] = origin(TILE.LOG_SIDE); const R = rng(31);
    ctx.fillStyle = '#6b5230'; ctx.fillRect(ox, oy, S, S);
    for (let x = 0; x < S; x += 4) { // vertical bark ridges
      ctx.fillStyle = shade('#6b5230', 0.7 + R() * 0.55);
      ctx.fillRect(ox + x, oy, 3, S);
    }
    speckles(TILE.LOG_SIDE, ['#4c3a20', '#86663c'], 70, 3);
  }
  {
    const [ox, oy] = origin(TILE.LOG_TOP); const R = rng(37);
    ctx.fillStyle = '#b08d57'; ctx.fillRect(ox, oy, S, S);
    for (let r = 30; r > 3; r -= 5) { // growth rings
      ctx.strokeStyle = shade('#8a6a3e', 0.85 + R() * 0.3); ctx.lineWidth = 3;
      ctx.strokeRect(ox + S / 2 - r, oy + S / 2 - r, r * 2, r * 2);
    }
    ctx.strokeStyle = '#6b5230'; ctx.lineWidth = 6; ctx.strokeRect(ox + 2, oy + 2, S - 4, S - 4);
  }
  {
    const [ox, oy] = origin(TILE.BIRCH_SIDE);
    grain(TILE.BIRCH_SIDE, '#d8d3c3', 0.06);
    speckles(TILE.BIRCH_SIDE, ['#3d3d3d', '#555048'], 40, 3);
    const R = rng(41);
    ctx.fillStyle = '#3d3d3d'; // birch's signature black dashes
    for (let i = 0; i < 12; i++) ctx.fillRect(ox + R() * (S - 12), oy + R() * S, 5 + R() * 8, 3);
  }
  {
    grain(TILE.PLANKS, '#b08d57', 0.1);
    const [ox, oy] = origin(TILE.PLANKS); const R = rng(43);
    ctx.fillStyle = 'rgba(90,66,35,.85)';
    for (let r = 0; r <= 4; r++) ctx.fillRect(ox, oy + r * 16 - 1, S, 3); // board gaps
    for (let r = 0; r < 4; r++) ctx.fillRect(ox + ((r * 29) % 48) + 8, oy + r * 16, 3, 16); // joints
    ctx.fillStyle = '#5d4525'; // nails
    for (let r = 0; r < 4; r++) { ctx.fillRect(ox + 4, oy + r * 16 + 6, 3, 3); ctx.fillRect(ox + S - 7, oy + r * 16 + 6, 3, 3); }
    for (let i = 0; i < 26; i++) { ctx.fillStyle = `rgba(120,88,48,${0.25 + R() * 0.3})`; ctx.fillRect(ox + R() * S, oy + R() * S, 6 + R() * 10, 1.5); }
  }

  // ── Leaves / brick / glass ─────────────────────────────────────────────────
  grain(TILE.LEAVES, '#3e7d28', 0.28);
  speckles(TILE.LEAVES, ['#2c5c1c', '#57a23a', '#1f4213', '#6cb84a'], 420, 4);
  {
    grain(TILE.BRICK, '#9c5a4a', 0.12);
    const [ox, oy] = origin(TILE.BRICK);
    ctx.fillStyle = '#b8aca4'; // mortar
    for (let r = 0; r <= 4; r++) ctx.fillRect(ox, oy + r * 16 - 2, S, 4);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      ctx.fillRect(ox + ((r % 2) * 16) + c * 32 - 2, oy + r * 16, 4, 16);
    }
  }
  {
    const [ox, oy] = origin(TILE.GLASS);
    ctx.clearRect(ox, oy, S, S);
    ctx.strokeStyle = 'rgba(230,248,250,.95)'; ctx.lineWidth = 4; ctx.strokeRect(ox + 2, oy + 2, S - 4, S - 4);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 5; // shine streaks
    ctx.beginPath(); ctx.moveTo(ox + 14, oy + S - 10); ctx.lineTo(ox + 34, oy + 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox + 30, oy + S - 10); ctx.lineTo(ox + 44, oy + 16); ctx.stroke();
  }

  // ── Snow ───────────────────────────────────────────────────────────────────
  grain(TILE.SNOW_TOP, '#f2f7f7', 0.05);
  speckles(TILE.SNOW_TOP, ['#ffffff', '#dde8ea'], 90, 2);
  {
    const [ox, oy] = origin(TILE.SNOW_SIDE); const R = rng(53);
    ctx.drawImage(cv, ...origin(TILE.DIRT), S, S, ox, oy, S, S);
    ctx.fillStyle = '#f2f7f7';
    for (let x = 0; x < S; x += 2) ctx.fillRect(ox + x, oy, 2, 12 + R() * 9);
  }

  // ── Water (also exported as its own animated texture) ──────────────────────
  const paintWater = (c, ox, oy, size) => {
    const R = rng(59);
    c.fillStyle = '#3f76e4'; c.fillRect(ox, oy, size, size);
    for (let i = 0; i < 34; i++) {
      c.fillStyle = `rgba(${140 + R() * 80},${190 + R() * 50},255,${0.25 + R() * 0.4})`;
      c.fillRect(ox + R() * size, oy + R() * size, 6 + R() * 16, 2);
    }
  };
  paintWater(ctx, ...origin(TILE.WATER), S);

  // ── Plants (transparent background) ────────────────────────────────────────
  {
    const [ox, oy] = origin(TILE.TALLGRASS); const R = rng(61);
    ctx.clearRect(ox, oy, S, S);
    for (let i = 0; i < 22; i++) {
      const x = ox + 6 + R() * (S - 12), h = 22 + R() * 36;
      ctx.strokeStyle = shade('#5f9e38', 0.75 + R() * 0.5); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, oy + S); ctx.quadraticCurveTo(x + (R() - 0.5) * 10, oy + S - h * 0.6, x + (R() - 0.5) * 18, oy + S - h); ctx.stroke();
    }
  }
  {
    const [ox, oy] = origin(TILE.ROSE);
    ctx.clearRect(ox, oy, S, S);
    ctx.strokeStyle = '#3e7d28'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(ox + S / 2, oy + S); ctx.lineTo(ox + S / 2, oy + 22); ctx.stroke();
    ctx.fillStyle = '#4c8a2c'; // leaves
    ctx.beginPath(); ctx.ellipse(ox + 22, oy + 44, 9, 4, -0.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ox + 42, oy + 38, 9, 4, 0.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#d63c4a'; // petals
    for (const [dx, dy] of [[0, -7], [-7, 0], [7, 0], [0, 6], [-5, -5], [5, -5]]) {
      ctx.beginPath(); ctx.arc(ox + S / 2 + dx, oy + 16 + dy, 6.5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#f5d04a'; ctx.beginPath(); ctx.arc(ox + S / 2, oy + 15, 3.5, 0, 7); ctx.fill();
  }

  // ── Cactus / crafting / ores / TNT / pumpkin ───────────────────────────────
  {
    grain(TILE.CACTUS_SIDE, '#4c7d33', 0.1);
    const [ox, oy] = origin(TILE.CACTUS_SIDE);
    ctx.fillStyle = 'rgba(30,60,18,.8)';
    for (let x = 6; x < S; x += 13) ctx.fillRect(ox + x, oy, 3, S);
    speckles(TILE.CACTUS_SIDE, ['#e8e8c8'], 46, 1.5);
    grain(TILE.CACTUS_TOP, '#55853a', 0.1);
    const [tx, ty] = origin(TILE.CACTUS_TOP);
    ctx.strokeStyle = 'rgba(30,60,18,.8)'; ctx.lineWidth = 4; ctx.strokeRect(tx + 3, ty + 3, S - 6, S - 6);
  }
  {
    grain(TILE.CRAFT_TOP, '#b08d57', 0.08);
    const [ox, oy] = origin(TILE.CRAFT_TOP);
    ctx.strokeStyle = 'rgba(70,50,25,.9)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * (S / 3), oy); ctx.lineTo(ox + i * (S / 3), oy + S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + i * (S / 3)); ctx.lineTo(ox + S, oy + i * (S / 3)); ctx.stroke();
    }
    grain(TILE.CRAFT_SIDE, '#a07c4a', 0.1);
    const [sx, sy] = origin(TILE.CRAFT_SIDE);
    ctx.fillStyle = '#6b5230'; ctx.fillRect(sx, sy, S, 10); ctx.fillRect(sx, sy + S - 10, S, 10);
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(sx + 12, sy + 22, 16, 5); // saw-ish tool mark
    ctx.fillStyle = '#5d4525'; ctx.fillRect(sx + 38, sy + 20, 5, 18);
  }
  const ore = (tile, colors, seed) => {
    const [ox, oy] = origin(tile);
    ctx.drawImage(cv, ...origin(TILE.STONE), S, S, ox, oy, S, S);
    const R = rng(seed);
    for (let i = 0; i < 7; i++) {
      const x = ox + 8 + R() * (S - 16), y = oy + 8 + R() * (S - 16);
      ctx.fillStyle = colors[0];
      ctx.fillRect(x, y, 7, 5); ctx.fillRect(x + 2, y - 3, 4, 3); ctx.fillRect(x + 1, y + 5, 5, 3);
      ctx.fillStyle = colors[1]; ctx.fillRect(x + 1, y + 1, 2.5, 2);
    }
  };
  ore(TILE.DIAMOND_ORE, ['#6fe3dd', '#c8fffa'], 67);
  ore(TILE.GOLD_ORE, ['#f5d04a', '#fff0a8'], 71);
  ore(TILE.COAL_ORE, ['#2e2e2e', '#555'], 73);
  {
    grain(TILE.TNT_SIDE, '#d63c22', 0.1);
    const [ox, oy] = origin(TILE.TNT_SIDE);
    ctx.fillStyle = '#e8ddc8'; ctx.fillRect(ox, oy + 20, S, 24);
    ctx.fillStyle = '#2b2b2b'; ctx.font = `bold 19px monospace`; ctx.textAlign = 'center';
    ctx.fillText('TNT', ox + S / 2, oy + 39);
    grain(TILE.TNT_TOP, '#d63c22', 0.1);
    const [tx, ty] = origin(TILE.TNT_TOP);
    ctx.fillStyle = '#2b2b2b'; ctx.fillRect(tx + S / 2 - 6, ty + S / 2 - 6, 12, 12); // fuse
  }
  {
    grain(TILE.PUMPKIN_SIDE, '#d9821e', 0.09);
    const [ox, oy] = origin(TILE.PUMPKIN_SIDE);
    ctx.fillStyle = 'rgba(160,90,10,.85)';
    for (let x = 4; x < S; x += 12) ctx.fillRect(ox + x, oy, 3, S);
    grain(TILE.PUMPKIN_TOP, '#d9821e', 0.09);
    const [tx, ty] = origin(TILE.PUMPKIN_TOP);
    ctx.fillStyle = '#5d6e2a'; ctx.fillRect(tx + S / 2 - 4, ty + S / 2 - 6, 8, 12); // stem
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;

  // Separate, scrollable water texture for the animated water material.
  const wcv = document.createElement('canvas'); wcv.width = wcv.height = S;
  paintWater(wcv.getContext('2d'), 0, 0, S);
  const waterTex = new THREE.CanvasTexture(wcv);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.colorSpace = THREE.SRGBColorSpace;
  waterTex.magFilter = THREE.NearestFilter;

  // Soft procedural cloud sprite sheet.
  const ccv = document.createElement('canvas'); ccv.width = ccv.height = 256;
  const cctx = ccv.getContext('2d'); const CR = rng(1234);
  for (let i = 0; i < 42; i++) {
    const x = CR() * 256, y = CR() * 256, r = 16 + CR() * 38;
    const g = cctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    cctx.fillStyle = g; cctx.beginPath(); cctx.arc(x, y, r, 0, 7); cctx.fill();
  }
  const cloudTex = new THREE.CanvasTexture(ccv);
  cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;

  // Per-tile icon data-URLs for the hotbar / inventory UI.
  const icons = {};
  const icv = document.createElement('canvas'); icv.width = icv.height = 48;
  const ictx = icv.getContext('2d');
  for (let t = 0; t < ATLAS_COLS * ATLAS_ROWS; t++) {
    ictx.clearRect(0, 0, 48, 48);
    ictx.imageSmoothingEnabled = false;
    ictx.drawImage(cv, ...origin(t), S, S, 0, 0, 48, 48);
    icons[t] = icv.toDataURL();
  }

  return { atlas: tex, waterTex, cloudTex, icons };
}

// UV rect for a tile, inset by half a texel to stop atlas bleeding.
export function tileUV(tile) {
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const e = 0.35 / (ATLAS_COLS * TILE_PX);
  const u0 = col / ATLAS_COLS + e, u1 = (col + 1) / ATLAS_COLS - e;
  const v1 = 1 - row / ATLAS_ROWS - e, v0 = 1 - (row + 1) / ATLAS_ROWS + e;
  return [u0, v0, u1, v1]; // u0,v0 = bottom-left · u1,v1 = top-right
}
