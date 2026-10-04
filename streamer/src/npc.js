// ── Chibi humans + low-poly cars (pedestrians, traffic, MP avatars) ─────────
import * as THREE from 'three';
import { mulberry32, rand, pick } from './util.js';
import { faceTexture } from './tex.js';

const SKIN = [0xf2c799, 0xd9a06b, 0x8d5a3b, 0xf7d7b0];
const SHIRT = [0xd8452f, 0x3f7fd8, 0x4aa34a, 0xe8b53a, 0x8d4fd8, 0x37b8a5, 0xd86fb0, 0x6b7280];
const PANT = [0x2d3440, 0x4a3b2a, 0x37475a, 0x20262e];
const HATS = [null, null, 0xd8452f, 0x243040, 0xe8b53a];

const faceTexCache = [];
function faceTex(i) { if (!faceTexCache.length) for (let k = 0; k < 3; k++) faceTexCache.push(faceTexture(k)); return faceTexCache[i % 3]; }

export function buildHuman(seed = 1, name = null) {
  const r = mulberry32(seed * 977 + 13);
  const g = new THREE.Group();
  const skin = pick(r, SKIN), shirt = pick(r, SHIRT), pant = pick(r, PANT), hat = pick(r, HATS);

  const legGeo = new THREE.BoxGeometry(0.13, 0.42, 0.14);
  const legMat = new THREE.MeshStandardMaterial({ color: pant, roughness: 0.9 });
  const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.09, 0.21, 0);
  const legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0.09, 0.21, 0);
  g.add(legL, legR);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 3, 8), new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 }));
  body.position.y = 0.66; g.add(body);

  const armGeo = new THREE.CapsuleGeometry(0.06, 0.3, 3, 6);
  const armMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const armL = new THREE.Mesh(armGeo, armMat); armL.position.set(-0.26, 0.78, 0);
  const armR = new THREE.Mesh(armGeo, armMat); armR.position.set(0.26, 0.78, 0);
  g.add(armL, armR);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8, map: faceTex(seed) }));
  head.position.y = 1.12; g.add(head);

  // some pedestrians carry a backpack (like the reference shots)
  if (seed % 3 === 0) {
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.12), new THREE.MeshStandardMaterial({ color: pick(r, [0xd8712f, 0x8f3b2f, 0x37475a, 0x4aa34a]), roughness: 0.9 }));
    bp.position.set(0, 0.78, -0.24); g.add(bp);
  }

  if (hat) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), new THREE.MeshStandardMaterial({ color: hat, roughness: 0.9 }));
    cap.position.y = 1.16; g.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.16), new THREE.MeshStandardMaterial({ color: hat }));
    brim.position.set(0, 1.2, 0.2); g.add(brim);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  let tag = null;
  if (name) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const gx = c.getContext('2d');
    gx.fillStyle = 'rgba(10,14,20,0.72)'; gx.beginPath(); gx.roundRect(20, 8, 216, 48, 12); gx.fill();
    gx.fillStyle = '#8fe3ff'; gx.font = 'bold 28px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle';
    gx.fillText(name.slice(0, 14), 128, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
    tag.scale.set(1.6, 0.4, 1); tag.position.y = 1.75;
    g.add(tag);
  }
  g.userData.walk = (phase, moving) => {
    const s = moving ? Math.sin(phase) * 0.55 : 0;
    legL.rotation.x = s; legR.rotation.x = -s;
    armL.rotation.x = -s * 0.8; armR.rotation.x = s * 0.8;
    g.userData.bobT = moving ? (g.userData.bobT || 0) : 0;
  };
  return g;
}

export class Pedestrian {
  constructor(seed, rect, speed = 1.1) {
    this.mesh = buildHuman(seed);
    this.rect = rect; // [x0,z0,x1,z1] loop
    this.wp = 0;
    this.speed = speed * (0.85 + (seed % 10) / 25);
    this.phase = seed;
    const pts = this.corners();
    this.mesh.position.set(pts[0][0], 0, pts[0][1]);
  }
  corners() {
    const [x0, z0, x1, z1] = this.rect;
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  }
  update(dt) {
    const pts = this.corners();
    const [tx, tz] = pts[this.wp];
    const dx = tx - this.mesh.position.x, dz = tz - this.mesh.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) { this.wp = (this.wp + 1) % 4; return; }
    this.mesh.position.x += (dx / d) * this.speed * dt;
    this.mesh.position.z += (dz / d) * this.speed * dt;
    this.mesh.rotation.y = Math.atan2(dx, dz);
    this.phase += dt * this.speed * 5;
    this.mesh.userData.walk(this.phase, true);
  }
}

// ── cars ──
export function buildCar(color, sporty = 0) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc6d8, roughness: 0.15, metalness: 0.4 });

  const bodyH = 0.5 - sporty * 0.08;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, bodyH, 4.3), paint);
  body.position.y = 0.55; g.add(body);
  // hood slope + trunk
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 1.1), paint);
  hood.position.set(0, 0.82 - sporty * 0.08, 1.7); hood.rotation.x = -0.09; g.add(hood);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55 - sporty * 0.1, 2.1), glass);
  cabin.position.set(0, 1.02 - sporty * 0.06, -0.25); g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.08, 2.2), paint);
  roof.position.set(0, 1.32 - sporty * 0.08, -0.25); g.add(roof);

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  [[-0.86, 1.45], [0.86, 1.45], [-0.86, -1.45], [0.86, -1.45]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.34, z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.27, 8), new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.8, roughness: 0.3 }));
    hub.rotation.z = Math.PI / 2; hub.position.copy(w.position);
    g.add(w, hub); wheels.push(w);
  });

  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6cf, emissive: 0xfff2b0, emissiveIntensity: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2020, emissiveIntensity: 0.4 });
  [[-0.62], [0.62]].forEach(([x]) => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), lightMat);
    hl.position.set(x, 0.62, 2.16); g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), tailMat);
    tl.position.set(x, 0.66, -2.16); g.add(tl);
  });

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.wheels = wheels;
  g.userData.headMat = lightMat;
  g.userData.tailMat = tailMat;
  return g;
}

// cockpit interior for first-person driving (dashboard, wheel, mirrors)
export function buildCockpit() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: 0.85 });
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.34, 0.5), dark);
  dash.position.set(0, -0.28, -0.72); g.add(dash);
  const dashTop = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.06, 0.6), new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.9 }));
  dashTop.position.set(0, -0.1, -0.75); dashTop.rotation.x = 0.18; g.add(dashTop);
  // gauges
  const gaugeMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0xff9a3c, emissiveIntensity: 0.8 });
  const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.03), gaugeMat);
  gauge.position.set(0, -0.22, -0.46); gauge.rotation.x = -0.3; g.add(gauge);
  // steering wheel
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.028, 8, 20), new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.6 }));
  const spoke1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.03), dark);
  const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.03), dark);
  wheel.add(rim, spoke1, spoke2);
  wheel.position.set(0, -0.32, -0.5); wheel.rotation.x = -0.5;
  g.add(wheel);
  // A-pillars + roof edge
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.9 });
  const pl = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), pillarMat); pl.position.set(-0.85, 0.15, -0.55); pl.rotation.z = 0.35; pl.rotation.x = -0.3; g.add(pl);
  const pr = pl.clone(); pr.position.x = 0.85; pr.rotation.z = -0.35; g.add(pr);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.7), pillarMat); head.position.set(0, 0.62, -0.35); g.add(head);
  // rearview mirror
  const mir = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.02), new THREE.MeshStandardMaterial({ color: 0x27313c, roughness: 0.2, metalness: 0.6 }));
  mir.position.set(0, 0.5, -0.5); g.add(mir);
  // side mirrors
  const sm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.14), new THREE.MeshStandardMaterial({ color: 0x27313c, roughness: 0.25, metalness: 0.5 }));
  const sml = sm.clone(); sml.position.set(-0.95, 0.02, -0.5); g.add(sml);
  const smr = sm.clone(); smr.position.set(0.95, 0.02, -0.5); g.add(smr);
  // gauges: two analog dials with moving needles
  const dialMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0xff9a3c, emissiveIntensity: 0.25 });
  const dial1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 16), dialMat);
  dial1.rotation.x = Math.PI / 2 - 0.3; dial1.position.set(-0.13, -0.22, -0.46); g.add(dial1);
  const dial2 = dial1.clone(); dial2.position.x = 0.13; g.add(dial2);
  const needleMat = new THREE.MeshStandardMaterial({ color: 0xff5030, emissive: 0xff3010, emissiveIntensity: 1.2 });
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.006), needleMat);
  needle.geometry.translate(0, 0.03, 0);
  needle.position.set(-0.13, -0.225, -0.45); needle.rotation.x = -0.3; g.add(needle);
  const needle2 = needle.clone(); needle2.position.x = 0.13; g.add(needle2);
  // windshield wipers
  const wiperMat = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.6 });
  const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.01), wiperMat);
  w1.position.set(-0.35, -0.02, -0.86); w1.rotation.z = 0.9; w1.rotation.x = -0.25; g.add(w1);
  const w2 = w1.clone(); w2.position.x = 0.3; g.add(w2);
  g.userData.wheel = wheel;
  g.userData.needles = [needle, needle2];
  return g;
}
