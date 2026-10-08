/**
 * SwiftLoad — application entry point.
 *
 * Responsibilities kept here (and nowhere else):
 *   • load the initial state from the backend,
 *   • subscribe to engine events and fan them out to the active view,
 *   • own the shell: sidebar, status bar, theme and keyboard shortcuts.
 */

import "./styles/theme.css";
import "./styles/views.css";

import { toast, toastError } from "./components/toast";
import {
  detectClipboardUrl,
  newDownload,
  pauseAll,
  retryDownload,
  startAll,
} from "./lib/actions";
import { api, hasBackend } from "./lib/api";
import { el, isTypingTarget, setText } from "./lib/dom";
import { toUiError } from "./lib/errors";
import { subscribeEngine } from "./lib/events";
import { formatBytes, formatSpeed } from "./lib/format";
import { store, type Topic } from "./lib/store";
import type { DownloadRecord, Theme, ViewName } from "./lib/types";
import type { View } from "./lib/view";
import { createCompletedView } from "./views/completed";
import { createDashboardView } from "./views/dashboard";
import { createDownloadsView } from "./views/downloads";
import { createFailedView } from "./views/failed";
import { createSettingsView } from "./views/settings";

const NAV: Array<{ view: ViewName; label: string; icon: string }> = [
  { view: "dashboard", label: "Dashboard", icon: "◧" },
  { view: "downloads", label: "Downloads", icon: "⇣" },
  { view: "completed", label: "Completed", icon: "✓" },
  { view: "failed", label: "Failed", icon: "⚠" },
  { view: "settings", label: "Settings", icon: "⚙" },
];

const FACTORIES: Record<ViewName, () => View> = {
  dashboard: createDashboardView,
  downloads: createDownloadsView,
  completed: createCompletedView,
  failed: createFailedView,
  settings: createSettingsView,
};

const views = new Map<ViewName, View>();
let active: ViewName = "dashboard";

function viewFor(name: ViewName): View {
  let view = views.get(name);
  if (!view) {
    view = FACTORIES[name]();
    views.set(name, view);
  }
  return view;
}

// --- shell elements -------------------------------------------------------

const sidebar = document.getElementById("sidebar") ?? document.body;
const content = document.getElementById("content") ?? document.body;
const statusbar = document.getElementById("statusbar") ?? document.body;

const navButtons = new Map<ViewName, HTMLButtonElement>();
const navCounts = new Map<ViewName, HTMLElement>();
const nav = el("nav", { class: "nav" });

for (const item of NAV) {
  const count = el("span", { class: "nav-count", attrs: { hidden: true } });
  const button = el(
    "button",
    {
      class: `nav-item${item.view === active ? " active" : ""}`,
      attrs: { type: "button", "data-view": item.view },
      on: { click: () => show(item.view) },
    },
    [
      el("span", { class: "nav-icon", text: item.icon }),
      el("span", { text: item.label }),
      count,
    ],
  );
  navButtons.set(item.view, button);
  navCounts.set(item.view, count);
  nav.append(button);
}

const sidebarSpeed = el("b", { text: "0 B/s" });
const sidebarActive = el("b", { text: "0" });

const clipboardButton = el("button", {
  class: "btn",
  text: "📋 Paste link",
  attrs: { type: "button", title: "Read the clipboard and start a download from it" },
  on: {
    click: async () => {
      const url = await detectClipboardUrl();
      if (url) await newDownload({ url });
      else toast.info("No link in the clipboard");
    },
  },
});

sidebar.replaceChildren(
  el("div", { class: "brand" }, [
    el("span", { class: "brand-mark", text: "S" }),
    el("div", { class: "brand-text" }, [
      el("strong", { text: "SwiftLoad" }),
      el("span", { text: "download manager" }),
    ]),
  ]),
  nav,
  el("div", { class: "sidebar-footer" }, [
    el("button", {
      class: "btn primary",
      text: "＋ New download",
      attrs: { type: "button" },
      on: { click: () => void newDownload() },
    }),
    el("div", { class: "row" }, [
      el("button", {
        class: "btn",
        text: "▶ Start all",
        attrs: { type: "button" },
        on: { click: () => void startAll() },
      }),
      el("button", {
        class: "btn",
        text: "⏸ Pause all",
        attrs: { type: "button" },
        on: { click: () => void pauseAll() },
      }),
    ]),
    clipboardButton,
    el("div", { class: "sidebar-stat" }, [el("span", { text: "Speed" }), sidebarSpeed]),
    el("div", { class: "sidebar-stat" }, [el("span", { text: "Active" }), sidebarActive]),
  ]),
);

// --- status bar -----------------------------------------------------------

const statusDot = el("span", { class: "dot" });
const statusText = el("span", { text: "idle" });
const statusSpeed = el("span", { text: "0 B/s" });
const statusBytes = el("span", { text: "0 B" });
const statusVersion = el("span", { class: "faint", text: "" });

statusbar.replaceChildren(
  statusDot,
  statusText,
  el("span", { class: "spacer" }),
  statusSpeed,
  statusBytes,
  statusVersion,
);

// --- view switching -------------------------------------------------------

function show(name: ViewName): void {
  active = name;
  store.setView(name);
  const view = viewFor(name);
  content.replaceChildren(view.element);
  for (const [key, button] of navButtons) button.classList.toggle("active", key === name);
  view.onShow?.();
  if (name === "settings") content.scrollTop = 0;
}

// --- theme ----------------------------------------------------------------

const systemTheme = window.matchMedia("(prefers-color-scheme: light)");

function applyTheme(preference: Theme): void {
  const resolved = preference === "system" ? (systemTheme.matches ? "light" : "dark") : preference;
  document.documentElement.dataset.theme = resolved;
  store.setResolvedTheme(resolved);
}

systemTheme.addEventListener("change", () => {
  const preference = store.themePreference;
  if (preference === "system") applyTheme("system");
});

function applyCompact(enabled: boolean): void {
  document.documentElement.dataset.compact = String(enabled);
}

// --- rendering ------------------------------------------------------------

function renderSidebar(): void {
  const stats = store.stats;
  setText(sidebarSpeed, formatSpeed(stats.totalSpeedBps));
  setText(sidebarActive, String(stats.active));

  const counts: Array<[ViewName, number]> = [
    ["downloads", stats.active + stats.queued + stats.paused],
    ["completed", stats.completed],
    ["failed", stats.failed],
  ];
  for (const [view, value] of counts) {
    const node = navCounts.get(view);
    if (!node) continue;
    node.toggleAttribute("hidden", value === 0);
    setText(node, String(value));
  }
}

function renderStatusbar(): void {
  const stats = store.stats;
  const live = stats.active > 0;
  statusDot.className = `dot${live ? " busy" : ""}`;
  setText(
    statusText,
    live
      ? `${stats.active} downloading · ${stats.queued} queued`
      : store.records.length === 0
        ? "idle — no downloads"
        : `${stats.queued} queued · ${stats.paused} paused`,
  );
  setText(statusSpeed, formatSpeed(stats.totalSpeedBps));
  setText(statusBytes, formatBytes(stats.totalDownloadedBytes));
}

function onTopic(topic: Topic): void {
  if (topic === "stats") {
    renderSidebar();
    renderStatusbar();
  } else if (topic === "settings") {
    const settings = store.settings;
    if (settings) {
      applyTheme(settings.general.theme);
      applyCompact(settings.general.compactMode);
    }
    renderSidebar();
  }
  viewFor(active).onTopic?.(topic);
}

store.subscribe(onTopic);

// --- engine events --------------------------------------------------------

async function connect(): Promise<void> {
  await subscribeEngine({
    onList: (records) => store.setRecords(records),
    onRecord: (record) => {
      const previous = store.getRecord(record.id);
      store.upsertRecord(record);
      announceTransition(previous, record);
    },
    onRemoved: (id) => store.removeRecord(id),
    onProgress: (progress) => store.setProgress(progress),
    onStats: (stats) => store.setStats(stats),
    onLaunchUrl: (url) => {
      void handleLaunchUrl(url);
    },
  });
}

async function handleLaunchUrl(url: string): Promise<void> {
  // The engine also stores launch URLs; this path covers a running window.
  if (active === "settings") show("downloads");
  await newDownload({ url });
}

// --- keyboard shortcuts ---------------------------------------------------

document.addEventListener("keydown", (event) => {
  const ctrl = event.ctrlKey || event.metaKey;

  if (ctrl && event.key.toLowerCase() === "n") {
    event.preventDefault();
    void newDownload();
    return;
  }

  if (ctrl && event.key.toLowerCase() === "v" && !isTypingTarget(event.target)) {
    event.preventDefault();
    void detectClipboardUrl().then((url) => {
      if (url) void newDownload({ url });
      else toast.info("The clipboard does not contain a download link");
    });
    return;
  }

  if (ctrl && event.key === ",") {
    event.preventDefault();
    show("settings");
    return;
  }

  if (ctrl && event.key === "f") {
    event.preventDefault();
    if (active !== "downloads" && active !== "completed") show("downloads");
    const search = viewFor(active).element.querySelector<HTMLInputElement>("input.search");
    search?.focus();
    return;
  }

  if (event.key === "F5") {
    event.preventDefault();
    void refreshFromBackend();
    return;
  }

  if (ctrl && /^[1-5]$/.test(event.key)) {
    event.preventDefault();
    const index = Number.parseInt(event.key, 10) - 1;
    const target = NAV[index];
    if (target) show(target.view);
  }
});

window.addEventListener("focus", () => {
  if (store.settings?.general.clipboardWatch) void detectClipboardUrl();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && store.settings?.general.clipboardWatch) void detectClipboardUrl();
});

/**
 * In-app notification for a state change the user cares about. Native Windows
 * notifications are sent by the engine itself; this keeps the window in sync
 * when it is already open.
 */
function announceTransition(previous: DownloadRecord | undefined, record: DownloadRecord): void {
  if (!previous || previous.status === record.status) return;
  const notificationsOff = store.settings ? !store.settings.general.notifications : false;
  if (notificationsOff) return;
  if (record.status === "completed") {
    toast.success("Download finished", record.filename);
  } else if (record.status === "failed") {
    toast.error("Download failed", record.error ?? record.filename, () =>
      void retryDownload(record),
    );
  } else if (record.status === "corrupt") {
    toast.error("Verification failed", record.error ?? record.filename);
  }
}

// --- startup --------------------------------------------------------------

async function refreshFromBackend(): Promise<void> {
  try {
    const [settings, records, stats] = await Promise.all([
      api.settingsGet(),
      api.list(),
      api.stats(),
    ]);
    store.setSettings(settings);
    store.setRecords(records);
    store.setStats(stats);
    applyTheme(settings.general.theme);
    applyCompact(settings.general.compactMode);
  } catch (raw) {
    toastError(toUiError(raw), () => void refreshFromBackend());
  }
}

async function loadAppInfo(): Promise<void> {
  try {
    const info = await api.appInfo();
    store.setAppInfo(info);
    setText(statusVersion, `v${info.version}`);
  } catch {
    /* the About page reports the details when it is opened */
  }
}

/** Adds downloads that were passed on the command line or by a link click. */
async function takeLaunchUrls(): Promise<void> {
  try {
    const urls = await api.takeLaunchUrls();
    if (urls.length === 0) return;
    await newDownload({ url: urls[0] });
    for (const url of urls.slice(1)) {
      try {
        const probe = await api.probe(url, null);
        await api.add({
          url: probe.finalUrl,
          filename: probe.filename,
          start: true,
          onConflict: "rename",
        });
      } catch (raw) {
        toastError(toUiError(raw));
      }
    }
  } catch {
    /* nothing to do when the shell is not available */
  }
}

async function start(): Promise<void> {
  if (!hasBackend) {
    document.documentElement.dataset.theme = "dark";
    renderSidebar();
    renderStatusbar();
    show("dashboard");
    return;
  }

  await connect();
  await refreshFromBackend();
  await loadAppInfo();
  show("dashboard");
  await takeLaunchUrls();
}

void start();

// A handle for the webview console (useful when diagnosing a support case).
Object.defineProperty(window, "__swiftload", {
  value: { store, views, api, show },
  configurable: true,
});
