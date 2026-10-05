// ============================================================
// ProceduralTextures.js — Dynamic Canvas PBR Textures
// ============================================================

import * as THREE from 'three';

const textureCache = new Map();

function getCanvas(w = 512, h = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

export class ProceduralTextures {
  static getWoodFloor() {
    if (textureCache.has('woodFloor')) return textureCache.get('woodFloor');
    const { canvas, ctx } = getCanvas(512, 512);

    // Warm wood base
    ctx.fillStyle = '#6e4726';
    ctx.fillRect(0, 0, 512, 512);

    // Planks
    const plankHeight = 64;
    for (let y = 0; y < 512; y += plankHeight) {
      // Plank tone variation
      const brightness = (Math.random() - 0.5) * 30;
      ctx.fillStyle = `rgba(${120 + brightness}, ${75 + brightness * 0.7}, ${40 + brightness * 0.4}, 0.8)`;
      ctx.fillRect(0, y, 512, plankHeight - 2);

      // Wood grain lines
      ctx.strokeStyle = 'rgba(60, 35, 15, 0.25)';
      ctx.lineWidth = 1.2;
      for (let g = 0; g < 10; g++) {
        ctx.beginPath();
        const gy = y + 4 + g * 5 + Math.random() * 3;
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(170, gy + (Math.random() - 0.5) * 6, 340, gy + (Math.random() - 0.5) * 6, 512, gy);
        ctx.stroke();
      }

      // Plank seams
      ctx.fillStyle = '#2d1808';
      ctx.fillRect(0, y + plankHeight - 2, 512, 2);

      // Staggered vertical seams
      const seamX1 = (y % 128 === 0) ? 220 : 440;
      const seamX2 = seamX1 === 220 ? 460 : 180;
      ctx.fillRect(seamX1, y, 2, plankHeight);
      ctx.fillRect(seamX2, y, 2, plankHeight);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    textureCache.set('woodFloor', tex);
    return tex;
  }

  static getCeramicTile(color = '#e2e8f0', grout = '#94a3b8') {
    const key = `tile_${color}`;
    if (textureCache.has(key)) return textureCache.get(key);
    const { canvas, ctx } = getCanvas(512, 512);

    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, 512, 512);

    const tileSize = 64;
    for (let x = 0; x < 512; x += tileSize) {
      for (let y = 0; y < 512; y += tileSize) {
        ctx.fillStyle = color;
        ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);

        // Soft gradient highlight
        const grad = ctx.createLinearGradient(x + 2, y + 2, x + tileSize, y + tileSize);
        grad.addColorStop(0, 'rgba(255,255,255,0.25)');
        grad.addColorStop(1, 'rgba(0,0,0,0.1)');
        ctx.fillStyle = grad;
        ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    textureCache.set(key, tex);
    return tex;
  }

  static getDrywall(tint = '#f8fafc') {
    const key = `drywall_${tint}`;
    if (textureCache.has(key)) return textureCache.get(key);
    const { canvas, ctx } = getCanvas(512, 512);

    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle plaster noise
    for (let i = 0; i < 20000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const alpha = Math.random() * 0.04;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      ctx.fillRect(x, y, 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    textureCache.set(key, tex);
    return tex;
  }

  static getMotherboard() {
    if (textureCache.has('mobo')) return textureCache.get('mobo');
    const { canvas, ctx } = getCanvas(512, 512);

    ctx.fillStyle = '#0f172a'; // Matte dark PCB
    ctx.fillRect(0, 0, 512, 512);

    // Gold/silver circuitry traces
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 60; i++) {
      ctx.beginPath();
      let sx = Math.random() * 512;
      let sy = Math.random() * 512;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 30, sy);
      ctx.lineTo(sx + 60, sy + 30);
      ctx.lineTo(sx + 120, sy + 30);
      ctx.stroke();
    }

    // Gold contacts
    ctx.fillStyle = '#fbbf24';
    for (let i = 20; i < 490; i += 12) {
      ctx.fillRect(i, 490, 8, 16);
    }

    // Socket chip center
    ctx.fillStyle = '#334155';
    ctx.fillRect(180, 160, 150, 150);
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(180, 160, 150, 150);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('NOVA PRO Z790', 190, 240);

    const tex = new THREE.CanvasTexture(canvas);
    textureCache.set('mobo', tex);
    return tex;
  }

  static getGpuShroud() {
    if (textureCache.has('gpuShroud')) return textureCache.get('gpuShroud');
    const { canvas, ctx } = getCanvas(512, 256);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 512, 256);

    // Dual fan rings
    [140, 370].forEach(cx => {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(cx, 128, 90, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, 128, 86, 0, Math.PI * 2);
      ctx.stroke();

      // Fan blades
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 6;
      for (let a = 0; a < 9; a++) {
        const rad = (a * Math.PI * 2) / 9;
        ctx.beginPath();
        ctx.moveTo(cx, 128);
        ctx.lineTo(cx + Math.cos(rad) * 75, 128 + Math.sin(rad) * 75);
        ctx.stroke();
      }

      // Center logo badge
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.arc(cx, 128, 25, 0, Math.PI * 2);
      ctx.fill();
    });

    // Top logo
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('RTX NOVA', 215, 35);

    const tex = new THREE.CanvasTexture(canvas);
    textureCache.set('gpuShroud', tex);
    return tex;
  }

  static getCardboardPackage(label = 'NOVAMARKET') {
    const key = `pkg_${label}`;
    if (textureCache.has(key)) return textureCache.get(key);
    const { canvas, ctx } = getCanvas(512, 512);

    // Kraft paper background
    ctx.fillStyle = '#b47b49';
    ctx.fillRect(0, 0, 512, 512);

    // Clear packing tape
    ctx.fillStyle = 'rgba(230, 215, 180, 0.45)';
    ctx.fillRect(0, 230, 512, 52);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.strokeRect(0, 230, 512, 52);

    // Shipping Label
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(100, 70, 312, 140);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(100, 70, 312, 140);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(label, 120, 105);

    ctx.font = '14px sans-serif';
    ctx.fillText('PRIORITY AIR DELIVERY', 120, 130);
    ctx.fillText('TRACK: #NVM-8842-EXP', 120, 150);

    // Barcode
    for (let bx = 120; bx < 390; bx += Math.random() > 0.4 ? 6 : 3) {
      ctx.fillRect(bx, 165, 2, 35);
    }

    // Fragile / Arrow icon
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('▲ FRAGILE ▲', 200, 330);

    const tex = new THREE.CanvasTexture(canvas);
    textureCache.set(key, tex);
    return tex;
  }

  static getMonitorScreen() {
    const { canvas, ctx } = getCanvas(1024, 576);

    // Wallpaper gradient (deep synthwave / modern cyber dusk)
    const grad = ctx.createLinearGradient(0, 0, 1024, 576);
    grad.addColorStop(0, '#090d16');
    grad.addColorStop(0.5, '#1e1b4b');
    grad.addColorStop(1, '#311042');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 576);

    // Neon mountain grid
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 1024; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 380);
      ctx.lineTo(512 + (x - 512) * 2.5, 576);
      ctx.stroke();
    }
    for (let y = 380; y < 576; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }

    // Sun orb
    const sunGrad = ctx.createRadialGradient(512, 360, 20, 512, 360, 160);
    sunGrad.addColorStop(0, '#f43f5e');
    sunGrad.addColorStop(1, 'rgba(244, 63, 94, 0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(512, 360, 160, 0, Math.PI * 2);
    ctx.fill();

    // OS Taskbar
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(0, 536, 1024, 40);

    // Taskbar icons
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('⊞ NOVA OS', 20, 562);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(160, 542, 28, 28);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('SF', 167, 561);

    ctx.fillStyle = '#10b981';
    ctx.fillRect(200, 542, 28, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText('GH', 206, 561);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.fillText('StreamForge Desktop — Click Monitor to Sit & Control', 300, 562);

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  static getRoadAsphalt() {
    if (textureCache.has('asphalt')) return textureCache.get('asphalt');
    const { canvas, ctx } = getCanvas(512, 512);

    ctx.fillStyle = '#1e242b';
    ctx.fillRect(0, 0, 512, 512);

    // Road grain
    for (let i = 0; i < 15000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(x, y, 2, 2);
    }

    // Yellow center divider dashed line
    ctx.fillStyle = '#facc15';
    for (let y = 20; y < 512; y += 80) {
      ctx.fillRect(250, y, 12, 45);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    textureCache.set('asphalt', tex);
    return tex;
  }

  static getSidewalkConcrete() {
    if (textureCache.has('sidewalk')) return textureCache.get('sidewalk');
    const { canvas, ctx } = getCanvas(512, 512);

    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(0, 0, 512, 512);

    // Paver slabs
    const slabSize = 128;
    for (let x = 0; x < 512; x += slabSize) {
      for (let y = 0; y < 512; y += slabSize) {
        ctx.fillStyle = (x + y) % 256 === 0 ? '#8c9bb0' : '#9aa9be';
        ctx.fillRect(x + 2, y + 2, slabSize - 4, slabSize - 4);

        ctx.fillStyle = '#475569';
        ctx.fillRect(x, y + slabSize - 2, slabSize, 2);
        ctx.fillRect(x + slabSize - 2, y, 2, slabSize);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    textureCache.set('sidewalk', tex);
    return tex;
  }

  static getStoreSign(title, sub, themeColor = '#06b6d4') {
    const key = `sign_${title}`;
    if (textureCache.has(key)) return textureCache.get(key);
    const { canvas, ctx } = getCanvas(512, 128);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 512, 128);

    // Neon border
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 116);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, 256, 64);

    ctx.fillStyle = themeColor;
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(sub, 256, 98);

    const tex = new THREE.CanvasTexture(canvas);
    textureCache.set(key, tex);
    return tex;
  }

  static getPoster(title, sub, bgColor = '#7c3aed') {
    const key = `poster_${title}`;
    if (textureCache.has(key)) return textureCache.get(key);
    const { canvas, ctx } = getCanvas(384, 512);

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 384, 512);

    // Graphic art
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(0, 320);
    ctx.lineTo(384, 180);
    ctx.lineTo(384, 512);
    ctx.lineTo(0, 512);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, 192, 120);

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(sub, 192, 160);

    const tex = new THREE.CanvasTexture(canvas);
    textureCache.set(key, tex);
    return tex;
  }
}
