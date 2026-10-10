// BLOCK CITY ULTRA — vertical slice entry point
// ============================================================================
// This is the "one complete district" milestone from the development plan:
// a drivable vehicle, a third-person character, realistic lighting, traffic,
// police AI with a wanted system, and one complete mission.
//
// It runs the SAME algorithms as the Unreal C++ project (city layout, road
// graph + A*, voxel architecture rules, wanted heat table, police ladder) so
// the browser build is a real benchmark harness for the engine build.

import * as THREE from '../vendor/three.module.js';
import { generateDistrict, findPath } from './city.js';
import { buildCity, setNightFactor, setWetness, MAT } from './voxel.js';
import { VehicleBody, buildVehicleMesh, VEHICLE_CLASSES, ChaseCamera } from './vehicle.js';
import { TrafficSystem, PedestrianSystem } from './traffic.js';
import { WantedSystem, PoliceSystem } from './police.js';
import { MissionSystem } from './mission.js';
import { Environment, WEATHERS } from './environment.js';
import { HUD } from './hud.js';
import { clamp, damp, lerp, angDiff, rng, SpatialHash } from './util.js';

// ---------------------------------------------------------------------------
// Graphics presets — mirror Perf/BCUScalabilityManager::GetPresetDefaults()
// ---------------------------------------------------------------------------
const PRESETS = {
  Performance: { scale: 0.62, shadows: false, shadowMap: 512,  aa: false, traffic: 0.4,  peds: 0.35, ghosts: 120, weather: true,  fpsCap: 60,  dynamic: true },
  Balanced:    { scale: 0.85, shadows: true,  shadowMap: 1024, aa: false, traffic: 0.7,  peds: 0.7,  ghosts: 220, weather: true,  fpsCap: 60,  dynamic: true },
  Quality:     { scale: 1.0,  shadows: true,  shadowMap: 2048, aa: true,  traffic: 1.0,  peds: 1.0,  ghosts: 320, weather: true,  fpsCap: 90,  dynamic: false },
  Ultra:       { scale: 1.0,  shadows: true,  shadowMap: 2048, aa: true,  traffic: 1.0,  peds: 1.0,  ghosts: 420, weather: true,  fpsCap: 120, dynamic: false },
};

const RESOLUTIONS = { '1080p': 1080, '1440p': 1440, '4K': 2160 };

// ---------------------------------------------------------------------------
class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.clock = new THREE.Clock();
    this.time = 0;
    this.paused = false;
    this.showStats = true;
    this.presetName = 'Ultra';
    this.resolution = '1440p';
    this.dynamicEnabled = false;
    this.renderScale = 1;
    this.frameTimes = [];
    this.worst = 16;
    this.credits = 1500;

    this._initRenderer();
    this._initScene();

    // City layout first: the HUD (minimap) and every system need the road graph.
    this.layout = generateDistrict('Downtown', 20251010, { maxBuildings: 260 });
    this.hud = new HUD(this.layout.roads, this.layout);

    this._initWorld();
    this._initPlayer();
    this._initInput();
    this._applyPreset('Ultra');

    this.hud.toast('BLOCK CITY ULTRA', 'Vertical slice — Foundry District. WASD drive · F enter/exit · Space handbrake');
    this._loop();
  }

  // -------------------------------------------------------------------------
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.renderer.info.autoReset = false;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.4, 3000);
    this.camera.position.set(0, 8, -20);

    window.addEventListener('resize', () => this._onResize());
  }

  _initWorld() {
    // ---- voxel district (same generator as the engine) ------------------------
    this.city = buildCity(this.scene, this.layout);

    // ---- collision index ------------------------------------------------------
    this.hash = new SpatialHash(40);
    for (const c of this.city.colliders) this.hash.insert(c.x, c.z, c);

    // ---- ground plane (countryside / outskirts fill) ---------------------------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: 0x3f443a, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // ---- systems ----------------------------------------------------------------
    this.env = new Environment(this.scene, this.renderer);
    this.env.onWetnessChange = (w) => setWetness(this.city, w);
    this.env.setTime(7.6);

    this.traffic = new TrafficSystem(this.scene, this.layout.roads, { density: 1 });
    this.peds = new PedestrianSystem(this.scene, this.layout.roads, { count: 320 });
    this.police = new PoliceSystem(this.scene, this.layout.roads);
    this.wanted = new WantedSystem();
    this.wanted.onChange = (lvl) => this.police.onWantedChanged(lvl, this.wanted.lastKnown);
    for (let i = 0; i < 3; i++) this.police.spawn(1);

    this.missions = new MissionSystem(this.scene, this.layout.roads, this.layout);
    this.missions.onComplete = (m) => {
      this.credits += m.reward.credits;
      this.hud.toast('MISSION COMPLETE', `${m.title} · +§${m.reward.credits.toLocaleString('en-US')}`, 6);
      if (m.reward.unlockVehicle) this.hud.toast('VEHICLE UNLOCKED', m.reward.unlockVehicle, 6);
    };
    this.missions.onObjectiveChanged = (m, i) => {
      this.hud.toast('OBJECTIVE', m.objectives[i].title, 4);
    };
    this.missions.start('MSN_FIRST_LIGHT');

    // weather cycling, like the engine's auto-weather
    this.weatherIndex = 0;
    this.weatherTimer = 0;

    this.chase = new ChaseCamera(this.camera);
  }

  /** Collision query used by VehicleBody.resolveCollisions(). */
  queryBuildings(x, z, radius) {
    return this.hash.query(x, z, radius);
  }

  _initPlayer() {
    // ---- starting vehicle (the one drivable car of the slice) -------------------
    const startNode = this.layout.roads.nodes[Math.floor(this.layout.roads.nodes.length / 2)];
    this.car = new VehicleBody('Sedan', startNode.x, startNode.z, 0);
    const built = buildVehicleMesh('Sedan', { color: 0x2a5fd6 });
    this.carMesh = built.group;
    this.carLights = built.lights;
    this.scene.add(this.carMesh);

    // ---- on-foot character -------------------------------------------------------
    this.char = {
      x: startNode.x + 6, z: startNode.z + 6, heading: 0,
      speed: 0, vy: 0, y: 0, sprinting: false,
    };
    this.charMesh = this._buildCharacter();
    this.scene.add(this.charMesh);

    this.inVehicle = true;
    this.charMesh.visible = false;
  }

  _buildCharacter() {
    const g = new THREE.Group();
    const mk = (w, h, d, color, x, y, z, rough = 0.8) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 })
      );
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    mk(0.62, 0.85, 0.42, 0x2f6fd0, 0, 1.25, 0);          // torso
    mk(0.66, 0.18, 0.46, 0x24528f, 0, 1.72, 0);          // shoulders
    mk(0.44, 0.44, 0.44, 0xd9a878, 0, 2.05, 0);          // head
    mk(0.46, 0.16, 0.46, 0x22201c, 0, 2.3, 0);           // hair
    mk(0.22, 0.62, 0.22, 0x24406e, -0.42, 1.25, 0);      // arm L
    mk(0.22, 0.62, 0.22, 0x24406e, 0.42, 1.25, 0);       // arm R
    this.charLegs = [mk(0.26, 0.72, 0.28, 0x22242a, -0.16, 0.46, 0),
                     mk(0.26, 0.72, 0.28, 0x22242a, 0.16, 0.46, 0)];
    g.name = 'Player';
    return g;
  }

  _initInput() {
    this.keys = {};
    this.mouse = { dx: 0, dy: 0, down: false };
    const kd = (e) => {
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyF') this._toggleVehicle();
      if (e.code === 'Escape') this._togglePause();
      if (e.code === 'F3') { this.showStats = !this.showStats; e.preventDefault(); }
      if (e.code === 'F3Left') { this.showStats = !this.showStats; }
      if (e.code === 'KeyR') this._repair();
      if (e.code === 'KeyN') this.env.setTime((this.env.timeOfDay + 3) % 24);
      if (e.code === 'KeyM') document.getElementById('panel').classList.toggle('collapsed');
    };
    const ku = (e) => { this.keys[e.code] = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    this.canvas.addEventListener('mousedown', () => { this.mouse.down = true; });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.mouse.down) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });

    // ---- UI wiring -----------------------------------------------------------------
    document.getElementById('preset').addEventListener('change', (e) => this._applyPreset(e.target.value));
    document.getElementById('resolution').addEventListener('change', (e) => {
      this.resolution = e.target.value; this._applyPreset(this.presetName);
    });
    document.getElementById('fpscap').addEventListener('change', (e) => {
      this.fpsCap = parseInt(e.target.value, 10) || 0;
    });
    document.getElementById('weather').addEventListener('change', (e) => {
      if (e.target.value === 'Auto') { this.autoWeather = true; }
      else { this.autoWeather = false; this.env.setWeather(e.target.value, 4); }
    });
    document.getElementById('tod').addEventListener('input', (e) => {
      this.env.autoAdvance = false;
      this.env.setTime(parseFloat(e.target.value));
    });
    document.getElementById('dynres').addEventListener('change', (e) => {
      this.dynamicEnabled = e.target.checked;
      if (!this.dynamicEnabled) { this.renderScale = PRESETS[this.presetName].scale; this._applyScale(); }
    });
    document.getElementById('traffic').addEventListener('input', (e) => {
      this._trafficScale = parseFloat(e.target.value);
      this.traffic.setDensity(this._trafficScale);
      document.getElementById('trafficval').textContent = `${Math.round(this._trafficScale * 100)}%`;
    });
    document.getElementById('restart').addEventListener('click', () => this._restart());
    document.getElementById('missionbtn').addEventListener('click', () => {
      if (!this.missions.active) { this.missions.start('MSN_FIRST_LIGHT'); }
    });
    this.autoWeather = true;
    this.fpsCap = 0;
    this._trafficScale = 1;
  }

  _applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    this.presetName = name;
    this.renderScale = p.scale;
    this.renderer.shadowMap.enabled = p.shadows;
    this.renderer.shadowMap.type = p.shadows ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    if (this.env.sun) this.env.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
    if (this.env.sun.shadow.map) { this.env.sun.shadow.map.dispose(); this.env.sun.shadow.map = null; }
    this.traffic.setDensity(p.traffic);
    this.traffic.maxGhosts = p.ghosts;
    this.peds.setDensity(p.peds);
    this.dynamicEnabled = p.dynamic;
    this.fpsCap = p.fpsCap;
    this._applyScale();
    document.getElementById('presetlabel').textContent = name;
  }

  _applyScale() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr * this.renderScale);
    this._onResize();
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  _report(crime, witnessed, at) {
    if (this._crimeCooldown > 0) return;
    this._crimeCooldown = 4;
    this.wanted.report(crime, witnessed, at);
  }

  _toggleVehicle() {
    const px = this.inVehicle ? this.car.pos.x : this.char.x;
    const pz = this.inVehicle ? this.car.pos.y : this.char.z;

    if (this.inVehicle) {
      // step out to the side of the car
      const side = this.car.right;
      this.char.x = px + side.x * 2.6;
      this.char.z = pz + side.y * 2.6;
      this.char.heading = this.car.heading + Math.PI * 0.5;
      this.char.speed = 0;
      this.inVehicle = false;
      this.charMesh.visible = true;
      this.chase.initialized = false;
      this.chase.dist = 6.5; this.chase.height = 2.6;
      this.hud.toast('ON FOOT', 'Walk up to any car and press F', 3);
    } else {
      const d = Math.hypot(this.car.pos.x - px, this.car.pos.y - pz);
      if (d < 5.5) {
        this.inVehicle = true;
        this.charMesh.visible = false;
        this.chase.initialized = false;
        this.chase.dist = 11; this.chase.height = 5.2;
        this.hud.toast('VEHICLE', 'Sedan · 220 hp', 2.5);
      } else {
        // steal the nearest traffic car
        let best = null, bd = 12;
        for (const a of this.traffic.agents) {
          const dd = Math.hypot(a.body.pos.x - px, a.body.pos.y - pz);
          if (dd < bd) { bd = dd; best = a; }
        }
        if (best) {
          this._report('Theft', this.peds.people.some(p =>
            Math.hypot(p.x - px, p.z - pz) < 30), { x: px, z: pz });
          this.car.cls = best.cls;
          this.car.S = VEHICLE_CLASSES[best.cls];
          this.car.mass = this.car.S.mass;
          this.car.halfLen = this.car.S.len * 0.5;
          this.car.halfWid = this.car.S.wid * 0.5;
          this.car.pos.copy(best.body.pos);
          this.car.heading = best.body.heading;
          this.car.vel.set(0, 0);
          this.car.damage = best.body.damage;
          this.scene.remove(this.carMesh);
          const built = buildVehicleMesh(best.cls, { color: best.color });
          this.carMesh = built.group;
          this.carLights = built.lights;
          this.scene.add(this.carMesh);
          this.inVehicle = true;
          this.charMesh.visible = false;
          this.chase.initialized = false;
          this.chase.dist = 11; this.chase.height = 5.2;
          this.hud.toast('VEHICLE ACQUIRED', best.cls, 3);
        }
      }
    }
  }

  _repair() {
    if (!this.inVehicle) return;
    const cost = Math.round(this.car.damage * 900);
    if (cost < 20) return;
    if (this.credits < cost) { this.hud.toast('NO CASH', `Repair costs §${cost}`, 3); return; }
    this.credits -= cost;
    this.car.damage = 0;
    this.hud.toast('REPAIRED', `-§${cost.toLocaleString('en-US')}`, 3);
  }

  _togglePause() {
    this.paused = !this.paused;
    document.getElementById('pause').classList.toggle('show', this.paused);
  }

  _restart() {
    window.location.reload();
  }

  // -------------------------------------------------------------------------
  _updateCharacter(dt) {
    const c = this.char;
    const k = this.keys;
    let fwd = 0, side = 0;
    if (k['KeyW'] || k['ArrowUp']) fwd += 1;
    if (k['KeyS'] || k['ArrowDown']) fwd -= 1;
    if (k['KeyA'] || k['ArrowLeft']) side -= 1;
    if (k['KeyD'] || k['ArrowRight']) side += 1;

    c.sprinting = !!(k['ShiftLeft'] || k['ShiftRight']) && fwd > 0;
    const target = c.sprinting ? 7.2 : (fwd || side) ? 3.6 : 0;
    c.speed = damp(c.speed, target, 9, dt);

    if (fwd || side) {
      // camera-relative movement: forward is where the camera looks
      const camFwd = new THREE.Vector3();
      this.camera.getWorldDirection(camFwd);
      const camYaw = Math.atan2(camFwd.x, camFwd.z);
      const moveAng = camYaw + Math.atan2(side, fwd) + Math.PI;
      c.heading = c.heading + angDiff(c.heading, moveAng) * (1 - Math.exp(-14 * dt));

      const nx = Math.sin(c.heading) * c.speed * dt;
      const nz = Math.cos(c.heading) * c.speed * dt;
      if (!this._blocked(c.x + nx, c.z)) c.x += nx;
      if (!this._blocked(c.x, c.z + nz)) c.z += nz;
    }

    // walk cycle
    const t = this.time * (c.sprinting ? 13 : 8);
    this.charLegs[0].rotation.x = Math.sin(t) * (c.speed > 0.4 ? 0.7 : 0);
    this.charLegs[1].rotation.x = -Math.sin(t) * (c.speed > 0.4 ? 0.7 : 0);
    this.charMesh.position.set(c.x, 0, c.z);
    this.charMesh.rotation.y = c.heading;
  }

  _blocked(x, z) {
    const list = this.hash.query(x, z, 3);
    for (const c of list) {
      if (Math.abs(x - c.x) < c.hw + 0.4 && Math.abs(z - c.z) < c.hd + 0.4) return true;
    }
    return false;
  }

  _updateVehicle(dt) {
    const k = this.keys;
    const c = this.car;

    let throttle = 0, brake = 0, steer = 0;
    if (k['KeyW'] || k['ArrowUp']) throttle = 1;
    if (k['KeyS'] || k['ArrowDown']) brake = 1;
    if (k['KeyA'] || k['ArrowLeft']) steer = -1;
    if (k['KeyD'] || k['ArrowRight']) steer = 1;

    c.throttle = throttle;
    c.brake = brake;
    c.steer = steer;
    c.handbrake = !!k['Space'];

    if (brake > 0 && c.speed < 0.5) { c.throttle = -1; c.brake = 0; }   // reverse

    c.step(dt, this);

    this.carMesh.position.set(c.pos.x, 0, c.pos.y);
    this.carMesh.rotation.y = c.heading;

    // body roll / pitch for weight transfer
    const roll = clamp(-c.yawRate * c.speed * 0.012, -0.09, 0.09);
    const pitch = clamp((c.throttle - c.brake) * 0.035, -0.05, 0.05);
    this.carMesh.rotation.z = damp(this.carMesh.rotation.z, roll, 8, dt);
    this.carMesh.rotation.x = damp(this.carMesh.rotation.x, pitch, 6, dt);

    // ---- crimes -----------------------------------------------------------------
    if (c.kph > 130) {
      this._speedTimer = (this._speedTimer || 0) + dt;
      if (this._speedTimer > 3) {
        this._speedTimer = 0;
        const cop = this.police.units.find(u => u.dist < 120);
        this._report('Speeding', !!cop, { x: c.pos.x, z: c.pos.y });
      }
    } else this._speedTimer = 0;

    // ---- collisions with traffic & peds --------------------------------------------
    for (const a of this.traffic.agents) {
      const d = Math.hypot(a.body.pos.x - c.pos.x, a.body.pos.y - c.pos.y);
      if (d < 4.2 && c.speed > 4) {
        const sev = c.applyDamage(c.speed * 0.55);
        a.body.vel.addScaledVector(new THREE.Vector2(
          (a.body.pos.x - c.pos.x) / d, (a.body.pos.y - c.pos.y) / d), c.speed * 0.5);
        if (sev > 0.25) {
          this._report('RecklessDriving', true, { x: c.pos.x, z: c.pos.y });
          this.hud.toast('COLLISION', 'Property damage reported', 3);
        }
      }
    }

    const hit = this._checkPedImpact(c.pos.x, c.pos.y, c.speed);
    if (hit > 0) {
      this._report('HitAndRun', true, { x: c.pos.x, z: c.pos.y });
      this.peds.causePanic(c.pos.x, c.pos.y, 60, 1.0);
      this.hud.toast('HIT AND RUN', 'Witnesses are calling it in', 4);
    }
  }

  _checkPedImpact(x, z, speed) {
    if (speed < 3) return 0;
    let n = 0;
    for (const p of this.peds.people) {
      if (Math.hypot(p.x - x, p.z - z) < 2.4) {
        p.state = 'flee'; p.panic = 1; p.speed = 6.2; n++;
      }
    }
    return n;
  }

  // -------------------------------------------------------------------------
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dtRaw = this.clock.getDelta();
    const dt = Math.min(dtRaw, 0.05);
    if (this.paused) return;

    this.time += dt;
    this._crimeCooldown = Math.max(0, (this._crimeCooldown ?? 0) - dt);

    // ---- frame pacing / dynamic resolution -------------------------------------
    if (this.fpsCap > 0) {
      const budget = 1000 / this.fpsCap;
      if (dtRaw * 1000 < budget - 1.2) return;
    }
    this.frameTimes.push(dtRaw * 1000);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.worst = Math.max(...this.frameTimes.slice(-120), 0);

    if (this.dynamicEnabled && this.frameTimes.length > 40) {
      const p = PRESETS[this.presetName];
      if (avg > 20 && this.renderScale > 0.5) { this.renderScale = Math.max(0.5, this.renderScale - 0.04); this._applyScale(); }
      else if (avg < 12 && this.renderScale < p.scale) { this.renderScale = Math.min(p.scale, this.renderScale + 0.02); this._applyScale(); }
    }

    // ---- player ---------------------------------------------------------------------
    if (this.inVehicle) this._updateVehicle(dt);
    else this._updateCharacter(dt);

    const px = this.inVehicle ? this.car.pos.x : this.char.x;
    const pz = this.inVehicle ? this.car.pos.y : this.char.z;
    const heading = this.inVehicle ? this.car.heading : this.char.heading;
    const playerPos = { x: px, y: pz };

    // ---- systems --------------------------------------------------------------------
    this.traffic.update(dt, playerPos);
    this.peds.update(dt, playerPos, this.time);
    this.wanted.update(dt);

    // police spotting: line of sight-ish + proximity
    let seen = false;
    for (const u of this.police.units) {
      if (u.dist < 90 && this.wanted.heat > 0) { seen = true; break; }
    }
    this.wanted.setSpotted(seen, { x: px, z: pz });

    const busted = this.police.update(dt, {
      x: px, y: pz, heading, speed: this.inVehicle ? this.car.speed : this.char.speed,
    }, this.wanted, this.time);
    if (busted) {
      this.wanted.clear();
      this.wanted.busted++;
      this.credits = Math.max(0, this.credits - Math.round(this.wanted.bounty || 500));
      this.credits = Math.max(0, this.credits - 500);
      this.hud.toast('BUSTED', 'You were arrested. Fines paid.', 5);
      if (this.inVehicle) {
        this.car.pos.set(this.police.units[0].body.pos.x + 8, this.police.units[0].body.pos.y + 8);
        this.car.vel.set(0, 0);
      }
    }

    this.missions.update(dt, {
      player: playerPos,
      inVehicle: this.inVehicle,
      wanted: this.wanted,
    });
    this.missions.updateMarker(dt, this.time);

    // ---- city night lighting -----------------------------------------------------------
    const nf = this.env.nightFactor;
    if (Math.abs(nf - (this._lastNf ?? -1)) > 0.01) {
      setNightFactor(this.city, nf);
      this._lastNf = nf;
      if (this.carLights) {
        for (const l of this.carLights) {
          if (l.material) l.material.emissiveIntensity = nf * 3.2;
        }
      }
    }

    // ---- weather cycling -----------------------------------------------------------------
    if (this.autoWeather) {
      this.weatherTimer += dt;
      if (this.weatherTimer > 90) {
        this.weatherTimer = 0;
        this.weatherIndex = (this.weatherIndex + 1) % WEATHERS.length;
        this.env.setWeather(WEATHERS[this.weatherIndex], 10);
      }
    }

    this.env.update(dt, this.time, new THREE.Vector3(px, 0, pz));

    // ---- camera ----------------------------------------------------------------------------
    const speedNorm = this.inVehicle ? clamp(this.car.speed / this.car.S.topSpeed, 0, 1) : 0;
    if (this.inVehicle) {
      this.chase.update(dt, this.car, speedNorm, !!this.keys['KeyC']);
      if (this.car.slip > 0.4) this.chase.shake = Math.min(0.5, this.car.slip * 0.15);
    } else {
      // third-person follow for the character
      const back = 6.2;
      const h = this.char.heading;
      const camYaw = this._charCamYaw ?? h;
      this._charCamYaw = damp(camYaw, h, 6, dt);
      const cy = this._charCamYaw;
      const desired = new THREE.Vector3(
        this.char.x - Math.sin(cy) * back, 3.4, this.char.z - Math.cos(cy) * back);
      if (!this.chase.initialized) { this.chase.smoothPos.copy(desired); this.chase.initialized = true; }
      this.chase.smoothPos.lerp(desired, 1 - Math.exp(-7 * dt));
      this.camera.position.copy(this.chase.smoothPos);
      this.camera.lookAt(this.char.x, 1.7, this.char.z);
      this.camera.fov = lerp(this.camera.fov, 68, dt * 3);
      this.camera.updateProjectionMatrix();
    }

    // ---- render -----------------------------------------------------------------------------
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);

    // ---- HUD ------------------------------------------------------------------------------
    const info = this.renderer.info;
    const obj = this.missions.objective;
    const missionLoc = (this.missions.active && obj && (obj.type === 'GoTo' || obj.type === 'DriveTo'))
      ? this.missions.locationFor(obj) : null;

    this.hud.update(dt, {
      kph: this.inVehicle ? this.car.kph : this.char.speed * 3.6,
      gear: this.inVehicle ? this.car.gear : 0,
      rpm: this.inVehicle ? this.car.engineRpm : 0,
      damage: this.inVehicle ? this.car.damage : 0,
      fuel: this.inVehicle ? this.car.fuel : 1,
      inVehicle: this.inVehicle,
      wanted: this.wanted,
      clock: this.env.clockString,
      weather: this.env.weatherName,
      credits: Math.round(this.credits),
      missionTitle: this.missions.active ? this.missions.active.title : '',
      objective: obj,
      missionLoc,
      route: this.missions.route,
      routeLength: this.missions.route ? this._routeLength(this.missions.route) : 0,
      heading,
      player: playerPos,
      fps: avg > 0 ? 1000 / avg : 0,
      frameMs: avg,
      worst: this.worst,
      drawCalls: info.render.calls,
      tris: info.render.triangles,
      boxes: this.city.stats.boxes,
      buildings: this.city.stats.buildings,
      trafficSimulated: this.traffic.agents.length,
      trafficGhosts: this.traffic.ghosts.length,
      peds: this.peds.people.length,
      policeUnits: this.police.units.length,
      policePursuing: this.police.units.filter(u => u.behaviour === 'Pursue').length,
      police: this.police.units.map(u => ({ x: u.body.pos.x, z: u.body.pos.y, chasing: u.behaviour === 'Pursue' })),
      trafficNear: this.traffic.agents.slice(0, 40).map(a => ({ x: a.body.pos.x, z: a.body.pos.y })),
      showStats: this.showStats,
      preset: this.presetName,
      res: `${Math.round(this.renderer.domElement.width)}×${Math.round(this.renderer.domElement.height)}`,
      gpu: this._gpuName(),
    });
  }

  _routeLength(route) {
    let d = 0;
    for (let i = 1; i < route.length; i++) {
      d += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
    }
    return d;
  }

  _gpuName() {
    if (this._gpu) return this._gpu;
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL';
      this._gpu = String(name).slice(0, 42);
    } catch (e) { this._gpu = 'WebGL'; }
    return this._gpu;
  }
}

// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loading').style.display = 'none';
  try {
    window.__BCU__ = new Game();
  } catch (e) {
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('loading').innerHTML =
      `<div style="color:#ff6b6b;font:13px monospace;padding:20px">Fatal: ${e.message}<br><pre>${e.stack}</pre></div>`;
    throw e;
  }
});
