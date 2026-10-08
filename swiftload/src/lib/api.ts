/**
 * The complete backend surface of SwiftLoad.
 *
 * The UI never touches the network or the filesystem itself: every operation
 * goes through one of these commands, which are the exact `#[tauri::command]`
 * functions in `src-tauri/src/commands/`. Keeping the list in one place makes it
 * obvious what the frontend is allowed to do.
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  AddDownloadArgs,
  AppInfo,
  AppSettings,
  DownloadProgress,
  DownloadRecord,
  HistoryEntry,
  HistoryFilter,
  LogRecord,
  ProbeResult,
  ProgressInfo,
  StatsSnapshot,
} from "./types";

/** `true` when the UI runs inside the Tauri shell rather than a browser. */
export const hasBackend: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasBackend) {
    throw {
      code: "no_backend",
      message: "SwiftLoad is running outside the desktop shell, so commands are unavailable.",
      detail: command,
      retryable: false,
    };
  }
  return invoke<T>(command, args);
}

export const api = {
  // --- downloads ---------------------------------------------------------
  list: () => call<DownloadRecord[]>("download_list"),
  get: (id: string) => call<DownloadRecord>("download_get", { id }),
  progress: (id: string) => call<ProgressInfo>("download_progress", { id }),
  progressAll: () => call<DownloadProgress[]>("download_progress_all"),
  stats: () => call<StatsSnapshot>("download_stats"),

  probe: (url: string, destDir?: string | null) =>
    call<ProbeResult>("download_probe", { url, destDir: destDir ?? null }),
  add: (args: AddDownloadArgs) => call<DownloadRecord>("download_add", { args }),

  start: (id: string) => call<DownloadRecord>("download_start", { id }),
  pause: (id: string) => call<DownloadRecord>("download_pause", { id }),
  resume: (id: string) => call<DownloadRecord>("download_resume", { id }),
  cancel: (id: string) => call<DownloadRecord>("download_cancel", { id }),
  retry: (id: string) => call<DownloadRecord>("download_retry", { id }),
  restart: (id: string) => call<DownloadRecord>("download_restart", { id }),
  remove: (id: string, deleteFile = false) =>
    call<void>("download_remove", { id, deleteFile }),
  moveUp: (id: string) => call<void>("download_move_up", { id }),
  moveDown: (id: string) => call<void>("download_move_down", { id }),
  reorder: (id: string, position: number) => call<void>("download_reorder", { id, position }),
  startAll: () => call<void>("download_start_all"),
  pauseAll: () => call<void>("download_pause_all"),
  removeFinished: (deleteFiles = false) =>
    call<number>("download_remove_finished", { deleteFiles }),
  setSpeedLimit: (id: string, limitBps: number | null) =>
    call<void>("download_set_speed_limit", { id, limitBps }),

  // --- history -----------------------------------------------------------
  history: (filter?: HistoryFilter) => call<HistoryEntry[]>("history_list", { filter: filter ?? null }),
  historyDelete: (id: string) => call<void>("history_delete", { id }),
  historyClear: (scope: "all" | "completed" | "failed") =>
    call<number>("history_clear", { scope }),

  // --- files -------------------------------------------------------------
  openFile: (id: string) => call<void>("file_open", { id }),
  openFolder: (id: string) => call<void>("file_open_folder", { id }),
  deleteFile: (id: string) => call<void>("file_delete", { id }),
  fileExists: (id: string) => call<boolean>("file_exists", { id }),
  pickFolder: (start?: string | null) =>
    call<string | null>("path_pick_folder", { start: start ?? null }),
  pickSaveFile: (startDir?: string | null, defaultName?: string | null) =>
    call<string | null>("path_pick_save_file", {
      startDir: startDir ?? null,
      defaultName: defaultName ?? null,
    }),
  defaultDownloadDir: () => call<string>("path_default_download"),
  freeSpace: (dir: string) => call<number | null>("path_free_space", { dir }),
  openLogs: () => call<void>("path_open_logs"),
  openDataDir: () => call<void>("path_open_data_dir"),
  checkFolder: (dir: string) => call<void>("path_check_folder", { dir }),
  openDir: (dir: string) => call<void>("path_open_dir", { dir }),

  // --- settings & logs ---------------------------------------------------
  settingsGet: () => call<AppSettings>("settings_get"),
  settingsUpdate: (settings: AppSettings) => call<AppSettings>("settings_update", { settings }),
  settingsReset: () => call<AppSettings>("settings_reset"),
  logs: (limit = 300, level?: string | null) =>
    call<LogRecord[]>("logs_list", { limit, level: level ?? null }),
  logsClear: () => call<void>("logs_clear"),
  logsCurrentFile: () => call<string>("logs_current_file"),
  logsOpenDir: () => call<void>("logs_open_dir"),
  logsWrite: (message: string) => call<void>("logs_write", { message, level: "info" }),

  // --- system ------------------------------------------------------------
  appInfo: () => call<AppInfo>("app_info"),
  diagnostics: () => call<Record<string, unknown>>("app_diagnostics"),
  clipboardUrl: () => call<string | null>("clipboard_detect_url"),
  integrationStatus: () => call<boolean>("integration_status"),
  integrationSet: (enabled: boolean) => call<boolean>("integration_set", { enabled }),
  openUrl: (url: string) => call<void>("app_open_url", { url }),
  takeLaunchUrls: () => call<string[]>("app_take_launch_urls"),
};

export type Api = typeof api;
