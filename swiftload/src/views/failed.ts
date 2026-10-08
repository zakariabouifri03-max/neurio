/**
 * Failed: everything that stopped because of an error, with the reason and a
 * one-click retry. Permanent failures (bad URL, authentication, missing file)
 * are shown exactly like transient ones but are never retried automatically.
 */

import { api } from "../lib/api";
import { cardActions } from "../lib/card-actions";
import { removeDownload } from "../lib/actions";
import { confirmDialog } from "../components/dialogs";
import { el, setText } from "../lib/dom";
import { store } from "../lib/store";
import { toast } from "../components/toast";
import type { View } from "../lib/view";
import { CardList } from "../components/card-list";

export function createFailedView(): View {
  const countLabel = el("span", { class: "faint" });
  const explanation = el("div", { class: "hint" });

  const cards = new CardList({
    actions: cardActions,
    emptyGlyph: "✓",
    emptyTitle: "No failed downloads",
    emptyMessage:
      "Downloads that stop because of a network error, a missing file or a verification mismatch appear here with the reason and a Retry button.",
  });

  const retryAll = el("button", {
    class: "btn",
    text: "Retry all",
    attrs: { type: "button" },
    on: { click: () => void retryEverything() },
  });

  const removeAll = el("button", {
    class: "btn danger",
    text: "Remove all",
    attrs: { type: "button" },
    on: { click: () => void removeEverything() },
  });

  const element = el("div", { class: "view" }, [
    el("div", { class: "view-header" }, [
      el("div", { class: "titles" }, [
        el("h1", { text: "Failed" }),
        el("div", { class: "subtitle", text: "Stopped downloads and what went wrong" }),
      ]),
      el("div", { class: "actions" }, [retryAll, removeAll]),
    ]),
    el("div", { class: "toolbar" }, [countLabel, el("span", { class: "spacer", style: { flex: "1" } }), explanation]),
    cards.element,
  ]);

  async function retryEverything(): Promise<void> {
    const failed = store.failed();
    if (failed.length === 0) {
      toast.info("Nothing to retry");
      return;
    }
    let started = 0;
    let refused = 0;
    for (const record of failed) {
      try {
        await api.retry(record.id);
        started += 1;
      } catch {
        refused += 1;
      }
    }
    if (started > 0) toast.info(`Retrying ${started} download${started === 1 ? "" : "s"}`);
    if (refused > 0) {
      toast.warning(
        `${refused} could not be retried`,
        "Their address or destination is permanently invalid.",
      );
    }
  }

  async function removeEverything(): Promise<void> {
    const failed = store.failed();
    if (failed.length === 0) {
      toast.info("Nothing to remove");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Remove all failed downloads?",
      message: `${failed.length} entr${failed.length === 1 ? "y" : "ies"} will be removed.`,
      detail:
        "Partial data on disk is deleted with them; files you already completed stay untouched.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    for (const record of failed) {
      await removeDownload(record, false);
    }
  }

  function render(): void {
    const records = store.failed();
    cards.render(records, (record) => store.statFor(record));
    setText(countLabel, `${records.length} stopped`);
    const retrying = store.records.filter((record) => record.status === "retrying").length;
    setText(
      explanation,
      retrying > 0
        ? `${retrying} download(s) are waiting for the next automatic attempt.`
        : "Automatic retries use exponential backoff (1s, 2s, 4s…). Invalid addresses and authentication failures are never retried automatically.",
    );

    const hasAny = records.length > 0;
    retryAll.disabled = !hasAny;
    removeAll.disabled = !hasAny;
  }

  return {
    element,
    onShow: render,
    onTopic(topic) {
      if (topic === "records") render();
      else if (topic === "progress") cards.updateStats((record) => store.statFor(record));
    },
  };
}
