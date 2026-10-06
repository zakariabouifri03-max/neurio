// ============================================================================
// NEXUS EDITOR — Script editor panel (CodeMirror) + Visual script graph editor
// ============================================================================
import CodeMirror from 'codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/addon/edit/matchbrackets';
import { h } from './dom';
import { icon } from './icons';
import { store } from './store';
import { editorBus } from '@engine/core/events';
import { createScriptAsset, setScriptSource } from '@engine/core/ops';
import { compileScript } from '@engine/scripting/runtime';
import { allNodeDefs, getNodeDef } from '@engine/visualscript/interpreter';
import type { VsGraph } from '@engine/core/types';
import { uid } from '@engine/core/types';

const SCRIPT_TEMPLATE = (name: string) => `// ${name} — NEXUS script
// Lifecycle: onStart, onUpdate(dt), onDestroy, onTriggerEnter(other), onInteract(player)
// API: Nexus.find(name), Nexus.findByTag(tag), Nexus.spawn(prefabId, pos), Nexus.on(evt, fn),
//      Nexus.log(msg), this.gameObject.move(dx,dy,dz), this.gameObject.position, ...

// @prop {number} speed = 1
class ${name} extends Nexus.Component {
  onStart() {
    this.speed = this.props.speed ?? 1;
    Nexus.log('${name} started on ' + this.gameObject.name);
  }

  onUpdate(dt) {
    // your logic here
  }
}
`;

export class ScriptEditorPanel {
  root: HTMLElement;
  private listEl: HTMLElement;
  private cmHost: HTMLElement;
  private cm: CodeMirror.Editor | null = null;
  private currentId: string | null = null;
  private list = h('div', { class: 'filelist' });

  constructor() {
    this.listEl = this.list;
    this.cmHost = h('div', { class: 'cmwrap' });
    this.root = h('div', { class: 'nx-scriptedit' }, this.listEl, this.cmHost);
    editorBus.on('scriptOpened', ({ scriptId, line }) => this.open(scriptId, line));
    editorBus.on('assetsChanged', () => this.renderList());
    this.renderList();
    this.renderEditor();
  }

  toolbar(): HTMLElement {
    return h('div', { class: 'nx-toolbar-row' },
      h('button', {
        onclick: () => {
          const name = prompt('Script name (PascalCase)', 'MyScript');
          if (!name || !store.project) return;
          const clean = name.replace(/[^\w]/g, '');
          const id = createScriptAsset(store.project, clean, SCRIPT_TEMPLATE(clean));
          store.markDirty();
          editorBus.emit('assetsChanged', undefined as any);
          this.open(id);
        },
      }, icon('plus', 12), ' New Script'),
      h('button', {
        onclick: () => this.save(),
        title: 'Save script (Ctrl+S)',
      }, icon('save', 12), ' Save'),
      h('span', { style: { color: 'var(--text-3)', fontSize: '11px', marginLeft: 'auto' } }, 'Scripts run in Play Mode — errors appear in Problems with clickable line numbers.'),
    );
  }

  private open(scriptId: string, line?: number) {
    // visual script graphs open in the graph editor instead
    if (scriptId.startsWith('vs:')) return;
    this.currentId = scriptId;
    this.renderList();
    this.renderEditor();
    if (line && this.cm) {
      this.cm.setCursor({ line: line - 1, ch: 0 });
      this.cm.focus();
    }
  }

  private save() {
    if (!this.currentId || !this.cm || !store.project) return;
    const script = store.project.scripts[this.currentId];
    if (!script) return;
    store.pushUndo('Save script');
    setScriptSource(store.project, this.currentId, this.cm.getValue());
    // syntax check → clear or set problem
    store.removeProblemsFor(this.currentId);
    const compiled = compileScript(this.currentId, script.name, this.cm.getValue(), () => ({}));
    if (compiled.problem) {
      store.addProblem({ file: `${script.name}.js`, line: compiled.problem.line, message: compiled.problem.message, severity: 'error', scriptId: this.currentId, scriptName: script.name });
    } else {
      store.log('info', `✓ ${script.name}.js compiles clean.`);
    }
    store.markDirty();
    this.renderList();
  }

  private renderList() {
    this.list.innerHTML = '';
    const scripts = Object.values(store.project?.scripts ?? {});
    if (!scripts.length) {
      this.list.append(h('div', { style: { padding: '10px', color: 'var(--text-3)', fontSize: '11px' } }, 'No scripts yet.'));
    }
    for (const s of scripts) {
      const hasError = store.problems.some(p => p.scriptId === s.id);
      this.list.append(h('div', {
        class: `f${this.currentId === s.id ? ' active' : ''}`,
        onclick: () => this.open(s.id),
      }, icon('code', 12), ` ${s.name}.js`, hasError ? h('span', { class: 'errdot', title: 'has errors' }) : ''));
    }
  }

  private renderEditor() {
    this.cmHost.innerHTML = '';
    const script = this.currentId ? store.project?.scripts[this.currentId] : null;
    if (!script) {
      this.cm = null;
      this.cmHost.append(h('div', { class: 'nx-empty' }, icon('code', 30), 'Select or create a script.', h('div', { style: { fontSize: '11px' } }, 'User scripts are JS classes with lifecycle hooks that run in Play Mode.')));
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = script.source;
    this.cmHost.append(textarea);
    this.cm = CodeMirror.fromTextArea(textarea, {
      mode: 'javascript',
      theme: 'nexus',
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
      lineWrapping: false,
    });
    this.cm.on('keydown', (_cm, e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this.save(); }
    });
    setTimeout(() => this.cm?.refresh(), 30);
  }
}

// ============================================================================
// Visual script graph editor
// ============================================================================

export class VisualScriptPanel {
  root: HTMLElement;
  private graph: VsGraph | null = null;
  private graphHolder: any = null;
  private canvasEl!: HTMLElement;
  private wiresSvg!: SVGElement;
  private pan = { x: 40, y: 40 };
  private linking: { from: { node: string; pin: number; kind: 'exec' | 'data' }; x: number; y: number } | null = null;

  constructor() {
    this.root = h('div', { class: 'nx-vseditor' });
    this.canvasEl = h('div', { class: 'vs-canvas' });
    this.wiresSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGElement;
    this.wiresSvg.setAttribute('class', 'wires');
    this.root.append(this.canvasEl, this.wiresSvg);
    this.canvasEl.addEventListener('mousedown', (e) => {
      if (e.target === this.canvasEl) this.selectNode(null);
    });
    this.canvasEl.addEventListener('wheel', (e) => {
      e.preventDefault();
    });
    editorBus.on('scriptOpened', ({ scriptId }) => {
      if (!scriptId.startsWith('vs:')) return;
      const objId = scriptId.slice(3);
      const obj = store.scene?.objects.find(o => o.id === objId);
      if (!obj) return;
      const comp = obj.components.find(c => c.type === 'VisualScript') as any;
      if (!comp) return;
      if (!comp.graph) comp.graph = { id: uid('g_'), name: `${obj.name} Graph`, nodes: [], links: [] };
      this.graph = comp.graph;
      this.graphHolder = comp;
      this.render();
    });
    this.render();
  }

  toolbar(): HTMLElement {
    return h('div', { class: 'nx-toolbar-row' },
      h('button', { onclick: () => this.addNodeMenu() }, icon('plus', 12), ' Add Node'),
      h('span', { style: { color: 'var(--text-3)', fontSize: '11px' } }, 'Events (red) → Flow (orange) → Actions (green). Drag from ● exec pins to build logic.'),
    );
  }

  private addNodeMenu() {
    if (!this.graph) return;
    import('./menus').then(({ showContextMenu }) => {
      const cats = new Map<string, any[]>();
      for (const def of allNodeDefs()) {
        if (!cats.has(def.category)) cats.set(def.category, []);
        cats.get(def.category)!.push(def);
      }
      const items: any[] = [];
      for (const [cat, defs] of cats) {
        items.push({ label: cat.toUpperCase(), header: true });
        for (const d of defs) items.push({ label: d.label, fn: () => this.addNode(d.type) });
      }
      showContextMenu(this.root, items);
    });
  }

  private addNode(type: string) {
    if (!this.graph) return;
    this.graph.nodes.push({ id: uid('n_'), type, x: this.pan.x + 60 + Math.random() * 60, y: this.pan.y + 60 + Math.random() * 80, params: {} });
    store.markDirty();
    this.render();
  }

  private selectNode(id: string | null) {
    this.canvasEl.querySelectorAll('.vs-node').forEach(n => n.classList.toggle('selected', (n as any).dataset.id === id));
  }

  render() {
    this.canvasEl.innerHTML = '';
    if (!this.graph) {
      this.canvasEl.append(h('div', { class: 'nx-empty', style: { position: 'absolute', inset: '0' } as any }));
      return;
    }
    // pan by dragging empty canvas
    this.canvasEl.onmousedown = (e) => {
      if (e.target !== this.canvasEl) return;
      const start = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
      this.canvasEl.classList.add('panning');
      const move = (ev: MouseEvent) => {
        this.pan = { x: ev.clientX - start.x, y: ev.clientY - start.y };
        this.canvasEl.style.backgroundPosition = `${this.pan.x}px ${this.pan.y}px`;
        for (const nodeEl of this.canvasEl.querySelectorAll('.vs-node')) this.positionNode(nodeEl as HTMLElement);
        this.drawWires();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        this.canvasEl.classList.remove('panning');
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    this.canvasEl.style.backgroundPosition = `${this.pan.x}px ${this.pan.y}px`;

    for (const node of this.graph.nodes) this.renderNode(node);
    this.drawWires();
  }

  private renderNode(node: any) {
    const def = getNodeDef(node.type);
    if (!def) return;
    const el = h('div', { class: 'vs-node', 'data-id': node.id, style: { left: '0px', top: '0px' } });
    el.dataset.x = node.x; el.dataset.y = node.y;

    const head = h('div', { class: 'head', style: { background: def.color, color: '#0b0d11' } }, def.label);
    head.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.selectNode(node.id);
      const startX = e.clientX - node.x, startY = e.clientY - node.y;
      const move = (ev: MouseEvent) => {
        node.x = ev.clientX - startX;
        node.y = ev.clientY - startY;
        this.positionNode(el);
        this.drawWires();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        store.markDirty();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`Delete node "${def.label}"?`)) {
        this.graph!.nodes = this.graph!.nodes.filter(n => n.id !== node.id);
        this.graph!.links = this.graph!.links.filter(l => l.from.node !== node.id && l.to.node !== node.id);
        store.markDirty();
        this.render();
      }
    });
    el.append(head);

    const pins = h('div', { class: 'pins' });
    const inCol = h('div', { class: 'col' });
    const outCol = h('div', { class: 'col' });
    // data inputs
    def.dataIn.forEach((label, i) => {
      inCol.append(this.pinEl(node, 'data', i, label, true));
    });
    // exec input (for action/flow nodes)
    if (def.category === 'action' || def.category === 'flow' || def.category === 'condition') {
      inCol.prepend(this.pinEl(node, 'exec', 0, '', true));
    }
    // exec outputs
    for (let i = 0; i < def.execOut; i++) {
      outCol.append(this.pinEl(node, 'exec', i, def.execOut > 1 ? (i === 0 ? 'true' : 'false') : '', false));
    }
    // data outputs
    def.dataOut.forEach((label, i) => {
      outCol.append(this.pinEl(node, 'data', i, label, false));
    });
    pins.append(inCol, outCol);
    el.append(pins);

    // params
    const params = h('div', { class: 'vs-params' });
    for (const key of def.params ?? []) {
      const pd = def.paramDefs?.[key];
      const value = node.params?.[key] ?? '';
      let input: HTMLElement;
      if (pd?.type === 'bool') {
        input = h('input', { type: 'checkbox', ...(value ? { checked: true } : {}), onchange: (e: any) => { node.params ??= {}; node.params[key] = e.target.checked; store.markDirty(); } });
      } else if (pd?.type === 'number') {
        input = h('input', { type: 'number', value, oninput: (e: any) => { node.params ??= {}; node.params[key] = parseFloat(e.target.value) || 0; store.markDirty(); } });
      } else {
        input = h('input', { type: 'text', value, oninput: (e: any) => { node.params ??= {}; node.params[key] = e.target.value; store.markDirty(); } });
      }
      params.append(h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, h('span', { style: { color: 'var(--text-3)', fontSize: '10px' } }, pd?.label ?? key), input));
    }
    if ((def.params ?? []).length) el.append(params);

    this.canvasEl.append(el);
    this.positionNode(el);
  }

  private pinEl(node: any, kind: 'exec' | 'data', pin: number, label: string, isInput: boolean): HTMLElement {
    const dot = h('span', { class: `dot` });
    const el = h('div', { class: `vs-pin ${kind}` }, isInput ? [label && h('span', {}, label), dot] : [dot, label && h('span', {}, label)]);
    dot.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (isInput) {
        // clicking an input pin with an active link deletes that link
        if (this.linking) { this.completeLink(node.id, pin, kind); }
        else {
          this.graph!.links = this.graph!.links.filter(l => !(l.to.node === node.id && l.to.pin === pin && l.to.kind === kind));
          store.markDirty();
          this.drawWires();
        }
      } else {
        this.linking = { from: { node: node.id, pin, kind }, x: e.clientX, y: e.clientY };
        dot.classList.add('linking');
        const move = (ev: MouseEvent) => { if (this.linking) { this.linking.x = ev.clientX; this.linking.y = ev.clientY; this.drawWires(); } };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          dot.classList.remove('linking');
          setTimeout(() => { this.linking = null; this.drawWires(); }, 10);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }
    });
    (el as any).__pin = { node: node.id, pin, kind, isInput };
    return el;
  }

  private completeLink(toNode: string, toPin: number, toKind: 'exec' | 'data') {
    const link = this.linking;
    if (!link || link.from.kind !== toKind || link.from.node === toNode) return;
    // replace existing link into same input
    this.graph!.links = this.graph!.links.filter(l => !(l.to.node === toNode && l.to.pin === toPin && l.to.kind === toKind));
    this.graph!.links.push({ from: { node: link.from.node, pin: link.from.pin, kind: link.from.kind }, to: { node: toNode, pin: toPin, kind: toKind } });
    store.markDirty();
    this.linking = null;
    this.drawWires();
  }

  private positionNode(el: HTMLElement) {
    const x = parseFloat(el.dataset.x), y = parseFloat(el.dataset.y);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  private drawWires() {
    const svg = this.wiresSvg;
    svg.innerHTML = '';
    if (!this.graph) return;
    const rect = this.canvasEl.getBoundingClientRect();
    const pinPos = (nodeId: string, kind: 'exec' | 'data', pin: number, isInput: boolean) => {
      const nodeEl = this.canvasEl.querySelector(`.vs-node[data-id="${nodeId}"]`);
      if (!nodeEl) return null;
      const pinEl = [...nodeEl.querySelectorAll(`.vs-pin.${kind}`)].find((p: any) => p.__pin && (p.__pin.pin === pin) && (p.__pin.isInput === isInput));
      if (!pinEl) return null;
      const r = pinEl.getBoundingClientRect();
      return { x: r.left - rect.left + (isInput ? 4 : r.width), y: r.top - rect.top + r.height / 2 };
    };
    const mkPath = (a: { x: number; y: number }, b: { x: number; y: number }, color: string) => {
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`);
      p.setAttribute('stroke', color);
      p.setAttribute('pointer-events', 'none');
      svg.append(p);
    };
    for (const l of this.graph.links ?? []) {
      const a = pinPos(l.from.node, l.from.kind === 'data' ? 'data' : 'exec', l.from.pin, false);
      const b = pinPos(l.to.node, l.to.kind === 'data' ? 'data' : 'exec', l.to.pin, true);
      if (a && b) mkPath(a, b, l.from.kind === 'exec' ? '#cbd5e1' : '#4f8fd9');
    }
    if (this.linking) {
      const a = pinPos(this.linking.from.node, this.linking.from.kind, this.linking.from.pin, false);
      if (a) mkPath(a, { x: this.linking.x - rect.left, y: this.linking.y - rect.top }, '#22d3ee');
    }
  }
}
