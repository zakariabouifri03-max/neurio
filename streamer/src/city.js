// ── Cedar Creek: the forest town (roads, lake, shops, houses, pines) ────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, rand } from './util.js';
import { TEX, signTexture, awningTexture, woodSidingTexture, windowTex } from './tex.js';
import { Pedestrian, buildCar } from './npc.js';

// house catalog placement: id → world transform of the EXTERIOR
export const HOUSE_SPOTS = {
  room:    { x: -14, z: 12,  rot: Math.PI / 2 },   // door faces +x (road)
  studio:  { x: 74,  z: -44, rot: -Math.PI / 2 },  // mobile home
  flat:    { x: 40,  z: 34,  rot: Math.PI },       // town house, door faces -z
  villa:   { x: -40, z: -52, rot: 0 },             // cabin, door +z
  mansion: { x: -52, z: 48,  rot: Math.PI },       // lakeview mansion
};

export function buildCity() {
  const r = mulberry32(2026);
  const group = new THREE.Group();
  const colliders = [];
  const interactables = [];
  const windowMats = [];   // emissive at night
  const lampHeads = [];

  const M = (geo, mat, x, y, z, ry = 0, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = shadow; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, ry = 0) => M(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry);

  // ── ground ──
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  group.add(ground);

  // ── roads ──
  const roadMat = new THREE.MeshStandardMaterial({ map: TEX.road, roughness: 0.95 });
  const roadX = new THREE.Mesh(new THREE.PlaneGeometry(190, 8), roadMat.clone());
  roadX.material.map = TEX.road.clone(); roadX.material.map.needsUpdate = true;
  roadX.material.map.repeat.set(24, 1); roadX.material.map.rotation = Math.PI / 2;
  roadX.material.map.center.set(0.5, 0.5);
  roadX.rotation.x = -Math.PI / 2; roadX.position.y = 0.02; roadX.receiveShadow = true;
  group.add(roadX);
  const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(8, 150), roadMat.clone());
  roadZ.material.map = TEX.road.clone(); roadZ.material.map.needsUpdate = true;
  roadZ.material.map.repeat.set(19, 1);
  roadZ.rotation.x = -Math.PI / 2; roadZ.position.y = 0.03; roadZ.receiveShadow = true;
  group.add(roadZ);
  // dirt shoulders
  const dirtMat = new THREE.MeshStandardMaterial({ map: TEX.dirt, roughness: 1 });
  [[190, 3.2, 0, 5.6], [190, 3.2, 0, -5.6], [3.2, 150, 5.6, 0], [3.2, 150, -5.6, 0]].forEach(([w, d, x, z]) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dirtMat);
    s.rotation.x = -Math.PI / 2; s.position.set(x, 0.01, z); s.receiveShadow = true;
    group.add(s);
  });

  // ── lake (west) ──
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(60, 200), new THREE.MeshStandardMaterial({ map: TEX.lake, roughness: 0.25, metalness: 0.1 }));
  lake.rotation.x = -Math.PI / 2; lake.position.set(-106, 0.05, 0);
  group.add(lake);
  // guardrail
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.7, roughness: 0.4 });
  const rail = box(0.12, 0.09, 120, railMat, -76.5, 0.75, 0, 0, false);
  for (let z = -60; z <= 60; z += 6) box(0.09, 0.75, 0.09, railMat, -76.5, 0.38, z, 0, false);
  colliders.push({ x: -76.5, z: 0, hx: 0.4, hz: 62 });

  // ── pine forest (merged) ──
  const trunkGeos = [], leafGeos = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4327, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2c4a2b, roughness: 1 });
  const addPine = (x, z, s) => {
    const t = new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 2.2 * s, 6);
    t.translate(x, 1.1 * s, z); trunkGeos.push(t);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.ConeGeometry((1.9 - i * 0.5) * s, 2.1 * s, 7);
      c.translate(x, (2.4 + i * 1.25) * s, z); leafGeos.push(c);
    }
  };
  for (let i = 0; i < 240; i++) {
    const a = r() * Math.PI * 2;
    const rad = 95 + r() * 70;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.8;
    if (Math.abs(z) < 9 && Math.abs(x) < 100) continue;
    if (Math.abs(x) < 9 && Math.abs(z) < 80) continue;
    if (x < -78 && Math.abs(z) < 100) continue; // lake
    addPine(x, z, 0.8 + r() * 0.9);
  }
  // scattered town pines
  const townTrees = [[-66, -20], [-66, 24], [16, -34], [-16, -34], [60, 30], [-60, -30], [84, -12], [-30, 52], [20, 52], [66, -20], [-70, -48], [52, 52], [86, 40], [-84, 30], [10, 30], [-8, -28]];
  townTrees.forEach(([x, z]) => addPine(x + (r() - 0.5) * 3, z + (r() - 0.5) * 3, 0.8 + r() * 0.7));
  const trunks = new THREE.Mesh(mergeGeometries(trunkGeos), trunkMat);
  const leafs = new THREE.Mesh(mergeGeometries(leafGeos), leafMat);
  trunks.castShadow = leafs.castShadow = true;
  trunks.receiveShadow = true;
  group.add(trunks, leafs);

  // ── building helper ──
  const sidingCache = {};
  const siding = (c) => { if (!sidingCache[c]) sidingCache[c] = new THREE.MeshStandardMaterial({ map: woodSidingTexture(c), roughness: 0.9 }); return sidingCache[c]; };
  const roofMat = new THREE.MeshStandardMaterial({ map: TEX.roof, roughness: 0.9 });
  const winLitMat = () => {
    const m = new THREE.MeshStandardMaterial({ map: windowTex(false), emissiveMap: windowTex(true), emissive: 0xffd98a, emissiveIntensity: 0, roughness: 0.5 });
    windowMats.push(m); return m;
  };

  function woodHouse(x, z, w, d, h, color, rot = 0, opts = {}) {
    const g = new THREE.Group();
    const add = (m) => { m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const walls = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), siding(color)));
    walls.position.y = h / 2;
    const roof = add(new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.74, h * 0.7, 4), roofMat));
    roof.position.y = h + h * 0.35; roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.max(w, d) * 1.06, 1, d / Math.max(w, d) * 1.06);
    // door on +z face
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2, 0.08), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 }));
    door.position.set(opts.doorX || 0, 1, d / 2 + 0.05); add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 0.8 }));
    knob.position.set((opts.doorX || 0) + 0.35, 1, d / 2 + 0.1); add(knob);
    // windows
    const wm = winLitMat();
    const n = opts.win ?? 2;
    for (let i = 0; i < n; i++) {
      const wx = -w / 2 + (w / (n + 1)) * (i + 1);
      if (Math.abs(wx - (opts.doorX || 0)) < 0.9) continue;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.1), wm);
      win.position.set(wx, h * 0.55, d / 2 + 0.06); g.add(win);
      const win2 = win.clone(); win2.rotation.y = Math.PI; win2.position.z = -d / 2 - 0.06; g.add(win2);
    }
    // step
    const step = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 0.7), new THREE.MeshStandardMaterial({ color: 0x8a8d92 })));
    step.position.set(opts.doorX || 0, 0.07, d / 2 + 0.4);
    g.position.set(x, 0, z); g.rotation.y = rot;
    group.add(g);
    // collider in world space (axis aligned approx)
    const c = Math.abs(Math.cos(rot)) > 0.7 ? { hx: w / 2, hz: d / 2 } : { hx: d / 2, hz: w / 2 };
    colliders.push({ x, z, hx: c.hx + 0.1, hz: c.hz + 0.1 });
    // door world pos = local (doorX, d/2) rotated
    const lx = opts.doorX || 0, lz = d / 2 + 1.1;
    const dx = x + lx * Math.cos(rot) + lz * Math.sin(rot);
    const dz = z - lx * Math.sin(rot) + lz * Math.cos(rot);
    return { g, door: { x: dx, z: dz } };
  }

  // ── shops ──
  function shopFront(x, z, w, d, h, color, signText, awn, rot, interact) {
    const hh = woodHouse(x, z, w, d, h, color, rot, { win: 3, doorX: 0 });
    const g = hh.g;
    const signT = new THREE.MeshBasicMaterial({ map: signTexture(signText, '#20303f', '#f5d76e') });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, w * 0.85 * 160 / 512), signT);
    const localZ = d / 2 + 0.15;
    sign.position.set(0, h * 0.82, localZ);
    g.add(sign);
    if (awn) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.08, 1.4), new THREE.MeshStandardMaterial({ map: awningTexture(awn[0], awn[1]) }));
      a.position.set(0, 2.6, d / 2 + 0.75); a.rotation.x = 0.16;
      a.castShadow = true; g.add(a);
    }
    const dx = x + localZ * Math.sin(rot), dz = z + localZ * Math.cos(rot);
    interactables.push(Object.assign({ x: dx, z: dz, r: 2.6 }, interact));
    return hh;
  }

  shopFront(26, -20, 16, 10, 5.5, '#c9b28a', 'HOMESTEAD FOODS', ['#e8b53a', '#d8452f'], 0, { id: 'supermarket', icon: '🛒', label: 'Browse shelves / work shift' });
  shopFront(-26, -20, 10, 8, 4.6, '#7f9c8f', 'TECH SHACK', ['#3f7fd8', '#e8e8e8'], 0, { id: 'tech', icon: '🖥️', label: 'Buy PC gear (instant, +8%)' });
  shopFront(26, 20, 12, 9, 5, '#a56b4a', 'COZY TIMBER FURNITURE', ['#4aa34a', '#e8e8e8'], Math.PI, { id: 'furniture', icon: '🛋️', label: 'Buy furniture' });
  shopFront(-26, 20, 10, 8, 4.6, '#8f7f9c', 'CEDAR REALTY', ['#d8452f', '#f5d76e'], Math.PI, { id: 'realty', icon: '🏠', label: 'Buy houses' });

  // ── car dealer lot ──
  const office = woodHouse(70, 22, 7, 6, 3.6, '#5f7f9c', Math.PI, { win: 2 });
  const offSign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.6), new THREE.MeshBasicMaterial({ map: signTexture('CEDAR MOTORS', '#20303f', '#8fe3ff') }));
  offSign.position.set(70, 4.6, 18.6); offSign.rotation.y = Math.PI; group.add(offSign);
  interactables.push({ id: 'dealer', icon: '🚗', label: 'Buy a car', x: 70, z: 17.5, r: 3 });
  const carSpots = [[58, 12, 0.2], [63, 12, -0.15], [68, 12, 0.1], [73, 12, -0.2]];
  carSpots.forEach(([cx, cz, cr], i) => {
    const c = buildCar([0xf2b705, 0x4f9cff, 0xe33b3b, 0xb44dff][i], i > 1 ? 1 : 0);
    c.position.set(cx, 0, cz); c.rotation.y = cr; group.add(c);
    colliders.push({ x: cx, z: cz, hx: 1.4, hz: 2.4 });
  });

  // ── decor houses ──
  const decorCols = ['#8d6e4e', '#7a8f6e', '#9c6b5f', '#6e7f8f', '#a08a5f', '#786a58'];
  [[-52, -30, 7, 6, 4], [10, -42, 8, 7, 4.4], [-12, 42, 7, 6, 4], [48, -40, 9, 7, 4.6], [-58, 34, 7, 6, 4], [70, -30, 8, 6, 4.2], [86, 18, 7, 6, 4], [-70, -60, 7, 6, 4]].forEach(([x, z, w, d, h], i) => {
    woodHouse(x, z, w, d, h, decorCols[i % decorCols.length], (r() * 4 | 0) * Math.PI / 2, { win: 2 + (i % 2) });
  });
  // second trailer decor
  const tr2 = box(3, 2.6, 9, siding('#9aa08a'), 80, 1.5, -46, 0.3);
  colliders.push({ x: 80, z: -46, hx: 2, hz: 5 });
  box(0.3, 1, 0.3, new THREE.MeshStandardMaterial({ color: 0x444 }), 77.4, 0.5, -43.5);
  box(0.3, 1, 0.3, new THREE.MeshStandardMaterial({ color: 0x444 }), 82.4, 0.5, -48);

  // ── buyable house exteriors ──
  const spots = HOUSE_SPOTS;
  const homeR = woodHouse(spots.room.x, spots.room.z, 6.5, 5.5, 3.6, '#8d6e4e', spots.room.rot, { win: 2 });
  interactables.push({ id: 'house:room', icon: '🚪', label: 'Enter your room', x: homeR.door.x, z: homeR.door.z, r: 2.2 });
  // mobile home (trailer)
  const trailer = box(3.2, 2.7, 10, siding('#b8b09a'), spots.studio.x, 1.55, spots.studio.z, spots.studio.rot);
  colliders.push({ x: spots.studio.x, z: spots.studio.z, hx: 5.4, hz: 2 });
  const tDoor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.08), new THREE.MeshStandardMaterial({ color: 0x4a3b2a }));
  tDoor.position.set(spots.studio.x - 1.7 * Math.sin(spots.studio.rot), 1.1, spots.studio.z - 1.7 * Math.cos(spots.studio.rot)); group.add(tDoor);
  interactables.push({ id: 'house:studio', icon: '🚪', label: 'Enter mobile home', x: spots.studio.x + 2.6, z: spots.studio.z - 1.4, r: 2.4 });
  const flatH = woodHouse(spots.flat.x, spots.flat.z, 9, 8, 6.4, '#9c6b5f', spots.flat.rot, { win: 4 });
  interactables.push({ id: 'house:flat', icon: '🚪', label: 'Enter town house', x: flatH.door.x, z: flatH.door.z, r: 2.4 });
  const villaH = woodHouse(spots.villa.x, spots.villa.z, 9, 8, 4.6, '#6e5a3f', spots.villa.rot, { win: 3 });
  interactables.push({ id: 'house:villa', icon: '🚪', label: 'Enter cabin', x: villaH.door.x, z: villaH.door.z, r: 2.4 });
  // mansion: bigger, two-tone
  const manG = new THREE.Group();
  const manW = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 12), siding('#7d8577'));
  manW.position.y = 3.5; manW.castShadow = manW.receiveShadow = true; manG.add(manW);
  const manRoof = new THREE.Mesh(new THREE.ConeGeometry(14, 3.4, 4), roofMat);
  manRoof.position.y = 8.6; manRoof.rotation.y = Math.PI / 4; manRoof.scale.set(1.15, 1, 0.9); manRoof.castShadow = true; manG.add(manRoof);
  const manWin = winLitMat();
  [[-5, 3.2], [0, 3.2], [5, 3.2], [-5, 6], [0, 6], [5, 6]].forEach(([wx, wy]) => {
    const wmesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.8), manWin);
    wmesh.position.set(wx, wy, 6.05); manG.add(wmesh);
  });
  const manDoor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 0.1), new THREE.MeshStandardMaterial({ color: 0x2b2118 }));
  manDoor.position.set(0, 1.3, 6.05); manG.add(manDoor);
  manG.position.set(spots.mansion.x, 0, spots.mansion.z);
  group.add(manG);
  colliders.push({ x: spots.mansion.x, z: spots.mansion.z, hx: 8.2, hz: 6.2 });
  interactables.push({ id: 'house:mansion', icon: '🚪', label: 'Enter mansion', x: spots.mansion.x, z: spots.mansion.z + 7.4, r: 2.6 });

  // ── road props ──
  const signPost = (x, z, texFn, ry = 0) => {
    box(0.08, 2.2, 0.08, railMat, x, 1.1, z, 0, false);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: texFn, side: THREE.DoubleSide }));
    s.position.set(x, 2.1, z); s.rotation.y = ry; group.add(s);
  };
  const warnTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#e8b53a'; g.save(); g.translate(48, 48); g.rotate(Math.PI / 4); g.fillRect(-34, -34, 68, 68); g.restore();
    g.strokeStyle = '#111'; g.lineWidth = 5; g.beginPath(); g.moveTo(38, 70); g.lineTo(48, 52); g.lineTo(40, 40); g.lineTo(52, 26); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const walkTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#e8b53a'; g.save(); g.translate(48, 48); g.rotate(Math.PI / 4); g.fillRect(-34, -34, 68, 68); g.restore();
    g.fillStyle = '#111'; g.beginPath(); g.arc(44, 34, 7, 0, 7); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 6; g.beginPath(); g.moveTo(44, 40); g.lineTo(40, 62); g.moveTo(44, 44); g.lineTo(54, 52); g.moveTo(40, 62); g.lineTo(34, 76); g.moveTo(40, 62); g.lineTo(48, 76); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  signPost(7, -6.5, warnTex, 0);
  signPost(-7, 6.5, walkTex, Math.PI);
  // crosswalk stripes
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xd8d8cf });
  for (let i = -3; i <= 3; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 3), stripeMat);
    s.rotation.x = -Math.PI / 2; s.position.set(6.5 + i * 1.1, 0.04, 0); group.add(s);
  }

  // ── street lamps ──
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, emissive: 0xffe9b0, emissiveIntensity: 0 });
  const lampPos = [[6, 6], [-6, -6], [6, -6], [-6, 6], [40, 6], [-40, -6], [6, 30], [-6, -30], [70, 6], [-60, 6]];
  lampPos.forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.6, 8), poleMat);
    p.position.set(x, 2.3, z); p.castShadow = true; group.add(p);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), poleMat);
    arm.position.set(x, 4.5, z + (z > 0 ? -0.5 : 0.5)); arm.rotation.x = Math.PI / 2; group.add(arm);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), headMat);
    head.position.set(x, 4.45, z + (z > 0 ? -1 : 1)); group.add(head);
    lampHeads.push(head);
  });

  // ── parked yellow van (decor, like the reference) ──
  const van = buildCar(0xe8b53a, 0);
  van.scale.set(1.15, 1.35, 1.15);
  van.position.set(18, 0, -8.5); van.rotation.y = Math.PI / 2 + 0.1;
  group.add(van);
  colliders.push({ x: 18, z: -8.5, hx: 2.6, hz: 1.6 });

  // ── clouds ──
  const clouds = [];
  const cloudTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    const rr = mulberry32(9);
    for (let i = 0; i < 20; i++) {
      const x = 40 + rr() * 176, y = 40 + rr() * 60, rad = 16 + rr() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.75, depthWrite: false }));
    s.position.set(rand(r, -150, 150), rand(r, 48, 70), rand(r, -120, 120));
    s.scale.set(rand(r, 30, 55), rand(r, 12, 20), 1);
    group.add(s); clouds.push(s);
  }

  // ── pedestrians ──
  const peds = [
    new Pedestrian(1, [20, -13, 34, -13.2], 1.2),
    new Pedestrian(2, [18, -6.8, 34, -13], 1.0),
    new Pedestrian(3, [-32, 6.8, -18, 13], 1.1),
    new Pedestrian(4, [20, 13, 33, 6.8], 1.15),
    new Pedestrian(5, [-33, -13, -19, -6.8], 0.95),
    new Pedestrian(6, [-8, 6.8, 8, 20], 1.05),
    new Pedestrian(7, [52, 6.8, 66, 14], 1.1),
    new Pedestrian(8, [-2, -20, 2, -8], 1.0),
  ];
  peds.forEach((p) => group.add(p.mesh));

  // ── traffic ─
  const traffic = [
    { mesh: buildCar(0x5f7f9c, 0), axis: 'x', lane: -2, dir: 1, pos: -60, speed: 8 },
    { mesh: buildCar(0x8f4f3f, 0), axis: 'z', lane: 2, dir: -1, pos: 40, speed: 7 },
  ];
  traffic.forEach((t) => group.add(t.mesh));

  // ── update ──
  let night = 0;
  function update(dt, hour, tSec) {
    peds.forEach((p) => p.update(dt));
    traffic.forEach((t) => {
      t.pos += t.speed * t.dir * dt;
      if (t.axis === 'x') {
        if (t.pos > 88) t.dir = -1; if (t.pos < -88) t.dir = 1;
        t.mesh.position.set(t.pos, 0, t.dir === 1 ? -2 : 2);
        t.mesh.rotation.y = t.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        if (t.pos > 70) t.dir = -1; if (t.pos < -70) t.dir = 1;
        t.mesh.position.set(t.dir === 1 ? 2 : -2, 0, t.pos);
        t.mesh.rotation.y = t.dir === 1 ? 0 : Math.PI;
      }
      t.mesh.userData.wheels.forEach((w) => (w.rotation.x += t.speed * dt * 3));
      t.mesh.userData.headMat.emissiveIntensity = night * 2.2;
    });
    // target night from hour
    const h = hour % 24;
    const target = h > 19.5 || h < 6 ? 1 : h > 18 ? (h - 18) / 1.5 : h < 7.5 ? 1 - (h - 6) / 1.5 : 0;
    night += (target - night) * Math.min(1, dt * 0.6);
    headMat.emissiveIntensity = night * 2.4;
    windowMats.forEach((m) => { m.emissiveIntensity = night * 0.9; });
    clouds.forEach((c, i) => {
      c.position.x += dt * (0.4 + i * 0.05);
      if (c.position.x > 170) c.position.x = -170;
    });
  }

  return { group, colliders, interactables, update, getNight: () => night, peds };
}
