// ── Neurio City · on-foot character ────────────────────────────────────────
// A simple articulated person (torso, head, hair, swinging arms and legs).
import * as THREE from 'three';
import { clamp } from '../src/util.js';

export function buildHuman(shirt = '#f97316', pants = '#1e293b') {
  const group = new THREE.Group();
  const mat = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const shirtM = mat(shirt), pantsM = mat(pants), skinM = mat('#e0a77e', 0.6), hairM = mat('#2a1d14', 0.7);
  const box = (w, h, d, y) => new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
  const legGeo = box(0.16, 0.82, 0.18, -0.41);
  const armGeo = box(0.12, 0.62, 0.14, -0.31);
  const part = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; return o; };

  const legL = new THREE.Group(); legL.position.set(-0.1, 0.82, 0); legL.add(part(legGeo, pantsM));
  const legR = new THREE.Group(); legR.position.set(0.1, 0.82, 0); legR.add(part(legGeo, pantsM));
  const armL = new THREE.Group(); armL.position.set(-0.27, 1.45, 0); armL.add(part(armGeo, shirtM));
  const armR = new THREE.Group(); armR.position.set(0.27, 1.45, 0); armR.add(part(armGeo, shirtM));
  group.add(legL, legR, armL, armR,
    part(box(0.42, 0.62, 0.26, 1.16), shirtM),
    part(new THREE.SphereGeometry(0.13, 14, 10).translate(0, 1.66, 0), skinM),
    part(box(0.27, 0.08, 0.27, 1.77), hairM));

  let phase = 0;
  return {
    group, legL, legR, armL, armR,
    /** speed in m/s — drives the gait; 0 = standing still */
    update(dt, speed) {
      phase += dt * (2 + speed * 1.3);
      const amp = clamp(speed / 4.5, 0, 1) * 0.6;
      const sw = Math.sin(phase) * amp;
      legL.rotation.x = sw; legR.rotation.x = -sw;
      armL.rotation.x = -sw * 0.8; armR.rotation.x = sw * 0.8;
    },
  };
}
