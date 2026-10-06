import { describe, expect, it } from "vitest";
import { clamp, daysBetween, median, quantile, round } from "../src/index.js";

describe("shared utils", () => {
  it("clamp/round", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(round(1.2345, 2)).toBe(1.23);
  });

  it("daysBetween", () => {
    expect(daysBetween("2026-10-01T00:00:00Z", "2026-10-06T00:00:00Z")).toBeCloseTo(5, 10);
    expect(daysBetween("garbage", "2026-10-06T00:00:00Z")).toBe(0);
  });

  it("median/quantile", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeNull();
  });
});
