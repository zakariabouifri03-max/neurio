import { COMPONENT_TYPES, componentOf } from './engine.js';
import { validateProject } from './project.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const colorWords = [
  ['red', '#d66b64'], ['blue', '#5e91c4'], ['green', '#678d5a'], ['gold', '#d0a74f'], ['yellow', '#d2bf60'],
  ['white', '#e4e2d9'], ['black', '#22262b'], ['purple', '#8f78b9'], ['orange', '#d8894c'], ['pink', '#cb8297'],
];

export const TOOL_DEFINITIONS = [
  { name: 'create_game_object', description: 'Create a real scene object from a supported primitive or prefab.' },
  { name: 'delete_game_object', description: 'Delete an object from the active scene.', destructive: true },
  { name: 'modify_component', description: 'Add a component or update configured component properties.' },
  { name: 'create_script', description: 'Create a stored JavaScript asset for future script-runtime support.' },
  { name: 'modify_script', description: 'Update a stored JavaScript asset.' },
  { name: 'create_scene', description: 'Create a new active scene.' },
  { name: 'modify_scene', description: 'Modify active-scene background and fog settings.' },
  { name: 'create_material', description: 'Create a reusable PBR material asset.' },
  { name: 'assign_material', description: 'Assign a project material or explicit PBR values to an object.' },
  { name: 'create_prefab', description: 'Save the selected object hierarchy as a reusable prefab asset.' },
  { name: 'run_game', description: 'Start the actual game simulation.' },
  { name: 'stop_game', description: 'Stop play mode and restore the editor scene.' },
  { name: 'read_console', description: 'Read recent editor console messages.' },
  { name: 'read_errors', description: 'Run project validation and read current problems.' },
  { name: 'inspect_scene', description: 'Inspect scene hierarchy and component configuration.' },
  { name: 'inspect_asset', description: 'Inspect mesh, material, and file metadata for an object or imported asset.' },
  { name: 'run_tests', description: 'Run the editor project validation checks.' },
  { name: 'build_project', description: 'Build a self-contained portable HTML game.' },
];

function named(engine, name) {
  if (!name) return null;
  return engine.listObjects().find((object) => object.name.toLowerCase() === name.toLowerCase()) || null;
}

function findNamedOrSelected(context, name) {
  return named(context.engine, name) || (!name ? context.getSelected?.() : null);
}

function step(tool, args, label, details = '') {
  return { tool, args, label, details };
}

function missingComponentSteps(engine, object, entries) {
  const results = [];
  for (const [type, properties, label] of entries) {
    const existing = componentOf(object, type);
    const needs = !existing || Object.entries(properties || {}).some(([key, value]) => existing[key] !== value);
    if (needs) results.push(step('modify_component', { objectName: object.name, componentType: type, properties, ensure: true }, label || `${existing ? 'Configure' : 'Add'} ${COMPONENT_TYPES[type]?.label || type} on ${object.name}`));
  }
  return results;
}

export function planPrompt(prompt, context) {
  const input = String(prompt || '').trim();
  const normalized = input.toLowerCase();
  const engine = context.engine;
  const objects = engine.getSceneSummary();
  const player = engine.findPlayer();
  const selected = context.getSelected?.();
  const steps = [];
  const notes = [];
  let title = 'Inspect project';

  const spawnAtNightOnly = /spawn.{0,20}night|night.{0,20}spawn/.test(normalized);
  if (spawnAtNightOnly) {
    return {
id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
      prompt: input,
      title: 'Night-time spawning is not implemented',
      steps: [],
      notes: ['This runtime does not yet have a spawn scheduler or spawn-point component. I will not create a decorative spawner that does nothing. The Day / Night component is available, but time-gated spawning is a future feature.'],
      unsupported: true,
      createdAt: new Date().toISOString(),
    };
  }

  const asksNPC = /\b(shopkeeper|merchant|dialogue|villager|npc)\b/.test(normalized);
  const asksCombatNPC = /\b(zombie|enemy|stalker|guard|creature)\b/.test(normalized);
  if (asksNPC && !asksCombatNPC) {
    return {
      id: globalThis.crypto?.randomUUID?.() || String(Date.now()), prompt: input, title: 'Dialogue NPC generation is not implemented', steps: [],
      notes: ['This build has no dialogue authoring, NPC interaction runtime, or shop inventory system. I will not create a static character and claim it is a shopkeeper. Built-in chasing enemies and simple Interactable components are available.'],
      unsupported: true, createdAt: new Date().toISOString(),
    };
  }
  const asksPlayer = /\b(player|third.?person|first.?person|controller|character)\b/.test(normalized);
  const asksEnemy = asksCombatNPC;
  const asksDayNight = /\b(day.?night|day and night|sunset|time of day)\b/.test(normalized);
  const asksResource = /\b(wood|stone|berry|berries|pickup|resource|gather)\b/.test(normalized);
  const asksTree = /\b(tree|trees|forest|palm|foliage)\b/.test(normalized);
  const asksHealth = /\b(health|damage|hurt|hp)\b/.test(normalized);
  const asksStamina = /\b(stamina|sprint)\b/.test(normalized);
  const asksInventory = /\b(inventory|craft|crafting)\b/.test(normalized);
  const asksBuild = /\b(build|export|package)\b/.test(normalized);
  const asksPlay = /\b(play|run|test|simulate)\b/.test(normalized);
  const asksDelete = /\b(delete|remove|destroy)\b/.test(normalized);
  const asksDuplicate = /\b(duplicate|copy|clone)\b/.test(normalized);
  const asksInspect = /\b(inspect|what is|show me|analy[sz]e|analyze)\b/.test(normalized);
  const asksScene = /\b(new scene|create scene|empty scene)\b/.test(normalized);
  const color = colorWords.find(([word]) => normalized.includes(word));
  const hexMatch = input.match(/#[\da-f]{6}\b/i);

  if (asksDelete) {
    const target = selected;
    if (!target) notes.push('Select an object first. Nothing will be deleted.');
    else steps.push(step('delete_game_object', { objectName: target.name }, `Delete ${target.name}`, 'Destructive scene change'));
    title = target ? 'Delete selected object' : 'Choose an object to delete';
  } else if (asksDuplicate) {
    const target = selected;
    if (target) steps.push(step('create_game_object', { sourceName: target.name, type: '__duplicate__' }, `Duplicate ${target.name}`));
    else notes.push('Select an object to duplicate.');
    title = 'Duplicate scene object';
  }

  if (asksScene) {
    const sceneName = input.match(/(?:scene)\s+(?:called|named)\s+([\w -]+)/i)?.[1]?.trim() || 'New Scene';
    steps.push(step('create_scene', { name: sceneName }, `Create scene “${sceneName}”`));
    title = 'Create a scene';
  }

  if (asksPlayer) {
    if (player) {
      steps.push(...missingComponentSteps(engine, player, [
        ['CharacterController', {}, 'Verify Player movement and jump settings'],
        ['Health', {}, 'Verify Player health component'],
        ['Stamina', {}, 'Verify Player stamina component'],
        ['CameraFollow', {}, 'Configure follow-camera component'],
      ]));
    } else {
      steps.push(step('create_game_object', { type: 'Player', name: 'Player', position: [0, 0, 4] }, 'Create Player with movement, health, stamina and follow-camera components'));
    }
    title = 'Set up a third-person player';
  }

  if (asksEnemy) {
    const enemy = engine.findByKind('Enemy').find((object) => object.visible);
    if (enemy && /\b(add|create|spawn|new)\b/.test(normalized)) {
      const enemyName = /zombie/.test(normalized) ? 'Zombie' : /guard/.test(normalized) ? 'Village Guard' : 'Island Stalker';
      steps.push(step('create_game_object', { type: 'Enemy', name: enemyName, position: [6, 0, -6] }, `Create ${enemyName} with health and chase AI`));
    } else if (enemy) {
      steps.push(...missingComponentSteps(engine, enemy, [['AIController', { state: 'Chase' }, `Configure ${enemy.name} chase AI`], ['Health', {}, `Verify ${enemy.name} health`]]));
    } else {
      const enemyName = /zombie/.test(normalized) ? 'Zombie' : /guard/.test(normalized) ? 'Village Guard' : 'Island Stalker';
      steps.push(step('create_game_object', { type: 'Enemy', name: enemyName, position: [6, 0, -6] }, `Create ${enemyName} with health and chase AI`));
    }
    title = 'Create or configure an enemy';
  }

  if (asksDayNight) {
    const sun = engine.findDirectionalLight();
    if (sun) {
      if (!componentOf(sun, 'DayNight')) steps.push(step('modify_component', { objectName: sun.name, componentType: 'DayNight', ensure: true, properties: { cycleDuration: 180, startHour: 8 } }, 'Add a working day / night cycle to Sun Light'));
      else notes.push('Sun Light already has a day / night cycle component.');
    } else notes.push('Add a Directional Light before enabling a day / night cycle.');
    title = 'Enable day and night';
  }

  if (asksResource) {
    if (/\bwood\b/.test(normalized)) steps.push(step('create_game_object', { type: 'Wood Pickup', name: 'Wood Cache', position: [2, 0, 2] }, 'Add a gatherable wood cache'));
    if (/\bstone\b/.test(normalized)) steps.push(step('create_game_object', { type: 'Stone Pickup', name: 'Stone Cache', position: [-2, 0, 2] }, 'Add a gatherable stone cache'));
    if (/\b(berry|berries)\b/.test(normalized)) steps.push(step('create_game_object', { type: 'Berry Pickup', name: 'Berry Cache', position: [0, 0, -2] }, 'Add a gatherable berry cache'));
    if (!/\bwood\b|\bstone\b|\b(berry|berries)\b/.test(normalized)) {
      steps.push(step('create_game_object', { type: 'Wood Pickup', name: 'Wood Cache', position: [2, 0, 2] }, 'Add gatherable wood'));
      steps.push(step('create_game_object', { type: 'Stone Pickup', name: 'Stone Cache', position: [-2, 0, 2] }, 'Add gatherable stone'));
    }
    title = 'Add playable resources';
  }

  if (asksTree) {
    const count = Math.max(1, Math.min(8, Number(input.match(/\b(\d+)\b/)?.[1] || (/trees|forest/.test(normalized) ? 3 : 1))));
    const type = /palm/.test(normalized) ? 'Palm' : 'Tree';
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2;
      const radius = 8 + index % 2 * 3;
      steps.push(step('create_game_object', { type, name: `${type} ${index + 1}`, position: [Number((Math.cos(angle) * radius).toFixed(2)), 0, Number((Math.sin(angle) * radius).toFixed(2))] }, `Place ${type.toLowerCase()} ${index + 1}`));
    }
    title = count > 1 ? `Create ${count} trees` : `Create a ${type.toLowerCase()}`;
  }

  if (asksPlayer && asksHealth && player) {
    steps.push(...missingComponentSteps(engine, player, [['Health', {}, 'Configure Player health']]))
  }
  if (asksPlayer && asksStamina && player) {
    steps.push(...missingComponentSteps(engine, player, [['Stamina', {}, 'Configure Player stamina']]))
  }
  if (asksPlayer && asksInventory && player) {
    steps.push(...missingComponentSteps(engine, player, [['Inventory', {}, 'Configure Player inventory']]))
  }
  if (asksHealth && !asksEnemy && !asksPlayer && selected) {
    steps.push(step('modify_component', { objectName: selected.name, componentType: 'Health', ensure: true, properties: { maxHealth: 100, currentHealth: 100 } }, `Add Health to ${selected.name}`));
    title = 'Add a Health component';
  }

  if (color || hexMatch) {
    const target = selected;
    if (target) {
      const selectedColor = hexMatch?.[0] || color[1];
      steps.push(step('assign_material', { objectName: target.name, color: selectedColor }, `Set ${target.name} base color to ${selectedColor}`));
      title = 'Update selected material';
    } else notes.push('Select a mesh or object before asking for a material color change.');
  }

  const speedMatch = input.match(/(?:speed|move speed|movement speed)\D{0,18}(\d+(?:\.\d+)?)/i);
  if (speedMatch && player) {
    steps.push(step('modify_component', { objectName: player.name, componentType: 'CharacterController', ensure: true, properties: { moveSpeed: Math.max(1, Math.min(18, Number(speedMatch[1]))) } }, `Set Player move speed to ${speedMatch[1]}`));
    title = 'Adjust player movement';
  }

  if (asksBuild) {
    steps.push(step('build_project', {}, 'Validate and build a portable HTML game'));
    title = 'Build playable game';
  } else if (asksPlay) {
    steps.push(step('run_game', {}, 'Start the real Play Mode simulation'));
    title = 'Run the project';
  }

  if (/\b(test|validate|check errors|debug|fix|jump)\b/.test(normalized)) {
    steps.push(step('run_tests', {}, 'Validate transforms, meshes and lighting'));
    if (player && /jump/.test(normalized)) steps.push(step('modify_component', { objectName: player.name, componentType: 'CharacterController', ensure: true, properties: { jumpHeight: 2.2, gravity: 18 } }, 'Verify jump and gravity configuration'));
    title = /jump/.test(normalized) ? 'Diagnose player jump setup' : 'Run project validation';
  }

  if (asksInspect || !steps.length) {
    const noMappedAction = !steps.length;
    steps.push(step('inspect_scene', {}, `Inspect ${objects.length} scene objects and their components`));
    if (selected) steps.push(step('inspect_asset', { objectName: selected.name }, `Inspect selected asset: ${selected.name}`));
    title = asksInspect ? 'Inspect active project' : noMappedAction && asksPlayer && player ? 'Player already configured' : 'Review project context';
    if (noMappedAction && asksPlayer && player) notes.push(`The active scene already contains ${player.name} with its movement, health, stamina, inventory and follow-camera components. No duplicate player was created.`);
    else if (noMappedAction && !asksInspect) notes.push('I could not map that request to a supported scene action. Try “create a player”, “add a tree”, “add a zombie”, “add wood”, or “build game”. I can still inspect the current scene.');
  }

  const unique = new Map();
  for (const item of steps) unique.set(`${item.tool}:${JSON.stringify(item.args)}`, item);
  const finalSteps = [...unique.values()];
  const unsupported = !finalSteps.length;
  const destructive = finalSteps.some((item) => TOOL_DEFINITIONS.find((tool) => tool.name === item.tool)?.destructive);
  if (!finalSteps.length && !notes.length) notes.push('No supported changes were identified. Describe a scene object, component, validation, or build action.');
  if (finalSteps.length && asksPlayer && engine.scene.userData?.nexusTemplate !== 'Island Survival') notes.push('The local planner can configure built-in components. It does not generate or execute arbitrary code.');
  return {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()), prompt: input, title, steps: finalSteps, notes, destructive, unsupported,
    impact: `${finalSteps.length} structured tool call${finalSteps.length === 1 ? '' : 's'} · active scene only`,
    createdAt: new Date().toISOString(),
  };
}

function makeScriptContent(name) {
  return `// ${name} — stored project script asset\n// Runtime script execution is not enabled in NEXUS 0.1.\n// Components and the visual Gameplay Graph are executable in Play Mode.\n\nexport function onStart(context) {\n  // Add a supported gameplay component or graph action in the editor.\n}\n`;
}

export async function executeTool(toolName, args, context) {
  const { engine, project } = context;
  switch (toolName) {
    case 'create_game_object': {
      if (args.type === '__duplicate__') {
        const source = named(engine, args.sourceName);
        if (!source) throw new Error(`Object “${args.sourceName}” no longer exists.`);
        const duplicate = engine.duplicateObject(source);
        return `Duplicated ${source.name} as ${duplicate.name}.`;
      }
      const allowed = ['Cube', 'Sphere', 'Cylinder', 'Capsule', 'Plane', 'Tree', 'Palm', 'Rock', 'Wood Pickup', 'Stone Pickup', 'Berry Pickup', 'Enemy', 'Player', 'Cabin', 'Point Light', 'Directional Light', 'Camera'];
      if (!allowed.includes(args.type)) throw new Error(`Unsupported object type: ${args.type}`);
      const object = engine.createObject(args.type, { name: args.name, position: args.position, color: args.color });
      return `Created ${object.name} (${args.type}) with ${object.userData?.nexus?.components?.length || 0} configured component(s).`;
    }
    case 'delete_game_object': {
      const object = named(engine, args.objectName) || context.getSelected?.();
      if (!object) throw new Error(`Object “${args.objectName || ''}” was not found.`);
      engine.deleteObject(object);
      return `Deleted ${object.name} from the active scene.`;
    }
    case 'modify_component': {
      const object = findNamedOrSelected(context, args.objectName);
      if (!object) throw new Error(`Object “${args.objectName || ''}” was not found.`);
      const component = componentOf(object, args.componentType) || (args.ensure ? engine.addComponent(object, args.componentType) : null);
      if (!component) throw new Error(`${object.name} does not have ${args.componentType}.`);
      for (const [key, value] of Object.entries(args.properties || {})) {
        if (key.startsWith('_') || typeof value === 'object' && value !== null) continue;
        engine.updateComponent(object, args.componentType, key, value);
      }
      return `${component.type} on ${object.name} is configured.`;
    }
    case 'create_script': {
      const name = (args.name || 'NewBehaviour').replace(/[^\w -]/g, '').trim() || 'NewBehaviour';
      const asset = { id: `script-${Date.now()}`, name: name.endsWith('.js') ? name : `${name}.js`, code: args.code || makeScriptContent(name), enabled: false, createdAt: new Date().toISOString(), note: 'Stored only: arbitrary script execution is not enabled in this build.' };
      project.scripts ||= []; project.scripts.push(asset);
      return `Created ${asset.name} as a stored project asset. It is not executed by Play Mode.`;
    }
    case 'modify_script': {
      const script = project.scripts?.find((asset) => asset.name === args.name || asset.id === args.name);
      if (!script) throw new Error(`Script asset “${args.name}” was not found.`);
      script.code = String(args.code ?? script.code);
      script.updatedAt = new Date().toISOString();
      return `Updated stored script ${script.name}. It is not hot-loaded or executed by this runtime.`;
    }
    case 'create_scene': {
      await context.createScene(args.name || 'New Scene');
      return `Created and opened scene “${args.name || 'New Scene'}”.`;
    }
    case 'modify_scene': {
      const color = args.background;
      if (color) engine.scene.background?.set(color);
      if (args.fogColor && engine.scene.fog) engine.scene.fog.color.set(args.fogColor);
      if (Number.isFinite(args.fogNear) && engine.scene.fog) engine.scene.fog.near = Math.max(0, args.fogNear);
      if (Number.isFinite(args.fogFar) && engine.scene.fog) engine.scene.fog.far = Math.max(engine.scene.fog.near + 0.1, args.fogFar);
      return 'Updated active-scene environment settings.';
    }
    case 'create_material': {
      project.materials ||= [];
      const material = { id: `material-${Date.now()}`, name: args.name || 'New Material', baseColor: args.color || '#b8c992', metallic: Math.max(0, Math.min(1, Number(args.metallic) || 0)), roughness: Math.max(0, Math.min(1, Number(args.roughness ?? 0.75))) };
      project.materials.push(material);
      return `Created PBR material “${material.name}”.`;
    }
    case 'assign_material': {
      const object = findNamedOrSelected(context, args.objectName);
      if (!object) throw new Error(`Select an object before assigning a material.`);
      const material = project.materials?.find((entry) => entry.name.toLowerCase() === String(args.materialName || '').toLowerCase());
      if (material) engine.assignMaterial?.(object, material);
      else if (args.color) engine.setObjectColor(object, args.color);
      if (Number.isFinite(args.roughness)) engine.updateComponent(object, 'MeshRenderer', 'roughness', args.roughness);
      if (Number.isFinite(args.metallic)) engine.updateComponent(object, 'MeshRenderer', 'metallic', args.metallic);
      return `Updated ${object.name} material${material ? ` to “${material.name}”` : ''}.`;
    }
    case 'create_prefab': {
      const object = findNamedOrSelected(context, args.objectName);
      if (!object) throw new Error('Select an object hierarchy to save as a prefab.');
      project.prefabs ||= [];
      project.prefabs.push({ id: `prefab-${Date.now()}`, name: args.name || object.name, object: object.toJSON(), createdAt: new Date().toISOString() });
      return `Saved “${args.name || object.name}” as a reusable prefab asset.`;
    }
    case 'run_game': engine.startPlay(); return 'Started Play Mode simulation.';
    case 'stop_game': engine.stopPlay(); return 'Stopped Play Mode and restored the saved editor scene.';
    case 'read_console': return context.readConsole?.(args.limit || 10) || 'Console is empty.';
    case 'read_errors': {
      const problems = validateProject(project, engine);
      return problems.length ? problems.map((problem) => `${problem.severity.toUpperCase()}: ${problem.message} [${problem.target}]`).join('\n') : 'No validation errors or warnings.';
    }
    case 'inspect_scene': {
      const rows = engine.getSceneSummary();
      return rows.length ? rows.map((object) => `• ${object.name} — ${object.kind}${object.components.length ? ` · ${object.components.join(', ')}` : ''}`).join('\n') : 'The active scene is empty.';
    }
    case 'inspect_asset': {
      const object = findNamedOrSelected(context, args.objectName);
      if (!object) throw new Error(`Object “${args.objectName || ''}” was not found.`);
      let meshes = 0, vertices = 0, triangles = 0, materialNames = new Set();
      object.traverse((child) => {
        if (!child.isMesh) return;
        meshes++; vertices += child.geometry?.getAttribute('position')?.count || 0; triangles += child.geometry?.index ? child.geometry.index.count / 3 : (child.geometry?.getAttribute('position')?.count || 0) / 3;
        const list = Array.isArray(child.material) ? child.material : [child.material]; list.forEach((material) => material?.name && materialNames.add(material.name));
      });
      const box = object.isObject3D ? object : null;
      return `${object.name}: ${object.userData?.nexus?.kind || object.type}; ${meshes} mesh(es), ${vertices} vertices, ${Math.floor(triangles)} triangles; components: ${object.userData?.nexus?.components?.map((component) => component.type).join(', ') || 'none'}; materials: ${[...materialNames].join(', ') || 'built-in/unnamed'}.`;
    }
    case 'run_tests': {
      const problems = validateProject(project, engine);
      context.setProblems?.(problems);
      if (!problems.length) return 'PASS: scene has objects, finite transforms, mesh position data, and at least one light.';
      return problems.map((problem) => `${problem.severity.toUpperCase()}: ${problem.message} [${problem.target}]`).join('\n');
    }
    case 'build_project': return await context.buildProject();
    default: throw new Error(`Unknown structured tool: ${toolName}`);
  }
}

export async function applyPlan(plan, context) {
  if (!plan || plan.unsupported || !plan.steps.length) throw new Error('This plan does not contain any executable tool calls.');
  const results = [];
  for (const item of plan.steps) {
    const result = await executeTool(item.tool, clone(item.args), context);
    results.push({ tool: item.tool, label: item.label, result });
    context.onToolResult?.(results.at(-1));
    const readOnlyTools = new Set(['run_game', 'stop_game', 'read_console', 'read_errors', 'inspect_scene', 'inspect_asset', 'run_tests', 'build_project']);
    if (!readOnlyTools.has(item.tool)) context.markDirty?.();
  }
  return results;
}
