/**
 * FFmpeg escaping + path helpers.
 *
 * Commands are always spawned with an **argument array** (never a shell), so
 * there is no shell injection surface. What remains is FFmpeg's own
 * filter-syntax escaping, handled here in one place.
 */

const FILTER_SPECIAL = /([\\':[\],;])/g;

/** Escape a value used inside a `key=value` filter argument. */
export function escapeFilterValue(value: string): string {
  return value.replace(FILTER_SPECIAL, '\\$1');
}

/** Wrap a value in single quotes and escape the inner quotes (FFmpeg style). */
export function quoteFilterValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Escape a filesystem path for use as a filter argument.
 * Windows drive letters contain `:`, which FFmpeg would read as an option
 * separator, so it is always escaped.
 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/(['[\]:,;])/g, '\\$1');
}

/** Join a filter's arguments as `k=v:k2=v2`. Empty values are skipped. */
export function filterArgs(args: Record<string, string | number | undefined>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(':');
}

export function buildFilter(name: string, args: Record<string, string | number | undefined>): string {
  const argString = filterArgs(args);
  return argString ? `${name}=${argString}` : name;
}

/** Chain filters with commas, dropping empty entries. */
export function chain(...filters: (string | null | undefined)[]): string {
  return filters.filter((f): f is string => Boolean(f && f.trim().length > 0)).join(',');
}

/**
 * `atempo` accepts only 0.5..2 per instance (and 0.5..100 in very new builds).
 * Decompose an arbitrary rate into a cascade that is safe everywhere.
 */
export function atempoCascade(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0) return [];
  if (Math.abs(speed - 1) < 1e-4) return [];
  const out: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    out.push('atempo=2.000000');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    out.push('atempo=0.500000');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-4) out.push(`atempo=${remaining.toFixed(6)}`);
  return out;
}

/** Linear gain to dB string, clamped to what `volume` accepts. */
export function gainToDbArg(gain: number): string | null {
  if (!Number.isFinite(gain) || gain <= 0) return 'volume=0';
  if (Math.abs(gain - 1) < 1e-4) return null;
  const db = 20 * Math.log10(gain);
  return `volume=${db.toFixed(3)}dB`;
}

/** Normalise an arbitrary aspect to one of the standard fps values. */
export function normalizeFps(fps: number): number {
  const known = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
  for (const k of known) if (Math.abs(k - fps) < 0.02) return k;
  return Math.round(fps * 1000) / 1000;
}

/** Even dimensions are required by yuv420p encoders. */
export function evenDimension(value: number): number {
  const v = Math.max(2, Math.round(value));
  return v % 2 === 0 ? v : v + 1;
}

/** Human-readable bitrate for the UI. */
export function formatBitrate(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(kbps % 1000 === 0 ? 0 : 1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}
