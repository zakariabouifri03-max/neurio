// NEXUS ENGINE — tiny typed event emitter
export type Listener<T = any> = (payload: T) => void;

export class Emitter<E extends Record<string, any> = Record<string, any>> {
  private map = new Map<keyof E, Set<Listener<any>>>();
  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    let set = this.map.get(event);
    if (!set) { set = new Set(); this.map.set(event, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }
  once<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    const off = this.on(event, (p) => { off(); fn(p); });
    return off;
  }
  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.map.get(event);
    if (set) for (const fn of [...set]) fn(payload);
  }
  off<K extends keyof E>(event: K, fn: Listener<E[K]>): void {
    this.map.get(event)?.delete(fn);
  }
  clear() { this.map.clear(); }
}

// Editor-level event bus (selection changes, scene dirty, console, etc.)
export interface EditorEvents {
  selectionChanged: { ids: string[] };
  sceneChanged: { sceneId: string; structural: boolean };
  sceneSwitched: { sceneId: string };
  objectsChanged: { ids: string[]; structural?: boolean };
  projectChanged: { dirty: boolean };
  assetsChanged: void;
  console: { level: 'info' | 'warning' | 'error'; message: string; source?: string; time: number };
  problemsChanged: void;
  playModeChanged: { playing: boolean; paused: boolean };
  aiMemoryChanged: void;
  layoutChanged: void;
  scriptOpened: { scriptId: string; line?: number };
  notify: { kind: 'info' | 'success' | 'warning' | 'error'; text: string };
}

export const editorBus = new Emitter<EditorEvents>();
