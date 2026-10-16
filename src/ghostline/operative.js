// Original articulated operative, modeled entirely from procedural geometry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Combine only siblings with the same material. Articulation groups stay intact.
function batchParts(root) {
  for (const child of [...root.children]) if (child.isGroup) batchParts(child);
  const batches = new Map();
  for (const child of root.children) if (child.isMesh) {
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material).push(child);
  }
  for (const [material, parts] of batches) {
    if (parts.length < 2) continue;
    const geometries = parts.map(p => { p.updateMatrix(); return p.geometry.clone().toNonIndexed().applyMatrix4(p.matrix); });
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false), material);
    mesh.name = `${root.name || 'Body'}_${material.uuid.slice(0, 6)}`;
    mesh.castShadow = mesh.receiveShadow = true;
    for (const part of parts) { root.remove(part); part.geometry.dispose(); }
    geometries.forEach(g => g.dispose()); root.add(mesh);
  }
}

export const PALETTES = {
  carbon: { jacket: '#384346', bag: '#777361', trim: '#c1dc7f', label: 'CARBON' },
  sand: { jacket: '#998b70', bag: '#464e49', trim: '#dfce9d', label: 'SANDSTONE' },
  spectre: { jacket: '#b5bfc2', bag: '#404e54', trim: '#98e2c9', label: 'SPECTRE' },
};
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .85, ...extra });
function part(parent, geo, material, x, y, z, name = '') {
  const mesh = new THREE.Mesh(geo, material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = name; parent.add(mesh); return mesh;
}
const box = (p, m, w, h, d, x = 0, y = 0, z = 0, name = '') => part(p, new THREE.BoxGeometry(w, h, d), m, x, y, z, name);
const sphere = (p, m, r, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = part(p, new THREE.SphereGeometry(r, 12, 10), m, x, y, z); o.scale.set(sx, sy, sz); return o; };
function capsule(p, m, r, length, x, y, z) { return part(p, new THREE.CapsuleGeometry(r, length, 4, 8), m, x, y, z); }
function tapered(w1, w2, h, d1, d2) {
  const geo = new THREE.CylinderGeometry(1, 1, h, 4, 1);
  geo.rotateY(Math.PI / 4);
  const a = geo.attributes.position;
  for (let i = 0; i < a.count; i++) { const top = a.getY(i) > 0; a.setX(i, a.getX(i) * (top ? w1 : w2) / Math.SQRT2); a.setZ(i, a.getZ(i) * (top ? d1 : d2) / Math.SQRT2); }
  geo.computeVertexNormals(); return geo;
}
export function buildOperative(palette = 'carbon') {
  const root = new THREE.Group(); root.name = 'ECHO_07';
  root.userData = { author: 'GHOSTLINE', description: 'Original procedural urban operative. Y up; forward -Z. Articulated node hierarchy.' };
  const jacket = mat(PALETTES[palette]?.jacket || PALETTES.carbon.jacket);
  const cloth = mat('#20292e'), pants = mat('#293137'), rubber = mat('#141e23');
  const bag = mat(PALETTES[palette]?.bag || PALETTES.carbon.bag);
  const strap = mat('#333a35'), seam = mat('#55615d'), steel = mat('#63726c', { metalness: .6, roughness: .45 });
  const trim = mat(PALETTES[palette]?.trim || PALETTES.carbon.trim, { emissive: '#91c86e', emissiveIntensity: .16 });
  const skin = mat('#b99578'), mask = mat('#151f24'), screen = mat('#a9e6c8', { emissive: '#b8ecc9', emissiveIntensity: 1.2 });
  const body = new THREE.Group(); body.name = 'Spine'; root.add(body);
  part(body, tapered(.63, .50, .63, .33, .31), jacket, 0, 1.27, 0, 'Field_jacket');
  part(body, tapered(.50, .62, .22, .31, .36), jacket, 0, .9, .018, 'Jacket_hem');
  box(body, cloth, .47, .18, .28, 0, .88, 0, 'Hips');
  box(body, seam, .016, .58, .012, 0, 1.28, -.178, 'Zipper');
  box(body, steel, .033, .04, .014, 0, 1.47, -.19);
  for (const s of [-1, 1]) {
    const pocket = box(body, jacket, .18, .16, .035, s * .18, 1.20, -.177); pocket.rotation.z = s * .12;
    const edge = box(body, seam, .155, .012, .012, s * .18, 1.27, -.20); edge.rotation.z = s * .12;
    box(body, strap, .067, .51, .046, s * .24, 1.36, -.17).rotation.z = -s * .13;
    box(body, steel, .059, .064, .055, s * .259, 1.22, -.192);
    box(body, strap, .062, .14, .32, s * .236, 1.52, .028).rotation.z = -s * .17;
  }
  box(body, strap, .50, .037, .042, 0, 1.34, -.216, 'Chest_strap');
  box(body, steel, .071, .053, .05, 0, 1.34, -.22, 'Buckle');
  // Weathered utility pack and its construction details.
  const pack = box(body, bag, .43, .52, .20, 0, 1.27, .243, 'Utility_pack');
  pack.rotation.x = -.07;
  sphere(body, bag, .2, 0, 1.51, .24, 1, .45, .54);
  box(body, bag, .345, .20, .077, 0, 1.12, .369, 'Pack_pocket');
  box(body, seam, .345, .013, .017, 0, 1.20, .412);
  box(body, strap, .040, .49, .025, -.136, 1.29, .359);
  box(body, strap, .040, .49, .025, .136, 1.29, .359);
  box(body, steel, .055, .066, .028, -.136, 1.15, .415);
  box(body, steel, .055, .066, .028, .136, 1.15, .415);
  box(body, rubber, .15, .10, .014, 0, 1.4, .351);
  box(body, trim, .058, .012, .02, -.017, 1.42, .363);
  box(body, trim, .012, .052, .02, .012, 1.40, .363);
  box(body, trim, .02, .047, .02, -.04, 1.395, .363);
  box(body, rubber, .058, .035, .13, 0, 1.56, .25);
  box(body, trim, .045, .18, .022, .232, 1.28, .265, 'Radio_indicator');
  box(body, mask, .067, .25, .065, -.255, 1.26, .23, 'Radio');
  box(body, mask, .009, .19, .009, -.258, 1.48, .23, 'Antenna');
  capsule(body, skin, .08, .09, 0, 1.66, 0);
  // Hood shell, dark inset, cap, half-mask, and eyes. Face looks down -Z.
  const head = new THREE.Group(); head.name = 'Head'; head.position.set(0, 1.81, 0); head.scale.set(.86, .88, .88); body.add(head);
  sphere(head, jacket, .226, 0, .028, .048, 1.04, 1.10, 1);
  sphere(head, mask, .188, 0, .025, -.078, 1, 1.12, .83);
  sphere(head, skin, .151, 0, .027, -.139, .91, 1.08, .82);
  sphere(head, mask, .145, 0, -.052, -.174, 1, .61, .74);
  sphere(head, cloth, .172, 0, .148, -.084, 1.1, .62, .99);
  const brim = box(head, cloth, .323, .023, .175, 0, .145, -.218, 'Cap_brim'); brim.rotation.x = -.05;
  box(head, mask, .23, .048, .049, 0, .050, -.267, 'Visor');
  for (const s of [-1, 1]) box(head, steel, .062, .018, .007, s * .054, .050, -.295);
  box(head, trim, .018, .013, .009, .105, .05, -.294);
  const limbs = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const arm = new THREE.Group(); arm.name = `Shoulder_${side}`; arm.position.set(s * .35, 1.49, .006); body.add(arm); arm.rotation.z = s * .11;
    capsule(arm, jacket, .11, .18, 0, -.12, 0);
    const elbow = new THREE.Group(); elbow.name = `Elbow_${side}`; elbow.position.y = -.31; arm.add(elbow);
    capsule(elbow, jacket, .087, .18, 0, -.125, -.016);
    capsule(elbow, strap, .092, .018, 0, -.245, -.016);
    sphere(elbow, rubber, .082, 0, -.31, -.012, .92, 1.25, .8);
    box(arm, trim, .02, .10, .094, s * .105, -.07, -.015, 'ID_patch');
    const leg = new THREE.Group(); leg.name = `Hip_${side}`; leg.position.set(s * .15, .87, 0); root.add(leg);
    part(leg, tapered(.235, .19, .35, .265, .21), pants, 0, -.15, 0, `Thigh_${side}`);
    box(leg, pants, .055, .18, .15, s * .116, -.21, .02, 'Cargo_pocket');
    box(leg, seam, .008, .015, .142, s * .15, -.15, .02);
    const knee = new THREE.Group(); knee.name = `Knee_${side}`; knee.position.y = -.35; leg.add(knee);
    capsule(knee, cloth, .093, .19, 0, -.14, 0);
    sphere(knee, pants, .095, 0, -.015, -.012, 1.05, 1, 1.1);
    box(knee, rubber, .212, .14, .34, 0, -.411, -.054, `Boot_${side}`);
    box(knee, steel, .213, .023, .348, 0, -.47, -.054, 'Sole');
    box(knee, cloth, .182, .15, .205, 0, -.309, .012, 'Boot_upper');
    for (let i = 0; i < 3; i++) box(knee, seam, .14, .012, .016, 0, -.337 + i * .032, -.098);
    limbs[`arm${side}`] = arm; limbs[`elbow${side}`] = elbow; limbs[`leg${side}`] = leg; limbs[`knee${side}`] = knee;
  }
  const phone = new THREE.Group(); phone.name = 'Profiler'; phone.position.set(.005, -.327, -.065); phone.rotation.x = -.5;
  box(phone, rubber, .088, .16, .022, 0, 0, 0);
  box(phone, screen, .07, .126, .004, 0, .003, -.013);
  box(phone, rubber, .028, .008, .004, 0, .059, -.016);
  limbs.elbowR.add(phone);
  function setPalette(key) {
    const p = PALETTES[key] || PALETTES.carbon;
    jacket.color.set(p.jacket); bag.color.set(p.bag); trim.color.set(p.trim);
  }
  function animate(time, speed = 0, hacking = false, jumping = false) {
    const walk = Math.min(1, speed / 3.2), stride = Math.sin(time * (speed > 5 ? 12 : 8.5));
    body.position.y = Math.abs(stride) * .028 * walk + Math.sin(time * 1.8) * .006;
    body.rotation.x = speed > 5 ? -.07 : 0;
    body.rotation.z = Math.cos(time * 8.5) * .024 * walk;
    head.rotation.y = !walk ? Math.sin(time * .37) * .13 : 0;
    for (const s of [-1, 1]) {
      const side = s < 0 ? 'L' : 'R';
      limbs[`leg${side}`].rotation.x = stride * s * .53 * walk + (jumping ? -.2 : 0);
      limbs[`knee${side}`].rotation.x = Math.max(0, -stride * s) * .61 * walk + (jumping ? .45 : 0);
      limbs[`arm${side}`].rotation.x = -stride * s * .4 * walk;
      limbs[`elbow${side}`].rotation.x = speed > 5 ? -.55 : -.12;
    }
    if (hacking) { limbs.armR.rotation.x = -1; limbs.elbowR.rotation.x = -.65; limbs.armR.rotation.z = -.16; head.rotation.x = -.07; }
    else { limbs.armR.rotation.z = .11; head.rotation.x = 0; }
  }
  batchParts(root);
  return { root, body, limbs, setPalette, animate, phone };
}

export function buildCivilian(color = '#5b6265') {
  const root = new THREE.Group(), coat = mat(color), dark = mat('#2b343b'), face = mat('#b89475');
  capsule(root, coat, .24, .40, 0, 1.15, 0);
  sphere(root, face, .14, 0, 1.67, 0, 1, 1.15, 1);
  sphere(root, dark, .147, 0, 1.745, .02, 1, .7, 1);
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * .125, .9, 0); root.add(leg);
    capsule(leg, dark, .093, .57, 0, -.36, 0); box(leg, dark, .19, .12, .27, 0, -.8, -.04); legs.push(leg);
    const arm = new THREE.Group(); arm.position.set(s * .25, 1.4, 0); root.add(arm);
    capsule(arm, coat, .08, .37, s * .035, -.26, 0); sphere(arm, face, .065, s * .035, -.53, 0); arms.push(arm);
  }
  batchParts(root);
  return { root, animate(t) { legs.forEach((p, i) => p.rotation.x = Math.sin(t * 5 + i * Math.PI) * .35); arms.forEach((p, i) => p.rotation.x = -Math.sin(t * 5 + i * Math.PI) * .28); } };
}
