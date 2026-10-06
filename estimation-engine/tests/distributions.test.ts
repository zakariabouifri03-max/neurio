import { describe, expect, it } from "vitest";
import { logNormalQuantiles, opinionPool, clampSigma, MIN_SIGMA, MAX_SIGMA } from "../src/distributions.js";

describe("log-normal quantiles", () => {
  it("p10 < p50 < p90", () => {
    const q = logNormalQuantiles({ mu: Math.log(500), sigma2: 0.5 });
    expect(q.p10).toBeLessThan(q.p50);
    expect(q.p50).toBeLessThan(q.p90);
    expect(q.p50).toBeCloseTo(500, 5);
  });

  it("wider sigma widens the interval", () => {
    const narrow = logNormalQuantiles({ mu: 5, sigma2: 0.1 });
    const wide = logNormalQuantiles({ mu: 5, sigma2: 0.9 });
    expect(wide.p90 / wide.p10).toBeGreaterThan(narrow.p90 / narrow.p10);
  });
});

describe("opinion pool", () => {
  it("returns null with no models", () => {
    expect(opinionPool([])).toBeNull();
  });

  it("agreement yields low disagreement; contradiction yields high", () => {
    const agree = opinionPool([
      { name: "a", mu: 6, sigma2: 0.2, weight: 1, note: "" },
      { name: "b", mu: 6.1, sigma2: 0.2, weight: 1, note: "" },
    ])!;
    const disagree = opinionPool([
      { name: "a", mu: 4, sigma2: 0.2, weight: 1, note: "" },
      { name: "b", mu: 9, sigma2: 0.2, weight: 1, note: "" },
    ])!;
    expect(disagree.disagreement).toBeGreaterThan(0.7);
    expect(agree.disagreement).toBeLessThan(0.05);
    // Disagreement inflates total variance beyond within-model variance.
    expect(disagree.sigma2).toBeGreaterThan(agree.sigma2 * 5);
  });

  it("weights are respected", () => {
    const pooled = opinionPool([
      { name: "a", mu: 0, sigma2: 0.01, weight: 3, note: "" },
      { name: "b", mu: 4, sigma2: 0.01, weight: 1, note: "" },
    ])!;
    expect(pooled.mu).toBeCloseTo(1, 5);
  });

  it("clamps sigma into the documented band", () => {
    expect(Math.sqrt(clampSigma(0.0001))).toBeCloseTo(MIN_SIGMA, 10);
    expect(Math.sqrt(clampSigma(100))).toBeCloseTo(MAX_SIGMA, 10);
  });
});
