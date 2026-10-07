import React, { useMemo, useState } from 'react';
import { useMedia, importFiles, deleteAsset, updateAsset } from '@/engine/MediaManager';
import type { MediaAsset } from '@/core/types';
import { useFavorites } from '@/services/favorites';
import { KV } from '@/services/db';
import { useProject, useSelectedClip } from '@/core/store';
import { toast } from '@/core/uiStore';
import * as act from '@/services/clipActions';
import { SearchBox, Chips, FavButton, Empty, ContextMenu, pickFiles, useDropFiles } from '../common';
import { PanelHeader } from './LeftPanels';
import { Upload, Film, Music, Image as ImageIcon, Plus, Folder, FolderPlus, Star, Grid2X2, List, Square, Palette } from 'lucide-react';
import { formatDuration, formatBytes, downloadBlob } from '@/core/util';
import { create } from 'zustand';
import { useMediaProxy } from '@/engine/Proxy';

type Filter = 'All' | 'Video' | 'Audio' | 'Image' | 'Favorites' | 'Recent' | 'In project';
type Sort = 'newest' | 'oldest' | 'name' | 'duration' | 'size';

interface MediaFolder {
  id: string;
  name: string;
}
interface MediaUI {
  folders: MediaFolder[];
  folderId: string | null;
  view: 'grid' | 'list';
  sort: Sort;
  setFolders: (f: MediaFolder[]) => void;
  set: (p: Partial<MediaUI>) => void;
  loaded: boolean;
}
export const useMediaUI = create<MediaUI>((set) => ({
  folders: [],
  folderId: null,
  view: 'grid',
  sort: 'newest',
  loaded: false,
  setFolders: (folders) => {
    set({ folders });
    void KV.set('mediaFolders', folders);
  },
  set: (p) => set(p),
}));
void KV.get<MediaFolder[]>('mediaFolders', []).then((folders) => useMediaUI.setState({ folders, loaded: true }));

const NO_IDS: string[] = [];

export function MediaPanel() {
  const assets = useMedia((s) => s.assets);
  const importing = useMedia((s) => s.importing);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter | null>(null);
  const { folders, folderId, view, sort } = useMediaUI();
  const favs = useFavorites((s) => s.favs);
  const recents = useFavorites((s) => s.recents);
  const projectMedia = useProject((s) => s.project?.mediaIds) ?? NO_IDS;
  const [menu, setMenu] = useState<{ x: number; y: number; asset: MediaAsset } | null>(null);
  const selected = useSelectedClip();

  const doImport = async (files: File[]) => {
    if (!files.length) return;
    const { assets: added, errors } = await importFiles(files, folderId);
    if (added.length) toast(`Imported ${added.length} file${added.length > 1 ? 's' : ''}`, 'success');
    for (const e of errors) toast('Import failed', 'error', e);
  };
  const drop = useDropFiles(doImport);

  const list = useMemo(() => {
    let l = assets.filter((a) => a.type !== 'font' && !a.isProxy);
    if (folderId) l = l.filter((a) => a.folderId === folderId);
    if (filter === 'Video') l = l.filter((a) => a.type === 'video');
    if (filter === 'Audio') l = l.filter((a) => a.type === 'audio');
    if (filter === 'Image') l = l.filter((a) => a.type === 'image');
    if (filter === 'Favorites') l = l.filter((a) => a.favorite);
    if (filter === 'In project') l = l.filter((a) => projectMedia.includes(a.id));
    if (filter === 'Recent') {
      const order = new Map(recents.filter((r) => r.kind === 'media').map((r, i) => [r.id, i]));
      l = l.filter((a) => order.has(a.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    }
    if (q) l = l.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()) || a.tags?.some((t) => t.includes(q.toLowerCase())));
    if (filter !== 'Recent') {
      l = [...l].sort((a, b) => (sort === 'newest' ? b.createdAt - a.createdAt : sort === 'oldest' ? a.createdAt - b.createdAt : sort === 'name' ? a.name.localeCompare(b.name) : sort === 'duration' ? b.duration - a.duration : b.size - a.size));
    }
    return l;
  }, [assets, folderId, filter, q, sort, recents, projectMedia, favs]);

  const counts = { video: assets.filter((a) => a.type === 'video').length, audio: assets.filter((a) => a.type === 'audio').length, image: assets.filter((a) => a.type === 'image').length };

  return (
    <>
      <PanelHeader title="Media" sub={`${counts.video} video · ${counts.audio} audio · ${counts.image} images`}>
        <button className="icon-btn" title={view === 'grid' ? 'List view' : 'Grid view'} onClick={() => useMediaUI.getState().set({ view: view === 'grid' ? 'list' : 'grid' })}>
          {view === 'grid' ? <List size={15} /> : <Grid2X2 size={15} />}
        </button>
        <button className="btn sm primary" onClick={() => pickFiles('video/*,audio/*,image/*').then(doImport)}>
          <Upload size={13} /> Import
        </button>
      </PanelHeader>
      <div className="panel-body" {...drop.props} style={drop.over ? { outline: '2px dashed var(--accent)', outlineOffset: -6 } : undefined}>
        <SearchBox value={q} onChange={setQ} placeholder="Search media…" />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '8px 0' }}>
          <Chips items={['All', 'Video', 'Audio', 'Image', 'Favorites', 'Recent', 'In project'] as Filter[]} value={filter === 'All' ? null : filter} onChange={(v) => setFilter(v)} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <select value={folderId ?? ''} onChange={(e) => useMediaUI.getState().set({ folderId: e.target.value || null })} style={{ flex: 1 }} title="Folder">
            <option value="">All folders</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <button className="icon-btn" title="New folder" onClick={() => { const n = prompt('Folder name'); if (n) useMediaUI.getState().setFolders([...folders, { id: `mf_${Date.now().toString(36)}`, name: n }]); }}><FolderPlus size={15} /></button>
          {folderId && <button className="icon-btn" title="Delete folder (media is kept)" onClick={() => { useMediaUI.getState().setFolders(folders.filter((f) => f.id !== folderId)); for (const a of assets.filter((x) => x.folderId === folderId)) void updateAsset(a.id, { folderId: null }); useMediaUI.getState().set({ folderId: null }); }}><Folder size={15} /></button>}
          <select value={sort} onChange={(e) => useMediaUI.getState().set({ sort: e.target.value as Sort })} title="Sort">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="duration">Duration</option>
            <option value="size">Size</option>
          </select>
        </div>
        {importing.length > 0 && (
          <div className="ai-card">
            {importing.map((i) => (
              <div key={i.name} className="row">
                <span className="small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Importing {i.name}</span>
                <div className="progress" style={{ width: 80 }}><div style={{ width: `${i.progress * 100}%` }} /></div>
              </div>
            ))}
          </div>
        )}
        {assets.length === 0 && importing.length === 0 ? (
          <div className="drop-zone" onClick={() => pickFiles('video/*,audio/*,image/*').then(doImport)}>
            <Upload size={22} />
            <div style={{ marginTop: 6 }}><b>Drop files here</b> or click to import</div>
            <div className="muted small" style={{ marginTop: 4 }}>MP4, MOV, WebM, MP3, WAV, PNG, JPG, GIF, SVG… Files stay on this device.</div>
          </div>
        ) : list.length === 0 ? (
          <Empty>No media matches.</Empty>
        ) : view === 'grid' ? (
          <div className="card-grid">
            {list.map((a) => (
              <MediaCard key={a.id} a={a} onMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, asset: a })} />
            ))}
          </div>
        ) : (
          <div>
            {list.map((a) => (
              <MediaRow key={a.id} a={a} onMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, asset: a })} />
            ))}
          </div>
        )}
        <div className="sub">Quick add</div>
        <div className="chips">
          <button className="chip" onClick={() => act.addColorClip('#000000')} title="Add a solid color clip"><Square size={11} /> Black</button>
          <button className="chip" onClick={() => act.addColorClip('#ffffff')}><Square size={11} /> White</button>
          <button className="chip" onClick={() => { const c = prompt('Color (hex)', '#8b5cf6'); if (c) act.addColorClip(c); }}><Palette size={11} /> Color…</button>
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Add to timeline at playhead', onClick: () => act.addAssetToTimeline(menu.asset) },
            { label: selected ? `Replace selected clip (${selected.name})` : 'Replace selected clip', onClick: () => act.replaceSelectedMedia(menu.asset), disabled: !selected },
            { label: menu.asset.favorite ? 'Remove from favorites' : 'Add to favorites', onClick: () => updateAsset(menu.asset.id, { favorite: !menu.asset.favorite }) },
            'sep',
            { label: 'Rename…', onClick: () => { const n = prompt('Name', menu.asset.name); if (n) void updateAsset(menu.asset.id, { name: n }); } },
            { label: 'Move to folder…', onClick: () => { const names = folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n'); const r = prompt(`Folder number (0 = none)\n${names}`, '0'); if (r === null) return; const idx = parseInt(r) - 1; void updateAsset(menu.asset.id, { folderId: folders[idx]?.id ?? null }); }, disabled: folders.length === 0 },
            { label: 'Download original', onClick: async () => { const { getBlob } = await import('@/engine/MediaManager'); const b = await getBlob(menu.asset.id); if (b) downloadBlob(b, menu.asset.name); } },
            ...(menu.asset.type === 'video' ? [{ label: menu.asset.proxyId ? 'Remove proxy' : 'Create proxy (smooth preview)', onClick: () => useMediaProxy.getState().toggle(menu.asset) }] : []),
            'sep',
            { label: 'Delete from library', danger: true, onClick: () => { if (confirm(`Delete "${menu.asset.name}" from the library? Clips using it will stop working.`)) void deleteAsset(menu.asset.id); } },
          ]}
        />
      )}
    </>
  );
}

function dragStart(e: React.DragEvent, a: MediaAsset) {
  e.dataTransfer.setData('application/neurio-asset', a.id);
  e.dataTransfer.effectAllowed = 'copy';
}

function MediaCard({ a, onMenu }: { a: MediaAsset; onMenu: (e: React.MouseEvent) => void }) {
  const inProject = useProject((s) => s.project?.mediaIds.includes(a.id));
  const proxy = useMediaProxy((s) => s.jobs[a.id]);
  return (
    <div className={`card ${inProject ? 'active' : ''}`} draggable onDragStart={(e) => dragStart(e, a)} onDoubleClick={() => act.addAssetToTimeline(a)} onContextMenu={(e) => { e.preventDefault(); onMenu(e); }} title={`${a.name}\nDouble-click or drag to timeline`}>
      <div className="thumb">
        {a.thumbnail ? <img src={a.thumbnail} alt="" draggable={false} /> : a.type === 'audio' ? <Music size={22} /> : a.type === 'video' ? <Film size={22} /> : <ImageIcon size={22} />}
        {a.duration > 0 && <span className="dur">{formatDuration(a.duration)}</span>}
        <button className="add" title="Add at playhead" onClick={(e) => { e.stopPropagation(); act.addAssetToTimeline(a); }}><Plus /></button>
        <FavButton on={a.favorite} onToggle={() => updateAsset(a.id, { favorite: !a.favorite })} />
        {proxy && proxy.progress < 1 && <div className="progress" style={{ position: 'absolute', left: 4, right: 4, bottom: 4 }}><div style={{ width: `${proxy.progress * 100}%` }} /></div>}
      </div>
      <div className="name">{a.name}</div>
      <div className="meta">
        <span>{a.width ? `${a.width}×${a.height}` : a.type}</span>
        <span>{a.proxyId ? 'proxy' : formatBytes(a.size)}</span>
      </div>
    </div>
  );
}

function MediaRow({ a, onMenu }: { a: MediaAsset; onMenu: (e: React.MouseEvent) => void }) {
  return (
    <div className="list-item" draggable onDragStart={(e) => dragStart(e, a)} onDoubleClick={() => act.addAssetToTimeline(a)} onContextMenu={(e) => { e.preventDefault(); onMenu(e); }}>
      <div className="ico">{a.thumbnail ? <img src={a.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} /> : a.type === 'audio' ? <Music size={16} /> : <Film size={16} />}</div>
      <div className="info">
        <div className="title">{a.name}</div>
        <div className="sub">{a.type} · {a.duration ? formatDuration(a.duration) + ' · ' : ''}{formatBytes(a.size)}</div>
      </div>
      <div className="acts">
        <button className="icon-btn sm" onClick={() => act.addAssetToTimeline(a)} title="Add"><Plus size={13} /></button>
        <button className={`icon-btn sm ${a.favorite ? 'active' : ''}`} onClick={() => updateAsset(a.id, { favorite: !a.favorite })} title="Favorite"><Star size={13} /></button>
      </div>
    </div>
  );
}

