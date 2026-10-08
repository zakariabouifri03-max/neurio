/**
 * A single download row.
 *
 * The card is created once and then updated in place, so a progress tick only
 * writes text nodes and one width value — no re-layout of the list and no
 * flicker while scrolling.
 */

import { el, setStyle, setText } from "../lib/dom";
import { ACTIVE_STATUSES, STATUS_LABELS } from "../lib/store";
import {
  fileGlyph,
  formatBytes,
  formatDuration,
  formatEta,
  formatPercent,
  formatSpeed,
  ratio,
  shortenMiddle,
} from "../lib/format";
import type { DownloadRecord, ProgressInfo } from "../lib/types";
import { openContextMenu, type MenuItem } from "./context-menu";

export interface CardActions {
  start: (record: DownloadRecord) => void;
  pause: (record: DownloadRecord) => void;
  resume: (record: DownloadRecord) => void;
  cancel: (record: DownloadRecord) => void;
  retry: (record: DownloadRecord) => void;
  openFile: (record: DownloadRecord) => void;
  openFolder: (record: DownloadRecord) => void;
  copyUrl: (record: DownloadRecord) => void;
  remove: (record: DownloadRecord, deleteFile: boolean) => void;
  changeLimit: (record: DownloadRecord) => void;
  showDetails?: (record: DownloadRecord) => void;
}

export class DownloadCard {
  readonly element: HTMLElement;

  private readonly name: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly glyph: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly segmentMap: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly error: HTMLElement;
  private readonly errorText: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly secondary: HTMLButtonElement;
  private readonly more: HTMLButtonElement;
  private readonly pills: HTMLElement;

  private record: DownloadRecord;
  private pillCount = -1;
  private renderedStatus = "";

  constructor(record: DownloadRecord, private readonly actions: CardActions) {
    this.record = record;

    this.glyph = el("span", { class: "dl-glyph", text: fileGlyph(record.category) });
    this.name = el("div", { class: "name", text: record.filename });
    this.badge = el("span", { class: "badge", text: STATUS_LABELS[record.status] });
    this.meta = el("div", { class: "meta" });

    this.primary = el("button", {
      class: "btn small",
      attrs: { type: "button" },
      on: { click: () => this.runPrimary() },
    });
    this.secondary = el("button", {
      class: "btn small ghost",
      attrs: { type: "button" },
      on: { click: () => this.runSecondary() },
    });
    this.more = el("button", {
      class: "btn small ghost icon",
      attrs: { type: "button", "aria-label": "More actions", title: "More actions" },
      text: "⋮",
      on: {
        click: (event: Event) => {
          const target = event.currentTarget as HTMLElement;
          const rect = target.getBoundingClientRect();
          this.showMenu(rect.left - 170, rect.bottom + 4);
        },
      },
    });

    this.fill = el("div", { class: "fill" });
    this.progress = el("div", { class: "progress", attrs: { role: "progressbar" } }, [this.fill]);
    this.segmentMap = el("div", { class: "segment-map" });
    this.pills = el("span", { class: "conn-pills" });
    this.stats = el("div", { class: "dl-stats" });
    this.errorText = el("span", { class: "dl-error-text" });
    this.error = el(
      "div",
      { class: "dl-error", attrs: { hidden: true } },
      [
        el("span", { text: "⚠" }),
        this.errorText,
        el("span", { class: "spacer" }),
        el("button", {
          class: "btn small",
          text: "Retry",
          attrs: { type: "button" },
          on: { click: () => this.actions.retry(this.record) },
        }),
      ],
    );

    this.element = el("article", { class: "dl-card" }, [
      el("div", { class: "dl-head" }, [
        this.glyph,
        el("div", { class: "dl-title" }, [
          el("div", { class: "row" }, [this.name, this.badge]),
          this.meta,
        ]),
        el("div", { class: "dl-actions" }, [this.primary, this.secondary, this.more]),
      ]),
      this.progress,
      this.segmentMap,
      this.stats,
      this.error,
    ]);

    this.element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showMenu(event.clientX, event.clientY);
    });

    this.update(record, null);
  }

  get current(): DownloadRecord {
    return this.record;
  }

  /** Repaints the card. `stat` is the live measurement, when there is one. */
  update(record: DownloadRecord, stat: ProgressInfo | null): void {
    this.record = record;
    const status = record.status;

    setText(this.glyph, fileGlyph(record.category));
    setText(this.name, record.filename);
    this.name.title = record.filePath || record.filename;

    const shortDir = shortenMiddle(record.destDir, 58);
    const queued =
      status === "queued" ? " · waiting for a slot" : status === "retrying" ? " · retrying" : "";
    setText(
      this.meta,
      `${shortDir}${queued}${
        record.speedLimitBps ? ` · limit ${formatBytes(record.speedLimitBps, 0)}/s` : ""
      }`,
    );

    setText(this.badge, STATUS_LABELS[status]);
    this.badge.className = `badge ${status}`;

    // --- progress ---------------------------------------------------------
    const total = stat?.total ?? record.total;
    const downloaded = stat?.downloaded ?? record.downloaded;
    const known = total !== null && total !== undefined && total > 0;
    const fraction = ratio(downloaded, total);
    this.progress.className = `progress ${
      status === "completed"
        ? "done"
        : status === "failed" || status === "corrupt"
          ? "failed"
          : status === "paused" || status === "queued" || status === "cancelled"
            ? "paused"
            : ""
    }`;
    if (known && fraction !== null) {
      setStyle(this.fill, "width", `${(fraction * 100).toFixed(3)}%`);
      setStyle(this.fill, "opacity", "1");
      setStyle(this.fill, "background", "");
    } else {
      // The total is unknown (chunked response): show a flat bar so nothing
      // implies a percentage that was never measured.
      setStyle(this.fill, "width", "100%");
      setStyle(this.fill, "opacity", "0.22");
      setStyle(this.fill, "background", "var(--text-faint)");
    }
    this.progress.setAttribute(
      "aria-valuetext",
      known ? `${formatPercent(downloaded, total)} of ${formatBytes(total)}` : "size unknown",
    );

    this.renderSegments(record, total);

    // --- statistics -------------------------------------------------------
    const active = ACTIVE_STATUSES.has(status);
    const speed = active ? (stat?.speedBps ?? 0) : 0;
    const avg = active ? (stat?.avgSpeedBps ?? 0) : record.elapsedSecs > 0 && record.downloaded > 0
      ? record.downloaded / record.elapsedSecs
      : 0;
    const eta = active ? (stat?.etaSecs ?? null) : null;

    const metrics: HTMLElement[] = [
      metric("Progress", known ? `${formatPercent(downloaded, total)} · ${formatBytes(downloaded)} / ${formatBytes(total)}` : `${formatBytes(downloaded)} / size unknown`),
      metric("Speed", formatSpeed(speed)),
      metric("Average", formatSpeed(avg)),
      metric("ETA", formatEta(eta)),
    ];

    const totalConnections = record.connections;
    const activeConnections = active ? (stat?.activeConnections ?? 0) : 0;
    this.renderPills(totalConnections, activeConnections);
    metrics.push(
      el("span", { class: "metric" }, [this.pills, el("b", { text: `${activeConnections}/${totalConnections}` })]),
    );
    if (record.elapsedSecs > 0) {
      metrics.push(metric("Elapsed", formatDuration(record.elapsedSecs)));
    }
    if (record.retryCount > 0) {
      metrics.push(metric("Retries", String(record.retryCount)));
    }
    if (!record.fragmentable && record.connections === 1 && active) {
      metrics.push(el("span", { class: "metric faint", text: "single connection" }));
    }
    this.stats.replaceChildren(...metrics);

    // --- error ------------------------------------------------------------
    if (record.error && ["failed", "corrupt", "cancelled"].includes(status)) {
      this.errorText.textContent = record.error;
      this.error.removeAttribute("hidden");
    } else {
      this.error.setAttribute("hidden", "");
    }

    // --- buttons (only touched when the status changed) -------------------
    if (this.renderedStatus !== status) {
      this.renderedStatus = status;
      this.syncButtons(record);
    }
  }

  private renderSegments(record: DownloadRecord, total: number | null): void {
    const segments = record.segments ?? [];
    if (!total || segments.length < 2) {
      if (this.segmentMap.childElementCount > 0) this.segmentMap.replaceChildren();
      return;
    }
    const ticks: HTMLElement[] = [];
    for (const segment of segments) {
      const left = (segment.start / total) * 100;
      const width = Math.max(((segment.end - segment.start) / total) * 100, 0.15);
      ticks.push(
        el("span", {
          class: "tick",
          style: {
            left: `${left.toFixed(3)}%`,
            width: `${width.toFixed(3)}%`,
            opacity: segment.done ? "0.95" : "0.45",
          },
        }),
      );
    }
    this.segmentMap.replaceChildren(...ticks);
  }

  private renderPills(total: number, active: number): void {
    if (this.pillCount === total) {
      const nodes = this.pills.children;
      for (let index = 0; index < nodes.length; index += 1) {
        nodes[index].classList.toggle("live", index < active);
      }
      return;
    }
    this.pillCount = total;
    const pills: HTMLElement[] = [];
    for (let index = 0; index < total; index += 1) {
      pills.push(el("span", { class: index < active ? "conn-pill live" : "conn-pill" }));
    }
    this.pills.replaceChildren(...pills);
  }

  private syncButtons(record: DownloadRecord): void {
    const status = record.status;
    const setButton = (
      button: HTMLButtonElement,
      label: string,
      icon: string,
      title: string,
      visible = true,
    ) => {
      button.textContent = `${icon} ${label}`.trim();
      button.title = title;
      button.toggleAttribute("hidden", !visible);
    };

    if (status === "downloading" || status === "connecting") {
      setButton(this.primary, "Pause", "⏸", "Pause this download");
      setButton(this.secondary, "Cancel", "✕", "Cancel and keep the partial file");
    } else if (status === "queued") {
      setButton(this.primary, "Start", "▶", "Start now");
      setButton(this.secondary, "Remove", "✕", "Remove from the queue");
    } else if (status === "paused") {
      setButton(this.primary, "Resume", "▶", "Resume from where it stopped");
      setButton(this.secondary, "Cancel", "✕", "Cancel and keep the partial file");
    } else if (status === "retrying") {
      setButton(this.primary, "Pause", "⏸", "Pause while waiting for the next attempt");
      setButton(this.secondary, "Cancel", "✕", "Cancel this download");
    } else if (status === "completed") {
      setButton(this.primary, "Open file", "📂", "Open the downloaded file");
      setButton(this.secondary, "Open folder", "🗀", "Show it in Explorer");
    } else {
      setButton(this.primary, "Retry", "↻", "Try again");
      setButton(this.secondary, "Remove", "🗑", "Remove from the list");
    }
  }

  private runPrimary(): void {
    const status = this.record.status;
    if (status === "completed") this.actions.openFile(this.record);
    else if (status === "downloading" || status === "connecting" || status === "retrying")
      this.actions.pause(this.record);
    else if (status === "paused" || status === "queued") this.actions.start(this.record);
    else this.actions.retry(this.record);
  }

  private runSecondary(): void {
    const status = this.record.status;
    if (status === "completed") this.actions.openFolder(this.record);
    else if (status === "queued") this.actions.remove(this.record, true);
    else if (status === "failed" || status === "cancelled" || status === "corrupt")
      this.actions.remove(this.record, true);
    else this.actions.cancel(this.record);
  }

  private showMenu(x: number, y: number): void {
    const record = this.record;
    const status = record.status;
    const finished = status === "completed";
    const partialReady = record.downloaded > 0 && !finished;

    const items: MenuItem[] = [];

    if (status === "downloading" || status === "connecting" || status === "retrying") {
      items.push({ label: "Pause", icon: "⏸", onSelect: () => this.actions.pause(record) });
    } else if (status === "paused" || status === "queued") {
      items.push({ label: "Resume", icon: "▶", onSelect: () => this.actions.resume(record) });
    } else {
      items.push({
        label: partialReady ? "Resume" : "Retry",
        icon: "↻",
        onSelect: () => this.actions.retry(record),
      });
    }

    if (["downloading", "connecting", "retrying", "queued"].includes(status)) {
      items.push({
        label: "Cancel",
        icon: "✕",
        onSelect: () => this.actions.cancel(record),
      });
    }

    items.push({ separator: true });
    items.push({
      label: "Open file",
      icon: "📂",
      disabled: !finished,
      shortcut: "Enter",
      onSelect: () => this.actions.openFile(record),
    });
    items.push({
      label: "Open folder",
      icon: "🗀",
      onSelect: () => this.actions.openFolder(record),
    });
    items.push({
      label: "Copy URL",
      icon: "🔗",
      shortcut: "Ctrl+C",
      onSelect: () => this.actions.copyUrl(record),
    });
    items.push({
      label: "Speed limit…",
      icon: "⏱",
      onSelect: () => this.actions.changeLimit(record),
    });
    if (this.actions.showDetails) {
      items.push({
        label: "Details",
        icon: "ⓘ",
        onSelect: () => this.actions.showDetails?.(record),
      });
    }

    items.push({ separator: true });
    items.push({
      label: "Remove from list",
      icon: "🗑",
      danger: true,
      onSelect: () => this.actions.remove(record, false),
    });
    items.push({
      label: "Delete file",
      icon: "🔥",
      danger: true,
      disabled: !finished && !partialReady,
      onSelect: () => this.actions.remove(record, true),
    });

    openContextMenu(items, { x, y });
  }
}

function metric(label: string, value: string): HTMLElement {
  return el("span", { class: "metric" }, [
    el("span", { class: "faint", text: `${label}:` }),
    el("b", { text: value }),
  ]);
}
