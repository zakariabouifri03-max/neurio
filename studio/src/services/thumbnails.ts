/** Filmstrip thumbnails for timeline video clips (generated lazily, cached per asset). */
import { getUrl, getAsset } from '@/engine/MediaManager';

const cache = new Map<string, Promise<string[]>>();
const listeners = new Set<() => void>();

export function onThumbnails(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function filmstrip(assetId: string, count = 12): string[] | null {
  const key = `${assetId}:${count}`;
  const p = cache.get(key);
  if (p) {
    let res: string[] | null = null;
    void p.then((r) => (res = r));
    return (p as any).__result ?? null;
  }
  const promise = generate(assetId, count);
  cache.set(key, promise);
  void promise.then((r) => {
    (promise as any).__result = r;
    for (const l of listeners) l();
  });
  return null;
}

async function generate(assetId: string, count: number): Promise<string[]> {
  const asset = getAsset(assetId);
  const url = await getUrl(assetId);
  if (!asset || !url) return [];
  if (asset.type === 'image') return asset.thumbnail ? [asset.thumbnail] : [];
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = url;
    const out: string[] = [];
    const h = 48;
    let w = 85;
    const c = document.createElement('canvas');
    let i = 0;
    const dur = asset.duration || 1;
    const finish = () => {
      v.src = '';
      resolve(out);
    };
    const next = () => {
      if (i >= count) return finish();
      v.currentTime = Math.min(dur - 0.05, (dur * (i + 0.5)) / count);
    };
    v.onloadeddata = () => {
      w = Math.round((h * v.videoWidth) / Math.max(1, v.videoHeight)) || 85;
      c.width = w;
      c.height = h;
      next();
    };
    v.onseeked = () => {
      try {
        c.getContext('2d')!.drawImage(v, 0, 0, w, h);
        out.push(c.toDataURL('image/jpeg', 0.6));
      } catch {}
      i++;
      next();
    };
    v.onerror = finish;
    setTimeout(finish, 20000);
  });
}
