import * as THREE from 'three';
import { G, tier } from './state.js';
import { Rand, clamp } from './util.js';
import { mat } from './tex.js';

// ══════════════════════════════════════════════════════════════
//  CHARACTER — a low-poly soldier built from boxes, with a real
//  walk/run cycle, aiming arm, parachute and death ragdoll pose.
//  ~9 meshes each; on tier 0 shadows + segments are cut hard.
// ══════════════════════════════════════════════════════════════

const SKIN = [0xc99b6f, 0xa9764c, 0x8a5a37, 0xe0b48c, 0x6f4a2c];
const SUIT = [0x4a5c34, 0x5c4a34, 0x38444f, 0x4f3838, 0x2f3d2f, 0x6b5a3c, 0x3a3f4a, 0x54463a];
const TEAMC = [0xd94a3d, 0x3d8fd9, 0xd9a53d, 0x7a3dd9, 0x3dd98a, 0xd93d9a];

export function makeCharacter(opts = {}) {
  const rnd = new Rand(opts.seed === undefined ? Math.floor(Math.random() * 1e9) : opts.seed);
  const sh = tier().shadows;
  const skinC = opts.skin !== undefined ? opts.skin : rnd.pick(SKIN);
  const suitC = opts.suit !== undefined ? opts.suit : rnd.pick(SUIT);
  const teamC = opts.team !== undefined ? opts.team : rnd.pick(TEAMC);

  const skinM = new THREE.MeshStandardMaterial({ color: skinC, roughness: .82 });
  const suitM = new THREE.MeshStandardMaterial({ color: suitC, roughness: .95, map: G.tier > 0 ? mat('camo').map : null });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: .7, metalness: .3 });
  const teamM = new THREE.MeshStandardMaterial({ color: teamC, roughness: .6, emissive: teamC, emissiveIntensity: .25 });

  const root = new THREE.Group();
  const body = new THREE.Group();      // everything that bobs
  root.add(body);

  const B = (w, h, d, m, x, y, z, parent = body) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = sh;
    parent.add(mesh);
    return mesh;
  };

  // ── legs (pivot at hip so they can swing) ──
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.14, 0.86, 0); legR.position.set(0.14, 0.86, 0);
  body.add(legL, legR);
  const mkLeg = (g) => {
    B(0.21, 0.5, 0.24, suitM, 0, -0.26, 0, g);
    B(0.2, 0.4, 0.22, darkM, 0, -0.66, 0.02, g);
    B(0.22, 0.13, 0.33, darkM, 0, -0.86, 0.05, g);
  };
  mkLeg(legL); mkLeg(legR);

  // ── torso ──
  const torso = B(0.54, 0.66, 0.32, suitM, 0, 1.2, 0);
  B(0.5, 0.2, 0.3, darkM, 0, 0.94, 0);                 // belt
  B(0.42, 0.3, 0.1, teamM, 0, 1.3, -0.2);              // backpack / team stripe
  B(0.5, 0.24, 0.36, darkM, 0, 1.44, 0);               // vest
  // ── head ──
  const headG = new THREE.Group(); headG.position.set(0, 1.62, 0); body.add(headG);
  const head = B(0.29, 0.31, 0.29, skinM, 0, 0.16, 0, headG);
  B(0.33, 0.13, 0.34, darkM, 0, 0.33, 0, headG);       // helmet
  B(0.31, 0.07, 0.1, darkM, 0, 0.26, 0.16, headG);     // brim
  B(0.2, 0.07, 0.04, new THREE.MeshStandardMaterial({ color: 0x101418, roughness: .2, metalness: .6 }), 0, 0.17, 0.15, headG);

  // ── arms ──
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.34, 1.44, 0); armR.position.set(0.34, 1.44, 0);
  body.add(armL, armR);
  const mkArm = (g) => {
    B(0.16, 0.4, 0.17, suitM, 0, -0.2, 0, g);
    B(0.14, 0.26, 0.15, skinM, 0, -0.5, 0, g);
    B(0.15, 0.13, 0.16, darkM, 0, -0.65, 0.01, g);     // glove
  };
  mkArm(armL); mkArm(armR);

  // ── gun anchor: held by both hands, points +Z ──
  const gunAnchor = new THREE.Group();
  gunAnchor.position.set(0.16, 1.22, 0.24);
  body.add(gunAnchor);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, 0.62);
  gunAnchor.add(muzzle);

  // ── parachute (used during the drop) ──
  let chute = null;
  const mkChute = () => {
    chute = new THREE.Group();
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, G.tier === 0 ? 8 : 12, G.tier === 0 ? 5 : 7, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: teamC, roughness: .8, side: THREE.DoubleSide })
    );
    canopy.scale.set(1, 0.62, 1);
    canopy.position.y = 2.6;
    canopy.castShadow = sh;
    chute.add(canopy);
    for (const s of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 3), darkM);
      line.position.set(s * 0.6, 1.5, 0);
      line.rotation.z = s * 0.44;
      chute.add(line);
    }
    root.add(chute);
  };

  // ── name / team tag sprite (only tier ≥ 1 keeps it cheap enough) ──
  let tag = null;
  if (opts.tag && G.tier > 0) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.font = '700 34px system-ui,sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 7; x.strokeStyle = 'rgba(0,0,0,.75)';
    x.strokeText(opts.tag, 128, 34);
    x.fillStyle = opts.tagColor || '#fff';
    x.fillText(opts.tag, 128, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false }));
    tag.scale.set(2.1, 0.52, 1);
    tag.position.y = 2.35;
    tag.renderOrder = 8;
    root.add(tag);
  }

  // ── health bar above enemies ──
  let hpBar = null, hpFill = null;
  if (opts.hpbar) {
    hpBar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.13), new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: .62, depthTest: false, fog: false }));
    hpFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.085), new THREE.MeshBasicMaterial({ color: 0xff4a3d, depthTest: false, fog: false }));
    hpFill.position.z = 0.005;
    hpBar.add(bg, hpFill);
    hpBar.position.y = 2.12;
    hpBar.renderOrder = 9;
    root.add(hpBar);
  }

  return {
    root, body, legL, legR, armL, armR, headG, torso, gunAnchor, muzzle,
    mkChute, get chute() { return chute; }, set chute(v) { chute = v; },
    tag, hpBar, hpFill, teamM, skinM, suitM,
    setHp(p) {
      if (!hpFill) return;
      const v = clamp(p, 0, 1);
      hpFill.scale.x = Math.max(v, 0.001);
      hpFill.position.x = -(1 - v) * 0.5;
      hpFill.material.color.setHex(v > 0.55 ? 0x4ade80 : v > 0.25 ? 0xffd45e : 0xff4a3d);
    },
  };
}

/** procedural rifle / SMG / pistol / shotgun mesh, parented to gunAnchor */
export function makeGun(kind) {
  const g = new THREE.Group();
  const sh = tier().shadows;
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2226, roughness: .48, metalness: .62 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3d20, roughness: .9 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: .7, metalness: .3 });
  const B = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); mesh.castShadow = sh; g.add(mesh); return mesh;
  };
  const C = (r, h, m, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, G.tier === 0 ? 6 : 9), m);
    mesh.position.set(x, y, z); mesh.rotation.x = rx || Math.PI / 2; mesh.castShadow = sh; g.add(mesh); return mesh;
  };
  if (kind === 'pistol') {
    B(0.09, 0.13, 0.3, dark, 0, 0, 0.1);
    B(0.085, 0.2, 0.1, dark, 0, -0.14, -0.02).rotation.x = 0.22;
    B(0.05, 0.05, 0.06, dark, 0, 0.08, 0.26);
  } else if (kind === 'smg') {
    B(0.1, 0.14, 0.5, dark, 0, 0, 0.16);
    B(0.09, 0.24, 0.09, accent, 0, -0.16, 0.02).rotation.x = 0.15;
    B(0.07, 0.24, 0.1, dark, 0, -0.16, 0.2);                  // mag
    C(0.03, 0.2, dark, 0, 0.02, 0.5);
    B(0.06, 0.07, 0.1, dark, 0, 0.1, 0.16);
  } else if (kind === 'shotgun') {
    B(0.1, 0.13, 0.62, wood, 0, -0.01, 0.02);
    C(0.042, 0.86, dark, 0, 0.045, 0.42);
    C(0.036, 0.7, dark, 0, -0.045, 0.38);
    B(0.09, 0.2, 0.1, wood, 0, -0.14, -0.26).rotation.x = 0.3;
    B(0.08, 0.09, 0.24, wood, 0, -0.05, 0.4);
  } else if (kind === 'sniper') {
    B(0.09, 0.13, 0.78, dark, 0, 0, 0.2);
    C(0.03, 1.05, dark, 0, 0.035, 0.62);
    B(0.085, 0.22, 0.1, accent, 0, -0.15, -0.02).rotation.x = 0.18;
    B(0.075, 0.13, 0.12, dark, 0, 0.02, 0.1);                 // mag
    const scope = C(0.05, 0.34, dark, 0, 0.15, 0.24);
    scope.rotation.x = Math.PI / 2;
    B(0.03, 0.08, 0.05, dark, 0, 0.1, 0.14);
    B(0.06, 0.16, 0.1, wood, 0, -0.02, -0.42);
  } else { // rifle (AR)
    B(0.1, 0.14, 0.66, dark, 0, 0, 0.18);
    C(0.032, 0.42, dark, 0, 0.035, 0.62);
    B(0.085, 0.22, 0.1, accent, 0, -0.15, 0.0).rotation.x = 0.16;
    B(0.075, 0.24, 0.11, dark, 0, -0.16, 0.2).rotation.x = 0.06;  // mag
    B(0.06, 0.08, 0.12, dark, 0, 0.11, 0.1);                       // rail
    B(0.07, 0.13, 0.22, wood, 0, -0.02, -0.26);                    // stock
    B(0.075, 0.1, 0.2, accent, 0, -0.06, 0.44);                    // handguard
  }
  g.userData.kind = kind;
  return g;
}

/** animate a character from its movement state */
export function animateChar(c, st, dt) {
  const speed = st.speed || 0;               // 0..1 of max run
  st.gait = (st.gait || 0) + dt * (2.2 + speed * 8.6);
  const swing = Math.sin(st.gait) * (0.14 + speed * 0.82);
  const air = st.airborne;

  if (air) {
    c.legL.rotation.x = -0.5; c.legR.rotation.x = -0.25;
    c.armL.rotation.x = -2.5; c.armR.rotation.x = -2.5;
    c.armL.rotation.z = 0.5; c.armR.rotation.z = -0.5;
    c.body.position.y = 0;
  } else if (st.crouch) {
    c.legL.rotation.x = -0.9; c.legR.rotation.x = -0.85;
    c.body.position.y = -0.34;
    c.body.rotation.x = 0.16;
    c.armL.rotation.x = -1.25 + swing * 0.15; c.armR.rotation.x = -1.25;
    c.armL.rotation.z = 0.28; c.armR.rotation.z = -0.2;
  } else if (speed > 0.02) {
    c.legL.rotation.x = swing; c.legR.rotation.x = -swing;
    c.armL.rotation.x = -swing * 0.75; c.armR.rotation.x = swing * 0.4;
    c.armL.rotation.z = 0.16; c.armR.rotation.z = -0.16;
    c.body.position.y = Math.abs(Math.cos(st.gait)) * 0.055 * speed;
    c.body.rotation.x = 0.06 + speed * 0.14;
    c.body.rotation.z = Math.sin(st.gait) * 0.035 * speed;
  } else {
    // idle: breathing + gun held up
    const br = Math.sin((st.t || 0) * 2.1) * 0.035;
    c.legL.rotation.x *= 0.82; c.legR.rotation.x *= 0.82;
    c.armL.rotation.x = -1.35 + br; c.armR.rotation.x = -1.15 + br;
    c.armL.rotation.z = 0.34; c.armR.rotation.z = -0.12;
    c.body.position.y = br * 0.3;
    c.body.rotation.x = 0.03; c.body.rotation.z = 0;
  }

  // aiming pose overrides the left arm so both hands meet the gun
  if (st.aiming && !air) {
    c.armR.rotation.x = -1.42; c.armR.rotation.z = -0.3;
    c.armL.rotation.x = -1.5; c.armL.rotation.z = 0.42;
    c.gunAnchor.position.set(0.1, 1.26, 0.3);
  } else {
    c.gunAnchor.position.set(0.16, 1.22, 0.24);
  }

  // the gun barrel pitches with the aim (+ recoil kick). Without this the
  // muzzle stays level while the bullet flies at an angle, so every shot on a
  // slope misses by half a metre.
  const pitch = st.pitch || 0;
  if (st.recoil > 0) {
    c.gunAnchor.position.z -= st.recoil * 0.12;
    st.recoil = Math.max(0, st.recoil - dt * 9);
  }
  c.gunAnchor.rotation.x = -pitch + st.recoil * 0.2;
  c.headG.rotation.x = -pitch * 0.55;

  st.t = (st.t || 0) + dt;
}

/** death pose: fall over and sink after a while */
export function killPose(c, st) {
  st.dead = true;
  c.body.rotation.x = -1.35;
  c.body.position.y = -0.55;
  c.root.rotation.z = 0.5;
  c.legL.rotation.x = 0.5; c.legR.rotation.x = -0.3;
  c.armL.rotation.x = -0.4; c.armR.rotation.x = -0.9;
  if (c.chute) { c.root.remove(c.chute); c.chute = null; }
  if (c.tag) c.tag.visible = false;
  if (c.hpBar) c.hpBar.visible = false;
}
