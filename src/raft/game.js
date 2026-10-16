import * as THREE from 'three';
import { TILE_SIZE, HOTBAR, ITEMS, RECIPES, clamp, loadGame, saveGame, newGame, collectResource, canAfford, canPlace, foundationSpots, craft, consume, tick, give } from './rules.js';
import { foundation, raftDetails, structure, character, resource, barrel, shark, seeded, material, box, cylinder, sphere } from './models.js';
import { createWorld } from './world.js';
import { UI } from './ui.js';
import { OceanAudio } from './audio.js';
import { exportRaft } from './export.js';
import { SEA_STATES, coastDistance, safeWaterPosition } from './waves.js';

const $ = id => document.getElementById(id);
const UP = new THREE.Vector3(0, 1, 0);
const ease = value => 1 - (1 - value) ** 3;
const angleLerp = (a, b, amount) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * amount;

class Drift {
  constructor() {
    try { this.storage = localStorage; } catch { this.storage = { getItem() { return null; }, setItem() { throw new Error('Storage unavailable'); } }; }
    this.state = loadGame(this.storage);
    this.state.travel = safeWaterPosition(this.state.travel);
    this.cameraMode = this.state.settings.view; this.deckPitch = .08; this.targetDeckPitch = .08; this.course = null;
    this.keys = new Set(); this.touch = new THREE.Vector2();
    this.tool = 'hook'; this.buildType = null; this.paused = false; this.photo = false;
    this.time = 0; this.uiTimer = 0; this.saveTimer = 0; this.walkTime = 0; this.actionTime = 0;
    this.cameraAngle = .90; this.targetAngle = .90;
    this.cameraPitch = .26; this.targetPitch = .26;
    this.cameraRadius = innerWidth < 600 ? 26.5 : 20; this.targetRadius = this.cameraRadius;
    this.cameraTarget = new THREE.Vector3();
    this.pointer = new THREE.Vector2(-999, -999); this.pointerNDC = new THREE.Vector2();
    this.pointers = new Map(); this.dragged = false; this.wasPinching = false; this.hovered = null;
    this.raycaster = new THREE.Raycaster(); this.buildPlane = new THREE.Plane(UP, -.66); this.intersection = new THREE.Vector3();
    this.vector = new THREE.Vector3(); this.projected = new THREE.Vector3();
    this.random = seeded(8251);
    this.effects = []; this.sails = []; this.resources = []; this.heldTools = new Map();
    this.hook = null; this.sharkNext = this.state.elapsed + 110; this.lastStrike = -10; this.sharkRetreat = -100;
    this.audio = new OceanAudio(); this.audio.enabled = this.state.settings.sound;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.state.settings.quality === 'high' ? 1.8 : 1));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .98;
    this.renderer.shadowMap.enabled = this.state.settings.quality === 'high'; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; this.needsShadowUpdate = true;
    this.renderer.setClearColor('#94c5c0');
    this.renderer.domElement.setAttribute('aria-label', '3D ocean. Drag to look, click supplies to collect, or use WASD and E.');
    this.renderer.domElement.tabIndex = 0;
    $('ocean').appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(49, innerWidth / innerHeight, .1, 800);
    this.world = createWorld(this.renderer); this.scene = this.world.scene;
    this.world.update(0, this.state.travel, this.state.settings.quality, this.state.settings.sea);
    this.raft = new THREE.Group(); this.raft.name = 'My little world'; this.scene.add(this.raft);
    this.floors = new THREE.Group(); this.raft.add(this.floors);
    for (const tile of this.state.tiles) this.addFoundation(tile);
    this.raft.add(raftDetails());
    for (const item of this.state.structures) this.addStructure(item);
    const deckBarrel = barrel(); deckBarrel.position.set(2.32, 1.19, -.65); deckBarrel.rotation.y = .4; this.raft.add(deckBarrel);
    const coil = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.21 + i * .025, .021, 5, 20), material('#d0b785')); ring.rotation.x = Math.PI / 2; ring.position.y = i * .023; coil.add(ring);
    }
    coil.position.set(-1.87, .71, .66); this.raft.add(coil);
    this.player = character(); this.player.name = 'The castaway'; this.player.position.set(.3, .58, 1.3); this.player.rotation.y = .38; this.playerTargetAngle = .38; this.raft.add(this.player);
    this.viewRig = new THREE.Group(); this.viewRig.position.set(.38, -.30, -.85); this.viewRig.scale.setScalar(.75); this.camera.add(this.viewRig); this.scene.add(this.camera);
    sphere(this.viewRig, material('#be966e'), [0, -.085, .015], [.073, .1, .08]);
    const forearm = cylinder(this.viewRig, material('#be966e'), [.055, -.28, .065], .055, .075, .32, 8); forearm.rotation.z = .28;
    this.showHeldTool();
    this.spawnResources();
    this.shark = shark(); this.shark.position.set(12, -.34, -5); this.scene.add(this.shark);
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(.57, .59, 40), new THREE.MeshBasicMaterial({ color: '#eddeb0', transparent: true, opacity: .48, side: THREE.DoubleSide, depthWrite: false }));
    this.targetRing.rotation.x = -Math.PI / 2; this.scene.add(this.targetRing);
    this.hookLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(28 * 3), 3)), new THREE.LineBasicMaterial({ color: '#e3d1a2', transparent: true, opacity: .9 }));
    this.hookLine.frustumCulled = false; this.hookLine.visible = false; this.scene.add(this.hookLine);
    this.hookHead = new THREE.Mesh(new THREE.TorusGeometry(.13, .025, 6, 15, Math.PI * 1.7), material('#b4c4b5', { metalness: .4 })); this.hookHead.visible = false; this.scene.add(this.hookHead);
    this.ui = new UI(this);
    this.bindControls(); this.resize(); this.setCameraMode(this.cameraMode, false); this.updateCamera(1);
    this.ui.selectTool(HOTBAR[0]); this.ui.update(); this.ui.updateCompass(this.cameraAngle);
    this.clock = new THREE.Clock(); this.frameCount = 0;
    this.renderer.setAnimationLoop(() => this.frame());
    requestAnimationFrame(() => requestAnimationFrame(() => { $('loading').classList.add('loaded'); $('ocean').setAttribute('data-ready', 'true'); }));
    if (this.state.stats.health <= 0) this.ui.showModal('gameover');
    else if (this.state.elapsed > 2) $('save-status').textContent = 'Welcome back to your little world.';
  }

  addFoundation(tile) {
    this.needsShadowUpdate = true;
    this.world.setRaftRadius(Math.max(...this.state.tiles.map(tile => Math.hypot(tile.x, tile.z) * TILE_SIZE)) + 1.1);
    const model = foundation(tile.x * 1349 + tile.z * 389 + 7900); model.position.set(tile.x * TILE_SIZE, 0, tile.z * TILE_SIZE); model.name = `Foundation ${tile.x}, ${tile.z}`; this.floors.add(model);
    return model;
  }
  addStructure(item) {
    this.needsShadowUpdate = true;
    const model = structure(item.type); model.position.set(item.x * TILE_SIZE, .66, item.z * TILE_SIZE); model.name = RECIPES[item.type]?.name || 'Storage chest';
    if (item.type === 'sail') { model.position.x += .55; model.position.z += .32; model.rotation.y = -.08; this.sails.push(model); }
    this.raft.add(model); return model;
  }

  spawnResources() {
    const first = [
      ['wood', -6, 2.7], ['barrel', 6.5, 2], ['plastic', 1.5, 7.6], ['leaf', -4.9, -5.8],
      ['crate', 7.7, -7.2], ['wood', -8.4, -4.4], ['barrel', -8.6, 9.8], ['wood', 9.3, 8.1],
      ['leaf', 2, -10], ['wood', -3.5, 10.5], ['plastic', 11.5, -1.5], ['leaf', -12.3, 2.5],
    ];
    for (let i = 0; i < 32; i++) {
      const kind = first[i]?.[0] || ['wood', 'wood', 'plastic', 'leaf', 'barrel', 'wood', 'crate', 'leaf'][i % 8];
      const root = new THREE.Group(); root.add(resource(kind));
      const angle = this.random() * Math.PI * 2, radius = 13 + this.random() * 27;
      root.position.set(first[i]?.[1] ?? Math.cos(angle) * radius, .12, first[i]?.[2] ?? Math.sin(angle) * radius);
      root.rotation.y = this.random() * Math.PI * 2;
      root.userData = { kind, phase: this.random() * Math.PI * 2, rotation: root.rotation.y, baseY: kind === 'barrel' ? .16 : kind === 'crate' ? -.1 : .13, speed: .065 + this.random() * .055, resource: true };
      this.resources.push(root); this.scene.add(root);
    }
  }

  bindControls() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      if (this.ui.modal) return;
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
      this.pointer.set(event.clientX, event.clientY);
      if (this.pointers.size === 1) { this.dragged = false; this.wasPinching = false; }
      if (this.pointers.size === 2) { this.wasPinching = true; this.pinchDistance = this.pointerDistance(); }
      if (this.state.settings.sound && !this.audio.context) this.audio.init().catch(() => {});
    });
    canvas.addEventListener('pointermove', event => {
      this.pointer.set(event.clientX, event.clientY);
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      this.pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });
      if (this.pointers.size >= 2) {
        const distance = this.pointerDistance();
        if (this.pinchDistance > 0) this.targetRadius = clamp(this.targetRadius * this.pinchDistance / distance, this.minZoom(), 42);
        this.pinchDistance = distance; return;
      }
      if (Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > 5) this.dragged = true;
      if (this.dragged) {
        this.targetAngle -= dx * .006;
        if (this.cameraMode === 'deck') this.targetDeckPitch = clamp(this.targetDeckPitch + dy * .0035, -.82, 1.0);
        else this.targetPitch = clamp(this.targetPitch + dy * .0045, .13, 1.02);
        canvas.style.cursor = 'grabbing';
      }
    });
    const pointerUp = event => {
      const hasPointer = this.pointers.has(event.pointerId);
      this.pointers.delete(event.pointerId);
      if (hasPointer && !this.dragged && !this.wasPinching && event.button === 0 && event.type !== 'pointercancel' && !this.photo) {
        this.pointer.set(event.clientX, event.clientY); this.action(true);
      }
      if (!this.pointers.size) canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('pointerleave', () => { if (!this.pointers.size) this.pointer.set(-999, -999); });
    canvas.addEventListener('wheel', event => {
      event.preventDefault(); if (this.ui.modal || this.cameraMode === 'deck') return;
      this.targetRadius = clamp(this.targetRadius + event.deltaY * .012, this.minZoom(), 42);
    }, { passive: false });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.setPaused(true);
      $('error-message').textContent = 'Your browser paused its 3D graphics. Your last save is safe. Reload to return to your raft.';
      $('error-screen').hidden = false;
    });
    window.addEventListener('keydown', event => this.keyDown(event));
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.clearKeys(); this.pointers.clear(); });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pagehide', () => this.save(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.save(false); this.clearKeys(); if (!this.ui.modal && !this.photo) this.ui.showModal('pause'); }
    });
    const joystick = $('joystick'); let joystickId = null;
    const moveJoystick = event => {
      if (event.pointerId !== joystickId) return;
      const rect = joystick.getBoundingClientRect();
      this.touch.set((event.clientX - rect.left - rect.width / 2) / 30, (event.clientY - rect.top - rect.height / 2) / 30);
      if (this.touch.length() > 1) this.touch.normalize();
      $('joystick-knob').style.transform = `translate(${this.touch.x * 24}px, ${this.touch.y * 24}px)`;
    };
    joystick.addEventListener('pointerdown', event => {
      if (this.paused || this.ui.panel) return;
      event.preventDefault(); joystickId = event.pointerId; joystick.setPointerCapture(event.pointerId); moveJoystick(event);
    });
    joystick.addEventListener('pointermove', moveJoystick);
    const releaseJoystick = event => { if (event.pointerId === joystickId) { joystickId = null; this.touch.set(0, 0); $('joystick-knob').style.transform = ''; } };
    joystick.addEventListener('pointerup', releaseJoystick); joystick.addEventListener('pointercancel', releaseJoystick);
  }
  pointerDistance() { const [a, b] = [...this.pointers.values()]; return a && b ? Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) : 1; }
  minZoom() { return innerWidth < 600 ? 19 : 12; }
  clearKeys() { this.keys.clear(); this.touch.set(0, 0); $('joystick-knob').style.transform = ''; }
  keyDown(event) {
    if (event.target.matches('input, textarea, select, [contenteditable]')) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      if (this.photo) this.photoMode(false);
      else if (this.ui.modal) this.ui.closeModal();
      else if (this.ui.panel) this.ui.closePanel();
      else if (this.buildType) this.selectTool('hook');
      else this.ui.showModal('pause');
      return;
    }
    if (this.ui.modal) return;
    if (['Tab', 'Space', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(event.code)) event.preventDefault();
    if (event.code === 'KeyP' && !event.repeat) { this.photoMode(!this.photo); return; }
    if (event.code === 'KeyV' && !event.repeat) { this.setCameraMode(this.cameraMode === 'deck' ? 'orbit' : 'deck'); return; }
    if (this.photo) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) this.keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'Tab' || event.code === 'KeyI') this.ui.togglePanel('inventory');
    else if (event.code === 'KeyC') this.ui.togglePanel('crafting');
    else if (event.code === 'KeyB') this.selectTool(this.tool === 'hammer' ? 'hook' : 'hammer');
    else if (event.code === 'KeyH') this.ui.showModal('help');
    else if (event.code === 'KeyG') this.startCourse();
    else if (/^Digit[1-6]$/.test(event.code)) this.selectTool(HOTBAR[Number(event.code.slice(-1)) - 1].id);
    else if (event.code === 'KeyE' || event.code === 'Space') this.action();
  }

  selectTool(id) {
    if (this.paused || this.photo) return;
    const tool = HOTBAR.find(item => item.id === id); if (!tool) return;
    if (id === 'hammer' && this.cameraMode === 'deck') this.setCameraMode('orbit', false);
    if (id !== 'paddle') this.course = null;
    this.tool = id; this.ui.selectTool(tool); this.showHeldTool(); this.audio.play('click');
    if (id === 'hammer') { this.ui.closePanel(); this.buildType = 'foundation'; this.makeBuildSpots(); this.ui.setBuild('foundation'); }
    else { this.buildType = null; this.removeBuildSpots(); this.ui.setBuild(null); }
    if (id === 'paddle') this.ui.toast('Hold W A S D, or use the joystick, to steer toward an island.', 'info');
    if (id === 'cup' || id === 'coconut') this.ui.toast(tool.hint + '.', 'info');
  }

  showHeldTool() {
    if (this.heldTool) this.heldTool.removeFromParent();
    if (!this.heldTools.has(this.tool)) {
      const group = new THREE.Group(), wood = material('#b88b58'), metal = material('#a2b8af');
      if (this.tool === 'hook') {
        const hook = new THREE.Mesh(new THREE.TorusGeometry(.11, .025, 6, 13, Math.PI * 1.7), metal); hook.position.y = -.12; hook.rotation.z = -.8; group.add(hook); cylinder(group, wood, [0, .02, 0], .024, .024, .17, 6);
      } else if (this.tool === 'hammer') {
        cylinder(group, wood, [0, .08, 0], .025, .025, .4, 6); box(group, metal, [0, .28, 0], [.29, .13, .15]);
      } else if (this.tool === 'paddle') {
        cylinder(group, wood, [0, -.26, 0], .025, .026, 1.4, 6); box(group, material('#d2a66a'), [0, -.99, 0], [.21, .48, .045]); group.rotation.z = -.35;
      } else if (this.tool === 'spear') {
        cylinder(group, wood, [0, .18, 0], .024, .024, 1.5, 6); cylinder(group, metal, [0, 1.02, 0], 0, .07, .23, 5); group.rotation.x = -.32;
      } else if (this.tool === 'cup') {
        cylinder(group, metal, [0, 0, .025], .11, .085, .19, 10); cylinder(group, material('#72bfc0'), [0, .1, .025], .092, .092, .007, 10);
      } else sphere(group, material('#9f7545'), [0, 0, 0], [.14, .15, .13]);
      this.heldTools.set(this.tool, group);
    }
    this.heldTool = this.heldTools.get(this.tool); this.heldTool.position.set(.075, -.39, .07); this.player.userData.arms[1].add(this.heldTool);
    if (this.viewRig) {
      this.fpTool?.removeFromParent(); this.fpTool = this.heldTool.clone(true); this.fpTool.position.set(0, 0, 0); this.viewRig.add(this.fpTool);
      this.viewRig.traverse(node => { if (node.isMesh) node.castShadow = false; });
    }
  }

  chooseRecipe(type) {
    if (this.paused) return;
    if (!Object.hasOwn(RECIPES, type)) return;
    const recipe = RECIPES[type];
    if (!canAfford(this.state, recipe.cost)) { this.ui.toast('Not enough supplies. Keep an eye on the tide.', 'warn'); return; }
    if (!recipe.place) {
      const result = craft(this.state, type);
      if (result.ok) { this.audio.play('build'); this.ui.toast('Woven rope. A little more holding it all together.'); this.save(); this.ui.update(); }
      return;
    }
    this.selectTool('hammer'); this.buildType = type; this.makeBuildSpots(); this.ui.setBuild(type); this.ui.closePanel();
  }

  removeBuildSpots() {
    if (!this.buildSpots) return;
    const geometries = new Set(), materials = new Set();
    this.buildSpots.traverse(child => { if (child.geometry) geometries.add(child.geometry); if (child.material) materials.add(child.material); });
    geometries.forEach(geo => geo.dispose()); materials.forEach(mat => mat.dispose());
    this.buildSpots.removeFromParent(); this.buildSpots = null; this.buildCandidate = null;
  }
  makeBuildSpots() {
    this.removeBuildSpots(); this.buildSpots = new THREE.Group(); this.raft.add(this.buildSpots);
    const spots = this.buildType === 'foundation' ? foundationSpots(this.state) : this.state.tiles.filter(tile => canPlace(this.state, this.buildType, tile.x, tile.z));
    const planeGeometry = new THREE.PlaneGeometry(TILE_SIZE - .1, TILE_SIZE - .1);
    const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE_SIZE - .06, .09, TILE_SIZE - .06));
    for (const spot of spots) {
      const group = new THREE.Group(); group.position.set(spot.x * TILE_SIZE, .68, spot.z * TILE_SIZE); group.userData.tile = spot;
      const fill = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({ color: '#b6d5b3', transparent: true, opacity: .10, side: THREE.DoubleSide, depthWrite: false })); fill.rotation.x = -Math.PI / 2; group.add(fill);
      const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: '#d5e1b7', transparent: true, opacity: .42 })); group.add(edges);
      const cross = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.18, .01, 0), new THREE.Vector3(.18, .01, 0), new THREE.Vector3(0, .01, -.18), new THREE.Vector3(0, .01, .18)]);
      group.add(new THREE.LineSegments(cross, new THREE.LineBasicMaterial({ color: '#e9e8b6', transparent: true, opacity: .7 })));
      this.buildSpots.add(group);
    }
    this.defaultBuild = spots.find(spot => spot.x === 0 && spot.z === 2) || spots[0] || null;
    this.buildCandidate = this.defaultBuild;
    if (!spots.length) this.ui.toast(this.buildType === 'foundation' ? 'Your raft has reached its 64-foundation limit.' : 'Add a foundation to make room for another improvement.', 'info');
  }
  updateBuildCandidate(fromPointer = false) {
    if (!this.buildSpots) return;
    if (this.pointer.x > -100) {
      this.pointerNDC.set(this.pointer.x / innerWidth * 2 - 1, -(this.pointer.y / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(this.pointerNDC, this.camera);
      this.raft.updateMatrixWorld(true);
      this.buildPlane.normal.set(0, 1, 0); this.buildPlane.constant = -.68; this.buildPlane.applyMatrix4(this.raft.matrixWorld);
      this.buildCandidate = null;
      if (this.raycaster.ray.intersectPlane(this.buildPlane, this.intersection)) {
        const local = this.raft.worldToLocal(this.intersection.clone());
        const x = Math.round(local.x / TILE_SIZE), z = Math.round(local.z / TILE_SIZE);
        if (canPlace(this.state, this.buildType, x, z)) this.buildCandidate = { x, z };
      }
    } else if (!fromPointer) this.buildCandidate = this.defaultBuild;
    const affordable = canAfford(this.state, RECIPES[this.buildType].cost);
    for (const child of this.buildSpots.children) {
      const active = this.buildCandidate && child.userData.tile.x === this.buildCandidate.x && child.userData.tile.z === this.buildCandidate.z;
      child.children[0].material.opacity = active ? .4 : .08;
      child.children[1].material.opacity = active ? .92 : .32;
      child.children[0].material.color.set(affordable ? active ? '#e3daa0' : '#b6d5b3' : '#d09271');
    }
  }
  build(pointerAction = false) {
    this.updateBuildCandidate(pointerAction);
    const candidate = this.buildCandidate || (!pointerAction ? this.defaultBuild : null);
    if (!candidate) { this.ui.toast(this.buildType === 'foundation' ? 'Click one of the highlighted edges of your raft.' : 'Click an empty foundation on your raft.', 'info'); return; }
    const type = this.buildType, result = craft(this.state, type, candidate.x, candidate.z);
    if (!result.ok) { this.ui.toast(result.reason, 'warn'); return; }
    if (type === 'foundation') this.addFoundation(candidate);
    else this.addStructure(this.state.structures.at(-1));
    this.spawnEffect(new THREE.Vector3(candidate.x * TILE_SIZE, .78, candidate.z * TILE_SIZE), '#efe0a1');
    this.actionTime = .45; this.audio.play('build'); this.ui.toast(`${result.name} built. A little more like home.`); this.ui.dismissTip(); this.save(); this.ui.update();
    if (type !== 'foundation') this.selectTool('hook'); else this.makeBuildSpots();
  }

  action(pointerAction = false) {
    if (this.paused || this.photo || this.ui.modal) return;
    if (this.state.settings.sound && !this.audio.context) this.audio.init().catch(() => {});
    if (this.buildType) { this.build(pointerAction); return; }
    if (this.tool === 'cup') { this.consume('water'); return; }
    if (this.tool === 'coconut') { this.consume('food'); return; }
    if (this.tool === 'spear') { this.defend(); return; }
    if (this.tool === 'paddle') { this.ui.toast('Hold W A S D, or use the joystick, to steer the raft.', 'info'); return; }
    if (this.hook) return;
    const target = pointerAction ? this.findHovered(48) : this.hovered || this.labelTarget || this.findNearest();
    if (!target) {
      if (pointerAction) { const close = this.findHovered(90); if (close) this.castHook(close); else this.ui.toast('Click floating wood, leaves, bottles, or barrels. E hooks the nearest supply.', 'info'); }
      else this.ui.toast('Nothing in reach yet. Let the current bring something closer.', 'info');
      return;
    }
    this.castHook(target);
  }
  consume(item) {
    if (this.paused) return;
    const result = consume(this.state, item);
    this.ui.toast(result.reason, result.ok ? 'success' : 'warn');
    if (result.ok) { this.audio.play(item === 'water' ? 'drink' : 'eat'); this.actionTime = .75; this.save(); this.ui.update(); }
  }

  findNearest() {
    let closest = null, distance = 26;
    for (const item of this.resources) {
      const dist = Math.hypot(item.position.x - this.player.position.x, item.position.z - this.player.position.z);
      if (dist < distance) { distance = dist; closest = item; }
    }
    return closest;
  }
  findHovered(tolerance = 36) {
    if (this.pointer.x < 0) return null;
    let closest = null, distance = tolerance;
    for (const item of this.resources) {
      if (Math.hypot(item.position.x, item.position.z) > 28) continue;
      const screen = this.screenPosition(item.position, .35);
      if (screen.z > 1) continue;
      const dist = Math.hypot(screen.x - this.pointer.x, screen.y - this.pointer.y);
      if (dist < distance) { closest = item; distance = dist; }
    }
    return closest;
  }
  screenPosition(position, height = 0) {
    this.projected.copy(position); this.projected.y += height; this.projected.project(this.camera);
    return { x: (this.projected.x * .5 + .5) * innerWidth, y: (-this.projected.y * .5 + .5) * innerHeight, z: this.projected.z };
  }
  castHook(target) {
    if (this.hook) return;
    this.hook = { target, elapsed: 0, origin: target.position.clone() };
    this.hookLine.visible = true; this.hookHead.visible = true;
    this.playerTargetAngle = Math.atan2(target.position.x - this.player.position.x, target.position.z - this.player.position.z);
    this.actionTime = 1.3; this.audio.play('hook'); this.ui.closePanel();
  }
  updateHook(dt) {
    if (!this.hook) return;
    const hook = this.hook; hook.elapsed += dt;
    const hand = this.cameraMode === 'deck' ? this.viewRig.localToWorld(new THREE.Vector3(0, -.06, 0)) : this.player.localToWorld(new THREE.Vector3(.3, .85, .17));
    const tip = new THREE.Vector3();
    if (hook.elapsed < .32) {
      const t = hook.elapsed / .32; tip.lerpVectors(hand, hook.origin, t); tip.y += Math.sin(t * Math.PI) * 2.1;
    } else {
      const t = clamp((hook.elapsed - .32) / .95, 0, 1);
      tip.lerpVectors(hook.origin, hand, ease(t)); tip.y += Math.sin(t * Math.PI) * .36;
      hook.target.position.copy(tip); hook.target.rotation.y += dt * 2;
      if (t >= 1) {
        const contents = collectResource(this.state, hook.target.userData.kind);
        this.audio.play('collect'); this.ui.toast('', 'success', contents); this.spawnEffect(hand, '#e7e6b2');
        this.recycleResource(hook.target); this.hook = null; this.hookLine.visible = false; this.hookHead.visible = false;
        if (this.state.gathered.wood + this.state.gathered.plastic + this.state.gathered.leaf > 6) this.ui.dismissTip();
        this.save(); this.ui.update(); return;
      }
    }
    this.hookHead.position.copy(tip); this.hookHead.rotation.z += dt * 3;
    const positions = this.hookLine.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const t = i / (positions.count - 1); this.vector.lerpVectors(hand, tip, t);
      this.vector.y -= Math.sin(t * Math.PI) * .36;
      positions.setXYZ(i, this.vector.x, this.vector.y, this.vector.z);
    }
    positions.needsUpdate = true;
  }
  recycleResource(item) {
    const angle = this.random() * Math.PI * 2, radius = 17 + this.random() * 10;
    item.position.set(Math.cos(angle) * radius, item.userData.baseY, Math.sin(angle) * radius);
    item.userData.rotation = this.random() * Math.PI * 2; item.rotation.y = item.userData.rotation;
  }

  defend() {
    if (this.state.elapsed - this.lastStrike < .65) return;
    this.lastStrike = this.state.elapsed; this.actionTime = .6; this.audio.play('defend');
    this.playerTargetAngle = Math.atan2(this.shark.position.x - this.player.position.x, this.shark.position.z - this.player.position.z);
    if (Math.hypot(this.shark.position.x, this.shark.position.z) < 17) {
      this.sharkNext = this.state.elapsed + 125; this.sharkRetreat = this.state.elapsed;
      this.spawnEffect(this.shark.position.clone().setY(.2), '#e2eec5');
      this.ui.toast('Not today. The shark is heading back to open water.');
      $('shark-warning').hidden = true;
    } else this.ui.toast('The shark is safely out of reach. Keep your spear handy.', 'info');
  }
  updateShark(dt) {
    const warning = this.state.elapsed >= this.sharkNext - 12;
    $('shark-warning').hidden = !warning || this.photo;
    const retreat = this.state.elapsed - this.sharkRetreat < 14;
    const desiredRadius = retreat ? 28 : warning ? 5.8 : 14;
    this.sharkRadius ??= 14; this.sharkRadius += (desiredRadius - this.sharkRadius) * dt * .7;
    const angle = this.time * (warning ? .29 : .105) - .7;
    this.shark.position.set(Math.cos(angle) * this.sharkRadius, -.42 + Math.sin(this.time * 1.5) * .04, Math.sin(angle) * this.sharkRadius);
    this.shark.position.y = this.world.sampleWater(this.shark.position.x, this.shark.position.z).height - .42;
    this.shark.rotation.y = -angle; this.shark.rotation.z = Math.sin(this.time * 2) * .018;
    if (this.state.elapsed >= this.sharkNext) {
      this.state.raftHealth = Math.max(1, this.state.raftHealth - 12);
      this.state.stats.health = Math.max(0, this.state.stats.health - 14);
      this.sharkNext = this.state.elapsed + 130; this.sharkRetreat = this.state.elapsed;
      this.ui.toast('A shark scraped the raft. Use your spear [4] when it circles closer.', 'warn'); this.audio.play('warn'); this.save();
    }
  }

  spawnEffect(position, color) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.15, .2, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(position); this.scene.add(ring); this.effects.push({ mesh: ring, age: 0 });
  }
  isWalkable(x, z) {
    for (const [dx, dz] of [[0, 0], [.19, 0], [-.19, 0], [0, .19], [0, -.19]]) {
      const tx = Math.round((x + dx) / TILE_SIZE), tz = Math.round((z + dz) / TILE_SIZE);
      if (!this.state.tiles.some(tile => tile.x === tx && tile.z === tz)) return false;
    }
    for (const structure of this.state.structures) {
      const sx = structure.x * TILE_SIZE + (structure.type === 'sail' ? .55 : 0), sz = structure.z * TILE_SIZE + (structure.type === 'sail' ? .32 : 0);
      if (Math.hypot(x - sx, z - sz) < (structure.type === 'sail' ? .32 : .64)) return false;
    }
    return true;
  }
  move(dt) {
    const key = code => this.keys.has(code) ? 1 : 0;
    const x = key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft') + this.touch.x;
    const z = key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown') - this.touch.y;
    this.moving = (Math.abs(x) + Math.abs(z) > .06) && !this.ui.panel;
    const deltaTravel = new THREE.Vector2(.018 * dt, -.033 * dt);
    if (this.moving) {
      this.course = null;
      const dir = this.vector.set(Math.cos(this.cameraAngle) * x - Math.sin(this.cameraAngle) * z, 0, -Math.sin(this.cameraAngle) * x - Math.cos(this.cameraAngle) * z).normalize();
      this.playerTargetAngle = Math.atan2(dir.x, dir.z);
      if (this.tool === 'paddle') { deltaTravel.x += dir.x * dt * 3.1; deltaTravel.y += dir.z * dt * 3.1; }
      else {
        const nx = this.player.position.x + dir.x * dt * 2.3, nz = this.player.position.z + dir.z * dt * 2.3;
        if (this.isWalkable(nx, this.player.position.z)) this.player.position.x = nx;
        if (this.isWalkable(this.player.position.x, nz)) this.player.position.z = nz;
      }
    }
    if (this.course) {
      const dx = this.course.x - this.state.travel.x, dz = this.course.z - this.state.travel.z, distance = Math.hypot(dx, dz);
      if (distance < this.course.radius * 1.15 + 5.8) {
        this.course = null; deltaTravel.set(0, 0); this.selectTool('hook');
        this.ui.toast('Palmwood Cove. Supplies salvaged. Press V to enjoy the view from your deck.'); this.save();
      } else {
        const speed = Math.min(3.1 * dt, distance - (this.course.radius * 1.15 + 5.5));
        deltaTravel.set(dx / distance * speed, dz / distance * speed);
        this.playerTargetAngle = Math.atan2(dx, dz);
      }
    }
    for (const island of this.world.islands) {
      const proposed = Math.hypot(island.x - (this.state.travel.x + deltaTravel.x), island.z - (this.state.travel.z + deltaTravel.y));
      if (coastDistance(this.state.travel.x + deltaTravel.x, this.state.travel.z + deltaTravel.y, island) < 4.6) {
        deltaTravel.set(0, 0);
        if (this.course) { this.course = null; this.ui.toast('Shallow water ahead. Use the paddle to steer around the coast.', 'info'); }
      }
      if (proposed < island.radius + 10 && !this.state.discovered?.includes(island.x)) {
        this.state.discovered ||= []; this.state.discovered.push(island.x);
        give(this.state, { wood: 8, leaf: 6, food: 3, water: 2, scrap: 2 });
        this.ui.toast('Island discovered! Beachcombing added wood, leaves, food, water, and scrap to your pack.'); this.audio.play('collect'); this.save();
      }
    }
    this.state.travel.x += deltaTravel.x; this.state.travel.z += deltaTravel.y;
    this.travelDelta = deltaTravel;
    if (this.moving) this.walkTime += dt * (this.tool === 'paddle' ? 6 : 10);
    else this.walkTime = 0;
  }

  updateResources(dt) {
    for (const item of this.resources) {
      if (this.hook?.target === item) continue;
      const data = item.userData;
      if (!this.paused) {
        item.position.x += (-data.speed * .7 * dt) - (this.travelDelta?.x || 0);
        item.position.z += (data.speed * dt) - (this.travelDelta?.y || 0);
      }
      const surface = this.world.sampleWater(item.position.x, item.position.z);
      item.position.y = data.baseY + surface.height;
      item.rotation.x = -Math.atan(surface.dz) + Math.sin(this.time * .8 + data.phase) * .025;
      item.rotation.z = Math.atan(surface.dx) + Math.cos(this.time * .9 + data.phase) * .025;
      item.rotation.y = data.rotation + Math.sin(this.time * .19 + data.phase) * .18;
      const r = Math.hypot(item.position.x, item.position.z);
      if (r < 4.65) { item.position.x *= 4.65 / Math.max(r, .1); item.position.z *= 4.65 / Math.max(r, .1); }
      if (r > 48) this.recycleResource(item);
    }
  }

  updateCamera(dt) {
    const smoothing = 1 - Math.exp(-dt * 10);
    this.cameraAngle += (this.targetAngle - this.cameraAngle) * smoothing;
    this.cameraPitch += (this.targetPitch - this.cameraPitch) * smoothing;
    this.cameraRadius += (this.targetRadius - this.cameraRadius) * smoothing;
    this.deckPitch += (this.targetDeckPitch - this.deckPitch) * smoothing;
    this.player.visible = this.cameraMode !== 'deck';
    this.viewRig.visible = this.cameraMode === 'deck' && !this.photo;
    if (this.cameraMode === 'deck') {
      this.raft.updateMatrixWorld(true);
      const head = this.player.localToWorld(new THREE.Vector3(0, 1.52, .02));
      this.camera.position.copy(head);
      this.cameraTarget.set(head.x - Math.sin(this.cameraAngle) * Math.cos(this.deckPitch), head.y - Math.sin(this.deckPitch), head.z - Math.cos(this.cameraAngle) * Math.cos(this.deckPitch));
      this.camera.up.set(0, 1, 0); this.camera.lookAt(this.cameraTarget); this.camera.updateMatrixWorld(); return;
    }
    const portrait = innerWidth / innerHeight < .8;
    this.cameraTarget.set(portrait ? 0 : -.6, portrait ? 1.3 : 1.32, portrait ? 0 : .45);
    const horizontal = Math.cos(this.cameraPitch) * this.cameraRadius;
    this.camera.position.set(this.cameraTarget.x + Math.sin(this.cameraAngle) * horizontal, this.cameraTarget.y + Math.sin(this.cameraPitch) * this.cameraRadius, this.cameraTarget.z + Math.cos(this.cameraAngle) * horizontal);
    this.camera.lookAt(this.cameraTarget); this.camera.updateMatrixWorld();
  }

  animateModels(dt) {
    const ocean = this.world.surface;
    this.raft.position.y = ocean.height;
    this.raft.rotation.x = -Math.atan(ocean.dz);
    this.raft.rotation.z = Math.atan(ocean.dx);
    this.viewRig.rotation.x = this.actionTime > 0 ? Math.sin(this.actionTime * 7) * .16 : Math.sin(this.walkTime) * .02;
    this.player.rotation.y = angleLerp(this.player.rotation.y, this.playerTargetAngle, 1 - Math.exp(-dt * 9));
    const moving = this.moving && !this.paused && this.tool !== 'paddle';
    const swing = moving ? Math.sin(this.walkTime) * .55 : 0;
    const data = this.player.userData;
    data.legs[0].rotation.x = swing; data.legs[1].rotation.x = -swing;
    data.body.position.y = moving ? Math.abs(Math.sin(this.walkTime)) * .026 : Math.sin(this.time * 2) * .007;
    data.arms[0].rotation.x = -swing * .75;
    data.arms[1].rotation.x = swing * .75;
    if (this.hook) data.arms[1].rotation.x = -.7 - Math.sin(this.hook.elapsed * 5) * .25;
    else if (this.actionTime > 0) { data.arms[1].rotation.x = -1.2 + Math.sin(this.actionTime * 9) * .3; if (!this.paused) this.actionTime -= dt; }
    else if (this.tool === 'paddle' && this.moving) data.arms[1].rotation.x = Math.sin(this.walkTime) * .65;
    for (const sail of this.sails) {
      const cloth = sail.userData.cloth, original = sail.userData.clothOriginal, positions = cloth.geometry.attributes.position, uv = cloth.geometry.attributes.uv;
      for (let i = 0; i < positions.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        positions.setZ(i, original[i * 3 + 2] + Math.sin(this.time * 1.6 + u * 4.2 + v * 2) * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * .08);
      }
      positions.needsUpdate = true;
      if (this.frameCount % 5 === 0) cloth.geometry.computeVertexNormals();
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]; effect.age += dt;
      effect.mesh.scale.setScalar(1 + effect.age * 5); effect.mesh.material.opacity = Math.max(0, .7 * (1 - effect.age / .8));
      if (effect.age > .8) { effect.mesh.removeFromParent(); effect.mesh.geometry.dispose(); effect.mesh.material.dispose(); this.effects.splice(i, 1); }
    }
  }

  updateTarget() {
    this.hovered = this.findHovered();
    const suggested = this.resources[0];
    const target = this.hook?.target || this.hovered || (this.state.elapsed < 45 ? suggested : this.findNearest());
    this.targetRing.visible = !!target && this.tool === 'hook' && !this.photo && !this.ui.modal;
    if (target) {
      const surface = this.world.sampleWater(target.position.x, target.position.z);
      this.targetRing.position.set(target.position.x, surface.height + .04, target.position.z);
      this.targetRing.rotation.set(-Math.PI / 2 - Math.atan(surface.dz), 0, Math.atan(surface.dx));
      this.targetRing.scale.setScalar(1 + Math.sin(this.time * 2) * .08);
      this.ui.setWorldLabel(this.tool === 'hook' ? target : null, this.screenPosition(target.position, .25));
    } else this.ui.setWorldLabel(null);
    this.labelTarget = !$('world-label').hidden ? target : null;
    if (!this.pointers.size) this.renderer.domElement.style.cursor = this.buildType ? this.buildCandidate ? 'crosshair' : 'default' : this.hovered && this.tool === 'hook' ? 'pointer' : 'grab';
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), .065); this.time += dt; this.frameCount++;
    if (!this.paused && !document.hidden) {
      for (const event of tick(this.state, dt)) {
        this.ui.toast(event.item === 'water' ? 'Your purifier made fresh water. +1 drink' : 'Something good is growing. +1 coconut'); this.audio.play('collect');
      }
      this.move(dt); this.updateHook(dt); this.updateShark(dt);
      this.saveTimer += dt;
      if (this.saveTimer >= 8) { this.saveTimer = 0; this.save(); }
      if (this.state.stats.health <= 0) { this.save(); this.ui.showModal('gameover'); }
    }
    this.world.update(this.time, this.state.travel, this.state.settings.quality, this.state.settings.sea);
    this.updateResources(dt); this.animateModels(dt); this.updateCamera(dt);
    if (this.buildType) this.updateBuildCandidate();
    this.updateTarget();
    this.uiTimer += dt;
    if (this.uiTimer > .25) { this.uiTimer = 0; this.ui.update(); }
    this.ui.updateCompass(this.cameraAngle);
    this.renderer.shadowMap.needsUpdate = this.needsShadowUpdate || this.frameCount % 3 === 0;
    const viewVisible = this.viewRig.visible; this.viewRig.visible = false;
    this.world.renderReflection(this.camera, this.state.settings.quality);
    this.viewRig.visible = viewVisible;
    this.renderer.render(this.scene, this.camera);
    this.needsShadowUpdate = false;
  }
  setCameraMode(mode, notify = true) {
    if (!['orbit', 'deck'].includes(mode)) return;
    if (mode === 'deck' && this.buildType) {
      this.buildType = null; this.removeBuildSpots(); this.ui.setBuild(null);
      this.tool = 'hook'; this.showHeldTool(); this.ui.selectTool(HOTBAR[0]);
    }
    this.cameraMode = mode; this.state.settings.view = mode;
    this.camera.fov = mode === 'deck' ? 68 : 49; this.camera.updateProjectionMatrix();
    document.body.classList.toggle('deck-view', mode === 'deck');
    this.ui?.updateViewButton();
    if (notify) { this.save(false); this.ui.toast(mode === 'deck' ? 'On deck. Drag to look around, WASD to walk. V returns to overview.' : 'Raft overview. Drag to orbit, scroll to zoom.', 'info'); }
  }
  cycleSea() {
    const modes = Object.keys(SEA_STATES), index = modes.indexOf(this.state.settings.sea);
    this.state.settings.sea = modes[(index + 1) % modes.length]; this.save(false); this.ui.update();
  }
  startCourse() {
    if (this.paused || this.photo) return;
    if (this.course) { this.course = null; this.ui.toast('Course cancelled. The helm is yours.', 'info'); return; }
    const island = this.world.islands[0];
    if (Math.hypot(island.x - this.state.travel.x, island.z - this.state.travel.z) < island.radius * 1.15 + 6) { this.ui.toast('You’re already at Palmwood Cove. Try the first-person deck view [V].', 'info'); return; }
    this.ui.closePanel(); this.selectTool('paddle'); this.course = island;
    this.ui.toast('Setting course for Palmwood Cove. Move manually or press G to cancel.', 'info');
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight);
    this.viewRig.position.x = Math.min(.38, this.camera.aspect * .35);
  }
  setPaused(value) {
    this.paused = value; this.clearKeys(); this.audio.setPaused(value);
    if (value) { this.save(false); this.moving = false; }
  }
  photoMode(value) {
    this.photo = value; this.ui.closePanel(); this.setPaused(value); document.body.classList.toggle('photo-mode', value); $('exit-photo').hidden = !value;
    if (value) { this.targetRing.visible = false; $('world-label').hidden = true; }
  }
  async toggleSound() {
    this.state.settings.sound = !this.state.settings.sound;
    try { await this.audio.setEnabled(this.state.settings.sound); }
    catch { this.state.settings.sound = false; this.audio.enabled = false; this.ui.toast('Audio isn’t available in this browser.', 'info'); }
    this.save(false); this.ui.update();
  }
  toggleQuality() {
    this.state.settings.quality = this.state.settings.quality === 'high' ? 'low' : 'high';
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.state.settings.quality === 'high' ? 1.8 : 1)); this.save(false);
  }
  save(notify = true) {
    const success = saveGame(this.storage, this.state);
    if (notify) $('save-status').textContent = success ? 'All is well. Progress saved.' : 'Playing without a save · storage unavailable';
    return success;
  }
  restart() { this.state = newGame(); this.save(false); location.reload(); }
  async exportIsland() {
    return exportRaft(this.world.islands[0].model, { filename: 'palmwood-cove.glb', title: 'Palmwood Cove — tropical island and shelter' });
  }
  async exportModel() {
    // Build-placement helpers are UI, not part of the exported model.
    const parent = this.buildSpots?.parent;
    if (this.buildSpots) this.buildSpots.removeFromParent();
    try { return await exportRaft(this.raft); }
    finally { if (parent && this.buildSpots) parent.add(this.buildSpots); }
  }
}

try {
  window.DRIFT = new Drift();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !document.documentElement.dataset.standalone) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.info('Offline cache unavailable:', error.message));
  }
} catch (error) {
  console.error('Drift could not start:', error);
  $('loading').classList.add('loaded'); $('error-screen').hidden = false;
}
