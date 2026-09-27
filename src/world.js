// ============================================================
// world.js — builds the entire Starview Motel: building, office,
// laundry, guest rooms, lot, signage, props, doors, drawers,
// lights, CCTV, trigger volumes and static collision.
// Coordinates: +x east · +z toward building (doors face -z south)
// Interior z∈[0,5.6] · walkway z∈[-2.6,0] · lot z∈[-26,-2.6] · road z<-26
// ============================================================
import * as THREE from 'three';
import { AABB, canvasTex, clamp, lerp, rand, pick } from './utils.js';

export const WALL_H = 2.7;
export const EXT_H = 3.2;

export class Door {
  // A hinged door. faces: 'front' => on plane z=z, opens toward +z.
  constructor(world, id, hx, z, { w = 0.96, h = 2.06, tex, label = 'Door', locked = false, hingeRight = false, knob = true } = {}) {
    this.world = world; this.id = id; this.label = label;
    this.w = w; this.h = h;
    this.locked = locked; this.open01 = 0; this.target = 0; this.speed = 2.4;
    this.hx = hx; this.z = z; this.hingeRight = hingeRight;
    this.group = new THREE.Group();
    this.group.position.set(hx, 0, z);
    const g = new THREE.BoxGeometry(w, h, 0.055);
    g.translate(hingeRight ? -w / 2 : w / 2, h / 2, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    if (knob) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), world.mat({ color: 0x8a8580 }));
      k.position.set(hingeRight ? -w + 0.09 : w - 0.09, 1.02, -0.05);
      this.group.add(k);
      const k2 = k.clone(); k2.position.z = 0.05; this.group.add(k2);
    }
    // frame
    this.cx = hx + (hingeRight ? -w / 2 : w / 2); // closed center x
    this.closedBox = AABB.fromCenter(this.cx, z, w + 0.06, 0.14, 0, h + 0.1);
    this.closedBox.tag = 'door:' + id; this.closedBox.blocksSight = true;
    world.colliders.push(this.closedBox);
    world.scene.add(this.group);
    this.poundT = 0;
  }
  setLocked(v) { this.locked = v; }
  open(slow = false) { this.target = 1; if (slow) this.speed = 0.5; }
  close() { this.target = 0; }
  toggle() { this.target = this.target > 0.5 ? 0 : 1; }
  isOpen() { return this.open01 > 0.55; }
  pound() { this.poundT = 1; }
  update(dt) {
    const prev = this.open01;
    this.open01 = lerp(this.open01, this.target, 1 - Math.exp(-this.speed * dt * (this.target > this.open01 ? 2.4 : 3.4)));
    if (Math.abs(this.open01 - this.target) < 0.002) this.open01 = this.target;
    const ang = this.open01 * (Math.PI * 0.52) * (this.hingeRight ? -1 : 1);
    this.group.rotation.y = ang;
    this.closedBox.solid = this.open01 < 0.4;
    if (this.poundT > 0) { // someone hammering on it
      this.poundT -= dt;
      this.group.position.z = this.z + Math.sin(this.poundT * 55) * 0.012 * this.poundT;
    } else this.group.position.z = this.z;
    this.moving = Math.abs(this.open01 - prev) > 0.0005;
  }
}

export class Drawer {
  constructor(world, id, x, y, z, w, h, d, tex, label = 'Drawer') {
    this.world = world; this.id = id; this.label = label;
    this.open01 = 0; this.target = 0;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: tex }));
    this.mesh.position.set(x, y, z);
    world.scene.add(this.mesh);
    this.baseZ = z; this.d = d;
    this.inner = new THREE.Group(); // contents shown when open
    this.mesh.add(this.inner);
  }
  toggle() { this.target = this.target > 0.5 ? 0 : 1; }
  update(dt) {
    this.open01 = lerp(this.open01, this.target, 1 - Math.exp(-6 * dt));
    this.mesh.position.z = this.baseZ - this.open01 * this.d * 0.8;
  }
}

export class World {
  constructor(G) {
    this.G = G;
    this.scene = G.scene;
    this.T = G.T;
    this.colliders = [];
    this.interactables = [];
    this.doors = new Map();
    this.drawers = new Map();
    this.lights = new Map();
    this.flickers = [];
    this.hideSpots = new Map();
    this.triggers = [];
    this.props = {};
    this.power = true;
    this.time = 0;
    this.tvDirty = 0;
    this.signFlicker = false;
    this.walkFlicker = true;
    this.buildMap();
    this._setup && this._setup();
  }
  // episode 1 map — the Starview Motel (episode 2 subclasses override this)
  buildMap() {
    this._buildMaterials();
    this._buildTerrain();
    this._buildBuilding();
    this._buildOffice();
    this._buildLaundry();
    this._buildRooms();
    this._buildLot();
    this._buildSky();
    this._buildCCTV();
    this._setup();
  }

  // ---------------- helpers ----------------
  mat(opts) { return new THREE.MeshLambertMaterial(opts); }
  texMat(tex, opts = {}) { return new THREE.MeshLambertMaterial({ map: tex, ...opts }); }
  emisMat(tex, color = 0xffffff, intensity = 1) {
    return new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color(color), emissiveMap: tex, emissiveIntensity: intensity, color: 0x1a1a1a });
  }

  box(w, h, d, material, x, y, z, { collide = false, sight = false, castShadow = true, receiveShadow = true, name = '' } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = castShadow; m.receiveShadow = receiveShadow;
    m.name = name;
    this.scene.add(m);
    if (collide) {
      const b = AABB.fromCenter(x, z, w, d, y - h / 2, y + h / 2);
      b.blocksSight = sight; b.tag = name;
      this.colliders.push(b);
    }
    return m;
  }

  addInteract(def) { this.interactables.push(def); return def; }

  addLight(id, x, y, z, color, intensity, dist, { shadow = false, decay = 1.8 } = {}) {
    const L = new THREE.PointLight(color, intensity, dist, decay);
    L.position.set(x, y, z);
    if (shadow) {
      L.castShadow = true; L.shadow.mapSize.set(512, 512);
      L.shadow.camera.near = 0.1; L.shadow.camera.far = dist;
      L.shadow.bias = -0.01;
    }
    this.scene.add(L);
    this.lights.set(id, { light: L, base: intensity, on: true });
    return L;
  }
  setLight(id, on, silent = true) {
    const e = this.lights.get(id); if (!e) return;
    e.on = on;
    if (!on) e.light.intensity = 0; else e.light.intensity = e.base;
  }
  glowSprite(tex, x, y, z, scale = 1, opacity = 0.5) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.set(x, y, z); s.scale.set(scale, scale, 1);
    this.scene.add(s);
    return s;
  }

  addTrigger(id, x0, z0, x1, z1, cb, { once = true, y0 = 0, y1 = 3 } = {}) {
    const t = { id, box: new AABB(x0, z0, x1, z1, y0, y1), cb, once, fired: false };
    this.triggers.push(t);
    return t;
  }
  clearTriggers(prefix = '') { this.triggers = this.triggers.filter(t => !t.id.startsWith(prefix)); }

  // ---------------------------------------------------------
  _buildMaterials() {
    const T = this.T;
    this.M = {
      stucco: this.texMat(T.stucco), roof: this.texMat(T.roof),
      wallInt: this.texMat(T.wallInt), wallpaper: this.texMat(T.wallpaper),
      wainscot: this.texMat(T.wainscot), carpet: this.texMat(T.carpet),
      linoleum: this.texMat(T.linoleum), tileBath: this.texMat(T.tileBath),
      ceiling: this.texMat(T.ceiling), woodDark: this.texMat(T.woodDark),
      woodLight: this.texMat(T.woodLight), metal: this.texMat(T.metal),
      curtain: this.texMat(T.curtain), bed: this.texMat(T.bedspread),
      pillow: this.texMat(T.pillow), concrete: this.texMat(T.concrete),
      asphalt: this.texMat(T.asphalt), dirt: this.texMat(T.dirt),
      dark: this.mat({ color: 0x17130e }), trim: this.mat({ color: 0x35291d }),
      glass: new THREE.MeshLambertMaterial({ color: 0x0d1116, transparent: true, opacity: 0.55 }),
      mirror: this.texMat(T.mirror),
    };
    this.M.chainlink = new THREE.MeshLambertMaterial({
      map: canvasTex(64, 64, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.strokeStyle = 'rgba(140,140,145,.9)'; c.lineWidth = 2;
        for (let i = -w; i < w * 2; i += 12) {
          c.beginPath(); c.moveTo(i, 0); c.lineTo(i + w, h); c.stroke();
          c.beginPath(); c.moveTo(i + w, 0); c.lineTo(i, h); c.stroke();
        }
      }, { repeat: [6, 3] }), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide,
    });
  }

  wallX(x, z0, z1, tex, th = 0.24) { // wall running along z (facing x)
    this.box(th, WALL_H, z1 - z0, tex, x, WALL_H / 2, (z0 + z1) / 2, { collide: true, sight: true, name: 'wall' });
    // exterior shell slightly thicker => no z-fighting
    this.box(th + 0.06, EXT_H, z1 - z0 + 0.02, this.M.stucco, x, EXT_H / 2, (z0 + z1) / 2, { castShadow: false });
  }
  wallZ(z, x0, x1, tex, th = 0.24) { // wall running along x (facing z)
    this.box(x1 - x0, WALL_H, th, tex, (x0 + x1) / 2, WALL_H / 2, z, { collide: true, sight: true, name: 'wall' });
    this.box(x1 - x0 + 0.02, EXT_H, th + 0.06, this.M.stucco, (x0 + x1) / 2, EXT_H / 2, z, { castShadow: false });
  }

  _buildTerrain() {
    const M = this.M;
    // ground base: dirt everywhere
    const g = new THREE.Mesh(new THREE.PlaneGeometry(150, 120), M.dirt);
    g.rotation.x = -Math.PI / 2; g.position.set(0, -0.02, -10); g.receiveShadow = true;
    this.scene.add(g);
    // parking lot asphalt
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(96, 26), M.asphalt);
    lot.rotation.x = -Math.PI / 2; lot.position.set(-1, 0, -14.5); lot.receiveShadow = true;
    this.scene.add(lot);
    // road
    const road = new THREE.Mesh(new THREE.PlaneGeometry(160, 8), M.asphalt);
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0.005, -30); road.receiveShadow = true;
    this.scene.add(road);
    // road center line
    for (let x = -70; x < 70; x += 6) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.16), this.mat({ color: 0x6d6440 }));
      l.rotation.x = -Math.PI / 2; l.position.set(x, 0.012, -30.2);
      this.scene.add(l);
    }
    // walkway concrete
    const walk = new THREE.Mesh(new THREE.BoxGeometry(96, 0.12, 3.0), M.concrete);
    walk.position.set(-1, 0.06, -1.3); walk.receiveShadow = true;
    this.scene.add(walk);
    // curb strips + parking lines
    for (let x = -38; x <= 14; x += 6) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 3.6), this.mat({ color: 0x7a745a }));
      l.rotation.x = -Math.PI / 2; l.rotation.z = 0; l.position.set(x + 3, 0.015, -7.5);
      l.material.transparent = true; l.material.opacity = 0.6;
      this.scene.add(l);
    }
    // perimeter fence (chain link) + posts
    const fmat = M.chainlink, postMat = this.mat({ color: 0x3a3a3e });
    const fenceRun = (x0, z0, x1, z1) => {
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.9), fmat);
      f.position.set((x0 + x1) / 2, 0.95, (z0 + z1) / 2);
      f.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
      f.castShadow = false; this.scene.add(f);
      const n = Math.floor(len / 3);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        this.box(0.07, 1.9, 0.07, postMat, x0 + dx * t, 0.95, z0 + dz * t, { castShadow: false });
      }
      const b = new AABB(Math.min(x0, x1) - 0.1, Math.min(z0, z1) - 0.1, Math.max(x0, x1) + 0.1, Math.max(z0, z1) + 0.1, 0, 1.9);
      b.tag = 'fence'; b.blocksSight = false;
      this.colliders.push(b);
    };
    fenceRun(-47, 12, 47, 12);   // north (trees beyond)
    fenceRun(47, 12, 47, -33);   // east
    fenceRun(-47, 12, -47, -33); // west
    fenceRun(-47, -33, 20, -33); // south (road side) — driveway gap x 20..30
    fenceRun(30, -33, 47, -33);
    // trees beyond the fence (dark pines)
    const treeMat = this.mat({ color: 0x0d1410 }), trunkMat = this.mat({ color: 0x171310 });
    this.trees = [];
    for (let i = 0; i < 26; i++) {
      const tx = rand(-70, 70) , tz = rand(14, 34) * (i % 2 ? 1 : 1);
      const ttz = i < 16 ? rand(14, 32) : -rand(34, 50); // mainly north, some across road
      const th = rand(4, 9);
      const grp = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(th * 0.32, th, 6), treeMat);
      cone.position.y = th * 0.62;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, th * 0.35, 5), trunkMat);
      trunk.position.y = th * 0.16;
      grp.add(cone, trunk);
      grp.position.set(tx, 0, ttz);
      this.scene.add(grp);
      this.trees.push(grp);
    }
    // filled-in pool (lore) with sign — west end of lot
    const pool = new THREE.Mesh(new THREE.CircleGeometry(4.6, 14), M.dirt);
    pool.rotation.x = -Math.PI / 2; pool.position.set(-36, 0.02, -18); pool.receiveShadow = true;
    this.scene.add(pool);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(4.7, 0.14, 5, 18), M.concrete);
    rim.rotation.x = Math.PI / 2; rim.position.set(-36, 0.06, -18);
    this.scene.add(rim);
    const ps = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.7), this.emisMat(this.T.plate('POOL CLOSED', '#26221c', '#c8b070'), 0x776644, 0.15));
    ps.position.set(-31.4, 1.1, -16.8); ps.rotation.y = Math.PI / 4;
    this.scene.add(ps);
  }

  _buildSky() {
    this.scene.background = new THREE.Color(0x030409);
    this.scene.fog = new THREE.FogExp2(0x05060a, 0.02);
    // stars
    const n = 340, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), r = rand(60, 110), y = rand(12, 70);
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x8b93b8, size: 0.13, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.8 }));
    this.scene.add(this.stars);
    // moon
    this.moon = this.glowSprite(this.T.moon, 48, 34, -60, 15, 0.8);
    this.moon.material.fog = false;
    // ambience: hemisphere + tiny ambient
    this.hemi = new THREE.HemisphereLight(0x232c3f, 0x0a0a08, 0.42);
    this.scene.add(this.hemi);
    this.moonlight = new THREE.DirectionalLight(0x2e3a55, 0.3);
    this.moonlight.position.set(40, 50, -40);
    this.scene.add(this.moonlight);
  }

  _buildBuilding() {
    const M = this.M, T = this.T;
    // floor slabs per section will be laid per-room; building roof + parapet:
    this.box(58.5, 0.25, 6.4, M.roof, -12, WALL_H + 0.14, 2.8, { castShadow: false });
    this.box(58.5, 0.7, 0.18, M.stucco, -12, WALL_H + 0.55, -0.1, { castShadow: false }); // front parapet
    // exterior end walls (boarded room7 x -41..-35 ... adjust: rooms strip x -41..+15)
    // --- main facade z=0 with door/window openings: build wall segments per unit.
    const front = [
      // [x0, x1, kind] kind: wall | door | window
      [-41, -36.5, 'wall'], [-36.5, -35.5, 'door7'], [-35.5, -33, 'wall'],
      [-33, -32.2, 'window6'], [-32.2, -30.5, 'wall'], [-30.5, -29.5, 'door6'], [-29.5, -27.8, 'window6'], [-27.8, -27, 'wall'],
      [-27, -26.2, 'window5'], [-26.2, -24.5, 'wall'], [-24.5, -23.5, 'door5'], [-23.5, -21.8, 'window5'], [-21.8, -21, 'wall'],
      [-21, -20.2, 'window4'], [-20.2, -18.5, 'wall'], [-18.5, -17.5, 'door4'], [-17.5, -15.8, 'window4'], [-15.8, -15, 'wall'],
      [-15, -14.2, 'window3'], [-14.2, -12.5, 'wall'], [-12.5, -11.5, 'door3'], [-11.5, -9.8, 'window3'], [-9.8, -9, 'wall'],
      [-9, -8.2, 'window2'], [-8.2, -6.5, 'wall'], [-6.5, -5.5, 'door2'], [-5.5, -3.8, 'window2'], [-3.8, -3, 'wall'],
      [-3, -1.1, 'windowL'], [-1.1, -0.55, 'wall'], [-0.55, 0.55, 'doorL'], [0.55, 1.1, 'wall'], [1.1, 3, 'windowL'],
      [3, 3.6, 'wall'], [3.6, 4.6, 'doorO'], [4.6, 8.3, 'wall'], [8.3, 13.7, 'windowO'], [13.7, 15, 'wall'],
    ];
    for (const [x0, x1, kind] of front) {
      if (kind.startsWith('wall')) { this.wallZ(0, x0, x1, M.stucco); continue; }
      if (kind.startsWith('door')) {
        // lintel above door
        this.box(x1 - x0, WALL_H - 2.1, 0.24, M.stucco, (x0 + x1) / 2, 2.1 + (WALL_H - 2.1) / 2, 0);
        this.box(x1 - x0, EXT_H, 0.24, M.stucco, (x0 + x1) / 2, EXT_H / 2 + WALL_H / 2, 0, { castShadow: false });
        continue;
      }
      // window: sill wall below, header above, glass + curtains by room
      this.box(x1 - x0, 1.0, 0.24, M.stucco, (x0 + x1) / 2, 0.5, 0, { collide: true, sight: true, name: 'winwall' });
      this.box(x1 - x0, WALL_H - 2.1, 0.24, M.stucco, (x0 + x1) / 2, 2.1 + (WALL_H - 2.1) / 2, 0, { name: 'winhead' });
      this.box(x1 - x0, EXT_H - WALL_H, 0.24, M.stucco, (x0 + x1) / 2, WALL_H + (EXT_H - WALL_H) / 2, 0, { castShadow: false });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.06, 1.05), M.glass);
      glass.position.set((x0 + x1) / 2, 1.55, 0);
      this.scene.add(glass);
    }
    this._facade = front;
    // back wall z=5.6
    this.wallZ(5.6, -41, 15, M.stucco);
    // side walls
    this.wallX(-41, 0, 5.6, M.stucco);
    this.wallX(15, 0, 5.6, M.stucco);
    // interior partitions
    const part = (x) => this.wallX(x, 0, 5.6, M.wallInt, 0.18);
    for (const x of [-33, -27, -21, -15, -9, -3, 3]) part(x);
    // awning over walkway
    const awn = new THREE.Mesh(new THREE.BoxGeometry(57, 0.12, 3.1), this.mat({ color: 0x4c3428 }));
    awn.position.set(-12.4, 2.62, -1.35); awn.rotation.x = 0.06;
    awn.castShadow = true;
    this.scene.add(awn);
    // awning columns
    for (const x of [-39.5, -33, -27, -21, -15, -9, -3, 3, 9, 14.5]) {
      this.box(0.14, 2.62, 0.14, this.mat({ color: 0x3a2f26 }), x, 1.31, -2.55, { collide: true, name: 'column' });
    }
    // walkway lights (under awning): fixture + glow sprite; 3 real point lights
    this.walkLampMeshes = [];
    this.walkLampGlows = [];
    const lampXs = [-33, -24, -15, -6, 2];
    this.walkLampsAt = lampXs;
    for (const x of lampXs) {
      const fix = this.box(0.4, 0.08, 0.16, M.metal, x, 2.5, -1.35, { castShadow: false });
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.1), this.emisMat(null, 0xffd9a0, 1.4));
      tube.material.color = new THREE.Color(0x1c1a16);
      tube.position.set(x, 2.46, -1.35);
      this.scene.add(tube);
      this.walkLampMeshes.push(tube);
      this.walkLampGlows.push(this.glowSprite(this.T.glowDot, x, 2.44, -1.35, 1.6, 0.4));
    }
    this.addLight('walk1', -24, 2.4, -1.5, 0xffc890, 5, 12);
    this.addLight('walk2', -6, 2.4, -1.5, 0xffc890, 5, 12);
    this.addLight('walk3', 8.5, 2.4, -1.5, 0xffc890, 4.2, 11);
    // bad flickering lamp at -15 handled via flickers on mesh + glow
    this.props.porchGlow = this.glowSprite(this.T.glowDot, 4.2, 2.4, -0.4, 2.2, 0.32);
  }

  // ---------- shared room dressing ----------
  _roomShell(x0, x1, floorTex, wallTex) {
    const cx = (x0 + x1) / 2, w = x1 - x0 - 0.2;
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, 5.5), floorTex);
    fl.rotation.x = -Math.PI / 2; fl.position.set(cx, 0.02, 2.8); fl.receiveShadow = true;
    this.scene.add(fl);
    const ce = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, 5.5), this.M.ceiling);
    ce.rotation.x = Math.PI / 2; ce.position.set(cx, WALL_H, 2.8);
    this.scene.add(ce);
    // inner wall faces
    const back = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, WALL_H), wallTex);
    back.position.set(cx, WALL_H / 2, 5.47); back.rotation.y = Math.PI;
    this.scene.add(back);
    const frontIn = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, WALL_H), wallTex);
    frontIn.position.set(cx, WALL_H / 2, 0.125);
    this.scene.add(frontIn);
    // wainscot strip
    const wn = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, 0.85), this.M.wainscot);
    wn.position.set(cx, 0.425, 5.465); wn.rotation.y = Math.PI;
    this.scene.add(wn);
  }

  _bed(x, z, ry = 0) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.22, 2.05), this.M.woodDark);
    frame.position.y = 0.22;
    const mat = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.18, 1.95), this.texMat(this.T.pillow));
    mat.position.y = 0.42;
    const spread = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.7), this.M.bed);
    spread.position.set(0, 0.52, 0.14);
    const pil = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.4), this.M.pillow);
    pil.position.set(0, 0.58, -0.72);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.8, 0.08), this.M.woodDark);
    head.position.set(0, 0.6, -1.05);
    g.add(frame, mat, spread, pil, head);
    g.position.set(x, 0, z); g.rotation.y = ry;
    g.traverse(m => { m.castShadow = true; m.receiveShadow = true; });
    this.scene.add(g);
    const rad = Math.abs(Math.sin(ry)) > 0.5;
    const b = AABB.fromCenter(x, z, rad ? 2.05 : 1.55, rad ? 1.55 : 2.05, 0, 0.62);
    b.tag = 'bed'; this.colliders.push(b);
    return g;
  }

  _dresser(x, z, ry = 0, withTV = true) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.5), this.M.woodLight);
    body.position.y = 0.475;
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    // drawer fronts (visual only)
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.03), this.M.woodDark);
      d.position.set(-0.36 + i * 0.72, 0.62, -0.26); g.add(d);
      const d2 = d.clone(); d2.position.y = 0.24; g.add(d2);
    }
    g.position.set(x, 0, z); g.rotation.y = ry;
    this.scene.add(g);
    const rad = Math.abs(Math.sin(ry)) > 0.5;
    const b = AABB.fromCenter(x, z, rad ? 0.5 : 1.5, rad ? 1.5 : 0.5, 0, 0.95);
    b.tag = 'dresser'; this.colliders.push(b);
    if (withTV) this.props._lastTv = this._tv(x, 0.95, z, ry);
    return g;
  }

  _tv(x, y, z, ry = 0, texOff = true) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.42), this.mat({ color: 0x211f1c }));
    body.castShadow = true;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4),
      texOff ? this.texMat(this.T.tvScreenOff) : this.emisMat(this.tvNoiseTex(), 0xaabbcc, 0.9));
    scr.position.set(0, 0.01, -0.215); scr.rotation.y = Math.PI;
    body.add(scr);
    g.add(body);
    g.position.set(x, y + 0.26, z); g.rotation.y = ry + Math.PI;
    this.scene.add(g);
    g.userData.screen = scr;
    return g;
  }

  tvNoiseTex() {
    if (this._tvTex) return this._tvTex;
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48;
    this._tvCtx = cv.getContext('2d');
    this._tvTex = new THREE.CanvasTexture(cv);
    this._tvTex.magFilter = THREE.NearestFilter; this._tvTex.colorSpace = THREE.SRGBColorSpace;
    return this._tvTex;
  }
  setTvNoise(g, on) {
    const scr = g.userData.screen; if (!scr) return;
    scr.material = on ? this.emisMat(this.tvNoiseTex(), 0xaabbcc, 1.1) : this.texMat(this.T.tvScreenOff);
    g.userData.on = on;
  }

  _nightstand(x, z) {
    this.box(0.5, 0.55, 0.42, this.M.woodLight, x, 0.275, z, { collide: true, name: 'nightstand' });
  }

  _lampOn(x, y, z) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.24, 8), this.mat({ color: 0x6b5a40 }));
    base.position.set(x, y + 0.12, z);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.18, 8, 1, true), this.emisMat(null, 0xffdfae, 0.7));
    shade.material.side = THREE.DoubleSide;
    shade.position.set(x, y + 0.32, z);
    this.scene.add(base, shade);
    this.glowSprite(this.T.glowDot, x, y + 0.34, z, 0.9, 0.4);
    return shade;
  }

  _closet(x, z, id, facing = 1) { // on partition wall x, sliding louver doors — hides you
    // niche in: frame + 2 doors
    const w = 1.3, depth = 0.72, h = 2.2;
    const back = this.box(0.06, h, w, this.M.wallInt, x + facing * (depth + 0.06), h / 2, z, { name: 'closetback' });
    const top = this.box(depth, 0.1, w, this.M.woodDark, x + facing * depth / 2, h + 0.05, z);
    const side1 = this.box(depth, h, 0.06, this.M.woodDark, x + facing * depth / 2, h / 2, z - w / 2 - 0.03, { collide: true, name: 'closetside' });
    const side2 = this.box(depth, h, 0.06, this.M.woodDark, x + facing * depth / 2, h / 2, z + w / 2 + 0.03, { collide: true, name: 'closetside' });
    // louver door (single interactive panel sliding sideways)
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.05, h - 0.1, w), new THREE.MeshLambertMaterial({
      map: canvasTex(64, 128, (c, W, H) => {
        c.fillStyle = '#6a5335'; c.fillRect(0, 0, W, H);
        for (let y = 4; y < H; y += 8) { c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(0, y, W, 3); }
      }),
    }));
    doorPanel.position.set(x + (facing > 0 ? 0.02 : -0.02), h / 2, z);
    doorPanel.castShadow = true;
    this.scene.add(doorPanel);
    const closed = AABB.fromCenter(doorPanel.position.x, z, 0.12, w, 0, h);
    closed.blocksSight = true; closed.tag = 'closet:' + id;
    this.colliders.push(closed);
    const st = { open01: 0, target: 0, panel: doorPanel, closed, x, z, w, facing };
    this.props['closet_' + id] = st;
    // darkness inside
    this.hideSpots.set(id, {
      id, eye: new THREE.Vector3(x + facing * (depth * 0.6), 1.45, z),
      stand: new THREE.Vector3(x + facing * (depth * 0.6), 0, z),
      exit: new THREE.Vector3(x - facing * 0.7, 0, z),
      st,
    });
  }

  _windowCurtains(x0, x1, z, id, { closed = false, lit = null } = {}) {
    // curtain planes just inside the window; emissive backing if room lit
    const w = x1 - x0 - 0.1, cx = (x0 + x1) / 2;
    const grp = new THREE.Group();
    const mkC = (ww, off) => {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(ww, 1.06), this.texMat(this.T.curtain, { side: THREE.DoubleSide }));
      c.position.set(cx + off, 1.55, z + 0.1);
      grp.add(c); return c;
    };
    const left = mkC(w / 2, -w / 4), right = mkC(w / 2, w / 4);
    let litPlane = null;
    if (lit) {
      litPlane = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.06), this.emisMat(null, lit, 0.85));
      litPlane.material.color = new THREE.Color(0x111111);
      litPlane.position.set(cx, 1.55, z + 0.05); litPlane.rotation.y = Math.PI;
      this.scene.add(litPlane);
    }
    this.scene.add(grp);
    const st = { left, right, litPlane, cx, w, open: closed ? 0 : 1 };
    this._applyCurtains(st);
    this.props['curtains_' + id] = st;
    return st;
  }
  _applyCurtains(st) {
    // open: panels retract to sides (thin); closed: cover window
    const o = st.open;
    const lw = lerp(st.w / 2, 0.16, o), off = lerp(st.w / 4, st.w / 2 - 0.08, o);
    st.left.scale.x = lw / (st.w / 2); st.left.position.x = st.cx - off;
    st.right.scale.x = lw / (st.w / 2); st.right.position.x = st.cx + off;
  }
  setCurtains(id, open) { const st = this.props['curtains_' + id]; if (st) { st.open = open; this._applyCurtains(st); } }

  _setup() {
    // surface lookup for footsteps
    this._surfaces = [
      new AABB(-41, -0.1, 15, 5.7, 0, 3),       // inside building: set below per room override
    ];
  }

  surfaceAt(x, z) {
    if (z > -0.2 && z < 5.7 && x > -41 && x < 15) {
      if (x > -3 && x < 3) return 'concrete';  // laundry linoleum
      return 'carpet';                          // office + guest rooms
    }
    if (z > -2.9 && z <= 0) return 'concrete';  // covered walkway
    if (z > 5.7) return 'dirt';                 // back alley
    return 'asphalt';                           // lot & road
  }

  _buildRooms() {} // implemented in world-rooms (called below via mixin)
  _buildOffice() {}
  _buildLaundry() {}
  _buildLot() {}
  _buildCCTV() {}

  update(dt) {
    this.time += dt;
    for (const d of this.doors.values()) d.update(dt);
    for (const d of this.drawers.values()) d.update(dt);
    // closet panels
    for (const k of Object.keys(this.props)) {
      if (!k.startsWith('closet_')) continue;
      const st = this.props[k];
      st.open01 = lerp(st.open01, st.target, 1 - Math.exp(-4.5 * dt));
      st.panel.position.z = st.z + st.open01 * st.w * 0.95;
      st.closed.solid = st.open01 < 0.7;
    }
    // flickers
    for (const f of this.flickers) {
      f.t += dt * f.speed;
      const v = f.eval(f.t);
      if (f.entry) f.entry.light.intensity = f.entry.on ? f.entry.base * v : 0;
      if (f.mesh) { f.mesh.material.emissiveIntensity = v * (f.emisBase || 1.4); }
      if (f.sprite) f.sprite.material.opacity = f.spriteBase * v;
    }
    // tv noise
    if (this._tvTex) {
      this.tvDirty -= dt;
      if (this.tvDirty <= 0) {
        this.tvDirty = 0.12;
        const ctx = this._tvCtx;
        const img = ctx.createImageData(64, 48);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 90 + 20;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        this._tvTex.needsUpdate = true;
      }
    }
    // big neon sign flicker
    if (this.props.signStar) {
      let v = 1;
      if (this.signFlicker) {
        const t = this.time * 13;
        v = (Math.sin(t) > -0.82 ? 1 : 0.12) * (0.88 + 0.12 * Math.sin(t * 4.7));
        if (Math.random() < 0.004) v = 0.05;
      }
      this.props.signStar.material.emissiveIntensity = 1.25 * v;
      this.props.signMotel.material.emissiveIntensity = 1.15 * v;
      const sl = this.lights.get('sign'); if (sl && sl.on) sl.light.intensity = sl.base * v;
      if (this.props.signGlow) this.props.signGlow.material.opacity = 0.5 * v;
    }
    // walkway bad lamp flicker (index 2 = x -15)
    const bad = this.walkLampMeshes[2], badGlow = this.walkLampGlows[2], wl2 = this.lights.get('walk2');
    if (bad && this._powerFlag) {
      const t = this.time * 9;
      const v = Math.sin(t * 0.7) > -0.2 ? (Math.random() < 0.08 ? 0.1 : 1) : 0.15;
      bad.material.emissiveIntensity = v * 1.3;
      badGlow.material.opacity = 0.34 * v;
    }
    // CCTV render (every 2nd frame)
    this._cctTick = (this._cctTick || 0) + 1;
    if (this.cctv && this._cctTick % 2 === 0 && this.cctv.live) {
      const r = this.G.renderer;
      r.setRenderTarget(this.cctv.rt);
      r.render(this.scene, this.cctv.cam);
      r.setRenderTarget(null);
    }
    // triggers
    const p = this.G.player;
    if (p) {
      for (const t of this.triggers) {
        if (t.fired && t.once) continue;
        if (t.box.contains2D(p.pos.x, p.pos.z)) {
          t.fired = true;
          t.cb();
        }
      }
    }
    // wall clock
    if (this.props.clockMin && this.G.story) {
      const mins = this.G.story.clockMin;
      this.props.clockMin.rotation.z = -((mins % 60) / 60) * Math.PI * 2;
      this.props.clockHr.rotation.z = -(((mins / 60) % 12) / 12) * Math.PI * 2;
    }
  }
}

// mixins are defined in world2.js and applied by main via worldApplyMixins
