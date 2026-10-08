/**
 * Frontend state.
 *
 * A single store holds what the engine told us. Views subscribe to the topics
 * they render, so a progress tick only repaints the progress widgets instead of
 * the whole document. There is no polling here: every value arrives through
 * {@link subscribeEngine}.
 */

import type {
  AppInfo,
  AppSettings,
  DownloadProgress,
  DownloadRecord,
  DownloadStatus,
  ProgressInfo,
  StatsSnapshot,
  Theme,
  ViewName,
} from "./types";

export const EMPTY_STATS: StatsSnapshot = {
  active: 0,
  queued: 0,
  completed: 0,
  failed: 0,
  paused: 0,
  totalSpeedBps: 0,
  totalDownloadedBytes: 0,
  averageSpeedBps: 0,
  totalDownloads: 0,
};

/** Statuses that mean "bytes are moving right now". */
export const ACTIVE_STATUSES: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  "connecting",
  "downloading",
  "retrying",
]);

/** Statuses waiting for a slot or for the user. */
export const WAITING_STATUSES: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  "queued",
  "paused",
]);

/** Statuses the user can retry. */
export const RETRYABLE_STATUSES: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  "failed",
  "cancelled",
  "corrupt",
]);

export const STATUS_LABELS: Record<DownloadStatus, string> = {
  queued: "Queued",
  connecting: "Connecting",
  downloading: "Downloading",
  paused: "Paused",
  retrying: "Retrying",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  corrupt: "Corrupted",
};

export type FilterKind = "all" | "active" | "waiting" | "completed" | "failed";

/** Topic the store notifies subscribers about. */
export type Topic = "records" | "progress" | "stats" | "settings" | "view" | "clipboard";

type Listener = (topic: Topic) => void;

export class Store {
  private readonly listeners = new Set<Listener>();
  private readonly index = new Map<string, DownloadRecord>();

  records: DownloadRecord[] = [];
  progress = new Map<string, ProgressInfo>();
  stats: StatsSnapshot = { ...EMPTY_STATS };
  settings: AppSettings | null = null;
  appInfo: AppInfo | null = null;
  view: ViewName = "dashboard";
  clipboardUrl: string | null = null;
  /** Free-text filter, kept per view so switching views never hides rows. */
  private readonly queries: Record<string, string> = {};
  filter: FilterKind = "all";
  /** Theme actually applied to the document (resolved from `system`). */
  resolvedTheme: "dark" | "light" = "dark";

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(topic: Topic): void {
    for (const listener of this.listeners) {
      try {
        listener(topic);
      } catch (error) {
        console.error("store listener failed", error);
      }
    }
  }

  // --- records -----------------------------------------------------------

  setRecords(records: DownloadRecord[]): void {
    this.index.clear();
    const sorted = [...records].sort(compareRecords);
    for (const record of sorted) this.index.set(record.id, record);
    this.records = sorted;
    this.notify("records");
  }

  upsertRecord(record: DownloadRecord): void {
    const previous = this.index.get(record.id);
    this.index.set(record.id, record);
    if (previous) {
      const position = this.records.findIndex((item) => item.id === record.id);
      if (position >= 0) {
        this.records[position] = record;
        this.records.sort(compareRecords);
      }
    } else {
      this.records.push(record);
      this.records.sort(compareRecords);
    }
    this.notify("records");
  }

  removeRecord(id: string): void {
    this.index.delete(id);
    this.progress.delete(id);
    this.records = this.records.filter((record) => record.id !== id);
    this.notify("records");
    this.notify("progress");
  }

  getRecord(id: string): DownloadRecord | undefined {
    return this.index.get(id);
  }

  // --- progress ----------------------------------------------------------

  setProgress(list: DownloadProgress[]): void {
    // The engine sends a complete snapshot for the running set; entries for
    // downloads that are no longer running are dropped so a finished download
    // cannot keep showing a stale speed.
    const next = new Map<string, ProgressInfo>();
    for (const item of list) next.set(item.id, item.info);
    this.progress = next;
    this.notify("progress");
  }

  clearProgress(id: string): void {
    if (this.progress.delete(id)) this.notify("progress");
  }

  /** Live numbers for a download, or an honest stand-in derived from the record. */
  statFor(record: DownloadRecord): ProgressInfo {
    const live = this.progress.get(record.id);
    if (live) return live;
    return {
      downloaded: record.downloaded,
      total: record.total,
      speedBps: 0,
      avgSpeedBps: 0,
      etaSecs: null,
      activeConnections: 0,
      totalConnections: record.connections,
      status: record.status,
    };
  }

  // --- simple fields -----------------------------------------------------

  setStats(stats: StatsSnapshot): void {
    this.stats = stats;
    this.notify("stats");
  }

  setSettings(settings: AppSettings): void {
    this.settings = settings;
    this.notify("settings");
  }

  setAppInfo(info: AppInfo): void {
    this.appInfo = info;
    this.notify("settings");
  }

  setView(view: ViewName): void {
    if (this.view === view) return;
    this.view = view;
    this.notify("view");
  }

  queryFor(view: ViewName): string {
    return this.queries[view] ?? "";
  }

  setQuery(view: ViewName, query: string): void {
    if (this.queries[view] === query) return;
    this.queries[view] = query;
    this.notify("records");
  }

  setFilter(filter: FilterKind): void {
    if (this.filter === filter) return;
    this.filter = filter;
    this.notify("records");
  }

  setClipboardUrl(url: string | null): void {
    if (this.clipboardUrl === url) return;
    this.clipboardUrl = url;
    this.notify("clipboard");
  }

  setResolvedTheme(theme: "dark" | "light"): void {
    if (this.resolvedTheme === theme) return;
    this.resolvedTheme = theme;
    this.notify("settings");
  }

  // --- derived collections ----------------------------------------------

  active(): DownloadRecord[] {
    return this.records.filter((record) => ACTIVE_STATUSES.has(record.status));
  }

  waiting(): DownloadRecord[] {
    return this.records.filter((record) => WAITING_STATUSES.has(record.status));
  }

  completed(): DownloadRecord[] {
    return this.records.filter((record) => record.status === "completed");
  }

  failed(): DownloadRecord[] {
    return this.records.filter((record) => RETRYABLE_STATUSES.has(record.status));
  }

  /** Records shown by the Downloads view (everything except finished/failed). */
  inProgress(): DownloadRecord[] {
    return this.records.filter(
      (record) => !["completed", "failed", "cancelled", "corrupt"].includes(record.status),
    );
  }

  /** Applies the current search box + filter selection. */
  visibleFor(view: ViewName): DownloadRecord[] {
    let list: DownloadRecord[];
    switch (view) {
      case "completed":
        list = this.completed();
        break;
      case "failed":
        list = this.failed();
        break;
      case "downloads":
        list = this.records.filter((record) => record.status !== "completed");
        break;
      default:
        list = this.records;
    }
    const filter = this.filter;
    if (filter !== "all") {
      list = list.filter((record) => {
        if (filter === "active") return ACTIVE_STATUSES.has(record.status);
        if (filter === "waiting") return WAITING_STATUSES.has(record.status);
        if (filter === "completed") return record.status === "completed";
        return RETRYABLE_STATUSES.has(record.status);
      });
    }
    const query = this.queryFor(view).trim().toLowerCase();
    if (query.length > 0) {
      list = list.filter((record) => haystack(record).includes(query));
    }
    return list;
  }

  get themePreference(): Theme {
    return this.settings?.general.theme ?? "dark";
  }
}

/** Position first (queue order), then creation time, then id for stability. */
export function compareRecords(a: DownloadRecord, b: DownloadRecord): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function haystack(record: DownloadRecord): string {
  return `${record.filename} ${record.url} ${record.filePath} ${record.destDir} ${record.category}`.toLowerCase();
}

/** Single shared instance used by every view. */
export const store = new Store();
