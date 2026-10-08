/**
 * Reconciles a list of {@link DownloadCard}s with the store.
 *
 * Cards are reused between renders: the DOM is only reordered when the queue
 * order changed, and live numbers are patched in place on every progress tick.
 */

import { el } from "../lib/dom";
import type { DownloadRecord, ProgressInfo } from "../lib/types";
import { DownloadCard, type CardActions } from "./download-card";

export interface CardListOptions {
  actions: CardActions;
  emptyGlyph: string;
  emptyTitle: string;
  emptyMessage: string;
  /** Enables drag & drop queue reordering. */
  reorder?: boolean;
  onReorder?: (draggedId: string, targetId: string) => void;
}

export class CardList {
  readonly element: HTMLElement;

  private readonly list: HTMLElement;
  private readonly emptyNode: HTMLElement;
  private readonly cards = new Map<string, DownloadCard>();
  private lastOrder = "";
  private lastCount = -1;

  constructor(private readonly options: CardListOptions) {
    this.list = el("div", { class: "card-list" });
    this.emptyNode = el("div", { class: "empty" }, [
      el("span", { class: "glyph", text: options.emptyGlyph }),
      el("h3", { text: options.emptyTitle }),
      el("p", { text: options.emptyMessage }),
    ]);
    this.element = el("div", {}, [this.list, this.emptyNode]);
  }

  /** Rebuilds/reorders the cards to match `records`. */
  render(records: DownloadRecord[], statOf: (record: DownloadRecord) => ProgressInfo): void {
    const wanted = new Set(records.map((record) => record.id));
    for (const [id, card] of this.cards) {
      if (!wanted.has(id)) {
        card.element.remove();
        this.cards.delete(id);
      }
    }

    const order = records.map((record) => record.id).join("|");
    const changed = order !== this.lastOrder || records.length !== this.lastCount;

    if (changed) {
      const nodes: HTMLElement[] = [];
      for (const record of records) {
        let card = this.cards.get(record.id);
        if (!card) {
          card = new DownloadCard(record, this.options.actions);
          this.cards.set(record.id, card);
          if (this.options.reorder) this.makeDraggable(card);
        }
        nodes.push(card.element);
      }
      // One write per change: avoids layout thrash while keeping DOM order.
      this.list.replaceChildren(...nodes);
      this.lastOrder = order;
      this.lastCount = records.length;
    }

    for (const record of records) {
      this.cards.get(record.id)?.update(record, statOf(record));
    }

    const isEmpty = records.length === 0;
    this.emptyNode.toggleAttribute("hidden", !isEmpty);
    this.list.toggleAttribute("hidden", isEmpty);
  }

  /** Cheap refresh used on progress ticks (no DOM reorder). */
  updateStats(statOf: (record: DownloadRecord) => ProgressInfo): void {
    for (const card of this.cards.values()) {
      card.update(card.current, statOf(card.current));
    }
  }

  private makeDraggable(card: DownloadCard): void {
    const node = card.element;
    node.draggable = true;
    node.addEventListener("dragstart", (event) => {
      node.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", card.current.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    node.addEventListener("dragend", () => {
      node.classList.remove("dragging");
      for (const other of this.list.children) other.classList.remove("drop-target");
    });
    node.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      node.classList.add("drop-target");
    });
    node.addEventListener("dragleave", () => node.classList.remove("drop-target"));
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("drop-target");
      const draggedId = event.dataTransfer?.getData("text/plain");
      if (draggedId && draggedId !== card.current.id) {
        this.options.onReorder?.(draggedId, card.current.id);
      }
    });
  }
}
