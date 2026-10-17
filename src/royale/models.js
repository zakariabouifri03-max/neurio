import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const materials = new Map();
const unitBox = new THREE.BoxGeometry(1, 1, 1);
export function mat(color, roughness = .8, metalness = 0) {
  if (color?.isMaterial) return color;
  const key = `${color}-${roughness}-${metalness}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return materials.get(key);
}
export function box(parent, x, y, z, w, h, d, color, rotation = 0) {
  const mesh = new THREE.Mesh(unitBox, mat(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.rotation.y = rotation; mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function cylinder(parent, x, y, z, r1, r2, height, color, sides = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, height, sides), mat(color)); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function ico(parent, x, y, z, radius, color, scale = [1, 1, 1], detail = 0) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, detail), mat(color)); mesh.position.set(x, y, z); mesh.scale.set(...scale); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function pole(parent, a, b, radius, color) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
  const m = cylinder(parent, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2, radius, radius, direction.length(), color, 6);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); return m;
}
export function quad(parent, points, material) {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function batch(group) {
  group.updateWorldMatrix(true, true);
  const inverse = group.matrixWorld.clone().invert(), buckets = new Map();
  group.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    if (!buckets.has(mesh.material.uuid)) buckets.set(mesh.material.uuid, { material: mesh.material, geometries: [] });
    buckets.get(mesh.material.uuid).geometries.push(geometry);
  });
  group.clear();
  for (const { material, geometries } of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    geometries.forEach(g => g.dispose());
  }
}
export function textPlane(parent, text, x, y, z, width, height, options = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (options.background) { ctx.fillStyle = options.background; ctx.fillRect(0, 0, 512, 128); }
  ctx.fillStyle = options.color || '#faf5e7'; ctx.font = `${options.weight || 700} ${options.size || 76}px Barlow, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 69, 480);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
const headlight = new THREE.MeshStandardMaterial({ color: 0xe4f7f2, emissive: 0xb8e2eb, emissiveIntensity: 1.1, metalness: .2, roughness: .2 });
const taillight = new THREE.MeshStandardMaterial({ color: 0xc93a28, emissive: 0xc93525, emissiveIntensity: .8, roughness: .24 });
let contactMap;
function contactShadow(root) {
  if (!contactMap) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 16, 64, 64, 62); gradient.addColorStop(0, '#0009'); gradient.addColorStop(.5, '#0006'); gradient.addColorStop(1, '#0000'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128); contactMap = new THREE.CanvasTexture(c);
  }
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.6), new THREE.MeshBasicMaterial({ map: contactMap, transparent: true, depthWrite: false, opacity: .65 })); plane.rotation.x = -Math.PI / 2; plane.position.y = .025; root.add(plane);
}
export function createCar(id = 'kaze', color = '#dfc153', detail = true) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: .26, metalness: .58, envMapIntensity: 1.25 });
  const black = mat(0x1b2429, .67), carbon = mat(0x222c30, .55, .15), chrome = mat(0xb2bdc0, .25, .85), rim = mat(id === 'raid' ? 0xadb0a0 : 0x414c51, .36, .65);
  const glass = mat(0x233c43, .12, .72); glass.side = THREE.DoubleSide;
  const rally = id === 'raid', gt = id === 'vela';
  const floor = rally ? .10 : 0, wheelRadius = rally ? .49 : .43;
  const profile = new THREE.Shape();
  profile.moveTo(-2.5, .44); profile.lineTo(-2.14, .44);
  profile.absarc(-1.57, .47, .57, Math.PI, 0, true);
  profile.lineTo(.98, .47); profile.absarc(1.55, .47, .57, Math.PI, 0, true);
  profile.lineTo(2.49, .47); profile.lineTo(2.55, .68); profile.lineTo(2.39, .88); profile.lineTo(1.17, 1.015);
  profile.lineTo(-1.18, 1.015); profile.lineTo(-2.42, .94); profile.lineTo(-2.55, .76); profile.closePath();
  const shell = new THREE.ExtrudeGeometry(profile, { depth: 1.96, bevelEnabled: true, bevelThickness: .026, bevelSize: .025, bevelSegments: 2, steps: 1, curveSegments: detail ? 16 : 8 });
  shell.translate(0, floor, -.98); shell.rotateY(-Math.PI / 2);
  const bodyMesh = new THREE.Mesh(shell, paint); bodyMesh.castShadow = bodyMesh.receiveShadow = true; body.add(bodyMesh);
  box(body, 0, .40 + floor, 0, 1.72, .12, 4.45, black);
  for (const side of [-1, 1]) {
    box(body, side * 1.005, .43 + floor, .0, .07, .14, 2.0, carbon);
    box(body, side * 1.019, .72 + floor, -.18, .012, .017, 1.77, carbon);
    box(body, side * 1.024, .9 + floor, -.58, .026, .04, .19, chrome);
    // Front and rear fender lips follow the real, cut-out wheel arches.
    for (const z of [-1.57, 1.55]) {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(.557, .034, 5, detail ? 24 : 12, Math.PI), rally ? black : paint);
      lip.rotation.y = Math.PI / 2; lip.rotation.z = -.0; lip.position.set(side * 1.002, .47 + floor, z); body.add(lip);
    }
  }
  // Sculpted hood, trunk and a separate glasshouse.
  quad(body, [[-.92, 1.017 + floor, 1.02], [.92, 1.017 + floor, 1.02], [.86, .931 + floor, 2.33], [-.86, .931 + floor, 2.33]], paint).material.side = THREE.DoubleSide;
  box(body, 0, 1.032 + floor, 1.43, .73, .014, .59, carbon);
  for (let i = 0; i < 5; i++) box(body, 0, 1.045 + floor, 1.21 + i * .10, .59, .008, .023, 0x4f5b60);
  const roofY = (gt ? 1.48 : rally ? 1.68 : 1.59) + floor;
  const rf = gt ? -.03 : .13, rr = gt ? -.98 : -.89;
  quad(body, [[-.83, 1.01 + floor, .98], [.83, 1.01 + floor, .98], [.70, roofY, rf], [-.70, roofY, rf]], glass);
  quad(body, [[-.70, roofY, rf], [.70, roofY, rf], [.70, roofY + .035, rr], [-.70, roofY + .035, rr]], paint);
  quad(body, [[-.70, roofY + .02, rr], [.70, roofY + .02, rr], [.85, 1.02 + floor, -1.49], [-.85, 1.02 + floor, -1.49]], glass);
  for (const s of [-1, 1]) {
    quad(body, [[s * .844, 1.047 + floor, .9], [s * .844, 1.047 + floor, -1.38], [s * .706, roofY - .045, rr + .03], [s * .706, roofY - .045, rf - .025]], glass);
    pole(body, [s * .83, 1.01 + floor, .98], [s * .71, roofY, rf], .034, paint);
    pole(body, [s * .71, roofY, rf], [s * .71, roofY, rr], .035, paint);
    pole(body, [s * .71, roofY, rr], [s * .85, 1.02 + floor, -1.49], .047, paint);
    pole(body, [s * .837, 1.03 + floor, -.43], [s * .71, roofY, -.43], .041, carbon);
    box(body, s * .986, 1.13 + floor, .66, .22, .055, .08, black);
    box(body, s * 1.12, 1.16 + floor, .66, .25, .12, .25, paint);
    box(body, s * 1.12, 1.164 + floor, .532, .21, .085, .008, chrome);
  }
  // Grille, radiator slats, front splitter and four LED projectors.
  box(body, 0, .64 + floor, 2.535, 1.65, .28, .045, black);
  for (let i = 0; i < (detail ? 7 : 3); i++) box(body, 0, .54 + floor + i * (detail ? .031 : .08), 2.566, 1.54, .008, .012, chrome);
  box(body, 0, .435 + floor, 2.49, 2.08, .072, .25, carbon);
  box(body, 0, .81 + floor, 2.50, .37, .046, .09, paint);
  for (const s of [-1, 1]) {
    box(body, s * .75, .86 + floor, 2.40, .46, .17, .15, black);
    for (const x of [.64, .85]) {
      const light = cylinder(body, s * x, .874 + floor, 2.485, .067, .067, .023, headlight, detail ? 16 : 8); light.rotation.x = Math.PI / 2;
    }
    box(body, s * .74, .964 + floor, 2.43, .44, .016, .02, headlight);
    box(body, s * .97, .712 + floor, 2.44, .07, .14, .07, carbon);
    box(body, s * .77, .86 + floor, -2.53, .48, .135, .031, black);
    for (const x of [.64, .86]) { const light = cylinder(body, s * x, .864 + floor, -2.555, .073, .073, .017, taillight, 12); light.rotation.x = Math.PI / 2; }
    box(body, s * .73, 1.12 + floor, -2.15, .064, .29, .12, carbon);
    const pipe = cylinder(body, s * .68, .47 + floor, -2.52, .068, .068, .19, chrome, 12); pipe.rotation.x = Math.PI / 2;
    const inner = cylinder(body, s * .68, .47 + floor, -2.62, .052, .052, .003, black, 12); inner.rotation.x = Math.PI / 2;
  }
  box(body, 0, 1.27 + floor, -2.15, 2.09, .063, .37, carbon);
  for (const s of [-1, 1]) box(body, s * 1.018, 1.28 + floor, -2.14, .028, .15, .44, paint);
  box(body, 0, .43 + floor, -2.4, 1.9, .09, .29, carbon);
  for (let i = -2; i <= 2; i++) box(body, i * .28, .43 + floor, -2.47, .022, .14, .23, black);
  if (rally) {
    box(body, 0, roofY + .12, -.2, 1.52, .06, 1.25, carbon);
    for (let i = 0; i < 4; i++) { const lamp = cylinder(body, -.45 + i * .3, roofY + .22, .44, .10, .10, .10, headlight, 12); lamp.rotation.x = Math.PI / 2; }
    box(body, 0, .66, 2.7, 1.8, .063, .08, chrome);
  }
  if (detail) {
    const plate = textPlane(body, 'OUTRUN', 0, .71 + floor, 2.582, .46, .105, { background: '#dbe3db', color: '#27363b', size: 88 });
    textPlane(body, 'K A Z E', 0, .97 + floor, 2.425, .4, .08, { color: '#333e3b', size: 65 });
    for (const side of [-1, 1]) {
      const label = textPlane(body, '01', side * 1.029, .85 + floor, -.1, .32, .26, { color: '#263530', size: 107 }); label.rotation.y = side * Math.PI / 2;
      const detailLabel = textPlane(body, 'OUTRUN MOTORSPORT', side * 1.035, .57 + floor, -.22, 1.15, .10, { color: '#37443f', size: 67 }); detailLabel.rotation.y = side * Math.PI / 2;
    }
  }
  const wheels = [], steeringWheels = [];
  for (const s of [-1, 1]) for (const z of [-1.57, 1.55]) {
    const pivot = new THREE.Group(); pivot.position.set(s * .99, wheelRadius + .012, z); root.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius - .09, .103, detail ? 10 : 6, detail ? 36 : 16), black); tire.rotation.y = Math.PI / 2; spin.add(tire);
    const drum = cylinder(spin, 0, 0, 0, wheelRadius * .76, wheelRadius * .76, .19, carbon, detail ? 24 : 12); drum.rotation.z = Math.PI / 2;
    const brake = cylinder(spin, s * .105, 0, 0, wheelRadius * .62, wheelRadius * .62, .015, chrome, detail ? 24 : 12); brake.rotation.z = Math.PI / 2;
    const hub = cylinder(spin, s * .159, 0, 0, .071, .071, .026, chrome, 12); hub.rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const spoke = box(spin, s * .14, Math.cos(angle) * .148, Math.sin(angle) * .148, .055, .265, .047, rim); spoke.rotation.x = angle;
    }
    box(pivot, s * .10, -.05, -.22, .08, .22, .11, mat(0xd55e40, .6, .2));
    batch(spin); wheels.push(spin); if (z > 0) steeringWheels.push(pivot);
  }
  batch(body); contactShadow(root);
  return { root, body, wheels, steeringWheels, paint, id, radius: wheelRadius,
    update(distance, steer = 0, pitch = 0, roll = 0) { wheels.forEach(w => { w.rotation.x = distance / wheelRadius; }); steeringWheels.forEach(w => { w.rotation.y = -steer * .4; }); body.rotation.z = roll; body.rotation.x = pitch; },
    setPaint(hex) { paint.color.set(hex); },
    dispose() { root.traverse(mesh => { if (mesh.isMesh && mesh.geometry !== unitBox) mesh.geometry.dispose(); }); paint.dispose(); },
  };
}
