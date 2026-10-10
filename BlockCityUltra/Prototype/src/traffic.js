// BLOCK CITY ULTRA — traffic + pedestrians (browser vertical slice)
//
// Mirrors the engine's three-tier approach:
//   * near  -> full VehicleBody physics + mesh
//   * mid   -> physics, simplified (no collision resolution vs props)
//   * far   -> "road ghosts": analytic motion along the graph, instanced mesh
// Only visible agents own a THREE.Group; everything else is data.

import * as THREE from '../vendor/three.module.js';
import { VehicleBody, buildVehicleMesh } from './vehicle.js';
import { rng, clamp, angDiff, damp } from './util.js';

const CITY_CARS = ['Sedan', 'CompactCar', 'SUV', 'Van', 'PickupTruck', 'Bus', 'MuscleCar'];
const CAR_COLORS = [0x2a5fd6, 0xc9302c, 0x2e7d32, 0xeeeeee, 0x222222, 0xb8860b, 0x6a1b9a, 0xdcdcdc, 0x1a1a1a, 0xe67e22];

export class TrafficSystem {
  constructor(scene, roads, opts = {}) {
    this.scene = scene;
    this.roads = roads;
    this.agents = [];
    this.ghosts = [];
    this.density = opts.density ?? 1;
    this.maxSimulated = opts.maxSimulated ?? 26;
    this.maxGhosts = opts.maxGhosts ?? 320;
    this.ghostCapacity = 512;   // instance buffer is allocated once; never exceed it
    this.spawnRadius = 320;
    this.ghostRadius = 620;
    this.rng = rng(7717);
    this.ghostMesh = null;
    this.group = new THREE.Group();
    this.group.name = 'Traffic';
    scene.add(this.group);

    this._buildGhostMesh();
    this.spawnInitial();
  }

  _buildGhostMesh() {
    // One InstancedMesh for every distant car: 1 draw call for the far skyline.
    const geo = new THREE.BoxGeometry(1.9, 1.4, 4.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5 });
    const im = new THREE.InstancedMesh(geo, mat, this.ghostCapacity);
    im.frustumCulled = false;
    im.castShadow = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ghostMesh = im;
    this.scene.add(im);
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
  }

  setDensity(s) {
    this.density = clamp(s, 0, 2);
    this.maxSimulated = Math.max(4, Math.round(26 * this.density));
    this.maxGhosts = Math.min(this.ghostCapacity, Math.round(320 * this.density) || 40);
    // shed simulated cars immediately when the density drops
    while (this.agents.length > this.maxSimulated) this._demote(this.agents[this.agents.length - 1]);
  }

  _randNode() {
    const n = this.roads.nodes;
    return n[Math.floor(this.rng.f() * n.length)];
  }

  spawnInitial() {
    for (let i = 0; i < this.maxSimulated; i++) this.spawnAgent(false);
    for (let i = 0; i < this.maxGhosts; i++) this.spawnAgent(true);
  }

  spawnAgent(asGhost) {
    const a = this._randNode();
    const b = a.links.length ? a.links[Math.floor(this.rng.f() * a.links.length)] : this._randNode();
    const agent = {
      from: a, to: b, t: 0,
      speed: this.rng.r(6, 14),
      desired: this.rng.r(8, 16),
      ghost: asGhost,
      body: null, mesh: null,
      color: CAR_COLORS[Math.floor(this.rng.f() * CAR_COLORS.length)],
      cls: CITY_CARS[Math.floor(this.rng.f() * CITY_CARS.length)],
    };
    if (!asGhost) {
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      const body = new VehicleBody(agent.cls, a.x, a.z, ang);
      body.vel.set(Math.sin(ang), Math.cos(ang)).multiplyScalar(agent.speed);
      agent.body = body;
      const built = buildVehicleMesh(agent.cls, { color: agent.color });
      agent.mesh = built.group;
      this.group.add(built.group);
    }
    (asGhost ? this.ghosts : this.agents).push(agent);
    return agent;
  }

  // Convert the furthest simulated car into a ghost (distance-based shedding).
  _demote(agent) {
    if (agent.mesh) { this.group.remove(agent.mesh); agent.mesh = null; }
    agent.body = null;
    agent.ghost = true;
    this.agents.splice(this.agents.indexOf(agent), 1);
    this.ghosts.push(agent);
  }

  _promote(agent) {
    if (this.agents.length >= this.maxSimulated) return;
    const ang = Math.atan2(agent.to.x - agent.from.x, agent.to.z - agent.from.z);
    agent.body = new VehicleBody(agent.cls, agent.posX ?? agent.from.x, agent.posZ ?? agent.from.z, ang);
    const built = buildVehicleMesh(agent.cls, { color: agent.color });
    agent.mesh = built.group;
    this.group.add(built.group);
    agent.ghost = false;
    this.ghosts.splice(this.ghosts.indexOf(agent), 1);
    this.agents.push(agent);
  }

  update(dt, playerPos) {
    const all = this.agents.concat(this.ghosts);

    for (const a of all) {
      const px = a.ghost ? (a.posX ?? a.from.x) : a.body.pos.x;
      const pz = a.ghost ? (a.posZ ?? a.from.z) : a.body.pos.y;
      const dist = Math.hypot(px - playerPos.x, pz - playerPos.z);

      // ---- banding ------------------------------------------------------------
      if (!a.ghost && dist > this.ghostRadius * 1.25) { this._demote(a); continue; }
      if (a.ghost && dist < this.spawnRadius * 0.8 && this.agents.length < this.maxSimulated) {
        a.posX = px; a.posZ = pz; this._promote(a); continue;
      }

      // ---- advance -------------------------------------------------------------
      if (a.ghost) {
        const dx = a.to.x - a.from.x, dz = a.to.z - a.from.z;
        const len = Math.hypot(dx, dz) || 1;
        a.t += (a.speed * dt) / len;
        if (a.t >= 1) {
          a.t = 0;
          a.from = a.to;
          a.to = a.from.links.length ? a.from.links[Math.floor(this.rng.f() * a.from.links.length)] : this._randNode();
        }
        a.posX = a.from.x + dx * a.t;
        a.posZ = a.from.z + dz * a.t;
        a.heading = Math.atan2(dx, dz);
        continue;
      }

      // ---- simulated: steer toward the next node with car-following -------------
      const b = a.body;
      const laneOff = 3.2;
      const tx = a.to.x + (a.to.z - a.from.z === 0 ? laneOff : 0);
      const tz = a.to.z;
      const desiredHeading = Math.atan2(tx - b.pos.x, tz - b.pos.y);
      const diff = angDiff(b.heading, desiredHeading);

      // car following: look ~18 m ahead for slower traffic
      let limit = a.desired;
      for (const o of all) {
        if (o === a) continue;
        const ox = o.ghost ? (o.posX ?? o.from.x) : o.body.pos.x;
        const oz = o.ghost ? (o.posZ ?? o.from.z) : o.body.pos.y;
        const d = Math.hypot(ox - b.pos.x, oz - b.pos.y);
        if (d < 16 && d > 0.1) {
          const ahead = (ox - b.pos.x) * Math.sin(b.heading) + (oz - b.pos.y) * Math.cos(b.heading);
          if (ahead > 2) {
            const other = o.ghost ? o.speed : o.body.speed;
            limit = Math.min(limit, other * clamp(d / 16, 0.1, 1));
          }
        }
      }

      a.speed = damp(a.speed, Math.min(limit, a.desired), 2.2, dt);
      b.steer = clamp(diff * 1.5, -1, 1);
      b.throttle = a.speed > b.speed ? 0.55 : 0.12;
      b.brake = a.speed < b.speed - 1.5 ? 0.4 : 0;
      b.step(dt, null);

      if (a.mesh) {
        a.mesh.position.set(b.pos.x, 0, b.pos.y);
        a.mesh.rotation.y = b.heading;
      }

      if (Math.hypot(b.pos.x - a.to.x, b.pos.y - a.to.z) < 9) {
        a.from = a.to;
        a.to = a.to.links.length ? a.to.links[Math.floor(this.rng.f() * a.to.links.length)] : this._randNode();
      }
    }

    // ---- maintain populations --------------------------------------------------
    if (this.agents.length < this.maxSimulated) this.spawnAgent(false);
    if (this.ghosts.length < this.maxGhosts) this.spawnAgent(true);

    this._syncGhosts(playerPos);
  }

  _syncGhosts(playerPos) {
    let n = 0;
    const cap = Math.min(this.maxGhosts, this.ghostCapacity);
    for (const a of this.ghosts) {
      if (n >= cap) break;
      if (a.posX === undefined) continue;
      const d = Math.hypot(a.posX - playerPos.x, a.posZ - playerPos.z);
      if (d > this.ghostRadius) continue;
      this._e.set(0, a.heading || 0, 0);
      this._q.setFromEuler(this._e);
      this._m4.compose(new THREE.Vector3(a.posX, 0.75, a.posZ), this._q, this._v);
      this.ghostMesh.setMatrixAt(n, this._m4);
      this._c.setHex(a.color);
      // fade distant cars into the fog colour
      const fade = clamp(1 - d / this.ghostRadius, 0, 1);
      this._c.lerp(new THREE.Color(0x9aa8bb), 1 - fade * 0.85);
      this.ghostMesh.setColorAt(n, this._c);
      n++;
    }
    this.ghostMesh.count = n;
    this.ghostMesh.instanceMatrix.needsUpdate = true;
    if (this.ghostMesh.instanceColor) this.ghostMesh.instanceColor.needsUpdate = true;
  }

  stats() {
    return { simulated: this.agents.length, ghosts: this.ghosts.length };
  }
}

// ---------------------------------------------------------------------------
// Pedestrians — instanced voxel people on the sidewalks
// ---------------------------------------------------------------------------
export class PedestrianSystem {
  constructor(scene, roads, opts = {}) {
    this.scene = scene;
    this.roads = roads;
    this.count = opts.count ?? 260;
    this.density = 1;
    this.rng = rng(4242);
    this.people = [];
    this.panicCentre = null;
    this.panicStrength = 0;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count * 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();

    this._seed();
  }

  _seed() {
    const segs = this.roads.segs;
    for (let i = 0; i < this.count; i++) {
      const s = segs[Math.floor(this.rng.f() * segs.length)];
      if (!s) break;
      const t = this.rng.f();
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      const side = this.rng.chance(0.5) ? 1 : -1;
      const off = (this.roads.road * 0.5 + this.rng.r(2.5, 6)) * side;
      this.people.push({
        x: s.a.x + dx * t + nx * off,
        z: s.a.z + dz * t + nz * off,
        dir: this.rng.r(0, Math.PI * 2),
        speed: this.rng.r(1.1, 1.9),
        state: 'walk',
        panic: 0,
        hue: this.rng.f(),
        phase: this.rng.r(0, Math.PI * 2),
        seg: s, t, side, off,
      });
    }
  }

  setDensity(s) {
    this.density = clamp(s, 0, 2);
  }

  causePanic(x, z, radius, strength) {
    this.panicCentre = { x, z, radius };
    this.panicStrength = strength;
    let n = 0;
    for (const p of this.people) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > radius) continue;
      p.panic = clamp(p.panic + strength * (1 - d / radius), 0, 1);
      if (p.panic > 0.35) { p.state = 'flee'; p.speed = this.rng.r(4.5, 6.5); n++; }
      else if (p.panic > 0.12) p.state = 'cower';
    }
    return n;
  }

  numFleeing() { return this.people.reduce((a, p) => a + (p.state === 'flee' ? 1 : 0), 0); }

  update(dt, playerPos, time) {
    let n = 0;
    const max = Math.round(this.count * this.density);
    const bob = Math.sin(time * 8);

    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      if (i >= max) continue;

      const dPlayer = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      if (dPlayer > 260) continue;                     // distance culling
      const tick = dPlayer > 140 ? 0.35 : 1;

      if (p.state === 'flee') {
        const ang = Math.atan2(p.x - (this.panicCentre?.x ?? p.x), p.z - (this.panicCentre?.z ?? p.z));
        p.dir = ang;
        p.x += Math.sin(ang) * p.speed * dt * tick;
        p.z += Math.cos(ang) * p.speed * dt * tick;
        p.panic = Math.max(0, p.panic - dt * 0.05);
        if (p.panic < 0.05) { p.state = 'walk'; p.speed = this.rng.r(1.1, 1.9); }
      } else if (p.state === 'cower') {
        p.panic = Math.max(0, p.panic - dt * 0.09);
        if (p.panic < 0.02) p.state = 'walk';
      } else {
        // stroll along the sidewalk, turn around at the segment end
        p.t += (p.speed * dt * tick) / 60;
        if (p.t > 1 || p.t < 0) { p.t = clamp(p.t, 0, 1); p.speed = -p.speed; p.dir += Math.PI; }
        const s = p.seg;
        const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        p.x = s.a.x + dx * p.t + nx * p.off;
        p.z = s.a.z + dz * p.t + nz * p.off;
        p.dir = Math.atan2(dx * Math.sign(p.speed), dz * Math.sign(p.speed));
      }

      // Skip drawing the ones far away (the mesh is one batch, so we just cap n)
      if (dPlayer > 240) continue;

      const walk = (p.state === 'flee' ? bob * 1.8 : bob * 0.35) * (p.state === 'cower' ? 0 : 1);
      const crouch = p.state === 'cower' ? 0.55 : 1;

      // torso
      this._e.set(0, p.dir, 0); this._q.setFromEuler(this._e);
      this._m4.compose(new THREE.Vector3(p.x, 1.05 * crouch, p.z), this._q, new THREE.Vector3(0.62, 0.85 * crouch, 0.42));
      this.mesh.setMatrixAt(n, this._m4);
      this._c.setHSL(p.hue, 0.42, 0.5);
      this.mesh.setColorAt(n, this._c);
      n++;

      // head
      this._m4.compose(new THREE.Vector3(p.x, 1.68 * crouch + walk * 0.04, p.z), this._q, new THREE.Vector3(0.42, 0.42, 0.42));
      this.mesh.setMatrixAt(n, this._m4);
      this._c.setHSL((p.hue + 0.08) % 1, 0.35, 0.68);
      this.mesh.setColorAt(n, this._c);
      n++;

      // legs
      this._m4.compose(new THREE.Vector3(p.x, 0.32 * crouch + walk * 0.05, p.z), this._q, new THREE.Vector3(0.58, 0.62 * crouch, 0.36));
      this.mesh.setMatrixAt(n, this._m4);
      this._c.setHSL((p.hue + 0.5) % 1, 0.1, 0.16);
      this.mesh.setColorAt(n, this._c);
      n++;
    }

    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
