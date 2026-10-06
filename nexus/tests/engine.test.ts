// ============================================================================
// NEXUS GAME STUDIO — automated test suite
// Real functional tests: engine ops, physics, scripting, visual scripting,
// terrain, AI planner, AI debugger, templates, build pipeline, server API.
// Run:  npm test
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createEmptyProject, gameObject, uid, findObject, cloneData,
} from '../Engine/core/types';
import {
  addGameObject, addComponent, duplicateGameObject, removeGameObject,
  createScriptAsset, validateProject, addAsset, createPrefabFrom, addScene,
} from '../Engine/core/ops';
import { PhysicsWorld } from '../Engine/physics/physics';
import { compileScript, parsePropAnnotations, createNexusApi, safeHook } from '../Engine/scripting/runtime';
import { VsGraphRuntime } from '../Engine/visualscript/interpreter';
import { generateIsland, sampleHeight, applyBrush, encodeFloats, decodeFloats, encodeBytes, decodeBytes } from '../Engine/terrain/terrain';
import { planFromText, buildGamePlan } from '../AIAgent/planner';
import { diagnoseProblem, diagnoseGameplayBug } from '../AIAgent/debugger';
import { TEMPLATES, templateIslandSurvival, templateTopDown, template3dGame } from '../Templates/index';
import { store } from '../Editor/store';
import { runBuild } from '../BuildSystem/pipeline';

// ---------------------------------------------------------------- helpers ----

const asProject = () => store.project!;

function withProject(name: string, fn: () => void) {
  const p = createEmptyProject(name);
  (store as any).project = p;
  (store as any).sceneId = p.scenes[0].id;
  fn();
}

async function withProjectAsync(name: string, fn: () => Promise<void>) {
  const p = createEmptyProject(name);
  (store as any).project = p;
  (store as any).sceneId = p.scenes[0].id;
  await fn();
}

// ------------------------------------------------------------- core / ops ----

describe('engine: project & scene ops', () => {
  it('creates a valid empty project with a default scene', () => {
    const p = createEmptyProject('Test');
    expect(p.scenes).toHaveLength(1);
    expect(p.settings.entrySceneId).toBe(p.scenes[0].id);
    expect(validateProject(p).filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('adds objects with components and maintains hierarchy', () => {
    withProject('Ops', () => {
      const p = asProject();
      const parent = addGameObject(p, p.scenes[0].id, 'Parent');
      const child = addGameObject(p, p.scenes[0].id, 'Child', { parent: parent.id });
      expect(child.parent).toBe(parent.id);
      expect(p.scenes[0].objects).toHaveLength(2);
      addComponent(p, p.scenes[0].id, child.id, 'MeshRenderer', { mesh: 'Cube' });
      expect(child.components.some(c => c.type === 'MeshRenderer' && (c as any).mesh === 'Cube')).toBe(true);
      // component defaults from the registry are applied
      const health = addComponent(p, p.scenes[0].id, child.id, 'Health');
      expect((health as any).maxHealth).toBeGreaterThan(0);
    });
  });

  it('duplicate deep-copies the subtree with fresh ids', () => {
    withProject('Dup', () => {
      const p = asProject();
      const a = addGameObject(p, p.scenes[0].id, 'A');
      addComponent(p, p.scenes[0].id, a.id, 'Health', { max: 55 });
      const b = addGameObject(p, p.scenes[0].id, 'B', { parent: a.id });
      const dup = duplicateGameObject(p, p.scenes[0].id, a.id);
      expect(dup).not.toBeNull();
      expect(dup!.id).not.toBe(a.id);
      expect(dup!.name).toMatch(/A/);
      const dupChild = p.scenes[0].objects.find(o => o.parent === dup!.id);
      expect(dupChild).toBeDefined();
      expect(dupChild!.id).not.toBe(b.id);
      const dupHealth: any = dup!.components.find(c => c.type === 'Health');
      expect(dupHealth.max).toBe(55);
    });
  });

  it('removes an object together with its subtree', () => {
    withProject('Rm', () => {
      const p = asProject();
      const a = addGameObject(p, p.scenes[0].id, 'A');
      const b = addGameObject(p, p.scenes[0].id, 'B', { parent: a.id });
      const c = addGameObject(p, p.scenes[0].id, 'C');
      removeGameObject(p, p.scenes[0].id, a.id);
      expect(findObject(p.scenes[0], a.id)).toBeFalsy();
      expect(findObject(p.scenes[0], b.id)).toBeFalsy(); // child removed with parent
      expect(findObject(p.scenes[0], c.id)).toBeTruthy(); // unrelated object untouched
    });
  });

  it('creates prefabs from subtrees and re-instantiates them with id remap', () => {
    withProject('Pf', () => {
      const p = asProject();
      const a = addGameObject(p, p.scenes[0].id, 'Enemy');
      addComponent(p, p.scenes[0].id, a.id, 'NPC', { role: 'enemy' });
      const sub = addGameObject(p, p.scenes[0].id, 'Weapon', { parent: a.id });
      const prefab = createPrefabFrom(p, p.scenes[0].id, a.id, 'EnemyPrefab');
      expect(prefab.type).toBe('prefab');
      expect(prefab.data).toHaveLength(2); // root + child captured
      expect(prefab.data[0].components.some((c: any) => c.type === 'NPC')).toBe(true);
      expect(prefab.data.some((o: any) => o.id === sub.id)).toBe(true);
      // project still validates with the prefab present
      expect(validateProject(p).filter(i => i.severity === 'error')).toHaveLength(0);
    });
  });

  it('script assets compile and attach via @prop', () => {
    withProject('Scr', () => {
      const p = asProject();
      const id = createScriptAsset(p, 'Rotator', 'class Rotator extends Nexus.Component {\n  onStart(){ this.done = true; }\n}');
      expect(p.scripts[id].name).toBe('Rotator');
      const compiled = compileScript(id, 'Rotator', p.scripts[id].source, () => createNexusApi({ log() { }, warn() { }, error() { }, events: { on() { } } }, {}, () => { }));
      expect(compiled.problem).toBeNull();
      expect(compiled.cls).not.toBeNull();
    });
  });

  it('validateProject catches missing assets and broken entry scene', () => {
    const p = createEmptyProject('V');
    p.settings.entrySceneId = 'nope';
    expect(validateProject(p).some(i => i.severity === 'error')).toBe(true);
    p.settings.entrySceneId = p.scenes[0].id;
    const go = addGameObject(p, p.scenes[0].id, 'X');
    go.components.push({ type: 'MeshRenderer', mesh: 'Cube', materialAsset: 'missing' } as any);
    expect(validateProject(p).some(i => i.message.includes('missing asset'))).toBe(true);
  });

  it('addScene creates navigable extra scenes', () => {
    const p = createEmptyProject('S');
    const s2 = addScene(p, 'Level2');
    expect(p.scenes).toHaveLength(2);
    expect(s2.objects).toBeDefined();
  });
});

// ---------------------------------------------------------------- physics ----

describe('physics: cannon-es world', () => {
  it('dynamic bodies fall under gravity and land on static ground', () => {
    const world = new PhysicsWorld();
    const ground = world.makeBody({
      objectId: 'g',
      collider: { shape: 'box', size: { x: 50, y: 1, z: 50 } },
      rigid: null, position: { x: 0, y: 0, z: 0 },
    });
    world.addBody(ground, 'g');
    const ball = world.makeBody({
      objectId: 'b',
      collider: { shape: 'sphere', radius: 0.5 },
      rigid: { mass: 1, lockRotation: true },
      position: { x: 0, y: 8, z: 0 },
    });
    world.addBody(ball, 'b');
    for (let i = 0; i < 240; i++) world.step(1 / 60);
    expect(ball.position.y).toBeLessThan(1.6);   // came down
    expect(ball.position.y).toBeGreaterThan(0.8); // resting on ground (top at y=0.5)
  });

  it('triggers detect overlap without blocking movement', () => {
    const world = new PhysicsWorld();
    const events: string[] = [];
    world.onContact = (a, b, started) => events.push(`${started ? 'begin' : 'end'}:${a}:${b}`);
    const trigger = world.makeBody({
      objectId: 't',
      collider: { shape: 'box', size: { x: 2, y: 2, z: 2 }, isTrigger: true },
      rigid: null, position: { x: 0, y: 0, z: 0 },
    });
    world.addBody(trigger, 't');
    const ball = world.makeBody({
      objectId: 'b',
      collider: { shape: 'sphere', radius: 0.4 },
      rigid: { mass: 1, lockRotation: true },
      position: { x: 0, y: 6, z: 0 },
    });
    world.addBody(ball, 'b');
    for (let i = 0; i < 300; i++) world.step(1 / 60);
    expect(events.some(e => e.startsWith('begin'))).toBe(true);
    expect(ball.position.y).toBeLessThan(-2); // fell through the trigger (no collision response)
  });

  it('raycast hits bodies and can skip a specific object', () => {
    const world = new PhysicsWorld();
    const ground = world.makeBody({
      objectId: 'g',
      collider: { shape: 'box', size: { x: 50, y: 1, z: 50 } },
      rigid: null, position: { x: 0, y: 0, z: 0 },
    });
    world.addBody(ground, 'g');
    const hit = world.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -10, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit!.gameObjectId).toBe('g');
    const skip = world.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -10, z: 0 }, 'g');
    expect(skip).toBeNull();
  });

  it('heightfield colliders support terrain standing', () => {
    const world = new PhysicsWorld();
    const n = 17;
    const heights = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) heights[i] = (i % n) * 0.1; // gentle slope
    world.addHeightfield([...heights], 50, 16, 'terrain');
    const body = world.makeBody({
      objectId: 'walker',
      collider: { shape: 'sphere', radius: 0.5 },
      rigid: { mass: 70, lockRotation: true },
      position: { x: 0, y: 10, z: 0 },
    });
    world.addBody(body, 'walker');
    for (let i = 0; i < 400; i++) world.step(1 / 60);
    expect(body.position.y).toBeLessThan(10); // it fell
    expect(body.position.y).toBeGreaterThan(-2); // and did not fall through the heightfield
  });
});

// -------------------------------------------------------------- scripting ----

describe('scripting: compile & sandbox', () => {
  const api = () => createNexusApi(
    { log() { }, warn() { }, error() { }, find: () => null, findByTag: () => [], events: { on() { }, emit() { } }, save() { }, load: () => null },
    { name: 'GO' }, () => { },
  );

  it('compiles and runs a valid script class', () => {
    const compiled = compileScript('s1', 'Test',
      'class Test extends Nexus.Component {\n  onStart(){ this.started = true; }\n}', api);
    expect(compiled.problem).toBeNull();
    expect(compiled.cls).not.toBeNull();
    const inst: any = new compiled.cls!();
    inst.onStart();
    expect(inst.started).toBe(true);
  });

  it('reports syntax errors with corrected line numbers', () => {
    const src = 'class B extends Nexus.Component {\n  onStart(){\n    this.,x = 1;\n  }\n}';
    const compiled = compileScript('s2', 'B', src, api);
    expect(compiled.problem).not.toBeNull();
    expect(compiled.problem!.line).toBe(3);
    expect(compiled.problem!.severity).toBe('error');
  });

  it('detects a missing class and suggests the fix', () => {
    const compiled = compileScript('s3', 'NoClass', 'const x = 1;', api);
    expect(compiled.problem).not.toBeNull();
    expect(compiled.problem!.message).toContain('class');
  });

  it('runtime errors inside hooks are captured as problems, not crashes', () => {
    const captured: any[] = [];
    const api2 = () => createNexusApi(
      { log() { }, warn() { }, error() { }, events: { on() { }, emit() { } } },
      { name: 'GO' },
      (p) => captured.push(p),
    );
    const compiled = compileScript('s4', 'Boom', 'class Boom extends Nexus.Component {\n  onUpdate(dt){ this.explode(); }\n}', api2);
    expect(compiled.problem).toBeNull();
    const inst: any = new compiled.cls!();
    expect(() => inst.onUpdate(0.016)).toThrow(); // raw call throws…
    // …but through safeHook it is captured:
    const safe = safeHook(inst.onUpdate, () => { }, (e: any) => captured.push({ message: e.message }));
    expect(() => safe(0.016)).not.toThrow();
    expect(captured.length).toBe(1);
  });

  it('parses @prop annotations for the Inspector', () => {
    const props = parsePropAnnotations('/** @prop {number} speed = 3 How fast */\nclass A {}');
    expect(props).toHaveLength(1);
    expect(props[0].key).toBe('speed');
    expect(props[0].type).toBe('number');
    expect(props[0].def).toBe(3);
    expect(props[0].label).toBe('How fast');
  });
});

// ---------------------------------------------------------- visual script ----

describe('visual scripting: interpreter', () => {
  function engineStub() {
    const calls: string[] = [];
    return {
      calls,
      engine: {
        time: { now: 0 },
        log: (m: string) => calls.push(`log:${m}`),
        variables: {},
        player: null,
        events: { on: () => { }, emit: (e: string) => calls.push(`emit:${e}`) },
        getGameObject: () => null,
        audio: { play2D: (id: string) => calls.push(`sound:${id}`) },
        ui: { showMessage: (m: string) => calls.push(`msg:${m}`) },
      },
    };
  }

  it('executes event → action chains (OnStart → Log)', () => {
    const { calls, engine } = engineStub();
    const graph = {
      nodes: [
        { id: 'n1', type: 'OnStart' },
        { id: 'n2', type: 'Log', params: { message: 'hello' } },
      ],
      links: [{ from: { node: 'n1', pin: 0, kind: 'exec' }, to: { node: 'n2', pin: 0, kind: 'exec' } }],
    };
    const rt = new VsGraphRuntime(graph, { engine, gameObject: null, self: null });
    rt.start();
    expect(calls).toContain('log:hello');
  });

  it('Branch routes exec flow by a data condition', () => {
    const { calls, engine } = engineStub();
    const graph = {
      nodes: [
        { id: 'e', type: 'OnStart' },
        { id: 'b', type: 'Branch' },
        { id: 'l1', type: 'Log', params: { message: 'true-path' } },
        { id: 'l2', type: 'Log', params: { message: 'false-path' } },
        { id: 'n1', type: 'Number', params: { value: 5 } },
        { id: 'n2', type: 'Number', params: { value: 2 } },
        { id: 'cmp', type: 'Compare', params: { op: '>' } },
      ],
      links: [
        { from: { node: 'e', pin: 0, kind: 'exec' }, to: { node: 'b', pin: 0, kind: 'exec' } },
        { from: { node: 'b', pin: 0, kind: 'exec' }, to: { node: 'l1', pin: 0, kind: 'exec' } },
        { from: { node: 'b', pin: 1, kind: 'exec' }, to: { node: 'l2', pin: 0, kind: 'exec' } },
        { from: { node: 'n1', pin: 0, kind: 'data' }, to: { node: 'cmp', pin: 0, kind: 'data' } },
        { from: { node: 'n2', pin: 0, kind: 'data' }, to: { node: 'cmp', pin: 1, kind: 'data' } },
        { from: { node: 'cmp', pin: 0, kind: 'data' }, to: { node: 'b', pin: 0, kind: 'data' } },
      ],
    };
    const rt = new VsGraphRuntime(graph, { engine, gameObject: null, self: null });
    rt.start();
    expect(calls.filter(c => c === 'log:true-path')).toHaveLength(1); // exactly once — no double-fire
    expect(calls).not.toContain('log:false-path');
  });

  it('Delayed actions fire after the delay elapses', () => {
    const { calls, engine } = engineStub();
    const graph = {
      nodes: [
        { id: 'e', type: 'OnStart' },
        { id: 'd', type: 'Delay', params: { seconds: 0.5 } },
        { id: 'l', type: 'Log', params: { message: 'after-delay' } },
      ],
      links: [
        { from: { node: 'e', pin: 0, kind: 'exec' }, to: { node: 'd', pin: 0, kind: 'exec' } },
        { from: { node: 'd', pin: 0, kind: 'exec' }, to: { node: 'l', pin: 0, kind: 'exec' } },
      ],
    };
    const rt = new VsGraphRuntime(graph, { engine, gameObject: null, self: null });
    rt.start();
    expect(calls).not.toContain('log:after-delay');
    engine.time.now = 0.4; rt.update(0.4);
    expect(calls).not.toContain('log:after-delay');
    engine.time.now = 0.7; rt.update(0.3);
    expect(calls).toContain('log:after-delay');
    expect(calls.filter(c => c === 'log:after-delay')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- terrain ----

describe('terrain: generation & sculpting', () => {
  it('generates an island (center high, edge below waterline)', () => {
    const { heights, colors } = generateIsland({ size: 100, segments: 48, maxHeight: 12, seed: 42 });
    expect(heights.length).toBe(49 * 49);
    expect(colors.length).toBe(49 * 49 * 3);
    const center = heights[24 * 49 + 24];
    const edge = heights[24 * 49 + 1];
    expect(center).toBeGreaterThan(edge);
    expect(edge).toBeLessThan(1.5);
  });

  it('samples heights bilinearly and rejects out-of-bounds', () => {
    const { heights } = generateIsland({ size: 100, segments: 48, maxHeight: 12, seed: 42 });
    const h = sampleHeight(heights, 100, 48, 10, 10);
    expect(typeof h).toBe('number');
    expect(sampleHeight(heights, 100, 48, 999, 999)).toBeNull();
  });

  it('brushes modify heights and colors', () => {
    const n = 33;
    const heights = new Float32Array(n * n);
    const colors = new Uint8Array(n * n * 3);
    const changed = applyBrush(heights, colors, { op: 'raise', worldX: 0, worldZ: 0, radius: 5, strength: 1, size: 100, segments: 32 });
    expect(changed).toBe(true);
    expect(heights[16 * 33 + 16]).toBeGreaterThan(0);
  });

  it('encodes/decodes terrain data losslessly (base64)', () => {
    const { heights, colors } = generateIsland({ size: 60, segments: 24, maxHeight: 8, seed: 7 });
    const h2 = decodeFloats(encodeFloats(heights), heights.length);
    let maxErr = 0;
    for (let i = 0; i < heights.length; i++) maxErr = Math.max(maxErr, Math.abs(heights[i] - h2[i]));
    expect(maxErr).toBeLessThan(0.01);
    const c2 = decodeBytes(encodeBytes(colors), colors.length);
    expect(Buffer.compare(Buffer.from(colors), Buffer.from(c2))).toBe(0);
  });
});

// ------------------------------------------------------------ AI planner ----

describe('AI: intent planner (deterministic routing)', () => {
  it('creates a real third-person player when the plan executes', async () => {
    await withProjectAsync('P', async () => {
      const m = planFromText('Create a third-person player');
      expect(m.intent).toBe('create-player');
      const ctx = { results: {}, vars: {} };
      for (const s of m.plan!.steps) await s.run(ctx);
      const player = asProject().scenes[0].objects.find(o => o.name === 'Player');
      expect(player).toBeDefined();
      const types = player!.components.map(c => c.type);
      expect(types).toContain('ThirdPersonController');
      expect(types).toContain('RigidBody');
      expect(types).toContain('Health');
      expect(player!.tags).toContain('player');
    });
  });

  it('creates a real zombie enemy when the plan executes', async () => {
    await withProjectAsync('P', async () => {
      const m = planFromText('Add a zombie enemy');
      expect(m.intent).toBe('create-npc');
      const ctx = { results: {}, vars: {} };
      for (const s of m.plan!.steps) await s.run(ctx);
      const p = asProject();
      const zombie = p.scenes[0].objects.find(o => o.components.some(c => c.type === 'NPC'));
      expect(zombie).toBeDefined();
      const npc: any = zombie!.components.find(c => c.type === 'NPC');
      expect(/zombie|enemy/i.test(zombie!.name)).toBe(true);
      expect(zombie!.tags).toContain('enemy');
      expect(npc.chaseSpeed).toBeGreaterThan(0);
      // a prefab asset exists for reuse
      expect(p.assets.some(a => a.type === 'prefab')).toBe(true);
    });
  });

  it('wires a real night-time spawner when an enemy exists (and reports honestly when not)', async () => {
    await withProjectAsync('P', async () => {
      // no enemy yet → the plan reports it cannot spawn (honest, no fake success)
      const empty = planFromText('Make zombies spawn at night');
      const summaries: string[] = [];
      for (const s of empty.plan!.steps) summaries.push(String((await s.run({ results: {}, vars: {} })).summary));
      expect(summaries.some(r => /no enemy/i.test(r))).toBe(true);

      // create the enemy first, then night-spawn composes on top of it
      const npc = planFromText('Add a zombie enemy');
      for (const s of npc.plan!.steps) await s.run({ results: {}, vars: {} });
      const m = planFromText('Make zombies spawn at night');
      expect(m.intent).toBe('night-spawn');
      for (const s of m.plan!.steps) await s.run({ results: {}, vars: {} });
      const spawnerGo = asProject().scenes[0].objects.find(o => o.components.some(c => c.type === 'Spawner'));
      expect(spawnerGo).toBeDefined();
      const spawner: any = spawnerGo!.components.find(c => c.type === 'Spawner');
      expect(spawner.mode).toBe('night');
      expect(spawner.prefab).toBeTruthy();
      // day/night cycle was ensured too
      expect(asProject().scenes[0].objects.some(o => o.components.some(c => c.type === 'DayNightCycle'))).toBe(true);
    });
  });

  it('routes "The player cannot jump" to the AI debugger', () => {
    withProject('P', () => {
      const m = planFromText('The player cannot jump');
      expect(m.handler).toBe('debugger');
    });
  });

  it('builds a structured GAME PLAN for open-ended game requests', () => {
    withProject('P', () => {
      const plan = buildGamePlan('Create a realistic third-person survival game on a large island');
      const sections = plan.sections.map(s => s.name);
      for (const want of ['World', 'Player', 'Gameplay', 'AI', 'UI']) expect(sections).toContain(want);
      expect(plan.steps.length).toBeGreaterThan(10);
    });
  });

  it('unknown requests return the honest "unknown" intent (no fake plan)', () => {
    withProject('P', () => {
      const m = planFromText('What is the meaning of life?');
      expect(m.intent).toBe('unknown');
      expect(m.plan).toBeNull();
    });
  });
});

// ----------------------------------------------------------- AI debugger ----

describe('AI: debugger (diagnose → explain → fix)', () => {
  it('finds a zero jump force as the cause of "cannot jump" and offers a real fix', () => {
    withProject('D', () => {
      const p = asProject();
      const player = addGameObject(p, p.scenes[0].id, 'Player');
      addComponent(p, p.scenes[0].id, player.id, 'ThirdPersonController', { jumpForce: 0 });
      addComponent(p, p.scenes[0].id, player.id, 'Collider', { shape: 'capsule', radius: 0.4, size: { x: 0.8, y: 1.7, z: 0.8 } });
      addComponent(p, p.scenes[0].id, player.id, 'RigidBody', { mass: 70, lockRotation: true });
      const diags = diagnoseGameplayBug('The player cannot jump');
      const d = diags.find(x => /jump force is zero/i.test(x.title));
      expect(d).toBeDefined();
      expect(d!.cause.length).toBeGreaterThan(10);
      expect(d!.solution.length).toBeGreaterThan(10);
      // applying the fix actually repairs the component
      const res: any = d!.apply();
      expect(res.ok).toBe(true);
      const comp: any = player.components.find(c => c.type === 'ThirdPersonController');
      expect(comp.jumpForce).toBeGreaterThan(0);
    });
  });

  it('detects missing physics components', () => {
    withProject('D2', () => {
      const p = asProject();
      const player = addGameObject(p, p.scenes[0].id, 'Player');
      addComponent(p, p.scenes[0].id, player.id, 'FirstPersonController', {});
      const diags = diagnoseGameplayBug('the player cannot jump');
      expect(diags.some(d => /missing/i.test(d.title) || /missing/i.test(d.cause))).toBe(true);
    });
  });

  it('diagnoses script problems (undefined property access) with a concrete fix', () => {
    withProject('D3', () => {
      const p = asProject();
      const scriptId = createScriptAsset(p, 'Rotator', 'class Rotator extends Nexus.Component {\n  onUpdate(dt){ this.gameObjekt.move(0,dt,0); }\n}');
      const diag = diagnoseProblem({ id: 'x', scriptId, file: 'Rotator.js', line: 2, message: "Cannot read properties of undefined (reading 'move')", severity: 'error' });
      expect(diag).not.toBeNull();
      expect(diag!.severity).toBe('error');
      expect(diag!.filesAffected.length).toBeGreaterThan(0);
    });
  });
});

// -------------------------------------------------------------- templates ----

describe('game templates', () => {
  it('Island Survival template is complete and playable', () => {
    const p = templateIslandSurvival();
    const scene = p.scenes[0];
    const types = new Set(scene.objects.flatMap(o => o.components.map(c => c.type)));
    for (const want of ['ThirdPersonController', 'NPC', 'Spawner', 'DayNightCycle', 'Pickup', 'Terrain', 'Water', 'SaveSystem', 'Health']) {
      expect(types.has(want), `missing component ${want}`).toBe(true);
    }
    expect(p.uiDocuments.some(d => d.name === 'HUD')).toBe(true);
    expect(p.uiDocuments.some(d => d.name === 'MainMenu')).toBe(true);
    expect(p.recipes.length).toBeGreaterThanOrEqual(3);
    expect(validateProject(p).filter(i => i.severity === 'error')).toHaveLength(0);
    // the spawner points at a valid prefab
    const spawnerGo = scene.objects.find(o => o.components.some(c => c.type === 'Spawner'))!;
    const spawner: any = spawnerGo.components.find(c => c.type === 'Spawner');
    expect(p.assets.find(a => a.id === spawner.prefab)?.type).toBe('prefab');
  });

  it('every template generates a valid project', () => {
    for (const t of TEMPLATES) {
      const p = t.build(`Test${t.id}`);
      const errors = validateProject(p).filter(i => i.severity === 'error');
      expect(errors, `${t.id}: ${errors.map(e => e.message).join('; ')}`).toHaveLength(0);
      expect(p.scenes.length).toBeGreaterThan(0);
      expect(p.settings.entrySceneId).toBe(p.scenes[0].id);
    }
  });

  it('top-down template has walls and a player', () => {
    const p = templateTopDown('TD');
    expect(p.scenes[0].objects.some(o => o.name.startsWith('Wall'))).toBe(true);
    expect(p.scenes[0].objects.some(o => o.components.some(c => c.type === 'TopDownController'))).toBe(true);
  });

  it('3D Game base template has ground, light and camera', () => {
    const p = template3dGame('B');
    const types = new Set(p.scenes[0].objects.flatMap(o => o.components.map(c => c.type)));
    expect(types.has('Light')).toBe(true);
    expect(p.scenes[0].objects.some(o => /ground|floor/i.test(o.name))).toBe(true);
  });
});

// ------------------------------------------------------------ build system ----

describe('build system: full pipeline', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-build-'));
  const projectId = 'buildtest';

  beforeAll(() => {
    const dir = path.join(tmp, projectId);
    fs.mkdirSync(path.join(dir, 'Content'), { recursive: true });
    const project = templateIslandSurvival('BuildTest');
    project.id = projectId;
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project));
    fs.writeFileSync(path.join(dir, 'Content', 'note.txt'), 'hello content');
  });

  it('builds a standalone game with a valid embedded payload', () => {
    // use the real runtime bundle when present; otherwise a stub (CI before editor build)
    const realBundle = path.resolve('www-runtime/runtime.js');
    const stub = path.join(tmp, 'runtime-stub.js');
    fs.writeFileSync(stub, 'window.NEXUS_BOOT = window.NEXUS_BOOT || function(){ console.log("boot", Object.keys(window.NEXUS_GAME).length); };');
    const bundle = fs.existsSync(realBundle) ? realBundle : stub;

    const res = runBuild(tmp, projectId, { mode: 'Release', name: 'BuildTest' }, bundle);
    for (const line of res.log.slice(0, 6)) console.log('   ', line);
    expect(res.ok).toBe(true);

    const html = fs.readFileSync(res.htmlPath!, 'utf8');
    expect(html).toContain('NEXUS_RUNTIME');
    expect(html).toContain('window.NEXUS_GAME');
    // payload round-trips
    const payload = html.match(/window\.NEXUS_GAME = (\{[\s\S]*?\});\n<\/script>/)![1];
    const data = JSON.parse(payload.replace(/<\\\/script/g, '</script'));
    expect(data.project.name).toBe('BuildTest');
    expect(data.project.scenes.length).toBeGreaterThan(0);
    // the whole project data is embedded
    expect(JSON.stringify(data.project).length).toBeGreaterThan(5000);

    // launcher + electron packaging exist
    expect(fs.existsSync(path.join(res.outputPath!, 'Launch-BuildTest.bat'))).toBe(true);
    expect(fs.existsSync(path.join(res.outputPath!, 'Make-BuildTest-Exe.bat'))).toBe(true);
    expect(fs.existsSync(path.join(res.outputPath!, 'Runtime', 'electron-main.cjs'))).toBe(true);
    expect(fs.existsSync(path.join(res.outputPath!, 'Config', 'game.json'))).toBe(true);
    expect(fs.existsSync(path.join(res.outputPath!, 'build.log'))).toBe(true);
  });

  it('fails honestly on a broken project (validation error, not a fake success)', () => {
    const dir = path.join(tmp, 'broken');
    fs.mkdirSync(dir, { recursive: true });
    const project = templateIslandSurvival('Broken');
    project.id = 'broken';
    project.settings.entrySceneId = 'does-not-exist';
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project));
    const res = runBuild(tmp, 'broken', { mode: 'Release', name: 'Broken' }, path.join(tmp, 'runtime-stub.js'));
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.suggestedFix).toBeTruthy();
    expect(res.log.some(l => l.includes('FAILED'))).toBe(true);
  });

  it('fails honestly on script compile errors with file+line', () => {
    const dir = path.join(tmp, 'badscript');
    fs.mkdirSync(dir, { recursive: true });
    const project = templateIslandSurvival('BadScript');
    project.id = 'badscript';
    project.scripts['bad'] = { id: 'bad', name: 'Bad', source: 'class Bad extends Nexus.Component {\n  broken(,\n}' };
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project));
    const res = runBuild(tmp, 'badscript', { mode: 'Release', name: 'BadScript' }, path.join(tmp, 'runtime-stub.js'));
    expect(res.ok).toBe(false);
    expect(res.log.some(l => /Bad\.js line \d+/.test(l))).toBe(true);
  });
});

// ----------------------------------------------------------------- server ----

import { app, PROJECTS_ROOT } from '../Server/index';

describe('server: REST API (real HTTP)', () => {
  let server: any, base: string;

  beforeAll(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    // clean test project out of the real Projects dir
    fs.rmSync(path.join(PROJECTS_ROOT, 'servertest'), { recursive: true, force: true });
  });

  it('health endpoint responds', async () => {
    const r = await (await fetch(`${base}/api/health`)).json();
    expect(r.ok).toBe(true);
    expect(r.name).toBe('NEXUS GAME STUDIO');
  });

  it('creates, lists, saves and reloads a project', async () => {
    const project = templateIslandSurvival('ServerTest');
    project.id = 'servertest';
    let r = await fetch(`${base}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
    });
    expect(r.status).toBe(200);
    r = await fetch(`${base}/api/projects`);
    const list = await r.json();
    expect(list.some((p: any) => p.id === 'servertest' && p.name === 'ServerTest')).toBe(true);
    // mutate + save
    project.scenes[0].name = 'RenamedScene';
    r = await fetch(`${base}/api/projects/servertest`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
    });
    expect((await r.json()).ok).toBe(true);
    const reloaded = await (await fetch(`${base}/api/projects/servertest`)).json();
    expect(reloaded.scenes[0].name).toBe('RenamedScene');
  });

  it('uploads assets (multipart) and serves their binaries', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'application/octet-stream' }), 'test-model.glb');
    const r = await fetch(`${base}/api/projects/servertest/assets`, { method: 'POST', body: fd });
    const asset = await r.json();
    expect(asset.type).toBe('model');
    expect(asset.path).toBe('Content/test-model.glb');
    // the binary is fetchable at asset.path
    const bin = await fetch(`${base}/Projects/servertest/${asset.path}`);
    expect(bin.status).toBe(200);
    const buf = Buffer.from(await bin.arrayBuffer());
    expect(buf.length).toBe(5);
    expect(buf[0]).toBe(1);
  });

  it('snapshots save, list and restore', async () => {
    const project = await (await fetch(`${base}/api/projects/servertest`)).json();
    // snapshot A
    let r = await fetch(`${base}/api/projects/servertest/snapshots`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Snapshot A' }),
    });
    expect((await r.json()).ok).toBe(true);
    // change the project
    project.scenes[0].name = 'AfterSnapshot';
    await fetch(`${base}/api/projects/servertest`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
    });
    // list snapshots
    const snaps = await (await fetch(`${base}/api/projects/servertest/snapshots`)).json();
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    const snapA = snaps.find((s: any) => s.name === 'Snapshot A');
    expect(snapA).toBeDefined();
    // restore
    r = await fetch(`${base}/api/projects/servertest/snapshots/${snapA.id}/restore`, { method: 'POST' });
    expect((await r.json()).ok).toBe(true);
    const restored = await (await fetch(`${base}/api/projects/servertest`)).json();
    expect(restored.scenes[0].name).toBe('RenamedScene'); // pre-snapshot state
    // the restore itself created an auto snapshot
    const snaps2 = await (await fetch(`${base}/api/projects/servertest/snapshots`)).json();
    expect(snaps2.some((s: any) => s.name.includes('pre-restore'))).toBe(true);
  });

  it('AI status reports unconfigured until config is set', async () => {
    const st = await (await fetch(`${base}/api/ai/status`)).json();
    expect(st).toHaveProperty('configured');
    expect(st.model === null || typeof st.model === 'string').toBe(true);
    // invalid config is rejected honestly
    const r = await fetch(`${base}/api/ai/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'openai' }),
    });
    expect(r.status).toBe(400);
  });

  it('build endpoint runs the real pipeline over HTTP', async () => {
    // the endpoint uses www-runtime/runtime.js — use the real bundle when the
    // editor has been built; otherwise drop in a temporary stub and remove it after.
    const bundleDir = path.resolve('www-runtime');
    const bundle = path.join(bundleDir, 'runtime.js');
    let createdStub = false;
    if (!fs.existsSync(bundle)) {
      fs.mkdirSync(bundleDir, { recursive: true });
      fs.writeFileSync(bundle, 'window.NEXUS_BOOT=function(){};');
      createdStub = true;
    }
    try {
    const r = await fetch(`${base}/api/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'servertest', config: { mode: 'Release', name: 'ServerBuild' } }),
    });
    const res = await r.json();
    expect(res.ok, res.error).toBe(true);
    expect(fs.existsSync(res.htmlPath)).toBe(true);
    } finally {
      if (createdStub) fs.rmSync(bundle, { force: true });
    }
  }, 30000);
});
