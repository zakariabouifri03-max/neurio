// ============================================================================
// NEXUS EDITOR — Console / Problems / Output / Profiler panels
// ============================================================================
import { store } from '../store';
import { editorBus } from '@engine/core/events';
import { icon } from '../icons';
import { h } from '../dom';

// --------------------------------- Console ----------------------------------

export class ConsolePanel {
  root: HTMLElement;
  private filter: 'all' | 'info' | 'warning' | 'error' = 'all';
  private search = '';

  constructor() {
    this.root = h('div', { class: 'nx-console' });
    editorBus.on('console', () => this.appendLine());
    editorBus.on('playModeChanged', () => this.render());
    this.render();
  }

  toolbar(): HTMLElement {
    return h('div', { class: 'nx-toolbar-row' },
      h('select', { onchange: (e: any) => { this.filter = e.target.value; this.render(); } },
        ['all', 'info', 'warning', 'error'].map(f => h('option', { value: f, ...(f === this.filter ? { selected: true } : {}) }, f))),
      h('input', { type: 'text', placeholder: 'Filter…', style: { flex: '1' }, oninput: (e: any) => { this.search = e.target.value.toLowerCase(); this.render(); } }),
      h('button', { class: 'nx-tbtn small', title: 'Clear console', onclick: () => { store.consoleLines = []; this.render(); } }, icon('trash', 12)),
    );
  }

  private appendLine() {
    const line = store.consoleLines[store.consoleLines.length - 1];
    if (!line) return;
    if (this.filter !== 'all' && line.level !== this.filter) return;
    if (this.search && !line.message.toLowerCase().includes(this.search)) return;
    this.root.append(this.lineEl(line));
    this.root.scrollTop = this.root.scrollHeight;
    if (this.root.children.length > 500) this.root.firstChild?.remove();
  }

  private lineEl(line: any): HTMLElement {
    return h('div', { class: `line ${line.level}` },
      h('span', { class: 'time' }, new Date(line.time).toLocaleTimeString()),
      h('span', { class: 'badge' }, line.level.toUpperCase()),
      h('span', { class: 'msg' }, line.message),
      line.source ? h('span', { class: 'src' }, line.source) : '',
    );
  }

  render() {
    this.root.innerHTML = '';
    const lines = store.consoleLines.filter(l =>
      (this.filter === 'all' || l.level === this.filter) &&
      (!this.search || l.message.toLowerCase().includes(this.search))).slice(-300);
    for (const l of lines) this.root.append(this.lineEl(l));
    this.root.scrollTop = this.root.scrollHeight;
  }
}

// --------------------------------- Problems ----------------------------------

export class ProblemsPanel {
  root: HTMLElement;
  onFixWithAi: ((problem: any) => void) | null = null;

  constructor() {
    this.root = h('div', { class: 'nx-problems' });
    editorBus.on('problemsChanged', () => this.render());
    this.render();
  }

  render() {
    this.root.innerHTML = '';
    if (!store.problems.length) {
      this.root.append(h('div', { class: 'nx-empty' }, icon('check', 30), 'No problems.', h('div', { style: { fontSize: '11px' } }, 'Script errors from Play Mode appear here with file & line.')));
      return;
    }
    for (const p of store.problems) {
      this.root.append(h('div', { class: 'nx-problem', onclick: () => p.scriptId && editorBus.emit('scriptOpened', { scriptId: p.scriptId, line: p.line }) },
        h('span', { class: `sev ${p.severity}` }),
        h('span', { class: 'file' }, p.file),
        h('span', { class: 'loc' }, `Ln ${p.line}`),
        h('span', { class: 'desc', title: p.message }, p.message),
        h('button', {
          class: 'fixbtn primary', onclick: (e: Event) => { e.stopPropagation(); this.onFixWithAi?.(p); },
        }, '⚡ Fix With AI'),
      ));
    }
  }
}

// ---------------------------------- Output -----------------------------------

export class OutputPanel {
  root: HTMLElement;
  private lines: string[] = [];

  constructor() {
    this.root = h('div', { class: 'nx-console', style: { fontFamily: 'var(--mono)' } });
  }

  clear() { this.lines = []; this.render(); }
  log(line: string) {
    this.lines.push(line);
    if (this.lines.length > 2000) this.lines.shift();
    this.render();
  }

  render() {
    this.root.innerHTML = '';
    for (const l of this.lines) {
      const color = l.includes('[ERROR]') ? 'var(--red)' : l.includes('[WARN]') ? 'var(--yellow)' : l.includes('[OK]') || l.includes('✓') ? 'var(--green)' : 'var(--text-1)';
      this.root.append(h('div', { class: 'line', style: { padding: '1.5px 10px' } }, h('span', { class: 'msg', style: { color, whiteSpace: 'pre-wrap' } }, l)));
    }
    this.root.scrollTop = this.root.scrollHeight;
  }
}

// --------------------------------- Profiler ----------------------------------

export class ProfilerPanel {
  root: HTMLElement;
  private statsGetter: () => any;
  private raf = 0;
  private canvas: HTMLCanvasElement;
  private history: number[] = [];

  constructor(statsGetter: () => any) {
    this.statsGetter = statsGetter;
    this.root = h('div', { class: 'nx-profiler' });
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:90px;border:1px solid var(--border-1);border-radius:6px;background:var(--bg-0);';
    this.root.append(this.canvas);
    this.render();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.root.isConnected || this.root.offsetParent === null) return;
    this.render();
  };

  render() {
    const s = this.statsGetter() ?? {};
    this.history.push(s.fps ?? 0);
    if (this.history.length > 120) this.history.shift();
    // graph
    const c = this.canvas;
    const w = c.clientWidth || 400, hgt = 90;
    if (c.width !== w * 2) { c.width = w * 2; c.height = hgt * 2; }
    const g = c.getContext('2d')!;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, w, hgt);
    g.strokeStyle = '#1d232e';
    for (let y = 0; y < hgt; y += 15) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#22d3ee';
    g.lineWidth = 1.4;
    g.beginPath();
    this.history.forEach((fps, i) => {
      const x = (i / Math.max(1, this.history.length - 1)) * w;
      const y = hgt - Math.min(1, fps / 120) * (hgt - 6) - 3;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    });
    g.stroke();

    // rebuild stat cards
    const statsEl = this.root.querySelector('.grid') ?? (() => {
      const div = h('div', { class: 'grid' });
      this.root.append(div);
      return div;
    })();
    statsEl.innerHTML = '';
    const mem = (performance as any).memory;
    const cards: [string, string, boolean?][] = [
      ['FPS', String(s.fps ?? 0), (s.fps ?? 0) < 24],
      ['Frame Time', `${s.frameMs ?? 0} ms`, (s.frameMs ?? 0) > 40],
      ['Draw Calls', String(s.drawCalls ?? 0), (s.drawCalls ?? 0) > 1200],
      ['Triangles', (s.triangles ?? 0).toLocaleString()],
      ['Objects', String(s.objects ?? 0)],
      ['Update', `${s.updateMs ?? 0} ms`],
      ['Physics', `${s.physicsMs ?? 0} ms`],
      ['JS Heap', mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB` : 'n/a'],
    ];
    for (const [k, v, warn] of cards) {
      statsEl.append(h('div', { class: 'nx-stat' },
        h('div', { class: 'k' }, k),
        h('div', { class: `v${warn ? ' warn' : ''}` }, v),
      ));
    }
  }

  dispose() { cancelAnimationFrame(this.raf); }
}
