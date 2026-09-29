// ═════════════════════════════════════════════════════════════════════════════
// Characters — cute stylised humans with animated faces, built from primitives.
// Original designs: pillow-limbs, big heads, geometric eyes, no texture files.
// ═════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { COSM, defaultAvatar } from '../../shared/content.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ── shared geometry / material caches ─────────────────────────────────────────
const GEO = {};
function box(w, h, d, r = 0) {
  const k = 'b' + [w, h, d, r].join();
  if (!GEO[k]) GEO[k] = r > 0.001 ? pillow(w, h, d, r) : new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  return GEO[k];
}
// "pillow": a sphere blended toward a box — the house style for soft solids
function pillow(w, h, d, round = 0.42) {
  const g = new THREE.SphereGeometry(0.5, 20, 16);
  const p = g.attributes.position;
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.set(p.getX(i), p.getY(i), p.getZ(i));
    const l = n.length() || 1e-5;
    n.divideScalar(l);
    const mx = Math.abs(n.x), my = Math.abs(n.y), mz = Math.abs(n.z);
    const boxR = 0.5 / Math.max(1e-4, mx, my, mz);
    const k = boxR * (1 - round) + 0.5 * round;
    p.setXYZ(i, n.x * k * w, n.y * k * h, n.z * k * d);
  }
  g.computeVertexNormals();
  return g;
}
function cyl(rt, rb, h, seg = 16) {
  const k = 'c' + [rt, rb, h, seg].join();
  if (!GEO[k]) GEO[k] = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  return GEO[k];
}
function sph(r, w = 16, h = 12) {
  const k = 's' + [r, w, h].join();
  if (!GEO[k]) GEO[k] = new THREE.SphereGeometry(r, w, h);
  return GEO[k];
}
function tor(r, t, arc = Math.PI * 2) {
  const k = 't' + [r, t, arc].join();
  if (!GEO[k]) GEO[k] = new THREE.TorusGeometry(r, t, 8, 20, arc);
  return GEO[k];
}
function cone(r, h, seg = 14) {
  const k = 'k' + [r, h, seg].join();
  if (!GEO[k]) GEO[k] = new THREE.ConeGeometry(r, h, seg);
  return GEO[k];
}
const MAT = {};
function mat(color, o = {}) {
  const key = o.key || 'm' + color + JSON.stringify([o.rough ?? 1, o.metal ?? 0, o.emis ?? 0, o.op ?? 1, o.flat ? 1 : 0]);
  if (!MAT[key]) {
    MAT[key] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: o.rough ?? 0.62,
      metalness: o.metal ?? 0.03,
      emissive: new THREE.Color(o.emisColor || color),
      emissiveIntensity: o.emis ?? 0,
      transparent: (o.op ?? 1) < 1,
      opacity: o.op ?? 1,
      flatShading: !!o.flat,
      side: o.side || THREE.FrontSide,
    });
    if (o.key) MAT[o.key] = MAT[key];
  }
  return MAT[key];
}
export function toonGradient() {
  if (GEO._grad) return GEO._grad;
  const c = new Uint8Array([90, 160, 220, 255]);
  const t = new THREE.DataTexture(c, c.length, 1, THREE.RedFormat);
  t.needsUpdate = true; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  GEO._grad = t;
  return t;
}
const M = {
  eyeW: () => mat('#fdfdfb', { rough: 0.22, key: 'eyeW' }),
  iris: () => mat('#171a24', { rough: 0.3, key: 'iris' }),
  shine: () => mat('#ffffff', { emis: 1.1, rough: 0.2, key: 'shine' }),
  mouth: () => mat('#3a1622', { rough: 0.8, key: 'mouth' }),
  tongue: () => mat('#e0677e', { rough: 0.7, key: 'tongue' }),
  blush: () => mat('#ff8a9c', { rough: 0.9, op: 0.55, key: 'blush' }),
  teeth: () => mat('#fffdf2', { rough: 0.35, key: 'teeth' }),
  dark: () => mat('#232838', { rough: 0.5, key: 'dark' }),
  metal: () => mat('#cfd6e2', { rough: 0.24, metal: 0.85, key: 'metal' }),
};

function mesh(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = false;
  return o;
}

// ── cosmetics: hair / hats / glasses / clothes, all primitive-built ───────────
function addHair(head, style, color) {
  const g = new THREE.Group(); g.name = 'hair';
  const m = mat(color, { rough: 0.72 });
  const R = 0.30;
  const cap = (thick = 0.06, y = 0.05, s = 1.03) => {
    const c = new THREE.Mesh(new THREE.SphereGeometry(R + thick, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), m);
    c.scale.set(s, s * (0.9 + thick), s); c.position.y = y; c.castShadow = true;
    return c;
  };
  const puff = (x, y, z, r) => { const p = mesh(sph(r, 12, 10), m, x, y, z); return p; };
  switch (style) {
    case -1: break;                                   // bald
    case 0: g.add(cap(0.05, 0.02, 1.02)); break;      // slick
    case 1: g.add(cap(0.1, 0.03)); for (let i = 0; i < 5; i++) { const a = -0.9 + i * 0.45; g.add(puff(Math.sin(a) * 0.24, 0.16, Math.cos(a) * 0.24, 0.12)); } break; // bubble
    case 2: for (let i = 0; i < 7; i++) { const a = -1.3 + i * 0.44; const s = mesh(cone(0.07, 0.2, 7), m, Math.sin(a) * 0.2, 0.24, Math.cos(a) * 0.2); s.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3); g.add(s); } break; // spikes
    case 3: for (let i = 0; i < 9; i++) { const a = i * 0.7, r = 0.2 + (i % 3) * 0.04; g.add(puff(Math.sin(a) * r, 0.14 + (i % 2) * 0.06, Math.cos(a) * r, 0.11)); } break; // curl cloud
    case 4: { g.add(cap(0.06, 0.02)); const tail = mesh(sph(0.1, 12, 10), m, 0, 0.1, -0.32); tail.scale.set(1, 1.5, 1); g.add(tail); const band = mesh(tor(0.08, 0.02), M.dark(), 0, 0.06, -0.26); g.add(band); } break; // ponytail
    case 5: g.add(cap(0.11, 0.0, 1.06)); g.children[0].geometry = new THREE.SphereGeometry(R + 0.11, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.72); break; // bob
    case 6: { for (let i = 0; i < 4; i++) g.add(puff(Math.sin(i * 1.6) * 0.22, 0.26 + (i % 2) * 0.04, Math.cos(i * 1.6) * 0.22, 0.07)); g.add(cap(0.03, 0.0)); } break; // tall fade
    case 7: g.add(cap(0.13, 0.02, 1.08)); for (let i = 0; i < 5; i++) g.add(puff(Math.sin(i * 2.3) * 0.26, 0.1 + (i % 2) * 0.08, Math.cos(i * 2.3) * 0.26, 0.13)); break; // messy mop
    case 8: g.add(puff(-0.19, 0.24, 0, 0.13)); g.add(puff(0.19, 0.24, 0, 0.13)); g.add(cap(0.05, 0.02)); break; // space buns
    case 9: g.add(cap(0.07, 0.02)); { const back = mesh(box(0.34, 0.3, 0.09, 0.4), m, 0, -0.06, -0.28); g.add(back); const fr = mesh(box(0.3, 0.07, 0.07, 0.4), m, 0, 0.14, 0.26); g.add(fr); } break; // mullet
    default: g.add(cap(0.07, 0.02));
  }
  head.add(g);
}

function addHat(head, id, color) {
  const g = new THREE.Group(); g.name = 'hat';
  const m = mat(color, { rough: 0.55 });
  const y = 0.24;
  switch (id) {
    case -1: break;
    case 0: { const c = mesh(cyl(0.19, 0.2, 0.15, 18), m, 0, y + 0.05); const b = mesh(cyl(0.3, 0.3, 0.028, 20), m, 0, y - 0.02); g.add(c, b); } break;   // bowler
    case 1: { const c = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), m); c.position.y = y; c.scale.y = 0.8; const br = mesh(box(0.3, 0.02, 0.16, 0.4), m, 0, y - 0.01, 0.2); g.add(c, br); } break; // flat cap
    case 2: { const c = mesh(cyl(0.22, 0.2, 0.14, 16), m, 0, y + 0.03); const b = mesh(cyl(0.3, 0.29, 0.03, 18), m, 0, y - 0.04); g.add(c, b); } break;      // bucket
    case 3: { const c = mesh(cyl(0.17, 0.18, 0.3, 18), m, 0, y + 0.15); const b = mesh(cyl(0.31, 0.31, 0.03, 20), m, 0, y - 0.01); const band = mesh(cyl(0.185, 0.185, 0.05, 18), mat('#d64a5a', { rough: .5 }), 0, y + 0.04); g.add(c, b, band); } break; // top hat
    case 4: { const c = mesh(sph(0.16, 14, 10), m, 0, y + 0.11); c.scale.set(1.15, 0.95, 1.15); const b = mesh(cyl(0.23, 0.22, 0.06, 16), m, 0, y - 0.01); g.add(c, b); } break; // toque
    case 5: { const b = mesh(box(0.36, 0.03, 0.24, 0.35), m, 0, y + 0.02, 0.06); const band = mesh(tor(0.2, 0.025, Math.PI), m, 0, y, -0.02); band.rotation.x = 1.2; g.add(b, band); } break; // visor
    case 6: { const p = mesh(box(0.3, 0.34, 0.24, 0.12), mat('#c9b58e', { rough: 0.9 }), 0, y + 0.14); const eyeHole = mesh(sph(0.03, 8, 6), M.dark(), 0.07, y + 0.14, 0.13); g.add(p, eyeHole); } break; // paper bag
    case 7: { const ring = mesh(cyl(0.2, 0.2, 0.03, 16), mat('#d9b64a', { rough: .3, metal: .7 }), 0, y); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const s = mesh(box(0.05, 0.16, 0.02, 0.2), mat('#d9b64a', { rough: .3, metal: .7 }), Math.sin(a) * 0.18, y + 0.1, Math.cos(a) * 0.18); s.rotation.z = Math.sin(a) * 0.2; g.add(s); } g.add(ring); } break; // spoon crown
    case 8: { const h = mesh(tor(0.26, 0.028, Math.PI * 2), mat('#fff4c2', { emis: 1.6, emisColor: '#ffe27a', rough: .4 }), 0, y + 0.34); h.rotation.x = Math.PI / 2; g.add(h); } break; // rented halo
    default: break;
  }
  if (g.children.length) head.add(g);
}

function addGlasses(head, id, color) {
  const g = new THREE.Group(); g.name = 'glass';
  const frame = mat(color, { rough: 0.35, metal: 0.4 });
  const lens = mat('#9fdcff', { rough: 0.06, metal: 0.5, op: 0.42 });
  const z = 0.27, y = 0.02;
  switch (id) {
    case -1: break;
    case 0: { for (const s of [-1, 1]) { g.add(mesh(tor(0.085, 0.014, Math.PI * 2), frame, s * 0.1, y, z)); g.add(mesh(cyl(0.078, 0.078, 0.01, 14), lens, s * 0.1, y, z + 0.002).rotateX(Math.PI / 2)); } g.add(mesh(box(0.05, 0.012, 0.012, 0), frame, 0, y + 0.02, z)); } break;
    case 1: { for (const s of [-1, 1]) g.add(mesh(box(0.17, 0.09, 0.015, 0.25), frame, s * 0.1, y, z)); g.add(mesh(box(0.05, 0.012, 0.012, 0), frame, 0, y, z)); } break;
    case 2: { for (const s of [-1, 1]) g.add(mesh(box(0.16, 0.08, 0.02, 0.3), M.dark(), s * 0.1, y, z)); g.add(mesh(box(0.04, 0.01, 0.01, 0), M.dark(), 0, y, z)); } break;
    case 3: { g.add(mesh(tor(0.09, 0.012), frame, 0.1, y, z)); const ch = mesh(cyl(0.006, 0.006, 0.16, 6), M.metal(), 0.1, y - 0.13, z - 0.02); ch.rotation.z = 0.2; g.add(ch); } break;
    case 4: { const b = mesh(box(0.34, 0.12, 0.06, 0.45), mat('#6c4a8f', { rough: 0.8 }), 0, y + 0.02, z - 0.02); g.add(b); const st = mesh(box(0.1, 0.02, 0.02, 0), mat('#8b63b5'), 0, y + 0.05, z - 0.2); g.add(st); } break;
    case 5: { for (const s of [-1, 1]) { g.add(mesh(cyl(0.075, 0.075, 0.06, 14), frame, s * 0.1, y, z - 0.01).rotateX(Math.PI / 2)); g.add(mesh(cyl(0.06, 0.06, 0.01, 14), mat('#49f0c0', { emis: .9, emisColor: '#20e0a0', op: .5 }), s * 0.1, y, z + 0.03).rotateX(Math.PI / 2)); } } break;
    default: break;
  }
  if (g.children.length) head.add(g);
}

function addAccessory(root, head, id, color) {
  const g = new THREE.Group(); g.name = 'acc';
  switch (id) {
    case -1: break;
    case 0: { const d = new THREE.Group(); const body = mesh(sph(0.075, 12, 10), mat('#ffd94d', { rough: .7 }), 0, 0, 0); const beak = mesh(cone(0.028, 0.06, 8), mat('#ff9f2e', { rough: .6 }), 0.06, -0.005, 0); beak.rotation.z = -1.5; const eye = mesh(sph(0.012, 8, 6), M.dark(), 0.03, 0.03, 0.045); d.add(body, beak, eye); d.position.set(-0.26, 0.72, 0.02); g.add(d); root.userData.duck = d; } break;
    case 1: { const chain = mesh(tor(0.14, 0.018, Math.PI * 2), mat('#ffd23f', { rough: .25, metal: .8 }), 0, 0.63, 0.02); chain.rotation.x = 1.35; g.add(chain); const p = mesh(sph(0.045, 10, 8), mat('#ffd23f', { rough: .25, metal: .8 }), 0, 0.53, 0.13); g.add(p); } break;
    case 2: { const w = mesh(cyl(0.055, 0.055, 0.02, 14), mat('#d9b64a', { rough: .3, metal: .7 }), 0.16, 0.5, 0.12); w.rotation.x = Math.PI / 2; const str = mesh(tor(0.03, 0.006), M.metal(), 0.16, 0.56, 0.1); g.add(w, str); } break;
    case 3: { const c = mesh(box(0.24, 0.18, 0.08, 0.2), mat('#7b4a2a', { rough: .55 }), 0.28, 0.42, 0.02); c.rotation.z = -0.1; const cl = mesh(box(0.1, 0.02, 0.02, 0), M.metal(), 0.28, 0.52, 0.06); g.add(c, cl); root.userData.case = c; } break;
    case 4: { const b = mesh(sph(0.06, 10, 8), mat('#3fb96b', { rough: .7 }), -0.2, 0.98, 0.0); const w = mesh(box(0.1, 0.05, 0.03, 0.4), mat('#e05545', { rough: .7 }), -0.21, 1.0, 0.06); const beak = mesh(cone(0.02, 0.05, 7), mat('#ffb63f'), -0.16, 0.99, 0.05); beak.rotation.z = -1.5; g.add(b, w, beak); root.userData.parrot = b; } break;
    case 5: { const c = new THREE.Mesh(new THREE.LatheGeometry([V(0.1, 0, 0), V(0.11, 0.05, 0), V(0.07, 0.06, 0), V(0.09, 0.12, 0), V(0.05, 0.13, 0), V(0.06, 0.02, 0)], 16), mat('#ffd23f', { rough: .22, metal: .8, emis: .1 })); c.position.set(0, 0.46, 0); g.add(c); } break;
    case 6: { for (const s of [-1, 1]) { const cuff = mesh(cyl(0.075, 0.075, 0.05, 14), M.metal(), s * 0.3, 0.44, 0); g.add(cuff); } } break;
    default: break;
  }
  void head; void color;
  if (g.children.length) root.add(g);
}

function addClothes(torso, legs, av, base) {
  const shirtC = COSM.color[av.color % COSM.color.length].c;
  const pantC = COSM.color[(av.color + 5) % COSM.color.length].c;
  const shoeC = COSM.color[(av.color + 9) % COSM.color.length].c;
  const shirt = mat(shirtC, { rough: 0.78 });
  const pants = mat(pantC, { rough: 0.7 });
  const shoes = mat(shoeC, { rough: 0.45, metal: 0.06 });
  torso.userData.shirt = shirt; torso.userData.pants = pants; torso.userData.shoes = shoes;
  torso.userData.shirtC = shirtC; torso.userData.pantC = pantC;

  // torso garment
  const gm = mesh(box(0.44, 0.44, 0.33, 0.5), shirt, 0, 0.21, 0);
  gm.name = 'garment';
  torso.add(gm);
  if (av.shirt >= 2) torso.add(mesh(box(0.42, 0.16, 0.3, 0.5), shirt, 0, 0.42, -0.06));
  if (av.shirt === 3 || av.shirt === 5) {
    torso.add(mesh(box(0.2, 0.3, 0.03, 0.2), mat('#20283a', { rough: .5 }), 0, 0.28, 0.17));
    const tie = mesh(box(0.06, 0.24, 0.02, 0.3), mat('#c0392b', { rough: .5 }), 0, 0.24, 0.19); torso.add(tie); torso.userData.tie = tie;
  }
  if (av.shirt === 6) {
    for (let i = 0; i < 5; i++) torso.add(mesh(box(0.06, 0.06, 0.02, 0.4), mat('#2b6ca3', { rough: .7 }), (i % 2 ? 0.13 : -0.12), 0.16 + i * 0.07, 0.18));
  }
  if (av.shirt === 8) {
    for (let i = 0; i < 4; i++) torso.add(mesh(sph(0.035, 8, 6), mat('#4f9d69', { rough: .8 }), (i - 1.5) * 0.09, 0.16 + (i % 2) * 0.12, 0.18));
  }
  // legs garment
  for (const [i, leg] of legs.entries()) {
    const pg = leg.children.find((c) => c.name === 'pantLeg');
    if (pg) pg.material = pants;
    const sg = leg.children.find((c) => c.name === 'shoe');
    if (sg) sg.material = shoes;
    if (av.pants === 1) { leg.scale.set(1.18, 1, 1.18); }
    if (av.pants === 3) { leg.children[0].scale.y = 0.6; }
    if (av.pants === 5) { sg && sg.scale.set(1.2, 0.9, 1.5); }
    if (av.shoes === 5) { sg && sg.scale.set(1.25, 1.5, 1.2); }
    if (av.shoes === 4) { sg && sg.children.push(mesh(cone(0.04, 0.07, 6), shoes, 0.06, 0.02, 0)); }
    if (av.shoes === 3) { const boot = mesh(cyl(0.09, 0.1, 0.2, 10), mat('#3b6b4d', { rough: .6 }), 0, 0.16, 0); boot.name = 'wellie' + i; leg.add(boot); }
    void base;
  }
}

// ── face: mesh-driven, so expressions animate instead of swapping textures ────
const EXPR = {
  neutral: { eye: 1, browY: 0, browA: 0, mouthW: 0.62, mouthC: 0.35, mouthO: 0.06, tilt: 0, squint: 0, blush: 0.15 },
  smug: { eye: 0.72, browY: 0.03, browA: -0.24, mouthW: 0.8, mouthC: 0.85, mouthO: 0.05, tilt: 0.1, squint: 0.35, blush: 0.3 },
  sly: { eye: 0.6, browY: 0.01, browA: -0.4, mouthW: 0.72, mouthC: 0.6, mouthO: 0.02, tilt: -0.08, squint: 0.55, blush: 0.1 },
  worry: { eye: 1.15, browY: -0.02, browA: 0.5, mouthW: 0.5, mouthC: -0.5, mouthO: 0.16, tilt: 0.05, squint: 0, blush: 0.5 },
  shock: { eye: 1.45, browY: 0.06, browA: 0.35, mouthW: 0.4, mouthC: 0.1, mouthO: 0.85, tilt: -0.05, squint: 0, blush: 0.3 },
  laugh: { eye: 0.35, browY: 0.02, browA: -0.1, mouthW: 1.0, mouthC: 1.0, mouthO: 0.7, tilt: 0.12, squint: 0.8, blush: 0.7 },
  sad: { eye: 0.85, browY: -0.04, browA: 0.7, mouthW: 0.45, mouthC: -0.85, mouthO: 0.1, tilt: 0.14, squint: 0.1, blush: 0.6 },
  angry: { eye: 0.75, browY: -0.03, browA: -0.75, mouthW: 0.55, mouthC: -0.55, mouthO: 0.1, tilt: -0.1, squint: 0.3, blush: 0.25 },
  cry: { eye: 1.2, browY: -0.02, browA: 0.9, mouthW: 0.5, mouthC: -1.0, mouthO: 0.5, tilt: 0.2, squint: 0, blush: 0.9 },
  cheer: { eye: 1.1, browY: 0.05, browA: -0.15, mouthW: 1.0, mouthC: 0.95, mouthO: 0.85, tilt: -0.06, squint: 0.35, blush: 0.6 },
  scheme: { eye: 0.55, browY: 0.0, browA: -0.55, mouthW: 0.68, mouthC: 0.5, mouthO: 0.04, tilt: -0.14, squint: 0.6, blush: 0.1 },
  deadpan: { eye: 0.5, browY: -0.01, browA: 0, mouthW: 0.5, mouthC: 0, mouthO: 0.02, tilt: 0, squint: 0.4, blush: 0 },
};
export const EXPRESSIONS = Object.keys(EXPR);

function buildFace(head, faceId, skinLike) {
  const f = new THREE.Group(); f.name = 'face';
  const wide = [0.115, 0.105, 0.13, 0.12, 0.11, 0.105, 0.14, 0.12, 0.13, 0.11][faceId % 10];
  const eyeY = [0.02, 0.0, 0.03, 0.01, -0.01, 0.02, 0.0, 0.04, 0.01, 0.02][faceId % 10];
  const eyeR = [0.062, 0.055, 0.07, 0.075, 0.05, 0.058, 0.08, 0.07, 0.066, 0.06][faceId % 10];
  const browTh = [0.02, 0.016, 0.024, 0.018, 0.03, 0.026, 0.016, 0.02, 0.022, 0.03][faceId % 10];
  const parts = { eyes: [], irises: [], brows: [], lids: [] };
  for (const s of [-1, 1]) {
    const eg = mesh(sph(eyeR, 14, 12), M.eyeW(), s * wide, eyeY, 0.235);
    eg.scale.set(1, 1, 0.6);
    const iris = mesh(sph(eyeR * 0.52, 12, 10), M.iris(), s * wide, eyeY, 0.235 + eyeR * 0.5);
    iris.scale.set(1, 1.05, 0.5);
    const shine = mesh(sph(eyeR * 0.19, 8, 6), M.shine(), s * wide + eyeR * 0.22, eyeY + eyeR * 0.3, 0.235 + eyeR * 0.62);
    const lid = mesh(box(eyeR * 2.5, eyeR * 0.62, eyeR * 0.75, 0.4), skinLike, s * wide, eyeY + eyeR * 0.6, 0.245);
    lid.visible = false;
    const brow = mesh(box(eyeR * 1.9, browTh, browTh * 1.4, 0.3), mat('#2a1f18', { rough: .8 }), s * wide, eyeY + eyeR * 1.15, 0.25);
    brow.name = 'brow' + s;
    f.add(eg, iris, shine, lid, brow);
    parts.eyes.push(eg); parts.irises.push(iris); parts.brows.push(brow); parts.lids.push(lid);
    parts.irisBase = eyeR * 0.52;
    parts.shines = parts.shines || []; parts.shines.push(shine);
  }
  // mouth: a curved slab whose width/curve/openness animate
  const mg = new THREE.Group(); mg.position.set(0, eyeY - 0.115, 0.252);
  const mouth = mesh(tor(0.055, 0.017, Math.PI), M.mouth(), 0, 0, 0);
  mouth.rotation.z = Math.PI; mouth.name = 'mouthCurve';
  const open = mesh(box(0.1, 0.03, 0.02, 0.4), M.mouth(), 0, -0.012, 0.004); open.name = 'mouthOpen';
  const teeth = mesh(box(0.075, 0.014, 0.016, 0.2), M.teeth(), 0, 0.008, 0.008); teeth.name = 'teeth';
  const tongue = mesh(box(0.05, 0.014, 0.016, 0.4), M.tongue(), 0, -0.014, 0.008); tongue.name = 'tongue';
  mg.add(mouth, open, teeth, tongue); f.add(mg);
  parts.mouthGroup = mg; parts.mouth = mouth; parts.open = open; parts.teeth = teeth; parts.tongue = tongue;
  // cheeks + nose
  for (const s of [-1, 1]) { const b = mesh(sph(0.036, 10, 8), M.blush(), s * (wide + 0.075), eyeY - 0.075, 0.225); b.scale.z = 0.35; f.add(b); (parts.cheeks = parts.cheeks || []).push(b); }
  const nose = mesh(sph(0.022, 8, 6), mat('#000000', { rough: .9, op: 0.12 }), 0, eyeY - 0.05, 0.262); nose.scale.set(1, 0.8, 0.7);
  f.add(nose);
  if (faceId === 6) { // gremlin: tiny fangs
    for (const s of [-1, 1]) f.add(mesh(cone(0.011, 0.026, 6), M.teeth(), s * 0.03, eyeY - 0.1, 0.262).rotateX(Math.PI));
  }
  if (faceId === 8) for (const ir of parts.irises) ir.material = mat('#ffe06a', { emis: 1.2, emisColor: '#ffcf3f', rough: .3 });
  head.add(f);
  return parts;
}

// ── rig ───────────────────────────────────────────────────────────────────────
export class Character {
  constructor(av = {}, opts = {}) {
    this.av = { ...defaultAvatar(), ...(av || {}) };
    this.opts = opts;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.t = Math.random() * 10;
    this.expr = { ...EXPR.neutral };
    this.target = { ...EXPR.neutral };
    this.blink = 0; this.nextBlink = 1 + Math.random() * 3;
    this.speed = 0; this.walkPhase = 0;
    this.emoteAnim = null; this.emoteT = 0;
    this.sitOn = null;
    this.build();
  }

  build() {
    const av = this.av;
    const skin = COSM.skin[av.skin % COSM.skin.length].c;
    const skinM = mat(skin, { rough: 0.68, key: 'skin' + this.root.id + av.skin });
    this.skinM = skinM;
    const legL = 0.24;
    // legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.1, legL, 0);
      const thigh = mesh(box(0.15, legL, 0.16, 0.35), skinM, 0, -legL / 2, 0);
      thigh.name = 'pantLeg';
      const shoe = mesh(box(0.17, 0.1, 0.26, 0.45), mat('#333a4d', { rough: .5, key: 'shoe' + this.root.id + av.shoes }), 0.0, -legL - 0.02, 0.045);
      shoe.name = 'shoe';
      leg.add(thigh, shoe);
      this.body.add(leg); this.legs.push(leg);
    }
    // torso
    const torso = new THREE.Group(); torso.position.y = legL + 0.02;
    this.torso = torso;
    const chest = mesh(box(0.4, 0.4, 0.3, 0.55), skinM, 0, 0.2, 0);
    chest.name = 'base';
    torso.add(chest);
    this.body.add(torso);
    // arms
    this.arms = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.24, 0.36, 0);
      const up = mesh(box(0.12, 0.3, 0.13, 0.45), skinM, 0, -0.14, 0);
      const hand = mesh(sph(0.075, 12, 10), skinM, 0, -0.31, 0.01);
      arm.add(up, hand);
      arm.userData.hand = hand;
      torso.add(arm);
      this.arms.push(arm);
    }
    // head
    const head = new THREE.Group(); head.position.y = 0.62;
    this.head = head;
    const skull = mesh(sph(0.3, 22, 18), skinM, 0, 0, 0);
    skull.scale.set(1.02, 0.98, 0.96);
    head.add(skull);
    for (const s of [-1, 1]) head.add(mesh(sph(0.05, 8, 6), skinM, s * 0.29, -0.02, -0.02));
    this.face = buildFace(head, av.face | 0, skinM);
    this.body.add(head);
    addHair(head, av.hair | 0, COSM.color[(av.hairColor | 0) % COSM.color.length].c);
    addHat(head, av.hat | 0, COSM.color[(av.color + 3) % COSM.color.length].c);
    addGlasses(head, av.glasses | 0, COSM.color[(av.color + 7) % COSM.color.length].c);
    addClothes(torso, this.legs, av, skinM);
    addAccessory(this.body, head, av.acc | 0, COSM.color[(av.color + 2) % COSM.color.length].c);
    // sweat drop + tear props (used by emotes / tells)
    this.sweat = mesh(sph(0.032, 10, 8), mat('#9fe0ff', { rough: .05, metal: .2, emis: .35, emisColor: '#69c8ff' }), 0.24, 0.66, 0.2);
    this.sweat.visible = false; this.sweat.scale.z = 0.6; head.add(this.sweat);
    this.tearL = mesh(sph(0.026, 8, 6), mat('#bfe9ff', { rough: .05, emis: .3 }), -0.1, 0.56, 0.28);
    this.tearR = this.tearL.clone(); head.add(this.tearL, this.tearR);
    this.tearL.visible = this.tearR.visible = false;
    // shadow blob (cheap, always-on grounding)
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.34, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.012;
    this.root.add(this.blob);
    this.root.userData.character = this;
  }

  setEmphasis(v) { this.emphasis = v; }

  setExpr(name) {
    const e = EXPR[name] || EXPR.neutral;
    this.target = { ...e };
  }
  faceTo(pid, look) { this.lookAt = look || null; }

  playEmote(anim, dur = 1800) {
    this.emoteAnim = anim; this.emoteDur = dur; this.emoteT = 0;
  }

  update(dt, t) {
    this.t += dt;
    const k = Math.min(1, dt * 11);
    // expression easing
    for (const key of Object.keys(this.target)) this.expr[key] = (this.expr[key] ?? 0) + ((this.target[key] ?? 0) - (this.expr[key] ?? 0)) * k;
    const e = this.expr;
    // blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 1; this.nextBlink = 1.6 + Math.random() * 4.2; }
    this.blink = Math.max(0, this.blink - dt * 8);
    const openY = Math.max(0.05, e.eye * (1 - this.blink * 0.92));
    for (let i = 0; i < 2; i++) {
      const eye = this.face.eyes[i];
      eye.scale.y = openY;
      const br = this.face.brows[i];
      br.position.y = (e.browY || 0) + 0.001;
      br.rotation.z = (i ? -1 : 1) * (e.browA || 0) * 0.5;
      this.face.irises[i].scale.y = 0.5 + openY * 0.55;
    }
    const mg = this.face.mouthGroup;
    mg.scale.set(0.55 + e.mouthW * 0.75, 0.55 + Math.abs(e.mouthO) * 1.5 + (e.mouthC > 0 ? 0.12 : 0), 1);
    this.face.mouth.visible = e.mouthO < 0.42;
    this.face.mouth.rotation.z = Math.PI + (e.mouthC || 0) * 0.001;
    this.face.mouth.position.y = (e.mouthC || 0) * 0.012;
    this.face.open.scale.set(1, Math.max(0.05, e.mouthO), 1);
    this.face.open.visible = e.mouthO > 0.05;
    this.face.teeth.visible = e.mouthO > 0.25;
    this.face.tongue.visible = e.mouthO > 0.5;
    if (this.face.cheeks) for (const c of this.face.cheeks) { c.material.opacity = 0.12 + (e.blush || 0) * 0.5; c.visible = (e.blush || 0) > 0.05; }
    // head aim
    const look = this.lookTarget;
    const tilt = (e.tilt || 0) + (look ? 0 : Math.sin(this.t * 0.7) * 0.02);
    this.head.rotation.z += (tilt - this.head.rotation.z) * Math.min(1, dt * 6);
    if (look) {
      const d = look.clone().sub(this.head.getWorldPosition(new THREE.Vector3()));
      const yaw = Math.atan2(d.x, d.z) - (this.root.rotation.y);
      this.head.rotation.y += (clampA(yaw, 0.6) - this.head.rotation.y) * Math.min(1, dt * 5);
      this.head.rotation.x += (clampA(-Math.atan2(d.y, Math.hypot(d.x, d.z)), 0.35) - this.head.rotation.x) * Math.min(1, dt * 5);
    } else {
      this.head.rotation.y += (Math.sin(this.t * 0.45) * 0.16 - this.head.rotation.y) * Math.min(1, dt * 3);
      this.head.rotation.x += (0 - this.head.rotation.x) * Math.min(1, dt * 3);
    }

    // body motion
    const spd = this.speed;
    this.walkPhase += dt * (4 + spd * 3.4);
    const bob = Math.sin(this.walkPhase) * Math.min(1, spd) * 0.055 + Math.sin(this.t * 1.6) * 0.008;
    this.body.position.y = (this.sitOn ? -0.02 : 0) + bob;
    this.torso.rotation.z = Math.sin(this.walkPhase) * Math.min(1, spd) * 0.05;
    this.torso.scale.setScalar(1 + Math.sin(this.t * 1.9) * 0.008);
    const legSwing = Math.sin(this.walkPhase) * Math.min(1, spd) * 0.7;
    for (let i = 0; i < 2; i++) {
      const sgn = i ? 1 : -1;
      const leg = this.legs[i];
      const arm = this.arms[i];
      if (this.sitOn) {
        leg.rotation.x += (-1.45 - leg.rotation.x) * Math.min(1, dt * 8);
        leg.position.y = 0.2;
      } else {
        leg.rotation.x += (sgn * legSwing - leg.rotation.x) * Math.min(1, dt * 12);
        leg.position.y += (0.24 - leg.position.y) * Math.min(1, dt * 12);
      }
      const armGoal = i ? -legSwing * 0.8 : legSwing * 0.8;
      arm.rotation.x += (armGoal * 0.6 - arm.rotation.x) * Math.min(1, dt * 10);
      arm.rotation.z += ((i ? -0.1 : 0.1) - arm.rotation.z) * Math.min(1, dt * 10);
    }
    // props
    if (this.root.userData.duck) this.root.userData.duck.rotation.y = Math.sin(this.t * 2.2) * 0.3;
    if (this.root.userData.parrot) this.root.userData.parrot.scale.setScalar(1 + Math.sin(this.t * 5) * 0.05);
    this.blob.scale.setScalar(1 - Math.min(0.22, bob * 1.6));
    this.sweat.visible = e.sweat > 0.02 || this.emoteAnim === 'sweat';
    if (this.sweat.visible) {
      this.sweat.position.y = 0.7 - (Math.sin(this.t * 3) * 0.5 + 0.5) * 0.1;
      this.sweat.material.opacity = 0.9;
    }
    const crying = this.target === EXPR.cry || this.emoteAnim === 'cry';
    this.tearL.visible = this.tearR.visible = crying;
    if (crying) {
      const y = 0.56 - ((this.t * 0.6) % 1) * 0.28;
      this.tearL.position.y = y; this.tearR.position.y = y;
    }
    // emote animation overlays
    if (this.emoteAnim) {
      this.emoteT += dt * 1000;
      const p = Math.min(1, this.emoteT / (this.emoteDur || 1800));
      const w = Math.sin(p * Math.PI);
      const a = this.emoteAnim;
      if (a === 'point') { this.arms[0].rotation.x = -1.5 * w; this.arms[0].rotation.z = 0.2; this.head.rotation.y = -0.2 * w; }
      if (a === 'guns') { this.arms[0].rotation.x = -1.2 * w; this.arms[1].rotation.x = -1.2 * w; this.arms[0].rotation.z = 0.4 * w; this.arms[1].rotation.z = -0.4 * w; }
      if (a === 'clap') { const c = Math.abs(Math.sin(p * Math.PI * 6)); this.arms[0].rotation.x = -1.1; this.arms[1].rotation.x = -1.1; this.arms[0].rotation.z = 0.9 - c * 0.7; this.arms[1].rotation.z = -0.9 + c * 0.7; }
      if (a === 'shake') { this.body.position.x = Math.sin(p * 40) * 0.05 * w; this.root.rotation.y += Math.sin(p * 30) * 0.01; }
      if (a === 'count') { this.arms[1].rotation.x = -1.35; for (let i = 0; i < 2; i++) this.arms[i].rotation.z = (i ? -1 : 1) * (0.3 + Math.sin(p * Math.PI * 4) * 0.25); }
      if (a === 'gasp') { this.body.rotation.x = -0.25 * w; this.arms[0].rotation.z = 0.9 * w; this.arms[1].rotation.z = -0.9 * w; this.body.position.y += 0.05 * w; }
      if (a === 'shrug') { this.arms[0].rotation.z = 0.9 * w; this.arms[1].rotation.z = -0.9 * w; this.arms[0].rotation.x = -0.4 * w; this.arms[1].rotation.x = -0.4 * w; }
      if (a === 'bow') { this.body.rotation.x = 0.55 * w; this.head.rotation.x = -0.3 * w; }
      if (a === 'wiggle') { this.body.rotation.z = Math.sin(p * Math.PI * 5) * 0.22; this.arms[0].rotation.x = -2.2; this.arms[1].rotation.x = -2.2; this.body.position.y += Math.abs(Math.sin(p * Math.PI * 5)) * 0.06; }
      if (a === 'hand') { this.arms[1].rotation.x = -1.45; this.arms[1].rotation.z = -0.35; }
      if (a === 'sweat') { this.head.rotation.z = Math.sin(p * 26) * 0.08; }
      if (a === 'cry') { this.body.rotation.x = 0.12 * w; this.arms[0].rotation.x = -1.6 * w; this.arms[1].rotation.x = -1.6 * w; }
      if (p >= 1) { this.emoteAnim = null; this.body.rotation.x = 0; }
    }
  }
  flash(v = 1) { this.emoteAnim = v > 0 ? 'gasp' : 'cry'; this.emoteDur = 900; this.emoteT = 0; }
}
const clampA = (v, m) => Math.max(-m, Math.min(m, v));

// ── nameplates: canvas sprite above head (name, chips, state pips) ───────────
export class Nameplate {
  constructor(char, { wide = 260 } = {}) {
    this.char = char;
    this.c = document.createElement('canvas');
    this.c.width = wide * 2; this.c.height = 128;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.spr = new THREE.Sprite(this.mat);
    this.spr.scale.set(1.3, 0.64, 1);
    this.spr.renderOrder = 20;
    this.data = {};
    this.dirty = true;
    this.wide = wide;
  }
  set(d) {
    const j = JSON.stringify(d);
    if (j === this._j) return;
    this._j = j; this.data = d; this.dirty = true;
  }
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const d = this.data, c = this.c, g = c.getContext('2d');
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const pad = 8, r = 26;
    // plate
    g.beginPath();
    if (g.roundRect) g.roundRect(pad, H - 62, W - pad * 2, 48, r); else g.rect(pad, H - 62, W - pad * 2, 48);
    g.fillStyle = d.mine ? 'rgba(255,210,63,.94)' : 'rgba(10,16,26,.78)';
    g.fill();
    g.lineWidth = 5; g.strokeStyle = d.you ? 'rgba(255,255,255,.9)' : (d.host ? 'rgba(255,210,63,.6)' : 'rgba(120,160,190,.35)');
    g.stroke();
    g.font = '700 26px Outfit, Fredoka, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = d.mine ? '#20160a' : '#eaf4ff';
    const nm = (d.name || '').slice(0, 12);
    g.fillText(nm, pad + 16, H - 38);
    g.textAlign = 'right';
    g.font = '700 24px Outfit, Fredoka, system-ui, sans-serif';
    g.fillStyle = d.mine ? '#5b3b00' : (d.deltaColor || 'rgba(200,230,255,.85)');
    g.fillText(d.right || '', W - pad - 16, H - 38);
    g.textAlign = 'left';
    // bubble / tag line
    if (d.tag) {
      g.font = '800 22px Outfit, system-ui, sans-serif';
      const tw = g.measureText(d.tag).width + 22;
      g.beginPath();
      if (g.roundRect) g.roundRect(W / 2 - tw / 2, 4, tw, 36, 18); else g.rect(W / 2 - tw / 2, 4, tw, 36);
      g.fillStyle = d.tagBg || 'rgba(255,61,127,.95)';
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(d.tag, W / 2 - tw / 2 + 11, 24);
    }
    if (d.bubble) {
      g.font = '700 22px Outfit, system-ui, sans-serif';
      const tw = Math.min(W - 24, g.measureText(d.bubble).width + 26);
      const bh = 44, by = 44;
      g.beginPath();
      if (g.roundRect) g.roundRect(W / 2 - tw / 2, by, tw, bh, 16); else g.rect(W / 2 - tw / 2, by, tw, bh);
      g.fillStyle = 'rgba(255,255,255,.94)'; g.fill();
      g.fillStyle = '#16202e';
      g.fillText((d.bubble || '').slice(0, 30), W / 2 - tw / 2 + 13, by + bh / 2);
    }
    this.tex.needsUpdate = true;
  }
}

export { EXPR, mat, mesh, box, sph, cyl, tor, cone };
