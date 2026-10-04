// ── the world: city + house interiors ───────────────────────────────────────
import * as THREE from 'three';
import { T } from './tex.js';
import { rnd, ri, pick, hash } from './util.js';

export const HOUSE_ORIGIN = { 1: new THREE.Vector3(0, 0, 1000), 2: new THREE.Vector3(0, 0, 1100), 3: new THREE.Vector3(0, 0, 1200) };

const mat = (o) => new THREE.MeshStandardMaterial(o);

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  g.position.set(x, y, z); g.castShadow = true; g.receiveShadow = true;
  return g;
}

export class World {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.colliders = [];     // {min:{x,z},max:{x,z}} AABB in world space
    this.interactables = []; // {pos:Vector3, r, label, key, fn, cond}
    this.doors = [];
    this.screens = [];       // live screens to update
    this.cityLights = [];
    this.build();
  }

  solid(mesh, pad = 0) {
    mesh.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(mesh);
    this.colliders.push({ minx: b.min.x - pad, maxx: b.max.x + pad, minz: b.min.z - pad, maxz: b.max.z + pad, miny: b.min.y, maxy: b.max.y });
    return mesh;
  }
  interact(pos, r, label, fn, opts = {}) {
    const it = { pos: pos.clone(), r, label, fn, ...opts };
    this.interactables.push(it);
    return it;
  }

  build() {
    this.buildCity();
    this.buildHouse(1, { w: 11, d: 9, name: 'Studio' });
    this.buildHouse(2, { w: 16, d: 13, name: 'Villa' });
    this.buildHouse(3, { w: 22, d: 18, name: 'Mansion' });
  }

  // ───────────────────────────── CITY ──────────────────────────────────────
  buildCity() {
    const g = new THREE.Group(); this.root.add(g);

    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat({ map: T.grass(60), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; g.add(ground);

    // road grid
    const roadMat = mat({ map: T.asphalt(20), roughness: .95 });
    const lineMat = mat({ color: 0xf2e9c8, roughness: .8 });
    const sideMat = mat({ map: T.sidewalk(14), roughness: 1 });
    const ROADS = [-120, -60, 0, 60, 120];
    for (const z of ROADS) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(400, 14), roadMat);
      r.rotation.x = -Math.PI / 2; r.position.set(0, .02, z); r.receiveShadow = true; g.add(r);
      for (let x = -190; x < 190; x += 12) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(6, .4), lineMat);
        l.rotation.x = -Math.PI / 2; l.position.set(x, .04, z); g.add(l);
      }
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(400, .3, 3), sideMat);
        w.position.set(0, .15, z + s * 8.5); w.receiveShadow = true; g.add(w);
      }
    }
    for (const x of ROADS) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(14, 400), roadMat);
      r.rotation.x = -Math.PI / 2; r.position.set(x, .025, 0); r.receiveShadow = true; g.add(r);
      for (let z = -190; z < 190; z += 12) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(.4, 6), lineMat);
        l.rotation.x = -Math.PI / 2; l.position.set(x, .045, z); g.add(l);
      }
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(3, .3, 400), sideMat);
        w.position.set(x + s * 8.5, .15, 0); w.receiveShadow = true; g.add(w);
      }
    }

    // city blocks with buildings
    const palette = ['#7d8794', '#8d7d6e', '#6c7b8a', '#9a8778', '#5f6b78', '#a09285'];
    for (let bx = 0; bx < 4; bx++) for (let bz = 0; bz < 4; bz++) {
      const cx = -90 + bx * 60, cz = -90 + bz * 60;
      if (Math.abs(cx + 30) < 1 && Math.abs(cz + 30) < 1) continue; // keep an empty plot
      const seed = bx * 7 + bz * 13;
      // park block
      if (hash(seed) > .78) { this.park(g, cx, cz); continue; }
      const count = 2 + ((hash(seed + 3) * 3) | 0);
      for (let i = 0; i < count; i++) {
        const w = 12 + hash(seed + i * 5) * 14;
        const d = 12 + hash(seed + i * 9) * 12;
        const h = 10 + hash(seed + i * 17) * 46;
        const px = cx + (hash(seed + i * 2) - .5) * 24;
        const pz = cz + (hash(seed + i * 4) - .5) * 24;
        const rows = Math.max(4, Math.round(h / 4.2));
        const facade = T.facade(seed + i, Math.max(3, Math.round(w / 3.6)), rows, pick(palette));
        const m = [mat({ map: facade, roughness: .85 }), mat({ map: facade, roughness: .85 }),
        mat({ color: 0x55606c, roughness: .9 }), mat({ color: 0x3a4049 }),
        mat({ map: facade, roughness: .85 }), mat({ map: facade, roughness: .85 })];
        const b = box(w, h, d, m, px, h / 2, pz);
        g.add(this.solid(b));
        // roof block
        g.add(box(w * .35, 2, d * .35, mat({ color: 0x4a515b }), px, h + 1, pz));
      }
    }

    // street props
    for (const z of ROADS) for (let x = -180; x <= 180; x += 20) {
      if (Math.abs(x) % 60 < 8) continue;
      this.lamp(g, x, z + 9.5); this.lamp(g, x, z - 9.5);
    }
    for (let i = 0; i < 120; i++) {
      const x = rnd(190, -190), z = rnd(190, -190);
      if (this.nearRoad(x, z, 11)) continue;
      this.tree(g, x, z);
    }
    // parked cars
    for (let i = 0; i < 40; i++) {
      const road = pick(ROADS), along = rnd(170, -170), horiz = Math.random() < .5;
      const x = horiz ? along : road + (Math.random() < .5 ? 5 : -5);
      const z = horiz ? road + (Math.random() < .5 ? 5 : -5) : along;
      const c = this.staticCar(horiz ? 0 : Math.PI / 2);
      c.position.set(x, 0, z); g.add(c); this.solid(c);
    }

    // ── landmark buildings (shops / bank / studio) ───────────────────────
    this.shopFront(g, 'SUPERMARKET', 0x27ae60, -30, -30, 0, 'shop_food', '🛒 Supermarket');
    this.shopFront(g, 'TECH STORE', 0x3498db, 30, -30, 0, 'shop_tech', '💻 Tech Store');
    this.shopFront(g, 'CAR DEALER', 0xe67e22, -30, 30, Math.PI, 'shop_car', '🚗 Car Dealer');
    this.shopFront(g, 'FURNITURE', 0x9b59b6, 30, 30, Math.PI, 'shop_furn', '🛋️ Furniture Store');
    this.shopFront(g, 'BANK', 0xf1c40f, -90, 30, Math.PI, 'bank', '🏦 Bank');
    this.shopFront(g, 'REAL ESTATE', 0x1abc9c, 90, -30, 0, 'estate', '🏠 Real Estate Agency');
    this.shopFront(g, 'CLOTHES', 0xe84393, 90, 30, Math.PI, 'shop_clothes', '👕 Clothes Shop');
    this.shopFront(g, 'GYM', 0xc0392b, -90, -30, 0, 'gym', '🏋️ Gym');

    // player home plots (doors)
    this.homePlot(g, 1, -60, -70, '#c4a07a');
    this.homePlot(g, 2, 0, -70, '#b9c4d6');
    this.homePlot(g, 3, 60, -70, '#e5d8c0');

    // billboard
    const bb = box(26, 14, 1, mat({ map: T.poster('STREAM LIFE', '#7c3aed'), roughness: .6, emissive: 0x221133, emissiveIntensity: .4 }), 0, 24, -160);
    g.add(bb); g.add(box(1.2, 24, 1.2, mat({ color: 0x3a3a3a }), -8, 12, -160)); g.add(box(1.2, 24, 1.2, mat({ color: 0x3a3a3a }), 8, 12, -160));
  }

  nearRoad(x, z, m) {
    for (const r of [-120, -60, 0, 60, 120]) if (Math.abs(x - r) < m || Math.abs(z - r) < m) return true;
    return false;
  }

  park(g, cx, cz) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(22, 32), mat({ map: T.grass(8), roughness: 1 }));
    p.rotation.x = -Math.PI / 2; p.position.set(cx, .05, cz); p.receiveShadow = true; g.add(p);
    const path = new THREE.Mesh(new THREE.RingGeometry(9, 11, 32), mat({ map: T.sidewalk(4), roughness: 1 }));
    path.rotation.x = -Math.PI / 2; path.position.set(cx, .07, cz); g.add(path);
    for (let i = 0; i < 12; i++) this.tree(g, cx + Math.cos(i) * rnd(20, 13), cz + Math.sin(i * 2.3) * rnd(20, 13));
    // fountain
    const f = new THREE.Group();
    f.add(box(6, 1, 6, mat({ color: 0xb9b3a8, roughness: .9 }), 0, .5, 0));
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, .3, 20), mat({ color: 0x3fa9f5, transparent: true, opacity: .85, roughness: .1, metalness: .2 }));
    water.position.y = 1.05; f.add(water);
    f.add(box(.8, 2.4, .8, mat({ color: 0xcfc9bd }), 0, 2, 0));
    f.position.set(cx, 0, cz); g.add(f); this.solid(f);
    for (let i = 0; i < 4; i++) {
      const bench = new THREE.Group();
      bench.add(box(3, .25, 1, mat({ map: T.wood(1, true), roughness: .9 }), 0, .6, 0));
      bench.add(box(3, 1, .22, mat({ map: T.wood(1, true), roughness: .9 }), 0, 1.1, -.4));
      bench.position.set(cx + Math.cos(i * 1.57) * 14, 0, cz + Math.sin(i * 1.57) * 14);
      bench.rotation.y = -i * 1.57; g.add(bench);
    }
  }

  tree(g, x, z) {
    const t = new THREE.Group();
    const h = rnd(7, 4);
    t.add(box(.5, h, .5, mat({ color: 0x6b4a2b, roughness: 1 }), 0, h / 2, 0));
    const leafMat = mat({ color: new THREE.Color().setHSL(.28, .5, rnd(.38, .22)), roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(2.6, 1.6), 0), leafMat);
      s.position.set(rnd(1, -1), h + rnd(1.6, -.4), rnd(1, -1)); s.castShadow = true; t.add(s);
    }
    t.position.set(x, 0, z); g.add(t);
  }

  lamp(g, x, z) {
    const l = new THREE.Group();
    l.add(box(.26, 7, .26, mat({ color: 0x2f3338, metalness: .4, roughness: .6 }), 0, 3.5, 0));
    const head = box(1.6, .4, .6, mat({ color: 0xfff3c4, emissive: 0xffe08a, emissiveIntensity: 1.3 }), .6, 7, 0);
    l.add(head);
    l.position.set(x, 0, z); g.add(l);
    this.cityLights.push(head);
  }

  staticCar(rot) {
    const c = new THREE.Group();
    const col = new THREE.Color().setHSL(Math.random(), .6, rnd(.6, .25));
    const body = mat({ color: col, metalness: .55, roughness: .35 });
    c.add(box(4.2, .9, 1.9, body, 0, .8, 0));
    c.add(box(2.3, .8, 1.75, mat({ color: 0x223044, metalness: .3, roughness: .2 }), -.2, 1.55, 0));
    const wm = mat({ color: 0x15171a, roughness: .9 });
    for (const [wx, wz] of [[1.35, .98], [1.35, -.98], [-1.35, .98], [-1.35, -.98]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .3, 14), wm);
      w.rotation.x = Math.PI / 2; w.position.set(wx, .42, wz); c.add(w);
    }
    c.rotation.y = rot; c.traverse(o => { o.castShadow = true; });
    return c;
  }

  shopFront(g, label, color, x, z, rot, key, title) {
    const s = new THREE.Group();
    const w = 20, h = 9, d = 14;
    const bodyMat = mat({ map: T.brick('#9a6a52', 5), roughness: .9 });
    s.add(box(w, h, d, bodyMat, 0, h / 2, 0));
    // sign
    const sign = box(w * .85, 2.4, .6, mat({ color, emissive: color, emissiveIntensity: .7, roughness: .4 }), 0, h - 1.6, d / 2 + .2);
    s.add(sign);
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128;
    const cx2 = cv.getContext('2d');
    cx2.fillStyle = '#0b0f19'; cx2.fillRect(0, 0, 1024, 128);
    cx2.fillStyle = '#fff'; cx2.font = 'bold 76px sans-serif'; cx2.textAlign = 'center'; cx2.fillText(label, 512, 92);
    const st = new THREE.CanvasTexture(cv); st.colorSpace = THREE.SRGBColorSpace;
    const plate = box(w * .8, 1.6, .1, new THREE.MeshBasicMaterial({ map: st }), 0, h - 1.6, d / 2 + .55);
    s.add(plate);
    // glass front + door
    const glass = box(w * .7, 5, .2, mat({ color: 0x9fd7f2, transparent: true, opacity: .45, metalness: .5, roughness: .05 }), 0, 3, d / 2 + .05);
    s.add(glass);
    const door = box(2.6, 4.4, .3, mat({ color: 0x2c3e50, metalness: .4, roughness: .4 }), 0, 2.2, d / 2 + .15);
    s.add(door);
    s.position.set(x, 0, z); s.rotation.y = rot;
    g.add(s); this.solid(s);
    const dir = new THREE.Vector3(0, 0, d / 2 + 2.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.interact(new THREE.Vector3(x + dir.x, 1, z + dir.z), 3.5, title, () => this.game.openShop(key));
  }

  homePlot(g, id, x, z, wallHex) {
    const sizes = { 1: [10, 6, 9], 2: [15, 7.5, 12], 3: [21, 10, 17] };
    const [w, h, d] = sizes[id];
    const hgrp = new THREE.Group();
    hgrp.add(box(w, h, d, mat({ map: T.wall(wallHex, 3), roughness: .9 }), 0, h / 2, 0));
    // roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * .78, 3.6, 4), mat({ color: 0x8e3b2f, roughness: .9 }));
    roof.rotation.y = Math.PI / 4; roof.position.y = h + 1.7; roof.castShadow = true; hgrp.add(roof);
    // windows
    for (const sx of [-w / 3.2, w / 3.2]) hgrp.add(box(2.4, 2, .2, mat({ color: 0x8fd0ef, emissive: 0x335577, emissiveIntensity: .5, metalness: .3, roughness: .1 }), sx, h * .58, d / 2 + .05));
    // door
    hgrp.add(box(2.2, 4, .3, mat({ map: T.wood(1, true), roughness: .8 }), 0, 2, d / 2 + .1));
    // yard
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(w + 10, d + 8), mat({ map: T.grass(5), roughness: 1 }));
    yard.rotation.x = -Math.PI / 2; yard.position.y = .03; yard.receiveShadow = true; hgrp.add(yard);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 6), mat({ map: T.sidewalk(2), roughness: 1 }));
    path.rotation.x = -Math.PI / 2; path.position.set(0, .06, d / 2 + 3); hgrp.add(path);
    // for-sale sign
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const c2 = cv.getContext('2d'); c2.fillStyle = '#0ea5e9'; c2.fillRect(0, 0, 256, 128);
    c2.fillStyle = '#fff'; c2.font = 'bold 28px sans-serif'; c2.textAlign = 'center';
    c2.fillText('HOUSE #' + id, 128, 50); c2.fillText(['', '$0', '$250K', '$2M'][id], 128, 92);
    const sgt = new THREE.CanvasTexture(cv); sgt.colorSpace = THREE.SRGBColorSpace;
    const sign = box(3, 1.6, .15, new THREE.MeshBasicMaterial({ map: sgt }), -w / 2 - 2, 2.2, d / 2 + 3);
    hgrp.add(sign); sign.userData.saleSign = id;
    hgrp.position.set(x, 0, z); g.add(hgrp); this.solid(hgrp);
    hgrp.traverse(o => { o.castShadow = true; o.receiveShadow = true; });

    this.interact(new THREE.Vector3(x, 1, z + d / 2 + 2.4), 3.2, `🚪 Enter House #${id}`, () => this.game.enterHouse(id), { houseId: id, sign });
  }

  // ───────────────────────────── HOUSE INTERIOR ────────────────────────────
  buildHouse(id, { w, d }) {
    const o = HOUSE_ORIGIN[id];
    const g = new THREE.Group(); g.position.copy(o); this.root.add(g);
    const H = 3.4;
    const floorTex = id === 1 ? T.wood(3) : id === 2 ? T.wood(4) : T.tile(5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat({ map: floorTex, roughness: .7 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat({ color: 0xf4f1ec, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; g.add(ceil);
    const wallMat = mat({ map: T.wall(id === 3 ? '#efe7dc' : '#e6e9ee', 3), roughness: .95, side: THREE.DoubleSide });
    const mk = (ww, hh, dd, x, y, z) => { const m = box(ww, hh, dd, wallMat, x, y, z); g.add(m); this.solid(m); return m; };
    mk(w, H, .3, 0, H / 2, -d / 2); mk(w, H, .3, 0, H / 2, d / 2);
    mk(.3, H, d, -w / 2, H / 2, 0); mk(.3, H, d, w / 2, H / 2, 0);

    // lighting fixture
    const lamp = box(1.4, .18, 1.4, mat({ color: 0xfff6dd, emissive: 0xfff0c0, emissiveIntensity: 1.2 }), 0, H - .12, 0);
    g.add(lamp);
    const pl = new THREE.PointLight(0xfff0cc, 1.2, 26, 1.6); pl.position.set(0, H - .5, 0); g.add(pl);
    if (id > 1) { const pl2 = new THREE.PointLight(0xfff0cc, .9, 22, 1.6); pl2.position.set(-w / 4, H - .5, d / 4); g.add(pl2); }

    const furn = new THREE.Group(); g.add(furn);
    this.game.houseFurniture = this.game.houseFurniture || {};
    this.game.houseFurniture[id] = furn;

    const wp = (x, y, z) => new THREE.Vector3(o.x + x, y, o.z + z);

    // ── exit door
    const door = box(2.2, 2.8, .25, mat({ map: T.wood(1, true), roughness: .8 }), 0, 1.4, d / 2 - .1);
    g.add(door);
    this.interact(wp(0, 1, d / 2 - 1.6), 2.2, '🚪 Go outside', () => this.game.exitHouse(), { houseId: id });

    // ── streaming desk + PC
    const deskX = -w / 2 + 2.6, deskZ = -d / 2 + 2.2;
    const desk = new THREE.Group();
    desk.add(box(3.4, .12, 1.5, mat({ map: T.wood(2, true), roughness: .5 }), 0, .78, 0));
    for (const sx of [-1.5, 1.5]) for (const sz of [-.6, .6]) desk.add(box(.12, .78, .12, mat({ color: 0x2b2f36, metalness: .5 }), sx, .39, sz));
    // monitors
    const scrMat = new THREE.MeshBasicMaterial({ color: 0x0b1020 });
    for (const [mx, ry] of [[-.95, .35], [.95, -.35], [0, 0]]) {
      const stand = box(.3, .35, .22, mat({ color: 0x23272e }), mx, 1.02, -.3);
      const scr = box(1.25, .75, .06, scrMat, mx, 1.6, -.3);
      scr.rotation.y = ry; stand.rotation.y = ry;
      desk.add(stand); desk.add(scr);
      this.screens.push(scr);
    }
    // tower + keyboard + mic + cam
    desk.add(box(.5, 1.1, 1.1, mat({ color: 0x15181d, metalness: .4, roughness: .4 }), 1.9, .55, 0));
    const rgb = box(.06, .9, .06, mat({ color: 0x9b5cff, emissive: 0x9b5cff, emissiveIntensity: 2 }), 1.64, .55, 0);
    desk.add(rgb);
    desk.add(box(1.3, .05, .45, mat({ color: 0x1b1e24 }), 0, .86, .3));
    const mic = new THREE.Mesh(new THREE.CapsuleGeometry(.1, .22, 4, 10), mat({ color: 0x2c2f36, metalness: .7, roughness: .3 }));
    mic.position.set(-1.5, 1.25, .1); desk.add(mic);
    desk.add(box(.1, .5, .1, mat({ color: 0x1a1c20 }), -1.5, .95, .1));
    const cam = box(.26, .22, .26, mat({ color: 0x111317 }), .3, 1.45, .45);
    desk.add(cam);
    // chair
    const chair = new THREE.Group();
    chair.add(box(.8, .14, .8, mat({ color: 0x1f2330, roughness: .7 }), 0, .5, 0));
    chair.add(box(.8, 1.1, .16, mat({ color: 0x25293a, roughness: .7 }), 0, 1.1, -.35));
    chair.add(box(.16, .5, .16, mat({ color: 0x15171d, metalness: .6 }), 0, .25, 0));
    chair.position.set(0, 0, 1.3); desk.add(chair);
    desk.position.set(deskX, 0, deskZ); furn.add(desk);
    desk.traverse(o2 => { o2.castShadow = true; o2.receiveShadow = true; });
    this.game.pcDesk = this.game.pcDesk || {};
    this.game.pcDesk[id] = { desk, rgb, screens: [desk.children[6], desk.children[8], desk.children[10]] };
    this.interact(wp(deskX, 1, deskZ + 1.6), 2, '🖥️ Use PC', () => this.game.openPC());

    // ── bed
    const bedX = w / 2 - 2.2, bedZ = -d / 2 + 2.4;
    const bed = new THREE.Group();
    bed.add(box(2.1, .4, 3.1, mat({ map: T.wood(1, true), roughness: .8 }), 0, .25, 0));
    bed.add(box(2, .3, 3, mat({ color: 0xf1f3f7, roughness: .95 }), 0, .6, 0));
    bed.add(box(1.8, .22, .7, mat({ color: 0xdfe6ef, roughness: 1 }), 0, .8, -1.1));
    bed.add(box(2, .5, 1.6, mat({ map: T.carpet('#2d4a7a', 1), roughness: 1 }), 0, .65, .7));
    bed.add(box(2.2, 1.4, .18, mat({ map: T.wood(1, true) }), 0, .9, -1.6));
    bed.position.set(bedX, 0, bedZ); furn.add(bed);
    bed.traverse(o2 => { o2.castShadow = true; o2.receiveShadow = true; });
    this.interact(wp(bedX - 1.6, 1, bedZ), 2, '🛏️ Sleep', () => this.game.sleep());

    // ── kitchen (fridge + counter)
    const kx = -w / 2 + 1.2, kz = d / 2 - 2.6;
    const fridge = box(1.1, 2.2, 1, mat({ color: 0xd8dce2, metalness: .7, roughness: .25 }), kx, 1.1, kz);
    furn.add(fridge);
    furn.add(box(.06, 1.9, .06, mat({ color: 0x8b9099, metalness: .9 }), kx + .5, 1.2, kz + .52));
    this.interact(wp(kx + 1.6, 1, kz), 2.1, '🍔 Eat', () => this.game.eat());
    const counter = box(3.2, .95, 1, mat({ color: 0xc9cfd6, roughness: .5 }), kx + 2.8, .475, kz);
    furn.add(counter);
    furn.add(box(3.2, .08, 1, mat({ color: 0x2f3338, roughness: .3, metalness: .4 }), kx + 2.8, .99, kz));

    // ── bathroom corner (shower)
    const sx = w / 2 - 1.6, sz = d / 2 - 1.8;
    const shower = new THREE.Group();
    shower.add(box(2, 2.6, 2, mat({ color: 0xa9d9ef, transparent: true, opacity: .25, roughness: .05, metalness: .3 }), 0, 1.3, 0));
    shower.add(box(2, .2, 2, mat({ map: T.tile(2), roughness: .6 }), 0, .1, 0));
    shower.add(box(.3, .1, .3, mat({ color: 0xc0c6cc, metalness: .8 }), 0, 2.3, 0));
    shower.position.set(sx, 0, sz); furn.add(shower);
    this.interact(wp(sx - 1.8, 1, sz), 2.1, '🚿 Shower', () => this.game.shower());

    // ── sofa + TV (living)
    const lz = d / 2 - 4.5;
    const sofa = new THREE.Group();
    sofa.add(box(3.4, .5, 1.3, mat({ map: T.carpet('#3d5a80', 1), roughness: 1 }), 0, .4, 0));
    sofa.add(box(3.4, .9, .3, mat({ map: T.carpet('#3d5a80', 1), roughness: 1 }), 0, .9, -.6));
    for (const ax of [-1.7, 1.7]) sofa.add(box(.3, .8, 1.3, mat({ map: T.carpet('#34507a', 1) }), ax, .75, 0));
    sofa.position.set(0, 0, lz); sofa.rotation.y = Math.PI; furn.add(sofa);
    const tv = box(3.2, 1.8, .12, new THREE.MeshBasicMaterial({ color: 0x0a0d14 }), 0, 1.8, lz - 4.5);
    furn.add(tv);
    furn.add(box(3.6, .5, .9, mat({ map: T.wood(1, true) }), 0, .25, lz - 4.4));
    this.interact(wp(0, 1, lz - .3), 2.2, '📺 Watch TV / relax', () => this.game.relax());
    this.game.tvScreen = this.game.tvScreen || {}; this.game.tvScreen[id] = tv;

    // rug
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3), mat({ map: T.carpet('#7b2b3a', 2), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, .02, lz - 2.3); furn.add(rug);

    // posters
    for (let i = 0; i < 3; i++) {
      const p = box(1.5, 2, .06, mat({ map: T.poster(pick(['GG EZ', 'STREAM 24/7', 'NEON CITY', 'TOP 1', 'LIVE NOW']), pick(['#7c3aed', '#0ea5e9', '#ef4444', '#10b981'])), roughness: .9 }),
        -w / 2 + .25, 2, -d / 2 + 5 + i * 3);
      p.rotation.y = Math.PI / 2; furn.add(p);
    }
    // plant
    const plant = new THREE.Group();
    plant.add(box(.7, .7, .7, mat({ color: 0xb4663a, roughness: .9 }), 0, .35, 0));
    for (let i = 0; i < 5; i++) {
      const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(.45, 0), mat({ color: 0x2e7d32, flatShading: true }));
      lf.position.set(rnd(.4, -.4), .9 + rnd(.6), rnd(.4, -.4)); plant.add(lf);
    }
    plant.position.set(w / 2 - 1.2, 0, -.5); furn.add(plant);

    furn.traverse(o2 => { o2.castShadow = true; o2.receiveShadow = true; });
  }
}
