import { describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";
import { scoreDemand, scoreTrend } from "../src/demand.js";
import { scoreCompetition, ESTABLISHED_REVIEW_THRESHOLD } from "../src/competition.js";
import { scoreOpportunity } from "../src/opportunity.js";
import { computeConfidence } from "../src/confidence.js";
import type { SerpInput, SerpPeer } from "../src/input.js";
import { daysAgoIso, mkInput, NOW, snapshotsOver } from "./fixtures.js";

function peers(n: number, opts: { reviews: number; price: number; ads?: number; rating?: number }): SerpPeer[] {
  return Array.from({ length: n }, (_, i) => ({
    listingId: String(9000 + i),
    reviewCount: opts.reviews,
    price: opts.price,
    rating: opts.rating ?? 4.7,
    isAd: i < (opts.ads ?? 0),
  }));
}

function serp(position: number, p: SerpPeer[], resultCount?: number): SerpInput {
  return { query: "halloween shirt", position, visibleResultCount: resultCount, peers: p, appearances: 5, snapshots: 6 };
}

describe("demand score", () => {
  it("scores a strong listing high with named components", () => {
    const input = mkInput({
      latest: { reviewCount: 386, rating: 4.8, favoritesCount: 120, badges: ["Bestseller"] },
      history: snapshotsOver(37, 0.6),
      serp: serp(8, peers(24, { reviews: 40, price: 18 })),
      lastObservedAt: NOW,
    });
    const d = scoreDemand(input);
    expect(d.available).toBe(true);
    expect(d.value!).toBeGreaterThanOrEqual(60);
    expect(d.value!).toBeLessThanOrEqual(100);
    const names = d.components.map((c) => c.name);
    expect(names).toContain("review_velocity");
    expect(names).toContain("search_position");
    expect(names).toContain("badges");
  });

  it("refuses to score without core evidence", () => {
    const input = mkInput({ latest: { reviewCount: undefined, rating: 4.9 } });
    const d = scoreDemand(input);
    expect(d.available).toBe(false);
    expect(d.value).toBeNull();
    expect(d.limitations.join(" ")).toMatch(/insufficient/i);
  });
});

describe("competition score", () => {
  it("LOW competition niche scores below HIGH competition niche", () => {
    const low = scoreCompetition(
      mkInput({ serp: serp(5, peers(20, { reviews: 12, price: 22 }), 350) }),
    );
    const high = scoreCompetition(
      mkInput({ serp: serp(5, peers(48, { reviews: 2_400, price: 9.5, ads: 8 }), 48_000) }),
    );
    expect(low.available).toBe(true);
    expect(high.available).toBe(true);
    expect(high.value!).toBeGreaterThan(low.value!);
    expect(low.interpretation).toMatch(/LOW|MEDIUM/);
    expect(high.interpretation).toBe("HIGH competition");
  });

  it("is unavailable without observed peers", () => {
    const c = scoreCompetition(mkInput({}));
    expect(c.available).toBe(false);
    expect(c.limitations.join(" ")).toMatch(/insufficient/i);
  });

  it("uses a documented threshold for established competitors", () => {
    expect(ESTABLISHED_REVIEW_THRESHOLD).toBe(500);
  });
});

describe("opportunity score", () => {
  it("combines pillars transparently", () => {
    const input = mkInput({
      latest: { reviewCount: 386, rating: 4.8, price: 19.99, badges: ["Bestseller"] },
      history: snapshotsOver(37, 0.6),
      serp: serp(8, peers(24, { reviews: 30, price: 19 })),
      lastObservedAt: NOW,
    });
    const a = analyze(input);
    const opp = a.scores.opportunity;
    expect(opp.available).toBe(true);
    expect(opp.value!).toBeGreaterThan(45);
    expect(opp.components.map((c) => c.name)).toEqual(
      expect.arrayContaining(["demand", "competition_headroom"]),
    );
    expect(opp.reasons.length).toBeGreaterThan(0);
  });

  it("stays unavailable without demand and competition pillars", () => {
    const input = mkInput({ latest: { rating: 4.5, price: 10, reviewCount: undefined } });
    const demand = scoreDemand(input);
    const competition = scoreCompetition(input);
    const trend = scoreTrend(input);
    const opp = scoreOpportunity(input, demand, competition, trend);
    expect(opp.available).toBe(false);
    expect(opp.limitations.join(" ")).toMatch(/insufficient evidence/i);
  });
});

describe("confidence engine", () => {
  it("long tracking + rich signals -> higher confidence with reasons", () => {
    const input = mkInput({
      latest: { reviewCount: 386, rating: 4.8, price: 19.99, listedOnDate: daysAgoIso(143), badges: ["Bestseller"], shopSalesCount: 5000, shopReviewCount: 200 },
      history: snapshotsOver(63, 2.7, { positions: [24, 21, 18, 17, 15, 14, 12, 11, 10, 8] }),
      firstObservedAt: daysAgoIso(63),
      lastObservedAt: NOW,
      serp: serp(8, peers(20, { reviews: 30, price: 19 }), 9000),
    });
    const c = computeConfidence(input, 0.1);
    expect(c.pct).toBeGreaterThanOrEqual(55);
    expect(c.reasons.join("\n")).toMatch(/tracking/i);
    expect(c.components.length).toBe(5);
  });

  it("single fresh snapshot with no history -> LOW or MEDIUM, never HIGH", () => {
    const input = mkInput({
      latest: { reviewCount: 12, price: 15 },
      history: [{ observedAt: NOW, reviewCount: 12 }],
      firstObservedAt: NOW,
      lastObservedAt: NOW,
    });
    const c = computeConfidence(input, 0.6);
    expect(c.pct).toBeLessThan(70);
    expect(c.limitations.join(" ")).toMatch(/tracking/i);
  });

  it("never exceeds 97% (no false certainty)", () => {
    const input = mkInput({
      latest: { reviewCount: 5000, rating: 5, price: 10, listedOnDate: daysAgoIso(300), shopSalesCount: 90000, shopReviewCount: 4000 },
      history: snapshotsOver(200, 16),
      firstObservedAt: daysAgoIso(200),
      lastObservedAt: NOW,
      serp: serp(1, peers(48, { reviews: 500, price: 10 }), 20000),
    });
    expect(computeConfidence(input, 0).pct).toBeLessThanOrEqual(97);
  });
});
