// ============================================================================
// NEXUS EDITOR — AI bridge
// Editor-side helpers the agent & panels share: asset drop instantiation,
// AI asset assistant, prefab creation, "fix with AI" wiring.
// ============================================================================
import { store } from './store';
import { editorBus } from '@engine/core/events';
import { addGameObject, addComponent, createPrefabFrom, createScriptAsset } from '@engine/core/ops';
import { assetRefField } from './panels/inspector';
import { h } from './dom';
import type { AssetData } from '@engine/core/types';
import { icon } from './icons';

/** Instantiate a dropped asset into the scene (called by viewport drop). */
export function dropAssetToScene(asset: { id: string; name: string; type: string }, pos: { x: number; y: number; z: number } | null) {
  if (!store.project || !store.scene) return;
  const full = store.project.assets.find(a => a.id === asset.id);
  if (!full) return;
  store.pushUndo(`Place ${full.name}`);
  const position = pos ? { x: pos.x, y: pos.y, z: pos.z } : { x: 0, y: 2, z: 0 };
  if (full.type === 'model') {
    const go = addGameObject(store.project, store.sceneId, full.name.replace(/\.\w+$/, ''), {
      transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    const mr = addComponent(store.project, store.sceneId, go.id, 'MeshRenderer', { mesh: 'Asset' });
    (mr as any).modelAsset = full.id;
    (mr as any).mesh = 'Asset';
    // guess a collider for props
    if (full.meta?.humanoid) {
      addComponent(store.project, store.sceneId, go.id, 'CharacterBody');
    } else {
      addComponent(store.project, store.sceneId, go.id, 'Collider', { shape: 'box', size: { x: 1, y: 1, z: 1 } });
    }
    store.markDirty();
    editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
    store.select([go.id]);
  } else if (full.type === 'prefab') {
    const go = addGameObject(store.project, store.sceneId, `${full.meta?.root ?? 'Prefab'}Instance`, {
      transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
    // replace the placeholder with the prefab tree via runtime spawn at play; for edit mode, embed subtree
    const tree = full.data as any[];
    if (Array.isArray(tree) && tree.length) {
      const idMap = new Map<string, string>();
      for (const t of tree) idMap.set(t.id, 'o_' + Math.random().toString(36).slice(2, 9));
      let i = 0;
      for (const t of tree) {
        const clone = JSON.parse(JSON.stringify(t));
        clone.id = idMap.get(t.id)!;
        clone.parent = t.parent ? idMap.get(t.parent)! : null;
        if (i === 0) {
          // reuse the placeholder object
          store.scene!.objects = store.scene!.objects.filter(o => o.id !== go.id);
        }
        if (i === 0 && pos) clone.transform.position = position;
        store.scene!.objects.push(clone);
        i++;
      }
    }
    store.markDirty();
    editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
  } else if (full.type === 'audio') {
    const go = addGameObject(store.project, store.sceneId, full.name, { transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
    addComponent(store.project, store.sceneId, go.id, 'AudioSource', { clip: full.id });
    store.markDirty();
    editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
    store.select([go.id]);
  }
}

/** Drop an asset as a child of a hierarchy row. */
export function dropAssetAsChild(asset: any, parentId: string) {
  if (asset.type === 'model') {
    const parent = store.scene?.objects.find(o => o.id === parentId);
    dropAssetToScene(asset, parent ? { x: parent.transform.position.x, y: parent.transform.position.y, z: parent.transform.position.z } : null);
  }
}

/**
 * AI Asset Assistant — analyzes an imported asset and offers real actions.
 * "Soldier.glb appears to be a humanoid character" → create Player / NPC / Enemy.
 */
export function assetAssistant(asset: AssetData, forced?: 'player' | 'npc' | 'enemy') {
  const meta = asset.meta ?? {};
  const humanoid = !!meta.humanoid;
  const hasAnims = (meta.animations ?? []).length > 0;

  const title = `${asset.name}: ${humanoid ? 'humanoid character' : meta.meshes ? `${meta.meshes} mesh(es)` : asset.type}${hasAnims ? ` with ${meta.animations.length} animation(s): ${meta.animations.slice(0, 4).join(', ')}` : ''}`;

  const toast = h('div', { class: 'nx-toast', style: { maxWidth: '420px', cursor: 'default' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
      icon('sparkle', 15), h('b', { style: { color: 'var(--text-0)' } }, 'AI Asset Assistant')),
    h('div', { style: { fontSize: '11.5px', lineHeight: '1.5' } },
      `This appears to be a ${humanoid ? '<b>humanoid character</b>' : '<b>3D model</b>'}${meta.height ? ` (~${meta.height}m tall)` : ''}. I can wire it up:`),
  );
  const btns = h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' } });
  const mkAction = (label: string, fn: () => void) => btns.append(h('button', { style: { fontSize: '11px', padding: '4px 10px' }, onclick: () => { fn(); toast.remove(); } }, label));

  const applyTo = (kind: 'player' | 'npc' | 'enemy') => {
    // Drop the model in, attach controller/AI + Animator
    dropAssetToScene({ id: asset.id, name: asset.name, type: 'model' }, null);
    const scene = store.scene!;
    const placed = [...scene.objects].sort((a, b) => scene.objects.indexOf(b) - scene.objects.indexOf(a))[0];
    if (!placed) return;
    store.pushUndo('AI asset wiring');
    if (kind === 'player') {
      addComponent(store.project!, store.sceneId!, placed.id, 'ThirdPersonController');
      addComponent(store.project!, store.sceneId!, placed.id, 'Collider', { shape: 'capsule', radius: 0.42, size: { x: 0.9, y: 1.75, z: 0.9 }, center: { x: 0, y: 0.12, z: 0 } });
      addComponent(store.project!, store.sceneId!, placed.id, 'RigidBody', { mass: 72, lockRotation: true, linearDamping: 0.02 });
      addComponent(store.project!, store.sceneId!, placed.id, 'Health', { maxHealth: 100 });
      placed.tags = ['player'];
      placed.name = 'Player';
    } else {
      addComponent(store.project!, store.sceneId!, placed.id, 'NPC', {
        role: kind === 'enemy' ? 'enemy' : 'neutral', preset: 'custom', initialState: 'patrol',
        moveSpeed: 2.4, chaseSpeed: 4.5, attackDamage: kind === 'enemy' ? 12 : 0, maxHealth: 60,
      });
      addComponent(store.project!, store.sceneId!, placed.id, 'Collider', { shape: 'capsule', radius: 0.4, size: { x: 0.8, y: 1.7, z: 0.8 }, center: { x: 0, y: 0.1, z: 0 } });
      addComponent(store.project!, store.sceneId!, placed.id, 'RigidBody', { mass: 68, lockRotation: true });
      placed.tags = [kind === 'enemy' ? 'enemy' : 'npc'];
      placed.name = asset.name.replace(/\.\w+$/, '');
    }
    if (hasAnims) addComponent(store.project!, store.sceneId!, placed.id, 'Animator', {});
    store.markDirty();
    editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
    store.select([placed.id]);
    editorBus.emit('notify', { kind: 'success', text: `AI wired ${asset.name} as ${kind}` });
  };

  mkAction('Create Player', () => applyTo('player'));
  mkAction('Create NPC', () => applyTo('npc'));
  mkAction('Create Enemy', () => applyTo('enemy'));
  if (!forced) mkAction('Just place it', () => dropAssetToScene({ id: asset.id, name: asset.name, type: 'model' }, null));
  toast.append(btns);
  toast.append(h('div', { style: { fontSize: '10px', color: 'var(--text-3)', marginTop: '8px' } }, 'Analysis: skinned meshes + height heuristics'));
  document.querySelector('.nx-toast-wrap')?.append(toast);
  setTimeout(() => toast.remove(), 25000);
  store.log('info', `[AI Asset Assistant] ${title}`);
}

export function createPrefabFromSelection(objectId: string) {
  if (!store.project || !store.scene) return;
  store.pushUndo('Create prefab');
  const asset = createPrefabFrom(store.project, store.scene.id, objectId);
  if (asset) {
    editorBus.emit('assetsChanged', undefined as any);
    store.markDirty();
    editorBus.emit('notify', { kind: 'success', text: `Prefab created: ${asset.name}` });
  }
}

/** Wire global drop hooks used by the viewport. */
export function installDropHooks() {
  (window as any).__NEXUS_DROP__ = (asset: any, pos: any) => dropAssetToScene(asset, pos);
  (window as any).__NEXUS_DROP_PARENT__ = (asset: any, parentId: string) => dropAssetAsChild(asset, parentId);
}
