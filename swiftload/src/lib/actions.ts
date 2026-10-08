/**
 * User actions shared by every view.
 *
 * Each function calls one backend command, keeps the store honest about the
 * result and reports failures with a toast. Views never talk to `api` directly
 * for these operations, so button behaviour is identical everywhere.
 */

import { confirmDialog, detailsDialog, speedLimitDialog } from "../components/dialogs";
import { DownloadDialog } from "../components/download-dialog";
import { toast, toastError } from "../components/toast";
import { api } from "./api";
import { copyToClipboard } from "./dom";
import { toUiError } from "./errors";
import { store } from "./store";
import type { DownloadRecord } from "./types";

const dialog = new DownloadDialog();

/** Opens the New Download dialog, optionally pre-filled from the clipboard. */
export async function newDownload(prefill?: { url?: string; sha256?: string }): Promise<void> {
  await dialog
    .withStarted((record) => {
      toast.success("Download added", record.filename);
    })
    .open(prefill);
}

const label = (record: DownloadRecord) => record.filename || record.url;

async function guard(action: () => Promise<unknown>, retry?: () => Promise<unknown>) {
  try {
    await action();
  } catch (raw) {
    const error = toUiError(raw);
    toastError(error, retry ? () => void retry() : undefined);
  }
}

export async function startDownload(record: DownloadRecord): Promise<void> {
  await guard(() => api.start(record.id));
}

export async function pauseDownload(record: DownloadRecord): Promise<void> {
  await guard(() => api.pause(record.id));
}

export async function resumeDownload(record: DownloadRecord): Promise<void> {
  await guard(() => api.resume(record.id));
}

export async function cancelDownload(record: DownloadRecord): Promise<void> {
  await guard(async () => {
    await api.cancel(record.id);
    toast.info("Cancelled", `${label(record)} — the partial file was kept`);
  });
}

export async function retryDownload(record: DownloadRecord): Promise<void> {
  await guard(async () => {
    await api.retry(record.id);
    toast.info("Retrying", label(record));
  });
}

export async function removeDownload(record: DownloadRecord, deleteFile: boolean): Promise<void> {
  const settings = store.settings;
  const active = ["downloading", "connecting", "retrying", "queued", "paused"].includes(
    record.status,
  );
  const hasPartial = record.downloaded > 0 && record.status !== "completed";

  if (deleteFile) {
    // Deleting data from the disk is irreversible, so this always asks.
    const confirmed = await confirmDialog({
      title: "Delete the downloaded file?",
      message: `${record.filename} will be deleted from ${record.destDir}.`,
      detail: "The file is removed from the disk and cannot be restored from the Recycle Bin.",
      confirmLabel: "Delete file",
      danger: true,
    });
    if (!confirmed) return;
  } else if (settings?.general.confirmBeforeDelete && (active || hasPartial)) {
    const confirmed = await confirmDialog({
      title: "Remove this download?",
      message: `${record.filename} will be removed from the list.`,
      detail: "The partial data SwiftLoad already downloaded is deleted as well.",
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
  }

  await guard(async () => {
    await api.remove(record.id, deleteFile);
    store.removeRecord(record.id);
    if (deleteFile) toast.info("File deleted", label(record));
  });
}

export async function openFileOf(record: DownloadRecord): Promise<void> {
  await guard(() => api.openFile(record.id));
}

export async function openFolderOf(record: DownloadRecord): Promise<void> {
  await guard(() => api.openFolder(record.id));
}

export async function copyUrlOf(record: DownloadRecord): Promise<void> {
  const ok = await copyToClipboard(record.url);
  if (ok) toast.info("URL copied", record.url.slice(0, 80));
  else toast.warning("Could not copy", "The clipboard is not available.");
}

export function changeLimit(record: DownloadRecord): void {
  speedLimitDialog(record);
}

export function showDetails(record: DownloadRecord): void {
  detailsDialog(record);
}

/** Starts every queued/paused download, respecting the concurrency limit. */
export async function startAll(): Promise<void> {
  try {
    await api.startAll();
    toast.info("Starting all downloads");
  } catch (raw) {
    toastError(toUiError(raw));
  }
}

export async function pauseAll(): Promise<void> {
  try {
    await api.pauseAll();
    toast.info("All downloads paused");
  } catch (raw) {
    toastError(toUiError(raw));
  }
}

export async function removeFinished(deleteFiles: boolean): Promise<void> {
  // The backend removes completed *and* cancelled entries in one sweep.
  const finished =
    store.completed().length + store.records.filter((record) => record.status === "cancelled").length;
  if (finished === 0 && !deleteFiles) {
    toast.info("Nothing to clean up");
    return;
  }
  if (deleteFiles) {
    const confirmed = await confirmDialog({
      title: "Delete all completed files?",
      message: `${finished} file(s) will be deleted from the disk and removed from the list.`,
      detail: "This cannot be undone.",
      confirmLabel: "Delete files",
      danger: true,
    });
    if (!confirmed) return;
  }
  try {
    const removed = await api.removeFinished(deleteFiles);
    toast.info(
      removed === 0 ? "Nothing to clean up" : `Removed ${removed} entr${removed === 1 ? "y" : "ies"}`,
    );
  } catch (raw) {
    toastError(toUiError(raw));
  }
}

export async function clearHistory(scope: "all" | "completed" | "failed"): Promise<void> {
  const confirmed = await confirmDialog({
    title: "Clear history?",
    message:
      scope === "all"
        ? "Every entry in the download history will be deleted."
        : `Every ${scope} entry in the history will be deleted.`,
    detail: "Downloaded files are not affected.",
    confirmLabel: "Clear",
  });
  if (!confirmed) return;
  try {
    const removed = await api.historyClear(scope);
    toast.info(`History cleared (${removed} entr${removed === 1 ? "y" : "ies"})`);
  } catch (raw) {
    toastError(toUiError(raw));
  }
}

/**
 * Checks the clipboard for a download URL and returns it.
 *
 * This runs when the user asks for it or when the window regains focus — never
 * on a timer — so SwiftLoad costs nothing while it sits idle in the background.
 */
export async function detectClipboardUrl(): Promise<string | null> {
  try {
    const url = await api.clipboardUrl();
    store.setClipboardUrl(url);
    return url;
  } catch {
    return null;
  }
}

/** Download from a URL that arrived from outside (file association, shortcut). */
export async function downloadFromUrl(url: string): Promise<void> {
  await newDownload({ url });
}
