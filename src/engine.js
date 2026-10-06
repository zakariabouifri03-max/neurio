import * as THREE from '../vendor/three.module.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const q = (value, min, max) => Math.max(min, Math.min(max, value));
const hex = (value) => `#${new THREE.Color(value).getHexString()}`;

export const COMPONENT_TYPES = {
  MeshRenderer: { glyph: '◩', label: 'Mesh Renderer', defaults: { castShadows: true, receiveShadows: true } },
  Collider: { glyph: '⬡', label: 'Collider', defaults: { shape: 'Capsule', radius: 0.45, isTrigger: false } },
  RigidBody: { glyph: '▣', label: 'Rigid Body', defaults: { mass: 1, useGravity: true, isKinematic: false } },
  CharacterController: { glyph: '♟', label: 'Character Controller', defaults: { moveSpeed: 6, jumpHeight: 2.2, sprintMultiplier: 1.7, gravity: 18 } },
  Health: { glyph: '♡', label: 'Health', defaults: { maxHealth: 100, currentHealth: 100 } },
  Stamina: { glyph: 'ϟ', label: 'Stamina', defaults: { maxStamina: 100, currentStamina: 100, sprintCost: 18 } },
  Inventory: { glyph: '▤', label: 'Inventory', defaults: { wood: 0, stone: 0, berries: 0, capacity: 30 } },
  AIController: { glyph: '◎', label: 'AI Controller', defaults: { behavior: 'Chase', state: 'Idle', moveSpeed: 2.4, detectionRange: 22, attackRange: 1.5, damage: 8 } },
  Pickup: { glyph: '✦', label: 'Pickup', defaults: { resource: 'wood', amount: 1, collectRadius: 2.2 } },
  DayNight: { glyph: '◐', label: 'Day / Night Cycle', defaults: { cycleDuration: 180, startHour: 8 } },
  Interactable: { glyph: '◇', label: 'Interactable', defaults: { action: 'Open', prompt: 'Interact' } },
  CameraFollow: { glyph: '▧', label: 'Camera Follow', defaults: { distance: 7, height: 3.2, lookHeight: 1.1, smoothing: 8 } },
};

export function componentOf(object, type) {
  return object?.userData?.nexus?.components?.find((component) => component.type === type) || null;
}

export function ensureNexus(object, kind = 'GameObject') {
  object.userData ||= {};
  object.userData.nexus ||= { kind, components: [] };
  object.userData.nexus.kind ||= kind;
  object.userData.nexus.components ||= [];
  return object.userData.nexus;
}

function makeMaterial(color, roughness = 0.82, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: options.metalness ?? 0.02, flatShading: options.flatShading ?? false, ...options });
}

function addMesh(parent, geometry, material, name, position, scale) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  if (position) mesh.position.set(...position);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function attachComponent(object, type, properties = {}) {
  const meta = ensureNexus(object);
  const known = COMPONENT_TYPES[type];
  const existing = meta.components.find((component) => component.type === type);
  if (existing) return existing;
  const entry = { type, enabled: true, ...(known ? clone(known.defaults) : {}), ...properties };
  meta.components.push(entry);
  return entry;
}

function addMeshRenderer(object) {
  const mesh = object.isMesh ? object : object.getObjectByProperty?.('isMesh', true);
  const mat = mesh?.material;
  attachComponent(object, 'MeshRenderer', {
    baseColor: mat?.color ? hex(mat.color) : '#d7dfeb',
    metallic: Number.isFinite(mat?.metalness) ? mat.metalness : 0,
    roughness: Number.isFinite(mat?.roughness) ? mat.roughness : 0.8,
  });
}

function materialColor(object, color) {
  object.traverse((child) => {
    if (!child.isMesh || !child.material?.color) return;
    child.material.color.set(color);
  });
  const renderer = componentOf(object, 'MeshRenderer');
  if (renderer) renderer.baseColor = hex(color);
}

function createTree(name = 'Tree') {
  const root = new THREE.Group(); root.name = name;
  const trunk = addMesh(root, new THREE.CylinderGeometry(0.2, 0.33, 2.2, 7), makeMaterial('#745034', 0.95), 'Trunk', [0, 1.08, 0]);
  trunk.castShadow = true;
  const leaves = new THREE.Group(); leaves.name = 'Canopy';
  addMesh(leaves, new THREE.ConeGeometry(1.4, 2.8, 7), makeMaterial('#477747', 0.92, { flatShading: true }), 'Upper canopy', [0, 3.05, 0]);
  addMesh(leaves, new THREE.ConeGeometry(1.75, 2.5, 7), makeMaterial('#5b8b4e', 0.9, { flatShading: true }), 'Lower canopy', [0, 2.25, 0]);
  root.add(leaves);
  ensureNexus(root, 'Tree');
  attachComponent(root, 'Collider', { shape: 'Cylinder', radius: 0.68, isTrigger: false });
  return root;
}

function createPalm(name = 'Palm') {
  const root = new THREE.Group(); root.name = name;
  const trunk = addMesh(root, new THREE.CylinderGeometry(0.14, 0.24, 3.1, 7), makeMaterial('#826243', 0.9), 'Palm trunk', [0, 1.52, 0]);
  trunk.rotation.z = -0.08;
  const crown = new THREE.Group(); crown.name = 'Fronds'; crown.position.y = 3.05; root.add(crown);
  const frondMat = makeMaterial('#438663', 0.88, { flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const leaf = addMesh(crown, new THREE.ConeGeometry(0.24, 2.6, 5), frondMat, `Frond ${i + 1}`, [0, -0.55, 0]);
    leaf.rotation.z = -0.72;
    leaf.rotation.y = (Math.PI * 2 * i) / 7;
  }
  ensureNexus(root, 'Tree');
  attachComponent(root, 'Collider', { shape: 'Cylinder', radius: 0.42, isTrigger: false });
  return root;
}

function createRock(name = 'Rock', color = '#818a8a') {
  const root = new THREE.Group(); root.name = name;
  const rock = addMesh(root, new THREE.DodecahedronGeometry(0.8, 0), makeMaterial(color, 0.94, { flatShading: true }), 'Rock mesh', [0, 0.48, 0], [1.1, 0.72, 0.92]);
  rock.rotation.set(0.18, 0.3, 0.15);
  ensureNexus(root, 'Rock');
  attachComponent(root, 'Collider', { shape: 'Sphere', radius: 0.75, isTrigger: false });
  return root;
}

function createPickup(resource = 'wood', name = `${resource[0].toUpperCase()}${resource.slice(1)} Pickup`) {
  const root = new THREE.Group(); root.name = name;
  const color = resource === 'stone' ? '#aab6bb' : resource === 'berries' ? '#d16d8e' : '#b58a57';
  const geometry = resource === 'stone' ? new THREE.DodecahedronGeometry(0.38, 0) : resource === 'berries' ? new THREE.SphereGeometry(0.31, 10, 8) : new THREE.BoxGeometry(0.6, 0.42, 0.38);
  const mat = makeMaterial(color, 0.48, { emissive: resource === 'berries' ? '#431124' : '#000000', flatShading: true });
  addMesh(root, geometry, mat, resource === 'wood' ? 'Log' : resource === 'stone' ? 'Stone' : 'Berries', [0, 0.42, 0]);
  if (resource === 'wood') {
    root.children[0].rotation.z = 0.18;
    addMesh(root, new THREE.CylinderGeometry(0.14, 0.14, 0.02, 8), makeMaterial('#d5b484', 0.8), 'Cut end', [0.31, 0.42, 0]);
  }
  ensureNexus(root, 'Pickup');
  attachComponent(root, 'Pickup', { resource, amount: 1, collectRadius: 2.25 });
  return root;
}

function createPlayer(name = 'Player') {
  const root = new THREE.Group(); root.name = name;
  const body = addMesh(root, new THREE.CapsuleGeometry(0.38, 0.88, 4, 8), makeMaterial('#6da8df', 0.67, { flatShading: true }), 'Body', [0, 1.05, 0]);
  body.castShadow = true;
  addMesh(root, new THREE.SphereGeometry(0.3, 12, 10), makeMaterial('#deb98c', 0.84, { flatShading: true }), 'Head', [0, 1.88, -0.03]);
  addMesh(root, new THREE.BoxGeometry(0.18, 0.42, 0.28), makeMaterial('#4f6b4a', 0.85), 'Backpack', [0, 1.12, 0.31]);
  addMesh(root, new THREE.BoxGeometry(0.5, 0.13, 0.26), makeMaterial('#d5b475', 0.56, { metalness: 0.1 }), 'Belt', [0, 0.87, 0]);
  ensureNexus(root, 'Player');
  attachComponent(root, 'CharacterController');
  attachComponent(root, 'Health');
  attachComponent(root, 'Stamina');
  attachComponent(root, 'Inventory');
  attachComponent(root, 'CameraFollow');
  attachComponent(root, 'Collider', { shape: 'Capsule', radius: 0.42, isTrigger: false });
  return root;
}

function createEnemy(name = 'Island Stalker') {
  const root = new THREE.Group(); root.name = name;
  addMesh(root, new THREE.CapsuleGeometry(0.42, 0.7, 3, 7), makeMaterial('#68814a', 0.9, { flatShading: true }), 'Body', [0, 0.94, 0]);
  addMesh(root, new THREE.SphereGeometry(0.31, 10, 8), makeMaterial('#8ca65f', 0.8, { flatShading: true }), 'Head', [0, 1.66, -0.06]);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#f37c65', emissive: '#63190f', emissiveIntensity: 0.6, roughness: 0.4 });
  addMesh(root, new THREE.SphereGeometry(0.055, 8, 6), eyeMat, 'Eye L', [-0.105, 1.67, -0.33]);
  addMesh(root, new THREE.SphereGeometry(0.055, 8, 6), eyeMat, 'Eye R', [0.105, 1.67, -0.33]);
  ensureNexus(root, 'Enemy');
  attachComponent(root, 'Health', { maxHealth: 50, currentHealth: 50 });
  attachComponent(root, 'AIController', { state: 'Chase', moveSpeed: 2.35, detectionRange: 25, attackRange: 1.65, damage: 8 });
  attachComponent(root, 'Collider', { shape: 'Capsule', radius: 0.48, isTrigger: false });
  return root;
}

function createIsland() {
  const root = new THREE.Group(); root.name = 'Island';
  addMesh(root, new THREE.CylinderGeometry(25.8, 27.8, 1.7, 64, 1), makeMaterial('#cbb48a', 0.96, { flatShading: true }), 'Sandy shoreline', [0, -0.87, 0]);
  addMesh(root, new THREE.CylinderGeometry(25.7, 24.4, 0.28, 64, 1), makeMaterial('#648a54', 0.95, { flatShading: true }), 'Grass plateau', [0, 0.02, 0]);
  addMesh(root, new THREE.CylinderGeometry(25.5, 25.2, 0.12, 64, 1), makeMaterial('#73945b', 1, { flatShading: true }), 'Grass variation', [0, 0.21, 0]);
  ensureNexus(root, 'Terrain');
  attachComponent(root, 'Collider', { shape: 'Terrain', radius: 26, isTrigger: false });
  return root;
}

function createWater() {
  const root = new THREE.Group(); root.name = 'Ocean';
  const water = addMesh(root, new THREE.PlaneGeometry(230, 230), new THREE.MeshStandardMaterial({ color: '#397f9b', roughness: 0.34, metalness: 0.05, side: THREE.DoubleSide }), 'Water surface', [0, -1.82, 0]);
  water.rotation.x = -Math.PI / 2;
  ensureNexus(root, 'Environment');
  attachComponent(root, 'MeshRenderer', { baseColor: '#397f9b', metallic: 0.05, roughness: 0.34 });
  return root;
}

function createCabin() {
  const root = new THREE.Group(); root.name = 'Driftwood Cabin';
  const wood = makeMaterial('#866547', 0.9, { flatShading: true });
  const wall = addMesh(root, new THREE.BoxGeometry(4.5, 2.7, 3.6), wood, 'Cabin walls', [0, 1.35, 0]);
  const roof = addMesh(root, new THREE.ConeGeometry(3.15, 1.7, 4), makeMaterial('#61584b', 0.95, { flatShading: true }), 'Roof', [0, 3.2, 0]);
  roof.rotation.y = Math.PI / 4;
  addMesh(root, new THREE.BoxGeometry(0.9, 1.75, 0.12), makeMaterial('#4f3929', 0.9), 'Door', [0, 0.88, -1.86]);
  addMesh(root, new THREE.BoxGeometry(0.95, 0.75, 0.08), makeMaterial('#a7c6ba', 0.48, { emissive: '#11221b', emissiveIntensity: 0.22 }), 'Window', [1.35, 1.75, -1.84]);
  wall.castShadow = true;
  ensureNexus(root, 'Prefab');
  attachComponent(root, 'Collider', { shape: 'Box', radius: 2.6, isTrigger: false });
  attachComponent(root, 'Interactable', { action: 'Open', prompt: 'Enter cabin' });
  return root;
}

export class StudioEngine {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8db9c4');
    this.scene.fog = new THREE.Fog('#8db9c4', 65, 115);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.08, 450);
    this.camera.position.set(38, 29, 46);
    this.orbitTarget = new THREE.Vector3(0, 2, 0);
    this.camera.lookAt(this.orbitTarget);
    this.gameCamera = new THREE.PerspectiveCamera(60, 1, 0.08, 300);
    this.renderer = null;
    this.grid = null;
    this.selectionHelper = null;
    this.selected = null;
    this.mode = 'edit';
    this.paused = false;
    this.activeView = 'scene';
    this.previousView = 'scene';
    this.tool = 'select';
    this.showGrid = true;
    this.keys = new Set();
    this.player = null;
    this.gameYaw = Math.PI;
    this.gameVelocityY = 0;
    this.stamina = 100;
    this.health = 100;
    this.inventory = { wood: 0, stone: 0, berries: 0 };
    this.attackPower = 18;
    this.gameTime = 8 * 60;
    this.attackCooldown = 0;
    this.graphs = [];
    this.graphStates = new Map();
    this.playSnapshot = null;
    this.drag = null;
    this.lastFrame = performance.now();
    this.fpsFrames = 0;
    this.fpsWindowStart = performance.now();
    this.fps = 0;
    this.frameTime = 0;
    this.resizeObserver = null;
    this.disposed = false;
    this.initRenderer();
    this.addHelpers();
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  initRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (error) {
      this.callbacks.onError?.(error);
      throw error;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D scene viewport');
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);
  }

  addHelpers() {
    this.grid = new THREE.GridHelper(120, 60, 0x526071, 0x313a45);
    this.grid.position.y = 0.008;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.43;
    this.grid.userData.editorOnly = true;
    this.scene.add(this.grid);
    this.selectionHelper = new THREE.BoxHelper(new THREE.Object3D(), 0xb5f36d);
    this.selectionHelper.material.depthTest = false;
    this.selectionHelper.material.transparent = true;
    this.selectionHelper.material.opacity = 0.96;
    this.selectionHelper.renderOrder = 1000;
    this.selectionHelper.visible = false;
    this.selectionHelper.userData.editorOnly = true;
    this.scene.add(this.selectionHelper);
  }

  bindEvents() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    canvas.addEventListener('pointercancel', () => { this.drag = null; });
    canvas.addEventListener('wheel', (event) => {
      if (this.mode !== 'edit' || this.activeView !== 'scene') return;
      event.preventDefault();
      this.zoom(event.deltaY);
    }, { passive: false });
    canvas.addEventListener('pointerdown', () => {
      if (this.mode === 'play' && !this.paused && document.pointerLockElement !== canvas) {
        try { canvas.requestPointerLock?.(); } catch (_) { /* mouse look is optional */ }
      }
    });
    window.addEventListener('pointermove', (event) => {
      if (document.pointerLockElement === canvas && this.mode === 'play' && !this.paused) this.gameYaw -= event.movementX * 0.0024;
    });
    window.addEventListener('keydown', (event) => this.keyDown(event));
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    document.addEventListener('pointerlockchange', () => {
      if (this.mode === 'play' && document.pointerLockElement !== canvas && !this.paused) this.callbacks.onHint?.('Click the game view to capture mouse look. Press Esc to release.');
    });
  }

  resize() {
    if (!this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.gameCamera.aspect = width / height;
    this.gameCamera.updateProjectionMatrix();
  }

  frame(now) {
    if (this.disposed) return;
    const dt = Math.min(Math.max((now - this.lastFrame) / 1000, 0), 0.06);
    this.lastFrame = now;
    this.frameTime = dt * 1000;
    if (this.mode === 'play' && !this.paused) this.updateGame(dt);
    if (this.selectionHelper && this.selected && this.mode === 'edit') {
      this.selectionHelper.setFromObject(this.selected);
      this.selectionHelper.visible = true;
    } else if (this.selectionHelper) this.selectionHelper.visible = false;
    this.grid.visible = this.showGrid && this.mode === 'edit' && this.activeView === 'scene';
    if (this.mode === 'edit' && this.activeView === 'game') this.updateGameCamera(0.05);
    const camera = this.mode === 'play' || this.activeView === 'game' ? this.gameCamera : this.camera;
    this.renderer.render(this.scene, camera);
    this.fpsFrames++;
    if (now - this.fpsWindowStart > 500) {
      this.fps = this.fpsFrames * 1000 / (now - this.fpsWindowStart);
      this.fpsFrames = 0;
      this.fpsWindowStart = now;
      this.callbacks.onStats?.(this.getStats());
    }
  }

  getStats() {
    const objectCount = this.listObjects().length;
    const info = this.renderer?.info;
    return {
      fps: this.fps,
      frameTime: this.frameTime,
      objects: objectCount,
      calls: info?.render?.calls ?? 0,
      triangles: info?.render?.triangles ?? 0,
      geometries: info?.memory?.geometries ?? 0,
      textures: info?.memory?.textures ?? 0,
    };
  }

  listObjects() {
    const result = [];
    this.scene.traverse((object) => {
      if (object === this.scene || object.userData?.editorOnly || object.parent?.userData?.editorOnly) return;
      if (object.userData?.nexus) result.push(object);
    });
    return result;
  }

  rootObjects() { return this.scene.children.filter((child) => !child.userData?.editorOnly); }

  createScene(name = 'Scene') {
    this.clearScene();
    this.scene = new THREE.Scene();
    this.scene.name = name;
    this.scene.background = new THREE.Color('#8db9c4');
    this.scene.fog = new THREE.Fog('#8db9c4', 80, 150);
    this.scene.userData.nexusSceneName = name;
    const hemi = new THREE.HemisphereLight(0xd6ebf3, 0x46523e, 1.2); hemi.name = 'Environment Light';
    ensureNexus(hemi, 'Light'); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffedc6, 2.7); sun.name = 'Sun Light';
    sun.position.set(-18, 28, 14); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -38; sun.shadow.camera.right = 38; sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
    sun.shadow.bias = -0.00035; ensureNexus(sun, 'Light'); this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), makeMaterial('#6d825a', 1));
    floor.rotation.x = -Math.PI / 2; floor.name = 'Ground'; floor.receiveShadow = true;
    ensureNexus(floor, 'Ground'); attachComponent(floor, 'MeshRenderer', { baseColor: '#6d825a', roughness: 1, metallic: 0 }); attachComponent(floor, 'Collider', { shape: 'Plane', radius: 40 });
    this.scene.add(floor);
    this.addHelpers();
    this.setQuality(this.quality || 'High');
    this.setSelection(null);
    this.callbacks.onSceneChanged?.(this.scene);
  }

  createSampleScene() {
    this.clearScene();
    this.scene = new THREE.Scene();
    this.scene.name = 'Island';
    this.scene.background = new THREE.Color('#80b5c0');
    this.scene.fog = new THREE.Fog('#80b5c0', 60, 110);
    this.scene.userData.nexusSceneName = 'Island';
    const hemi = new THREE.HemisphereLight(0xe4f4ed, 0x667050, 1.25); hemi.name = 'Ambient Sky';
    ensureNexus(hemi, 'Light'); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe7bd, 3.3); sun.name = 'Sun Light';
    sun.position.set(-20, 33, 16); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -38; sun.shadow.camera.right = 38; sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
    ensureNexus(sun, 'Light'); attachComponent(sun, 'DayNight', { cycleDuration: 180, startHour: 8 }); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xa8d7ef, 0.56); fill.name = 'Ocean Fill'; fill.position.set(18, 12, -22); ensureNexus(fill, 'Light'); this.scene.add(fill);
    this.scene.add(createWater());
    this.scene.add(createIsland());
    const cabin = createCabin(); cabin.position.set(-8, 0.24, -7); cabin.rotation.y = -0.22; this.scene.add(cabin);
    const treeSpots = [
      [-17, -8, 0.88, true], [-18, 4, 1.05, true], [-13, 12, 0.8, false], [-5, -17, 0.95, true],
      [3, -19, 1.12, true], [13, -13, 0.86, true], [18, -3, 1, false], [16, 10, 0.9, true],
      [8, 17, 1.08, false], [-9, 18, 0.91, true], [-19, -15, 0.72, false], [2, 10, 0.82, true],
    ];
    treeSpots.forEach(([x, z, scale, palm], i) => {
      const tree = palm ? createPalm(`Palm ${String(i + 1).padStart(2, '0')}`) : createTree(`Coastal Tree ${String(i + 1).padStart(2, '0')}`);
      tree.position.set(x, 0.21, z); tree.scale.setScalar(scale); tree.rotation.y = (i * 1.7) % (Math.PI * 2); this.scene.add(tree);
    });
    const rockSpots = [[-12, -2], [14, 3], [6, -12], [-4, 15], [20, 4], [-20, 12]];
    rockSpots.forEach(([x, z], i) => { const rock = createRock(`Shore Rock ${i + 1}`, i % 2 ? '#858e89' : '#a09a86'); rock.position.set(x, 0.21, z); rock.scale.setScalar(0.75 + (i % 3) * 0.12); this.scene.add(rock); });
    const resources = [
      ['wood', -4, 1, 8], ['wood', 9, 1, 8], ['wood', -11, 1, -1], ['wood', 3, 1, -15],
      ['stone', -12, 1, 7], ['stone', 13, 1, -5], ['stone', 4, 1, 15],
      ['berries', 7, 1, -2], ['berries', -8, 1, 11], ['berries', 15, 1, 12],
    ];
    resources.forEach(([type, x, y, z], i) => { const pickup = createPickup(type, `${type[0].toUpperCase()}${type.slice(1)} Cache ${i + 1}`); pickup.position.set(x, 0.21, z); this.scene.add(pickup); });
    const enemy = createEnemy(); enemy.position.set(8, 0.21, -9); this.scene.add(enemy);
    const player = createPlayer(); player.position.set(0, 0.21, 11); this.scene.add(player);
    this.scene.userData.nexusTemplate = 'Island Survival';
    this.addHelpers();
    this.setQuality(this.quality || 'High');
    this.setSelection(player);
    this.orbitTarget.set(0, 1, 0);
    this.camera.position.set(39, 31, 45); this.camera.lookAt(this.orbitTarget);
    this.callbacks.onSceneChanged?.(this.scene);
  }

  clearScene() {
    if (this.scene) {
      this.scene.traverse((object) => {
        if (object.geometry?.dispose) object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const mat of mats) {
          if (!mat) continue;
          for (const value of Object.values(mat)) if (value?.isTexture) value.dispose();
          mat.dispose?.();
        }
      });
      this.scene.clear();
    }
    this.grid = null; this.selectionHelper = null; this.selected = null; this.player = null;
  }

  addHelpers() {
    this.grid = new THREE.GridHelper(120, 60, 0x526071, 0x313a45);
    this.grid.position.y = 0.008;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.43;
    this.grid.userData.editorOnly = true;
    this.scene.add(this.grid);
    this.selectionHelper = new THREE.BoxHelper(new THREE.Object3D(), 0xb5f36d);
    this.selectionHelper.material.depthTest = false;
    this.selectionHelper.material.transparent = true;
    this.selectionHelper.material.opacity = 0.96;
    this.selectionHelper.renderOrder = 1000;
    this.selectionHelper.visible = false;
    this.selectionHelper.userData.editorOnly = true;
    this.scene.add(this.selectionHelper);
  }

  serializeScene() {
    const helpers = [this.grid, this.selectionHelper].filter(Boolean);
    const visibility = helpers.map((helper) => helper.visible);
    helpers.forEach((helper) => this.scene.remove(helper));
    const data = JSON.parse(JSON.stringify(this.scene.toJSON()));
    helpers.forEach((helper, i) => { this.scene.add(helper); helper.visible = visibility[i]; });
    return data;
  }

  loadScene(data) {
    this.clearScene();
    try {
      const parsed = new THREE.ObjectLoader().parse(data);
      this.scene = parsed;
      this.scene.userData ||= {};
      this.scene.name ||= this.scene.userData.nexusSceneName || 'Scene';
      this.scene.traverse((object) => {
        if (!object.isScene && object !== this.scene && object.type !== 'DirectionalLight' && object.type !== 'AmbientLight' && object.type !== 'HemisphereLight' && !object.userData?.editorOnly) {
          if (object.userData?.nexus) {
            object.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
          }
        }
      });
      this.addHelpers();
      this.setSelection(null);
      this.callbacks.onSceneChanged?.(this.scene);
      return true;
    } catch (error) {
      this.callbacks.onLog?.('ERROR', `Scene could not be loaded: ${error.message}`);
      return false;
    }
  }

  setSelection(object) {
    this.selected = object || null;
    if (this.selected?.isMesh) {
      ensureNexus(this.selected, 'Mesh');
      if (!componentOf(this.selected, 'MeshRenderer')) addMeshRenderer(this.selected);
    }
    if (this.selectionHelper) this.selectionHelper.visible = false;
    this.callbacks.onSelection?.(this.selected);
  }

  setTool(tool) { this.tool = tool; }
  setGraphs(graphs) { this.graphs = Array.isArray(graphs) ? graphs : []; this.graphStates.clear(); }
  setQuality(quality = 'High') {
    this.quality = quality;
    const presets = { High: { pixelRatio: 1.6, shadowSize: 2048 }, Balanced: { pixelRatio: 1.25, shadowSize: 1024 }, Performance: { pixelRatio: 1, shadowSize: 512 } };
    const preset = presets[quality] || presets.High;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
    this.scene.traverse((object) => {
      if (!object.isLight || !object.castShadow) return;
      object.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
      if (object.shadow.map) { object.shadow.map.dispose(); object.shadow.map = null; }
    });
  }
  setGridVisible(show) { this.showGrid = !!show; }
  setView(view) { this.activeView = view === 'game' ? 'game' : 'scene'; }

  pickObject(clientX, clientY) {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, this.camera);
    const hits = ray.intersectObjects(this.scene.children.filter((child) => !child.userData?.editorOnly), true);
    for (const hit of hits) {
      if (hit.object.userData?.editorOnly) continue;
      let chosen = hit.object;
      while (chosen.parent && chosen.parent !== this.scene && !chosen.userData?.nexus) chosen = chosen.parent;
      if (chosen.userData?.nexus) return chosen;
    }
    return null;
  }

  pointerDown(event) {
    this.container.focus?.();
    if (this.mode === 'play') return;
    const { clientX: x, clientY: y, button } = event;
    if (button === 2 || button === 1) {
      this.drag = { kind: button === 2 ? 'orbit' : 'pan', x, y, startX: x, startY: y, target: this.orbitTarget.clone(), camera: this.camera.position.clone() };
      this.renderer.domElement.setPointerCapture?.(event.pointerId);
      return;
    }
    if (button !== 0) return;
    const hit = this.pickObject(x, y);
    if (hit) this.setSelection(hit);
    else if (this.tool === 'select') this.setSelection(null);
    const canTransform = hit && hit === this.selected && this.tool !== 'select';
    if (canTransform) this.callbacks.onTransformStart?.(hit);
    this.drag = { kind: canTransform ? this.tool : 'click', x, y, startX: x, startY: y, object: canTransform ? hit : null, original: canTransform ? hit.position.clone() : null, rotationY: canTransform ? hit.rotation.y : null, scale: canTransform ? hit.scale.clone() : null, planePoint: canTransform && this.tool === 'move' ? this.worldPointAt(x, y, hit.position.y) : null };
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  pointerMove(event) {
    const drag = this.drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.kind === 'orbit') {
      const offset = this.camera.position.clone().sub(drag.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= dx * 0.006;
      spherical.phi = q(spherical.phi - dy * 0.006, 0.1, Math.PI - 0.1);
      offset.setFromSpherical(spherical);
      this.camera.position.copy(drag.target).add(offset);
      this.camera.lookAt(drag.target);
    } else if (drag.kind === 'pan') {
      const offset = drag.camera.clone().sub(drag.target);
      const right = new THREE.Vector3().crossVectors(this.camera.up, offset).normalize();
      const up = new THREE.Vector3().crossVectors(offset, right).normalize();
      const distance = offset.length();
      const scale = distance * 0.0015;
      const delta = right.multiplyScalar(-dx * scale).add(up.multiplyScalar(dy * scale));
      this.orbitTarget.copy(drag.target).add(delta);
      this.camera.position.copy(drag.camera).add(delta);
      this.camera.lookAt(this.orbitTarget);
    } else if (drag.kind === 'move' && drag.object) {
      const point = this.worldPointAt(event.clientX, event.clientY, drag.object.position.y);
      if (point && drag.planePoint) {
        const delta = point.sub(drag.planePoint);
        drag.object.position.copy(drag.original).add(delta);
        this.callbacks.onTransform?.(drag.object);
      }
    } else if (drag.kind === 'rotate' && drag.object) {
      drag.object.rotation.y = drag.rotationY + (event.clientX - drag.startX) * 0.012;
      this.callbacks.onTransform?.(drag.object);
    } else if (drag.kind === 'scale' && drag.object) {
      const factor = Math.max(0.1, 1 + (event.clientX - drag.startX) * 0.006);
      drag.object.scale.copy(drag.scale).multiplyScalar(factor);
      this.callbacks.onTransform?.(drag.object);
    }
    drag.x = event.clientX; drag.y = event.clientY;
  }

  pointerUp(event) {
    const drag = this.drag;
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (drag.kind === 'click' && moved < 5 && this.tool === 'select') {
      const hit = this.pickObject(event.clientX, event.clientY);
      this.setSelection(hit);
    }
    if (drag.kind === 'move' || drag.kind === 'rotate' || drag.kind === 'scale') this.callbacks.onTransformEnd?.(drag.object);
    this.drag = null;
  }

  worldPointAt(clientX, clientY, planeY = 0) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const point = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, point) ? point : null;
  }

  zoom(delta) {
    const offset = this.camera.position.clone().sub(this.orbitTarget);
    const length = q(offset.length() * (1 + Math.sign(delta) * 0.09), 4, 180);
    offset.setLength(length);
    this.camera.position.copy(this.orbitTarget).add(offset);
    this.camera.lookAt(this.orbitTarget);
  }

  focusSelected() {
    if (!this.selected) return;
    const box = new THREE.Box3().setFromObject(this.selected);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1.5);
    const direction = this.camera.position.clone().sub(this.orbitTarget).normalize();
    this.orbitTarget.copy(center);
    this.camera.position.copy(center).add(direction.multiplyScalar(Math.max(radius * 3.2, 7)));
    this.camera.lookAt(center);
  }

  createObject(type, options = {}) {
    const position = options.position || [0, 0.22, 0];
    let object;
    switch (type) {
      case 'Cube': {
        object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), makeMaterial(options.color || '#7794b3', 0.72));
        object.name = options.name || 'Cube'; object.position.set(...position); ensureNexus(object, 'Mesh'); addMeshRenderer(object); attachComponent(object, 'Collider', { shape: 'Box', radius: 0.58, isTrigger: false }); break;
      }
      case 'Sphere': {
        object = new THREE.Mesh(new THREE.SphereGeometry(0.65, 20, 14), makeMaterial(options.color || '#82a8c7', 0.68));
        object.name = options.name || 'Sphere'; object.position.set(...position); ensureNexus(object, 'Mesh'); addMeshRenderer(object); attachComponent(object, 'Collider', { shape: 'Sphere', radius: 0.65, isTrigger: false }); break;
      }
      case 'Cylinder': {
        object = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.25, 18), makeMaterial(options.color || '#98a070', 0.8));
        object.name = options.name || 'Cylinder'; object.position.set(...position); ensureNexus(object, 'Mesh'); addMeshRenderer(object); attachComponent(object, 'Collider', { shape: 'Cylinder', radius: 0.65, isTrigger: false }); break;
      }
      case 'Capsule': {
        object = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.85, 4, 10), makeMaterial(options.color || '#8ca8c2', 0.72));
        object.name = options.name || 'Capsule'; object.position.set(...position); ensureNexus(object, 'Mesh'); addMeshRenderer(object); attachComponent(object, 'Collider', { shape: 'Capsule', radius: 0.45, isTrigger: false }); break;
      }
      case 'Plane': {
        object = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), makeMaterial(options.color || '#667e59', 1, { side: THREE.DoubleSide }));
        object.rotation.x = -Math.PI / 2; object.position.set(position[0], position[1], position[2]); object.name = options.name || 'Plane'; ensureNexus(object, 'Ground'); addMeshRenderer(object); attachComponent(object, 'Collider', { shape: 'Plane', radius: 4, isTrigger: false }); break;
      }
      case 'Tree': object = createTree(options.name || 'Tree'); object.position.set(...position); break;
      case 'Palm': object = createPalm(options.name || 'Palm'); object.position.set(...position); break;
      case 'Rock': object = createRock(options.name || 'Rock'); object.position.set(...position); break;
      case 'Wood Pickup': object = createPickup('wood', options.name || 'Wood Pickup'); object.position.set(...position); break;
      case 'Stone Pickup': object = createPickup('stone', options.name || 'Stone Pickup'); object.position.set(...position); break;
      case 'Berry Pickup': object = createPickup('berries', options.name || 'Berry Pickup'); object.position.set(...position); break;
      case 'Enemy': object = createEnemy(options.name || 'Enemy'); object.position.set(...position); break;
      case 'Player': object = createPlayer(options.name || 'Player'); object.position.set(...position); break;
      case 'Cabin': object = createCabin(); object.name = options.name || 'Cabin'; object.position.set(...position); break;
      case 'Point Light': {
        object = new THREE.PointLight(options.color || 0xffd68a, 32, 25, 2); object.name = options.name || 'Point Light'; object.position.set(position[0], position[1] + 3, position[2]); object.castShadow = true; ensureNexus(object, 'Light');
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: options.color || 0xffd68a })); bulb.name = 'Light marker'; bulb.userData.editorOnly = true; object.add(bulb); break;
      }
      case 'Directional Light': {
        object = new THREE.DirectionalLight(options.color || 0xfff0d2, 2.4); object.name = options.name || 'Directional Light'; object.position.set(position[0] - 8, position[1] + 12, position[2] + 6); object.castShadow = true; object.shadow.mapSize.set(1024, 1024); ensureNexus(object, 'Light'); break;
      }
      case 'Camera': {
        object = new THREE.Group(); object.name = options.name || 'Camera';
        const cameraIcon = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.28), new THREE.MeshStandardMaterial({ color: '#88b4e6', roughness: 0.4, metalness: 0.25, wireframe: true })); cameraIcon.name = 'Camera gizmo'; cameraIcon.userData.editorOnly = true; object.add(cameraIcon);
        ensureNexus(object, 'Camera'); attachComponent(object, 'CameraFollow', { distance: 7, height: 3.2, lookHeight: 1.1, smoothing: 8 }); object.position.set(...position); break;
      }
      default: throw new Error(`Unknown scene object type: ${type}`);
    }
    if (options.parent) options.parent.add(object); else this.scene.add(object);
    if (options.select !== false) this.setSelection(object);
    this.callbacks.onObjectsChanged?.();
    return object;
  }

  createImportedModel(object, name = 'Imported Model') {
    object.name = name;
    ensureNexus(object, 'ImportedModel');
    object.position.set(0, 0.22, 0);
    object.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    addMeshRenderer(object);
    this.scene.add(object);
    this.setSelection(object);
    this.callbacks.onObjectsChanged?.();
    return object;
  }

  instantiatePrefab(serialized, name = 'Prefab') {
    try {
      const object = new THREE.ObjectLoader().parse(serialized);
      object.name = name || object.name || 'Prefab';
      object.position.x += 1.5;
      ensureNexus(object, 'Prefab');
      this.scene.add(object);
      this.setSelection(object);
      this.callbacks.onObjectsChanged?.();
      return object;
    } catch (error) {
      this.callbacks.onLog?.('ERROR', `Prefab could not be instantiated: ${error.message}`);
      return null;
    }
  }

  setParent(object, parent) {
    if (!object || !parent || object === parent) return false;
    let ancestor = parent;
    while (ancestor) { if (ancestor === object) return false; ancestor = ancestor.parent; }
    object.updateWorldMatrix(true, false);
    const worldMatrix = object.matrixWorld.clone();
    const matrixAutoUpdate = object.matrixAutoUpdate;
    parent.add(object); parent.updateWorldMatrix(true, false);
    const localMatrix = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(worldMatrix);
    if (matrixAutoUpdate) { localMatrix.decompose(object.position, object.quaternion, object.scale); object.updateMatrix(); }
    else object.matrix.copy(localMatrix);
    this.callbacks.onObjectsChanged?.();
    return true;
  }

  duplicateObject(object) {
    if (!object) return null;
    const duplicate = object.clone(true);
    duplicate.name = `${object.name} Copy`;
    duplicate.position.x += 1.4; duplicate.position.z += 0.8;
    (object.parent || this.scene).add(duplicate);
    this.setSelection(duplicate);
    this.callbacks.onObjectsChanged?.();
    return duplicate;
  }

  deleteObject(object = this.selected) {
    if (!object || object === this.scene || object.userData?.editorOnly) return false;
    object.parent?.remove(object);
    this.setSelection(null);
    this.callbacks.onObjectsChanged?.();
    return true;
  }

  addComponent(object, type, properties = {}) {
    if (!object || !type) throw new Error('Select an object and component type.');
    if (type === 'MeshRenderer' && !object.isMesh && !object.getObjectByProperty('isMesh', true)) throw new Error('Mesh Renderer requires a mesh.');
    const component = attachComponent(object, type, properties);
    this.callbacks.onSelection?.(object);
    return component;
  }

  removeComponent(object, type) {
    const meta = object?.userData?.nexus;
    if (!meta || type === 'MeshRenderer' && object.isMesh) return false;
    const index = meta.components.findIndex((entry) => entry.type === type);
    if (index >= 0) meta.components.splice(index, 1);
    this.callbacks.onSelection?.(object);
    return index >= 0;
  }

  updateComponent(object, type, key, value) {
    const component = componentOf(object, type);
    if (!component) return false;
    component[key] = value;
    if (type === 'MeshRenderer' && key === 'baseColor') materialColor(object, value);
    if (type === 'MeshRenderer' && (key === 'roughness' || key === 'metallic')) {
      object.traverse((child) => {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!material || !material.isMeshStandardMaterial) continue;
          if (key === 'roughness') material.roughness = q(Number(value), 0, 1);
          if (key === 'metallic') material.metalness = q(Number(value), 0, 1);
          material.needsUpdate = true;
        }
      });
    }
    return true;
  }

  renameObject(object, name) {
    if (!object || !name.trim()) return;
    object.name = name.trim();
    this.callbacks.onObjectsChanged?.();
    this.callbacks.onSelection?.(object);
  }

  setTransform(object, key, values) {
    if (!object) return;
    const target = key === 'position' ? object.position : key === 'rotation' ? object.rotation : key === 'scale' ? object.scale : null;
    if (!target) return;
    target.set(Number(values[0]), Number(values[1]), Number(values[2]));
    if (object === this.selected) this.selectionHelper?.setFromObject(object);
    this.callbacks.onTransform?.(object);
  }

  setObjectColor(object, color) { materialColor(object, color); this.callbacks.onSelection?.(object); }

  assignMaterial(object, material) {
    if (!object || !material) return false;
    object.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const current of materials) {
        if (!current) continue;
        if (current.color) current.color.set(material.baseColor || '#ffffff');
        if ('roughness' in current) current.roughness = Math.max(0, Math.min(1, Number(material.roughness ?? 0.75)));
        if ('metalness' in current) current.metalness = Math.max(0, Math.min(1, Number(material.metallic ?? 0)));
        if (material.name) current.name = material.name;
        current.needsUpdate = true;
      }
    });
    const component = componentOf(object, 'MeshRenderer');
    if (component) Object.assign(component, { baseColor: material.baseColor, roughness: material.roughness, metallic: material.metallic });
    this.callbacks.onSelection?.(object);
    return true;
  }

  setShadows(enabled) {
    this.renderer.shadowMap.enabled = !!enabled;
    this.scene.traverse((object) => {
      if (object.isMesh) { object.castShadow = !!enabled; object.receiveShadow = !!enabled; }
    });
  }

  findPlayer() {
    const players = this.listObjects().filter((object) => componentOf(object, 'CharacterController'));
    return players[0] || null;
  }

  findDirectionalLight() {
    let found = null;
    this.scene.traverse((object) => { if (!found && object.isDirectionalLight) found = object; });
    return found;
  }

  startPlay() {
    if (this.mode === 'play') { this.paused = false; this.callbacks.onMode?.('play'); return; }
    this.playSnapshot = this.serializeScene();
    this.previousView = this.activeView;
    this.setView('game');
    this.mode = 'play'; this.paused = false;
    this.player = this.findPlayer();
    if (!this.player) {
      this.callbacks.onLog?.('WARNING', 'No Character Controller found. Add a Player object before testing movement.');
    }
    const health = this.player && componentOf(this.player, 'Health');
    const stamina = this.player && componentOf(this.player, 'Stamina');
    this.health = health?.currentHealth ?? health?.maxHealth ?? 100;
    this.stamina = stamina?.currentStamina ?? stamina?.maxStamina ?? 100;
    this.inventory = { wood: 0, stone: 0, berries: 0 };
    const playerInventory = this.player && componentOf(this.player, 'Inventory');
    if (playerInventory) Object.assign(playerInventory, this.inventory);
    this.attackPower = 18;
    this.gameTime = 8 * 60;
    this.realPlayTime = 0;
    this.gameVelocityY = 0;
    this.attackCooldown = 0;
    this.graphStates.clear();
    this.gameYaw = this.player ? this.player.rotation.y + Math.PI : Math.PI;
    this.updateGameCamera(1);
    this.keys.clear();
    this.callbacks.onMode?.('play');
    this.callbacks.onLog?.('INFO', 'Play Mode started. Use WASD to move, E to gather, F to attack, and C to craft.');
    this.callbacks.onGameUI?.(this.gameUIState());
  }

  stopPlay() {
    if (this.mode !== 'play') return;
    const snapshot = this.playSnapshot;
    this.mode = 'edit'; this.paused = false; this.playSnapshot = null; this.keys.clear();
    this.setView(this.previousView || 'scene');
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock?.();
    if (snapshot) this.loadScene(snapshot);
    this.player = null;
    this.callbacks.onMode?.('edit');
    this.callbacks.onLog?.('INFO', 'Play Mode stopped. Runtime changes were discarded; the editor scene was restored.');
  }

  togglePause() {
    if (this.mode !== 'play') return;
    this.paused = !this.paused;
    this.keys.clear();
    if (this.paused && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock?.();
    this.callbacks.onMode?.(this.paused ? 'paused' : 'play');
  }

  keyDown(event) {
    const target = event.target;
    if (target?.matches?.('input,textarea,select,[contenteditable="true"]')) return;
    if (this.mode !== 'play') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (event.code === 'Escape') { this.togglePause(); return; }
    if (event.repeat) return;
    this.keys.add(event.code);
    if (this.paused) return;
    if (event.code === 'KeyE') this.tryGather();
    if (event.code === 'KeyF') this.tryAttack();
    if (event.code === 'KeyC') this.tryCraft();
  }

  updateGame(dt) {
    this.player ||= this.findPlayer();
    const player = this.player;
    const dayNightOwner = this.listObjects().find((object) => componentOf(object, 'DayNight')?.enabled !== false && componentOf(object, 'DayNight'));
    const cycle = dayNightOwner && componentOf(dayNightOwner, 'DayNight');
    const cycleDuration = Math.max(30, Number(cycle?.cycleDuration) || 180);
    this.realPlayTime = (this.realPlayTime || 0) + dt;
    this.gameTime = (this.gameTime + dt * (cycle ? 24 * 60 / cycleDuration : 0.6)) % (24 * 60);
    if (dayNightOwner) {
      const phase = (this.gameTime / (24 * 60)) % 1;
      const angle = phase * Math.PI * 2 - Math.PI / 2;
      const sun = dayNightOwner.isDirectionalLight ? dayNightOwner : this.findDirectionalLight();
      if (sun) {
        sun.position.set(Math.cos(angle) * 25, Math.max(4, Math.sin(angle) * 28), Math.sin(angle) * 18);
        sun.intensity = 0.28 + Math.max(0, Math.sin(angle)) * 3.05;
        const night = q((Math.sin(angle) + 0.16) / 0.45, 0, 1);
        const dayColor = new THREE.Color('#80b5c0'); const nightColor = new THREE.Color('#182437');
        this.scene.background?.copy?.(nightColor).lerp(dayColor, night);
        this.scene.fog?.color?.copy?.(this.scene.background);
      }
    }
    if (player) this.updatePlayer(player, dt);
    if (player) this.updateEnemies(player, dt);
    if (player) this.updateGraphs(player);
    this.updateRigidBodies(dt);
    this.updatePickups(dt);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.callbacks.onGameUI?.(this.gameUIState());
  }

  updatePlayer(player, dt) {
    const controller = componentOf(player, 'CharacterController') || COMPONENT_TYPES.CharacterController.defaults;
    const forwardX = Math.sin(this.gameYaw), forwardZ = Math.cos(this.gameYaw);
    const rightX = Math.cos(this.gameYaw), rightZ = -Math.sin(this.gameYaw);
    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) { x += forwardX; z += forwardZ; }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) { x -= forwardX; z -= forwardZ; }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) { x += rightX; z += rightZ; }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) { x -= rightX; z -= rightZ; }
    const length = Math.hypot(x, z) || 1; x /= length; z /= length;
    const moving = Math.hypot(x, z) > 0.1;
    const staminaComponent = componentOf(player, 'Stamina');
    const sprinting = moving && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.stamina > 0.2;
    if (sprinting) this.stamina = Math.max(0, this.stamina - (staminaComponent?.sprintCost || 18) * dt);
    else this.stamina = Math.min(staminaComponent?.maxStamina || 100, this.stamina + 12 * dt);
    if (staminaComponent) staminaComponent.currentStamina = this.stamina;
    const speed = Number(controller.moveSpeed) * (sprinting ? Number(controller.sprintMultiplier) : 1);
    const next = player.position.clone();
    next.x += x * speed * dt;
    next.z += z * speed * dt;
    const islandRadius = this.findByKind('Terrain')[0]?.userData?.nexus?.components?.find((component) => component.type === 'Collider')?.radius || 26;
    const allowed = Math.max(1, islandRadius - 1.1);
    const r = Math.hypot(next.x, next.z);
    if (r > allowed) { next.x *= allowed / r; next.z *= allowed / r; }
    if (!this.collides(next.x, next.z, player)) { player.position.x = next.x; player.position.z = next.z; }
    else {
      const xOnly = { x: next.x, z: player.position.z }; if (!this.collides(xOnly.x, xOnly.z, player)) player.position.x = xOnly.x;
      const zOnly = { x: player.position.x, z: next.z }; if (!this.collides(zOnly.x, zOnly.z, player)) player.position.z = zOnly.z;
    }
    if (moving) player.rotation.y = Math.atan2(x, z) + Math.PI;
    const ground = this.findGroundHeight(player.position.x, player.position.z);
    const gravity = Number(controller.gravity) || 18;
    const jumpHeight = Number(controller.jumpHeight) || 2.2;
    const grounded = player.position.y <= ground + 0.012 && this.gameVelocityY <= 0;
    if (grounded) {
      player.position.y = ground;
      this.gameVelocityY = Math.max(0, this.gameVelocityY);
      if (this.keys.has('Space')) { this.gameVelocityY = Math.sqrt(2 * gravity * jumpHeight); this.keys.delete('Space'); }
    } else {
      this.gameVelocityY -= gravity * dt;
      player.position.y = Math.max(ground, player.position.y + this.gameVelocityY * dt);
      if (player.position.y === ground) this.gameVelocityY = 0;
    }
    this.updateGameCamera(dt);
  }

  findGroundHeight(x, z) {
    let height = 0;
    const ground = this.listObjects().find((object) => componentOf(object, 'Collider')?.shape === 'Plane' && object.rotation.x < -0.5);
    if (ground) height = ground.position.y;
    const terrain = this.findByKind('Terrain')[0];
    if (terrain) height = terrain.position.y + 0.24;
    return height;
  }

  collides(x, z, player) {
    for (const object of this.listObjects()) {
      if (object === player || object === this.findByKind('Terrain')[0]) continue;
      const collider = componentOf(object, 'Collider');
      if (!collider || collider.isTrigger || collider.shape === 'Plane') continue;
      if (componentOf(object, 'Pickup')) continue;
      if (object.isLight || object.userData.nexus.kind === 'Light' || object.userData.nexus.kind === 'Camera') continue;
      const radius = Math.max(0.2, Number(collider.radius) || 0.55) * Math.max(object.scale.x, object.scale.z, 0.7);
      if (Math.hypot(x - object.position.x, z - object.position.z) < radius + 0.4) return true;
    }
    return false;
  }

  updateGameCamera(dt) {
    const player = this.player || this.findPlayer();
    if (!player) {
      this.gameCamera.position.set(16, 14, 21); this.gameCamera.lookAt(0, 0, 0); return;
    }
    const follow = componentOf(player, 'CameraFollow') || COMPONENT_TYPES.CameraFollow.defaults;
    if (this.mode === 'play' && Number(follow.distance) < 1) player.traverse((child) => { if (child.isMesh) child.visible = false; });
    const behindAngle = this.gameYaw + Math.PI;
    const desired = new THREE.Vector3(
      player.position.x + Math.sin(behindAngle) * Number(follow.distance),
      player.position.y + Number(follow.height),
      player.position.z + Math.cos(behindAngle) * Number(follow.distance),
    );
    const smoothing = Number(follow.smoothing) || 8;
    const alpha = 1 - Math.exp(-smoothing * Math.max(dt, 0.001));
    this.gameCamera.position.lerp(desired, alpha);
    this.gameCamera.lookAt(player.position.x, player.position.y + Number(follow.lookHeight), player.position.z);
  }

  findByKind(kind) {
    return this.listObjects().filter((object) => object.userData?.nexus?.kind === kind);
  }

  tryGather() {
    if (!this.player) return;
    const nearest = this.listObjects()
      .filter((object) => componentOf(object, 'Pickup') && object.visible)
      .map((object) => ({ object, distance: object.position.distanceTo(this.player.position) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || nearest.distance > (componentOf(nearest.object, 'Pickup')?.collectRadius || 2.2) + 0.85) {
      this.callbacks.onGameToast?.('No resource nearby. Move closer to a glowing item.'); return;
    }
    const item = componentOf(nearest.object, 'Pickup');
    const key = item.resource === 'berry' ? 'berries' : item.resource;
    const amount = Number(item.amount) || 1;
    const storedInventory = componentOf(this.player, 'Inventory');
    const capacity = Number(storedInventory?.capacity) || 30;
    const total = Object.values(this.inventory).reduce((sum, value) => sum + Number(value || 0), 0);
    if (total + amount > capacity) { this.callbacks.onGameToast?.('Inventory is full.'); return; }
    this.inventory[key] = (this.inventory[key] || 0) + amount;
    if (storedInventory) storedInventory[key] = this.inventory[key];
    nearest.object.visible = false;
    this.callbacks.onLog?.('SUCCESS', `Collected ${item.resource} × ${item.amount}.`);
    this.callbacks.onGameToast?.(`Collected ${item.resource}  +${item.amount}`);
  }

  tryAttack() {
    if (!this.player || this.attackCooldown > 0) return;
    this.attackCooldown = 0.6;
    const enemy = this.findByKind('Enemy').filter((object) => object.visible && componentOf(object, 'Health')?.currentHealth > 0)
      .sort((a, b) => a.position.distanceTo(this.player.position) - b.position.distanceTo(this.player.position))[0];
    if (!enemy || enemy.position.distanceTo(this.player.position) > 3.2) { this.callbacks.onGameToast?.('No enemy in reach.'); return; }
    const health = componentOf(enemy, 'Health');
    health.currentHealth = Math.max(0, Number(health.currentHealth) - this.attackPower);
    this.callbacks.onGameToast?.(health.currentHealth > 0 ? `Hit the stalker · ${health.currentHealth} HP` : 'Stalker defeated');
    if (health.currentHealth <= 0) {
      enemy.visible = false;
      this.inventory.berries += 1;
      const storedInventory = componentOf(this.player, 'Inventory'); if (storedInventory) storedInventory.berries = this.inventory.berries;
      this.callbacks.onLog?.('SUCCESS', 'Enemy defeated. It dropped one berry.');
    }
  }

  tryCraft() {
    if (this.inventory.wood < 3 || this.inventory.stone < 2) {
      this.callbacks.onGameToast?.('Stone tool needs 3 wood + 2 stone.'); return;
    }
    this.inventory.wood -= 3; this.inventory.stone -= 2; this.attackPower = 34;
    const storedInventory = componentOf(this.player, 'Inventory');
    if (storedInventory) Object.assign(storedInventory, this.inventory);
    this.callbacks.onGameToast?.('Stone tool crafted · attacks deal more damage');
    this.callbacks.onLog?.('SUCCESS', 'Crafted a stone tool (3 wood, 2 stone).');
  }

  updateEnemies(player, dt) {
    for (const enemy of this.findByKind('Enemy')) {
      if (!enemy.visible) continue;
      const ai = componentOf(enemy, 'AIController');
      if (!ai || ai.enabled === false) continue;
      const health = componentOf(enemy, 'Health');
      const behavior = ai.behavior || 'Chase';
      if (behavior === 'Dead' || (health && health.currentHealth <= 0)) { ai.state = 'Dead'; continue; }
      if (behavior === 'Idle') { ai.state = 'Idle'; continue; }
      const delta = player.position.clone().sub(enemy.position); delta.y = 0;
      const distance = delta.length();
      const detection = Number(ai.detectionRange || 20);
      const attackRange = Number(ai.attackRange || 1.6);
      const speed = Number(ai.moveSpeed || 2.2);
      const move = (direction) => {
        if (direction.lengthSq() < 1e-6) return;
        direction.normalize();
        const nx = enemy.position.x + direction.x * speed * dt;
        const nz = enemy.position.z + direction.z * speed * dt;
        if (!this.collides(nx, enemy.position.z, enemy)) enemy.position.x = nx;
        if (!this.collides(enemy.position.x, nz, enemy)) enemy.position.z = nz;
        enemy.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;
      };
      if (behavior === 'Patrol' && distance > detection) {
        ai.state = 'Patrol';
        ai._patrolOrigin ||= [enemy.position.x, enemy.position.z];
        ai._patrolAngle = (ai._patrolAngle || 0) + dt * 0.45;
        const targetX = ai._patrolOrigin[0] + Math.cos(ai._patrolAngle) * 2.5;
        const targetZ = ai._patrolOrigin[1] + Math.sin(ai._patrolAngle) * 2.5;
        move(new THREE.Vector3(targetX - enemy.position.x, 0, targetZ - enemy.position.z));
        continue;
      }
      if (behavior === 'Flee') {
        if (distance > detection) { ai.state = 'Idle'; continue; }
        ai.state = 'Flee'; move(delta.negate()); continue;
      }
      if (distance > detection) { ai.state = behavior === 'Patrol' ? 'Patrol' : 'Idle'; continue; }
      if (behavior === 'Attack' && distance > attackRange) { ai.state = 'Attack'; continue; }
      if (distance > attackRange) {
        ai.state = behavior === 'Investigate' ? 'Investigate' : behavior === 'Follow' ? 'Follow' : 'Chase';
        move(delta);
        continue;
      }
      if (behavior === 'Follow' || behavior === 'Investigate') { ai.state = behavior; continue; }
      ai.state = 'Attack';
      ai._attackTimer = (ai._attackTimer || 0) - dt;
      if (ai._attackTimer <= 0) {
        ai._attackTimer = 1.3;
        this.health = Math.max(0, this.health - Number(ai.damage || 8));
        const hp = componentOf(player, 'Health'); if (hp) hp.currentHealth = this.health;
        this.callbacks.onGameToast?.(this.health > 0 ? 'The stalker hit you!' : 'You are down. Restart Play Mode to retry.');
        this.callbacks.onLog?.('WARNING', `Player took ${ai.damage || 8} damage from ${enemy.name}.`);
      }
    }
  }

  updateRigidBodies(dt) {
    for (const object of this.listObjects()) {
      const body = componentOf(object, 'RigidBody');
      if (!body || body.enabled === false || body.isKinematic || body.useGravity === false || componentOf(object, 'CharacterController')) continue;
      body._velocityY = (Number(body._velocityY) || 0) - 18 * dt;
      object.position.y += body._velocityY * dt;
      const collider = componentOf(object, 'Collider');
      const restingHeight = this.findGroundHeight(object.position.x, object.position.z) + Math.max(0.18, Number(collider?.radius) || 0.5);
      if (object.position.y < restingHeight) { object.position.y = restingHeight; body._velocityY = 0; }
    }
  }

  updateGraphs(player) {
    for (const graph of this.graphs) {
      if (!graph.enabled || graph.event !== 'proximity') continue;
      const trigger = this.listObjects().find((object) => object.name === graph.triggerObject && object.visible);
      if (!trigger) continue;
      const inside = trigger.position.distanceTo(player.position) <= Math.max(0.5, Number(graph.radius) || 4);
      const wasInside = this.graphStates.get(graph.id) || false;
      this.graphStates.set(graph.id, inside);
      if (!inside || wasInside) continue;
      const hour = Math.floor(this.gameTime / 60) % 24;
      if (graph.condition === 'night' && !(hour < 6 || hour >= 19)) continue;
      const target = this.listObjects().find((object) => object.name === graph.targetObject);
      if (graph.action === 'message') this.callbacks.onGameToast?.(graph.message || `${graph.name} triggered.`);
      else if (graph.action === 'open_door' && target) { target.rotation.y += Math.PI / 2; target.userData.nexus.opened = true; this.callbacks.onGameToast?.(`${target.name} opened.`); }
      else if (graph.action === 'toggle_object' && target) { target.visible = !target.visible; this.callbacks.onGameToast?.(`${target.name} ${target.visible ? 'shown' : 'hidden'}.`); }
      else if (graph.action === 'heal_player') { this.health = Math.min(100, this.health + Math.max(1, Number(graph.healAmount) || 25)); const health = componentOf(player, 'Health'); if (health) health.currentHealth = this.health; this.callbacks.onGameToast?.('The event restored your health.'); }
      this.callbacks.onLog?.('INFO', `Gameplay Graph “${graph.name}” executed (${graph.action}).`);
    }
  }

  updatePickups(dt) {
    for (const object of this.listObjects()) {
      if (!componentOf(object, 'Pickup') || !object.visible) continue;
      object.rotation.y += dt * 0.65;
      object.position.y = Math.max(0.2, object.position.y + Math.sin(performance.now() * 0.0016 + object.id) * 0.0018);
    }
  }

  gameUIState() {
    const clock = Math.floor(this.gameTime);
    const hour = Math.floor(clock / 60) % 24;
    const minute = clock % 60;
    const cycle = this.listObjects().map((object) => componentOf(object, 'DayNight')).find(Boolean);
    const cycleDuration = Math.max(30, Number(cycle?.cycleDuration) || 180);
    const day = cycle ? Math.floor((this.realPlayTime || 0) / cycleDuration) + 1 : 1;
    return { health: Math.max(0, Math.round(this.health)), stamina: Math.round(this.stamina), inventory: { ...this.inventory }, time: `DAY ${String(day).padStart(2, '0')} · ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
  }

  getSceneSummary() {
    return this.listObjects().map((object) => ({
      name: object.name,
      kind: object.userData?.nexus?.kind || object.type,
      position: object.position.toArray().map((value) => Number(value.toFixed(2))),
      components: object.userData?.nexus?.components?.map((component) => component.type) || [],
      children: object.children.filter((child) => child.userData?.nexus).length,
    }));
  }

  destroy() {
    this.disposed = true;
    this.renderer?.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.clearScene();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

export function createEditorSample(engine) { engine.createSampleScene(); }
