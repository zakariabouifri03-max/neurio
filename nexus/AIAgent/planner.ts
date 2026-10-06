// ============================================================================
// NEXUS AI AGENT — Offline planner
// Deterministic intent engine that maps natural-language requests to real
// tool executions. Handles the core authoring commands (players, enemies,
// spawners, worlds, UI, gameplay) and generates full game plans for
// "Create With AI". When an LLM is connected, the agent uses that instead for
// open-ended requests — but everything still executes through the same tools.
// ============================================================================

import { store } from '../Editor/store';
import { getTool, type ToolResult } from './tools';
import { findObject } from '../Engine/core/types';
import { uid } from '../Engine/core/types';

export interface PlanStep {
  id: string;
  label: string;
  section?: string;
  run: (ctx: PlanContext) => Promise<ToolResult>;
  /** Skip silently when condition is false (e.g. already exists). */
  when?: (ctx: PlanContext) => boolean;
}

export interface Plan {
  title: string;
  intro: string;
  steps: PlanStep[];
  /** Plan-level safety review before execution. */
  review?: string[];
}

export interface PlanContext {
  results: Record<string, any>;
  vars: Record<string, any>;
}

export type ToolRunner = (tool: string, args?: any) => ToolResult;
let runTool: ToolRunner = (t, a) => getTool(t)!.execute(a);
export function setToolRunner(fn: ToolRunner) { runTool = fn; }

const has = (text: string, ...words: string[]) => words.some(w => text.includes(w));
const lower = (s: string) => s.toLowerCase();

function findAssetByName(name: string, type?: string) {
  return store.project?.assets.find(a =>
    (!type || a.type === type) && a.name.toLowerCase().includes(name.toLowerCase()),
  ) ?? null;
}
function findObjectsByNames(...names: string[]) {
  const scene = store.scene;
  if (!scene) return [];
  const ln = names.map(lower);
  return scene.objects.filter(o => ln.some(n => lower(o.name).includes(n)));
}

// ============================================================================
// Recipe: player controllers
// ============================================================================

function playerSteps(text: string): PlanStep[] {
  const t = lower(text);
  let kind: 'third' | 'first' | 'top' = 'third';
  if (has(t, 'first person', 'fps')) kind = 'first';
  else if (has(t, 'top down', 'top-down', 'topdown', 'isometric')) kind = 'top';
  const controller = kind === 'first' ? 'FirstPersonController' : kind === 'top' ? 'TopDownController' : 'ThirdPersonController';
  const survival = has(t, 'survival', 'stamina', 'hunger');
  const withWeapon = has(t, 'weapon', 'sword', 'attack', 'combat', 'fight', 'shooter');

  const steps: PlanStep[] = [
    {
      id: 'player', label: `Create ${kind === 'third' ? 'third-person' : kind === 'first' ? 'first-person' : 'top-down'} player object`, section: 'Player',
      run: async () => runTool('create_game_object', {
        name: 'Player',
        position: '0,2,0',
        tags: ['player'],
        components: [
          controller,
          { type: 'CharacterBody' },
          { type: 'Collider', shape: 'capsule', radius: 0.42, size: { x: 0.9, y: 1.75, z: 0.9 }, center: { x: 0, y: 0.12, z: 0 } },
          { type: 'RigidBody', mass: 72, lockRotation: true, linearDamping: 0.02, angularDamping: 0.9 },
          { type: 'Health', maxHealth: 100, startHealth: 100, regenPerSecond: survival ? 0 : 1.5, regenDelay: 5 },
          { type: 'Inventory', capacity: 200 },
          ...(survival ? [{ type: 'SaveSystem', saveKey: 'player_save', autosaveSeconds: 60 }] : []),
          ...(withWeapon ? [{ type: 'Weapon', damage: 18, range: 2.4, cooldown: 0.65, affectsTag: 'enemy' }] : []),
        ],
      }),
    },
    {
      id: 'player-anim', label: 'Wire animation hooks (locomotion states)', section: 'Player',
      when: () => !!store.project?.assets.find(a => a.type === 'model' && (a.meta?.humanoid || a.name.match(/soldier|character|player|zombie|kaykit|hero/i))),
      run: async (ctx) => {
        const model = store.project!.assets.find(a => a.type === 'model' && (a.meta?.humanoid || a.name.match(/soldier|character|player|kaykit|hero/i)));
        if (!model) return { ok: true, summary: 'skipped (no humanoid model)' };
        ctx.vars.playerModel = model.id;
        const player = findObjectsByNames('player')[0];
        if (!player) return { ok: false, summary: 'player not found' };
        const mr = player.components.find(c => c.type === 'MeshRenderer') ?? undefined;
        return runTool('add_component', { object: 'Player', component: 'Animator', props: { states: [
          { name: 'Idle', clip: 'idle', loop: true, speed: 1 }, { name: 'Walk', clip: 'walk', loop: true, speed: 1 },
          { name: 'Run', clip: 'run', loop: true, speed: 1 }, { name: 'Jump', clip: 'jump', loop: false },
        ] } });
      },
    },
  ];
  return steps;
}

// ============================================================================
// Recipe: enemies & NPCs
// ============================================================================

function npcSteps(text: string): PlanStep[] {
  const t = lower(text);
  const isZombie = has(t, 'zombie', 'undead');
  const isGuard = has(t, 'guard', 'patrol');
  const isShopkeeper = has(t, 'shopkeeper', 'shop', 'merchant', 'vendor', 'trader');
  const isWildlife = has(t, 'wildlife', 'animal', 'deer', 'wolf', 'rabbit');
  const isSoldier = has(t, 'soldier', 'robot', 'turret');
  const name = isZombie ? 'Zombie' : isShopkeeper ? 'Shopkeeper' : isWildlife ? 'Wildlife' : isSoldier ? 'Soldier' : isGuard ? 'Guard' : 'Enemy';
  const role = isShopkeeper ? 'vendor' : isGuard ? 'guard' : isWildlife ? 'neutral' : 'enemy';
  const preset = isZombie ? 'zombie' : isShopkeeper ? 'shopkeeper' : isWildlife ? 'wildlife' : isGuard ? 'guard' : 'soldier';

  const baseProps: any = { role, preset, initialState: isShopkeeper ? 'idle' : 'patrol', maxHealth: isZombie ? 55 : 70, detectionRange: isZombie ? 13 : 16, moveSpeed: isZombie ? 2.1 : 2.6, chaseSpeed: isZombie ? 4.2 : 5.4, attackDamage: isZombie ? 11 : 15 };
  if (isZombie) Object.assign(baseProps, { attackCooldown: 1.6, nightOnly: has(t, 'night') });
  if (isWildlife) Object.assign(baseProps, { fleeBelowHealthPct: 0.4, role: 'neutral' });

  return [
    {
      id: 'npc', label: `Create ${name.toLowerCase()} NPC with AI states (idle/patrol/chase/attack/death)`, section: 'AI',
      run: async (ctx) => {
        // patrol around village if mentioned
        let patrol: any[] | undefined;
        const village = findObjectsByNames('village', 'camp', 'town')[0];
        if (village) {
          patrol = [1, 2, 3].map(i => ({ x: village.transform.position.x + Math.cos(i * 2.1) * 12, y: village.transform.position.y + 0.2, z: village.transform.position.z + Math.sin(i * 2.1) * 12 }));
        }
        const r = runTool('create_game_object', {
          name,
          position: village ? `${village.transform.position.x + 6},1,${village.transform.position.z + 6}` : '4,1,4',
          tags: [role === 'enemy' ? 'enemy' : 'npc'],
          components: [
            { type: 'NPC', ...baseProps, ...(patrol ? { patrolPoints: patrol } : {}), loot: isZombie ? 'rotten_flesh' : null },
            { type: 'CharacterBody', bodyColor: isZombie ? '#4a5d3a' : '#5b6b8c', skinColor: isZombie ? '#7d9070' : '#c9a17e' },
            { type: 'Collider', shape: 'capsule', radius: 0.4, size: { x: 0.8, y: 1.7, z: 0.8 }, center: { x: 0, y: 0.1, z: 0 } },
            { type: 'RigidBody', mass: 68, lockRotation: true, linearDamping: 0.05, angularDamping: 0.9 },
            ...(isShopkeeper ? [{ type: 'Interactable', prompt: 'Talk', range: 3, action: 'custom', dialogue: ['Welcome, traveler!', 'Best goods on the island.'] }] : []),
          ],
        });
        if (r.ok) ctx.vars.npcName = name;
        return r;
      },
    },
    {
      id: 'npc-prefab', label: `Save ${name} as a prefab (reusable by spawners)`, section: 'AI',
      run: async (ctx) => {
        const r = runTool('create_prefab', { object: ctx.vars.npcName ?? name, name: `${name}Prefab` });
        if (r.ok) ctx.vars.npcPrefab = r.details?.id;
        return r;
      },
    },
  ];
}

// ============================================================================
// Recipe: night spawners / day-night
// ============================================================================

function nightSpawnSteps(text: string): PlanStep[] {
  const t = lower(text);
  return [
    {
      id: 'daynight', label: 'Ensure a day/night cycle exists', section: 'World',
      when: () => !findObjectsByNames('day night', 'daynight', 'sun cycle').length,
      run: async () => runTool('create_game_object', { name: 'DayNightCycle', components: [{ type: 'DayNightCycle', dayLengthMinutes: 4, startTime: 9 }] }),
    },
    {
      id: 'spawner', label: 'Create a night-time spawner for the enemy', section: 'AI',
      when: (ctx) => !ctx.vars.existingSpawner,
      run: async (ctx) => {
        // find an existing zombie/enemy prefab or NPC object
        const prefab = ctx.vars.npcPrefab
          ?? findAssetByName('zombie', 'prefab')?.id ?? findAssetByName('enemy', 'prefab')?.id;
        const npcObj = findObjectsByNames('zombie', 'enemy', 'soldier')[0];
        let prefabId = prefab;
        if (!prefabId && npcObj) {
          const r = runTool('create_prefab', { object: npcObj.id, name: `${npcObj.name}Prefab` });
          prefabId = r.details?.id;
        }
        if (!prefabId) return { ok: false, summary: 'No enemy exists yet — create one first (e.g. "Add a zombie enemy").' };
        const village = findObjectsByNames('village', 'camp')[0];
        return runTool('create_game_object', {
          name: 'NightSpawner',
          position: village ? `${village.transform.position.x + 14},0.5,${village.transform.position.z + 14}` : '18,0.5,18',
          components: [{ type: 'Spawner', prefab: prefabId, mode: 'night', interval: 14, maxAlive: 4, spawnRadius: 10 }],
        });
      },
    },
    {
      id: 'spawner-mode', label: 'Set existing spawners to night mode', section: 'AI',
      when: (ctx) => !!ctx.vars.existingSpawner,
      run: async (ctx) => runTool('modify_component', { object: ctx.vars.existingSpawner, component: 'Spawner', property: 'mode', value: 'night' }),
    },
  ];
}

// ============================================================================
// Recipe: world / island / environment
// ============================================================================

function worldSteps(text: string): PlanStep[] {
  const t = lower(text);
  const island = has(t, 'island', 'beach', 'ocean', 'sea');
  const forest = has(t, 'forest', 'tree', 'jungle', 'wood');
  const rocks = has(t, 'rock', 'stone', 'boulder');
  const village = has(t, 'village', 'camp', 'town', 'house', 'hut');
  const night = has(t, 'night', 'dark');
  const resources = has(t, 'resource', 'collect', 'gather', 'wood', 'stone', 'berry');
  const size = has(t, 'large', 'big', 'huge') ? 320 : 220;

  const steps: PlanStep[] = [];
  steps.push({
    id: 'terrain', label: island ? `Generate island terrain (${size}m)` : 'Create terrain', section: 'World',
    when: () => !findObjectsByNames('terrain').length,
    run: async () => runTool('create_game_object', {
      name: 'Terrain',
      components: [{ type: 'Terrain', size, segments: 112, collider: true }],
    }),
  });
  if (island) steps.push({
    id: 'island', label: 'Sculpt island (beaches, hills, auto sand/grass/rock splat)', section: 'World',
    run: async () => runTool('generate_terrain', { object: 'Terrain', style: 'island', maxHeight: has(t, 'mountain', 'hilly') ? 26 : 18 }),
  });
  if (island) steps.push({
    id: 'water', label: 'Add ocean water plane', section: 'World',
    when: () => !findObjectsByNames('water', 'ocean', 'sea').length,
    run: async () => runTool('create_game_object', { name: 'Ocean', position: '0,0.4,0', components: [{ type: 'Water', size: 1600, color: '#2a6f8e', opacity: 0.78 }] }),
  });
  if (forest) steps.push({
    id: 'trees', label: 'Scatter trees (forest area + colliders)', section: 'World',
    run: async () => scatterStep('Tree', 46, 'forest', '#2e5d33', '4,0,0', true),
  });
  if (rocks || resources) steps.push({
    id: 'rocks', label: 'Scatter rocks (stone collectibles)', section: 'World',
    run: async () => scatterStep('Rock', 24, 'rock', '#6f6f6f', '-14,0,10', true),
  });
  if (village) steps.push({
    id: 'village', label: 'Build a small village (huts, campfire, lanterns)', section: 'World',
    run: async (ctx) => {
      const r1 = runTool('create_game_object', { name: 'Village', position: '2,0,2' });
      ctx.vars.villageName = 'Village';
      return r1;
    },
  });
  if (village) steps.push({
    id: 'village-huts', label: 'Add 3 huts with colliders', section: 'World',
    run: async () => {
      const hut = (i: number, x: number, z: number, rot: number) => runTool('create_game_object', {
        name: `Hut${i}`, position: `${x},0.2,${z}`, parent: 'Village',
        components: [
          { type: 'MeshRenderer', mesh: 'Cube', castShadows: true },
          { type: 'Collider', shape: 'box', size: { x: 4, y: 3, z: 4 } },
        ],
      });
      hut(1, -7, -5, 0); hut(2, 6, -7, 0); hut(3, 0, 8, 0);
      return { ok: true, summary: 'Built 3 huts around the village center.' };
    },
  });
  if (village) steps.push({
    id: 'campfire', label: 'Add campfire (light + rest point)', section: 'World',
    run: async () => runTool('create_game_object', {
      name: 'Campfire', position: '2,0.4,2', parent: 'Village',
      components: [
        { type: 'Light', lightType: 'point', color: '#ff9a3c', intensity: 2.6, range: 16 },
        { type: 'Interactable', prompt: 'Rest at campfire', range: 3, action: 'rest' },
      ],
    }),
  });
  if (resources) steps.push({
    id: 'resources', label: 'Place collectible resources (wood piles & berry bushes)', section: 'Gameplay',
    run: async () => {
      const items = [['WoodPile', 'wood', '#7a5a3a', 16], ['BerryBush', 'berries', '#8a2f4f', 12]] as const;
      for (const [name, item, color, count] of items) {
        for (let i = 0; i < Math.min(count, 8); i++) {
          const a = (i / 8) * Math.PI * 2 + Math.random();
          const r = 18 + Math.random() * 40;
          runTool('create_game_object', {
            name, position: `${(Math.cos(a) * r).toFixed(1)},0.4,${(Math.sin(a) * r).toFixed(1)}`,
            components: [
              { type: 'MeshRenderer', mesh: 'Sphere' },
              { type: 'Collider', shape: 'sphere', radius: 0.7, isTrigger: true },
              { type: 'Pickup', item, amount: 2, bob: true, spin: true },
            ],
          });
        }
      }
      return { ok: true, summary: 'Placed wood piles and berry bushes as pickups.' };
    },
  });
  steps.push({
    id: 'lighting', label: 'Set up lighting (sun + ambient + fog)', section: 'World',
    when: () => !findObjectsByNames('sun', 'daynight').length,
    run: async () => {
      runTool('modify_scene', { property: 'sunIntensity', value: 2.3 });
      runTool('modify_scene', { property: 'ambientIntensity', value: 0.55 });
      return { ok: true, summary: 'Tuned sun & ambient lighting.' };
    },
  });
  if (night) steps.push({
    id: 'daynight', label: 'Add day/night cycle', section: 'World',
    when: () => !findObjectsByNames('daynight').length,
    run: async () => runTool('create_game_object', { name: 'DayNightCycle', components: [{ type: 'DayNightCycle', dayLengthMinutes: 3.5, startTime: 16 }] }),
  });
  return steps;
}

/** Helper: scatter simple prop objects in a ring. */
function scatterStep(name: string, count: number, _tag: string, color: string, center: string, colliders: boolean): ToolResult {
  const n = Math.min(count, 14); // keep scenes light; templates can add more via Foliage
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = 22 + Math.random() * 55;
    const scale = 0.7 + Math.random() * 0.9;
    runTool('create_game_object', {
      name, position: `${(Math.cos(a) * r).toFixed(1)},0,${(Math.sin(a) * r).toFixed(1)}`,
      components: [
        { type: 'MeshRenderer', mesh: name.toLowerCase().includes('tree') ? 'Cylinder' : 'Sphere' },
        ...(colliders ? [{ type: 'Collider', shape: 'box', size: { x: 1 * scale, y: 2, z: 1 * scale } }] : []),
      ],
    });
  }
  return { ok: true, summary: `Scattered ${n} ${name} props.` };
}

// ============================================================================
// Recipe: UI / HUD
// ============================================================================

function uiSteps(text: string): PlanStep[] {
  const t = lower(text);
  const steps: PlanStep[] = [];
  if (has(t, 'hud', 'health bar', 'healthbar', 'stamina')) steps.push({ id: 'ui-hud', label: 'Create HUD (health & stamina bars, clock)', section: 'UI', run: async () => runTool('create_ui', { template: 'HUD' }) });
  if (has(t, 'crosshair')) steps.push({ id: 'ui-cross', label: 'Create crosshair', section: 'UI', run: async () => runTool('create_ui', { template: 'Crosshair' }) });
  if (has(t, 'inventory')) steps.push({ id: 'ui-inv', label: 'Create inventory screen', section: 'UI', run: async () => runTool('create_ui', { template: 'Inventory' }) });
  if (has(t, 'menu')) steps.push({ id: 'ui-menu', label: 'Create main & pause menus + win/lose screens', section: 'UI', run: async () => { runTool('create_ui', { template: 'MainMenu' }); runTool('create_ui', { template: 'PauseMenu' }); return runTool('create_ui', { template: 'EndScreens' }); } });
  if (has(t, 'craft')) steps.push({ id: 'ui-craft', label: 'Create crafting screen', section: 'UI', run: async () => runTool('create_ui', { template: 'Crafting' }) });
  return steps;
}

// ============================================================================
// Recipe: gameplay items (weapons, projectiles, doors, checkpoints)
// ============================================================================

function gameplaySteps(text: string): PlanStep[] {
  const t = lower(text);
  const steps: PlanStep[] = [];
  if (has(t, 'bow', 'gun', 'rifle', 'shoot', 'projectile')) steps.push({
    id: 'proj', label: 'Create projectile prefab (damage carrier)', section: 'Gameplay',
    run: async (ctx) => {
      const r = runTool('create_game_object', {
        name: 'Projectile', position: '0,-5,0',
        components: [
          { type: 'MeshRenderer', mesh: 'Sphere' },
          { type: 'Projectile', speed: 34, damage: 14, lifetime: 3, affectsTag: 'enemy' },
        ],
      });
      if (r.ok) ctx.vars.projectile = 'Projectile';
      return r;
    },
  });
  if (has(t, 'door', 'gate')) steps.push({
    id: 'door', label: 'Create a door with interaction', section: 'Gameplay',
    run: async () => {
      runTool('create_game_object', {
        name: 'Door', position: '0,1.5,0',
        components: [
          { type: 'MeshRenderer', mesh: 'Cube' },
          { type: 'Collider', shape: 'box', size: { x: 2, y: 3, z: 0.3 } },
          { type: 'Door', mode: 'slide', openOffset: { x: 0, y: 3.2, z: 0 }, speed: 2.6 },
          { type: 'Interactable', prompt: 'Open door', range: 3, action: 'openDoor', target: 'self' },
        ],
      });
      return { ok: true, summary: 'Created interactive sliding door.' };
    },
  });
  if (has(t, 'checkpoint', 'save point')) steps.push({
    id: 'checkpoint', label: 'Add a checkpoint', section: 'Gameplay',
    run: async () => runTool('create_game_object', {
      name: 'Checkpoint', position: '0,0.5,0',
      components: [{ type: 'Checkpoint', radius: 3, isStart: true }],
    }),
  });
  if (has(t, 'craft')) steps.push({
    id: 'recipes', label: 'Add crafting recipes (axe, campfire)', section: 'Gameplay',
    when: () => !(store.project?.recipes?.length),
    run: async () => {
      runTool('add_recipe', { name: 'Stone Axe', inputs: { wood: 3, stone: 2 }, output: 'axe', outputAmount: 1 });
      return runTool('add_recipe', { name: 'Torch', inputs: { wood: 2 }, output: 'torch', outputAmount: 1 });
    },
  });
  return steps;
}

// ============================================================================
// Full game plan (Create With AI)
// ============================================================================

export interface GamePlanSection {
  name: string;
  items: { label: string; done: boolean }[];
}
export interface GamePlan {
  title: string;
  idea: string;
  genre: string;
  sections: GamePlanSection[];
  steps: PlanStep[];
}

export function buildGamePlan(idea: string): GamePlan {
  const t = lower(idea);
  const isFPS = has(t, 'first person', 'fps', 'horror');
  const isTopDown = has(t, 'top down', 'top-down', 'isometric');
  const isShooter = has(t, 'shooter', 'combat', 'gun', 'attack');
  const survival = has(t, 'survival', 'survive', 'gather', 'craft');
  const island = has(t, 'island', 'beach', 'ocean');

  const genre = survival ? 'Survival' : isFPS ? 'First-Person' : isTopDown ? 'Top-Down' : isShooter ? 'Shooter' : 'Third-Person Adventure';

  // assemble steps from recipes
  const steps: PlanStep[] = [];
  steps.push(...worldSteps(idea + (island || survival ? ' island forest rocks village resources ' : ' terrain ') + (survival ? ' night' : '')));
  steps.push(...playerSteps(idea + (isFPS ? ' first person' : isTopDown ? ' top down' : ' third person') + (survival ? ' survival stamina' : '') + (isShooter ? ' weapon combat' : '')));
  if (survival || isShooter || has(t, 'enemy', 'zombie', 'monster')) steps.push(...npcSteps(idea + (has(t, 'zombie') ? ' zombie' : ' enemy')));
  if (survival || has(t, 'night', 'zombie')) steps.push(...nightSpawnSteps(idea));
  steps.push(...uiSteps(idea + ' hud crosshair inventory menu' + (survival ? ' craft' : '')));
  steps.push(...gameplaySteps(idea + (survival ? ' craft checkpoint' : '')));
  if (survival) steps.push({
    id: 'rules', label: 'Set game rules (survive, respawn, win conditions)', section: 'Gameplay',
    run: async () => runTool('create_game_object', {
      name: 'GameRules', components: [{ type: 'GameRules', respawnOnDeath: true, respawnSeconds: 3, loseWhenPlayerDies: false, winWhenTimeSurvived: 0 }],
    }),
  });

  // build display sections from step metadata
  const sectionsMap = new Map<string, { label: string }[]>();
  for (const s of steps) {
    const key = s.section ?? 'Gameplay';
    if (!sectionsMap.has(key)) sectionsMap.set(key, []);
    sectionsMap.get(key)!.push({ label: s.label });
  }

  return {
    title: idea.length > 60 ? idea.slice(0, 60) + '…' : idea,
    idea,
    genre,
    sections: [...sectionsMap.entries()].map(([name, items]) => ({ name, items: items.map(i => ({ label: i.label, done: false })) })),
    steps,
  };
}

// ============================================================================
// Intent routing: text → plan
// ============================================================================

export interface IntentMatch {
  intent: string;
  confidence: number;
  plan: Plan | null;
  handler?: 'debugger';
}

export function planFromText(text: string): IntentMatch {
  const t = lower(text);

  // ---- debugging intents → route to AI debugger ----
  if (/(can'?t|cannot|won'?t|doesn'?t|not) (jump|move|walk|run|attack|pick|open|work|spawn)|broken|doesn't work|error|bug|fix/i.test(t) ||
      /the player (can'?t|cannot)/i.test(text) || /(fix|debug) (it|this|the)?/i.test(t) && store.problems.length) {
    return { intent: 'debug', confidence: 0.9, plan: null, handler: 'debugger' };
  }

  // ---- build intent ----
  if (/\b(build|export|package)\b/.test(t) && /\b(game|exe|project|build)\b/.test(t)) {
    return { intent: 'build', confidence: 0.85, plan: null };
  }

  // ---- full game creation ----
  if (/\b(create|make|build|generate)\b.*\b(game|survival game|adventure|shooter|horror)/.test(t)) {
    const plan = buildGamePlan(text);
    return { intent: 'create-game', confidence: 0.95, plan: {
      title: `Create game: ${plan.genre}`,
      intro: `I'll build a ${plan.genre.toLowerCase()} game from your idea. Review the plan, then press Generate.`,
      steps: plan.steps,
      review: ['This will add objects, components, UI and gameplay systems to the current scene.'],
    } };
  }

  // ---- player ----
  if (/\b(player|character|controller|protagonist)\b/.test(t) && /(third|first|fps|top|create|add|make)/.test(t)) {
    return { intent: 'create-player', confidence: 0.9, plan: {
      title: 'Create player controller',
      intro: 'A full player setup: controller, physics, camera, animation hooks, health.',
      steps: playerSteps(text),
      review: ['Adds a Player object with controller components.'],
    } };
  }

  // ---- enemy / NPC ----
  if (/\b(zombie|enemy|npc|monster|guard|shopkeeper|merchant|wildlife|animal|soldier|villager)\b/.test(t)) {
    return { intent: 'create-npc', confidence: 0.9, plan: {
      title: 'Create NPC / enemy',
      intro: 'An AI-driven character with states, detection, navigation and attack.',
      steps: npcSteps(text),
      review: ['Adds an NPC object and a prefab asset.'],
    } };
  }

  // ---- night spawning ----
  if (/\bspawn/.test(t) && /\b(night|dark|dusk)/.test(t)) {
    return { intent: 'night-spawn', confidence: 0.9, plan: {
      title: 'Night-time spawning',
      intro: 'Enemies will spawn when night falls.',
      steps: nightSpawnSteps(text),
      review: ['Adds or reconfigures a spawner + day/night cycle.'],
    } };
  }

  // ---- world / environment ----
  if (/\b(terrain|island|world|forest|village|environment|mountain|beach|ocean|map|level)\b/.test(t) && /(create|add|make|generate|build)/.test(t)) {
    return { intent: 'create-world', confidence: 0.85, plan: {
      title: 'Build world',
      intro: 'Environment generation based on your description.',
      steps: worldSteps(text),
      review: ['Adds terrain, props and lighting to the scene.'],
    } };
  }

  // ---- UI ----
  if (/\b(hud|health bar|stamina bar|ui|menu|crosshair|inventory screen|interface)\b/.test(t)) {
    return { intent: 'create-ui', confidence: 0.85, plan: {
      title: 'Create UI',
      intro: 'In-game UI documents rendered during Play Mode.',
      steps: uiSteps(text) || uiSteps('hud crosshair menu'),
      review: ['Adds UI documents to the project.'],
    } };
  }

  // ---- gameplay bits ----
  const gsteps = gameplaySteps(text);
  if (gsteps.length && /(add|create|make)/.test(t)) {
    return { intent: 'create-gameplay', confidence: 0.8, plan: {
      title: 'Add gameplay',
      intro: 'Gameplay elements from your request.',
      steps: gsteps,
      review: ['Adds gameplay objects.'],
    } };
  }

  // ---- light ----
  if (/\b(light|lantern|lamp|campfire|torch)\b/.test(t) && /(add|create|place|make)/.test(t)) {
    return { intent: 'add-light', confidence: 0.85, plan: {
      title: 'Add light',
      intro: 'Placing a light source.',
      steps: [{
        id: 'light', label: 'Add light source', section: 'World',
        run: async () => runTool('create_game_object', {
          name: /campfire/.test(t) ? 'Campfire' : 'Lantern',
          components: [{ type: 'Light', lightType: 'point', color: /campfire|torch/.test(t) ? '#ff9a3c' : '#ffd9a0', intensity: 2.4, range: 15 }],
        }),
      }],
      review: ['Adds a light object.'],
    } };
  }

  // ---- material ----
  if (/\bmaterial\b/.test(t) && /(create|make|new)/.test(t)) {
    const colorMatch = t.match(/#([0-9a-f]{6})|(red|green|blue|gold|silver|metal|wood|stone|emissive|glow\w*)/);
    const named: Record<string, string> = { red: '#c0392b', green: '#27ae60', blue: '#2980b9', gold: '#d4af37', silver: '#c0c0c0', metal: '#8f9a9e', wood: '#8b5a2b', stone: '#7d7d7d' };
    const color = colorMatch ? (colorMatch[1] ? `#${colorMatch[1]}` : named[colorMatch[2]] ?? '#a8a29a') : '#a8a29a';
    return { intent: 'create-material', confidence: 0.85, plan: {
      title: 'Create material',
      intro: 'PBR material asset.',
      steps: [{
        id: 'mat', label: 'Create PBR material', section: 'Assets',
        run: async () => runTool('create_material', {
          name: 'NewMaterial', color,
          metallic: /metal|silver|gold/.test(t) ? 0.9 : 0.05,
          roughness: /metal|silver|gold/.test(t) ? 0.25 : 0.8,
          emissive: /emissive|glow/.test(t) ? color : '#000000',
        }),
      }],
      review: ['Adds a material asset.'],
    } };
  }

  return { intent: 'unknown', confidence: 0, plan: null };
}
