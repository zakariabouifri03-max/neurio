// ============================================================================
// NEXUS — Game templates
// Each template builds a real, playable ProjectData. These same builders are
// used by "Create With AI" when the idea matches a genre.
// ============================================================================

import {
  ProjectData, SceneData, GameObjectData, gameObject, uid, createEmptyProject, defaultEnvironment, v3,
} from '@engine/core/types';
import { createComponentData } from '@engine/core/registry';
import { addAsset } from '@engine/core/ops';
import {
  generateIsland, encodeFloats, encodeBytes, sampleHeight,
} from '@engine/terrain/terrain';
import {
  templateHealthBar, templateCrosshair, templateInventory, templateMainMenu,
  templatePauseMenu, templateEndScreens, templateCrafting, templateInteractPrompt,
} from '@engine/ui/hud';

// ------------------------------ builder helpers -----------------------------

function scene(p: ProjectData): SceneData { return p.scenes[0]; }

interface AddOpts {
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  transform?: GameObjectData['transform'];
  components?: any[];
  tags?: string[];
  parent?: string | null;
}

function add(p: ProjectData, name: string, opts: AddOpts = {}): GameObjectData {
  const go = gameObject(name, {
    parent: opts.parent ?? null,
    transform: opts.transform ?? { position: opts.position ?? v3(), rotation: opts.rotation ?? v3(), scale: opts.scale ?? v3(1, 1, 1) },
    components: [],
    tags: opts.tags ?? [],
  });
  go.components = (opts.components ?? []).map((c: any) =>
    typeof c === 'string' ? createComponentData(c) : createComponentData(c.type, c));
  scene(p).objects.push(go);
  return go;
}

function mat(name: string, data: any) {
  return { name, type: 'material' as const, data };
}

function addMaterials(p: ProjectData) {
  const mats = [
    mat('GrassGreen', { color: '#4d7a3e', roughness: 0.92 }),
    mat('SandBeach', { color: '#cbb78a', roughness: 0.95 }),
    mat('RockGray', { color: '#7a7a78', roughness: 0.88 }),
    mat('WoodBrown', { color: '#7a5a3a', roughness: 0.85 }),
    mat('ZombieSkin', { color: '#5d7050', roughness: 0.9 }),
    mat('WaterBlue', { color: '#2a6f8e', roughness: 0.12, metallic: 0.6 }),
    mat('LeafGreen', { color: '#2e5d33', roughness: 0.9 }),
    mat('Gold', { color: '#d4af37', metallic: 0.95, roughness: 0.22 }),
    mat('LavaGlow', { color: '#3a2a20', emissive: '#ff5a1f', emissiveIntensity: 2.2 }),
  ];
  for (const m of mats) addAsset(p, m);
}

function playerSetup(p: ProjectData, kind: 'third' | 'first' | 'top', pos = v3(0, 3, 0), opts: { survival?: boolean; weapon?: boolean } = {}) {
  const controller = kind === 'first' ? 'FirstPersonController' : kind === 'top' ? 'TopDownController' : 'ThirdPersonController';
  return add(p, 'Player', {
    position: pos, tags: ['player'],
    components: [
      controller,
      { type: 'CharacterBody' },
      { type: 'Collider', shape: 'capsule', radius: 0.42, size: { x: 0.9, y: 1.75, z: 0.9 }, center: { x: 0, y: 0.12, z: 0 } },
      { type: 'RigidBody', mass: 72, lockRotation: true, linearDamping: 0.02, angularDamping: 0.9 },
      { type: 'Health', maxHealth: 100, startHealth: 100, regenPerSecond: opts.survival ? 0 : 1.5, regenDelay: 5 },
      { type: 'Inventory', capacity: 200, startingItems: opts.survival ? { wood: 0 } : {} },
      ...(opts.survival ? [{ type: 'SaveSystem', saveKey: 'player_save', autosaveSeconds: 90 }] : []),
      ...(opts.weapon || opts.survival ? [{ type: 'Weapon', damage: 20, range: 2.5, cooldown: 0.6, affectsTag: 'enemy' }] : []),
    ],
  });
}

function enemyPrefab(p: ProjectData, name: string, props: any, visual: any = {}): string {
  const go = {
    ...gameObject(name, {
      transform: { position: v3(0, -40, 0), rotation: v3(), scale: v3(1, 1, 1) },
      components: [
        { type: 'NPC', ...props },
        { type: 'CharacterBody', ...visual },
        { type: 'Collider', shape: 'capsule', radius: 0.4, size: { x: 0.8, y: 1.7, z: 0.8 }, center: { x: 0, y: 0.1, z: 0 } },
        { type: 'RigidBody', mass: 68, lockRotation: true, linearDamping: 0.05, angularDamping: 0.9 },
      ],
      tags: ['enemy'],
    }),
  };
  const asset = addAsset(p, { name: `${name}Prefab`, type: 'prefab', data: [go] });
  return asset.id;
}

function basicLighting(p: ProjectData) {
  const env = scene(p).environment;
  env.sunIntensity = 2.3; env.ambientIntensity = 0.55;
}

function ground(p: ProjectData, size = 120) {
  return add(p, 'Ground', {
    position: v3(0, 0, 0),
    components: [
      { type: 'MeshRenderer', mesh: 'Plane', scale: { x: size, y: 1, z: size } },
      { type: 'Collider', shape: 'box', size: { x: size, y: 1, z: size }, center: { x: 0, y: -0.5, z: 0 } },
    ],
    transform: { position: v3(0, 0, 0), rotation: v3(), scale: v3(size, 1, size) },
  });
}

// ============================================================================
// Template: Empty
// ============================================================================
export function templateEmpty(name: string): ProjectData {
  const p = createEmptyProject(name, 'empty');
  basicLighting(p);
  add(p, 'DirectionalLight', { components: [{ type: 'Light', lightType: 'directional', intensity: 2.0 }] });
  return p;
}

// ============================================================================
// Template: 3D Game (basic sandbox scene)
// ============================================================================
export function template3dGame(name: string): ProjectData {
  const p = createEmptyProject(name, '3d-game');
  basicLighting(p);
  addMaterials(p);
  ground(p, 80);
  add(p, 'Sun', { components: [{ type: 'Light', lightType: 'directional', intensity: 2.2 }] });
  add(p, 'Cube', { position: v3(0, 1, 0), components: [{ type: 'MeshRenderer', mesh: 'Cube' }, { type: 'RigidBody', mass: 2 }, { type: 'Collider', shape: 'box' }] });
  add(p, 'Sphere', { position: v3(2.5, 1.5, 1), components: [{ type: 'MeshRenderer', mesh: 'Sphere' }, { type: 'RigidBody', mass: 1 }, { type: 'Collider', shape: 'sphere', radius: 0.5 }] });
  add(p, 'MainCamera', { position: v3(8, 5, 8), components: [{ type: 'Camera', fov: 60 }] });
  return p;
}

// ============================================================================
// Template: Third Person / Top Down / First Person basics
// ============================================================================
export function templateThirdPerson(name: string): ProjectData {
  const p = createEmptyProject(name, 'third-person');
  basicLighting(p);
  addMaterials(p);
  ground(p, 140);
  add(p, 'Sun', { components: [{ type: 'Light', lightType: 'directional', intensity: 2.2 }] });
  playerSetup(p, 'third', v3(0, 2, 6));
  // some props to jump on
  for (let i = 0; i < 5; i++) {
    add(p, `Platform${i}`, {
      position: v3(i * 4 - 8, 0.5 + i * 0.6, -6),
      components: [
        { type: 'MeshRenderer', mesh: 'Cube' },
        { type: 'Collider', shape: 'box', size: { x: 3, y: 1 + i * 1.2, z: 3 } },
      ],
      transform: { position: v3(i * 4 - 8, (0.5 + i * 0.6), -6), rotation: v3(), scale: v3(3, 1 + i * 1.2, 3) },
    });
  }
  p.uiDocuments.push(templateHealthBar(), templateCrosshair(), templateMainMenu(name), templatePauseMenu(), ...templateEndScreens());
  return p;
}

export function templateTopDown(name: string): ProjectData {
  const p = createEmptyProject(name, 'top-down');
  basicLighting(p);
  addMaterials(p);
  ground(p, 120);
  add(p, 'Sun', { components: [{ type: 'Light', lightType: 'directional', intensity: 2.0 }] });
  playerSetup(p, 'top', v3(0, 1, 0), { weapon: true });
  // arena walls
  const w = 40;
  add(p, 'WallN', { transform: { position: v3(0, 1, -w), rotation: v3(), scale: v3(w * 2, 2, 1) }, components: [{ type: 'MeshRenderer', mesh: 'Cube' }, { type: 'Collider', shape: 'box', size: { x: w * 2, y: 2, z: 1 } }] });
  add(p, 'WallS', { transform: { position: v3(0, 1, w), rotation: v3(), scale: v3(w * 2, 2, 1) }, components: [{ type: 'MeshRenderer', mesh: 'Cube' }, { type: 'Collider', shape: 'box', size: { x: w * 2, y: 2, z: 1 } }] });
  add(p, 'WallW', { transform: { position: v3(-w, 1, 0), rotation: v3(), scale: v3(1, 2, w * 2) }, components: [{ type: 'MeshRenderer', mesh: 'Cube' }, { type: 'Collider', shape: 'box', size: { x: 1, y: 2, z: w * 2 } }] });
  add(p, 'WallE', { transform: { position: v3(w, 1, 0), rotation: v3(), scale: v3(1, 2, w * 2) }, components: [{ type: 'MeshRenderer', mesh: 'Cube' }, { type: 'Collider', shape: 'box', size: { x: 1, y: 2, z: w * 2 } }] });
  p.uiDocuments.push(templateHealthBar(), templateCrosshair(), templateMainMenu(name), templatePauseMenu(), ...templateEndScreens());
  return p;
}

export function templateFirstPersonHorror(name: string): ProjectData {
  const p = createEmptyProject(name, 'fp-horror');
  const env = scene(p).environment;
  env.sunIntensity = 0.25; env.ambientIntensity = 0.12; env.skyTop = '#05060a'; env.skyBottom = '#10141c';
  env.fogMode = 'exponential'; env.fogColor = '#0a0d13'; env.fogDensity = 0.045;
  addMaterials(p);
  ground(p, 60);
  add(p, 'MoonLight', { components: [{ type: 'Light', lightType: 'directional', color: '#7d90c0', intensity: 0.35 }] });
  playerSetup(p, 'first', v3(0, 2, 0));
  // creepy maze walls
  const walls: [number, number, number, number][] = [[0, -12, 20, 1], [-8, -4, 1, 14], [8, -4, 1, 14], [0, 4, 20, 1], [-4, 0, 1, 6]];
  walls.forEach(([x, z, sx, sz], i) => {
    add(p, `Wall${i}`, {
      transform: { position: v3(x, 1.6, z), rotation: v3(), scale: v3(sx, 3.2, sz) },
      components: [{ type: 'MeshRenderer', mesh: 'Cube' }, { type: 'Collider', shape: 'box', size: { x: sx, y: 3.2, z: sz } }],
    });
  });
  // flickering lights + monster
  add(p, 'FlickerLight', { position: v3(0, 3, -8), components: [{ type: 'Light', lightType: 'point', color: '#ffd9a0', intensity: 1.8, range: 12 }] });
  enemyPrefab(p, 'Stalker', { role: 'enemy', preset: 'zombie', maxHealth: 250, detectionRange: 24, chaseSpeed: 5.2, attackDamage: 25, moveSpeed: 3, attackCooldown: 1.1, loot: null, onDeathDestroy: true }, { bodyColor: '#1f2430', skinColor: '#5d7050' });
  const spawner = add(p, 'StalkerSpawner', { position: v3(0, 0.5, -20), components: [] });
  spawner.components.push(createComponentData('Spawner', { prefab: p.assets[p.assets.length - 1].id, mode: 'always', interval: 45, maxAlive: 1, spawnRadius: 4 }));
  add(p, 'DayNightCycle', { components: [{ type: 'DayNightCycle', dayLengthMinutes: 8, startTime: 22, sunIntensity: 0.3, moonIntensity: 0.5, nightAmbient: 0.1 }] });
  p.uiDocuments.push(templateHealthBar(), templateCrosshair(), templateMainMenu(name), templatePauseMenu(), ...templateEndScreens());
  return p;
}

// ============================================================================
// Template: Simple Shooter (top-down twin-stick with projectiles)
// ============================================================================
export function templateShooter(name: string): ProjectData {
  const p = createEmptyProject(name, 'shooter');
  basicLighting(p);
  addMaterials(p);
  ground(p, 90);
  add(p, 'Sun', { components: [{ type: 'Light', lightType: 'directional', intensity: 2.0 }] });
  playerSetup(p, 'top', v3(0, 1, 0), { weapon: true });
  const prefabId = enemyPrefab(p, 'Drone', { role: 'enemy', preset: 'soldier', maxHealth: 40, moveSpeed: 3.4, chaseSpeed: 4.6, attackDamage: 8, attackRange: 1.6, detectionRange: 30, detectionFov: 360 }, { bodyColor: '#8a4a4a' });
  add(p, 'EnemySpawner', { position: v3(-20, 0.5, -20), components: [{ type: 'Spawner', prefab: prefabId, mode: 'always', interval: 6, maxAlive: 8, spawnRadius: 28 }] });
  add(p, 'GameRules', { components: [{ type: 'GameRules', respawnOnDeath: true, respawnSeconds: 2, winWhenEnemiesKilled: 20 }] });
  p.recipes.push({ id: uid('r_'), name: 'Repair Kit', inputs: { scrap: 4 }, output: 'repair_kit', outputAmount: 1 });
  p.uiDocuments.push(templateHealthBar(), templateCrosshair(), templateMainMenu(name), templatePauseMenu(), ...templateEndScreens());
  return p;
}

// ============================================================================
// Template: ISLAND SURVIVAL — the flagship sample game
// ============================================================================
export function templateIslandSurvival(name = 'Island Survival'): ProjectData {
  const p = createEmptyProject(name, 'survival');
  p.description = 'Third-person survival: gather, craft, fight zombies at night, survive. Built with NEXUS.';
  const env = scene(p).environment;
  env.sunIntensity = 2.4; env.ambientIntensity = 0.55;
  env.skyTop = '#3f74ad'; env.skyBottom = '#cfe3ee';
  env.fogMode = 'exponential'; env.fogColor = '#b9cbd8'; env.fogDensity = 0.006;
  addMaterials(p);

  // ---- island terrain ----
  const SIZE = 300, SEG = 120;
  const island = generateIsland({ size: SIZE, segments: SEG, maxHeight: 17, beachHeight: 1.4, seed: 20771 });
  add(p, 'Terrain', {
    components: [{ type: 'Terrain', size: SIZE, segments: SEG, heights: encodeFloats(island.heights), colors: encodeBytes(island.colors), collider: true, baseColor: '#7ba05b' }],
  });
  add(p, 'Ocean', { position: v3(0, 0.55, 0), components: [{ type: 'Water', size: 2200, color: '#2a6f8e', opacity: 0.8, waveHeight: 0.1, waveSpeed: 1.2 }] });

  const hAt = (x: number, z: number) => sampleHeight(island.heights, SIZE, SEG, x, z) ?? 2;

  // ---- player ----
  const spawn = { x: 0, z: 6 };
  playerSetup(p, 'third', v3(spawn.x, hAt(spawn.x, spawn.z) + 1.5, spawn.z), { survival: true, weapon: true });

  // ---- day/night ----
  add(p, 'DayNightCycle', { components: [{ type: 'DayNightCycle', dayLengthMinutes: 5, startTime: 9.5, sunIntensity: 2.4, moonIntensity: 0.4, nightAmbient: 0.14, dayAmbient: 0.55 }] });

  // ---- camp & village ----
  const village = add(p, 'VillageCamp', { position: v3(0, hAt(0, 0), 0) });
  const hut = (i: number, x: number, z: number) => {
    add(p, `Hut${i}`, {
      parent: village.id,
      transform: { position: v3(x, hAt(x, z) + 1.4, z), rotation: v3(0, Math.random() * 360, 0), scale: v3(4.4, 2.8, 4.4) },
      components: [
        { type: 'MeshRenderer', mesh: 'Cube' },
        { type: 'Collider', shape: 'box', size: { x: 4.4, y: 2.8, z: 4.4 } },
      ],
    });
  };
  hut(1, -9, -7); hut(2, 9, -8); hut(3, 1, 12); hut(4, -12, 6);
  add(p, 'Campfire', {
    parent: village.id, position: v3(0, hAt(0, 0) + 0.35, 0),
    components: [
      { type: 'Light', lightType: 'point', color: '#ff9a3c', intensity: 2.8, range: 18 },
      { type: 'Interactable', prompt: 'Rest & Save', range: 3.5, action: 'save' },
    ],
  });
  add(p, 'StartCheckpoint', { position: v3(spawn.x, hAt(spawn.x, spawn.z) + 0.6, spawn.z), components: [{ type: 'Checkpoint', radius: 3, isStart: true }] });

  // ---- trees & rocks with real colliders ----
  let treeCount = 0, rockCount = 0;
  for (let i = 0; i < 150 && treeCount < 42; i++) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 105;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = hAt(x, z);
    if (h < 2.2 || h > 12) continue; // beach/peak check
    const s = 0.8 + Math.random() * 0.8;
    add(p, `Tree${++treeCount}`, {
      transform: { position: v3(x, h + 1.6 * s, z), rotation: v3(0, Math.random() * 360, 0), scale: v3(s, s, s) },
      components: [
        { type: 'MeshRenderer', mesh: 'Cylinder' },
        { type: 'Collider', shape: 'box', size: { x: 0.7 * s, y: 3.2 * s, z: 0.7 * s } },
      ],
    });
  }
  for (let i = 0; i < 80 && rockCount < 16; i++) {
    const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 100;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = hAt(x, z);
    if (h < 1.2) continue;
    const s = 0.7 + Math.random() * 1.1;
    add(p, `Rock${++rockCount}`, {
      transform: { position: v3(x, h + 0.45 * s, z), rotation: v3(), scale: v3(s, s * 0.7, s) },
      components: [
        { type: 'MeshRenderer', mesh: 'Sphere' },
        { type: 'Collider', shape: 'box', size: { x: s, y: s * 0.7, z: s } },
      ],
    });
  }

  // ---- collectible resources ----
  const scatterPickups = (name: string, item: string, count: number, minR: number, maxR: number) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = hAt(x, z);
      if (h < 1.4) continue;
      add(p, name, {
        transform: { position: v3(x, h + 0.55, z), rotation: v3(), scale: v3(0.55, 0.55, 0.55) },
        components: [
          { type: 'MeshRenderer', mesh: 'Sphere' },
          { type: 'Collider', shape: 'sphere', radius: 0.85, isTrigger: true },
          { type: 'Pickup', item, amount: 2, bob: true, spin: true },
        ],
      });
    }
  };
  scatterPickups('WoodPile', 'wood', 14, 20, 110);
  scatterPickups('StoneNode', 'stone', 12, 22, 115);
  scatterPickups('BerryBush', 'berries', 10, 14, 90);

  // ---- zombies + night spawner ----
  const zombiePrefabId = enemyPrefab(p, 'Zombie', {
    role: 'enemy', preset: 'zombie', initialState: 'patrol', maxHealth: 55,
    detectionRange: 14, detectionFov: 150, hearingRange: 18,
    moveSpeed: 2.2, chaseSpeed: 4.3, attackRange: 2.0, attackDamage: 12, attackCooldown: 1.5,
    loseInterestRange: 30, loot: 'rotten_flesh', lootAmount: 1, onDeathDestroy: true,
  }, { bodyColor: '#44513c', skinColor: '#7d9070' });
  // two daytime wanderers for atmosphere
  add(p, 'ZombieWanderer1', {
    position: v3(40, hAt(40, -30) + 1, -30), tags: ['enemy'],
    components: [
      { type: 'NPC', role: 'enemy', preset: 'zombie', initialState: 'patrol', maxHealth: 55, moveSpeed: 1.8, chaseSpeed: 4.0, attackDamage: 12, detectionRange: 13, loot: 'rotten_flesh' },
      { type: 'CharacterBody', bodyColor: '#44513c', skinColor: '#7d9070' },
      { type: 'Collider', shape: 'capsule', radius: 0.4, size: { x: 0.8, y: 1.7, z: 0.8 }, center: { x: 0, y: 0.1, z: 0 } },
      { type: 'RigidBody', mass: 68, lockRotation: true, linearDamping: 0.05 },
    ],
  });
  const spawnerPos = { x: 60, z: 55 };
  add(p, 'NightZombieSpawner', {
    position: v3(spawnerPos.x, hAt(spawnerPos.x, spawnerPos.z) + 0.5, spawnerPos.z),
    components: [{ type: 'Spawner', prefab: zombiePrefabId, mode: 'night', interval: 16, maxAlive: 5, spawnRadius: 60 }],
  });

  // ---- crafting & rules ----
  p.recipes.push(
    { id: uid('r_'), name: 'Stone Axe', inputs: { wood: 3, stone: 2 }, output: 'stone_axe', outputAmount: 1 },
    { id: uid('r_'), name: 'Campfire Kit', inputs: { wood: 5, stone: 3 }, output: 'campfire_kit', outputAmount: 1 },
    { id: uid('r_'), name: 'Bandage', inputs: { berries: 4 }, output: 'bandage', outputAmount: 1 },
  );
  add(p, 'CraftingTable', {
    position: v3(3.5, hAt(3.5, 0) + 0.5, 0), parent: village.id,
    components: [
      { type: 'MeshRenderer', mesh: 'Cube' },
      { type: 'Collider', shape: 'box', size: { x: 1.6, y: 1, z: 1 } },
      { type: 'Interactable', prompt: 'Craft', range: 3, action: 'craft' },
    ],
  });
  add(p, 'GameRules', { components: [{ type: 'GameRules', respawnOnDeath: true, respawnSeconds: 4, loseWhenPlayerDies: false }] });

  // ---- UI ----
  const hud = templateHealthBar();
  hud.elements.push(templateInteractPrompt());
  p.uiDocuments.push(
    hud, templateCrosshair(), templateInventory(), templateCrafting(),
    templateMainMenu(name), templatePauseMenu(), ...templateEndScreens(),
  );

  // ---- AI memory ----
  p.aiMemory.summary = `"${name}" — third-person survival on a procedurally generated island.`;
  p.aiMemory.systems = ['player-controller', 'health-system', 'inventory', 'crafting (3 recipes)', 'npc-ai', 'day-night-cycle', 'spawners ×1', 'save-system', 'game-rules', 'terrain', 'water'];
  p.aiMemory.keyObjects = [
    { id: 'player', name: 'Player', role: 'ThirdPersonController' },
    { id: 'spawner', name: 'NightZombieSpawner', role: 'Spawner' },
    { id: 'daynight', name: 'DayNightCycle', role: 'DayNightCycle' },
    { id: 'camp', name: 'VillageCamp', role: 'camp' },
  ];
  return p;
}

// ============================================================================
// Registry
// ============================================================================
export interface TemplateDef { id: string; name: string; description: string; icon: string; build: (name: string) => ProjectData; }

export const TEMPLATES: TemplateDef[] = [
  { id: 'survival', name: 'Survival — Island Survival', icon: 'water', description: 'Third-person survival on a procedural island: terrain, trees, resources, crafting, day/night, night zombies, save system. Fully playable.', build: templateIslandSurvival },
  { id: 'third-person', name: 'Third Person Adventure', icon: 'person', description: 'Third-person controller with jumping platforms, camera follow, HUD and menus.', build: templateThirdPerson },
  { id: 'fp-horror', name: 'First Person Horror', icon: 'sunMoon', description: 'Dark foggy maze, flashlight vibe, a stalker enemy that hunts you.', build: templateFirstPersonHorror },
  { id: 'shooter', name: 'Simple Shooter', icon: 'sword', description: 'Twin-stick style top-down arena: waves of drones, kill 20 to win.', build: templateShooter },
  { id: 'top-down', name: 'Top Down', icon: 'grid', description: 'Top-down controller with a walled arena and melee combat.', build: templateTopDown },
  { id: '3d-game', name: '3D Game (basic scene)', icon: 'cube', description: 'Ground, lights, physics props, camera — a clean starting point.', build: template3dGame },
  { id: 'empty', name: 'Empty Project', icon: 'file', description: 'A truly empty scene. Build everything yourself or with the AI.', build: templateEmpty },
];
