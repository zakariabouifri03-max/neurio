/**
 * History engine.
 *
 * Snapshots are serialized documents, which makes undo/redo exact (including
 * grouping, masks, keyframes and timeline state) and makes the same payload
 * reusable for version history and collaboration recovery.
 *
 * Entries are coalesced: rapid mutations with the same coalesce key (e.g.
 * dragging, typing) collapse into a single undo step, and the stack is
 * memory-bounded so very long sessions stay responsive.
 */

export type HistoryEntry<T> = {
  label: string;
  state: T;
  time: number;
  key?: string;
};

export type HistoryOptions = {
  limit?: number;
  maxBytes?: number;
  coalesceMs?: number;
};

export class History<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private present: HistoryEntry<T>;
  private limit: number;
  private maxBytes: number;
  private coalesceMs: number;
  private listeners = new Set<() => void>();

  constructor(initial: T, label = 'Open document', options: HistoryOptions = {}) {
    this.present = { label, state: initial, time: Date.now() };
    this.limit = options.limit ?? 250;
    this.maxBytes = options.maxBytes ?? 96 * 1024 * 1024; // 96 MB of history
    this.coalesceMs = options.coalesceMs ?? 700;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  get current(): T {
    return this.present.state;
  }

  get currentLabel(): string {
    return this.present.label;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.length ? this.past[this.past.length - 1].label : null;
  }

  get redoLabel(): string | null {
    return this.future.length ? this.future[this.future.length - 1].label : null;
  }

  get depth(): number {
    return this.past.length;
  }

  /**
   * Records a new state. When `key` matches the previous entry and the change
   * happened within the coalesce window, the previous entry is replaced
   * (so a whole drag or burst of typing is one undo step).
   */
  push(state: T, label: string, key?: string, force = false): void {
    const now = Date.now();
    const last = this.present;
    const canCoalesce =
      !force && !!key && last.key === key && now - last.time < this.coalesceMs;
    if (canCoalesce) {
      this.present = { label, state, time: now, key };
      this.future = [];
      this.emit();
      return;
    }
    this.past.push(last);
    this.present = { label, state, time: now, key };
    this.future = [];
    this.trim();
    this.emit();
  }

  /** Commits any coalescing in progress so the next push starts a new step. */
  commit(): void {
    this.present = { ...this.present, key: undefined, time: 0 };
  }

  undo(): T | null {
    if (!this.past.length) return null;
    const entry = this.past.pop()!;
    this.future.push(this.present);
    this.present = entry;
    this.emit();
    return entry.state;
  }

  redo(): T | null {
    if (!this.future.length) return null;
    const entry = this.future.pop()!;
    this.past.push(this.present);
    this.present = entry;
    this.emit();
    return entry.state;
  }

  /** Jump to an arbitrary entry (version history restore). */
  restore(state: T, label: string): void {
    this.past.push(this.present);
    this.present = { label, state, time: Date.now() };
    this.future = [];
    this.trim();
    this.emit();
  }

  private trim(): void {
    while (this.past.length > this.limit) this.past.shift();
    let bytes = 0;
    for (const e of this.past) bytes += estimateSize(e.state);
    while (bytes > this.maxBytes && this.past.length > 1) {
      const dropped = this.past.shift();
      if (dropped) bytes -= estimateSize(dropped.state);
    }
  }

  clear(state?: T, label = 'Reset'): void {
    this.past = [];
    this.future = [];
    if (state !== undefined) this.present = { label, state, time: Date.now() };
    this.emit();
  }

  /** Labels for the history panel (most recent first). */
  stack(): { label: string; time: number; active: boolean }[] {
    return [
      ...this.future.map((e) => ({ label: e.label, time: e.time, active: false })).reverse(),
      { label: this.present.label, time: this.present.time, active: true },
      ...this.past.map((e) => ({ label: e.label, time: e.time, active: false })).reverse(),
    ];
  }
}

export function estimateSize(value: unknown): number {
  if (typeof value === 'string') return value.length * 2;
  if (value == null) return 8;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (typeof value === 'object') {
    // Fast path: avoid JSON.stringify cost by sampling.
    let sum = 64;
    for (const k of Object.keys(value as Record<string, unknown>)) {
      sum += k.length * 2 + estimateSize((value as Record<string, unknown>)[k]);
    }
    return sum;
  }
  return 16;
}
