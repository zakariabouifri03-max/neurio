/**
 * Proxy media: creates a low-resolution copy of a video (real-time canvas capture → MediaRecorder)
 * which the playback engine uses for smooth previews. Export always uses the original file.
 */
import { create } from 'zustand';
import type { MediaAsset } from '@/core/types';
import { getUrl, importFile, updateAsset, deleteAsset, getAsset } from './MediaManager';
import { toast, useUI } from '@/core/uiStore';

interface ProxyJob {
  progress: number;
  cancel: () => void;
}
interface ProxyStore {
  jobs: Record<string, ProxyJob>;
  toggle: (asset: MediaAsset) => Promise<void>;
  create: (asset: MediaAsset, maxHeight?: number) => Promise<void>;
}

export const useMediaProxy = create<ProxyStore>((set, get) => ({
  jobs: {},
  toggle: async (asset) => {
    if (asset.proxyId) {
      const pid = asset.proxyId;
      await updateAsset(asset.id, { proxyId: null });
      await deleteAsset(pid).catch(() => {});
      toast('Proxy removed', 'info');
      return;
    }
    await get().create(asset);
  },
  create: async (asset, maxHeight = 540) => {
    if (get().jobs[asset.id]) return;
    if (typeof MediaRecorder === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) {
      toast('Proxy generation unavailable', 'error', 'This browser does not support canvas capture / MediaRecorder.');
      return;
    }
    const url = await getUrl(asset.id);
    if (!url) return;
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error('load failed'));
    });
    const scale = Math.min(1, maxHeight / Math.max(1, video.videoHeight));
    if (scale >= 1) {
      toast('Proxy not needed', 'info', `${asset.name} is already ${video.videoHeight}p or smaller.`);
      return;
    }
    const w = Math.round((video.videoWidth * scale) / 2) * 2, h = Math.round((video.videoHeight * scale) / 2) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      toast('Proxy generation unavailable', 'error', 'No supported WebM encoder.');
      return;
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let cancelled = false;
    let raf = 0;
    const toastId = useUI.getState().toast({ kind: 'progress', title: `Creating proxy: ${asset.name}`, progress: 0, message: 'Runs in real time at reduced resolution. You can keep editing.' });
    const finish = () =>
      new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        if (rec.state !== 'inactive') rec.stop();
        else resolve();
      });
    const cancel = () => {
      cancelled = true;
      video.pause();
      cancelAnimationFrame(raf);
    };
    set({ jobs: { ...get().jobs, [asset.id]: { progress: 0, cancel } } });
    try {
      rec.start(1000);
      await video.play();
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (cancelled || video.ended) return resolve();
          ctx.drawImage(video, 0, 0, w, h);
          const p = video.duration ? video.currentTime / video.duration : 0;
          set({ jobs: { ...get().jobs, [asset.id]: { progress: p, cancel } } });
          useUI.getState().updateToast(toastId, { progress: p });
          raf = requestAnimationFrame(tick);
        };
        video.onended = () => resolve();
        tick();
      });
      await finish();
      if (cancelled) {
        useUI.getState().dismissToast(toastId);
        return;
      }
      const blob = new Blob(chunks, { type: 'video/webm' });
      const proxy = await importFile(blob, { name: `${asset.name} (proxy ${h}p)`, type: 'video', isProxy: true, tags: ['proxy'] });
      await updateAsset(asset.id, { proxyId: proxy.id });
      useUI.getState().dismissToast(toastId);
      toast('Proxy ready', 'success', `${asset.name} now previews at ${h}p. Export still uses the original.`);
    } catch (e: any) {
      useUI.getState().dismissToast(toastId);
      toast('Proxy generation failed', 'error', e?.message);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      video.src = '';
      const jobs = { ...get().jobs };
      delete jobs[asset.id];
      set({ jobs });
    }
  },
}));

export function hasProxy(id: string) {
  return !!getAsset(id)?.proxyId;
}
