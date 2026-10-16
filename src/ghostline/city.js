import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom, RELAYS, SAFEHOUSE } from './rules.js';
import { buildCivilian } from './operative.js';

const UP = new THREE.Vector3(0, 1, 0);
const rng = seededRandom(27419);
const standard = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .78, ...options });
function texture(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; return t;
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
class Batch {
  constructor(parent) { this.parent = parent; this.groups = new Map(); }
  add(geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    if (!this.groups.has(material)) this.groups.set(material, []);
    this.groups.get(material).push(geo); return geo;
  }
  box(m, w, h, d, x, y, z, ry = 0) { return this.add(new THREE.BoxGeometry(w, h, d), m, x, y, z, 0, ry); }
  cyl(m, r, h, x, y, z, top = r) { return this.add(new THREE.CylinderGeometry(top, r, h, 8), m, x, y, z); }
  finish() {
    for (const [material, geometries] of this.groups) {
      const combined = mergeGeometries(geometries, false);
      const m = new THREE.Mesh(combined, material); m.castShadow = !material.transparent; m.receiveShadow = true;
      this.parent.add(m); geometries.forEach(g => g.dispose());
    }
    this.groups.clear();
  }
}
function glowTexture() {
  const [c, g] = canvas(128, 128), a = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  a.addColorStop(0, '#ffffffe6'); a.addColorStop(.18, '#ffffff88'); a.addColorStop(.48, '#ffffff24'); a.addColorStop(1, '#ffffff00');
  g.fillStyle = a; g.fillRect(0, 0, 128, 128); return texture(c);
}
function surfaceTexture(sidewalk = false) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = sidewalk ? '#636e6d' : '#3d4b4e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 12000; i++) { const v = rng() > .5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${rng() * .08})`; g.fillRect(rng() * 256, rng() * 256, rng() * 2 + .5, rng() * 2 + .5); }
  if (sidewalk) { g.strokeStyle = '#303d4055'; g.lineWidth = 1.5; for (let j = 0; j < 5; j++) { g.beginPath(); g.moveTo(0, j * 64); g.lineTo(256, j * 64); g.stroke(); for (let i = 0; i < 5; i++) g.strokeRect(i * 64 + (j % 2) * 32, j * 64, 64, 64); } }
  return texture(c, true);
}
function facadeMaterial(base, warm, seed) {
  const r = seededRandom(seed), [c, g] = canvas(384, 672), [e, eg] = canvas(384, 672);
  g.fillStyle = base; g.fillRect(0, 0, 384, 672); eg.fillStyle = '#000'; eg.fillRect(0, 0, 384, 672);
  for (let k = 0; k < 3500; k++) { g.fillStyle = `rgba(0,0,0,${r() * .11})`; g.fillRect(r() * 384, r() * 672, 1 + r() * 5, 1 + r() * 2); }
  for (let row = 0; row < 8; row++) {
    g.fillStyle = '#18212655'; g.fillRect(0, row * 84 + 78, 384, 3); g.fillStyle = '#c6c9ab12'; g.fillRect(0, row * 84 + 81, 384, 2);
    for (let col = 0; col < 4; col++) {
      const x = col * 96 + 15, y = row * 84 + 13, lit = r() < .31;
      g.fillStyle = '#151e25'; g.fillRect(x - 3, y - 3, 67, 60);
      const glass = g.createLinearGradient(x, y, x + 30, y + 55);
      glass.addColorStop(0, lit ? warm ? '#b4a07a' : '#87a5aa' : '#35464e'); glass.addColorStop(1, lit ? warm ? '#706548' : '#586f78' : '#1e2d33');
      g.fillStyle = glass; g.fillRect(x, y, 61, 52);
      if (lit) {
        eg.fillStyle = warm ? '#efbc72' : '#a0d0d0'; eg.fillRect(x + 1, y + 1, 59, 50);
        if (r() > .6) { eg.fillStyle = '#403729'; eg.fillRect(x + 4, y + 3, 21, 48); }
        if (r() > .5) { g.fillStyle = '#252b29'; g.fillRect(x + 11, y + 34, 7, 17); eg.fillStyle = '#262724'; eg.fillRect(x + 11, y + 34, 7, 17); }
      }
      g.fillStyle = '#152126'; g.fillRect(x + 28, y, 3, 52); g.fillRect(x, y + 26, 61, 2);
      eg.fillStyle = '#030806'; eg.fillRect(x + 28, y, 3, 52); eg.fillRect(x, y + 26, 61, 2);
      for (let j = 1; j < 6; j++) { g.fillStyle = '#06131a33'; g.fillRect(x, y + j * 8, 61, 1); eg.fillStyle = '#00000025'; eg.fillRect(x, y + j * 8, 61, 1); }
      g.fillStyle = '#94998b44'; g.fillRect(x - 4, y + 55, 70, 4); g.fillStyle = '#08111944'; g.fillRect(x - 3, y + 60, 70, 5);
    }
  }
  return standard('#ffffff', { map: texture(c, true), emissiveMap: texture(e, true), emissive: '#ffffff', emissiveIntensity: .55, metalness: .16, roughness: .63 });
}
function facadeBox(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
  for (let face = 0; face < 6; face++) for (let i = 0; i < 4; i++) {
    const n = face * 4 + i;
    uv.setXY(n, uv.getX(n) * (face < 2 ? d : w) / 11.5, uv.getY(n) * (face === 2 || face === 3 ? d : h) / 24);
  }
  return geo;
}
function signTexture(title, subtitle, color = '#d9e8c5', background = '#152b2e', width = 768, height = 192) {
  const [c, g] = canvas(width, height); g.fillStyle = background; g.fillRect(0, 0, width, height);
  g.strokeStyle = color + '55'; g.lineWidth = 2; g.strokeRect(9, 9, width - 18, height - 18);
  g.textAlign = 'center'; g.fillStyle = color; g.font = `600 ${subtitle ? height * .37 : height * .44}px Space, sans-serif`;
  g.fillText(title, width / 2, subtitle ? height * .51 : height * .65, width - 45);
  if (subtitle) { g.font = `400 ${height * .12}px Plex, monospace`; g.fillStyle = color + 'aa'; g.fillText(subtitle, width / 2, height * .76, width - 45); }
  return texture(c);
}
function sign(parent, title, sub, w, h, x, y, z, rotation = 0, color, bg) {
  const map = signTexture(title, sub, color, bg);
  const material = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: .45, roughness: .5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material); mesh.position.set(x, y, z); mesh.rotation.y = rotation; parent.add(mesh); return mesh;
}
function addGlow(parent, map, color, size, x, y, z, opacity = .35, floor = false) {
  const material = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const mesh = floor ? new THREE.Mesh(new THREE.PlaneGeometry(size, size * 1.6), material) : new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  if (floor) mesh.rotation.x = -Math.PI / 2; else mesh.scale.set(size, size, 1);
  mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function makeCar(color) {
  const root = new THREE.Group(), b = new Batch(root);
  const paint = standard(color, { roughness: .35, metalness: .5 }), glass = standard('#172b33', { metalness: .72, roughness: .15 }), tire = standard('#111c22'), steel = standard('#627477', { metalness: .7, roughness: .3 });
  const light = standard('#f4e5bd', { emissive: '#ffddb1', emissiveIntensity: 1.8 }), red = standard('#c75541', { emissive: '#e83d27', emissiveIntensity: 1.5 });
  b.box(paint, 1.91, .57, 4.25, 0, .61, 0); b.box(paint, 1.86, .12, 4.17, 0, .92, 0);
  b.box(glass, 1.61, .55, 2.1, 0, 1.21, .16); b.box(paint, 1.64, .095, 2.04, 0, 1.52, .19);
  for (const s of [-1, 1]) { b.box(paint, .06, .58, .08, s * .81, 1.2, .15); b.box(paint, .1, .56, .10, s * .8, 1.2, 1.15); b.box(paint, .13, .12, .26, s * 1.02, 1.0, -.6); b.box(light, .58, .16, .04, s * .56, .78, -2.135); b.box(red, .51, .15, .04, s * .62, .79, 2.135); }
  b.box(steel, 1.3, .14, .03, 0, .53, -2.14); b.box(tire, 1.23, .10, .035, 0, .72, -2.14);
  for (const x of [-.93, .93]) for (const z of [-1.36, 1.35]) { b.add(new THREE.CylinderGeometry(.36, .36, .24, 14), tire, x, .38, z, 0, 0, Math.PI / 2); b.add(new THREE.CylinderGeometry(.19, .19, .247, 10), steel, x, .38, z, 0, 0, Math.PI / 2); }
  b.finish(); return root;
}
function makeDrone() {
  const root = new THREE.Group(), b = new Batch(root), dark = standard('#354749', { metalness: .6 }), trim = standard('#a8b5ac'), red = standard('#da7360', { emissive: '#ff4e39', emissiveIntensity: 2 });
  b.box(dark, .8, .22, .55, 0, 0, 0); b.box(trim, .55, .04, .45, 0, .14, 0); b.box(red, .26, .045, .025, 0, -.025, -.29);
  const rotors = [];
  for (const s of [-1, 1]) for (const z of [-.42, .42]) {
    b.box(dark, .7, .06, .075, s * .47, .045, z * .8, s * z);
    b.cyl(dark, .065, .15, s * .75, .1, z);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(.8, .015, .075), dark); rotor.position.set(s * .75, .19, z); root.add(rotor); rotors.push(rotor);
  }
  b.cyl(dark, .095, .18, 0, -.18, -.08);
  b.finish();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 6, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#abcfac', transparent: true, opacity: .022, depthWrite: false, side: THREE.DoubleSide }));
  cone.position.y = -3.2; root.add(cone);
  return { root, rotors, cone, light: red };
}

export function buildCity(scene) {
  const group = new THREE.Group(); scene.add(group);
  const b = new Batch(group), colliders = [], buildings = [], glows = [], windowMaterials = [];
  const concrete = standard('#707b76'), curb = standard('#9caaa0'), roof = standard('#4a5a5b'), steel = standard('#3b5156', { metalness: .5, roughness: .55 }), dark = standard('#172c33'), wood = standard('#665e48'), markings = standard('#c9c7a6', { roughness: .7 });
  const amber = standard('#f8d49f', { emissive: '#ffd6a0', emissiveIntensity: 2 }), green = standard('#c2dfae', { emissive: '#b6e6a1', emissiveIntensity: 1.2 }), glass = standard('#213e47', { metalness: .65, roughness: .24 });
  const glow = glowTexture(), asphalt = surfaceTexture(), sidewalk = surfaceTexture(true);
  asphalt.repeat.set(72, 72); sidewalk.repeat.set(6, 6);
  const roadMaterial = standard('#9cacb0', { map: asphalt, roughness: .48, metalness: .24 });
  b.box(roadMaterial, 330, .15, 330, 0, -.09, 0);
  const pavement = standard('#e0e7d9', { map: sidewalk, roughness: .79 });
  const wallMaterials = ['#647375', '#7e7e74', '#45585f', '#727c78', '#64665f', '#506369'].map((c, i) => facadeMaterial(c, i !== 2, 450 + i * 17));
  windowMaterials.push(...wallMaterials);
  // Four-by-four blocks, 64 m road spacing, walkable pavements and alleyways.
  for (let ix = -2; ix < 2; ix++) for (let iz = -2; iz < 2; iz++) {
    const cx = ix * 64 + 32, cz = iz * 64 + 32;
    b.box(pavement, 44.8, .22, 44.8, cx, .04, cz);
    for (const s of [-1, 1]) { b.box(curb, .17, .25, 44.8, cx + s * 22.4, .045, cz); b.box(curb, 44.8, .25, .17, cx, .045, cz + s * 22.4); }
    for (const ox of [-10.8, 10.8]) for (const oz of [-10.8, 10.8]) {
      const x = cx + ox, z = cz + oz, w = 16 + rng() * 3.5, d = 16.5 + rng() * 3.5;
      let h = 14 + rng() * 23;
      if (z < -40) h += rng() * 15;
      if (x > 12 && x < 30 && z > 12 && z < 30) h = 26;
      if (x < -12 && x > -30 && z > 12 && z < 30) h = 21;
      const material = wallMaterials[Math.floor(rng() * wallMaterials.length)];
      b.add(facadeBox(w, h, d), material, x, h / 2 + 3.4, z);
      b.box(dark, w, 3.4, d, x, 1.7, z);
      b.box(roof, w + .35, .35, d + .35, x, h + 3.55, z);
      b.box(concrete, w + .3, .22, d + .3, x, 3.5, z);
      b.box(roof, w * .48, 1.15, d * .36, x + 1, h + 4.2, z + 1);
      b.box(steel, 1.7, 1, 2.4, x - 3, h + 4.05, z + 2);
      b.cyl(steel, .11, 3.4, x + 3, h + 5.15, z - 3);
      b.box(steel, 1.8, .04, .04, x + 3, h + 6.3, z - 3);
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      buildings.push({ x, z, w, d, h });
      // Street-facing storefronts, metal mullions and overhangs.
      const side = ox < 0 ? -1 : 1, fx = x + side * (w / 2 + .025);
      b.box(glass, .07, 2.65, d - .7, fx, 1.7, z);
      b.box(steel, .12, .1, d, fx, 2.98, z);
      b.box(steel, .12, .1, d, fx, .43, z);
      for (let j = -d / 2 + .35; j <= d / 2; j += 2.4) b.box(concrete, .22, 3.15, .16, fx, 1.72, z + j);
      const canopy = rng() > .5 ? steel : wood;
      b.box(canopy, .7, .16, d - .25, fx + side * .2, 3.18, z);
      if (Math.abs(x) < 45 && Math.abs(z) < 88 && rng() > .25) {
        const names = [['NIGHT OWL', 'COFFEE / LATE HOURS'], ['SOUTH BANK', 'NEWS & EVERYDAY GOODS'], ['KIOSK 24', 'OPEN ALL NIGHT'], ['OFFLINE', 'RECORDS / CULTURE'], ['COMMON GROUND', 'LOCAL / INDEPENDENT'], ['METRO', 'PHARMACY +']];
        const n = names[Math.floor(rng() * names.length)];
        sign(group, n[0], n[1], Math.min(7.4, d - 2), 1.05, fx + side * .03, 4.1, z, side * Math.PI / 2, rng() > .5 ? '#dbcba4' : '#b9d6cb');
      }
      for (const s of [-1, 1]) b.box(concrete, .32, h, .42, x + s * (w / 2 - .05), h / 2 + 3.5, z + d / 2 + .07);
    }
  }
  // A distant business district breaks up the skyline.
  for (let i = 0; i < 32; i++) {
    const x = (rng() - .5) * 360, z = -145 - rng() * 75, h = 32 + rng() * 66, w = 9 + rng() * 18, d = 11 + rng() * 12;
    b.add(facadeBox(w, h, d), wallMaterials[i % wallMaterials.length], x, h / 2, z);
    b.box(roof, w, .6, d, x, h + .25, z);
    if (i % 5 === 0) { b.cyl(steel, .14, 12, x, h + 6, z); b.cyl(amber, .20, .35, x, h + 12, z); }
  }
  // Lane markings and pedestrian crossings.
  for (const road of [-128, -64, 0, 64, 128]) {
    for (let p = -145; p < 150; p += 7) {
      if (Math.abs(p - Math.round(p / 64) * 64) < 13) continue;
      b.box(markings, .11, .012, 3.5, road, .012, p); b.box(markings, 3.5, .012, .11, p, .014, road);
    }
    for (const inter of [-64, 0, 64]) for (const s of [-1, 1]) for (let q = -7; q <= 7; q += 1.35) {
      b.box(markings, .66, .014, 2.7, road + q, .018, inter + s * 11.6);
      b.box(markings, 2.7, .014, .66, inter + s * 11.6, .018, road + q);
    }
    for (const segment of [-96, -32, 32, 96]) for (const s of [-1, 1]) {
      b.box(markings, .06, .012, 35, road + s * 8.45, .013, segment);
      b.box(markings, 35, .012, .06, segment, .013, road + s * 8.45);
    }
  }
  // Light-pools and reflections use soft procedural decals, not expensive mirrors.
  const lightMaterials = [amber, green];
  const lampPosts = [];
  for (const street of [-64, 0, 64]) for (const z of [-108, -80, -47, -18, 18, 46, 81, 110]) for (const s of [-1, 1]) {
    const x = street + s * 10.2;
    b.cyl(steel, .083, 6.45, x, 3.2, z, .055); b.cyl(dark, .18, .35, x, .18, z);
    b.box(steel, 2.1, .10, .13, x - s * .95, 6.39, z);
    b.box(steel, .65, .13, 1.25, x - s * 1.9, 6.36, z);
    b.box(amber, .49, .034, 1.02, x - s * 1.9, 6.28, z);
    lampPosts.push({ x, z });
    if (Math.abs(street) < 70 && Math.abs(z) < 90) {
      glows.push(addGlow(group, glow, '#ffe0a8', 3.3, x - s * 1.9, 6.26, z, .19));
      glows.push(addGlow(group, glow, '#e9b479', 6, x - s * 2.2, .033, z, .12, true));
    }
  }
  const leaves = [standard('#48563d'), standard('#627052'), standard('#798365'), standard('#536b58')];
  for (const x of [-11.2, 11.2, -53, 53, -75, 75]) for (const z of [-94, -47, -18, 28, 47, 91]) {
    b.box(concrete, 1.65, .44, 2.05, x, .31, z); b.box(wood, 1.45, .1, 1.84, x, .55, z);
    b.cyl(wood, .16, 3.4, x, 2, z, .09);
    for (let j = 0; j < 6; j++) { const a = j * 2.399; b.add(new THREE.IcosahedronGeometry(1.15 + rng() * .6, 1), leaves[j % leaves.length], x + Math.cos(a) * .65, 3.7 + rng() * 1.5, z + Math.sin(a) * .8); }
    colliders.push({ minX: x - .8, maxX: x + .8, minZ: z - 1, maxZ: z + 1 });
  }
  // Bollards, benches, bins, street furniture.
  for (const x of [-9.85, 9.85]) for (let z = -110; z < 116; z += 7) {
    if (Math.abs(z - Math.round(z / 64) * 64) < 15) continue;
    b.cyl(steel, .07, .75, x, .53, z); b.cyl(curb, .077, .07, x, .82, z); b.cyl(dark, .12, .10, x, .21, z);
  }
  for (const x of [-11.5, 11.5]) for (const z of [-79, -38, 38, 76]) {
    for (let i = 0; i < 4; i++) b.box(wood, .12, .07, 1.85, x - .20 + i * .14, .67, z);
    for (const s of [-1, 1]) { b.box(steel, .45, .50, .07, x, .39, z + s * .67); b.box(wood, .07, .14, 1.85, x + Math.sign(x) * .28, .96 + s * .11, z); }
    b.cyl(steel, .29, .8, x, .56, z + 1.8); b.cyl(dark, .31, .08, x, .99, z + 1.8);
  }
  // Junction signals.
  const redLight = standard('#aa6254', { emissive: '#df6956', emissiveIntensity: 1.2 });
  lightMaterials.push(redLight);
  for (const z of [-64, 0, 64]) for (const s of [-1, 1]) {
    const x = s * 8.8, zz = z - s * 8.8;
    b.cyl(steel, .067, 4.4, x, 2.2, zz); b.box(dark, .36, .99, .30, x, 4.28, zz);
    for (let k = 0; k < 3; k++) b.add(new THREE.SphereGeometry(.1, 8, 6), k === (s > 0 ? 0 : 2) ? s > 0 ? redLight : green : steel, x, 4.58 - k * .29, zz + .15);
  }
  // The district's focal billboard, street name plates, and a familiar red phone box.
  b.box(steel, 8.5, 4.8, .25, 22, 17, -10.6);
  sign(group, 'NEXUS', 'A SAFER TOMORROW. A CONNECTED CITY.', 8.2, 4.5, 22, 17, -10.43, 0, '#c5e5cd', '#1d4147');
  b.box(steel, .12, 3.8, .12, 19, 13, -10.8); b.box(steel, .12, 3.8, .12, 25, 13, -10.8);
  sign(group, 'SOUTH BANK', 'SE1 · LONDON', 3.7, .85, -13.7, 4.1, 10.65, 0, '#e7eadb', '#223132');
  sign(group, 'OFF THE GRID', 'INDEPENDENT SINCE 2026', 5.5, 1.5, -20.2, 7, 10.65, 0, '#ccd696', '#1c342d');
  const phoneRed = standard('#80504a');
  b.box(phoneRed, 1.12, 2.4, 1.12, -10.9, 1.4, 16);
  b.box(glass, 1.13, 1.65, .85, -10.9, 1.55, 16);
  for (const s of [-1, 1]) b.box(phoneRed, .11, 2.5, 1.15, -10.9 + s * .51, 1.45, 16);
  b.box(phoneRed, 1.23, .22, 1.22, -10.9, 2.75, 16);
  b.box(amber, .95, .17, 1.125, -10.9, 2.55, 16);
  // Overhead utilities add a fine silhouette against the fog.
  const cableMaterial = new THREE.LineBasicMaterial({ color: '#253c43' });
  for (const z of [-22, -76]) {
    const points = [new THREE.Vector3(-13, 11.2, z), new THREE.Vector3(0, 9.6, z), new THREE.Vector3(13, 11.2, z)];
    const curve = new THREE.CatmullRomCurve3(points); group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), cableMaterial));
  }
  b.finish();
  // Sparse real lights supplement the emissive geometry and decals.
  const points = [[7.5, 5.5, 18], [-7.5, 5.5, -18], [7.5, 5.5, -47]].map(p => {
    const l = new THREE.PointLight('#ffcf94', 35, 18, 2); l.position.set(...p); group.add(l); return l;
  });

  const relayNodes = RELAYS.map((relay, i) => {
    const root = new THREE.Group(); root.position.set(relay.x, .08, relay.z); group.add(root);
    const body = new Batch(root), led = standard('#b8e979', { emissive: '#b6ec77', emissiveIntensity: 1.4 });
    body.box(steel, .79, 1.6, .56, 0, .8, 0); body.box(dark, .88, .08, .64, 0, 1.62, 0); body.box(dark, .68, .61, .03, 0, 1.11, .299);
    body.box(led, .5, .30, .032, 0, 1.17, .32); body.box(steel, .49, .014, .01, 0, 1.18, .34);
    for (let j = 0; j < 4; j++) body.box(dark, .47, .023, .023, 0, .42 + j * .09, .289);
    body.box(led, .033, .13, .03, .235, .78, .318); body.box(dark, .87, .08, .66, 0, .06, 0); body.finish();
    sign(root, `NXS / 00${i + 1}`, '', .56, .12, 0, 1.48, .324, 0, '#c2d9c0');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, .016, 4, 48), new THREE.MeshBasicMaterial({ color: '#bbeb7a', transparent: true, opacity: .40, depthWrite: false })); ring.rotation.x = Math.PI / 2; ring.position.y = .07; root.add(ring);
    const glowMesh = addGlow(root, glow, '#c9e873', 2.1, 0, .01, .6, .17, true);
    colliders.push({ minX: relay.x - .45, maxX: relay.x + .45, minZ: relay.z - .32, maxZ: relay.z + .32 });
    return { ...relay, root, led, ring, glow: glowMesh, type: 'relay', anchor: new THREE.Vector3(relay.x, 2.5, relay.z) };
  });
  const cameras = [[-10.2, 5.7, 18], [10.2, 5.7, -18], [-53.8, 5.7, -47], [53.8, 5.7, -80]].map((p, i) => {
    const root = new THREE.Group(); root.position.set(...p); group.add(root); root.rotation.y = p[0] < 0 ? -.7 : .7;
    const batch = new Batch(root), led = standard('#bad6c8', { emissive: '#bbdfc6', emissiveIntensity: 1 });
    batch.box(curb, .32, .26, .64, 0, 0, 0); batch.box(dark, .24, .20, .025, 0, 0, .333); batch.box(led, .09, .09, .027, 0, 0, .348); batch.box(steel, .1, .35, .09, 0, -.23, -.17); batch.finish();
    return { id: `cam-${24 + i}`, name: `Camera ${24 + i}`, code: `CAM_${24 + i}`, type: 'camera', x: p[0], z: p[2], anchor: new THREE.Vector3(p[0], p[1] + .5, p[2]), root, led, disabled: 0 };
  });

  const cars = [];
  for (let i = 0; i < 8; i++) {
    const root = makeCar(['#40565f', '#948776', '#314445', '#716956', '#6b7775', '#6c4744', '#b4b7a8', '#28394b'][i]);
    const lane = i % 2 ? -4.45 : 4.45, street = i < 4 ? 0 : i < 6 ? -64 : 64, direction = i % 2 ? 1 : -1;
    root.position.set(street + lane, 0, -117 + i * 31); root.rotation.y = direction > 0 ? Math.PI : 0; group.add(root);
    cars.push({ root, direction, speed: 5.4 + rng() * 3.5 });
  }
  const pedestrians = [];
  for (let i = 0; i < 10; i++) {
    const person = buildCivilian(['#586e65', '#63767e', '#8a7361', '#3f555c', '#807f6c'][i % 5]);
    const x = i % 2 ? -11.2 : 11.2, z = -107 + i * 22, direction = i % 3 === 0 ? -1 : 1;
    person.root.position.set(x, .17, z); person.root.rotation.y = direction > 0 ? Math.PI : 0; group.add(person.root);
    pedestrians.push({ ...person, origin: z, direction, speed: .48 + rng() * .32 });
  }
  const drones = Array.from({ length: 3 }, (_, i) => { const d = makeDrone(); group.add(d.root); return { ...d, id: i, x: 0, z: 0 }; });
  const extraction = new THREE.Group(); extraction.position.set(SAFEHOUSE.x, .07, SAFEHOUSE.z); scene.add(extraction); extraction.visible = false;
  const exitMat = new THREE.MeshBasicMaterial({ color: '#b8e694', transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.9, 3.02, 64), exitMat); ring.rotation.x = -Math.PI / 2; extraction.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 2.95, 10, 48, 1, true), new THREE.MeshBasicMaterial({ color: '#b2ec93', transparent: true, opacity: .025, side: THREE.DoubleSide, depthWrite: false })); beam.position.y = 5; extraction.add(beam);

  const scanGrid = new THREE.GridHelper(290, 145, '#a3d692', '#75988c'); scanGrid.position.y = .18; scanGrid.material.transparent = true; scanGrid.material.opacity = .16; scanGrid.material.depthWrite = false; scanGrid.visible = false; scene.add(scanGrid);
  const networkLines = new THREE.Group(); networkLines.visible = false; scene.add(networkLines);
  const linkPoints = relayNodes.map(r => new THREE.Vector3(r.x, 1.7, r.z));
  const network = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linkPoints), new THREE.LineDashedMaterial({ color: '#b8e68e', transparent: true, opacity: .7, dashSize: .55, gapSize: .4, depthTest: false })); network.computeLineDistances(); networkLines.add(network);

  const rainCount = 430, rainArray = new Float32Array(rainCount * 6);
  for (let i = 0; i < rainCount; i++) { const n = i * 6, x = (rng() - .5) * 65, y = rng() * 28, z = (rng() - .5) * 65; rainArray.set([x, y, z, x - .1, y - .75, z], n); }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainArray, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#bed8ce', transparent: true, opacity: .14, depthWrite: false })); rain.frustumCulled = false; scene.add(rain);
  let blackoutLevel = 0;
  function update(dt, time, player, blackout = false, paused = false) {
    blackoutLevel = THREE.MathUtils.damp(blackoutLevel, blackout ? 1 : 0, 4, dt);
    for (const m of windowMaterials) m.emissiveIntensity = .55 * (1 - blackoutLevel * .99);
    amber.emissiveIntensity = 2 * (1 - blackoutLevel * .97); green.emissiveIntensity = 1.2 * (1 - blackoutLevel * .9);
    for (const p of points) p.intensity = 35 * (1 - blackoutLevel);
    for (const g of glows) g.visible = blackoutLevel < .8;
    if (!paused) {
      for (const c of cars) {
        const ahead = (player.z - c.root.position.z) * c.direction;
        const blocked = Math.abs(c.root.position.x - player.x) < 1.7 && ahead > 0 && ahead < 5;
        c.root.position.z += c.direction * (blocked ? 0 : c.speed) * dt;
        if (Math.abs(c.root.position.z) > 143) c.root.position.z = -Math.sign(c.root.position.z) * 142;
      }
      for (const p of pedestrians) { p.root.position.z += p.direction * p.speed * dt; if (Math.abs(p.root.position.z - p.origin) > 9) { p.direction *= -1; p.root.rotation.y += Math.PI; } p.animate(time * p.speed + p.origin); }
      for (const d of drones) {
        if (d.id === 0) { d.x = Math.sin(time * .14) * 5; d.z = -27 + Math.sin(time * .10) * 24; }
        if (d.id === 1) { d.x = 31 + Math.sin(time * .12 + 2) * 23; d.z = -64 + Math.cos(time * .12) * 4; }
        if (d.id === 2) { d.x = -64 + Math.sin(time * .16) * 4; d.z = -18 + Math.sin(time * .08 + 3) * 41; }
        d.root.position.set(d.x, 6.6 + Math.sin(time * 1.6 + d.id) * .15, d.z); d.root.rotation.y = time * .3 + d.id; d.root.rotation.z = Math.sin(time * .8) * .07;
        for (const r of d.rotors) r.rotation.y = time * 90;
        d.cone.visible = !blackout; d.light.emissiveIntensity = blackout ? .05 : 2;
      }
      for (let i = 0; i < rainCount; i++) {
        const n = i * 6; rainArray[n + 1] -= dt * 17; rainArray[n] -= dt * 1.6;
        if (rainArray[n + 1] < -.5) { rainArray[n + 1] = 28; rainArray[n] = (rng() - .5) * 65; }
        rainArray[n + 3] = rainArray[n] - .1; rainArray[n + 4] = rainArray[n + 1] - .75;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    rain.position.set(player.x, 0, player.z);
    for (const r of relayNodes) { r.ring.material.opacity = .3 + Math.sin(time * 2 + r.x) * .10; r.ring.rotation.z = time * .2; }
    exitMat.opacity = .45 + Math.sin(time * 2) * .15;
  }
  function setScan(on) { scanGrid.visible = on; networkLines.visible = on; }
  function setBreached(ids) { for (const node of relayNodes) { const done = ids.has(node.id); node.led.color.set(done ? '#81d4bf' : '#b8e979'); node.led.emissive.set(done ? '#71cbb6' : '#b6ec77'); node.ring.material.color.set(done ? '#6cc6b0' : '#bbeb7a'); } }
  return { group, colliders, buildings, relayNodes, cameras, cars, drones, pedestrians, extraction, rain, update, setScan, setBreached, groundHeight(x, z) { const nx = Math.abs(x - Math.round(x / 64) * 64), nz = Math.abs(z - Math.round(z / 64) * 64); return nx > 9.6 && nz > 9.6 ? .155 : 0; } };
}

export function createAtmosphere(scene) {
  scene.background = new THREE.Color('#354a52'); scene.fog = new THREE.FogExp2('#3c535a', .0072);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vPosition;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 p=normalize(vPosition);float h=max(p.y,0.);vec3 col=mix(vec3(.35,.46,.46),vec3(.065,.13,.19),pow(h,.48));float n=noise(p.xz*8.+p.y*5.)*.5+noise(p.xz*19.)*.22;col+=vec3(.075,.075,.06)*n*(1.-h);gl_FragColor=vec4(col,1.);}`,
  })); scene.add(sky);
  const hemi = new THREE.HemisphereLight('#b8d7dd', '#4c5950', 2.05); scene.add(hemi);
  const key = new THREE.DirectionalLight('#c9dce0', 2.4); key.position.set(-35, 70, 25); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -65; key.shadow.camera.right = 65; key.shadow.camera.top = 65; key.shadow.camera.bottom = -65; key.shadow.camera.near = 1; key.shadow.camera.far = 180; key.shadow.bias = -.0005; key.shadow.normalBias = .13; scene.add(key); scene.add(key.target);
  const rim = new THREE.DirectionalLight('#e7c08a', 1.25); rim.position.set(60, 25, -80); scene.add(rim);
  return { sky, hemi, key, rim };
}
