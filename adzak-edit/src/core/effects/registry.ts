import type { EffectDefinition, EffectParamValues } from '../types/effects';
import { defaultsFor } from '../types/effects';
import { colorEffects } from './builtin/color';
import { visualEffects } from './builtin/visual';

/**
 * Effect registry.
 *
 * `register()` is public so plugins (Phase 5) can add effects without editing
 * the timeline, the inspector or the renderer: everything downstream reads the
 * registry.
 */
class EffectRegistry {
  private readonly defs = new Map<string, EffectDefinition>();

  constructor(defs: EffectDefinition[] = []) {
    for (const d of defs) this.register(d);
  }

  register(def: EffectDefinition): void {
    if (this.defs.has(def.id)) {
      // Later registration wins — allows overriding a built-in.
      this.defs.set(def.id, def);
      return;
    }
    this.defs.set(def.id, def);
  }

  unregister(id: string): boolean {
    return this.defs.delete(id);
  }

  get(id: string): EffectDefinition | undefined {
    return this.defs.get(id);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  all(): EffectDefinition[] {
    return [...this.defs.values()].sort((a, b) => a.order - b.order);
  }

  byCategory(category: EffectDefinition['category']): EffectDefinition[] {
    return this.all().filter((d) => d.category === category);
  }

  categories(): EffectDefinition['category'][] {
    return [...new Set(this.all().map((d) => d.category))];
  }

  defaults(id: string): EffectParamValues {
    const def = this.defs.get(id);
    return def ? defaultsFor(def) : {};
  }

  /** Merge user params over the definition defaults, dropping unknown keys. */
  normalizeParams(id: string, params: EffectParamValues): EffectParamValues {
    const def = this.defs.get(id);
    if (!def) return {};
    const out = defaultsFor(def);
    for (const p of def.params) {
      const raw = params[p.id];
      if (raw === undefined) continue;
      if ((p.type === 'float' || p.type === 'int') && typeof raw === 'number') {
        const min = p.min ?? Number.NEGATIVE_INFINITY;
        const max = p.max ?? Number.POSITIVE_INFINITY;
        out[p.id] = Math.min(Math.max(raw, min), max);
      } else {
        out[p.id] = raw;
      }
    }
    return out;
  }

  isNeutral(id: string, params: EffectParamValues): boolean {
    const def = this.defs.get(id);
    if (!def) return true;
    return def.isNeutral ? def.isNeutral(params) : false;
  }
}

export const effectRegistry = new EffectRegistry([...colorEffects, ...visualEffects]);

export type { EffectDefinition };
