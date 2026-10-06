// ============================================================================
// NEXUS ENGINE — Scene & project mutation operations
// Pure data operations shared by the Editor UI, the AI Agent tools and the
// game templates. Every op validates and returns the affected ids so the
// editor can refresh views incrementally.
// ============================================================================
import {
  ProjectData, SceneData, GameObjectData, ComponentData, AssetData, Vec3,
  gameObject as makeObject, uid, cloneData, findObject, subtree, childrenOf,
} from './types';
import { createComponentData, getComponentDef } from './registry';

// ------------------------------ scene objects -------------------------------

export function addGameObject(project: ProjectData, sceneId: string | null, name: string, opts: Partial<GameObjectData> = {}): GameObjectData {
  const scene = project.scenes.find(s => s.id === (sceneId ?? project.settings.entrySceneId)) ?? project.scenes[0];
  const go = makeObject(name, opts);
  scene.objects.push(go);
  return go;
}

export function removeGameObject(project: ProjectData, sceneId: string, id: string): GameObjectData[] {
  const scene = project.scenes.find(s => s.id === sceneId)!;
  const removed = subtree(scene, id);
  const ids = new Set(removed.map(o => o.id));
  // reparent children of removed roots to the removed root's parent
  const root = findObject(scene, id);
  for (const o of scene.objects) {
    if (o.parent && ids.has(o.parent) && o.parent !== id) o.parent = root?.parent ?? null;
  }
  scene.objects = scene.objects.filter(o => !ids.has(o.id));
  return removed;
}

export function duplicateGameObject(project: ProjectData, sceneId: string, id: string): GameObjectData | null {
  const scene = project.scenes.find(s => s.id === sceneId)!;
  const source = findObject(scene, id);
  if (!source) return null;
  const tree = subtree(scene, id);
  const idMap = new Map<string, string>();
  for (const o of tree) idMap.set(o.id, uid('o_'));
  let rootClone: GameObjectData | null = null;
  for (const o of tree) {
    const clone: GameObjectData = cloneData(o);
    clone.id = idMap.get(o.id)!;
    clone.name = o === source ? `${o.name} (Copy)` : o.name;
    clone.parent = o.parent ? (idMap.get(o.parent) ?? o.parent) : null;
    scene.objects.push(clone);
    if (o === source) rootClone = clone;
  }
  return rootClone;
}

export function setParent(project: ProjectData, sceneId: string, id: string, parent: string | null) {
  const scene = project.scenes.find(s => s.id === sceneId)!;
  if (id === parent) return;
  // prevent cycles
  let p = parent;
  while (p) {
    if (p === id) return;
    p = findObject(scene, p)?.parent ?? null;
  }
  const go = findObject(scene, id);
  if (go) go.parent = parent;
}

export function renameGameObject(project: ProjectData, sceneId: string, id: string, name: string) {
  const go = findObject(project.scenes.find(s => s.id === sceneId)!, id);
  if (go) go.name = name;
}

// ------------------------------- components ---------------------------------

export function addComponent(project: ProjectData, sceneId: string, objectId: string, type: string, overrides: Record<string, any> = {}): ComponentData | null {
  const go = findObject(project.scenes.find(s => s.id === sceneId)!, objectId);
  if (!go) return null;
  if (!getComponentDef(type)) return null;
  const comp = createComponentData(type, overrides);
  go.components.push(comp);
  return comp;
}

export function removeComponent(project: ProjectData, sceneId: string, objectId: string, type: string, index?: number): boolean {
  const go = findObject(project.scenes.find(s => s.id === sceneId)!, objectId);
  if (!go) return false;
  const i = index !== undefined ? index : go.components.findIndex(c => c.type === type);
  if (i < 0) return false;
  go.components.splice(i, 1);
  return true;
}

export function setComponentProperty(project: ProjectData, sceneId: string, objectId: string, compType: string, key: string, value: any, index = 0): boolean {
  const go = findObject(project.scenes.find(s => s.id === sceneId)!, objectId);
  if (!go) return false;
  const comps = go.components.filter(c => c.type === compType);
  const comp = comps[index];
  if (!comp) return false;
  setDeep(comp, key, value);
  return true;
}

export function setDeep(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// --------------------------------- assets -----------------------------------

export function addAsset(project: ProjectData, asset: Partial<AssetData> & { name: string; type: AssetData['type'] }): AssetData {
  const a: AssetData = {
    id: asset.id ?? uid('a_'),
    name: asset.name,
    type: asset.type,
    path: asset.path ?? '',
    size: asset.size ?? 0,
    thumbnail: asset.thumbnail,
    meta: asset.meta ?? {},
    data: asset.data,
  };
  project.assets.push(a);
  return a;
}

export function createMaterialAsset(project: ProjectData, name: string, data: Partial<any> = {}): AssetData {
  return addAsset(project, {
    name,
    type: 'material',
    data: {
      color: '#a8a29a', metallic: 0.05, roughness: 0.8,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1,
      map: null, normalMap: null, doubleSided: false, ...data,
    },
  });
}

export function createPrefabFrom(project: ProjectData, sceneId: string, objectId: string, name?: string): AssetData | null {
  const scene = project.scenes.find(s => s.id === sceneId)!;
  const tree = subtree(scene, objectId);
  if (!tree.length) return null;
  return addAsset(project, {
    name: name ?? `${tree[0].name} Prefab`,
    type: 'prefab',
    data: cloneData(tree),
    meta: { root: tree[0].name },
  });
}

export function createScriptAsset(project: ProjectData, name: string, source: string, description = ''): string {
  const id = uid('sc_');
  project.scripts[id] = { id, name, source, description };
  // keep AI memory index fresh
  project.aiMemory.index.scripts.push({ id, name, keywords: name.toLowerCase() });
  return id;
}

export function setScriptSource(project: ProjectData, scriptId: string, source: string) {
  const s = project.scripts[scriptId];
  if (s) s.source = source;
}

export function addScene(project: ProjectData, name: string): SceneData {
  const scene: SceneData = {
    id: uid('s_'),
    name,
    environment: cloneData(project.scenes[0]?.environment ?? ({} as any)),
    objects: [],
  };
  if (!scene.environment.skyTop) {
    scene.environment = {
      skyTop: '#0e1420', skyBottom: '#3a4a63', ambientColor: '#bcd2ff', ambientIntensity: 0.45,
      sunColor: '#fff2dd', sunIntensity: 2.2, sunAngle: 125, sunElevation: 42,
      fogMode: 'none', fogColor: '#9db1c7', fogDensity: 0.012, fogNear: 20, fogFar: 260, shadows: true,
    };
  }
  project.scenes.push(scene);
  return scene;
}

// ------------------------------ validation ----------------------------------

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  objectId?: string;
  assetId?: string;
  scriptId?: string;
}

export function validateProject(project: ProjectData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!project.scenes.length) issues.push({ severity: 'error', message: 'Project has no scenes.' });
  if (!project.scenes.find(s => s.id === project.settings.entrySceneId)) {
    issues.push({ severity: 'error', message: 'Entry scene is not set — set one in Project Settings.' });
  }
  const assetIds = new Set(project.assets.map(a => a.id));
  for (const scene of project.scenes) {
    for (const o of scene.objects) {
      for (const c of o.components) {
        if (c.type === 'MeshRenderer') {
          for (const key of ['materialAsset', 'modelAsset', 'meshAsset']) {
            if (c[key] && !assetIds.has(c[key])) issues.push({ severity: 'error', message: `${o.name}: MeshRenderer references missing asset (${key}).`, objectId: o.id, assetId: c[key] });
          }
        }
        if (c.type === 'Script' && c.script && !project.scripts[c.script]) {
          issues.push({ severity: 'error', message: `${o.name}: Script component references missing script.`, objectId: o.id, scriptId: c.script });
        }
        if (c.type === 'Spawner' && c.prefab && !assetIds.has(c.prefab)) {
          issues.push({ severity: 'error', message: `${o.name}: Spawner references missing prefab.`, objectId: o.id });
        }
        if (c.type === 'AudioSource' && c.clip && !assetIds.has(c.clip)) {
          issues.push({ severity: 'error', message: `${o.name}: AudioSource references missing clip.`, objectId: o.id });
        }
        const def = getComponentDef(c.type);
        if (!def) issues.push({ severity: 'error', message: `${o.name}: unknown component type "${c.type}".`, objectId: o.id });
      }
    }
  }
  // player check
  const entry = project.scenes.find(s => s.id === project.settings.entrySceneId);
  if (entry) {
    const hasController = entry.objects.some(o => o.components.some(c => ['ThirdPersonController', 'FirstPersonController', 'TopDownController'].includes(c.type)));
    if (!hasController && entry.objects.length > 0) {
      issues.push({ severity: 'warning', message: 'Entry scene has no player controller — the game will use a spectator camera.' });
    }
    const hasCamera = entry.objects.some(o => o.components.some(c => c.type === 'Camera' || ['ThirdPersonController', 'FirstPersonController', 'TopDownController'].includes(c.type)));
    if (!hasCamera && entry.objects.length > 0) issues.push({ severity: 'warning', message: 'Entry scene has no camera.' });
  }
  return issues;
}
