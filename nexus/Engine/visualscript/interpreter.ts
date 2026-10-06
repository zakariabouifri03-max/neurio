// ============================================================================
// NEXUS ENGINE — Visual scripting
// Node registry (events / conditions / actions / variables / values) and the
// graph interpreter that executes them at runtime.
// ============================================================================

export interface VsNodeDef {
  type: string;
  label: string;
  category: 'event' | 'flow' | 'condition' | 'action' | 'variable' | 'value';
  color: string;
  /** exec outputs count (0 for pure data nodes) */
  execOut: number;
  dataIn: string[];   // data pin labels
  dataOut: string[];  // data pin labels
  params?: string[];  // editable params in the node
  paramDefs?: Record<string, { label: string; type: 'number' | 'string' | 'bool' | 'enum' | 'asset' | 'objectref'; options?: string[] }>;
  description: string;
}

const defs = new Map<string, VsNodeDef>();
export function defineNode(d: VsNodeDef) { defs.set(d.type, d); }
export function getNodeDef(type: string): VsNodeDef | undefined { return defs.get(type); }
export function allNodeDefs(): VsNodeDef[] { return [...defs.values()]; }

// --------------------------------- EVENTS -----------------------------------
const E = '#e05252';
defineNode({ type: 'OnStart', label: 'On Start', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: [], description: 'Fires once when play begins.' });
defineNode({ type: 'OnUpdate', label: 'On Update', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: ['Δt'], description: 'Fires every frame. Output Δt = delta time.' });
defineNode({ type: 'OnKeyDown', label: 'On Key Down', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: [], params: ['key'], paramDefs: { key: { label: 'Key', type: 'string' } }, description: 'Fires when a key is pressed (e.g. KeyF).' });
defineNode({ type: 'OnPlayerEnterTrigger', label: 'On Player Enter Trigger', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: [], params: ['triggerName'], paramDefs: { triggerName: { label: 'Trigger Name', type: 'string' } }, description: 'Fires when the player enters a trigger volume.' });
defineNode({ type: 'OnInteract', label: 'On Interact', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: [], description: 'Fires when the player interacts with this object.' });
defineNode({ type: 'OnNight', label: 'On Night', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: [], description: 'Fires when night begins.' });
defineNode({ type: 'OnDay', label: 'On Day', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: [], description: 'Fires when day begins.' });
defineNode({ type: 'OnPickup', label: 'On Pickup', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: ['item'], description: 'Fires when the player collects any pickup.' });
defineNode({ type: 'OnPlayerDied', label: 'On Player Died', category: 'event', color: E, execOut: 1, dataIn: [], dataOut: [], description: 'Fires when the player dies.' });

// ---------------------------------- FLOW ------------------------------------
const F = '#d9a441';
defineNode({ type: 'Branch', label: 'Branch', category: 'flow', color: F, execOut: 2, dataIn: ['condition'], dataOut: [], description: 'True → first output, False → second.' });
defineNode({ type: 'Delay', label: 'Delay', category: 'flow', color: F, execOut: 1, dataIn: ['seconds'], dataOut: [], params: ['seconds'], paramDefs: { seconds: { label: 'Seconds', type: 'number' } }, description: 'Waits, then continues.' });
defineNode({ type: 'Sequence', label: 'Sequence', category: 'flow', color: F, execOut: 2, dataIn: [], dataOut: [], description: 'Runs output A then output B.' });
defineNode({ type: 'Compare', label: 'Compare', category: 'condition', color: F, execOut: 0, dataIn: ['a', 'b'], dataOut: ['result'], params: ['op'], paramDefs: { op: { label: 'Op', type: 'enum', options: ['>', '<', '>=', '<=', '==', '!='] } }, description: 'Compares two numbers.' });

// --------------------------------- ACTIONS ----------------------------------
const A = '#3fa66a';
defineNode({ type: 'Log', label: 'Log', category: 'action', color: A, execOut: 1, dataIn: ['message'], dataOut: [], params: ['message'], paramDefs: { message: { label: 'Message', type: 'string' } }, description: 'Prints to the console panel.' });
defineNode({ type: 'SetObjectActive', label: 'Set Object Active', category: 'action', color: A, execOut: 1, dataIn: [], dataOut: [], params: ['target', 'active'], paramDefs: { target: { label: 'Object', type: 'objectref' }, active: { label: 'Active', type: 'bool' } }, description: 'Activates / deactivates a game object.' });
defineNode({ type: 'OpenDoor', label: 'Open / Close Door', category: 'action', color: A, execOut: 1, dataIn: [], dataOut: [], params: ['target', 'open'], paramDefs: { target: { label: 'Door', type: 'objectref' }, open: { label: 'Open', type: 'bool' } }, description: 'Opens or closes a Door component.' });
defineNode({ type: 'PlaySound', label: 'Play Sound', category: 'action', color: A, execOut: 1, dataIn: [], dataOut: [], params: ['clip', 'volume'], paramDefs: { clip: { label: 'Clip', type: 'asset' }, volume: { label: 'Volume', type: 'number' } }, description: 'Plays a 2D sound.' });
defineNode({ type: 'SpawnPrefab', label: 'Spawn Prefab', category: 'action', color: A, execOut: 1, dataIn: [], dataOut: [], params: ['prefab'], paramDefs: { prefab: { label: 'Prefab', type: 'asset' } }, description: 'Spawns a prefab at this object position.' });
defineNode({ type: 'DamagePlayer', label: 'Damage Player', category: 'action', color: A, execOut: 1, dataIn: ['amount'], dataOut: [], params: ['amount'], paramDefs: { amount: { label: 'Damage', type: 'number' } }, description: 'Deals damage to the player.' });
defineNode({ type: 'HealPlayer', label: 'Heal Player', category: 'action', color: A, execOut: 1, dataIn: ['amount'], dataOut: [], params: ['amount'], paramDefs: { amount: { label: 'Heal', type: 'number' } }, description: 'Heals the player.' });
defineNode({ type: 'GiveItem', label: 'Give Item', category: 'action', color: A, execOut: 1, dataIn: [], dataOut: [], params: ['item', 'amount'], paramDefs: { item: { label: 'Item', type: 'string' }, amount: { label: 'Amount', type: 'number' } }, description: 'Adds an item to player inventory.' });
defineNode({ type: 'DestroyObject', label: 'Destroy Object', category: 'action', color: A, execOut: 1, dataIn: [], dataOut: [], params: ['target'], paramDefs: { target: { label: 'Object', type: 'objectref' } }, description: 'Destroys a game object.' });
defineNode({ type: 'SetLightIntensity', label: 'Set Light Intensity', category: 'action', color: A, execOut: 1, dataIn: ['intensity'], dataOut: [], params: ['target', 'intensity'], paramDefs: { target: { label: 'Light Object', type: 'objectref' }, intensity: { label: 'Intensity', type: 'number' } }, description: 'Changes a light\'s intensity.' });
defineNode({ type: 'ShowMessage', label: 'Show Message', category: 'action', color: A, execOut: 1, dataIn: ['message'], dataOut: [], params: ['message', 'seconds'], paramDefs: { message: { label: 'Message', type: 'string' }, seconds: { label: 'Seconds', type: 'number' } }, description: 'Shows an on-screen message.' });
defineNode({ type: 'SetVariable', label: 'Set Variable', category: 'action', color: A, execOut: 1, dataIn: ['value'], dataOut: [], params: ['name'], paramDefs: { name: { label: 'Variable', type: 'string' } }, description: 'Sets a project variable.' });

// -------------------------------- VARIABLES ---------------------------------
const V = '#4f8fd9';
defineNode({ type: 'GetVariable', label: 'Get Variable', category: 'variable', color: V, execOut: 0, dataIn: [], dataOut: ['value'], params: ['name'], paramDefs: { name: { label: 'Variable', type: 'string' } }, description: 'Reads a project variable.' });
defineNode({ type: 'Number', label: 'Number', category: 'value', color: V, execOut: 0, dataIn: [], dataOut: ['value'], params: ['value'], paramDefs: { value: { label: 'Value', type: 'number' } }, description: 'Constant number.' });
defineNode({ type: 'String', label: 'Text', category: 'value', color: V, execOut: 0, dataIn: [], dataOut: ['value'], params: ['value'], paramDefs: { value: { label: 'Value', type: 'string' } }, description: 'Constant text.' });
defineNode({ type: 'Bool', label: 'Bool', category: 'value', color: V, execOut: 0, dataIn: [], dataOut: ['value'], params: ['value'], paramDefs: { value: { label: 'Value', type: 'bool' } }, description: 'Constant true/false.' });
defineNode({ type: 'Random', label: 'Random', category: 'value', color: V, execOut: 0, dataIn: ['min', 'max'], dataOut: ['value'], params: ['min', 'max'], paramDefs: { min: { label: 'Min', type: 'number' }, max: { label: 'Max', type: 'number' } }, description: 'Random number between min and max.' });

// ============================================================================
// Interpreter
// ============================================================================

export interface GraphCtx {
  engine: any;
  gameObject: any;
  self: any;
}

interface ScheduledCall { at: number; node: any; pin: number; graph: VsGraphRuntime; }

export class VsGraphRuntime {
  graph: any;
  ctx: GraphCtx;
  private nodesById = new Map<string, any>();
  private executedOnStart = false;
  private scheduled: ScheduledCall[] = [];
  private running = false;

  constructor(graph: any, ctx: GraphCtx) {
    this.graph = graph;
    this.ctx = ctx;
    for (const n of graph.nodes ?? []) this.nodesById.set(n.id, n);
  }

  start() {
    this.running = true;
    for (const n of this.graph.nodes ?? []) {
      if (n.type === 'OnStart') this.fireEventNode(n);
    }
    this.executedOnStart = true;
  }

  fireEvent(eventName: string, data: any, nodeFilter?: (n: any) => boolean) {
    if (!this.running) return;
    for (const n of this.graph.nodes ?? []) {
      if (n.type === eventName && (!nodeFilter || nodeFilter(n))) this.fireEventNode(n, data);
    }
  }

  update(dt: number) {
    if (!this.running) return;
    const now = (this.ctx.engine.time?.now ?? 0) * 1000;
    // run scheduled (delay) calls — continue the chain WITHOUT re-running the node itself
    const due = this.scheduled.filter(s => s.at <= now);
    this.scheduled = this.scheduled.filter(s => s.at > now);
    for (const s of due) {
      for (const t of this.execLinks(s.node.id, s.pin)) this.execute(t.node, undefined, 0);
    }
    for (const n of this.graph.nodes ?? []) {
      if (n.type === 'OnUpdate') this.fireEventNode(n, { dt });
    }
  }

  stop() { this.running = false; this.scheduled = []; }

  fireEventNode(node: any, data?: any) {
    // depth-limited execution to prevent infinite loops
    this.execFrom(node, data, 0);
  }

  private execFrom(node: any, data: any, depth: number) {
    if (depth > 64) return;
    const outPins = this.execLinks(node.id, 0);
    for (const target of outPins) {
      this.execute(target.node, data, depth + 1);
    }
  }

  private execLinks(nodeId: string, pinIndex: number): { node: any; pin: number }[] {
    const out: { node: any; pin: number }[] = [];
    for (const l of this.graph.links ?? []) {
      if (l.from.node === nodeId && l.from.pin === pinIndex && l.from.kind !== 'data') {
        const target = this.nodesById.get(l.to.node);
        if (target) out.push({ node: target, pin: l.to.pin });
      }
    }
    return out;
  }

  /** data links INTO a node's input pin: constant params or upstream nodes */
  private evalDataIn(node: any, pinIndex: number, data: any): any {
    // find link feeding this input
    for (const l of this.graph.links ?? []) {
      if (l.to.node === node.id && l.to.pin === pinIndex && l.to.kind === 'data') {
        const src = this.nodesById.get(l.from.node);
        if (!src) return undefined;
        return this.evalNode(src, data);
      }
    }
    return undefined; // fall back to node param
  }

  private evalNode(node: any, data: any): any {
    const p = node.params ?? {};
    switch (node.type) {
      case 'Number': return Number(p.value ?? 0);
      case 'String': return String(p.value ?? '');
      case 'Bool': return !!p.value;
      case 'Random': {
        const min = this.evalDataIn(node, 0, data) ?? Number(p.min ?? 0);
        const max = this.evalDataIn(node, 1, data) ?? Number(p.max ?? 1);
        return min + Math.random() * (max - min);
      }
      case 'GetVariable': return (this.ctx.engine.variables ?? {})[p.name ?? ''] ?? this.ctx.gameObject?.engine?.variables?.[p.name];
      case 'Compare': {
        const a = this.evalDataIn(node, 0, data) ?? Number(p.a ?? 0);
        const b = this.evalDataIn(node, 1, data) ?? Number(p.b ?? 0);
        switch (p.op ?? '>') {
          case '>': return a > b; case '<': return a < b; case '>=': return a >= b;
          case '<=': return a <= b; case '==': return a == b; case '!=': return a != b;
        }
        return false;
      }
      default: return undefined;
    }
  }

  private execute(node: any, data: any, depth: number): void {
    const p = node.params ?? {};
    const engine = this.ctx.engine;
    const go = this.ctx.gameObject;
    try {
      switch (node.type) {
        // ---- flow ----
        case 'Branch': {
          const cond = this.evalDataIn(node, 0, data) ?? !!(p as any).condition;
          const links = this.execLinks(node.id, cond ? 0 : 1);
          for (const t of links) this.execute(t.node, data, depth + 1);
          break;
        }
        case 'Delay': {
          const seconds = this.evalDataIn(node, 0, data) ?? Number(p.seconds ?? 1);
          const now = (engine.time?.now ?? 0) * 1000;
          // continue from this node's exec-out pin AFTER the delay (node itself does not re-run)
          this.scheduled.push({ at: now + seconds * 1000, node, pin: 0, graph: this });
          break;
        }
        case 'Sequence': {
          for (const t of this.execLinks(node.id, 0)) this.execute(t.node, data, depth + 1);
          // second output runs on the next tick
          const now = (engine.time?.now ?? 0) * 1000;
          this.scheduled.push({ at: now + 16, node, pin: 1, graph: this });
          break;
        }
        // ---- actions ----
        case 'Log': engine.log?.(String(this.evalDataIn(node, 0, data) ?? p.message ?? '')); break;
        case 'SetObjectActive': {
          const target = p.target ? engine.getGameObject?.(p.target) : go;
          target?.setActive?.(p.active !== false);
          break;
        }
        case 'OpenDoor': {
          const target = p.target ? engine.getGameObject?.(p.target) : go;
          const door = target?.getComponent?.('Door');
          if (door) p.open !== undefined ? door.setOpen(!!p.open) : door.toggle();
          break;
        }
        case 'PlaySound': {
          if (p.clip) engine.audio?.play2D?.(p.clip, { volume: Number(p.volume ?? 0.8) });
          break;
        }
        case 'SpawnPrefab': {
          const pos = go?.worldPosition?.() ?? { x: 0, y: 0, z: 0 };
          engine.spawn?.(p.prefab, pos);
          break;
        }
        case 'DamagePlayer': {
          const player = engine.player;
          const amount = this.evalDataIn(node, 0, data) ?? Number(p.amount ?? 10);
          player?.getComponent?.('Health')?.takeDamage?.(amount);
          break;
        }
        case 'HealPlayer': {
          const player = engine.player;
          const amount = this.evalDataIn(node, 0, data) ?? Number(p.amount ?? 10);
          player?.getComponent?.('Health')?.heal?.(amount);
          break;
        }
        case 'GiveItem': {
          const player = engine.player;
          player?.getComponent?.('Inventory')?.addItem?.(String(p.item ?? 'item'), Number(p.amount ?? 1));
          break;
        }
        case 'DestroyObject': {
          const target = p.target ? engine.getGameObject?.(p.target) : go;
          target?.destroy?.();
          break;
        }
        case 'SetLightIntensity': {
          const target = p.target ? engine.getGameObject?.(p.target) : go;
          const light = target?.slots?.light as any;
          if (light) light.intensity = Number(p.intensity ?? 1);
          break;
        }
        case 'ShowMessage': {
          engine.ui?.showMessage?.(String(this.evalDataIn(node, 0, data) ?? p.message ?? ''), Number(p.seconds ?? 3));
          break;
        }
        case 'SetVariable': {
          const value = this.evalDataIn(node, 0, data) ?? p.value;
          if (engine.variables) engine.variables[p.name] = value;
          break;
        }
        case 'OnUpdate': {
          // pass-through event node reached via link — continue chain
          break;
        }
        default: break;
      }
    } catch (e: any) {
      engine.warn?.(`Visual script error in ${node.type}: ${e?.message ?? e}`);
    }
    // continue exec chain — except flow nodes that manage their own outputs
    // (Branch/Delay/Sequence already executed the right output pins above).
    if (!SELF_MANAGED_EXEC.has(node.type)) {
      for (const t of this.execLinks(node.id, 0)) this.execute(t.node, data, depth + 1);
    }
  }
}

const SELF_MANAGED_EXEC = new Set(['Branch', 'Delay', 'Sequence']);
