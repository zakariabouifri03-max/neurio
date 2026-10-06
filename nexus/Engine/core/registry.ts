// ============================================================================
// NEXUS ENGINE — Component registry
// One place that describes every built-in component: defaults + inspector
// schema + runtime class. The Inspector auto-generates its UI from this,
// the AI Agent uses it to discover modifiable properties, and templates
// construct components through it.
// ============================================================================

export type FieldType =
  | 'number' | 'vec3' | 'color' | 'bool' | 'enum' | 'string'
  | 'asset' | 'objectref' | 'vec3list' | 'graph' | 'section';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  min?: number; max?: number; step?: number;
  assetType?: string;          // for 'asset'
  hint?: string;
  when?: (data: any) => boolean; // conditional visibility
}

export interface ComponentDef {
  type: string;
  label: string;
  category: 'render' | 'physics' | 'gameplay' | 'ai' | 'audio' | 'logic' | 'environment' | 'scripting';
  icon: string;
  defaults: () => Record<string, any>;
  schema: FieldDef[];
  description: string;
  /** Assigned by the runtime module — the live behaviour class. */
  runtime?: any;
  /** Marks components the physics/scene sync layer handles specially. */
  builtin?: boolean;
}

const defs: ComponentDef[] = [];
const byType = new Map<string, ComponentDef>();

export function defineComponent(def: ComponentDef) {
  defs.push(def);
  byType.set(def.type, def);
}
export function getComponentDef(type: string): ComponentDef | undefined { return byType.get(type); }
export function allComponentDefs(): ComponentDef[] { return defs; }
export function componentsByCategory(cat: string): ComponentDef[] { return defs.filter(d => d.category === cat); }
export function createComponentData(type: string, overrides: Record<string, any> = {}): any {
  const def = byType.get(type);
  if (!def) throw new Error(`Unknown component type: ${type}`);
  return { type, enabled: true, ...def.defaults(), ...overrides };
}

const n = (key: string, label: string, def: number, min?: number, max?: number, step = 0.1): FieldDef =>
  ({ key, label, type: 'number', min, max, step });
const b = (key: string, label: string, _def: boolean): FieldDef => ({ key, label, type: 'bool' });
const e = (key: string, label: string, options: string[], _def: string): FieldDef => ({ key, label, type: 'enum', options });
const col = (key: string, label: string, _def: string): FieldDef => ({ key, label, type: 'color' });
const a = (key: string, label: string, assetType: string): FieldDef => ({ key, label, type: 'asset', assetType });
const s = (key: string, label: string): FieldDef => ({ key, label, type: 'string' });

// ============================ RENDER / CORE ================================

defineComponent({
  type: 'MeshRenderer', label: 'Mesh Renderer', category: 'render', icon: 'cube',
  description: 'Renders a primitive mesh or an imported 3D model with a material.',
  defaults: () => ({
    mesh: 'Cube', materialAsset: null, castShadows: true, receiveShadows: true,
  }),
  schema: [
    { key: 'mesh', label: 'Mesh', type: 'enum', options: ['Cube', 'Sphere', 'Cylinder', 'Cone', 'Capsule', 'Plane', 'Quad', 'Asset'] },
    a('materialAsset', 'Material', 'material'),
    b('castShadows', 'Cast Shadows', true),
    b('receiveShadows', 'Receive Shadows', true),
  ],
});

defineComponent({
  type: 'Light', label: 'Light', category: 'render', icon: 'light',
  description: 'Point / spot / directional light with shadows.',
  defaults: () => ({ lightType: 'point', color: '#ffffff', intensity: 1.5, range: 18, spotAngle: 38, castShadows: true }),
  schema: [
    e('lightType', 'Type', ['point', 'spot', 'directional'], 'point'),
    col('color', 'Color', '#ffffff'),
    n('intensity', 'Intensity', 1.5, 0, 60, 0.1),
    n('range', 'Range', 18, 0.5, 200, 0.5),
    n('spotAngle', 'Spot Angle', 38, 5, 89, 1),
    b('castShadows', 'Cast Shadows', true),
  ],
});

defineComponent({
  type: 'Camera', label: 'Camera', category: 'render', icon: 'camera',
  description: 'Game camera. The first enabled camera is used in Play Mode.',
  defaults: () => ({ fov: 60, near: 0.1, far: 800, isMain: true, clearWithSky: true }),
  schema: [n('fov', 'FOV', 60, 20, 120, 1), n('near', 'Near', 0.1, 0.01, 5, 0.01), n('far', 'Far', 800, 50, 5000, 10), b('isMain', 'Main Camera', true)],
});

defineComponent({
  type: 'CharacterBody', label: 'Character Body (procedural)', category: 'render', icon: 'person',
  description: 'Low-poly humanoid built from primitives with procedural walk/run/idle animation. No model import needed.',
  defaults: () => ({ bodyColor: '#8a6d4f', shirtColor: '#39506b', pantsColor: '#2b2f38', skinColor: '#c9a17e', scale: 1, walkSwing: 1 }),
  schema: [col('bodyColor', 'Clothes', '#39506b'), col('skinColor', 'Skin', '#c9a17e'), col('pantsColor', 'Pants', '#2b2f38'), n('scale', 'Scale', 1, 0.4, 3, 0.05), n('walkSwing', 'Anim Intensity', 1, 0, 2, 0.1)],
});

// ================================ PHYSICS ==================================

defineComponent({
  type: 'Collider', label: 'Collider', category: 'physics', icon: 'box',
  description: 'Collision shape. Trigger colliders raise events without physical response.',
  defaults: () => ({ shape: 'box', size: { x: 1, y: 1, z: 1 }, radius: 0.5, isTrigger: false, center: { x: 0, y: 0, z: 0 }, friction: 0.4, restitution: 0.05 }),
  schema: [
    e('shape', 'Shape', ['box', 'sphere', 'capsule'], 'box'),
    { key: 'size', label: 'Size', type: 'vec3' },
    n('radius', 'Radius', 0.5, 0.05, 20, 0.05),
    { key: 'center', label: 'Center', type: 'vec3' },
    b('isTrigger', 'Is Trigger', false),
    n('friction', 'Friction', 0.4, 0, 2, 0.05),
    n('restitution', 'Restitution', 0.05, 0, 1, 0.05),
  ],
});

defineComponent({
  type: 'RigidBody', label: 'Rigid Body', category: 'physics', icon: 'weight',
  description: 'Dynamic physics body — gravity, forces, mass.',
  defaults: () => ({ mass: 1, useGravity: true, linearDamping: 0.05, angularDamping: 0.2, lockRotation: true, kinematic: false }),
  schema: [
    n('mass', 'Mass', 1, 0, 1000, 0.1),
    b('useGravity', 'Use Gravity', true),
    b('kinematic', 'Kinematic', false),
    b('lockRotation', 'Lock Rotation', true),
    n('linearDamping', 'Linear Damping', 0.05, 0, 2, 0.01),
    n('angularDamping', 'Angular Damping', 0.2, 0, 2, 0.01),
  ],
});

// ================================ GAMEPLAY =================================

defineComponent({
  type: 'ThirdPersonController', label: 'Third Person Controller', category: 'gameplay', icon: 'person',
  description: 'WASD movement relative to camera, jump, gravity, sprint, crouch, stamina drain, camera spring-arm follow.',
  defaults: () => ({
    moveSpeed: 6, sprintSpeed: 10.5, jumpForce: 7.5, gravityScale: 1.8, turnSpeed: 12,
    cameraDistance: 6.5, cameraHeight: 2.4, cameraLag: 8, mouseSensitivity: 0.14,
    canSprint: true, canCrouch: true, crouchSpeed: 3, useStamina: true, staminaDrain: 12, staminaRegen: 9,
    groundCheckExtra: 0.18, requireCollider: true,
  }),
  schema: [
    n('moveSpeed', 'Walk Speed', 6, 0.5, 30, 0.5),
    n('sprintSpeed', 'Sprint Speed', 10.5, 0.5, 40, 0.5),
    n('jumpForce', 'Jump Force', 7.5, 0, 30, 0.1),
    n('gravityScale', 'Gravity Scale', 1.8, 0.1, 6, 0.1),
    n('turnSpeed', 'Turn Speed', 12, 1, 30, 0.5),
    n('cameraDistance', 'Camera Distance', 6.5, 1, 30, 0.5),
    n('cameraHeight', 'Camera Height', 2.4, 0, 15, 0.1),
    n('cameraLag', 'Camera Smoothing', 8, 1, 20, 0.5),
    n('mouseSensitivity', 'Mouse Sensitivity', 0.14, 0.01, 1, 0.01),
    b('canSprint', 'Can Sprint', true),
    b('canCrouch', 'Can Crouch', true),
    n('crouchSpeed', 'Crouch Speed', 3, 0.5, 20, 0.5),
    b('useStamina', 'Use Stamina', true),
    n('staminaDrain', 'Stamina Drain /s', 12, 0, 100, 1),
    n('staminaRegen', 'Stamina Regen /s', 9, 0, 100, 1),
    n('groundCheckExtra', 'Ground Check Extra', 0.18, 0.02, 1, 0.02),
  ],
});

defineComponent({
  type: 'FirstPersonController', label: 'First Person Controller', category: 'gameplay', icon: 'person',
  description: 'Pointer-locked mouse look, WASD, jump, sprint, gravity.',
  defaults: () => ({
    moveSpeed: 6, sprintSpeed: 10, jumpForce: 7.5, gravityScale: 1.8, mouseSensitivity: 0.12,
    eyeHeight: 1.62, canSprint: true, canCrouch: true, crouchSpeed: 3, useStamina: true, staminaDrain: 12, staminaRegen: 9, groundCheckExtra: 0.18,
  }),
  schema: [
    n('moveSpeed', 'Walk Speed', 6, 0.5, 30, 0.5),
    n('sprintSpeed', 'Sprint Speed', 10, 0.5, 40, 0.5),
    n('jumpForce', 'Jump Force', 7.5, 0, 30, 0.1),
    n('gravityScale', 'Gravity Scale', 1.8, 0.1, 6, 0.1),
    n('mouseSensitivity', 'Mouse Sensitivity', 0.12, 0.01, 1, 0.01),
    n('eyeHeight', 'Eye Height', 1.62, 0.5, 3, 0.02),
    b('canSprint', 'Can Sprint', true), b('canCrouch', 'Can Crouch', true),
    b('useStamina', 'Use Stamina', true),
  ],
});

defineComponent({
  type: 'TopDownController', label: 'Top Down Controller', category: 'gameplay', icon: 'person',
  description: 'WASD world-space movement with an overhead follow camera.',
  defaults: () => ({ moveSpeed: 6.5, sprintSpeed: 11, cameraHeight: 16, cameraAngle: 55, cameraLag: 6, useStamina: false, staminaDrain: 12, staminaRegen: 9 }),
  schema: [
    n('moveSpeed', 'Walk Speed', 6.5, 0.5, 30, 0.5), n('sprintSpeed', 'Sprint Speed', 11, 0.5, 40, 0.5),
    n('cameraHeight', 'Camera Height', 16, 4, 60, 0.5), n('cameraAngle', 'Camera Tilt', 55, 20, 89, 1), n('cameraLag', 'Camera Smoothing', 6, 1, 20, 0.5),
  ],
});

defineComponent({
  type: 'Health', label: 'Health', category: 'gameplay', icon: 'heart',
  description: 'Hit points with damage/heal API, regen, death event, optional UI binding.',
  defaults: () => ({ maxHealth: 100, startHealth: 100, regenPerSecond: 0, regenDelay: 4, invulnerableSeconds: 0, destroyOnDeath: false, deathEvent: 'died' }),
  schema: [
    n('maxHealth', 'Max Health', 100, 1, 100000, 1), n('startHealth', 'Start Health', 100, 0, 100000, 1),
    n('regenPerSecond', 'Regen /s', 0, 0, 1000, 0.5), n('regenDelay', 'Regen Delay (s)', 4, 0, 600, 0.5),
    n('invulnerableSeconds', 'Invulnerable (s)', 0, 0, 30, 0.5), b('destroyOnDeath', 'Destroy On Death', false),
  ],
});

defineComponent({
  type: 'DamageDealer', label: 'Damage Dealer', category: 'gameplay', icon: 'bolt',
  description: 'Deals damage to Health components on contact (melee zones, projectiles, hazards).',
  defaults: () => ({ damage: 10, cooldownPerTarget: 1, affectsTag: 'player', affectsAllies: false, destroySelf: false }),
  schema: [n('damage', 'Damage', 10, 0, 10000, 1), n('cooldownPerTarget', 'Cooldown / Target (s)', 1, 0, 30, 0.1), { key: 'affectsTag', label: 'Affects Tag', type: 'string' }],
});

defineComponent({
  type: 'Interactable', label: 'Interactable', category: 'gameplay', icon: 'hand',
  description: 'Player can interact (E key) within range — fires visual-script events & built-in actions.',
  defaults: () => ({ prompt: 'Interact', range: 3, action: 'none', target: null, requireItem: null, consumeItem: false, amount: 1, once: false }),
  schema: [
    { key: 'prompt', label: 'Prompt', type: 'string' },
    n('range', 'Range', 3, 0.5, 20, 0.5),
    e('action', 'Action', ['none', 'openDoor', 'pickup', 'save', 'rest', 'craft', 'custom'], 'none'),
    { key: 'target', label: 'Target Object', type: 'objectref' },
    { key: 'requireItem', label: 'Requires Item', type: 'string' },
    b('once', 'One-shot', false),
  ],
});

defineComponent({
  type: 'Pickup', label: 'Pickup', category: 'gameplay', icon: 'gift',
  description: 'Collectible item added to player inventory on touch.',
  defaults: () => ({ item: 'wood', amount: 1, respawn: false, respawnSeconds: 30, bob: true, spin: true }),
  schema: [
    { key: 'item', label: 'Item ID', type: 'string' },
    n('amount', 'Amount', 1, 1, 999, 1),
    b('respawn', 'Respawn', false), n('respawnSeconds', 'Respawn (s)', 30, 1, 600, 1),
    b('bob', 'Bob', true), b('spin', 'Spin', true),
  ],
});

defineComponent({
  type: 'Inventory', label: 'Inventory', category: 'gameplay', icon: 'grid',
  description: 'Item storage with capacity, crafting hooks, and HUD binding.',
  defaults: () => ({ capacity: 100, startingItems: {} as Record<string, number> }),
  schema: [n('capacity', 'Capacity', 100, 1, 9999, 1)],
});

defineComponent({
  type: 'Spawner', label: 'Spawner', category: 'gameplay', icon: 'spawn',
  description: 'Spawns a prefab repeatedly. Modes: always, day only, night only, once.',
  defaults: () => ({ prefab: null, interval: 12, maxAlive: 4, mode: 'always', spawnRadius: 6, offset: { x: 0, y: 0.2, z: 0 } }),
  schema: [
    a('prefab', 'Prefab', 'prefab'),
    n('interval', 'Interval (s)', 12, 0.5, 600, 0.5),
    n('maxAlive', 'Max Alive', 4, 1, 200, 1),
    e('mode', 'Mode', ['always', 'day', 'night', 'once'], 'always'),
    n('spawnRadius', 'Spawn Radius', 6, 0, 60, 0.5),
    { key: 'offset', label: 'Offset', type: 'vec3' },
  ],
});

defineComponent({
  type: 'TriggerVolume', label: 'Trigger Volume', category: 'gameplay', icon: 'target',
  description: 'Fires events when tagged objects enter/exit. Pairs with visual scripts.',
  defaults: () => ({ tag: 'player', once: false, requireAll: false }),
  schema: [{ key: 'tag', label: 'Target Tag', type: 'string' }, b('once', 'Fire Once', false)],
});

defineComponent({
  type: 'Door', label: 'Door', category: 'gameplay', icon: 'door',
  description: 'Sliding/rotating door that opens on interaction or trigger events.',
  defaults: () => ({ mode: 'slide', openOffset: { x: 0, y: 3, z: 0 }, openAngle: 100, speed: 3, startOpen: false, keyItem: null }),
  schema: [
    e('mode', 'Mode', ['slide', 'rotate'], 'slide'),
    { key: 'openOffset', label: 'Open Offset', type: 'vec3' },
    n('openAngle', 'Open Angle', 100, 0, 359, 1),
    n('speed', 'Speed', 3, 0.2, 20, 0.2),
    b('startOpen', 'Start Open', false),
    { key: 'keyItem', label: 'Key Item', type: 'string' },
  ],
});

defineComponent({
  type: 'Checkpoint', label: 'Checkpoint', category: 'gameplay', icon: 'flag',
  description: 'Saves player progress when touched.',
  defaults: () => ({ radius: 2.5, isStart: false }),
  schema: [n('radius', 'Radius', 2.5, 0.5, 20, 0.5), b('isStart', 'Is Start', false)],
});

defineComponent({
  type: 'Weapon', label: 'Weapon', category: 'gameplay', icon: 'sword',
  description: 'Melee attack with cooldown, range, damage; fires on mouse click.',
  defaults: () => ({ damage: 15, range: 2.2, cooldown: 0.7, staminaCost: 0, affectsTag: 'enemy', swingSound: null }),
  schema: [
    n('damage', 'Damage', 15, 1, 1000, 1), n('range', 'Range', 2.2, 0.3, 20, 0.1),
    n('cooldown', 'Cooldown (s)', 0.7, 0.1, 10, 0.05), n('staminaCost', 'Stamina Cost', 0, 0, 100, 1),
    { key: 'affectsTag', label: 'Affects Tag', type: 'string' },
    a('swingSound', 'Swing Sound', 'audio'),
  ],
});

defineComponent({
  type: 'Projectile', label: 'Projectile', category: 'gameplay', icon: 'arrow',
  description: 'Flying damage carrier —直线 travel with lifetime & self-destruct.',
  defaults: () => ({ speed: 26, damage: 12, lifetime: 4, affectsTag: 'enemy', gravity: 0, radius: 0.35 }),
  schema: [
    n('speed', 'Speed', 26, 1, 200, 1), n('damage', 'Damage', 12, 0, 1000, 1),
    n('lifetime', 'Lifetime (s)', 4, 0.2, 60, 0.1), n('gravity', 'Gravity', 0, -20, 20, 0.5),
    { key: 'affectsTag', label: 'Affects Tag', type: 'string' },
  ],
});

// ================================== NPC AI =================================

defineComponent({
  type: 'NPC', label: 'NPC / Enemy AI', category: 'ai', icon: 'bot',
  description: 'Finite-state AI: idle, patrol, investigate, follow, chase, attack, flee, dead — with detection FOV, navigation steering and waypoint patrol.',
  defaults: () => ({
    preset: 'zombie', role: 'enemy',            // enemy | ally | neutral | vendor | guard
    initialState: 'patrol',
    patrolPoints: [] as any[],                   // [{x,y,z}]
    patrolLoop: true, patrolWait: 1.2,
    detectionRange: 14, detectionFov: 130, hearingRange: 20,
    moveSpeed: 2.4, chaseSpeed: 4.6, attackRange: 1.9, attackDamage: 12, attackCooldown: 1.4,
    maxHealth: 60, loseInterestRange: 26,
    fleeBelowHealthPct: 0, investigateDuration: 6,
    avoidObstacles: true, dayOnly: false, nightOnly: false,
    onDeathDestroy: true, loot: null, lootAmount: 1,
    dialogue: [] as string[],
    shopItems: {} as Record<string, number>,
  }),
  schema: [
    e('preset', 'Preset', ['zombie', 'guard', 'shopkeeper', 'wildlife', 'soldier', 'custom'], 'zombie'),
    e('role', 'Role', ['enemy', 'ally', 'neutral', 'vendor', 'guard'], 'enemy'),
    e('initialState', 'Initial State', ['idle', 'patrol', 'investigate', 'follow', 'chase', 'attack', 'flee', 'dead'], 'patrol'),
    { key: 'patrolPoints', label: 'Patrol Points', type: 'vec3list' },
    b('patrolLoop', 'Loop Patrol', true), n('patrolWait', 'Wait At Point (s)', 1.2, 0, 30, 0.2),
    n('detectionRange', 'Detection Range', 14, 1, 100, 0.5), n('detectionFov', 'Detection FOV', 130, 20, 360, 5),
    n('hearingRange', 'Hearing Range', 20, 0, 100, 1),
    n('moveSpeed', 'Move Speed', 2.4, 0.2, 30, 0.2), n('chaseSpeed', 'Chase Speed', 4.6, 0.2, 40, 0.2),
    n('attackRange', 'Attack Range', 1.9, 0.3, 30, 0.1), n('attackDamage', 'Attack Damage', 12, 0, 1000, 1),
    n('attackCooldown', 'Attack Cooldown (s)', 1.4, 0.1, 30, 0.1),
    n('maxHealth', 'NPC Health', 60, 1, 100000, 1),
    n('loseInterestRange', 'Lose Interest Range', 26, 2, 200, 1),
    n('fleeBelowHealthPct', 'Flee Below Health %', 0, 0, 1, 0.05),
    n('investigateDuration', 'Investigate (s)', 6, 1, 120, 1),
    b('avoidObstacles', 'Avoid Obstacles', true),
    b('nightOnly', 'Active At Night Only', false), b('dayOnly', 'Active At Day Only', false),
    b('onDeathDestroy', 'Destroy On Death', true),
    { key: 'loot', label: 'Loot Item', type: 'string' }, n('lootAmount', 'Loot Amount', 1, 1, 999, 1),
  ],
});

// ============================== ENVIRONMENT ================================

defineComponent({
  type: 'DayNightCycle', label: 'Day / Night Cycle', category: 'environment', icon: 'sun',
  description: 'Rotating sun & moon, sky/fog color blending, star field, and day/night events used by spawners & scripts.',
  defaults: () => ({ dayLengthMinutes: 4, startTime: 10, sunIntensity: 2.4, moonIntensity: 0.35, nightAmbient: 0.16, dayAmbient: 0.5, startAtNight: false }),
  schema: [
    n('dayLengthMinutes', 'Day Length (min)', 4, 0.2, 60, 0.2),
    n('startTime', 'Start Hour (0-24)', 10, 0, 24, 0.5),
    n('sunIntensity', 'Sun Intensity', 2.4, 0, 10, 0.1),
    n('moonIntensity', 'Moon Intensity', 0.35, 0, 3, 0.05),
    n('nightAmbient', 'Night Ambient', 0.16, 0, 2, 0.02),
    n('dayAmbient', 'Day Ambient', 0.5, 0, 2, 0.02),
  ],
});

defineComponent({
  type: 'Terrain', label: 'Terrain', category: 'environment', icon: 'mountain',
  description: 'Sculptable heightmap terrain with texture splat layers and a physics heightfield collider.',
  defaults: () => ({
    size: 200, segments: 96,
    heights: null as any,       // Float32Array base64 (generated lazily)
    colors: null as any,        // Uint8Array base64 vertex splat colors
    layerTextures: [null, null, null] as any,  // asset ids (max 3 + base color)
    baseColor: '#6b7d52', layerTiling: 12,
    collider: true, smoothNormals: true,
  }),
  schema: [
    n('size', 'Size (m)', 200, 20, 1000, 10),
    n('segments', 'Resolution', 96, 16, 192, 16),
    b('collider', 'Physics Collider', true),
    col('baseColor', 'Base Color', '#6b7d52'),
    a('layerTextures.0', 'Layer 1 (R)', 'texture'), a('layerTextures.1', 'Layer 2 (G)', 'texture'), a('layerTextures.2', 'Layer 3 (B)', 'texture'),
    n('layerTiling', 'Layer Tiling', 12, 1, 64, 1),
  ],
});

defineComponent({
  type: 'Water', label: 'Water', category: 'environment', icon: 'water',
  description: 'Animated translucent water plane.',
  defaults: () => ({ size: 1000, color: '#2a6f8e', opacity: 0.72, waveHeight: 0.08, waveSpeed: 1.1 }),
  schema: [n('size', 'Size (m)', 1000, 10, 5000, 10), col('color', 'Color', '#2a6f8e'), n('opacity', 'Opacity', 0.72, 0.1, 1, 0.02), n('waveHeight', 'Wave Height', 0.08, 0, 2, 0.02), n('waveSpeed', 'Wave Speed', 1.1, 0, 5, 0.1)],
});

defineComponent({
  type: 'Foliage', label: 'Foliage (instanced)', category: 'environment', icon: 'tree',
  description: 'Instanced mesh scatter (grass, rocks, bushes) driven by terrain height. Painted with the foliage brush.',
  defaults: () => ({ meshAsset: null, instances: [] as any[], density: 1, randomRotation: true, randomScale: 0.25, alignToGround: true }),
  schema: [a('meshAsset', 'Mesh Asset', 'model'), n('density', 'Density', 1, 0.1, 10, 0.1), n('randomScale', 'Scale Jitter', 0.25, 0, 1, 0.05), b('randomRotation', 'Random Rotation', true)],
});

// ================================= AUDIO ===================================

defineComponent({
  type: 'AudioSource', label: 'Audio Source', category: 'audio', icon: 'audio',
  description: 'Plays a clip — 2D (music/UI) or 3D positional sound.',
  defaults: () => ({ clip: null, autoplay: true, loop: false, volume: 0.8, spatial: false, minDistance: 2, maxDistance: 40, rolloff: 1.5, channel: 'sfx' }),
  schema: [
    a('clip', 'Audio Clip', 'audio'),
    b('autoplay', 'Play On Start', true), b('loop', 'Loop', false),
    n('volume', 'Volume', 0.8, 0, 1, 0.05),
    b('spatial', '3D Spatial', false),
    n('minDistance', 'Min Distance', 2, 0.1, 50, 0.1), n('maxDistance', 'Max Distance', 40, 1, 300, 1), n('rolloff', 'Rolloff', 1.5, 0.1, 4, 0.1),
    e('channel', 'Channel', ['sfx', 'music'], 'sfx'),
  ],
});

// ============================ ANIMATION / LOGIC ============================

defineComponent({
  type: 'Animator', label: 'Animator', category: 'logic', icon: 'play',
  description: 'Animation state machine for imported model clips (idle/walk/run/jump/attack) with parameter-driven transitions.',
  defaults: () => ({
    states: [
      { name: 'Idle', clip: 'idle', speed: 1, loop: true },
      { name: 'Walk', clip: 'walk', speed: 1, loop: true },
      { name: 'Run', clip: 'run', speed: 1, loop: true },
      { name: 'Jump', clip: 'jump', speed: 1, loop: false },
    ] as any[],
    initialState: 'Idle',
    autoLocomotion: true,            // maps speed -> walk/run automatically
    crossfade: 0.22,
  }),
  schema: [
    e('initialState', 'Initial State', ['Idle', 'Walk', 'Run', 'Jump'], 'Idle'),
    b('autoLocomotion', 'Auto Locomotion', true),
    n('crossfade', 'Crossfade (s)', 0.22, 0, 1.5, 0.02),
  ],
});

defineComponent({
  type: 'Script', label: 'Script', category: 'scripting', icon: 'code',
  description: 'Attaches a user script (JS class with lifecycle hooks) to this object.',
  defaults: () => ({ script: null, props: {} as Record<string, any> }),
  schema: [],
});

defineComponent({
  type: 'VisualScript', label: 'Visual Script Graph', category: 'scripting', icon: 'flow',
  description: 'Node-based gameplay logic: events → conditions → actions without code.',
  defaults: () => ({ graph: null }),
  schema: [],
});

defineComponent({
  type: 'SaveSystem', label: 'Save System', category: 'gameplay', icon: 'save',
  description: 'Persists player position, health, inventory & time under a save key. Autosave optional.',
  defaults: () => ({ saveKey: 'nexus_save', autosaveSeconds: 0, includeTime: true }),
  schema: [{ key: 'saveKey', label: 'Save Key', type: 'string' }, n('autosaveSeconds', 'Autosave (s, 0=off)', 0, 0, 600, 5)],
});

defineComponent({
  type: 'GameRules', label: 'Game Rules', category: 'gameplay', icon: 'sliders',
  description: 'Win / lose conditions and respawn behaviour.',
  defaults: () => ({
    respawnOnDeath: true, respawnSeconds: 3, respawnPoint: null as any,
    loseWhenPlayerDies: true, winWhenEnemiesKilled: 0, winWhenItemCollected: null, winWhenItemAmount: 1,
    winWhenTimeSurvived: 0,
  }),
  schema: [
    b('respawnOnDeath', 'Respawn On Death', true), n('respawnSeconds', 'Respawn Delay (s)', 3, 0, 60, 0.5),
    { key: 'respawnPoint', label: 'Respawn Point', type: 'objectref' },
    b('loseWhenPlayerDies', 'Lose When Player Dies', true),
    n('winWhenEnemiesKilled', 'Win: Enemies Killed', 0, 0, 10000, 1),
    { key: 'winWhenItemCollected', label: 'Win: Collect Item', type: 'string' },
    n('winWhenTimeSurvived', 'Win: Survive (s, 0=off)', 0, 0, 100000, 10),
  ],
});
