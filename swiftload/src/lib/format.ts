/**
 * Formatting helpers used across the UI.
 *
 * Everything here renders numbers that came from real measurements; when a
 * value is unknown (for example the size of a chunked response) the helpers
 * return a dash instead of inventing a number.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** `1_234_567` → `1.18 MB`. Returns `—` for `null`/`undefined`. */
export function formatBytes(bytes: number | null | undefined, digits?: number): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const decimals = digits ?? (exponent === 0 ? 0 : value >= 100 ? 1 : value >= 10 ? 1 : 2);
  return `${value.toFixed(decimals)} ${UNITS[exponent]}`;
}

/** Bytes per second → `18.4 MB/s`. */
export function formatSpeed(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps) || bps <= 0) return "—";
  return `${formatBytes(bps, bps >= 1024 * 1024 ? 1 : 0)}/s`;
}

/** Seconds → `1m 12s` (compact) or `1h 02m 03s`. */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

/** Progress ratio in `0…1`, or `null` when the total is unknown. */
export function ratio(downloaded: number, total: number | null | undefined): number | null {
  if (total === null || total === undefined || total <= 0) return null;
  return Math.max(0, Math.min(1, downloaded / total));
}

/** `78%` — or `—` while the total is unknown. */
export function formatPercent(downloaded: number, total: number | null | undefined): string {
  const value = ratio(downloaded, total);
  if (value === null) return "—";
  return `${(value * 100).toFixed(value === 1 ? 0 : 1)}%`;
}

/** Unix milliseconds → `2026-10-08 14:32`. */
export function formatTimestamp(millis: number | null | undefined): string {
  if (!millis) return "—";
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Unix milliseconds → `2 minutes ago`. */
export function formatRelative(millis: number | null | undefined, now = Date.now()): string {
  if (!millis) return "—";
  const seconds = Math.max(0, Math.round((now - millis) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatTimestamp(millis);
}

/** Elapsed seconds → `12s` / `4m 12s`. */
export function formatDuration(seconds: number | null | undefined): string {
  return formatEta(seconds);
}

/** `1_048_576` → `1 MB` for the speed-limit selector. */
export function formatLimit(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "Unlimited";
  return `${formatBytes(bps, 0)}/s`;
}

/** Parses `5 MB`, `500 KB/s`, `1048576` into bytes/second; `null` = unlimited. */
export function parseLimit(input: string): number | null | undefined {
  const text = input.trim().toLowerCase();
  if (text.length === 0) return undefined;
  if (["unlimited", "none", "off", "0"].includes(text)) return null;
  const match = text.match(/^([0-9]*\.?[0-9]+)\s*(b|kb|mb|gb|kib|mib|gib)?(?:\/s)?$/);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = (match[2] ?? "b").toLowerCase();
  const factor: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
  };
  return Math.round(value * (factor[unit] ?? 1));
}

/** Trims a path for display: `C:\Users\me\Downloads\file.zip`. */
export function shortenMiddle(text: string, max = 64): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 3) / 2);
  const tail = Math.floor((max - 3) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** Simple, dependency-free number formatting with thousands separators. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US");
}

/** Maps a file type to a glyph used by the list (no external icon fonts). */
export function fileGlyph(category: string): string {
  switch (category) {
    case "video":
      return "🎬";
    case "audio":
      return "🎵";
    case "image":
      return "🖼";
    case "archives":
      return "🗜";
    case "documents":
      return "📄";
    case "programs":
      return "⚙";
    default:
      return "📦";
  }
}
