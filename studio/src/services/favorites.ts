/** Favorites + recents + user presets (persisted in IndexedDB KV). */
import { create } from 'zustand';
import { useMemo } from 'react';
import { KV } from './db';
import { uid } from '@/core/util';

export type FavKind = 'template' | 'sfx' | 'music' | 'effect' | 'transition' | 'font' | 'sticker' | 'preset' | 'lut' | 'textpreset';

interface FavStore {
  favs: Record<string, true>;
  recents: { kind: FavKind | 'media'; id: string; at: number }[];
  toggle: (kind: FavKind, id: string) => void;
  is: (kind: FavKind, id: string) => boolean;
  touch: (kind: FavKind | 'media', id: string) => void;
  load: () => Promise<void>;
}

const key = (k: string, id: string) => `${k}:${id}`;

export const useFavorites = create<FavStore>((set, get) => ({
  favs: {},
  recents: [],
  toggle: (kind, id) => {
    const favs = { ...get().favs };
    const k = key(kind, id);
    if (favs[k]) delete favs[k];
    else favs[k] = true;
    set({ favs });
    void KV.set('favorites', favs);
  },
  is: (kind, id) => !!get().favs[key(kind, id)],
  touch: (kind, id) => {
    const recents = [{ kind, id, at: Date.now() }, ...get().recents.filter((r) => !(r.kind === kind && r.id === id))].slice(0, 60);
    set({ recents });
    void KV.set('recents', recents);
  },
  load: async () => {
    const [favs, recents] = await Promise.all([KV.get('favorites', {}), KV.get('recents', [])]);
    set({ favs, recents });
  },
}));

export type PresetKind = 'color' | 'text' | 'animation' | 'effect' | 'audio' | 'export' | 'caption';
export interface UserPreset {
  id: string;
  kind: PresetKind;
  name: string;
  createdAt: number;
  data: any;
}

interface PresetStore {
  presets: UserPreset[];
  add: (kind: PresetKind, name: string, data: any) => UserPreset;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  byKind: (kind: PresetKind) => UserPreset[];
  load: () => Promise<void>;
}

export const usePresets = create<PresetStore>((set, get) => ({
  presets: [],
  add: (kind, name, data) => {
    const p: UserPreset = { id: uid('ps'), kind, name, createdAt: Date.now(), data: structuredClone(data) };
    const presets = [p, ...get().presets];
    set({ presets });
    void KV.set('presets', presets);
    return p;
  },
  remove: (id) => {
    const presets = get().presets.filter((p) => p.id !== id);
    set({ presets });
    void KV.set('presets', presets);
  },
  rename: (id, name) => {
    const presets = get().presets.map((p) => (p.id === id ? { ...p, name } : p));
    set({ presets });
    void KV.set('presets', presets);
  },
  byKind: (kind) => get().presets.filter((p) => p.kind === kind),
  load: async () => set({ presets: await KV.get('presets', []) }),
}));

/**
 * Presets of one kind. Selects the stable `presets` array and memoizes the filtered result —
 * returning a fresh array from a zustand selector would re-render forever ("Maximum update depth exceeded").
 */
export function usePresetsOfKind(kind: PresetKind) {
  const all = usePresets((s) => s.presets);
  return useMemo(() => all.filter((p) => p.kind === kind), [all, kind]);
}
