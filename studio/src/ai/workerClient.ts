/**
 * Tiny request/response client for the AI web workers (captions, TTS, translation).
 * Each request gets an id; progress events are forwarded; a crash rejects everything in flight.
 */
export interface ModelProgress {
  stage: 'download' | 'ready' | string;
  progress: number; // 0..1
  file?: string;
  loaded?: number;
  total?: number;
}

export class WorkerClient {
  private worker: Worker | null = null;
  private seq = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: ModelProgress) => void }>();
  /** True once any request completed successfully (model known to be cached by the browser). */
  ready = false;
  constructor(private create: () => Worker, private label = 'AI worker') {}

  private get(): Worker {
    if (this.worker) return this.worker;
    const w = (this.worker = this.create());
    w.onmessage = (e: MessageEvent<any>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') p.onProgress?.({ stage: m.stage, progress: m.progress, file: m.file, loaded: m.loaded, total: m.total });
      else if (m.type === 'done') {
        this.pending.delete(m.id);
        this.ready = true;
        p.resolve(m.result);
      } else if (m.type === 'error') {
        this.pending.delete(m.id);
        p.reject(new Error(m.error));
      }
    };
    w.onerror = (e) => {
      const err = new Error(e.message || `${this.label} crashed`);
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
      w.terminate();
      this.worker = null;
    };
    return w;
  }

  request<T>(msg: Record<string, unknown>, onProgress?: (p: ModelProgress) => void, transfer: Transferable[] = []): Promise<T> {
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.get().postMessage({ ...msg, id }, transfer);
    });
  }

  cancelAll() {
    this.pending.forEach((p) => p.reject(new Error('Cancelled')));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
  get busy() {
    return this.pending.size > 0;
  }
}

export function friendlyModelError(e: unknown): string {
  const m = String((e as Error)?.message || e);
  if (/fetch|network|Failed to load|404|403|ERR_|NetworkError|timed? ?out/i.test(m)) return 'Model download failed — check your internet connection (models are fetched from huggingface.co on first use).';
  if (/memory|OOM|allocation/i.test(m)) return 'Not enough memory to run this model in the browser. Close other tabs or pick a smaller model.';
  if (/WebGPU|gpu/i.test(m)) return `GPU execution failed (${m}). Try again with CPU.`;
  return m;
}
