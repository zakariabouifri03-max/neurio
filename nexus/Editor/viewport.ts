// ============================================================================
// NEXUS EDITOR — 3D Viewport
// Edit-mode scene graph (visual components only), orbit camera, gizmos,
// click selection, drag & drop instantiation, terrain sculpting tools,
// Play Mode integration with the GameRuntime.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { NexusRenderer } from '@engine/render/renderer';
import { RuntimeObject, RuntimeComponent } from '@engine/runtime/object';
import { ensureComponentsRegistered, GameRuntime } from '@engine/runtime/game';
import { AssetResolver } from '@engine/runtime/assetresolver';
import { getComponentDef } from '@engine/core/registry';
import { editorBus } from '@engine/core/events';
import { store } from './store';
import { findObject, cloneData, type GameObjectData } from '@engine/core/types';
import { removeGameObject } from '@engine/core/ops';
import { el } from './dom';

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type TerrainTool = 'none' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint0' | 'paint1' | 'paint2' | 'foliage';

export class Viewport {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  renderer: NexusRenderer;
  resolver: AssetResolver;
  controls: OrbitControls;
  gizmo: TransformControls;
  gizmoHelper: THREE.Object3D;
  editObjects = new Map<string, RuntimeObject>();
  editRoot = new THREE.Object3D();
  grid: THREE.GridHelper;
  selectionBox: THREE.Box3Helper | null = null;
  gizmoMode: GizmoMode = 'translate';
  snapEnabled = false;
  runtime: GameRuntime | null = null;
  terrainTool: TerrainTool = 'none';
  brushRadius = 8;
  brushStrength = 0.5;
  private raf = 0;
  private lastT = 0;
  private frameTimes: number[] = [];
  fps = 0;
  private raycaster = new THREE.Raycaster();
  private dragOver = false;
  statsOverlay: { fps: number; frameMs: number; drawCalls: number; objects: number; triangles: number; updateMs: number; physicsMs: number } = { fps: 0, frameMs: 0, drawCalls: 0, objects: 0, triangles: 0, updateMs: 0, physicsMs: 0 };
  onPlayToggle: ((playing: boolean) => void) | null = null;
  private terrainPreviewMesh: THREE.Mesh | null = null;
  hudHost: HTMLElement;

  constructor(host: HTMLElement) {
    ensureComponentsRegistered();
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.host.appendChild(this.canvas);
    this.hudHost = el('div', 'hud-layer');
    this.host.appendChild(this.hudHost);

    this.renderer = new NexusRenderer(this.canvas, 'high');
    this.resolver = new AssetResolver([], { baseUrl: '' });
    this.controls = new OrbitControls(this.renderer.camera, this.canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.grid = new THREE.GridHelper(400, 400, 0x2a3346, 0x1a212e);
    (this.grid.material as any).transparent = true;
    (this.grid.material as any).opacity = 0.55;
    this.renderer.scene.add(this.grid);
    this.renderer.scene.add(this.editRoot);

    this.gizmo = new TransformControls(this.renderer.camera, this.canvas);
    this.gizmo.setSize(0.85);
    this.gizmo.addEventListener('dragging-changed', (e: any) => {
      this.controls.enabled = !e.value;
      if (!e.value) this.commitGizmo();
    });
    this.gizmo.addEventListener('objectChange', () => this.gizmoLiveSync());
    this.gizmoHelper = (this.gizmo as any).getHelper ? (this.gizmo as any).getHelper() : (this.gizmo as unknown as THREE.Object3D);
    this.renderer.scene.add(this.gizmoHelper);

    this.bindEvents();
    this.loop();
    editorBus.on('sceneChanged', ({ structural }) => { if (structural) this.rebuildAll(); else this.refreshSelected(); });
    editorBus.on('sceneSwitched', () => this.rebuildAll());
    editorBus.on('objectsChanged', ({ ids }) => this.refreshObjects(ids));
    editorBus.on('selectionChanged', ({ ids }) => this.updateSelection(ids));
    editorBus.on('assetsChanged', () => this.rebuildResolver());
  }

  // ------------------------------- scene sync --------------------------------

  rebuildResolver() {
    if (!store.project) return;
    const assets = store.project.assets;
    // preserve caches across resolver swaps
    const old = this.resolver as any;
    this.resolver = new AssetResolver(assets, { baseUrl: '' });
    (this.resolver as any).modelCache = old.modelCache ?? new Map();
    (this.resolver as any).textureCache = old.textureCache ?? new Map();
    if (this.runtime) (this.runtime as any).resolver = this.resolver;
  }

  rebuildAll() {
    if (this.runtime) return; // playing — runtime owns the view
    // dispose old
    for (const go of this.editObjects.values()) {
      for (const cmp of go.components) (cmp as any).teardown?.();
    }
    this.editObjects.clear();
    this.editRoot.clear();
    const scene = store.scene;
    if (!scene) return;
    for (const data of scene.objects) this.buildEditObject(data);
    // re-parent holders
    for (const data of scene.objects) {
      if (data.parent) {
        const child = this.editObjects.get(data.id);
        const parent = this.editObjects.get(data.parent);
        if (child && parent) parent.holder.attach(child.holder);
      }
    }
    this.applyEnvironment();
    this.updateSelection(store.selection);
    this.rebuildResolver();
  }

  buildEditObject(data: GameObjectData): RuntimeObject {
    const go = new RuntimeObject(data, true);
    this.editObjects.set(data.id, go);
    this.editRoot.add(go.holder);
    for (const comp of data.components) {
      const def = getComponentDef(comp.type);
      if (def?.runtime?.visual) {
        const cls = def.runtime as any;
        const vc: RuntimeComponent = new cls(go, comp, null as any);
        go.attachComponent(vc);
        try { (vc as any).build(this.resolver); } catch (e: any) {
          store.log('error', `${data.name} (${comp.type}): ${e?.message ?? e}`);
        }
      }
    }
    return go;
  }

  applyEnvironment() {
    const env = store.scene?.environment;
    if (!env) return;
    this.renderer.setSky(env.skyTop, env.skyBottom);
    this.renderer.setAmbient(env.ambientColor, env.ambientIntensity);
    this.renderer.setSun(env.sunColor, env.sunIntensity, env.sunAngle, env.sunElevation, env.shadows);
    this.renderer.setFog(env.fogMode, env.fogColor, env.fogNear, env.fogFar, env.fogDensity);
  }

  refreshSelected() { this.refreshObjects(store.selection); }

  refreshObjects(ids: string[]) {
    if (this.runtime) return;
    const scene = store.scene;
    if (!scene) return;
    for (const id of ids) {
      const data = findObject(scene, id);
      const existing = this.editObjects.get(id);
      if (!data) {
        if (existing) { for (const c of existing.components) (c as any).teardown?.(); existing.holder.parent?.remove(existing.holder); this.editObjects.delete(id); }
        continue;
      }
      if (!existing) { this.buildEditObject(data); continue; }
      // rebuild the object's visuals
      for (const c of existing.components) (c as any).teardown?.();
      existing.components = [];
      existing.data = data;
      existing.applyTransform(data.transform);
      existing.holder.visible = data.active;
      for (const comp of data.components) {
        const def = getComponentDef(comp.type);
        if (def?.runtime?.visual) {
          const cls = def.runtime as any;
          const vc: RuntimeComponent = new cls(existing, comp, null as any);
          existing.attachComponent(vc);
          try { (vc as any).build(this.resolver); } catch { }
        }
      }
    }
  }

  // ------------------------------- selection ---------------------------------

  updateSelection(ids: string[]) {
    if (this.gizmo.object) this.gizmo.detach();
    this.selectionBox?.removeFromParent();
    this.selectionBox = null;
    const go = ids.length ? this.editObjects.get(ids[0]) : null;
    if (go && !this.runtime) {
      if (go.data.locked !== true) {
        this.gizmo.attach(go.holder);
        this.gizmo.setMode(this.gizmoMode);
      }
      const box = new THREE.Box3().setFromObject(go.holder);
      if (box.isEmpty() === false && isFinite(box.min.x)) {
        this.selectionBox = new THREE.Box3Helper(box, new THREE.Color(0x22d3ee));
        (this.selectionBox as any).material.transparent = true;
        (this.selectionBox as any).material.opacity = 0.7;
        this.renderer.scene.add(this.selectionBox);
      }
    }
  }

  setGizmoMode(mode: GizmoMode) {
    this.gizmoMode = mode;
    this.gizmo.setMode(mode);
  }

  private gizmoLiveSync() {
    const obj = this.gizmo.object;
    if (!obj) return;
    const go = this.editObjects.get(obj.userData.gameObjectId as string);
    if (go) go.syncToData();
    if (this.selectionBox) {
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) this.selectionBox.box.copy(box);
    }
  }

  private commitGizmo() {
    const obj = this.gizmo.object;
    if (!obj || !store.scene) return;
    const go = this.editObjects.get(obj.userData.gameObjectId as string);
    if (go) {
      go.syncToData();
      editorBus.emit('objectsChanged', { ids: [go.id] });
      store.markDirty();
    }
  }

  private bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !this.gizmo.dragging && !(this.gizmo as any).axis) {
        // click select (unless dragging gizmo)
        const start = { x: e.clientX, y: e.clientY, t: Date.now() };
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointerup', up);
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5 && Date.now() - start.t < 400) {
            this.handleClickSelect(ev);
          }
        };
        window.addEventListener('pointerup', up);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (this.terrainTool !== 'none' && !this.runtime) this.updateTerrainPreview(e);
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && this.terrainTool !== 'none' && !this.runtime) this.applyTerrainStroke(e, e.shiftKey ? 0.25 : 1);
    });
    window.addEventListener('keydown', (e) => {
      if (!store.project || this.runtime) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.code === 'KeyW') this.setGizmoMode('translate');
      if (e.code === 'KeyE') this.setGizmoMode('rotate');
      if (e.code === 'KeyR') this.setGizmoMode('scale');
      if (e.code === 'KeyF' && store.selection.length) this.focusSelection();
      if (e.code === 'Delete') this.deleteSelection();
      if (e.code === 'KeyQ' && e.ctrlKey) { /* reserved */ }
    });
    window.addEventListener('resize', () => this.renderer.resize());
    // drag & drop from asset browser
    this.host.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.host.classList.add('drag-over');
    });
    this.host.addEventListener('dragleave', () => this.host.classList.remove('drag-over'));
    this.host.addEventListener('drop', (e) => {
      e.preventDefault();
      this.host.classList.remove('drag-over');
      const json = e.dataTransfer?.getData('application/nexus-asset');
      if (!json) return;
      try {
        const asset = JSON.parse(json);
        const pos = this.screenToWorld(e.clientX, e.clientY);
        if (pos) editorBus.emit('notify', { kind: 'info', text: `Dropped ${asset.name}` });
        (window as any).__NEXUS_DROP__(asset, pos);
      } catch { }
    });
  }

  screenToWorld(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.renderer.camera);
    // raycast against edit objects + ground plane
    const targets: THREE.Object3D[] = [];
    this.editRoot.traverse(o => { if ((o as any).isMesh && !(o as any).userData?.__helper) targets.push(o); });
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length) return hits[0].point;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, pt) ? pt : null;
  }

  private handleClickSelect(e: MouseEvent) {
    if (this.runtime) return; // no selection changes while playing
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.renderer.camera);
    const targets: THREE.Object3D[] = [];
    this.editRoot.traverse(o => { if ((o as any).isMesh) targets.push(o); });
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !o.userData.gameObjectId) o = o.parent;
      if (o?.userData.gameObjectId) {
        const id = o.userData.gameObjectId as string;
        if (e.shiftKey) {
          const sel = new Set(store.selection);
          sel.has(id) ? sel.delete(id) : sel.add(id);
          store.select([...sel]);
        } else store.select([id]);
        return;
      }
    }
    store.select([]);
  }

  focusSelection() {
    const go = store.selection.length ? this.editObjects.get(store.selection[0]) : null;
    if (go) {
      const box = new THREE.Box3().setFromObject(go.holder);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 4;
      const dir = this.renderer.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(center);
      this.renderer.camera.position.copy(center.clone().add(dir.multiplyScalar(Math.max(4, size * 1.6))));
    }
  }

  deleteSelection() {
    const ids = [...store.selection];
    if (!ids.length || !store.scene || !store.project) return;
    store.pushUndo('Delete objects');
    for (const id of ids) {
      const go = findObject(store.scene, id);
      if (go?.locked) continue;
      removeGameObject(store.project, store.scene.id, id);
    }
    store.select([]);
    store.markDirty();
    editorBus.emit('sceneChanged', { sceneId: store.sceneId ?? '', structural: true });
  }

  // ------------------------------- terrain tools ------------------------------

  private terrainAt(pointer: { x: number; y: number }): { cmp: any; point: THREE.Vector3 } | null {
    for (const go of this.editObjects.values()) {
      const cmp = go.getComponent<any>('Terrain');
      if (cmp?.result) {
        const hit = this.raycastTerrain(pointer, cmp);
        if (hit) return { cmp, point: hit };
      }
    }
    return null;
  }

  private raycastTerrain(pointer: { x: number; y: number }, cmp: any): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((pointer.x - rect.left) / rect.width) * 2 - 1,
      -((pointer.y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.renderer.camera);
    const hits = this.raycaster.intersectObject(cmp.result.mesh, false);
    return hits.length ? hits[0].point : null;
  }

  private updateTerrainPreview(e: PointerEvent) {
    const t = this.terrainAt(e);
    if (!this.terrainPreviewMesh) {
      const geo = new THREE.RingGeometry(0.94, 1, 40);
      geo.rotateX(-Math.PI / 2);
      this.terrainPreviewMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false }));
      this.terrainPreviewMesh.renderOrder = 999;
      this.renderer.scene.add(this.terrainPreviewMesh);
    }
    if (t) {
      this.terrainPreviewMesh.visible = true;
      this.terrainPreviewMesh.position.copy(t.point).add(new THREE.Vector3(0, 0.06, 0));
      this.terrainPreviewMesh.scale.setScalar(this.brushRadius);
    } else this.terrainPreviewMesh.visible = false;
  }

  applyTerrainStroke(e: PointerEvent, strengthScale = 1) {
    const t = this.terrainAt(e);
    if (!t) return;
    const { cmp, point } = t;
    const local = t.point.clone().sub(cmp.gameObject.holder.position);
    const tool = this.terrainTool;
    if (tool.startsWith('paint')) {
      const layer = parseInt(tool.slice(5));
      t.cmp.stroke({ op: 'paint', worldX: local.x, worldZ: local.z, radius: this.brushRadius, strength: this.brushStrength * strengthScale, paintLayer: layer });
    } else if (tool !== 'none') {
      t.cmp.stroke({ op: tool as any, worldX: local.x, worldZ: local.z, radius: this.brushRadius, strength: this.brushStrength * strengthScale });
    }
    store.markDirty();
  }

  hideTerrainTools() {
    this.terrainPreviewMesh && (this.terrainPreviewMesh.visible = false);
  }

  // ------------------------------- play mode ----------------------------------

  async enterPlayMode(sceneId?: string) {
    if (!store.project || this.runtime) return;
    const project = cloneData(store.project);
    // play a specific scene if requested (else entry scene)
    if (sceneId) project.settings.entrySceneId = sceneId;
    this.editRoot.visible = false;
    this.grid.visible = false;
    this.gizmo.detach();
    this.gizmoHelper.visible = false;
    this.hideTerrainTools();
    this.controls.enabled = false;
    store.clearProblems();
    this.runtime = new GameRuntime({
      project, resolver: this.resolver, renderer: this.renderer, canvas: this.canvas,
      hudHost: this.hudHost,
      onLog: (level, msg) => store.log(level, msg),
      onProblem: (p) => store.addProblem({ file: p.scriptName ?? 'Script', line: p.line, message: p.message, severity: p.severity, scriptId: p.scriptId, scriptName: p.scriptName }),
      savePrefix: `editor:${project.id}`,
    });
    this.runtime.instantiateScene();
    this.runtime.start();
    store.playing = true;
    store.paused = false;
    editorBus.emit('playModeChanged', { playing: true, paused: false });
    this.onPlayToggle?.(true);
    store.log('info', `▶ PLAY — "${store.scene?.name ?? 'Scene'}" (runtime objects: ${this.runtime.objects.size})`);
  }

  pausePlayMode() {
    if (!this.runtime) return;
    this.runtime.setPaused(!this.runtime.paused);
    store.paused = this.runtime.paused;
    editorBus.emit('playModeChanged', { playing: true, paused: store.paused });
  }

  stopPlayMode() {
    if (!this.runtime) return;
    this.runtime.dispose();
    this.runtime = null;
    this.hudHost.innerHTML = '';
    this.editRoot.visible = true;
    this.grid.visible = true;
    this.gizmoHelper.visible = true;
    this.controls.enabled = true;
    this.applyEnvironment();
    this.updateSelection(store.selection);
    store.playing = false;
    store.paused = false;
    editorBus.emit('playModeChanged', { playing: false, paused: false });
    this.onPlayToggle?.(false);
    store.log('info', '■ STOP — editor state restored.');
  }

  // ---------------------------------- loop -----------------------------------

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const t = performance.now();
    if (!this.lastT) this.lastT = t;
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = avg > 0 ? 1 / avg : 0;

    if (this.runtime) {
      // runtime steps itself via its internal loop? No — editor drives it here.
      if (!this.runtime.paused) this.runtime.step(dt);
      this.runtime.resize(this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
      this.renderer.render(this.runtime.camera.three ?? this.renderer.camera);
    } else {
      this.controls.update();
      this.renderer.resize();
      this.renderer.render();
    }

    const s = this.renderer.stats;
    this.statsOverlay = {
      fps: Math.round(this.fps),
      frameMs: +(dt * 1000).toFixed(1),
      drawCalls: s.drawCalls,
      objects: this.runtime ? this.runtime.objects.size : this.editObjects.size,
      triangles: s.triangles,
      updateMs: +(this.runtime?.profile.updateMs ?? 0).toFixed(2),
      physicsMs: +(this.runtime?.profile.physicsMs ?? 0).toFixed(2),
    };
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.runtime?.dispose();
    this.renderer.dispose();
    this.controls.dispose();
  }
}
