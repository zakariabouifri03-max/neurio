// BLOCK CITY ULTRA — missions (browser vertical slice)
// Mirrors Gameplay/BCUMissionSystem.cpp: a data-driven objective list with a
// small state machine (GoTo -> EnterVehicle -> DriveTo -> EscapePolice).
// All content is original: original names, original fiction, original district.

import * as THREE from '../vendor/three.module.js';
import { findPath } from './city.js';

export const MISSIONS = [
  {
    id: 'MSN_FIRST_LIGHT',
    title: 'First Light',
    synopsis: 'Vero wants a car moved across Midtown before the morning rush. Clean, quick, no heat.',
    type: 'Story',
    district: 'Downtown',
    reward: { credits: 4500, respect: 10, unlockVehicle: 'MuscleCar' },
    objectives: [
      { type: 'GoTo', title: 'Meet Vero at the Foundry Lot', radius: 9, hint: 'Drive to the marker in the industrial block.' },
      { type: 'EnterVehicle', title: 'Take the Courier Sedan', radius: 8, hint: 'Walk up to the marked car and press F.' },
      { type: 'DriveTo', title: 'Deliver the package to Halcyon Heights', radius: 11, hint: 'Follow the GPS ribbon. Avoid the cops.' },
      { type: 'EscapePolice', title: 'Lose any heat', radius: 0, hint: 'Break line of sight and stay out of it.' },
    ],
  },
  {
    id: 'MSN_NIGHT_RUN',
    title: 'Night Run',
    synopsis: 'A midnight sprint across the grid. Five checkpoints, one clock, zero excuses.',
    type: 'Race',
    district: 'Commercial',
    reward: { credits: 9000, respect: 25 },
    objectives: [
      { type: 'GoTo', title: 'Checkpoint 1 — Pier Nine', radius: 10, hint: '' },
      { type: 'GoTo', title: 'Checkpoint 2 — Kessel Underpass', radius: 10, hint: '' },
      { type: 'GoTo', title: 'Checkpoint 3 — Halcyon Overlook', radius: 10, hint: '' },
      { type: 'GoTo', title: 'Finish — Vantage Point', radius: 12, hint: '' },
    ],
  },
  {
    id: 'MSN_SIDE_COFFEE',
    title: 'Beans & Bullets',
    synopsis: 'Deliver four crates of very legitimate coffee to four very legitimate businesses.',
    type: 'Delivery',
    district: 'Commercial',
    reward: { credits: 2400, respect: 5 },
    objectives: [
      { type: 'GoTo', title: 'Pick up the crates', radius: 9, hint: '' },
      { type: 'GoTo', title: 'Drop 1 — Kessel Diner', radius: 9, hint: '' },
      { type: 'GoTo', title: 'Drop 2 — Vantage Gym', radius: 9, hint: '' },
      { type: 'GoTo', title: 'Drop 3 — Foundry Roasters', radius: 9, hint: '' },
    ],
  },
];

export class MissionSystem {
  constructor(scene, roads, layout) {
    this.scene = scene;
    this.roads = roads;
    this.layout = layout;
    this.defs = MISSIONS;
    this.active = null;
    this.index = 0;
    this.state = 'Idle';       // Idle | Active | Complete | Failed
    this.elapsed = 0;
    this.marker = null;
    this.route = null;
    this.completed = new Set();
    this.onObjectiveChanged = null;
    this.onComplete = null;
    this.onFail = null;
    this.escapeTimer = 0;

    this._buildMarker();
  }

  _buildMarker() {
    // Rotating voxel beacon: a light column + a ring of cubes + a chevron.
    const group = new THREE.Group();
    group.name = 'MissionMarker';

    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd24a, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    column.position.y = 13;
    group.add(column);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd24a, emissive: 0xffb020, emissiveIntensity: 2.2, roughness: 0.4,
    });
    const ringGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = new THREE.Mesh(ringGeo, ringMat);
      c.position.set(Math.cos(a) * 4.2, 0.5 + Math.sin(i * 1.7) * 0.25, Math.sin(a) * 4.2);
      group.add(c);
    }
    const chevron = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 2.4), ringMat);
    chevron.position.y = 7.5;
    group.add(chevron);

    group.visible = false;
    this.marker = group;
    this.markerRing = ringMat;
    this.scene.add(group);
  }

  updateMarker(dt, time) {
    const m = this.marker;
    if (!m) return;
    if (this.state !== 'Active' || !this.active) { m.visible = false; return; }
    const loc = this.locationFor(this.objective);
    m.visible = true;
    m.position.set(loc.x, 0, loc.z);
    m.rotation.y = time * 1.1;
    if (this.markerRing) {
      this.markerRing.emissiveIntensity = 1.6 + Math.sin(time * 4) * 0.8;
    }
    // keep the light column standing on the ground whatever the marker height
    m.children[1] && (m.children[1].position.y = 7.5 + Math.sin(time * 3) * 0.6);
  }

  start(id) {
    const def = this.defs.find(m => m.id === id);
    if (!def) return false;
    this.active = def;
    this.index = 0;
    this.state = 'Active';
    this.elapsed = 0;
    this._objStart = 0;
    if (this.onObjectiveChanged) this.onObjectiveChanged(def, 0);
    return true;
  }

  get objective() {
    return this.active ? this.active.objectives[this.index] : null;
  }

  advance() {
    this.index++;
    if (this.index >= this.active.objectives.length) {
      this.state = 'Complete';
      this.completed.add(this.active.id);
      if (this.onComplete) this.onComplete(this.active);
      this.active = null;
      this.route = null;
      return;
    }
    this.route = null;
    this._objStart = this.elapsed;
    if (this.onObjectiveChanged) this.onObjectiveChanged(this.active, this.index);
  }

  fail(reason) {
    this.state = 'Failed';
    if (this.onFail) this.onFail(this.active, reason);
    // Failed missions return to Available (mirrors the C++ behaviour).
    this.state = 'Idle';
    this.index = 0;
    this.active = null;
    this.route = null;
  }

  /** Pick a world location for the current objective (stable per objective). */
  locationFor(obj) {
    if (!this._locs) this._locs = new Map();
    const key = this.active.id + ':' + this.index;
    if (this._locs.has(key)) return this._locs.get(key);

    const nodes = this.roads.nodes;
    // deterministic-ish placement: spread objectives around the district
    const seedBase = this.active.id.length * 37 + this.index * 911;
    const n = nodes[Math.floor(((Math.sin(seedBase) * 0.5 + 0.5) * nodes.length)) % nodes.length];
    const loc = { x: n.x, z: n.z };
    this._locs.set(key, loc);
    return loc;
  }

  update(dt, ctx) {
    if (this.state !== 'Active' || !this.active) return;
    this.elapsed += dt;

    const obj = this.objective;
    const loc = this.locationFor(obj);

    // keep a GPS route to the current objective (re-planned every 4 s)
    this.routeTimer = (this.routeTimer ?? 0) + dt;
    if ((!this.route || this.routeTimer > 4) && (obj.type === 'GoTo' || obj.type === 'DriveTo')) {
      const path = findPath(this.roads, { x: ctx.player.x, z: ctx.player.y }, { x: loc.x, z: loc.z });
      if (path) { this.route = path.map(n => ({ x: n.x, z: n.z })); }
      this.routeTimer = 0;
    }

    switch (obj.type) {
      case 'GoTo': {
        const inVehicle = ctx.inVehicle;
        if (!inVehicle && Math.hypot(ctx.player.x - loc.x, ctx.player.y - loc.z) < obj.radius) this.advance();
        else if (inVehicle && Math.hypot(ctx.player.x - loc.x, ctx.player.y - loc.z) < obj.radius + 5) this.advance();
        break;
      }
      case 'EnterVehicle':
        if (ctx.inVehicle) this.advance();
        break;
      case 'DriveTo':
        if (ctx.inVehicle && Math.hypot(ctx.player.x - loc.x, ctx.player.y - loc.z) < obj.radius) this.advance();
        break;
      case 'EscapePolice':
        // give the player a beat to read the objective before it clears
        if (ctx.wanted.heat === 0 && (this.elapsed - this._objStart) > 2.5) this.advance();
        break;
    }
  }
}
