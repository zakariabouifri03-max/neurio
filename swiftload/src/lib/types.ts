/**
 * TypeScript mirror of the Rust types exposed over the Tauri IPC bridge.
 *
 * Every interface here corresponds one-to-one to a `serde`-serialised struct in
 * `src-tauri/src/types.rs` (camelCase on the wire). Keep both sides in sync:
 * a mismatch is a compile error in Rust, and a silent `undefined` here.
 */

export type DownloadStatus =
  | "queued"
  | "connecting"
  | "downloading"
  | "paused"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled"
  | "corrupt";

export type ConflictAction = "replace" | "rename" | "cancel";

export interface SegmentPlan {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  done: boolean;
}

export interface DownloadRecord {
  id: string;
  url: string;
  finalUrl: string;
  filename: string;
  destDir: string;
  filePath: string;
  partPath: string;
  status: DownloadStatus;
  error: string | null;
  fragmentable: boolean;
  connections: number;
  segments: SegmentPlan[];
  downloaded: number;
  total: number | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  sha256: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  elapsedSecs: number;
  position: number;
  retryCount: number;
  speedLimitBps: number | null;
  category: string;
  onConflict: ConflictAction;
}

export interface ProgressInfo {
  downloaded: number;
  total: number | null;
  speedBps: number;
  avgSpeedBps: number;
  etaSecs: number | null;
  activeConnections: number;
  totalConnections: number;
  status: DownloadStatus;
}

export interface DownloadProgress {
  id: string;
  info: ProgressInfo;
}

export interface StatsSnapshot {
  active: number;
  queued: number;
  completed: number;
  failed: number;
  paused: number;
  totalSpeedBps: number;
  totalDownloadedBytes: number;
  averageSpeedBps: number;
  totalDownloads: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  filename: string;
  filePath: string;
  status: DownloadStatus;
  total: number | null;
  downloaded: number;
  error: string | null;
  createdAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  averageSpeedBps: number;
  connections: number;
}

export interface ExistingFile {
  path: string;
  size: number;
  modified: number;
  suggestedAlternative: string;
}

export interface ProbeResult {
  finalUrl: string;
  filename: string;
  contentType: string | null;
  contentLength: number | null;
  acceptsRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  httpStatus: number;
  suggestedDestination: string;
  existingFile: ExistingFile | null;
}

export interface AddDownloadArgs {
  url: string;
  destDir?: string | null;
  filename?: string | null;
  connections?: number | null;
  sha256?: string | null;
  onConflict?: ConflictAction | null;
  start?: boolean | null;
}

export interface HistoryFilter {
  query?: string | null;
  scope?: "all" | "completed" | "failed" | null;
  sort?: "newest" | "oldest" | null;
  limit?: number | null;
  offset?: number | null;
}

export interface UiError {
  code: string;
  message: string;
  detail: string | null;
  retryable: boolean;
}

export type Theme = "dark" | "light" | "system";
export type ProxyMode = "off" | "system" | "custom";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface GeneralSettings {
  defaultDownloadDir: string;
  startWithWindows: boolean;
  notifications: boolean;
  confirmBeforeDelete: boolean;
  theme: Theme;
  compactMode: boolean;
  clipboardWatch: boolean;
  focusOnComplete: boolean;
  language: string;
}

export interface DownloadSettings {
  maxConcurrent: number;
  connectionsPerDownload: number;
  maxConnectionsPerDownload: number;
  adaptiveConnections: boolean;
  minSegmentBytes: number;
  maxRetries: number;
  retryDelayMs: number;
  retryMaxDelayMs: number;
  speedLimitBps: number | null;
  verifyOnResume: boolean;
  keepPartialFiles: boolean;
  verifyRanges: boolean;
  computeSha256: boolean;
  checkFreeSpace: boolean;
}

export interface NetworkSettings {
  connectTimeoutMs: number;
  stallTimeoutMs: number;
  proxyMode: ProxyMode;
  proxyUrl: string;
  noProxy: string;
  userAgent: string;
  maxRedirects: number;
  http1Only: boolean;
  poolIdlePerHost: number;
}

export interface AdvancedSettings {
  logLevel: LogLevel;
  tempDir: string;
  uiRefreshMs: number;
  checkpointIntervalMs: number;
  writeBufferBytes: number;
  sparseFiles: boolean;
  notifyOnComplete: boolean;
}

export interface AppSettings {
  general: GeneralSettings;
  downloads: DownloadSettings;
  network: NetworkSettings;
  advanced: AdvancedSettings;
}

export interface LogRecord {
  timestamp: number;
  level: LogLevel;
  category: string;
  downloadId: string | null;
  message: string;
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  engineVersion: string;
  os: string;
  arch: string;
  dataDir: string;
  logDir: string;
  databasePath: string;
  defaultDownloadDir: string;
  autostartEnabled: boolean;
  integrationRegistered: boolean;
  executable: string;
}

/** Local view state (never persisted by the backend). */
export type ViewName =
  | "dashboard"
  | "downloads"
  | "completed"
  | "failed"
  | "settings";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error" | "warning";
  title: string;
  message?: string;
  /** When set, the toast shows a Retry button that calls this function. */
  retry?: () => void;
  timeoutMs?: number;
}
