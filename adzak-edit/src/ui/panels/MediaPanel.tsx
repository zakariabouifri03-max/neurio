import { useState, type DragEvent } from 'react';
import { useEditor } from '../store/editorStore';
import { Icons } from '../components/Icons';
import { formatTimecode } from '../../core/types/time';
import type { MediaAsset } from '../../core/types/media';
import { getBridge } from '../../core/bridge';
import { clsx } from 'clsx';

/**
 * Media / assets panel.
 *
 * Import, browse and drag media onto the timeline. Missing files are shown with
 * a relink action rather than being silently dropped, so a project moved to
 * another machine can be repaired.
 */

const KIND_ICON = {
  video: Icons.Film,
  audio: Icons.Music,
  image: Icons.Image,
  gif: Icons.Image,
  unknown: Icons.Film,
} as const;

const KIND_COLOUR: Record<MediaAsset['kind'], string> = {
  video: 'text-track-video',
  audio: 'text-track-audio',
  image: 'text-track-text',
  gif: 'text-track-text',
  unknown: 'text-ink-400',
};

function bytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function MediaPanel() {
  const assets = useEditor((s) => s.project.assets);
  const importFiles = useEditor((s) => s.importFiles);
  const addAssetToTimeline = useEditor((s) => s.addAssetToTimeline);
  const relinkAsset = useEditor((s) => s.relinkAsset);
  const removeAsset = useEditor((s) => s.removeAsset);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const files = event.dataTransfer.files;
    if (!files.length) return;
    const bridge = getBridge();
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i);
      if (file) {
        // The web bridge registers the File; the desktop bridge receives paths.
        const register = (bridge as unknown as { register?: (f: File) => string }).register;
        paths.push(register ? register(file) : (file as unknown as { path?: string }).path ?? file.name);
      }
    }
    void useEditor.getState().importPaths(paths);
  };

  return (
    <div
      className={clsx('flex flex-col h-full min-h-0', dragOver && 'drop-active')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="panel-header">
        <Icons.Layers size={14} />
        <span>Media</span>
        <span className="ml-auto normal-case tracking-normal text-ink-500">{assets.length}</span>
        <button className="btn h-7 px-2" onClick={() => void importFiles()}>
          <Icons.Plus size={14} />
          Import
        </button>
      </div>

      {assets.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="w-14 h-14 rounded-xl bg-ink-850 border border-ink-700 flex items-center justify-center text-ink-500">
            <Icons.Folder size={26} />
          </div>
          <div>
            <p className="text-ink-200 font-medium">No media yet</p>
            <p className="text-ink-500 text-[11px] mt-1 leading-relaxed">
              Drop video, audio or image files here, or click <span className="text-ink-300">Import</span>. Nothing is
              uploaded — files stay on your disk.
            </p>
          </div>
          <button className="btn-primary h-8" onClick={() => void importFiles()}>
            <Icons.Plus size={14} />
            Choose files
          </button>
        </div>
      ) : (
        <div className="flex-1 scroll-area p-2 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 content-start">
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onAdd={() => addAssetToTimeline(asset.id)}
              onRelink={() => void relinkAsset(asset.id)}
              onRemove={() => removeAsset(asset.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AssetCardProps {
  asset: MediaAsset;
  onAdd: () => void;
  onRelink: () => void;
  onRemove: () => void;
}

function AssetCard({ asset, onAdd, onRelink, onRemove }: AssetCardProps) {
  const KindIcon = KIND_ICON[asset.kind] ?? Icons.Film;
  const bridge = getBridge();
  const probing = asset.probeState === 'probing' || asset.probeState === 'pending';
  const missing = asset.isMissing || asset.probeState === 'error';

  return (
    <div
      draggable={!missing}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-adzak-asset', asset.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={onAdd}
      className={clsx(
        'group relative rounded-lg border bg-ink-850 overflow-hidden cursor-grab active:cursor-grabbing',
        missing ? 'border-accent-danger/50' : 'border-ink-700 hover:border-ink-600',
      )}
      title={asset.originalPath}
    >
      <div className="relative aspect-video bg-ink-900 overflow-hidden">
        {probing ? (
          <div className="absolute inset-0 skeleton" />
        ) : asset.thumbnails?.uri ? (
          <img src={asset.thumbnails.uri} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-ink-600">
            <KindIcon size={26} />
          </div>
        )}

        {missing && (
          <div className="absolute inset-0 bg-ink-950/85 flex flex-col items-center justify-center gap-1 px-1 text-center">
            <Icons.Warning size={18} className="text-accent-danger" />
            <span className="text-[9px] text-accent-danger leading-tight">
              {asset.probeState === 'error' ? 'Unreadable' : 'File missing'}
            </span>
          </div>
        )}

        {asset.probe && asset.probe.durationSec > 0 && (
          <span className="absolute bottom-1 right-1 mono text-[9px] bg-ink-950/85 px-1 rounded text-ink-200">
            {formatTimecode(asset.probe.durationSec, asset.probe.fps || 30)}
          </span>
        )}

        <button
          onClick={onAdd}
          className="absolute inset-0 flex items-center justify-center bg-ink-950/70 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Add to timeline at the playhead"
        >
          <span className="btn-primary h-7 text-[11px]">
            <Icons.Plus size={13} />
            Add
          </span>
        </button>
      </div>

      <div className="px-1.5 py-1">
        <div className="flex items-center gap-1">
          <KindIcon size={11} className={KIND_COLOUR[asset.kind]} />
          <span className="truncate text-[11px] text-ink-200 flex-1">{asset.name}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[9px] text-ink-500">
            {asset.probe && asset.probe.width > 0 ? `${asset.probe.width}×${asset.probe.height}` : bytes(asset.sizeBytes)}
          </span>
          <button
            onClick={onRemove}
            className="ml-auto opacity-0 group-hover:opacity-100 text-ink-500 hover:text-accent-danger transition-opacity"
            title="Remove from project (the file on disk is not deleted)"
          >
            <Icons.Close size={12} />
          </button>
        </div>
      </div>

      {missing && (
        <button
          onClick={onRelink}
          className="w-full text-[10px] py-1 bg-accent-danger/15 text-accent-danger hover:bg-accent-danger/25 border-t border-accent-danger/30"
        >
          Relink…
        </button>
      )}
      <span className="sr-only">{bridge.kind === 'web' ? 'Browser session' : 'Desktop'}</span>
    </div>
  );
}
