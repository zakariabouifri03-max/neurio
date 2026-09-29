// ─────────────────────────────────────────────────────────────────────────────
//  hall.js — the walkable pool hall
//
//  A third-person avatar you actually walk around a room with: WASD/arrows (or
//  the on-screen stick on touch), drag or pointer-lock to look, collision
//  against the tables, the bar and the walls. Other people are procedural rigs
//  with the same skeleton — they wander between waypoints, stop to watch a
//  table, sit down, wave — and their names float over their heads as DOM plates
//  projected from world space each frame.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { TABLE, HL, HW } from './table.js';
import { $, show, el, clamp, txt } from './ui.js';

const FLOOR_Y = -(TABLE.legH + TABLE.frameH);
const ROOM = { hx: 15.4, hz: 10.4 };

// ── procedural avatar ───────────────────────────────────────────────────────
function faceTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 128, 128);
  const r = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed >>> 8) / 16777216 * n; };
  // eyes
  g.fillStyle = '#1a1410';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(64 + sx * 20, 58 + r(4), 5.4 + r(1.6), 6.6 + r(2), 0, 0, 7);
    g.fill();
  }
  // brows
  g.strokeStyle = 'rgba(30,20,14,0.75)'; g.lineWidth = 3.2; g.lineCap = 'round';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.moveTo(64 + sx * 13, 44 + r(3));
    g.quadraticCurveTo(64 + sx * 21, 40 + r(3), 64 + sx * 28, 45 + r(3));
    g.stroke();
  }
  // mouth
  g.strokeStyle = 'rgba(90,40,40,0.85)'; g.lineWidth = 3.4;
  g.beginPath();
  g.moveTo(52, 84); g.quadraticCurveTo(64, 92 + r(4), 76, 84);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SKIN = ['#f0c9a4', '#e0ac7e', '#c68a5c', '#9a6238', '#6d4227', '#f6dcc0', '#4a2c1a'];
const SHIRT = ['#2f6f8f', '#8f3346', '#3d7a52', '#c9a227', '#4a4a6a', '#b5622e', '#2b2b33', '#7a4fa3', '#d8d2c4'];
const HAIR = ['#20160f', '#3d2a1a', '#6b4a2a', '#a8813f', '#c9c2b4', '#171a20', '#7a2b2b'];

export class Avatar {
  constructor(scene3d, opts = {}) {
    const seed = opts.seed || 1;
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s >>> 8) / 16777216; };
    this.name = opts.name || 'Player';
    this.skin = opts.skin || SKIN[(rnd() * SKIN.length) | 0];
    this.shirt = opts.shirt || SHIRT[(rnd() * SHIRT.length) | 0];
    this.hair = opts.hair || HAIR[(rnd() * HAIR.length) | 0];
    this.scale = 0.94 + rnd() * 0.12;
    this.isPlayer = !!opts.isPlayer;

    const skinMat = new THREE.MeshStandardMaterial({ color: this.skin, roughness: 0.72, metalness: 0 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: this.shirt, roughness: 0.85, metalness: 0 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: '#22262e', roughness: 0.9 });
    const hairMat = new THREE.MeshStandardMaterial({ color: this.hair, roughness: 0.95 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.6 });

    const root = new THREE.Group();
    root.scale.setScalar(this.scale);
    // hips at ~0.92 m
    const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.06, 4, 10), pantsMat);
    hips.add(pelvis);

    const torso = new THREE.Group(); torso.position.y = 0.10; hips.add(torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.30, 4, 12), shirtMat);
    chest.position.y = 0.22; chest.scale.set(1, 1, 0.72);
    torso.add(chest);
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.145, 0.10, 4, 10), shirtMat);
    belly.position.y = 0.02; belly.scale.set(1, 1, 0.74);
    torso.add(belly);

    const neck = new THREE.Group(); neck.position.y = 0.44; torso.add(neck);
    const head = new THREE.Group(); head.position.y = 0.115; neck.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skinMat);
    skull.scale.set(0.94, 1.06, 0.98);
    head.add(skull);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.1165, 20, 16, -0.7, 1.4, 0.9, 1.2),
      new THREE.MeshStandardMaterial({ map: faceTexture(seed * 7 + 3), transparent: true, roughness: 0.8, depthWrite: false }));
    face.scale.copy(skull.scale);
    head.add(face);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.121, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMat);
    hair.position.y = 0.012; hair.scale.set(0.98, 1.02, 1.0);
    head.add(hair);
    // ears
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), skinMat);
      ear.position.set(sx * 0.108, 0.0, 0); ear.scale.set(0.5, 1, 0.8);
      head.add(ear);
    }

    const mkLimb = (parent, len, r1, r2, mat, x) => {
      const g = new THREE.Group();
      g.position.set(x, 0, 0);
      parent.add(g);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r1, len, 4, 8), mat);
      m.position.y = -len / 2;
      m.scale.z = r2;
      g.add(m);
      return { group: g, mesh: m, len };
    };
    // arms hang from the shoulders; the group pivot is the shoulder so a
    // rotation swings the whole arm
    const shoulderY = 0.36;
    const armL = mkLimb(torso, 0.56, 0.052, 0.85, shirtMat, -0.20);
    armL.group.position.y = shoulderY;
    const armR = mkLimb(torso, 0.56, 0.052, 0.85, shirtMat, 0.20);
    armR.group.position.y = shoulderY;
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), skinMat);
    handL.position.y = -0.58; armL.group.add(handL);
    const handR = handL.clone(); handR.position.y = -0.58; armR.group.add(handR);

    const legL = mkLimb(hips, 0.80, 0.072, 0.85, pantsMat, -0.088);
    const legR = mkLimb(hips, 0.80, 0.072, 0.85, pantsMat, 0.088);
    const shoeGeo = new THREE.BoxGeometry(0.10, 0.055, 0.24);
    const shoeL = new THREE.Mesh(shoeGeo, shoeMat); shoeL.position.set(0, -0.82, 0.05); legL.group.add(shoeL);
    const shoeR = new THREE.Mesh(shoeGeo, shoeMat); shoeR.position.set(0, -0.82, 0.05); legR.group.add(shoeR);

    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    this.root = root;
    this.parts = { root, hips, torso, neck, head, armL, armR, legL, legR, chest };
    this.pose = 'idle';
    this.poseT = 0;
    this.speed = 0;
    this.yaw = 0;
    this.emote = null;
    this.emoteT = 0;
    this.seat = null;
  }

  addTo(group) { group.add(this.root); return this; }

  play(emote, secs = 2.0) { this.emote = emote; this.emoteT = secs; }

  /** advance the pose. speed in m/s, dt in seconds */
  update(dt, speed = this.speed) {
    this.speed = speed;
    this.poseT += dt;
    if (this.emoteT > 0) this.emoteT -= dt;
    const P = this.parts;
    const t = this.poseT;
    const moving = speed > 0.12;
    const gait = clamp(speed / 1.5, 0, 1);
    const f = 2.1 + gait * 3.1;                     // steps per second
    const ph = t * f * Math.PI * 2;

    // legs
    const swing = moving ? (0.28 + gait * 0.62) : 0.02;
    P.legL.group.rotation.x = Math.sin(ph) * swing - (this.seat ? -1.35 : 0);
    P.legR.group.rotation.x = Math.sin(ph + Math.PI) * swing - (this.seat ? -1.35 : 0);
    P.legL.group.rotation.z = moving ? Math.sin(ph) * 0.03 : 0.02;
    P.legR.group.rotation.z = moving ? Math.sin(ph + Math.PI) * 0.03 : -0.02;

    // arms counter-swing
    const aSwing = moving ? (0.22 + gait * 0.5) : 0.03;
    P.armL.group.rotation.x = Math.sin(ph + Math.PI) * aSwing;
    P.armR.group.rotation.x = Math.sin(ph) * aSwing;
    P.armL.group.rotation.z = 0.10 + (moving ? 0.05 : 0.02) + Math.sin(t * 1.1) * 0.012;
    P.armR.group.rotation.z = -0.10 - (moving ? 0.05 : 0.02) - Math.sin(t * 1.1) * 0.012;

    // torso: breathing + a little counter-rotation while walking
    P.torso.rotation.y = moving ? Math.sin(ph) * 0.055 * gait : Math.sin(t * 0.7) * 0.014;
    P.torso.rotation.x = moving ? 0.06 + gait * 0.13 : Math.sin(t * 0.9) * 0.012;
    P.chest.scale.z = 0.72 + Math.sin(t * 1.6) * 0.008;
    P.hips.position.y = (this.seat ? 0.52 : 0.92) + (moving ? Math.abs(Math.sin(ph)) * 0.022 * gait : Math.sin(t * 1.6) * 0.006);
    P.hips.rotation.y = moving ? Math.sin(ph + Math.PI) * 0.04 * gait : 0;

    // head: look where you are going, with a little idle curiosity
    P.neck.rotation.x = moving ? -0.05 : Math.sin(t * 0.6) * 0.03;
    P.head.rotation.y = moving ? 0 : Math.sin(t * 0.43) * 0.22;
    P.head.rotation.x = moving ? 0.02 : Math.sin(t * 0.31) * 0.045;

    // emotes
    if (this.emoteT > 0) {
      const k = Math.min(1, this.emoteT * 2.2);
      switch (this.emote) {
        case 'wave':
          P.armR.group.rotation.z = -2.35 * k;
          P.armR.group.rotation.x = -0.35 * k + Math.sin(t * 11) * 0.30 * k;
          P.head.rotation.z = Math.sin(t * 5) * 0.05 * k;
          break;
        case 'sit':
          this.seat = this.seat || true;
          break;
        case 'stand':
          this.seat = null;
          break;
        case 'cheer':
          P.armL.group.rotation.z = 2.5 * k; P.armR.group.rotation.z = -2.5 * k;
          P.armL.group.rotation.x = -0.4 * k + Math.sin(t * 9) * 0.22 * k;
          P.armR.group.rotation.x = -0.4 * k + Math.sin(t * 9 + 1) * 0.22 * k;
          P.hips.position.y += Math.abs(Math.sin(t * 7)) * 0.06 * k;
          break;
        case 'laugh':
          P.torso.rotation.x += Math.sin(t * 13) * 0.06 * k;
          P.head.rotation.x += -0.14 * k + Math.sin(t * 13) * 0.05 * k;
          P.armL.group.rotation.x += -0.5 * k; P.armR.group.rotation.x += -0.5 * k;
          break;
        case 'aim':
          // leaning over a table: both arms forward, torso down
          P.torso.rotation.x = 0.62 * k;
          P.armL.group.rotation.x = -1.15 * k; P.armR.group.rotation.x = -1.05 * k;
          P.armL.group.rotation.z = 0.30 * k; P.armR.group.rotation.z = -0.05 * k;
          P.neck.rotation.x = 0.35 * k;
          P.hips.position.y = 0.92 - 0.10 * k;
          break;
        default: break;
      }
    } else if (this.emote === 'sit' || this.seat) {
      // stay seated
      this.seat = true;
    } else this.seat = null;

    // face the walking direction
    P.root.rotation.y = this.yaw;
  }
}

// ── the hall ────────────────────────────────────────────────────────────────
const ZONES = [
  { id: 'main', name: 'MAIN POOL AREA', test: (x, z) => Math.abs(x) < 11 && Math.abs(z) < 7 },
  { id: 'vip', name: 'VIP ROOMS', test: (x, z) => x > 11 },
  { id: 'bar', name: 'THE BAR', test: (x, z) => x < -11 },
  { id: 'tournament', name: 'TOURNAMENT FLOOR', test: (x, z) => z < -7 },
  { id: 'social', name: 'SOCIAL LOUNGE', test: (x, z) => z > 7 },
];

const BOT_NAMES = ['Rico', 'Mina', 'Ovie', 'Lena', 'Kaz', 'Sofia', 'Dmitri', 'Aya', 'Bruno', 'Nour', 'Teo', 'Iris', 'Malik', 'June'];
const BOT_CHAT = [
  'Anyone up for a race to 5?', 'That draw shot was filthy.', 'New cue just dropped in the shop.',
  'Table 4 is open.', 'gg, rematch?', 'I have been practising the break all week.',
  'Who wants to join the tournament?', 'Nice safety.', 'Send me a challenge!',
];

export class Hall {
  /**
   * @param {object} ctx {scene, audio, profile, onPlayTable, onToast}
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.active = false;
    this.pos = new THREE.Vector3(0, FLOOR_Y, 3.4);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;                 // looking at the table
    this.pitch = 0.16;
    this.keys = {};
    this.speed = 0;
    this.stickVec = { x: 0, y: 0 };
    this.colliders = [];
    this.bots = [];
    this.plates = [];
    this.zone = 'main';
    this.interactTarget = null;
    this.lookDrag = null;
    this.locked = false;
  }

  build() {
    const g = this.scene.groups.people;
    while (g.children.length) g.remove(g.children[0]);
    this.bots = [];

    // ── the player avatar (visible in third person)
    this.player = new Avatar(this.scene, { name: this.ctx.profile.me.name, isPlayer: true, seed: 7 });
    this.player.addTo(g);

    // ── collision volumes: our table, the prop tables, the bar, the plants
    this.colliders = [
      { x: 0, z: 0, rx: HL + 0.42, rz: HW + 0.42, kind: 'table', label: 'Championship Table', id: 'main' },
      { x: -7.5, z: -4.5, rx: HL + 0.4, rz: HW + 0.4, kind: 'table', label: 'Table 2 · Casual', id: 't2' },
      { x: 7.5, z: -4.5, rx: HL + 0.4, rz: HW + 0.4, kind: 'table', label: 'Table 3 · Ranked', id: 't3' },
      { x: -7.5, z: 4.5, rx: HL + 0.4, rz: HW + 0.4, kind: 'table', label: 'Table 4 · Practice', id: 't4' },
      { x: 7.5, z: 4.5, rx: HL + 0.4, rz: HW + 0.4, kind: 'table', label: 'Table 5 · High Stakes', id: 't5' },
      { x: -11.6, z: -6.4, rx: 0.7, rz: 3.3, kind: 'bar', label: 'The Bar', id: 'bar' },
    ];

    // ── seating spots around the tables (for NPCs to sit/lean on)
    this.seats = [];
    for (const c of this.colliders) {
      if (c.kind !== 'table') continue;
      for (const [dx, dz, yaw] of [[0, c.rz + 0.5, Math.PI], [0, -c.rz - 0.5, 0], [c.rx + 0.5, 0, -Math.PI / 2], [-c.rx - 0.5, 0, Math.PI / 2]]) {
        this.seats.push({ x: c.x + dx, z: c.z + dz, yaw, table: c.id });
      }
    }

    // ── NPCs
    const count = this.scene.Q.hallDetail >= 2 ? 9 : this.scene.Q.hallDetail === 1 ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const a = new Avatar(this.scene, { name: BOT_NAMES[i % BOT_NAMES.length], seed: 101 + i * 37 });
      a.addTo(g);
      const seat = this.seats[(i * 3) % this.seats.length];
      const bot = {
        av: a,
        x: seat ? seat.x + (Math.random() - 0.5) * 2 : Math.random() * 8 - 4,
        z: seat ? seat.z + (Math.random() - 0.5) * 2 : Math.random() * 6 - 3,
        yaw: Math.random() * 7,
        target: null, wait: Math.random() * 4, mode: 'idle', speed: 0,
        chat: 4 + Math.random() * 22, seated: false,
      };
      this.bots.push(bot);
      if (i % 3 === 0 && seat) { bot.seated = true; bot.x = seat.x; bot.z = seat.z; bot.yaw = seat.yaw; a.play('sit', 1e9); a.seat = true; }
    }

    // ── nameplates
    this.plateHost = $('app');
    this.active = true;
    this._bind();
    this.scene.setShowHall(true);
    this.scene.cam.setMode('free', true);
    return this;
  }

  destroy() {
    this.active = false;
    this._unbind();
    for (const p of this.plates) p.node.remove();
    this.plates = [];
    const g = this.scene.groups.people;
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      c.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    }
    this.scene.setShowHall(false);
  }

  _bind() {
    const cv = this.scene.canvas;
    this._h = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); this._h.push([t, ev, fn, o]); };
    on(window, 'keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyF') { this.player.play('wave', 2.0); this.ctx.audio && this.ctx.audio.click(); this._say(this.ctx.profile.me.name, '👋'); }
      if (e.code === 'KeyE' && this.interactTarget) this._use(this.interactTarget);
      if (e.code === 'KeyQ') this.player.play('cheer', 2.2);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e) => { this.keys[e.code] = false; });
    on(cv, 'pointerdown', (e) => {
      if (!this.active) return;
      this.lookDrag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 };
      if (!this.locked && e.button === 0 && this.scene.Q.hallDetail >= 1 && cv.requestPointerLock && window.matchMedia('(pointer: fine)').matches) {
        // pointer lock gives proper mouse-look on desktop
        try { cv.requestPointerLock(); } catch (err) {}
      }
    });
    on(cv, 'pointermove', (e) => {
      if (!this.active) return;
      if (this.locked) {
        const s = 0.0022 * (this.ctx.profile.settings.sensitivity || 1);
        this.yaw -= e.movementX * s;
        this.pitch = clamp(this.pitch + e.movementY * s * 0.7, -0.35, 0.85);
        return;
      }
      if (!this.lookDrag) return;
      const dx = e.clientX - this.lookDrag.x, dy = e.clientY - this.lookDrag.y;
      this.lookDrag.x = e.clientX; this.lookDrag.y = e.clientY;
      this.lookDrag.moved += Math.abs(dx) + Math.abs(dy);
      const s = 0.005 * (this.ctx.profile.settings.sensitivity || 1);
      this.yaw -= dx * s;
      this.pitch = clamp(this.pitch + dy * s * 0.6, -0.35, 0.85);
    });
    const up = () => { this.lookDrag = null; };
    on(cv, 'pointerup', up);
    on(cv, 'pointercancel', up);
    on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === cv; });

    // touch stick
    const stick = $('stick');
    const nub = $('stickNub');
    if (stick && nub) {
      let sid = null, cx = 0, cy = 0;
      const start = (e) => {
        const t = e.changedTouches ? e.changedTouches[0] : e;
        sid = t.identifier !== undefined ? t.identifier : 'mouse';
        const r = stick.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        stick.classList.add('on');
      };
      const move = (e) => {
        if (sid === null) return;
        const list = e.changedTouches || [e];
        for (const t of list) {
          if (t.identifier !== undefined && t.identifier !== sid) continue;
          const dx = (t.clientX - cx) / 46, dy = (t.clientY - cy) / 46;
          const l = Math.hypot(dx, dy) || 1;
          const k = l > 1 ? 1 / l : 1;
          this.stickVec.x = dx * k; this.stickVec.y = dy * k;
          nub.style.transform = `translate(${this.stickVec.x * 26}px, ${this.stickVec.y * 26}px)`;
        }
        e.preventDefault();
      };
      const end = () => { sid = null; this.stickVec.x = this.stickVec.y = 0; nub.style.transform = ''; stick.classList.remove('on'); };
      on(stick, 'pointerdown', start);
      on(window, 'pointermove', move, { passive: false });
      on(window, 'pointerup', end);
      on(window, 'pointercancel', end);
    }
    const tw = $('tWave'); if (tw) on(tw, 'click', () => this.player.play('wave', 2.0));
    const te = $('tEmote'); if (te) on(te, 'click', () => this.player.play('cheer', 2.2));
    const tu = $('tUse'); if (tu) on(tu, 'click', () => { if (this.interactTarget) this._use(this.interactTarget); });
  }

  _unbind() {
    for (const [t, ev, fn, o] of this._h || []) t.removeEventListener(ev, fn, o);
    this._h = [];
    if (document.pointerLockElement) document.exitPointerLock();
  }

  enter() {
    this.active = true;
    this.pos.set(0, FLOOR_Y, 3.6);
    this.yaw = Math.PI; this.pitch = 0.14;
    show($('hallHud'), true);
    show($('stick'), 'ontouchstart' in window);
    show($('touchBtns'), 'ontouchstart' in window);
    this.scene.setShowHall(true);
    this.ctx.audio && this.ctx.audio.setAmbience(true, 1);
  }
  exit() {
    this.active = false;
    show($('hallHud'), false);
    show($('stick'), false);
    show($('touchBtns'), false);
    show($('interact'), false);
    this._unbind();
  }

  /** squared-distance collision against boxes and the room bounds */
  _collide(nx, nz) {
    for (const c of this.colliders) {
      const dx = Math.abs(nx - c.x), dz = Math.abs(nz - c.z);
      if (dx < c.rx && dz < c.rz) {
        // push out along the smaller penetration axis
        const px = c.rx - dx, pz = c.rz - dz;
        if (px < pz) nx = c.x + Math.sign(nx - c.x || 1) * c.rx;
        else nz = c.z + Math.sign(nz - c.z || 1) * c.rz;
      }
    }
    return { x: clamp(nx, -ROOM.hx, ROOM.hx), z: clamp(nz, -ROOM.hz, ROOM.hz) };
  }

  update(dt) {
    if (!this.active) return;
    const k = this.keys;
    let ix = 0, iz = 0;
    if (k.KeyW || k.ArrowUp) iz += 1;
    if (k.KeyS || k.ArrowDown) iz -= 1;
    if (k.KeyA || k.ArrowLeft) ix -= 1;
    if (k.KeyD || k.ArrowRight) ix += 1;
    ix += this.stickVec.x; iz += -this.stickVec.y;
    const l = Math.hypot(ix, iz);
    const run = !!(k.ShiftLeft || k.ShiftRight);
    const maxSpeed = run ? 3.05 : 1.55;
    if (l > 0.001) {
      ix /= Math.max(1, l); iz /= Math.max(1, l);
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // forward is where the camera looks
      const wx = sin * iz + cos * ix;
      const wz = cos * iz - sin * ix;
      this.vel.x += (wx * maxSpeed - this.vel.x) * Math.min(1, dt * 11);
      this.vel.z += (wz * maxSpeed - this.vel.z) * Math.min(1, dt * 11);
    } else {
      this.vel.x *= Math.max(0, 1 - dt * 9);
      this.vel.z *= Math.max(0, 1 - dt * 9);
    }
    const np = this._collide(this.pos.x + this.vel.x * dt, this.pos.z + this.vel.z * dt);
    this.pos.x = np.x; this.pos.z = np.z;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.14) this.yaw = Math.atan2(this.vel.x, this.vel.z);
    this.player.root.position.set(this.pos.x, FLOOR_Y, this.pos.z);
    this.player.yaw = this.yaw;
    this.player.update(dt, this.speed);

    // ── bots wander
    for (const b of this.bots) {
      if (b.seated) {
        b.av.root.position.set(b.x, FLOOR_Y, b.z);
        b.av.yaw = b.yaw;
        b.av.update(dt, 0);
        b.chat -= dt;
        if (b.chat <= 0) { b.chat = 16 + Math.random() * 40; if (Math.hypot(b.x - this.pos.x, b.z - this.pos.z) < 7) this._say(b.av.name, BOT_CHAT[(Math.random() * BOT_CHAT.length) | 0]); }
        continue;
      }
      b.wait -= dt;
      if (!b.target && b.wait <= 0) {
        const seat = this.seats[(Math.random() * this.seats.length) | 0];
        b.target = { x: seat.x + (Math.random() - 0.5) * 1.4, z: seat.z + (Math.random() - 0.5) * 1.4, yaw: seat.yaw };
        if (Math.random() < 0.18) { b.target = { x: (Math.random() * 2 - 1) * ROOM.hx * 0.8, z: (Math.random() * 2 - 1) * ROOM.hz * 0.8, yaw: Math.random() * 7 }; }
      }
      if (b.target) {
        const dx = b.target.x - b.x, dz = b.target.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.25) {
          b.target = null; b.wait = 1.6 + Math.random() * 6;
          b.yaw = b.target && b.target.yaw !== undefined ? b.target.yaw : b.yaw;
          if (Math.random() < 0.3) { b.av.play('wave', 1.8); }
        } else {
          const sp = 0.85 + Math.random() * 0.05;
          b.yaw = Math.atan2(dx, dz);
          const c = this._collide(b.x + (dx / d) * sp * dt, b.z + (dz / d) * sp * dt);
          b.x = c.x; b.z = c.z;
          b.speed = sp;
        }
      } else b.speed = 0;
      b.av.root.position.set(b.x, FLOOR_Y, b.z);
      b.av.yaw = b.yaw;
      b.av.update(dt, b.speed);
      b.chat -= dt;
      if (b.chat <= 0) {
        b.chat = 18 + Math.random() * 40;
        if (Math.hypot(b.x - this.pos.x, b.z - this.pos.z) < 7) this._say(b.av.name, BOT_CHAT[(Math.random() * BOT_CHAT.length) | 0]);
      }
    }

    // ── camera
    this.scene.cam.setGoal(this.scene.cam.hallTarget(this.pos.x, FLOOR_Y, this.pos.z, this.yaw, this.pitch));

    // ── zone + interaction
    const z = ZONES.find((zz) => zz.test(this.pos.x, this.pos.z));
    if (z && z.id !== this.zone) { this.zone = z.id; txt('zoneName', z.name); }
    let near = null, bestD = 2.6;
    for (const c of this.colliders) {
      const d = Math.max(Math.abs(this.pos.x - c.x) - c.rx, Math.abs(this.pos.z - c.z) - c.rz);
      if (d < bestD) { bestD = d; near = c; }
    }
    if (near !== this.interactTarget) {
      this.interactTarget = near;
      const box = $('interact');
      if (near) {
        txt('intTitle', near.label);
        txt('intSub', near.kind === 'table' ? 'Walk-in table · ready to play' : 'Drinks and chatter');
        const btns = $('intBtns');
        btns.innerHTML = '';
        if (near.kind === 'table') {
          for (const [label, act] of [['PRACTICE', 'practice'], ['VS CPU', 'ai'], ['LOCAL 2P', 'local']]) {
            const b = el('button', 'btn small ' + (act === 'practice' ? 'ghost' : 'primary'), label);
            b.addEventListener('click', () => this._use(near, act));
            btns.appendChild(b);
          }
        } else {
          const b = el('button', 'btn small ghost', 'SIT');
          b.addEventListener('click', () => this.player.play('sit', 3));
          btns.appendChild(b);
        }
        show(box, true);
      } else show(box, false);
    }

    this._updatePlates();
    txt('hudCoins', String(this.ctx.profile.total));
  }

  _use(target, act) {
    if (!target) return;
    if (target.kind === 'bar') { this.player.play('laugh', 2); return; }
    this.ctx.onPlayTable && this.ctx.onPlayTable({
      table: target.id, label: target.label,
      mode: act || (target.id === 't4' ? 'practice' : target.id === 't3' ? 'ai' : 'ai'),
    });
  }

  _say(name, text) {
    const host = $('app');
    if (!host) return;
    const n = el('div', 'said', `<b>${name}</b> ${text}`);
    n.style.cssText = 'position:fixed;left:14px;bottom:74px;max-width:min(340px,70vw);z-index:14;background:rgba(6,18,24,.86);border-radius:12px;padding:8px 12px;font:500 .78rem var(--font);color:#dfeef3;box-shadow:inset 0 0 0 1px rgba(255,255,255,.09);animation:nin .3s;pointer-events:none';
    host.appendChild(n);
    setTimeout(() => { n.style.transition = 'opacity .5s'; n.style.opacity = '0'; setTimeout(() => n.remove(), 520); }, 4200);
    while (host.querySelectorAll('.said').length > 3) host.querySelector('.said').remove();
  }

  /** floating nameplates, projected from world space */
  _updatePlates() {
    const host = this.plateHost;
    if (!host) return;
    const want = [{ name: this.ctx.profile.me.name + ' (you)', pos: this.player.root.position, y: 1.86, me: true }];
    for (const b of this.bots) {
      const d = Math.hypot(b.x - this.pos.x, b.z - this.pos.z);
      if (d > 13) continue;
      want.push({ name: b.av.name, pos: b.av.root.position, y: 1.82, d });
    }
    want.sort((a, b) => (a.d || 0) - (b.d || 0));
    const use = want.slice(0, 9);
    while (this.plates.length < use.length) {
      const node = el('div', 'plate', '');
      node.style.cssText = 'position:fixed;transform:translate(-50%,-100%);pointer-events:none;z-index:9;font:600 .68rem var(--font);letter-spacing:.06em;color:#eaf6fa;background:rgba(6,18,24,.62);padding:3px 9px;border-radius:9px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);white-space:nowrap;transition:opacity .2s';
      host.appendChild(node);
      this.plates.push({ node });
    }
    for (let i = 0; i < this.plates.length; i++) {
      const p = this.plates[i];
      const w = use[i];
      if (!w) { p.node.style.opacity = '0'; continue; }
      const s = this.scene.worldToScreen(w.pos.x, FLOOR_Y + w.y, w.pos.z);
      if (s.behind || s.x < -80 || s.x > this.scene.width + 80) { p.node.style.opacity = '0'; continue; }
      p.node.style.opacity = '1';
      p.node.style.left = `${s.x}px`;
      p.node.style.top = `${s.y}px`;
      if (p.text !== w.name) { p.text = w.name; p.node.textContent = w.name; }
      p.node.style.borderColor = w.me ? 'rgba(49,224,208,.6)' : '';
    }
  }
}

export default Hall;
