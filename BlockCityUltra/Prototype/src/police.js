// BLOCK CITY ULTRA — police AI + wanted system (browser vertical slice)
//
// Mirrors AI/BCUWantedComponent.cpp and AI/BCUPoliceSystem.cpp:
// heat accumulates from witnessed crimes, decays when unseen, and drives the
// search radius, unit count and unit composition. Behaviour ladder:
//   Patrol -> Investigate -> SearchGrid -> Pursue -> Ram/Arrest -> ReturnToPatrol

import * as THREE from '../vendor/three.module.js';
import { VehicleBody, buildVehicleMesh } from './vehicle.js';
import { clamp, angDiff, damp, rng as makeRng } from './util.js';

export const WANTED_TABLE = [
  { level: 0, heat: 0,  units: 0,  search: 0,    label: '' },
  { level: 1, heat: 8,  units: 1,  search: 250,  label: '★' },
  { level: 2, heat: 24, units: 2,  search: 450,  label: '★★' },
  { level: 3, heat: 46, units: 4,  search: 700,  label: '★★★' },
  { level: 4, heat: 68, units: 7,  search: 1000, label: '★★★★' },
  { level: 5, heat: 90, units: 12, search: 1600, label: '★★★★★' },
];

export const CRIME_HEAT = {
  Speeding: 6, RecklessDriving: 10, PropertyDamage: 14, Trespassing: 12,
  HitAndRun: 26, Theft: 34, EscapingCustody: 30, Brandishing: 48,
  Assault: 55, Murder: 100,
};

export class WantedSystem {
  constructor() {
    this.heat = 0;
    this.level = 0;
    this.spotted = false;
    this.timeSinceSeen = 0;
    this.lastKnown = new THREE.Vector2(0, 0);
    this.busted = 0;
    this.bounty = 0;
    this.onChange = null;
  }

  report(crime, witnessed = true, at = { x: 0, z: 0 }) {
    const base = CRIME_HEAT[crime] ?? 0;
    const heat = base * (witnessed ? 1 : 0.25);
    if (heat <= 0) return;
    this.heat = Math.min(100, this.heat + heat);
    this.lastKnown.set(at.x, at.z);
    this.bounty += heat * 25;
    if (witnessed) { this.spotted = true; this.timeSinceSeen = 0; }
    this._recompute();
  }

  setSpotted(v, at) {
    this.spotted = v;
    if (v) { this.timeSinceSeen = 0; if (at) this.lastKnown.set(at.x, at.z); }
  }

  clear() {
    const old = this.level;
    this.heat = 0; this.level = 0; this.spotted = false; this.timeSinceSeen = 0;
    if (old !== 0 && this.onChange) this.onChange(0, old);
  }

  escape() {
    const old = this.level;
    this.heat *= 0.4;
    this.spotted = false;
    this._recompute();
    if (this.level !== old && this.onChange) this.onChange(this.level, old);
  }

  update(dt) {
    if (this.level === 0 && this.heat <= 0) return;
    if (this.spotted) {
      this.timeSinceSeen += dt;
      if (this.timeSinceSeen > 8) this.spotted = false;   // lost visual
    } else {
      this.heat = Math.max(0, this.heat - dt * 1.6);
    }
    this._recompute();
  }

  _recompute() {
    let lvl = 0;
    if (this.heat >= 90) lvl = 5;
    else if (this.heat >= 68) lvl = 4;
    else if (this.heat >= 46) lvl = 3;
    else if (this.heat >= 24) lvl = 2;
    else if (this.heat >= 8) lvl = 1;
    if (lvl !== this.level) {
      const old = this.level;
      this.level = lvl;
      if (this.onChange) this.onChange(lvl, old);
    }
  }

  get searchRadius() { return WANTED_TABLE[this.level]?.search ?? 0; }
  get stars() { return WANTED_TABLE[this.level]?.label ?? ''; }
}

// ---------------------------------------------------------------------------
export class PoliceSystem {
  constructor(scene, roads) {
    this.scene = scene;
    this.roads = roads;
    this.units = [];
    this.group = new THREE.Group();
    this.group.name = 'Police';
    scene.add(this.group);
    this.maxUnits = 14;
    this.giveUpTime = 45;
    this.giveUpTimer = 0;
    this.rng = makeRng(31337);
    this.lastBustCheck = 0;
  }

  _randNode() { const n = this.roads.nodes; return n[Math.floor(this.rng.f() * n.length)]; }

  spawn(rank = 1, at = null) {
    const node = at ? this._nearest(at.x, at.z) : this._randNode();
    const body = new VehicleBody('PoliceCruiser', node.x, node.z, 0);
    const built = buildVehicleMesh('PoliceCruiser', { color: 0xf2f2f2 });
    this.group.add(built.group);

    const unit = {
      body, mesh: built.group, rank,
      behaviour: 'Patrol',
      from: node, to: this._randNode(),
      search: new THREE.Vector2(node.x, node.z),
      searchTimer: 0,
      dist: 9999,
      sirenPhase: this.rng.r(0, Math.PI * 2),
      lights: built.lights,
    };
    this.units.push(unit);
    return unit;
  }

  _nearest(x, z) {
    let best = this.roads.nodes[0], bd = Infinity;
    for (const n of this.roads.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  onWantedChanged(level, wantedLastKnown) {
    const desired = Math.min(this.maxUnits, level * 3);
    while (this.units.length < desired) this.spawn(level >= 3 ? 3 : level >= 2 ? 2 : 1);
    for (const u of this.units) {
      if (u.behaviour === 'Patrol' || u.behaviour === 'ReturnToPatrol') {
        u.behaviour = level > 0 ? 'Investigate' : 'Patrol';
      }
    }
    this.giveUpTimer = 0;
    this._assignSearch(wantedLastKnown, WANTED_TABLE[level]?.search ?? 400);
  }

  _assignSearch(lastKnown, radius = 400) {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      const bearing = (i / Math.max(1, this.units.length)) * Math.PI * 2;
      const r = (radius ?? 400) * 0.75;
      u.search.set(
        (lastKnown?.x ?? u.search.x) + Math.cos(bearing) * r,
        (lastKnown?.y ?? u.search.y) + Math.sin(bearing) * r
      );
      u.to = this._nearest(u.search.x, u.search.y);
      u.searchTimer = 0;
    }
  }

  dispatch(x, z) {
    for (const u of this.units) {
      if (u.behaviour === 'Patrol' || u.behaviour === 'ReturnToPatrol') {
        u.behaviour = 'Investigate';
        u.search.set(x, z);
        u.searchTimer = 0;
      }
    }
  }

  update(dt, player, wanted, time) {
    // ---- give-up ---------------------------------------------------------------
    if (wanted.level > 0) {
      if (!wanted.spotted) this.giveUpTimer += dt; else this.giveUpTimer = 0;
      if (this.giveUpTimer > this.giveUpTime) {
        wanted.escape();
        for (const u of this.units) u.behaviour = 'ReturnToPatrol';
        this.giveUpTimer = 0;
      }
    }

    for (const u of this.units) {
      const b = u.body;
      u.dist = Math.hypot(b.pos.x - player.x, b.pos.y - player.z);

      // ---- behaviour selection --------------------------------------------------
      if (wanted.level === 0) {
        if (u.behaviour === 'Pursue' || u.behaviour === 'SearchGrid') u.behaviour = 'ReturnToPatrol';
      } else if (wanted.spotted && u.dist < 130) u.behaviour = 'Pursue';
      else if (wanted.spotted) { u.behaviour = 'Investigate'; u.search.copy(wanted.lastKnown); }
      else u.behaviour = 'SearchGrid';

      // ---- goal -------------------------------------------------------------------
      let gx, gz;
      if (u.behaviour === 'Pursue') {
        // aim slightly ahead of the player when very close -> PIT manoeuvre
        const lead = u.dist < 25 ? 12 : 0;
        gx = player.x + Math.sin(player.heading) * lead;
        gz = player.y + Math.cos(player.heading) * lead;
        if (u.dist < 14) u.behaviour = 'Arrest';
      } else if (u.behaviour === 'Investigate' || u.behaviour === 'SearchGrid') {
        gx = u.search.x; gz = u.search.y;
        u.searchTimer += dt;
        if (u.searchTimer > (u.behaviour === 'Investigate' ? 20 : 35)) {
          u.searchTimer = 0;
          this._assignSearch(wanted.lastKnown, wanted.searchRadius);
        }
      } else {
        gx = u.to.x; gz = u.to.z;
        if (Math.hypot(b.pos.x - gx, b.pos.y - gz) < 12) {
          u.from = u.to;
          u.to = this._randNode();
        }
      }

      // ---- drive -------------------------------------------------------------------
      const desired = Math.atan2(gx - b.pos.x, gz - b.pos.y);
      const diff = angDiff(b.heading, desired);
      b.steer = clamp(diff * 1.6, -1, 1);
      const targetKph = (u.behaviour === 'Pursue' || u.behaviour === 'Investigate') ? 46 : 20;
      const target = targetKph / 3.6;
      b.throttle = b.speed < target ? 0.85 : 0.15;
      b.brake = b.speed > target * 1.15 ? 0.5 : 0;
      b.step(dt, null);

      if (u.mesh) {
        u.mesh.position.set(b.pos.x, 0, b.pos.y);
        u.mesh.rotation.y = b.heading;
      }

      // ---- siren lights --------------------------------------------------------------
      const responding = u.behaviour === 'Pursue' || u.behaviour === 'Investigate' || u.behaviour === 'Arrest';
      if (u.lights) {
        const flash = Math.sin(time * 9 + u.sirenPhase) > 0 ? 1 : 0;
        for (const l of u.lights) {
          if (!l.material) continue;
          l.material.emissiveIntensity = responding ? (flash * 6) : 0.4;
          if (responding) {
            l.material.emissive.setHex(flash ? 0x2244ff : 0xff2222);
          }
        }
      }
    }

    // ---- bust check ------------------------------------------------------------------
    return this._tryArrest(player);
  }

  _tryArrest(player) {
    for (const u of this.units) {
      if (u.behaviour !== 'Arrest') continue;
      if (u.dist < 9 && player.speed < 5) return true;
    }
    return false;
  }

  stats() {
    return {
      units: this.units.length,
      pursuing: this.units.filter(u => u.behaviour === 'Pursue').length,
      searching: this.units.filter(u => u.behaviour === 'SearchGrid').length,
    };
  }
}
