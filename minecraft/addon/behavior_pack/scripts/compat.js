/**
 * compat.js — tiny wrappers so the pack keeps working across Minecraft Bedrock versions
 * (the Script API changes shape between releases: `isValid()` became `isValid`, etc.)
 */

export function safe(fn, fallback = undefined) {
  try {
    const r = fn();
    return r === undefined ? fallback : r;
  } catch (e) {
    return fallback;
  }
}

/** Entity / Container validity changed from a method to a property between API versions. */
export function isValid(obj) {
  if (!obj) return false;
  try {
    if (typeof obj.isValid === 'function') return !!obj.isValid();
    if (typeof obj.isValid === 'boolean') return obj.isValid;
    return true;
  } catch (e) {
    return false;
  }
}

export function getComponent(entity, id) {
  return safe(() => entity.getComponent(id), undefined);
}

export function healthOf(entity) {
  const h = getComponent(entity, 'minecraft:health');
  if (!h) return { current: 20, effective: 20 };
  return { current: h.currentValue ?? h.current ?? 20, effective: h.effectiveMaximum ?? h.effective ?? 20 };
}

export function inventoryOf(entity) {
  const inv = getComponent(entity, 'minecraft:inventory');
  return inv && inv.container ? inv.container : undefined;
}

/** Villager profession / biome from the vanilla component values. */
export function villagerVariant(entity) {
  const variant = safe(() => getComponent(entity, 'minecraft:variant')?.value, -1);
  const mark = safe(() => getComponent(entity, 'minecraft:mark_variant')?.value, -1);
  return { profession: variant ?? -1, biome: mark ?? -1 };
}

export function nameTagOf(entity) {
  return safe(() => entity.nameTag || '', '');
}

export function runLater(system, fn, ticks = 1) {
  return safe(() => system.runTimeout(() => safe(fn), ticks), undefined);
}

export function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
