import { ID, ITEM_BY_ID, ITEMS, MAX_STACK, TOOL_POWER } from './blocks.js';

const TOOL_IDS = new Set(Object.keys(TOOL_POWER).map(Number));

export class Inventory {
  constructor(record = {}, mode = 'survival') {
    this.mode = mode;
    this.counts = {};
    for (const [idText, rawCount] of Object.entries(record.counts || {})) {
      const id = Number(idText), count = Math.max(0, Math.min(MAX_STACK, Number(rawCount) | 0));
      if (ITEM_BY_ID.has(id) && count) this.counts[id] = TOOL_IDS.has(id) ? Math.min(1, count) : count;
    }
    this.slots = Array.isArray(record.slots) ? Array.from({ length: 9 }, (_, i) => Number(record.slots[i]) || 0) : Array(9).fill(0);
    this.slots = this.slots.map((id) => this.counts[id] ? id : 0);
    this.selected = Math.max(0, Math.min(8, Number(record.selected) | 0));
    this.onUpdate = null;
    if (!Object.keys(this.counts).length && mode === 'survival') this._starterKit();
    if (mode === 'creative') this._creativeKit();
    this._fillSlots();
  }

  _starterKit() {
    this.counts[ID.LOG] = 3;
    this.counts[ID.PLANKS] = 8;
    this.counts[ID.STICK] = 4;
    this.counts[ID.WOOD_PICK] = 1;
    this.counts[ID.APPLE] = 5;
    this.counts[ID.TORCH] = 4;
    this.slots = [ID.LOG, ID.PLANKS, ID.WOOD_PICK, ID.TORCH, ID.APPLE, 0, 0, 0, 0];
  }

  _creativeKit() {
    for (const item of ITEMS) if (item.block || TOOL_IDS.has(item.id) || item.category === 'food' || item.category === 'resources') {
      this.counts[item.id] = TOOL_IDS.has(item.id) ? 1 : MAX_STACK;
    }
    this.slots = [ID.GRASS, ID.DIRT, ID.STONE, ID.LOG, ID.PLANKS, ID.CRAFTING, ID.DIAMOND_PICK, ID.DIAMOND_SWORD, ID.APPLE];
  }

  _fillSlots() {
    for (let slot = 0; slot < 9; slot++) {
      if (this.slots[slot] && !this.counts[this.slots[slot]]) this.slots[slot] = 0;
    }
    for (const id of Object.keys(this.counts).map(Number)) {
      if (this.slots.includes(id)) continue;
      const slot = this.slots.indexOf(0);
      if (slot < 0) break;
      this.slots[slot] = id;
    }
  }

  getCount(id) { return Number(this.counts[Number(id)] || 0); }
  selectedItem() { return ITEM_BY_ID.get(this.slots[this.selected]) || null; }
  selectedCount() { return this.getCount(this.slots[this.selected]); }

  add(id, amount = 1) {
    id = Number(id); amount = Math.max(0, Math.floor(amount));
    if (!ITEM_BY_ID.has(id) || amount <= 0) return amount;
    if (this.mode === 'creative') return 0;
    const max = TOOL_IDS.has(id) ? 1 : MAX_STACK;
    const before = this.getCount(id);
    const after = Math.min(max, before + amount);
    this.counts[id] = after;
    if (!before && after) {
      const empty = this.slots.indexOf(0);
      if (empty >= 0) this.slots[empty] = id;
    }
    this.changed();
    return amount - (after - before);
  }

  remove(id, amount = 1) {
    id = Number(id); amount = Math.max(0, Math.floor(amount));
    if (this.mode === 'creative') return true;
    if (this.getCount(id) < amount) return false;
    const left = this.getCount(id) - amount;
    if (left) this.counts[id] = left; else delete this.counts[id];
    if (!left) this.slots = this.slots.map((slotId) => slotId === id ? 0 : slotId);
    this.changed();
    return true;
  }

  canPay(requirements = {}) {
    if (this.mode === 'creative') return true;
    return Object.entries(requirements).every(([id, count]) => this.getCount(Number(id)) >= count);
  }

  pay(requirements = {}) {
    if (!this.canPay(requirements)) return false;
    if (this.mode !== 'creative') for (const [id, count] of Object.entries(requirements)) this.remove(Number(id), Number(count));
    return true;
  }

  selectSlot(slot) {
    this.selected = Math.max(0, Math.min(8, Number(slot) | 0));
    this.changed();
  }

  selectItem(id) {
    id = Number(id);
    let slot = this.slots.indexOf(id);
    if (slot < 0) {
      slot = this.slots.indexOf(0);
      if (slot < 0) slot = this.selected;
      const displaced = this.slots[slot];
      this.slots[slot] = id;
      if (displaced && displaced !== id && this.slots.includes(displaced)) {
        const other = this.slots.indexOf(displaced);
        if (other >= 0) this.slots[other] = 0;
      }
    }
    this.selected = slot;
    this.changed();
  }

  eatSelected(game) {
    const selected = this.selectedItem();
    if (!selected?.food || this.mode === 'creative' || this.getCount(selected.id) <= 0) return false;
    const ate = game?.eat?.(selected) || false;
    if (ate) this.remove(selected.id, 1);
    return ate;
  }

  changed() { this.onUpdate?.(); }

  serialize() { return { counts: { ...this.counts }, slots: [...this.slots], selected: this.selected }; }
}
