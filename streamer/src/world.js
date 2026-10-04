// ---------- world: town, houses, interiors, cars, NPCs ----------
import * as THREE from 'three';
import { mulberry32 } from './util.js';
import * as TX from './tex.js';
import { HOUSES, CARS } from './data.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildWorld(scene) {
  const W = {
    collidersBox: [], collidersCirc: [], interact: [], npcs: [], cars: {},
    windowMats: [], lampMats: [], houses: {}, interiors: {},
  };
  const rng = mulberry32(42);
  const add = (m) => scene.add(m);

  const box = (w, h, d, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    add(m); return m;
  };

  // ---------------- ground & roads ----------------
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ map: TX.texGrass() }));
  grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; add(grass);

  const mapX = TX.texAsphalt(); mapX.rotation = Math.PI / 2; mapX.center.set(0.5, 0.5); mapX.repeat.set(12, 1);
  const roadX = new THREE.Mesh(new THREE.PlaneGeometry(300, 8), new THREE.MeshStandardMaterial({ map: mapX }));
  roadX.rotation.x = -Math.PI / 2; roadX.position.y = 0.02; roadX.receiveShadow = true;
  add(roadX);
  const mapZ = TX.texAsphalt(); mapZ.repeat.set(1, 12);
  const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(8, 300), new THREE.MeshStandardMaterial({ map: mapZ }));
  roadZ.rotation.x = -Math.PI / 2; roadZ.position.y = 0.02; roadZ.receiveShadow = true;
  add(roadZ);

  const swMat = new THREE.MeshStandardMaterial({ map: TX.texSidewalk() });
  for (const s of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const horiz = s[0] !== 0;
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? 300 : 5, horiz ? 5 : 300), swMat);
    sw.rotation.x = -Math.PI / 2; sw.position.set(horiz ? 0 : s[0] * 6.5, 0.03, horiz ? s[1] * 6.5 : 0);
    sw.receiveShadow = true; add(sw);
  }
  // crosswalks
  const cwMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  for (const [px, pz, horiz] of [[0, 6.5, 1], [0, -6.5, 1], [6.5, 0, 0], [-6.5, 0, 0]]) {
    for (let i = -3; i <= 3; i++) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? 0.7 : 2.4, horiz ? 2.4 : 0.7), cwMat);
      st.rotation.x = -Math.PI / 2; st.position.set(px + (horiz ? i * 1.1 : 0), 0.04, pz + (horiz ? 0 : i * 1.1));
      add(st);
    }
  }

  // ---------------- trees (instanced pines) ----------------
  const treePts = [];
  for (let i = 0; i < 340; i++) {
    const a = rng() * Math.PI * 2, r = 70 + rng() * 130;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 12 || Math.abs(z) < 12) continue;
    treePts.push([x, z, 0.8 + rng() * 0.9]);
  }
  for (let i = 0; i < 40; i++) treePts.push([-16 + (rng() - 0.5) * 50, 64 + (rng() - 0.5) * 40 + 14, 0.8 + rng() * 0.8]);
  const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6);
  const leafG = new THREE.ConeGeometry(1.6, 5.2, 7);
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a4028 });
  const leafM = new THREE.MeshStandardMaterial({ color: 0x2d4a26 });
  const trunks = new THREE.InstancedMesh(trunkG, trunkM, treePts.length);
  const leaves = new THREE.InstancedMesh(leafG, leafM, treePts.length);
  const M4 = new THREE.Matrix4();
  treePts.forEach(([x, z, s], i) => {
    M4.makeTranslation(x, 1.2 * s, z); M4.scale(V3(s, s, s)); trunks.setMatrixAt(i, M4);
    M4.makeTranslation(x, (2.4 + 2.2) * s, z); M4.scale(V3(s, s, s)); leaves.setMatrixAt(i, M4);
    trunks.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
    W.collidersCirc.push({ x, z, r: 0.4 * s });
  });
  trunks.castShadow = leaves.castShadow = true;
  add(trunks); add(leaves);

  // ---------------- street props ----------------
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a });
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe9b0, emissiveIntensity: 0 });
  W.lampMats.push(lampHeadMat);
  const lampAt = (x, z) => {
    box(0.15, 5, 0.15, poleMat, x, 2.5, z);
    box(1.2, 0.12, 0.12, poleMat, x + (x > 0 ? -0.6 : 0.6), 4.9, z);
    const h = box(0.5, 0.15, 0.25, lampHeadMat, x + (x > 0 ? -1.1 : 1.1), 4.85, z, false);
  };
  [[7, 7], [-7, 7], [7, -7], [-7, -7], [40, 7], [-40, 7], [40, -7], [-40, -7], [7, 40], [-7, -40]].forEach(p => lampAt(p[0], p[1]));

  // utility poles + wires along main road
  const woodMat = new THREE.MeshStandardMaterial({ map: TX.texWood('#5d4526', 60) });
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const poles = [];
  for (let x = -120; x <= 120; x += 30) {
    if (Math.abs(x) < 12) continue;
    box(0.14, 6, 0.14, woodMat, x, 3, -8.6);
    box(1.4, 0.1, 0.1, woodMat, x, 5.6, -8.6);
    poles.push([x, -8.6]);
  }
  for (let i = 0; i < poles.length - 1; i++) {
    const [x1, z1] = poles[i], [x2] = poles[i + 1];
    if (x2 - x1 > 32) continue;
    const len = x2 - x1;
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 4), wireMat);
    w.rotation.z = Math.PI / 2; w.position.set((x1 + x2) / 2, 5.6, z1); add(w);
  }

  // road signs
  const signPost = (x, z, kind) => {
    box(0.08, 2, 0.08, poleMat, x, 1, z);
    const t = TX.texRoadSign(kind);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshStandardMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
    m.position.set(x, 2.1, z); add(m);
  };
  signPost(58, 5.5, 'curve'); signPost(-58, -5.5, 'curve');
  signPost(9, 9, 'ped'); signPost(-9, -9, 'ped');

  // guardrail west side
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
  for (let x = -120; x < -70; x += 4) {
    box(0.1, 0.7, 0.1, poleMat, x, 0.35, 5.2);
  }
  box(50, 0.25, 0.08, railMat, -95, 0.75, 5.2);

  // ---------------- buildings ----------------
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1c2a33, emissive: 0xffd98a, emissiveIntensity: 0, roughness: 0.2 });
  W.windowMats.push(winMat);

  function gableHouse(w, d, h, wallTex, roofCol, x, z, rotY = 0) {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: wallTex }));
    walls.position.y = h / 2; walls.castShadow = walls.receiveShadow = true; g.add(walls);
    const roofM = new THREE.MeshStandardMaterial({ map: TX.texRoof(roofCol) });
    const rw = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.15, Math.hypot(d / 2 + 0.5, h * 0.55)), roofM);
    const ang = Math.atan2(h * 0.55, d / 2 + 0.4);
    const r1 = rw.clone(); r1.rotation.x = ang; r1.position.set(0, h + h * 0.27, -(d / 4 + 0.1)); r1.castShadow = true;
    const r2 = rw.clone(); r2.rotation.x = -ang; r2.position.set(0, h + h * 0.27, (d / 4 + 0.1)); r2.castShadow = true;
    g.add(r1, r2);
    // gable triangles
    const tri = new THREE.Shape(); tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, h * 0.55); tri.closePath();
    const triG = new THREE.ShapeGeometry(tri);
    const t1 = new THREE.Mesh(triG, new THREE.MeshStandardMaterial({ map: wallTex })); t1.position.set(0, h, d / 2 + 0.01);
    const t2 = t1.clone(); t2.position.z = -d / 2 - 0.01; t2.rotation.y = Math.PI;
    g.add(t1, t2);
    // door + windows on +z face
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.1), new THREE.MeshStandardMaterial({ map: TX.texWood('#4a3524', 40) }));
    door.position.set(0, 1.05, d / 2 + 0.06); g.add(door);
    for (const wx of [-w / 4 - 0.4, w / 4 + 0.4]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), winMat);
      win.position.set(wx, 1.5, d / 2 + 0.07); g.add(win);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 0.08), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      frame.position.set(wx, 1.5, d / 2 + 0.03); g.add(frame);
    }
    g.position.set(x, 0, z); g.rotation.y = rotY;
    add(g);
    W.collidersBox.push({ x, z, hx: (Math.abs(Math.cos(rotY)) * w + Math.abs(Math.sin(rotY)) * d) / 2 + 0.3, hz: (Math.abs(Math.sin(rotY)) * w + Math.abs(Math.cos(rotY)) * d) / 2 + 0.3 });
    return g;
  }

  // Homestead Foods (shop)
  {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(24, 6, 14), new THREE.MeshStandardMaterial({ map: TX.texSiding('#c9c2b2') }));
    body.position.y = 3; body.castShadow = body.receiveShadow = true; g.add(body);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(24.4, 2.2, 0.4), new THREE.MeshStandardMaterial({ map: TX.texSign('HOMESTEAD FOODS', '#e8b71a', '#c02818', 'GROCERY & SUPPLIES') }));
    fascia.position.set(0, 4.6, 7.1); g.add(fascia);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(20, 0.15, 2.2), new THREE.MeshStandardMaterial({ color: 0xd87818 }));
    awning.position.set(0, 3.4, 8); awning.rotation.x = 0.15; g.add(awning);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), winMat);
    glass.position.set(0, 1.6, 7.06); g.add(glass);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.15), new THREE.MeshStandardMaterial({ color: 0x334455 }));
    door.position.set(8, 1.3, 7.05); g.add(door);
    g.position.set(24, 0, -20); add(g);
    W.collidersBox.push({ x: 24, z: -20, hx: 12.4, hz: 7.4 });
    W.interact.push({ type: 'shopdoor', pos: V3(32, 1.2, -12.5), label: 'Homestead Foods', get: () => '🔒 Closed — the whole town shops online anyway' });
  }

  // barn
  {
    const g = gableHouse(12, 10, 4.5, TX.texWood('#5a3a2a'), '#3a2a20', 48, -40);
    W.interact.push({ type: 'flavor', pos: V3(48, 1.2, -34.5), get: () => 'Old barn. Smells like hay and secrets.' });
  }

  // houses (buyable)
  const houseDefs = {
    cabin: () => gableHouse(8, 7, 3.4, TX.texWood('#7a5a3a'), '#4a3524', -26, -24),
    redhouse: () => gableHouse(10, 8, 4, TX.texSiding('#8a3a30'), '#3a2a24', 26, 26, Math.PI),
    villa: () => gableHouse(14, 10, 5, TX.texSiding('#b8b0a0'), '#4a4038', -40, -34, Math.PI / 2),
  };
  for (const h of HOUSES) {
    if (h.id === 'trailer') continue;
    houseDefs[h.id]();
    const rot = h.id === 'villa' ? Math.PI / 2 : (h.id === 'redhouse' ? Math.PI : 0);
    const doorOff = V3(0, 0, 1).applyAxisAngle(V3(0, 1, 0), rot);
    const dp = V3(h.pos[0] + doorOff.x * 5.6, 1.2, h.pos[1] + doorOff.z * 5.6);
    W.interact.push({ type: 'door', house: h.id, pos: dp });
    // for-sale sign
    const sp = V3(h.pos[0] + 4, 0, h.pos[1] + 6);
    box(0.1, 1.4, 0.1, woodMat, sp.x, 0.7, sp.z);
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: TX.texSign('FOR SALE', '#ffffff', '#1a7a2a', '$' + h.price.toLocaleString()), side: THREE.DoubleSide }));
    signM.position.set(sp.x, 1.5, sp.z); add(signM);
    W.houses[h.id] = { sign: signM };
    W.interact.push({ type: 'sign', house: h.id, pos: V3(sp.x, 1.2, sp.z) });
  }

  // trailer (starter home)
  {
    const g = new THREE.Group();
    const bodyM = new THREE.Mesh(new THREE.BoxGeometry(8, 2.8, 3.4), new THREE.MeshStandardMaterial({ map: TX.texSiding('#8a7f6a') }));
    bodyM.position.y = 1.7; bodyM.castShadow = true; g.add(bodyM);
    const roofM = new THREE.Mesh(new THREE.BoxGeometry(8.3, 0.2, 3.7), new THREE.MeshStandardMaterial({ color: 0x555555 }));
    roofM.position.y = 3.2; g.add(roofM);
    for (const wx of [-2.5, 0.8]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1), winMat); win.position.set(wx, 1.9, 1.72); g.add(win);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), new THREE.MeshStandardMaterial({ map: TX.texWood('#4a3524', 40) }));
    door.position.set(2.8, 1.5, 1.72); g.add(door);
    for (const wx of [-3, 3]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x222222 })); wh.rotation.x = Math.PI / 2; wh.position.set(wx, 0.5, 0); g.add(wh); }
    // steps
    box(1.2, 0.25, 0.8, woodMat, 2.8, 0.15, 2.4); box(1.2, 0.5, 0.5, woodMat, 2.8, 0.25, 2.0);
    g.position.set(-16, 0.3, 64); add(g);
    W.collidersBox.push({ x: -16, z: 64, hx: 4.3, hz: 2.1 });
    W.interact.push({ type: 'door', house: 'trailer', pos: V3(-13.2, 1.2, 66.2) });
    // dirt patch
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(9, 20), new THREE.MeshStandardMaterial({ color: 0x7a6a4f }));
    dirt.rotation.x = -Math.PI / 2; dirt.position.set(-14, 0.015, 66); add(dirt);
    // bicycle
    const bike = new THREE.Group();
    const wm = new THREE.MeshStandardMaterial({ color: 0x3aa02a });
    for (const bz of [-0.7, 0.7]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 16), new THREE.MeshStandardMaterial({ color: 0x111111 })); w.position.set(0, 0.42, bz); bike.add(w); }
    const fr = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), wm); fr.rotation.x = Math.PI / 2; fr.position.y = 0.7; bike.add(fr);
    const fr2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), wm); fr2.position.set(0, 1, 0.55); fr2.rotation.x = 0.6; bike.add(fr2);
    bike.position.set(-19.5, 0, 66.5); bike.rotation.y = 0.6; add(bike);
  }

  // RV camp
  {
    for (const [rx, rz, ry] of [[55, 62, 0.4], [63, 58, -0.8]]) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.6), new THREE.MeshStandardMaterial({ map: TX.texSiding('#c8c8c0') }));
      body.position.y = 1.6; body.castShadow = true; g.add(body);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.05, 0.4, 2.65), new THREE.MeshStandardMaterial({ color: 0xc04828 }));
      stripe.position.y = 1.4; g.add(stripe);
      for (const wx of [-1.8, 0.6]) { const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), winMat); win.position.set(wx, 1.9, 1.32); g.add(win); }
      g.position.set(rx, 0, rz); g.rotation.y = ry; add(g);
      W.collidersBox.push({ x: rx, z: rz, hx: 3.2, hz: 1.6 });
    }
    const fire = new THREE.Group();
    for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x666666 })); const a = i / 6 * Math.PI * 2; st.position.set(Math.cos(a) * 0.7, 0.15, Math.sin(a) * 0.7); fire.add(st); }
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 6), woodMat); log.rotation.z = Math.PI / 2; log.position.y = 0.25; fire.add(log);
    fire.position.set(58, 0, 66); add(fire);
  }

  // ---------------- cars ----------------
  function buildCar(def) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.4, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.4), paint);
    body.position.y = 0.75; body.castShadow = true; g.add(body);
    // cabin: pillars + roof + glass
    const glass = new THREE.MeshStandardMaterial({ color: 0x16222c, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.4 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 2.2), paint); roof.position.set(0, 1.85, -0.2); roof.castShadow = true; g.add(roof);
    for (const [px, pz] of [[-0.85, -1.25], [0.85, -1.25], [-0.85, 0.85], [0.85, 0.85]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), paint); p.position.set(px, 1.45, pz); g.add(p);
    }
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.8), glass); ws.position.set(0, 1.5, 0.92); ws.rotation.x = -0.35; g.add(ws);
    const bw = ws.clone(); bw.position.set(0, 1.5, -1.32); bw.rotation.x = 0.4; g.add(bw);
    for (const s of [-1, 1]) { const sw2 = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.7), glass); sw2.rotation.y = Math.PI / 2; sw2.position.set(s * 0.9, 1.5, -0.2); sw2.scale.z = 2.6; g.add(sw2); }
    // lights
    const hl = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff2b0, emissiveIntensity: 0.25 });
    const tl = new THREE.MeshStandardMaterial({ color: 0x881111, emissive: 0xff2222, emissiveIntensity: 0.2 });
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.08), hl); h.position.set(s * 0.65, 0.8, 2.21); g.add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.08), tl); t.position.set(s * 0.65, 0.8, -2.21); g.add(t);
    }
    // wheels
    const wheels = [];
    const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
    const wmat = new THREE.MeshStandardMaterial({ color: 0x151515 });
    for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
      const w = new THREE.Mesh(wg, wmat); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, wz); w.castShadow = true; g.add(w); wheels.push(w);
    }
    // interior: dash, wheel, seat, mirror
    const dark = new THREE.MeshStandardMaterial({ color: 0x202020 });
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 0.5), dark); dash.position.set(0, 1.15, 0.75); g.add(dash);
    const swheel = new THREE.Group();
    const tor = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 20), dark); swheel.add(tor);
    const sp1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.05), dark); swheel.add(sp1);
    swheel.position.set(-0.45, 1.25, 0.55); swheel.rotation.x = -0.5; g.add(swheel);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.6), new THREE.MeshStandardMaterial({ color: 0x3a3a42 }));
    seat.position.set(-0.45, 1.0, -0.1); g.add(seat);
    const seatB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.15), new THREE.MeshStandardMaterial({ color: 0x3a3a42 }));
    seatB.position.set(-0.45, 1.45, -0.35); g.add(seatB);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: 0x99aabb, metalness: 0.8, roughness: 0.1 }));
    mirror.position.set(0, 1.78, 0.85); g.add(mirror);

    g.position.set(def.pos[0], 0, def.pos[1]); g.rotation.y = def.rot;
    add(g);
    const car = { id: def.id, def, group: g, wheels, swheel, speed: 0, steer: 0, yaw: def.rot };
    W.cars[def.id] = car;
    W.interact.push({ type: 'car', car: def.id, pos: V3(def.pos[0], 1, def.pos[1]) });
    return car;
  }
  CARS.forEach(buildCar);

  // ---------------- interiors ----------------
  HOUSES.forEach((h, idx) => {
    const ox = 1000 + idx * 40, oz = 0;
    const g = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({ map: TX.texCarpet() }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const wp = new THREE.MeshStandardMaterial({ map: TX.texWallpaper() });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({ color: 0xd8d8d0 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 3; g.add(ceil);
    const wallN = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), wp); wallN.position.set(0, 1.5, -3.5); g.add(wallN);
    const wallS = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), wp.clone()); wallS.position.set(0, 1.5, 3.5); wallS.rotation.y = Math.PI; g.add(wallS);
    const wallE = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), wp.clone()); wallE.position.set(3.5, 1.5, 0); wallE.rotation.y = -Math.PI / 2; g.add(wallE);
    const wallW = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), wp.clone()); wallW.position.set(-3.5, 1.5, 0); wallW.rotation.y = Math.PI / 2; g.add(wallW);
    // door on south wall
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.12), new THREE.MeshStandardMaterial({ map: TX.texWood('#5a4028', 40) }));
    door.position.set(2.2, 1.1, 3.45); g.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshStandardMaterial({ color: 0xccaa44 }));
    knob.position.set(1.8, 1.1, 3.38); g.add(knob);
    // window east wall
    const iwin = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.3), new THREE.MeshStandardMaterial({ color: 0x9fc4dd, emissive: 0x9fc4dd, emissiveIntensity: 0.5 }));
    iwin.position.set(3.45, 1.7, -1); iwin.rotation.y = -Math.PI / 2; g.add(iwin);
    // desk + PC + chair (upgraded visuals applied later by pc.js via events)
    const desk = new THREE.Group(); desk.name = 'desk';
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1), new THREE.MeshStandardMaterial({ map: TX.texWood('#6a4a2e') }));
    deskTop.position.y = 0.78; desk.add(deskTop);
    for (const [lx, lz] of [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.78, 0.08), new THREE.MeshStandardMaterial({ map: TX.texWood('#5a3a20') }));
      l.position.set(lx, 0.39, lz); desk.add(l);
    }
    desk.position.set(0, 0, -2.8); g.add(desk);
    const pc = new THREE.Group(); pc.name = 'pc';
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, 0.6), new THREE.MeshStandardMaterial({ color: 0x2a2a2e }));
    tower.position.set(0.85, 1.17, -2.8); pc.add(tower);
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.06), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    monitor.name = 'monitor'; monitor.position.set(0, 1.25, -3.0); pc.add(monitor);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.47), new THREE.MeshStandardMaterial({ color: 0x0a2a4a, emissive: 0x1a4a7a, emissiveIntensity: 0.6 }));
    screen.name = 'screen'; screen.position.set(0, 1.25, -2.965); pc.add(screen);
    const mstand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    mstand.position.set(0, 0.92, -3.0); pc.add(mstand);
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.18), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    kb.position.set(0, 0.84, -2.6); pc.add(kb);
    g.add(pc);
    const chair = new THREE.Group(); chair.name = 'chair';
    const cseat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x4a3a28 }));
    cseat.position.y = 0.5; chair.add(cseat);
    const cback = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.08), new THREE.MeshStandardMaterial({ color: 0x4a3a28 }));
    cback.position.set(0, 0.85, 0.25); chair.add(cback);
    for (const [lx, lz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      l.position.set(lx, 0.25, lz); chair.add(l);
    }
    chair.position.set(0, 0, -1.9); g.add(chair);
    // ceiling lamp
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xfff2c0, emissiveIntensity: 1 }));
    lamp.position.set(0, 2.85, 0); g.add(lamp);
    const il = new THREE.PointLight(0xffe9c0, 12, 12, 1.8); il.position.set(0, 2.6, 0); g.add(il);

    g.position.set(ox, 0, oz); add(g);
    W.interiors[h.id] = {
      group: g, ox, oz,
      enterPos: V3(ox + 2.2, 1.7, oz + 2.4),
      exitPos: V3(ox + 2.2, 1.2, oz + 3.0),
      pcPos: V3(ox, 1.3, oz - 2.6),
      desk, chair, monitor, screen, pc,
    };
    W.interact.push({ type: 'pc', house: h.id, pos: V3(ox, 1.3, oz - 2.2) });
    W.interact.push({ type: 'exit', house: h.id, pos: V3(ox + 2.2, 1.2, oz + 3.1) });
  });

  // ---------------- NPCs ----------------
  const skins = [0xd8a878, 0xb07848, 0xe8c098, 0x906038];
  const shirts = [0xc07818, 0x2868a0, 0x782838, 0x287838, 0x784898, 0xa8a828];
  const paths = [
    [[8, 12], [30, 12], [30, -8], [8, -8]],
    [[-8, -12], [-24, -12], [-24, -8], [-8, -8]],
    [[12, 20], [12, 40], [20, 40], [20, 20]],
    [[-12, 16], [-12, 40], [-20, 44], [-20, 16]],
    [[24, -10], [36, -10], [36, -14], [24, -14]],
    [[-14, 60], [-20, 68], [-12, 70]],
  ];
  paths.forEach((path, i) => {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: skins[i % skins.length] });
    const shirt = new THREE.MeshStandardMaterial({ color: shirts[i % shirts.length] });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2a2a3a });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), shirt); torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 10), skin); head.position.y = 1.68; g.add(head);
    const mkLimb = (mat, w, len, x) => {
      const geo = new THREE.BoxGeometry(w, len, w); geo.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(geo, mat); m.position.set(x, 0, 0); m.castShadow = true; return m;
    };
    const armL = mkLimb(shirt, 0.12, 0.6, -0.33); armL.position.y = 1.45; g.add(armL);
    const armR = mkLimb(shirt, 0.12, 0.6, 0.33); armR.position.y = 1.45; g.add(armR);
    const legL = mkLimb(pants, 0.16, 0.8, -0.14); legL.position.y = 0.8; g.add(legL);
    const legR = mkLimb(pants, 0.16, 0.8, 0.14); legR.position.y = 0.8; g.add(legR);
    g.position.set(path[0][0], 0, path[0][1]);
    add(g);
    W.npcs.push({ group: g, armL, armR, legL, legR, path, wp: 1, t: rng() * 10, speed: 1 + rng() * 0.5 });
  });

  W.update = (dt, now) => {
    for (const n of W.npcs) {
      n.t += dt * n.speed;
      const target = V3(n.path[n.wp][0], 0, n.path[n.wp][1]);
      const d = target.clone().sub(n.group.position); d.y = 0;
      const dist = d.length();
      if (dist < 0.3) { n.wp = (n.wp + 1) % n.path.length; continue; }
      d.normalize();
      n.group.position.addScaledVector(d, dt * n.speed);
      const yaw = Math.atan2(d.x, d.z);
      n.group.rotation.y = yaw;
      const sw = Math.sin(n.t * 6) * 0.5;
      n.legL.rotation.x = sw; n.legR.rotation.x = -sw;
      n.armL.rotation.x = -sw * 0.7; n.armR.rotation.x = sw * 0.7;
    }
  };

  return W;
}
