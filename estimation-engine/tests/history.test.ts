import { describe, expect, it } from "vitest";
import { positionVelocity, reviewVelocity, trackedDays, velocityAcceleration } from "../src/history.js";
import { NOW, snapshotsOver } from "./fixtures.js";
import type { HistoricalSnapshot } from "@etsy-signal/shared";

describe("review velocity", () => {
  it("recovers a known linear rate", () => {
    const snaps = snapshotsOver(35, 0.5); // 0.5 reviews/day for 35 days
    const fit = reviewVelocity(snaps)!;
    expect(fit).toBeTruthy();
    expect(fit.slopePerDay).toBeCloseTo(0.5, 1);
    expect(fit.r2).toBeGreaterThan(0.99);
    expect(fit.spanDays).toBeCloseTo(35, 0);
  });

  it("returns null with a single snapshot", () => {
    expect(reviewVelocity([{ observedAt: NOW, reviewCount: 10 }])).toBeNull();
  });

  it("returns null for same-day duplicates", () => {
    expect(
      reviewVelocity([
        { observedAt: NOW, reviewCount: 10 },
        { observedAt: NOW, reviewCount: 12 },
      ]),
    ).toBeNull();
  });

  it("floors negative slopes at zero and flags inconsistency", () => {
    const snaps: HistoricalSnapshot[] = [
      { observedAt: "2026-09-01T00:00:00Z", reviewCount: 100 },
      { observedAt: "2026-10-01T00:00:00Z", reviewCount: 80 },
    ];
    const fit = reviewVelocity(snaps)!;
    expect(fit.slopePerDay).toBe(0);
    expect(fit.inconsistent).toBe(true);
  });

  it("tracks days correctly", () => {
    const snaps = snapshotsOver(37, 0.2);
    expect(trackedDays(snaps)).toBeCloseTo(37, 0);
    expect(trackedDays([])).toBe(0);
  });

  it("detects acceleration", () => {
    const snaps: HistoricalSnapshot[] = [
      { observedAt: "2026-08-01T00:00:00Z", reviewCount: 0 },
      { observedAt: "2026-08-15T00:00:00Z", reviewCount: 2 },
      { observedAt: "2026-09-01T00:00:00Z", reviewCount: 4 },
      { observedAt: "2026-09-15T00:00:00Z", reviewCount: 12 },
      { observedAt: "2026-10-01T00:00:00Z", reviewCount: 30 },
    ];
    const accel = velocityAcceleration(snaps)!;
    expect(accel).toBeGreaterThan(1.5);
  });

  it("position velocity: negative slope means improving rank", () => {
    const snaps: HistoricalSnapshot[] = [
      { observedAt: "2026-09-01T00:00:00Z", reviewCount: 10, searchPosition: 24 },
      { observedAt: "2026-09-15T00:00:00Z", reviewCount: 14, searchPosition: 17 },
      { observedAt: "2026-10-01T00:00:00Z", reviewCount: 20, searchPosition: 11 },
    ];
    const fit = positionVelocity(snaps)!;
    expect(fit.slopePerDay).toBeLessThan(0);
  });
});
