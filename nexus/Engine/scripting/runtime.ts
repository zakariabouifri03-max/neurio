// ============================================================================
// NEXUS ENGINE — User script runtime
// Project scripts are JS classes extending Nexus.Component with lifecycle
// hooks. They are compiled at play time with new Function() in an isolated
// scope, given a controlled API (the Nexus object). Errors are captured with
// script-relative line numbers and reported to the Problems panel.
// ============================================================================

export interface ScriptProblem {
  scriptId: string;
  scriptName: string;
  line: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
  stack?: string;
}

export interface CompiledScript {
  cls: any;
  className: string;
  problem: ScriptProblem | null;
}

/** Wrapper prologue lines added before user source (for line-offset math). */
const PROLOGUE = `'use strict';
return function(Nexus){
`;

/** EPILOGUE returns the user's class by its detected name. */
const makeEpilogue = (className: string) => `
;
return (typeof ${className} !== 'undefined') ? ${className} : undefined;
};

//# sourceURL=NEXUS_SCRIPT
`;

/** Compile a script source into a class. Never throws — returns a problem instead. */
export function compileScript(scriptId: string, scriptName: string, source: string, apiFactory: (onProblem: (p: ScriptProblem) => void) => any): CompiledScript {
  const className = detectClassName(source);
  try {
    const factory = new Function(PROLOGUE + source + makeEpilogue(className || 'undefined'))();
    const problemHolder: { p: ScriptProblem | null } = { p: null };
    const Nexus: any = apiFactory((p) => { if (!problemHolder.p) problemHolder.p = p; });
    const cls = factory(Nexus);
    if (typeof cls !== 'function') {
      return {
        cls: null, className,
        problem: {
          scriptId, scriptName, line: 1, message: `Script must define a class (found ${typeof cls}). Export it by declaring "class ${className || 'MyScript'} extends Nexus.Component {}".`,
          severity: 'error',
        },
      };
    }
    return { cls, className, problem: problemHolder.p };
  } catch (e: any) {
    const { line, message } = parseErrorLocation(e, source);
    return { cls: null, className, problem: { scriptId, scriptName, line, message: `${message}${className ? '' : ' (hint: declare a class like "class MyScript extends Nexus.Component {}")'}`, severity: 'error', stack: e.stack } };
  }
}

export function detectClassName(source: string): string {
  const m = source.match(/class\s+([A-Za-z_$][\w$]*)/);
  return m ? m[1] : '';
}

function parseErrorLocation(e: any, source: string): { line: number; message: string } {
  const stack: string = e?.stack ?? '';
  // V8: "    at eval (<anonymous>:LINE:COL)" or "NEXUS_SCRIPT:LINE:COL"
  let line = 0;
  const m = stack.match(/(?:<anonymous>|NEXUS_SCRIPT):(\d+):(\d+)/);
  if (m) {
    line = Math.max(1, parseInt(m[1], 10) - PROLOGUE_LINES);
  }
  // Syntax errors from new Function carry no line in the stack — locate by
  // prefix scan: the first line-prefix whose compile error matches the full
  // source's error message is the offending line.
  if (!line && e instanceof SyntaxError) {
    line = locateSyntaxLine(source, e?.message ?? String(e));
  }
  return { line: line || 1, message: e?.message ?? String(e) };
}

function locateSyntaxLine(source: string, fullMessage: string): number {
  const lines = source.split('\n');
  // "Unexpected end of input" means a missing closer — point at the last line
  if (/end of input/i.test(fullMessage)) return lines.length;
  for (let i = 0; i < lines.length; i++) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(lines.slice(0, i + 1).join('\n'));
    } catch (err: any) {
      if (err?.message === fullMessage) return i + 1;
    }
  }
  return 0;
}

const PROLOGUE_LINES = PROLOGUE.split('\n').length - 1; // lines before user code inside the function body

/** Parse "@prop" annotations so the Inspector can edit script properties. */
export interface PropDef { key: string; type: 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'enum'; label: string; def: any; options?: string[]; }
export function parsePropAnnotations(source: string): PropDef[] {
  const out: PropDef[] = [];
  const re = /@prop\s+\{(\w+)\}\s+(\w+)(?:\s*=\s*([^@\n*]+?))?(?:\s+(.*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const type = (['number', 'string', 'boolean', 'color', 'asset', 'enum'].includes(m[1]) ? m[1] : 'string') as PropDef['type'];
    let def: any = (m[3] ?? '').trim();
    def = String(def).replace(/^["']|["']$/g, '');
    if (type === 'number') def = parseFloat(def) || 0;
    if (type === 'boolean') def = def === 'true';
    const label = (m[4] ?? '').replace(/\*\/\s*$/, '').trim();
    out.push({ key: m[2], type, label: label || m[2], def });
  }
  return out;
}

/**
 * The Nexus API surface given to user scripts.
 * engine = GameRuntime (typed loosely here).
 */
export function createNexusApi(engine: any, go: any, onError: (p: ScriptProblem) => void): any {
  const mkProblem = (e: any, scriptId: string, scriptName: string) => {
    const stack: string = e?.stack ?? '';
    const m = stack.match(/(?:<anonymous>|NEXUS_SCRIPT):(\d+):(\d+)/);
    const line = m ? Math.max(1, parseInt(m[1], 10) - PROLOGUE_LINES) : 1;
    return { scriptId, scriptName, line, message: e?.message ?? String(e), severity: 'error' as const, stack };
  };

  class Component {
    /** filled by the runtime */
    gameObject: any = go;
    engine: any = engine;
    props: any = {};
    onStart() { }
    onUpdate(_dt: number) { }
    onFixedUpdate(_dt: number) { }
    onDestroy() { }
    onTriggerEnter(_other: any) { }
    onTriggerExit(_other: any) { }
    onCollisionEnter(_other: any) { }
    onInteract(_player: any) { }
  }

  return {
    Component,
    THREE: null, // lazily provided below (three is bundled once)
    log: (...args: any[]) => engine.log(args.map(a => fmt(a)).join(' ')),
    warn: (...args: any[]) => engine.warn(args.map(a => fmt(a)).join(' ')),
    error: (...args: any[]) => engine.error(args.map(a => fmt(a)).join(' ')),
    find: (name: string) => engine.find(name),
    findByTag: (tag: string) => engine.findByTag(tag),
    spawn: (prefabId: string, pos?: any, rot?: any) => engine.spawn(prefabId, pos, rot),
    destroy: (id: string) => engine.destroyObject(id),
    // events with automatic error capture
    on: (evt: string, fn: (d?: any) => void) => engine.events.on(evt, (d?: any) => {
      try { fn(d); } catch (e: any) {
        onError(mkProblem(e, go?.__scriptId ?? 'unknown', go?.__scriptName ?? 'Script'));
      }
    }),
    emit: (evt: string, data?: any) => engine.events.emit(evt, data),
    save: (k: string, v: any) => engine.save(k, v),
    load: (k: string) => engine.load(k),
    Math: { clamp: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)), lerp: (a: number, b: number, t: number) => a + (b - a) * t, rad: (d: number) => d * Math.PI / 180, deg: (r: number) => r * 180 / Math.PI },
  };
}

function fmt(v: any): string {
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}

/** Wrap lifecycle calls with error capture. Returns a safe invoker. */
export function safeHook(fn: any, fallback: () => void, onErr: (e: any) => void) {
  return (...args: any[]) => {
    try { return fn(...args); } catch (e: any) { onErr(e); try { fallback(); } catch { } }
  };
}
