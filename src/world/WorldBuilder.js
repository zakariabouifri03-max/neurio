// ============================================================
// WorldBuilder.js — 3D Environment, Apartment, Setup & City
// ============================================================

import * as THREE from 'three';
import { ProceduralTextures } from './ProceduralTextures.js';
import { gameState } from '../core/GameState.js';

export class WorldBuilder {
  constructor(scene) {
    this.scene = scene;
    this.interactives = []; // Objects with raycast interactions
    this.colliders = [];    // AABB / bounding meshes for player collision
    this.lights = {};
    this.animatedProps = [];
    this.packageMeshes = [];
    this.cityCars = [];
    this.npcs = [];

    // References to dynamic apartment objects
    this.fridgeDoor = null;
    this.isFridgeOpen = false;
    this.fridgeFoodMeshes = [];
    this.pcCasePanel = null;
    this.pcGpuMesh = null;
    this.pcCoolerMesh = null;
    this.pcFans = [];
    this.monitorScreenMesh = null;
    this.sunLight = null;
    this.ambientLight = null;
    this.roomCeilingLight = null;
    this.isRoomLightOn = true;
    this.showerHead = null;
    this.showerParticles = null;
  }

  buildAll() {
    this.buildLighting();
    this.buildApartment();
    this.buildStreamingSetup();
    this.buildKitchen();
    this.buildBathroom();
    this.buildCityStreet();
    this.updatePackages();
  }

  buildLighting() {
    // Ambient / Hemisphere light
    this.ambientLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.45);
    this.scene.add(this.ambientLight);

    // Directional Sun / Moon
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.2);
    this.sunLight.position.set(15, 25, 10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 70;
    const d = 25;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.scene.add(this.sunLight);

    // Ceiling point light in apartment bedroom
    this.roomCeilingLight = new THREE.PointLight(0xffedd5, 1.3, 16);
    this.roomCeilingLight.position.set(0, 2.9, 0);
    this.roomCeilingLight.castShadow = true;
    this.scene.add(this.roomCeilingLight);
    this.lights.ceiling = this.roomCeilingLight;

    // Monitor glow point light
    this.monitorGlow = new THREE.PointLight(0x38bdf8, 0.8, 4);
    this.monitorGlow.position.set(0, 1.2, -4.0);
    this.scene.add(this.monitorGlow);
  }

  buildApartment() {
    const floorMat = new THREE.MeshStandardMaterial({
      map: ProceduralTextures.getWoodFloor(),
      roughness: 0.4,
      metalness: 0.1
    });

    const wallMat = new THREE.MeshStandardMaterial({
      map: ProceduralTextures.getDrywall('#f1f5f9'),
      roughness: 0.85
    });

    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.95
    });

    // Apartment dimensions: 12m wide (X: -6 to 6), 10m deep (Z: -5 to 5), 3.2m high
    // Main Floor
    const floorGeo = new THREE.PlaneGeometry(12, 10);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(-6, -1, -5), new THREE.Vector3(6, 0, 5)));

    // Ceiling
    const ceilingGeo = new THREE.PlaneGeometry(12, 10);
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.2, 0);
    this.scene.add(ceiling);

    // North Wall (Z = -5) with Window overlooking city
    this.createWall(new THREE.Vector3(0, 1.6, -5), new THREE.Vector3(12, 3.2, 0.2), wallMat);

    // South Wall (Z = 5) with Front Door opening to outside
    // Left part
    this.createWall(new THREE.Vector3(-3.5, 1.6, 5), new THREE.Vector3(5, 3.2, 0.2), wallMat);
    // Right part
    this.createWall(new THREE.Vector3(3.5, 1.6, 5), new THREE.Vector3(5, 3.2, 0.2), wallMat);
    // Over door lintel
    this.createWall(new THREE.Vector3(0, 2.7, 5), new THREE.Vector3(2, 1.0, 0.2), wallMat);

    // Front Door (interactive)
    const doorGeo = new THREE.BoxGeometry(1.8, 2.2, 0.08);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 1.1, 5.0);
    this.scene.add(door);
    door.userData = {
      isInteractive: true,
      action: 'door_front',
      prompt: '[E] Open Front Door (Step Outside)'
    };
    this.interactives.push(door);

    // Welcome mat on doorstep outside
    const matGeo = new THREE.BoxGeometry(1.6, 0.02, 1.0);
    const matMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
    const welcomeMat = new THREE.Mesh(matGeo, matMat);
    welcomeMat.position.set(0, 0.01, 5.7);
    this.scene.add(welcomeMat);

    // West Wall (X = -6)
    this.createWall(new THREE.Vector3(-6, 1.6, 0), new THREE.Vector3(0.2, 3.2, 10), wallMat);

    // East Wall (X = 6)
    this.createWall(new THREE.Vector3(6, 1.6, 0), new THREE.Vector3(0.2, 3.2, 10), wallMat);

    // Partition wall separating bathroom (X: 2 to 6, Z: 1.5 to 5)
    this.createWall(new THREE.Vector3(2, 1.6, 3.2), new THREE.Vector3(0.2, 3.2, 3.6), wallMat);
    this.createWall(new THREE.Vector3(4, 1.6, 1.4), new THREE.Vector3(4, 3.2, 0.2), wallMat);

    // Window frame on North Wall looking at city
    const windowFrameGeo = new THREE.BoxGeometry(3.6, 1.8, 0.1);
    const windowFrameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
    const windowFrame = new THREE.Mesh(windowFrameGeo, windowFrameMat);
    windowFrame.position.set(0, 1.8, -4.95);
    this.scene.add(windowFrame);

    // Window glass pane (translucent)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.25,
      roughness: 0.1,
      transmission: 0.8
    });
    const glassPane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6), glassMat);
    glassPane.position.set(0, 1.8, -4.93);
    this.scene.add(glassPane);

    // Bed in bedroom corner (X: -4.5, Z: -3.5)
    this.buildBed();

    // Wardrobe closet (X: -5.4, Z: 0)
    this.buildWardrobe();

    // Light switch on wall
    const switchGeo = new THREE.BoxGeometry(0.12, 0.18, 0.03);
    const switchMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const lightSwitch = new THREE.Mesh(switchGeo, switchMat);
    lightSwitch.position.set(1.2, 1.3, 4.9);
    this.scene.add(lightSwitch);
    lightSwitch.userData = {
      isInteractive: true,
      action: 'light_switch',
      prompt: '[E] Toggle Room Lights'
    };
    this.interactives.push(lightSwitch);

    // Posters
    const poster1 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.6),
      new THREE.MeshStandardMaterial({ map: ProceduralTextures.getPoster('VELOCITY RUSH 2', 'CLIMB THE LEADERBOARD', '#4c1d95') })
    );
    poster1.position.set(-2.5, 2.0, -4.89);
    this.scene.add(poster1);

    const poster2 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.4),
      new THREE.MeshStandardMaterial({ map: ProceduralTextures.getPoster('ZERO TO FAMOUS', 'GRIND NEVER STOPS', '#047857') })
    );
    poster2.position.set(2.5, 2.0, -4.89);
    this.scene.add(poster2);
  }

  createWall(pos, size, mat) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Add bounding box collider
    const half = size.clone().multiplyScalar(0.5);
    this.colliders.push(new THREE.Box3(
      pos.clone().sub(half),
      pos.clone().add(half)
    ));
    return mesh;
  }

  buildStreamingSetup() {
    const deskGroup = new THREE.Group();
    deskGroup.position.set(0, 0, -4.0);

    // --- 1. Large Desk ---
    const deskTopMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.3, metalness: 0.2 });
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.1), deskTopMat);
    deskTop.position.set(0, 0.75, 0);
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    deskGroup.add(deskTop);

    // Desk legs (metal frame)
    const legMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.8, roughness: 0.2 });
    [[-1.2, 0.37, -0.45], [1.2, 0.37, -0.45], [-1.2, 0.37, 0.45], [1.2, 0.37, 0.45]].forEach(p => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.74, 0.06), legMat);
      leg.position.set(p[0], p[1], p[2]);
      leg.castShadow = true;
      deskGroup.add(leg);
    });

    // Desk mousepad
    const padMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.9 });
    const mousepad = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.005, 0.5), padMat);
    mousepad.position.set(0, 0.785, 0.1);
    deskGroup.add(mousepad);

    // --- 2. Main Monitor (27") ---
    const standMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.6 });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 12), standMat);
    stand.position.set(0, 0.95, -0.2);
    deskGroup.add(stand);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.25), standMat);
    base.position.set(0, 0.785, -0.2);
    deskGroup.add(base);

    // Monitor bezel
    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.4 });
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.58, 0.03), bezelMat);
    bezel.position.set(0, 1.25, -0.2);
    bezel.castShadow = true;
    deskGroup.add(bezel);

    // Monitor screen (emissive canvas texture)
    const screenMat = new THREE.MeshBasicMaterial({
      map: ProceduralTextures.getMonitorScreen()
    });
    this.monitorScreenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.54), screenMat);
    this.monitorScreenMesh.position.set(0, 1.25, -0.183);
    deskGroup.add(this.monitorScreenMesh);

    // Interactive monitor
    bezel.userData = {
      isInteractive: true,
      action: 'use_pc',
      prompt: '[E] Sit at Desk & Use Nova OS'
    };
    this.interactives.push(bezel);

    // Secondary Chat Monitor (portrait, tilted 25 degrees)
    const secBezel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.03), bezelMat);
    secBezel.position.set(0.72, 1.25, -0.12);
    secBezel.rotation.y = -0.4;
    deskGroup.add(secBezel);

    const secScreenMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    const secScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.57), secScreenMat);
    secScreen.position.set(0.71, 1.25, -0.105);
    secScreen.rotation.y = -0.4;
    deskGroup.add(secScreen);

    // Webcam clipped on main monitor
    const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.04), bezelMat);
    camBody.position.set(0, 1.56, -0.19);
    const camLens = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12), new THREE.MeshBasicMaterial({ color: 0x10b981 }));
    camLens.rotation.x = Math.PI / 2;
    camLens.position.set(0, 1.56, -0.165);
    deskGroup.add(camBody);
    deskGroup.add(camLens);

    // Keyboard
    const kbMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.5 });
    const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.015, 0.16), kbMat);
    keyboard.position.set(-0.15, 0.79, 0.12);
    deskGroup.add(keyboard);

    // Mouse
    const mouseMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.3 });
    const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.11), mouseMat);
    mouse.position.set(0.25, 0.795, 0.12);
    deskGroup.add(mouse);

    // Studio Microphone on boom arm
    const boomArmMat = new THREE.MeshStandardMaterial({ color: 0x09090b, metalness: 0.7 });
    const boomStand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8), boomArmMat);
    boomStand.position.set(-0.95, 0.95, -0.1);
    boomStand.rotation.z = -0.35;
    deskGroup.add(boomStand);

    const micArm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 8), boomArmMat);
    micArm2.position.set(-0.8, 1.15, 0.05);
    micArm2.rotation.z = 0.5;
    deskGroup.add(micArm2);

    const micBodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 });
    const micCapsule = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 16), micBodyMat);
    micCapsule.position.set(-0.65, 1.25, 0.15);
    micCapsule.rotation.x = Math.PI / 6;
    deskGroup.add(micCapsule);

    // Pop filter
    const popRing = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.005, 8, 24), boomArmMat);
    popRing.position.set(-0.62, 1.25, 0.2);
    deskGroup.add(popRing);

    // --- 3. PC Tower Chassis ---
    this.buildPCTower(deskGroup);

    // --- 4. Gaming Chair (interactive sit) ---
    this.buildGamingChair();

    this.scene.add(deskGroup);

    // Add desk collider
    this.colliders.push(new THREE.Box3(
      new THREE.Vector3(-1.3, 0, -4.6),
      new THREE.Vector3(1.3, 1.6, -3.4)
    ));
  }

  buildPCTower(parent) {
    const pcGroup = new THREE.Group();
    pcGroup.position.set(0.95, 0.78, -0.1);

    // Main Case body (black matte steel)
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.5 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.46, 0.48), caseMat);
    chassis.position.set(0, 0.23, 0);
    chassis.castShadow = true;
    pcGroup.add(chassis);

    // Motherboard inside
    const mobo = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.38), new THREE.MeshStandardMaterial({
      map: ProceduralTextures.getMotherboard(),
      roughness: 0.4
    }));
    mobo.rotation.y = -Math.PI / 2;
    mobo.position.set(-0.09, 0.23, 0.02);
    pcGroup.add(mobo);

    // CPU Cooler with illuminated fan
    const coolerMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.2 });
    this.pcCoolerMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), coolerMat);
    this.pcCoolerMesh.rotation.z = Math.PI / 2;
    this.pcCoolerMesh.position.set(-0.06, 0.3, -0.05);
    pcGroup.add(this.pcCoolerMesh);

    // GPU (graphics card slotted horizontally)
    const gpuGeo = new THREE.BoxGeometry(0.06, 0.11, 0.26);
    const gpuMat = new THREE.MeshStandardMaterial({
      map: ProceduralTextures.getGpuShroud(),
      roughness: 0.3
    });
    this.pcGpuMesh = new THREE.Mesh(gpuGeo, gpuMat);
    this.pcGpuMesh.position.set(-0.04, 0.16, 0.03);
    pcGroup.add(this.pcGpuMesh);

    // RGB Fans on front intake
    for (let f = 0; f < 3; f++) {
      const fanRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.04, 0.008, 8, 16),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      fanRing.rotation.y = Math.PI / 2;
      fanRing.position.set(0.12, 0.1 + f * 0.12, 0.22);
      pcGroup.add(fanRing);
      this.pcFans.push(fanRing);
    }

    // Acrylic / Glass Side Panel (interactive open)
    const glassSideMat = new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.35,
      roughness: 0.1,
      transmission: 0.7
    });
    this.pcCasePanel = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.44, 0.46), glassSideMat);
    this.pcCasePanel.position.set(-0.125, 0.23, 0);
    pcGroup.add(this.pcCasePanel);

    // Interactive Case & Power Button
    chassis.userData = {
      isInteractive: true,
      action: 'pc_hardware',
      prompt: '[E] Inspect PC Hardware / Open Case'
    };
    this.interactives.push(chassis);

    parent.add(pcGroup);
  }

  buildGamingChair() {
    const chairGroup = new THREE.Group();
    chairGroup.position.set(0, 0, -3.2);

    const chairMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });

    // Seat cushion
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.52), chairMat);
    seat.position.set(0, 0.48, 0);
    seat.castShadow = true;
    chairGroup.add(seat);

    // Backrest (high back bucket style)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.1), chairMat);
    back.position.set(0, 0.88, 0.22);
    back.castShadow = true;
    chairGroup.add(back);

    // Headrest pillow
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.08), trimMat);
    pillow.position.set(0, 1.15, 0.19);
    chairGroup.add(pillow);

    // Armrests
    [-0.28, 0.28].forEach(x => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.3), trimMat);
      arm.position.set(x, 0.68, 0.05);
      chairGroup.add(arm);
    });

    // Base cylinder & 5-star wheels
    const baseCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 12), trimMat);
    baseCyl.position.set(0, 0.23, 0);
    chairGroup.add(baseCyl);

    chairGroup.userData = {
      isInteractive: true,
      action: 'use_pc',
      prompt: '[E] Sit in Chair (Nova OS)'
    };
    seat.userData = chairGroup.userData;
    this.interactives.push(seat);

    this.scene.add(chairGroup);
  }

  buildBed() {
    const bedGroup = new THREE.Group();
    bedGroup.position.set(-4.6, 0, -3.2);

    // Wooden bed frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3f2e1e, roughness: 0.6 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 2.3), frameMat);
    frame.position.set(0, 0.18, 0);
    bedGroup.add(frame);

    // Mattress
    const matMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.9 });
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 2.2), matMat);
    mattress.position.set(0, 0.42, 0);
    mattress.castShadow = true;
    bedGroup.add(mattress);

    // Quilt / Blanket
    const quiltMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.8 });
    const quilt = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.08, 1.6), quiltMat);
    quilt.position.set(0, 0.54, 0.28);
    bedGroup.add(quilt);

    // Pillows
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    [-0.4, 0.4].forEach(x => {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.35), pillowMat);
      pil.position.set(x, 0.58, -0.85);
      bedGroup.add(pil);
    });

    mattress.userData = {
      isInteractive: true,
      action: 'sleep_bed',
      prompt: '[E] Sleep in Bed'
    };
    this.interactives.push(mattress);

    this.scene.add(bedGroup);
    this.colliders.push(new THREE.Box3(
      new THREE.Vector3(-5.6, 0, -4.5),
      new THREE.Vector3(-3.6, 1.2, -1.9)
    ));
  }

  buildWardrobe() {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x382414, roughness: 0.5 });
    const wardrobe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.5, 0.7), woodMat);
    wardrobe.position.set(-5.3, 1.25, 0.2);
    wardrobe.castShadow = true;
    this.scene.add(wardrobe);

    wardrobe.userData = {
      isInteractive: true,
      action: 'wardrobe',
      prompt: '[E] Wardrobe (Change Clothes)'
    };
    this.interactives.push(wardrobe);

    this.colliders.push(new THREE.Box3(
      new THREE.Vector3(-5.9, 0, -0.2),
      new THREE.Vector3(-4.6, 2.5, 0.6)
    ));
  }

  buildKitchen() {
    const kitchenGroup = new THREE.Group();
    kitchenGroup.position.set(-4.0, 0, 3.8);

    // Counter base
    const counterMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.25 }); // White quartz
    const counterBase = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.85, 0.8), counterMat);
    counterBase.position.set(0, 0.42, 0);
    kitchenGroup.add(counterBase);

    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.05, 0.85), topMat);
    counterTop.position.set(0, 0.87, 0);
    counterTop.castShadow = true;
    kitchenGroup.add(counterTop);

    // Sink basin & faucet
    const sinkMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 });
    const sink = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.45), sinkMat);
    sink.position.set(-0.6, 0.9, 0);
    kitchenGroup.add(sink);

    const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 12), sinkMat);
    faucet.position.set(-0.6, 1.02, -0.15);
    kitchenGroup.add(faucet);

    sink.userData = {
      isInteractive: true,
      action: 'sink_drink',
      prompt: '[E] Drink Tap Water / Wash Hands'
    };
    this.interactives.push(sink);

    // Microwave oven
    const microMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.3 });
    const microwave = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.38), microMat);
    microwave.position.set(0.7, 1.07, 0);
    microwave.castShadow = true;
    kitchenGroup.add(microwave);

    microwave.userData = {
      isInteractive: true,
      action: 'microwave',
      prompt: '[E] Heat up / Cook Food'
    };
    this.interactives.push(microwave);

    // Refrigerator
    this.buildRefrigerator(kitchenGroup);

    // Trash can
    const trash = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.15, 0.5, 16),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 })
    );
    trash.position.set(-1.8, 0.25, 0);
    kitchenGroup.add(trash);
    trash.userData = {
      isInteractive: true,
      action: 'trash',
      prompt: '[E] Discard Empty Packaging'
    };
    this.interactives.push(trash);

    this.scene.add(kitchenGroup);
    this.colliders.push(new THREE.Box3(
      new THREE.Vector3(-5.8, 0, 3.2),
      new THREE.Vector3(-2.2, 2.0, 4.4)
    ));
  }

  buildRefrigerator(parent) {
    const fridgeGroup = new THREE.Group();
    fridgeGroup.position.set(1.9, 0, 0);

    const steelMat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, metalness: 0.65, roughness: 0.3 });
    const fridgeBody = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.9, 0.8), steelMat);
    fridgeBody.position.set(0, 0.95, 0);
    fridgeBody.castShadow = true;
    fridgeGroup.add(fridgeBody);

    // Fridge Door with handle
    this.fridgeDoor = new THREE.Group();
    this.fridgeDoor.position.set(-0.42, 0.95, 0.4);

    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.88, 0.08), steelMat);
    doorMesh.position.set(0.42, 0, 0);
    this.fridgeDoor.add(doorMesh);

    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 })
    );
    handle.position.set(0.78, 0.1, 0.06);
    this.fridgeDoor.add(handle);

    fridgeGroup.add(this.fridgeDoor);

    doorMesh.userData = {
      isInteractive: true,
      action: 'fridge_door',
      prompt: '[E] Open Refrigerator'
    };
    this.interactives.push(doorMesh);

    parent.add(fridgeGroup);
  }

  toggleFridge() {
    this.isFridgeOpen = !this.isFridgeOpen;
    if (this.fridgeDoor) {
      this.fridgeDoor.rotation.y = this.isFridgeOpen ? -Math.PI * 0.55 : 0;
    }
    return this.isFridgeOpen;
  }

  buildBathroom() {
    const bathGroup = new THREE.Group();
    bathGroup.position.set(4.0, 0, 3.2);

    // Floor tile in bathroom
    const bathFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 3.4),
      new THREE.MeshStandardMaterial({ map: ProceduralTextures.getCeramicTile('#cbd5e1') })
    );
    bathFloor.rotation.x = -Math.PI / 2;
    bathFloor.position.set(0, 0.01, 0);
    bathGroup.add(bathFloor);

    // Shower stall with glass enclosure
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.35,
      roughness: 0.1,
      transmission: 0.8
    });
    const showerDoor = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.2, 1.4), glassMat);
    showerDoor.position.set(-0.8, 1.1, 0.8);
    bathGroup.add(showerDoor);

    // Chrome showerhead
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.9, roughness: 0.1 });
    this.showerHead = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 16), chromeMat);
    this.showerHead.position.set(-1.4, 2.4, 0.8);
    bathGroup.add(this.showerHead);

    showerDoor.userData = {
      isInteractive: true,
      action: 'shower',
      prompt: '[E] Take a Warm Shower (Hygiene + Energy)'
    };
    this.interactives.push(showerDoor);

    // Vanity mirror and sink
    const vanity = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.85, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x334155 })
    );
    vanity.position.set(0.6, 0.42, -1.2);
    bathGroup.add(vanity);

    // Mirror
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.98, roughness: 0.05 });
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.2), mirrorMat);
    mirror.position.set(0.6, 1.6, -1.48);
    bathGroup.add(mirror);

    this.scene.add(bathGroup);
  }

  buildCityStreet() {
    const cityGroup = new THREE.Group();
    cityGroup.position.set(0, 0, 15);

    // Paved Sidewalk directly outside apartment door
    const sidewalkMat = new THREE.MeshStandardMaterial({
      map: ProceduralTextures.getSidewalkConcrete(),
      roughness: 0.8
    });
    const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(36, 6), sidewalkMat);
    sidewalk.rotation.x = -Math.PI / 2;
    sidewalk.position.set(0, 0.05, -7);
    cityGroup.add(sidewalk);

    // Two-lane asphalt avenue
    const roadMat = new THREE.MeshStandardMaterial({
      map: ProceduralTextures.getRoadAsphalt(),
      roughness: 0.6
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(36, 10), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.0, 1);
    cityGroup.add(road);

    // Streetlamps with warm light
    [-12, -4, 4, 12].forEach(x => {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 4.5, 12),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8 })
      );
      pole.position.set(x, 2.25, -4.2);
      cityGroup.add(pole);

      const lampHead = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xfef08a })
      );
      lampHead.position.set(x, 4.5, -4.0);
      cityGroup.add(lampHead);

      const lampLight = new THREE.PointLight(0xfef08a, 0.8, 12);
      lampLight.position.set(x, 4.3, -3.8);
      cityGroup.add(lampLight);
    });

    // --- City Storefronts (Open-World Lite Interactive Destinations) ---
    // 1. FreshMart Supermarket (left side, X = -10)
    this.buildStorefront(cityGroup, -10, 'FRESHMART', '24/7 GROCERY & SNACKS', '#10b981', 'store_freshmart', '[E] Shop at FreshMart Supermarket');

    // 2. SiliconTech Electronics & PC Store (right side, X = -3)
    this.buildStorefront(cityGroup, -3, 'SILICON TECH', 'PC PARTS & HARDWARE', '#0ea5e9', 'store_silicontech', '[E] Browse SiliconTech PC Hardware');

    // 3. Pulse Cafe (X = 4)
    this.buildStorefront(cityGroup, 4, 'PULSE CAFE', 'COFFEE & BARISTA SHIFTS', '#f59e0b', 'store_cafe', '[E] Pulse Cafe (Coffee & Work Shift)');

    // 4. MetroVault ATM & Branch (X = 11)
    this.buildStorefront(cityGroup, 11, 'METROVAULT', 'ATM & BANKING SERVICES', '#8b5cf6', 'atm_banking', '[E] Use MetroVault ATM');

    // Ambient cars on road
    this.buildAmbientCars(cityGroup);

    // Walking NPCs on sidewalk
    this.buildPedestrians(cityGroup);

    this.scene.add(cityGroup);
  }

  buildStorefront(parent, x, title, sub, color, action, prompt) {
    const storeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    const building = new THREE.Mesh(new THREE.BoxGeometry(5.5, 5, 4), storeMat);
    building.position.set(x, 2.5, -9);
    parent.add(building);

    // Glowing Sign
    const signMat = new THREE.MeshBasicMaterial({
      map: ProceduralTextures.getStoreSign(title, sub, color)
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 1.2), signMat);
    sign.position.set(x, 4.0, -6.95);
    parent.add(sign);

    // Store Entrance Door (interactive)
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.3
    });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.1), doorMat);
    door.position.set(x, 1.2, -6.95);
    door.userData = {
      isInteractive: true,
      action,
      prompt
    };
    this.interactives.push(door);
    parent.add(door);
  }

  buildAmbientCars(parent) {
    const colors = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x475569];
    for (let i = 0; i < 3; i++) {
      const carGroup = new THREE.Group();
      const carBodyMat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], metalness: 0.6, roughness: 0.2 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.0, 1.8), carBodyMat);
      body.position.set(0, 0.55, 0);
      carGroup.add(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 1.6), carBodyMat);
      roof.position.set(-0.2, 1.3, 0);
      carGroup.add(roof);

      // Headlights
      const hLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      hLight.position.set(1.8, 0.55, 0.6);
      carGroup.add(hLight);
      const hLight2 = hLight.clone();
      hLight2.position.set(1.8, 0.55, -0.6);
      carGroup.add(hLight2);

      carGroup.position.set(-18 + i * 16, 0.1, i % 2 === 0 ? -1.5 : 3.5);
      carGroup.userData = { speed: (i % 2 === 0 ? 6 : -5), dir: i % 2 === 0 ? 1 : -1 };
      if (i % 2 !== 0) carGroup.rotation.y = Math.PI;

      parent.add(carGroup);
      this.cityCars.push(carGroup);
    }
  }

  buildPedestrians(parent) {
    const npcNames = ['Emma (Neighbor)', 'Ken (Gamer)', 'Maya (Creator)', 'Leo (Tech Student)'];
    const npcColors = [0xec4899, 0x8b5cf6, 0x06b6d4, 0x84cc16];

    for (let i = 0; i < 4; i++) {
      const npcGroup = new THREE.Group();
      npcGroup.position.set(-14 + i * 8, 0, -6.5 + (i % 2) * 1.5);

      // Torso
      const shirtMat = new THREE.MeshStandardMaterial({ color: npcColors[i] });
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.65, 0.25), shirtMat);
      torso.position.set(0, 1.15, 0);
      npcGroup.add(torso);

      // Head
      const headMat = new THREE.MeshStandardMaterial({ color: 0xf3c59a });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), headMat);
      head.position.set(0, 1.65, 0);
      npcGroup.add(head);

      // Legs
      const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });
      [-0.1, 0.1].forEach(lx => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, 0.18), legMat);
        leg.position.set(lx, 0.4, 0);
        npcGroup.add(leg);
      });

      torso.userData = {
        isInteractive: true,
        action: 'talk_npc',
        npcName: npcNames[i],
        prompt: `[E] Talk to ${npcNames[i]}`
      };
      this.interactives.push(torso);

      npcGroup.userData = {
        name: npcNames[i],
        speed: 0.8 + Math.random() * 0.4,
        dir: i % 2 === 0 ? 1 : -1
      };
      parent.add(npcGroup);
      this.npcs.push(npcGroup);
    }
  }

  updatePackages() {
    // Clear existing package meshes
    this.packageMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      const idx = this.interactives.indexOf(mesh);
      if (idx !== -1) this.interactives.splice(idx, 1);
    });
    this.packageMeshes = [];

    const s = gameState.get();
    s.packages.forEach((pkg, index) => {
      const boxMat = new THREE.MeshStandardMaterial({
        map: ProceduralTextures.getCardboardPackage(pkg.sender || 'NOVAMARKET'),
        roughness: 0.85
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.45), boxMat);
      box.castShadow = true;

      // Position: outside apartment door mat, or inside desk if carried/dropped
      if (pkg.location === 'desk') {
        box.position.set(0.6, 0.95, -3.8);
      } else {
        box.position.set(-0.4 + index * 0.45, 0.18, 5.6);
      }

      box.userData = {
        isInteractive: true,
        action: 'package',
        packageIndex: index,
        packageData: pkg,
        prompt: `[E] Pick up Package (${pkg.item.name})`
      };

      this.scene.add(box);
      this.interactives.push(box);
      this.packageMeshes.push(box);
    });
  }

  update(delta, daylightFactor) {
    // Rotate PC fans if PC is on
    const s = gameState.get();
    if (s.pc.isOn) {
      this.pcFans.forEach(fan => {
        fan.rotation.x += delta * 15;
      });
      if (this.pcCoolerMesh) this.pcCoolerMesh.rotation.y += delta * 12;
      this.monitorGlow.intensity = 0.8;
    } else {
      this.monitorGlow.intensity = 0.05;
    }

    // Dynamic Sun light orientation & color
    if (this.sunLight && this.ambientLight) {
      const sunAngle = daylightFactor * Math.PI;
      this.sunLight.position.x = Math.cos(sunAngle) * 35;
      this.sunLight.position.y = Math.sin(sunAngle) * 30 + 5;
      this.sunLight.intensity = Math.max(0.1, daylightFactor * 1.4);

      if (daylightFactor > 0.4) {
        this.sunLight.color.setHex(0xfffaed); // Noon
        this.ambientLight.color.setHex(0xdbeafe);
      } else if (daylightFactor > 0.1) {
        this.sunLight.color.setHex(0xf97316); // Golden hour / Sunset
        this.ambientLight.color.setHex(0x7c2d12);
      } else {
        this.sunLight.color.setHex(0x38bdf8); // Moonlight
        this.ambientLight.color.setHex(0x0f172a);
      }
    }

    // Move ambient city traffic
    this.cityCars.forEach(car => {
      car.position.x += car.userData.speed * delta;
      if (car.position.x > 20) car.position.x = -20;
      if (car.position.x < -20) car.position.x = 20;
    });

    // Move walking pedestrians
    this.npcs.forEach(npc => {
      npc.position.x += npc.userData.speed * npc.userData.dir * delta;
      if (npc.position.x > 14) npc.userData.dir = -1;
      if (npc.position.x < -14) npc.userData.dir = 1;
    });
  }
}
