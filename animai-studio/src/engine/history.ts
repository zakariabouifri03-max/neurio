import { cloneCanvas } from "./cel";

export interface HistorySnap {
  label: string;
  layerId: string;
  frame: number;
  before: HTMLCanvasElement | null;
  after: HTMLCanvasElement | null;
}

export class HistoryStack {
  private undoStack: HistorySnap[] = [];
  private redoStack: HistorySnap[] = [];
  readonly limit = 80;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(snap: HistorySnap): void {
    this.undoStack.push(snap);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): HistorySnap | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.redoStack.push(s);
    return s;
  }

  redo(): HistorySnap | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push(s);
    return s;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

export function snapshotCanvas(c: HTMLCanvasElement | null): HTMLCanvasElement | null {
  return c ? cloneCanvas(c) : null;
}
