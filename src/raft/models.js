import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE_SIZE } from './rules.js';
import { timberTexture } from './textures.js';

const materialCache = new Map();
export function material(color, options = {}) {
  const key = color + JSON.stringify(Object.fromEntries(Object.entries(options).map(([name, value]) => [name, value?.isTexture ? value.uuid : value])));
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...options }));
  return materialCache.get(key);
}
const geometries = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  ico: new THREE.IcosahedronGeometry(1, 0),
};
export function mesh(geometry, mat, parent, position = [0, 0, 0], scale = [1, 1, 1]) {
  const result = new THREE.Mesh(geometry, mat);
  result.position.set(...position); result.scale.set(...scale);
  result.castShadow = true; result.receiveShadow = true;
  if (parent) parent.add(result);
  return result;
}
export const box = (parent, mat, position, scale) => mesh(geometries.box, mat, parent, position, scale);
export const sphere = (parent, mat, position, scale) => mesh(geometries.sphere, mat, parent, position, scale);
export const rock = (parent, mat, position, scale) => mesh(geometries.ico, mat, parent, position, scale);
export function cylinder(parent, mat, position, top, bottom, height, segments = 10) {
  return mesh(new THREE.CylinderGeometry(top, bottom, height, segments), mat, parent, position);
}
export function beam(parent, from, to, radius, mat, endRadius = radius) {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to), delta = end.clone().sub(start);
  const result = cylinder(parent, mat, start.clone().add(end).multiplyScalar(0.5).toArray(), endRadius, radius, delta.length(), 8);
  result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return result;
}
export function rope(parent, points, radius = 0.025, color = '#bda374') {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 6), radius, 5, false), material(color), parent);
}
export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Collapse static procedural details to a handful of draw calls per model.
export function optimizeStatic(root) {
  root.updateMatrixWorld(true);
  const batches = new Map();
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse(node => {
    if (!node.isMesh) return;
    let geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const key = node.material.uuid;
    if (!batches.has(key)) batches.set(key, { material: node.material, geometries: [] });
    batches.get(key).geometries.push(geometry);
  });
  const result = new THREE.Group();
  for (const batch of batches.values()) {
    const merged = mergeGeometries(batch.geometries, false);
    if (merged) mesh(merged, batch.material, result);
    batch.geometries.forEach(geometry => geometry.dispose());
  }
  return result;
}

const wood = ['#c29057', '#cfa06a', '#bb8750', '#d2a26a', '#c79a60', '#d6ac76'].map(c => material(c, { map: timberTexture(), bumpMap: timberTexture(), bumpScale: .024 }));
const darkWood = material('#765332', { map: timberTexture(), bumpMap: timberTexture(), bumpScale: .024 });
const ropeMat = material('#d2bc89');
const iron = material('#586d66', { metalness: 0.25 });
const canvas = material('#f0e5c6', { side: THREE.DoubleSide });
const teal = material('#4c8b81');

export function foundation(seed = 0) {
  const group = new THREE.Group(), rng = seeded(seed + 87), S = TILE_SIZE;
  box(group, darkWood, [0, 0.31, -S / 2 + 0.14], [S, 0.23, 0.2]);
  box(group, darkWood, [0, 0.31, S / 2 - 0.14], [S, 0.23, 0.2]);
  for (let p = 0; p < 5; p++) {
    const z = (p - 2) * (S / 5);
    box(group, wood[Math.floor(rng() * wood.length)], [0, 0.54 + rng() * 0.015, z], [S - 0.027, 0.22, S / 5 - 0.025]);
    for (const side of [-1, 1]) {
      cylinder(group, iron, [side * (S / 2 - 0.18), 0.655, z + 0.08], 0.022, 0.022, 0.005, 5);
      cylinder(group, iron, [side * (S / 2 - 0.18), 0.655, z - 0.08], 0.018, 0.018, 0.005, 5);
    }
    // Subtle split grain is actual geometry, not a downloaded texture.
    for (let i = 0; i < 2; i++) box(group, material('#a87748'), [(rng() - 0.5) * 1.3, 0.656, z + (rng() - 0.5) * 0.24], [0.1 + rng() * 0.46, 0.001, 0.008]);
  }
  const buoy = cylinder(group, material('#73968c'), [0, 0.17, 0], 0.25, 0.25, 1.5, 10);
  buoy.rotation.z = Math.PI / 2;
  return optimizeStatic(group);
}

export function raftDetails() {
  const group = new THREE.Group(), S = TILE_SIZE * 1.5;
  for (const x of [-S + 0.12, S - 0.12]) for (const z of [-S + 0.12, S - 0.12]) {
    cylinder(group, wood[0], [x, 0.77, z], 0.075, 0.095, 0.62, 8);
    for (let i = 0; i < 3; i++) {
      const ring = mesh(new THREE.TorusGeometry(0.09, 0.017, 4, 10), ropeMat, group, [x, 0.8 + i * 0.04, z]);
      ring.rotation.x = Math.PI / 2;
    }
  }
  // Front float logs, tied with rope.
  for (const z of [-S + 0.13, S - 0.13]) {
    const log = cylinder(group, material('#855d37'), [0, 0.19, z], 0.22, 0.19, S * 2 + 0.12, 10);
    log.rotation.z = Math.PI / 2;
    for (const x of [-2.5, 0, 2.5]) {
      const ring = mesh(new THREE.TorusGeometry(0.225, 0.035, 5, 12), ropeMat, group, [x, 0.19, z]);
      ring.rotation.y = Math.PI / 2;
    }
  }
  // A real orange lifebuoy, with cream wrapping and a draped line.
  const life = new THREE.Group();
  mesh(new THREE.TorusGeometry(0.42, 0.105, 8, 28), material('#d8874b'), life);
  for (let i = 0; i < 4; i++) {
    const wrap = mesh(new THREE.TorusGeometry(0.425, 0.11, 8, 5, 0.38), canvas, life);
    wrap.rotation.z = i * Math.PI / 2 - 0.2;
  }
  life.position.set(1.35, 0.43, S + 0.05); life.rotation.x = -0.18; group.add(life);
  rope(group, [[0.7, 0.68, S], [0.7, 0.12, S + 0.3], [1.2, 0.03, S + 0.4], [1.85, 0.7, S]], 0.022);
  // Rolled sleeping mat and its leather straps.
  const mat = cylinder(group, material('#9baca0'), [-1.8, 0.94, 1.75], 0.28, 0.28, 1.3, 12);
  mat.rotation.z = Math.PI / 2;
  const inner = cylinder(group, material('#627f77'), [-1.13, 0.94, 1.75], 0.15, 0.15, 0.008, 12); inner.rotation.z = Math.PI / 2;
  for (const x of [-2.2, -1.42]) {
    const strap = mesh(new THREE.TorusGeometry(0.28, 0.035, 5, 12), darkWood, group, [x, 0.94, 1.75]); strap.rotation.y = Math.PI / 2;
  }
  // Lantern on its own little post.
  beam(group, [-2.9, 0.6, -2.8], [-2.9, 2.05, -2.8], 0.055, darkWood);
  beam(group, [-2.9, 2.05, -2.8], [-2.6, 2.05, -2.8], 0.045, darkWood);
  cylinder(group, iron, [-2.6, 1.7, -2.8], 0.18, 0.16, 0.07, 6);
  cylinder(group, material('#efc478', { emissive: '#eea34e', emissiveIntensity: 0.55 }), [-2.6, 1.84, -2.8], 0.11, 0.11, 0.22, 6);
  cylinder(group, iron, [-2.6, 1.98, -2.8], 0.05, 0.18, 0.11, 6);
  return optimizeStatic(group);
}

export function sail() {
  const root = new THREE.Group(), frame = new THREE.Group();
  beam(frame, [0, 0, 0], [0, 5.6, 0], 0.105, wood[0], 0.062);
  for (const y of [2.05, 5.05]) {
    beam(frame, [-1.55, y, 0], [1.8, y, 0], 0.055, darkWood);
    for (let i = 0; i < 4; i++) {
      const knot = mesh(new THREE.TorusGeometry(0.118, 0.02, 4, 10), ropeMat, frame, [0, y - 0.08 + i * 0.05, 0]); knot.rotation.x = Math.PI / 2;
    }
  }
  rope(frame, [[0, 5.4, 0], [1.65, 2.3, 0.5], [2.4, 0.04, 1.7]], 0.024);
  rope(frame, [[0, 5.4, 0], [-1.1, 2.6, -0.6], [-1.05, 0.04, -0.8]], 0.024);
  cylinder(frame, darkWood, [0, 0.16, 0], 0.23, 0.27, 0.22, 8);
  root.add(optimizeStatic(frame));
  const columns = 16, rows = 15, positions = [], uvs = [], indices = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const u = x / columns, v = y / rows;
    const width = 2.92 + 0.25 * (1 - v);
    positions.push((u - 0.5) * width + 0.12, 2.15 + v * 2.78, Math.sin(u * Math.PI) * Math.sin(v * Math.PI * 0.84) * 0.46 + 0.035);
    uvs.push(u, v);
    if (x < columns && y < rows) { const a = y * (columns + 1) + x; indices.push(a, a + 1, a + columns + 1, a + 1, a + columns + 2, a + columns + 1); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const textureCanvas = document.createElement('canvas'); textureCanvas.width = 512; textureCanvas.height = 512;
  const ctx = textureCanvas.getContext('2d');
  ctx.fillStyle = '#e8e0c3'; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#63968a'; ctx.beginPath(); ctx.moveTo(0, 400); ctx.lineTo(512, 270); ctx.lineTo(512, 512); ctx.lineTo(0, 512); ctx.fill();
  ctx.strokeStyle = '#c5ba99'; ctx.lineWidth = 1;
  for (let i = 16; i < 512; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(100, 91, 66, .25)'; ctx.setLineDash([4, 6]); ctx.strokeRect(8, 8, 496, 496);
  ctx.setLineDash([]); ctx.strokeStyle = '#a4b9a0'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(254, 186, 42, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(225, 208); ctx.lineTo(254, 151); ctx.lineTo(282, 208); ctx.stroke();
  const texture = new THREE.CanvasTexture(textureCanvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const cloth = mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 1 }), root);
  root.userData.cloth = cloth; root.userData.clothOriginal = [...positions];
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute('position', new THREE.Float32BufferAttribute([0, 5.58, 0, 0.95, 5.39, 0.1, 0, 5.2, 0], 3)); pennant.computeVertexNormals();
  mesh(pennant, material('#cd7b46', { side: THREE.DoubleSide }), root);
  return root;
}

export function storage() {
  const group = new THREE.Group();
  box(group, darkWood, [0, 0.45, 0], [1.15, 0.86, 0.83]);
  for (let i = 0; i < 5; i++) {
    box(group, wood[(i + 1) % 6], [(i - 2) * 0.23, 0.9, 0], [0.21, 0.09, 0.85]);
    box(group, wood[(i + 2) % 6], [(i - 2) * 0.23, 0.45, 0.43], [0.21, 0.78, 0.03]);
  }
  for (const x of [-0.42, 0.42]) {
    box(group, iron, [x, 0.96, 0], [0.07, 0.045, 0.91]);
    box(group, iron, [x, 0.47, 0.455], [0.07, 0.94, 0.05]);
  }
  box(group, material('#baab71', { metalness: 0.35 }), [0, 0.69, 0.48], [0.15, 0.22, 0.065]);
  return optimizeStatic(group);
}

export function barrel(floating = false) {
  const root = new THREE.Group();
  const body = cylinder(root, wood[1], [0, 0, 0], 0.4, 0.4, 1.06, 12);
  // Individual staves form the wide belly.
  cylinder(root, wood[0], [0, 0, 0], 0.46, 0.46, 0.65, 12);
  for (const y of [-0.4, 0.4]) cylinder(root, iron, [0, y, 0], 0.433, 0.433, 0.095, 12);
  cylinder(root, darkWood, [0, 0.537, 0], 0.35, 0.35, 0.015, 12);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    beam(root, [Math.sin(angle) * 0.405, -0.45, Math.cos(angle) * 0.405], [Math.sin(angle) * 0.46, 0, Math.cos(angle) * 0.46], 0.008, darkWood);
    beam(root, [Math.sin(angle) * 0.46, 0, Math.cos(angle) * 0.46], [Math.sin(angle) * 0.405, 0.45, Math.cos(angle) * 0.405], 0.008, darkWood);
  }
  const result = optimizeStatic(root);
  if (floating) result.rotation.z = 1.35;
  return result;
}

export function purifier() {
  const group = new THREE.Group();
  box(group, wood[0], [0, 0.08, 0], [1.45, 0.13, 1.22]);
  for (const x of [-0.6, 0.6]) for (const z of [-0.45, 0.45]) beam(group, [x, 0.12, z], [x * 0.7, 1.32, z * 0.8], 0.04, darkWood);
  beam(group, [-0.43, 1.32, -0.36], [0.43, 1.32, -0.36], 0.04, darkWood);
  const cover = box(group, material('#9fc6b2', { transparent: true, opacity: 0.7, side: THREE.DoubleSide }), [0, 0.96, 0], [1.02, 0.02, 1.03]); cover.rotation.x = 0.38;
  cylinder(group, iron, [0, 0.45, 0.1], 0.43, 0.25, 0.3, 10);
  cylinder(group, material('#59babc'), [0, 0.602, 0.1], 0.37, 0.37, 0.009, 12);
  cylinder(group, material('#bbc9bb'), [0, 0.22, 0.47], 0.14, 0.12, 0.27, 10);
  return optimizeStatic(group);
}

export function grill() {
  const group = new THREE.Group();
  for (const x of [-0.35, 0.35]) for (const z of [-0.3, 0.3]) beam(group, [x * 1.4, 0, z * 1.4], [x, 0.7, z], 0.035, iron);
  const bowl = sphere(group, material('#485f59'), [0, 0.62, 0], [0.6, 0.27, 0.47]);
  for (let i = -3; i <= 3; i++) beam(group, [i * 0.145, 0.82, -0.38], [i * 0.145, 0.82, 0.38], 0.015, iron);
  for (const x of [-0.2, 0.16]) sphere(group, material('#c5874b'), [x, 0.87, 0], [0.13, 0.05, 0.16]);
  return optimizeStatic(group);
}

export function garden() {
  const group = new THREE.Group();
  box(group, material('#66543b'), [0, 0.22, 0], [1.45, 0.3, 1.1]);
  for (const z of [-0.57, 0.57]) box(group, wood[2], [0, 0.26, z], [1.6, 0.47, 0.08]);
  for (const x of [-0.78, 0.78]) box(group, wood[1], [x, 0.26, 0], [0.08, 0.47, 1.2]);
  const plant = palm(0.75, 32); plant.position.y = 0.39; group.add(plant);
  return optimizeStatic(group);
}

export function structure(type) {
  return ({ sail, storage, purifier, grill, garden }[type] || storage)();
}

export function resource(kind) {
  let result;
  if (kind === 'barrel') return barrel(true);
  if (kind === 'crate') { result = storage(); result.scale.setScalar(0.78); result.position.y = -0.3; return result; }
  const root = new THREE.Group();
  if (kind === 'wood') {
    for (let i = 0; i < 2; i++) {
      const plank = box(root, wood[i + 1], [(i - 0.5) * 0.24, i * 0.07, 0], [0.32, 0.09, 1.6 - i * 0.28]); plank.rotation.y = i * 0.24;
      box(root, darkWood, [(i - 0.5) * 0.24, i * 0.07 + 0.046, -0.15], [0.012, 0.004, 0.6]);
    }
  } else if (kind === 'plastic') {
    const bottle = new THREE.Group();
    box(bottle, material('#d1ded1'), [0, 0, 0], [0.53, 0.23, 0.8]);
    box(bottle, material('#569894'), [0, 0.001, 0], [0.54, 0.24, 0.25]);
    const neck = cylinder(bottle, material('#c0d2c6'), [0, 0, 0.49], 0.12, 0.12, 0.2, 8); neck.rotation.x = Math.PI / 2;
    const cap = cylinder(bottle, material('#d79258'), [0, 0, 0.62], 0.13, 0.13, 0.08, 8); cap.rotation.x = Math.PI / 2;
    root.add(bottle);
  } else {
    const leaf = frond(1.8, 0.42, 0.1, 2); leaf.position.x = -.8; leaf.rotation.x = -.06; leaf.rotation.y = 0.7; root.add(leaf);
  }
  return optimizeStatic(root);
}

export function frond(length, width, droop, variant = 0) {
  const positions = [], indices = [];
  for (let s = 0; s <= 8; s++) {
    const t = s / 8, w = Math.sin(Math.PI * t) * width;
    const y = -droop * t * t + Math.sin(t * Math.PI) * length * 0.2;
    positions.push(t * length, y - w * 0.2, -w, t * length, y + w * 0.17, 0, t * length, y - w * 0.2, w);
    if (s < 8) { const a = s * 3; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals();
  return mesh(geo, material(['#4d8c58', '#729b5e', '#84ac66', '#659754'][variant % 4], { side: THREE.DoubleSide, flatShading: true }));
}

export function palm(height = 5, seed = 1) {
  const group = new THREE.Group(), rng = seeded(seed), bend = 0.5 + rng() * 0.65, angle = rng() * 6.28;
  for (let s = 0; s < 7; s++) {
    const a = s / 7, b = (s + 1) / 7;
    const from = [Math.sin(angle) * bend * a * a, a * height, Math.cos(angle) * bend * a * a];
    const to = [Math.sin(angle) * bend * b * b, b * height, Math.cos(angle) * bend * b * b];
    beam(group, from, to, height * (0.046 - a * 0.018), material(s % 2 ? '#aa8553' : '#b59863'), height * (0.046 - b * 0.018));
  }
  const top = new THREE.Vector3(Math.sin(angle) * bend, height, Math.cos(angle) * bend);
  for (let i = 0; i < 9; i++) {
    const leaf = frond(height * (0.52 + rng() * 0.18), height * 0.09, height * (0.18 + rng() * 0.18), i);
    leaf.position.copy(top); leaf.rotation.y = i * Math.PI * 2 / 9; leaf.rotation.z = (rng() - 0.5) * 0.38; group.add(leaf);
  }
  for (let i = 0; i < 3; i++) sphere(group, material('#807447'), [top.x + (rng() - 0.5) * height * 0.11, height - height * 0.05, top.z + (rng() - 0.5) * height * 0.1], [height * 0.048, height * 0.058, height * 0.048]);
  return optimizeStatic(group);
}

export function island(seed = 17, size = 1) {
  const group = new THREE.Group(), rng = seeded(seed);
  const shore = cylinder(group, material('#ddd09b'), [0, 0.08, 0], 7.4, 8.4, 0.72, 17); shore.scale.set(1, 1, 0.76);
  const sand = cylinder(group, material('#eee0ad'), [-0.3, 0.52, -0.4], 5.8, 7.4, 0.7, 16); sand.scale.z = 0.79; sand.rotation.y = 0.18;
  rock(group, material('#9eac7c'), [-0.7, 1.1, -1], [5.6, 1.3, 3.6]);
  for (let i = 0; i < 7; i++) {
    const x = (rng() - 0.5) * 7, z = (rng() - 0.5) * 4 - 0.5;
    const tree = palm(4.6 + rng() * 2.5, seed * 10 + i); tree.position.set(x, 1.1, z); tree.rotation.y = rng() * 6.28; group.add(tree);
  }
  for (let i = 0; i < 10; i++) {
    const x = (rng() - 0.5) * 9, z = (rng() - 0.5) * 5;
    rock(group, material(i % 2 ? '#879c91' : '#a2afa0'), [x, 0.6 + rng() * 0.3, z], [0.65 + rng() * 1.1, 0.8 + rng() * 1.3, 0.5 + rng()]);
  }
  const result = optimizeStatic(group); result.scale.setScalar(size);
  result.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
  return result;
}

export function character() {
  const group = new THREE.Group(), shirt = material('#c8784d'), skin = material('#c99669'), pants = material('#446966'), shoe = material('#674f39');
  const body = new THREE.Group(); group.add(body);
  const torso = cylinder(body, shirt, [0, 0.91, 0], 0.23, 0.19, 0.48, 8); torso.scale.z = 0.74;
  sphere(body, skin, [0, 1.37, 0.02], [0.21, 0.25, 0.21]);
  sphere(body, material('#4e3c2d'), [0, 1.44, -0.025], [0.212, 0.2, 0.2]);
  sphere(body, skin, [0, 1.34, 0.1], [0.19, 0.18, 0.15]);
  for (const x of [-0.075, 0.075]) sphere(body, material('#373f37'), [x, 1.37, 0.236], [0.017, 0.025, 0.015]);
  sphere(body, skin, [0, 1.31, 0.255], [0.035, 0.043, 0.034]);
  const hat = new THREE.Group(); hat.position.set(0, 1.58, 0); hat.rotation.z = -0.07;
  cylinder(hat, material('#d9bd80'), [0, 0, 0], 0.38, 0.36, 0.05, 16);
  cylinder(hat, material('#d9bd80'), [0, 0.1, 0], 0.17, 0.23, 0.19, 12);
  cylinder(hat, material('#648981'), [0, 0.036, 0], 0.225, 0.23, 0.058, 12); body.add(hat);
  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 0.12, 0.69, 0);
    cylinder(leg, pants, [0, -0.15, 0], 0.107, 0.084, 0.34, 7);
    cylinder(leg, skin, [0, -0.38, 0], 0.074, 0.061, 0.2, 7);
    box(leg, shoe, [0, -0.54, 0.04], [0.16, 0.12, 0.29]); group.add(leg); legs.push(leg);
    const arm = new THREE.Group(); arm.position.set(side * 0.23, 1.05, 0);
    cylinder(arm, shirt, [side * 0.035, -0.07, 0], 0.1, 0.09, 0.23, 7);
    cylinder(arm, skin, [side * 0.075, -0.26, 0], 0.07, 0.065, 0.25, 7);
    sphere(arm, skin, [side * 0.075, -0.4, 0.01], [0.074, 0.09, 0.075]);
    arm.rotation.z = side * 0.15; body.add(arm); arms.push(arm);
  }
  group.userData = { body, legs, arms };
  return group;
}

export function shark() {
  const root = new THREE.Group(), top = material('#527f83'), belly = material('#acbfad');
  sphere(root, top, [0, 0, 0], [0.56, 0.4, 1.75]);
  sphere(root, belly, [0, -0.19, 0.2], [0.49, 0.19, 1.34]);
  const fin = new THREE.BufferGeometry(); fin.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.27, 0.35, 0, 1.05, -0.2, 0, 0.25, -0.68], 3)); fin.computeVertexNormals();
  mesh(fin, material('#4b7275', { side: THREE.DoubleSide }), root);
  for (const side of [-1, 1]) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([0.3 * side, 0, 0.55, 1.15 * side, -0.1, -0.3, 0.35 * side, 0, -0.55], 3)); geo.computeVertexNormals();
    mesh(geo, material('#527f83', { side: THREE.DoubleSide }), root);
    sphere(root, material('#142f30'), [0.34 * side, 0.11, 1.28], [0.045, 0.045, 0.045]);
  }
  const tail = new THREE.BufferGeometry(); tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1.5, 0, 0.7, -2.3, 0, -0.1, -2.1, 0, 0, -1.5, 0, -0.1, -2.1, 0, -0.55, -2.2], 3)); tail.computeVertexNormals(); mesh(tail, material('#527f83', { side: THREE.DoubleSide }), root);
  return optimizeStatic(root);
}
