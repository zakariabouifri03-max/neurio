/**
 * Small modal dialogs: confirmation, speed limit and technical details.
 *
 * They all share the dialog scaffolding (backdrop, Escape, focus) that the
 * download dialog uses, so the application behaves consistently everywhere.
 */

import { api } from "../lib/api";
import { el, focusIfPossible } from "../lib/dom";
import { toUiError } from "../lib/errors";
import { formatBytes, formatEta, formatLimit, formatTimestamp } from "../lib/format";
import type { DownloadRecord } from "../lib/types";
import { toast, toastError } from "./toast";

interface DialogShellOptions {
  title: string;
  /** Rendered into the body. */
  body: HTMLElement[];
  /** Footer buttons, left to right. */
  footer: HTMLElement[];
  width?: number;
  /** Called once, after the dialog is gone (Escape, backdrop or a button). */
  onClose?: () => void;
}

function openShell(options: DialogShellOptions): { close: () => void } {
  const modal = el(
    "div",
    { class: "modal", attrs: { role: "dialog", "aria-modal": "true" } },
    [
      el("header", {}, [el("h2", { text: options.title })]),
      el("div", { class: "content" }, options.body),
      el("footer", {}, options.footer),
    ],
  );
  if (options.width) modal.style.width = `${options.width}px`;

  const backdrop = el("div", { class: "modal-backdrop" }, [modal]);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
    options.onClose?.();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeyDown);
  (document.getElementById("modal-root") ?? document.body).append(backdrop);

  // Focus the primary action when there is one, otherwise the first button.
  const focusable =
    modal.querySelector<HTMLElement>("footer button.primary") ??
    modal.querySelector<HTMLElement>("footer button");
  focusIfPossible(focusable);
  return { close };
}

export interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Promise-based confirmation, used before anything destructive happens. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const confirm = el("button", {
      class: options.danger ? "btn danger" : "btn primary",
      text: options.confirmLabel ?? "Confirm",
      attrs: { type: "button" },
      on: {
        click: () => {
          confirmed = true;
          close();
        },
      },
    });
    const body: HTMLElement[] = [el("div", { text: options.message })];
    if (options.detail) body.push(el("div", { class: "hint", text: options.detail }));

    const { close } = openShell({
      title: options.title,
      body,
      onClose: () => resolve(confirmed),
      footer: [
        el("span", { class: "spacer" }),
        el("button", {
          class: "btn ghost",
          text: options.cancelLabel ?? "Cancel",
          attrs: { type: "button" },
          on: {
            click: () => {
              confirmed = false;
              close();
            },
          },
        }),
        confirm,
      ],
      width: 520,
    });
  });
}

const PRESETS: Array<{ label: string; value: number | null }> = [
  { label: "Unlimited", value: null },
  { label: "100 KB/s", value: 100 * 1000 },
  { label: "500 KB/s", value: 500 * 1000 },
  { label: "1 MB/s", value: 1024 * 1024 },
  { label: "5 MB/s", value: 5 * 1024 * 1024 },
  { label: "10 MB/s", value: 10 * 1024 * 1024 },
];

/** Per-download bandwidth limit (also available globally in Settings). */
export function speedLimitDialog(record: DownloadRecord, onApplied?: () => void): void {
  let value: number | null = record.speedLimitBps ?? null;
  const custom = el("input", {
    attrs: { type: "number", min: "1", step: "1", placeholder: "KB/s" },
  });
  custom.value = value !== null && !PRESETS.some((preset) => preset.value === value)
    ? String(Math.round(value / 1024))
    : "";

  const buttons = PRESETS.map((preset) => {
    const button = el("button", {
      class: "btn small",
      text: preset.label,
      attrs: { type: "button" },
      on: {
        click: () => {
          value = preset.value;
          custom.value = "";
          for (const other of buttons) other.classList.toggle("primary", other === button);
        },
      },
    });
    if (preset.value === value) button.classList.add("primary");
    return button;
  });

  custom.addEventListener("input", () => {
    for (const button of buttons) button.classList.remove("primary");
    const parsed = Number.parseFloat(custom.value);
    value = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1024) : null;
  });

  const apply = el("button", {
    class: "btn primary",
    text: "Apply",
    attrs: { type: "button" },
    on: {
      click: async () => {
        try {
          await api.setSpeedLimit(record.id, value);
          close();
          toast.info(
            value === null
              ? "Speed limit removed"
              : `Limited to ${formatLimit(value)}`,
            record.filename,
          );
          onApplied?.();
        } catch (raw) {
          toastError(toUiError(raw));
        }
      },
    },
  });

  const { close } = openShell({
    title: "Speed limit",
    body: [
      el("div", {
        text:
          "The limiter shapes the traffic of this download only. Other downloads keep " +
          "their own limit and the global limit in Settings still applies.",
      }),
      el("div", { class: "row wrap" }, buttons),
      el(
        "div",
        { class: "field" },
        [el("label", { text: "Custom (KB/s)" }), custom],
      ),
    ],
    footer: [
      el("span", { class: "spacer" }),
      el("button", {
        class: "btn ghost",
        text: "Cancel",
        attrs: { type: "button" },
        on: { click: () => close() },
      }),
      apply,
    ],
    width: 480,
  });
}

/** Technical facts for a download — exactly what the engine knows. */
export function detailsDialog(record: DownloadRecord): void {
  const rows: Array<[string, string]> = [
    ["File name", record.filename],
    ["Status", record.status],
    ["URL", record.url],
    ["Final URL", record.finalUrl],
    ["Saved to", record.filePath],
    ["Temporary file", record.partPath],
    ["Size", record.total === null ? "unknown" : formatBytes(record.total)],
    ["Downloaded", formatBytes(record.downloaded)],
    ["Content type", record.contentType ?? "not reported"],
    ["Range support", record.fragmentable ? "ranges available" : "no ranges — single connection"],
    ["Connections", `${record.connections}`],
    ["Segments", record.segments.length === 0 ? "not started" : `${record.segments.length}`],
    ["ETag", record.etag ?? "not provided"],
    ["Last modified", record.lastModified ?? "not provided"],
    ["Retries", `${record.retryCount}`],
    ["Speed limit", record.speedLimitBps === null ? "none" : formatLimit(record.speedLimitBps)],
    ["Category", record.category],
    ["Queued at", formatTimestamp(record.createdAt)],
    ["Started at", formatTimestamp(record.startedAt)],
    ["Completed at", formatTimestamp(record.completedAt)],
    ["Elapsed", record.elapsedSecs > 0 ? formatEta(record.elapsedSecs) : "—"],
    ["Checksum", record.sha256 ? `SHA-256 ${record.sha256.slice(0, 16)}…` : "not requested"],
  ];

  const table = el(
    "table",
    { class: "table" },
    [
      el(
        "tbody",
        {},
        rows.map(([key, value]) =>
          el("tr", {}, [
            el("td", { class: "faint", text: key }),
            el("td", { class: "grow mono", text: value }),
          ]),
        ),
      ),
    ],
  );

  const segmentLines =
    record.segments.length > 0
      ? record.segments
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((segment, index) =>
            el("div", {
              class: "log-line",
              text:
                `#${index + 1}  bytes ${segment.start}–${segment.end}  ` +
                `(${formatBytes(segment.end - segment.start + 1)})  ` +
                `downloaded ${formatBytes(segment.downloaded)}  ` +
                `${segment.done ? "complete" : "incomplete"}`,
            }),
          )
      : [el("div", { class: "faint", text: "No segment layout yet." })];

  const { close } = openShell({
    title: `Details — ${record.filename}`,
    body: [
      table,
      el("div", { class: "field" }, [
        el("label", { text: "Segments (byte ranges actually requested)" }),
        el("div", { class: "log-view" }, segmentLines),
      ]),
    ],
    footer: [
      el("span", { class: "spacer" }),
      el("button", {
        class: "btn",
        text: "Copy URL",
        attrs: { type: "button" },
        on: {
          click: async () => {
            await navigator.clipboard.writeText(record.url).catch(() => undefined);
            toast.info("URL copied");
          },
        },
      }),
      el("button", {
        class: "btn primary",
        text: "Close",
        attrs: { type: "button" },
        on: { click: () => close() },
      }),
    ],
    width: 640,
  });}
