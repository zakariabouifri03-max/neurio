// main.js — game shell: staging, cinematic intro, missions, input, camera and the main loop
import * as THREE from 'three';
import { World, WORLD_SIZE } from './world.js';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { Player } from './player.js';
import { VehicleSystem } from './vehicles.js';
import { Survival, ITEMS, RECIPES } from './survival.js';
import { Fishing } from './fishing.js';
import { Disasters } from './disasters.js';
import { NPCSystem } from './npc.js';
import { ResourceField } from './resource.js';
import { FX } from './particles.js';
import { Post } from './post.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { createMaterials } from './materials.js';
import { clamp, clamp01, lerp, damp, smoothstep, rand, mulberry32, TAU } from './util.js';

const QUALITIES = ['low', 'medium', 'high', 'ultra'];

class Game {
  constructor() {
    this.quality = this.loadSetting('quality', this.detectQuality());
    this.state = 'loading';
    this.time = 0;
    this.clockT = 0.24;          // 0..1 sky time (0.24 ≈ morning)
    this.dayLength = 1500;       // seconds per full day
    this.input = {
      forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0, crouch: 0,
      use: 0, attack: 0, alt: 0, horn: 0, handbrake: 0,
      mx: 0, my: 0, wheel: 0,
    };
    this.keys = {};
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.mission = -1;
    this.flags = {};
    this.rng = mulberry32(7);
    this.stats = { fishCaught: 0, treesChopped: 0, structuresBuilt: 0, animalsHunted: 0, peopleSaved: 0, days: 1 };
    this.savedState = this.loadSave();
    this.cinematicTime = 0;
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 60;
  }

  detectQuality() {
    const m = navigator.userAgent.match(/Android|iPhone|iPad|iPod/i);
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 4;
    if (m) return cores >= 8 ? 'medium' : 'low';
    if (cores <= 4 || mem <= 4) return 'medium';
    return 'high';
  }
  loadSetting(k, d) { try { const v = localStorage.getItem('tsunami.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  saveSetting(k, v) { try { localStorage.setItem('tsunami.' + k, JSON.stringify(v)); } catch (e) { } }
  loadSave() { try { const v = localStorage.getItem('tsunami.save'); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  writeSave() {
    try {
      localStorage.setItem('tsunami.save', JSON.stringify({
        mission: this.mission,
        flags: this.flags,
        stats: this.stats,
        survival: this.survival.save(),
        player: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, yaw: this.player.yaw, health: this.player.health, hunger: this.player.hunger, thirst: this.player.thirst, warmth: this.player.warmth },
        clock: this.clockT,
      }));
    } catch (e) { }
  }

  /* ================================================================== boot */
  async boot() {
    const root = document.getElementById('ui-root') || document.body;
    this.ui = new UI(root);
    this.ui.onAction = (a) => this.onUiAction(a);
    this.ui.setLang(this.loadSetting('lang', 'en'));
    this.audio = new Audio();
    this.audio.volumes.master = this.loadSetting('volume', 0.85);
    this.ui.setLoading(0.02, 'Creating renderer…');
    await frame();

    // ---------------- renderer & scene
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality === 'low', powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = this.quality === 'low' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // A shader that fails to compile is *silently skipped* by three: the mesh simply never
    // draws (this is exactly how "the ocean disappeared" happens). Surface it on screen.
    this.shaderErrors = [];
    if (this.renderer.debug) {
      this.renderer.debug.checkShaderErrors = true;
      this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
        let log = '';
        try {
          log = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(program)]
            .filter(Boolean).join('\n').trim();
        } catch (e) { log = '(no log)'; }
        if (!log || this.shaderErrors.includes(log)) return;
        this.shaderErrors.push(log);
        console.error('[shader] compile failed:', log);
        showShaderWarning(log);
      };
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.canvasHost = document.getElementById('game-canvas') || document.body;
    this.canvasHost.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.12, 9000);
    this.camera.userData.focus = new THREE.Vector3();
    this.post = new Post(this.renderer, this.quality);
    this.post.setSize(window.innerWidth, window.innerHeight);
    this.ui.setLoading(0.06, 'Generating materials…');
    await frame();

    // ---------------- materials
    const { mats, tex } = createMaterials(this.quality, (p) => this.ui.setLoading(0.06 + p * 0.12));
    this.mats = mats;
    await frame();

    // ---------------- world
    this.world = new World(this.scene, this.quality);
    this.ui.setLoading(0.2, 'Carving the coastline…');
    await frame();
    this.world.buildHeightField((p) => this.ui.setLoading(0.2 + p * 0.12));
    this.world.defineRoads().buildRoads();
    await frame();
    this.ui.setLoading(0.34, 'Baking terrain…');
    this.world.makeHeightTexture(this.quality === 'low' ? 256 : 512);
    this.world.buildTerrainMesh(mats);
    this.world.installTerrainShader(tex);
    await frame();
    this.ui.setLoading(0.44, 'Raising the town…');
    await frame();
    this.world.buildCity();
    await frame();
    this.world.buildCoast();
    await frame();
    this.ui.setLoading(0.56, 'Planting the mountain…');
    await frame();
    this.world.buildMountain();
    this.world.buildRoadMeshes(mats);
    await frame();
    this.world.finalize(mats);
    // resource nodes (harvestable)
    this.resourceField = new ResourceField(this.scene, this.world, mats, this.quality);
    this.resourceField.scatter();
    this.world.resources = this.resourceField.nodes;
    await frame();

    // ---------------- sky & sea
    this.ui.setLoading(0.66, 'Painting the sky…');
    this.sky = new Sky(this.scene, this.quality);
    await frame();
    this.sky.bakeClouds((p) => this.ui.setLoading(0.66 + p * 0.08));
    this.ocean = new Ocean(this.scene, this.world, this.quality, this.renderer);
    this.ui.setLoading(0.76, 'Filling the ocean…');
    await frame();

    // ---------------- fx & life
    this.fx = new FX(this.scene, this.quality, this.renderer);
    this.npc = new NPCSystem({ scene: this.scene, world: this.world, ocean: this.ocean, fx: this.fx, audio: this.audio, quality: this.quality });
    this.ui.setLoading(0.84, 'Waking up the town…');
    await frame();
    this.vehicles = new VehicleSystem(this.scene, this.world, this.ocean, this.quality);
    this.vehicles.populate(this.world.spawns);
    await frame();

    // ---------------- gameplay systems
    this.player = new Player(this.world, this.ocean, { camera: this.camera });
    this.survival = new Survival({
      player: this.player, world: this.world, ocean: this.ocean, fx: this.fx,
      audio: this.audio, ui: this.ui, scene: this.scene, quality: this.quality,
    });
    this.survival.onEvent = (e) => this.onGameEvent(e);
    this.fishing = new Fishing({
      player: this.player, world: this.world, ocean: this.ocean, fx: this.fx, audio: this.audio,
      survival: this.survival, camera: this.camera, ui: this.ui, scene: this.scene,
    });
    this.disasters = new Disasters({
      world: this.world, ocean: this.ocean, fx: this.fx, audio: this.audio, sky: this.sky,
      npc: this.npc, vehicles: this.vehicles, survival: this.survival, ui: this.ui,
      scene: this.scene, mats, quality: this.quality,
    });
    this.disasters.onEvent = (e) => this.onGameEvent(e);
    this.sky.setWeather(0.1, true);
    this.ocean.syncSky(this.sky);

    // starter inventory
    this.survival.inv.add('water_clean', 1);
    this.survival.inv.add('bandage', 1);

    {
      // a scenic pose so the loading screen is not black
      const bc = this.world.beachCenter;
      this.camera.position.set(this.world.coastX(bc.z) - 260, 46, bc.z + 180);
      this.camera.lookAt(this.world.coastX(bc.z) + 90, 6, bc.z - 30);
    }
    this.ui.setLoading(0.94, 'Ready.');
    this.setupInput();
    this.setupWaterfall();
    this.spawnPlayerAtBeach();
    this.setupMissions();
    this.ui.setLoading(1, 'Ready.');
    this.ui.showStart();
    this.state = 'title';
    this.renderer.setAnimationLoop(() => this.tick());
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('beforeunload', () => this.writeSave());
  }

  setupWaterfall() {
    // simple animated waterfall plane + mist at the lake outlet
    const wf = (this.world.waterfalls || [])[0];
    if (!wf) return;
    const geo = new THREE.PlaneGeometry(wf.w, wf.h, 1, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdff1ff, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.0,
      side: THREE.DoubleSide, depthWrite: false, emissive: 0x24404a, emissiveIntensity: 0.25,
    });
    this.waterfall = new THREE.Mesh(geo, mat);
    this.waterfall.position.set(wf.x, wf.y + wf.h / 2, wf.z);
    this.waterfall.rotation.y = wf.rot;
    this.scene.add(this.waterfall);
    this.waterfallGeo = geo;
    this.waterfallBase = geo.attributes.position.array.slice();
    this.fx.addEmitter((dt, fx) => {
      if (!this.waterfall) return;
      if (this.rng() < 0.6) fx.mist(wf.x, wf.y + 1.5, wf.z, 9, 2);
    });
  }

  spawnPlayerAtBeach() {
    const sp = this.world.spawns.beach || { x: 60, y: 3, z: -150 };
    this.player.setPosition(sp.x, sp.y + 0.4, sp.z);
    this.player.yaw = -1.4;
    this.player.pitch = -0.12;
  }

  /* ================================================================ input */
  setupInput() {
    const dom = this.renderer.domElement;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    dom.addEventListener('mousedown', (e) => {
      if (this.state === 'play' && document.pointerLockElement !== dom) { dom.requestPointerLock(); return; }
      if (e.button === 0) {
        this.mouse.left = true;
        if (this.state === 'play' && !this.fishing.equipped && !this.player.vehicle) this.attack();
      }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === dom;
      if (!this.pointerLocked && this.state === 'play' && !this.ui.panelOpen) this.pause();
    });
    window.addEventListener('wheel', (e) => { this.input.wheel = Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('blur', () => { this.keys = {}; });
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    this.keys[k] = down;
    if (!down) return;
    if (k === 'escape') {
      if (this.ui.panelOpen) this.ui.closePanel();
      else if (this.state === 'play') this.pause();
      else if (this.state === 'paused') this.resume();
      return;
    }
    if (this.state === 'cinematic' && (k === 'enter' || k === ' ')) { this.endCinematic(); return; }
    if (this.state !== 'play') return;
    if (k === 'i' || k === 'b') this.ui.openPanel('inv', this.panelCtx());
    else if (k === 'c') this.ui.openPanel('craft', this.panelCtx());
    else if (k === 'j') this.ui.openPanel('log', this.panelCtx());
    else if (k === 'h') this.ui.openPanel('help', this.panelCtx());
    else if (k === 'm') this.toggleMap();
    else if (k === 'v') this.flags.thirdPerson = !this.flags.thirdPerson;
    else if (k === 'f') this.toggleVehicle();
    else if (k === 'e') this.interact();
    else if (k === 'g') this.buildMenu();
    else if (k === 'q') this.quickAction();
    else if (k === 't') this.toggleTorch();
    else if (k >= '1' && k <= '9') this.quickUse(parseInt(k, 10));
  }

  onUiAction(a) {
    if (a === 'start' || a === 'newGame') this.beginPlaythrough(true);
    else if (a === 'skip') this.endCinematic();
    else if (a === 'resume') this.resume();
    else if (a === 'restart') { localStorage.removeItem('tsunami.save'); location.reload(); }
    else if (a === 'lang') {
      this.ui.setLang(this.ui.lang === 'en' ? 'ar' : 'en');
      this.saveSetting('lang', this.ui.lang);
    } else if (a === 'sound') {
      this.audio.setMuted(!this.audio.muted);
      this.ui.message(this.audio.muted ? 'Sound off' : 'Sound on');
    } else if (a === 'quality') {
      const i = (QUALITIES.indexOf(this.quality) + 1) % QUALITIES.length;
      this.quality = QUALITIES[i];
      this.saveSetting('quality', this.quality);
      this.ui.el.qLabel.textContent = this.quality.toUpperCase();
      this.ui.message('Quality: ' + this.quality + ' — reload to apply (R)');
    } else if (a.startsWith('tab:')) {
      this.ui.panelTab = a.slice(4);
      this.ui.renderPanel(this.panelCtx());
    } else if (a.startsWith('use:')) {
      const id = a.slice(4);
      const it = ITEMS[id];
      if (it.kind === 'food') this.survival.eat(id);
      else if (it.kind === 'drink') this.survival.drinkItem(id);
      else if (it.kind === 'med') this.survival.eat(id);
      this.ui.renderPanel(this.panelCtx());
    } else if (a.startsWith('craft:')) {
      this.survival.craft(a.slice(6));
      this.ui.renderPanel(this.panelCtx());
    } else if (a === 'equiprod') { this.fishing.equipRod(); this.ui.closePanel(); }
    else if (a === 'flare') this.fireFlare();
    else if (a.startsWith('build:')) this.doBuild(a.slice(6));
    else if (a.startsWith('touch:')) this.onTouchAction(a.slice(6));
  }

  onTouchAction(act) {
    if (this.state !== 'play') return;
    if (act === 'use') this.interact();
    else if (act === 'attack') this.attack();
    else if (act === 'fish') { if (this.fishing.equipped) this.fishing.unequip(); else this.fishing.equipRod(); }
    else if (act === 'jump') this.input.jump = 1;
  }

  pause() {
    this.state = 'paused';
    this.ui.el.pause.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.writeSave();
  }
  resume() {
    this.state = 'play';
    this.ui.el.pause.classList.add('hidden');
    this.renderer.domElement.requestPointerLock?.();
  }
  toggleMap() {
    if (this.ui.panelOpen) this.ui.closePanel();
    else this.ui.openPanel('log', this.panelCtx());
  }
  panelCtx() {
    return {
      inv: this.survival.inv, fishing: this.fishing, stats: { ...this.stats, ...this.survival.stats },
    };
  }

  /* =========================================================== playthrough */
  beginPlaythrough(fresh) {
    this.audio.init();
    this.audio.resume();
    this.ui.hideLoading();
    this.ui.setLang(this.ui.lang);
    if (this.savedState && this.savedState.mission >= 0) {
      this.mission = this.savedState.mission;
      this.flags = this.savedState.flags || {};
      Object.assign(this.stats, this.savedState.stats || {});
      this.survival.load(this.savedState.survival);
      const p = this.savedState.player;
      if (p) { this.player.setPosition(p.x, p.y, p.z); this.player.yaw = p.yaw; this.player.health = p.health; this.player.hunger = p.hunger; this.player.thirst = p.thirst; this.player.warmth = p.warmth; }
      this.clockT = this.savedState.clock || 0.24;
      this.state = 'play';
      this.ui.message('Resumed your journey.', 3);
      this.setMission(this.mission, true);
      this.renderer.domElement.requestPointerLock?.();
      return;
    }
    if (!fresh) { this.state = 'play'; return; }
    this.startCinematic();
  }

  startCinematic() {
    this.state = 'cinematic';
    this.cinematicTime = 0;
    this.clockT = 0.13;              // golden morning
    this.sky.setTimeOfDay(this.clockT);
    this.sky.setWeather(0.05, true);
    this.ui.showCinema(true);
    this.ui.dialogue('—', 'Rhissa, a small fishing town on the coast. 06:40.');
    this.cinematicCam = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.2, 9000);
  }

  endCinematic() {
    this.ui.showCinema(false);
    this.ui.el.subtitle.classList.add('hidden');
    this.cinematicCam = null;
    this.state = 'play';
    this.setMission(0, true);
    this.renderer.domElement.requestPointerLock?.();
    this.ui.message('W A S D to move · E to interact · I for your bag', 6);
  }

  updateCinematic(dt) {
    this.cinematicTime += dt;
    const t = this.cinematicTime;
    const cam = this.cinematicCam;
    const beach = this.world.beachCenter || { x: 60, z: -150 };
    const coast = this.world.coastX(beach.z);
    // three-shot flyover
    let pos, look;
    if (t < 11) {
      const k = t / 11;
      pos = new THREE.Vector3(coast - 420 + k * 180, 62 - k * 12, beach.z + 260 - k * 90);
      look = new THREE.Vector3(coast + 60, 8, beach.z - 20);
    } else if (t < 20) {
      const k = (t - 11) / 9;
      pos = new THREE.Vector3(coast - 90 + k * 40, 22 - k * 8, beach.z - 210 + k * 330);
      look = new THREE.Vector3(coast + k * 260, 10, beach.z - 60 + k * 200);
    } else {
      const k = clamp01((t - 20) / 8);
      pos = new THREE.Vector3(coast + 70 - k * 46, 8 - k * 4, beach.z + 66 - k * 46);
      look = new THREE.Vector3(coast + 40, 3.2, beach.z - 2);
    }
    cam.position.copy(pos);
    cam.lookAt(look);
    cam.rotation.z += Math.sin(t * 0.35) * 0.012;
    this.camera.position.copy(cam.position);
    this.camera.quaternion.copy(cam.quaternion);
    // cinematic subtitles
    if (t > 11 && t < 20 && !this.flags.c2) { this.flags.c2 = true; this.ui.dialogue('—', 'Boats in the bay, laundry on the roofs, everyone busy.'); }
    if (t > 20 && t < 29 && !this.flags.c3) { this.flags.c3 = true; this.ui.dialogue('—', 'You fell asleep on the sand… the water feels wrong.'); }
    if (t > 30) this.endCinematic();
  }

  /* ============================================================= missions */
  setupMissions() {
    const W = this.world;
    this.missions = [
      {
        id: 'wake', obj: 'Explore the beach — you washed up here. Find something useful.',
        goal: () => (W.spawns.hut ? { x: W.spawns.hut.x, z: W.spawns.hut.z } : null),
        check: () => this.survival.inv.count('rod_broken') > 0 || this.survival.inv.count('rod') > 0,
        hint: 'Follow the beach; the broken rod lies near the jetty.',
      },
      {
        id: 'repair', obj: 'Repair the fishing rod — collect fibre & scrap, then craft it (I → CRAFT).',
        check: () => this.survival.inv.count('rod') > 0,
        onEnter: () => {
          // the broken rod is dropped near the pier
          const b = W.beachCenter;
          const y = W.heightAt(b.x + 8, b.z - 6);
          this.survival.inv.add('rod_broken', 1);
          this.ui.message('You pick up a splintered fishing rod.', 5);
          this.goalMarker = { x: b.x + 8, z: b.z - 6 };
        },
      },
      {
        id: 'tsunami', obj: 'THE SEA IS PULLING BACK! Run inland — get to high ground.',
        goal: () => (W.spawns.city ? { x: W.spawns.city.x, z: W.spawns.city.z } : null),
        onEnter: () => {
          this.disasters.startTsunami();
          this.ui.message('Drop everything and RUN!', 6);
        },
        check: () => this.disasters.tsunamiPhase === 'flood' || this.disasters.tsunamiPhase === 'drain' || this.player.pos.y > 22,
      },
      {
        id: 'escape', obj: 'Escape the flood: climb above the water line (20 m) in the upper town.',
        goal: () => (W.spawns.tower ? { x: W.spawns.tower.x, z: W.spawns.tower.z } : null),
        check: () => this.player.pos.y > 19 && this.disasters.tsunamiPhase !== 'wave',
      },
      {
        id: 'car', obj: 'Take the red pickup parked on the road above town and drive up the mountain.',
        goal: () => (this.vehicles.hero ? { x: this.vehicles.hero.pos.x, z: this.vehicles.hero.pos.z } : null),
        onEnter: () => {
          this.ui.message('The road up the mountain — the only way out.', 5);
          // make sure the escape car is not buried in the rubble the flood left behind
          const hero = this.vehicles.hero;
          if (hero && this.vehicles.blocked(hero.pos.x, hero.pos.z, hero.pos.y)) {
            const spot = this.vehicles.findCarSpot(hero.pos.x, hero.pos.z, hero.rot, 70);
            if (Math.hypot(spot.x - hero.pos.x, spot.z - hero.pos.z) > 0.01) {
              hero.placeAt(spot.x, spot.y + 0.15, spot.z, spot.rot);
              this.ui.message('You shove the debris off the pickup.', 4);
            }
          }
        },
        check: () => this.vehicles.hero && this.player.vehicle === this.vehicles.hero && this.vehicles.hero.pos.y > 75,
      },
      {
        id: 'camp', obj: 'Reach the ranger camp on the mountain bench.',
        goal: () => (W.spawns.camp ? { x: W.spawns.camp.x, z: W.spawns.camp.z } : null),
        check: () => Math.hypot(this.player.pos.x - (W.spawns.camp?.x || 1e9), this.player.pos.z - (W.spawns.camp?.z || 1e9)) < 45,
        onEnter: () => this.ui.message('Follow the switchbacks up the mountain.', 5),
      },
      {
        id: 'shelter', obj: 'Build a campfire and a lean-to shelter (G to build).',
        check: () => this.survival.structures.some((s) => s.kind === 'campfire') && this.survival.structures.some((s) => s.kind === 'shelter'),
        onEnter: () => { this.ui.message('Night is coming — you need fire and shelter.', 6); },
      },
      {
        id: 'radio', obj: 'Find radio parts in the old mine, then repair the camp transmitter.',
        goal: () => ({ x: W.mineC.x, z: W.mineC.z }),
        onEnter: () => {
          const m = W.mineC;
          // salvage crate at the mine entrance
          this.spawnCrate(m.x + 8, m.z + 10, 'radio_crate');
          this.ui.message('A salvage crate sits by the mine entrance, east along the ridge road.', 6);
        },
        check: () => {
          if (this.flags.radioRepaired) return true;
          const camp = W.spawns.camp;
          const near = camp && Math.hypot(this.player.pos.x - camp.x, this.player.pos.z - camp.z) < 55;
          if (near && this.survival.inv.count('radio_part') >= 1 && this.survival.structures.length > 0) {
            this.flags.radioRepaired = true;
            this.ui.chapter('TRANSMITTER ONLINE', 'You can call for rescue');
            this.audio.play('uiBig');
            return true;
          }
          return false;
        },
      },
      {
        id: 'fish', obj: 'Catch 3 fish (repair done — cast with LMB) and cook one at the fire.',
        check: () => this.survival.stats.fishCaught >= 3 && (this.survival.inv.count('fish_cooked') > 0 || this.flags.cookedFish),
        onEnter: () => { this.ui.message('The lake is full of trout. Cast, wait, strike!', 6); this.fishing.equipRod(); },
      },
      {
        id: 'rescue', obj: 'Fire a flare from the ridge and get down to the rescue boat.',
        goal: () => ({ x: this.vehicles.rescueBoat ? this.vehicles.rescueBoat.pos.x : -800, z: -60 }),
        onEnter: () => {
          this.ui.message('Rescue is coming — signal them!', 6);
          this.ui.chapter('RESCUE INBOUND', 'Fire a flare, then reach the boat');
          this.flagRescue = true;
        },
        check: () => this.flags.signalled && this.vehicles.rescueBoat && Math.hypot(this.player.pos.x - this.vehicles.rescueBoat.pos.x, this.player.pos.z - this.vehicles.rescueBoat.pos.z) < 14,
      },
    ];
    if (this.savedState) return;
  }

  setMission(i, force = false) {
    if (i === this.mission && !force) return;
    const prev = this.missions[this.mission];
    if (prev && prev.onExit) prev.onExit();
    this.mission = i;
    const m = this.missions[i];
    if (!m) return;
    this.ui.objective(`${i + 1}/${this.missions.length} · ${m.obj}`);
    if (m.onEnter) m.onEnter();
    this.ui.message(m.obj, 7);
    if (m.hint) setTimeout(() => this.ui.message('Hint: ' + m.hint, 6), 3000);
    this.writeSave();
  }

  updateMissions(dt) {
    const m = this.missions[this.mission];
    if (!m) return;
    if (m.check && m.check()) {
      this.ui.message(`✓ ${m.id.toUpperCase()} complete`, 4);
      this.audio.play('uiBig');
      if (this.mission === this.missions.length - 1) { this.finish(); return; }
      this.setMission(this.mission + 1);
    }
    // storm after the flood
    if (this.disasters.tsunamiPhase === 'aftermath' && !this.flags.stormDone && this.time > (this.flags.stormTimer || 0)) {
      if (!this.flags.stormTimer) this.flags.stormTimer = this.time + 40;
      else { this.flags.stormDone = true; this.disasters.startStorm(210, 0.85); }
    }
    // landslide on the mountain road while driving up
    if (this.mission >= 4 && this.player.vehicle && !this.flags.landslide1 && this.player.pos.y > 90) {
      this.flags.landslide1 = true;
      const px = this.player.pos.x + 40, pz = this.player.pos.z + 20;
      this.disasters.landslide(px, pz, 14);
      this.ui.message('The hillside is giving way — keep moving!', 5);
    }
    this.survival.update(dt, {
      rain: this.disasters.storm.active ? this.disasters.storm.intensity : 0,
      night: this.isNight(),
    });
  }

  isNight() { return this.clockT > 0.5 && this.clockT < 0.92; }

  /* =========================================================== interactions */
  nearestInteractable() {
    const p = this.player;
    const eye = p.eye;
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const c = { x: p.pos.x + fwd.x * 1.4, z: p.pos.z + fwd.z * 1.4, y: p.pos.y };
    // vehicles
    const v = this.vehicles.nearest(p.pos, 3.6);
    if (v) return { type: 'vehicle', label: v.kind === 'car' ? `Drive the ${v.spec.name}` : `Sail the ${v.spec.name}`, obj: v };
    // structures
    for (const s of this.survival.structures) {
      const d = Math.hypot(s.pos.x - c.x, s.pos.z - c.z);
      if (d < 2.6) {
        if (s.kind === 'campfire') return { type: 'fire', label: s.fuel > 0 ? 'Cook / add wood (E)' : 'Add wood to relight', obj: s };
        if (s.kind === 'shelter') return { type: 'shelter', label: 'Rest (sleep until morning)', obj: s };
      }
    }
    // resource
    const r = this.survival.nearestResource(c, 3.6);
    if (r) {
      const labels = {
        palm: 'Cut palm fronds', tree: 'Chop the tree (needs hatchet)', bush: 'Gather berries',
        rock: 'Break the rock', cactus: 'Open the cactus (knife)', driftwood: 'Pick up driftwood',
        shell: 'Collect shellfish', wreck: 'Search the wreck', supply: 'Open the rescue crate',
        radio_crate: 'Salvage radio parts',
      };
      return { type: 'resource', label: labels[r.type] || 'Gather', obj: r };
    }
    // carcass
    const carc = this.npc.nearestCarcass(c, 2.8);
    if (carc) return { type: 'carcass', label: 'Skin the animal (knife)', obj: carc };
    // water
    const wy = this.ocean.waterYAt(p.pos.x, p.pos.z);
    const g = this.world.heightAt(p.pos.x, p.pos.z);
    const kind = this.fishing.waterKind(p.pos.x, p.pos.z);
    if (kind !== 'land' && wy - g > -0.4) {
      const fresh = this.world.lake && Math.hypot(p.pos.x - this.world.lake.x, p.pos.z - this.world.lake.z) < this.world.lake.r * 1.2;
      return { type: 'water', label: fresh ? 'Drink fresh lake water' : (this.survival.inv.count('bucket') ? 'Fill the bucket' : 'Drink (risky)'), fresh };
    }
    // mining store / crates we spawned
    for (const cr of this.crates || []) {
      if (!cr.used && Math.hypot(cr.x - c.x, cr.z - c.z) < 2.6) return { type: 'crate', label: 'Search the crate', obj: cr };
    }
    return null;
  }

  spawnCrate(x, z, kind) {
    this.crates = this.crates || [];
    const y = this.world.heightAt(x, z);
    const g = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.7, 0.7),
      this.mats.wood
    );
    g.position.set(x, y + 0.35, z);
    g.castShadow = true;
    this.scene.add(g);
    const rec = { x, y, z, kind, used: false, mesh: g };
    this.crates.push(rec);
    this.world.resources.push({ type: kind, x, y, z, hp: 1, depleted: false, obj: g });
    return rec;
  }

  interact() {
    const t = this.nearestInteractable();
    if (!t) { this.ui.message('Nothing here.', 1.5); return; }
    const p = this.player;
    switch (t.type) {
      case 'vehicle': {
        this.enterVehicle(t.obj);
        break;
      }
      case 'fire': {
        const raw = ['fish_raw', 'meat_raw', 'shellfish', 'crab', 'bird_egg'].find((i) => this.survival.inv.count(i) > 0);
        if (raw) this.survival.cook(raw);
        else if (this.survival.inv.count('water_dirty') > 0) {
          const rec = RECIPES.find((r) => r.id === 'water_clean');
          if (this.survival.inv.count('charcoal') > 0) this.survival.craft('water_clean');
          else this.ui.message('You need charcoal to purify water (burn wood in the fire).');
          void rec;
        } else this.survival.addFuelToFire();
        break;
      }
      case 'shelter': {
        this.sleep();
        break;
      }
      case 'resource': {
        this.survival.harvest(t.obj);
        if (t.obj.type === 'bush' || t.obj.type === 'rock') this.stats.treesChopped += 0;
        if (t.obj.depleted && this.resourceField) this.resourceField.hide(t.obj);
        break;
      }
      case 'carcass': {
        if (this.survival.inv.count('knife') === 0) { this.ui.message('You need a knife to skin it.'); break; }
        if (t.obj.looted) { this.ui.message('Already skinned.'); break; }
        t.obj.looted = true;
        t.obj.mesh.visible = false;
        this.survival.inv.add('meat_raw', 3);
        this.survival.inv.add('cloth', 1);
        this.survival.stats.animalsHunted++;
        this.stats.animalsHunted = this.survival.stats.animalsHunted;
        this.ui.message('+3 raw meat, +1 hide', 3);
        break;
      }
      case 'water': {
        if (t.fresh) this.survival.drinkSource({ safe: true });
        else if (this.survival.inv.count('bucket') > 0) this.survival.fillBottle({ safe: false });
        else this.survival.drinkSource({ safe: false });
        break;
      }
      case 'crate': {
        t.obj.used = true;
        t.obj.mesh.visible = false;
        const r = this.world.resources.find((rr) => rr.obj === t.obj.mesh);
        if (r) { this.survival.harvest(r); r.depleted = true; }
        break;
      }
      default: break;
    }
    void p;
  }

  attack() {
    if (this.fishing.equipped && ['charging', 'flying', 'waiting', 'bite', 'fight'].includes(this.fishing.state)) return;
    const p = this.player;
    const dir = new THREE.Vector3(Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const hasSpear = this.survival.inv.count('spear') > 0;
    const hasKnife = this.survival.inv.count('knife') > 0;
    const dmg = hasSpear ? 34 : hasKnife ? 20 : 8;
    const hit = this.npc.attack(p.pos, dir, hasSpear ? 3.1 : 2.3, dmg);
    this.audio.play(hasSpear ? 'shoot' : 'step');
    if (hit) {
      this.ui.message(hit.hp <= 0 ? 'Clean hit — it went down.' : 'Hit!', 2);
      this.fx.hitSpark = true;
      if (this.flags.throwSpear && hasSpear) this.throwSpear(dir);
    }
  }

  throwSpear(dir) {
    // physical spear projectile
    const p = this.player;
    const geo = new THREE.CylinderGeometry(0.03, 0.035, 1.7, 6);
    const mesh = new THREE.Mesh(geo, this.mats.wood);
    mesh.position.copy(p.eye);
    this.scene.add(mesh);
    const vel = new THREE.Vector3(dir.x, 0.12, dir.z).multiplyScalar(24);
    this.projectiles = this.projectiles || [];
    this.projectiles.push({ mesh, vel, life: 4, item: 'spear' });
  }

  updateProjectiles(dt) {
    for (const pr of this.projectiles || []) {
      pr.life -= dt;
      pr.vel.y -= 14 * dt;
      pr.mesh.position.addScaledVector(pr.vel, dt);
      pr.mesh.lookAt(pr.mesh.position.clone().add(pr.vel));
      pr.mesh.rotateX(Math.PI / 2);
      const hit = this.npc.attack(pr.mesh.position, pr.vel.clone().normalize(), 1.4, 30);
      const g = this.world.heightAt(pr.mesh.position.x, pr.mesh.position.z);
      if (hit || pr.life <= 0 || pr.mesh.position.y < g) {
        if (hit) this.ui.message('Spear hit!', 2);
        pr.life = 0;
        this.scene.remove(pr.mesh);
      }
    }
    if (this.projectiles) this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  enterVehicle(v) {
    if (this.player.vehicle) this.exitVehicle();
    this.player.vehicle = v;
    v.board(this.player);
    this.ui.message(`${v.spec.name} — F to get out`, 3);
    if (v.kind === 'car' && v.fuel < 5) this.ui.message('The tank is almost empty — find a fuel can.', 4);
  }
  exitVehicle() {
    const v = this.player.vehicle;
    if (!v) return;
    v.unboard();
    this.player.vehicle = null;
    const side = new THREE.Vector3(Math.cos(v.rot), 0, -Math.sin(v.rot));
    this.player.setPosition(v.pos.x + side.x * 2.4, v.pos.y + 0.6, v.pos.z + side.z * 2.4);
  }
  toggleVehicle() {
    if (this.player.vehicle) { this.exitVehicle(); return; }
    const v = this.vehicles.nearest(this.player.pos, 4.2);
    if (v) this.enterVehicle(v);
    else this.ui.message('No vehicle nearby.', 2);
  }

  buildMenu() {
    const opts = [
      ['campfire', 'Campfire — 4 stick · 3 stone'],
      ['shelter', 'Lean-to shelter — 6 plank · 6 frond · 2 rope'],
      ['rack', 'Drying rack — 4 stick · 1 rope'],
      ['wall', 'Wind wall — 3 plank'],
      ['marker', 'Stone marker — 3 stone'],
    ];
    this.ui.openPanel('craft', this.panelCtx());
    const body = this.ui.el.panelBody;
    body.innerHTML = `<h3>Build</h3><div class="recipes">${opts.map(([k, label]) =>
      `<div class="recipe"><div class="rHead"><b>${label}</b></div><button class="mini" data-act="build:${k}">BUILD</button></div>`).join('')}</div>
      <p class="dim">Structures are placed right in front of you.</p>`;
    body.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => this.onUiAction(b.dataset.act)));
  }

  doBuild(kind) {
    const p = this.player;
    const dir = new THREE.Vector3(Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const pos = new THREE.Vector3(p.pos.x + dir.x * 3.2, 0, p.pos.z + dir.z * 3.2);
    this.survival.build(kind, pos, p.yaw + Math.PI);
    this.ui.closePanel();
  }

  sleep() {
    if (!this.survival.nearShelter()) { this.ui.message('Build a shelter first.'); return; }
    if (this.survival.structures.filter((s) => s.kind === 'campfire' && s.fuel > 0).length === 0) { this.ui.message('You need a burning fire to stay warm.'); return; }
    this.clockT = (this.clockT + 0.35) % 1;
    this.sky.setTimeOfDay(this.clockT);
    this.player.health = Math.min(100, this.player.health + 25);
    this.player.stamina = 100;
    this.stats.days++;
    this.survival.stats.daysSurvived++;
    this.ui.chapter(`DAY ${this.stats.days}`, 'You slept through the night');
    this.audio.play('uiBig');
    this.writeSave();
  }

  toggleTorch() {
    if (this.survival.inv.count('torch') === 0) { this.ui.message('You have no torch. Craft one (1 stick · 1 cloth · 1 charcoal).'); return; }
    this.flags.torchOn = !this.flags.torchOn;
    if (this.flags.torchOn) this.survival.inv.add('torch', 0);
    this._torchEquipped = this.flags.torchOn;
  }

  quickUse(n) {
    const list = this.survival.inv.list();
    const s = list[n - 1];
    if (!s) return;
    const it = ITEMS[s.id];
    if (it.kind === 'food' || it.kind === 'med') this.survival.eat(s.id);
    else if (it.kind === 'drink') this.survival.drinkItem(s.id);
    else if (s.id === 'rod') this.fishing.equipRod();
    else if (s.id === 'torch') this.toggleTorch();
    else if (s.id === 'flare') this.fireFlare();
  }

  quickAction() {
    if (this.survival.inv.count('flare') > 0) this.fireFlare();
    else this.audio.play('ui');
  }

  fireFlare() {
    if (this.survival.inv.count('flare') === 0) { this.ui.message('No flares left.'); return; }
    this.survival.inv.remove('flare', 1);
    const p = this.player;
    const dir = new THREE.Vector3(Math.sin(p.yaw), 0.8, -Math.cos(p.yaw));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff6a2a }));
    mesh.position.copy(p.eye);
    this.scene.add(mesh);
    const vel = dir.multiplyScalar(28);
    this.projectiles = this.projectiles || [];
    this.projectiles.push({ mesh, vel, flare: true, life: 8 });
    this.flags.signalled = true;
    this.ui.message('Flare away! Rescue will see that.', 4);
    this.audio.play('shoot');
    // add a light to the flare projectile
    const light = new THREE.PointLight(0xff5522, 40, 260, 2);
    mesh.add(light);
  }

  /* ========================================================== event bridge */
  /** single funnel for gameplay-system events (Survival + Disasters) */
  onGameEvent(e) {
    if (!e || !e.type) return;
    switch (e.type) {
      case 'message': if (e.text) this.ui.message(e.text, 3.5); break;
      case 'eat': this.audio.play('eat'); break;
      case 'drink': this.audio.play('drink'); break;
      case 'craft': this.audio.play('craft'); break;
      case 'build': this.audio.play('build'); break;
      case 'catch': this.audio.play('uiBig'); break;
      case 'hurt': this.player.damage(e.amount || 8, e.source || 'hit'); this.audio.play('hurt'); this.ui.flash('bad'); break;
      case 'sick': this.ui.message('You feel sick…', 4); break;
      case 'tsunami-warning': this.ui.chapter('TSUNAMI', 'Get to high ground — NOW'); break;
      case 'wave-incoming': this.ui.flash('quake'); this.audio.play('rumble'); break;
      case 'shore-hit': this.disasters.shake.add(1.0); this.ui.flash('quake'); break;
      case 'city-flooded': this.ui.objective('Escape the flood — reach the upper town'); break;
      case 'flood-drain': this.ui.objective('Take the pick-up above town and drive up the mountain'); break;
      case 'tsunami-over':
        this.ui.chapter('AFTERMATH', 'More disasters will follow — survive');
        break;
      case 'quake': this.ui.flash('quake'); this.audio.play('quake'); break;
      case 'lightning': this.ui.flash('bad'); break;
      default: break;
    }
  }

  /* ================================================================= loop */
  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 1) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    if (this.state === 'title' || this.state === 'loading') { this.renderer.render(this.scene, this.camera); return; }
    this.update(dt);
    this.render(dt);
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.cinematicCam) { this.cinematicCam.aspect = w / h; this.cinematicCam.updateProjectionMatrix(); }
    if (this.post.enabled) this.post.setSize(w, h);
    else { this.renderer.setSize(w, h); }
  }

  update(dt) {
    this.time += dt;
    // ---- clock / sky
    this.clockT = (this.clockT + dt / this.dayLength) % 1;
    this.sky.setTimeOfDay(this.clockT);
    this.sky.update(dt, this.camera);
    // ---- input mapping
    const inp = this.readInput();
    // ---- player / vehicle
    if (this.state === 'cinematic') { this.updateCinematic(dt); }
    else {
      if (this.player.vehicle) {
        const v = this.player.vehicle;
        this.vehicles.update(dt, v, inp);
        this.player.pos.copy(v.pos);
        this.player.vel.copy(v.vel);
        // player damage on bad crashes
        if (v.crashEvent && performance.now() - v.crashEvent.t < 60) {
          const f = v.crashEvent.force;
          v.crashEvent = null;
          if (f > 10) { this.player.damage(Math.min(38, f * 1.4), 'crash'); this.audio.play('hurt'); this.disasters.shake.add(0.4); }
        }
      } else {
        this.player.update(dt, inp);
        this.vehicles.update(dt, null, {});
      }
    }
    // ---- systems
    this.fx.update(dt, this.camera, (x, z) => this.ocean.waterYAt(x, z));
    this.npc.update(dt, this.player, { panic: this.disasters.tsunami ? 0.9 : 0.2, tsunami: !!this.disasters.tsunami });
    const shake = this.disasters.update(dt, { player: this.player });
    this.updateProjectiles(dt);
    this.updateMissions(dt);
    if (this.state !== 'cinematic') this.updateFishing(dt, inp);
    // ---- camera
    this.updateCamera(dt, shake);
    // ---- ocean / sky sync
    this.ocean.update(dt, this.camera, this.player.pos);
    this.ocean.syncSky(this.sky);
    this.ocean.bakeProbe(this.renderer, this.scene, this.player.pos);
    if (this.world.terrainMaterial.userData.shader) {
      const u = this.world.terrainMaterial.userData.shader.uniforms;
      u.uWaterLevel.value = this.ocean.level;
      u.uMud.value = clamp01(this.ocean.level / 6);
    }
    // ---- waterfall animation
    if (this.waterfall) {
      const pos = this.waterfall.geometry.attributes.position;
      const base = this.waterfallBase;
      for (let i = 0; i < pos.count; i++) {
        const t = this.time * 3.2 + i;
        pos.setY(i, base[i * 3 + 1] + Math.sin(t) * 0.12);
        pos.setX(i, base[i * 3] + Math.cos(t * 0.7) * 0.08);
      }
      pos.needsUpdate = true;
    }
    // ---- audio mix
    const nearSea = Math.abs(this.player.pos.x - this.world.coastX(this.player.pos.z)) < 160;
    this.audio.update(dt, {
      nearSea, storm: this.sky.storm + (this.disasters.storm.active ? 0.6 : 0),
      rain: this.disasters.storm.active ? this.disasters.storm.intensity * (this.player.pos.y > 100 ? 0.7 : 1) : 0,
      flood: clamp01(this.ocean.level / 10),
      altitude: this.player.pos.y,
      forest: this.player.pos.y > 40 && this.player.pos.y < 300 ? 0.02 : 0,
      engine: this.player.vehicle ? { kind: this.player.vehicle.kind === 'car' ? 'car' : 'boat', rpm: this.player.vehicle.rpm } : null,
      danger: this.disasters.tsunami ? 1 : this.sky.storm,
      underwater: this.player.underwater,
      heartRate: true,
    });
    // ---- underwater occlusion
    this.underwater = this.player.underwater || (this.camera.position.y < this.ocean.waterYAt(this.camera.position.x, this.camera.position.z) && this.player.swimming);
    if (this.underwater && this.rng() < 0.4) this.fx.bubbles(this.camera.position.x + rand(this.rng, -0.4, 0.4), this.camera.position.y + 0.3, this.camera.position.z + rand(this.rng, -0.4, 0.4), 1);
    // ---- HUD
    const hh = Math.floor(this.clockT * 24) % 24;
    const mm = Math.floor(((this.clockT * 24) % 1) * 60);
    this.ui.update(dt, {
      player: this.player, fishing: this.fishing.hud(), world: this.world, vehicles: this.vehicles.vehicles,
      heroVehicle: this.vehicles.hero, flood: this.ocean.level, goal: this.currentGoal(), stats: this.stats,
      clock: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    });
    // ---- prompts
    if (this.state === 'play' && !this.ui.panelOpen) {
      const t = this.nearestInteractable();
      this.ui.prompt(t ? t.label : null);
    } else this.ui.prompt(null);
    // ---- death
    if (!this.player.alive) this.die();
  }

  currentGoal() {
    const m = this.missions[this.mission];
    if (!m || !m.goal) return this.goalMarker || null;
    try { return m.goal(); } catch (e) { return null; }
  }

  readInput() {
    if (this.ui.panelOpen || this.state !== 'play') {
      return { forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0, crouch: 0 };
    }
    // mouse look
    if (this.pointerLocked) {
      const sens = 0.0022;
      this.player.yaw += this.mouse.dx * sens;
      this.player.pitch = clamp(this.player.pitch - this.mouse.dy * sens, -1.35, 1.2);
      this.mouse.dx = 0; this.mouse.dy = 0;
    }
    const k = this.keys;
    const t = this.ui.touch.active ? this.ui.touchInput : null;
    const inp = {
      forward: !!(k['w'] || k['arrowup'] || (k['z'] && this.ui.lang === 'ar') || (t && t.forward)),
      back: !!(k['s'] || k['arrowdown'] || (t && t.back)),
      left: !!(k['a'] || k['arrowleft'] || (t && t.left)),
      right: !!(k['d'] || k['arrowright'] || (t && t.right)),
      jump: !!(k[' '] || (t && t.jump)),
      sprint: !!(k['shift'] || (t && t.sprint)),
      crouch: !!(k['c'] || (t && t.crouch)),
      handbrake: !!k[' '] && !!this.player.vehicle,
      use: !!this.keys['e'],
      attack: this.mouse.left || !!(t && t.attack),
      alt: this.mouse.right,
      strike: this.mouse.left,
      cast: this.mouse.left,
      giveLine: this.mouse.right || !!k['shift'],
    };
    if (t) this.player.yaw += t.lookX * 0.03;
    return inp;
  }

  updateFishing(dt, inp) {
    this.fishing.update(dt, {
      cast: !!this.mouse.left,
      strike: !!this.mouse.left,
      giveLine: !!this.mouse.right || !!this.keys['shift'],
    });
    void inp;
  }

  updateCamera(dt, shake) {
    const p = this.player;
    const cam = this.camera;
    if (this.state === 'cinematic') return;
    if (p.vehicle) {
      const v = p.vehicle;
      const back = (v.kind === 'car' ? 7.4 : 8.6) + Math.abs(v.speed) * 0.07;
      const up = v.kind === 'car' ? 3.0 : 3.8;
      const desired = new THREE.Vector3(
        v.pos.x - Math.sin(v.rot) * back, v.pos.y + up, v.pos.z - Math.cos(v.rot) * back);
      const g = this.world.heightAt(desired.x, desired.z);
      desired.y = Math.max(desired.y, g + 1.2);
      cam.position.lerp(desired, 1 - Math.exp(-7 * dt));
      const look = new THREE.Vector3(v.pos.x, v.pos.y + 1.5, v.pos.z).addScaledVector(
        new THREE.Vector3(Math.sin(v.rot), 0, Math.cos(v.rot)), Math.min(9, Math.abs(v.speed) * 0.35));
      cam.lookAt(look);
      cam.rotation.z += clamp(-v.steer * 0.06, -0.09, 0.09);
      cam.userData.focus.copy(v.pos);
    } else if (this.flags.thirdPerson) {
      const off = new THREE.Vector3(
        -Math.sin(p.yaw) * 4.4, 1.9, Math.cos(p.yaw) * 4.4);
      const eye = p.eye;
      const desired = eye.clone().add(off);
      const g = this.world.heightAt(desired.x, desired.z) + 0.5;
      if (desired.y < g) desired.y = g;
      cam.position.lerp(desired, 1 - Math.exp(-9 * dt));
      cam.lookAt(eye.x + Math.sin(p.yaw) * 2, eye.y + 0.2, eye.z - Math.cos(p.yaw) * 2);
      cam.userData.focus.copy(p.pos);
    } else {
      const eye = p.eye;
      cam.position.copy(eye);
      const roll = Math.sin(p.stepPhase) * 0.012 * clamp01(p.speed / 6) + Math.sin(this.time * 3.1) * 0.002;
      cam.rotation.set(0, 0, 0);
      cam.rotateY(-p.yaw);
      cam.rotateX(p.pitch);
      cam.rotateZ(roll + (p.swimming ? Math.sin(this.time * 2.2) * 0.03 : 0));
      cam.userData.focus.copy(p.pos);
    }
    // shake
    if (shake && shake.mag > 0.001) {
      cam.position.x += shake.x * 0.9;
      cam.position.y += shake.y * 0.9;
      cam.position.z += shake.z * 0.9;
      cam.rotateZ(shake.r * 0.12);
    }
    // motion feeling while sprinting
    if (!this.flags.thirdPerson && !p.vehicle) {
      const targetFov = 62 + clamp(p.speed - 4, 0, 6) * 1.4 + (this.underwater ? -4 : 0);
      cam.fov = damp(cam.fov, targetFov, 5, dt);
      cam.updateProjectionMatrix();
    }
  }

  render(dt) {
    const p = this.player;
    const sunDir = this.sky.sunDir.clone();
    // screen-space sun for the god rays
    const sp = sunDir.clone().multiplyScalar(4000).project(this.camera);
    const sunVisible = sp.z < 1 && Math.abs(sp.x) < 1.1 && Math.abs(sp.y) < 1.1 && sunDir.y > 0.03;
    const opts = {
      time: this.time,
      exposure: 1.02 + (this.underwater ? 0.12 : 0),
      bloom: 0.55 + this.sky.storm * 0.25,
      rays: sunVisible ? 0.5 : 0,
      sunScreen: new THREE.Vector2((sp.x + 1) / 2, (sp.y + 1) / 2),
      sunVisible,
      underwater: !!this.underwater,
      wet: clamp01((this.disasters.storm.active ? 0.55 : 0) + p.wet * 0.4),
      damage: clamp01(1 - p.health / 40) * (p.health < 40 ? 1 : 0),
      cold: clamp01(1 - p.warmth / 45) * (p.warmth < 45 ? 1 : 0),
      tint: this.disasters.tsunami && this.disasters.tsunamiPhase === 'flood' ? [0.94, 0.96, 1.0] : [1, 0.995, 0.985],
    };
    this.post.render(this.scene, this.camera, opts);
  }

  die() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.audio.play('death');
    this.ui.showDead('You survived ' + Math.floor(this.time / 60) + ' minutes.');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  finish() {
    this.state = 'ended';
    this.audio.play('win');
    this.ui.showEnd({
      'Time on the coast': `${Math.floor(this.time / 60)} min`,
      'Fish caught': this.survival.stats.fishCaught,
      'Townsfolk saved': this.npc.peopleSafe(),
      'Structures built': this.survival.stats.structuresBuilt,
      'Days survived': this.stats.days,
      'Quests completed': `${this.mission + 1}/${this.missions.length}`,
    });
    localStorage.removeItem('tsunami.save');
  }
}

function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }

/* A shader that fails to compile is silently skipped by three: the mesh just never draws.
   That is how "the ocean disappeared" happens, so put the compiler log on screen. */
function showShaderWarning(log) {
  try {
    let box = document.getElementById('glwarn');
    if (!box) {
      box = document.createElement('div');
      box.id = 'glwarn';
      box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;max-width:60vw;max-height:34vh;'
        + 'overflow:auto;padding:8px 10px;border-radius:8px;font:11px/1.35 ui-monospace,monospace;'
        + 'background:#3b0d0dee;color:#ffd9d9;border:1px solid #ff6b6b;white-space:pre-wrap';
      (document.body || document.documentElement).appendChild(box);
    }
    const short = log.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 3).join('\n') || log.slice(0, 300);
    box.textContent = `⚠ GLSL COMPILE ERROR (this mesh will not render)\n${short}`;
    box.style.display = 'block';
  } catch (e) { /* never break the boot because of a warning box */ }
}

const game = new Game();
window.TsunamiGame = game;
game.boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('err');
  if (el) { el.style.display = 'block'; el.textContent = 'Error: ' + (e && e.message ? e.message : e); }
});
