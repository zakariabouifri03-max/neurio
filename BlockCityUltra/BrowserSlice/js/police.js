// BLOCK CITY ULTRA — browser slice: wanted level, dispatch and pursuit AI.
// Mirrors UBCUPoliceSubsystem: heat accumulates per crime, decays only when the
// police have lost sight of the player, and each wanted level has a dispatch
// profile. Original force, original livery, original radio barks.

import * as THREE from './three.module.js';
import { VEHICLES, WANTED, WANTED_THRESHOLDS, CRIME_HEAT } from './config.js';
import { Vehicle } from './vehicles.js';
import { clamp, dist2, angleDelta, lerp } from './util.js';

const BARKS = {
  approach: ['Stop the vehicle.', 'Pull over. Now.', 'Vault City PD — stop the car.'],
  close: ['Last warning. Get out of the car.', 'Hands where we can see them.'],
  lost: ['We lost them. Hold the perimeter.', 'Suspect is off camera. Search the block.'],
  arrest: ['Suspect in custody. Scene is clear.'],
  backup: ['Requesting backup, one is running.', 'Units responding to my location.'],
};

export class PoliceSystem {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;

    this.heat = 0;
    this.wantedLevel = 0;
    this.units = [];
    this.crimes = [];
    this.spotted = false;
    this.hidden = false;
    this.lastKnown = new THREE.Vector3();
    this.lastSeenTime = 0;
    this.dispatchTimer = 0;
    this.phase = 'none';      // none | responding | pursuit | searching | arrested | escaped
    this.barkTimer = 4;
    this.currentBark = null;
    this.searchAngle = 0;
    this.searchRadius = 30;
    this.timeSinceVisual = 0;
    this.escapeTimer = 0;
  }

  // ── Crime reporting ────────────────────────────────────────────────────────
  reportCrime(type, x, z, witnessed = true) {
    const heat = CRIME_HEAT[type] || 0;
    if (heat === 0) return;

    this.crimes.push({ type, x, z, t: performance.now() / 1000, heat, investigated: false });
    if (this.crimes.length > 64) this.crimes.shift();

    this.addHeat(heat * (witnessed ? 1 : 0.5));
  }

  addHeat(amount) {
    this.heat = clamp(this.heat + amount, 0, 1200);
    const newLevel = this.levelForHeat(this.heat);
    if (newLevel !== this.wantedLevel) {
      const old = this.wantedLevel;
      this.wantedLevel = newLevel;
      this.onWantedChanged?.(newLevel, old);
    }
  }

  levelForHeat(heat) {
    for (let l = 6; l >= 1; l--) if (heat >= WANTED_THRESHOLDS[l]) return l;
    return 0;
  }

  clear(arrested) {
    this.heat = 0;
    const old = this.wantedLevel;
    this.wantedLevel = 0;
    this.crimes.length = 0;
    this.phase = arrested ? 'arrested' : 'none';

    for (const u of this.units) u.standDown();
    // Give the units a moment to drive off before they are recycled.
    setTimeout(() => { this.#despawnAllUnits(); }, arrested ? 600 : 2500);

    if (arrested) this.onArrested?.(old);
    this.onWantedChanged?.(0, old);
  }

  #despawnAllUnits() {
    for (const u of this.units) {
      this.scene.remove(u.vehicle.mesh);
      u.dead = true;
    }
    this.units.length = 0;
  }

  enterHideout() { this.hidden = true; }
  leaveHideout() { this.hidden = false; }

  get closestPursuerDistance() {
    let best = Infinity;
    for (const u of this.units) {
      if (u.dead) continue;
      best = Math.min(best, u.distanceToPlayer || Infinity);
    }
    return best === Infinity ? -1 : best;
  }

  get pursuerLocations() {
    return this.units.filter(u => !u.dead).map(u => u.vehicle.position);
  }

  // ── Per-frame ──────────────────────────────────────────────────────────────
  update(dt, player, traffic) {
    this.#trackPlayer(dt, player);
    this.#decayHeat(dt);
    this.#expireCrimes();
    this.#dispatch(dt, player, traffic);
    this.#updateUnits(dt, player, traffic);
    this.#updatePhase(dt, player);
  }

  #trackPlayer(dt, player) {
    const pos = player.isDriving ? player.vehicle.position : player.position;

    // Line of sight: any unit within range with no building between it and the
    // player. The city's collider list is the occluder set.
    let visual = false;
    for (const u of this.units) {
      if (u.dead) continue;
      const d = dist2(u.vehicle.position.x, u.vehicle.position.z, pos.x, pos.z);
      u.distanceToPlayer = d;
      if (d > 170) { u.hasVisual = false; continue; }

      const clear = !this.city.isSegmentBlocked(u.vehicle.position.x, u.vehicle.position.z, pos.x, pos.z);
      u.hasVisual = clear && !this.hidden;
      if (u.hasVisual) { visual = true; break; }
    }

    this.spotted = visual;

    if (visual) {
      this.lastKnown.copy(pos);
      this.lastSeenTime = performance.now() / 1000;
      this.timeSinceVisual = 0;
    } else {
      this.timeSinceVisual += dt;
      // Predict forward from the last known position so the search covers where
      // the player is going, not just where they were.
      const v = player.isDriving ? player.vehicle.velocity : player.velocity;
      this.lastKnown.x += v.x * Math.min(dt, 0.1) * 6;
      this.lastKnown.z += v.z * Math.min(dt, 0.1) * 6;
    }
  }

  #decayHeat(dt) {
    if (this.heat <= 0) return;

    // The single rule that makes "lose the cops" a real loop: heat only decays
    // when no unit can see the player.
    const rate = this.spotted ? 0 : lerp(0.30, 0.06, this.wantedLevel / 6);
    if (rate > 0) {
      const multiplier = this.hidden ? 2.5 : 1.0;
      this.addHeat(-rate * dt * multiplier);
    }
  }

  #expireCrimes() {
    const now = performance.now() / 1000;
    this.crimes = this.crimes.filter(c => now - c.t < 45);
  }

  #dispatch(dt, player, traffic) {
    if (this.wantedLevel <= 0) { this.dispatchTimer = 0; return; }

    this.dispatchTimer += dt;
    const profile = WANTED[this.wantedLevel];
    const delay = profile.responseTime;

    if (this.dispatchTimer < delay) return;
    this.dispatchTimer = 0;

    const active = this.units.filter(u => !u.dead).length;
    if (active >= profile.units) return;

    this.#spawnUnit(player, profile);
  }

  #spawnUnit(player, profile) {
    const pos = player.isDriving ? player.vehicle.position : player.position;

    // Spawn off-camera: a ring around the player, biased towards behind so a
    // pursuit feels like it is catching up rather than materialising ahead.
    let sx = 0, sz = 0, attempts = 0;
    do {
      const angle = Math.random() * Math.PI * 2;
      const dist = lerp(55, 130, Math.min(1, this.wantedLevel / 5));
      sx = pos.x + Math.cos(angle) * dist;
      sz = pos.z + Math.sin(angle) * dist;
      attempts++;
    } while (this.city.isInsideBuilding(sx, sz, 1.4) && attempts < 24);

    if (this.city.isInsideBuilding(sx, sz, 1.4)) {
      // Fall back to a lane node.
      const nodes = this.city.laneNodes;
      if (nodes.length) {
        const n = nodes[(Math.random() * nodes.length) | 0];
        sx = n.x; sz = n.z;
      }
    }

    const def = VEHICLES.find(v => v.police) || VEHICLES[7];
    const vehicle = new Vehicle(def, this.city);
    vehicle.place(sx, sz, Math.atan2(pos.x - sx, pos.z - sz));
    vehicle.setHeadlights(true);

    const unit = {
      vehicle,
      dead: false,
      hasVisual: false,
      distanceToPlayer: Infinity,
      tactic: this.wantedLevel >= 4 ? 'ram' : this.wantedLevel >= 2 ? 'intercept' : 'follow',
      aggression: profile.aggression,
      ramCooldown: 0,
      searchAngle: Math.random() * Math.PI * 2,
      searchRadius: 30,
      standDown: () => { unit.standingDown = true; vehicle.setHeadlights(false); },
      standingDown: false,
    };

    vehicle.userData = { lightbar: true };
    vehicle.setHeadlights(true);

    this.scene.add(vehicle.mesh);
    this.units.push(unit);

    this.phase = this.wantedLevel >= 3 ? 'pursuit' : 'responding';
    this.currentBark = this.wantedLevel >= 3 ? BARKS.backup[0] : BARKS.approach[0];
    this.barkTimer = 3.5;
    this.onUnitSpawned?.(unit);
  }

  #updateUnits(dt, player, traffic) {
    const target = this.spotted
      ? (player.isDriving ? player.vehicle.position : player.position)
      : this.lastKnown;

    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.dead) { this.units.splice(i, 1); continue; }

      u.ramCooldown = Math.max(0, u.ramCooldown - dt);

      if (u.standingDown) {
        u.vehicle.throttle = 0;
        u.vehicle.brake = 0.5;
        u.vehicle.steerInput = 0;
        u.vehicle.handbrake = false;
        u.vehicle.update(dt);

        // Recycle once stopped and far away.
        if (u.vehicle.speedKmh < 3 && u.distanceToPlayer > 120) {
          this.scene.remove(u.vehicle.mesh);
          u.dead = true;
          this.units.splice(i, 1);
        }
        continue;
      }

      if (this.wantedLevel <= 0) { u.standDown(); continue; }

      // Choose a tactic from range, wanted level and the player's speed.
      const d = u.distanceToPlayer;
      const playerSpeed = player.isDriving ? player.vehicle.speedKmh : player.speedKmh;

      if (this.spotted) {
        if (this.wantedLevel >= 4 && d < 26 && u.ramCooldown <= 0) u.tactic = 'ram';
        else if (this.wantedLevel >= 3 && d > 60 && playerSpeed > 90) u.tactic = 'box';
        else if (d > 32) u.tactic = 'intercept';
        else u.tactic = u.aggression > 1.0 && d < 16 ? 'ram' : 'follow';
      } else {
        u.tactic = 'search';
      }

      this.#driveUnit(u, dt, target, player, traffic);
      u.vehicle.update(dt);

      // Lightbar strobe.
      const ud = u.vehicle.mesh.userData;
      if (ud.lightbar) {
        const phase = (performance.now() * 0.007) % 2;
        ud.lightbar.userData.a.material.emissiveIntensity = phase < 1 ? 6 : 0;
        ud.lightbar.userData.b.material.emissiveIntensity = phase < 1 ? 0 : 6;
      }

      // Arrest: close, slow, and seen.
      if (this.spotted && d < 4.5 && playerSpeed < 9) {
        this.reportCrime('evasion', target.x, target.z, true);
        this.arrest(player);
        return;
      }

      // Despawn a unit that searched its whole grid and found nothing.
      if (!this.spotted && this.timeSinceVisual > 45) u.standDown();

      // A unit too far behind is recycled so the budget goes to fresh units.
      if (d > 300) {
        this.scene.remove(u.vehicle.mesh);
        u.dead = true;
        this.units.splice(i, 1);
      }
    }
  }

  #driveUnit(u, dt, target, player, traffic) {
    const v = u.vehicle;
    const pos = v.position;

    let aimX = target.x, aimZ = target.z;

    if (u.tactic === 'intercept') {
      // Lead the target: aim at where it will be, not where it is.
      const pv = player.isDriving ? player.vehicle.velocity : player.velocity;
      const lead = clamp(pos.distanceTo(target) / Math.max(6, v.speedKmh / 3.6), 0, 2.6);
      aimX += pv.x * lead;
      aimZ += pv.z * lead;
    } else if (u.tactic === 'box') {
      // Get ahead and offset to one side, to cut across the player's path.
      const pv = player.isDriving ? player.vehicle.velocity : player.velocity;
      const len = Math.hypot(pv.x, pv.z) || 1;
      aimX = target.x + (pv.x / len) * 70 - (pv.z / len) * 8;
      aimZ = target.z + (pv.z / len) * 70 + (pv.x / len) * 8;
    } else if (u.tactic === 'search') {
      // Spiral search around the last known position. The radius grows at a
      // constant rate so the sweep is evenly spaced — and beatable by staying
      // still inside an already-searched ring.
      u.searchRadius = Math.min(u.searchRadius + 11 * dt, 120);
      u.searchAngle += (14 / Math.max(18, u.searchRadius)) * dt * 57.3 * 0.06;
      aimX = this.lastKnown.x + Math.cos(u.searchAngle) * u.searchRadius;
      aimZ = this.lastKnown.z + Math.sin(u.searchAngle) * u.searchRadius;
      if (u.searchRadius >= 120) { u.searchRadius = 22; u.searchAngle = Math.random() * Math.PI * 2; }
    }

    const dx = aimX - pos.x, dz = aimZ - pos.z;
    const distance = Math.hypot(dx, dz);
    const desiredYaw = Math.atan2(dx, dz);
    const yawError = clamp(angleDelta(v.yaw, desiredYaw) / 0.55, -1, 1);

    // Desired speed by tactic and wanted level.
    let desiredKmh = u.tactic === 'search' ? 62
      : u.tactic === 'ram' ? 165
      : u.tactic === 'box' ? 140
      : lerp(78, 190, this.wantedLevel / 6);
    desiredKmh *= lerp(0.85, 1.25, u.aggression);

    // Slow for corners.
    desiredKmh *= 1 - Math.min(1, Math.abs(yawError)) * 0.52;

    // Obstacle avoidance: never drive through traffic or buildings.
    let blocking = 0;
    const probe = clamp(4 + v.speedKmh / 3.6 * 1.2, 4, 24);
    const ax = pos.x + Math.sin(v.yaw) * probe, az = pos.z + Math.cos(v.yaw) * probe;

    for (const other of traffic.vehicles) {
      if (other === v) continue;
      const od = dist2(ax, az, other.position.x, other.position.z);
      if (od < 3.6) {
        const rx = other.position.x - pos.x, rz = other.position.z - pos.z;
        if (rx * Math.sin(v.yaw) + rz * Math.cos(v.yaw) > 0) blocking = Math.max(blocking, 1 - od / 3.6);
      }
    }

    if (this.city.isInsideBuilding(ax, az, 1.2)) blocking = 1;

    if (blocking > 0.1 && u.tactic !== 'ram') {
      v.throttle = 0;
      v.brake = clamp(blocking * 1.5, 0, 1);
      v.steerInput = clamp(-yawError + 0.45 * Math.sign(yawError || 1), -1, 1);
    } else {
      const speedError = (desiredKmh / 3.6 - v.speed) / Math.max(1, desiredKmh / 3.6);
      v.throttle = clamp(speedError * 2.4, -0.3, 1);
      v.brake = v.speedKmh > desiredKmh * 1.3 ? clamp(-speedError * 1.8, 0, 0.9) : 0;
      v.steerInput = clamp(-yawError, -1, 1);
    }

    // Ramming: close hard and accept the damage.
    if (u.tactic === 'ram' && distance < 9) {
      v.throttle = 1;
      v.brake = 0;
      if (distance < 4.5) u.ramCooldown = 2.4;
    }

    v.handbrake = false;

    // Barks, throttled so it is not constant.
    this.barkTimer -= dt;
    if (this.barkTimer <= 0 && this.spotted) {
      this.barkTimer = 5 + Math.random() * 8;
      const set = distance < 12 ? BARKS.close : BARKS.approach;
      this.currentBark = set[(Math.random() * set.length) | 0];
      this.onBark?.(this.currentBark);
    } else if (this.barkTimer <= 0 && !this.spotted && this.wantedLevel > 0) {
      this.barkTimer = 9 + Math.random() * 8;
      this.currentBark = BARKS.lost[(Math.random() * BARKS.lost.length) | 0];
      this.onBark?.(this.currentBark);
    }
  }

  #updatePhase(dt, player) {
    if (this.wantedLevel <= 0) {
      if (this.phase !== 'none' && this.phase !== 'arrested') {
        this.phase = 'escaped';
        this.escapeTimer = 4;
        this.onEscaped?.();
      }
      if (this.phase === 'escaped') {
        this.escapeTimer -= dt;
        if (this.escapeTimer <= 0) this.phase = 'none';
      }
      return;
    }

    if (this.phase === 'arrested') { this.phase = 'none'; return; }

    const activeUnits = this.units.filter(u => !u.dead && !u.standingDown).length;
    if (activeUnits === 0) { this.phase = 'none'; return; }

    if (this.spotted) {
      const newPhase = this.wantedLevel >= 3 ? 'pursuit' : 'responding';
      if (newPhase !== this.phase) { this.phase = newPhase; this.onPhaseChanged?.(newPhase); }
    } else if (this.timeSinceVisual > 5 && this.phase === 'pursuit') {
      this.phase = 'searching';
      this.onPhaseChanged?.('searching');
      this.currentBark = BARKS.lost[(Math.random() * BARKS.lost.length) | 0];
      this.onBark?.(this.currentBark);
    }
  }

  arrest(player) {
    this.phase = 'arrested';
    this.currentBark = BARKS.arrest[0];
    this.onBark?.(this.currentBark);
    this.clear(true);
  }

  get activeUnitCount() { return this.units.filter(u => !u.dead).length; }
}
