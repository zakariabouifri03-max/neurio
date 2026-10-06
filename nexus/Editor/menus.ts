// ============================================================================
// NEXUS EDITOR — Menu bar & context menus
// ============================================================================
import { h } from './dom';
import { icon } from './icons';

export interface MenuItem {
  label?: string;
  fn?: () => void;
  kbd?: string;
  disabled?: boolean;
  sep?: boolean;
  header?: boolean;
  danger?: boolean;
  icon?: string;
}

export function showContextMenu(at: MouseEvent | HTMLElement, items: MenuItem[]): void {
  document.querySelectorAll('.nx-menu-drop').forEach(e => e.remove());
  const drop = h('div', { class: 'nx-menu-drop' });
  for (const item of items) {
    if (item.sep) { drop.append(h('div', { class: 'sep' })); continue; }
    if (item.header) { drop.append(h('div', { class: 'label' }, item.label ?? '')); continue; }
    drop.append(h('div', {
      class: `item${item.disabled ? ' disabled' : ''}`,
      onclick: () => { drop.remove(); item.fn?.(); },
    },
      h('span', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, item.danger ? icon('trash', 12) : '', item.label ?? ''),
      item.kbd ? h('span', { class: 'kbd' }, item.kbd) : '',
    ));
  }
  document.body.append(drop);
  let x = 0, y = 0;
  if (at instanceof MouseEvent) { x = at.clientX; y = at.clientY; }
  else { const r = at.getBoundingClientRect(); x = r.left; y = r.bottom + 2; }
  const rect = drop.getBoundingClientRect();
  x = Math.min(x, window.innerWidth - rect.width - 8);
  y = Math.min(y, window.innerHeight - rect.height - 8);
  drop.style.left = `${Math.max(4, x)}px`;
  drop.style.top = `${Math.max(4, y)}px`;
  const close = (e: Event) => {
    if (!drop.contains(e.target as Node)) { drop.remove(); window.removeEventListener('mousedown', close); }
  };
  setTimeout(() => window.addEventListener('mousedown', close), 0);
}

export interface MenuDef { label: string; items: () => MenuItem[]; }

export function menubar(defs: MenuDef[], onBrand?: () => void): HTMLElement {
  const bar = h('div', { class: 'nx-menubar' });
  const brand = h('div', { class: 'brand', ...(onBrand ? { onclick: onBrand } : {}), title: 'NEXUS GAME STUDIO' });
  brand.innerHTML = `<svg viewBox="0 0 32 32" width="17" height="17"><path d="M16 2 29 9v14L16 30 3 23V9z" fill="none" stroke="#22d3ee" stroke-width="2.4"/><path d="M11 22V10l10 12V10" fill="none" stroke="#22d3ee" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>NEXUS`;
  bar.append(brand);
  for (const def of defs) {
    const item = h('div', { class: 'nx-menu-item' }, def.label);
    item.addEventListener('click', () => {
      document.querySelectorAll('.nx-menu-drop').forEach(e => e.remove());
      item.classList.add('open');
      const drop = h('div', { class: 'nx-menu-drop' });
      for (const mi of def.items()) {
        if (mi.sep) { drop.append(h('div', { class: 'sep' })); continue; }
        if (mi.header) { drop.append(h('div', { class: 'label' }, mi.label ?? '')); continue; }
        drop.append(h('div', {
          class: `item${mi.disabled ? ' disabled' : ''}`,
          onclick: () => { drop.remove(); item.classList.remove('open'); mi.fn?.(); },
        },
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, mi.icon ? icon(mi.icon, 12) : '', mi.label ?? ''),
          mi.kbd ? h('span', { class: 'kbd' }, mi.kbd) : ''));
      }
      document.body.append(drop);
      const r = item.getBoundingClientRect();
      drop.style.left = `${Math.min(r.left, window.innerWidth - drop.offsetWidth - 8)}px`;
      drop.style.top = `${r.bottom + 2}px`;
      const close = (e: Event) => {
        if (!drop.contains(e.target as Node) && e.target !== item) {
          drop.remove(); item.classList.remove('open');
          window.removeEventListener('mousedown', close);
        }
      };
      setTimeout(() => window.addEventListener('mousedown', close), 0);
    });
    bar.append(item);
  }
  return bar;
}
