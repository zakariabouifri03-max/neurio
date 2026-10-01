// ── IRONVOW — the game itself: one hall, two men, and a fixed step ───────────
// The duel runs at a fixed 120 Hz whatever the display does, because the
// difference between a parry and a beating is half a frame of the steel's
// travel. Rendering is left to whatever the browser manages; the fight never
// sees a variable timestep.
import * as THREE from 'three';
import { Arena } from './arena.js';
import { Fighter } from './fighter.js';
import { Brain } from './ai.js';
import { bindPair, resolveExchange } from './exchange.js';
import { threatPoint, incomingSide } from './defense.js';
import { Vfx } from './vfx.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { Input } from './input.js';
import { View } from './view.js';
import { Save, Bout, brainFor, DRILLS } from './state.js';
import { CHAMPIONS, champById, weaponById, harnessById, shieldById, arenaById, MODES, rankFor } from './data.js';
import { clamp, clamp01, srand, angDiff, _v1, _v2 } from './mathx.js';

const FIXED = 1 / 120;
const SURFACE = { hall: 'stone', oubliette: 'stone', courtyard: 'sand', ramparts: 'stone' };
const MAX_STEPS = 8;

export class Game {
  constructor(container) {
    this.container = container;
    this.time = 0;
    this.acc = 0;
    this.mode = 'menu';
    this.freeze = 0;
    this.bout = null;
    this.pendingEnd = null;
    this.landed = 0;
    this.taken = 0;
    this.parries = 0;
    this.breaks = 0;
    this.stepFlag = new Map();
    this.swings = 0;
    this.opponentQueue = [];
    this.lastEventAt = 0;
    this.slowMo = 0;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
  }

  // ══ boot ══════════════════════════════════════════════════════════════════
  boot() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    this.container.append(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.02, 160);
    this.camera.rotation.order = 'YXZ';

    this.save = new Save();
    this.kit = this.save.data.kit;
    this.tally = { player: 0, foe: 0 };
    srand(this.save.data.seed || 20261001);

    this.input = new Input(renderer.domElement);
    this.input.sensitivity = 0.0022 * (this.save.data.settings.sensitivity || 1);
    this.input.invertY = !!this.save.data.settings.invertY;
    this.view = new View(this.camera);
    this.vfx = new Vfx(this.scene);
    this.audio = new Audio();
    this.audio.setEnabled(this.save.data.settings.sound !== false);
    this.audio.setVolume(this.save.data.settings.volume ?? 0.8);

    this.hud = new Hud(document.getElementById('hud'));
    this.menu = new Menu(document.getElementById('menu'), { save: this.save, kit: this.kit });
    this._wireMenu();

    addEventListener('resize', () => this.resize());
    renderer.domElement.addEventListener('mousedown', () => {
      this.audio.start();
      if (this.mode === 'fight' && !this.input.locked) this.input.requestLock();
    });
    addEventListener('keydown', () => this.audio.start(), { once: true });
    this.input.onLock = (locked) => {
      if (!locked && this.mode === 'fight') this.pause();
    };
    this.input.onTouchBlock = () => { /* touch: a second finger is the guard */ };

    this.loadArena('hall');
    this.menu.showTitle();
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  _wireMenu() {
    this.menu.on('click', () => this.audio.start());
    this.menu.on('settings', () => {
      const s = this.save.data.settings;
      this.input.sensitivity = 0.0022 * (s.sensitivity || 1);
      this.input.invertY = !!s.invertY;
      this.audio.setEnabled(s.sound !== false);
      this.audio.setVolume(s.volume ?? 0.8);
    });
    this.menu.on('drill', (id) => this.menu.showBriefing(DRILLS.find((d) => d.id === id)));
    this.menu.on('begin', (id) => this.startDrill(id));
    this.menu.on('quick', (spec) => this.startQuick(spec));
    this.menu.on('resume', () => this.resume());
    this.menu.on('abandon', () => this.toHall());
    this.menu.on('again', () => this.restartLast());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ══ halls ═════════════════════════════════════════════════════════════════
  loadArena(id) {
    if (this.arena) {
      this.scene.remove(this.arena.group);
      this.scene.fog = null;
    }
    this.arenaId = id;
    this.arena = new Arena(id);
    this.scene.add(this.arena.group);
    // the hall owns its own lights and its own air
    if (this.arena.scene?.fog) this.scene.fog = this.arena.scene.fog;
    if (this.arena.def.fog !== undefined) this.scene.background = new THREE.Color(this.arena.def.fog);
    if (this.audio.ready) this.audio.setAmbient(id);
    this.hud.arena = this.arena;
  }

  // ══ setting up a bout ════════════════════════════════════════════════════
  startDrill(id) {
    const drill = DRILLS.find((d) => d.id === id) || DRILLS[0];
    this.loadArena(drill.arena);
    const spec = {
      mode: drill.mode, arena: drill.arena, opponents: drill.opponents.slice(),
      rounds: drill.mode === 'gauntlet' ? drill.opponents.length : Math.max(2, Math.ceil(drill.rounds / 2)),
      drill,
    };
    this.beginBout(spec);
  }

  startQuick(o) {
    this.loadArena(o.arena || 'hall');
    const champ = champById(o.opponent) || CHAMPIONS[0];
    this.beginBout({
      mode: 'duel', arena: o.arena || 'hall',
      opponents: [champ.id], rounds: 2, quick: true,
    });
  }

  restartLast() {
    if (!this._lastSpec) return this.toHall();
    const s = this._lastSpec;
    if (s.drill) this.startDrill(s.drill.id); else this.startQuick({ opponent: s.opponents[0], arena: s.arena });
  }

  beginBout(spec) {
    this._lastSpec = spec;
    this.menu.hide();
    this.audio.start();
    this.audio.setAmbient(spec.arena);
    this.bout = new Bout(spec, this.save);
    this.mode = 'fight';
    this.spawnPlayer();
    this.vfx.decals.slice().forEach((d) => { d.m.dead = true; });
    this.spawnOpponent(this.bout.next());
    this.hud.build(this.player, this.foe, this.arena);
    this.hud.setRounds(this.bout.roundsToWin * 2 - 1, 0, 0);
    this.startRound(true);
    this.input.requestLock();
  }

  spawnPlayer() {
    if (this.player) { this.scene.remove(this.player.rig.root); this.player = null; }
    const spawn = this.arena.spawns[0];
    this.player = new Fighter({
      name: 'You', side: 'player',
      weapon: weaponById(this.kit.weapon), harness: harnessById(this.kit.harness),
      shield: shieldById(this.kit.shield), house: 'ashcombe',
      position: new THREE.Vector3(spawn.x, 0, spawn.z),
    });
    this.player.rig.setFirstPerson(true);
    this.scene.add(this.player.rig.root);
    this.view.setLook(this.arena.facingFor(0), -0.04);
  }

  spawnOpponent(champ) {
    if (this.foe) { this.scene.remove(this.foe.rig.root); this.foe = null; }
    const spawn = this.arena.spawns[1];
    const cfg = {
      name: champ.name, id: champ.id, side: 'enemy',
      body: champ.body, cloth: champ.cloth, accent: champ.accent,
      harness: harnessById(champ.harness), weapon: weaponById(champ.weapon),
      shield: shieldById(champ.shield || 'none'), house: champ.house,
      position: new THREE.Vector3(spawn.x, 0, spawn.z),
    };
    this.foe = new Fighter(cfg);
    this.foe.lead = champ.title;
    this.foe.champ = champ;
    this.foe.rig.root.rotation.y = this.arena.facingFor(1);
    this.foe.yaw = this.arena.facingFor(1);
    this.scene.add(this.foe.rig.root);
    const difficulty = this.save.data.settings.difficulty || 1;
    this.brain = new Brain(this.foe, brainFor(champ, difficulty));
    this.foe.stamina = this.foe.maxStamina;
  }

  startRound(first = false) {
    this.roundStart = this.time;
    this.freeze = first ? 1.9 : 2.4;
    this.roundOver = false;
    this.pendingEnd = null;
    this.landed = 0; this.taken = 0; this.parries = 0; this.breaks = 0;
    if (this.player) {
      this.player.vel.set(0, 0, 0);
      if (this.bout.mode !== 'gauntlet' || first) this.player.bodyState = this.player.rig.body;
    }
    const champ = this.foe.champ;
    this.hud.announce(first ? champ.name : `Pass ${this.bout.round}`, first ? champ.title : 'first blood takes it', 1800);
    this.audio.bell();
    if (this.player) { this.player.intent.x = 0; this.player.intent.z = 0; }
  }

  // ══ flow ═════════════════════════════════════════════════════════════════
  pause() {
    if (this.mode !== 'fight') return;
    this.mode = 'pause';
    this.input.releaseLock();
    this.menu.showPause();
  }

  resume() {
    this.menu.hide();
    this.mode = 'fight';
    this.input.requestLock();
    this.last = performance.now();
  }

  toHall() {
    this.mode = 'menu';
    this.input.releaseLock();
    if (this.player) { this.scene.remove(this.player.rig.root); this.player = null; }
    if (this.foe) { this.scene.remove(this.foe.rig.root); this.foe = null; }
    this.hud.show(false);
    this.menu.showTitle();
  }

  /** Someone has stopped standing. Finish the pass. */
  endRound(playerWon, reason) {
    if (this.roundOver) return;
    this.roundOver = true;
    const t = this.time - this.roundStart;
    if (playerWon) this.bout.note('kills');
    const res = this.bout.finishRound(playerWon, { time: t, health: this.player.bodyState.health / this.player.bodyState.maxHealth });
    const word = reason === 'yield' ? (playerWon ? 'He yields' : 'You yield') : (playerWon ? 'The pass is yours' : 'You are beaten');
    this.hud.announce(word, playerWon ? (this.foe.champ?.lines?.lose?.[0] || '') : (this.foe.champ?.lines?.win?.[0] || ''), 2200);
    this.audio.bell();
    if (res.boutOver) {
      this.pendingEnd = { at: this.time + 2.6, playerWon };
    } else {
      this.pendingEnd = { at: this.time + 2.4, nextRound: true, playerWon };
    }
  }

  finishBout(playerWon) {
    const drill = this.bout.spec.drill;
    let reward = null;
    if (drill) reward = this.save.finishDrill(drill, this.bout.summary(playerWon));
    else this.save.noteBout({ bouts: 1, [playerWon ? 'wins' : 'losses']: 1, kills: this.bout.stats.kills });
    this.mode = 'menu';
    this.input.releaseLock();
    const next = this.save.nextDrill();
    this.menu.showResults({
      won: playerWon,
      title: drill ? `${drill.name} — ${rankFor(this.save.data.renown)}` : 'Quick duel',
      roundsWon: this.bout.won, roundsLost: this.bout.lost,
      blowsLanded: this.bout.stats.blowsLanded, blowsTaken: this.bout.stats.blowsTaken,
      parries: this.bout.stats.parries, guardBreaks: this.bout.stats.guardBreaks,
      time: this.bout.time, reward,
      nextDrill: this.save.isUnlocked(next.id) && !this.save.drillState(next.id) ? next.id : null,
      epitaph: playerWon ? '' : (this.foe.champ?.lines?.win?.[0] || ''),
    });
    this.hud.show(false);
  }

  nextRound() {
    const champ = this.bout.current;
    const alive = this.foe && this.foe.alive;
    if (this.bout.mode === 'gauntlet') {
      // the next name walks out; you keep what is left of you, plus a measure of
      // breath a surgeon would not begrudge
      this.player.bodyState = this.player.rig.body;
      this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 34);
      this.spawnOpponent(this.bout.next());
      this.hud.build(this.player, this.foe, this.arena);
      this.hud.setRounds(1, 0, 0);
    } else {
      // a fresh pass: both men are stood up, bandaged and told to try again
      this.resetFighter(this.player);
      this.resetFighter(this.foe);
    }
    this.startRound(false);
  }

  resetFighter(f) {
    const spawn = f.side === 'player' ? this.arena.spawns[0] : this.arena.spawns[1];
    f.bodyState.health = f.bodyState.maxHealth;
    f.bodyState.bleed = 0;
    for (const r in f.bodyState.regions) {
      const rg = f.bodyState.regions[r];
      rg.hp = rg.maxHp; rg.disabled = false;
      for (const k in rg.layers) rg.layers[k].dur = 1;
    }
    f.stamina = f.maxStamina;
    f.dead = false; f.yielded = false; f.deathT = 0;
    f.bodyState.alive = true;
    f.state = 'idle'; f.stateT = 0; f.move = null; f.charge = 0;
    f.frozen = null; f.guardBroken = 0; f.staggerT = 0;
    f.rig.root.rotation.set(0, f.yaw, 0);
    if (f.guardMisread) f.guardMisread.set(0, 0, 0);
    f.pos.set(spawn.x, 0, spawn.z);
    f.vel.set(0, 0, 0);
    f.yaw = this.arena.facingFor(f.side === 'player' ? 0 : 1);
    f.rig.root.rotation.set(0, f.yaw, 0);
    if (f.ai) f.ai.state = 'idle';
  }

  // ══ player intent ════════════════════════════════════════════════════════
  readPlayer(dt) {
    const p = this.player, i = this.input;
    const look = i.lookDelta();
    this.view.addLook(look.yaw, look.pitch);
    // the body turns with the eyes: a first-person fighter IS his looking
    p.yaw = this.view.yaw;
    p.lookPitch = this.view.pitch;
    const ax = i.moveAxis();
    p.intent.x = ax.x;
    p.intent.z = ax.z;
    p.intent.sprint = i.down('sprint');
    if (i.pressed('lock') && this.foe) this.lockOn = !this.lockOn;
    if (this.lockOn && this.foe && this.foe.alive) {
      const want = Math.atan2(this.foe.pos.x - p.pos.x, this.foe.pos.z - p.pos.z);
      const d = angDiff(this.view.yaw, want);
      this.view.addLook(clamp(d * 5 * dt, -3 * dt, 3 * dt), 0);
      p.yaw = this.view.yaw;
    }

    if (this.freeze > 0) { return; }
    const st = this.save.data.settings;
    // ── guard: right hand on the hilt, held where the eyes are ──
    if (i.mouse.right) {
      const want = this._guardDir();
      if (!p.blocking) { p.startBlock(want); this.audio.draw(); }
      // the guard's line follows the eyes while it is held: this is the whole of
      // "precise weapon control" on defence — you cover what you are looking at
      else if (want !== p.guardDir) p.startBlock(want);
      this.guardDir = want;
    } else if (p.blocking) p.endBlock();

    // ── blows: wind on press, release to commit, hold to charge ──
    if (i.mouse.leftDown) {
      const dir = this._swingDir(look.dx, look.dy);
      if (p.startAttack(dir)) this.audio.grunt(false);
    } else if (!i.mouse.left && (p.state === 'windup' || (p.state === 'strike' && p.stateT < 0.02))) {
      if (p.state === 'windup') { p.releaseAttack(); this.audio.grunt(p.charge > 0.6); }
    }
    // keyboard fallback for a precise choice of line
    const dirKeys = { KeyI: 'U', KeyJ: 'L', KeyK: 'D', KeyL: 'R', Numpad8: 'U', Numpad4: 'L', Numpad5: 'D', Numpad6: 'R' };
    if (!i.mouse.left) {
      for (const code in dirKeys) {
        if (i.pressed(code)) { if (p.startAttack(dirKeys[code])) this.audio.grunt(false); }
      }
    }
    if (i.pressed('feint') && p.state === 'windup') { p.feint(); this.audio.rattle(0.5); }
    if (i.pressed('shove')) { p.shove(1); this.vfx.burst(p.pos.clone().setY(1.1).addScaledVector(p.forward(_v1), 0.4), p.forward(_v2), 0.7); this.audio.exhale(0.8); }
    if (i.pressed('swap')) this.swapGuard();
    // a beaten man can ask for quarter instead of being carried out — only when
    // he is clearly beaten, so it can never be a cheap way out of a close fight
    if (i.pressed('yield') && p.bodyState.health < p.bodyState.maxHealth * 0.42) {
      if (p.yield()) { this.hud.announce('YOU YIELD', 'the hall takes your point', 1800); this.audio.ui('deny'); }
    }
    if (i.pressed('pause')) this.pause();
  }

  _guardDir() {
    const pitch = this.view.pitch;
    // the guard follows the eyes: up is a high line, down is a low one
    if (pitch > 0.16) return 'high';
    if (pitch < -0.30) return 'low';
    if (this.foe && this.foe.alive) {
      const right = _v1.set(1, 0, 0).applyQuaternion(this.player.rig.root.getWorldQuaternion(new THREE.Quaternion()));
      const to = _v2.copy(this.foe.pos).sub(this.player.pos).setY(0);
      const h = to.dot(right) * -1;
      if (Math.abs(h) > 0.75) return h > 0 ? 'right' : 'left';
    }
    return 'center';
  }

  /** Which line the blow takes: the mouse's own gesture, not a menu. */
  _swingDir(dx, dy) {
    const p = this.player;
    if (Math.hypot(dx, dy) > 6) {
      if (Math.abs(dy) > Math.abs(dx) * 1.25) return dy < 0 ? 'U' : 'D';
      return dx > 0 ? 'R' : 'L';
    }
    // no gesture (or a still hand): the stance decides, and a point weapon
    // throws its point by default
    if (p.weaponDef.archetype === 'spear' || p.weaponDef.archetype === 'polearm') return 'D';
    return p.lastDir === 'U' ? 'R' : 'U';
  }

  /** Swap which side of the body carries the guard. */
  swapGuard() {
    const order = ['center', 'high', 'left', 'low', 'right'];
    const cur = order.indexOf(this.player.guardDir || 'center');
    this.player.guardDir = order[(cur + 1) % order.length];
    if (this.player.blocking) this.player.guardT = 0;
    this.audio.ui('click');
  }

  // ══ one fixed step of the fight ══════════════════════════════════════════
  step(dt) {
    const p = this.player, f = this.foe;
    if (!p || !f) return;
    if (this.freeze > 0) {
      this.freeze -= dt;
      p.intent.x = 0; p.intent.z = 0; p.intent.sprint = false;
      if (this.brain) { this.brain.f.intent.x = 0; this.brain.f.intent.z = 0; }
    }
    // a drillmaster is not killed: the hall wants you corrected, not hanged
    if (this.bout.mode === 'training' && f.bodyState.health < 8) f.bodyState.health = 8;
    if (this.brain && this.freeze <= 0 && !this.roundOver) this.brain.update(dt, p);
    bindPair(p, f);
    p.update(dt, this.arena, this.time);
    f.update(dt, this.arena, this.time);
    const events = resolveExchange(p, f, dt, this._ev || (this._ev = []));
    for (const e of events) this.onEvent(e);

    // footfalls, from the fighters' own speed
    for (const g of [p, f]) {
      const sp = g.speed;
      const phase = Math.sin(g.stepPhase);
      const prev = this.stepFlag.get(g) ?? 0;
      if (phase > 0 && prev <= 0 && sp > 0.35) {
        const at = g.pos.clone();
        const surface = SURFACE[this.arenaId] || 'stone';
        this.vfx.step(at, null, clamp01(sp / 3));
        this.audio.step(sp * (g === p ? 1 : 0.8), surface, g === p ? 1 : 0.9);
      }
      this.stepFlag.set(g, phase);
    }
    this.time += dt;
    // the director asks every frame: a pass can end by death, by quarter, or by
    // the marshal's count, and two of those leave both men standing
    this.checkEnd();
  }

  checkEnd() {
    // A pass has to END. Two good men can hold each other at guard for a long
    // time, and the hall's marshal would call it: at three-quarters of a minute
    // the pass goes to whoever is standing in better order.
    const limit = this.bout?.mode === 'gauntlet' ? 70 : 62;
    if (!this.roundOver && !this.pendingEnd && this.time - this.roundStart > limit) {
      const p = this.player, f = this.foe;
      // A harness bout that draws no blood is decided the way a marshal decides
      // it: blows landed, then who is in better order. That is the whole art of
      // the thing — get past his guard more often than he gets past yours — and
      // it is the one score a tank of a man in plate cannot simply outlast.
      const tally = this.tally || (this.tally = { player: 0, foe: 0 });
      const mine = tally.player * 2 + p.bodyState.health / p.bodyState.maxHealth + p.stamina / p.maxStamina * 0.5;
      const his = tally.foe * 2 + f.bodyState.health / f.bodyState.maxHealth + f.stamina / f.maxStamina * 0.5;
      this.hud.say(`the marshal counts the blows — ${tally.player} to ${tally.foe}`, mine >= his ? 'good' : 'bad');
      this.endRound(mine >= his, 'time');
      return;
    }
    if (this.pendingEnd) {
      if (this.time >= this.pendingEnd.at) {
        const pe = this.pendingEnd;
        this.pendingEnd = null;
        if (pe.nextRound) this.nextRound(); else this.finishBout(pe.playerWon);
      }
      return;
    }
    if (this.roundOver) return;
    const p = this.player, f = this.foe;
    if (!p.alive) this.endRound(false, 'death');
    else if (!f.alive) this.endRound(true, 'death');
    else if (p.yielded) this.endRound(false, 'yield');
    else if (f.yielded) this.endRound(true, 'yield');
    else if (this.bout.mode === 'training' && f.bodyState.health <= 6) this.endRound(true, 'drill');
  }

  onEvent(e) {
    const p = this.player, f = this.foe;
    const isPlayerAttacker = e.attacker === p;
    switch (e.type) {
      case 'clash':
      case 'parry': {
        const power = clamp01((e.energy || 0) / 120);
        this.vfx.clash(e.point, _v1.copy(e.point).sub(e.victim.pos).setY(0).normalize(), power * (e.type === 'parry' ? 1.2 : 0.9));
        if (e.type === 'parry') this.audio.parry(power);
        else if (e.shield) this.audio.shieldHit(power);
        else this.audio.clash(power);
        if (e.victim === p) { this.view.jolt(power); this.hud.flash('rgba(255,240,210,0.25)'); }
        else this.view.jolt(power * 0.4);
        this.hud.say(e.type === 'parry' ? 'parried' : (e.shield ? 'took it on the shield' : 'steel on steel'), e.type === 'parry' ? 'parry' : 'clash');
        if (e.type === 'parry') { this.parries++; this.bout.note('parries'); }
        break;
      }
      case 'guardBreak': {
        this.vfx.clash(e.point, _v1.set(0, 0.4, 0).addScaledVector(_v2.copy(e.point).sub(e.victim.pos).setY(0).normalize(), 1), 1.2);
        this.audio.guardBreak();
        this.hud.say(e.victim === p ? 'your guard is beaten open' : `${f.name}'s guard breaks`, 'break');
        this.hud.announce(e.victim === p ? 'GUARD BROKEN' : 'HIS GUARD BREAKS', '', 900);
        if (e.victim === p) { this.view.impact(0.9, 'front'); this.hud.flash('rgba(255,90,60,0.35)'); }
        this.breaks++; this.bout.note('guardBreaks');
        break;
      }
      case 'graze': {
        // his steel slid along ours: a scrape, a shower of sparks, and most of
        // the blow still coming — this is what a guard in the wrong line buys
        const power = clamp01((e.energy || 0) / 140);
        this.vfx.clash(e.point, _v1.copy(e.point).sub(e.victim.pos).setY(0.2).normalize(), 0.35 + power);
        this.audio.clash(0.25, e.shield);
        if (e.victim === p) { this.view.jolt(0.4 + power * 0.5); this.hud.say('turned aside — hold the line!', 'note'); }
        else this.hud.say('your edge slides off his', 'note');
        break;
      }
      case 'touch': {
        this.vfx.clash(e.point, _v1.set(0, 1, 0), 0.2);
        this.audio.clang(0.2);
        break;
      }
      case 'hit': {
        const res = e.res;
        const dir = e.dir || 'front';
        const power = clamp01((res.applied || 0) / 34);
        const attacker = e.attacker === p;
        const point = e.point;
        const edgePoint = _v1.copy(point);
        this.vfx.wound(point, _v2.copy(point).sub(e.victim.pos).setY(0).normalize(), edgePoint, power,
          (res.region === 'throat' || res.region === 'chest') && res.applied > 20);
        (this.tally || (this.tally = { player: 0, foe: 0 }))[attacker ? 'player' : 'foe'] += 1 + ((res.applied || 0) > 16 ? 1 : 0);
        const armoury = res.protection !== undefined ? res.protection > 0.6 : false;
        this.audio.cut(power, res.strike);
        if (armoury) this.audio.clang(power);
        if (e.victim === p) {
          this.view.impact(power, dir);
          this.hud.hurt(dir, power);
          this.audio.hurt(power > 0.6);
          this.taken++;
          this.bout.stats.blowsTaken++;
          this.hud.say(`${res.label || res.region} — ${word(res.applied)}`, power > 0.5 ? 'bad' : 'note');
        } else {
          this.view.jolt(power * 0.5);
          this.hud.flash('rgba(255,210,150,0.12)');
          this.landed++;
          this.bout.stats.blowsLanded++;
          this.hud.say(`you ${res.strike} his ${res.label || res.region} — ${word(res.applied)}`, power > 0.5 ? 'good' : 'note');
          if (res.gap) this.hud.say(`through the ${res.gap}`, 'good');
        }
        if (res.applied > 8 || !e.victim.alive) this.slowMo = Math.min(0.28, 0.06 + power * 0.3);
        if (!e.victim.alive) {
          this.vfx.fall(e.victim.pos.clone().setY(0.6));
          const at = e.victim.pos.clone();
          for (let i = 0; i < 4; i++) this.vfx.stain(_stainAt(at, i));
          this.audio.death();
        }
        break;
      }
      case 'death': {
        this.hud.announce(e.victim === p ? 'You fall' : `${f.name} falls`, '', 2000);
        break;
      }
      default: break;
    }
    this.audio.start();
  }

  // ══ the frames ═══════════════════════════════════════════════════════════
  frame(now) {
    const raw = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.mode === 'fight') {
      if (this.player) this.readPlayer(raw);
      this.acc += raw;
      let n = 0;
      while (this.acc >= FIXED && n < MAX_STEPS) { this.step(FIXED); this.acc -= FIXED; n++; }
      if (n === MAX_STEPS) this.acc = 0;
      this.renderFight(raw);
    } else {
      this.time += raw;
    }
    this.vfx.update(raw);
    if (this.arena) this.arena.update(raw, this.time, this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  renderFight(raw) {
    const p = this.player, f = this.foe;
    if (this.slowMo > 0) this.slowMo = Math.max(0, this.slowMo - raw);
    this.view.update(raw, p);
    // ── what the player can see of the incoming blow ──
    let ctx = { threat: null, incomingSide: null, incomingKind: null, aimX: 0, aimY: 0, quality: 0, measure: 0 };
    if (f && f.alive) {
      const tp = threatPoint(p.rig, f.wb, 0.11, { facing: true, maxRange: 2.1 });
      if (tp) {
        const side = incomingSide(f.pos, p.rig);
        const local = this._tmpA.copy(tp).applyMatrix4(this._tmpB.copy(this.camera.matrixWorld).invert());
        ctx = {
          threat: tp, incomingSide: side,
          incomingKind: f.opponentKind || 'cut',
          aimX: local.x / Math.max(0.4, -local.z),
          aimY: local.y / Math.max(0.4, -local.z),
          quality: p.guardOut ? (p.guardOut.quality || 0) : 0,
        };
      }
    }
    ctx.quality = p.guardOut?.quality || 0;
    // out of measure: the most useful thing a swordsman can be told, and the one
    // the game can honestly know
    this.hud.measure((f && f.alive) ? f.chestDistance(p) : 0, p.measure || 0);
    this.hud.update(raw, ctx);
    this.vfx.updateTrail(p, raw);
    if (this.save.data.settings.showTell === false) this.hud.tell.style.display = 'none';
    else this.hud.tell.style.display = '';
    // a beaten man's hands shake
    if (p.exhausted) this.camera.rotation.z += Math.sin(this.time * 3.1) * 0.004;
  }
}

function word(n) {
  const a = n || 0;
  if (a < 3) return 'barely';
  if (a < 8) return 'a sting';
  if (a < 16) return 'a real wound';
  if (a < 26) return 'bad';
  return 'grievous';
}

function _stainAt(base, i) {
  const a = (i / 4) * Math.PI * 2 + 0.7;
  return base.clone().add(new THREE.Vector3(Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34));
}

// ── boot ───────────────────────────────────────────────────────────────────
const container = typeof document !== 'undefined' ? document.getElementById('app') : null;
if (container && !globalThis.__ironvowNoAutoBoot) {
  const game = new Game(container);
  game.boot();
  window.__ironvow = game;
}
