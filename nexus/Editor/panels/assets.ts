// ============================================================================
// NEXUS EDITOR — Asset Browser panel
// Import (GLB/GLTF/FBX/OBJ models, textures, audio), auto thumbnails,
// category filters, search, drag → drop into viewport, AI asset assistant.
// ============================================================================
import { store } from '../store';
import { editorBus } from '@engine/core/events';
import { icon } from '../icons';
import { h } from '../dom';
import { addGameObject, addComponent, createMaterialAsset } from '@engine/core/ops';
import type { AssetData } from '@engine/core/types';
import { showContextMenu } from '../menus';
import { assetAssistant } from '../ai-bridge';

const TYPE_ICON: Record<string, string> = {
  model: 'cube', texture: 'layers', material: 'sphere', audio: 'audio',
  animation: 'play', script: 'code', prefab: 'package', scene: 'file', uitemplate: 'grid', other: 'file',
};

export class AssetsPanel {
  root: HTMLElement;
  private filter = 'all';
  private search = '';

  constructor() {
    this.root = h('div', { class: 'nx-assets' });
    editorBus.on('assetsChanged', () => this.render());
    this.render();
  }

  toolbar(): HTMLElement {
    const cats = ['all', 'model', 'material', 'texture', 'audio', 'prefab', 'script'];
    const sel = h('select', { onchange: (e: any) => { this.filter = e.target.value; this.render(); } },
      cats.map(c => h('option', { value: c, ...(c === this.filter ? { selected: true } : {}) }, c === 'all' ? 'All Types' : c)));
    return h('div', { class: 'nx-toolbar-row' },
      sel,
      h('input', { type: 'text', placeholder: 'Search assets…', style: { flex: '1' }, oninput: (e: any) => { this.search = e.target.value.toLowerCase(); this.render(); } }),
      h('button', { class: 'nx-tbtn small', title: 'Import assets (GLB, GLTF, FBX, OBJ, PNG, JPG, WAV, MP3, OGG)', onclick: () => this.importFiles() }, icon('plus', 13), ' Import'),
    );
  }

  importFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.glb,.gltf,.fbx,.obj,.png,.jpg,.jpeg,.webp,.wav,.mp3,.ogg';
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      for (const f of files) await this.importFile(f);
    };
    input.click();
  }

  async importFile(file: File): Promise<AssetData | null> {
    if (!store.project) return null;
    const form = new FormData();
    form.append('file', file);
    store.log('info', `Importing ${file.name} (${(file.size / 1024).toFixed(1)} KB)…`);
    try {
      const res = await fetch(`/api/projects/${store.project.id}/assets`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const asset: AssetData = await res.json();
      store.project.assets.push(asset);
      store.markDirty();
      // thumbnails + meta (models: render preview; textures: use directly)
      this.generateThumbnail(asset);
      editorBus.emit('assetsChanged', undefined as any);
      store.log('info', `✓ Imported ${asset.name} [${asset.type}]`);
      // AI asset assistant analysis
      if (asset.type === 'model') assetAssistant(asset);
      return asset;
    } catch (e: any) {
      store.log('error', `Import failed for ${file.name}: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Render model previews / texture thumbs with an offscreen renderer. */
  generateThumbnail(asset: AssetData) {
    const ext = (asset.path || asset.name).split('.').pop()?.toLowerCase();
    if (asset.type === 'texture') {
      const img = new Image();
      img.onload = () => { asset.thumbnail = downscale(img, 96); editorBus.emit('assetsChanged', undefined as any); };
      img.src = asset.path;
      return;
    }
    if (asset.type !== 'model') return;
    import('three').then(async (THREE: any) => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const buffer = await (await fetch(asset.path)).arrayBuffer();
        let root: any = null;
        let animations: string[] = [];
        if (ext === 'glb' || ext === 'gltf') {
          const gltf = await new Promise<any>((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
          root = gltf.scene; animations = (gltf.animations ?? []).map((a: any) => a.name);
        } else if (ext === 'fbx') {
          root = new FBXLoader().parse(buffer, ''); animations = (root.animations ?? []).map((a: any) => a.name);
        } else if (ext === 'obj') {
          root = new OBJLoader().parse(await (await fetch(asset.path)).text());
        }
        if (!root) return;
        // analyze
        let meshes = 0, skinned = 0, materials = new Set<string>();
        root.traverse((o: any) => {
          if (o.isMesh) { meshes++; if (o.isSkinnedMesh) skinned++; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m && materials.add(m.name || 'mat')); }
        });
        const bbox = new THREE.Box3().setFromObject(root);
        const heightMeters = bbox.getSize(new THREE.Vector3()).y;
        asset.meta = { ...asset.meta, meshes, skinnedMeshes: skinned, materials: materials.size, animations, humanoid: skinned > 0 && heightMeters > 1.2, height: +heightMeters.toFixed(2) };
        // thumbnail
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#10141b');
        scene.add(root);
        const light = new THREE.HemisphereLight(0xffffff, 0x334455, 2.2);
        scene.add(light);
        const dir = new THREE.DirectionalLight(0xffffff, 2.5);
        dir.position.set(3, 5, 4); scene.add(dir);
        const size = bbox.getSize(new THREE.Vector3()).length() || 1;
        const center = bbox.getCenter(new THREE.Vector3());
        const cam = new THREE.PerspectiveCamera(38, 1, 0.01, size * 10);
        cam.position.set(center.x + size * 0.9, center.y + size * 0.65, center.z + size * 0.9);
        cam.lookAt(center);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
        renderer.setSize(192, 192);
        renderer.render(scene, cam);
        asset.thumbnail = renderer.domElement.toDataURL('image/jpeg', 0.72);
        renderer.dispose();
        root.traverse((o: any) => { o.geometry?.dispose?.(); });
        editorBus.emit('assetsChanged', undefined as any);
        store.markDirty();
      } catch (e: any) {
        store.log('warning', `Thumbnail generation failed for ${asset.name}: ${e?.message ?? e}`);
      }
    });
  }

  render() {
    const el = this.root;
    el.innerHTML = '';
    if (!store.project) { el.append(h('div', { class: 'nx-empty' }, 'No project')); return; }
    const assets = store.project.assets.filter(a =>
      (this.filter === 'all' || a.type === this.filter) &&
      (!this.search || a.name.toLowerCase().includes(this.search)));
    if (!assets.length) {
      el.append(h('div', { class: 'nx-empty' }, icon('folder', 34), 'No assets yet.', h('div', { style: { fontSize: '11px' } }, 'Import GLB / FBX / OBJ models, textures, audio — or ask the AI to create materials.')));
      return;
    }
    const grid = h('div', { class: 'nx-asset-grid' });
    for (const a of assets) {
      const card = h('div', {
        class: `nx-asset-card${(window as any).__NEXUS_SELECTED_ASSET__ === a.id ? ' selected' : ''}`,
        draggable: 'true',
        onclick: () => { (window as any).__NEXUS_SELECTED_ASSET__ = a.id; editorBus.emit('selectionChanged', { ids: [] }); this.render(); },
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); this.assetMenu(a, e); },
        ondragstart: (e: DragEvent) => {
          e.dataTransfer?.setData('application/nexus-asset', JSON.stringify({ id: a.id, name: a.name, type: a.type }));
          e.dataTransfer!.effectAllowed = 'copy';
        },
      },
        h('div', { class: 'thumb' },
          a.thumbnail ? h('img', { src: a.thumbnail, draggable: 'false' }) : icon(TYPE_ICON[a.type] ?? 'file', 30)),
        h('div', { class: 'name', title: a.name }, a.name),
        h('div', { class: 'meta' }, a.type + (a.size ? ` · ${(a.size / 1024).toFixed(0)}KB` : '')),
      );
      grid.append(card);
    }
    el.append(grid);
  }

  private assetMenu(a: AssetData, e: MouseEvent) {
    const items: any[] = [];
    if (a.type === 'model') {
      items.push(
        { label: 'Add To Scene', fn: () => (window as any).__NEXUS_DROP__({ id: a.id, name: a.name, type: a.type }, null) },
        { label: 'AI: Create Player With This Model', fn: () => assetAssistant(a, 'player') },
        { label: 'AI: Create NPC / Enemy With This Model', fn: () => assetAssistant(a, 'npc') },
      );
    }
    if (a.type === 'texture') {
      items.push({ label: 'Create Material From Texture', fn: () => {
        store.pushUndo('Create material');
        const mat = createMaterialAsset(store.project!, `${a.name} Material`, { map: a.id });
        editorBus.emit('assetsChanged', undefined as any);
        store.markDirty();
      } });
    }
    if (a.type === 'prefab') items.push({ label: 'Add To Scene', fn: () => (window as any).__NEXUS_DROP__({ id: a.id, name: a.name, type: a.type }, null) });
    if (a.type === 'script') items.push({ label: 'Open Script', fn: () => editorBus.emit('scriptOpened', { scriptId: a.id }) });
    items.push({ sep: true }, { label: 'Delete Asset', danger: true, fn: () => {
      store.pushUndo('Delete asset');
      store.project!.assets = store.project!.assets.filter(x => x.id !== a.id);
      editorBus.emit('assetsChanged', undefined as any);
      store.markDirty();
    } });
    showContextMenu(e, items);
  }
}

function downscale(img: HTMLImageElement, size: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const scale = Math.max(size / img.width, size / img.height);
  g.drawImage(img, (size - img.width * scale) / 2, (size - img.height * scale) / 2, img.width * scale, img.height * scale);
  return c.toDataURL('image/jpeg', 0.75);
}


