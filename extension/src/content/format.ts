import type { ConfidenceLevel, Estimate, Score } from "@etsy-signal/shared";

export function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `$${Math.round(v / 1000)}k`;
  if (v >= 1_000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(v < 100 ? 2 : 0)}`;
}

export function fmtNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1_000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

export function fmtBand(unit: "USD" | "sales", p10: number, p90: number): string {
  const f = unit === "USD" ? fmtMoney : fmtNum;
  return `${f(p10)}–${f(p90)}`;
}

export function scoreColorClass(score: Score | undefined, invert = false): string {
  if (!score || !score.available || score.value == null) return "es-na";
  let good: boolean;
  if (invert) good = score.value < 35;
  else good = score.value >= 65;
  const bad = invert ? score.value >= 65 : score.value <= 35;
  if (good) return "es-good";
  if (bad) return "es-bad";
  return "es-warn";
}

export function confColor(level: ConfidenceLevel): string {
  return level === "HIGH" ? "var(--es-green)" : level === "MEDIUM" ? "var(--es-yellow)" : "var(--es-red)";
}

export function estText(e: Estimate): string {
  if (!e.available || !e.quantiles) return e.unavailableReason ?? "Insufficient public data";
  return fmtBand(e.unit, e.quantiles.p10, e.quantiles.p90);
}
