// ============================================================================
// NEXUS EDITOR — Command registry, keyboard shortcuts, command palette
// ============================================================================
import { h, fuzzyScore } from './dom';
import { icon } from './icons';

export interface CommandDef {
  id: string;
  label: string;
  category: string;
  kbd?: string;
  when?: () => boolean;   // enabled condition
  run: () => void;
}

const commands = new Map<string, CommandDef>();

export function command(def: CommandDef) {
  commands.set(def.id, def);
}
export function getCommand(id: string) { return commands.get(id); }
export function allCommands(): CommandDef[] { return [...commands.values()]; }
export function runCommand(id: string): boolean {
  const c = commands.get(id);
  if (!c) return false;
  if (c.when && !c.when()) return false;
  c.run();
  return true;
}

/** Install global keyboard shortcuts from registered commands. */
export function installShortcuts() {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || (target as any).codemirrorIgnore)) return;
    for (const c of commands.values()) {
      if (!c.kbd) continue;
      if (matchKbd(c.kbd, e)) {
        if (c.when && !c.when()) continue;
        e.preventDefault();
        c.run();
        return;
      }
    }
  });
}

function matchKbd(kbd: string, e: KeyboardEvent): boolean {
  const parts = kbd.split('+').map(s => s.trim());
  const needCtrl = parts.includes('Ctrl');
  const needShift = parts.includes('Shift');
  const needAlt = parts.includes('Alt');
  const key = parts[parts.length - 1];
  const code = e.code === 'Space' ? 'Space' : e.key;
  if (e.ctrlKey !== needCtrl || e.shiftKey !== needShift || e.altKey !== needAlt) return false;
  return code.toLowerCase() === key.toLowerCase() ||
    (key.length === 1 && e.code === `Key${key.toUpperCase()}`) ||
    (key === 'Space' && e.code === 'Space');
}

// --------------------------------- palette ----------------------------------

export class CommandPalette {
  private backdrop: HTMLElement | null = null;
  private selected = 0;
  private items: { cmd: CommandDef; html: string }[] = [];

  open(preselect?: string) {
    this.close();
    this.backdrop = h('div', { class: 'nx-palette-backdrop', onclick: (e: Event) => { if (e.target === this.backdrop) this.close(); } });
    const input = h('input', { type: 'text', placeholder: 'Type a command… (⌘ every editor action)', value: preselect ?? '' }) as HTMLInputElement;
    const list = h('div', { class: 'list' });
    const palette = h('div', { class: 'nx-palette' }, input, list);
    this.backdrop.append(palette);
    document.body.append(this.backdrop);
    const refresh = () => this.refreshList(list, input.value);
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowDown') { this.selected = Math.min(this.items.length - 1, this.selected + 1); this.paint(list); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.selected = Math.max(0, this.selected - 1); this.paint(list); e.preventDefault(); }
      else if (e.key === 'Enter') {
        const item = this.items[this.selected];
        if (item) { this.close(); item.cmd.run(); }
      }
    });
    refresh();
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  close() { this.backdrop?.remove(); this.backdrop = null; }

  private refreshList(list: HTMLElement, query: string) {
    this.items = allCommands()
      .filter(c => !c.when || c.when())
      .map(cmd => ({ cmd, score: query ? fuzzyScore(query, `${cmd.category} ${cmd.label}`) : 0 }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map(x => ({ cmd: x.cmd, html: highlight(x.cmd.label, query) }));
    this.selected = 0;
    this.paint(list);
  }

  private paint(list: HTMLElement) {
    list.innerHTML = '';
    this.items.forEach((item, i) => {
      list.append(h('div', {
        class: `cmd${i === this.selected ? ' selected' : ''}`,
        onclick: () => { this.close(); item.cmd.run(); },
        onmouseenter: () => { this.selected = i; this.paint(list); },
      },
        h('span', {}, icon('zap', 12), ` ${item.html}`),
        item.cmd.kbd ? h('span', { class: 'kbd' }, item.cmd.kbd) : '',
        h('span', { class: 'cat' }, item.cmd.category),
      ));
    });
  }
}

function highlight(label: string, query: string): string {
  if (!query) return label;
  const idx = label.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return label;
  return label.slice(0, idx) + `<span class="nx-fuzzy-hl">${label.slice(idx, idx + query.length)}</span>` + label.slice(idx + query.length);
}

export const palette = new CommandPalette();
