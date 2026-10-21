import * as THREE from 'three';
import { G, tier } from './state.js';
import { Rand } from './util.js';

// ── procedural textures ────────────────────────────────────────
// Everything is painted into a <canvas> at runtime: zero network,
// zero image files, and we can drop the resolution on weak phones.

const cache = new Map();

function cvs(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function tex(canvas, repeat = 1, aniso = 2) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** cheap value-noise speckle painter */
function speckle(ctx, size, base, spots, count, rnd) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const r = rnd.range(spots.minR, spots.maxR);
    ctx.globalAlpha = rnd.range(spots.a0, spots.a1);
    ctx.fillStyle = rnd.pick(spots.colors);
    ctx.beginPath();
    ctx.arc(rnd.range(0, size), rnd.range(0, size), r, 0, 6.2832);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function getTex(name) {
  const key = name + '@' + G.tier;
  if (cache.has(key)) return cache.get(key);
  const t = make(name);
  cache.set(key, t);
  return t;
}

function sizeFor(big) {
  return G.tier === 0 ? (big ? 128 : 64) : G.tier === 1 ? (big ? 256 : 128) : (big ? 384 : 192);
}

function make(name) {
  const rnd = new Rand(name.length * 7919 + 13);

  if (name === 'grass') {
    const S = sizeFor(true), c = cvs(S), x = c.getContext('2d');
    speckle(x, S, '#4a6b2c', { minR: 1, maxR: 5, a0: .05, a1: .28, colors: ['#5d8236', '#3c5a24', '#6b9340', '#2f4a1d', '#7aa14a'] }, S * 26, rnd);
    // blades
    for (let i = 0; i < S * 3; i++) {
      x.strokeStyle = rnd.pick(['#6f9a3e', '#587d2e', '#83ad50', '#41601f']);
      x.globalAlpha = rnd.range(.25, .7);
      x.lineWidth = 1;
      const px = rnd.range(0, S), py = rnd.range(0, S), h = rnd.range(2, 7);
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + rnd.range(-2, 2), py - h); x.stroke();
    }
    x.globalAlpha = 1;
    return tex(c, 26);
  }

  if (name === 'dirt') {
    const S = sizeFor(true), c = cvs(S), x = c.getContext('2d');
    speckle(x, S, '#6d5a3c', { minR: 1, maxR: 7, a0: .06, a1: .3, colors: ['#7d6a48', '#584729', '#8a7653', '#4a3b22'] }, S * 20, rnd);
    return tex(c, 14);
  }

  if (name === 'sand') {
    const S = sizeFor(true), c = cvs(S), x = c.getContext('2d');
    speckle(x, S, '#cbb183', { minR: .7, maxR: 3, a0: .05, a1: .3, colors: ['#dcc79c', '#b89c6d', '#e8d6ae', '#a88f61'] }, S * 30, rnd);
    return tex(c, 18);
  }

  if (name === 'rock') {
    const S = sizeFor(false), c = cvs(S), x = c.getContext('2d');
    speckle(x, S, '#6e6a63', { minR: 1, maxR: 6, a0: .08, a1: .35, colors: ['#827d74', '#57534c', '#948e83', '#45423c'] }, S * 16, rnd);
    return tex(c, 2);
  }

  if (name === 'wood') {
    const S = sizeFor(false), c = cvs(S), x = c.getContext('2d');
    x.fillStyle = '#8a6134'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) {
      x.globalAlpha = rnd.range(.1, .35);
      x.strokeStyle = rnd.pick(['#6d4a24', '#a3784a', '#5b3c1c', '#b08a5c']);
      x.lineWidth = rnd.range(1, 4);
      const y = rnd.range(0, S);
      x.beginPath(); x.moveTo(0, y);
      for (let px = 0; px <= S; px += S / 6) x.lineTo(px, y + rnd.range(-3, 3));
      x.stroke();
    }
    // plank seams
    x.globalAlpha = .5; x.strokeStyle = '#4b3218'; x.lineWidth = 2;
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(0, (S / 4) * i); x.lineTo(S, (S / 4) * i); x.stroke(); }
    x.globalAlpha = 1;
    return tex(c, 1);
  }

  if (name === 'concrete') {
    const S = sizeFor(false), c = cvs(S), x = c.getContext('2d');
    speckle(x, S, '#a9a49a', { minR: .8, maxR: 5, a0: .05, a1: .28, colors: ['#bdb8ad', '#8d8880', '#cec9be', '#7c776f'] }, S * 18, rnd);
    x.globalAlpha = .25; x.strokeStyle = '#6f6a62'; x.lineWidth = 1.5;
    x.strokeRect(2, 2, S - 4, S - 4);
    x.beginPath(); x.moveTo(S / 2, 0); x.lineTo(S / 2, S); x.moveTo(0, S / 2); x.lineTo(S, S / 2); x.stroke();
    x.globalAlpha = 1;
    return tex(c, 1);
  }

  if (name === 'brick') {
    const S = sizeFor(false), c = cvs(S), x = c.getContext('2d');
    x.fillStyle = '#8d8377'; x.fillRect(0, 0, S, S);
    const bh = S / 8;
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * (S / 8);
      for (let i = -1; i < 5; i++) {
        x.fillStyle = rnd.pick(['#a4543c', '#96482f', '#b1614a', '#8c4230']);
        x.globalAlpha = rnd.range(.75, 1);
        x.fillRect(i * (S / 4) + off + 1.5, r * bh + 1.5, S / 4 - 3, bh - 3);
      }
    }
    x.globalAlpha = 1;
    return tex(c, 2);
  }

  if (name === 'roof') {
    const S = sizeFor(false), c = cvs(S), x = c.getContext('2d');
    x.fillStyle = '#7a3b2c'; x.fillRect(0, 0, S, S);
    for (let r = 0; r < 10; r++) {
      for (let i = 0; i < 10; i++) {
        x.globalAlpha = rnd.range(.5, 1);
        x.fillStyle = rnd.pick(['#8f4836', '#6b3125', '#a05540']);
        x.fillRect(i * (S / 10) + 1, r * (S / 10) + 1, S / 10 - 2, S / 10 - 2);
      }
    }
    x.globalAlpha = 1;
    return tex(c, 3);
  }

  if (name === 'metal') {
    const S = sizeFor(false), c = cvs(S), x = c.getContext('2d');
    x.fillStyle = '#5b6167'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      x.globalAlpha = rnd.range(.04, .18);
      x.strokeStyle = rnd.pick(['#7d848b', '#454a4f', '#9aa1a8']);
      x.lineWidth = rnd.range(.6, 2.4);
      const y = rnd.range(0, S);
      x.beginPath(); x.moveTo(0, y); x.lineTo(S, y + rnd.range(-4, 4)); x.stroke();
    }
    x.globalAlpha = 1;
    return tex(c, 1);
  }

  if (name === 'water') {
    const S = sizeFor(true), c = cvs(S), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#1d5f7a'); g.addColorStop(.5, '#2a7d99'); g.addColorStop(1, '#17536c');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      x.globalAlpha = rnd.range(.05, .22);
      x.strokeStyle = rnd.pick(['#8fd6e8', '#bfeef7', '#4fa7c4']);
      x.lineWidth = rnd.range(1, 3);
      const y = rnd.range(0, S), w = rnd.range(10, 60);
      x.beginPath(); x.moveTo(rnd.range(0, S), y); x.quadraticCurveTo(rnd.range(0, S), y + rnd.range(-8, 8), rnd.range(0, S) + w, y); x.stroke();
    }
    x.globalAlpha = 1;
    return tex(c, 6);
  }

  if (name === 'camo') {
    const S = sizeFor(false), c = cvs(S), x = c.getContext('2d');
    x.fillStyle = '#6b7a45'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 46; i++) {
      x.globalAlpha = rnd.range(.4, .9);
      x.fillStyle = rnd.pick(['#4c5a30', '#8a9a5c', '#3b4526', '#a89468']);
      x.beginPath();
      const px = rnd.range(0, S), py = rnd.range(0, S), r = rnd.range(4, 16);
      x.ellipse(px, py, r, r * rnd.range(.4, .9), rnd.range(0, 3.14), 0, 6.2832);
      x.fill();
    }
    x.globalAlpha = 1;
    return tex(c, 2);
  }

  // fallback: flat grey
  const S = 32, c = cvs(S), x = c.getContext('2d');
  x.fillStyle = '#999'; x.fillRect(0, 0, S, S);
  return tex(c, 1);
}

/** soft round sprite used for particles / muzzle flash / smoke */
export function blobTexture(color = '#ffffff', hard = false) {
  const key = 'blob:' + color + (hard ? ':h' : '');
  if (cache.has(key)) return cache.get(key);
  const S = 64, c = cvs(S), x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  if (hard) { g.addColorStop(0, color); g.addColorStop(.72, color); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { g.addColorStop(0, color); g.addColorStop(.45, color.replace(')', ',0.55)').replace('rgb', 'rgba')); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  x.fillStyle = hard ? color : g;
  if (!hard) x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** radial gradient sky dome texture */
export function skyTexture() {
  if (cache.has('sky')) return cache.get('sky');
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2b6cb0');
  g.addColorStop(.34, '#5fa8d8');
  g.addColorStop(.62, '#a9d8ef');
  g.addColorStop(.84, '#e6d9b8');
  g.addColorStop(1, '#c9b189');
  x.fillStyle = g; x.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  cache.set('sky', t);
  return t;
}

/** one shared material library so we never create duplicates mid-match */
const mats = new Map();
export function mat(name) {
  if (mats.has(name)) return mats.get(name);
  const T = tier();
  const std = G.tier > 0;
  // tier 0 uses Lambert (cheap, no PBR): it must not receive roughness/metalness
  // or three.js logs a warning per material per frame.
  const mk = (o) => {
    if (std) return new THREE.MeshStandardMaterial(o);
    const l = Object.assign({}, o);
    delete l.roughness; delete l.metalness; delete l.emissive; delete l.emissiveIntensity;
    return new THREE.MeshLambertMaterial(l);
  };
  let m;
  switch (name) {
    case 'grass': m = mk({ map: getTex('grass'), roughness: 1, metalness: 0 }); break;
    case 'dirt': m = mk({ map: getTex('dirt'), roughness: 1, metalness: 0 }); break;
    case 'sand': m = mk({ map: getTex('sand'), roughness: 1, metalness: 0 }); break;
    case 'rock': m = mk({ map: getTex('rock'), roughness: .95, metalness: 0 }); break;
    case 'wood': m = mk({ map: getTex('wood'), roughness: .9, metalness: 0 }); break;
    case 'concrete': m = mk({ map: getTex('concrete'), roughness: .92, metalness: 0 }); break;
    case 'brick': m = mk({ map: getTex('brick'), roughness: .95, metalness: 0 }); break;
    case 'roof': m = mk({ map: getTex('roof'), roughness: .85, metalness: 0 }); break;
    case 'metal': m = mk({ map: getTex('metal'), roughness: .45, metalness: .75 }); break;
    case 'camo': m = mk({ map: getTex('camo'), roughness: .95, metalness: 0 }); break;
    case 'leaf': m = mk({ color: 0x3f6b28, roughness: 1, flatShading: true }); break;
    case 'leaf2': m = mk({ color: 0x54802f, roughness: 1, flatShading: true }); break;
    case 'trunk': m = mk({ color: 0x5b4227, roughness: 1, flatShading: true }); break;
    case 'water': m = new THREE.MeshStandardMaterial({ map: getTex('water'), roughness: .18, metalness: .35, transparent: true, opacity: .93 }); break;
    case 'skin': m = mk({ color: 0xc99b6f, roughness: .8 }); break;
    case 'shirt': m = mk({ color: 0x2f6b4f, roughness: .9 }); break;
    case 'pants': m = mk({ color: 0x3a4a5c, roughness: .95 }); break;
    case 'gun': m = mk({ color: 0x22262a, roughness: .5, metalness: .6 }); break;
    case 'zone': m = new THREE.MeshBasicMaterial({ color: 0x35b6ff, transparent: true, opacity: .17, side: THREE.BackSide, depthWrite: false }); break;
    case 'loot': m = new THREE.MeshStandardMaterial({ color: 0xffd45e, roughness: .35, metalness: .5, emissive: 0x5c3c00, emissiveIntensity: .8 }); break;
    default: m = mk({ color: 0x999999, roughness: .9 });
  }
  mats.set(name, m);
  return m;
}

export function disposeAll() {
  cache.forEach((t) => t.dispose && t.dispose());
  cache.clear();
  mats.forEach((m) => m.dispose && m.dispose());
  mats.clear();
}
