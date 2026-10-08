/**
 * Completed: finished downloads (live records) plus the persistent history that
 * survives restarts, with search and cleanup.
 */

import { api } from "../lib/api";
import { cardActions } from "../lib/card-actions";
import { clearHistory, openFolderOf, removeFinished } from "../lib/actions";
import { confirmDialog } from "../components/dialogs";
import { el, replace, setText } from "../lib/dom";
import { toUiError } from "../lib/errors";
import { formatBytes, formatRelative, formatSpeed, shortenMiddle } from "../lib/format";
import { store } from "../lib/store";
import type { HistoryEntry } from "../lib/types";
import { toast, toastError } from "../components/toast";
import type { View } from "../lib/view";
import { CardList } from "../components/card-list";

export function createCompletedView(): View {
  const countLabel = el("span", { class: "faint" });
  const search = el("input", {
    class: "search",
    attrs: { type: "search", placeholder: "Search the history…", "aria-label": "Search history" },
  });
  const historyBody = el("div", { class: "body" });
  const historyCount = el("span", { class: "faint" });

  let searchTimer: number | null = null;
  let lastCompleted = -1;

  const cards = new CardList({
    actions: cardActions,
    emptyGlyph: "✓",
    emptyTitle: "Nothing completed yet",
    emptyMessage:
      "Finished downloads appear here. Right-click a card for Open file, Open folder, Copy URL and cleanup actions.",
  });

  const element = el("div", { class: "view" }, [
    el("div", { class: "view-header" }, [
      el("div", { class: "titles" }, [
        el("h1", { text: "Completed" }),
        el("div", {
          class: "subtitle",
          text: "Finished files stay where you saved them; removing an entry never deletes the file unless you ask",
        }),
      ]),
      el("div", { class: "actions" }, [
        el("button", {
          class: "btn",
          text: "Remove entries",
          attrs: { type: "button", title: "Remove the completed entries from the list" },
          on: { click: () => void removeFinished(false) },
        }),
        el("button", {
          class: "btn danger",
          text: "Delete files…",
          attrs: { type: "button", title: "Remove the entries and delete the files from disk" },
          on: { click: () => void removeFinished(true) },
        }),
        el("button", {
          class: "btn primary",
          text: "Open download folder",
          attrs: { type: "button", title: "Open the default download folder in Explorer" },
          on: { click: () => void openDefaultFolder() },
        }),
      ]),
    ]),
    el("div", { class: "toolbar" }, [
      search,
      el("span", { class: "spacer", style: { flex: "1" } }),
      countLabel,
    ]),
    cards.element,
    el("div", { class: "panel" }, [
      el("header", {}, [
        el("h2", { text: "History" }),
        historyCount,
        el("span", { class: "spacer" }),
        el("button", {
          class: "btn small ghost",
          text: "Clear completed history",
          attrs: { type: "button" },
          on: { click: () => void clearHistory("completed") },
        }),
        el("button", {
          class: "btn small ghost",
          text: "Clear everything",
          attrs: { type: "button" },
          on: { click: () => void clearHistory("all") },
        }),
      ]),
      historyBody,
    ]),
  ]);

  search.addEventListener("input", () => {
    store.setQuery("completed", search.value);
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      void loadHistory();
    }, 250);
  });

  async function openDefaultFolder(): Promise<void> {
    const dir = store.settings?.general.defaultDownloadDir;
    if (!dir) {
      toast.warning("No default folder", "Choose one in Settings → General.");
      return;
    }
    try {
      await api.openDir(dir);
    } catch (raw) {
      toastError(toUiError(raw));
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const entries = await api.history({
        query: store.queryFor("completed").trim() || null,
        scope: "completed",
        sort: "newest",
        limit: 200,
      });
      setText(historyCount, entries.length === 1 ? "1 entry" : `${entries.length} entries`);
      if (entries.length === 0) {
        replace(historyBody, [
          el("div", {
            class: "hint",
            text:
              store.queryFor("completed").trim().length > 0
                ? "No history entry matches your search."
                : "No finished download in the history yet.",
          }),
        ]);
        return;
      }
      replace(historyBody, [el("table", { class: "table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "File" }),
            el("th", { text: "Size" }),
            el("th", { text: "Average" }),
            el("th", { text: "Connections" }),
            el("th", { text: "Finished" }),
            el("th", { text: "" }),
          ]),
        ]),
        el("tbody", {}, entries.map(historyRow)),
      ])]);
    } catch (raw) {
      replace(historyBody, [el("div", { class: "hint", text: toUiError(raw).message })]);
    }
  }

  function historyRow(entry: HistoryEntry): HTMLElement {
    const live = store.getRecord(entry.id);
    return el("tr", {}, [
      el("td", { class: "grow" }, [
        el("div", { class: "row" }, [
          el("span", { text: entry.filename, attrs: { title: entry.filePath } }),
          entry.status !== "completed"
            ? el("span", { class: `badge ${entry.status}`, text: entry.status })
            : null,
        ]),
        el("div", { class: "faint", text: shortenMiddle(entry.filePath, 72) }),
      ]),
      el("td", {
        text: entry.total === null ? formatBytes(entry.downloaded) : formatBytes(entry.total),
      }),
      el("td", { text: formatSpeed(entry.averageSpeedBps) }),
      el("td", { text: `${entry.connections}` }),
      el("td", { text: entry.completedAt ? formatRelative(entry.completedAt) : "—" }),
      el("td", {}, [
        el("div", { class: "row" }, [
          live
            ? el("button", {
                class: "btn small ghost",
                text: "Open folder",
                attrs: { type: "button" },
                on: { click: () => void openFolderOf(live) },
              })
            : null,
          el("button", {
            class: "btn small ghost",
            text: "Forget",
            attrs: { type: "button", title: "Remove this entry from the history" },
            on: {
              click: async () => {
                const confirmed = await confirmDialog({
                  title: "Remove this history entry?",
                  message: entry.filename,
                  detail: "The downloaded file is not touched.",
                  confirmLabel: "Remove",
                });
                if (!confirmed) return;
                try {
                  await api.historyDelete(entry.id);
                  void loadHistory();
                } catch (raw) {
                  toastError(toUiError(raw));
                }
              },
            },
          }),
        ]),
      ]),
    ]);
  }

  function render(): void {
    const records = store.visibleFor("completed");
    cards.render(records, (record) => store.statFor(record));
    setText(countLabel, `${records.length} file${records.length === 1 ? "" : "s"}`);
  }

  return {
    element,
    onShow() {
      search.value = store.queryFor("completed");
      render();
      void loadHistory();
      lastCompleted = store.stats.completed;
    },
    onTopic(topic) {
      if (topic === "records") {
        render();
        if (store.stats.completed !== lastCompleted) {
          lastCompleted = store.stats.completed;
          void loadHistory();
        }
      } else if (topic === "progress") {
        cards.updateStats((record) => store.statFor(record));
      }
    },
    destroy() {
      if (searchTimer !== null) window.clearTimeout(searchTimer);
    },
  };
}
