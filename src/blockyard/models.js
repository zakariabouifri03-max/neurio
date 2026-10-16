import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OUTFITS } from './rules.js';

const geometries = new Map(), materials = new Map();
export function mat(color, extras = {}) {
  const key = color + JSON.stringify(extras, (k, v) => v?.isTexture ? v.uuid : v);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .78, ...extras }));
  return materials.get(key);
}
export function roundGeometry(w, h, d, radius = .07) {
  const key = [w, h, d, radius].join(',');
  if (geometries.has(key)) return geometries.get(key);
  const geometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const r = Math.min(radius, w * .4, h * .4, d * .4), p = new THREE.Vector3(), core = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i); core.copy(p).clampScalar(-.25, .25); n.copy(p).sub(core).normalize();
    position.setXYZ(i, core.x * 4 * (w / 2 - r) + n.x * r, core.y * 4 * (h / 2 - r) + n.y * r, core.z * 4 * (d / 2 - r) + n.z * r);
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  geometry.computeBoundingSphere(); geometries.set(key, geometry); return geometry;
}
export function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); object.castShadow = object.receiveShadow = true; parent.add(object); return object;
}
export function box(parent, color, xyz, size, radius = .07) { return mesh(parent, roundGeometry(...size, radius), typeof color === 'string' ? mat(color) : color, ...xyz); }
export function cylinder(parent, color, xyz, radius, height, segments = 16) {
  const key = `cyl-${radius}-${height}-${segments}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.CylinderGeometry(radius, radius, height, segments));
  return mesh(parent, geometries.get(key), typeof color === 'string' ? mat(color) : color, ...xyz);
}
export function ball(parent, color, xyz, size) {
  if (!geometries.has('ball')) geometries.set('ball', new THREE.SphereGeometry(1, 12, 8));
  const object = mesh(parent, geometries.get('ball'), typeof color === 'string' ? mat(color) : color, ...xyz); object.scale.set(...size); return object;
}
export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const byMaterial = new Map(), result = new THREE.Group();
  group.traverse(object => {
    if (!object.isMesh) return;
    let geo = object.geometry.clone(); geo.applyMatrix4(object.matrixWorld);
    if (geo.index) { const indexed = geo; geo = geo.toNonIndexed(); indexed.dispose(); }
    if (!byMaterial.has(object.material)) byMaterial.set(object.material, []);
    byMaterial.get(object.material).push(geo);
  });
  for (const [material, parts] of byMaterial) {
    const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
    if (geometry) mesh(result, geometry, material);
  }
  return result;
}
let faceTexture, studs;
function face() {
  if (faceTexture) return faceTexture;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffcf79'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#393c48';
  ctx.beginPath(); ctx.roundRect(75, 96, 17, 25, 8); ctx.roundRect(163, 96, 17, 25, 8); ctx.fill();
  ctx.strokeStyle = '#393c48'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(128, 128, 36, .18, Math.PI - .18); ctx.stroke();
  ctx.fillStyle = '#edaa72'; ctx.beginPath(); ctx.ellipse(66, 143, 14, 7, 0, 0, Math.PI * 2); ctx.ellipse(190, 143, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
  faceTexture = new THREE.CanvasTexture(canvas); faceTexture.colorSpace = THREE.SRGBColorSpace; return faceTexture;
}
export function studTexture() {
  if (studs) return studs;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 128, 128);
  c.strokeStyle = '#e8ebdf'; c.lineWidth = 2; c.strokeRect(1, 1, 126, 126);
  c.fillStyle = '#e0e5d4'; c.beginPath(); c.ellipse(66, 66, 27, 24, 0, 0, 2 * Math.PI); c.fill();
  c.fillStyle = '#f4f5ec'; c.beginPath(); c.ellipse(63, 60, 26, 24, 0, 0, 2 * Math.PI); c.fill();
  studs = new THREE.CanvasTexture(canvas); studs.colorSpace = THREE.SRGBColorSpace; studs.wrapS = studs.wrapT = THREE.RepeatWrapping; studs.anisotropy = 8; return studs;
}
export function label(text, { width = 3, height = .75, bg = '#ffffff', fg = '#334341', size = 54 } = {}) {
  const logicalWidth = 768, logicalHeight = Math.round(768 * height / width);
  const canvas = document.createElement('canvas');
  canvas.width = 2 ** Math.round(Math.log2(Math.max(128, width * 128)));
  canvas.height = 2 ** Math.round(Math.log2(Math.max(32, height * 128)));
  const ctx = canvas.getContext('2d');
  // Preserve the intended lettering proportions while keeping exported textures
  // power-of-two for older game engines and mipmapped glTF importers.
  ctx.scale(canvas.width / logicalWidth, canvas.height / logicalHeight);
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(2, 2, logicalWidth - 4, logicalHeight - 4, 24); ctx.fill();
  ctx.fillStyle = fg; ctx.font = `800 ${size}px "Outfit",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, logicalWidth / 2, logicalHeight / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(width, height, 1); sprite.userData.noExport = true; return sprite;
}

export function starGeometry(radius = .45, depth = .12) {
  const key = `star-${radius}-${depth}`;
  if (geometries.has(key)) return geometries.get(key);
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 + Math.PI / 2, r = i % 2 ? radius * .48 : radius; i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .018, bevelThickness: .018 }); geometry.translate(0, 0, -depth / 2); geometries.set(key, geometry); return geometry;
}
export function avatar(outfit = 'citrus') {
  const root = new THREE.Group(); root.name = 'Blockyard adventurer';
  const colors = { shirt: new THREE.MeshStandardMaterial({ color: OUTFITS[outfit].shirt, roughness: .8 }), cap: new THREE.MeshStandardMaterial({ color: OUTFITS[outfit].cap, roughness: .8 }), pants: new THREE.MeshStandardMaterial({ color: OUTFITS[outfit].pants, roughness: .85 }), bag: new THREE.MeshStandardMaterial({ color: OUTFITS[outfit].bag, roughness: .85 }) };
  const skin = mat('#ffcf79'), cream = mat('#fff5dc'), dark = mat('#344451');
  box(root, colors.shirt, [0, 1.49, 0], [1.15, .94, .62], .10);
  // A small, original diamond badge — not an official avatar or brand asset.
  const badge = box(root, cream, [.29, 1.63, .322], [.2, .2, .025], .018); badge.rotation.z = Math.PI / 4;
  box(root, colors.bag, [0, 1.5, -.46], [.77, .84, .31], .13);
  box(root, mat('#c7b5ed'), [0, 1.31, -.635], [.59, .30, .07], .05);
  for (const x of [-.32, .32]) box(root, colors.bag, [x, 1.52, .32], [.075, .85, .045], .02);
  const head = new THREE.Group(); head.position.y = 2.36; root.add(head);
  box(head, skin, [0, 0, 0], [.82, .80, .78], .09);
  const facePlane = mesh(head, new THREE.PlaneGeometry(.65, .65), new THREE.MeshStandardMaterial({ map: face(), roughness: .9 }), 0, -.035, .397); facePlane.castShadow = false;
  box(head, colors.cap, [0, .39, -.025], [.90, .20, .84], .10);
  box(head, colors.cap, [0, .325, .41], [.93, .09, .43], .035);
  box(head, cream, [0, .42, .405], [.18, .105, .02], .02);
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * .79, 1.9, 0); root.add(arm);
    box(arm, colors.shirt, [0, -.29, 0], [.43, .62, .62], .075);
    box(arm, skin, [0, -.71, 0], [.43, .30, .60], .07); arms.push(arm);
    const leg = new THREE.Group(); leg.position.set(side * .29, 1.05, 0); root.add(leg);
    box(leg, colors.pants, [0, -.44, 0], [.49, .83, .60], .06);
    box(leg, cream, [0, -.91, .075], [.52, .25, .78], .07);
    box(leg, mat('#d7e0d6'), [0, -1.015, .075], [.53, .05, .79], .02); legs.push(leg);
  }
  root.userData.rig = { arms, legs, head, colors };
  return root;
}
export function setOutfit(root, outfit) { for (const [part, color] of Object.entries(OUTFITS[outfit])) if (root.userData.rig.colors[part]) root.userData.rig.colors[part].color.set(color); }
export function animateAvatar(root, time, speed, airborne, verticalSpeed = 0) {
  const { arms, legs, head } = root.userData.rig;
  const amount = Math.min(1, speed / 7.5), wave = Math.sin(time * 13) * .62 * amount;
  legs[0].rotation.x = airborne ? -.28 : wave; legs[1].rotation.x = airborne ? .24 : -wave;
  arms[0].rotation.x = airborne ? -.65 : -wave; arms[1].rotation.x = airborne ? -.65 : wave;
  arms[0].rotation.z = airborne ? .38 : .035 + Math.sin(time * 2.2) * .025;
  arms[1].rotation.z = airborne ? -.38 : -.035 - Math.sin(time * 2.2) * .025;
  head.rotation.x = airborne ? Math.max(-.14, Math.min(.15, -verticalSpeed * .014)) : Math.sin(time * 1.6) * .025;
}
export function tree(size = 1, color = '#88b768') {
  const group = new THREE.Group();
  box(group, '#b58d65', [0, 1.22 * size, 0], [.55 * size, 2.44 * size, .55 * size]);
  box(group, color, [0, 2.9 * size, 0], [2.45 * size, 1.9 * size, 2.1 * size], .25);
  box(group, '#a8cc78', [.35 * size, 3.85 * size, -.1 * size], [1.8 * size, 1.0 * size, 1.7 * size], .22);
  box(group, '#799e62', [-.68 * size, 2.75 * size, .15 * size], [1.35 * size, 1.12 * size, 1.65 * size], .19);
  return mergeStatic(group);
}
export function bench() {
  const group = new THREE.Group();
  for (const x of [-1.1, 1.1]) { box(group, '#f3ad7d', [x, .42, 0], [.2, .84, .8]); box(group, '#f3ad7d', [x, 1.05, -.45], [.17, 1.4, .15]); }
  for (let i = 0; i < 3; i++) box(group, '#fff2d6', [0, .82, (i - 1) * .27], [2.9, .15, .24]);
  for (let i = 0; i < 2; i++) box(group, '#fff2d6', [0, 1.25 + i * .3, -.47], [2.9, .25, .14]);
  return mergeStatic(group);
}
export function coin() {
  const group = new THREE.Group();
  const body = cylinder(group, mat('#ffd36b', { metalness: .3, roughness: .32, emissive: '#ffcc47', emissiveIntensity: .10 }), [0, 0, 0], .44, .15, 24); body.rotation.x = Math.PI / 2;
  mesh(group, starGeometry(.27, .025), mat('#fff3bb', { metalness: .2, roughness: .35 }), 0, 0, .095);
  mesh(group, starGeometry(.27, .025), mat('#fff3bb', { metalness: .2, roughness: .35 }), 0, 0, -.095);
  return group;
}
export function arch(parent, x, y, z, color, title) {
  for (const sign of [-1, 1]) {
    box(parent, '#f9f8e9', [x + sign * 3.3, y + 2.1, z], [.7, 4.2, .85], .17);
    box(parent, color, [x + sign * 3.3, y + .30, z], [1.0, .6, 1.05], .12);
    for (let j = 0; j < 3; j++) box(parent, color, [x + sign * 3.3, y + 1.1 + j * .85, z + .45], [.71, .25, .045], .02);
  }
  box(parent, color, [x, y + 4.4, z], [7.35, .9, 1.05], .20);
  const artwork = label(title, { width: 5.4, height: .75, bg: '#ffffff', fg: '#354a52', size: 78 });
  const sign = mesh(parent, new THREE.PlaneGeometry(5.4, .75), new THREE.MeshBasicMaterial({ map: artwork.material.map, transparent: true, toneMapped: false }), x, y + 4.4, z + .54); sign.castShadow = false;
}
