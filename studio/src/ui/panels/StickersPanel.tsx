import React, { useMemo, useState } from 'react';
import { Smile, Upload, Plus } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { SearchBox, Chips, FavButton, Empty, pickFiles } from '../common';
import { useFavorites } from '@/services/favorites';
import { STICKERS, STICKER_CATEGORIES, STICKER_ANIMATIONS, type StickerDef, type StickerCategory } from '@/library/stickers';
import { addStickerClip } from '@/services/clipActions';
import { importFiles, useMedia } from '@/engine/MediaManager';
import { toast, useUI } from '@/core/uiStore';

export function StickerThumb({ s, size = 40 }: { s: StickerDef; size?: number }) {
  if (s.kind === 'emoji') return <span style={{ fontSize: size * 0.8, lineHeight: 1 }}>{s.char}</span>;
  return <span style={{ width: size, height: size, display: 'inline-block' }} dangerouslySetInnerHTML={{ __html: s.svg || '' }} />;
}

export function StickersPanel() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<StickerCategory | 'Favorites' | 'My uploads' | null>(null);
  const [anim, setAnim] = useState<string>('none');
  const fav = useFavorites();
  const assets = useMedia((s) => s.assets);
  const uploads = useMemo(() => Object.values(assets).filter((a) => a.type === 'image' && a.tags?.includes('sticker')).sort((a, b) => b.createdAt - a.createdAt), [assets]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return STICKERS.filter((s) => (cat === null || cat === 'My uploads' ? true : cat === 'Favorites' ? fav.is('sticker', s.id) : s.category === cat)).filter((s) => !t || s.name.toLowerCase().includes(t) || s.category.toLowerCase().includes(t) || s.tags?.some((x) => x.includes(t)));
  }, [q, cat, fav.favs]);

  const add = (s: StickerDef) => {
    addStickerClip(s.id, null, s.name, anim === 'none' ? s.animation ?? null : anim, 4);
    useUI.getState().setRightPanel('properties');
  };
  const upload = async () => {
    const files = await pickFiles('image/png,image/svg+xml,image/webp,image/gif');
    if (!files.length) return;
    const { assets, errors } = await importFiles(files);
    for (const a of assets) {
      const { updateAsset } = await import('@/engine/MediaManager');
      await updateAsset(a.id, { tags: [...(a.tags || []), 'sticker'] });
    }
    if (errors.length) toast('Some files were skipped', 'error', errors.join('\n'));
    if (assets.length) setCat('My uploads');
  };

  return (
    <>
      <PanelHeader title="Stickers" sub={`${STICKERS.length} built-in`}>
        <button className="btn sm" onClick={upload} title="Import PNG / SVG / WebP / GIF stickers">
          <Upload size={13} /> Upload
        </button>
      </PanelHeader>
      <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search stickers…" />
        <Chips items={['Favorites', 'My uploads', ...STICKER_CATEGORIES] as (StickerCategory | 'Favorites' | 'My uploads')[]} value={cat} onChange={setCat} all="All" />
        <div className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0' }}>
          <span className="muted small">Animation</span>
          <select value={anim} onChange={(e) => setAnim(e.target.value)} style={{ flex: 1 }}>
            {STICKER_ANIMATIONS.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="panel-body scroll" style={{ flex: 1 }}>
        {cat === 'My uploads' && (
          <>
            {!uploads.length && (
              <Empty icon={<Upload />}>
                No uploaded stickers yet. <button className="btn sm" onClick={upload}>Upload PNG/SVG</button>
              </Empty>
            )}
            <div className="card-grid">
              {uploads.map((a) => (
                <div key={a.id} className="card" onClick={() => { addStickerClip(null, a.id, a.name, anim === 'none' ? null : anim, 4); }} title={a.name}>
                  <div className="thumb" style={{ display: 'grid', placeItems: 'center', background: 'repeating-conic-gradient(#2a2a33 0 25%, #1f1f26 0 50%) 0 0/16px 16px' }}>
                    {a.thumbnail ? <img src={a.thumbnail} alt="" style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }} /> : <Smile />}
                  </div>
                  <div className="name">{a.name}</div>
                </div>
              ))}
            </div>
            {uploads.length > 0 && <hr style={{ margin: '12px 0', borderColor: 'var(--line)' }} />}
          </>
        )}
        {cat !== 'My uploads' && !list.length && <Empty icon={<Smile />}>No stickers match.</Empty>}
        {cat !== 'My uploads' && (
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))' }}>
            {list.map((s) => (
              <div key={s.id} className="card" onClick={() => add(s)} title={`${s.name}${s.animation ? ' · ' + s.animation : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-neurio-sticker', s.id)}>
                <div className="thumb" style={{ display: 'grid', placeItems: 'center', aspectRatio: '1' }}>
                  <StickerThumb s={s} size={36} />
                </div>
                <FavButton on={fav.is('sticker', s.id)} onToggle={() => fav.toggle('sticker', s.id)} />
                <button className="add" onClick={(e) => { e.stopPropagation(); add(s); }}><Plus size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="muted small" style={{ marginTop: 12 }}>
          Click to add at the playhead. Resize, rotate, animate and keyframe stickers from the Properties / Animation inspectors.
        </div>
      </div>
    </>
  );
}
