// BLOCK CITY ULTRA — browser slice: the vertical-slice mission chain.
// All missions, characters, factions and dialogue are original.

import * as THREE from './three.module.js';
import { buildBoxMesh } from './mesher.js';
import { clamp, dist2, lerp } from './util.js';

/** The slice's three missions, in order. Mirrors Tools/data/missions.csv. */
export const MISSIONS = [
  {
    id: 'slice_delivery',
    title: 'COLD CHAIN RUN',
    giver: 'Mara Kessel',
    district: 'IRONSIDE DOCKS',
    briefing: 'A refrigerated crate has to cross the docks before the shift change. Nobody asks what is in it.',
    rewardCash: 1800,
    rewardRep: 220,
    parSeconds: 240,
    timeBonus: 600,
    objectives: [
      { type: 'goto', text: 'Drive to the cold store on Pier 9', radius: 9 },
      { type: 'collect', text: 'Load the crate', radius: 4 },
      { type: 'deliver', text: 'Deliver the crate to the Neon Mile garage', radius: 9 },
      { type: 'evade', text: 'Shake off any police response', seconds: 6 },
    ],
  },
  {
    id: 'slice_race',
    title: 'NEON MILE SPRINT',
    giver: 'Dex Oyelaran',
    district: 'NEON MILE',
    briefing: 'Three laps of the Mile against drivers who know every kerb. Six checkpoints, one timer.',
    rewardCash: 2400,
    rewardRep: 300,
    parSeconds: 180,
    timeBonus: 800,
    objectives: [
      { type: 'route', text: 'Hit all six checkpoints', count: 6, radius: 10, timeLimit: 210 },
      { type: 'speed', text: 'Reach 180 km/h on the arterial', kmh: 180 },
    ],
  },
  {
    id: 'slice_heist',
    title: 'VAULT OF FOUNDRY HEIGHTS',
    giver: 'Silas Vane',
    district: 'FOUNDRY HEIGHTS',
    briefing: 'A five-minute window, a storm overhead, and a strongroom eleven floors down. Four bonds, then we are all strangers.',
    rewardCash: 9500,
    rewardRep: 900,
    parSeconds: 600,
    timeBonus: 3000,
    forcedWanted: 3,
    objectives: [
      { type: 'goto', text: 'Reach the service entrance on Kestrel Avenue', radius: 10 },
      { type: 'collect', text: 'Take the four bearer bonds', radius: 5, count: 4 },
      { type: 'deliver', text: 'Get to the Rowan Park safehouse', radius: 10 },
      { type: 'evade', text: 'Lose the police and reach the safehouse', seconds: 8 },
    ],
  },
];

/** A world-space objective marker: a rotating ring plus a light column. */
export function buildMarker(color = 0xffc93c) {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.28, 6, 24),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, roughness: 0.4 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.6;
  group.add(ring);

  // A tall, faint column so the marker is readable from a distance and through
  // the skyline — the single most important navigational cue in an open world.
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.9, 90, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false })
  );
  column.position.y = 45;
  group.add(column);

  group.userData = { ring, column };
  return group;
}

/** A pickup crate: a small emissive voxel box. */
export function buildPickup(color = 0x35d6ff) {
  const mesh = buildBoxMesh([{ x: -0.5, y: 0, z: -0.5, w: 1.0, h: 1.0, d: 1.0 }], color, 0.5, 0.1);
  mesh.material.emissive = new THREE.Color(color);
  mesh.material.emissiveIntensity = 0.7;
  mesh.castShadow = true;
  return mesh;
}

/**
 * Mission runner. Owns the active mission, its markers and pickups, and the
 * pass/fail decision. Mirrors UBCUMissionSubsystem.
 */
export class MissionSystem {
  constructor(scene, city, police, traffic) {
    this.scene = scene;
    this.city = city;
    this.police = police;
    this.traffic = traffic;

    this.completed = new Set();
    this.active = null;
    this.objectiveIndex = 0;
    this.progress = 0;
    this.elapsed = 0;
    this.objectiveElapsed = 0;
    this.cleanTimer = 0;

    this.markers = [];
    this.pickups = [];
    this.target = null;      // current objective's world target
    this.radius = 0;
  }

  get isAvailable() { return !this.active; }
  get nextMission() { return MISSIONS.find(m => !this.completed.has(m.id)); }
  get currentObjective() { return this.active?.objectives[this.objectiveIndex] || null; }

  /** Starts the next mission in the chain. */
  start(index = -1) {
    const def = index >= 0 ? MISSIONS[index] : this.nextMission;
    if (!def || this.active) return false;

    this.active = def;
    this.objectiveIndex = 0;
    this.progress = 0;
    this.elapsed = 0;
    this.objectiveElapsed = 0;
    this.cleanTimer = 0;

    this.#spawnObjective();
    this.onStarted?.(def);

    // A heist starts with the police already looking for you.
    if (def.forcedWanted) {
      this.police.addHeat(160);
      this.police.reportCrime('heist', this.target.x, this.target.z, true);
    }

    return true;
  }

  /** Places the marker / pickups for the current objective. */
  #spawnObjective() {
    this.#clearMarkers();

    const obj = this.currentObjective;
    if (!obj) return;

    const rngPoints = this.#objectivePoints(obj);

    if (obj.type === 'collect' && obj.count > 1) {
      // Multiple pickups scattered near the target.
      for (let i = 0; i < obj.count; i++) {
        const p = rngPoints[i % rngPoints.length];
        const mesh = buildPickup();
        mesh.position.set(p.x + (i - obj.count / 2) * 2.4, 0.9, p.z + ((i * 7) % 5) - 2);
        this.scene.add(mesh);
        this.pickups.push({ mesh, x: mesh.position.x, z: mesh.position.z, taken: false });
      }
      this.target = { x: this.pickups[0].x, z: this.pickups[0].z };
      this.radius = obj.radius * 3;
    } else {
      const p = rngPoints[0];
      this.target = { x: p.x, z: p.z };
      this.radius = obj.radius;

      const marker = buildMarker(obj.type === 'deliver' ? 0x3ddc84 : 0xffc93c);
      marker.position.set(p.x, 0.3, p.z);
      this.scene.add(marker);
      this.markers.push(marker);

      if (obj.type === 'collect') {
        const crate = buildPickup();
        crate.position.set(p.x, 0.9, p.z);
        this.scene.add(crate);
        this.pickups.push({ mesh: crate, x: p.x, z: p.z, taken: false });
      }
    }

    if (obj.type === 'route') {
      // A race: all checkpoints at once, in order.
      this.checkpoints = rngPoints.slice(0, obj.count).map((p, i) => ({ ...p, index: i }));
      this.nextCheckpoint = 0;
      for (const cp of this.checkpoints) {
        const marker = buildMarker(0x35d6ff);
        marker.position.set(cp.x, 0.3, cp.z);
        marker.scale.setScalar(0.8);
        this.scene.add(marker);
        this.markers.push(marker);
      }
      this.target = this.checkpoints[0];
      this.radius = obj.radius;
    }

    this.onObjectiveChanged?.(obj, this.objectiveIndex);
  }

  /** Picks world positions appropriate to the objective type. */
  #objectivePoints(obj) {
    const def = this.active;
    const buildings = this.city.buildings;
    const districtName = def.district;

    // Prefer buildings in the mission's district so the job actually takes you
    // somewhere, rather than spawning next to the player.
    const districtIndex = { 'IRONSIDE DOCKS': 4, 'NEON MILE': 2, 'FOUNDRY HEIGHTS': 0, 'ROWAN PARK': 3 }[districtName] ?? 0;
    const inDistrict = buildings.filter(b => b.district === districtIndex);
    const pool = inDistrict.length > 3 ? inDistrict : buildings;

    const playerPos = this.#playerPos();

    if (obj.type === 'route') {
      // Checkpoints form a loop around the district, alternating sides of the
      // street grid so the route uses the roads rather than cutting corners.
      const points = [];
      const count = obj.count || 6;
      const cx = pool.length ? pool.reduce((s, b) => s + b.x, 0) / pool.length : 0;
      const cz = pool.length ? pool.reduce((s, b) => s + b.z, 0) / pool.length : 0;
      const radius = 70;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const x = cx + Math.cos(a) * radius;
        const z = cz + Math.sin(a) * radius;
        points.push(this.#snapToStreet(x, z));
      }
      return points;
    }

    // Everything else: one point, at least 90 m from the player so the objective
    // is a drive rather than a step.
    for (let attempt = 0; attempt < 60; attempt++) {
      const b = pool[(Math.random() * pool.length) | 0];
      const x = b.x + b.w / 2 + (Math.random() - 0.5) * 12;
      const z = b.z + b.d + 3 + Math.random() * 6;
      const snapped = this.#snapToStreet(x, z);
      if (dist2(snapped.x, snapped.z, playerPos.x, playerPos.z) > 90) return [snapped];
    }

    return [this.#snapToStreet(playerPos.x + 120, playerPos.z + 120)];
  }

  /** Moves a point off a building footprint and onto the nearest street. */
  #snapToStreet(x, z) {
    if (!this.city.isInsideBuilding(x, z, 2.2)) return { x, z };

    // Walk outward in a spiral until we are clear.
    for (let r = 3; r < 60; r += 2.5) {
      for (let a = 0; a < Math.PI * 2; a += 0.4) {
        const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
        if (!this.city.isInsideBuilding(tx, tz, 2.6)) return { x: tx, z: tz };
      }
    }
    return { x, z };
  }

  #playerPos() {
    return window.__bcuPlayer
      ? (window.__bcuPlayer.isDriving ? window.__bcuPlayer.vehicle.position : window.__bcuPlayer.position)
      : new THREE.Vector3();
  }

  #clearMarkers() {
    for (const m of this.markers) this.scene.remove(m);
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.markers.length = 0;
    this.pickups.length = 0;
  }

  update(dt) {
    if (!this.active) return;

    this.elapsed += dt;
    this.objectiveElapsed += dt;

    const obj = this.currentObjective;
    if (!obj) { this.#complete(); return; }

    // Objective time limit.
    if (obj.timeLimit && this.objectiveElapsed > obj.timeLimit) {
      this.fail('Out of time.');
      return;
    }

    // Animate markers and pickups.
    const t = performance.now() * 0.001;
    for (const m of this.markers) {
      if (m.userData.ring) m.userData.ring.rotation.z = t * 1.4;
      m.position.y = 0.3 + Math.sin(t * 2) * 0.12;
    }
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.mesh.rotation.y = t * 1.6;
      p.mesh.position.y = 0.9 + Math.sin(t * 2.4) * 0.16;
    }

    const pos = this.#playerPos();

    switch (obj.type) {
      case 'goto':
      case 'deliver': {
        if (this.target && dist2(pos.x, pos.z, this.target.x, this.target.z) < obj.radius) {
          this.#advance();
        }
        break;
      }

      case 'collect': {
        // Pick up every crate in range.
        let allTaken = true;
        for (const p of this.pickups) {
          if (p.taken) continue;
          if (dist2(pos.x, pos.z, p.x, p.z) < obj.radius) {
            p.taken = true;
            p.mesh.visible = false;
            this.progress++;
            this.onProgress?.(this.progress, obj.count || 1);
          } else {
            allTaken = false;
            // Retarget the marker at the nearest remaining crate.
            this.target = { x: p.x, z: p.z };
          }
        }
        if (allTaken || this.progress >= (obj.count || 1)) this.#advance();
        break;
      }

      case 'route': {
        const cp = this.checkpoints?.[this.nextCheckpoint];
        if (cp) {
          this.target = cp;
          if (dist2(pos.x, pos.z, cp.x, cp.z) < obj.radius) {
            this.nextCheckpoint++;
            this.progress = this.nextCheckpoint;
            this.onProgress?.(this.progress, obj.count);
            if (this.markers[cp.index]) this.markers[cp.index].visible = false;
            if (this.nextCheckpoint >= obj.count) this.#advance();
          }
        }
        break;
      }

      case 'speed': {
        const kmh = window.__bcuPlayer?.isDriving ? window.__bcuPlayer.vehicle.speedKmh : 0;
        if (kmh >= obj.kmh) this.#advance();
        break;
      }

      case 'evade': {
        // Success when the wanted level has dropped to zero and stayed there.
        if (this.police.wantedLevel <= 0) {
          this.cleanTimer += dt;
          if (this.cleanTimer >= obj.seconds) this.#advance();
        } else {
          this.cleanTimer = 0;
        }
        break;
      }
    }
  }

  #advance() {
    this.objectiveIndex++;
    this.objectiveElapsed = 0;
    this.progress = 0;
    this.cleanTimer = 0;

    if (this.objectiveIndex >= this.active.objectives.length) {
      this.#complete();
    } else {
      this.#spawnObjective();
    }
  }

  #complete() {
    const def = this.active;
    this.completed.add(def.id);

    let cash = def.rewardCash;
    let bonus = [];

    if (def.parSeconds && this.elapsed <= def.parSeconds) {
      cash += def.timeBonus;
      bonus.push('time bonus');
    }

    this.#clearMarkers();
    this.active = null;
    this.onCompleted?.(def, cash, this.elapsed, bonus);
  }

  fail(reason) {
    const def = this.active;
    this.#clearMarkers();
    this.active = null;
    this.onFailed?.(def, reason);
  }

  abandon() {
    if (!this.active) return;
    this.#clearMarkers();
    this.active = null;
  }

  /** Distance to the current objective marker, in metres. */
  get distanceToTarget() {
    if (!this.target) return -1;
    const p = this.#playerPos();
    return Math.hypot(p.x - this.target.x, p.z - this.target.z);
  }

  /** Direction to the target in player-local space, for the minimap arrow. */
  get bearingToTarget() {
    if (!this.target) return null;
    const p = this.#playerPos();
    return { dx: this.target.x - p.x, dz: this.target.z - p.z };
  }

  get objectiveCount() { return this.active ? this.active.objectives.length : 0; }
}
