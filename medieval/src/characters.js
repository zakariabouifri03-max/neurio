// ── IRONVOW — the flesh and the harness ──────────────────────────────────────
// Every fighter is a jointed rig with human proportions, then dressed layer by
// layer: gambeson, cuir bouilli, riveted mail, plate. Cloth and steel follow the
// bones, so a pauldron rides the shoulder it was strapped to.
//
// Proportions for the 1.78 m reference man (scaled by k = height / 1.78):
//   ankle 0.08 · knee 0.48 · hip socket 0.92 · shoulder 1.46 · eye 1.645 · crown 1.78
import * as THREE from 'three';
import { metalMat, mailMat, leatherMat, clothMat, flatMat } from './tex.js';
import { clamp, _v1, _v2, _v3, _q1, _q2, _m1 } from './mathx.js';
import { BodyState, capsule } from './combat.js';

const MAT = {
  mail: mailMat(),
  iron: metalMat('iron', [1, 1], 0.45),
  steel: metalMat('steel', [1, 1], 0.28),
  black: metalMat('black', [1, 1], 0.4),
  leatherDark: leatherMat('black', [1, 1]),
  leather: leatherMat('brown', [1, 1]),
  wood: flatMat(0x5a4229, 0.9),
  rope: flatMat(0x9c8556, 0.95),
  eyeWhite: flatMat(0xe8e2d6, 0.5),
  eyeDark: flatMat(0x14110e, 0.35),
  tooth: flatMat(0xd8d2c2, 0.5),
};

// ── double-sided variants for open shells (helmets, sleeves, greaves) ───────
// distance from the wrist joint to the centre of the closed fist
const GRIP_OFFSET = 0.05;

const sideCache = new Map();
function ds(m) {
  if (sideCache.has(m.uuid)) return sideCache.get(m.uuid);
  const c = m.clone();
  c.side = THREE.DoubleSide;
  sideCache.set(m.uuid, c);
  return c;
}
const plateCache = new Map();
function plateMat(tint) {
  const key = tint >>> 0;
  if (!plateCache.has(key)) {
    const m = metalMat('steel', [1, 2], 0.22).clone();
    m.color = new THREE.Color(tint);
    plateCache.set(key, m);
  }
  return plateCache.get(key);
}

// ── geometry helpers ────────────────────────────────────────────────────────
function limb(len, r1, r2, mat, opts = {}) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(r2, r1, len, opts.seg || 12, 1, !!opts.open);
  geo.translate(0, -len / 2, 0);
  const mesh = new THREE.Mesh(geo, opts.open ? ds(mat) : mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  if (!opts.noJoint) {
    const j = new THREE.Mesh(new THREE.SphereGeometry(r1 * 1.0, 12, 9), mat);
    j.castShadow = true;
    g.add(j);
  }
  g.userData.len = len;
  return g;
}
function sphereMesh(r, mat, w = 14, h = 10) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, w, h), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function shell(r, mat, opts = {}) {
  const { phiStart = 0, phiLength = Math.PI, thetaStart = 0.4, thetaLength = 1.6, sy = 1 } = opts;
  const geo = opts.cyl
    ? new THREE.CylinderGeometry(r, r * (opts.taper ?? 1), opts.h ?? r, 18, 1, true, phiStart, phiLength)
    : new THREE.SphereGeometry(r, 20, 14, phiStart, phiLength, thetaStart, thetaLength);
  const m = new THREE.Mesh(geo, ds(mat));
  m.scale.y = sy;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function boxMesh(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function tube(r1, r2, h, mat, thetaStart, thetaLength) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, h, 16, 1, true, thetaStart, thetaLength), ds(mat));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function ring(r, t, mat) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 6, 20), mat);
  m.castShadow = true;
  return m;
}

// ════════════════════════════════════════════════════════════════════════════
//  RIG
// ════════════════════════════════════════════════════════════════════════════
export class Rig {
  constructor(cfg = {}) {
    this.cfg = cfg;
    const k = (cfg.height || 1.78) / 1.78;
    const build = cfg.build ?? 1;
    this.scale = k;
    this.k = k;
    this.height = cfg.height || 1.78;
    this.build = build;
    this.bones = {};

    // ── proportions ──
    const D = this.dims = {
      k, build,
      hipsY: 0.95 * k,
      spineY: 0.10 * k,
      chestY: 0.16 * k,
      clavY: 0.25 * k,
      neckY: 0.22 * k,
      headY: 0.13 * k,
      shoulderX: 0.185 * k * build,
      hipX: 0.095 * k * build,
      upperArmL: 0.30 * k,
      foreArmL: 0.27 * k,
      thighL: 0.44 * k,
      shinL: 0.40 * k,
      eyeY: 0.085 * k,
    };

    this.root = new THREE.Group();
    this.root.name = 'fighter';

    const hips = new THREE.Group(); hips.position.y = D.hipsY; this.root.add(hips);
    const spine = new THREE.Group(); spine.position.y = D.spineY; hips.add(spine);
    const chest = new THREE.Group(); chest.position.y = D.chestY; spine.add(chest);
    const neck = new THREE.Group(); neck.position.y = D.neckY; chest.add(neck);
    const head = new THREE.Group(); head.position.y = D.headY; neck.add(head);
    Object.assign(this.bones, { hips, spine, chest, neck, head });

    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      // arms
      const clav = new THREE.Group();
      clav.position.set(sx * D.shoulderX * 0.5, D.clavY, 0);
      chest.add(clav);
      const arm = new THREE.Group();
      arm.position.set(sx * D.shoulderX * 0.5, 0, 0);
      clav.add(arm);
      const armMesh = limb(D.upperArmL, 0.055 * build, 0.045 * build, MAT.mail);
      arm.add(armMesh);
      const elbow = new THREE.Group(); elbow.position.y = -D.upperArmL; arm.add(elbow);
      const foreMesh = limb(D.foreArmL, 0.043 * build, 0.032 * build, MAT.mail);
      elbow.add(foreMesh);
      const wrist = new THREE.Group(); wrist.position.y = -D.foreArmL; elbow.add(wrist);
      Object.assign(this.bones, {
        ['clav' + s]: clav, ['arm' + s]: arm, ['elbow' + s]: elbow, ['wrist' + s]: wrist,
        ['upperArmMesh' + s]: armMesh, ['foreArmMesh' + s]: foreMesh,
      });
      // legs
      const hipJoint = new THREE.Group();
      hipJoint.position.set(sx * D.hipX, -0.03 * k, 0);
      hips.add(hipJoint);
      const thighMesh = limb(D.thighL, 0.078 * build, 0.06 * build, MAT.leatherDark);
      hipJoint.add(thighMesh);
      const knee = new THREE.Group(); knee.position.y = -D.thighL; hipJoint.add(knee);
      const shinMesh = limb(D.shinL, 0.058 * build, 0.038 * build, MAT.leatherDark);
      knee.add(shinMesh);
      const ankle = new THREE.Group(); ankle.position.y = -D.shinL; knee.add(ankle);
      Object.assign(this.bones, {
        ['hip' + s]: hipJoint, ['knee' + s]: knee, ['ankle' + s]: ankle,
        ['thighMesh' + s]: thighMesh, ['shinMesh' + s]: shinMesh,
      });
    }

    this.buildBody(cfg, k, build);
    this.body = new BodyState(cfg.harness || { id: 'gambeson', layers: { gambeson: 1 }, gaps: {} });
    this.addWeakPoints();

    // A weapon attaches at `grip[side]` (a child of the wrist) and shares the
    // hand's orientation: +Y runs from pommel to tip through the closed fist.
    // GRIP_OFFSET is how far past the wrist joint that fist centre sits.
    this.grip = {};
    for (const s of ['L', 'R']) {
      const g = new THREE.Group();
      g.position.y = GRIP_OFFSET * k;
      this.bones['wrist' + s].add(g);
      this.grip[s] = g;
    }

    this.volumes = [];
    this.armourPieces = [];
    this.setHarness(cfg.harness || { id: 'gambeson', layers: { gambeson: 1 }, gaps: {} }, true);
  }

  // ── body meshes ───────────────────────────────────────────────────────────
  buildBody(cfg, k, build) {
    const skin = flatMat(cfg.skin ?? 0xd0a882, 0.72);
    const cloth = clothMat(cfg.cloth || [86, 70, 48], [1, 2]);
    const hairM = flatMat(cfg.hair ?? 0x3a2a1a, 0.85);
    const { hips, chest, head } = this.bones;
    this.skinMat = skin;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.152 * build, 0.26 * k, 8, 18), cloth);
    torso.scale.set(1.06, 1, 0.80);
    torso.position.y = 0.03 * k;
    torso.castShadow = true; torso.receiveShadow = true;
    chest.add(torso);
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.135 * build, 0.10 * k, 8, 16), cloth);
    pelvis.scale.set(1.04, 1, 0.86);
    pelvis.castShadow = true; pelvis.receiveShadow = true;
    hips.add(pelvis);
    const skirt = tube(0.155 * build, 0.185 * build, 0.24 * k, cloth, 0, Math.PI * 2);
    skirt.position.y = -0.14 * k;
    hips.add(skirt);

    // ── head ──
    const headG = new THREE.Group();
    head.add(headG);
    this.headG = headG;
    const skull = sphereMesh(0.096 * k, skin, 20, 16);
    skull.scale.set(0.92, 1.05, 1.0);
    skull.position.y = 0.088 * k;
    headG.add(skull);
    const face = sphereMesh(0.082 * k, skin, 16, 12);
    face.position.set(0, 0.05 * k, 0.022 * k);
    face.scale.set(0.86, 1.0, 0.9);
    headG.add(face);
    const jaw = boxMesh(0.112 * k, 0.058 * k, 0.095 * k, skin);
    jaw.position.set(0, 0.012 * k, 0.018 * k);
    headG.add(jaw);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016 * k, 0.04 * k, 6), skin);
    nose.rotation.x = Math.PI / 2.1;
    nose.position.set(0, 0.078 * k, 0.09 * k);
    headG.add(nose);
    const brow = boxMesh(0.122 * k, 0.014 * k, 0.028 * k, skin);
    brow.position.set(0, 0.113 * k, 0.072 * k);
    headG.add(brow);
    for (const s of [-1, 1]) {
      const eye = sphereMesh(0.015 * k, MAT.eyeWhite, 8, 6);
      eye.position.set(s * 0.031 * k, 0.098 * k, 0.072 * k);
      eye.scale.set(1, 0.8, 0.55);
      headG.add(eye);
      const pupil = sphereMesh(0.0075 * k, MAT.eyeDark, 6, 5);
      pupil.position.set(s * 0.032 * k, 0.097 * k, 0.081 * k);
      headG.add(pupil);
      const ear = boxMesh(0.011 * k, 0.030 * k, 0.021 * k, skin);
      ear.position.set(s * 0.09 * k, 0.085 * k, -0.004 * k);
      headG.add(ear);
      const cheek = sphereMesh(0.025 * k, skin, 8, 6);
      cheek.position.set(s * 0.05 * k, 0.055 * k, 0.05 * k);
      cheek.scale.set(1, 0.9, 0.8);
      headG.add(cheek);
    }

    // hair
    const style = cfg.hairStyle || 'crop';
    if (style === 'crop' || style === 'shaved') {
      const cap = shell(0.099 * k, style === 'shaved' ? flatMat(0x6a5c4a, 0.92) : hairM,
        { phiLength: Math.PI * 2, thetaStart: 0, thetaLength: style === 'shaved' ? 1.05 : 1.18 });
      cap.position.y = 0.09 * k;
      cap.scale.set(0.95, 1.05, 1.02);
      headG.add(cap);
    } else if (style === 'mane' || style === 'ponytail') {
      const cap = shell(0.101 * k, hairM, { phiLength: Math.PI * 2, thetaStart: 0, thetaLength: 1.38 });
      cap.position.y = 0.09 * k;
      cap.scale.set(0.97, 1.04, 1.04);
      headG.add(cap);
      const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.034 * k, 0.10 * k, 5, 9), hairM);
      back.position.set(0, 0.055 * k, -0.088 * k);
      back.castShadow = true;
      headG.add(back);
      if (style === 'ponytail') {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.019 * k, 0.22 * k, 5, 9), hairM);
        tail.position.set(0, -0.03 * k, -0.105 * k);
        tail.rotation.x = -0.28;
        tail.castShadow = true;
        headG.add(tail);
      }
    } else if (style === 'braid') {
      const cap = shell(0.1 * k, hairM, { phiLength: Math.PI * 2, thetaStart: 0, thetaLength: 1.25 });
      cap.position.y = 0.09 * k;
      headG.add(cap);
      for (let i = 0; i < 4; i++) {
        const seg = sphereMesh(0.024 * k, hairM, 8, 6);
        seg.position.set(0, (0.03 - i * 0.042) * k, -0.082 * k);
        seg.scale.set(1, 0.78, 1);
        headG.add(seg);
      }
    }
    // beard
    const beard = cfg.beard || 0;
    if (beard > 0) {
      const b = boxMesh(0.098 * k, (0.026 + beard * 0.010) * k, 0.058 * k, hairM);
      b.position.set(0, (0.012 - beard * 0.004) * k, 0.05 * k);
      headG.add(b);
      if (beard >= 2) {
        const m = boxMesh(0.072 * k, 0.02 * k, 0.014 * k, hairM);
        m.position.set(0, 0.072 * k, 0.086 * k);
        headG.add(m);
      }
      if (beard >= 3) {
        const b2 = boxMesh(0.08 * k, 0.05 * k, 0.046 * k, hairM);
        b2.position.set(0, -0.028 * k, 0.056 * k);
        headG.add(b2);
      }
    }

    // ── hands: a closed fist built around the grip axis (+Y) ──
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      const hand = new THREE.Group();
      hand.position.y = GRIP_OFFSET * k;
      this.bones['wrist' + s].add(hand);
      const palm = boxMesh(0.032 * k, 0.086 * k, 0.046 * k, skin);
      palm.position.set(0, 0, -0.014 * k);
      hand.add(palm);
      // heel of the hand, where the pommel sits
      const heel = boxMesh(0.034 * k, 0.03 * k, 0.05 * k, skin);
      heel.position.set(0, -0.05 * k, -0.006 * k);
      hand.add(heel);
      // four fingers curled around the grip
      for (let i = 0; i < 4; i++) {
        const y = (-0.026 + i * 0.019) * k;
        const f = boxMesh(0.028 * k, 0.017 * k, 0.042 * k, skin);
        f.position.set(sx * 0.002 * k, y, 0.016 * k);
        hand.add(f);
        const knuckle = boxMesh(0.026 * k, 0.016 * k, 0.02 * k, skin);
        knuckle.position.set(sx * 0.002 * k, y, 0.036 * k);
        hand.add(knuckle);
      }
      const thumb = boxMesh(0.022 * k, 0.03 * k, 0.052 * k, skin);
      thumb.position.set(sx * 0.018 * k, 0.014 * k, 0.012 * k);
      thumb.rotation.x = -0.2;
      thumb.rotation.z = sx * 0.3;
      hand.add(thumb);
      this.bones['handMesh' + s] = hand;
    }

    // ── feet ──
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      const foot = new THREE.Group();
      this.bones['ankle' + s].add(foot);
      const boot = boxMesh(0.084 * build, 0.072 * k, 0.19 * k, MAT.leatherDark);
      boot.position.set(0, -0.048 * k, 0.048 * k);
      foot.add(boot);
      const toe = sphereMesh(0.040 * k, MAT.leatherDark, 10, 8);
      toe.position.set(0, -0.058 * k, 0.14 * k);
      toe.scale.set(1.02, 0.75, 1.1);
      foot.add(toe);
      const heel = boxMesh(0.058 * build, 0.05 * k, 0.05 * k, MAT.leatherDark);
      heel.position.set(0, -0.055 * k, -0.038 * k);
      foot.add(heel);
      this.bones['footMesh' + s] = foot;
    }
  }

  // ── armour ────────────────────────────────────────────────────────────────
  setHarness(h, force = false) {
    if (!force && this._harnessId === h.id) return;
    this._harnessId = h.id;
    this.clearArmour();
    const L = h.layers || {};
    const k = this.k, build = this.build;
    // plate tint: brighten the authored colour toward steel
    const base = h.color || [120, 124, 130];
    const tint = new THREE.Color(
      clamp(base[0] / 255 * 0.55 + 0.42, 0, 1),
      clamp(base[1] / 255 * 0.55 + 0.43, 0, 1),
      clamp(base[2] / 255 * 0.55 + 0.45, 0, 1),
    ).getHex();
    const pm = plateMat(tint);
    const quilt = clothMat(h.color
      ? [clamp(h.color[0] * 0.42 + 46, 0, 255) | 0, clamp(h.color[1] * 0.42 + 40, 0, 255) | 0, clamp(h.color[2] * 0.42 + 34, 0, 255) | 0]
      : [108, 92, 62], [1, 3]);
    const lm = leatherMat('brown', [1, 2]);
    const { hips, chest, head } = this.bones;
    const pieces = [];
    const put = (obj, parent) => { obj.userData.armour = true; parent.add(obj); pieces.push(obj); return obj; };

    // ── gambeson: quilted coat with visible seams + belt ──
    if ((L.gambeson || 0) > 0.3) {
      const coat = new THREE.Mesh(new THREE.CapsuleGeometry(0.172 * build, 0.26 * k, 8, 18), quilt);
      coat.scale.set(1.06, 1, 0.84);
      coat.position.y = 0.03 * k;
      coat.castShadow = true;
      put(coat, chest);
      const sk = tube(0.19 * build, 0.215 * build, 0.26 * k, quilt, 0, Math.PI * 2);
      sk.position.y = -0.16 * k;
      put(sk, hips);
      // quilting: horizontal seam rings pick up the light and read as padding
      for (let i = 0; i < 5; i++) {
        const seam = ring(0.185 * build, 0.006 * k, quilt);
        seam.rotation.x = Math.PI / 2;
        seam.position.y = (0.20 - i * 0.075) * k;
        seam.scale.set(1.02, 0.84, 1);
        put(seam, chest);
      }
      for (const s of ['L', 'R']) {
        const sleeve = tube(0.062 * k, 0.05 * k, 0.44 * k, quilt, 0, Math.PI * 2);
        sleeve.position.y = -0.21 * k;
        put(sleeve, this.bones['arm' + s]);
        const hose = tube(0.088 * build, 0.068 * build, 0.46 * k, quilt, 0, Math.PI * 2);
        hose.position.y = -0.23 * k;
        put(hose, this.bones['hip' + s]);
      }
      const belt = ring(0.178 * build, 0.022 * k, MAT.leatherDark);
      belt.rotation.x = Math.PI / 2;
      belt.scale.set(1, 0.86, 1);
      belt.position.y = 0.005 * k;
      put(belt, hips);
      const buckle = boxMesh(0.036 * k, 0.03 * k, 0.012 * k, MAT.iron);
      buckle.position.set(0, 0.005 * k, 0.158 * build);
      put(buckle, hips);
    }

    // ── leather: cuir bouilli over the vitals + joint caps ──
    if ((L.leather || 0) > 0.35) {
      const cuir = tube(0.196 * build, 0.205 * build, 0.34 * k, lm, -0.95, 1.9);
      cuir.position.y = 0.03 * k;
      cuir.rotation.y = Math.PI;
      put(cuir, chest);
      const backP = tube(0.196 * build, 0.205 * build, 0.34 * k, lm, Math.PI - 0.95, 1.9);
      backP.position.y = 0.03 * k;
      backP.rotation.y = Math.PI;
      put(backP, chest);
      for (const s of ['L', 'R']) {
        const sp = shell(0.088 * k, lm, { phiLength: Math.PI * 2, thetaStart: 0.85, thetaLength: 1.05 });
        sp.position.y = -0.005 * k;
        put(sp, this.bones['arm' + s]);
        const cap = shell(0.072 * k, lm, { phiStart: -0.9, phiLength: 1.8, thetaStart: 0.7, thetaLength: 1.2 });
        put(cap, this.bones['knee' + s]);
        const elbowCap = shell(0.06 * k, lm, { phiStart: -0.8, phiLength: 1.6, thetaStart: 0.8, thetaLength: 1.1 });
        put(elbowCap, this.bones['elbow' + s]);
      }
      // cross straps
      for (const s of [-1, 1]) {
        const strap = boxMesh(0.03 * k, 0.30 * k, 0.012 * k, MAT.leatherDark);
        strap.position.set(s * 0.06 * k, 0.02 * k, 0.163 * build);
        strap.rotation.z = s * 0.42;
        put(strap, chest);
      }
    }

    // ── mail ──
    if ((L.mail || 0) > 0.3) {
      const hauberk = new THREE.Mesh(new THREE.CapsuleGeometry(0.182 * build, 0.28 * k, 8, 18), MAT.mail);
      hauberk.scale.set(1.05, 1, 0.84);
      hauberk.position.y = 0.02 * k;
      hauberk.castShadow = true;
      put(hauberk, chest);
      const sk = tube(0.195 * build, 0.225 * build, 0.34 * k, MAT.mail, 0, Math.PI * 2);
      sk.position.y = -0.20 * k;
      put(sk, hips);
      for (const s of ['L', 'R']) {
        const sleeve = tube(0.062 * k, 0.048 * k, 0.46 * k, MAT.mail, 0, Math.PI * 2);
        sleeve.position.y = -0.22 * k;
        put(sleeve, this.bones['arm' + s]);
        const hose = tube(0.084 * build, 0.064 * build, 0.46 * k, MAT.mail, 0, Math.PI * 2);
        hose.position.y = -0.23 * k;
        put(hose, this.bones['hip' + s]);
        const mitt = sphereMesh(0.05 * k, MAT.mail, 12, 9);
        mitt.position.y = -0.04 * k;
        put(mitt.clone(), this.bones['handMesh' + s]);
      }
      const coif = shell(0.106 * k, MAT.mail, { phiLength: Math.PI * 2, thetaStart: 0, thetaLength: 1.5 });
      coif.position.y = 0.086 * k;
      coif.scale.set(1.0, 1.05, 1.02);
      put(coif, this.headG);
      const mantle = tube(0.09 * k, 0.14 * k, 0.17 * k, MAT.mail, 0, Math.PI * 2);
      mantle.position.y = -0.05 * k;
      put(mantle, head);
      // a short aventail hanging off the shoulders
      const av = tube(0.115 * k, 0.15 * k, 0.13 * k, MAT.mail, 0, Math.PI * 2);
      av.position.y = -0.02 * k;
      put(av, this.bones.head);
    }

    // ── plate ──
    if ((L.plate || 0) > 0.35) {
      const full = L.plate > 0.5;
      const breast = shell(0.188 * build, pm, { phiStart: -1.0, phiLength: 2.0, thetaStart: 0.62, thetaLength: 1.3, sy: 1.12 });
      breast.position.y = 0.045 * k;
      breast.scale.set(1.03, 1.12, 0.9);
      put(breast, chest);
      const backP = shell(0.188 * build, pm, { phiStart: Math.PI - 1.0, phiLength: 2.0, thetaStart: 0.62, thetaLength: 1.3, sy: 1.12 });
      backP.position.y = 0.045 * k;
      backP.scale.set(1.03, 1.12, 0.9);
      put(backP, chest);
      // fauld (skirt plates) + tassets
      const fauld = tube(0.205 * build, 0.225 * build, 0.16 * k, pm, -1.05, 2.1);
      fauld.position.y = -0.13 * k;
      put(fauld, hips);
      for (const s of [-1, 1]) {
        const tas = boxMesh(0.085 * k, 0.10 * k, 0.02 * k, pm);
        tas.position.set(s * 0.10 * k, -0.15 * k, 0.145 * build);
        tas.rotation.z = s * 0.15;
        put(tas, hips);
      }
      for (const s of ['L', 'R']) {
        const sx = s === 'L' ? 1 : -1;
        // pauldron with lames
        const pauld = shell(0.1 * k, pm, { phiLength: Math.PI * 2, thetaStart: 0.72, thetaLength: 1.28 });
        pauld.position.y = 0.0;
        pauld.scale.set(1.06, 0.94, 1.0);
        put(pauld, this.bones['arm' + s]);
        const lame = tube(0.088 * k, 0.084 * k, 0.05 * k, pm, -1.3, 2.6);
        lame.position.y = -0.075 * k;
        put(lame, this.bones['arm' + s]);
        // rerebrace + couter + vambrace + gauntlet
        const rebrace = tube(0.056 * k, 0.05 * k, 0.19 * k, pm, -1.25, 2.5);
        rebrace.position.y = -0.14 * k;
        put(rebrace, this.bones['arm' + s]);
        const couter = shell(0.062 * k, pm, { phiStart: -1.25, phiLength: 2.5, thetaStart: 0.72, thetaLength: 1.2 });
        put(couter, this.bones['elbow' + s]);
        const vambrace = tube(0.05 * k, 0.043 * k, 0.21 * k, pm, -1.35, 2.7);
        vambrace.position.y = -0.13 * k;
        put(vambrace, this.bones['elbow' + s]);
        const gaunt = boxMesh(0.05 * k, 0.05 * k, 0.068 * k, pm);
        gaunt.position.y = -0.035 * k;
        put(gaunt, this.bones['handMesh' + s]);
        // gorget
        if (full) {
          const gorget = tube(0.078 * k, 0.086 * k, 0.06 * k, pm, 0, Math.PI * 2);
          gorget.position.y = -0.01 * k;
          put(gorget, this.bones.chest);
        }
        if (full) {
          const cuisse = tube(0.085 * build, 0.072 * build, 0.28 * k, pm, -1.15, 2.3);
          cuisse.position.y = -0.18 * k;
          put(cuisse, this.bones['hip' + s]);
          const poleyn = shell(0.076 * k, pm, { phiStart: -1.15, phiLength: 2.3, thetaStart: 0.72, thetaLength: 1.2 });
          put(poleyn, this.bones['knee' + s]);
          const greave = tube(0.062 * k, 0.05 * k, 0.27 * k, pm, -1.35, 2.7);
          greave.position.y = -0.16 * k;
          put(greave, this.bones['knee' + s]);
          const sab = boxMesh(0.048 * k, 0.02 * k, 0.115 * k, pm);
          sab.position.set(0, -0.07 * k, 0.042 * k);
          put(sab, this.bones['ankle' + s]);
        }
      }
      this.addHelmet(full ? 'closed' : 'open', pm);
    } else if ((L.mail || 0) > 0.3) {
      this.addHelmet('coif', pm);
    } else if ((L.leather || 0) > 0.6) {
      this.addHelmet('kettle', pm);
    }

    if (this.cfg.hollow) {
      for (let i = 0; i < 2; i++) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.024 * k, 0.008 * k, 0.012 * k),
          new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
        eye.position.set((i ? 1 : -1) * 0.027 * k, 0.09 * k, 0.1 * k);
        this.headG.add(eye);
        this.armourPieces.push(eye);
      }
    }
  }

  addHelmet(kind, pm) {
    const k = this.k;
    const headG = this.headG;
    if (this._helm) { this._helm.removeFromParent(); this._helm = null; }
    const g = new THREE.Group();
    if (kind === 'closed') {
      const dome = shell(0.107 * k, pm, { phiLength: Math.PI * 2, thetaStart: 0, thetaLength: 1.5 });
      dome.position.y = 0.09 * k;
      dome.scale.set(0.96, 1.08, 1.04);
      g.add(dome);
      const visor = boxMesh(0.122 * k, 0.08 * k, 0.09 * k, pm);
      visor.position.set(0, 0.082 * k, 0.07 * k);
      visor.rotation.x = 0.1;
      g.add(visor);
      const slit = boxMesh(0.1 * k, 0.009 * k, 0.014 * k, MAT.eyeDark);
      slit.position.set(0, 0.094 * k, 0.115 * k);
      g.add(slit);
      for (let i = 0; i < 5; i++) {
        const br = boxMesh(0.006 * k, 0.028 * k, 0.008 * k, MAT.eyeDark);
        br.position.set((i - 2) * 0.018 * k, 0.052 * k, 0.118 * k);
        br.rotation.z = 0.5;
        g.add(br);
      }
      const bev = boxMesh(0.068 * k, 0.05 * k, 0.07 * k, pm);
      bev.position.set(0, 0.03 * k, 0.05 * k);
      g.add(bev);
      const crest = boxMesh(0.012 * k, 0.05 * k, 0.19 * k, pm);
      crest.position.set(0, 0.145 * k, -0.01 * k);
      g.add(crest);
    } else if (kind === 'open') {
      const dome = shell(0.105 * k, pm, { phiLength: Math.PI * 2, thetaStart: 0, thetaLength: 1.5 });
      dome.position.y = 0.09 * k;
      dome.scale.set(0.96, 1.06, 1.02);
      g.add(dome);
      const brim = ring(0.106 * k, 0.011 * k, pm);
      brim.rotation.x = Math.PI / 2 - 0.12;
      brim.position.y = 0.052 * k;
      brim.scale.set(1, 1.14, 1);
      g.add(brim);
      const nasal = boxMesh(0.022 * k, 0.07 * k, 0.014 * k, pm);
      nasal.position.set(0, 0.062 * k, 0.092 * k);
      g.add(nasal);
    } else if (kind === 'kettle') {
      const dome = shell(0.104 * k, pm, { phiLength: Math.PI * 2, thetaStart: 0, thetaLength: 1.2 });
      dome.position.y = 0.08 * k;
      g.add(dome);
      const brim = new THREE.Mesh(new THREE.ConeGeometry(0.16 * k, 0.05 * k, 20, 1, true), ds(pm));
      brim.position.y = 0.048 * k;
      brim.rotation.x = Math.PI;
      brim.scale.set(1, 1, 1.1);
      g.add(brim);
      const band = ring(0.105 * k, 0.009 * k, MAT.iron);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.052 * k;
      g.add(band);
    } else if (kind === 'coif') {
      const c = shell(0.107 * k, MAT.mail, { phiLength: Math.PI * 2, thetaStart: 0, thetaLength: 1.45 });
      c.position.y = 0.088 * k;
      c.scale.set(1.0, 1.06, 1.02);
      g.add(c);
      const d = boxMesh(0.048 * k, 0.06 * k, 0.012 * k, MAT.mail);
      d.position.set(0, 0.005 * k, 0.088 * k);
      g.add(d);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.armour = true; } });
    headG.add(g);
    this._helm = g;
    this.armourPieces.push(g);
  }

  clearArmour() {
    for (const p of this.armourPieces) p.removeFromParent();
    this.armourPieces.length = 0;
    if (this._helm) { this._helm.removeFromParent(); this._helm = null; }
  }

  addWeakPoints() {
    const k = this.k;
    const G = (region, anchor, x, y, z, r, label) => {
      this.body.addGap(region, new THREE.Vector3(x * k, y * k, z * k), r * k, label);
      this._gapAnchors.push(anchor);
    };
    this._gapAnchors = [];
    // offsets are in the anchor bone's local frame at rest (no rest rotations)
    G('throat', 'neck', 0, -0.01, 0.062, 0.05, 'the throat');
    G('head', 'head', 0, 0.098, 0.09, 0.03, 'the visor slit');
    G('head', 'head', 0, 0.006, 0.028, 0.036, 'under the chin');
    G('chest', 'chest', 0.165, 0.20, 0.005, 0.055, 'the armpit');
    G('chest', 'chest', -0.165, 0.20, 0.005, 0.055, 'the armpit');
    G('abdomen', 'hips', 0, -0.105, 0.055, 0.055, 'the groin');
    G('foreArm', 'elbowR', -0.032, -0.20, 0, 0.05, 'the inside of the wrist');
    G('shin', 'kneeR', -0.045, -0.055, 0.05, 0.055, 'behind the knee');
    this._gapWorld = this.body.gaps.map(() => new THREE.Vector3());
    this._gapOffsets = this.body.gaps.map((g) => g.local.clone());
  }

  /** Weak points, transformed by the bone they were authored against. */
  updateGaps() {
    for (let i = 0; i < this.body.gaps.length; i++) {
      const anchor = this.bones[this._gapAnchors[i]] || this.bones.chest;
      this._gapWorld[i].copy(this._gapOffsets[i]).applyMatrix4(anchor.matrixWorld);
    }
  }
  gapPoints() { return this.body.gaps; }
  gapWorld() { return this._gapWorld; }

  // ── hit volumes ───────────────────────────────────────────────────────────
  updateVolumes() {
    this.root.updateWorldMatrix(true, false);
    const V = this.volumes;
    V.length = 0;
    const b = this.bones, k = this.k, build = this.build;
    const P = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const chestP = P(b.chest), hipsP = P(b.hips), headP = P(b.head), neckP = P(b.neck);
    const push = (region, a, bp, r) => V.push(capsule(region, a, bp, r, this));
    push('chest', chestP.clone().setY(chestP.y + 0.19 * k), chestP.clone().setY(chestP.y - 0.05 * k), (0.215 * build + 0.03) * k);
    push('abdomen', hipsP.clone().setY(hipsP.y + 0.10 * k), hipsP.clone().setY(hipsP.y - 0.12 * k), (0.175 * build + 0.03) * k);
    push('head', headP.clone().add(new THREE.Vector3(0, 0.145 * k, 0)), headP.clone().add(new THREE.Vector3(0, 0.02 * k, 0)), 0.128 * k + 0.01);
    push('throat', neckP.clone().add(new THREE.Vector3(0, -0.03 * k, 0)), neckP.clone().add(new THREE.Vector3(0, 0.05 * k, 0)), 0.085 * k + 0.012);
    for (const s of ['L', 'R']) {
      push('upperArm', P(b['arm' + s]), P(b['elbow' + s]), 0.072 * k + 0.012 * build);
      push('foreArm', P(b['elbow' + s]), P(b['wrist' + s]), 0.060 * k + 0.012 * build);
      const w = P(b['wrist' + s]);
      push('hand', w.clone().setY(w.y - 0.02 * k), w.clone().setY(w.y - 0.09 * k), 0.078 * k + 0.012);
      push('thigh', P(b['hip' + s]), P(b['knee' + s]), 0.098 * k + 0.02 * build);
      push('shin', P(b['knee' + s]), P(b['ankle' + s]), 0.086 * k + 0.02 * build);
      const a = P(b['ankle' + s]);
      push('foot', a, a.clone().setZ(a.z + 0.12 * k), 0.084 * k + 0.015);
    }
    this.updateGaps();
    return V;
  }

  setFirstPerson(on) {
    this.headG.visible = !on;
    if (this._helm) this._helm.visible = !on;
    this.firstPerson = on;
  }

  // ── analytic two-bone IK ──────────────────────────────────────────────────
  /**
   * Place a fist at a world position; the elbow is pushed toward `pole`.
   * Returns the solved elbow position.
   */
  solveArm(side, target, pole, handQuat) {
    const b = this.bones;
    const arm = b['arm' + side], elbow = b['elbow' + side], wrist = b['wrist' + side];
    const L1 = this.dims.upperArmL, L2 = this.dims.foreArmL;
    // World matrices must be current before we read the shoulder out of one:
    // stale parents are how a swing ends up pointing somewhere the animation
    // never asked for (and reporting speeds that never happened).
    this.root.updateWorldMatrix(true, true);
    // the target is the fist centre; the wrist joint sits GRIP_OFFSET behind it
    const wristTarget = new THREE.Vector3().copy(target);
    if (handQuat) wristTarget.addScaledVector(_v2.set(0, 1, 0).applyQuaternion(handQuat), -GRIP_OFFSET * this.k);
    const S = new THREE.Vector3().setFromMatrixPosition(arm.matrixWorld);
    const d = wristTarget.clone().sub(S);
    let dist = d.length();
    if (dist < 1e-4) return S.clone();
    dist = clamp(dist, Math.abs(L1 - L2) + 0.005, L1 + L2 - 0.004);
    d.normalize();
    const axis = new THREE.Vector3().crossVectors(d, pole);
    if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1).cross(d);
    axis.normalize();
    const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const upperDir = d.clone().applyQuaternion(_q1.setFromAxisAngle(axis, Math.acos(cosA))).normalize();
    const elbowPos = S.clone().addScaledVector(upperDir, L1);
    const foreDir = wristTarget.clone().sub(elbowPos).normalize();
    this._orientBone(arm, upperDir);
    arm.updateWorldMatrix(false, true);
    this._orientBone(elbow, foreDir);
    elbow.updateWorldMatrix(false, true);
    // the wrist carries the fist (and the weapon) in the caller's orientation
    if (handQuat) {
      const pq = _q2.setFromRotationMatrix(_m1.copy(elbow.matrixWorld).extractRotation(_m1)).invert();
      wrist.quaternion.copy(pq).multiply(handQuat);
      wrist.updateWorldMatrix(false, false);
    }
    return elbowPos;
  }

  /** Place an ankle at a world position (footwork). */
  solveLeg(side, target, pole) {
    const b = this.bones;
    const hip = b['hip' + side], knee = b['knee' + side], ankle = b['ankle' + side];
    const L1 = this.dims.thighL, L2 = this.dims.shinL;
    this.root.updateWorldMatrix(true, true);
    const H = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
    const d = target.clone().sub(H);
    let dist = d.length();
    if (dist < 1e-4) return null;
    dist = clamp(dist, Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.006);
    d.normalize();
    const axis = new THREE.Vector3().crossVectors(d, pole);
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0).cross(d).normalize();
    else axis.normalize();
    const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const thighDir = d.clone().applyQuaternion(_q1.setFromAxisAngle(axis, -Math.acos(cosA))).normalize();
    const kneePos = H.clone().addScaledVector(thighDir, L1);
    const shinDir = H.clone().addScaledVector(d, dist).sub(kneePos).normalize();
    this._orientBone(hip, thighDir);
    hip.updateWorldMatrix(false, true);
    this._orientBone(knee, shinDir);
    knee.updateWorldMatrix(false, true);
    return kneePos;
  }

  _orientBone(bone, worldDir) {
    const pq = bone.parent.getWorldQuaternion(_q2);
    const local = worldDir.clone().applyQuaternion(_q2.copy(pq).invert());
    bone.quaternion.setFromUnitVectors(_v1.set(0, -1, 0), local.normalize());
  }
}

export { MAT as rigMaterials };
