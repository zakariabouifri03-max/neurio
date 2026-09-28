// fishing.js — rod rig, casting, bite detection and the line-fight minigame
import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, mulberry32, rand, pick, TAU, colorGeo } from './util.js';

/** species table — weights in kg, fight = how hard it pulls, zone = safe tension band */
export const FISH = {
  surfperch: { name: 'Surf perch', icon: '🐟', w: [0.2, 0.9], fight: 0.55, waters: ['surf'], rarity: 0.30, value: 4 },
  sardine: { name: 'Sardine', icon: '🐟', w: [0.05, 0.25], fight: 0.4, waters: ['surf', 'sea'], rarity: 0.28, value: 2 },
  seabream: { name: 'Sea bream', icon: '🐠', w: [0.6, 2.4], fight: 0.95, waters: ['surf', 'sea'], rarity: 0.16, value: 12 },
  bass: { name: 'Sea bass', icon: '🐟', w: [0.8, 3.4], fight: 1.15, waters: ['sea'], rarity: 0.10, value: 18 },
  mackerel: { name: 'Mackerel', icon: '🐟', w: [0.3, 1.1], fight: 0.85, waters: ['sea'], rarity: 0.17, value: 9 },
  grouper: { name: 'Grouper', icon: '🐡', w: [2.0, 9.5], fight: 1.7, waters: ['sea', 'deep'], rarity: 0.05, value: 34 },
  octopus: { name: 'Octopus', icon: '🐙', w: [0.5, 3.0], fight: 1.45, waters: ['sea', 'deep'], rarity: 0.07, value: 26 },
  trout: { name: 'Mountain trout', icon: '🐟', w: [0.3, 1.6], fight: 0.9, waters: ['lake'], rarity: 0.34, value: 15 },
  carp: { name: 'Carp', icon: '🐟', w: [1.0, 5.0], fight: 1.05, waters: ['lake'], rarity: 0.26, value: 12 },
  catfish: { name: 'Catfish', icon: '🐋', w: [1.5, 8.0], fight: 1.4, waters: ['lake'], rarity: 0.12, value: 24 },
  golden: { name: 'Golden fish ✨', icon: '✨', w: [0.8, 2.2], fight: 1.6, waters: ['lake', 'sea', 'deep', 'surf'], rarity: 0.012, value: 120, legendary: true },
  junk_boot: { name: 'Old boot', icon: '👢', w: [0.5, 0.5], fight: 0.2, waters: ['surf', 'sea', 'deep', 'lake'], rarity: 0.06, value: 0, junk: true },
  junk_weed: { name: 'Seaweed', icon: '🌿', w: [0.2, 0.2], fight: 0.15, waters: ['surf', 'sea'], rarity: 0.05, value: 0, junk: true, item: 'fiber' },
  junk_bottle: { name: 'Bottle with a note', icon: '🍾', w: [0.4, 0.4], fight: 0.2, waters: ['sea', 'surf'], rarity: 0.03, value: 0, junk: true, item: 'cloth' },
};

export const BAITS = {
  none: { name: 'No bait', biteRate: 1.0, sizeBonus: 0 },
  shellfish: { name: 'Shellfish', biteRate: 1.6, sizeBonus: 0.15 },
  fish_raw: { name: 'Fish scraps', biteRate: 1.45, sizeBonus: 0.2 },
  meat_raw: { name: 'Meat scraps', biteRate: 1.35, sizeBonus: 0.25 },
  lure: { name: 'Shiny lure', biteRate: 1.25, sizeBonus: 0.1 },
  berry: { name: 'Berries', biteRate: 1.15, sizeBonus: 0 },
};

function makeRodMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
  const add = (geo, color, pos, rot, scale) => {
    const m = new THREE.Mesh(colorGeo(geo, new THREE.Color(color)), mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    g.add(m);
    return m;
  };
  // grip
  add(new THREE.CylinderGeometry(0.026, 0.03, 0.32, 8), 0x5a3f28, [0, 0, 0], [Math.PI / 2, 0, 0]);
  // blank (segments bending)
  const segs = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const s = add(new THREE.CylinderGeometry(0.016 - t * 0.011, 0.02 - t * 0.012, 0.42, 6), 0x3a2c20 - i * 0x000404, [0, 0, -0.4 - i * 0.4], [Math.PI / 2, 0, 0]);
    segs.push(s);
  }
  // reel
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), 0x2b3138, [0.02, -0.05, -0.18], [0, 0, Math.PI / 2]);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6), 0xcfd4d8, [0.05, -0.05, -0.18], [0, 0, 0]);
  add(new THREE.TorusGeometry(0.05, 0.006, 4, 10), 0xa8b0b6, [-0.03, -0.05, -0.18]);
  return { group: g, segs };
}

export class Fishing {
  constructor({ player, world, ocean, fx, audio, survival, camera, ui, scene }) {
    this.player = player; this.world = world; this.ocean = ocean; this.fx = fx;
    this.audio = audio; this.survival = survival; this.camera = camera; this.ui = ui; this.scene = scene;
    this.rng = mulberry32(2048);
    this.state = 'idle';   // idle | charging | flying | waiting | bite | fight | caught
    this.power = 0;
    this.equipped = false;
    this.bait = 'none';
    this.log = {};                      // journal: species → {count, best}
    this.timer = 0;
    this.bobber = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3() };
    this.biteWindow = 0;
    this.fight = { tension: 0, distance: 0, maxDistance: 1, fish: null, tank: 100, runTimer: 0, run: 0, escape: 0 };
    this.lastCastResult = null;
    this.castAnim = 0;
    this.buildViewModel();
  }

  buildViewModel() {
    const rod = makeRodMesh();
    this.rod = rod.group;
    this.rodSegs = rod.segs;
    this.rod.visible = false;
    this.rod.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
    this.scene.add(this.rod);

    this.bobberMesh = new THREE.Group();
    const bmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 });
    const ball = new THREE.Mesh(colorGeo(new THREE.SphereGeometry(0.06, 10, 8), new THREE.Color(0xd8442c)), bmat);
    const top = new THREE.Mesh(colorGeo(new THREE.SphereGeometry(0.05, 10, 8), new THREE.Color(0xf2f2f2)), bmat);
    top.position.y = 0.035;
    const stick = new THREE.Mesh(colorGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 5), new THREE.Color(0xf2f2f2)), bmat);
    stick.position.y = 0.09;
    this.bobberMesh.add(ball, top, stick);
    this.bobberMesh.visible = false;
    this.scene.add(this.bobberMesh);

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xdfe6ea, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.scene.add(this.line);
  }

  get hasRod() { return this.survival.inv.count('rod') > 0; }

  equipRod() {
    if (!this.hasRod) { this.survival.onEvent({ type: 'message', text: 'You have no fishing rod. Craft or repair one (I · crafting).' }); return false; }
    this.equipped = true;
    this.rod.visible = true;
    this.survival.onEvent({ type: 'message', text: 'Rod ready. Hold LMB to charge a cast, release to throw.' });
    return true;
  }
  unequip() {
    this.equipped = false;
    this.state = 'idle';
    this.rod.visible = false;
    this.bobberMesh.visible = false;
    this.line.visible = false;
  }
  cycleBait() {
    const keys = Object.keys(BAITS);
    const i = (keys.indexOf(this.bait) + 1) % keys.length;
    const next = keys[i];
    if (next !== 'none' && this.survival.inv.count(next) === 0) { this.bait = 'none'; }
    else this.bait = next;
    this.survival.onEvent({ type: 'message', text: `Bait: ${BAITS[this.bait].name}` });
  }

  /** which water body is at a point */
  waterKind(x, z) {
    const w = this.world;
    if (w.lake && Math.hypot(x - w.lake.x, z - w.lake.z) < w.lake.r * 1.1) return 'lake';
    const coast = w.coastX(z);
    const off = coast - x;
    if (off < -4) return 'land';
    if (off < 120) return 'surf';
    if (off < 700) return 'sea';
    return 'deep';
  }

  /** cast the bobber toward the aim direction with `power` 0..1 */
  cast(power) {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const eye = this.player.eye;
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const dist = 6 + power * 26;
    const target = new THREE.Vector3(eye.x + flat.x * dist, 0, eye.z + flat.z * dist);
    const kind = this.waterKind(target.x, target.z);
    if (kind === 'land') {
      this.survival.onEvent({ type: 'message', text: 'You cast onto dry land. Aim at the water.' });
      this.state = 'idle';
      return false;
    }
    this.bobber.pos.copy(eye);
    this.bobber.pos.y += 0.3;
    const vy = 4.5 + power * 5.5;
    const flight = Math.max(0.4, (vy + Math.sqrt(Math.max(0, vy * vy + 2 * 21.5 * (this.bobber.pos.y + 20)))) / 21.5) * 0.55;
    this.bobber.vel.set(flat.x * (dist / Math.max(0.6, flight)), vy - 2.5, flat.z * (dist / Math.max(0.6, flight)));
    this.bobber.target.copy(target);
    this.state = 'flying';
    this.timer = 0;
    this.castAnim = 1;
    this.audio?.play('cast');
    this.waterAt = kind;
    return true;
  }

  chooseFish(kind, baitBonus) {
    let pool = Object.entries(FISH).filter(([, f]) => f.waters && f.waters.includes(kind));
    if (!pool.length) pool = Object.entries(FISH).filter(([, f]) => !f.junk);   // never crash on odd water
    // rarity-weighted pick (bait shifts toward bigger fish)
    let total = 0;
    const weights = pool.map(([, f]) => {
      let w = f.rarity;
      if (baitBonus > 0 && f.junk) w *= 0.45;
      if (baitBonus > 0 && f.w[1] > 1) w *= 1 + baitBonus;
      total += w;
      return w;
    });
    let r = this.rng() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i][1];
    }
    return pool[0][1];
  }

  startBite() {
    if (!this.waterAt) return;                     // nothing under the float (cast onto land)
    const bait = BAITS[this.bait];
    const f = this.chooseFish(this.waterAt, bait.sizeBonus);
    const weight = lerp(f.w[0], f.w[1], Math.pow(this.rng(), f.legendary ? 0.4 : 0.75));
    this.fight.fish = { ...f, weight: +weight.toFixed(2) };
    this.state = 'bite';
    this.biteWindow = 1.35;
    this.fx?.splash(this.bobber.pos.x, this.ocean.waterYAt(this.bobber.pos.x, this.bobber.pos.z), this.bobber.pos.z, 1.1);
    this.audio?.play(f.legendary ? 'legendaryBite' : 'bite');
    this.ui?.flash('bite');
  }

  strike() {
    if (this.state !== 'bite') return;
    const f = this.fight.fish;
    const startDist = 8 + f.fight * 9 + f.weight * 1.6;
    this.fight.distance = startDist;
    this.fight.maxDistance = startDist;
    this.fight.tension = 42;
    this.fight.run = 0;
    this.fight.runTimer = 1.5;
    this.state = 'fight';
    this.audio?.play('strike');
    this.survival.onEvent({ type: 'message', text: `Fish on! Something is pulling…` });
  }

  /** called every frame; `input` provides reel (LMB) and giveLine (RMB) */
  update(dt, input = {}) {
    const p = this.player;
    const eye = p.eye;
    // ---------- view model placement
    if (this.equipped && this.hasRod) {
      this.rod.visible = true;
      const yaw = p.yaw, pitch = p.pitch;
      const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const up = new THREE.Vector3(0, 1, 0);
      const base = eye.clone()
        .addScaledVector(fwd, 0.45)
        .addScaledVector(right, 0.30)
        .addScaledVector(up, -0.30);
      this.rod.position.copy(base);
      const castT = this.state === 'charging' ? -0.5 - this.power * 0.9 : 0;
      const fightT = this.state === 'fight' ? -0.35 - this.fight.tension * 0.012 : 0;
      this.rod.rotation.set(0, 0, 0);
      this.rod.quaternion.setFromEuler(new THREE.Euler(pitch + (castT + fightT) * 0.6, yaw + Math.PI / 2, 0.25 + (castT + fightT) * 0.35, 'YXZ'));
      // bend the blank
      const bend = clamp01(this.fight.tension / 100) * 0.55 + this.power * 0.25;
      this.rodSegs.forEach((s, i) => { s.rotation.x = Math.PI / 2 - bend * (i / this.rodSegs.length) * 1.4; });
      this.tipWorld = this.rodSegs[this.rodSegs.length - 1].localToWorld(new THREE.Vector3(0, 0.22, 0));
    } else if (this.rod) this.rod.visible = false;

    // ---------- state machine
    switch (this.state) {
      case 'idle': {
        if (this.equipped && this.hasRod && input.cast) { this.state = 'charging'; this.power = 0; this.audio?.play('charge'); }
        break;
      }
      case 'charging': {
        this.power = clamp01(this.power + dt * 0.85);
        if (!input.cast) {           // released → cast
          if (this.cast(this.power)) this.state = 'flying';
          else { this.state = 'idle'; this.power = 0; }
        }
        break;
      }
      case 'flying': {
        this.timer += dt;
        const b = this.bobber;
        b.vel.y -= 21.5 * dt;
        b.vel.multiplyScalar(1 - 0.06 * dt);
        b.pos.addScaledVector(b.vel, dt);
        const wl = this.ocean.waterYAt(b.pos.x, b.pos.z);
        const g = this.world.heightAt(b.pos.x, b.pos.z);
        if (b.pos.y <= wl && wl > g + 0.05) {
          this.state = 'waiting';
          this.timer = 0;
          this.biteDelay = (2.5 + this.rng() * 9) / (BAITS[this.bait].biteRate * (this.waterAt === 'deep' ? 0.85 : 1));
          this.fx?.splash(b.pos.x, wl, b.pos.z, 0.7);
          this.audio?.play('splash');
        } else if (b.pos.y <= g + 0.05) {
          this.state = 'idle'; this.power = 0;
          this.survival.onEvent({ type: 'message', text: 'The line came back to shore.' });
        }
        break;
      }
      case 'waiting': {
        this.timer += dt;
        const b = this.bobber;
        const wl = this.ocean.waterYAt(b.pos.x, b.pos.z);
        b.pos.y = damp(b.pos.y, wl + 0.02, 8, dt);
        // drift with the current / waves
        b.pos.x += Math.sin(this.timer * 0.7) * 0.06 * dt * 10;
        b.pos.z += Math.cos(this.timer * 0.5) * 0.06 * dt * 10;
        if (this.timer > this.biteDelay) {
          if (this.rng() < 0.55) this.startBite();
          else { this.timer = 0.6; this.nibble = 0.7; }   // nibble, no hook
        }
        if (input.cast) { this.reel(); }
        break;
      }
      case 'bite': {
        this.biteWindow -= dt;
        const b = this.bobber;
        b.pos.y -= dt * 0.55;
        this.fx?.bubbles(b.pos.x, b.pos.y, b.pos.z, 1);
        if (input.cast && input.strike) { this.strike(); break; }
        if (this.biteWindow <= 0) {
          this.survival.onEvent({ type: 'message', text: 'Too slow — the fish spat the hook.' });
          this.state = 'waiting';
          this.timer = 0;
          this.biteDelay = 4 + this.rng() * 8;
          this.audio?.play('miss');
        }
        break;
      }
      case 'fight': {
        const f = this.fight;
        const fish = f.fish;
        // fish runs in bursts
        f.runTimer -= dt;
        if (f.runTimer <= 0) {
          f.run = this.rng() < 0.45 ? (0.5 + this.rng() * 1.5) * fish.fight : 0;
          f.runTimer = 1.0 + this.rng() * 2.6;
        }
        const reel = input.cast && !input.giveLine;
        const give = input.giveLine;
        const pull = (fish.fight * fish.weight * 0.6 + f.run * 9) + (this.fight.run > 1.2 ? 6 : 0);
        let tensionDelta = 0;
        if (reel) tensionDelta += 34 + fish.fight * 8;
        if (give) tensionDelta -= 40;
        if (!reel && !give) tensionDelta -= 12;
        f.tension = clamp(f.tension + (tensionDelta + pull * (reel ? 1 : 0.35) - 16) * dt, 0, 130);
        // distance
        let distDelta = 0;
        if (reel) distDelta -= (2.6 + 1.6 / Math.max(0.3, fish.fight)) * dt * (f.tension < 88 ? 1 : 0.25);
        distDelta += (fish.fight * 0.7 + f.run * 2.4) * dt;
        f.distance = clamp(f.distance + distDelta, 0, f.maxDistance * 1.35);
        // bobber follows the fish a bit
        const b = this.bobber;
        const wl = this.ocean.waterYAt(b.pos.x, b.pos.z);
        const away = new THREE.Vector3(b.pos.x - eye.x, 0, b.pos.z - eye.z).normalize();
        const move = (reel ? -1.6 : 0.9 + f.run * 1.4) * dt;
        b.pos.addScaledVector(away, move);
        b.pos.y = wl + 0.02 - Math.min(0.25, f.tension / 400);
        if (this.fx && this.rng() < 0.3) this.fx.splash(b.pos.x, wl, b.pos.z, 0.35 + f.run * 0.2);
        // outcomes
        if (f.tension >= 100) {
          this.survival.onEvent({ type: 'message', text: 'SNAP! The line broke — the fish got away.' });
          this.audio?.play('snap');
          this.ui?.flash('bad');
          this.state = 'idle'; this.power = 0;
          break;
        }
        if (f.distance <= 0.15) this.land();
        break;
      }
      case 'caught': {
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'idle';
        break;
      }
      default: break;
    }

    // ---------- visual sync
    const showBobber = ['flying', 'waiting', 'bite', 'fight'].includes(this.state);
    this.bobberMesh.visible = showBobber;
    this.line.visible = showBobber && this.equipped;
    if (showBobber) {
      this.bobberMesh.position.copy(this.bobber.pos);
      this.bobberMesh.rotation.z = Math.sin(performance.now() * 0.004) * 0.15;
    }
    if (this.line.visible && this.tipWorld) {
      const pts = [];
      const a = this.tipWorld, b = this.bobber.pos;
      const sag = clamp(a.distanceTo(b) * 0.06, 0.05, 1.2) * (this.state === 'fight' ? 0.25 : 1);
      for (let i = 0; i <= 11; i++) {
        const t = i / 11;
        const pnt = new THREE.Vector3().lerpVectors(a, b, t);
        pnt.y -= Math.sin(t * Math.PI) * sag;
        pts.push(pnt);
      }
      const arr = this.line.geometry.attributes.position.array;
      pts.forEach((pp, i) => { arr[i * 3] = pp.x; arr[i * 3 + 1] = pp.y; arr[i * 3 + 2] = pp.z; });
      this.line.geometry.attributes.position.needsUpdate = true;
      this.line.geometry.computeBoundingSphere();
    }
    return this.state;
  }

  reel() {
    if (this.state === 'waiting') {
      this.survival.onEvent({ type: 'message', text: 'You reel the line back in.' });
      this.state = 'idle';
      this.power = 0;
    }
  }

  land() {
    const f = this.fight.fish;
    const inv = this.survival.inv;
    const gained = [];
    if (f.junk) {
      const item = f.item || (f.name === 'Old boot' ? 'cloth' : 'scrap');
      inv.add(item, 1);
      gained.push(item);
    } else {
      inv.add('fish_raw', 1);
      gained.push('fish_raw');
      if (f.weight > 3) inv.add('fish_raw', 1);
      if (f.legendary) { inv.add('water_clean', 2); }
    }
    const rec = this.log[f.name] || { count: 0, best: 0 };
    rec.count++;
    rec.best = Math.max(rec.best, f.weight);
    this.log[f.name] = rec;
    this.survival.stats.fishCaught++;
    this.state = 'caught';
    this.timer = 2.2;
    this.lastCatch = { ...f, gained };
    this.fx?.splash(this.bobber.pos.x, this.ocean.waterYAt(this.bobber.pos.x, this.bobber.pos.z), this.bobber.pos.z, 1.4);
    this.audio?.play(f.legendary ? 'legendary' : 'catch');
    this.survival.onEvent({
      type: 'catch',
      text: `${f.icon} ${f.name} — ${f.weight} kg`,
      fish: f,
    });
    this.ui?.celebrate(f);
  }

  /* UI state for the HUD */
  hud() {
    return {
      state: this.state,
      power: this.power,
      tension: this.fight.tension,
      distance: this.fight.distance,
      maxDistance: this.fight.maxDistance,
      fish: this.fight.fish,
      bait: BAITS[this.bait],
      lastCatch: this.lastCatch,
      log: this.log,
    };
  }
}
