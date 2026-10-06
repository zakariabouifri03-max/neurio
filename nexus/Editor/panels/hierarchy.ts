// ============================================================================
// NEXUS EDITOR — Scene Hierarchy panel
// Tree view, drag-reparent, search, context menus, visibility/lock toggles.
// ============================================================================
import { store } from '../store';
import { editorBus } from '@engine/core/events';
import { flattenHierarchy, findObject, type GameObjectData } from '@engine/core/types';
import { icon } from '../icons';
import { h } from '../dom';
import { removeGameObject, duplicateGameObject, addGameObject, setParent } from '@engine/core/ops';
import { showContextMenu } from '../menus';

export class HierarchyPanel {
  root: HTMLElement;
  private search = '';

  constructor() {
    this.root = h('div', { class: 'nx-hierarchy', tabindex: '0' });
    editorBus.on('sceneChanged', () => this.render());
    editorBus.on('sceneSwitched', () => this.render());
    editorBus.on('selectionChanged', () => this.render());
    editorBus.on('playModeChanged', () => this.render());
    this.render();
  }

  toolbar(): HTMLElement {
    return h('div', { class: 'nx-toolbar-row' },
      h('input', {
        type: 'text', placeholder: 'Search objects…', style: { flex: '1' },
        oninput: (e: any) => { this.search = e.target.value.toLowerCase(); this.render(); },
      }),
      sceneSelector(),
      h('button', {
        class: 'nx-tbtn small', title: 'Create empty object',
        onclick: () => this.createMenu(),
      }, icon('plus', 13)),
    );
  }

  private createMenu(anchorEl?: HTMLElement) {
    const items = [
      { label: 'Empty Object', fn: () => this.createObject('EmptyObject') },
      { label: 'Cube', fn: () => this.createObject('Cube', 'MeshRenderer') },
      { label: 'Sphere', fn: () => this.createObject('Sphere', 'MeshRenderer') },
      { label: 'Light', fn: () => this.createObject('Light', 'Light') },
      { label: 'Camera', fn: () => this.createObject('Camera', 'Camera') },
      { label: 'Audio Source', fn: () => this.createObject('AudioSource', 'AudioSource') },
    ];
    showContextMenu(anchorEl ?? this.root, items.map(i => ({ label: i.label, fn: i.fn })));
  }

  private createObject(name: string, comp?: string) {
    if (!store.project || !store.scene) return;
    store.pushUndo('Create object');
    const go = addGameObject(store.project, store.sceneId, name);
    if (comp) go.components.push({ type: comp, enabled: true } as any);
    store.markDirty();
    editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
    store.select([go.id]);
  }

  render() {
    const el = this.root;
    el.innerHTML = '';
    const scene = store.scene;
    if (!scene) {
      el.append(h('div', { class: 'nx-empty' }, 'No scene'));
      return;
    }
    const objects = flattenHierarchy(scene).filter(o => !this.search || o.name.toLowerCase().includes(this.search));
    const selected = new Set(store.selection);
    for (const o of objects) {
      const depth = depthOf(scene, o);
      const isParent = scene.objects.some(x => x.parent === o.id);
      const row = h('div', {
        class: `nx-hier-row${selected.has(o.id) ? ' selected' : ''}${o.active ? '' : ' inactive'}`,
        style: { paddingLeft: `${6 + depth * 15}px` },
        draggable: 'true',
        onclick: (e: MouseEvent) => {
          if (e.shiftKey) {
            const sel = new Set(store.selection);
            sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id);
            store.select([...sel]);
          } else store.select([o.id]);
        },
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); this.objectMenu(o, e); },
        ondragstart: (e: DragEvent) => e.dataTransfer?.setData('text/nexus-object', o.id),
        ondragover: (e: DragEvent) => { e.preventDefault(); row.classList.add('drop-target'); },
        ondragleave: () => row.classList.remove('drop-target'),
        ondrop: (e: DragEvent) => {
          e.preventDefault(); e.stopPropagation();
          row.classList.remove('drop-target');
          const id = e.dataTransfer?.getData('text/nexus-object');
          const assetJson = e.dataTransfer?.getData('application/nexus-asset');
          if (id && store.project && store.scene) {
            store.pushUndo('Reparent object');
            setParent(store.project, store.scene.id, id, o.id);
            store.markDirty();
            editorBus.emit('sceneChanged', { sceneId: store.scene.id, structural: true });
          } else if (assetJson) {
            (window as any).__NEXUS_DROP_PARENT__?.(JSON.parse(assetJson), o.id);
          }
        },
      },
        h('span', { class: 'caret', onclick: (e: Event) => { e.stopPropagation(); o.expanded = !o.expanded; this.render(); } }, isParent ? (o.expanded !== false ? '▾' : '▸') : ''),
        icon(objectIcon(o), 13),
        h('span', { class: 'name' }, o.name),
        o.components.length ? h('span', { style: { color: 'var(--text-3)', fontSize: '9.5px' } }, `${o.components.length}`) : '',
        h('span', {
          class: 'rowactions',
          onclick: (e: Event) => { e.stopPropagation(); o.active = !o.active; store.markDirty(); editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true }); },
          title: 'Toggle active',
        }, icon(o.active ? 'eye' : 'eyeOff', 12)),
      );
      el.append(row);
    }
    if (!objects.length) el.append(h('div', { class: 'nx-empty' }, 'Scene is empty', h('div', { style: { fontSize: '11px' } }, 'Right-click or use ▢ to add objects. Try the AI: “Create a third-person player”.')));

    // root drop zone (drag to top level)
    el.ondragover = (e) => e.preventDefault();
    el.ondrop = (e) => {
      const id = e.dataTransfer?.getData('text/nexus-object');
      if (id && store.project && store.scene && e.target === el) {
        store.pushUndo('Reparent object');
        setParent(store.project, store.scene.id, id, null);
        store.markDirty();
        editorBus.emit('sceneChanged', { sceneId: store.scene.id, structural: true });
      }
    };
  }

  private objectMenu(o: GameObjectData, e: MouseEvent) {
    showContextMenu(e, [
      { label: 'Create Child ▸', fn: () => this.createMenu() },
      { label: 'Duplicate', fn: () => this.duplicate(o) },
      { label: 'Rename', fn: () => { const name = prompt('Rename object', o.name); if (name && store.scene) { store.pushUndo('Rename'); o.name = name; store.markDirty(); editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true }); } } },
      { label: 'Unparent', fn: () => { if (store.project && store.scene) { store.pushUndo('Unparent'); setParent(store.project, store.scene.id, o.id, null); store.markDirty(); editorBus.emit('sceneChanged', { sceneId: store.scene.id, structural: true }); } } },
      { sep: true },
      { label: o.locked ? 'Unlock' : 'Lock', fn: () => { o.locked = !o.locked; store.markDirty(); this.render(); } },
      { label: 'Create Prefab', fn: () => { import('../ai-bridge').then(m => m.createPrefabFromSelection(o.id)); } },
      { sep: true },
      { label: 'Delete', danger: true, fn: () => this.deleteObject(o) },
    ]);
  }

  private duplicate(o: GameObjectData) {
    if (!store.project || !store.scene) return;
    store.pushUndo('Duplicate');
    const c = duplicateGameObject(store.project, store.scene.id, o.id);
    store.markDirty();
    editorBus.emit('sceneChanged', { sceneId: store.scene.id, structural: true });
    if (c) store.select([c.id]);
  }

  private deleteObject(o: GameObjectData) {
    if (!store.project || !store.scene) return;
    store.pushUndo('Delete object');
    removeGameObject(store.project, store.scene.id, o.id);
    store.select([]);
    store.markDirty();
    editorBus.emit('sceneChanged', { sceneId: store.scene.id, structural: true });
  }
}

export function depthOf(scene: any, o: GameObjectData): number {
  let d = 0, p = o.parent;
  while (p) { d++; p = findObject(scene, p)?.parent ?? null; }
  return d;
}

export function objectIcon(o: GameObjectData): string {
  if (o.components.some(c => ['ThirdPersonController', 'FirstPersonController', 'TopDownController'].includes(c.type))) return 'person';
  const first = o.components[0]?.type;
  const map: Record<string, string> = {
    Light: 'light', Camera: 'camera', MeshRenderer: 'cube', Terrain: 'mountain', Water: 'water',
    NPC: 'bot', Spawner: 'spawn', AudioSource: 'audio', DayNightCycle: 'sun', Script: 'code',
    VisualScript: 'flow', Door: 'door', Pickup: 'gift', Checkpoint: 'flag', Weapon: 'sword',
  };
  for (const c of o.components) if (map[c.type]) return map[c.type];
  return first ? 'cube' : 'box';
}

export function sceneSelector(): HTMLElement {
  const select = h('select', {
    title: 'Active scene',
    onchange: (e: any) => {
      store.sceneId = e.target.value;
      editorBus.emit('sceneSwitched', { sceneId: store.sceneId! });
    },
  });
  for (const s of store.project?.scenes ?? []) {
    const opt = h('option', { value: s.id }, `${s.name}${s.id === store.project?.settings.entrySceneId ? ' ⭐' : ''}`);
    if (s.id === store.sceneId) (opt as any).selected = true;
    select.append(opt);
  }
  return select;
}
