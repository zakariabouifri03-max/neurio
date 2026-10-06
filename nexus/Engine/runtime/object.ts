// ============================================================================
// NEXUS ENGINE — Runtime objects & component base class
// A RuntimeObject wraps serializable GameObjectData + a THREE.Object3D holder
// + live component instances. The editor uses the same system in edit mode
// (behaviours disabled); Play Mode instantiates from cloned data.
// ============================================================================
import * as THREE from 'three';
import type { ComponentData, GameObjectData, Vec3 } from '../core/types';
import { getComponentDef } from '../core/registry';

export interface EngineLike {
  time: { now: number; deltaTime: number; frame: number; timeScale: number };
  log(msg: string): void; warn(msg: string): void; error(msg: string, source?: string): void;
  find(name: string): RuntimeObject | null;
  findAll(name: string): RuntimeObject[];
  findByTag(tag: string): RuntimeObject[];
  spawn(prefabAssetId: string, position?: Vec3, rotation?: Vec3): RuntimeObject | null;
  destroyObject(id: string): void;
  events: { on(evt: string, fn: (d?: any) => void): () => void; emit(evt: string, data?: any): void };
  physics: any;
  input: any;
  audio: any;
  ui: any;
  camera: any;
  getGameObject(id: string): RuntimeObject | null;
  readonly isPlaying: boolean;
  save(key: string, data: any): void;
  load(key: string): any;
  variables: Record<string, any>;
}

export class RuntimeComponent {
  data: ComponentData;
  gameObject: RuntimeObject;
  engine: EngineLike;
  /** name of the class — set by subclass */
  started = false;
  destroyed = false;

  constructor(gameObject: RuntimeObject, data: ComponentData, engine: EngineLike) {
    this.gameObject = gameObject;
    this.data = data;
    this.engine = engine;
  }
  get props() { return this.data; }
  get enabled() { return this.data.enabled !== false && this.gameObject.active; }
  // lifecycle hooks (overridden)
  onStart() {}
  onUpdate(_dt: number) {}
  onFixedUpdate(_dt: number) {}
  onDestroy() {}
  onTriggerEnter(_other: RuntimeObject) {}
  onTriggerExit(_other: RuntimeObject) {}
  onCollisionEnter(_other: RuntimeObject, _relativeVelocity?: number) {}
  onInteract(_player: RuntimeObject) {}
}

export class RuntimeObject {
  id: string;
  data: GameObjectData;
  holder: THREE.Object3D;
  components: RuntimeComponent[] = [];
  engine: EngineLike | null = null;
  editMode: boolean;
  /** visual payload slots used by render components */
  slots: Record<string, any> = {};
  destroyed = false;

  constructor(data: GameObjectData, editMode: boolean) {
    this.id = data.id;
    this.data = data;
    this.editMode = editMode;
    this.holder = new THREE.Object3D();
    this.holder.name = data.name;
    this.holder.userData.gameObjectId = data.id;
    this.applyTransform(data.transform);
  }

  get name() { return this.data.name; }
  set name(v: string) { this.data.name = v; this.holder.name = v; }
  get active() { return this.data.active; }
  setActive(v: boolean) {
    this.data.active = v;
    this.holder.visible = v;
  }
  get tags() { return this.data.tags; }
  hasTag(t: string) { return this.data.tags.includes(t); }

  get position(): THREE.Vector3 { return this.holder.position; }
  get rotation(): THREE.Euler { return this.holder.rotation; }
  get scale(): THREE.Vector3 { return this.holder.scale; }

  setPosition(x: number | Vec3, y?: number, z?: number) {
    if (typeof x === 'object') { y = x.y; z = x.z; x = x.x; }
    this.holder.position.set(x, y ?? 0, z ?? 0);
    this.syncToData();
  }
  setRotation(x: number | Vec3, y?: number, z?: number) {
    if (typeof x === 'object') { y = x.y; z = x.z; x = x.x; }
    this.holder.rotation.set(
      (x ?? 0) * Math.PI / 180, (y ?? 0) * Math.PI / 180, (z ?? 0) * Math.PI / 180,
    );
    this.syncToData();
  }
  setScale(x: number | Vec3, y?: number, z?: number) {
    if (typeof x === 'object') { y = x.y; z = x.z; x = x.x; }
    this.holder.scale.set(x ?? 1, y ?? 1, z ?? 1);
    this.syncToData();
  }
  move(x: number, y: number, z: number) {
    this.holder.position.x += x; this.holder.position.y += y; this.holder.position.z += z;
    this.syncToData();
  }
  rotateY(rad: number) { this.holder.rotation.y += rad; this.syncToData(); }
  lookAt(x: number, y: number, z: number) { this.holder.lookAt(x, y, z); this.syncToData(); }
  /** Yaw in degrees (commonly used by NPCs / controllers). */
  get yaw() { return this.holder.rotation.y * 180 / Math.PI; }
  setYaw(deg: number) { this.holder.rotation.y = deg * Math.PI / 180; this.syncToData(); }

  applyTransform(t: { position: Vec3; rotation: Vec3; scale: Vec3 }) {
    this.holder.position.set(t.position.x, t.position.y, t.position.z);
    this.holder.rotation.set(t.rotation.x * Math.PI / 180, t.rotation.y * Math.PI / 180, t.rotation.z * Math.PI / 180);
    this.holder.scale.set(t.scale.x, t.scale.y, t.scale.z);
  }

  /** Push three transform back into serializable data (used by play mode & gizmo edits). */
  syncToData() {
    const t = this.data.transform;
    t.position = { x: this.holder.position.x, y: this.holder.position.y, z: this.holder.position.z };
    t.rotation = { x: this.holder.rotation.x * 180 / Math.PI, y: this.holder.rotation.y * 180 / Math.PI, z: this.holder.rotation.z * 180 / Math.PI };
    t.scale = { x: this.holder.scale.x, y: this.holder.scale.y, z: this.holder.scale.z };
  }

  getComponent<T extends RuntimeComponent = RuntimeComponent>(type: string): T | undefined {
    return this.components.find(c => c.data.type === type) as T | undefined;
  }
  getComponentData(type: string): ComponentData | undefined {
    return this.data.components.find(c => c.type === type);
  }
  /** Instantiate a behaviour component (runtime only). */
  attachComponent(comp: RuntimeComponent) {
    this.components.push(comp);
  }
  worldPosition(): Vec3 {
    const v = new THREE.Vector3();
    this.holder.getWorldPosition(v);
    return { x: v.x, y: v.y, z: v.z };
  }
  distanceTo(other: RuntimeObject): number {
    const a = this.worldPosition(), b = other.worldPosition();
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  find(name: string): RuntimeObject | null { return this.engine?.find(name) ?? null; }
  destroy() { this.engine?.destroyObject(this.id); }
}

/** Helper: create live component instances via the registry's runtime class. */
export function instantiateComponent(go: RuntimeObject, data: ComponentData, engine: EngineLike): RuntimeComponent | null {
  const def = getComponentDef(data.type);
  if (!def?.runtime) return null;
  const cls = def.runtime as new (go: RuntimeObject, data: ComponentData, engine: EngineLike) => RuntimeComponent;
  return new cls(go, data, engine);
}
