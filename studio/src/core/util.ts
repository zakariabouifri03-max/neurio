let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
export function deepClone<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
export function formatTime(sec: number, fps = 30, showFrames = true): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const totalFrames = Math.round(sec * fps);
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const core = h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
  return showFrames ? `${core}.${pad(f)}` : core;
}
export function formatDuration(sec: number): string {
  if (!isFinite(sec)) return '--';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    bytes /= 1024;
    i++;
  } while (bytes >= 1024 && i < u.length - 1);
  return `${bytes.toFixed(bytes < 10 ? 2 : 1)} ${u[i]}`;
}
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: any;
  return ((...a: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  }) as T;
}
export function throttle<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: any;
  return ((...a: any[]) => {
    const now = performance.now();
    const rem = ms - (now - last);
    if (rem <= 0) {
      last = now;
      fn(...a);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = performance.now();
        fn(...a);
      }, rem);
    }
  }) as T;
}
export function downloadBlob(blob: Blob, filename: string) {
  // Packaged Android build: WebViews can't download blob: URLs — hand the file to the native layer.
  if ((window as any).Capacitor?.isNativePlatform?.() && (window as any).Capacitor.getPlatform() === 'android') {
    void import('@/platform/native').then((m) => m.saveBlobNative(blob, filename)).then(
      (uri) => import('@/core/uiStore').then(({ toast }) => toast('Saved to Documents/Neurio', 'success', uri.replace(/^file:\/\//, ''))),
      (e) => import('@/core/uiStore').then(({ toast }) => toast('Could not save file', 'error', String(e?.message || e))),
    );
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 2000);
}
export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
export function nextFrame(): Promise<number> {
  return new Promise((r) => requestAnimationFrame(r));
}
