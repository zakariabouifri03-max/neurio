// ── Core Gameplay Engine: First-Person Walk, Car Physics, Fluids & Raycast ───
import * as THREE from 'three';
import {
  CAR_BY_ID,
  ENGINES,
  RADIATORS,
  ITEM_DEFS,
  RADIO_STATIONS,
  GRAPHICS_PRESETS,
  createItemInstance,
} from './data.js';
import {
  buildVehicle,
  buildItemMesh,
  buildDesertHare,
} from './builders.js';
import { smokeTexture } from './tex.js';
import { DesertWorld } from './world.js';
import { audio } from './audio.js';
import {
  clamp,
  lerp,
  angDiff,
  fmt1,
  roadX,
  roadY,
  roadHeading,
} from './util.js';

export class LongDriveGame {
  constructor(appHost, saveState, callbacks) {
    this.appHost = appHost;
    this.cb = callbacks;
    this._loadedFromSave = !!saveState;

    // Three.js Scene & Main Camera (1400m far plane for endless desert horizon)
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 1400);
    this.scene.add(this.camera);

    // Handheld Flashlight attached to player camera
    this.flashlight = new THREE.SpotLight(0xfffbeb, 0, 55, Math.PI / 4.2, 0.45, 1.2);
    this.flashlight.position.set(0.15, -0.1, 0);
    this.flashlight.target.position.set(0, -0.05, -10);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this.flashlightOn = false;

    // 1st-Person Hand Viewmodel Group attached to camera
    this.handGroup = new THREE.Group();
    this.handGroup.position.set(0.32, -0.28, -0.52);
    this.camera.add(this.handGroup);
    this._handBob = 0;
    this._handActionAnim = 0;

    // Raycaster for center crosshair inspection
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 4.6;
    this.hoveredInteract = null;

    // Dynamic entities
    this.vehicles = [];
    this.worldItems = [];
    this.hares = [];
    this.particles = [];
    this.skidMarks = [];
    this.skidMat = new THREE.MeshBasicMaterial({
      color: 0x111827,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    // Graphics & Physics Realism state
    this.inMainMenu = true;
    this._menuOrbitAngle = 0.4;
    this.baseFov = 74;
    this.physicsRealism = 'simulation'; // 'simulation' | 'arcade'

    // Particle sprite material for dust, steam, sparks & spray paint
    this.smokeTex = smokeTexture();

    // Player state
    this.mode = 'walk'; // 'walk' | 'drive'
    this.thirdPerson = false;
    this.zoomBinoculars = false;

    this.player = {
      x: -12.5,
      y: 0.08,
      z: 8.2,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0.45, // looking toward garage & starter car
      pitch: -0.06,
      onGround: true,
      crouching: false,
      health: 100,
      hunger: 92,
      thirst: 90,
      stamina: 100,
      hotbar: [
        createItemInstance('canteen', { amount: 2.5 }),
        createItemInstance('wire_brush', { uses: 30 }),
        null,
        null,
        null,
      ],
      activeSlot: 0,
    };

    // World & Time
    this.timeOfDay = 9.5; // 09:30 AM
    this.odometerKm = 0.0;
    this.bestKm = 0.0;
    this.activeCar = null;

    // Input state
    this.keys = {};
    this.lookDelta = { x: 0, y: 0 };
    this.mouseDown = false;
    this._stepDist = 0;
    this._actionCooldown = 0;

    // Build streaming desert world
    this.world = new DesertWorld(this.scene, this);

    if (saveState) {
      this._restoreFromSave(saveState);
    } else {
      // Spawn Starter Car DISASSEMBLED / BROKEN ("Kharbana") in the Garage Bay!
      // Player must install the Engine, Radiator, 2 missing Wheels, and pour Gas, Oil & Water!
      this.activeCar = this.spawnVehicle({
        archId: 'sedan',
        x: -13.6,
        y: 0.08,
        z: 13.8,
        heading: Math.PI / 2, // facing East (+X) out through the open garage bay door!
        paintHex: '#c94a38',
        condition: 0.35,
        fuel: 0.0,
        oil: 0.0,
        water: 0.0,
        engineId: null,     // Missing! Sitting on garage workbench
        radiatorId: null,   // Missing! Sitting on garage workbench
        hoodOpen: true,
        trunkOpen: true,
        wheels: [
          { installed: false, condition: 0.85 }, // Front-Left missing! On garage floor
          { installed: true, condition: 0.72 },
          { installed: true, condition: 0.70 },
          { installed: false, condition: 0.82 }, // Rear-Right missing! On garage floor
        ],
        trunk: [
          createItemInstance('chocolate'),
        ],
      });
    }

    this.world.updateChunks(this.player.z);
    this.rebuildHandViewmodel();
  }

  // ── Save / Restore State ───────────────────────────────────────────────────
  serializeSave() {
    const car = this.activeCar || this.vehicles[0];
    return {
      timeOfDay: this.timeOfDay,
      odometerKm: this.odometerKm,
      bestKm: Math.max(this.bestKm, this.odometerKm),
      player: {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        health: this.player.health,
        hunger: this.player.hunger,
        thirst: this.player.thirst,
        hotbar: this.player.hotbar,
        activeSlot: this.player.activeSlot,
      },
      car: car
        ? {
            archId: car.archId,
            x: car.x,
            y: car.y,
            z: car.z,
            heading: car.heading,
            paintHex: car.paintHex,
            condition: car.condition,
            fuel: car.fuel,
            oil: car.oil,
            water: car.water,
            engineId: car.engineId,
            engineCondition: car.engineCondition,
            radiatorId: car.radiatorId,
            radiatorCondition: car.radiatorCondition,
            wheels: car.wheels,
            trunk: car.trunk,
          }
        : null,
    };
  }

  _restoreFromSave(s) {
    try {
      this.timeOfDay = s.timeOfDay ?? 9.5;
      this.odometerKm = s.odometerKm ?? 0;
      this.bestKm = s.bestKm ?? this.odometerKm;
      if (s.player) {
        Object.assign(this.player, s.player);
      }
      if (s.car) {
        this.activeCar = this.spawnVehicle(s.car);
      }
      this.world._populateStarterCompound();
    } catch (err) {
      // Incompatible/corrupted save → wipe it and start a fresh road trip instead of crashing
      console.warn('Save restore failed — starting fresh:', err);
      try {
        localStorage.removeItem('the_long_drive_3d_v3');
      } catch (e2) { /* ignore */ }
      this.activeCar = this.spawnVehicle({
        archId: 'sedan',
        x: -13.6,
        y: 0.08,
        z: 13.8,
        heading: Math.PI / 2,
        paintHex: '#c94a38',
        condition: 0.35,
        fuel: 0.0,
        oil: 0.0,
        water: 0.0,
        engineId: null,
        radiatorId: null,
        hoodOpen: true,
        trunkOpen: true,
        wheels: [
          { installed: false, condition: 0.85 },
          { installed: true, condition: 0.72 },
          { installed: true, condition: 0.70 },
          { installed: false, condition: 0.82 },
        ],
        trunk: [createItemInstance('chocolate')],
      });
      this.timeOfDay = 9.5;
      this.odometerKm = 0;
      this.player.x = -12.5;
      this.player.y = 0.08;
      this.player.z = 8.2;
      this.player.hotbar = [
        createItemInstance('canteen', { amount: 2.5 }),
        createItemInstance('wire_brush', { uses: 30 }),
        null,
        null,
        null,
      ];
    }
  }

  // ── Entity Spawners ────────────────────────────────────────────────────────
  spawnVehicle(cfg) {
    const arch = CAR_BY_ID[cfg.archId] || CAR_BY_ID.sedan;
    const carState = {
      uid: 'car_' + Math.random().toString(36).slice(2, 8),
      archId: arch.id,
      name: arch.name,
      x: cfg.x ?? 0,
      y: cfg.y ?? 0.08,
      z: cfg.z ?? 12,
      heading: cfg.heading ?? 0,
      speed: 0, // m/s signed
      steerAngle: 0,
      pitchAngle: 0,
      rollAngle: 0,
      wheelSpin: 0,
      paintHex: cfg.paintHex || arch.defaultColor,
      condition: cfg.condition ?? 0.65,
      fuel: cfg.fuel ?? 16.0,
      oil: cfg.oil ?? 2.4,
      water: cfg.water ?? 5.5,
      tempC: 32,
      engineRunning: false,
      handbrake: true,
      headlights: 0, // 0=off, 1=low, 2=high
      doorLOpen: !!cfg.doorLOpen,
      doorROpen: !!cfg.doorROpen,
      hoodOpen: !!cfg.hoodOpen,
      trunkOpen: !!cfg.trunkOpen,
      _doorLAngle: 0,
      _doorRAngle: 0,
      _hoodAngle: 0,
      _trunkAngle: 0,
      engineId: cfg.engineId !== undefined ? cfg.engineId : arch.defaultEngine,
      engineCondition: cfg.engineCondition ?? 0.82,
      radiatorId: cfg.radiatorId !== undefined ? cfg.radiatorId : arch.defaultRadiator,
      radiatorCondition: cfg.radiatorCondition ?? 0.82,
      wheels: cfg.wheels || [
        { installed: true, condition: 0.85 },
        { installed: true, condition: 0.85 },
        { installed: true, condition: 0.85 },
        { installed: true, condition: 0.85 },
      ],
      trunk: cfg.trunk ? [...cfg.trunk] : [],
      mesh: null,
    };

    const meshRefs = buildVehicle(carState);
    meshRefs.root.position.set(carState.x, carState.y, carState.z);
    meshRefs.root.rotation.y = carState.heading;
    this.scene.add(meshRefs.root);
    this.vehicles.push(carState);
    return carState;
  }

  spawnWorldItem(item, x, y, z, vx = 0, vy = 0, vz = 0) {
    const mesh = buildItemMesh(item);
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;

    // Invisible larger hitbox for easy raycast picking
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.45, 0.45),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.y = 0.20;
    mesh.add(hit);

    const wItem = {
      item,
      mesh,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      resting: vx === 0 && vy === 0 && vz === 0,
    };

    mesh.traverse((c) => {
      c.userData.interact = { type: 'world_item', worldItem: wItem };
    });

    this.scene.add(mesh);
    this.worldItems.push(wItem);
    return wItem;
  }

  removeWorldItem(wItem) {
    const idx = this.worldItems.indexOf(wItem);
    if (idx >= 0) this.worldItems.splice(idx, 1);
    this.scene.remove(wItem.mesh);
  }

  spawnHare(x, y, z) {
    const mesh = buildDesertHare();
    mesh.position.set(x, y, z);
    const hare = {
      mesh,
      x,
      y,
      z,
      vx: 0,
      vz: 0,
      hp: 50,
      hopPhase: Math.random() * 6,
      attackCooldown: 0,
    };
    mesh.traverse((c) => {
      c.userData.interact = { type: 'hare', hare };
    });
    this.scene.add(mesh);
    this.hares.push(hare);
    return hare;
  }

  // ── 1st-Person Hand Viewmodel ──────────────────────────────────────────────
  getHeldItem() {
    return this.player.hotbar[this.player.activeSlot] || null;
  }

  selectSlot(slotIdx) {
    this.player.activeSlot = clamp(slotIdx, 0, 4);
    this.rebuildHandViewmodel();
    audio.click();
    this.cb.onHudUpdate();
  }

  rebuildHandViewmodel() {
    while (this.handGroup.children.length) {
      this.handGroup.remove(this.handGroup.children[0]);
    }
    if (this.mode === 'drive') return;
    const held = this.getHeldItem();
    if (!held) return;
    const m = buildItemMesh(held);
    m.scale.setScalar(0.68);
    m.rotation.y = -0.35;
    this.handGroup.add(m);
  }

  // ── Particle Spawner (Steam, Dust, Scrub Sparks, Paint Mist) ───────────────
  emitParticle(x, y, z, colorHex = 0xffffff, size = 0.45, vy = 1.2, life = 0.9) {
    if (this.particles.length > 75) return;
    const mat = new THREE.SpriteMaterial({
      map: this.smokeTex,
      color: colorHex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(
      x + (Math.random() - 0.5) * 0.25,
      y + (Math.random() - 0.5) * 0.15,
      z + (Math.random() - 0.5) * 0.25
    );
    sp.scale.setScalar(size);
    this.scene.add(sp);
    this.particles.push({
      sprite: sp,
      vx: (Math.random() - 0.5) * 0.6,
      vy: vy + Math.random() * 0.5,
      vz: (Math.random() - 0.5) * 0.6,
      age: 0,
      life,
      size0: size,
    });
  }

  // ── Enter / Exit Vehicle ───────────────────────────────────────────────────
  enterCar(car) {
    this.activeCar = car;
    this.mode = 'drive';
    car.doorLOpen = false;
    this.rebuildHandViewmodel();
    audio.door(false);

    // Auto-crank ignition if car has fuel & engine so player can drive right away
    if (!car.engineRunning && car.fuel > 0.05 && car.engineId) {
      this.toggleIgnition();
    } else if (!car.engineId) {
      this.cb.toast('⚠️ No engine installed! Open the hood to install an engine.', true);
    } else if (car.fuel <= 0.05) {
      this.cb.toast('⛽ Fuel tank is empty! Pour gasoline into the rear-left filler cap.', true);
    }
    this.cb.onHudUpdate();
  }

  exitCar() {
    if (this.mode !== 'drive' || !this.activeCar) return;
    const car = this.activeCar;
    const arch = CAR_BY_ID[car.archId] || CAR_BY_ID.sedan;
    this.mode = 'walk';
    this.thirdPerson = false;

    // Place player outside the driver's door (+X in car local frame)
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    const localX = arch.width * 0.5 + 0.95;
    const localZ = 0.1;
    this.player.x = car.x + localX * cos + localZ * sin;
    this.player.z = car.z - localX * sin + localZ * cos;
    this.player.y = this.world.getGroundHeight(this.player.x, this.player.z);
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
    this.player.yaw = car.heading - Math.PI * 0.5; // face the car
    this.player.pitch = -0.1;

    car.doorLOpen = true;
    audio.door(true);
    this.rebuildHandViewmodel();
    this.cb.onHudUpdate();
  }

  toggleIgnition() {
    const car = this.activeCar;
    if (!car) return;
    if (car.engineRunning) {
      car.engineRunning = false;
      audio.click();
      this.cb.toast('🔑 Engine turned OFF');
    } else {
      const wheelCount = car.wheels.filter((w) => w.installed).length;
      const engBroken = (car.engineCondition ?? 0.8) < 0.25;
      const canStart =
        !!car.engineId &&
        !engBroken &&
        wheelCount >= 3 &&
        car.fuel > 0.05 &&
        car.oil > 0.05 &&
        car.tempC < 120;
      audio.starterCrank(canStart);
      if (canStart) {
        car.engineRunning = true;
        car.handbrake = false; // auto-release handbrake on start for smooth driving
        this.cb.toast('🔑 Engine started! [W/S] Drive • [Space] Handbrake • [L] Lights • [R] Radio');
      } else if (!car.engineId) {
        this.cb.toast('⚠️ Cannot start: Missing Engine! Install an engine under the hood (or via [Tab] Mechanic).', true);
      } else if (engBroken) {
        this.cb.toast('🔧 Engine is broken/wrecked! Repair it with a Mechanic Wrench Kit [🔧] or swap in another engine.', true);
      } else if (wheelCount < 3) {
        this.cb.toast(`🛞 Cannot drive: Only ${wheelCount}/4 wheels mounted! Mount the missing wheels first.`, true);
      } else if (car.fuel <= 0.05) {
        this.cb.toast('⛽ Starter cranks, but Fuel Tank is empty (0.0L)! Pour gasoline from a Jerrycan.', true);
      } else if (car.oil <= 0.05) {
        this.cb.toast('🛢️ Engine dry: 0.0L Motor Oil! Pour motor oil into the engine under the hood.', true);
      } else {
        this.cb.toast('🌡️ Engine is overheated! Let it cool or add radiator water.', true);
      }
    }
    this.cb.onHudUpdate();
  }

  cycleHeadlights() {
    if (this.mode === 'drive' && this.activeCar) {
      const car = this.activeCar;
      car.headlights = (car.headlights + 1) % 3;
      audio.click();
      const labels = ['Headlights: OFF', 'Headlights: LOW BEAM', 'Headlights: HIGH BEAM'];
      this.cb.toast('💡 ' + labels[car.headlights]);
      this.cb.onHudUpdate();
    } else {
      this.flashlightOn = !this.flashlightOn;
      this.flashlight.intensity = this.flashlightOn ? 4.5 : 0;
      audio.click();
      this.cb.toast(this.flashlightOn ? '🔦 Flashlight ON' : '🔦 Flashlight OFF');
    }
  }

  flipCarUpright() {
    const car = this.activeCar || this.vehicles[0];
    if (!car) return;
    const rx = roadX(car.z);
    const distToRoad = Math.abs(car.x - rx);
    if (distToRoad < 35) {
      car.x = rx - 2.1; // right lane
      car.heading = roadHeading(car.z);
    }
    car.y = this.world.getGroundHeight(car.x, car.z) + 0.1;
    car.speed = 0;
    car.pitchAngle = 0;
    car.rollAngle = 0;
    audio.wrench();
    this.cb.toast('🔄 Vehicle recovered upright onto the road!');
  }

  // ── Inventory & Item Actions ───────────────────────────────────────────────
  pickupItem(wItem) {
    const itm = wItem.item;
    // Find empty hotbar slot, or use activeSlot if empty
    let slot = this.player.hotbar[this.player.activeSlot] === null ? this.player.activeSlot : -1;
    if (slot === -1) {
      slot = this.player.hotbar.findIndex((s) => s === null);
    }
    if (slot === -1) {
      // Drop current activeSlot item and replace
      this.dropHeldItem();
      slot = this.player.activeSlot;
    }
    this.player.hotbar[slot] = itm;
    this.player.activeSlot = slot;
    this.removeWorldItem(wItem);
    audio.pickup();
    this.rebuildHandViewmodel();
    this.cb.toast(`${itm.icon} Picked up <b>${itm.name}</b>`);
    this.cb.onHudUpdate();
  }

  dropHeldItem(throwForce = 1.8) {
    const itm = this.getHeldItem();
    if (!itm || this.mode === 'drive') return;
    this.player.hotbar[this.player.activeSlot] = null;

    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );
    const sx = this.player.x + dir.x * 1.1;
    const sy = this.player.y + 1.25 + dir.y * 0.5;
    const sz = this.player.z + dir.z * 1.1;

    this.spawnWorldItem(itm, sx, sy, sz, dir.x * throwForce, Math.max(1.2, dir.y * throwForce + 1.5), dir.z * throwForce);
    audio.click();
    this.rebuildHandViewmodel();
    this.cb.onHudUpdate();
  }

  consumeItem(itm, fromSlotIdx = null) {
    const def = ITEM_DEFS[itm.defId];
    if (!def) return false;

    if (def.category === 'food') {
      this.player.hunger = clamp(this.player.hunger + (def.hunger || 0), 0, 100);
      this.player.thirst = clamp(this.player.thirst + (def.thirst || 0), 0, 100);
      this.player.health = clamp(this.player.health + (def.health || 0), 0, 100);
      if (def.thirst > 20) audio.drink();
      else audio.eat();
      this.cb.toast(`${itm.icon} Consumed <b>${itm.name}</b>`);
      if (fromSlotIdx !== null) {
        this.player.hotbar[fromSlotIdx] = null;
        this.rebuildHandViewmodel();
      }
      this.cb.onHudUpdate();
      return true;
    }

    if (itm.fluidType === 'water' && itm.amount > 0.05) {
      const sip = Math.min(0.5, itm.amount);
      itm.amount = Math.round((itm.amount - sip) * 100) / 100;
      this.player.thirst = clamp(this.player.thirst + sip * 75, 0, 100);
      this.player.health = clamp(this.player.health + 5, 0, 100);
      audio.drink();
      this.cb.toast(`💧 Drank water (${fmt1(itm.amount)} L left)`);
      this.cb.onHudUpdate();
      return true;
    }
    return false;
  }

  // ── Primary [E] & Secondary [F / Click] Raycast Interactions ───────────────
  handleInteractKey(keyType = 'E') {
    if (this.mode === 'drive') {
      if (keyType === 'E') {
        this.exitCar();
      } else if (keyType === 'F') {
        const st = audio.nextStation();
        this.cb.toast(`📻 Tuned to <b>${st.freq} — ${st.name}</b>`);
        this.cb.onHudUpdate();
      }
      return;
    }

    const hit = this.hoveredInteract;
    const held = this.getHeldItem();

    // If pressing F with food/water in hand and not looking at a car fluid cap, consume it!
    if (keyType === 'F' && held) {
      const isFluidTarget =
        hit &&
        (hit.type === 'car_fuel_cap' ||
          hit.type === 'car_engine' ||
          hit.type === 'car_radiator' ||
          hit.type === 'car_trunk_bay' ||
          hit.type === 'water_pump' ||
          hit.type === 'fuel_pump');
      if (!isFluidTarget) {
        if (this.consumeItem(held, this.player.activeSlot)) {
          this._handActionAnim = 0.45;
          return;
        }
      }
    }

    if (!hit) return;
    if (hit.car) this.activeCar = hit.car;

    switch (hit.type) {
      case 'world_item': {
        if (keyType === 'E') {
          this.pickupItem(hit.worldItem);
        } else if (keyType === 'F') {
          if (this.consumeItem(hit.worldItem.item, null)) {
            if (ITEM_DEFS[hit.worldItem.item.defId]?.category === 'food') {
              this.removeWorldItem(hit.worldItem);
            }
          } else {
            this.pickupItem(hit.worldItem);
          }
        }
        break;
      }

      case 'mom_letter': {
        audio.click();
        this.cb.openMomLetter();
        break;
      }

      case 'bed': {
        this.timeOfDay = (this.timeOfDay + 6) % 24;
        this.player.health = 100;
        this.player.stamina = 100;
        audio.pickup();
        this.cb.toast('🛏️ Slept 6 hours. Health & Stamina fully restored!');
        this.cb.onHudUpdate();
        break;
      }

      case 'water_pump': {
        if (held && held.fluidType === 'water') {
          held.amount = held.capacity;
          audio.glug();
          this.cb.toast(`💧 Filled <b>${held.name}</b> to ${fmt1(held.capacity)} L!`);
        } else {
          this.player.thirst = 100;
          this.player.health = clamp(this.player.health + 10, 0, 100);
          audio.drink();
          this.cb.toast('💧 Drank cool desert well water! Thirst 100%');
        }
        this.cb.onHudUpdate();
        break;
      }

      case 'fuel_pump': {
        if (hit.fuelLeft <= 0.1) {
          this.cb.toast('⛽ Pump is dry (0.0 L remaining)', true);
          break;
        }
        if (held && held.fluidType === 'gas') {
          const need = held.capacity - held.amount;
          const transfer = Math.min(need, hit.fuelLeft, 5.0);
          if (transfer > 0.05) {
            held.amount = Math.round((held.amount + transfer) * 10) / 10;
            hit.fuelLeft = Math.round((hit.fuelLeft - transfer) * 10) / 10;
            audio.glug();
            this.cb.toast(`⛽ Pumped +${fmt1(transfer)}L into Jerrycan (${fmt1(held.amount)}/${held.capacity}L)`);
          } else {
            this.cb.toast('⛽ Jerrycan is already full!');
          }
        } else if (this.activeCar && Math.hypot(this.activeCar.x - this.player.x, this.activeCar.z - this.player.z) < 8) {
          const arch = CAR_BY_ID[this.activeCar.archId];
          const need = arch.fuelCap - this.activeCar.fuel;
          const transfer = Math.min(need, hit.fuelLeft, 8.0);
          if (transfer > 0.05) {
            this.activeCar.fuel = Math.round((this.activeCar.fuel + transfer) * 10) / 10;
            hit.fuelLeft = Math.round((hit.fuelLeft - transfer) * 10) / 10;
            audio.glug();
            this.cb.toast(`⛽ Pumped +${fmt1(transfer)}L directly into ${this.activeCar.name}!`);
          } else {
            this.cb.toast('⛽ Car fuel tank is already full!');
          }
        } else {
          this.cb.toast('⛽ Hold a Gasoline Jerrycan or park your car next to the pump!', true);
        }
        this.cb.onHudUpdate();
        break;
      }

      case 'car_door': {
        const car = hit.car;
        if (keyType === 'E') {
          if (hit.side === 'L') car.doorLOpen = !car.doorLOpen;
          else car.doorROpen = !car.doorROpen;
          audio.door(hit.side === 'L' ? car.doorLOpen : car.doorROpen);
        } else if (keyType === 'F') {
          this.enterCar(car);
        }
        break;
      }

      case 'car_seat': {
        this.enterCar(hit.car);
        break;
      }

      case 'car_radio': {
        if (keyType === 'E') {
          const st = audio.nextStation();
          this.cb.toast(`📻 Radio: <b>${st.freq} — ${st.name}</b>`);
        } else {
          const on = audio.toggleRadio();
          this.cb.toast(on ? '📻 Radio Power ON' : '📻 Radio Power OFF');
        }
        this.cb.onHudUpdate();
        break;
      }

      case 'car_hood': {
        const car = hit.car;
        car.hoodOpen = !car.hoodOpen;
        audio.door(car.hoodOpen);
        break;
      }

      case 'car_trunk': {
        const car = hit.car;
        car.trunkOpen = !car.trunkOpen;
        audio.door(car.trunkOpen);
        break;
      }

      case 'car_trunk_bay': {
        const car = hit.car;
        const arch = CAR_BY_ID[car.archId];
        if (!car.trunkOpen) {
          car.trunkOpen = true;
          audio.door(true);
          break;
        }
        if (held) {
          if (car.trunk.length >= arch.trunkSlots) {
            this.cb.toast('📦 Trunk is full!', true);
            break;
          }
          car.trunk.push(held);
          this.player.hotbar[this.player.activeSlot] = null;
          car.mesh.syncParts();
          this.rebuildHandViewmodel();
          audio.pickup();
          this.cb.toast(`📦 Stowed <b>${held.name}</b> in trunk (${car.trunk.length}/${arch.trunkSlots})`);
          this.cb.onHudUpdate();
        } else {
          this.cb.openInspectorModal();
        }
        break;
      }

      case 'trunk_item': {
        const car = hit.car;
        const idx = hit.trunkIndex;
        const itm = car.trunk[idx];
        if (itm) {
          let slot = this.player.hotbar[this.player.activeSlot] === null ? this.player.activeSlot : -1;
          if (slot === -1) slot = this.player.hotbar.findIndex((s) => s === null);
          if (slot === -1) {
            this.cb.toast('🎒 Hotbar full! Drop or stow an item first.', true);
            break;
          }
          car.trunk.splice(idx, 1);
          this.player.hotbar[slot] = itm;
          this.player.activeSlot = slot;
          car.mesh.syncParts();
          this.rebuildHandViewmodel();
          audio.pickup();
          this.cb.toast(`🎒 Took <b>${itm.name}</b> from trunk`);
          this.cb.onHudUpdate();
        }
        break;
      }

      case 'car_fuel_cap': {
        const car = hit.car;
        const arch = CAR_BY_ID[car.archId];
        if (held && held.fluidType === 'gas' && held.amount > 0.05) {
          const space = arch.fuelCap - car.fuel;
          const pour = Math.min(space, held.amount, 4.0);
          if (pour > 0.02) {
            car.fuel = Math.round((car.fuel + pour) * 10) / 10;
            held.amount = Math.round((held.amount - pour) * 10) / 10;
            this._handActionAnim = 0.4;
            audio.glug();
            this.cb.toast(`⛽ Poured +${fmt1(pour)}L Gasoline (Tank: ${fmt1(car.fuel)}/${arch.fuelCap}L)`);
          } else {
            this.cb.toast('⛽ Fuel tank is full!');
          }
        } else if (held && held.defId === 'siphon_hose') {
          // Siphon fuel out of this car into any gas container in hotbar
          const gasCan = this.player.hotbar.find((s) => s && s.fluidType === 'gas' && s.amount < s.capacity);
          if (gasCan && car.fuel > 0.2) {
            const take = Math.min(car.fuel, gasCan.capacity - gasCan.amount, 5.0);
            car.fuel = Math.round((car.fuel - take) * 10) / 10;
            gasCan.amount = Math.round((gasCan.amount + take) * 10) / 10;
            audio.glug();
            this.cb.toast(`➰ Siphoned ${fmt1(take)}L into ${gasCan.name}!`);
          } else if (!gasCan) {
            this.cb.toast('➰ Keep an non-full Gasoline Jerrycan in your hotbar to siphon into!', true);
          } else {
            this.cb.toast('⛽ This tank is bone dry.');
          }
        } else {
          this.cb.toast(`⛽ Fuel Tank: ${fmt1(car.fuel)} / ${arch.fuelCap} L. Hold a Gasoline Jerrycan & press [F] to pour!`);
        }
        this.cb.onHudUpdate();
        break;
      }

      case 'car_engine': {
        const car = hit.car;
        if (!car.hoodOpen) {
          car.hoodOpen = true;
          audio.door(true);
          break;
        }
        const eng = ENGINES[car.engineId];
        if (held && held.fluidType === 'oil' && held.amount > 0.05 && eng) {
          const space = eng.oilCap - car.oil;
          const pour = Math.min(space, held.amount, 1.0);
          if (pour > 0.02) {
            car.oil = Math.round((car.oil + pour) * 10) / 10;
            held.amount = Math.round((held.amount - pour) * 10) / 10;
            this._handActionAnim = 0.4;
            audio.glug();
            this.cb.toast(`🛢️ Added +${fmt1(pour)}L Motor Oil (${fmt1(car.oil)}/${eng.oilCap}L)`);
          } else {
            this.cb.toast('🛢️ Engine oil is already at the full mark!');
          }
        } else if (held && held.partSlot === 'engine') {
          // Swap or install engine
          const oldEngId = car.engineId;
          const oldCond = car.engineCondition;
          car.engineId = held.engineId || 'eng_i4_1200';
          car.engineCondition = held.condition ?? 0.9;
          car.engineRunning = false;
          if (oldEngId) {
            const oldDefId =
              oldEngId === 'eng_v8_5000'
                ? 'part_engine_v8'
                : oldEngId === 'eng_diesel_6500'
                ? 'part_engine_diesel'
                : oldEngId === 'eng_i4_1800'
                ? 'part_engine_i4'
                : 'part_engine_std';
            this.player.hotbar[this.player.activeSlot] = createItemInstance(oldDefId, {
              engineId: oldEngId,
              condition: oldCond,
            });
          } else {
            this.player.hotbar[this.player.activeSlot] = null;
          }
          car.mesh.syncParts();
          this.rebuildHandViewmodel();
          audio.wrench();
          this.cb.toast(`⚙️ Installed <b>${ENGINES[car.engineId].name}</b>!`);
        } else if (keyType === 'F' && car.engineId && !held) {
          // Detach engine into empty hand slot
          const oldEngId = car.engineId;
          const oldDefId =
            oldEngId === 'eng_v8_5000'
              ? 'part_engine_v8'
              : oldEngId === 'eng_diesel_6500'
              ? 'part_engine_diesel'
              : oldEngId === 'eng_i4_1800'
              ? 'part_engine_i4'
              : 'part_engine_std';
          this.player.hotbar[this.player.activeSlot] = createItemInstance(oldDefId, {
            engineId: oldEngId,
            condition: car.engineCondition,
          });
          car.engineId = null;
          car.engineRunning = false;
          car.mesh.syncParts();
          this.rebuildHandViewmodel();
          audio.wrench();
          this.cb.toast('⚙️ Detached Engine Block');
        } else if (eng) {
          this.cb.toast(`⚙️ ${eng.name} (${eng.hp} HP) • Oil: ${fmt1(car.oil)}/${eng.oilCap}L`);
        } else {
          this.cb.toast('⚙️ Engine Bay is empty! Hold an Engine Block and press [F] to install.');
        }
        this.cb.onHudUpdate();
        break;
      }

      case 'car_radiator': {
        const car = hit.car;
        if (!car.hoodOpen) {
          car.hoodOpen = true;
          audio.door(true);
          break;
        }
        const rad = RADIATORS[car.radiatorId];
        if (held && held.fluidType === 'water' && held.amount > 0.05 && rad) {
          const space = rad.waterCap - car.water;
          const pour = Math.min(space, held.amount, 2.5);
          if (pour > 0.02) {
            car.water = Math.round((car.water + pour) * 10) / 10;
            held.amount = Math.round((held.amount - pour) * 10) / 10;
            car.tempC = Math.max(38, car.tempC - pour * 8);
            this._handActionAnim = 0.4;
            audio.glug();
            this.cb.toast(`💧 Poured +${fmt1(pour)}L Coolant Water (${fmt1(car.water)}/${rad.waterCap}L)`);
          } else {
            this.cb.toast('💧 Radiator is already full to the cap!');
          }
        } else if (held && held.partSlot === 'radiator') {
          const oldRadId = car.radiatorId;
          const oldCond = car.radiatorCondition;
          car.radiatorId = held.radiatorId || 'rad_std';
          car.radiatorCondition = held.condition ?? 0.9;
          if (oldRadId) {
            const oldDefId = oldRadId === 'rad_heavy' ? 'part_radiator_heavy' : 'part_radiator_std';
            this.player.hotbar[this.player.activeSlot] = createItemInstance(oldDefId, {
              radiatorId: oldRadId,
              condition: oldCond,
            });
          } else {
            this.player.hotbar[this.player.activeSlot] = null;
          }
          car.mesh.syncParts();
          this.rebuildHandViewmodel();
          audio.wrench();
          this.cb.toast(`🌡️ Installed <b>${RADIATORS[car.radiatorId].name}</b>!`);
        } else if (keyType === 'F' && car.radiatorId && !held) {
          const oldRadId = car.radiatorId;
          const oldDefId = oldRadId === 'rad_heavy' ? 'part_radiator_heavy' : 'part_radiator_std';
          this.player.hotbar[this.player.activeSlot] = createItemInstance(oldDefId, {
            radiatorId: oldRadId,
            condition: car.radiatorCondition,
          });
          car.radiatorId = null;
          car.mesh.syncParts();
          this.rebuildHandViewmodel();
          audio.wrench();
          this.cb.toast('🌡️ Detached Radiator');
        } else if (rad) {
          this.cb.toast(`💧 ${rad.name} • Water: ${fmt1(car.water)}/${rad.waterCap}L • Temp: ${Math.round(car.tempC)}°C`);
        }
        this.cb.onHudUpdate();
        break;
      }

      case 'car_wheel': {
        const car = hit.car;
        const wIdx = hit.wheelIndex;
        const wSlot = car.wheels[wIdx];
        if (held && held.partSlot === 'wheel') {
          const wasInstalled = wSlot.installed;
          const oldCond = wSlot.condition;
          wSlot.installed = true;
          wSlot.condition = held.condition ?? 0.9;
          if (wasInstalled) {
            this.player.hotbar[this.player.activeSlot] = createItemInstance('part_wheel', { condition: oldCond });
          } else {
            this.player.hotbar[this.player.activeSlot] = null;
          }
          car.mesh.syncParts();
          this.rebuildHandViewmodel();
          audio.wrench();
          this.cb.toast(`🛞 Installed ${hit.label} Wheel (${Math.round(wSlot.condition * 100)}%)`);
        } else if (keyType === 'F' && wSlot.installed && !held) {
          wSlot.installed = false;
          this.player.hotbar[this.player.activeSlot] = createItemInstance('part_wheel', {
            condition: wSlot.condition,
          });
          car.mesh.syncParts();
          this.rebuildHandViewmodel();
          audio.wrench();
          this.cb.toast(`🛞 Detached ${hit.label} Wheel`);
        } else {
          this.cb.toast(
            wSlot.installed
              ? `🛞 ${hit.label} Tire: ${Math.round(wSlot.condition * 100)}% condition ([F] with empty hand to remove)`
              : `🛞 ${hit.label} Hub is empty! Hold a Wheel & press [F] to mount.`
          );
        }
        this.cb.onHudUpdate();
        break;
      }
    }
  }

  // ── Left-Click Tool / Weapon Action (Wire Brush, Spray Paint, Revolver, Fluid Pour) ──
  useHeldToolPrimary() {
    if (this.mode === 'drive' || this._actionCooldown > 0) return;
    const held = this.getHeldItem();
    const hit = this.hoveredInteract;

    if (!held) {
      if (hit) this.handleInteractKey('E');
      return;
    }

    // 1. Revolver Shooting
    if (held.defId === 'revolver') {
      this._actionCooldown = 0.32;
      if (held.ammo <= 0) {
        audio.click();
        this.cb.toast('🔫 Click! Out of .357 ammo.', true);
        return;
      }
      held.ammo--;
      this._handActionAnim = 0.55;
      audio.shoot();
      this.cb.onHudUpdate();

      // Long-range raycast for shooting desert hares / targets (up to 45m)
      const shootRay = new THREE.Raycaster();
      shootRay.far = 45;
      shootRay.setFromCamera(new THREE.Vector2(0, 0), this.camera);
      const hareMeshes = this.hares.map((h) => h.mesh);
      const hits = shootRay.intersectObjects(hareMeshes, true);
      if (hits.length > 0) {
        const pt = hits[0].point;
        this.emitParticle(pt.x, pt.y, pt.z, 0xdc2626, 0.4, 1.5, 0.5);
        let obj = hits[0].object;
        while (obj && !obj.userData?.interact?.hare) obj = obj.parent;
        const hare = obj?.userData?.interact?.hare;
        if (hare) {
          hare.hp -= 60;
          audio.rabbitHit();
          if (hare.hp <= 0) {
            this.scene.remove(hare.mesh);
            this.hares.splice(this.hares.indexOf(hare), 1);
            // Drop bonus salami meat!
            this.spawnWorldItem(createItemInstance('salami'), hare.x, hare.y + 0.2, hare.z);
            this.cb.toast('🎯 Eliminated rabid desert hare!');
          }
        }
      }
      return;
    }

    // 2. Mechanic Wrench & Parts Kit (Repairs broken engines, radiators, wheels & chassis!)
    if (held.defId === 'repair_kit' && hit && hit.car) {
      this._actionCooldown = 0.28;
      this._handActionAnim = 0.45;
      const car = hit.car;
      this.activeCar = car;
      audio.wrench();
      car.engineCondition = clamp((car.engineCondition ?? 0.2) + 0.55, 0, 1);
      car.radiatorCondition = clamp((car.radiatorCondition ?? 0.2) + 0.55, 0, 1);
      car.condition = clamp((car.condition ?? 0.3) + 0.35, 0, 1);
      car.wheels.forEach((w) => {
        if (w.installed) w.condition = clamp((w.condition ?? 0.5) + 0.45, 0, 1);
      });
      held.uses = Math.max(0, (held.uses ?? 5) - 1);
      if (held.uses <= 0) {
        this.player.hotbar[this.player.activeSlot] = null;
        this.rebuildHandViewmodel();
      }
      car.mesh.syncParts();
      this.emitParticle(car.x, car.y + 1.0, car.z, 0xfbbf24, 0.45, 1.2, 0.55);
      this.cb.toast(
        `🔧 Repaired <b>${car.name}</b>! (Engine: ${Math.round(car.engineCondition * 100)}%, Body: ${Math.round(
          car.condition * 100
        )}%)`
      );
      this.cb.onHudUpdate();
      return;
    }

    // 3. Wire Brush Rust Removal
    if (held.defId === 'wire_brush' && hit && hit.car) {
      this._actionCooldown = 0.16;
      this._handActionAnim = 0.35;
      const car = hit.car;
      audio.scrub();
      car.condition = clamp((car.condition ?? 0.6) + 0.08, 0, 1);
      car.engineCondition = clamp((car.engineCondition ?? 0.8) + 0.06, 0, 1);
      car.radiatorCondition = clamp((car.radiatorCondition ?? 0.8) + 0.06, 0, 1);
      car.mesh.syncParts();
      this.emitParticle(car.x, car.y + 0.9, car.z, 0xb45309, 0.35, 0.8, 0.5);
      if (car.condition >= 0.99) {
        this.cb.toast('✨ Car polished to 100% Mint Condition!');
      }
      this.cb.onHudUpdate();
      return;
    }

    // 3. Aerosol Spray Paint Respray
    if (held.defId === 'spray_paint' && hit && hit.car) {
      this._actionCooldown = 0.22;
      this._handActionAnim = 0.35;
      const car = hit.car;
      audio.spray();
      car.paintHex = held.paintHex || '#2b6cb0';
      car.condition = clamp((car.condition ?? 0.6) + 0.04, 0, 1);
      car.mesh.syncParts();
      this.emitParticle(car.x, car.y + 1.0, car.z, new THREE.Color(car.paintHex).getHex(), 0.5, 0.6, 0.6);
      this.cb.toast(`🎨 Resprayed ${car.name} with ${held.name}!`);
      this.cb.onHudUpdate();
      return;
    }

    // 4. Otherwise trigger secondary [F] action (pour fluid, eat food, install part)
    this._actionCooldown = 0.22;
    this.handleInteractKey('F');
  }

  // ── Main Frame Update ──────────────────────────────────────────────────────
  update(dt) {
    this._actionCooldown = Math.max(0, this._actionCooldown - dt);
    this._handActionAnim = Math.max(0, this._handActionAnim - dt * 2.2);

    // Advance 24h Day/Night cycle slowly (1 game hour = ~75 real seconds)
    this.timeOfDay = (this.timeOfDay + dt * (1 / 75)) % 24;

    // Survival metabolism (gentle so it feels engaging, never frustrating)
    this.player.thirst = clamp(this.player.thirst - dt * 0.085, 0, 100);
    this.player.hunger = clamp(this.player.hunger - dt * 0.055, 0, 100);
    if (this.player.thirst <= 0 || this.player.hunger <= 0) {
      this.player.health = clamp(this.player.health - dt * 0.6, 15, 100);
    }

    // Binoculars zoom FOV + Speed-based dynamic FOV warp
    const held = this.getHeldItem();
    const wantZoom = this.zoomBinoculars || (held && held.defId === 'binoculars' && this.keys['KeyF']);
    const carSpdKmh = this.mode === 'drive' && this.activeCar ? Math.abs(this.activeCar.speed) * 3.6 : 0;
    const speedFovBoost = clamp((carSpdKmh - 40) * 0.08, 0, 10);
    const targetFov = wantZoom
      ? 16
      : this.mode === 'drive' && !this.thirdPerson
      ? this.baseFov + 3 + speedFovBoost
      : this.baseFov + speedFovBoost * 0.6;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = lerp(this.camera.fov, targetFov, dt * 10);
      this.camera.updateProjectionMatrix();
    }

    // If in Main Menu, smoothly orbit camera around the desert starter compound & highway
    if (this.inMainMenu) {
      this._menuOrbitAngle += dt * 0.14;
      const cx = -11.5 + Math.cos(this._menuOrbitAngle) * 18.5;
      const cz = 12.0 + Math.sin(this._menuOrbitAngle) * 18.5;
      const cy = Math.max(this.world.getGroundHeight(cx, cz) + 2.5, 4.8 + Math.sin(this._menuOrbitAngle * 0.7) * 1.4);
      this.camera.position.set(cx, cy, cz);
      this.camera.lookAt(-13.5, 1.4, 13.0);
      this.handGroup.visible = false;
      for (const car of this.vehicles) {
        this._updateVehicleVisuals(car, dt);
      }
      this.world.updateChunks(12);
      this.world.updateAtmosphere(new THREE.Vector3(-12, 1, 12), this.timeOfDay);
      return;
    }
    this.handGroup.visible = this.mode === 'walk';

    if (this.mode === 'walk') {
      this._updateWalk(dt);
    } else if (this.mode === 'drive' && this.activeCar) {
      this._updateDrive(dt);
    }

    // Update all vehicles (hinge animations, gauges, steam, lights)
    for (const car of this.vehicles) {
      this._updateVehicleVisuals(car, dt);
    }

    // Update physics of dropped world items
    this._updateWorldItems(dt);

    // Update Mutant Desert Hares
    this._updateHares(dt);

    // Update particles
    this._updateParticles(dt);

    // Stream highway chunks & update sky/sun/moon around active focus position
    const focusX = this.mode === 'drive' && this.activeCar ? this.activeCar.x : this.player.x;
    const focusY = this.mode === 'drive' && this.activeCar ? this.activeCar.y : this.player.y;
    const focusZ = this.mode === 'drive' && this.activeCar ? this.activeCar.z : this.player.z;

    this.world.updateChunks(focusZ);
    this.world.updateAtmosphere(new THREE.Vector3(focusX, focusY, focusZ), this.timeOfDay);

    // Radio audible when inside car or within 14m of activeCar
    const carDist = this.activeCar
      ? Math.hypot(this.activeCar.x - focusX, this.activeCar.z - focusZ)
      : 999;
    audio.radioAudible = this.mode === 'drive' || carDist < 16;

    // Continuous left-click tool hold (for wire brush / spray paint / pouring)
    if (this.mouseDown && this._actionCooldown <= 0 && held && held.defId !== 'revolver') {
      this.useHeldToolPrimary();
    }
  }

  // ── On-Foot Walking & Raycast Inspection ───────────────────────────────────
  _updateWalk(dt) {
    const p = this.player;

    // Mouse / Touch Look
    p.yaw -= this.lookDelta.x;
    p.pitch = clamp(p.pitch - this.lookDelta.y, -1.42, 1.42);
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;

    // Keyboard movement vector
    let fwd = 0, strafe = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) fwd += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) fwd -= 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) strafe -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) strafe += 1;

    const sprinting = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) && fwd > 0 && p.stamina > 5;
    if (sprinting) p.stamina = Math.max(0, p.stamina - dt * 18);
    else p.stamina = Math.min(100, p.stamina + dt * 12);

    const speed = p.crouching ? 2.6 : sprinting ? 7.8 : 4.8;
    const len = Math.hypot(fwd, strafe);
    if (len > 0) {
      fwd /= len;
      strafe /= len;
    }

    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    // In Three.js camera facing -Z when yaw=0: forward is (-sin, -cos), right is (cos, -sin)
    const moveX = (-sin * fwd + cos * strafe) * speed;
    const moveZ = (-cos * fwd - sin * strafe) * speed;

    let nextX = p.x + moveX * dt;
    let nextZ = p.z + moveZ * dt;

    // Building wall collision check
    const chIdx = Math.floor(nextZ / 160);
    const ch = this.world.chunks.get(chIdx);
    if (ch) {
      for (const box of ch.colliders) {
        if (nextX > box.minX - 0.35 && nextX < box.maxX + 0.35 && nextZ > box.minZ - 0.35 && nextZ < box.maxZ + 0.35) {
          nextX = p.x;
          nextZ = p.z;
          break;
        }
      }
    }

    p.x = nextX;
    p.z = nextZ;

    // Vertical gravity & ground height
    const groundY = this.world.getGroundHeight(p.x, p.z);
    p.vy -= 16.5 * dt;
    p.y += p.vy * dt;
    if (p.y <= groundY) {
      p.y = groundY;
      p.vy = 0;
      p.onGround = true;
    }

    // Footstep sound & headbob
    const horizSpd = Math.hypot(moveX, moveZ);
    if (horizSpd > 0.4 && p.onGround) {
      this._handBob += dt * horizSpd * 2.1;
      this._stepDist += horizSpd * dt;
      if (this._stepDist > 2.1) {
        this._stepDist = 0;
        const onRoad = Math.abs(p.x - roadX(p.z)) < 5.0;
        audio.step(onRoad);
      }
    }

    // Position 1st-person camera
    const eyeH = p.crouching ? 1.02 : 1.68;
    const bobY = Math.sin(this._handBob) * 0.035 * clamp(horizSpd / 5, 0, 1);
    this.camera.position.set(p.x, p.y + eyeH + bobY, p.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch;
    this.camera.rotation.z = 0;

    // Animate 1st-person hand viewmodel
    this.handGroup.position.set(
      0.32 + Math.cos(this._handBob * 0.5) * 0.015,
      -0.28 + Math.sin(this._handBob) * 0.018 + this._handActionAnim * 0.08,
      -0.52 - this._handActionAnim * 0.12
    );
    this.handGroup.rotation.x = -this._handActionAnim * 0.65;

    // Engine sound from outside if car is idling nearby
    if (this.activeCar) {
      audio.updateEngine(
        this.activeCar.engineRunning,
        0.08,
        ENGINES[this.activeCar.engineId]?.pitch || 1,
        this.activeCar.oil < 0.7,
        this.activeCar.tempC > 106,
        false
      );
    }

    // Center Crosshair Raycast for interactive objects
    this._performCrosshairRaycast();
  }

  _performCrosshairRaycast() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    let found = null;
    for (const h of hits) {
      // Skip handGroup meshes
      let p = h.object;
      let inHand = false;
      while (p) {
        if (p === this.handGroup) {
          inHand = true;
          break;
        }
        if (!found && p.userData && p.userData.interact) {
          found = p.userData.interact;
        }
        p = p.parent;
      }
      if (inHand) {
        found = null;
        continue;
      }
      if (found) break;
    }
    this.hoveredInteract = found;
  }

  // ── Vehicle Physics, Fluids & Cockpit Camera ───────────────────────────────
  _updateDrive(dt) {
    const car = this.activeCar;
    const arch = CAR_BY_ID[car.archId] || CAR_BY_ID.sedan;
    const eng = ENGINES[car.engineId];
    const rad = RADIATORS[car.radiatorId];

    // Look delta in cockpit
    this.player.yaw -= this.lookDelta.x;
    this.player.pitch = clamp(this.player.pitch - this.lookDelta.y, -0.85, 0.75);
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    // Gently recenter cockpit look when driving fast
    if (Math.abs(car.speed) > 2) {
      this.player.yaw = lerp(this.player.yaw, 0, dt * 1.5);
      this.player.pitch = lerp(this.player.pitch, -0.05, dt * 1.5);
    }

    // Driving Inputs
    let throttle = 0;
    let brake = 0;
    let steerIn = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) throttle = 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) brake = 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) steerIn += 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) steerIn -= 1;

    const handbrakeHeld = !!this.keys['Space'];
    if (handbrakeHeld) car.handbrake = true;
    else if (throttle > 0 && car.engineRunning) car.handbrake = false;

    // Auto-start convenience if player presses W while engine is off and fuel > 0
    if (throttle > 0 && !car.engineRunning && car.fuel > 0.05 && car.oil > 0.05 && car.engineId && car.tempC < 118) {
      this.toggleIgnition();
    }

    // Count installed wheels
    const wheelCount = car.wheels.filter((w) => w.installed).length;
    const avgTireCond =
      wheelCount > 0
        ? car.wheels.reduce((acc, w) => acc + (w.installed ? w.condition : 0), 0) / 4
        : 0.1;

    // ── Fluid & Thermal Simulation ──
    if (car.engineRunning) {
      if (!eng || car.fuel <= 0.01 || car.oil <= 0.01 || car.tempC >= 122) {
        car.engineRunning = false;
        audio.updateEngine(false, 0, 1, false, false, true);
        if (car.fuel <= 0.01) this.cb.toast('⛽ Engine sputtered out — Out of Gasoline!', true);
        else if (car.oil <= 0.01) this.cb.toast('🛢️ Engine seized — Out of Motor Oil!', true);
        else if (car.tempC >= 122) this.cb.toast('🌡️ Engine overheated and stalled! Add water to radiator.', true);
      } else {
        // Fuel consumption
        const load = 0.15 + 0.85 * Math.max(throttle, Math.abs(car.speed) / 40);
        car.fuel = Math.max(0, car.fuel - eng.fuelRate * load * dt);

        // Slow oil consumption
        car.oil = Math.max(0, car.oil - 0.0035 * load * dt);

        // Engine temperature dynamics
        const oilFactor = clamp(car.oil / (eng.oilCap * 0.25), 0.2, 1.0); // low oil causes extra friction heat
        const waterFill = rad ? clamp(car.water / rad.waterCap, 0, 1) : 0;
        const coolPower = rad ? rad.coolingPower * (0.2 + 0.8 * waterFill) * (0.5 + 0.5 * car.radiatorCondition) : 0.15;

        const targetEquilibrium = 52 + (36 * eng.heatRate * (0.4 + 0.6 * load)) / (coolPower * oilFactor);
        car.tempC = lerp(car.tempC, targetEquilibrium, dt * 0.085);

        // Boil off radiator water if overheating (> 106°C)
        if (car.tempC > 106 && car.water > 0) {
          car.water = Math.max(0, car.water - dt * 0.08);
        }
      }
    } else {
      // Cool down toward ambient desert temperature (30°C)
      car.tempC = lerp(car.tempC, 30, dt * 0.09);
    }

    // ── Longitudinal Acceleration, Mass Inertia, 5-Speed Gearbox, Braking & Drag ──
    const massKg = arch.massKg || 1200;
    const isSim = this.physicsRealism !== 'arcade';
    const massInertia = isSim ? clamp(1250 / Math.pow(massKg, 0.22), 0.52, 1.28) : 1.05;
    const topSpeedMs = eng ? (eng.topSpeedKmh / 3.6) * (0.65 + 0.35 * car.engineCondition) * (wheelCount / 4) : 0;
    const accelRate = eng ? eng.accel * (0.7 + 0.3 * avgTireCond) * massInertia : 0;

    const prevSpeed = car.speed;
    if (car.engineRunning && wheelCount >= 2) {
      if (throttle > 0) {
        if (car.speed < topSpeedMs) {
          car.speed += accelRate * (1 - (car.speed / (topSpeedMs + 1)) * 0.45) * dt;
        }
      }
      if (brake > 0) {
        if (car.speed > 0.6) {
          car.speed -= 24.0 * massInertia * dt; // braking forward
        } else {
          car.speed = Math.max(-12, car.speed - 9.5 * massInertia * dt); // reversing
        }
      }
    } else if (brake > 0) {
      // Braking while engine off
      if (Math.abs(car.speed) < 0.5) car.speed = 0;
      else car.speed -= Math.sign(car.speed) * 18.0 * dt;
    }

    // ── Realistic 5-Speed Automatic Transmission Gear & RPM Computation ──
    const absKmh = Math.abs(car.speed) * 3.6;
    if (car.speed < -0.5) {
      car.currentGear = 'R';
    } else if (absKmh < 1.2 && throttle === 0) {
      car.currentGear = 'N';
    } else if (absKmh < 24) {
      car.currentGear = '1';
    } else if (absKmh < 52) {
      car.currentGear = '2';
    } else if (absKmh < 86) {
      car.currentGear = '3';
    } else if (absKmh < 124) {
      car.currentGear = '4';
    } else {
      car.currentGear = '5';
    }

    // Off-road sand resistance vs smooth highway asphalt
    const onHighway = Math.abs(car.x - roadX(car.z)) < 5.0;
    const drag = (onHighway ? 0.25 : 0.78) + (car.handbrake ? 3.2 : 0) + (4 - wheelCount) * 1.8;
    car.speed -= car.speed * Math.min(1, drag * dt);
    if (!throttle && !brake && Math.abs(car.speed) < 0.18) car.speed = 0;

    // ── Steering & Heading ──
    const steerRate = 2.6;
    const maxSteer = 0.55 / (1 + Math.abs(car.speed) * 0.042);
    const targetSteer = steerIn * maxSteer;
    car.steerAngle = lerp(car.steerAngle, targetSteer, dt * steerRate * 3);

    // Pull steering if front wheel is missing
    let missingPull = 0;
    if (!car.wheels[0].installed) missingPull += 0.12;
    if (!car.wheels[1].installed) missingPull -= 0.12;

    if (Math.abs(car.speed) > 0.1) {
      const turnFactor = (car.speed / arch.wheelBase) * Math.tan(car.steerAngle + missingPull);
      car.heading += turnFactor * dt;
    }

    // Advance car position (+Z in car local frame is forward: x += sin(heading)*ds, z += cos(heading)*ds)
    const ds = car.speed * dt;
    const sinH = Math.sin(car.heading);
    const cosH = Math.cos(car.heading);
    let nextX = car.x + sinH * ds;
    let nextZ = car.z + cosH * ds;

    // Check rock & building collisions
    const chIdx = Math.floor(nextZ / 160);
    const ch = this.world.chunks.get(chIdx);
    if (ch) {
      for (const r of ch.rocks) {
        const d = Math.hypot(nextX - r.x, nextZ - r.z);
        if (d < r.radius + arch.width * 0.55) {
          const impact = Math.abs(car.speed) / 25;
          audio.crash(impact);
          car.speed *= -0.32;
          car.condition = Math.max(0.15, car.condition - impact * 0.05);
          if (impact > 0.5) car.hoodOpen = true;
          car.mesh.syncParts();
          nextX = car.x;
          nextZ = car.z;
          break;
        }
      }
      for (const b of ch.colliders) {
        if (nextX > b.minX - 1.1 && nextX < b.maxX + 1.1 && nextZ > b.minZ - 1.1 && nextZ < b.maxZ + 1.1) {
          audio.crash(Math.abs(car.speed) / 20);
          car.speed *= -0.25;
          nextX = car.x;
          nextZ = car.z;
          break;
        }
      }
    }

    // Run over hostile desert hares with the car!
    for (let i = this.hares.length - 1; i >= 0; i--) {
      const h = this.hares[i];
      if (Math.hypot(nextX - h.x, nextZ - h.z) < 1.5 && Math.abs(car.speed) > 3) {
        audio.rabbitHit();
        audio.crash(0.2);
        this.emitParticle(h.x, h.y + 0.3, h.z, 0xdc2626, 0.5, 1.4, 0.6);
        this.scene.remove(h.mesh);
        this.hares.splice(i, 1);
      }
    }

    car.x = nextX;
    car.z = nextZ;
    car.y = this.world.getGroundHeight(car.x, car.z);

    // Update Odometer in KM
    this.odometerKm += Math.abs(ds) / 1000;
    if (this.odometerKm > this.bestKm) this.bestKm = this.odometerKm;

    // Suspension pitch & roll
    const accelG = (car.speed - prevSpeed) / Math.max(dt, 0.008);
    const targetPitch = clamp(-accelG * 0.0055, -0.07, 0.07);
    const targetRoll = clamp(-car.steerAngle * (car.speed / 18) * 0.11, -0.10, 0.10);
    car.pitchAngle = lerp(car.pitchAngle, targetPitch, dt * 8);
    car.rollAngle = lerp(car.rollAngle, targetRoll, dt * 8);

    // Keep player coordinates synced with car
    this.player.x = car.x;
    this.player.y = car.y;
    this.player.z = car.z;

    // ── 3D Tire Skid Marks on Hard Braking / Drifting & Exhaust Plumes ──
    const isSkidding =
      Math.abs(car.speed) > 7 &&
      (car.handbrake || (brake > 0 && car.speed > 8) || (Math.abs(car.steerAngle) > 0.28 && Math.abs(car.speed) > 16));
    if (isSkidding && Math.random() < 0.65) {
      const halfTrack = arch.trackWidth * 0.5;
      const rearZ = -arch.wheelBase * 0.5;
      const px = Math.cos(car.heading);
      const pz = -Math.sin(car.heading);
      for (const side of [-1, 1]) {
        const wx = car.x + sinH * rearZ + px * (side * halfTrack);
        const wz = car.z + cosH * rearZ + pz * (side * halfTrack);
        this._spawnSkidSegment(wx, car.y + 0.04, wz, car.heading);
      }
    }

    // Desert Tire Dust Particles when driving fast off-road or drifting
    if (Math.abs(car.speed) > 6 && (!onHighway || isSkidding)) {
      if (Math.random() < 0.5) {
        this.emitParticle(
          car.x - sinH * (arch.length * 0.45) + (Math.random() - 0.5) * 1.4,
          car.y + 0.22,
          car.z - cosH * (arch.length * 0.45) + (Math.random() - 0.5) * 1.4,
          onHighway ? 0x9ca3af : 0xd4af76,
          0.65,
          0.65,
          0.65
        );
      }
    }

    // Exhaust Smoke Puffs when Engine is Running & Accelerating
    if (car.engineRunning && throttle > 0 && Math.random() < 0.35) {
      this.emitParticle(
        car.x - sinH * (arch.length * 0.52),
        car.y + 0.35,
        car.z - cosH * (arch.length * 0.52),
        car.oil < 0.8 ? 0x334155 : 0x94a3b8,
        0.35,
        0.7,
        0.45
      );
    }

    // Engine Sound Synthesis with Gear-Ratio Sawtooth Modulation
    const gearNum = parseInt(car.currentGear, 10) || 1;
    const gearSpan = 32;
    const gearRpm = clamp(((absKmh - (gearNum - 1) * 24) / gearSpan) * 0.65 + throttle * 0.28, 0.08, 1.0);
    audio.updateEngine(
      car.engineRunning,
      gearRpm,
      eng?.pitch || 1.0,
      car.oil < (eng ? eng.oilCap * 0.22 : 0.8),
      car.tempC > 106,
      true
    );

    // ── Position Camera (1st-Person Cockpit vs 3rd-Person Chase) ──
    if (this.thirdPerson) {
      const isBus = car.archId === 'bus' || car.archId === 'megabus';
      const isTruck = car.archId === 'truck';
      const camDist = car.archId === 'megabus' ? 12.8 : isBus ? 10.8 : isTruck ? 8.2 : 6.6;
      const camHeight = isBus ? 3.55 : isTruck ? 2.95 : 2.45;
      const lookYaw = car.heading + this.player.yaw * 0.6;
      const cx = car.x - Math.sin(lookYaw) * camDist;
      const cz = car.z - Math.cos(lookYaw) * camDist;
      const cy = Math.max(this.world.getGroundHeight(cx, cz) + 0.6, car.y + camHeight);
      this.camera.position.set(cx, cy, cz);
      this.camera.lookAt(car.x + Math.sin(car.heading) * 2.5, car.y + (isBus ? 1.6 : 1.1), car.z + Math.cos(car.heading) * 2.5);
    } else {
      // 1st-Person Cockpit View inside Driver's Seat
      // Transform driver seat offset from car local space to world space
      const driverLocalX = arch.width * 0.23; // Left side (+X)
      const driverLocalY = arch.seatOffset.y;
      const driverLocalZ = arch.seatOffset.z;
      const localVec = new THREE.Vector3(driverLocalX, driverLocalY, driverLocalZ);
      car.mesh.bodyGroup.updateMatrixWorld();
      const worldEye = localVec.applyMatrix4(car.mesh.bodyGroup.matrixWorld);
      this.camera.position.copy(worldEye);

      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = car.heading + Math.PI + this.player.yaw;
      this.camera.rotation.x = this.player.pitch - car.pitchAngle * 0.6;
      this.camera.rotation.z = -car.rollAngle * 0.5;
    }

    this.hoveredInteract = null;
  }

  // ── Vehicle Visual Articulation (Doors, Hood, Trunk, Gauges, Steam, Wheels) ──
  _updateVehicleVisuals(car, dt) {
    const m = car.mesh;
    if (!m) return;

    m.root.position.set(car.x, car.y, car.z);
    m.root.rotation.y = car.heading;

    // Missing wheel tilt
    let missingTiltZ = 0;
    if (!car.wheels[0].installed || !car.wheels[2].installed) missingTiltZ -= 0.09;
    if (!car.wheels[1].installed || !car.wheels[3].installed) missingTiltZ += 0.09;

    m.bodyGroup.rotation.x = car.pitchAngle;
    m.bodyGroup.rotation.z = car.rollAngle + missingTiltZ;

    // Smooth hinge animations for Doors, Hood & Trunk
    car._doorLAngle = lerp(car._doorLAngle, car.doorLOpen ? 1.15 : 0, dt * 8);
    car._doorRAngle = lerp(car._doorRAngle, car.doorROpen ? -1.15 : 0, dt * 8);
    car._hoodAngle = lerp(car._hoodAngle, car.hoodOpen ? -0.95 : 0, dt * 7);
    car._trunkAngle = lerp(car._trunkAngle, car.trunkOpen ? 1.05 : 0, dt * 7);

    m.doorLGroup.rotation.y = car._doorLAngle;
    m.doorRGroup.rotation.y = car._doorRAngle;
    m.hoodGroup.rotation.x = car._hoodAngle;
    m.trunkGroup.rotation.x = car._trunkAngle;

    // Steering wheel & Front wheel steering + spin
    m.steeringWheel.rotation.z = -car.steerAngle * 4.2;
    m.handbrakeLever.rotation.x = car.handbrake ? -0.38 : 0;

    car.wheelSpin += (car.speed / 0.34) * dt;
    m.wheelHubs.forEach((wh, i) => {
      if (i < 2) wh.steerPivot.rotation.y = car.steerAngle;
      wh.spinGroup.rotation.x = car.wheelSpin;
    });

    // 3D Dashboard Gauge Needles (Speed 0..180 km/h, Temp 40..120 °C, Fuel 0..Full)
    const arch = CAR_BY_ID[car.archId] || CAR_BY_ID.sedan;
    const kmh = Math.abs(car.speed) * 3.6;
    const spdFrac = clamp(kmh / 180, 0, 1);
    const tempFrac = clamp((car.tempC - 40) / 80, 0, 1);
    const fuelFrac = clamp(car.fuel / arch.fuelCap, 0, 1);

    // Rotate needles from +2.1 rad (left) to -2.1 rad (right)
    m.dashNeedles.speed.rotation.z = lerp(2.1, -2.1, spdFrac);
    m.dashNeedles.temp.rotation.z = lerp(2.1, -2.1, tempFrac);
    m.dashNeedles.fuel.rotation.z = lerp(2.1, -2.1, fuelFrac);

    // Headlights & Taillights
    const hlPower = car.headlights === 2 ? 7.5 : car.headlights === 1 ? 3.8 : 0;
    m.headlightSpot.intensity = hlPower;
    m.headlightSpot.distance = car.headlights === 2 ? 125 : 75;
    m.headLampMat.emissiveIntensity = car.headlights > 0 ? 2.2 : 0;
    m.beamL.visible = car.headlights > 0;
    m.beamR.visible = car.headlights > 0;
    m.tailLampMat.emissiveIntensity = car.headlights > 0 || car.handbrake ? 1.6 : 0.2;

    // Overheating Radiator Steam (> 104°C)
    if (car.tempC > 104 && Math.random() < 0.35) {
      const sinH = Math.sin(car.heading);
      const cosH = Math.cos(car.heading);
      this.emitParticle(
        car.x + sinH * 1.6,
        car.y + 1.05,
        car.z + cosH * 1.6,
        0xf8fafc,
        0.55,
        1.6,
        0.85
      );
    }
  }

  _updateWorldItems(dt) {
    for (const wi of this.worldItems) {
      if (wi.resting) continue;
      wi.vy -= 14.5 * dt;
      wi.x += wi.vx * dt;
      wi.y += wi.vy * dt;
      wi.z += wi.vz * dt;
      const gy = this.world.getGroundHeight(wi.x, wi.z) + 0.04;
      if (wi.y <= gy) {
        wi.y = gy;
        wi.vy = 0;
        wi.vx *= 0.4;
        wi.vz *= 0.4;
        if (Math.hypot(wi.vx, wi.vz) < 0.15) {
          wi.resting = true;
        }
      }
      wi.mesh.position.set(wi.x, wi.y, wi.z);
    }
  }

  _updateHares(dt) {
    const px = this.player.x;
    const pz = this.player.z;
    for (const h of this.hares) {
      h.attackCooldown = Math.max(0, h.attackCooldown - dt);
      const dx = px - h.x;
      const dz = pz - h.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 24 && dist > 1.1) {
        h.hopPhase += dt * 9;
        const spd = 4.2;
        h.x += (dx / dist) * spd * dt;
        h.z += (dz / dist) * spd * dt;
        h.y = this.world.getGroundHeight(h.x, h.z) + Math.abs(Math.sin(h.hopPhase)) * 0.32;
        h.mesh.position.set(h.x, h.y, h.z);
        h.mesh.rotation.y = Math.atan2(dx, dz);
      } else if (dist <= 1.2 && this.mode === 'walk' && h.attackCooldown <= 0) {
        h.attackCooldown = 1.4;
        this.player.health = Math.max(10, this.player.health - 8);
        audio.rabbitHit();
        this.cb.toast('🐇 Bitten by a rabid desert hare! (-8 HP) — Shoot with Revolver or jump in your car!', true);
        this.cb.onHudUpdate();
      }
    }
  }

  _spawnSkidSegment(x, y, z, heading) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.75), this.skidMat);
    seg.rotation.x = -Math.PI / 2;
    seg.rotation.z = -heading;
    seg.position.set(x, y, z);
    this.scene.add(seg);
    this.skidMarks.push(seg);
    if (this.skidMarks.length > 160) {
      const old = this.skidMarks.shift();
      this.scene.remove(old);
      old.geometry.dispose();
    }
  }

  // ── Apply Graphics Preset & Custom Display/Shadow/PostFX Settings ──────────
  applyGraphicsSettings(settings, renderer, postFX) {
    const preset = GRAPHICS_PRESETS[settings.preset] || GRAPHICS_PRESETS.high;

    // 1. Resolution Scale (720p HD = 0.67, 1080p Full HD = 1.0, 1440p QHD = 1.35, 4K UHD = 2.0)
    let pr = preset.resScale || 1.0;
    if (settings.resolutionMode === '720p') pr = 0.68;
    else if (settings.resolutionMode === '1080p') pr = 1.0;
    else if (settings.resolutionMode === '1440p') pr = 1.35;
    else if (settings.resolutionMode === '4k') pr = 2.0;

    if (renderer) {
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight);
      const shadowsOn = settings.shadows !== undefined ? settings.shadows : preset.shadows;
      renderer.shadowMap.enabled = shadowsOn;
      if (this.world && this.world.sunLight) {
        this.world.sunLight.castShadow = shadowsOn;
        const mapSz = settings.shadowMapSize || preset.shadowMapSize || 1024;
        if (shadowsOn && this.world.sunLight.shadow.mapSize.width !== mapSz) {
          this.world.sunLight.shadow.mapSize.set(mapSz, mapSz);
          if (this.world.sunLight.shadow.map) {
            this.world.sunLight.shadow.map.dispose();
            this.world.sunLight.shadow.map = null;
          }
        }
        const d = preset.shadowDist || 55;
        this.world.sunLight.shadow.camera.left = -d;
        this.world.sunLight.shadow.camera.right = d;
        this.world.sunLight.shadow.camera.top = d;
        this.world.sunLight.shadow.camera.bottom = -d;
        this.world.sunLight.shadow.camera.updateProjectionMatrix();
      }
      renderer.shadowMap.needsUpdate = true;
    }

    // 2. World Draw Distance, Horizon Fog Density & Camera Far Plane
    if (this.world) {
      this.world.drawChunksAhead = settings.drawDistance || preset.chunkForward || 8;
      this.world.drawChunksBehind = Math.max(3, Math.floor(this.world.drawChunksAhead * 0.7));
      if (this.scene.fog) {
        // Fog fades exactly at the horizon draw limit for a natural endless-desert look
        const drawMeters = this.world.drawChunksAhead * 160;
        this.scene.fog.density = clamp(1.0 / (drawMeters * 1.3), 0.00028, 0.0016);
      }
      const aniso = preset.anisotropy || 4;
      if (this.world.roadMat?.map) this.world.roadMat.map.anisotropy = aniso;
      if (this.world.sandMat?.map) this.world.sandMat.map.anisotropy = aniso;
      this.camera.far = Math.max(900, (this.world.drawChunksAhead + 5) * 160);
    }

    // 3. Camera FOV & Physics Realism
    this.baseFov = Number(settings.fov) || 74;
    this.physicsRealism = settings.physicsRealism || 'simulation';
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();

    // 4. Post-Processing Shader Settings (Bloom, Chromatic Aberration, Film Grain, Exposure, MSAA)
    if (postFX) {
      postFX.applySettings({
        bloom: settings.bloom !== undefined ? settings.bloom : preset.bloom,
        bloomStrength: preset.bloomStrength,
        bloomThreshold: preset.bloomThreshold,
        exposure: settings.exposure !== undefined ? Number(settings.exposure) : preset.exposure,
        contrast: preset.contrast,
        saturation: preset.saturation,
        chromaticAberration:
          settings.chromaticAberration !== undefined
            ? settings.chromaticAberration
              ? Math.max(0.0016, preset.chromaticAberration)
              : 0
            : preset.chromaticAberration,
        filmGrain:
          settings.filmGrain !== undefined
            ? settings.filmGrain
              ? Math.max(0.022, preset.filmGrain)
              : 0
            : preset.filmGrain,
        msaaSamples: preset.msaaSamples,
      });
      postFX.setSize(window.innerWidth, window.innerHeight, pr);
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      const f = p.age / p.life;
      p.sprite.scale.setScalar(p.size0 * (1 + f * 1.4));
      p.sprite.material.opacity = (1 - f) * 0.65;
    }
  }
}
