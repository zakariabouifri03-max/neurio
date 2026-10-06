// ============================================================================
// NEXUS EDITOR — Docking layout
// Dock zones (left / center / right / bottom) with tabbed panels, resizable
// splitters, movable panels (context menu: Dock ▸ …), and layout persistence.
// ============================================================================
import { h } from './dom';
import { showContextMenu } from './menus';
import { icon } from './icons';

export interface PanelDef {
  id: string;
  title: string;
  icon: string;
  factory: () => { root: HTMLElement; toolbar?: HTMLElement };
  defaultZone?: 'left' | 'right' | 'bottom' | 'center' | 'bottomRight';
}

interface Zone {
  id: 'left' | 'right' | 'bottom' | 'center';
  el: HTMLElement;
  tabstrip: HTMLElement;
  body: HTMLElement;
  panels: string[];       // panel ids in this zone
  active: string | null;
}

const LS_KEY = 'nexus.layout.v1';

export class DockLayout {
  host: HTMLElement;
  zones: Record<string, Zone> = {} as any;
  private defs = new Map<string, PanelDef>();
  private instances = new Map<string, { root: HTMLElement; toolbar?: HTMLElement; def: PanelDef }>();
  private sizes = { left: 250, right: 320, bottom: 260, bottomLeft: 380 };
  main: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.loadSizes();
    this.main = h('div', { class: 'nx-main' });
    this.host.append(this.main);
    this.build();
  }

  private loadSizes() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) Object.assign(this.sizes, JSON.parse(raw).sizes ?? {});
    } catch { }
  }
  private saveLayout() {
    const data = {
      sizes: this.sizes,
      zones: Object.fromEntries(Object.values(this.zones).map(z => [z.id, { panels: z.panels, active: z.active }])),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }

  private build() {
    const mk = (id: Zone['id']): Zone => {
      const tabstrip = h('div', { class: 'nx-tabstrip' });
      const body = h('div', { class: 'nx-panel-body' });
      const panel = h('div', { class: 'nx-panel', style: id === 'left' ? { width: `${this.sizes.left}px` } : id === 'right' ? { width: `${this.sizes.right}px` } : {} },
        tabstrip, body);
      const z: Zone = { id, el: panel, tabstrip, body, panels: [], active: null };
      this.zones[id] = z;
      return z;
    };

    const left = mk('left');
    const center = mk('center');
    center.el.style.cssText = 'flex:1;margin:3px 0;min-width:0;border:none;background:transparent;padding:0;';
    const right = mk('right');
    const bottomLeft = mk('bottom');
    const bottomRight = mk('center'); // separate tab group on the right of bottom

    // bottom row: [bottomLeft | bottomRight]
    const bottomRow = h('div', { class: 'nx-dock-zone', style: { height: `${this.sizes.bottom}px`, flexShrink: '0' } }, left === null ? '' : '');
    // assemble: left | (center + bottomRow) | right
    const centerCol = h('div', { class: 'nx-dock-zone vertical', style: { flex: '1', minWidth: '0' } },
      center.el, this.splitterH('bottom'), bottomRow);
    bottomRow.append(bottomLeft.el, this.splitterV('bottomLeft'), bottomRight.el);
    this.main.append(
      left.el,
      this.splitterV('left'),
      centerCol,
      this.splitterV('right'),
      right.el,
    );
    this.zones.center = center;
    this.zones.bottom = bottomLeft;
    (this.zones as any).bottomRight = bottomRight;
  }

  private splitterV(sizeKey: 'left' | 'right' | 'bottomLeft'): HTMLElement {
    const s = h('div', { class: 'nx-splitter' });
    let startX = 0, startSize = 0;
    s.addEventListener('mousedown', (e) => {
      startX = e.clientX; startSize = this.sizes[sizeKey];
      s.classList.add('dragging');
      const move = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        this.sizes[sizeKey] = Math.max(140, Math.min(window.innerWidth - 420, startSize + (sizeKey === 'right' ? -delta : delta)));
        this.applySizes();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        s.classList.remove('dragging');
        this.saveLayout();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    s.addEventListener('dblclick', () => this.toggleZone(sizeKey));
    return s;
  }

  private splitterH(sizeKey: 'bottom'): HTMLElement {
    const s = h('div', { class: 'nx-splitter h' });
    let startY = 0, startSize = 0;
    s.addEventListener('mousedown', (e) => {
      startY = e.clientY; startSize = this.sizes[sizeKey];
      s.classList.add('dragging');
      const move = (ev: MouseEvent) => {
        this.sizes[sizeKey] = Math.max(120, Math.min(window.innerHeight - 240, startSize - (ev.clientY - startY)));
        this.applySizes();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        s.classList.remove('dragging');
        this.saveLayout();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    s.addEventListener('dblclick', () => this.toggleZone(sizeKey));
    return s;
  }

  private toggleZone(key: 'left' | 'right' | 'bottom' | 'bottomLeft') {
    const zoneId = key === 'bottomLeft' ? 'bottom' : key;
    const zone = this.zones[zoneId];
    if (!zone) return;
    const collapsed = zone.el.style.display === 'none';
    zone.el.style.display = collapsed ? '' : 'none';
    // also hide associated splitters
    this.main.querySelectorAll('.nx-splitter').forEach(s => { /* sizes preserved */ });
    this.saveLayout();
  }

  private applySizes() {
    (this.zones.left.el as HTMLElement).style.width = `${this.sizes.left}px`;
    (this.zones.right.el as HTMLElement).style.width = `${this.sizes.right}px`;
    (this.zones.bottom.el as HTMLElement).parentElement!.style.height = `${this.sizes.bottom}px`;
    (this.zones.bottomRight as any).el.style.flex = '1';
    window.dispatchEvent(new Event('resize'));
  }

  register(def: PanelDef) {
    this.defs.set(def.id, def);
    // restore layout or use default zone
    let zoneId: string = def.defaultZone ?? 'bottom';
    let restored = false;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const zones = JSON.parse(raw).zones ?? {};
        for (const [zid, z] of Object.entries<any>(zones)) {
          if (z.panels?.includes(def.id)) { zoneId = zid; restored = true; break; }
        }
      }
    } catch { }
    this.addPanelToZone(def.id, zoneId, { silent: true });
    if (!restored) this.saveLayout();
  }

  addPanelToZone(panelId: string, zoneId: string, opts: { silent?: boolean } = {}) {
    const def = this.defs.get(panelId);
    if (!def) return;
    const zone = this.zones[zoneId] ?? this.zones.bottom;
    // remove from previous zone
    for (const z of Object.values(this.zones)) {
      if (z.panels.includes(panelId)) {
        z.panels = z.panels.filter(p => p !== panelId);
        if (z.active === panelId) z.active = z.panels[0] ?? null;
        z.tabstrip.innerHTML = '';
        for (const p of z.panels) this.renderTab(z, p);
      }
    }
    zone.panels.push(panelId);
    zone.tabstrip.innerHTML = '';
    for (const p of zone.panels) this.renderTab(zone, p);
    this.show(panelId);
    if (!opts.silent) this.saveLayout();
  }

  private renderTab(zone: Zone, panelId: string) {
    const def = this.defs.get(panelId)!;
    const tab = h('div', {
      class: `nx-tab${zone.active === panelId ? ' active' : ''}`,
      onclick: () => this.show(panelId),
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        showContextMenu(e, [
          { label: 'Dock Left', fn: () => this.addPanelToZone(panelId, 'left') },
          { label: 'Dock Right', fn: () => this.addPanelToZone(panelId, 'right') },
          { label: 'Dock Bottom', fn: () => this.addPanelToZone(panelId, 'bottom') },
          { label: 'Dock Bottom Right', fn: () => this.addPanelToZone(panelId, 'bottomRight') },
          { label: 'Dock Center', fn: () => this.addPanelToZone(panelId, 'center') },
        ]);
      },
    }, icon(def.icon, 13), def.title);
    zone.tabstrip.append(tab);
  }

  show(panelId: string) {
    for (const z of Object.values(this.zones)) {
      if (!z.panels.includes(panelId)) continue;
      z.active = panelId;
      z.tabstrip.querySelectorAll('.nx-tab').forEach((t, i) => t.classList.toggle('active', z.panels[i] === panelId));
      z.body.innerHTML = '';
      const inst = this.ensureInstance(panelId);
      if (inst.toolbar) z.body.append(inst.toolbar);
      z.body.append(inst.root);
      window.dispatchEvent(new Event('resize'));
    }
    this.saveLayout();
  }

  private ensureInstance(panelId: string) {
    if (!this.instances.has(panelId)) {
      const def = this.defs.get(panelId)!;
      const built = def.factory();
      this.instances.set(panelId, { ...built, def });
    }
    return this.instances.get(panelId)!;
  }

  refresh(panelId: string) {
    if (this.instances.has(panelId)) {
      this.instances.delete(panelId);
      const z = Object.values(this.zones).find(z => z.active === panelId);
      if (z) this.show(panelId);
    }
  }
}
