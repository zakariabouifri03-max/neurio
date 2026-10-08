/**
 * Downloads: the working list — queue order, live progress and every control.
 */

import { api } from "../lib/api";
import { cardActions } from "../lib/card-actions";
import { newDownload, pauseAll, removeFinished, startAll } from "../lib/actions";
import { el } from "../lib/dom";
import { toUiError } from "../lib/errors";
import { store, type FilterKind } from "../lib/store";
import type { View } from "../lib/view";
import { CardList } from "../components/card-list";
import { toast, toastError } from "../components/toast";

/** This view never lists finished downloads, so it offers no "Completed" chip. */
const FILTERS: Array<{ key: FilterKind; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "waiting", label: "Waiting" },
  { key: "failed", label: "Failed" },
];

export function createDownloadsView(): View {
  const search = el("input", {
    class: "search",
    attrs: { type: "search", placeholder: "Search name, URL or folder…", "aria-label": "Search downloads" },
  });
  const countLabel = el("span", { class: "faint" });

  const filterButtons = FILTERS.map((item) =>
    el("button", {
      class: item.key === "all" ? "active" : "",
      text: item.label,
      attrs: { type: "button", "data-filter": item.key },
      on: {
        click: () => {
          store.setFilter(item.key);
          for (const button of filterButtons) {
            button.classList.toggle("active", button.dataset.filter === item.key);
          }
        },
      },
    }),
  );

  const cards = new CardList({
    actions: cardActions,
    reorder: true,
    emptyGlyph: "⇣",
    emptyTitle: "The list is empty",
    emptyMessage:
      "Downloads you add appear here. Pause, resume, cancel, reorder with drag & drop or use the ⋮ menu for more actions.",
    onReorder: (draggedId, targetId) => void reorder(draggedId, targetId),
  });

  async function reorder(draggedId: string, targetId: string): Promise<void> {
    if (store.queryFor("downloads").trim().length > 0 || store.filter !== "all") {
      toast.warning("Reordering is disabled", "Clear the search box and the filter first.");
      return;
    }
    const order = store.records.map((record) => record.id);
    const from = order.indexOf(draggedId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    // `download_reorder` removes the entry first and re-inserts it, so a move
    // downwards lands one slot earlier than the drop target.
    const insertAt = to > from ? to - 1 : to;
    try {
      await api.reorder(draggedId, insertAt);
    } catch (raw) {
      toastError(toUiError(raw));
    }
  }

  const element = el("div", { class: "view" }, [
    el("div", { class: "view-header" }, [
      el("div", { class: "titles" }, [
        el("h1", { text: "Downloads" }),
        el("div", {
          class: "subtitle",
          text: "Queue order decides which download starts next when a slot frees up",
        }),
      ]),
      el("div", { class: "actions" }, [
        el("button", {
          class: "btn",
          text: "Start all",
          attrs: { type: "button" },
          on: { click: () => void startAll() },
        }),
        el("button", {
          class: "btn",
          text: "Pause all",
          attrs: { type: "button" },
          on: { click: () => void pauseAll() },
        }),
        el("button", {
          class: "btn",
          text: "Remove finished",
          attrs: { type: "button", title: "Remove completed entries, keeping the files on disk" },
          on: { click: () => void removeFinished(false) },
        }),
        el("button", {
          class: "btn primary",
          text: "＋ New download",
          attrs: { type: "button" },
          on: { click: () => void newDownload() },
        }),
      ]),
    ]),
    el("div", { class: "toolbar" }, [
      search,
      el("div", { class: "segmented" }, filterButtons),
      el("span", { class: "spacer", style: { flex: "1" } }),
      countLabel,
    ]),
    cards.element,
  ]);

  search.addEventListener("input", () => store.setQuery("downloads", search.value));

  function render(): void {
    const records = store.visibleFor("downloads");
    cards.render(records, (record) => store.statFor(record));
    countLabel.textContent = `${records.length} of ${store.records.length}`;
  }

  return {
    element,
    onShow() {
      search.value = store.queryFor("downloads");
      for (const button of filterButtons) {
        button.classList.toggle("active", button.dataset.filter === store.filter);
      }
      render();
    },
    onTopic(topic) {
      if (topic === "records") render();
      else if (topic === "progress") cards.updateStats((record) => store.statFor(record));
    },
  };
}
