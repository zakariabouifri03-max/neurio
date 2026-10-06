// ============================================================================
// NEXUS ENGINE — GameRuntime
// Orchestrates a live game simulation from ProjectData:
//   • instantiates RuntimeObjects from scene data
//   • creates physics bodies (colliders + rigidbodies)
//   • compiles & runs user scripts and visual-script graphs
//   • drives controllers, NPCs, gameplay systems, HUD, day/night, audio
//   • supports play / pause / stop / restart + an automated playtest harness
// Used by the editor (Play Mode) and by the standalone exported game.
// ============================================================================
import * as THREE from 'three';
import type { ProjectData, SceneData, GameObjectData, Vec3 } from '../core/types';
import { cloneData, findObject, worldTransform as worldTransformOf } from '../core/types';
import { getComponentDef } from '../core/registry';
import { RuntimeObject, RuntimeComponent, instantiateComponent } from './object';
import { AssetResolver } from './assetresolver';
import { PhysicsWorld } from '../physics/physics';
import { InputSystem } from './input';
import { AudioSystem } from '../audio/audio';
import { HudSystem } from '../ui/hud';
import { Emitter } from '../core/events';
import { VsGraphRuntime } from '../visualscript/interpreter';
import { compileScript, createNexusApi, type ScriptProblem } from '../scripting/runtime';

// register all built-in components (idempotent)
import { registerVisualComponents } from '../gameplay/visuals';
import { registerControllerComponents } from '../gameplay/controllers';
import { registerNpcComponents } from '../gameplay/npc';
import { registerGameplayComponents } from '../gameplay/gameplay';
import { registerAnimator } from '../animation/animator';

let registered = false;
export function ensureComponentsRegistered() {
  if (registered) return;
  registered = true;
  registerVisualComponents();
  registerControllerComponents();
  registerNpcComponents();
  registerGameplayComponents();
  registerAnimator();
}

export interface RuntimeOptions {
  project: ProjectData;
  sceneId?: string;
  resolver: AssetResolver;
  renderer?: any;            // NexusRenderer — needed only when rendering
  canvas?: HTMLCanvasElement;
  hudHost?: HTMLElement | null;
  input?: InputSystem | null;
  audio?: AudioSystem | null;
  headless?: boolean;        // test mode: no input/audio/ui
  embedded?: any;            // embedded asset payloads (standalone)
  onLog?: (level: 'info' | 'warning' | 'error', msg: string, source?: string) => void;
  onProblem?: (p: ScriptProblem) => void;
  savePrefix?: string;
  mode?: 'play' | 'standalone';
}

export class GameRuntime {
  project: ProjectData;
  scene: SceneData;
  resolver: AssetResolver;
  renderer: any;
  physics = new PhysicsWorld();
  events = new Emitter();
  input: InputSystem | null;
  audio: AudioSystem | null;
  hud: HudSystem | null = null;
  objects = new Map<string, RuntimeObject>();
  player: RuntimeObject | null = null;
  playerController: any = null;
  dayNight: any = null;
  saveSystem: any = null;
  stats: any = { kills: 0, enemiesTotal: 0, itemsCollected: {} };
  variables: Record<string, any> = {};
  recipes: any[] = [];
  time = { now: 0, deltaTime: 0, frame: 0, timeScale: 1 };
  camera: { three: THREE.PerspectiveCamera | null } = { three: null };
  isPlaying = true;
  paused = false;
  interactCandidate: any = null;
  savePrefix = 'nexus';
  mode: 'play' | 'standalone';
  problems: ScriptProblem[] = [];
  onLog?: (level: 'info' | 'warning' | 'error', msg: string, source?: string) => void;
  onProblem?: (p: ScriptProblem) => void;
  private sceneRoot = new THREE.Object3D();
  private physicsBodies = new Map<string, any>(); // objectId → {body, dynamic}
  private visualGraphs: { go: RuntimeObject; graph: VsGraphRuntime }[] = [];
  private scriptInstances: { go: RuntimeObject; cmp: RuntimeComponent }[] = [];
  private accumulator = 0;
  private rafHandle: number | null = null;
  private lastTime = 0;
  private started = false;
  private disposed = false;
  private rendererApi: any;
  blackboard: any = { player: {}, inventory: {}, game: {}, crafting: {} };
  /** frame profiling (ms) */
  profile = { updateMs: 0, physicsMs: 0, renderMs: 0 };

  constructor(opts: RuntimeOptions) {
    ensureComponentsRegistered();
    this.project = opts.project;
    this.scene = this.project.scenes.find(s => s.id === (opts.sceneId ?? this.project.settings.entrySceneId)) ?? this.project.scenes[0];
    this.resolver = opts.resolver;
    this.renderer = opts.renderer ?? null;
    this.input = opts.headless ? null : (opts.input ?? (typeof window !== 'undefined' ? new InputSystem() : null));
    this.audio = opts.headless ? null : (opts.audio ?? (typeof window !== 'undefined' ? new AudioSystem() : null));
    this.onLog = opts.onLog;
    this.onProblem = opts.onProblem;
    this.savePrefix = opts.savePrefix ?? 'nexus';
    this.mode = opts.mode ?? 'play';
    this.variables = cloneData(this.project.variables ?? {});
    this.recipes = this.project.recipes ?? [];
    if (this.audio) {
      this.audio.setVolumes(this.project.settings.masterVolume, this.project.settings.musicVolume, this.project.settings.sfxVolume);
      this.audio.setLoader(async (id: string) => await this.resolver.loadArrayBuffer(id));
    }

    if (this.renderer) {
      this.renderer.scene.add(this.sceneRoot);
      this.rendererApi = {
        setSky: (a: string, b: string) => this.renderer.setSky(a, b),
        setAmbient: (a: string, b: number) => this.renderer.setAmbient(a, b),
        setSun: (a: string, b: number, c: number, d: number, e: boolean) => this.renderer.setSun(a, b, c, d, e),
        setSunFromDirection: (dir: any) => this.renderer.setSunFromDirection(dir),
        setNightFactor: () => { },
      };
      this.camera.three = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2000);
      this.renderer.scene.add(this.camera.three);
      if (this.renderer.preset) this.camera.three.fov = 62;
    }

    if (opts.hudHost) {
      this.hud = new HudSystem(opts.hudHost, this.api());
      this.hud.registerDocuments(this.project.uiDocuments ?? []);
    }
    (this as any).ui = {
      show: (n: string) => this.hud?.show(n),
      hide: (n: string) => this.hud?.hide(n),
      toggle: (n: string) => this.hud?.toggle(n),
      setPaused: (p: boolean) => this.setPaused(p),
      showMessage: (t: string, s?: number) => this.hud?.showMessage(t, s),
      setText: (a: string, b: string) => this.hud?.setText(a, b),
      setFill: (a: string, b: number) => this.hud?.setFill(a, b),
    };
    (this as any).hasMenuOpen = () => this.hud?.hasMenuOpen ?? false;
  }

  // ------------------------------ Engine API --------------------------------

  api(): EngineApi {
    return {
      time: this.time,
      isPlaying: true,
      find: (name: string) => this.find(name),
      findAll: (name: string) => this.findAll(name),
      findByTag: (tag: string) => this.findByTag(tag),
      getGameObject: (id: string) => this.objects.get(id) ?? null,
      spawn: (prefabId: string, pos?: Vec3, rot?: Vec3) => this.spawn(prefabId, pos, rot),
      destroyObject: (id: string) => this.destroyObject(id),
      events: this.events,
      physics: this.physics,
      input: this.input ?? fakeInput(),
      audio: this.audio,
      ui: (this as any).ui,
      camera: this.camera,
      resolver: this.resolver,
      rendererApi: this.rendererApi,
      dayNight: null,
      player: null,
      playerController: null,
      stats: this.stats,
      recipes: this.recipes,
      variables: this.variables,
      savePrefix: this.savePrefix,
      interactCandidate: null,
      setPlayer: (go: any, ctrl: any) => this.setPlayer(go, ctrl),
      log: (m: string) => this.log('info', m),
      warn: (m: string) => this.log('warning', m),
      error: (m: string, s?: string) => this.log('error', m, s),
      save: (k: string, v: any) => this.save(k, v),
      load: (k: string) => this.load(k),
      saveSystem: null,
    };
  }

  private engineApi: EngineApi | null = null;
  get apiRef(): EngineApi {
    if (!this.engineApi) this.engineApi = this.api();
    // refresh mutable refs
    (this.engineApi as any).dayNight = this.dayNight;
    (this.engineApi as any).player = this.player;
    (this.engineApi as any).playerController = this.playerController;
    (this.engineApi as any).stats = this.stats;
    (this.engineApi as any).saveSystem = this.saveSystem;
    (this.engineApi as any).interactCandidate = this.interactCandidate;
    (this.engineApi as any).recipes = this.recipes;
    return this.engineApi;
  }

  setPlayer(go: RuntimeObject, ctrl: any) {
    if (this.player && this.player !== go) {
      // multiple controllers — first one wins, warn
      this.log('warning', `Multiple player controllers found ("${this.player.name}", "${go.name}") — using the first.`);
      return;
    }
    this.player = go;
    this.playerController = ctrl;
    this.events.emit('playerSpawned', { object: go.id });
  }

  // ---------------------------- instantiation -------------------------------

  /** Build every object from scene data. Call once. */
  instantiateScene() {
    for (const data of this.scene.objects) {
      if (data.parent === null) this.instantiateObject(data);
    }
    // hierarchy
    for (const data of this.scene.objects) {
      if (data.parent !== null) {
        const child = this.objects.get(data.id);
        const parent = this.objects.get(data.parent);
        if (child && parent) parent.holder.attach(child.holder);
      }
    }
  }

  instantiateObject(data: GameObjectData, atPosition?: Vec3): RuntimeObject {
    const go = new RuntimeObject(data, false);
    go.engine = this.apiRef;
    this.objects.set(data.id, go);
    this.sceneRoot.add(go.holder);
    if (atPosition) go.setPosition(atPosition.x, atPosition.y, atPosition.z);

    // visual components (build immediately)
    for (const comp of data.components) {
      const def = getComponentDef(comp.type);
      if (def?.runtime?.prototype instanceof RuntimeComponent && def.runtime.visual) {
        const vc = new def.runtime(go, comp, this.apiRef);
        go.attachComponent(vc);
        try { (vc as any).build(this.resolver); } catch (e: any) { this.log('error', `${data.name} (${comp.type}): ${e?.message ?? e}`); }
      }
    }

    // physics body (world transform so children of hierarchies land correctly)
    const collider = data.components.find(c => c.type === 'Collider');
    if (collider) {
      const rigid = data.components.find(c => c.type === 'RigidBody') ?? null;
      const wt = worldTransformOf(this.scene, data.id);
      const body = this.physics.makeBody({
        objectId: data.id, collider, rigid,
        position: atPosition ?? wt.position,
        quaternion: eulerToQuaternion(wt.rotation),
      });
      this.physics.addBody(body, data.id);
      this.physicsBodies.set(data.id, { body, dynamic: !!rigid && !rigid.kinematic, kinematic: !!rigid?.kinematic });
    }

    // behaviour components (runtime classes, non-visual)
    for (const comp of data.components) {
      const def = getComponentDef(comp.type);
      if (!def?.runtime) continue;
      if (def.runtime.visual) continue;
      if (comp.type === 'Script') { this.attachScript(go, comp); continue; }
      if (comp.type === 'VisualScript') { this.attachVisualScript(go, comp); continue; }
      const instance = instantiateComponent(go, comp, this.apiRef);
      if (instance) go.attachComponent(instance);
    }
    return go;
  }

  private attachScript(go: RuntimeObject, comp: any) {
    const script = this.project.scripts?.[comp.script];
    if (!script) {
      this.log('warning', `${go.name}: script asset missing ("${comp.script}")`);
      return;
    }
    const onError = (p: ScriptProblem) => this.reportProblem(p);
    const api = createNexusApi(this.apiRef, go, onError);
    (api as any).THREE = THREE;
    const compiled = compileScript(script.id, script.name, script.source, () => api);
    if (compiled.problem) { this.reportProblem(compiled.problem); return; }
    try {
      const instance = new compiled.cls(go, comp, this.apiRef);
      instance.props = comp;
      if (comp.props) for (const [k, v] of Object.entries(comp.props)) instance[k] = v;
      go.attachComponent(instance);
      this.scriptInstances.push({ go, cmp: instance });
    } catch (e: any) {
      this.reportProblem({ scriptId: script.id, scriptName: script.name, line: 1, message: `Failed to instantiate: ${e?.message ?? e}`, severity: 'error' });
    }
  }

  private attachVisualScript(go: RuntimeObject, comp: any) {
    const graph = comp.graph && typeof comp.graph === 'object' ? comp.graph
      : this.project.assets.find(a => a.id === comp.graph)?.data;
    if (!graph) return;
    const runtime = new VsGraphRuntime(graph, { engine: this.apiRef, gameObject: go, self: comp });
    this.visualGraphs.push({ go, graph: runtime });
  }

  // ------------------------------ lifecycle ---------------------------------

  start() {
    if (this.started) return;
    this.started = true;
    this.physics.onContact = (a, b, started) => this.handleContact(a, b, started);
    this.hud?.buildAll();
    // onStart for every object's components
    for (const go of this.objects.values()) {
      for (const cmp of go.components) {
        try { cmp.onStart(); } catch (e: any) { this.reportRuntimeError(cmp, e); }
      }
    }
    for (const { graph } of this.visualGraphs) graph.start();
    this.wireGlobalEvents();
    this.events.emit('runtimeStarted', { scene: this.scene.name });
    if (this.mode === 'standalone') this.runLoop();
  }

  private wireGlobalEvents() {
    const bus = this.events;
    bus.on('died', (d: any) => {
      if (this.player && d?.object === this.player.id) {
        for (const { graph } of this.visualGraphs) graph.fireEvent('OnPlayerDied', d);
      }
    });
    bus.on('pickup', (d: any) => { for (const { graph } of this.visualGraphs) graph.fireEvent('OnPickup', d); });
    bus.on('night', () => { for (const { graph } of this.visualGraphs) graph.fireEvent('OnNight', {}); });
    bus.on('day', () => { for (const { graph } of this.visualGraphs) graph.fireEvent('OnDay', {}); });
    bus.on('triggerEnter', (d: any) => {
      if (!this.player || d.object !== this.player.id) return;
      for (const { graph } of this.visualGraphs) {
        graph.fireEvent('OnPlayerEnterTrigger', d, (n: any) => {
          const name = String(n.params?.triggerName ?? '').toLowerCase();
          return !name || String(d.name ?? '').toLowerCase().includes(name);
        });
      }
    });
    bus.on('interacted', (d: any) => {
      for (const { go, graph } of this.visualGraphs) if (go.id === d.object) graph.fireEvent('OnInteract', d);
    });
  }

  private handleContact(aId: string, bId: string, started: boolean) {
    const a = this.objects.get(aId), b = this.objects.get(bId);
    if (!a || !b) return;
    const aTrig = a.getComponentData('Collider')?.isTrigger;
    const bTrig = b.getComponentData('Collider')?.isTrigger;
    if (started) {
      for (const cmp of a.components) { try { aTrig || bTrig ? cmp.onTriggerEnter(b) : cmp.onCollisionEnter(b); } catch (e) { this.reportRuntimeError(cmp, e); } }
      for (const cmp of b.components) { try { aTrig || bTrig ? cmp.onTriggerEnter(a) : cmp.onCollisionEnter(a); } catch (e) { this.reportRuntimeError(cmp, e); } }
    } else {
      for (const cmp of a.components) { try { cmp.onTriggerExit(b); } catch { } }
      for (const cmp of b.components) { try { cmp.onTriggerExit(a); } catch { } }
    }
  }

  private reportRuntimeError(cmp: RuntimeComponent, e: any) {
    const msg = `${cmp.gameObject.name} → ${cmp.data.type}: ${e?.message ?? e}`;
    this.log('error', msg);
    if (cmp.data.type === 'Script' && (cmp as any).data?.script) {
      const script = this.project.scripts?.[(cmp as any).data.script];
      if (script) {
        const m = (e?.stack ?? '').match(/(?:<anonymous>|NEXUS_SCRIPT):(\d+):(\d+)/);
        this.reportProblem({ scriptId: script.id, scriptName: script.name, line: m ? Math.max(1, +m[1] - 3) : 1, message: e?.message ?? String(e), severity: 'error', stack: e?.stack });
      }
    }
  }

  reportProblem(p: ScriptProblem) {
    this.problems.push(p);
    this.onProblem?.(p);
    this.log('error', `${p.scriptName} (line ${p.line}): ${p.message}`, p.scriptName);
  }

  log(level: 'info' | 'warning' | 'error', msg: string, source?: string) {
    this.onLog?.(level, msg, source);
  }

  // --------------------------------- loop -----------------------------------

  setPaused(p: boolean) {
    this.paused = p;
    this.events.emit('pausedChanged', { paused: p });
  }

  private runLoop() {
    const tick = (t: number) => {
      if (this.disposed) return;
      this.rafHandle = requestAnimationFrame(tick);
      if (!this.lastTime) this.lastTime = t;
      const dt = Math.min(0.1, (t - this.lastTime) / 1000);
      this.lastTime = t;
      if (!this.paused) this.step(dt);
      if (this.renderer) this.render();
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  /** One simulation step (called by the editor's RAF loop or the internal loop). */
  step(dt: number) {
    const t0 = performance.now();
    this.time.deltaTime = dt * this.time.timeScale;
    this.time.now += this.time.deltaTime;
    this.time.frame++;
    this.interactCandidate = null;

    // updates
    for (const go of this.objects.values()) {
      if (!go.active) continue;
      for (const cmp of go.components) {
        if (cmp.enabled === false) continue;
        try { cmp.onUpdate(this.time.deltaTime); } catch (e) { this.reportRuntimeError(cmp, e); }
      }
    }
    const t1 = performance.now();
    this.profile.updateMs = this.profile.updateMs * 0.9 + (t1 - t0) * 0.1;

    // fixed-step physics
    this.accumulator += this.time.deltaTime;
    let steps = 0;
    while (this.accumulator >= 1 / 60 && steps < 5) {
      const p0 = performance.now();
      this.physics.step(1 / 60);
      this.physicsFixedUpdate(1 / 60);
      this.accumulator -= 1 / 60;
      steps++;
      this.profile.physicsMs = this.profile.physicsMs * 0.9 + (performance.now() - p0) * 0.1;
    }
    this.syncDynamicBodies();

    // visual scripts
    for (const { graph } of this.visualGraphs) graph.update(this.time.deltaTime);

    // interact key
    if (this.input) {
      if (this.input.interactPressed && this.interactCandidate && this.player) {
        this.interactCandidate.cmp.interact(this.player);
      }
      // OnKeyDown visual nodes
      for (const { graph } of this.visualGraphs) {
        graph.graph.nodes?.forEach?.((n: any) => {
          if (n.type === 'OnKeyDown' && n.params?.key && this.input!.wasPressed(n.params.key)) {
            graph.fireEventNode(n);
          }
        });
      }
      this.input.endFrame();
    }

    this.updateBlackboard();
    this.hud?.updateBindings(this.blackboard);

    // sun shadow focus follows player/camera
    if (this.renderer?.focusSunShadows) {
      const p = this.player?.worldPosition() ?? (this.camera.three?.position ?? { x: 0, y: 0, z: 0 });
      if (!this.dayNight) this.renderer.focusSunShadows(p);
    }
  }

  render() {
    if (!this.renderer) return;
    const t0 = performance.now();
    const cam = this.camera.three ?? this.renderer.camera;
    if (cam) this.renderer.render(cam);
    this.profile.renderMs = this.profile.renderMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private physicsFixedUpdate(dt: number) {
    for (const go of this.objects.values()) {
      if (!go.active) continue;
      for (const cmp of go.components) {
        if (cmp.enabled === false) continue;
        try { cmp.onFixedUpdate(dt); } catch (e) { this.reportRuntimeError(cmp, e); }
      }
    }
  }

  private syncDynamicBodies() {
    for (const [id, rec] of this.physicsBodies) {
      const go = this.objects.get(id);
      if (!go) continue;
      const collider = go.getComponentData('Collider');
      if (!collider?.isTrigger && rec.dynamic !== false && rec.kinematic !== true) {
        const body = rec.body;
        go.holder.position.set(body.position.x, body.position.y, body.position.z);
        if (!body.fixedRotation) go.holder.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
    }
  }

  private updateBlackboard() {
    const bb = this.blackboard;
    if (this.player) {
      const health = this.player.getComponent<any>('Health');
      bb.player.health = Math.round(health?.health ?? 100);
      bb.player.maxHealth = health?.data?.maxHealth ?? 100;
      const ctrl = this.playerController;
      bb.player.stamina = ctrl ? Math.round(ctrl.stamina ?? 100) : 100;
      bb.player.maxStamina = ctrl?.maxStamina ?? 100;
    }
    const inv = this.player?.getComponent<any>('Inventory');
    bb.inventory.text = inv ? Object.entries(inv.items).map(([k, v]) => `${k} × ${v}`).join('\n') : '';
    if (this.hud) {
      const invDoc = this.project.uiDocuments.find(d => d.name === 'Crafting');
      if (invDoc) {
        bb.crafting.text = this.recipes.map(r => {
          const have = Object.entries(r.inputs ?? {}).map(([item, amt]: any) => `${item} ${inv?.count(item) ?? 0}/${amt}`).join(', ');
          return `${r.name}  [${have}]  →  ${r.output} ×${r.outputAmount ?? 1}`;
        }).join('\n');
        bb.crafting.hint = 'Press the interact key near a crafting table to craft.';
      }
    }
    const dn = this.dayNight;
    if (dn) {
      const h = Math.floor(dn.timeOfDay), m = Math.floor((dn.timeOfDay % 1) * 60);
      bb.game.clock = `Day ${dn.dayCount}  ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${dn.isNight ? '  🌙' : '  ☀'}`;
    }
    bb.game.interactPrompt = this.interactCandidate ? `[E] ${this.interactCandidate.cmp.data.prompt ?? 'Interact'}` : '';
    bb.game.kills = this.stats.kills;
  }

  // -------------------------------- helpers ---------------------------------

  find(name: string): RuntimeObject | null {
    return [...this.objects.values()].find(o => o.name === name && !o.destroyed) ?? null;
  }
  findAll(name: string): RuntimeObject[] { return [...this.objects.values()].filter(o => o.name === name); }
  findByTag(tag: string): RuntimeObject[] { return [...this.objects.values()].filter(o => o.hasTag(tag) && !o.destroyed); }
  getGameObject(id: string): RuntimeObject | null { return this.objects.get(id) ?? null; }

  spawn(prefabAssetId: string, pos?: Vec3, rot?: Vec3): RuntimeObject | null {
    const asset = this.resolver.getAsset(prefabAssetId);
    if (!asset || asset.type !== 'prefab') { this.log('warning', `Spawn failed: prefab "${prefabAssetId}" not found.`); return null; }
    const tree: GameObjectData[] = cloneData(asset.data ?? []);
    if (!tree.length) return null;
    // remap ids & parents, preserving order (root first)
    const idMap = new Map<string, string>();
    const rootOldId = tree[0].id;
    for (const d of tree) idMap.set(d.id, 'o_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4));
    const remapped = tree.map(d => ({ ...d, id: idMap.get(d.id)!, parent: d.parent ? (idMap.get(d.parent) ?? null) : null, components: cloneData(d.components) }));
    const root = remapped[0];
    root.active = true;
    let result: RuntimeObject | null = null;
    for (const d of remapped) {
      if (d.id !== root.id) this.scene.objects.push(d);
      const go = this.instantiateObject(d, d.id === root.id ? (pos ?? d.transform.position) : undefined);
      if (rot && d.id === root.id) go.setRotation(rot.x, rot.y, rot.z);
      if (d.id === root.id) result = go;
      else {
        // keep spawned children parented to spawned root holder
        const parentGo = this.objects.get(idMap.get(d.parent ?? rootOldId)!);
        parentGo?.holder.add(go.holder);
      }
    }
    for (const d of remapped) {
      if (d.id === root.id) continue;
      const go = this.objects.get(d.id);
      go?.components.forEach(c => { try { c.onStart(); } catch (e) { this.reportRuntimeError(c, e); } });
    }
    this.events.emit('objectSpawned', { object: result?.id });
    return result;
  }

  destroyObject(id: string) {
    const go = this.objects.get(id);
    if (!go || go.destroyed) return;
    go.destroyed = true;
    // destroy children first
    for (const other of [...this.objects.values()]) {
      if (other.data.parent === id) this.destroyObject(other.id);
    }
    for (const cmp of go.components) { try { cmp.onDestroy(); } catch { } }
    go.holder.parent?.remove(go.holder);
    this.physics.removeBody(id);
    this.physicsBodies.delete(id);
    this.objects.delete(id);
    this.events.emit('objectDestroyed', { object: id });
    // spawners release tracking
    for (const o of this.objects.values()) {
      const spawner = o.getComponent<any>('Spawner');
      spawner?.onGameObjectDestroyed?.(id);
    }
  }

  save(key: string, value: any) {
    try { localStorage.setItem(`${this.savePrefix}:${key}`, JSON.stringify(value)); } catch { }
  }
  load(key: string): any {
    try { const raw = localStorage.getItem(`${this.savePrefix}:${key}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  resize(aspect: number) {
    if (this.camera.three) { this.camera.three.aspect = aspect; this.camera.three.updateProjectionMatrix(); }
  }

  dispose() {
    this.disposed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    for (const go of this.objects.values()) for (const cmp of go.components) { try { cmp.onDestroy(); } catch { } }
    for (const { graph } of this.visualGraphs) graph.stop();
    this.physics.clear();
    this.hud?.dispose();
    this.events.clear();
    this.renderer?.scene?.remove(this.sceneRoot);
    this.renderer?.scene?.remove(this.camera.three as any);
    this.objects.clear();
  }

  // ---------------------------- playtest harness ----------------------------

  /**
   * Automated playtest: runs the simulation for N seconds with scripted input,
   * collecting errors and running assertions. Returns a report.
   */
  async runPlaytest(opts: {
    seconds?: number;
    inputScript?: (t: number, input: FakeInput) => void;
    assertions?: Array<{ name: string; check: (engine: EngineApi, runtime: GameRuntime) => boolean }>;
    stepMs?: number;
  } = {}): Promise<PlaytestReport> {
    const seconds = opts.seconds ?? 4;
    const stepMs = opts.stepMs ?? 16;
    const fake = new FakeInput();
    const savedInput = this.input;
    (this as any).input = fake;
    (this.apiRef as any).input = fake;
    const errors: string[] = [];
    const logHook = (level: string, msg: string) => { if (level === 'error') errors.push(msg); };
    this.onLog = (l, m) => { logHook(l, m); };
    this.start();
    const steps = Math.ceil((seconds * 1000) / stepMs);
    for (let i = 0; i < steps; i++) {
      const t = (i * stepMs) / 1000;
      fake.frame(t, () => opts.inputScript?.(t, fake));
      this.step(stepMs / 1000);
      await new Promise(r => setTimeout(r, 0));
    }
    const failures: string[] = [];
    for (const a of opts.assertions ?? []) {
      try { if (!a.check(this.apiRef, this)) failures.push(a.name); } catch (e) { failures.push(`${a.name} (threw: ${e})`); }
    }
    this.onLog = undefined;
    (this as any).input = savedInput;
    (this.apiRef as any).input = savedInput;
    return {
      passed: errors.length === 0 && failures.length === 0,
      errors, failures,
      framesSimulated: steps,
      stats: { ...this.stats, playerPosition: this.player ? { ...this.player.position } : null },
    };
  }
}

export interface PlaytestReport {
  passed: boolean;
  errors: string[];
  failures: string[];
  framesSimulated: number;
  stats: any;
}

export interface EngineApi {
  time: any; isPlaying: boolean; saveSystem: any;
  find(name: string): any; findAll(name: string): any[]; findByTag(tag: string): any[];
  getGameObject(id: string): any;
  spawn(prefabId: string, pos?: Vec3, rot?: Vec3): any;
  destroyObject(id: string): void;
  events: any; physics: any; input: any; audio: any; ui: any; camera: any;
  resolver: any; rendererApi: any;
  dayNight: any; player: any; playerController: any; stats: any; recipes: any[];
  variables: Record<string, any>; savePrefix: string; interactCandidate: any;
  setPlayer(go: any, ctrl: any): void;
  log(m: string): void; warn(m: string): void; error(m: string, s?: string): void;
  save(k: string, v: any): void; load(k: string): any;
}

/** Scriptable input for automated playtests. */
export class FakeInput {
  down = new Set<string>();
  pressed = new Set<string>();
  mouse = { dx: 0, dy: 0, x: 0, y: 0, buttons: 0, wheel: 0, locked: true };
  private hooks: Array<() => void> = [];
  frame(t: number, hook?: () => void) {
    this.hooks.forEach(h => h());
    hook?.();
  }
  onFrame(h: () => void) { this.hooks.push(h); }
  isKeyDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }
  wasReleased(code: string) { return false; }
  wasClicked() { return false; }
  consumeClick() { return false; }
  requestInteract() { }
  consumeInteract() { return false; }
  get moveVector() {
    let x = 0, z = 0;
    if (this.isKeyDown('KeyW')) z -= 1;
    if (this.isKeyDown('KeyS')) z += 1;
    if (this.isKeyDown('KeyA')) x -= 1;
    if (this.isKeyDown('KeyD')) x += 1;
    return { x, z };
  }
  get sprintDown() { return this.isKeyDown('ShiftLeft'); }
  get crouchDown() { return this.isKeyDown('ControlLeft'); }
  get jumpPressed() { return this.wasPressed('Space'); }
  get interactPressed() { return this.wasPressed('KeyE'); }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; }
  dispose() { }
}

function fakeInput() { return new FakeInput(); }

/** Euler (degrees) → quaternion (x,y,z,w). */
function eulerToQuaternion(e: { x: number; y: number; z: number }) {
  const d = Math.PI / 180;
  const rx = e.x * d / 2, ry = e.y * d / 2, rz = e.z * d / 2;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // XYZ order (three.js default)
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}
