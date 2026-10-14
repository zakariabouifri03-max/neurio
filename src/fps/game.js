// ── WARFRONT · the match director: input, hit resolution, waves, scoring ─────

import * as THREE from 'three';
import { World } from './world.js';
import { FX } from './fx.js';
import { Player } from './player.js';
import { Guns, WEAPONS, damageAt } from './weapons.js';
import { Soldier, CLASSES } from './soldier.js';
import { Hud } from './hud.js';
import { audio } from './audio.js';
import { clamp, lerp, damp, dist, RNG, rayWorld, rayBox, losClear, fmtTime } from './util.js';

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  ControlLeft: 'crouch', KeyC: 'crouch2', KeyV: 'melee',
};

export const DIFFS = {
  recruit: {
    name: 'RECRUIT', waves: 6, perWave: 5, extra: .55, skill: .62, dmgMul: .62, aiDmg: .8,
    regen: 26, regenDelay: 4.2, plates: 3, maxArmor: 150, xp: 1, fallDmg: false, capAlive: 7, spawnGap: 2.1, allies: 4, minutes: 13,
  },
  operator: {
    name: 'OPERATOR', waves: 8, perWave: 6, extra: .8, skill: .92, dmgMul: 1, aiDmg: 1,
    regen: 18, regenDelay: 6, plates: 3, maxArmor: 100, xp: 2, fallDmg: true, capAlive: 9, spawnGap: 1.6, allies: 3, minutes: 15,
  },
  veteran: {
    name: 'VETERAN', waves: 10, perWave: 7, extra: 1.05, skill: 1.25, dmgMul: 1.5, aiDmg: 1.35,
    regen: 0, regenDelay: 9, plates: 2, maxArmor: 100, xp: 3, fallDmg: true, capAlive: 12, spawnGap: 1.15, allies: 2, minutes: 18,
  },
};

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.aa !== false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(0x0b0d0f, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.info.autoReset = true;
    this.dpr = Math.min(devicePixelRatio || 1, opts.dpr || 1.5);
    this.renderer.setPixelRatio(this.dpr);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.06, 520);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    // viewmodel pass
    this.vmScene = new THREE.Scene();
    this.vmScene.add(new THREE.HemisphereLight(0xdfe8f5, 0x6b5a42, 2.35));
    const vkey = new THREE.DirectionalLight(0xfff0d8, 2.9);
    vkey.position.set(-.6, 1.2, .9);
    this.vmScene.add(vkey);
    const vrim = new THREE.DirectionalLight(0x9fc6ff, 1.15);
    vrim.position.set(1, -.4, -1);
    this.vmScene.add(vrim);
    this.vmRoot = new THREE.Object3D();
    this.vmScene.add(this.vmRoot);
    this.vmCam = new THREE.PerspectiveCamera(55, 1, .01, 12);
    this.vmKey = vkey;

    this.rng = new RNG(20261014);
    this.time = 0;
    this.tickCount = 0;
    this.pathTokens = 3;
    this.movementLocked = false;
    this.state = 'menu';
    this.detail = 1;
    this.quality = opts.quality || 'high';
    this.world = new World(this.scene, 2026).build();
    this.fx = new FX(this.scene, this.renderer);
    this.hud = new Hud(this);
    this.audio = audio;
    this.player = new Player(this);
    this.guns = new Guns(this);
    this.soldiers = [];
    this.grenades = [];
    this.drops = [];
    this.rockets = [];
    this.diff = DIFFS.operator;
    this.perk = 'none';
    this.input = { fwd: 0, back: 0, left: 0, right: 0, jump: false, sprint: false, crouch: false, crouchEdge: false, ads: false, melee: false, moveMag: 0 };
    this.keys = {};
    this.firing = false;
    this._lockWanted = false;
    this.combat = 0;
    this.medalsWon = [];
    this.onEnd = null;
    this.onKill = null;
    this._tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.updateFov();
  }
  updateFov() {
    const base = this.fovBase || 74;
    const sprint = this.player && this.player.sprinting ? 1.045 : 1;
    const spd = this.player ? clamp(this.player.speed2D / 26, 0, .08) : 0;
    const ads = this.guns ? this.guns.fovMult() : 1;
    this.camera.fov = base * ads * sprint * (1 + spd);
    this.camera.updateProjectionMatrix();
  }

  deploy(loadout, diffKey, perk) {
    this.diff = DIFFS[diffKey] || DIFFS.operator;
    this.timeLeft = this.diff.minutes * 60;
    this.perk = perk || 'none';
    this.totalWaves = this.diff.waves;
    this.wave = 0;
    this.score = 0; this.kills = 0; this.streak = 0; this.bestStreak = 0; this.deaths = 0;
    this.headshots = 0; this.longShots = 0; this.grenadeKills = 0; this.dmgTaken = 0;
    this.sessionXp = 0;
    this.medalsWon = [];
    this.stocks = { uav: 0, strike: 0, care: 0 };
    this.uav = 0;
    this.killsByWeapon = {};
    this.time = 0;
    this.player.stats = { shots: 0, hits: 0, damage: 0 };
    this.player.deadproofReady = true;
    this.grenades.length = 0; this.drops.length = 0; this.rockets.length = 0;
    this._streakMark = { uav: 0, strike: 0, care: 0 };
    this.dmgThisWave = 0; this.revengeWindow = 0; this.meleeT = 0;
    this.firing = false; this.wantFireEdge = false;
    this.save = this.save || { wpnKills: {} };
    for (const s of this.soldiers) this.scene.remove(s.obj);
    this.soldiers.length = 0;
    this.guns.init(loadout);
    this.callsign = 'GHOST-1';
    this.state = 'play';
    this.movementLocked = false;
    const sp = this.pickSpawn(0, 0, true);
    this.player.respawnAt(sp.x, sp.z, Math.atan2(sp.x, sp.z));
    this.camera.position.set(sp.x, 1.6, sp.z);
    this.hud.show(true);
    this.startWave(1);
    this.audio.unlock();
    this.audio.resume();
    this.audio.ambience(true);
    this.audio.deploy();
    this.hud.banner('OPERATION BLACKOUT', this.diff.name + ' · ' + this.totalWaves + ' waves', 3000, 'big');
    this.requestLock();
  }

  endRun(win) {
    this.state = win ? 'complete' : 'over';
    this.exitLock();
    if (this.onEnd) this.onEnd(this.summary(win));
  }
  summary(win) {
    const acc = this.player.stats.shots ? this.player.stats.hits / this.player.stats.shots * 100 : 0;
    return {
      win, time: this.time, wave: this.wave, totalWaves: this.totalWaves,
      kills: this.kills, deaths: this.deaths, headshots: this.headshots, longShots: this.longShots,
      accuracy: acc, bestStreak: this.bestStreak, score: this.score, medals: this.medalsWon.slice(),
      xp: this.sessionXp, grenadeKills: this.grenadeKills, diff: this.diff.name,
      dmgTaken: Math.round(this.dmgTaken),
    };
  }

  pause(on) {
    if (on && this.state === 'play') { this.state = 'paused'; this.exitLock(); this.audio.suspend(); this.firing = false; }
    else if (!on && this.state === 'paused') { this.state = 'play'; this.audio.resume(); this.requestLock(); }
  }

  requestLock() {
    if (!this.canvas.requestPointerLock || this.noLock) return;
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => {
        try { this.canvas.requestPointerLock(); } catch (e) { this.fallbackAim(); }
      });
    } catch (e) {
      try { this.canvas.requestPointerLock(); } catch (e2) { this.fallbackAim(); }
    }
    // iframes without the pointer-lock permission, or browsers that refuse, fall back
    clearTimeout(this._lockT);
    this._lockT = setTimeout(() => {
      if (this.state === 'play' && document.pointerLockElement !== this.canvas) this.fallbackAim();
    }, 450);
  }

  fallbackAim() {
    if (this.noLock) return;
    this.noLock = true;
    this.hud.notice('Mouse capture unavailable — aim works while the cursor is over the window, LMB fires');
  }
  exitLock() { if (document.exitPointerLock && document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) { } } }

  // ── input ────────────────────────────────────────────────────────────────
  bindInput() {
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys = {}; this.firing = false; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'play') return;
      if (!this.noLock && document.pointerLockElement !== this.canvas) { this.requestLock(); return; }
      if (e.button === 0) { this.firing = true; this.wantFireEdge = true; }
      if (e.button === 2) { this.rmb = true; this.input.ads = true; }
      if (e.button === 1) { e.preventDefault(); this.guns.cycle(1); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) { this.rmb = false; this.input.ads = false; }
    });
    addEventListener('contextmenu', (e) => { if (this.state === 'play') e.preventDefault(); });
    addEventListener('mousemove', (e) => {
      if (this.state !== 'play') return;
      if (!this.noLock && document.pointerLockElement !== this.canvas) return;
      const sens = (this.sens || .0022) * (1 - this.guns.ads * .35);
      this.player.look(e.movementX || 0, e.movementY || 0, sens, this.invertY);
    });
    addEventListener('wheel', (e) => {
      if (this.state !== 'play') return;
      if (e.deltaY > 0) this.guns.cycle(1); else this.guns.cycle(-1);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) this.noLock = false;
      else if (this.state === 'play' && this._lockWanted && !this.noLock) this.pause(true);
    });
    if (document.addEventListener) document.addEventListener('pointerlockerror', () => this.fallbackAim());
    this._lockWanted = true;
    // in fallback mode the mouse buttons are captured on the canvas itself
    addEventListener('mouseup', () => { if (this.noLock) this.firing = false; });
    // touch
    if (matchMedia && matchMedia('(pointer: coarse)').matches) this.bindTouch();
  }

  bindTouch() {
    document.getElementById('touchPad').classList.remove('hide');
    const stick = document.getElementById('stickMove');
    const knob = stick.querySelector('i');
    let sid = null, sx = 0, sy = 0;
    const R = 54;
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; sid = t.identifier; sx = t.clientX; sy = t.clientY;
      stick.classList.add('on'); e.preventDefault();
    }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== sid) continue;
        const dx = clamp((t.clientX - sx) / R, -1, 1), dy = clamp((t.clientY - sy) / R, -1, 1);
        knob.style.transform = `translate(${dx * R}px,${dy * R}px)`;
        this.input.right = dx; this.input.fwd = -dy; this.input.back = dy > 0 ? dy : 0;
        if (dy > 0) this.input.fwd = 0; else this.input.back = 0;
        this.input.fwd = dy < 0 ? -dy : 0;
        this.input.left = dx < 0 ? -dx : 0; this.input.right = dx > 0 ? dx : 0;
        this.input.moveMag = Math.min(1, Math.hypot(dx, dy));
        e.preventDefault();
      }
    }, { passive: false });
    addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== sid) continue;
        sid = null; knob.style.transform = ''; stick.classList.remove('on');
        this.input.fwd = this.input.back = this.input.left = this.input.right = 0; this.input.moveMag = 0;
      }
    });
    // look: drags on the right half of the screen
    let lid = null, lx = 0, ly = 0;
    addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX > innerWidth * .42 && lid === null && this.state === 'play') {
          lid = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lid) continue;
        this.player.look((t.clientX - lx) * 1.9, (t.clientY - ly) * 1.9, (this.sens || .0022) * 1.5, this.invertY);
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: true });
    addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; });
    const btn = (id, down, up) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { down(); e.preventDefault(); }, { passive: false });
      el.addEventListener('touchend', (e) => { if (up) up(); e.preventDefault(); }, { passive: false });
    };
    btn('tFire', () => { this.firing = true; }, () => { this.firing = false; });
    btn('tReload', () => this.guns.startReload());
    btn('tJump', () => { this.input.jump = true; setTimeout(() => { this.input.jump = false; }, 120); });
    btn('tAds', () => { this.input.ads = !this.input.ads; }, null);
    btn('tSprint', () => { this.input.sprint = !this.input.sprint; }, null);
  }

  onKey(e, down) {
    if (e.code === 'Escape') {
      if (this.state === 'play') this.pause(true);
      else if (this.state === 'paused' && this.onTogglePause) this.onTogglePause(false);
      return;
    }
    if (this.state !== 'play') { if (e.code === 'Tab') e.preventDefault(); return; }
    const k = KEYMAP[e.code];
    if (k) this.keys[k] = down;
    if (!down) { if (['KeyR', 'KeyQ', 'KeyG', 'KeyE', 'KeyF', 'KeyV', 'Digit4', 'Digit5', 'Digit6', 'Tab', 'KeyZ'].includes(e.code)) e.preventDefault(); }
    if (down) {
      switch (e.code) {
        case 'KeyR': this.guns.startReload(); e.preventDefault(); break;
        case 'KeyQ': this.guns.cycle(1); break;
        case 'Digit1': this.guns.equip(this.guns.loadout[0]); break;
        case 'Digit2': this.guns.equip(this.guns.loadout[1]); break;
        case 'Digit3': if (this.guns.loadout[2]) this.guns.equip(this.guns.loadout[2]); break;
        case 'KeyG': { const n = this.player.throwNade(); if (n) this.grenades.push(n); break; }
        case 'KeyE': this.player.usePlate(); break;
        case 'KeyF': this.tryPickup(); break;
        case 'KeyV': this.melee(); break;
        case 'Digit4': this.useStreak('uav'); break;
        case 'Digit5': this.useStreak('strike'); break;
        case 'Digit6': this.useStreak('care'); break;
        case 'Tab': this.showScore(true); e.preventDefault(); break;
        case 'KeyZ': this.hud.notice('Say: ' + this.rng.pick(['Need backup!', 'Moving up!', 'On me!'])); break;
      }
    } else if (e.code === 'Tab') this.showScore(false);
    if (down && e.code === 'ControlLeft') this.input.crouchEdge = true;
  }
  showScore(on) {
    if (on) { this.sbTimer = setTimeout(() => this.showScore(false), 6000); this.hud.el.hud.classList.add('sbOn'); this.hud.el.hud.querySelector('#sbPanel')?.remove(); const p = document.createElement('div'); p.id = 'sbPanel'; p.className = 'sbPanel show'; p.innerHTML = this.hud.scoreboard(this); this.hud.el.hud.appendChild(p); }
    else { clearTimeout(this.sbTimer); this.hud.el.hud.classList.remove('sbOn'); const p = this.hud.el.hud.querySelector('#sbPanel'); if (p) p.remove(); }
  }

  readInput(dt) {
    const i = this.input;
    const k = this.keys;
    i.fwd = clamp((k.fwd ? 1 : 0) - (k.back ? 1 : 0) + (this.touchFwd || 0), -1, 1);
    i.x = clamp((k.right ? 1 : 0) - (k.left ? 1 : 0), -1, 1);
    i.y = i.fwd;
    i.jump = !!k.jump;
    i.sprint = !!k.sprint;
    const crouchKey = !!k.crouch || !!k.crouch2;
    i.crouchEdge = crouchKey && !this._prevCrouch;
    this._prevCrouch = crouchKey;
    i.crouch = crouchKey;
    i.moveMag = Math.hypot(i.x, i.y);
    if (this.meleeT > 0) this.meleeT -= dt;
    if (k.melee && (!this._prevMelee) && (this.meleeT || 0) <= 0) this.melee();
    this._prevMelee = !!k.melee;
    i.ads = i.ads || !!this.rmb;
    return i;
  }

  // ── shooting / traces ────────────────────────────────────────────────────
  /**
   * March a ray through the world + character hitboxes.
   * `shooter` = null for the player, or the firing Soldier.
   */
  traceHits(origin, dir, maxD, shooter, maxTargets) {
    const hits = [];
    const wh = rayWorld(origin, dir, this.world.colliders, maxD);
    let limit = wh ? wh.t : maxD;
    const shooterTeam = shooter ? shooter.team : 'irf';
    for (const s of this.soldiers) {
      if (s.dead || s === shooter) continue;
      if (s.team === shooterTeam) continue;
      if (s.pos.distanceToSquared(origin) > 200 * 200) continue;
      for (const hb of s.boxes()) {
        const t = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, hb.b, limit);
        if (t >= 0 && t <= limit) {
          hits.push({ kind: 'soldier', soldier: s, part: hb.part, t, point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t) });
          break;
        }
      }
    }
    if (shooter && shooterTeam === 'opfor') {
      const p = this.player;
      if (!p.dead) {
        for (const b of p.hitBoxes()) {
          const t = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, b, limit);
          if (t >= 0 && t <= limit) {
            hits.push({ kind: 'player', part: b.tag, t, point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t) });
            break;
          }
        }
      }
    }
    limit = Math.min(limit, ...hits.map((h) => h.t), limit);
    hits.sort((a, b) => a.t - b.t);
    if (wh) hits.push({ kind: 'world', t: wh.t, point: new THREE.Vector3(origin.x + dir.x * wh.t, origin.y + dir.y * wh.t, origin.z + dir.z * wh.t), normal: { x: wh.nx, y: wh.ny, z: wh.nz }, mat: wh.box && wh.box.mesh && wh.box.mesh.material && wh.box.mesh.material === this.world.mats.metal ? 'metal' : 'concrete' });
    return hits.slice(0, maxTargets || 1);
  }

  /** single-hit convenience wrapper used by the AI */
  traceShot(origin, dir, maxD, shooter) {
    const h = this.traceHits(origin, dir, maxD, shooter, 1);
    if (h.length) return h[0];
    return { kind: 'none', point: origin.clone().addScaledVector(dir, maxD), t: maxD };
  }

  shoot(origin, dir, def, meta) {
    const pierce = def.pierce ? 2 : 1;
    const hits = this.traceHits(origin, dir, 340, null, pierce);
    const end = hits.length ? hits[0].point.clone() : origin.clone().addScaledVector(dir, 120);
    if (meta && meta.muzzle) this.fx.tracer(meta.muzzle, end, def.pellets ? .028 : .04);
    let dmgDone = 0;
    for (const h of hits) {
      if (h.kind === 'world') {
        this.fx.impact(h.point, h.normal, h.mat);
        audio.impact(h.mat === 'metal' ? 'metal' : 'concrete');
        break;
      }
      const d = origin.distanceTo(h.point);
      let dmg = damageAt(def, d);
      if (def.cls === 'shotgun') dmg *= clamp(1 - d / (def.falloff[1] * 1.2), .18, 1);
      const s = h.soldier;
      if (!s) continue;
      const wasAlive = !s.dead;
      const killed = s.damage(dmg, h.part, h.point, true);
      dmgDone += Math.min(dmg, wasAlive ? s.maxHp : 0);
      this.fx.bloodHit(h.point, dir, h.part === 'head');
      this._shotHits = (this._shotHits || 0) + 1;
      this.player.stats.damage += dmg;
      if (!killed) this.hud.hitmark(h.part === 'head' ? 'head' : 'flesh');
      else this.hud.hitmark('kill');
      audio.hitmark(h.part === 'head' ? 'head' : killed ? 'kill' : 'body');
      if (h.part === 'head') this.pendingHeadshot = true;
    }
    if (dmgDone > 0) this.score += Math.round(dmgDone * .35);
    void meta;
  }

  melee() {
    if (this.meleeT > 0 || this.player.dead) return;
    this.meleeT = .55;
    audio.ui('back');
    const o = this.player.eyePos(new THREE.Vector3());
    const d = this.player.forward(new THREE.Vector3());
    let best = null, bt = 2.9;
    for (const s of this.soldiers) {
      if (s.dead || s.team === 'irf') continue;
      const to = s.chest(new THREE.Vector3()).sub(o);
      const dd = to.length();
      if (dd > bt) continue;
      to.normalize();
      if (to.dot(d) < .55) continue;
      best = s; bt = dd;
    }
    this.guns.vm && (this.guns.vm.position.z += .22);
    if (best) {
      const killed = best.damage(240, 'chest', best.chest(new THREE.Vector3()), true);
      this.fx.bloodHit(best.chest(new THREE.Vector3()), d, true);
      if (killed) { this.hud.medal('EXECUTION', 'melee takedown'); this.meleeKills = (this.meleeKills || 0) + 1; }
    }
  }

  // ── kill events / scoring ────────────────────────────────────────────────
  onSoldierKilled(s, byPlayer, part, hitPos) {
    const names = s.team === 'opfor' ? s.name : s.name;
    if (s.team === 'opfor' && byPlayer) {
      this.kills++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      const wpn = this.guns.current;
      this.killsByWeapon[wpn] = (this.killsByWeapon[wpn] || 0) + 1;
      let pts = 100;
      if (part === 'head') { pts += 50; this.headshots++; this.hud.medal('HEADSHOT', 'one tap'); }
      const d = hitPos ? hitPos.distanceTo(this.player.pos) : 0;
      if (d > 46) { pts += 40; this.longShots++; this.hud.medal('LONGSHOT', Math.round(d) + ' m'); }
      if (this.revengeWindow > 0) { pts += 50; this.hud.medal('REVENGE', 'killed your shooter'); }
      this.score += pts;
      this.sessionXp += 12;
      this.hud.killfeed({ killer: this.callsign || 'YOU', victim: names, weapon: wpn, head: part === 'head', ours: true });
      audio.killfeed();
      this.checkMultiKill();
      this.grantStreak();
      this.waveKills++;
      if (this.player.hp < 26) this.hud.medal('COMEBACK', 'killed while critical');
      this.pendingHeadshot = false;
      this.revengeWindow = 0;
      if (this.onKill) this.onKill(this.kills);
    } else if (s.team === 'opfor') {
      this.hud.killfeed({ killer: s.team === 'opfor' ? 'ALLIED AI' : 'ALLIED AI', victim: names, weapon: 'rifle', ours: false });
      this.score += 25;
      if (this.objMode === 'clear') this.waveKills++;
    } else {
      // an ally died — no penalty, but the squad thins out
    }
    void part; void hitPos; void s;
  }

  checkMultiKill() {
    const now = this.time;
    this.multi = (now - (this._lastKillT || -9) < 3) ? (this._multiCount || 0) + 1 : 1;
    this._lastKillT = now;
    this._multiCount = this.multi;
    const names = { 2: ['DOUBLE KILL', 'two down, one shot'], 3: ['TRIPLE KILL', 'three and breathing'], 4: ['QUAD KILL', 'four! four!'], 5: ['RAMPAGE', 'five in a row'], 6: ['BLOODTHIRSTY', 'six without a scratch'] };
    if (names[this.multi]) {
      const [t, s] = names[this.multi];
      this.hud.medal(t, s, 'gold');
      audio.medal();
      this.score += this.multi * 40;
    }
  }

  grantStreak() {
    const k = this.streak;
    const want = { uav: 3, strike: 5, care: 8 };
    if (!this._streakMark) this._streakMark = { uav: 0, strike: 0, care: 0 };
    for (const key of Object.keys(want)) {
      const marks = Math.floor(k / want[key]);
      if (marks > this._streakMark[key]) {
        this._streakMark[key] = marks;
        this.stocks[key]++;
        this.hud.medal(key === 'uav' ? 'UAV READY' : key === 'strike' ? 'AIRSTRIKE READY' : 'CARE PACKAGE READY',
          'press ' + (key === 'uav' ? '4' : key === 'strike' ? '5' : '6'), 'streak');
        audio.streakReady();
      }
    }
    if (k > 0 && k % 5 === 0) this.score += k * 25;
  }

  useStreak(kind) {
    if (this.state !== 'play' || this.stocks[kind] <= 0) return;
    this.stocks[kind]--;
    if (kind === 'uav') {
      this.uav = 22;
      audio.ping();
      this.hud.banner('UAV INBOUND', 'hostiles painted for 22s', 1800);
      for (const s of this.soldiers) if (s.team === 'opfor' && !s.dead) s.marked = 22;
    } else if (kind === 'strike') {
      const o = this.player.eyePos(new THREE.Vector3());
      const d = this.player.forward(new THREE.Vector3());
      const hit = rayWorld(o, d, this.world.colliders, 260);
      const tp = hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : o.clone().addScaledVector(d, 60);
      tp.y = 0;
      this.hud.banner('AIRSTRIKE', 'mark confirmed · guns hot', 1800);
      for (let i = 0; i < 4; i++) {
        this.rockets.push({
          pos: new THREE.Vector3(tp.x + this.rng.range(-6, 6), 90 + i * 8, tp.z + this.rng.range(-6, 6)),
          target: new THREE.Vector3(tp.x + this.rng.range(-7, 7), 0, tp.z + this.rng.range(-7, 7)),
          speed: 46 + i * 6, i, delay: i * .28,
        });
      }
      audio.deploy();
    } else if (kind === 'care') {
      const ahead = this.player.pos.clone().addScaledVector(this.player.forward(new THREE.Vector3()), 6);
      this.drops.push({
        pos: new THREE.Vector3(ahead.x, 70, ahead.z), vy: 0, landed: false, open: false,
        content: this.rollCarePackage(), tag: 0,
      });
      this.hud.banner('CARE PACKAGE', 'incoming drop — mark it up', 1900);
      audio.ping();
    }
  }

  rollCarePackage() {
    const pool = Object.keys(WEAPONS).filter((k) => !WEAPONS[k].secondary);
    const id = this.rng.pick(pool);
    return { weapon: id, ammo: 'full', nades: 2 };
  }

  tryPickup() {
    for (const d of this.drops) {
      if (!d.landed) continue;
      if (dist(d.pos.x, d.pos.z, this.player.pos.x, this.player.pos.z) > 3.2) continue;
      d.open = true;
      const w = d.content.weapon;
      this.guns.loadout = [w, this.guns.loadout[1] || 'm1911', this.guns.loadout[2]].filter(Boolean);
      this.guns.newAmmo(w);
      this.guns.equip(w, true);
      this.guns.refitAll();
      this.player.nades = Math.min(4, this.player.nades + d.content.nades);
      this.hud.banner('CARE PACKAGE OPENED', WEAPONS[w].name + ' · ' + WEAPONS[this.guns.loadout[0]].name, 2200, 'gold');
      audio.medal();
      this.score += 50;
      d.gone = true;
      return;
    }
  }

  camoFor(id) {
    const w = this.save && this.save.wpnKills ? (this.save.wpnKills[id] || 0) : 0;
    if (w >= 250) return 'ghost';
    if (w >= 100) return 'gold';
    if (w >= 40) return 'coyote';
    return null;
  }

  // ── waves & spawning ─────────────────────────────────────────────────────
  startWave(n) {
    this.wave = n;
    this.waveKills = 0;
    this.dmgThisWave = 0;
    this.objMode = n >= 3 && n % 3 === 0 ? 'hold' : 'clear';
    this.holdT = this.objMode === 'hold' ? 35 + n * 2 : 0;
    this.holdNeed = this.holdT;
    this.objActive = false;
    this.waveState = 'active';
    this.toSpawn = Math.round(this.diff.perWave + n * this.diff.extra);
    this.spawnCd = .4;
    this.hud.setObj(this.objMode === 'hold' ? 'DEFEND' : 'ELIMINATE',
      this.objMode === 'hold' ? 'Hold the uplink — do not let it be overrun' : 'Sweep the sector — neutralise every hostile',
      0, this.objMode === 'hold' ? 1 : this.toSpawn, n, this.totalWaves, 0);
    audio.waveStart();
    this.hud.banner('WAVE ' + n + (n > this.totalWaves ? '' : '/' + this.totalWaves),
      this.objMode === 'hold' ? 'defend the position' : 'hostiles inbound · ' + this.toSpawn + ' confirmed', 2600, n === 1 ? 'big' : '');
    this.player.nades = Math.max(this.player.nades, this.diff === DIFFS.recruit ? 3 : 2);
    this.player.deadproofReady = true;
  }

  pickSpawn(px, pz, forPlayer) {
    const spawns = this.world.spawns;
    let best = spawns[0], bd = -1;
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[(i + this.rng.int(0, spawns.length - 1)) % spawns.length];
      const d = dist(s.x, s.z, px, pz);
      if (forPlayer) {
        if (d < 18) continue;
        return s;
      }
      if (d < 22) continue;
      // avoid spawning with a clear shot at the player at close range
      if (d < 40 && !this.world.blockedBetween({ x: s.x, z: s.z }, { x: px, z: pz })) continue;
      if (d > bd) { bd = d; best = s; }
    }
    return best;
  }

  spawnEnemy() {
    const n = this.wave;
    const pool = ['grunt', 'rifleman', 'rifleman'];
    if (n >= 2) pool.push('shotgunner', 'breacher');
    if (n >= 3) pool.push('automatic', 'dm');
    if (n >= 4) pool.push('sniper', 'breacher');
    if (n >= 6) pool.push('automatic', 'sniper');
    const clsKey = this.rng.pick(pool);
    const cls = { ...CLASSES[clsKey] };
    cls.hp = Math.round(cls.hp * (1 + n * .06));
    cls.skill = cls.skill * (1 + n * .02);
    const s = new Soldier(this, 'opfor', cls);
    s.clsName = clsKey;
    s.name = 'OPFOR ' + clsKey.toUpperCase().slice(0, 6);
    const sp = this.pickSpawn(this.player.pos.x, this.player.pos.z, false);
    const jitter = this.rng.range(-4, 4);
    s.spawnAt(sp.x + jitter, sp.z + jitter * .6, Math.atan2(-(this.player.pos.x - sp.x), -(this.player.pos.z - sp.z)));
    s.kills = 0; s.deaths = 0;
    this.soldiers.push(s);
    this.scene.add(s.obj);
    return s;
  }

  spawnAlly() {
    const pool = ['rifleman', 'breacher', 'dm', 'automatic'];
    const cls = { ...CLASSES[this.rng.pick(pool)] };
    cls.dmg *= .85;
    const s = new Soldier(this, 'irf', cls);
    s.name = this.rng.pick(NAME_POOL);
    const sp = this.pickSpawn(this.player.pos.x, this.player.pos.z, false);
    s.spawnAt(sp.x + this.rng.range(-3, 3), sp.z + this.rng.range(-3, 3), 0);
    s.kills = 0; s.deaths = 0;
    this.soldiers.push(s);
    this.scene.add(s.obj);
    return s;
  }

  aiObjective(s) {
    if (this.objMode === 'hold' && s.team === 'opfor') {
      return { x: this.world.objective.x + Math.sin(s.id * 1.7) * 5, z: this.world.objective.z + Math.cos(s.id * 2.3) * 5 };
    }
    if (s.team === 'irf') {
      // allies push toward the player's threat or the player
      if (s.target) return { x: s.target.pos.x, z: s.target.pos.z };
      return { x: this.player.pos.x + Math.sin(s.id) * 5, z: this.player.pos.z + Math.cos(s.id) * 5 };
    }
    return { x: this.player.pos.x, z: this.player.pos.z };
  }

  /** short AI barks shown as subtitles when they are close enough to hear */
  say(soldier, txt) {
    if (!soldier || !txt) return;
    if (this.saidRecently && this.time - this.saidRecently < 2.6) return;
    const d = dist(soldier.pos.x, soldier.pos.z, this.player.pos.x, this.player.pos.z);
    if (d > 30) return;
    this.saidRecently = this.time;
    this.hud.sayLine(txt, soldier.name || 'VOICE');
    audio.say(txt);
  }

  noiseAt(x, z, loud) {
    for (const s of this.soldiers) if (!s.dead) s.hear(x, z, loud);
  }
  footstepPing() {
    const p = this.player.pos;
    for (const s of this.soldiers) {
      if (s.dead || s.team !== 'opfor') continue;
      s.hear(p.x, p.z, s.sprinting ? 26 : 15);
    }
  }
  markTracerHit(fromPos) {
    const d = fromPos ? dist(fromPos.x, fromPos.z, this.player.pos.x, this.player.pos.z) : 99;
    if (d < 34 && this.rng.chance(.6)) audio.whiz();
  }

  // ── grenades / drops / rockets ───────────────────────────────────────────
  updateNades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const n = this.grenades[i];
      n.fuse -= dt;
      n.vel.y -= 24 * dt;
      const nx = n.pos.x + n.vel.x * dt, ny = n.pos.y + n.vel.y * dt, nz = n.pos.z + n.vel.z * dt;
      // bounce off world boxes
      const d = new THREE.Vector3(nx - n.pos.x, ny - n.pos.y, nz - n.pos.z);
      const len = d.length() || 1;
      d.divideScalar(len);
      const hit = this.world.rayTrace(n.pos.x, n.pos.y, n.pos.z, d.x, d.y, d.z, len);
      if (hit) {
        const nrm = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
        n.pos.addScaledVector(d, Math.max(.02, hit.t - .1));
        n.vel.reflect(nrm).multiplyScalar(.42);
        if (Math.abs(n.vel.y) < .4) n.vel.y = 0;
        audio.impact('concrete');
      } else {
        n.pos.set(nx, ny, nz);
      }
      const gy = this.world.groundAt(n.pos.x, n.pos.z, .2, n.pos.y + .4, n.pos.y);
      const g = gy < 0 ? 0 : gy;
      if (n.pos.y < g + .12) {
        n.pos.y = g + .12;
        if (n.vel.y < 0) { n.vel.y = -n.vel.y * .34; n.vel.x *= .7; n.vel.z *= .7; }
      }
      n.spin = (n.spin || 0) + dt * 8;
      if (!n.mesh) {
        n.mesh = new THREE.Mesh(GAME_GEO.nade, GAME_MAT.nade.clone());
        this.scene.add(n.mesh);
      }
      n.mesh.position.copy(n.pos);
      if (n.fuse < .9 && (Math.round(n.fuse * 12) % 2 === 0)) { n.mesh.material.emissive = new THREE.Color(0xff2b1d); n.mesh.material.emissiveIntensity = 1.4; }
      else if (n.mesh.material.emissiveIntensity) { n.mesh.material.emissiveIntensity = 0; }
      if (n.fuse <= 0) { this.grenades.splice(i, 1); if (n.mesh) this.scene.remove(n.mesh); this.detonate(n); }
    }
  }

  detonate(n) {
    const at = n.pos.clone();
    this.fx.explode(at, n.radius, { shake: .55 });
    audio.explosion(at, n.enemy ? .8 : 1);
    // damage soldiers
    for (const s of this.soldiers) {
      if (s.dead) continue;
      const d = s.chest(this._tmp.a).distanceTo(at);
      if (d > n.radius) continue;
      const los = losClear(at.clone().setY(at.y + .4), s.chest(this._tmp.b), this.world.colliders);
      if (!los) continue;
      const f = 1 - d / n.radius;
      const killed = s.damage(n.dmg * (.35 + f * .95), 'chest', s.chest(this._tmp.b), n.owner === 'player' || !n.enemy);
      if (killed && !n.enemy) {
        this.grenadeKills++;
        this.score += 150;
        if (f > .6) this.hud.medal('MULTI-KILL', 'grenade', 'gold');
      } else if (killed && n.enemy && s.team === 'irf') {
        this.score -= 60;
      }
    }
    // damage the player
    const pd = this.player.chestPos(this._tmp.c).distanceTo(at);
    if (!this.player.dead && pd < n.radius) {
      const los = losClear(at.clone().setY(at.y + .4), this.player.chestPos(this._tmp.a), this.world.colliders);
      if (los) this.player.damage(Math.round(n.dmg * (1 - pd / n.radius) * (n.enemy ? .9 : .65) * this.diff.dmgMul), at, 'explode');
      this.fx.shakeAdd(clamp(1 - pd / n.radius, 0, 1) * .9);
    }
    for (const s of this.soldiers) if (!s.dead) s.hear(at.x, at.z, 46);
  }

  updateRockets(dt) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      if (r.delay > 0) { r.delay -= dt; continue; }
      const dir = r.target.clone().sub(r.pos);
      const len = dir.length();
      if (len < 1.4) {
        this.rockets.splice(i, 1);
        const at = r.target.clone(); at.y = .6;
        this.fx.explode(at, 9.5, { shake: .8 });
        audio.explosion(at, 1.15);
        this.explosionDamage(at, 10, 130 * this.diff.dmgMul, false);
        continue;
      }
      dir.normalize();
      r.pos.addScaledVector(dir, r.speed * dt);
      if (!r.mesh) {
        r.mesh = new THREE.Mesh(GAME_GEO.rocket, GAME_MAT.rocket.clone());
        r.mesh.castShadow = true;
        this.scene.add(r.mesh);
      }
      r.mesh.position.copy(r.pos);
      r.mesh.lookAt(r.target);
      r.mesh.rotateX(Math.PI / 2);
      this.fx.tracer(r.pos, r.pos.clone().addScaledVector(dir, -3.4), .3, .16, 1);
    }
  }

  explosionDamage(at, radius, dmg, byEnemy) {
    for (const s of this.soldiers) {
      if (s.dead) continue;
      const d = s.chest(this._tmp.a).distanceTo(at);
      if (d > radius) continue;
      if (!losClear(at.clone().setY(at.y + .5), s.chest(this._tmp.b), this.world.colliders)) continue;
      const killed = s.damage(dmg * (1 - d / radius), 'chest', s.chest(this._tmp.b), !byEnemy);
      if (killed && !byEnemy) { this.score += 120; this.grenadeKills++; }
    }
    const pd = this.player.chestPos(this._tmp.c).distanceTo(at);
    if (!this.player.dead && pd < radius && byEnemy) this.player.damage(Math.round(dmg * (1 - pd / radius) * .8), at, 'explode');
  }

  updateDrops(dt) {
    this._nearDrop = false;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.gone) { if (d.para) this.scene.remove(d.para); this.drops.splice(i, 1); continue; }
      if (!d.landed) {
        d.vy = Math.min(9, d.vy + 14 * dt);
        d.pos.y -= d.vy * dt * (d.pos.y > 14 ? 2.6 : 1);
        if (d.pos.y <= .55) { d.pos.y = .55; d.landed = true; d.vy = 0; this.fx.dustPuff(d.pos, 2.2); audio.explosion(d.pos, .35); }
      }
      if (!d.mesh) {
        d.mesh = new THREE.Mesh(GAME_GEO.crate, GAME_MAT.crate.clone());
        d.mesh.castShadow = true;
        d.chute = new THREE.Mesh(GAME_GEO.chute, GAME_MAT.chute);
        d.chute.position.y = 2.6;
        d.para = new THREE.Group();
        d.para.add(d.mesh, d.chute);
        this.scene.add(d.para);
      }
      d.mesh.position.set(0, 0, 0);
      d.mesh.rotation.y += dt * (d.landed ? 0 : .3);
      d.mesh.position.copy(d.pos);
      d.chute.visible = !d.landed;
      d.chute.position.set(0, 2.5, 0);
      if (d.para) d.para.position.set(0, 0, 0);
      const near = dist(d.pos.x, d.pos.z, this.player.pos.x, this.player.pos.z) < 3.2 && d.landed;
      if (near) { this._nearDrop = true; if (!d._beep) { d._beep = 1; audio.ping(); } }
    }
    this.hud.prompt(this._nearDrop ? '<kbd>F</kbd> OPEN CARE PACKAGE' : '');
  }

  // ── player death / respawn ───────────────────────────────────────────────
  onPlayerDeath(srcPos) {
    this.deaths++;
    this.streak = 0;
    this._streakMark = { uav: 0, strike: 0, care: 0 };
    this.stocks = { uav: 0, strike: 0, care: 0 };
    this.combat = 1;
    this.fx.shakeAdd(.7);
    audio.hurt();
    audio.explosion(this.player.pos, .4);
    this.hud.banner('K.I.A.', 'respawning…', 1000, 'red');
    this.respawnIn = 4.5;
    if (this.onDeath) this.onDeath(srcPos);
    this.hud.el.hud.classList.add('dead');
    this.lastKiller = srcPos ? { x: srcPos.x, z: srcPos.z } : null;
    if (this.onDeath) this.onDeath(this.summary(false));
  }

  hideDeath() {
    this.respawnIn = 0;
    this.hud.el.hud.classList.remove('dead');
  }

  respawn() {
    if (this.state !== 'play' && this.state !== 'dead') return;
    this.state = 'play';
    this.hud.el.hud.classList.remove('dead');
    const sp = this.pickSpawn(this.player.pos.x, this.player.pos.z, true);
    this.player.respawnAt(sp.x, sp.z, Math.atan2(-(this.player.pos.x - sp.x), -(this.player.pos.z - sp.z)));
    this.requestLock();
    this.hud.banner('DEPLOYED', 'back in the fight', 1400);
    audio.deploy();
  }

  // ── frame ────────────────────────────────────────────────────────────────
  update(dt) {
    this.tickCount++;
    this.time += dt;
    const t = this.time;
    this.pathTokens = this.quality === 'low' ? 2 : 3;

    const input = this.readInput(dt);
    input.jump = input.jump || !!this.touchJump;
    input.ads = !!this.input.ads || !!this.touchAds;

    // firing
    if (this.state === 'play' && !this.player.dead) {
      if (this.firing) {
        const def = this.guns.def();
        if (def.mode === 'auto') this.guns.tryFire(this.time);
        else if (this.wantFireEdge) { this.guns.tryFire(this.time); this.wantFireEdge = false; }
      }
      if (!this.firing) this.wantFireEdge = false;
    }

    this.player.update(dt, input, this.time);   // camera first, then the viewmodel follows it
    this.guns.update(dt, this.time, input);

    // soldiers
    let alive = 0, hostiles = 0, nearest = 999;
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const s = this.soldiers[i];
      if (s.remove) {
        this.scene.remove(s.obj);
        this.soldiers.splice(i, 1);
        continue;
      }
      if (s.dead) { s.render(dt, t); continue; }
      if (s.marked > 0) s.marked -= dt;
      s.think(dt);
      s.resolve(dt);
      s.render(dt, t);
      alive++;
      if (s.team === 'opfor') {
        hostiles++;
        const d = dist(s.pos.x, s.pos.z, this.player.pos.x, this.player.pos.z);
        if (d < nearest) nearest = d;
        if (s.alert > 0 && d < 30) this.combat = Math.min(1, this.combat + dt * .5);
      }
    }
    this.aliveSoldiers = alive;

    // combat intensity for the music + hud tint
    this.combat = damp(this.combat, hostiles > 0 && nearest < 55 ? clamp(1.35 - nearest / 60, .3, 1) : 0, .7, dt);
    audio.setIntensity(this.combat * (this.state === 'play' ? 1 : 0));

    // wave director + mission clock
    if (this.state === 'play') {
      this.updateWaves(dt, hostiles);
      if (!this.player.dead) this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.endRun(false); }
      if (this.timeLeft < 60 && Math.ceil(this.timeLeft) !== this._lastCd) {
        this._lastCd = Math.ceil(this.timeLeft);
        if (this._lastCd <= 10) { audio.ping(); this.hud.notice('EXFIL IN ' + this._lastCd + ' — fall back to the uplink'); }
      }
    }

    this.updateNades(dt);
    this.updateRockets(dt);
    this.updateDrops(dt);

    if (this.uav > 0) this.uav -= dt;
    if (this.respawnIn > 0 && this.player.dead) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawn();
    }
    if (this.revengeWindow > 0) this.revengeWindow -= dt;

    this.fx.update(dt, this.camera);
    this.world.update(dt, t, this.player.pos.x, this.player.pos.z);
    // camera shake on top of the player-controlled transform
    const sh = this.fx.camShakeOffset();
    if (sh) {
      this.camera.position.x += sh.x; this.camera.position.y += sh.y;
      this.camera.rotation.z += sh.r;
    }
    this.updateFov();
    this.hud.update(dt, this);
    if (this.dmgThisWave === undefined) this.dmgThisWave = 0;
  }

  updateWaves(dt, hostiles) {
    const d = this.diff;
    if (this.waveState === 'break') {
      this.breakT -= dt;
      this.hud.setObj('REGROUP', this.breakT < 1.2 ? 'Fixing bayos — next wave pushing in' : 'Resupplying · armor refilled', 0, 1, this.wave, this.totalWaves, 1 - clamp(this.breakT / 6, 0, 1));
      if (this.breakT <= 0) {
        if (this.wave >= this.totalWaves) { this.endRun(true); return; }
        this.startWave(this.wave + 1);
      }
      return;
    }
    // spawn trickle — keep the field busy but never overwhelming
    this.spawnCd -= dt;
    if (this.spawnCd <= 0 && this.toSpawn > 0 && hostiles < Math.min(d.capAlive, 3 + this.wave)) {
      this.spawnEnemy();
      this.toSpawn--;
      this.spawnCd = d.spawnGap * this.rng.range(.8, 1.35);
      void d;
    }
    // allies
    const allies = this.soldiers.filter((s) => s.team === 'irf' && !s.dead).length;
    if (allies < d.allies && this.tickCount % 40 === 0) this.spawnAlly();

    const killed = this.waveKills;
    if (this.objMode === 'clear') {
      const total = killed + this.toSpawn;
      this.hud.setObj('ELIMINATE', 'Sweep the sector — neutralise every hostile', killed, total, this.wave, this.totalWaves, killed / Math.max(1, total));
      if (killed >= total) this.clearWave();
    } else {
      const inZone = dist(this.player.pos.x, this.player.pos.z, this.world.objective.x, this.world.objective.z) < this.world.objective.r;
      this.objActive = inZone;
      if (inZone) this.holdT -= dt * (hostiles > 4 ? .72 : 1);
      this.hud.setObj('DEFEND', inZone ? 'Holding the uplink — ' + Math.ceil(Math.max(0, this.holdT)) + 's' : 'Return to the uplink zone', 0, 1, this.wave, this.totalWaves, 1 - clamp(this.holdT / Math.max(1, this.holdNeed), 0, 1));
      if (this.holdT <= 0) this.clearWave();
    }
  }

  clearWave() {
    this.waveState = 'break';
    this.breakT = 6.5;
    this.score += 300 + this.wave * 60;
    this.sessionXp += 90 + this.wave * 24;
    this.player.armor = this.diff.maxArmor;
    this.player.plates = this.diff.plates + (this.perk === 'situational' ? 1 : 0);
    this.player.nades = this.player.maxNades;
    this.guns.refitAll();
    if (this.dmgThisWave === 0) { this.hud.medal('UNTOUCHABLE', 'wave without damage', 'gold'); this.score += 200; }
    this.hud.banner('WAVE ' + this.wave + ' CLEARED', this.wave >= this.totalWaves ? 'exfil inbound…' : 'resupply · next wave in 6s', 3000, 'gold');
    audio.waveClear();
    // mop up the stragglers so the break feels like a break
    for (const s of this.soldiers) if (s.team === 'opfor' && !s.dead) s.hp = Math.min(s.hp, 1);
  }

  render() {
    const r = this.renderer;
    r.render(this.scene, this.camera);
    // hands + gun on top, never clipped by level geometry
    if (this.state === 'play' || this.state === 'paused' || this.state === 'dead') {
      const cam = this.camera, root = this.vmRoot, vc = this.vmCam;
      root.position.copy(cam.position);
      root.quaternion.copy(cam.quaternion);
      root.updateMatrixWorld(true);
      vc.fov = cam.fov; vc.aspect = cam.aspect; vc.updateProjectionMatrix();
      const prev = r.autoClear;
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, vc);
      r.autoClear = prev;
    }
  }
}

const GAME_GEO = {
  nade: new THREE.SphereGeometry(.12, 8, 6),
  rocket: new THREE.CylinderGeometry(.16, .12, 1.4, 6),
  crate: new THREE.BoxGeometry(1.5, 1.1, 1.5),
  chute: new THREE.ConeGeometry(2.1, 1.8, 10, 1, true),
};
const GAME_MAT = {
  nade: new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: .7, metalness: .25 }),
  rocket: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, emissive: 0x552200, roughness: .6 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x6d7a5a, roughness: .8, emissive: 0x1a2a10, emissiveIntensity: .6 }),
  chute: new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: .95, side: THREE.DoubleSide }),
};

const NAME_POOL = ['SGT. VAUGHN', 'CPL. OKAFOR', 'PVT. LUND', 'PVT. AOKI', 'CPL. MENDES', 'SGT. REYES', 'PVT. HAAL', 'CPL. NOVAK', 'SGT. IBRAHIM'];
export { NAME_POOL };
