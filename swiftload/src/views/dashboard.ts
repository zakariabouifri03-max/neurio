/**
 * Dashboard: what is running right now, and what happened recently.
 *
 * The numbers come from the engine's statistics snapshot (counters and byte
 * totals the engine measured) and from the history table in SQLite.
 */

import { api } from "../lib/api";
import { cardActions } from "../lib/card-actions";
import { detectClipboardUrl, newDownload, pauseAll, startAll } from "../lib/actions";
import { el, setText } from "../lib/dom";
import { toUiError } from "../lib/errors";
import { formatBytes, formatRelative, formatSpeed } from "../lib/format";
import { store } from "../lib/store";
import type { HistoryEntry } from "../lib/types";
import type { View } from "../lib/view";
import { CardList } from "../components/card-list";

export function createDashboardView(): View {
  let lastCompleted = -1;

  const activeValue = el("div", { class: "value", text: "0" });
  const activeExtra = el("div", { class: "extra", text: "no active downloads" });
  const queuedValue = el("div", { class: "value", text: "0" });
  const queuedExtra = el("div", { class: "extra", text: "queue empty" });
  const completedValue = el("div", { class: "value", text: "0" });
  const failedValue = el("div", { class: "value", text: "0" });
  const speedValue = el("div", { class: "value", text: "—" });
  const speedExtra = el("div", { class: "extra", text: "measured over the last seconds" });
  const bytesValue = el("div", { class: "value", text: "0 B" });
  const bytesExtra = el("div", { class: "extra", text: "all downloads in this session" });

  const cards = new CardList({
    actions: cardActions,
    emptyGlyph: "⇣",
    emptyTitle: "Nothing is downloading",
    emptyMessage:
      "Add a link with “New download”, paste a URL with Ctrl+V, or drop the address of a file you copied.",
  });

  const recentBody = el("div", { class: "body" });
  let recentBodyFilled = false;

  const clipboardBanner = el("div", { class: "banner", attrs: { hidden: true } });
  const clipboardText = el("span", {});
  const clipboardUse = el("button", {
    class: "btn small primary",
    text: "Download it",
    attrs: { type: "button" },
  });
  const clipboardDismiss = el("button", {
    class: "btn small ghost",
    text: "Dismiss",
    attrs: { type: "button" },
  });
  clipboardBanner.append(clipboardText, el("span", { class: "spacer" }), clipboardUse, clipboardDismiss);

  const element = el("div", { class: "view" }, [
    el("div", { class: "view-header" }, [
      el("div", { class: "titles" }, [
        el("h1", { text: "Dashboard" }),
        el("div", { class: "subtitle", text: "Live status of the download engine" }),
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
          class: "btn primary",
          text: "＋ New download",
          attrs: { type: "button" },
          on: { click: () => void newDownload() },
        }),
      ]),
    ]),
    clipboardBanner,
    el("div", { class: "stat-grid" }, [
      statCard("Active", activeValue, activeExtra, "accent"),
      statCard("Queued", queuedValue, queuedExtra),
      statCard("Completed", completedValue, null, "success"),
      statCard("Failed", failedValue, null, "danger"),
      statCard("Current speed", speedValue, speedExtra),
      statCard("Downloaded", bytesValue, bytesExtra),
    ]),
    el("div", { class: "panel" }, [
      el("header", {}, [el("h2", { text: "In progress" }), el("span", { class: "spacer" })]),
      el("div", { class: "body", style: { padding: "12px" } }, [cards.element]),
    ]),
    el("div", { class: "panel" }, [
      el("header", {}, [
        el("h2", { text: "Recent activity" }),
        el("span", { class: "spacer" }),
        el("button", {
          class: "btn small ghost",
          text: "Open history",
          attrs: { type: "button" },
          on: { click: () => store.setView("completed") },
        }),
      ]),
      recentBody,
    ]),
  ]);

  clipboardUse.addEventListener("click", () => {
    const url = store.clipboardUrl;
    if (!url) return;
    clipboardBanner.setAttribute("hidden", "");
    void newDownload({ url });
  });
  clipboardDismiss.addEventListener("click", () => {
    store.setClipboardUrl(null);
    clipboardBanner.setAttribute("hidden", "");
  });

  function renderStats(): void {
    const stats = store.stats;
    setText(activeValue, String(stats.active));
    setText(
      activeExtra,
      stats.active === 0 ? "no active downloads" : `${stats.active} running now`,
    );
    setText(queuedValue, String(stats.queued));
    setText(queuedExtra, stats.queued === 0 ? "queue empty" : "waiting for a slot");
    setText(completedValue, String(stats.completed));
    setText(failedValue, String(stats.failed));
    setText(speedValue, formatSpeed(stats.totalSpeedBps));
    setText(bytesValue, formatBytes(stats.totalDownloadedBytes));
    setText(
      bytesExtra,
      stats.averageSpeedBps > 0
        ? `average ${formatSpeed(stats.averageSpeedBps)}`
        : "all downloads in this session",
    );
  }

  function renderCards(): void {
    const records = [...store.active(), ...store.waiting()];
    cards.render(records, (record) => store.statFor(record));
  }

  async function loadRecent(): Promise<void> {
    try {
      const entries = await api.history({ limit: 6, sort: "newest" });
      recentBodyFilled = true;
      if (entries.length === 0) {
        recentBody.replaceChildren(
          el("div", { class: "hint", style: { padding: "12px 14px" }, text: "No finished downloads yet." }),
        );
        return;
      }
      recentBody.replaceChildren(el("div", { class: "list" }, entries.map(historyRow)));
    } catch (raw) {
      // A failing history read must not break the dashboard; it is reported once.
      if (!recentBodyFilled) {
        recentBody.replaceChildren(
          el("div", { class: "hint", style: { padding: "12px 14px" }, text: toUiError(raw).message }),
        );
      }
    }
  }

  function historyRow(entry: HistoryEntry): HTMLElement {
    const exists = store.getRecord(entry.id);
    return el("div", { class: "dl-card" }, [
      el("div", { class: "dl-head" }, [
        el("div", { class: "dl-title" }, [
          el("div", { class: "row" }, [
            el("span", { class: "name", text: entry.filename }),
            el("span", { class: `badge ${entry.status}`, text: entry.status }),
          ]),
          el("div", {
            class: "meta",
            text: `${formatBytes(entry.downloaded)}${entry.total ? ` of ${formatBytes(entry.total)}` : ""} · ${
              entry.completedAt ? formatRelative(entry.completedAt) : "—"
            }`,
          }),
        ]),
        el("div", { class: "dl-actions" }, [
          exists
            ? el("button", {
                class: "btn small ghost",
                text: "Open folder",
                attrs: { type: "button" },
                on: { click: () => void cardActions.openFolder(exists) },
              })
            : null,
        ]),
      ]),
      entry.error ? el("div", { class: "hint", text: entry.error }) : null,
    ]);
  }

  async function refreshClipboard(): Promise<void> {
    const enabled = store.settings?.general.clipboardWatch ?? false;
    if (!enabled) {
      clipboardBanner.setAttribute("hidden", "");
      return;
    }
    const url = await detectClipboardUrl();
    if (url) {
      setText(clipboardText, `Copied link detected: ${url.slice(0, 120)}`);
      clipboardBanner.removeAttribute("hidden");
    } else {
      clipboardBanner.setAttribute("hidden", "");
    }
  }

  return {
    element,
    onShow() {
      renderStats();
      renderCards();
      void loadRecent();
      void refreshClipboard();
      lastCompleted = store.stats.completed;
    },
    onTopic(topic) {
      if (topic === "stats" || topic === "records") {
        renderStats();
        renderCards();
        if (store.stats.completed !== lastCompleted) {
          lastCompleted = store.stats.completed;
          void loadRecent();
        }
      } else if (topic === "progress") {
        cards.updateStats((record) => store.statFor(record));
        renderStats();
      } else if (topic === "settings") {
        renderStats();
      } else if (topic === "clipboard") {
        const url = store.clipboardUrl;
        if (url) {
          setText(clipboardText, `Copied link detected: ${url.slice(0, 120)}`);
          clipboardBanner.removeAttribute("hidden");
        } else {
          clipboardBanner.setAttribute("hidden", "");
        }
      }
    },
  };
}

function statCard(
  label: string,
  value: HTMLElement,
  extra: HTMLElement | null,
  tone?: "accent" | "success" | "danger",
): HTMLElement {
  return el("div", { class: `stat-card${tone ? ` ${tone}` : ""}` }, [
    el("div", { class: "label", text: label }),
    value,
    extra,
  ]);
}
