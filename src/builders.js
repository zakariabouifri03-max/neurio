// ── 3D builders: cars, drivers, tracks, garage ───────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARCH, THEMES } from './data.js';
import { mulberry32, clamp, lerp } from './util.js';
import * as TEX from './tex.js';

// tiny helpers ───────────────────────────────────────────────────────────────
function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function xform(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
  geo.applyMatrix4(m);
  return geo;
}

function tube(p1, p2, r, mat, seg = 6) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(p1).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ═══════════════════════════ CARS ═══════════════════════════════════════════

export function buildCar(car, opts = {}) {
  const A = ARCH[car.arch];
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.paint || car.paint), roughness: 0.32, metalness: 0.22 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(car.accent), roughness: 0.5, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.08, metalness: 0.55 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd7dde8, roughness: 0.18, metalness: 0.9 });
  const lightF = new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xffe9a0, emissiveIntensity: 0.9 });
  const lightR = new THREE.MeshStandardMaterial({ color: 0xff4455, emissive: 0xaa1122, emissiveIntensity: 0.7 });

  const wheels = { all: [], front: [] };
  const wheelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.wheelColor || '#23262e'), roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, roughness: 0.3, metalness: 0.7 });

  function wheel(x, z, r, steerable) {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const w = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.wheelW, 18), wheelMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, A.wheelW + 0.04, 12), hubMat);
    hub.rotation.z = Math.PI / 2;
    w.add(tire, hub);
    pivot.add(w);
    g.add(pivot);
    wheels.all.push(w);
    if (steerable) wheels.front.push(pivot);
    return pivot;
  }
  wheel(-A.track, A.wb, A.wheelR, true);
  wheel(A.track, A.wb, A.wheelR, true);
  wheel(-A.track, -A.wb, A.wheelRr, false);
  wheel(A.track, -A.wb, A.wheelRr, false);

  const bodyY = A.clear + A.bodyH / 2;
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(A.W, A.bodyH, A.L), paint);
  chassis.position.y = bodyY;
  chassis.castShadow = true;
  g.add(chassis);

  // hood stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.3, 0.03, A.L * 0.94), accent);
  stripe.position.set(0, A.clear + A.bodyH + 0.005, 0.04);
  g.add(stripe);

  // bumpers
  const bf = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.9, 0.16, 0.3), chrome);
  bf.position.set(0, A.clear + 0.05, A.L / 2 + 0.06);
  const bb = bf.clone(); bb.position.z = -A.L / 2 - 0.06;
  g.add(bf, bb);

  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa133, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  function exhaust(x, y, z) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.5, 8), chrome);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, y, z);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 8), flameMat);
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(x, y, z - 0.55);
    fl.visible = false;
    g.add(pipe, fl);
    flames.push(fl);
  }
  exhaust(-A.W * 0.25, A.clear + 0.1, -A.L / 2 - 0.1);
  exhaust(A.W * 0.25, A.clear + 0.1, -A.L / 2 - 0.1);

  // headlights / taillights
  const hl1 = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), lightF);
  hl1.position.set(-A.W * 0.3, bodyY + A.bodyH * 0.25, A.L / 2 + 0.01);
  const hl2 = hl1.clone(); hl2.position.x *= -1;
  const tl1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.06), lightR);
  tl1.position.set(-A.W * 0.3, bodyY + A.bodyH * 0.25, -A.L / 2 - 0.01);
  const tl2 = tl1.clone(); tl2.position.x *= -1;
  g.add(hl1, hl2, tl1, tl2);

  // seat + steering
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.55), dark);
  const seatZ = A.cab === 'truck' || A.cab === 'fastback' ? -0.2 : -0.35;
  seat.position.set(0, A.clear + A.bodyH + 0.2, seatZ);
  g.add(seat);
  const swheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 8, 14), dark);
  swheel.position.set(0, A.clear + A.bodyH + 0.42, seatZ + 0.7);
  swheel.rotation.x = -0.9;
  g.add(swheel);

  // cab styles ────────────────────────────────────────────────
  if (A.cab === 'bubble') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.86, 0.5, A.L * 0.42), paint);
    cab.position.set(0, A.clear + A.bodyH + 0.25, -0.35);
    g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.8, 0.42, A.L * 0.2), glass);
    win.position.set(0, A.clear + A.bodyH + 0.28, 0.32);
    g.add(win);
  } else if (A.cab === 'fastback') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.8, 0.48, A.L * 0.4), paint);
    cab.position.set(0, A.clear + A.bodyH + 0.26, -0.55);
    g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.74, 0.4, 0.5), glass);
    win.position.set(0, A.clear + A.bodyH + 0.26, 0.02);
    win.rotation.x = 0.35;
    g.add(win);
  } else if (A.cab === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.88, 0.78, A.L * 0.34), paint);
    cab.position.set(0, A.clear + A.bodyH + 0.38, A.L * 0.18);
    g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.8, 0.5, 0.1), glass);
    win.position.set(0, A.clear + A.bodyH + 0.42, A.L * 0.18 + A.L * 0.17 + 0.03);
    g.add(win);
    // bed walls
    const bw = 0.09, bedL = A.L * 0.42, bedY = A.clear + A.bodyH + 0.22;
    const w1 = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.45, bedL), paint);
    w1.position.set(-A.W / 2 + bw / 2, bedY, -A.L * 0.27);
    const w2 = w1.clone(); w2.position.x *= -1;
    const w3 = new THREE.Mesh(new THREE.BoxGeometry(A.W - 0.1, 0.45, bw), paint);
    w3.position.set(0, bedY, -A.L * 0.27 - bedL / 2);
    g.add(w1, w2, w3);
    // rollbar
    g.add(tube(V3(-A.W * 0.4, bedY + 0.15, -A.L * 0.12), V3(-A.W * 0.4, bedY + 0.75, -A.L * 0.12), 0.05, dark));
    g.add(tube(V3(A.W * 0.4, bedY + 0.15, -A.L * 0.12), V3(A.W * 0.4, bedY + 0.75, -A.L * 0.12), 0.05, dark));
    g.add(tube(V3(-A.W * 0.4, bedY + 0.75, -A.L * 0.12), V3(A.W * 0.4, bedY + 0.75, -A.L * 0.12), 0.05, dark, 4));
  } else if (A.cab === 'convert') {
    const win = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.8, 0.4, 0.08), glass);
    win.position.set(0, A.clear + A.bodyH + 0.3, seatZ + 0.85);
    win.rotation.x = -0.25;
    g.add(win);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.9, 0.18, A.L * 0.3), accent);
    boot.position.set(0, A.clear + A.bodyH + 0.03, -A.L * 0.36);
    g.add(boot);
    // tail fins
    const fin1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.7), paint);
    fin1.position.set(-A.W * 0.48, A.clear + A.bodyH + 0.1, -A.L * 0.38);
    const fin2 = fin1.clone(); fin2.position.x *= -1;
    g.add(fin1, fin2);
  } else if (A.cab === 'sports') {
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.5, 0.35, 0.6), paint);
    cowl.position.set(0, A.clear + A.bodyH + 0.15, -0.75);
    g.add(cowl);
    const win = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.6, 0.28, 0.08), glass);
    win.position.set(0, A.clear + A.bodyH + 0.24, seatZ + 0.9);
    win.rotation.x = -0.35;
    g.add(win);
  } else if (A.cab === 'open') {
    const win = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.66, 0.32, 0.06), glass);
    win.position.set(0, A.clear + A.bodyH + 0.3, seatZ + 0.95);
    win.rotation.x = -0.3;
    g.add(win);
  }

  // roll cage (buggy)
  if (A.cage) {
    const t = 0.055, top = A.clear + A.bodyH + 1.0;
    g.add(
      tube(V3(-A.W * 0.42, A.clear + A.bodyH, seatZ + 0.95), V3(-A.W * 0.42, top, seatZ + 0.3), t, dark),
      tube(V3(A.W * 0.42, A.clear + A.bodyH, seatZ + 0.95), V3(A.W * 0.42, top, seatZ + 0.3), t, dark),
      tube(V3(-A.W * 0.42, top, seatZ + 0.3), V3(A.W * 0.42, top, seatZ + 0.3), t, dark, 4),
      tube(V3(-A.W * 0.42, A.clear + A.bodyH, seatZ - 0.75), V3(-A.W * 0.42, top, seatZ + 0.28), t, dark),
      tube(V3(A.W * 0.42, A.clear + A.bodyH, seatZ - 0.75), V3(A.W * 0.42, top, seatZ + 0.28), t, dark),
      tube(V3(-A.W * 0.42, top, seatZ + 0.3), V3(-A.W * 0.42, top, seatZ - 0.6), t, dark, 4),
      tube(V3(A.W * 0.42, top, seatZ + 0.3), V3(A.W * 0.42, top, seatZ - 0.6), t, dark, 4),
    );
  }
  // engine block (buggy/hotrod)
  if (A.engine) {
    const eb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.7), chrome);
    eb.position.set(0, A.clear + A.bodyH + 0.28, -A.L * 0.38);
    g.add(eb);
    for (let i = 0; i < 3; i++) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6), chrome);
      stack.position.set(-0.22 + i * 0.22, A.clear + A.bodyH + 0.75, -A.L * 0.38);
      g.add(stack);
    }
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), dark);
    scoop.position.set(0, A.clear + A.bodyH + 0.65, -A.L * 0.3);
    g.add(scoop);
  }
  // spoiler (muscle/sport)
  if (A.spoiler) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(A.W * 0.95, 0.07, 0.5), accent);
    const wy = A.clear + A.bodyH + (A.cab === 'sports' ? 0.75 : 0.55);
    wing.position.set(0, wy, -A.L / 2 + 0.1);
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, wy - A.clear - A.bodyH, 0.2), dark);
    p1.position.set(-A.W * 0.35, (A.clear + A.bodyH + wy) / 2, -A.L / 2 + 0.1);
    const p2 = p1.clone(); p2.position.x *= -1;
    g.add(wing, p1, p2);
  }
  // monster suspension
  if (car.arch === 'monster') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(tube(V3(sx * A.track * 0.8, A.wheelR, sz * A.wb), V3(sx * A.W * 0.4, A.clear + 0.1, sz * A.wb * 0.75), 0.07, chrome));
    }
  }

  // driver (open cockpits only — enclosed cabs hide the driver)
  let driver = null;
  if (opts.driver && A.cab !== 'bubble' && A.cab !== 'fastback') {
    driver = buildDriver(opts.driver, 'sit');
    driver.group.position.set(0, A.clear + A.bodyH + 0.28, seatZ);
    driver.group.scale.setScalar(0.72);
    g.add(driver.group);
  }

  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(A.L, A.W) * 0.62, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  shield.position.y = bodyY + 0.4;
  shield.visible = false;
  g.add(shield);

  return { group: g, wheels, flames, shield, paintMat: paint, wheelMat, driver };
}

// ═══════════════════════════ DRIVERS ════════════════════════════════════════

export function buildDriver(d, pose = 'stand') {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.skin), roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.shirt), roughness: 0.75 });
  const pants = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.pants), roughness: 0.75 });
  const hairM = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.9 });
  const blondM = new THREE.MeshStandardMaterial({ color: 0xf7d154, roughness: 0.9 });

  const sit = pose === 'sit';

  // body
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.30, 0.35, 4, 10), shirt);
  body.position.y = sit ? 0.42 : 0.68;
  body.castShadow = true;
  g.add(body);
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.3, 10), pants);
  hips.position.y = sit ? 0.16 : 0.36;
  g.add(hips);

  // arms
  const armGeo = new THREE.CapsuleGeometry(0.09, 0.34, 4, 8);
  const aL = new THREE.Mesh(armGeo, shirt);
  const aR = aL.clone();
  if (sit) {
    aL.position.set(-0.36, 0.5, 0.25); aL.rotation.set(-1.1, 0, 0.25);
    aR.position.set(0.36, 0.5, 0.25); aR.rotation.set(-1.1, 0, -0.25);
  } else {
    aL.position.set(-0.4, 0.72, 0); aL.rotation.z = 0.35;
    aR.position.set(0.4, 0.72, 0); aR.rotation.z = -0.35;
  }
  g.add(aL, aR);

  // legs (standing only)
  let legL, legR;
  if (!sit) {
    const legGeo = new THREE.CapsuleGeometry(0.11, 0.3, 4, 8);
    legL = new THREE.Mesh(legGeo, pants); legL.position.set(-0.14, 0.13, 0);
    legR = legL.clone(); legR.position.x = 0.14;
    g.add(legL, legR);
    const shoeGeo = new THREE.BoxGeometry(0.18, 0.1, 0.3);
    const sL = new THREE.Mesh(shoeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
    sL.position.set(-0.14, 0.03, 0.05);
    const sR = sL.clone(); sR.position.x = 0.14;
    g.add(sL, sR);
  }

  // head + emoji face
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.40, 18, 14), skin);
  skull.castShadow = true;
  head.add(skull);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.46),
    new THREE.MeshBasicMaterial({ map: TEX.faceTexture(d.emoji), transparent: true })
  );
  face.position.set(0, 0.02, 0.385);
  head.add(face);
  head.position.y = sit ? 0.88 : 1.22;
  g.add(head);

  // ── hats ──
  const H = d.hat, hy = 0.3;
  if (H === 'goggles') {
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 6), hairM);
      spike.position.set(-0.18 + i * 0.09, hy + 0.12 + Math.sin(i) * 0.02, 0.02);
      spike.rotation.z = (i - 2) * 0.22;
      head.add(spike);
    }
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 8, 18), new THREE.MeshStandardMaterial({ color: 0xd64545, roughness: 0.6 }));
    strap.rotation.x = Math.PI / 2; strap.position.y = hy + 0.05;
    head.add(strap);
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 8, 14), new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4 }));
    lens.position.set(-0.13, hy + 0.05, 0.36);
    const lens2 = lens.clone(); lens2.position.x = 0.13;
    head.add(lens, lens2);
  } else if (H === 'pigtails') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.41, 14, 10, 0, Math.PI * 2, 0, 1.35), blondM);
    cap.position.y = 0.04; head.add(cap);
    for (const sx of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), blondM);
      tail.position.set(sx * 0.4, 0.12, -0.1); head.add(tail);
      const bow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.06), new THREE.MeshStandardMaterial({ color: 0xff70a6 }));
      bow.position.set(sx * 0.38, 0.26, -0.05); bow.rotation.z = sx * 0.5; head.add(bow);
    }
  } else if (H === 'flower') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.41, 14, 10, 0, Math.PI * 2, 0, 1.3), hairM);
    cap.position.y = 0.03; head.add(cap);
    for (let i = 0; i < 5; i++) {
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff8fa3 }));
      petal.position.set(0.32 + Math.cos(i * 1.256) * 0.08, 0.32 + Math.sin(i * 1.256) * 0.08, 0.15);
      head.add(petal);
    }
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd23f }));
    center.position.set(0.32, 0.32, 0.16); head.add(center);
  } else if (H === 'straw') {
    const straw = new THREE.MeshStandardMaterial({ color: 0xe8c46a, roughness: 0.95 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.58, 0.06, 14), straw);
    brim.position.y = hy; head.add(brim);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.24, 12), straw);
    top.position.y = hy + 0.14; head.add(top);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0xd64545 }));
    band.position.y = hy + 0.05; head.add(band);
  } else if (H === 'bunny') {
    const earGeo = new THREE.CapsuleGeometry(0.09, 0.4, 4, 8);
    const earM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const inM = new THREE.MeshStandardMaterial({ color: 0xffc6ff, roughness: 0.85 });
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, earM);
      ear.position.set(sx * 0.14, hy + 0.35, 0); ear.rotation.z = -sx * 0.15; head.add(ear);
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.28, 4, 6), inM);
      inner.position.set(sx * 0.14, hy + 0.35, 0.06); inner.rotation.z = -sx * 0.15; head.add(inner);
    }
  } else if (H === 'frog') {
    const froM = new THREE.MeshStandardMaterial({ color: 0x57cc5f, roughness: 0.8 });
    const band = new THREE.Mesh(new THREE.SphereGeometry(0.405, 14, 10, 0, Math.PI * 2, 0, 1.1), froM);
    band.position.y = 0.05; head.add(band);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), froM);
      eye.position.set(sx * 0.18, hy + 0.18, 0.12); head.add(eye);
      const pup = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      pup.position.set(sx * 0.18, hy + 0.2, 0.23); head.add(pup);
    }
  } else if (H === 'mohawk') {
    const mo = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.6), new THREE.MeshStandardMaterial({ color: 0xff3355, roughness: 0.7 }));
    mo.position.set(0, hy + 0.16, 0); head.add(mo);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.405, 14, 10, 0, Math.PI * 2, 0, 1.2), hairM);
    cap.position.y = 0.02; head.add(cap);
  } else if (H === 'clown') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6),
        new THREE.MeshStandardMaterial({ color: [0xff3355, 0xffd23f, 0x38bdf8, 0x84cc16][i % 4], roughness: 0.8 }));
      ball.position.set(Math.cos(a) * 0.34, hy + Math.sin(a) * 0.12 + 0.1, Math.sin(a) * 0.34);
      head.add(ball);
    }
  } else if (H === 'bandana') {
    const band = new THREE.Mesh(new THREE.SphereGeometry(0.405, 14, 10, 0, Math.PI * 2, 0, 1.1), new THREE.MeshStandardMaterial({ color: 0x3f88c5, roughness: 0.85 }));
    band.position.y = 0.06; head.add(band);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), band.material);
    knot.position.set(0, 0.18, -0.36); head.add(knot);
  } else if (H === 'nightcap') {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.75, 10), new THREE.MeshStandardMaterial({ color: 0x7b2cbf, roughness: 0.85 }));
    cap.position.set(0, hy + 0.3, -0.1); cap.rotation.x = -0.5; head.add(cap);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff6c9 }));
    pom.position.set(0, hy + 0.52, -0.42); head.add(pom);
  } else if (H === 'fin') {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 4), new THREE.MeshStandardMaterial({ color: 0x6b7c93, roughness: 0.6, flatShading: true }));
    fin.position.set(0, hy + 0.25, -0.02); fin.rotation.y = Math.PI / 4; fin.scale.z = 0.35; head.add(fin);
  } else if (H === 'pirate') {
    const band = new THREE.Mesh(new THREE.SphereGeometry(0.41, 14, 10, 0, Math.PI * 2, 0, 1.15), new THREE.MeshStandardMaterial({ color: 0x8f1d1d, roughness: 0.85 }));
    band.position.y = 0.05; head.add(band);
    for (const sx of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.05), band.material);
      tail.position.set(sx * 0.1, 0.12, -0.4); tail.rotation.z = sx * 0.3; head.add(tail);
    }
  } else if (H === 'antenna') {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI * 2, 0, 1.6), new THREE.MeshStandardMaterial({ color: 0xadb5bd, metalness: 0.7, roughness: 0.35 }));
    helm.position.y = 0.02; head.add(helm);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6), helm.material);
    ant.position.y = hy + 0.35; head.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff3355, emissiveIntensity: 1.2 }));
    tip.position.y = hy + 0.55; head.add(tip);
  } else if (H === 'mermaid') {
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.43, 14, 10, 0, Math.PI * 2, 0, 1.9), new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 0.85 }));
    hairBack.position.y = -0.02; head.add(hairBack);
    for (let i = 0; i < 3; i++) {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff8fa3 }));
      shell.position.set(-0.15 + i * 0.15, hy + 0.12, 0.28); head.add(shell);
    }
  } else if (H === 'crown') {
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.25 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.16, 12), gold);
    band.position.y = hy + 0.1; head.add(band);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 4), gold);
      const a = (i / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.29, hy + 0.26, Math.sin(a) * 0.29);
      head.add(spike);
    }
  } else if (H === 'alien') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.3 }));
    dome.position.y = 0.02; head.add(dome);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0x57cc5f }));
    ant.position.y = hy + 0.4; head.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0x84ff6a, emissive: 0x84ff6a, emissiveIntensity: 1.5 }));
    tip.position.y = hy + 0.58; head.add(tip);
  }

  return { group: g, head, body };
}

// ═══════════════════════════ PROPS (decor) ══════════════════════════════════

// each returns array of geometries, translated to origin, ready for merging
const PROPS = {
  palm: (r) => {
    const g = [], lean = (r() - 0.5) * 0.3, h = 5 + r() * 3;
    g.push(xform(tint(new THREE.CylinderGeometry(0.22, 0.4, h, 7), 0x8a5a2b), lean * 2, h / 2, 0, 0, 0, lean));
    const topX = lean * 4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.push(xform(tint(new THREE.ConeGeometry(0.5, 3.2, 4), 0x2e9e4f),
        topX + Math.cos(a) * 1.5, h + 0.3, Math.sin(a) * 1.5, Math.PI * 0.62, -a + Math.PI / 2, 0, 1));
    }
    g.push(xform(tint(new THREE.SphereGeometry(0.28, 6, 5), 0x6f4a1e), topX + 0.3, h - 0.2, 0.3));
    g.push(xform(tint(new THREE.SphereGeometry(0.24, 6, 5), 0x6f4a1e), topX - 0.3, h - 0.3, -0.1));
    return g;
  },
  bigtree: (r) => {
    const g = [], h = 6 + r() * 4;
    g.push(xform(tint(new THREE.CylinderGeometry(0.5, 0.9, h, 7), 0x6b4a26), 0, h / 2, 0));
    for (let i = 0; i < 3; i++) {
      const s = 3.2 - i * 0.7;
      g.push(xform(tint(new THREE.IcosahedronGeometry(s, 0), [0x2e7d32, 0x388e3c, 0x43a047][i]),
        (r() - 0.5) * 1.5, h - 0.5 + i * 1.6, (r() - 0.5) * 1.5));
    }
    return g;
  },
  fern: (r) => {
    const g = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + r();
      g.push(xform(tint(new THREE.ConeGeometry(0.28, 1.6, 4), 0x3f9e46), Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.5, 0.9, -a, 0));
    }
    return g;
  },
  totem: (r) => {
    const g = [], cols = [0xe63946, 0xf4a261, 0x2a9d8f, 0xe9c46a];
    for (let i = 0; i < 4; i++) {
      g.push(xform(tint(new THREE.BoxGeometry(1.1 - i * 0.08, 1.1, 1.1 - i * 0.08), cols[(r() * 4) | 0]), 0, 0.55 + i * 1.1, 0, 0, r() * 0.5, 0));
    }
    return g;
  },
  rock: (r) => [xform(tint(new THREE.IcosahedronGeometry(1 + r() * 1.5, 0), 0x8d99ae), 0, 0.4, 0, r(), r(), 0, 1)],
  rockmoss: (r) => [xform(tint(new THREE.IcosahedronGeometry(1 + r() * 1.6, 0), 0x6b8f5e), 0, 0.4, 0, r(), r(), 0, 1)],
  rockred: (r) => [xform(tint(new THREE.IcosahedronGeometry(1 + r() * 1.8, 0), 0xb25a3a), 0, 0.4, 0, r(), r(), 0, 1)],
  basalt: (r) => [xform(tint(new THREE.CylinderGeometry(0.8 + r(), 1 + r(), 3 + r() * 5, 6), 0x2b2320), 0, 1.5, 0, 0, r() * 3, 0)],
  obsidian: (r) => [xform(tint(new THREE.ConeGeometry(0.8, 3.5 + r() * 2, 5), 0x1a1418), 0, 1.7, 0, 0, r(), 0)],
  deadtree: (r) => {
    const g = [xform(tint(new THREE.CylinderGeometry(0.18, 0.35, 3.5, 6), 0x4a3a30), 0, 1.75, 0, 0, 0, (r() - 0.5) * 0.4)];
    g.push(xform(tint(new THREE.CylinderGeometry(0.08, 0.14, 2, 5), 0x4a3a30), 0.6, 3.4, 0, 0, 0, -0.8));
    g.push(xform(tint(new THREE.CylinderGeometry(0.06, 0.12, 1.6, 5), 0x4a3a30), -0.5, 3.2, 0.2, 0.4, 0, 0.7));
    return g;
  },
  lavavent: (r) => {
    const g = [xform(tint(new THREE.ConeGeometry(1.2, 1.6, 7), 0x3a2f2a), 0, 0.8, 0)];
    g.push(xform(tint(new THREE.ConeGeometry(0.55, 0.8, 7), 0xff7733), 0, 1.4, 0));
    return g;
  },
  cactus: (r) => {
    const h = 2 + r() * 2, c = 0x4f9e4f;
    const g = [xform(tint(new THREE.CylinderGeometry(0.35, 0.4, h, 8), c), 0, h / 2, 0)];
    g.push(xform(tint(new THREE.CylinderGeometry(0.18, 0.18, 0.9, 6), c), 0.55, h * 0.55, 0, 0, 0, Math.PI / 2));
    g.push(xform(tint(new THREE.CylinderGeometry(0.18, 0.18, 1, 6), c), 0.95, h * 0.55 + 0.45, 0));
    if (r() > 0.5) {
      g.push(xform(tint(new THREE.CylinderGeometry(0.16, 0.16, 0.8, 6), c), -0.5, h * 0.7, 0, 0, 0, Math.PI / 2));
      g.push(xform(tint(new THREE.CylinderGeometry(0.16, 0.16, 0.8, 6), c), -0.85, h * 0.7 + 0.35, 0));
    }
    return g;
  },
  bones: (r) => {
    const g = [];
    for (let i = 0; i < 4; i++) {
      g.push(xform(tint(new THREE.TorusGeometry(1 + i * 0.28, 0.12, 5, 10, Math.PI), 0xf4f1de), 0, 0.1 + i * 0.05, i * 0.9 - 1.4, 0, 0, 0));
    }
    g.push(xform(tint(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), 0xf4f1de), 0, 0.25, 0, Math.PI / 2));
    return g;
  },
  tumbleweed: (r) => [xform(tint(new THREE.IcosahedronGeometry(0.7 + r() * 0.4, 0), 0x9a7b4f), 0, 0.6, 0, r() * 3, r() * 3, 0)],
  house: (r) => {
    const g = [], w = 4 + r() * 2, d = 3.5 + r() * 1.5, h = 2.6 + r() * 0.8;
    const wall = [0xf5e6c8, 0xf0e0d0, 0xe8d5b5][(r() * 3) | 0];
    g.push(xform(tint(new THREE.BoxGeometry(w, h, d), wall), 0, h / 2, 0));
    g.push(xform(tint(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.8, 4), 0xc1440e), 0, h + 0.9, 0, 0, Math.PI / 4, 0));
    g.push(xform(tint(new THREE.BoxGeometry(0.9, 1.6, 0.15), 0x6f4a26), 0, 0.8, d / 2 + 0.05));
    g.push(xform(tint(new THREE.BoxGeometry(0.7, 0.7, 0.15), 0x87ceeb), -w * 0.28, h * 0.6, d / 2 + 0.05));
    g.push(xform(tint(new THREE.BoxGeometry(0.7, 0.7, 0.15), 0x87ceeb), w * 0.28, h * 0.6, d / 2 + 0.05));
    return g;
  },
  awning: (r) => {
    const g = [], c1 = [0xe63946, 0x2a9d8f, 0xe9c46a][(r() * 3) | 0];
    g.push(xform(tint(new THREE.BoxGeometry(2.6, 0.8, 1.2), 0x8a5a2b), 0, 0.4, 0));
    for (let i = 0; i < 5; i++) {
      g.push(xform(tint(new THREE.BoxGeometry(0.52, 0.06, 1.6), i % 2 ? c1 : 0xffffff), -1.04 + i * 0.52, 1.85, 0.3, 0.35, 0, 0));
    }
    g.push(xform(tint(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 5), 0x6f4a26), -1.2, 0.9, 0.9));
    g.push(xform(tint(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 5), 0x6f4a26), 1.2, 0.9, 0.9));
    return g;
  },
  lantern: (r) => {
    const g = [xform(tint(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6), 0x4a3728), 0, 1.7, 0)];
    g.push(xform(tint(new THREE.BoxGeometry(0.45, 0.6, 0.45), 0xffb347), 0, 3.2, 0));
    g.push(xform(tint(new THREE.ConeGeometry(0.4, 0.3, 4), 0x4a3728), 0, 3.65, 0));
    return g;
  },
  crate: (r) => {
    const g = [];
    const n = 1 + (r() * 2 | 0);
    for (let i = 0; i < n; i++) {
      g.push(xform(tint(new THREE.BoxGeometry(1, 1, 1), i ? 0xa07850 : 0x8a5a2b), (r() - 0.5) * 0.5, 0.5 + i * 1.02, (r() - 0.5) * 0.5, 0, r(), 0));
    }
    return g;
  },
  surf: (r) => {
    const c = [0xff70a6, 0x38bdf8, 0xffd23f, 0x84cc16][(r() * 4) | 0];
    return [xform(tint(new THREE.CapsuleGeometry(0.28, 1.7, 4, 8), c), 0, 0.9, 0, 0.25, 0, 0.15)];
  },
  pine: (r) => {
    const g = [], h = 3.2 + r() * 2;
    g.push(xform(tint(new THREE.CylinderGeometry(0.2, 0.35, 1.4, 6), 0x6b4a26), 0, 0.7, 0));
    for (let i = 0; i < 3; i++) {
      const s = 1.9 - i * 0.5;
      g.push(xform(tint(new THREE.ConeGeometry(s, 2.2, 7), 0x2d6a4f), 0, 1.5 + i * 1.5, 0));
      g.push(xform(tint(new THREE.ConeGeometry(s * 0.7, 0.7, 7), 0xffffff), 0, 2.25 + i * 1.5, 0));
    }
    return g;
  },
  pinedark: (r) => {
    const g = [], h = 3 + r() * 2;
    g.push(xform(tint(new THREE.CylinderGeometry(0.2, 0.35, 1.4, 6), 0x2a2018), 0, 0.7, 0));
    for (let i = 0; i < 3; i++) {
      g.push(xform(tint(new THREE.ConeGeometry(1.9 - i * 0.5, 2.2, 7), 0x1e3a4f), 0, 1.5 + i * 1.5, 0));
    }
    return g;
  },
  icerock: (r) => [xform(tint(new THREE.IcosahedronGeometry(0.9 + r() * 1.4, 0), 0xbfe3ff), 0, 0.5, 0, r(), r(), 0, 1)],
  snowman: (r) => {
    const g = [];
    g.push(xform(tint(new THREE.SphereGeometry(0.8, 10, 8), 0xffffff), 0, 0.75, 0));
    g.push(xform(tint(new THREE.SphereGeometry(0.55, 10, 8), 0xffffff), 0, 1.8, 0));
    g.push(xform(tint(new THREE.SphereGeometry(0.4, 10, 8), 0xffffff), 0, 2.6, 0));
    g.push(xform(tint(new THREE.ConeGeometry(0.1, 0.5, 6), 0xff7733), 0, 2.6, 0.5, Math.PI / 2, 0, 0));
    g.push(xform(tint(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 10), 0x232323), 0, 3.05, 0));
    g.push(xform(tint(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 10), 0x232323), 0, 3.25, 0));
    return g;
  },
  candycane: () => {
    const g = [];
    for (let i = 0; i < 6; i++) {
      g.push(xform(tint(new THREE.CylinderGeometry(0.14, 0.14, 0.5, 8), i % 2 ? 0xe63946 : 0xffffff), 0, 0.25 + i * 0.5, 0));
    }
    g.push(xform(tint(new THREE.TorusGeometry(0.3, 0.14, 6, 10, Math.PI), 0xe63946), 0.3, 2.95, 0, 0, 0, 0));
    return g;
  },
  mangrove: (r) => {
    const g = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r();
      g.push(xform(tint(new THREE.CylinderGeometry(0.12, 0.2, 2.6, 5), 0x5a4632), Math.cos(a) * 0.9, 1.1, Math.sin(a) * 0.9, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5));
    }
    const s = 1.6 + r();
    g.push(xform(tint(new THREE.IcosahedronGeometry(s, 0), 0x3a5f2a), 0, 3 + s * 0.4, 0));
    g.push(xform(tint(new THREE.IcosahedronGeometry(s * 0.7, 0), 0x466e33), 0.8, 2.6 + s * 0.5, 0.5));
    return g;
  },
  mushroom: (r) => {
    const g = [], c = r() > 0.5 ? 0xe63946 : 0xf4a261;
    g.push(xform(tint(new THREE.CylinderGeometry(0.16, 0.24, 0.9, 7), 0xf5e6c8), 0, 0.45, 0));
    g.push(xform(tint(new THREE.SphereGeometry(0.55, 10, 8, 0, Math.PI * 2, 0, 1.6), c), 0, 0.85, 0));
    return g;
  },
  glowshroom: (r) => {
    const g = [], c = [0x66ffd9, 0xff8ae2, 0x8ab6ff][(r() * 3) | 0];
    g.push(xform(tint(new THREE.CylinderGeometry(0.14, 0.22, 0.8, 7), 0xd8e4ff), 0, 0.4, 0));
    g.push(xform(tint(new THREE.SphereGeometry(0.5, 10, 8, 0, Math.PI * 2, 0, 1.6), c), 0, 0.75, 0));
    return g;
  },
  crystal: (r) => {
    const c = [0xb892ff, 0x8ab6ff, 0x66ffd9][(r() * 3) | 0];
    const g = [xform(tint(new THREE.OctahedronGeometry(0.8 + r() * 0.6, 0), c), 0, 1, 0, 0, r() * 3, 0, 1)];
    g[0].scale(new THREE.Vector3(1, 1.8, 1));
    g[0].translate(0, 0.2, 0);
    return g;
  },
  starpole: (r) => {
    const g = [xform(tint(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), 0x2b3252), 0, 1.6, 0)];
    g.push(xform(tint(new THREE.OctahedronGeometry(0.4, 0), 0xffe95e), 0, 3.4, 0));
    return g;
  },
  logwood: (r) => [xform(tint(new THREE.CylinderGeometry(0.45, 0.5, 2.6 + r() * 1.5, 7), 0x5a4632), 0, 0.45, 0, 0, r() * 3, Math.PI / 2)],
  cattail: (r) => {
    const g = [];
    for (let i = 0; i < 4; i++) {
      const x = (r() - 0.5) * 0.8, z = (r() - 0.5) * 0.8;
      g.push(xform(tint(new THREE.CylinderGeometry(0.03, 0.04, 1.6, 4), 0x5a7a3a), x, 0.8, z));
      g.push(xform(tint(new THREE.CapsuleGeometry(0.08, 0.3, 4, 6), 0x6f4a26), x, 1.6, z));
    }
    return g;
  },
  mesa: (r) => {
    const h = 8 + r() * 6, w = 6 + r() * 5;
    return [xform(tint(new THREE.CylinderGeometry(w, w * 1.3, h, 9), [0xb25a3a, 0xc96f4a][(r() * 2) | 0]), 0, h / 2, 0, 0, r() * 3, 0)];
  },
  arch: (r) => {
    const c = 0xc96f4a;
    const g = [
      xform(tint(new THREE.BoxGeometry(2, 7, 2), c), -3.5, 3.5, 0, 0, 0, 0.08),
      xform(tint(new THREE.BoxGeometry(2, 6.2, 2), c), 3.5, 3.1, 0, 0, 0, -0.1),
      xform(tint(new THREE.BoxGeometry(8.6, 1.6, 2.2), c), 0, 6.6, 0, 0, 0, 0.03),
    ];
    return g;
  },
  barn: (r) => {
    const g = [];
    g.push(xform(tint(new THREE.BoxGeometry(5, 3, 4), 0xc0392b), 0, 1.5, 0));
    g.push(xform(tint(new THREE.ConeGeometry(3.9, 2, 4), 0x7f8c8d), 0, 4, 0, 0, Math.PI / 4, 0));
    g.push(xform(tint(new THREE.BoxGeometry(1.6, 2.2, 0.16), 0xffffff), 0, 1.1, 2.02));
    g.push(xform(tint(new THREE.BoxGeometry(1.2, 1.5, 0.2), 0x6f4a26), 0, 0.75, 2.06));
    return g;
  },
  hay: (r) => [xform(tint(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 10), 0xe0c068), 0, 0.8, 0, 0, 0, Math.PI / 2)],
  sunflower: (r) => {
    const g = [xform(tint(new THREE.CylinderGeometry(0.04, 0.05, 1.7, 4), 0x4a7a2a), 0, 0.85, 0)];
    g.push(xform(tint(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 10), 0xffd23f), 0, 1.7, 0.05, Math.PI / 2 - 0.2, 0, 0));
    g.push(xform(tint(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 8), 0x6f4a26), 0, 1.7, 0.1, Math.PI / 2 - 0.2, 0, 0));
    return g;
  },
  windmill: (r) => {
    const g = [];
    g.push(xform(tint(new THREE.CylinderGeometry(0.5, 0.9, 6, 4), 0xa07850), 0, 3, 0, 0, Math.PI / 4, 0));
    g.push(xform(tint(new THREE.ConeGeometry(1, 1, 4), 0xc0392b), 0, 6.4, 0, 0, Math.PI / 4, 0));
    return g;
  },
};

// ═══════════════════════════ TRACK WORLD ════════════════════════════════════

export function buildTrackWorld(map) {
  const theme = THEMES[map.theme];
  const rng = mulberry32(map.seed);
  const group = new THREE.Group();
  const userData = { balloons: [], clouds: [], itemBoxes: [], coins: [], theme };

  // ── 1. control points + curve ──
  const nc = 13 + Math.floor(rng() * 5);
  const baseR = 95 + rng() * 35;
  const hillAmp = { 0: 0.35, 1: 0.8, 2: 0.5, 3: 0.3, 4: 1.1, 5: 0.9, 6: 0.4, 7: 1.0, 8: 0.6, 9: 0.7 }[map.theme] || 0.6;
  const pts = [];
  for (let i = 0; i < nc; i++) {
    const a = (i / nc) * Math.PI * 2;
    const rad = baseR + (rng() - 0.5) * 2 * 42;
    const y = Math.max(0, (rng() - 0.35) * 14 * hillAmp);
    pts.push(V3(Math.cos(a) * rad, y, Math.sin(a) * rad));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

  // ── 2. samples ──
  const N = 480;
  const samples = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    tan.y = 0; tan.normalize();
    const right = V3(tan.z, 0, -tan.x).normalize().negate(); // right side of forward
    samples.push({ p, tan, right, y: p.y });
  }
  const length = curve.getLength();

  // ── 3. road ribbon ──
  const roadHalf = 7.5;
  {
    const pos = [], uv = [], idx = [];
    let dist = 0;
    for (let i = 0; i <= N; i++) {
      const s = samples[i % N];
      if (i > 0) dist += samples[(i - 1) % N].p.distanceTo(samples[i % N].p);
      const c = s.p, r = s.right;
      const lift = 0.14;
      pos.push(
        c.x - r.x * (roadHalf + 2.6), s.y - 0.45, c.z - r.z * (roadHalf + 2.6),
        c.x - r.x * roadHalf, s.y + lift, c.z - r.z * roadHalf,
        c.x + r.x * roadHalf, s.y + lift, c.z + r.z * roadHalf,
        c.x + r.x * (roadHalf + 2.6), s.y - 0.45, c.z + r.z * (roadHalf + 2.6),
      );
      const v = dist / 16;
      uv.push(-0.18, v, 0, v, 1, v, 1.18, v);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 4, b = (i + 1) * 4;
      // CCW winding = faces UP
      idx.push(a, a + 1, b, b, a + 1, b + 1);             // left skirt
      idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2); // road
      idx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3); // right skirt
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const roadTex = TEX.roadTexture(theme.road, map.seed);
    const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: roadTex }));
    road.receiveShadow = true;
    group.add(road);
  }

  // finish line
  {
    const s = samples[0];
    const geo = new THREE.PlaneGeometry(roadHalf * 2, 3);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: TEX.checkerTexture() }));
    m.position.set(s.p.x, s.y + 0.17, s.p.z);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(s.tan.x, s.tan.z);
    group.add(m);
  }

  // ── 4. terrain ──
  const SIZE = 1500;
  {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, 100, 100);
    geo.rotateX(-Math.PI / 2);
    const posA = geo.attributes.position;
    const colors = new Float32Array(posA.count * 3);
    const c1 = new THREE.Color(theme.ground[0]), c2 = new THREE.Color(theme.ground[1]);
    const sand = new THREE.Color('#f2e3b0');
    const nrRng = mulberry32(map.seed + 9);
    const no1 = nrRng() * 10, no2 = nrRng() * 10, no3 = nrRng() * 10;
    const isIsland = !!theme.water && map.theme !== 6;
    const islandR = baseR + 90;
    const heightsAtSamples = samples.filter((_, i) => i % 4 === 0).map((s) => s.p);

    const amp = { 0: 5, 1: 9, 2: 9, 3: 3, 4: 10, 5: 10, 6: 3.5, 7: 11, 8: 5, 9: 6 }[map.theme] || 6;
    for (let i = 0; i < posA.count; i++) {
      const x = posA.getX(i), z = posA.getZ(i);
      let h = (Math.sin(x * 0.021 + no1) * Math.cos(z * 0.019 + no2) * 0.55 +
        Math.sin(x * 0.053 + no3) * Math.sin(z * 0.047 + no1) * 0.3 +
        Math.sin((x + z) * 0.013 + no2) * 0.35) * amp;
      // distance to track (coarse)
      let dmin = 1e9, nearY = 0;
      for (let j = 0; j < heightsAtSamples.length; j++) {
        const dx = heightsAtSamples[j].x - x, dz = heightsAtSamples[j].z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < dmin) { dmin = d2; nearY = heightsAtSamples[j].y; }
      }
      const d = Math.sqrt(dmin);
      const mask = THREE.MathUtils.smoothstep(d, 14, 60);
      h = lerp(nearY - 0.55, h, mask);
      if (isIsland) {
        const rr = Math.sqrt(x * x + z * z);
        const w = 1 - THREE.MathUtils.smoothstep(rr, islandR, islandR + 90);
        if (w < 1) h = lerp(-9, Math.max(h, -9), w) - (1 - w) * 2;
      }
      posA.setY(i, h);
      // colors
      const nz = 0.5 + 0.5 * Math.sin(x * 0.09 + no3) * Math.cos(z * 0.08 + no1);
      const col = c1.clone().lerp(c2, nz);
      if (theme.water && h < 0.35) col.lerp(sand, clamp((0.35 - h) * 2.2, 0, 1) * 0.85);
      if (map.theme === 4 && nz < 0.3) col.lerp(new THREE.Color('#cfe0ee'), 0.4);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terr = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    terr.receiveShadow = true;
    group.add(terr);
  }

  // ── 5. water / lava ──
  if (theme.water) {
    const isLava = map.theme === 5;
    const wmat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(theme.water), shininess: 90, transparent: true, opacity: 0.9,
      emissive: isLava ? new THREE.Color(0xff4400) : new THREE.Color(0x003355),
      emissiveIntensity: isLava ? 0.9 : 0.25,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), wmat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.75;
    group.add(water);
    userData.water = water;
  }

  // ── 6. sky, sun, clouds, stars ──
  {
    const skyGeo = new THREE.SphereGeometry(1100, 20, 14);
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: TEX.skyTexture(theme), side: THREE.BackSide, fog: false, depthWrite: false }));
    group.add(sky);
    if (theme.night) {
      const stars = new THREE.Mesh(new THREE.SphereGeometry(1050, 20, 14),
        new THREE.MeshBasicMaterial({ map: TEX.starsTexture(), side: THREE.BackSide, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      group.add(stars);
    }
    const sunDir = V3(0.5, 0.7, 0.35).normalize();
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glowTexture(), color: new THREE.Color(theme.sun[0]), transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sun.position.copy(sunDir).multiplyScalar(950);
    sun.scale.setScalar(theme.night ? 90 : 220);
    group.add(sun);
    userData.sunDirWorld = sunDir;
    // clouds
    const cloudTex = TEX.cloudTexture();
    const nc2 = theme.night ? 4 : 9;
    for (let i = 0; i < nc2; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: theme.night ? 0.25 : 0.85, fog: false, depthWrite: false }));
      const a = rng() * Math.PI * 2, rr = 250 + rng() * 500;
      sp.position.set(Math.cos(a) * rr, 90 + rng() * 90, Math.sin(a) * rr);
      sp.scale.set(140 + rng() * 160, 60 + rng() * 60, 1);
      sp.userData.drift = 1.2 + rng() * 2;
      group.add(sp);
      userData.clouds.push(sp);
    }
  }

  // ── 7. decor (merged) ──
  {
    const geos = [];
    const decorList = theme.decor;
    const place = (propFn, x, y, z, s, ry) => {
      for (const gg of propFn(rng)) {
        gg.scale(new THREE.Vector3(s, s, s));
        gg.rotateY(ry);
        gg.translate(x, y, z);
        geos.push(gg);
      }
    };
    // along track
    const step = Math.floor(N / 42);
    for (let i = 6; i < N; i += step) {
      const s = samples[i];
      const propName = decorList[(rng() * decorList.length) | 0];
      const side = rng() > 0.5 ? 1 : -1;
      const off = roadHalf + 5 + rng() * 26;
      const x = s.p.x + s.right.x * off * side;
      const z = s.p.z + s.right.z * off * side;
      const big = propName === 'mesa' || propName === 'house' || propName === 'barn' || propName === 'bigtree' || propName === 'arch' || propName === 'bones';
      place(PROPS[propName] || PROPS.rock, x, s.y - 0.3, z, big ? 1 + rng() * 0.7 : 0.7 + rng() * 0.9, rng() * Math.PI * 2);
      // sometimes a second item opposite side
      if (rng() > 0.55) {
        const p2 = decorList[(rng() * decorList.length) | 0];
        const off2 = roadHalf + 5 + rng() * 22;
        place(PROPS[p2] || PROPS.rock, s.p.x - s.right.x * off2 * side, s.y - 0.3, s.p.z - s.right.z * off2 * side, 0.7 + rng() * 0.8, rng() * Math.PI * 2);
      }
    }
    // far scatter
    for (let i = 0; i < 60; i++) {
      const a = rng() * Math.PI * 2;
      const rr = baseR + 90 + rng() * 260;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const propName = decorList[(rng() * decorList.length) | 0];
      place(PROPS[propName] || PROPS.rock, x, Math.max(0, (rng() - 0.4) * 6) - 0.4, z, 0.8 + rng() * 1.4, rng() * Math.PI * 2);
    }
    // mountain ring
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + rng() * 0.4;
      const rr = 420 + rng() * 160;
      const mCol = new THREE.Color(theme.ground[1]).multiplyScalar(0.8).getHex();
      const hh = 90 + rng() * 130, ww = 90 + rng() * 90;
      geos.push(xform(tint(new THREE.ConeGeometry(ww, hh, 7), mCol), Math.cos(a) * rr, hh / 2 - 12, Math.sin(a) * rr));
      if (map.theme === 4) {
        geos.push(xform(tint(new THREE.ConeGeometry(ww * 0.35, hh * 0.35, 7), 0xffffff), Math.cos(a) * rr, hh * 0.83 - 12, Math.sin(a) * rr));
      }
    }
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── 8. start arch + banner + flags ──
  {
    const s = samples[0];
    const archG = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 9, 8), poleMat);
      pole.position.set(s.right.x * side * (roadHalf + 1), 4.5, s.right.z * side * (roadHalf + 1));
      pole.castShadow = true;
      archG.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshBasicMaterial({ map: TEX.flagTexture(), side: THREE.DoubleSide }));
      flag.position.set(s.right.x * side * (roadHalf + 1), 8.6, s.right.z * side * (roadHalf + 1));
      flag.rotation.y = Math.atan2(s.tan.x, s.tan.z) + 0.5;
      archG.add(flag);
      userData['flag' + side] = flag;
    }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(roadHalf * 2 + 2, 2.2),
      new THREE.MeshBasicMaterial({ map: TEX.bannerTexture(map.name), side: THREE.DoubleSide }));
    banner.position.set(0, 8.2, 0);
    banner.rotation.y = Math.atan2(s.tan.x, s.tan.z);
    archG.add(banner);
    archG.position.set(s.p.x, s.y, s.p.z);
    group.add(archG);
  }

  // ── 9. item boxes ──
  {
    const boxTex = TEX.itemBoxTexture();
    const glowTex = TEX.glowTexture('rgba(255,140,255,1)', 'rgba(200,60,255,0)');
    const boxMat = new THREE.MeshStandardMaterial({ map: boxTex, emissive: 0xa64ddb, emissiveIntensity: 0.55 });
    const rows = [0.14, 0.28, 0.45, 0.60, 0.76, 0.90];
    for (const f of rows) {
      const idxAt = Math.floor(f * N);
      for (const lat of [-3.6, 0, 3.6]) {
        if (rng() < 0.18) continue;
        const s = samples[idxAt];
        const bg = new THREE.Group();
        const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), boxMat);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.setScalar(4);
        bg.add(cube, glow);
        bg.position.set(s.p.x + s.right.x * lat, s.y + 1.6, s.p.z + s.right.z * lat);
        bg.userData = { idx: idxAt, lat, takenT: 0, baseY: s.y + 1.6 };
        group.add(bg);
        userData.itemBoxes.push(bg);
      }
    }
  }

  // ── 10. coins ──
  {
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.85, roughness: 0.2, emissive: 0x8a6d00, emissiveIntensity: 0.4 });
    const coinGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.14, 18);
    for (let r2 = 0; r2 < 6; r2++) {
      const startIdx = Math.floor((0.08 + r2 * 0.155) * N);
      const lat = [-3, 0, 3][(rng() * 3) | 0];
      for (let k = 0; k < 5; k++) {
        const idxAt = (startIdx + k * 3) % N;
        const s = samples[idxAt];
        const c = new THREE.Mesh(coinGeo, coinMat);
        c.rotation.x = Math.PI / 2;
        const cg = new THREE.Group();
        cg.add(c);
        cg.position.set(s.p.x + s.right.x * lat, s.y + 1.1, s.p.z + s.right.z * lat);
        cg.userData = { idx: idxAt, lat, takenT: 0 };
        group.add(cg);
        userData.coins.push(cg);
      }
    }
  }

  // ── 11. hot air balloons ──
  {
    const nBal = 2 + Math.floor(rng() * 2);
    const cols = ['#e63946', '#38bdf8', '#ffd23f', '#84cc16', '#ff70a6'];
    for (let i = 0; i < nBal; i++) {
      const bg = new THREE.Group();
      const tex = TEX.balloonTexture(cols[(rng() * 5) | 0], cols[(rng() * 5) | 0]);
      const env = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshLambertMaterial({ map: tex }));
      env.scale.y = 1.15;
      const basket = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.6), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
      basket.position.y = -7;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        bg.add(tube(V3(sx * 0.7, -6.3, sz * 0.7), V3(sx * 2.4, -3.4, sz * 2.4), 0.05, new THREE.MeshLambertMaterial({ color: 0x4a3728 }), 4));
      }
      bg.add(env, basket);
      const a = rng() * Math.PI * 2;
      bg.position.set(Math.cos(a) * (baseR * 0.5 + rng() * baseR), 45 + rng() * 35, Math.sin(a) * (baseR * 0.5 + rng() * baseR));
      bg.userData = { bobPhase: rng() * 9, driftA: a, baseY: bg.position.y };
      group.add(bg);
      userData.balloons.push(bg);
    }
  }

  return { group, samples, N, roadHalf, length, curve, userData, theme, sunDir: V3(0.5, 0.7, 0.35).normalize() };
}

// ═══════════════════════════ GARAGE ═════════════════════════════════════════

export function buildGarageWorld() {
  const g = new THREE.Group();
  const userData = { balloons: [], clouds: [] };
  const rng = mulberry32(12345);

  // sand
  const sand = new THREE.Mesh(new THREE.CircleGeometry(700, 48), new THREE.MeshLambertMaterial({ color: 0xecd9a0 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.05;
  sand.receiveShadow = true;
  g.add(sand);

  // sea
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshPhongMaterial({ color: 0x1e90c8, shininess: 90, transparent: true, opacity: 0.92 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.7;
  g.add(sea);

  // cobble platform
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.8, 0.55, 36),
    new THREE.MeshLambertMaterial({ map: TEX.roadTexture({ type: 'cobble', base: '#b7a58c', edge: '#d6c9ae', line: '#b7a58c' }, 7) }));
  plat.position.y = 0.27;
  plat.receiveShadow = true;
  g.add(plat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.28, 10, 36), new THREE.MeshLambertMaterial({ color: 0x8f8168 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.5;
  g.add(rim);

  // car & driver anchors
  const carAnchor = new THREE.Group();
  carAnchor.position.y = 0.55;
  g.add(carAnchor);
  const driverAnchor = new THREE.Group();
  driverAnchor.position.set(4.6, 0.55, 2.2);
  driverAnchor.rotation.y = -0.6;
  g.add(driverAnchor);

  // palms
  const palmGeos = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const rr = 10 + rng() * 14;
    for (const gg of PROPS.palm(rng)) {
      gg.scale(new THREE.Vector3(1.1, 1.1, 1.1));
      gg.translate(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      palmGeos.push(gg);
    }
  }
  // cabana house
  for (const gg of PROPS.house(rng)) { gg.scale(new THREE.Vector3(1.5, 1.5, 1.5)); gg.rotateY(2.4); gg.translate(-14, 0, -10); palmGeos.push(gg); }
  for (const gg of PROPS.awning(rng)) { gg.rotateY(-2.2); gg.translate(-9.5, 0, -4); palmGeos.push(gg); }
  for (const gg of PROPS.crate(rng)) { gg.translate(-7, 0, -3); palmGeos.push(gg); }
  for (const gg of PROPS.surf(rng)) { gg.translate(-6.6, 0, -8.6); palmGeos.push(gg); }
  for (const gg of PROPS.surf(rng)) { gg.translate(8.5, 0, -7.5); palmGeos.push(gg); }
  for (const gg of PROPS.lantern(rng)) { gg.translate(5, 0, -7); palmGeos.push(gg); }
  for (const gg of PROPS.lantern(rng)) { gg.translate(-5, 0, 7); palmGeos.push(gg); }
  for (const gg of PROPS.palm(rng)) { gg.translate(12, 0, -14); palmGeos.push(gg); }
  const decor = new THREE.Mesh(mergeGeometries(palmGeos, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  decor.castShadow = true;
  decor.receiveShadow = true;
  g.add(decor);

  // string lights between poles
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const x = lerp(5, -5, t), z = lerp(-7, 7, t);
    const y = 3.2 - Math.sin(t * Math.PI) * 0.8;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), lightMat);
    bulb.position.set(x, y, z);
    g.add(bulb);
  }

  // sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 20, 14),
    new THREE.MeshBasicMaterial({ map: TEX.skyTexture(THEMES[0]), side: THREE.BackSide, fog: false, depthWrite: false }));
  g.add(sky);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowTexture(), color: 0xfff2c0, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  sun.position.set(300, 380, 200);
  sun.scale.setScalar(200);
  g.add(sun);
  const cloudTex = TEX.cloudTexture();
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    const a = rng() * Math.PI * 2;
    sp.position.set(Math.cos(a) * (200 + rng() * 300), 70 + rng() * 90, Math.sin(a) * (200 + rng() * 300));
    sp.scale.set(120 + rng() * 120, 50 + rng() * 50, 1);
    sp.userData.drift = 1 + rng() * 1.5;
    g.add(sp);
    userData.clouds.push(sp);
  }
  // balloons
  for (let i = 0; i < 2; i++) {
    const bg = new THREE.Group();
    const tex = TEX.balloonTexture(i ? '#e63946' : '#38bdf8', '#ffd23f');
    const env = new THREE.Mesh(new THREE.SphereGeometry(4, 14, 10), new THREE.MeshLambertMaterial({ map: tex }));
    env.scale.y = 1.15;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.3), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
    basket.position.y = -5.6;
    bg.add(env, basket);
    bg.position.set(i ? -120 : 150, 40 + i * 14, i ? -140 : -90);
    bg.userData = { bobPhase: i * 3, baseY: bg.position.y };
    g.add(bg);
    userData.balloons.push(bg);
  }

  return { group: g, carAnchor, driverAnchor, userData, theme: THEMES[0], sunDir: V3(0.5, 0.7, 0.35).normalize() };
}
