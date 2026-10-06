import { describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";
import { estimateLifetimeSales, estimateMonthlySales } from "../src/sales.js";
import { estimateMonthlyRevenue } from "../src/revenue.js";
import { daysAgoIso, mkInput, NOW, snapshotsOver } from "./fixtures.js";

describe("sales estimation — established listing", () => {
  const input = mkInput({
    latest: { reviewCount: 386, rating: 4.8, price: 19.99, listedOnDate: daysAgoIso(143) },
    history: snapshotsOver(37, 386 / 143), // consistent with lifetime rate
    firstObservedAt: daysAgoIso(37),
    lastObservedAt: NOW,
  });

  it("lifetime sales: available, ordered quantiles, sane magnitude", () => {
    const est = estimateLifetimeSales(input);
    expect(est.available).toBe(true);
    const q = est.quantiles!;
    expect(q.p10).toBeLessThan(q.p50);
    expect(q.p50).toBeLessThan(q.p90);
    // 386 reviews / 3% propensity ≈ 12,867 — allow the ensemble room to move.
    expect(q.p50).toBeGreaterThan(4_000);
    expect(q.p50).toBeLessThan(45_000);
    expect(est.evidence.some((e) => e.includes("386"))).toBe(true);
    expect(est.limitations.join(" ")).toMatch(/not official|does not disclose/i);
  });

  it("monthly sales: available with velocity + age agreement", () => {
    const est = estimateMonthlySales(input);
    expect(est.available).toBe(true);
    const q = est.quantiles!;
    expect(q.p10).toBeGreaterThan(0);
    expect(q.p10).toBeLessThan(q.p90);
    expect(est.modelBreakdown.length).toBeGreaterThanOrEqual(2);
  });

  it("monthly revenue: sales × observed price", () => {
    const monthly = estimateMonthlySales(input);
    const est = estimateMonthlyRevenue(input, monthly);
    expect(est.available).toBe(true);
    const q = est.quantiles!;
    // ~2,700/month × $19.99 ≈ $54k median — allow wide ensemble tolerance.
    expect(q.p50).toBeGreaterThan(10_000);
    expect(q.p50).toBeLessThan(300_000);
    expect(est.limitations.join(" ")).toMatch(/revenue/i);
  });

  it("is fully deterministic", () => {
    const a = analyze(input);
    const b = analyze(input);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("labels estimates as estimates in the full analysis bundle", () => {
    const a = analyze(input);
    expect(a.estimates.sales.unit).toBe("sales");
    expect(a.real.reviewCount).toBe(386);
    expect(a.real.price).toBe(19.99);
    expect(a.signals.length).toBeGreaterThanOrEqual(3);
    for (const s of a.signals) {
      expect(s.source).toMatch(/observed_public_data|extension_history|user_authorized_api/);
      expect(typeof s.timestamp).toBe("string");
    }
  });
});

describe("sales estimation — shop calibration (real shop totals)", () => {
  it("anchors to the shop's public review rate instead of the prior", () => {
    const input = mkInput({
      latest: { reviewCount: 120, shopSalesCount: 10_000, shopReviewCount: 400 },
    });
    const est = estimateLifetimeSales(input);
    expect(est.available).toBe(true);
    // 120 reviews / 4% shop rate = 3,000 expected lifetime sales.
    expect(est.quantiles!.p50).toBeGreaterThan(1_800);
    expect(est.quantiles!.p50).toBeLessThan(5_000);
    expect(est.evidence.join(" ")).toMatch(/shop/i);
  });
});

describe("sales estimation — edge cases", () => {
  it("0 reviews -> no fabricated range, documented upper bound", () => {
    const est = estimateLifetimeSales(mkInput({ latest: { reviewCount: 0 } }));
    expect(est.available).toBe(false);
    expect(est.quantiles).toBeUndefined();
    expect(est.unavailableReason).toMatch(/0 reviews/i);
    expect(est.limitations.join(" ")).toMatch(/unlikely/i);
  });

  it("1 review -> available but LOW confidence and very wide interval", () => {
    const est = estimateLifetimeSales(mkInput({ latest: { reviewCount: 1 } }));
    expect(est.available).toBe(true);
    expect(est.confidenceLevel).toBe("LOW");
    const q = est.quantiles!;
    expect(q.p90 / Math.max(1, q.p10)).toBeGreaterThan(5);
  });

  it("very old listing (5+ years, 9.8k reviews)", () => {
    const est = estimateLifetimeSales(
      mkInput({ latest: { reviewCount: 9_800, listedOnDate: "2021-01-01T00:00:00Z" } }),
    );
    expect(est.available).toBe(true);
    expect(est.quantiles!.p50).toBeGreaterThan(100_000);
  });

  it("very new listing: lifetime ok, monthly refuses without history", () => {
    const input = mkInput({
      latest: { reviewCount: 3, listedOnDate: daysAgoIso(2) },
    });
    expect(estimateLifetimeSales(input).available).toBe(true);
    const monthly = estimateMonthlySales(input);
    expect(monthly.available).toBe(false);
    expect(monthly.unavailableReason).toMatch(/historical/i);
  });

  it("no listing age and no history -> monthly unavailable with clear reason", () => {
    const monthly = estimateMonthlySales(mkInput({ latest: { reviewCount: 200 } }));
    expect(monthly.available).toBe(false);
    expect(monthly.unavailableReason).toMatch(/not enough/i);
  });

  it("missing price -> revenue estimate unavailable (not invented)", () => {
    const input = mkInput({
      latest: { reviewCount: 386, price: undefined, listedOnDate: daysAgoIso(143) },
      history: snapshotsOver(37, 2.7),
    });
    const monthly = estimateMonthlySales(input);
    expect(monthly.available).toBe(true);
    const est = estimateMonthlyRevenue(input, monthly);
    expect(est.available).toBe(false);
    expect(est.unavailableReason).toMatch(/revenue estimate unavailable/i);
  });

  it("missing rating does not break sales estimation", () => {
    const est = estimateLifetimeSales(mkInput({ latest: { reviewCount: 50, rating: undefined } }));
    expect(est.available).toBe(true);
  });

  it("rapid review growth produces a rising trend", () => {
    const input = mkInput({
      latest: { reviewCount: 120 },
      history: [
        { observedAt: daysAgoIso(60), reviewCount: 0 },
        { observedAt: daysAgoIso(45), reviewCount: 2 },
        { observedAt: daysAgoIso(30), reviewCount: 5 },
        { observedAt: daysAgoIso(15), reviewCount: 20 },
        { observedAt: daysAgoIso(1), reviewCount: 70 },
      ],
    });
    const a = analyze(input);
    expect(a.scores.trend.trend).toBe("rising");
    expect(a.scores.trend.value!).toBeGreaterThan(55);
  });

  it("conflicting signals widen the interval instead of averaging away", () => {
    const conflicted = estimateLifetimeSales(
      mkInput({ latest: { reviewCount: 2, favoritesCount: 5_000, badges: ["Bestseller"] } }),
    );
    const consistent = estimateLifetimeSales(mkInput({ latest: { reviewCount: 200, favoritesCount: 400 } }));
    expect(conflicted.available).toBe(true);
    const wConf = conflicted.quantiles!.p90 / Math.max(1, conflicted.quantiles!.p10);
    const wCons = consistent.quantiles!.p90 / Math.max(1, consistent.quantiles!.p10);
    expect(wConf).toBeGreaterThan(wCons);
  });

  it("bestseller badge floors the monthly low end (documented assumption)", () => {
    const input = mkInput({
      latest: { reviewCount: 6, badges: ["Bestseller"], listedOnDate: daysAgoIso(200) },
    });
    const est = estimateMonthlySales(input);
    expect(est.available).toBe(true);
    expect(est.quantiles!.p10).toBeGreaterThanOrEqual(30);
    expect(est.limitations.join(" ")).toMatch(/badge/i);
  });

  it("active discount widens the revenue band", () => {
    const base = mkInput({
      latest: { reviewCount: 386, price: 19.99, listedOnDate: daysAgoIso(143) },
      history: snapshotsOver(37, 2.7),
    });
    const discounted = mkInput({
      latest: { reviewCount: 386, price: 15.0, originalPrice: 30.0, listedOnDate: daysAgoIso(143) },
      history: snapshotsOver(37, 2.7),
    });
    const monthlyBase = estimateMonthlySales(base);
    const monthlyDisc = estimateMonthlySales(discounted);
    const rBase = estimateMonthlyRevenue(base, monthlyBase);
    const rDisc = estimateMonthlyRevenue(discounted, monthlyDisc);
    const wBase = rBase.quantiles!.p90 / Math.max(1, rBase.quantiles!.p10);
    const wDisc = rDisc.quantiles!.p90 / Math.max(1, rDisc.quantiles!.p10);
    expect(wDisc).toBeGreaterThan(wBase);
    expect(rDisc.evidence.join(" ")).toMatch(/discount/i);
  });
});
