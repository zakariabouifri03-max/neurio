// ── High-Resolution Procedural PBR & Bump CanvasTextures ─────────────────────
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function makeCanvas(w, h, fn, isLinear = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = isLinear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const _cache = new Map();
function cached(key, builder) {
  if (_cache.has(key)) return _cache.get(key);
  const v = builder();
  _cache.set(key, v);
  return v;
}

// ── 1024x1024 High-Detail Desert Highway Asphalt + Bump Map ──
export function highwayTexture() {
  return cached('highway_hd', () => {
    const r = mulberry32(1979);
    const tex = makeCanvas(1024, 1024, (g, w, h) => {
      g.fillStyle = '#2d2f34';
      g.fillRect(0, 0, w, h);

      // Fine basalt & granite aggregate grain
      for (let i = 0; i < 6500; i++) {
        const v = 30 + ((r() * 48) | 0);
        g.fillStyle = `rgba(${v},${v},${v + 3},${0.16 + r() * 0.28})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 4.5);
      }

      // Oil & rubber tire wear lanes
      const drawLaneWear = (cx) => {
        const grd = g.createLinearGradient(cx - 55, 0, cx + 55, 0);
        grd.addColorStop(0, 'rgba(14,15,18,0)');
        grd.addColorStop(0.5, 'rgba(14,15,18,0.32)');
        grd.addColorStop(1, 'rgba(14,15,18,0)');
        g.fillStyle = grd;
        g.fillRect(cx - 55, 0, 110, h);
      };
      drawLaneWear(w * 0.21);
      drawLaneWear(w * 0.36);
      drawLaneWear(w * 0.64);
      drawLaneWear(w * 0.79);

      // Sealed tar cracks
      g.strokeStyle = 'rgba(12, 13, 16, 0.65)';
      g.lineWidth = 2.2;
      for (let c = 0; c < 34; c++) {
        let cx = 80 + r() * (w - 160);
        let cy = r() * h;
        g.beginPath();
        g.moveTo(cx, cy);
        for (let s = 0; s < 8; s++) {
          cx += (r() - 0.5) * 44;
          cy += (r() - 0.25) * 38;
          g.lineTo(cx, cy);
        }
        g.stroke();
      }

      // Gravel & blown desert sand along left & right shoulders
      const leftGrad = g.createLinearGradient(0, 0, 96, 0);
      leftGrad.addColorStop(0, '#c8a36b');
      leftGrad.addColorStop(0.5, 'rgba(200,163,107,0.55)');
      leftGrad.addColorStop(1, 'rgba(200,163,107,0)');
      g.fillStyle = leftGrad;
      g.fillRect(0, 0, 96, h);

      const rightGrad = g.createLinearGradient(w, 0, w - 96, 0);
      rightGrad.addColorStop(0, '#c8a36b');
      rightGrad.addColorStop(0.5, 'rgba(200,163,107,0.55)');
      rightGrad.addColorStop(1, 'rgba(200,163,107,0)');
      g.fillStyle = rightGrad;
      g.fillRect(w - 96, 0, 96, h);

      // Distressed white shoulder lines
      g.fillStyle = 'rgba(232, 228, 214, 0.68)';
      g.fillRect(74, 0, 11, h);
      g.fillRect(w - 85, 0, 11, h);

      // Distressed double/dashed highway yellow centerline
      g.fillStyle = '#eab308';
      for (let y = 0; y < 4; y++) {
        g.fillRect(w / 2 - 9, y * 256 + 34, 18, 152);
      }
      // Scuff marks across paint lines
      for (let i = 0; i < 420; i++) {
        g.fillStyle = 'rgba(42,44,48,0.45)';
        g.fillRect(r() * w, r() * h, 4 + r() * 14, 2 + r() * 6);
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

export function highwayBumpTexture() {
  return cached('highway_bump', () => {
    const r = mulberry32(1981);
    const tex = makeCanvas(512, 512, (g, w, h) => {
      g.fillStyle = '#808080';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) {
        const v = (60 + r() * 135) | 0;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(r() * w, r() * h, 2, 2);
      }
    }, true);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

// ── 1024x1024 Sculpted Desert Sand Dunes + Ripple Bump Map ──
export function sandTexture() {
  return cached('sand_hd', () => {
    const r = mulberry32(404);
    const tex = makeCanvas(1024, 1024, (g, w, h) => {
      g.fillStyle = '#d3ac71';
      g.fillRect(0, 0, w, h);

      // Organic wind-blown sand wave ripples
      for (let y = 0; y < h; y += 12) {
        const grd = g.createLinearGradient(0, y, 0, y + 12);
        grd.addColorStop(0, 'rgba(244, 216, 168, 0.22)');
        grd.addColorStop(0.5, 'rgba(211, 172, 113, 0.0)');
        grd.addColorStop(1, 'rgba(156, 114, 64, 0.20)');
        g.fillStyle = grd;
        g.fillRect(0, y, w, 12);
      }

      // Fine desert quartz grains & small pebbles
      for (let i = 0; i < 6500; i++) {
        const dark = r() > 0.46;
        g.fillStyle = dark
          ? `rgba(122, 86, 46, ${0.07 + r() * 0.16})`
          : `rgba(252, 234, 194, ${0.09 + r() * 0.18})`;
        const sz = 1 + r() * 4;
        g.fillRect(r() * w, r() * h, sz, sz);
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

export function sandBumpTexture() {
  return cached('sand_bump', () => {
    const r = mulberry32(409);
    const tex = makeCanvas(512, 512, (g, w, h) => {
      g.fillStyle = '#808080';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) {
        g.fillStyle = y % 16 === 0 ? '#b8b8b8' : '#4a4a4a';
        g.fillRect(0, y, w, 4);
      }
      for (let i = 0; i < 2200; i++) {
        const v = (50 + r() * 155) | 0;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(r() * w, r() * h, 2.5, 2.5);
      }
    }, true);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

// ── Vehicle Underbody Ambient Occlusion Contact Shadow ──
export function carShadowTexture() {
  return cached('car_ao_shadow', () =>
    makeCanvas(256, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const grd = g.createRadialGradient(w / 2, h / 2, 16, w / 2, h / 2, w * 0.52);
      grd.addColorStop(0, 'rgba(0, 0, 0, 0.78)');
      grd.addColorStop(0.65, 'rgba(0, 0, 0, 0.48)');
      grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.save();
      g.scale(1, h / w);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(w / 2, w / 2, w * 0.49, 0, Math.PI * 2);
      g.fill();
      g.restore();
    })
  );
}

// ── Rusty / Weathered Car Body Overlay Texture ──
export function rustMetalTexture(rustAmount = 0.5) {
  const key = 'rust_' + Math.round(rustAmount * 10);
  return cached(key, () => {
    const r = mulberry32(88 + Math.round(rustAmount * 100));
    const tex = makeCanvas(512, 512, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);

      // Subtle metallic panel seam lines
      g.strokeStyle = 'rgba(0,0,0,0.08)';
      g.lineWidth = 2;
      g.strokeRect(8, 8, w - 16, h - 16);

      if (rustAmount > 0.02) {
        const patches = Math.floor(rustAmount * 260);
        for (let i = 0; i < patches; i++) {
          const rx = r() * w;
          const ry = r() * h;
          const rad = 5 + r() * 38 * rustAmount;
          const grd = g.createRadialGradient(rx, ry, 1, rx, ry, rad);
          grd.addColorStop(0, `rgba(118, 46, 18, ${0.48 + rustAmount * 0.46})`);
          grd.addColorStop(0.55, `rgba(158, 72, 28, ${0.28 + rustAmount * 0.32})`);
          grd.addColorStop(1, 'rgba(158, 72, 28, 0)');
          g.fillStyle = grd;
          g.beginPath();
          g.arc(rx, ry, rad, 0, Math.PI * 2);
          g.fill();
        }
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

// ── Building Materials: Corrugated Iron, Stucco, Palace Sandstone, Timber ──
export function corrugatedTexture() {
  return cached('corrugated', () => {
    const r = mulberry32(311);
    const tex = makeCanvas(512, 512, (g, w, h) => {
      g.fillStyle = '#7c766e';
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) {
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fillRect(x, 0, 5, h);
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(x + 8, 0, 5, h);
      }
      for (let i = 0; i < 65; i++) {
        g.fillStyle = `rgba(138, 62, 27, ${0.14 + r() * 0.28})`;
        g.fillRect(r() * w, r() * h, 8 + r() * 22, 18 + r() * 60);
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

export function stuccoWallTexture() {
  return cached('stucco', () => {
    const r = mulberry32(512);
    const tex = makeCanvas(512, 512, (g, w, h) => {
      g.fillStyle = '#e0d3bd';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) {
        g.fillStyle = r() > 0.5 ? 'rgba(155,135,105,0.14)' : 'rgba(255,250,240,0.14)';
        g.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 6);
      }
      const grd = g.createLinearGradient(0, h * 0.65, 0, h);
      grd.addColorStop(0, 'rgba(135, 105, 70, 0)');
      grd.addColorStop(1, 'rgba(115, 82, 46, 0.48)');
      g.fillStyle = grd;
      g.fillRect(0, h * 0.65, w, h * 0.35);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

// Ornate Sandstone & Marble Wall Texture for Desert Palaces / Mansions ("9osssor")
export function palaceMarbleTexture() {
  return cached('palace_marble', () => {
    const r = mulberry32(777);
    const tex = makeCanvas(512, 512, (g, w, h) => {
      g.fillStyle = '#f3e8d2';
      g.fillRect(0, 0, w, h);

      // Sandstone ashlar block joints
      g.strokeStyle = 'rgba(168, 142, 104, 0.42)';
      g.lineWidth = 3;
      for (let y = 0; y < h; y += 64) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
        const offset = (y / 64) % 2 === 0 ? 0 : 64;
        for (let x = offset; x < w; x += 128) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + 64);
          g.stroke();
        }
      }

      // Ornate gold/terracotta mosaic frieze band near top
      g.fillStyle = '#b45309';
      g.fillRect(0, 28, w, 24);
      g.fillStyle = '#fde047';
      for (let x = 8; x < w; x += 32) {
        g.fillRect(x, 34, 16, 12);
      }

      // Subtle marble veining
      for (let i = 0; i < 600; i++) {
        g.fillStyle = `rgba(180, 150, 110, ${0.05 + r() * 0.08})`;
        g.fillRect(r() * w, r() * h, 4 + r() * 12, 2 + r() * 4);
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

export function woodPlankTexture() {
  return cached('wood_planks', () => {
    const r = mulberry32(601);
    const tex = makeCanvas(512, 512, (g, w, h) => {
      g.fillStyle = '#784f2f';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) {
        g.fillStyle = y % 64 === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(255,220,180,0.06)';
        g.fillRect(0, y, w, 30);
        g.fillStyle = 'rgba(25,15,8,0.55)';
        g.fillRect(0, y + 30, w, 2);
      }
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(40, 22, 10, ${0.06 + r() * 0.12})`;
        g.fillRect(r() * w, r() * h, 12 + r() * 35, 1.5);
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
}

// ── Dashboard Analog Gauge Cluster Texture ──
export function dashGaugeTexture() {
  return cached('dash_gauge', () =>
    makeCanvas(512, 256, (g, w, h) => {
      g.fillStyle = '#111317';
      g.fillRect(0, 0, w, h);

      g.strokeStyle = '#64748b';
      g.lineWidth = 8;
      g.strokeRect(6, 6, w - 12, h - 12);

      const drawDial = (cx, cy, rad, title, labels) => {
        g.fillStyle = '#090a0d';
        g.beginPath();
        g.arc(cx, cy, rad, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#cbd5e1';
        g.lineWidth = 4;
        g.stroke();

        const n = labels.length;
        for (let i = 0; i < n; i++) {
          const frac = i / (n - 1);
          const ang = (-0.75 + frac * 1.5) * Math.PI - Math.PI / 2;
          const x1 = cx + Math.cos(ang) * (rad - 6);
          const y1 = cy + Math.sin(ang) * (rad - 6);
          const x2 = cx + Math.cos(ang) * (rad - 18);
          const y2 = cy + Math.sin(ang) * (rad - 18);
          g.strokeStyle = frac > 0.78 ? '#ef4444' : '#f8fafc';
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          g.stroke();

          const lx = cx + Math.cos(ang) * (rad - 32);
          const ly = cy + Math.sin(ang) * (rad - 32);
          g.fillStyle = '#e2e8f0';
          g.font = 'bold 14px monospace';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(labels[i], lx, ly);
        }

        g.fillStyle = '#fbbf24';
        g.font = 'bold 13px monospace';
        g.textAlign = 'center';
        g.fillText(title, cx, cy + rad * 0.52);
      };

      drawDial(135, 128, 98, 'KM/H', ['0', '30', '60', '90', '120', '150', '200']);
      drawDial(320, 128, 68, 'TEMP °C', ['40', '80', '120']);
      drawDial(442, 128, 54, 'FUEL', ['E', '1/2', 'F']);
    })
  );
}

// ── License Plate Texture ──
export function licensePlateTexture(text = 'TLD-1979') {
  return cached('plate_' + text, () =>
    makeCanvas(256, 64, (g, w, h) => {
      g.fillStyle = '#f5ebd6';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1e293b';
      g.lineWidth = 6;
      g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = '#1e293b';
      g.font = '900 38px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
    })
  );
}

// ── Roadside Sign & Milepost Textures ──
export function signTexture(text, bg = '#155e3b', fg = '#f8fafc') {
  const key = `sign_${text}_${bg}`;
  return cached(key, () =>
    makeCanvas(256, 128, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = fg;
      g.lineWidth = 8;
      g.strokeRect(8, 8, w - 16, h - 16);
      g.fillStyle = fg;
      g.font = '900 36px Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
    })
  );
}

// ── Mom's Letter Texture on Table ──
export function letterPaperTexture() {
  return cached('mom_letter', () =>
    makeCanvas(256, 320, (g, w, h) => {
      g.fillStyle = '#f6eedc';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d1bfa3';
      g.lineWidth = 6;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#7c2d12';
      g.font = 'bold 22px serif';
      g.fillText('Dear Child,', 24, 44);
      g.fillStyle = '#334155';
      for (let y = 72; y < 260; y += 20) {
        g.fillRect(24, y, w - 48 - ((y * 7) % 40), 4);
      }
      g.fillStyle = '#b91c1c';
      g.font = 'bold 20px serif';
      g.fillText('— Mom ❤️', 130, 290);
    })
  );
}

export function starsTexture() {
  return cached('stars', () => {
    const r = mulberry32(42);
    return makeCanvas(1024, 512, (g, w, h) => {
      g.fillStyle = '#03050a';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 750; i++) {
        const y = r() * h * 0.85;
        g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
        const s = r() * 2.0 + 0.5;
        g.fillRect(r() * w, y, s, s);
      }
      for (let i = 0; i < 32; i++) {
        g.fillStyle = `rgba(200,225,255,${0.6 + r() * 0.4})`;
        g.beginPath();
        g.arc(r() * w, r() * h * 0.7, 1.4 + r() * 2.0, 0, Math.PI * 2);
        g.fill();
      }
    });
  });
}

export function glowTexture(inner = 'rgba(255,250,220,1)', outer = 'rgba(255,200,90,0)') {
  return cached('glow_' + inner, () =>
    makeCanvas(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grd.addColorStop(0, inner);
      grd.addColorStop(0.28, inner);
      grd.addColorStop(1, outer);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    })
  );
}

export function smokeTexture() {
  return cached('smoke', () =>
    makeCanvas(64, 64, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0.85)');
      grd.addColorStop(0.55, 'rgba(240,240,240,0.4)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    })
  );
}
