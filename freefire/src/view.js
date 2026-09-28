// ── BOOYAH FIRE — the match view: characters, gunfire, loot, camera ──────────
// Reads the simulation and draws it. Never writes game state (except the
// camera / input yaw+pitch which the sim consumes).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { World, makeAirdropCrate, makeGlooWall } from './world.js';
import { clamp, clamp01, lerp, dist2D, TAU } from './util.js';
import { WEAPONS, ITEMS, VEST, HELMET, BAG, VEHICLES, SKINS_CHAR, SKINS_GUN, SKINS_CHUTE } from './data.js';
import { bindThree, itemLabelTex, smokeTex, sparkTex } from './tex.js';

bindThree(THREE);

const V = new THREE.Vector3();

function spriteMat(map, additive = false) {
  return new THREE.SpriteMaterial({
    map: map || null,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    color: 0xffffff,
  });
}

// ── floating name plate ──────────────────────────────────────────────────────
const nameCache = new Map();
const hasDOM = typeof document !== 'undefined';
function nameTex(name, color = '#ffffff') {
  if (!hasDOM) return null;
  const key = name + color;
  if (nameCache.has(key)) return nameCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 32);
  g.fillStyle = color;
  g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (nameCache.size > 90) { const f = nameCache.keys().next().value; const t2 = nameCache.get(f); if (t2 && t2.dispose) t2.dispose(); nameCache.delete(f); }
  nameCache.set(key, t);
  return t;
}

function colBox(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  const col = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  g.translate(x, y, z);
  return g;
}

// one merged mesh per (weapon × gun-skin) — shared by every character using it
const gunCache = new Map();
function gunMesh(weaponId, skinIndex) {
  const key = weaponId + ':' + skinIndex;
  if (gunCache.has(key)) return gunCache.get(key);
  const def = WEAPONS[weaponId];
  const skin = SKINS_GUN[skinIndex] || SKINS_GUN[0];
  const long = def.kind === 'sniper' ? 1.5 : def.kind === 'smg' || def.kind === 'pistol' ? 0.62 : 1.15;
  const parts = [
    colBox(0.09, 0.14, long, 0, 0, long * 0.35, skin.tint),
    colBox(0.08, 0.22, 0.1, 0, -0.14, 0.05, skin.accent),
    colBox(0.07, 0.2, 0.12, 0, -0.14, long * 0.24, skin.accent),
  ];
  if (def.kind === 'sniper' || def.kind === 'dmr') parts.push(colBox(0.09, 0.09, 0.34, 0, 0.12, long * 0.3, skin.accent));
  if (def.pellets) parts.push(colBox(0.08, 0.09, 0.26, 0, -0.05, long * 0.5, skin.accent));
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  gunCache.set(key, mesh);
  return mesh;
}

// ── a chibi battle-royale character built from primitives ────────────────────
export class Avatar {
  constructor(ent, opts = {}) {
    this.ent = ent;
    this.group = new THREE.Group();
    this.anim = 0;
    this.deadT = -1;
    this.detail = opts.detail !== false;

    const skin = SKINS_CHAR[opts.skinIndex || 0];
    const skinCol = skin ? skin.colors : [ent.char.skin, '#2c3550', '#e8b98f'];
    const cloth = skinCol[0], pants = skinCol[1], face = skinCol[2];
    const isAlly = opts.ally;

    this.matBody = new THREE.MeshLambertMaterial({ color: new THREE.Color(cloth) });
    this.matPants = new THREE.MeshLambertMaterial({ color: new THREE.Color(pants) });
    this.matSkin = new THREE.MeshLambertMaterial({ color: new THREE.Color(face) });
    this.matGear = new THREE.MeshLambertMaterial({ color: new THREE.Color('#2b3038') });

    // torso + backpack merged into one draw call (vertex colours)
    const torsoGeo = colBox(0.62, 0.72, 0.36, 0, 1.02, 0, cloth);
    const packGeo = colBox(0.42, 0.5, 0.24, 0, 1.06, -0.26, '#2b3038');
    const torso = new THREE.Mesh(mergeGeometries([torsoGeo.toNonIndexed(), packGeo.toNonIndexed()], false), new THREE.MeshLambertMaterial({ vertexColors: true }));
    torso.castShadow = true;
    this.torso = torso;
    this.group.add(torso);
    // backpack (visible from level 1 up, tints and grows with the tier)
    this.bag = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.3), new THREE.MeshLambertMaterial({ color: new THREE.Color(BAG[1].color) }));
    this.bag.position.set(0, 1.2, -0.34);
    this.bag.castShadow = true;
    this.bag.visible = false;
    this.group.add(this.bag);
    // vest plate
    this.vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.5, 0.42), new THREE.MeshLambertMaterial({ color: new THREE.Color(VEST[0].color) }));
    this.vest.position.y = 1.06;
    this.group.add(this.vest);
    // head + helmet
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.34), this.matSkin);
    head.position.y = 1.58;
    this.head = head;
    this.group.add(head);
    this.helmet = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(HELMET[0].color) }));
    this.helmet.position.y = 1.62;
    this.helmet.scale.z = 1.05;
    this.group.add(this.helmet);
    // arms & legs
    const limb = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    this.armL = limb(0.16, 0.58, 0.16, this.matBody);
    this.armL.geometry.translate(0, -0.29, 0);
    this.armL.position.set(-0.39, 1.3, 0);
    this.armR = limb(0.16, 0.58, 0.16, this.matBody);
    this.armR.geometry.translate(0, -0.29, 0);
    this.armR.position.set(0.39, 1.3, 0);
    this.legL = limb(0.2, 0.62, 0.2, this.matPants);
    this.legL.geometry.translate(0, -0.31, 0);
    this.legL.position.set(-0.15, 0.66, 0);
    this.legR = limb(0.2, 0.62, 0.2, this.matPants);
    this.legR.geometry.translate(0, -0.31, 0);
    this.legR.position.set(0.15, 0.66, 0);
    for (const p of [this.armL, this.armR, this.legL, this.legR]) { p.castShadow = true; this.group.add(p); }

    // gun (swapped by weapon type)
    this.gunGroup = new THREE.Group();
    this.gunGroup.position.set(0.36, 1.16, 0.1);
    this.group.add(this.gunGroup);
    this.gunSkin = SKINS_GUN[opts.gunSkin || 0];
    this._gunSkinIndex = opts.gunSkin || 0;
    this._gunWeapon = null;

    // muzzle flash anchor
    this.muzzle = new THREE.Sprite(spriteMat(sparkTex(), true));
    this.muzzle.scale.set(0.9, 0.9, 1);
    this.muzzle.visible = false;
    this.gunGroup.add(this.muzzle);

    // parachute
    this.chute = new THREE.Group();
    const ch = SKINS_CHUTE[opts.chuteSkin || 0];
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.46),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(ch.a), side: THREE.DoubleSide })
    );
    dome.scale.y = 0.75;
    dome.position.y = 4.1;
    this.chute.add(dome);
    const dome2 = new THREE.Mesh(new THREE.SphereGeometry(1.99, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.2),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(ch.b), side: THREE.DoubleSide }));
    dome2.scale.y = 0.75;
    dome2.position.y = 4.1;
    this.chute.add(dome2);
    for (const a of [0.6, 2.7, 4.4]) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3.9, 3),
        new THREE.MeshBasicMaterial({ color: 0xdddddd }));
      line.position.set(Math.cos(a) * 0.9, 2.1, Math.sin(a) * 0.9);
      this.chute.add(line);
    }
    this.chute.visible = false;
    this.group.add(this.chute);

    // name plate + squad HP bar
    this.plate = new THREE.Sprite(spriteMat(nameTex(ent.name, isAlly ? '#7dfb8a' : '#ffd9d9')));
    this.plate.scale.set(2.2, 0.55, 1);
    this.plate.position.y = 2.15;
    this.plate.visible = false;
    this.group.add(this.plate);
    this.hpBar = new THREE.Sprite(spriteMat(null));
    this.hpBar.scale.set(1.1, 0.14, 1);
    this.hpBar.position.y = 1.92;
    this.hpBar.visible = false;
    this.hpBar.material.color = new THREE.Color('#4ade80');
    this.group.add(this.hpBar);

    this.setRig(this.ent.helmet, this.ent.vest, this.ent.bag);
  }

  setRig(helmet, vest, bag) {
    this.helmet.material.color.set(HELMET[helmet || 0].color);
    this.vest.material.color.set(VEST[vest || 0].color);
    this.vest.visible = (vest || 0) > 0;
    this.helmet.visible = (helmet || 0) > 0;
    const b = bag || 0;
    this.bag.visible = b > 0;
    if (b > 0) {
      this.bag.material.color.set(BAG[b].color);
      const k = 1 + (b - 1) * 0.12;
      this.bag.scale.set(k, k, k);
    }
  }

  setGun(weaponId) {
    if (this._gunWeapon === weaponId) return;
    this._gunWeapon = weaponId;
    this.gunGroup.clear();
    this.gunGroup.add(this.muzzle);
    if (!weaponId) return;
    const mesh = gunMesh(weaponId, this._gunSkinIndex || 0);
    this.gunMesh = mesh;
    this.gunGroup.add(mesh);
  }

  flash() {
    this.muzzle.visible = true;
    this.muzzle.material.opacity = 1;
    this.muzzle.scale.setScalar(0.75 + Math.random() * 0.35);
    this._flashT = 0.055;
  }

  update(dt, isLocal, lod = 0) {
    const e = this.ent;
    this.group.position.set(e.x, e.y, e.z);
    // distance LOD: drop limbs/gun/plates for tiny far-away characters
    const detail = lod < 0.6;
    if (this._detail !== detail) {
      this._detail = detail;
      for (const p of [this.armL, this.armR, this.legL, this.legR, this.gunGroup]) p.visible = detail;
    }
    this.group.rotation.y = e.yaw;
    const dead = !e.alive;
    if (dead && this.deadT < 0) this.deadT = 0;
    if (this.deadT >= 0) this.deadT += dt;

    // ── models ──
    this.setGun(e.weapons && e.weapons[e.cur] && e.weapons.length ? e.weapons[e.cur].id : null);
    this.setRig(e.helmet, e.vest, e.bag);
    if (this._flashT > 0) {
      this._flashT -= dt;
      this.muzzle.material.opacity = Math.max(0, this._flashT / 0.055);
      if (this._flashT <= 0) this.muzzle.visible = false;
    }
    this.chute.visible = !!e.parachuting;
    if (e.parachuting) {
      this.chute.rotation.z = Math.sin(performance.now() * 0.0012) * 0.07;
      this.torso.rotation.x = -0.35;
      this.armL.rotation.x = -2.4; this.armR.rotation.x = -2.4;
      this.legL.rotation.x = 0.35; this.legR.rotation.x = -0.2;
      this.group.position.y = e.y;
      this.group.rotation.y = e.yaw;
      this.group.rotation.z = Math.sin(performance.now() * 0.001) * 0.05;
      this._plateUpdate(e, isLocal);
      return;
    }
    this.group.rotation.z = 0;

    if (dead) {
      // crumple: fall over and sink a little
      const k = Math.min(1, this.deadT / 0.45);
      this.group.rotation.z = (Math.PI / 2) * k;
      this.group.position.y = e.y + 0.16 * (1 - k);
      this.torso.rotation.x = 0.2;
      this.plate.visible = false;
      this.hpBar.visible = false;
      this.armL.rotation.x = -0.5; this.armR.rotation.x = 0.5;
      this.legL.rotation.x = 0.2; this.legR.rotation.x = -0.2;
      return;
    }

    if (e.knocked) {
      // crawl pose
      this.group.rotation.x = 0.0;
      this.group.rotation.z = 1.35;
      this.group.position.y = e.y + 0.28;
      this.torso.rotation.x = 0.1;
      const cyc = (this.anim += dt * 3.2);
      this.armL.rotation.x = Math.sin(cyc) * 0.7 - 1.5;
      this.armR.rotation.x = -Math.sin(cyc) * 0.7 - 1.5;
      this.legL.rotation.x = Math.sin(cyc) * 0.4;
      this.legR.rotation.x = -Math.sin(cyc) * 0.4;
      this._plateUpdate(e, isLocal);
      return;
    }

    this.group.rotation.x = 0;
    const speed = e.speed || 0;
    const moving = speed > 0.4;
    const cycle = (this.anim += dt * (2.6 + speed * 1.5) * (moving ? 1 : 0));
    const amp = moving ? clamp(speed / 6, 0.25, 1.15) : 0;
    const crouchK = e.crouch ? 1 : 0;
    this.group.position.y = e.y - crouchK * 0.24;

    this.legL.rotation.x = Math.sin(cycle) * 1.0 * amp;
    this.legR.rotation.x = -Math.sin(cycle) * 1.0 * amp;
    const aimUp = e.ads ? -1.15 : -0.75;
    this.armL.rotation.x = lerp(Math.sin(cycle) * 0.8 * amp, aimUp, e.ads ? 0.85 : 0.35);
    this.armR.rotation.x = lerp(-Math.sin(cycle) * 0.8 * amp, aimUp, e.ads ? 0.9 : 0.4);
    this.torso.rotation.y = Math.sin(cycle) * 0.08 * amp;
    this.torso.rotation.x = lerp(0, -0.12, e.ads ? 1 : 0);
    this.head.rotation.x = -clamp(e.pitch || 0, -0.6, 0.6) * 0.6;
    this.helmet.rotation.x = this.head.rotation.x;
    this.gunGroup.rotation.x = -clamp(e.pitch || 0, -0.7, 0.7) * 0.9;
    this.gunGroup.position.y = lerp(1.16, 1.32, e.ads ? 1 : 0);
    this.gunGroup.position.x = lerp(0.36, 0.22, e.ads ? 1 : 0);
    if (e.punchT > 0) this.armR.rotation.x = -2.2 + Math.sin((0.42 - e.punchT) * 22) * 0.6;
    this._plateUpdate(e, isLocal);
  }

  _plateUpdate(e) {
    const t = performance.now() * 0.001;
    if (e.isPlayer) { this.plate.visible = false; this.hpBar.visible = false; return; }
    this.plate.visible = !!this._showPlate;
    this.hpBar.visible = !!this._showPlate && !this.ent.isPlayer;
    if (this._showPlate) {
      this.plate.position.y = 2.15 + Math.sin(t * 2) * 0.02;
      const hpFrac = clamp01(e.hp / e.maxHp);
      this.hpBar.material.color.set(hpFrac > 0.6 ? '#4ade80' : hpFrac > 0.3 ? '#facc15' : '#ef4444');
      this.hpBar.scale.set(1.1 * hpFrac, 0.14, 1);
      this.hpBar.position.x = -0.55 * (1 - hpFrac);
    }
  }
}

// ═══════════════════════════ MATCH VIEW ═════════════════════════════════════
export class MatchView {
  constructor(battle, opts = {}) {
    this.battle = battle;
    this.lowQ = !!opts.lowQ;
    this.scene = new THREE.Scene();
    const th = battle.theme;
    this.scene.background = new THREE.Color(th.sky[1]);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(th.fog), this.lowQ ? 0.0035 : 0.0026);

    this.world = new World(battle.island, th, { lowQ: this.lowQ });
    this.scene.add(this.world.group);

    this.camera = new THREE.PerspectiveCamera(66, 1, 0.12, 2600);
    this.focus = null;                       // spectated entity (squad mode)
    this.carK = 0;                            // 0 = on foot, 1 = chase camera
    this.scene.add(this.camera);
    this.camDist = 4.6;
    this.camHeight = 1.9;
    this.shake = 0;
    this.adsK = 0;
    this.dead = false;
    this.deadOrbit = 0;

    this.viewGroup = new THREE.Group();
    this.scene.add(this.viewGroup);

    this._buildAvatars(opts);
    this._buildPools();
    this._buildDrops();
    this._buildAirdrops();
    this._buildTracers();
    this._buildGloo();
    this._buildFx();
    // marker ring for the chosen landing spot (drop phase only)
    const mGeo = new THREE.RingGeometry(1.4, 1.9, 28);
    mGeo.rotateX(-Math.PI / 2);
    this.dropMarker = new THREE.Mesh(mGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.viewGroup.add(this.dropMarker);
    this.dropMarker.visible = false;

    this._dropsTimer = 0;
    this._labels = [];
  }

  _buildAvatars(opts) {
    this.avatars = new Map();
    const myTeam = this.battle.player.team;
    for (const e of this.battle.entities) {
      const av = new Avatar(e, {
        ally: e.team === myTeam,
        skinIndex: e.isPlayer ? (opts.skinIndex || 0) : (e.id % SKINS_CHAR.length),
        gunSkin: e.isPlayer ? (opts.gunSkin || 0) : (e.id % SKINS_GUN.length),
        chuteSkin: e.isPlayer ? (opts.chuteSkin || 0) : (e.id % SKINS_CHUTE.length),
      });
      this.avatars.set(e.id, av);
      this.viewGroup.add(av.group);
    }
  }

  _buildPools() {
    // sprites used for impacts / blood / muzzle sparks / explosions
    const spark = spriteMat(sparkTex(), true);
    const smoke = spriteMat(smokeTex(), false);
    this.pools = {
      spark: new SpritePool(this.viewGroup, spark, 90),
      blood: new SpritePool(this.viewGroup, spriteMat(smokeTex(), false), 60, new THREE.Color('#c0141b')),
      smoke: new SpritePool(this.viewGroup, smoke, 120, new THREE.Color('#dcdcdc')),
      flash: new SpritePool(this.viewGroup, spriteMat(sparkTex(), true), 24, new THREE.Color('#ffffff')),
    };
    // explosion shells
    this.booms = [];
    const boomMat = new THREE.MeshBasicMaterial({ color: 0xffa235, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), boomMat.clone());
      m.visible = false;
      this.viewGroup.add(m);
      this.booms.push({ mesh: m, t: 9, dur: 0.55, r: 6 });
    }
  }

  // loot on the ground: instanced per kind, refreshed a few times a second
  _buildDrops() {
    const cap = 900;
    const mk = (geo, color) => {
      const mat = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.25) });
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      im.castShadow = false;
      for (let i = 0; i < cap; i++) im.setColorAt(i, new THREE.Color(color));
      im.instanceColor.needsUpdate = true;
      this.viewGroup.add(im);
      return im;
    };
    this.dropMeshes = {
      weapon: mk(new THREE.BoxGeometry(1.0, 0.12, 0.22), '#e2b13c'),
      item: mk(new THREE.BoxGeometry(0.42, 0.3, 0.42), '#f97316'),
      vest: mk(new THREE.BoxGeometry(0.42, 0.4, 0.3), '#60a5fa'),
      helmet: mk(new THREE.BoxGeometry(0.36, 0.34, 0.36), '#f59e0b'),
      bag: mk(new THREE.BoxGeometry(0.44, 0.52, 0.34), '#9ca3af'),
    };
    // floating labels for the closest loot
    this.labelPool = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(spriteMat(null));
      s.scale.set(1.1, 0.42, 1);
      s.visible = false;
      this.viewGroup.add(s);
      this.labelPool.push(s);
    }
  }

  _buildAirdrops() {
    this.crates = new Map();
    this.vehicleMeshes = new Map();
  }

  _buildTracers() {
    const MAX = 64;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerLines = new THREE.LineSegments(geo, mat);
    this.tracerLines.frustumCulled = false;
    this.viewGroup.add(this.tracerLines);
    this.tracers = [];
  }

  _buildGloo() {
    this.glooMeshes = new Map();
  }

  _buildFx() {
    this.smokeFx = new Map();
    this.flashOverlay = 0;
  }

  dispose() {
    this.world.dispose();
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  update(dt, events, input) {
    const b = this.battle, p = b.player;
    this.world.update(dt, this.camera, b.zone);
    if (p.flash > 0) this.flashOverlay = Math.min(1, p.flash / 2.4);

    // avatars
    const myTeam = p.team;
    for (const e of b.entities) {
      const av = this.avatars.get(e.id);
      const d = dist2D(e.x, e.z, p.x, p.z);
      const squad = e.team === myTeam;
      av._showPlate = !e.isPlayer && e.alive && (squad ? d < 120 : d < 60);
      av.group.visible = d < 340 || e.isPlayer;
      if (av.group.visible) av.update(dt, e.isPlayer, clamp01((d - 70) / 90));
    }

    // events → visuals
    for (const ev of events) this._event(ev, dt);

    // tracers + pools + booms
    this._stepTracers(dt);
    for (const k of Object.keys(this.pools)) this.pools[k].update(dt);
    for (const boom of this.booms) {
      if (boom.t > boom.dur) { boom.mesh.visible = false; continue; }
      boom.t += dt;
      const k = boom.t / boom.dur;
      boom.mesh.visible = true;
      boom.mesh.scale.setScalar(lerp(0.6, boom.r, Math.sqrt(k)));
      boom.mesh.material.opacity = (1 - k) * 0.9;
    }

    // landing marker
    if (b.player.parachuting && b.player.targetLandX !== undefined) {
      this.dropMarker.visible = true;
      const gy = Math.max(b.island.height(b.player.targetLandX, b.player.targetLandZ), 0.05);
      this.dropMarker.position.set(b.player.targetLandX, gy + 0.15, b.player.targetLandZ);
      this.dropMarker.material.opacity = 0.5 + Math.sin(performance.now() * 0.005) * 0.3;
    } else this.dropMarker.visible = false;

    // loot instances
    this._dropsTimer -= dt;
    if (this._dropsTimer <= 0) { this._dropsTimer = 0.12; this._refreshDrops(p); }

    // gloo walls
    this._syncGloo();
    // vehicles
    this._syncVehicles(dt);
    // airdrops
    this._syncAirdrops(dt);
    // smoke / flash effects
    this._syncEffects(dt);

    this._camera(dt, input);
  }

  _event(ev, dt) {
    const b = this.battle;
    switch (ev.type) {
      case 'shoot': {
        const av = this.avatars.get(ev.e.id);
        if (av) av.flash();
        if (ev.e.isPlayer) this.shake = Math.min(0.5, this.shake + 0.045);
        break;
      }
      case 'bulletMiss': {
        if (ev.impact === 'terrain') this.pools.spark.spawn(ev.x, ev.y, ev.z, 0.5, 0.25, new THREE.Color('#cbb27a'));
        else if (ev.impact === 'prop') this.pools.spark.spawn(ev.x, ev.y, ev.z, 0.45, 0.22, new THREE.Color('#ffd9a0'));
        else if (ev.impact === 'gloo') this.pools.spark.spawn(ev.x, ev.y, ev.z, 0.5, 0.25, new THREE.Color('#9fe4ff'));
        // tracer from the shooter (only when close enough to matter)
        if (dist2D(ev.ox, ev.oz, b.player.x, b.player.z) < 140) {
          this.tracers.push({ x1: ev.ox, y1: ev.oy, z1: ev.oz, x2: ev.x, y2: ev.y, z2: ev.z, t: 0, dur: 0.055 + Math.min(0.05, Math.hypot(ev.x - ev.ox, ev.z - ev.oz) / 4000) });
        }
        break;
      }
      case 'bulletHit': {
        this.tracers.push({ x1: ev.e.x, y1: ev.e.y + 1.4, z1: ev.e.z, x2: ev.x, y2: ev.y, z2: ev.z, t: 0, dur: 0.06 });
        this.pools.blood.spawn(ev.x, ev.y, ev.z, 0.42, 0.3, new THREE.Color('#b3141c'));
        if (ev.target.isPlayer) this.shake = Math.min(0.7, this.shake + 0.12);
        break;
      }
      case 'explode': {
        if (ev.kind === 'grenade') {
          const boom = this.booms.find((x) => x.t > x.dur) || this.booms[0];
          boom.t = 0; boom.r = 7.5;
          boom.mesh.position.set(ev.x, ev.y + 1.2, ev.z);
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * TAU, r = Math.random() * 4;
            this.pools.smoke.spawn(ev.x + Math.cos(a) * r, ev.y + 0.6 + Math.random() * 2, ev.z + Math.sin(a) * r, 3.2, 1.5, new THREE.Color('#5c5248'));
          }
          this.pools.spark.spawn(ev.x, ev.y + 0.7, ev.z, 3.4, 0.35, new THREE.Color('#ffb347'));
          const dd = dist2D(ev.x, ev.z, b.player.x, b.player.z);
          this.shake = Math.min(1, this.shake + clamp01(1 - dd / 26) * 0.8);
        } else if (ev.kind === 'flash') {
          for (let i = 0; i < 6; i++) this.pools.flash.spawn(ev.x, ev.y + 1, ev.z, 5, 0.35, new THREE.Color('#ffffff'));
        }
        break;
      }
      case 'vehicleDead': {
        const boom = this.booms.find((x) => x.t > x.dur) || this.booms[0];
        boom.t = 0; boom.r = 9;
        boom.mesh.position.set(ev.v.x, ev.v.y + 1.3, ev.v.z);
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * TAU, r = Math.random() * 4.5;
          this.pools.smoke.spawn(ev.v.x + Math.cos(a) * r, ev.v.y + 0.8 + Math.random() * 2.4, ev.v.z + Math.sin(a) * r, 3.6, 1.8, new THREE.Color('#4a4640'));
        }
        this.pools.spark.spawn(ev.v.x, ev.v.y + 1, ev.v.z, 3.6, 0.4, new THREE.Color('#ffb347'));
        break;
      }
      case 'gloo': {
        if (!ev.g) break;
        const m = makeGlooWall();
        m.position.set(ev.g.x, ev.g.y, ev.g.z);
        m.rotation.y = ev.g.yaw;
        this.viewGroup.add(m);
        this.glooMeshes.set(ev.g, m);
        break;
      }
      case 'landed': {
        if (ev.e.isPlayer) this.shake = Math.min(0.6, this.shake + 0.25);
        break;
      }
      case 'airdrop': {
        if (!ev.a) break;
        const crate = makeAirdropCrate();
        crate.position.set(ev.a.x, ev.a.y, ev.a.z);
        this.viewGroup.add(crate);
        this.crates.set(ev.a, crate);
        break;
      }
      default: break;
    }
  }

  _stepTracers(dt) {
    for (const t of this.tracers) t.t += dt;
    this.tracers = this.tracers.filter((t) => t.t < t.dur);
    const attr = this.tracerLines.geometry.attributes.position;
    const arr = attr.array;
    let i = 0;
    for (const t of this.tracers) {
      if (i >= arr.length / 6) break;
      arr[i * 6] = t.x1; arr[i * 6 + 1] = t.y1; arr[i * 6 + 2] = t.z1;
      arr[i * 6 + 3] = t.x2; arr[i * 6 + 4] = t.y2; arr[i * 6 + 5] = t.z2;
      i++;
    }
    // park unused tracers at the origin
    for (; i < arr.length / 6; i++) {
      arr[i * 6] = arr[i * 6 + 3] = 0;
      arr[i * 6 + 1] = arr[i * 6 + 4] = -1000;
      arr[i * 6 + 2] = arr[i * 6 + 5] = 0;
    }
    attr.needsUpdate = true;
    this.tracerLines.material.opacity = 0.8;
  }

  _refreshDrops(p) {
    const counts = { weapon: 0, item: 0, vest: 0, helmet: 0, bag: 0 };
    const M = new THREE.Matrix4();
    const S = new THREE.Vector3(1, 1, 1);
    const Q = new THREE.Quaternion();
    const P = new THREE.Vector3();
    const near = [];
    for (const d of this.battle.drops) {
      if (d.taken) continue;
      const dist = dist2D(d.x, d.z, p.x, p.z);
      if (dist > 200) continue;
      const kind = d.kind === 'weapon' ? 'weapon' : d.kind === 'item' ? 'item' : d.kind;
      const mesh = this.dropMeshes[kind];
      if (!mesh || counts[kind] >= mesh.instanceMatrix.count) continue;
      const lift = kind === 'weapon' ? 0.16 : 0.22;
      P.set(d.x, (d.y || 0) + lift, d.z);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((d.uid ?? 0) * 1.7) % TAU);
      M.compose(P, Q, S);
      mesh.setMatrixAt(counts[kind], M);
      if (kind === 'helmet' || kind === 'vest' || kind === 'bag') mesh.setColorAt(counts[kind], new THREE.Color((kind === 'vest' ? VEST : kind === 'helmet' ? HELMET : BAG)[d.level || 1].color));
      else if (kind === 'weapon' && d.tier >= 3) mesh.setColorAt(counts[kind], new THREE.Color('#ffd23f'));
      else if (kind === 'item') mesh.setColorAt(counts[kind], new THREE.Color(ITEMS[d.id] ? ITEMS[d.id].color : '#f97316'));
      counts[kind]++;
      if (dist < 16 && near.length < 8) near.push({ d, dist });
    }
    for (const k of Object.keys(this.dropMeshes)) {
      const mesh = this.dropMeshes[k];
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // floating labels for the closest loot
    near.sort((a, b2) => a.dist - b2.dist);
    this.labelPool.forEach((s, i) => {
      const item = near[i];
      if (!item) { s.visible = false; return; }
      const d = item.d;
      let emoji = '📦', label = 'LOOT', color = '#ffcf3f';
      if (d.kind === 'weapon') { emoji = '🔫'; label = WEAPONS[d.id].name; color = d.tier >= 3 ? '#ffd23f' : '#ffe9a8'; }
      else if (d.kind === 'item') { emoji = ITEMS[d.id].icon; label = ITEMS[d.id].name; }
      else if (d.kind === 'vest') { emoji = '🦺'; label = VEST[d.level].name; }
      else if (d.kind === 'helmet') { emoji = '🪖'; label = HELMET[d.level].name; }
      else if (d.kind === 'bag') { emoji = '🎒'; label = BAG[d.level].name; }
      s.material.map = itemLabelTex(emoji, label, color);
      s.material.needsUpdate = true;
      s.position.set(d.x, (d.y || 0) + 1.15, d.z);
      s.visible = true;
    });
  }

  // ── vehicles ────────────────────────────────────────────────────────────
  _makeVehicleMesh(kind) {
    const def = VEHICLES[kind];
    const g = new THREE.Group();
    const body = new THREE.MeshLambertMaterial({ color: new THREE.Color(def.color) });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1b1f27 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.55 });
    const [w, h, l] = def.size;
    const part = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (kind === 'boat') {
      part(new THREE.BoxGeometry(w, h * 0.55, l), body, 0, h * 0.28, 0);
      part(new THREE.BoxGeometry(w * 0.7, h * 0.4, l * 0.34), glass, 0, h * 0.62, l * 0.16);
      part(new THREE.BoxGeometry(w * 0.92, h * 0.2, l * 0.9), dark, 0, h * 0.04, 0);
      g.userData.wheels = [];
    } else if (kind === 'bike') {
      part(new THREE.BoxGeometry(w * 0.5, h * 0.35, l * 0.75), body, 0, h * 0.55, 0);
      part(new THREE.BoxGeometry(w * 0.42, h * 0.42, l * 0.2), glass, 0, h * 0.85, -l * 0.28);
      const wA = part(new THREE.CylinderGeometry(0.36, 0.36, 0.18, 12), dark, 0, 0.36, -l * 0.42, Math.PI / 2);
      const wB = part(new THREE.CylinderGeometry(0.36, 0.36, 0.18, 12), dark, 0, 0.36, l * 0.42, Math.PI / 2);
      wA.rotation.z = Math.PI / 2; wB.rotation.z = Math.PI / 2;
      g.userData.wheels = [wA, wB];
    } else {
      part(new THREE.BoxGeometry(w, h * 0.62, l), body, 0, h * 0.5, 0);
      part(new THREE.BoxGeometry(w * 0.86, h * 0.46, l * 0.44), glass, 0, h * 0.98, l * 0.02);
      if (kind === 'buggy') part(new THREE.BoxGeometry(w * 0.8, 0.12, l * 0.9), dark, 0, h * 1.2, 0);
      const wheels = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const m = part(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 12), dark, sx * w * 0.5, 0.42, sz * l * 0.32);
        m.rotation.z = Math.PI / 2;
        wheels.push(m);
      }
      g.userData.wheels = wheels;
    }
    g.userData.hp = null;
    return g;
  }

  _syncVehicles(dt) {
    const b = this.battle;
    for (const v of b.vehicles) {
      let g = this.vehicleMeshes.get(v);
      if (!g) {
        g = this._makeVehicleMesh(v.kind);
        this.viewGroup.add(g);
        this.vehicleMeshes.set(v, g);
      }
      g.visible = !v.dead;
      g.position.set(v.x, v.y, v.z);
      g.rotation.y = v.yaw;
      const driver = v.driver;
      if (driver) g.rotation.z = -v.steer * 0.06 * clamp01(Math.abs(v.speed) / 8);
      else g.rotation.z *= 0.9;
      // wheels turn with speed; the bike leans into its steering
      const spin = v.speed * dt * 1.6;
      for (const wheel of g.userData.wheels || []) wheel.rotation.x += spin * (v.kind === 'bike' ? 1 : 1);
      if (v.kind === 'bike') g.rotation.z -= v.steer * 0.22 * clamp01(Math.abs(v.speed) / 10);
      // smoke when badly damaged
      if (!v.dead && v.hp / v.maxHp < 0.35 && Math.random() < 0.25) {
        this.pools.smoke.spawn(v.x + (Math.random() - 0.5), v.y + 1.1, v.z + (Math.random() - 0.5), 1.6, 1.1, new THREE.Color('#4a4640'));
      }
    }
    for (const [v, g] of this.vehicleMeshes) {
      if (v.dead && v.t > 3) {
        this.viewGroup.remove(g);
        this.vehicleMeshes.delete(v);
      }
    }
  }

  _syncGloo() {
    const live = this.battle.glools;
    for (const [g, mesh] of this.glooMeshes) {
      if (live.indexOf(g) === -1) {
        this.viewGroup.remove(mesh);
        mesh.geometry.dispose(); mesh.material.dispose();
        this.glooMeshes.delete(g);
        continue;
      }
      const k = clamp01(g.hp / g.maxHp);
      mesh.material.opacity = 0.3 + 0.62 * k;
      mesh.scale.set(1, 0.5 + 0.5 * k, 1);
    }
  }

  _syncAirdrops(dt) {
    for (const [a, crate] of this.crates) {
      crate.position.set(a.x, a.y, a.z);
      crate.rotation.y += dt * 0.5;
      if (a.landed) {
        crate.userData.chute.visible = false;
        crate.position.y = a.y - 1.3;
      }
    }
  }

  _syncEffects(dt) {
    for (const fx of this.battle.effects) {
      if (fx.kind !== 'smoke') continue;
      let puff = this.smokeFx.get(fx);
      if (!puff) {
        puff = [];
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * TAU, r = Math.random() * fx.radius * 0.85;
          puff.push({
            x: fx.x + Math.cos(a) * r, y: fx.y + 0.5 + Math.random() * 3.6, z: fx.z + Math.sin(a) * r,
            s: 2.4 + Math.random() * 2.6, phase: Math.random() * TAU,
          });
        }
        this.smokeFx.set(fx, puff);
      }
      const grow = clamp01(fx.t / 1.2);
      const fade = fx.t > fx.dur - 2 ? Math.max(0, (fx.dur - fx.t) / 2) : 1;
      // spawn a rotating subset of puffs so the cloud stays dense but cheap
      const start = this.battle.frame % puff.length;
      for (let i = 0; i < 5; i++) {
        const p = puff[(start + i) % puff.length];
        const shimmer = Math.sin(performance.now() * 0.0007 + p.phase) * 0.25;
        this.pools.smoke.spawn(p.x, p.y + shimmer, p.z, p.s * grow * fade, 0.3, new THREE.Color('#cfd4d8'), 0.55);
      }
    }
  }

  // ── camera: over-the-shoulder third person, ADS zoom, death orbit ───────
  _camera(dt, input) {
    const b = this.battle;
    const p = (this.focus && this.focus.alive) ? this.focus : b.player;
    const spectating = p !== b.player;
    const cam = this.camera;
    const alive = p.alive;
    const drivingCar = b.player.vehicle;
    const targetYaw = spectating ? p.yaw : (drivingCar ? drivingCar.yaw : (input ? input.yaw : p.yaw));
    const pitch = clamp(spectating ? p.pitch * 0.4 : (input ? input.pitch : p.pitch), -1.15, 1.15);
    const ads = !!(input && input.ads) && alive && !spectating;
    this.adsK = lerp(this.adsK, ads ? 1 : 0, clamp01(dt * 9));

    // while driving, pull back and up and follow the car's heading
    const car = b.player.vehicle;
    this.carK = lerp(this.carK || 0, car && !spectating ? 1 : 0, clamp01(dt * 4));
    const dist = lerp(alive ? 4.7 : 8.5, 2.3, this.adsK) + this.carK * 4.6;
    const height = lerp(1.75, 1.62, this.adsK) + this.carK * 1.1;
    const shoulder = lerp(0.22, 0.55, this.adsK);

    const head = V.set(p.x, p.y + (p.crouch ? 1.15 : 1.5) + this.carK * 0.6, p.z);
    const dir = new THREE.Vector3(Math.sin(targetYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(targetYaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(targetYaw), 0, -Math.sin(targetYaw));
    const desired = head.clone()
      .addScaledVector(dir, -dist)
      .addScaledVector(right, shoulder)
      .add(new THREE.Vector3(0, height - 0.9, 0));
    // never clip into the ground
    const groundY = Math.max(b.island.height(desired.x, desired.z), 0.05);
    if (desired.y < groundY + 0.45) desired.y = groundY + 0.45;
    const k = alive ? clamp01(dt * 11) : clamp01(dt * 3);
    cam.position.lerp(desired, k);

    // shake (recoil + explosions)
    this.shake = Math.max(0, this.shake - dt * 2.6);
    const sh = this.shake * 0.11 + (p.kick || 0) * 0.02;
    const look = head.clone().addScaledVector(dir, 12);
    look.x += (Math.random() - 0.5) * sh;
    look.y += (Math.random() - 0.5) * sh;
    look.z += (Math.random() - 0.5) * sh;
    cam.lookAt(look);
    cam.rotation.z += (Math.random() - 0.5) * sh * 0.3 + (p.knocked ? 0.25 : 0);

    const targetFov = lerp(66, 44, this.adsK);
    cam.fov = lerp(cam.fov, targetFov, clamp01(dt * 8));
    cam.updateProjectionMatrix();

    // shadow-follow handled inside world.update()
    if (p.alive && p.kick) p.kick = Math.max(0, p.kick - dt * 4);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

// ── tiny pooled sprite emitter ───────────────────────────────────────────────
class SpritePool {
  constructor(parent, material, count, color) {
    this.items = [];
    this.i = 0;
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(material.clone());
      s.visible = false;
      if (color) s.material.color.copy(color);
      parent.add(s);
      this.items.push({ s, t: 0, dur: 0, size: 1, vy: 0 });
    }
  }
  spawn(x, y, z, size = 0.5, dur = 0.3, color = null, rise = 0.5) {
    const it = this.items[this.i++ % this.items.length];
    it.s.visible = true;
    it.s.position.set(x, y, z);
    it.size = size;
    it.t = 0;
    it.dur = dur;
    it.vy = rise;
    if (color) it.s.material.color.copy(color);
    it.s.material.opacity = 1;
    it.s.scale.set(size, size, 1);
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.s.visible) continue;
      it.t += dt;
      if (it.t >= it.dur) { it.s.visible = false; continue; }
      const k = it.t / it.dur;
      it.s.position.y += it.vy * dt;
      if (this.billboard !== false) it.s.material.rotation = (it.s.material.map ? 0 : 0);
      const sc = it.size * (1 + k * 0.7);
      it.s.scale.set(sc, sc, 1);
      it.s.material.opacity = 1 - k * k;
    }
  }
}
