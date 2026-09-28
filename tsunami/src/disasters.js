// disasters.js — the tsunami sequence plus aftershocks, landslides, storms and fires
import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, rand, pick, mulberry32, TAU, colorGeo, Shake } from './util.js';

export class Disasters {
  constructor({ world, ocean, fx, audio, sky, npc, vehicles, survival, ui, scene, mats, quality = 'high' }) {
    this.world = world; this.ocean = ocean; this.fx = fx; this.audio = audio; this.sky = sky;
    this.npc = npc; this.vehicles = vehicles; this.survival = survival; this.ui = ui; this.scene = scene;
    this.mats = mats || {};
    this.quality = quality;
    this.rng = mulberry32(112358);
    this.shake = new Shake();
    this.tsunami = null;
    this.storm = { active: false, t: 0, duration: 0, intensity: 0, hail: false, hailTimer: 0, strikeTimer: 4 };
    this.fires = [];
    this.rocks = [];
    this.debris = [];
    this.cracks = [];
    this.aftershockQueue = [];
    this.onEvent = () => {};
    this.debrisGroup = new THREE.Group(); this.debrisGroup.name = 'debris'; scene.add(this.debrisGroup);
    this.rockGroup = new THREE.Group(); this.rockGroup.name = 'rocks'; scene.add(this.rockGroup);
    this.crackGroup = new THREE.Group(); this.crackGroup.name = 'cracks'; scene.add(this.crackGroup);
    this.pebbleGroup = new THREE.Group(); this.pebbleGroup.name = 'pebbles'; scene.add(this.pebbleGroup);
    this._m4 = new THREE.Matrix4();
    this.time = 0;
  }

  /* ============================================================= tsunami */
  startTsunami(opts = {}) {
    if (this.tsunami && this.tsunami.active) return;
    const beach = this.world.beachCenter || { x: 0, z: -150 };
    const t = {
      active: true, phase: 'drawback', t: 0, fronts: [], flood: false, destruction: 0,
      maxLevel: opts.height ?? 16.5, destroyedCount: 0, hitShore: false, sirens: 0, warned: false,
      origin: { x: this.world.coastX(beach.z) - 1750, z: beach.z }, beach,
      direction: opts.direction || { x: 1, z: 0.05 },
    };
    this.tsunami = t;
    this.ocean.setWaveHeight(1.0);
    this.ocean.clearFronts();
    this.sky.setWeather(0.62);
    this.audio?.play('siren');
    this.audio?.play('rumble');
    this.ui?.chapter('THE SEA PULLS BACK', 'Run inland — a tsunami is coming');
    this.onEvent({ type: 'tsunami-start' });
    if (this.npc) this.npc.scare(beach.x + 30, beach.z, 900);
    return t;
  }

  get tsunamiPhase() { return this.tsunami ? this.tsunami.phase : 'none'; }
  get floodLevel() { return this.ocean.level; }

  updateTsunami(dt) {
    const t = this.tsunami;
    if (!t || !t.active) return;
    t.t += dt;
    const ocean = this.ocean;
    switch (t.phase) {
      case 'drawback': {
        // the sea withdraws, exposing the seabed
        ocean.setLevel(-7.2);
        ocean.setWaveHeight(0.55);
        ocean.setFoam(0);
        if (t.t > 3 && t.sirens < 4 && t.t % 4 < dt) { this.audio?.play('siren'); t.sirens++; }
        if (!t.warned && t.t > 3.5) {
          t.warned = true;
          this.ui?.chapter('TSUNAMI!', 'Get to high ground — NOW');
          this.onEvent({ type: 'tsunami-warning' });
        }
        if (t.t > 11) {
          t.phase = 'wave';
          t.t = 0;
          const dir = t.direction;
          const H = 13.5;
          const first = ocean.spawnFront({
            x: t.origin.x, z: t.origin.z, dirX: dir.x, dirZ: dir.z,
            height: H, speed: 78, lead: 40, trail: 300,
          });
          t.fronts.push(first);
          t.heroFront = first;
          this.audio?.play('rumble');
          this.ui?.chapter('WAVE 1 of 3', 'Do not stand on the beach');
          this.onEvent({ type: 'wave-incoming', front: 1 });
        }
        break;
      }
      case 'wave': {
        ocean.setWaveHeight(1.2);
        // extra front waves for drama
        if (t.fronts.length === 1 && t.t > 3.5) {
          t.fronts.push(ocean.spawnFront({ x: t.origin.x - 320, z: t.origin.z + 60, dirX: t.direction.x, dirZ: t.direction.z, height: 19.5, speed: 82, lead: 46, trail: 340 }));
          this.ui?.chapter('WAVE 2', '');
        }
        if (t.fronts.length === 2 && t.t > 7) {
          t.fronts.push(ocean.spawnFront({ x: t.origin.x - 260, z: t.origin.z - 120, dirX: t.direction.x, dirZ: t.direction.z, height: 24, speed: 88, lead: 52, trail: 380 }));
          this.ui?.chapter('WAVE 3', 'The big one');
          this.audio?.play('rumble');
        }
        // spray as the crest approaches the shore
        const f = t.heroFront;
        if (f && f.alive) {
          const coast = this.world.coastX(f.z);
          const dist = Math.abs(f.x - coast);
          if (dist < 240) {
            const n = dist < 90 ? 5 : 2;
            for (let i = 0; i < n; i++) {
              const zz = f.z + (this.rng() - 0.5) * 700;
              this.fx?.waveSpray(f.x + (this.rng() - 0.5) * 90, this.ocean.waterYAt(f.x, zz) + f.height * 0.4, zz, f.height / 9);
            }
          }
          if (!t.hitShore && f.x > coast - 30) this.onShoreHit(t);
        }
        if (t.hitShore && t.t > 15) { t.phase = 'flood'; t.t = 0; }
        break;
      }
      case 'flood': {
        ocean.setLevel(t.maxLevel);
        ocean.setWaveHeight(1.9);
        ocean.setFoam(0.55);
        // the outflow: everything between the shore and the flood edge is churned whitewater
        const inland = this.world.coastX(t.beach.z) + lerp(0, 900, clamp01(t.t / 40));
        this.destroyAlongCoast(inland);
        // debris + cars lifted
        if (t.t % 0.4 < dt) this.spawnFloatingDebris(inland);
        if (t.t > 46 && !t.spread) {
          t.spread = true;
          this.ui?.chapter('THE TOWN IS UNDER WATER', 'Find the road up the mountain');
          this.onEvent({ type: 'city-flooded' });
        }
        if (t.t > 62) {
          t.phase = 'drain'; t.t = 0;
          const freed = this.vehicles?.unstickAll?.() || 0;
          if (freed) this.ui?.message(`${freed} car(s) dug out of the rubble`, 4);
        }
        break;
      }
      case 'drain': {
        ocean.setLevel(2.2);
        ocean.setWaveHeight(1.1);
        ocean.setFoam(0.28);
        ocean.setCurrent(-0.94, -0.34, 4.6);
        if (t.t > 26 && !t.draining) {
          t.draining = true;
          this.ui?.chapter('THE WATER RETREATS', 'The town is wrecked — head for the mountain');
          this.sky.setWeather(0.3);
          this.onEvent({ type: 'flood-drain' });
          // aftermath fires in the harbour
          const h = this.world.harbor;
          this.igniteFire(this.world.coastX(h.z) + 40, h.z - 20, 1.0);
          this.igniteFire(this.world.coastX(h.z) + 60, h.z + 30, 0.7);
        }
        if (t.t > 70) { t.phase = 'aftermath'; t.t = 0; }
        break;
      }
      case 'aftermath': {
        ocean.setFoam(0.1);
        ocean.setCurrent(0, 0, 0);
        if (t.t % 8 < dt) this.vehicles?.unstickAll?.();   // keep the escape car usable
        if (t.t > 8) {
          t.active = false;
          this.ocean.setLevel(0.35);
          this.onEvent({ type: 'tsunami-over' });
          this.queueAftershocks();
        }
        break;
      }
      default: break;
    }
    // shake on the big waves
    const f = t.heroFront;
    if (f && f.alive && t.phase === 'wave') {
      const coast = this.world.coastX(f.z);
      const d = Math.abs(f.x - coast);
      if (d < 300) this.shake.add(clamp01(1 - d / 300) * 0.35);
    }
  }

  onShoreHit(t) {
    t.hitShore = true;
    t.fronts.forEach((f) => { f.speed *= 0.55; });
    this.audio?.play('waveHit');
    this.shake.add(1.0);
    this.ui?.flash('quake');
    this.onEvent({ type: 'shore-hit' });
    const beach = t.beach;
    for (let i = 0; i < 24; i++) {
      const z = beach.z + (this.rng() - 0.5) * 900;
      const x = this.world.coastX(z) + (this.rng() - 0.5) * 60;
      this.fx?.waveSpray(x, this.ocean.waterYAt(x, z) + 6, z, 2.2);
    }
  }

  destroyAlongCoast(inlandX) {
    const t = this.tsunami;
    const list = this.world.destructibles || [];
    for (const d of list) {
      if (d.state !== 'standing') continue;
      if (d.spec.x > inlandX) continue;
      if (this.ocean.waterYAt(d.spec.x, d.spec.z) < this.world.heightAt(d.spec.x, d.spec.z) + 0.6) continue;
      d.state = 'collapsing';
      d.t = 0;
      d.dir = this.rng() < 0.5 ? 1 : -1;
      t.destroyedCount++;
      this.audio?.play('rockfall', { position: [d.spec.x, d.spec.y, d.spec.z] });
      this.shake.add(0.25);
    }
  }

  updateCollapsing(dt) {
    const list = this.world.destructibles || [];
    for (const d of list) {
      if (d.state === 'collapsing') {
        d.t += dt;
        const k = clamp01(d.t / 2.6);
        const ease = k * k * (3 - 2 * k);
        const maxA = 0.85;
        d.group.rotation.z = d.dir * maxA * ease;
        d.group.rotation.x = (d.dir * 0.25) * ease;
        d.group.position.y = -ease * ease * d.spec.floors * 1.1;
        d.group.updateMatrixWorld();
        if (k > 0.35 && !d.dustDone) {
          d.dustDone = true;
          this.fx?.dustBurst(d.spec.x, d.spec.y + 1.5, d.spec.z, 3.2, [0.68, 0.62, 0.54]);
          this.fx?.debrisBurst(d.spec.x, d.spec.y + 2, d.spec.z, 18, [0.55, 0.5, 0.45]);
        }
        if (k >= 1) {
          d.state = 'rubble';
          if (d.collider) {
            const i = this.world.colliders.indexOf(d.collider);
            if (i >= 0) this.world.colliders.splice(i, 1);
          }
          this.spawnRubble(d.spec);
          d.group.visible = false;
        }
      }
    }
  }

  spawnRubble(spec) {
    if (!this.mats.rock) return;
    const g = [];
    const n = 5 + ((this.rng() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const w = rand(this.rng, 1.2, 3.2), h = rand(this.rng, 0.4, 1.6), d = rand(this.rng, 1.2, 3.0);
      const geo = colorGeo(new THREE.BoxGeometry(w, h, d), new THREE.Color().setHSL(0.08, 0.1, 0.36 + this.rng() * 0.12));
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(this.rng() * TAU).setPosition(
        spec.x + rand(this.rng, -spec.w * 0.6, spec.w * 0.6),
        this.world.heightAt(spec.x, spec.z) + h * 0.5 + this.rng() * 0.6,
        spec.z + rand(this.rng, -spec.d * 0.6, spec.d * 0.6)));
      g.push(geo);
    }
    const merged = g.length ? this._merge(g) : null;
    if (merged) {
      const mesh = new THREE.Mesh(merged, this.mats.rock);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.debrisGroup.add(mesh);
      this.world.colliders.push({ cx: spec.x, cz: spec.z, hx: spec.w * 0.55, hz: spec.d * 0.55, rot: spec.rot, y0: this.world.heightAt(spec.x, spec.z), y1: this.world.heightAt(spec.x, spec.z) + 1.1, kind: 'rubble' });
    }
  }

  _merge(geos) {
    const pos = [], nrm = [], uv = [], col = [], idx = [];
    let base = 0;
    for (const g of geos) {
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      const u = g.attributes.uv ? g.attributes.uv.array : new Float32Array(p.length / 3 * 2);
      const c = g.attributes.color ? g.attributes.color.array : new Float32Array(p.length);
      for (let i = 0; i < p.length; i++) pos.push(p[i]);
      for (let i = 0; i < n.length; i++) nrm.push(n[i]);
      for (let i = 0; i < u.length; i++) uv.push(u[i]);
      for (let i = 0; i < c.length; i++) col.push(c[i]);
      const gi = g.index ? g.index.array : null;
      if (gi) for (let i = 0; i < gi.length; i++) idx.push(gi[i] + base);
      else for (let i = 0; i < p.length / 3; i++) idx.push(i + base);
      base += p.length / 3;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setIndex(idx);
    return out;
  }

  spawnFloatingDebris(inlandX) {
    if (this.debris.length > (this.quality === 'low' ? 30 : 70)) return;
    const rng = this.rng;
    const z = this.world.coastX(this.tsunami.beach.z) * 0 + lerp(-700, 500, rng());
    const x = lerp(this.world.coastX(z) - 200, inlandX, rng());
    if (this.ocean.waterYAt(x, z) < this.world.heightAt(x, z) + 0.3) return;
    const geo = colorGeo(new THREE.BoxGeometry(rand(rng, 0.4, 2.2), rand(rng, 0.15, 0.5), rand(rng, 0.4, 2.6)),
      new THREE.Color().setHSL(0.09, 0.25, 0.3 + rng() * 0.3));
    const mesh = new THREE.Mesh(geo, this.mats.wood || this.mats.plaster || new THREE.MeshStandardMaterial());
    mesh.position.set(x, this.ocean.waterYAt(x, z) + 0.1, z);
    mesh.castShadow = true;
    this.debrisGroup.add(mesh);
    this.debris.push({ mesh, x, z, rot: rng() * TAU, spin: (rng() - 0.5) * 0.6, life: 240 });
    if (rng() < 0.12) {
      // a car gets lifted
      const v = this.vehicles?.vehicles.find((vv) => !vv.occupied && vv.kind === 'car' && Math.hypot(vv.pos.x - x, vv.pos.z - z) < 40);
      if (v) { v.floatage = 0.2; v.vel.set(this.ocean.current.x * 2, 0, this.ocean.current.z * 2); }
    }
  }

  updateDebris(dt) {
    const cur = this.ocean.current;
    for (const d of this.debris) {
      d.life -= dt;
      const wy = this.ocean.waterYAt(d.x, d.z);
      d.mesh.position.set(d.x, wy + 0.06, d.z);
      d.rot += d.spin * dt;
      d.mesh.rotation.set(Math.sin(d.rot * 1.7) * 0.2, d.rot, Math.cos(d.rot * 1.3) * 0.15);
      d.x += (cur.x * cur.speed * 0.8 + Math.sin(d.rot) * 0.2) * dt;
      d.z += (cur.z * cur.speed * 0.8 + Math.cos(d.rot) * 0.2) * dt;
      if (d.life < 0 || wy < this.world.heightAt(d.x, d.z) - 0.4) { d.mesh.visible = false; }
    }
    this.debris = this.debris.filter((d) => d.life > 0);
  }

  /* ======================================================== aftershocks */
  queueAftershocks() {
    this.aftershockQueue = [];
    const base = this.time + 25;
    for (let i = 0; i < 4; i++) {
      this.aftershockQueue.push({ t: base + i * (48 + this.rng() * 40), mag: 0.28 + this.rng() * 0.56, fired: false });
    }
  }

  aftershock(mag = 0.6, opts = {}) {
    this.shake.add(mag);
    this.audio?.play('quake');
    this.ui?.flash('quake');
    this.ui?.message('AFTERSHOCK — ' + (mag > 0.7 ? 'strong' : 'moderate'), 2.6);
    // cracks in the ground near the player
    const p = opts.at || (this.playerRef ? this.playerRef.pos : { x: 0, z: 0 });
    for (let i = 0; i < 3; i++) this.spawnCrack(p.x + rand(this.rng, -40, 40), p.z + rand(this.rng, -40, 40), 6 + this.rng() * 16);
    // knock things over
    if (this.npc) {
      for (const a of this.npc.animals) if (a.alive && this.rng() < 0.3 * mag) { a.state = 'flee'; a.fleeT = 6; }
    }
    // dislodge rocks on steep slopes
    for (let i = 0; i < (mag > 0.6 ? 8 : 3); i++) {
      const x = rand(this.rng, 380, 1250), z = rand(this.rng, -900, 900);
      if (this.world.slopeAt(x, z) > 0.42 && this.world.heightAt(x, z) > 60) this.spawnFallingRock(x, z);
    }
    this.onEvent({ type: 'aftershock', mag });
  }

  spawnCrack(x, z, len = 10) {
    if (this.cracks.length > 60) return;
    const y = this.world.heightAt(x, z);
    const rot = this.rng() * TAU;
    const geo = new THREE.PlaneGeometry(len, rand(this.rng, 0.5, 1.6));
    const mesh = new THREE.Mesh(colorGeo(geo, new THREE.Color(0x14100c)), this.mats.dirt || this.mats.rock);
    mesh.rotation.set(-Math.PI / 2, 0, rot);
    mesh.position.set(x, y + 0.06, z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.crackGroup.add(mesh);
    this.cracks.push(mesh);
  }

  /* ========================================================== landslide */
  spawnFallingRock(x, z, size = 1) {
    const r = rand(this.rng, 0.5, 1.8) * size;
    const geo = colorGeo(new THREE.DodecahedronGeometry(r, 0), new THREE.Color().setHSL(0.08, 0.08, 0.34 + this.rng() * 0.14));
    const mesh = new THREE.Mesh(geo, this.mats.rockPlain || this.mats.rock);
    mesh.castShadow = true;
    const y = this.world.heightAt(x, z);
    mesh.position.set(x, y + r, z);
    this.rockGroup.add(mesh);
    this.rocks.push({ mesh, x, y: y + r, z, vx: rand(this.rng, -2, 2), vy: 0, vz: rand(this.rng, -2, 2), r, life: 30, settled: false, spin: this.rng() * TAU });
    this.audio?.play('rockfall', { position: [x, y, z] });
    this.fx?.dustBurst(x, y + 1, z, 2, [0.62, 0.58, 0.5]);
    return this.rocks[this.rocks.length - 1];
  }

  landslide(x, z, count = 12) {
    this.ui?.message('LANDSLIDE!', 3.2);
    this.audio?.play('rockfall');
    this.audio?.play('rumble');
    this.shake.add(0.85);
    const rocks = [];
    for (let i = 0; i < count; i++) {
      rocks.push(this.spawnFallingRock(x + rand(this.rng, -18, 18), z + rand(this.rng, -18, 18), rand(this.rng, 0.8, 2.3)));
    }
    this.onEvent({ type: 'landslide', x, z });
    return rocks;
  }

  updateRocks(dt) {
    for (const r of this.rocks) {
      if (r.settled) continue;
      r.vy -= 19 * dt;
      // roll downhill: follow the terrain gradient
      const n = this.world.normalAt(r.x, r.z, 1.5);
      r.vx += n.x * 16 * dt; r.vz += n.z * 16 * dt;
      r.vx *= 1 - 0.6 * dt; r.vz *= 1 - 0.6 * dt;
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      const g = this.world.heightAt(r.x, r.z) + r.r;
      if (r.y <= g) {
        r.y = g;
        r.vy *= -0.22;
        r.vx *= 0.72; r.vz *= 0.72;
        if (Math.abs(r.vy) < 1.4 && Math.hypot(r.vx, r.vz) < 1.6) {
          r.settled = true;
          this.world.colliders.push({ cx: r.x, cz: r.z, hx: r.r, hz: r.r, rot: 0, y0: r.y - r.r, y1: r.y + r.r * 0.8, kind: 'boulder' });
        }
        if (this.rng() < 0.4) this.fx?.dustBurst(r.x, r.y, r.z, 0.6, [0.6, 0.56, 0.48]);
      }
      const oce = this.ocean.waterYAt(r.x, r.z);
      if (r.y < oce) { r.settled = true; this.fx?.splash(r.x, oce, r.z, 1.2); }
      r.spin += dt * 2.4;
      r.mesh.position.set(r.x, r.y, r.z);
      r.mesh.rotation.set(r.spin, r.spin * 0.7, r.spin * 1.3);
      r.life -= dt;
      if (r.life < 0) { r.mesh.visible = false; }
    }
  }

  /* ============================================================== storm */
  startStorm(duration = 180, intensity = 1) {
    this.storm.active = true;
    this.storm.t = 0;
    this.storm.duration = duration;
    this.storm.intensity = clamp01(intensity);
    this.sky.setWeather(clamp01(0.75 * intensity + 0.25));
    this.ui?.chapter('STORM FRONT', 'Find shelter before you get soaked');
    this.onEvent({ type: 'storm-start' });
  }

  updateStorm(dt) {
    const s = this.storm;
    if (!s.active) return;
    s.t += dt;
    const k = s.t < 12 ? s.t / 12 : (s.t > s.duration - 20 ? clamp01((s.duration - s.t) / 20) : 1);
    this.fx?.setRain(k * s.intensity);
    this.ocean.setWaveHeight(0.75 + k * 1.35 * s.intensity);
    this.ocean.setStorm(k * 0.9 * s.intensity);
    // lightning + thunder
    s.strikeTimer -= dt;
    if (s.strikeTimer <= 0) {
      s.strikeTimer = 6 + this.rng() * 22;
      const near = this.rng() < 0.3;
      this.audio?.play('thunder', { near });
      this.sky.flash = 1;
      this.shake.add(near ? 0.32 : 0.12);
    }
    // hail
    if (s.intensity > 0.6 && this.rng() < dt * 0.05) {
      s.hailTimer = 3 + this.rng() * 4;
    }
    if (s.hailTimer > 0) {
      s.hailTimer -= dt;
      const p = this.playerRef ? this.playerRef.pos : { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 4; i++) {
        this.fx?.spray.emit(p.x + rand(this.rng, -14, 14), p.y + 14, p.z + rand(this.rng, -14, 14),
          rand(this.rng, -1, 1), -16, rand(this.rng, -1, 1),
          { life: 1.1, size: 0.3, sizeEnd: 0.3, color: [0.88, 0.93, 1.0], alpha: 0.85, alphaEnd: 0.3, drag: 0 });
      }
    }
    // rain puts out fires
    for (const f of this.fires) f.intensity = Math.max(0, f.intensity - dt * 0.03 * k);
    if (s.t > s.duration) {
      s.active = false;
      this.fx?.setRain(0);
      this.sky.setWeather(0.25);
      this.ocean.setWaveHeight(0.8);
      this.ocean.setStorm(0.15);
      this.ui?.message('The storm passes.', 3);
      this.onEvent({ type: 'storm-end' });
    }
  }

  /* =============================================================== fire */
  igniteFire(x, z, intensity = 1) {
    const y = this.world.heightAt(x, z);
    const light = new THREE.PointLight(0xff7a2a, 3 * intensity, 24, 2);
    light.position.set(x, y + 1.6, z);
    this.scene.add(light);
    const f = { x, y, z, intensity, fuel: 60 + this.rng() * 120, light, t: 0, spread: 0 };
    this.fires.push(f);
    return f;
  }

  updateFires(dt) {
    const p = this.playerRef;
    for (const f of this.fires.slice()) {
      f.t += dt;
      f.fuel -= dt * (0.55 + f.intensity * 0.5);
      const flick = 0.7 + Math.sin(f.t * 11.3) * 0.18 + Math.sin(f.t * 5.7) * 0.12;
      f.light.intensity = 3.2 * f.intensity * flick;
      const flames = Math.round(2 + f.intensity * 3);
      if (Math.random() < 0.9) this.fx?.fireAt(f.x, f.y + 0.7, f.z, flames);
      if (Math.random() < 0.5) this.fx?.smoke(f.x, f.y + 1.4, f.z, 2, [0.22, 0.2, 0.19]);
      // spread
      f.spread += dt;
      if (f.spread > 14 && f.intensity > 0.4 && this.fires.length < 12 && this.rng() < 0.5) {
        f.spread = 0;
        const nx = f.x + rand(this.rng, -26, 26), nz = f.z + rand(this.rng, -26, 26);
        if (this.world.heightAt(nx, nz) > 2) this.igniteFire(nx, nz, f.intensity * 0.6);
      }
      // damage nearby player
      if (p && Math.hypot(p.pos.x - f.x, p.pos.z - f.z) < 3.2) {
        p.damage(dt * 12 * f.intensity, 'fire');
        if (Math.random() < dt * 2) this.audio?.play('fire');
      }
      if (f.fuel <= 0) { f.intensity = Math.max(0, f.intensity - dt * 0.06); }
      if (f.intensity <= 0.02 && f.fuel <= 0) {
        this.scene.remove(f.light);
        this.fires.splice(this.fires.indexOf(f), 1);
      }
    }
  }

  extinguishAt(x, z, radius = 6) {
    let n = 0;
    for (const f of this.fires) {
      if (Math.hypot(f.x - x, f.z - z) < radius) { f.intensity = Math.max(0, f.intensity - 0.55); n++; this.fx?.smoke(f.x, f.y + 1, f.z, 3, [0.8, 0.8, 0.8]); }
    }
    return n;
  }

  /* ============================================================ update */
  update(dt, refs = {}) {
    this.time += dt;
    if (refs.player) this.playerRef = refs.player;
    this.updateTsunami(dt);
    this.updateCollapsing(dt);
    this.updateDebris(dt);
    this.updateRocks(dt);
    this.updateStorm(dt);
    this.updateFires(dt);
    // queued aftershocks
    for (const a of this.aftershockQueue) {
      if (!a.fired && this.time > a.t) {
        a.fired = true;
        this.aftershock(a.mag, { at: refs.player ? refs.player.pos : null });
      }
    }
    const sh = this.shake.update(dt);
    this.lastShake = sh;
    return sh;
  }
}
