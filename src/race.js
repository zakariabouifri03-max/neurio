// ── Race: physics, AI, powerups, particles, camera, HUD ─────────────────────
import * as THREE from 'three';
import { ARCH, RIVALS, driverById, carById, REWARDS } from './data.js';
import { buildTrackWorld, buildCar } from './builders.js';
import { clamp, lerp, mulberry32 } from './util.js';
import { audio } from './audio.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const DUST_MAX = 260;

function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Race {
  constructor(game, mapDef, onFinish) {
    this.game = game;
    this.map = mapDef;
    this.onFinish = onFinish;
    this.state = 'count';           // count | race | done
    this.countT = 3.6;
    this.raceT = 0;
    this.laps = mapDef.laps;
    this.raceCoins = 0;
    this.rng = mulberry32(mapDef.seed + performance.now());
    this.finishOrder = [];
    this.rockets = [];
    this._bumpCd = 0;
    this._doneTimer = -1;
    this._results = null;
    this._hudCache = {};

    const { renderer } = game;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2400);

    // ── world ──
    this.world = buildTrackWorld(mapDef);
    const { theme } = this.world;
    this.scene.add(this.world.group);
    this.scene.fog = new THREE.Fog(new THREE.Color(theme.fog[0]), theme.fog[1], theme.fog[2]);

    const hemi = new THREE.HemisphereLight(new THREE.Color(theme.hemi[0]), new THREE.Color(theme.hemi[1]), theme.night ? 0.7 : 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(new THREE.Color(theme.sun[0]), theme.sun[1] * 1.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.game.highQ ? 2048 : 1024, this.game.highQ ? 2048 : 1024);
    sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
    sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0012;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    // ── racers ──
    this.karts = [];
    const save = game.save;
    const playerCar = carById(save.selectedCar);
    const upg = game.getUpgrades(playerCar.id);
    const paint = save.paints[playerCar.id] || null;
    const mk = (carDef, driverDef, isPlayer, rival, i) => {
      const { group, wheels, flames, shield, driver } = buildCar(carDef, {
        driver: driverDef,
        paint: isPlayer ? paint : null,
        wheelColor: isPlayer ? save.wheelColor : null,
      });
      this.scene.add(group);
      const stats = isPlayer ? game.carStats(playerCar) : this._rivalStats(rival);
      const k = {
        id: i, isPlayer, rival, name: isPlayer ? driverDef.name : rival.name,
        emoji: driverDef.emoji, car: carDef, driverDef,
        mesh: group, wheels, flames, shieldMesh: shield, driver,
        pos: V3(), ang: 0, dirV: V3(0, 0, 1), speed: 0,
        idx: 0, progress: 0, lat: 0, place: i + 1,
        topSpeed: stats.topSpeed, accel: stats.accel, turn: stats.turn,
        offroad: false, boostT: 0, shieldT: 0, spinT: 0, power: null,
        finished: false, stuckT: 0, wobT: this.rng() * 9,
        ai: isPlayer ? null : { lane: (this.rng() - 0.5) * 7, useT: 1 + this.rng() * 2, stormT: 0 },
        spinVis: 0,
      };
      // grid: 2 columns behind start line
      const row = Math.floor(i / 2), col = i % 2 ? 1 : -1;
      const sIdx = ((this.world.N - 14 - row * 9) % this.world.N);
      const s = this.world.samples[sIdx];
      const lat = col * 3.4;
      k.pos.set(s.p.x + s.right.x * lat, s.y + 0.3, s.p.z + s.right.z * lat);
      k.ang = Math.atan2(s.tan.x, s.tan.z);
      k.dirV.set(Math.sin(k.ang), 0, Math.cos(k.ang));
      k.idx = sIdx;
      k.progress = sIdx - this.world.N; // negative, crosses 0 at line
      while (k.progress >= 0) k.progress -= this.world.N;
      this.karts.push(k);
      return k;
    };
    this.player = mk(playerCar, driverById(save.selectedDriver), true, null, 5); // last on grid? put 5th
    // actually grid order: rivals 0..4 in front-ish, player at 5 (3rd row)
    RIVALS.forEach((r, i) => {
      const carDef = { ...carById('c01'), arch: r.arch, paint: r.paint, accent: '#1f2937', name: r.name };
      mk(carDef, driverById(r.driverId), false, r, i);
    });

    // ── dust particles ──
    {
      const geo = new THREE.BufferGeometry();
      this.dustPos = new Float32Array(DUST_MAX * 3);
      this.dustCol = new Float32Array(DUST_MAX * 4);
      this.dustSize = new Float32Array(DUST_MAX);
      this.dustVel = new Float32Array(DUST_MAX * 3);
      this.dustLife = new Float32Array(DUST_MAX);
      this.dustMaxLife = new Float32Array(DUST_MAX);
      geo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
      geo.setAttribute('aCol', new THREE.BufferAttribute(this.dustCol, 4));
      geo.setAttribute('aSize', new THREE.BufferAttribute(this.dustSize, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        vertexShader: `attribute float aSize; attribute vec4 aCol; varying vec4 vCol;
          void main(){ vCol=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize = aSize * (240.0 / max(1.0,-mv.z)); gl_Position=projectionMatrix*mv; }`,
        fragmentShader: `varying vec4 vCol;
          void main(){ float d=length(gl_PointCoord-vec2(0.5));
          float a=smoothstep(0.5,0.12,d)*vCol.a; if(a<0.01) discard; gl_FragColor=vec4(vCol.rgb,a); }`,
      });
      this.dust = new THREE.Points(geo, mat);
      this.dust.frustumCulled = false;
      this.scene.add(this.dust);
      this.dustHead = 0;
      this.dustColor = new THREE.Color(theme.dust);
    }

    // rocket meshes pool
    this.rocketPool = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 8),
        new THREE.MeshStandardMaterial({ color: 0xff5522, emissive: 0xbb2200, emissiveIntensity: 0.8 }));
      body.rotation.x = Math.PI / 2;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff8844, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(2.6);
      g.add(body, glow);
      g.visible = false;
      this.scene.add(g);
      this.rocketPool.push(g);
    }

    this._buildMinimap();
    this._bindInput();
    this._updateHUDStatic();

    // intro toast
    this.game.toast(`<b>MAP ${this.map.id + 1}/50</b> · ${this.map.name} ${this.world.theme.night ? '🌙' : '🏝️'}`);
    this.banner('3', false);
  }

  _rivalStats(rival) {
    const t = 30 + rival.skill * 14;
    return { topSpeed: t * (0.86 + rival.skill * 0.06), accel: 16 + rival.skill * 5, turn: 2.9 + rival.skill * 0.4 };
  }

  // ── input ──────────────────────────────────────────────────────────────────
  _bindInput() {
    this.keys = {};
    this._kd = (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') { this.usePower(this.player); e.preventDefault(); }
      if (e.code === 'KeyR') this._respawn(this.player, false);
      if (e.code === 'KeyH') audio.horn(this.game.save.horn);
      if (e.code === 'Escape') this.game.togglePause();
    };
    this._ku = (e) => { this.keys[e.code] = false; };
    addEventListener('keydown', this._kd);
    addEventListener('keyup', this._ku);
    if (this.game.autoGas || matchMedia('(pointer: coarse)').matches) {
      document.getElementById('touchWrap').classList.add('on');
    }
    const pslot = document.getElementById('powerSlot');
    this._pslot = () => this.usePower(this.player);
    pslot.addEventListener('pointerdown', this._pslot);
    this._pauseBtn = () => this.game.togglePause();
    document.getElementById('btnPauseTop').addEventListener('pointerdown', this._pauseBtn);
  }

  _input() {
    const k = this.keys;
    const t = this.game.touch;
    return {
      gas: !!(k['KeyW'] || k['ArrowUp'] || t.gas || this.game.autoGas),
      brake: !!(k['KeyS'] || k['ArrowDown'] || t.brake),
      left: !!(k['KeyA'] || k['ArrowLeft'] || t.left),
      right: !!(k['KeyD'] || k['ArrowRight'] || t.right),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  _updateNearest(k) {
    const S = this.world.samples, N = this.world.N;
    let best = -1, bestD = 1e12;
    const start = k.idx - 10, end = k.idx + 34;
    for (let j = start; j < end; j++) {
      const i = ((j % N) + N) % N;
      const dx = S[i].p.x - k.pos.x, dz = S[i].p.z - k.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    if (best >= 0) {
      let delta = best - k.idx;
      if (delta > N / 2) delta -= N;
      if (delta < -N / 2) delta += N;
      k.progress += delta;
      k.idx = best;
      const s = S[best];
      const dx = k.pos.x - s.p.x, dz = k.pos.z - s.p.z;
      k.lat = dx * s.right.x + dz * s.right.z;
      k.roadY = s.y;
    }
  }

  _respawn(k, penalty = true) {
    const s = this.world.samples[k.idx];
    k.pos.set(s.p.x, s.y + 0.4, s.p.z);
    k.ang = Math.atan2(s.tan.x, s.tan.z);
    k.dirV.set(Math.sin(k.ang), 0, Math.cos(k.ang));
    k.speed = 0; k.spinT = 0;
    if (penalty) k.speed = 4;
    if (k.isPlayer) audio.splash();
  }

  _randomPower(place) {
    const r = this.rng();
    const b = place >= 5 ? 0.52 : 0.40;
    const s = place <= 2 ? 0.28 : 0.20;
    if (r < b) return 'boost';
    if (r < b + s) return 'shield';
    return 'rocket';
  }

  usePower(k) {
    if (!k.power || k.finished || this.state !== 'race') return;
    const p = k.power;
    k.power = null;
    if (p === 'boost') {
      k.boostT = 2.7;
      if (k.isPlayer) { audio.boost(); this.game.speedLines(true); }
    } else if (p === 'shield') {
      k.shieldT = 7;
      if (k.isPlayer) audio.pickup();
    } else if (p === 'rocket') {
      const g = this.rocketPool.find((r) => !r.visible);
      if (g) {
        const mesh = g;
        this.rockets.push({
          pos: k.pos.clone().addScaledVector(k.dirV, 2.5).add(V3(0, 0.8, 0)),
          ang: k.ang, owner: k, t: 4, mesh,
        });
        mesh.visible = true;
        audio.rocket();
      }
    }
    this._flashPower();
  }

  _hitKart(target) {
    if (target.shieldT > 0) {
      target.shieldT = 0;
      if (target.isPlayer) audio.shieldHit();
      return;
    }
    target.spinT = 1.35;
    target.speed *= 0.22;
    if (target.isPlayer) { audio.hit(); this.game.shake(); }
    else if (this.player && this.player.pos.distanceToSquared(target.pos) < 2500) audio.hit();
  }

  banner(txt, small = false) {
    const b = document.getElementById('banner');
    b.textContent = txt;
    b.classList.remove('small', 'pop');
    if (small) b.classList.add('small');
    void b.offsetWidth;
    b.classList.add('pop');
    if (txt) setTimeout(() => { if (b.textContent === txt) b.textContent = ''; }, small ? 1400 : 900);
  }

  // ── dust ──
  _spawnDust(x, y, z, vx, vy, vz, size, color, alpha) {
    const i = this.dustHead;
    this.dustHead = (this.dustHead + 1) % DUST_MAX;
    this.dustPos[i * 3] = x; this.dustPos[i * 3 + 1] = y; this.dustPos[i * 3 + 2] = z;
    this.dustVel[i * 3] = vx; this.dustVel[i * 3 + 1] = vy; this.dustVel[i * 3 + 2] = vz;
    this.dustLife[i] = this.dustMaxLife[i] = 0.5 + this.rng() * 0.5;
    this.dustSize[i] = size;
    this.dustCol[i * 4] = color.r; this.dustCol[i * 4 + 1] = color.g; this.dustCol[i * 4 + 2] = color.b; this.dustCol[i * 4 + 3] = alpha;
  }

  _updateDust(dt) {
    for (let i = 0; i < DUST_MAX; i++) {
      if (this.dustLife[i] <= 0) continue;
      this.dustLife[i] -= dt;
      const f = this.dustLife[i] / this.dustMaxLife[i];
      this.dustPos[i * 3] += this.dustVel[i * 3] * dt;
      this.dustPos[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt;
      this.dustPos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
      this.dustCol[i * 4 + 3] = f * 0.55;
      this.dustSize[i] += dt * 3.2;
      if (this.dustLife[i] <= 0) this.dustCol[i * 4 + 3] = 0;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.geometry.attributes.aCol.needsUpdate = true;
    this.dust.geometry.attributes.aSize.needsUpdate = true;
  }

  // ── kart physics ──
  _stepKart(k, dt) {
    const inp = k.isPlayer ? this._input() : this._aiInput(k, dt);
    const locked = this.state !== 'race' || k.spinT > 0;

    if (k.spinT > 0) { k.spinT -= dt; k.spinVis += dt * 14; }
    else k.spinVis *= Math.max(0, 1 - dt * 6);
    if (k.boostT > 0) k.boostT -= dt;
    if (k.shieldT > 0) k.shieldT -= dt;

    const top = k.topSpeed * (k.offroad ? 0.55 : 1) * (k.boostT > 0 ? 1.42 : 1);
    const gas = locked ? 0 : (inp.gas ? 1 : 0);
    const brake = locked ? 0 : (inp.brake ? 1 : 0);

    if (gas) {
      k.speed += k.accel * (k.boostT > 0 ? 1.9 : 1) * Math.max(0.12, 1 - k.speed / top) * dt;
    } else {
      k.speed -= (k.offroad ? 10 : 6.5) * dt;
    }
    if (brake) {
      if (k.speed > 1) k.speed -= 30 * dt;
      else k.speed = Math.max(k.speed - k.accel * 0.5 * dt, -11);
    }
    k.speed = clamp(k.speed, -11, top * 1.02);

    // steering
    let steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (k.isPlayer || k.ai) { /* steer is analog for AI */ }
    if (k.ai) steer = inp.steer;
    const spdF = clamp(k.speed / 9, -1, 1);
    const turnEff = k.turn * spdF * (1.06 - 0.38 * clamp(Math.abs(k.speed) / k.topSpeed, 0, 1));
    k.ang += steer * turnEff * dt * (k.speed < 0 ? -1 : 1);

    // grip: movement dir eases toward heading
    const grip = (k.offroad ? 4.2 : 7.5) * (1 - 0.5 * Math.abs(steer) * clamp(k.speed / k.topSpeed, 0, 1));
    const hx = Math.sin(k.ang), hz = Math.cos(k.ang);
    k.dirV.x += (hx - k.dirV.x) * Math.min(1, grip * dt);
    k.dirV.z += (hz - k.dirV.z) * Math.min(1, grip * dt);
    k.dirV.normalize();

    k.pos.addScaledVector(k.dirV, k.speed * dt);

    this._updateNearest(k);
    k.offroad = Math.abs(k.lat) > this.world.roadHalf - 0.5;

    // soft wall — extreme off track pushes back
    if (Math.abs(k.lat) > this.world.roadHalf + 26) {
      const s = this.world.samples[k.idx];
      const dir = k.lat > 0 ? -1 : 1;
      k.pos.x += s.right.x * dir * 24 * dt;
      k.pos.z += s.right.z * dir * 24 * dt;
      k.speed *= (1 - 0.9 * dt);
    }
    if (Math.abs(k.lat) > 60 || k.pos.y < -20) this._respawn(k);

    // vertical follow
    k.pos.y = lerp(k.pos.y, (k.roadY ?? k.pos.y), Math.min(1, 12 * dt));

    // AI stuck watchdog
    if (k.ai) {
      if (Math.abs(k.speed) < 1.5 && this.state === 'race') {
        k.stuckT += dt;
        if (k.stuckT > 1.6) { this._respawn(k, false); k.stuckT = 0; }
      } else k.stuckT = 0;
    }

    // ── visuals ──
    const m = k.mesh;
    m.position.copy(k.pos);
    const bounce = Math.sin(performance.now() * 0.02 + k.id * 9) * 0.035 * clamp(k.speed / 30, 0, 1);
    m.position.y += bounce;
    const slide = angDiff(k.ang, Math.atan2(k.dirV.x, k.dirV.z));
    m.rotation.set(0, k.ang + slide * 0.45 + k.spinVis, 0, 'YXZ');
    m.rotation.z = -steer * clamp(k.speed / k.topSpeed, 0, 1) * 0.14;
    m.rotation.x = gas * 0.03 - brake * 0.04 + (k.boostT > 0 ? -0.03 : 0);

    const spin = k.speed * dt / 0.5;
    for (const w of k.wheels.all) w.rotation.x += spin;
    for (const p of k.wheels.front) p.rotation.y = steer * 0.42;
    for (const f of k.flames) {
      f.visible = k.boostT > 0;
      if (f.visible) f.scale.set(1 + this.rng() * 0.5, 1 + this.rng() * 1.4, 1 + this.rng() * 0.5);
    }
    k.shieldMesh.visible = k.shieldT > 0;
    if (k.shieldT > 0) k.shieldMesh.rotation.y += dt * 2;

    // dust
    if (gas && k.speed > 6) {
      const n = k.offroad ? 2 : (k.boostT > 0 ? 2 : (this.rng() < 0.35 ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const back = k.boostT > 0 ? 2.2 : 1.6;
        this._spawnDust(
          k.pos.x - k.dirV.x * back + (this.rng() - 0.5) * 1.6,
          k.pos.y + 0.25,
          k.pos.z - k.dirV.z * back + (this.rng() - 0.5) * 1.6,
          -k.dirV.x * 3 + (this.rng() - 0.5) * 2, 1.5 + this.rng() * 2, -k.dirV.z * 3 + (this.rng() - 0.5) * 2,
          1.4 + this.rng() * 1.8,
          k.boostT > 0 ? new THREE.Color(0xffa133) : this.dustColor,
          k.offroad ? 0.65 : 0.45
        );
      }
    }
  }

  _aiInput(k, dt) {
    const N = this.world.N, S = this.world.samples;
    k.wobT += dt;
    const look = 9 + k.speed * 0.30;
    const ti = (k.idx + Math.floor(look)) % N;
    const t = S[ti];
    const laneTarget = k.ai.lane + Math.sin(k.wobT * 0.7) * 1.6;

    // avoid kart directly ahead
    let avoid = 0;
    for (const o of this.karts) {
      if (o === k) continue;
      const dp = o.progress - k.progress;
      if (dp > 0 && dp < 14 && Math.abs(o.lat - k.lat) < 3.4) {
        avoid = (o.lat - k.lat > 0 ? -3.2 : 3.2);
        break;
      }
    }
    const tx = t.p.x + t.right.x * (laneTarget + avoid);
    const tz = t.p.z + t.right.z * (laneTarget + avoid);
    const want = Math.atan2(tx - k.pos.x, tz - k.pos.z);
    const err = angDiff(k.ang, want);
    const steer = clamp(err * 2.2, -1, 1);

    // rubber-band throttle
    const pp = this.player ? this.player.progress : 0;
    const diff = pp - k.progress;
    let mult = 1;
    if (!this.player.finished) {
      mult = diff > 0 ? 1 + Math.min(diff * 0.00045, 0.17) : 1 + Math.max(diff * 0.0003, -0.13);
    }
    mult *= 0.94 + k.rival.skill * 0.06;
    k._aiMult = mult;

    // powerups
    k.ai.useT -= dt;
    if (k.power && k.ai.useT <= 0) {
      if (k.power === 'rocket') {
        const ahead = this.karts.some((o) => o !== k && o.progress > k.progress && o.progress - k.progress < 150);
        if (ahead) { this.usePower(k); k.ai.useT = 2 + this.rng() * 2; }
      } else { this.usePower(k); k.ai.useT = 2.5 + this.rng() * 3; }
    }

    const gas = Math.abs(err) < 2.6;
    return { gas, brake: err > 2.0 || err < -2.0, steer };
  }

  // ── rockets ──
  _stepRockets(dt) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.t -= dt;
      // home on nearest target ahead
      let best = null, bestScore = 1e9;
      for (const o of this.karts) {
        if (o === r.owner || o.finished) continue;
        const dx = o.pos.x - r.pos.x, dz = o.pos.z - r.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 90 * 90) continue;
        const dirx = Math.sin(r.ang), dirz = Math.cos(r.ang);
        if ((dx * dirx + dz * dirz) / Math.max(1, Math.sqrt(d2)) < 0.1) continue;
        if (d2 < bestScore) { bestScore = d2; best = o; }
      }
      if (best) {
        const want = Math.atan2(best.pos.x - r.pos.x, best.pos.z - r.pos.z);
        r.ang += clamp(angDiff(r.ang, want), -3.2 * dt, 3.2 * dt);
      }
      const spd = 58;
      r.pos.x += Math.sin(r.ang) * spd * dt;
      r.pos.z += Math.cos(r.ang) * spd * dt;
      if (best) r.pos.y = lerp(r.pos.y, best.pos.y + 0.9, Math.min(1, 2.2 * dt));
      r.mesh.position.copy(r.pos);
      r.mesh.rotation.y = r.ang;

      let hit = null;
      for (const o of this.karts) {
        if (o === r.owner) continue;
        if (o.pos.distanceToSquared(r.pos) < 3.4 * 3.4) { hit = o; break; }
      }
      if (hit || r.t <= 0) {
        if (hit) this._hitKart(hit);
        for (let j = 0; j < 8; j++) {
          this._spawnDust(r.pos.x, r.pos.y, r.pos.z,
            (this.rng() - 0.5) * 10, this.rng() * 7, (this.rng() - 0.5) * 10,
            2.5 + this.rng() * 2, new THREE.Color(0xff7733), 0.9);
        }
        r.mesh.visible = false;
        this.rockets.splice(i, 1);
      }
    }
  }

  // ── pickups ──
  _stepPickups(dt) {
    for (const bg of this.world.userData.itemBoxes) {
      if (bg.userData.takenT > 0) {
        bg.userData.takenT -= dt;
        if (bg.userData.takenT <= 0) bg.visible = true;
        continue;
      }
      bg.rotation.y += dt * 1.4;
      bg.position.y = bg.userData.baseY + Math.sin(performance.now() * 0.002 + bg.userData.lat) * 0.3;
      for (const k of this.karts) {
        if (k.finished || k.power) continue;
        const dx = k.pos.x - bg.position.x, dz = k.pos.z - bg.position.z;
        if (dx * dx + dz * dz < 3.6 * 3.6) {
          k.power = this._randomPower(k.place);
          bg.userData.takenT = 4.5;
          bg.visible = false;
          if (k.isPlayer) { audio.pickup(); this._flashPower(); }
          break;
        }
      }
    }
    for (const cg of this.world.userData.coins) {
      if (cg.userData.taken) continue;
      cg.rotation.y += dt * 3;
      const p = this.player;
      if (p.finished) continue;
      const dx = p.pos.x - cg.position.x, dz = p.pos.z - cg.position.z;
      if (dx * dx + dz * dz < 2.7 * 2.7) {
        cg.userData.taken = true;
        cg.visible = false;
        this.raceCoins += REWARDS.coinPickup;
        audio.coin();
        this.game.coinPop(cg.position);
        this._hudCache.coins = null;
      }
    }
  }

  // ── camera ──
  _stepCamera(dt) {
    const p = this.player;
    const back = 8.8 + Math.abs(p.speed) * 0.055;
    const camT = this.camera.position;
    if (this.state === 'count') {
      // sweep from in front of the kart around to behind it
      const f = clamp(1 - this.countT / 3.6, 0, 1);
      const rad = 12 - f * 3.2;
      const oa = p.ang + Math.PI * (1 + f);
      camT.set(p.pos.x + Math.sin(oa) * -rad, p.pos.y + 4.5 - f * 1.2, p.pos.z + Math.cos(oa) * -rad);
      this.camera.lookAt(p.pos.x, p.pos.y + 1.2, p.pos.z);
    } else if (this.state === 'done') {
      this._orbitA = (this._orbitA || 0) + dt * 0.45;
      camT.set(p.pos.x + Math.sin(this._orbitA) * 9.5, p.pos.y + 3.6, p.pos.z + Math.cos(this._orbitA) * 9.5);
      this.camera.lookAt(p.pos.x, p.pos.y + 1, p.pos.z);
    } else {
      const shake = this.game._shake || 0;
      const tx = p.pos.x - p.dirV.x * back + (Math.random() - 0.5) * shake;
      const ty = p.pos.y + 3.7 + Math.abs(p.speed) * 0.012;
      const tz = p.pos.z - p.dirV.z * back + (Math.random() - 0.5) * shake;
      const kf = 1 - Math.exp(-5.2 * dt);
      camT.x += (tx - camT.x) * kf;
      camT.y += (ty - camT.y) * kf;
      camT.z += (tz - camT.z) * kf;
      this.camera.lookAt(p.pos.x + p.dirV.x * 7, p.pos.y + 1.35, p.pos.z + p.dirV.z * 7);
    }
    if (p.boostT > 0 && this.state === 'race') {
      this.camera.fov = lerp(this.camera.fov, 71, Math.min(1, 4 * dt));
    } else {
      this.camera.fov = lerp(this.camera.fov, 62, Math.min(1, 4 * dt));
    }
    this.camera.updateProjectionMatrix();
  }

  // ── HUD ──
  _buildMinimap() {
    const cv = document.getElementById('minimap');
    this.mmCtx = cv.getContext('2d');
    const S = this.world.samples;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const s of S) {
      minX = Math.min(minX, s.p.x); maxX = Math.max(maxX, s.p.x);
      minZ = Math.min(minZ, s.p.z); maxZ = Math.max(maxZ, s.p.z);
    }
    const sc = Math.min(96 / (maxX - minX), 96 / (maxZ - minZ));
    this._mmMap = (x, z) => [54 + (x - (minX + maxX) / 2) * sc, 54 + (z - (minZ + maxZ) / 2) * sc];
    const path = new Path2D();
    S.forEach((s, i) => {
      const [x, y] = this._mmMap(s.p.x, s.p.z);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    path.closePath();
    this._mmPath = path;
    // progress markers
    const wrap = document.getElementById('progMarkers');
    wrap.innerHTML = '';
    this._markers = this.karts.map((k) => {
      const el = document.createElement('span');
      el.className = 'pmarker' + (k.isPlayer ? ' me' : '');
      el.textContent = k.emoji;
      wrap.appendChild(el);
      return el;
    });
  }

  _updateHUDStatic() {
    document.getElementById('hudLap').textContent = `1/${this.laps}`;
    document.getElementById('hudPower').textContent = '';
    this._hudCache = {};
  }

  _flashPower() {
    this._hudCache.power = null;
  }

  _updateHUD() {
    const p = this.player, c = this._hudCache;
    const place = this._computePlace(p);
    if (c.place !== place) {
      c.place = place;
      const el = document.getElementById('hudPlace');
      el.textContent = `${place}/6`;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
    const lap = clamp(Math.floor(Math.max(0, p.progress) / this.world.N) + 1, 1, this.laps);
    if (c.lap !== lap) {
      c.lap = lap;
      document.getElementById('hudLap').textContent = `${lap}/${this.laps}`;
      if (lap === this.laps) this.banner('FINAL LAP! 🏁', true);
    }
    const pw = p.power ? { boost: '🔥', rocket: '🚀', shield: '🛡️' }[p.power] : '';
    if (c.power !== pw) {
      c.power = pw;
      const slot = document.getElementById('hudPower');
      slot.textContent = pw;
      slot.parentElement.classList.toggle('has', !!pw);
      if (pw) { slot.classList.remove('bump'); void slot.offsetWidth; slot.classList.add('bump'); }
    }
    if (c.coins !== this.raceCoins) {
      if (c.coins !== null && c.coins !== undefined) {
        const el = document.getElementById('hudCoins');
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      }
      c.coins = this.raceCoins;
      document.getElementById('hudCoins').textContent = `+${this.raceCoins}`;
    }
    const t = this.raceT;
    if (c.time !== (t | 0)) {
      c.time = t | 0;
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      document.getElementById('hudTime').textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
    // progress bar markers
    const total = this.laps * this.world.N;
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      const f = clamp(k.progress / total, 0, 1);
      this._markers[i].style.left = (f * 97 + 1) + '%';
    }
    // minimap
    const g = this.mmCtx;
    g.clearRect(0, 0, 108, 108);
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineCap = 'round';
    g.stroke(this._mmPath);
    g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke(this._mmPath);
    for (const k of this.karts) {
      const [x, y] = this._mmMap(k.pos.x, k.pos.z);
      g.beginPath();
      g.fillStyle = k.isPlayer ? '#ffd23f' : '#ffffff';
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5;
      g.arc(x, y, k.isPlayer ? 4.4 : 3.2, 0, 7);
      g.fill(); g.stroke();
    }
    // speed
    document.getElementById('kmh').textContent = Math.abs(Math.round(p.speed * 3.1));
  }

  _computePlace(k) {
    let place = 1;
    for (const o of this.karts) if (o !== k && o.progress > k.progress) place++;
    k.place = place;
    return place;
  }

  // ── update ──
  update(dt) {
    dt = Math.min(dt, 0.05);

    // countdown
    if (this.state === 'count') {
      const prev = Math.ceil(this.countT);
      this.countT -= dt;
      const cur = Math.ceil(this.countT);
      if (cur !== prev && cur > 0 && cur <= 3) { this.banner(String(cur)); audio.beep(false); }
      if (this.countT <= 0) {
        this.state = 'race';
        this.banner('GO! 🏁');
        audio.beep(true);
      }
    } else if (this.state === 'race') {
      this.raceT += dt;
    }

    for (const k of this.karts) {
      this._stepKart(k, dt);
      if (!k.finished && k.progress >= this.laps * this.world.N) {
        k.finished = true;
        this.finishOrder.push(k);
        if (k.isPlayer) this._finishRace();
      }
    }

    // kart collisions
    this._bumpCd -= dt;
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i], b = this.karts[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz, R = 4.2;
        if (d2 < R * R && d2 > 0.01) {
          const d = Math.sqrt(d2), push = (R - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
          a.speed *= 0.965; b.speed *= 0.965;
          if ((a.isPlayer || b.isPlayer) && this._bumpCd <= 0 && Math.abs(a.speed - b.speed) > 4) {
            audio.bump();
            this._bumpCd = 0.3;
          }
        }
      }
    }

    this._stepRockets(dt);
    this._stepPickups(dt);
    this._updateDust(dt);

    // animated world bits
    const ud = this.world.userData;
    for (const b of ud.balloons) {
      b.position.y = b.userData.baseY + Math.sin(performance.now() * 0.0004 + b.userData.bobPhase) * 3;
      b.rotation.y += dt * 0.05;
    }
    for (const c of ud.clouds) c.position.x += c.userData.drift * dt;
    if (ud.water) ud.water.position.y = -0.75 + Math.sin(performance.now() * 0.001) * 0.08;

    // sun follows player for shadows
    this.sun.position.copy(this.player.pos).addScaledVector(this.world.sunDir, 180);
    this.sun.target.position.copy(this.player.pos);

    this._stepCamera(dt);
    this._updateHUD();

    // engine sound
    if (audio.ctx) {
      audio.engineOn = this.state !== 'done';
      audio.engine(clamp(Math.abs(this.player.speed) / this.player.topSpeed, 0, 1), this.player.boostT > 0);
    }

    if (this.player.boostT <= 0) this.game.speedLines(false);

    // done timer → results
    if (this._doneTimer > 0) {
      this._doneTimer -= dt;
      if (this._doneTimer <= 0 && this._results) {
        this.onFinish(this._results);
      }
    }
  }

  _finishRace() {
    this.state = 'done';
    this.banner('FINISH! 🏁');
    audio.fanfare();
    // final order: finishers in order, then by progress
    const order = this.karts.slice().sort((a, b) => {
      if (a.finished && b.finished) return this.finishOrder.indexOf(a) - this.finishOrder.indexOf(b);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    const place = order.indexOf(this.player) + 1;
    this._results = {
      place,
      order,
      time: this.raceT,
      coins: REWARDS.coinsByPlace[place - 1] + this.raceCoins,
      gems: REWARDS.gemsByPlace[place - 1],
      trophy: place === 1,
      champPoints: REWARDS.champPoints[place - 1],
      raceCoins: this.raceCoins,
      map: this.map,
    };
    this._doneTimer = 2.4;
  }

  dispose() {
    removeEventListener('keydown', this._kd);
    removeEventListener('keyup', this._ku);
    document.getElementById('powerSlot').removeEventListener('pointerdown', this._pslot);
    document.getElementById('btnPauseTop').removeEventListener('pointerdown', this._pauseBtn);
    document.getElementById('touchWrap').classList.remove('on');
    if (audio.ctx) { audio.engineOn = false; audio.engine(0, false); }
    this.game.speedLines(false);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
}
