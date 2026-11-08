/** Small formatting/utility helpers used across the popup UI. */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export const CATEGORIES = [
  "shirt",
  "tshirt",
  "dress",
  "jacket",
  "coat",
  "trousers",
  "pants",
  "skirt",
  "sweater",
  "hoodie",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function categoryLabel(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}
