// ============================================================================
// NEXUS AI AGENT — Tool registry
// Structured tools the agent uses to inspect and modify the project.
// These are REAL operations — the same code paths the editor UI uses.
// Tools operate through the shared ops layer and emit editorBus events so
// every panel updates live.
// ============================================================================

import { store } from '../Editor/store';
import {
  addGameObject, removeGameObject, addComponent, setComponentProperty, removeComponent,
  createMaterialAsset, createPrefabFrom, createScriptAsset, setScriptSource, addScene, setParent,
  addAsset, duplicateGameObject, setDeep,
} from '../Engine/core/ops';
import { editorBus } from '../Engine/core/events';
import { findObject, cloneData, defaultTransform, type GameObjectData, type Vec3 } from '../Engine/core/types';
import { getComponentDef, allComponentDefs } from '../Engine/core/registry';
import { templateHealthBar, templateCrosshair, templateInventory, templateMainMenu, templatePauseMenu, templateEndScreens, templateCrafting, templateInteractPrompt } from '../Engine/ui/hud';
import { generateIsland, encodeFloats, encodeBytes, paintIslandSplat } from '../Engine/terrain/terrain';

/** Editor capabilities the tools may invoke (implemented by EditorApp). */
export interface EditorContext {
  runGame(sceneId?: string): void;
  stopGame(): void;
  runPlaytest(seconds?: number): Promise<any>;
  buildProject(mode?: string): Promise<any>;
  focusObject(id: string): void;
  openScript(scriptId: string, line?: number): void;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  details?: any;
  changes?: string[];      // human-readable change manifest entries
  destructive?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  params: Record<string, { type: string; description?: string; required?: boolean }>;
  destructive?: boolean;
  execute(args: any): ToolResult;
}

const ctx: EditorContext = null as any; // injected via setEditorContext
let editorCtx: EditorContext | null = null;
export function setEditorContext(c: EditorContext) { editorCtx = c; }

function sceneId(): string { return store.sceneId ?? store.project!.settings.entrySceneId; }
function requireProject() {
  if (!store.project) throw new Error('No project open.');
  return store.project;
}
function refresh(structural = true) {
  store.markDirty();
  editorBus.emit('sceneChanged', { sceneId: sceneId(), structural });
}
function obj(nameOrId: string): GameObjectData | null {
  const scene = store.scene!;
  return findObject(scene, nameOrId) ?? scene.objects.find(o => o.name.toLowerCase() === nameOrId.toLowerCase()) ?? null;
}
function parseVec3(v: any, fallback: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  if (!v) return { ...fallback };
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(\.\d+)?/g);
    if (m && m.length >= 3) return { x: +m[0], y: +m[1], z: +m[2] };
    return { ...fallback };
  }
  return { x: v.x ?? fallback.x, y: v.y ?? fallback.y, z: v.z ?? fallback.z };
}

const tools = new Map<string, AgentTool>();
export function getTool(name: string) { return tools.get(name); }
export function allTools(): AgentTool[] { return [...tools.values()]; }
function defineTool(t: AgentTool) { tools.set(t.name, t); }

// ============================== INSPECTION ==================================

defineTool({
  name: 'inspect_project',
  description: 'Get an overview of the open project: scenes, object counts, systems, assets, scripts.',
  params: {},
  execute(): ToolResult {
    const p = requireProject();
    return {
      ok: true,
      summary: `Project "${p.name}": ${p.scenes.length} scene(s), ${p.scenes.reduce((a, s) => a + s.objects.length, 0)} objects, ${p.assets.length} assets, ${Object.keys(p.scripts).length} scripts, ${p.uiDocuments.length} UI documents, ${p.recipes.length} recipes.`,
      details: {
        name: p.name, template: p.template,
        scenes: p.scenes.map(s => ({ id: s.id, name: s.name, objects: s.objects.length })),
        assets: p.assets.map(a => ({ id: a.id, name: a.name, type: a.type })),
        scripts: Object.values(p.scripts).map(s => ({ id: s.id, name: s.name })),
        systems: p.aiMemory.systems,
        entryScene: p.scenes.find(s => s.id === p.settings.entrySceneId)?.name,
      },
    };
  },
});

defineTool({
  name: 'inspect_scene',
  description: 'List the game objects and components of a scene (default: active scene).',
  params: { scene: { type: 'string', description: 'Scene name or id (optional)' } },
  execute(args): ToolResult {
    const p = requireProject();
    const scene = p.scenes.find(s => s.name === args?.scene || s.id === args?.scene) ?? store.scene!;
    return {
      ok: true,
      summary: `Scene "${scene.name}": ${scene.objects.length} objects.`,
      details: scene.objects.map(o => ({
        id: o.id, name: o.name, active: o.active, tags: o.tags,
        components: o.components.map(c => ({ type: c.type, key: Object.entries(c).filter(([k]) => !['type', 'enabled'].includes(k)).slice(0, 5) })),
      })),
    };
  },
});

defineTool({
  name: 'inspect_game_object',
  description: 'Full component & property dump of one game object.',
  params: { object: { type: 'string', description: 'Object name or id', required: true } },
  execute(args): ToolResult {
    const o = obj(String(args?.object ?? ''));
    if (!o) return { ok: false, summary: `Object "${args?.object}" not found.` };
    return {
      ok: true,
      summary: `${o.name}: ${o.components.length} component(s) — ${o.components.map(c => c.type).join(', ')}`,
      details: { id: o.id, name: o.name, transform: o.transform, tags: o.tags, components: o.components },
    };
  },
});

defineTool({
  name: 'search_project',
  description: 'Keyword search across object names, components, scripts and assets.',
  params: { query: { type: 'string', description: 'Search query', required: true } },
  execute(args): ToolResult {
    const p = requireProject();
    const q = String(args?.query ?? '').toLowerCase();
    const hits: any = { objects: [], scripts: [], assets: [] };
    for (const s of p.scenes) for (const o of s.objects) {
      const text = (o.name + ' ' + o.tags.join(' ') + ' ' + o.components.map(c => c.type + ' ' + JSON.stringify(c)).join(' ')).toLowerCase();
      if (text.includes(q)) hits.objects.push({ scene: s.name, id: o.id, name: o.name });
    }
    for (const s of Object.values(p.scripts)) {
      if ((s.name + ' ' + s.source).toLowerCase().includes(q)) hits.scripts.push({ id: s.id, name: s.name });
    }
    for (const a of p.assets) if (a.name.toLowerCase().includes(q) || a.type === q) hits.assets.push({ id: a.id, name: a.name, type: a.type });
    const count = hits.objects.length + hits.scripts.length + hits.assets.length;
    return { ok: true, summary: `${count} match(es) for "${args.query}".`, details: hits };
  },
});

defineTool({
  name: 'inspect_asset',
  description: 'Inspect an imported asset (type, size, metadata, animations).',
  params: { asset: { type: 'string', description: 'Asset name or id', required: true } },
  execute(args): ToolResult {
    const p = requireProject();
    const a = p.assets.find(x => x.id === args?.asset || x.name.toLowerCase() === String(args?.asset).toLowerCase());
    if (!a) return { ok: false, summary: `Asset "${args?.asset}" not found.` };
    return { ok: true, summary: `${a.name} [${a.type}] ${(a.size / 1024).toFixed(1)}KB`, details: { id: a.id, name: a.name, type: a.type, path: a.path, size: a.size, meta: a.meta } };
  },
});

defineTool({
  name: 'read_console',
  description: 'Read recent console output from the last play session.',
  params: { level: { type: 'string', description: 'Filter: info|warning|error (optional)' } },
  execute(args): ToolResult {
    const lines = store.consoleLines.slice(-40).filter(l => !args?.level || l.level === args.level);
    return { ok: true, summary: `${lines.length} console line(s).`, details: lines };
  },
});

defineTool({
  name: 'read_errors',
  description: 'Read current problems (script errors, validation issues) with file & line.',
  params: {},
  execute(): ToolResult {
    return {
      ok: true,
      summary: store.problems.length ? `${store.problems.length} problem(s).` : 'No problems.',
      details: store.problems,
    };
  },
});

// ============================== CREATION ====================================

defineTool({
  name: 'create_game_object',
  description: 'Create a game object with components. Component props use registry defaults.',
  params: {
    name: { type: 'string', description: 'Object name', required: true },
    position: { type: 'string', description: '"x,y,z" world position (optional)' },
    components: { type: 'array', description: 'Component types with optional props, e.g. ["Light", {"type":"RigidBody","mass":2}]' },
    parent: { type: 'string', description: 'Parent object name (optional)' },
    tags: { type: 'array', description: 'Tags (optional)' },
  },
  execute(args): ToolResult {
    const p = requireProject();
    const pos = parseVec3(args?.position);
    const go = addGameObject(p, sceneId(), String(args.name), { transform: { position: pos, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
    if (args?.parent) {
      const parent = obj(String(args.parent));
      if (parent) go.parent = parent.id;
    }
    for (const t of (go.tags = args?.tags ?? [])) { }
    const created: string[] = [];
    for (const c of (args?.components ?? [])) {
      if (typeof c === 'string') { addComponent(p, sceneId(), go.id, c); created.push(c); }
      else if (c && c.type) {
        const { type, ...props } = c;
        const comp = addComponent(p, sceneId(), go.id, type, props);
        if (comp) created.push(type);
      }
    }
    refresh();
    editorBus.emit('selectionChanged', { ids: [go.id] });
    return { ok: true, summary: `Created "${go.name}"${created.length ? ` with ${created.join(', ')}` : ''}.`, details: { id: go.id }, changes: [`+ object "${go.name}"${created.length ? ` (${created.join(', ')})` : ''}`] };
  },
});

defineTool({
  name: 'delete_game_object',
  description: 'Delete a game object and its children.',
  params: { object: { type: 'string', description: 'Object name or id', required: true } },
  destructive: true,
  execute(args): ToolResult {
    const p = requireProject();
    const o = obj(String(args?.object ?? ''));
    if (!o) return { ok: false, summary: `Object "${args?.object}" not found.` };
    const removed = removeGameObject(p, sceneId(), o.id);
    refresh();
    return { ok: true, summary: `Deleted ${removed.length} object(s) (root: "${o.name}").`, changes: [`− object "${o.name}" (+${removed.length - 1} children)`], destructive: true };
  },
});

defineTool({
  name: 'add_component',
  description: 'Add a component to an existing object.',
  params: {
    object: { type: 'string', description: 'Object name or id', required: true },
    component: { type: 'string', description: 'Component type', required: true },
    props: { type: 'object', description: 'Property overrides' },
  },
  execute(args): ToolResult {
    const p = requireProject();
    const o = obj(String(args?.object ?? ''));
    if (!o) return { ok: false, summary: `Object "${args?.object}" not found.` };
    if (!getComponentDef(String(args.component))) return { ok: false, summary: `Unknown component "${args.component}".` };
    const comp = addComponent(p, sceneId(), o.id, String(args.component), args?.props ?? {});
    refresh();
    return { ok: true, summary: `Added ${args.component} to "${o.name}".`, changes: [`~ ${o.name}: + ${args.component}`] };
  },
});

defineTool({
  name: 'modify_component',
  description: 'Modify a property of a component on an object.',
  params: {
    object: { type: 'string', description: 'Object name or id', required: true },
    component: { type: 'string', description: 'Component type', required: true },
    property: { type: 'string', description: 'Property path (e.g. "moveSpeed" or "openOffset.y")', required: true },
    value: { type: 'any', description: 'New value', required: true },
  },
  execute(args): ToolResult {
    const p = requireProject();
    const o = obj(String(args?.object ?? ''));
    if (!o) return { ok: false, summary: `Object "${args?.object}" not found.` };
    const ok = setComponentProperty(p, sceneId(), o.id, String(args.component), String(args.property), args.value);
    refresh(false);
    editorBus.emit('objectsChanged', { ids: [o.id] });
    return ok
      ? { ok: true, summary: `Set ${o.name}.${args.component}.${args.property} = ${JSON.stringify(args.value)}.`, changes: [`~ ${o.name}.${args.component}.${args.property} = ${JSON.stringify(args.value)}`] }
      : { ok: false, summary: `Component ${args.component} not found on "${o.name}".` };
  },
});

defineTool({
  name: 'set_object_property',
  description: 'Set object-level data: name, active, tags, transform, parent.',
  params: {
    object: { type: 'string', description: 'Object name or id', required: true },
    property: { type: 'string', description: 'name | active | tags | position | rotation | scale | parent', required: true },
    value: { type: 'any', description: 'New value', required: true },
  },
  execute(args): ToolResult {
    const p = requireProject();
    const o = obj(String(args?.object ?? ''));
    if (!o) return { ok: false, summary: `Object "${args?.object}" not found.` };
    switch (args.property) {
      case 'name': o.name = String(args.value); break;
      case 'active': o.active = !!args.value; break;
      case 'tags': o.tags = Array.isArray(args.value) ? args.value : String(args.value).split(',').map(s => s.trim()); break;
      case 'position': o.transform.position = parseVec3(args.value); break;
      case 'rotation': o.transform.rotation = parseVec3(args.value); break;
      case 'scale': o.transform.scale = parseVec3(args.value, { x: 1, y: 1, z: 1 }); break;
      case 'parent': {
        const parent = args.value ? obj(String(args.value)) : null;
        setParent(p, sceneId(), o.id, parent?.id ?? null);
        break;
      }
      default: return { ok: false, summary: `Unknown property "${args.property}".` };
    }
    refresh();
    return { ok: true, summary: `${o.name}.${args.property} updated.`, changes: [`~ ${o.name}.${args.property} = ${JSON.stringify(args.value)}`] };
  },
});

// ------------------------------- materials -----------------------------------

defineTool({
  name: 'create_material',
  description: 'Create a PBR material asset.',
  params: {
    name: { type: 'string', description: 'Material name', required: true },
    color: { type: 'string', description: 'Hex base color' },
    metallic: { type: 'number', description: 'Metallic 0-1' },
    roughness: { type: 'number', description: 'Roughness 0-1' },
    emissive: { type: 'string', description: 'Hex emissive color' },
    opacity: { type: 'number', description: 'Opacity 0-1' },
  },
  execute(args): ToolResult {
    const p = requireProject();
    const a = createMaterialAsset(p, String(args.name), {
      color: args?.color, metallic: args?.metallic, roughness: args?.roughness,
      emissive: args?.emissive, opacity: args?.opacity,
    });
    editorBus.emit('assetsChanged', undefined as any);
    store.markDirty();
    return { ok: true, summary: `Created material "${a.name}".`, details: { id: a.id }, changes: [`+ material "${a.name}"`] };
  },
});

defineTool({
  name: 'assign_material',
  description: 'Assign a material asset to an object\'s MeshRenderer.',
  params: {
    object: { type: 'string', description: 'Object name or id', required: true },
    material: { type: 'string', description: 'Material asset name or id', required: true },
  },
  execute(args): ToolResult {
    const p = requireProject();
    const o = obj(String(args?.object ?? ''));
    if (!o) return { ok: false, summary: `Object "${args?.object}" not found.` };
    const mat = p.assets.find(a => a.type === 'material' && (a.id === args?.material || a.name.toLowerCase() === String(args?.material).toLowerCase()));
    if (!mat) return { ok: false, summary: `Material "${args?.material}" not found.` };
    let mr = o.components.find(c => c.type === 'MeshRenderer');
    if (!mr) mr = addComponent(p, sceneId(), o.id, 'MeshRenderer');
    setDeep(mr, 'materialAsset', mat.id);
    refresh();
    return { ok: true, summary: `Assigned material "${mat.name}" to "${o.name}".`, changes: [`~ ${o.name}.material = ${mat.name}`] };
  },
});

// -------------------------------- prefabs -----------------------------------

defineTool({
  name: 'create_prefab',
  description: 'Create a prefab asset from an existing scene object (with children).',
  params: { object: { type: 'string', description: 'Object name or id', required: true }, name: { type: 'string', description: 'Prefab name' } },
  execute(args): ToolResult {
    const p = requireProject();
    const o = obj(String(args?.object ?? ''));
    if (!o) return { ok: false, summary: `Object "${args?.object}" not found.` };
    const asset = createPrefabFrom(p, sceneId(), o.id, args?.name);
    if (!asset) return { ok: false, summary: 'Failed to create prefab.' };
    editorBus.emit('assetsChanged', undefined as any);
    store.markDirty();
    return { ok: true, summary: `Created prefab "${asset.name}" from "${o.name}".`, details: { id: asset.id }, changes: [`+ prefab "${asset.name}"`] };
  },
});

// --------------------------------- scripts ----------------------------------

defineTool({
  name: 'create_script',
  description: 'Create a script asset (JS class with lifecycle hooks).',
  params: { name: { type: 'string', description: 'Script name', required: true }, source: { type: 'string', description: 'JS source code' } },
  execute(args): ToolResult {
    const p = requireProject();
    const className = String(args.name).replace(/[^\w]/g, '');
    const source = args?.source ?? defaultScriptSource(className);
    const id = createScriptAsset(p, className, source);
    editorBus.emit('assetsChanged', undefined as any);
    store.markDirty();
    return { ok: true, summary: `Created script "${className}".`, details: { id }, changes: [`+ script "${className}.js"`] };
  },
});

defineTool({
  name: 'modify_script',
  description: 'Replace the source of a script asset.',
  params: { script: { type: 'string', description: 'Script name or id', required: true }, source: { type: 'string', description: 'New full source', required: true } },
  destructive: true,
  execute(args): ToolResult {
    const p = requireProject();
    const s = Object.values(p.scripts).find(x => x.id === args?.script || x.name.toLowerCase() === String(args?.script).toLowerCase());
    if (!s) return { ok: false, summary: `Script "${args?.script}" not found.` };
    const oldLen = s.source.split('\n').length;
    setScriptSource(p, s.id, String(args.source));
    store.removeProblemsFor(s.id);
    editorBus.emit('assetsChanged', undefined as any);
    store.markDirty();
    return { ok: true, summary: `Updated script "${s.name}" (${oldLen} → ${String(args.source).split('\n').length} lines).`, changes: [`~ script "${s.name}.js"`], destructive: true };
  },
});

defineTool({
  name: 'read_script',
  description: 'Read a script source.',
  params: { script: { type: 'string', description: 'Script name or id', required: true } },
  execute(args): ToolResult {
    const p = requireProject();
    const s = Object.values(p.scripts).find(x => x.id === args?.script || x.name.toLowerCase() === String(args?.script).toLowerCase());
    if (!s) return { ok: false, summary: `Script "${args?.script}" not found.` };
    return { ok: true, summary: `Script "${s.name}" (${s.source.split('\n').length} lines).`, details: { id: s.id, name: s.name, source: s.source } };
  },
});

// --------------------------------- scenes -----------------------------------

defineTool({
  name: 'create_scene',
  description: 'Create a new scene.',
  params: { name: { type: 'string', description: 'Scene name', required: true }, setAsEntry: { type: 'boolean', description: 'Make it the entry scene' } },
  execute(args): ToolResult {
    const p = requireProject();
    const s = addScene(p, String(args.name));
    if (args?.setAsEntry) p.settings.entrySceneId = s.id;
    refresh();
    return { ok: true, summary: `Created scene "${s.name}"${args?.setAsEntry ? ' (entry scene)' : ''}.`, details: { id: s.id }, changes: [`+ scene "${s.name}"`] };
  },
});

defineTool({
  name: 'modify_scene',
  description: 'Modify scene environment (sky, fog, sun, ambient).',
  params: {
    property: { type: 'string', description: 'skyTop|skyBottom|ambientColor|ambientIntensity|sunColor|sunIntensity|fogMode|fogColor|fogNear|fogFar|shadows', required: true },
    value: { type: 'any', description: 'New value', required: true },
  },
  execute(args): ToolResult {
    const scene = store.scene!;
    if (!(args.property in scene.environment)) return { ok: false, summary: `Unknown environment property "${args.property}".` };
    (scene.environment as any)[args.property] = args.value;
    refresh(false);
    return { ok: true, summary: `Scene environment: ${args.property} = ${JSON.stringify(args.value)}.`, changes: [`~ scene.${args.property} = ${JSON.stringify(args.value)}`] };
  },
});

// ----------------------------------- UI -------------------------------------

defineTool({
  name: 'create_ui',
  description: 'Create a UI document from a template: HUD, Crosshair, Inventory, MainMenu, PauseMenu, EndScreens, Crafting.',
  params: { template: { type: 'string', description: 'Template name', required: true }, gameName: { type: 'string', description: 'For MainMenu title' } },
  execute(args): ToolResult {
    const p = requireProject();
    const t = String(args.template).toLowerCase();
    let doc;
    if (t.includes('hud') || t.includes('health')) doc = templateHealthBar();
    else if (t.includes('crosshair')) doc = templateCrosshair();
    else if (t.includes('inventory')) doc = templateInventory();
    else if (t.includes('main')) doc = templateMainMenu(args?.gameName ?? p.name);
    else if (t.includes('pause')) doc = templatePauseMenu();
    else if (t.includes('end') || t.includes('win')) { p.uiDocuments.push(...templateEndScreens()); doc = null; }
    else if (t.includes('craft')) doc = templateCrafting();
    else return { ok: false, summary: `Unknown UI template "${args.template}".` };
    if (doc) p.uiDocuments.push(doc);
    store.markDirty();
    return { ok: true, summary: `Created UI document${t.includes('end') ? 's (Win/Lose)' : ` "${doc.name}"`}.`, changes: [`+ UI "${t}"`] };
  },
});

// -------------------------------- terrain -----------------------------------

defineTool({
  name: 'generate_terrain',
  description: 'Generate terrain on an object\'s Terrain component: island or plains.',
  params: { object: { type: 'string', description: 'Object with Terrain component (creates one if missing)' }, style: { type: 'string', description: 'island | plains' }, maxHeight: { type: 'number', description: 'Max height (m)' } },
  execute(args): ToolResult {
    const p = requireProject();
    const o = obj(String(args?.object ?? 'Terrain')) ?? addGameObject(p, sceneId(), 'Terrain');
    let terrain = o.components.find(c => c.type === 'Terrain');
    if (!terrain) {
      terrain = addComponent(p, sceneId(), o.id, 'Terrain')!;
    }
    const d = terrain as any;
    if (String(args?.style ?? 'island') === 'island') {
      const result = generateIsland({ size: d.size ?? 200, segments: d.segments ?? 96, maxHeight: args?.maxHeight ?? 18, seed: Math.floor(Math.random() * 9999) });
      d.heights = encodeFloats(result.heights);
      d.colors = encodeBytes(result.colors);
    } else {
      const n = (d.segments ?? 96) + 1;
      const heights = new Float32Array(n * n);
      const colors = new Uint8Array(n * n * 3);
      for (let i = 0; i < heights.length; i++) { heights[i] = (Math.random() - 0.5) * 3; colors[i * 3 + 1] = 255; }
      d.heights = encodeFloats(heights);
      d.colors = encodeBytes(colors);
    }
    refresh();
    return { ok: true, summary: `Generated ${args?.style ?? 'island'} terrain on "${o.name}".`, changes: [`~ terrain "${o.name}" regenerated`], details: { object: o.id } };
  },
});

// -------------------------------- gameplay ---------------------------------

defineTool({
  name: 'add_recipe',
  description: 'Add a crafting recipe.',
  params: { name: { type: 'string', required: true }, inputs: { type: 'object', description: '{item: amount}' }, output: { type: 'string', required: true }, outputAmount: { type: 'number' } },
  execute(args): ToolResult {
    const p = requireProject();
    p.recipes.push({ id: `r_${Math.random().toString(36).slice(2, 8)}`, name: String(args.name), inputs: args.inputs ?? {}, output: String(args.output), outputAmount: args?.outputAmount ?? 1 });
    store.markDirty();
    return { ok: true, summary: `Added recipe "${args.name}".`, changes: [`+ recipe "${args.name}"`] };
  },
});

defineTool({
  name: 'set_variable',
  description: 'Set a project variable (used by visual scripts).',
  params: { name: { type: 'string', required: true }, value: { type: 'any', required: true } },
  execute(args): ToolResult {
    const p = requireProject();
    p.variables[args.name] = args.value;
    store.markDirty();
    return { ok: true, summary: `Variable ${args.name} = ${JSON.stringify(args.value)}.`, changes: [`~ var ${args.name}`] };
  },
});

// ------------------------------- run / build --------------------------------

defineTool({
  name: 'run_game',
  description: 'Enter Play Mode.',
  params: {},
  execute(): ToolResult {
    editorCtx?.runGame();
    return { ok: true, summary: 'Play Mode started.' };
  },
});

defineTool({
  name: 'stop_game',
  description: 'Stop Play Mode.',
  params: {},
  execute(): ToolResult {
    editorCtx?.stopGame();
    return { ok: true, summary: 'Play Mode stopped.' };
  },
});

defineTool({
  name: 'run_test',
  description: 'Run an automated playtest for N seconds and report errors/assertions.',
  params: { seconds: { type: 'number', description: 'Duration (default 4)' } },
  execute(args): ToolResult {
    // async internally — return pending marker; agent awaits via ctx
    return { ok: true, summary: 'playtest:pending', details: { seconds: args?.seconds ?? 4 } };
  },
});

defineTool({
  name: 'build_project',
  description: 'Build the game (Development or Release).',
  params: { mode: { type: 'string', description: 'Development | Release' } },
  execute(args): ToolResult {
    return { ok: true, summary: 'build:pending', details: { mode: args?.mode ?? 'Release' } };
  },
});

defineTool({
  name: 'undo',
  description: 'Undo the last change batch.',
  params: {},
  execute(): ToolResult {
    const label = store.undo();
    return { ok: !!label, summary: label ? `Undid: ${label}` : 'Nothing to undo.' };
  },
});

/** Execute a tool by name (used by the planner, debugger and LLM loop). */
export function runTool(name: string, args: any = {}): ToolResult {
  const t = tools.get(name);
  if (!t) return { ok: false, summary: `Unknown tool: ${name}` };
  try {
    return t.execute(args ?? {});
  } catch (e: any) {
    return { ok: false, summary: `Tool error: ${e?.message ?? e}` };
  }
}

export function defaultScriptSource(className: string): string {
  return `// ${className} — NEXUS script
// Lifecycle: onStart, onUpdate(dt), onDestroy, onTriggerEnter(other), onInteract(player)
// @prop {number} speed = 1  How fast it moves
class ${className} extends Nexus.Component {
  onStart() {
    this.speed = this.props.speed ?? 1;
  }

  onUpdate(dt) {
    // example: bob up and down
    this.gameObject.holder.position.y += Math.sin(Nexus time) * 0;
  }
}
`;
}

/** Standard script header usable by the planner's script generation. */
export const SCRIPT_DOC = `
Available Nexus API:
- this.gameObject: { position, rotation, scale, setPosition(x,y,z), move(dx,dy,dz), rotateY(r), lookAt(x,y,z), destroy(), find(name), getComponent(type), tags }
- Nexus.find(name), Nexus.findByTag(tag), Nexus.spawn(prefabId, pos), Nexus.destroy(id)
- Nexus.on(event, fn), Nexus.emit(event, data)  — events: night, day, pickup, died, triggerEnter, interacted...
- Nexus.log(msg), Nexus.warn(msg), Nexus.error(msg)
- Nexus.save(key, value), Nexus.load(key)
- Nexus.Math: clamp, lerp, rad, deg
Lifecycle hooks: onStart, onUpdate(dt), onFixedUpdate(dt), onTriggerEnter(other), onTriggerExit(other), onCollisionEnter(other), onInteract(player), onDestroy
`;
