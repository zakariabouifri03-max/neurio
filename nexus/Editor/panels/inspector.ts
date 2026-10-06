// ============================================================================
// NEXUS EDITOR — Inspector panel
// Auto-generated property UI from the component registry schema.
// Also renders scene environment settings when nothing is selected, and the
// Material Editor for material assets.
// ============================================================================
import { store } from '../store';
import { editorBus } from '@engine/core/events';
import { getComponentDef, allComponentDefs, type FieldDef } from '@engine/core/registry';
import { removeComponent, setDeep, createMaterialAsset } from '@engine/core/ops';
import { findObject, cloneData } from '@engine/core/types';
import { icon } from '../icons';
import { h, debounce } from '../dom';
import { showContextMenu } from '../menus';
import { parsePropAnnotations } from '@engine/scripting/runtime';

export class InspectorPanel {
  root: HTMLElement;

  constructor() {
    this.root = h('div', { class: 'nx-inspector' });
    editorBus.on('selectionChanged', () => this.render());
    editorBus.on('sceneChanged', () => this.render());
    editorBus.on('assetsChanged', () => this.render());
    editorBus.on('sceneSwitched', () => this.render());
    this.render();
  }

  render() {
    const el = this.root;
    el.innerHTML = '';
    if (!store.project) { el.append(h('div', { class: 'nx-empty' }, 'No project open')); return; }

    // material asset selected in asset browser?
    const matAsset = store.project.assets.find(a => a.id === (window as any).__NEXUS_SELECTED_ASSET__ && a.type === 'material');
    if (matAsset) { this.renderMaterialEditor(el, matAsset.id); return; }

    const obj = store.selectedObject;
    if (!obj) { this.renderSceneSettings(el); return; }
    this.renderObject(el, obj.id);
  }

  // ------------------------------ object view --------------------------------

  private renderObject(el: HTMLElement, id: string) {
    const scene = store.scene!;
    const obj = findObject(scene, id)!;
    el.append(h('div', { class: 'nx-insp-header' },
      icon('box', 16),
      h('input', {
        class: 'objname', value: obj.name,
        onchange: (e: any) => {
          store.pushUndo('Rename');
          obj.name = e.target.value;
          store.markDirty();
          editorBus.emit('sceneChanged', { sceneId: scene.id, structural: true });
        },
      }),
      h('span', { class: 'nx-kbd', title: 'Object id' }, obj.id.slice(0, 8)),
    ));

    // active & tags
    el.append(h('div', { class: 'nx-field' },
      h('label', {}, 'Active'),
      h('div', { class: 'control' }, h('input', { type: 'checkbox', checked: obj.active, onchange: (e: any) => { obj.active = e.target.checked; store.markDirty(); editorBus.emit('sceneChanged', { sceneId: scene.id, structural: true }); } })),
    ));
    el.append(h('div', { class: 'nx-field' },
      h('label', {}, 'Tags'),
      h('div', { class: 'control' }, h('input', {
        type: 'text', value: obj.tags.join(', '), placeholder: 'player, enemy…',
        onchange: (e: any) => { obj.tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean); store.markDirty(); editorBus.emit('sceneChanged', { sceneId: scene.id, structural: true }); },
      })),
    ));

    // transform
    el.append(h('div', { class: 'nx-section-title' }, 'Transform'));
    el.append(this.vec3Field('Position', obj.transform.position, (p) => { obj.transform.position = p; this.softSceneUpdate(); }));
    el.append(this.vec3Field('Rotation', obj.transform.rotation, (p) => { obj.transform.rotation = p; this.softSceneUpdate(); }, true));
    el.append(this.vec3Field('Scale', obj.transform.scale, (p) => { obj.transform.scale = p; this.softSceneUpdate(); }));

    // components
    for (let i = 0; i < obj.components.length; i++) {
      const comp = obj.components[i];
      el.append(this.renderComponent(obj, comp, i));
    }

    // add component
    el.append(h('button', {
      class: 'nx-addcomp-btn', onclick: (e) => this.addComponentMenu(obj.id, e.target as HTMLElement),
    }, icon('plus', 12), ' Add Component'));
  }

  private renderComponent(obj: any, comp: any, index: number): HTMLElement {
    const def = getComponentDef(comp.type);
    const body = h('div', { class: 'nx-comp-body' });
    if (!def) {
      body.append(h('div', { style: { color: 'var(--red)' } }, `Unknown component: ${comp.type}`));
    } else {
      // script components: show props from annotations
      if (comp.type === 'Script') this.renderScriptComponent(body, obj, comp);
      else if (comp.type === 'VisualScript') this.renderVisualScriptComponent(body, obj, comp);
      else {
        for (const f of def.schema) {
          if (f.type === 'section') { body.append(h('div', { class: 'nx-section-title' }, f.label)); continue; }
          body.append(this.field(f, comp, () => this.softSceneUpdate(obj.id)));
        }
        if (!def.schema.length) body.append(h('div', { style: { color: 'var(--text-3)', fontSize: '11px' } }, def.description));
      }
    }
    const header = h('div', { class: 'nx-comp-header', onclick: (e: Event) => { if ((e.target as HTMLElement).tagName !== 'INPUT') compEl.classList.toggle('collapsed'); } },
      icon(def?.icon ?? 'box', 13),
      h('span', {}, def?.label ?? comp.type),
      h('span', {
        class: 'nx-tbtn small enabled', title: 'Toggle enabled',
        onclick: (e: Event) => { e.stopPropagation(); comp.enabled = comp.enabled === false ? true : false; store.markDirty(); },
      }),
      h('input', {
        type: 'checkbox', class: 'enabled', checked: comp.enabled !== false, style: { cursor: 'pointer' },
        onclick: (e: Event) => e.stopPropagation(),
        onchange: (e: any) => { comp.enabled = e.target.checked; store.markDirty(); editorBus.emit('objectsChanged', { ids: [obj.id] }); },
      }),
    );
    const compEl = h('div', { class: 'nx-comp' }, header, body);
    compEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: 'Remove Component', danger: true, fn: () => {
          store.pushUndo('Remove component');
          if (store.scene) removeComponent(store.project!, store.scene.id, obj.id, comp.type, index);
          store.markDirty();
          editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
        } },
        { label: 'Reset to Defaults', fn: () => {
          store.pushUndo('Reset component');
          const d = getComponentDef(comp.type)?.defaults() ?? {};
          for (const k of Object.keys(comp)) if (k !== 'type' && k !== 'enabled') delete comp[k];
          Object.assign(comp, d);
          store.markDirty();
          editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
        } },
      ]);
    });
    return compEl;
  }

  private renderScriptComponent(body: HTMLElement, obj: any, comp: any) {
    const script = store.project!.scripts[comp.script];
    if (!script) {
      body.append(h('div', { class: 'nx-field' }, h('label', {}, 'Script'), h('div', { class: 'control', style: { color: 'var(--red)' } }, 'missing script asset')));
      return;
    }
    body.append(h('div', { class: 'nx-field' }, h('label', {}, 'Script'),
      h('div', { class: 'control' }, h('button', {
        onclick: () => editorBus.emit('scriptOpened', { scriptId: script.id }),
        style: { flex: '1' },
      }, icon('code', 12), ` ${script.name}.js`))));
    const props = parsePropAnnotations(script.source);
    for (const p of props) {
      const value = comp.props?.[p.key] ?? p.def;
      body.append(this.field({
        key: `props.${p.key}`, label: p.label, type: p.type === 'boolean' ? 'bool' : p.type === 'number' ? 'number' : 'string',
      } as FieldDef, comp, () => this.softSceneUpdate(obj.id), value));
    }
    if (!props.length) body.append(h('div', { style: { color: 'var(--text-3)', fontSize: '11px' } }, 'Add “/** @prop {number} speed = 1 */” annotations above the class to expose properties here.'));
  }

  private renderVisualScriptComponent(body: HTMLElement, obj: any, comp: any) {
    const hasGraph = !!comp.graph;
    body.append(h('div', { class: 'nx-field' }, h('label', {}, 'Graph'),
      h('div', { class: 'control' }, h('button', {
        onclick: () => editorBus.emit('scriptOpened', { scriptId: `vs:${obj.id}` }),
        style: { flex: '1' },
      }, icon('flow', 12), hasGraph ? ' Edit Graph' : ' Create Graph'))));
    body.append(h('div', { style: { color: 'var(--text-3)', fontSize: '11px' } }, 'Node-based logic: events → conditions → actions.'));
  }

  private addComponentMenu(objectId: string, anchor: HTMLElement) {
    const cats: [string, string][] = [
      ['render', 'Rendering'], ['physics', 'Physics'], ['gameplay', 'Gameplay'],
      ['ai', 'AI'], ['environment', 'Environment'], ['audio', 'Audio'], ['logic', 'Animation & Logic'], ['scripting', 'Scripting'],
    ];
    const items: any[] = [];
    for (const [cat, label] of cats) {
      const defs = allComponentDefs().filter(d => d.category === cat);
      if (!defs.length) continue;
      items.push({ label, header: true });
      for (const d of defs) items.push({ label: d.label, icon: d.icon, fn: () => {
        store.pushUndo(`Add ${d.type}`);
        obj_addComponent(objectId, d.type);
      } });
    }
    showContextMenu(anchor, items);
  }

  // ------------------------------ field builders -----------------------------

  private field(f: FieldDef, target: any, onChange: () => void, presetValue?: any): HTMLElement {
    const value = presetValue !== undefined ? presetValue : getPath(target, f.key);
    const set = (v: any) => { setDeep(target, f.key, v); store.markDirty(); onChange(); };
    const label = h('label', { title: f.hint ?? f.key }, f.label);
    let control: HTMLElement;
    switch (f.type) {
      case 'number':
        control = h('input', { type: 'number', value: fmtNum(value), step: f.step ?? 0.1, ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}), oninput: debounce((e: any) => set(parseFloat(e.target.value) || 0), 120) });
        break;
      case 'bool':
        control = h('div', { class: 'control' }, h('input', { type: 'checkbox', checked: !!value, onchange: (e: any) => set(e.target.checked) }));
        break;
      case 'enum':
        control = h('select', { onchange: (e: any) => set(e.target.value) },
          (f.options ?? []).map(o => h('option', { value: o, ...(o === value ? { selected: true } : {}) }, o)));
        break;
      case 'color':
        control = h('input', { type: 'color', value: rgbHex(value), oninput: debounce((e: any) => set(e.target.value), 100) });
        break;
      case 'string':
        control = h('input', { type: 'text', value: value ?? '', onchange: (e: any) => set(e.target.value) });
        break;
      case 'vec3':
        return this.vec3Field(f.label, value, (v) => { set(v); }, false, f.key, target);
      case 'vec3list':
        control = h('div', { class: 'control', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '3px' } },
          h('span', { style: { fontSize: '10.5px', color: 'var(--text-3)' } }, `${(value ?? []).length} point(s)`),
          h('button', { style: { fontSize: '10.5px', padding: '2px 8px' }, onclick: () => {
            const pts = value ?? [];
            const p = prompt('Add patrol point "x,y,z"', '0,0,0');
            if (p) { const m = p.match(/-?\d+(\.\d+)?/g); if (m && m.length >= 3) { pts.push({ x: +m[0], y: +m[1], z: +m[2] }); set(pts); this.render(); } }
          } }, '+ Add Point'),
          ...(value ?? []).map((pt: any, i: number) => h('span', {
            style: { fontSize: '10px', color: 'var(--text-2)', cursor: 'pointer' },
            onclick: () => { const pts = value.filter((_: any, j: number) => j !== i); set(pts); this.render(); },
            title: 'Click to remove',
          }, `${i + 1}. ${pt.x.toFixed(0)}, ${pt.y.toFixed(0)}, ${pt.z.toFixed(0)} ✕`)),
        );
        break;
      case 'asset':
        control = assetRefField(f.assetType ?? 'model', value, (v) => set(v));
        break;
      case 'objectref': {
        const sel = h('select', { onchange: (e: any) => set(e.target.value || null) },
          h('option', { value: '' }, '— none —'),
          ...(store.scene?.objects ?? []).map(o => h('option', { value: o.id, ...(o.id === value ? { selected: true } : {}) }, o.name)));
        control = sel;
        break;
      }
      default:
        control = h('span', { style: { color: 'var(--text-3)' } }, String(value ?? ''));
    }
    if (f.type === 'bool') return h('div', { class: 'nx-field' }, label, control);
    return h('div', { class: 'nx-field' }, label, h('div', { class: 'control' }, control));
  }

  private vec3Field(label: string, value: any, set: (v: any) => void, degrees = false, key?: string, target?: any): HTMLElement {
    const mk = (axis: 'x' | 'y' | 'z', hint: string) => {
      const input = h('input', {
        type: 'number', step: degrees ? 5 : 0.1, value: fmtNum(value?.[axis] ?? 0),
        oninput: debounce(() => {
          const v = { x: value.x, y: value.y, z: value.z };
          v[axis] = parseFloat(input.value) || 0;
          set(v);
        }, 100),
      });
      return h('div', { class: 'cell' }, h('span', {}, hint), input);
    };
    return h('div', { class: 'nx-field' },
      h('label', {}, label),
      h('div', { class: 'nx-vec3' }, mk('x', 'X'), mk('y', 'Y'), mk('z', 'Z')));
  }

  private softSceneUpdate(objectId?: string) {
    editorBus.emit('objectsChanged', { ids: objectId ? [objectId] : store.selection });
  }

  // ------------------------------ scene settings ------------------------------

  private renderSceneSettings(el: HTMLElement) {
    const scene = store.scene;
    if (!scene) { el.append(h('div', { class: 'nx-empty' }, icon('cube'), 'Select an object to inspect it.', h('div', { style: { fontSize: '11px' } }, 'With nothing selected, scene settings are shown here.'))); return; }
    const env = scene.environment;
    el.append(h('div', { class: 'nx-section-title' }, `Scene — ${scene.name}`));
    const f = (label: string, key: string, type: 'number' | 'color' | 'string' | 'bool' | 'enum', options?: string[]) => {
      el.append(this.field({ key, label, type, options } as FieldDef, env, () => { editorBus.emit('sceneChanged', { sceneId: scene.id, structural: false }); editorBus.emit('objectsChanged', { ids: [] }); }));
    };
    f('Sky Top', 'skyTop', 'color');
    f('Sky Bottom', 'skyBottom', 'color');
    f('Ambient Color', 'ambientColor', 'color');
    f('Ambient Intensity', 'ambientIntensity', 'number');
    f('Sun Color', 'sunColor', 'color');
    f('Sun Intensity', 'sunIntensity', 'number');
    f('Sun Angle', 'sunAngle', 'number');
    f('Sun Elevation', 'sunElevation', 'number');
    f('Shadows', 'shadows', 'bool');
    f('Fog Mode', 'fogMode', 'enum', ['none', 'linear', 'exponential']);
    f('Fog Color', 'fogColor', 'color');
    f('Fog Near', 'fogNear', 'number');
    f('Fog Far', 'fogFar', 'number');
    f('Fog Density', 'fogDensity', 'number');
    el.append(h('div', { class: 'nx-section-title' }, 'Project'));
    el.append(h('div', { class: 'nx-field' }, h('label', {}, 'Entry Scene'),
      h('div', { class: 'control' }, h('select', {
        onchange: (e: any) => { store.project!.settings.entrySceneId = e.target.value; store.markDirty(); },
      }, store.project!.scenes.map(s => h('option', { value: s.id, ...(s.id === store.project!.settings.entrySceneId ? { selected: true } : {}) }, s.name))))));
    for (const q of ['low', 'medium', 'high', 'ultra'] as const) {
      // graphics quality shown as enum field
    }
    el.append(this.field({ key: 'graphicsQuality', label: 'Graphics Quality', type: 'enum', options: ['low', 'medium', 'high', 'ultra'] } as FieldDef, store.project!.settings, () => store.markDirty()));
  }

  // ------------------------------ material editor -----------------------------

  private renderMaterialEditor(el: HTMLElement, assetId: string) {
    const asset = store.project!.assets.find(a => a.id === assetId)!;
    const data = asset.data ?? {};
    el.append(h('div', { class: 'nx-section-title' }, `Material — ${asset.name}`));
    const preview = h('div', {
      style: {
        width: '100%', height: '140px', borderRadius: '6px', border: '1px solid var(--border-1)',
        marginBottom: '10px', background: `radial-gradient(circle at 35% 30%, #fff3 0%, transparent 55%), ${data.color ?? '#777'}`,
        boxShadow: 'inset 0 -22px 40px rgba(0,0,0,.45)',
      },
    }, h('div', { style: { textAlign: 'center', paddingTop: '56px', color: 'var(--text-3)', fontSize: '10px' } }, 'real-time preview (sphere)'));
    el.append(preview);
    const f = (label: string, key: string, type: any, min?: number, max?: number) => {
      el.append(this.field({ key, label, type, min, max } as FieldDef, data, () => { store.markDirty(); (window as any).__NEXUS_MATERIAL_UPDATED__?.(assetId); }));
    };
    f('Base Color', 'color', 'color');
    f('Metallic', 'metallic', 'number', 0, 1);
    f('Roughness', 'roughness', 'number', 0, 1);
    f('Emission', 'emissive', 'color');
    f('Emission Intensity', 'emissiveIntensity', 'number', 0, 10);
    f('Opacity', 'opacity', 'number', 0, 1);
    f('Double Sided', 'doubleSided', 'bool');
    el.append(h('div', { class: 'nx-section-title' }, 'Textures'));
    for (const [key, label] of [['map', 'Base Map'], ['normalMap', 'Normal Map']] as const) {
      el.append(this.field({ key, label, type: 'asset', assetType: 'texture' } as FieldDef, data, () => { store.markDirty(); (window as any).__NEXUS_MATERIAL_UPDATED__?.(assetId); }));
    }
    el.append(h('button', {
      style: { marginTop: '12px', width: '100%' },
      onclick: () => { (window as any).__NEXUS_SELECTED_ASSET__ = null; this.render(); },
    }, '← Back to Inspector'));
  }
}

// helpers ----------------------------------------------------------------------

function obj_addComponent(objectId: string, type: string) {
  const p = store.project!;
  const obj = findObject(store.scene!, objectId);
  if (!obj) return;
  const comp = { type, enabled: true } as any;
  const def = getComponentDef(type);
  if (def) Object.assign(comp, def.defaults());
  obj.components.push(comp);
  store.markDirty();
  editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
  editorBus.emit('selectionChanged', { ids: [objectId] });
}

function getPath(obj: any, path: string) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function fmtNum(v: any) { return typeof v === 'number' ? Math.round(v * 1000) / 1000 : (v ?? 0); }
function rgbHex(v: any): string {
  if (typeof v === 'string' && v.startsWith('#')) return v;
  if (typeof v === 'number') return '#' + v.toString(16).padStart(6, '0');
  return v ?? '#ffffff';
}

export function assetRefField(assetType: string, value: any, set: (v: any) => void): HTMLElement {
  const assets = store.project?.assets.filter(a => a.type === assetType) ?? [];
  const asset = assets.find(a => a.id === value);
  const wrap = h('div', {
    class: `nx-assetref${asset ? ' filled' : ''}`,
    ...(asset ? { draggable: 'false' } : {}),
    title: asset ? `${asset.name} (${assetType})` : `Drop or click to assign a ${assetType}`,
    onclick: () => {
      // cycle through available assets on click
      if (!assets.length) return;
      const idx = assets.findIndex(a => a.id === value);
      const next = assets[(idx + 1) % assets.length];
      set(next.id);
    },
  }, icon('file', 12), asset ? asset.name : `— assign ${assetType} —`);
  if (asset) wrap.append(h('span', { class: 'clear', onclick: (e: Event) => { e.stopPropagation(); set(null); } }, '✕'));
  wrap.ondragover = (e) => { e.preventDefault(); wrap.style.borderColor = 'var(--accent)'; };
  wrap.ondragleave = () => { wrap.style.borderColor = ''; };
  wrap.ondrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.style.borderColor = '';
    try {
      const a = JSON.parse(e.dataTransfer?.getData('application/nexus-asset') ?? 'null');
      if (a && a.type === assetType) set(a.id);
    } catch { }
  };
  return wrap;
}
