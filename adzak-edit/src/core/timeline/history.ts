/**
 * Undo / redo history.
 *
 * The editor state is immutable, so history is just a stack of previous
 * states. `pushCoalesced` collapses the many micro-states produced by a single
 * gesture (slider drag, clip move) into one undo step.
 */

export interface HistoryEntry<T> {
  state: T;
  label: string;
  at: number;
}

export interface HistoryOptions {
  /** Maximum retained states. Oldest are dropped. */
  limit?: number;
  /** Micro-updates within this window share one entry. */
  coalesceMs?: number;
}

export class History<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private current: T;
  private currentLabel = 'initial';
  private lastPushAt = 0;
  private readonly limit: number;
  private readonly coalesceMs: number;

  constructor(initial: T, options: HistoryOptions = {}) {
    this.current = initial;
    this.limit = options.limit ?? 120;
    this.coalesceMs = options.coalesceMs ?? 500;
  }

  get value(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.length ? this.past[this.past.length - 1]!.label : null;
  }

  get redoLabel(): string | null {
    return this.future.length ? this.future[0]!.label : null;
  }

  get size(): number {
    return this.past.length;
  }

  /** Record a discrete edit. */
  push(next: T, label: string): void {
    if (next === this.current) return;
    this.past.push({ state: this.current, label: this.currentLabel, at: Date.now() });
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.currentLabel = label;
    this.future = [];
    this.lastPushAt = Date.now();
  }

  /**
   * Record a continuous edit. Consecutive calls with the same `label` inside
   * the coalesce window replace the pending entry instead of stacking.
   */
  pushCoalesced(next: T, label: string, force = false): void {
    const now = Date.now();
    const coalesce = !force && now - this.lastPushAt < this.coalesceMs;
    if (coalesce && this.past.length > 0 && this.currentLabel === label) {
      // Keep the older snapshot, just advance the head.
      this.current = next;
      this.lastPushAt = now;
      this.future = [];
      return;
    }
    this.push(next, label);
  }

  undo(): T | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.unshift({ state: this.current, label: this.currentLabel, at: Date.now() });
    this.current = entry.state;
    this.currentLabel = entry.label;
    this.lastPushAt = 0;
    return this.current;
  }

  redo(): T | null {
    const entry = this.future.shift();
    if (!entry) return null;
    this.past.push({ state: this.current, label: this.currentLabel, at: Date.now() });
    this.current = entry.state;
    this.currentLabel = entry.label;
    this.lastPushAt = 0;
    return this.current;
  }

  /** Replace the head without creating an undo step (autosave bookkeeping). */
  replaceCurrent(next: T): void {
    this.current = next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  labels(): { undo: string[]; redo: string[] } {
    return {
      undo: this.past.slice(-20).map((e) => e.label),
      redo: this.future.slice(0, 20).map((e) => e.label),
    };
  }
}
