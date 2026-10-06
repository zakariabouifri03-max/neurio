// ============================================================================
// NEXUS ENGINE — Core data types
// The entire project is described by these serializable structures.
// Everything (Editor, AI Agent, BuildSystem, Runtime) operates on this model.
// ============================================================================

export interface Vec3 { x: number; y: number; z: number; }
export interface Vec2 { x: number; y: number; }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const v3eq = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

export interface TransformData {
  position: Vec3;
  rotation: Vec3; // euler degrees
  scale: Vec3;
}

export type AssetType =
  | 'model' | 'texture' | 'material' | 'audio' | 'animation'
  | 'script' | 'prefab' | 'scene' | 'uitemplate' | 'font' | 'other';

export interface AssetData {
  id: string;
  name: string;
  type: AssetType;
  path: string;            // server-relative path (Content/...) — empty for embedded assets
  size: number;
  thumbnail?: string;      // dataURL
  meta?: Record<string, any>;
  /** For embedded asset kinds (material/prefab/uitemplate) the payload lives here. */
  data?: any;
}

export interface ComponentData {
  type: string;
  enabled?: boolean;
  [key: string]: any;
}

export interface GameObjectData {
  id: string;
  name: string;
  active: boolean;
  tags: string[];
  transform: TransformData;
  parent: string | null;
  components: ComponentData[];
  locked?: boolean;
  expanded?: boolean;
}

export interface EnvironmentData {
  skyTop: string;
  skyBottom: string;
  ambientColor: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
  sunAngle: number;        // degrees
  sunElevation: number;    // degrees
  fogMode: 'none' | 'linear' | 'exponential';
  fogColor: string;
  fogDensity: number;
  fogNear: number;
  fogFar: number;
  shadows: boolean;
}

export interface SceneData {
  id: string;
  name: string;
  environment: EnvironmentData;
  objects: GameObjectData[];
}

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';
export type TargetPlatform = 'windows' | 'web';

export interface ProjectSettings {
  graphicsQuality: GraphicsQuality;
  targetPlatform: TargetPlatform;
  entrySceneId: string;
  playerStartId?: string;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

export interface CraftRecipe {
  id: string;
  name: string;
  inputs: Record<string, number>;
  output: string;
  outputAmount: number;
}

export interface ProjectData {
  id: string;
  name: string;
  template: string;
  createdAt: string;
  modifiedAt: string;
  description?: string;
  settings: ProjectSettings;
  scenes: SceneData[];
  assets: AssetData[];
  scripts: Record<string, { id: string; name: string; source: string; description?: string }>;
  uiDocuments: UiDocumentData[];
  variables: Record<string, any>;
  recipes: CraftRecipe[];
  aiMemory: AiMemory;
  changeLog: ChangeEntry[];
  version: number;
}

export interface ChangeEntry {
  time: string;
  actor: string; // 'user' | 'ai:<tool>' | 'build'
  description: string;
}

export interface AiMemory {
  summary: string;
  architecture: string[];
  systems: string[];
  keyObjects: { id: string; name: string; role: string }[];
  decisions: { time: string; text: string }[];
  knownBugs: { time: string; text: string; resolved: boolean }[];
  index: { scripts: { id: string; name: string; keywords: string }[] };
}

// ---------------------------- UI documents ---------------------------------

export type UiElementType = 'panel' | 'text' | 'image' | 'button' | 'progressbar';

export interface UiElementData {
  id: string;
  type: UiElementType;
  name?: string;
  x: number | string; y: number | string;   // px or '50%' / 'calc(50%-100px)'
  width: number | string; height: number | string;
  anchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  text?: string;
  color?: string;
  background?: string;
  fontSize?: number;
  image?: string;            // asset id or dataURL
  fill?: number;             // progressbar 0..1
  fillColor?: string;
  visible?: boolean;
  binding?: string;          // e.g. 'player.health', 'player.stamina', 'game.time'
  bindingMax?: string;       // e.g. 'player.maxHealth'
  action?: string;           // button action id
  children?: UiElementData[];
}

export interface UiDocumentData {
  id: string;
  name: string;
  mode: 'overlay' | 'menu';   // overlay = HUD in scene, menu = fullscreen page
  visibleInPlay: boolean;
  elements: UiElementData[];
}

// ---------------------------- Visual scripting ------------------------------

export type VsPinKind = 'exec' | 'data';
export interface VsNode {
  id: string;
  type: string;
  x: number; y: number;
  params?: Record<string, any>;
}
export interface VsLink { from: { node: string; pin: number; kind?: 'exec' | 'data' }; to: { node: string; pin: number; kind?: 'exec' | 'data' }; }
export interface VsGraph {
  id: string;
  name: string;
  nodes: VsNode[];
  links: VsLink[];
  variables?: Record<string, any>;
}

// ---------------------------- Helpers --------------------------------------

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function defaultTransform(): TransformData {
  return { position: v3(), rotation: v3(), scale: v3(1, 1, 1) };
}

export function gameObject(name: string, opts: Partial<GameObjectData> = {}): GameObjectData {
  return {
    id: uid('o_'),
    name,
    active: true,
    tags: [],
    transform: opts.transform ?? defaultTransform(),
    parent: opts.parent ?? null,
    components: opts.components ?? [],
    locked: false,
    expanded: true,
  };
}

export function defaultEnvironment(): EnvironmentData {
  return {
    skyTop: '#0e1420',
    skyBottom: '#3a4a63',
    ambientColor: '#bcd2ff',
    ambientIntensity: 0.45,
    sunColor: '#fff2dd',
    sunIntensity: 2.2,
    sunAngle: 125,
    sunElevation: 42,
    fogMode: 'none',
    fogColor: '#9db1c7',
    fogDensity: 0.012,
    fogNear: 20,
    fogFar: 260,
    shadows: true,
  };
}

export function emptyAiMemory(): AiMemory {
  return {
    summary: '',
    architecture: [],
    systems: [],
    keyObjects: [],
    decisions: [],
    knownBugs: [],
    index: { scripts: [] },
  };
}

export function createEmptyProject(name: string, template = 'empty'): ProjectData {
  const sceneId = uid('s_');
  return {
    id: uid('p_'),
    name,
    template,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    description: '',
    settings: {
      graphicsQuality: 'high',
      targetPlatform: 'web',
      entrySceneId: sceneId,
      masterVolume: 0.9,
      musicVolume: 0.6,
      sfxVolume: 0.9,
    },
    scenes: [{ id: sceneId, name: 'Main', environment: defaultEnvironment(), objects: [] }],
    assets: [],
    scripts: {},
    uiDocuments: [],
    variables: {},
    recipes: [],
    aiMemory: emptyAiMemory(),
    changeLog: [],
    version: 1,
  };
}

/** Deep structured clone that also preserves typed arrays (structuredClone). */
export function cloneData<T>(data: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(data)
    : JSON.parse(JSON.stringify(data));
}

/** Find an object anywhere in the scene, returning the object + top-level index. */
export function findObject(scene: SceneData, id: string): GameObjectData | null {
  return scene.objects.find(o => o.id === id) ?? null;
}

export function childrenOf(scene: SceneData, id: string | null): GameObjectData[] {
  return scene.objects.filter(o => o.parent === id);
}

/** Depth-first traversal order used by hierarchy display. */
export function flattenHierarchy(scene: SceneData): GameObjectData[] {
  const out: GameObjectData[] = [];
  const walk = (parent: string | null) => {
    for (const o of scene.objects) {
      if (o.parent === parent) { out.push(o); walk(o.id); }
    }
  };
  walk(null);
  return out;
}

/** Iterate a subtree (including root) depth-first. */
export function subtree(scene: SceneData, rootId: string): GameObjectData[] {
  const out: GameObjectData[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const o = findObject(scene, id);
    if (!o) continue;
    out.push(o);
    for (const c of childrenOf(scene, id)) stack.push(c.id);
  }
  return out;
}

export function worldTransform(scene: SceneData, id: string): TransformData {
  const o = findObject(scene, id);
  if (!o) return defaultTransform();
  if (!o.parent) return o.transform;
  const p = worldTransform(scene, o.parent);
  // Composition of euler XYZ with scale — sufficient for editor purposes.
  const deg = Math.PI / 180;
  const cr = Math.cos(o.transform.rotation.x * deg), sr = Math.sin(o.transform.rotation.x * deg);
  const cy = Math.cos(o.transform.rotation.y * deg), sy = Math.sin(o.transform.rotation.y * deg);
  const local = o.transform.position;
  const scaled = v3(local.x * p.scale.x, local.y * p.scale.y, local.z * p.scale.z);
  const x = scaled.x, y = scaled.y, z = scaled.z;
  // rotate around Y then X (parent euler) — approximation matching three's XYZ order
  const xy = x * cy - z * sy, zy = x * sy + z * cy;
  const xy2 = xy * cr - y * sr, y2 = xy * sr + y * cr;
  return {
    position: v3(p.position.x + xy2, p.position.y + y2, p.position.z + zy),
    rotation: v3(p.rotation.x + o.transform.rotation.x, p.rotation.y + o.transform.rotation.y, p.rotation.z + o.transform.rotation.z),
    scale: v3(p.scale.x * o.transform.scale.x, p.scale.y * o.transform.scale.y, p.scale.z * o.transform.scale.z),
  };
}

export function getComponent(o: GameObjectData, type: string): ComponentData | undefined {
  return o.components.find(c => c.type === type);
}
