import { LIMITS } from '../../../shared/constants'
import type { DesignDocument } from '../../../shared/types/document'
import { structuredCloneSafe } from '../lib/clone'

export interface HistoryEntry {
  document: DesignDocument
  /** ids selected right before this snapshot was taken */
  selection: string[]
  activePageId: string
  label: string
  at: number
}

/**
 * Snapshot-based undo/redo.
 *
 * Documents are small relative to images (images are referenced by asset id),
 * so storing whole documents is simpler and safer than patch inversion — and it
 * can never drift out of sync with the canvas.
 */
export class History {
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  private baseline: HistoryEntry | null = null
  private depth: number
  private lastPush = 0

  constructor(depth = LIMITS.HISTORY_DEPTH) {
    this.depth = depth
  }

  reset(entry: HistoryEntry): void {
    this.past = []
    this.future = []
    this.baseline = entry
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null
  }

  get size(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length }
  }

  /** True when the current document differs from the last saved baseline. */
  isDirty(current: DesignDocument): boolean {
    if (!this.baseline) return true
    return JSON.stringify(this.baseline.document) !== JSON.stringify(current)
  }

  markSaved(entry: HistoryEntry): void {
    this.baseline = entry
  }

  /**
   * Push a new state. Consecutive pushes within `coalesceMs` carrying the same
   * label are replaced, so dragging a slider does not flood the stack.
   */
  push(entry: HistoryEntry, coalesceMs = 0): void {
    const now = Date.now()
    const top = this.past.at(-1)
    if (top && coalesceMs > 0 && top.label === entry.label && now - this.lastPush < coalesceMs) {
      this.past[this.past.length - 1] = entry
      this.lastPush = now
      return
    }
    this.past.push(entry)
    if (this.past.length > this.depth) this.past.shift()
    this.future = []
    this.lastPush = now
  }

  undo(current: HistoryEntry): HistoryEntry | null {
    const previous = this.past.pop()
    if (!previous) return null
    this.future.push(current)
    if (this.future.length > this.depth) this.future.shift()
    return previous
  }

  redo(current: HistoryEntry): HistoryEntry | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(current)
    if (this.past.length > this.depth) this.past.shift()
    return next
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}

export const cloneDocument = (document: DesignDocument): DesignDocument => structuredCloneSafe(document)
