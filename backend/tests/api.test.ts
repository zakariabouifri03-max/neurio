import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Analysis } from "@etsy-signal/shared";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/memoryStore.js";

const NOW = "2026-10-06T12:00:00.000Z";
const day = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

function obs(n: number, patch: Record<string, unknown> = {}) {
  return {
    listingId: "222222",
    observedAt: day(n),
    surface: "search_card",
    searchQuery: "halloween shirt",
    price: 19.99,
    rating: 4.8,
    title: "Halloween Shirt Pumpkin",
    url: "https://www.etsy.com/listing/222222/halloween-shirt-pumpkin",
    ...patch,
  };
}

describe("backend API", () => {
  let app: FastifyInstance;
  let store: MemoryStore;

  beforeAll(async () => {
    store = new MemoryStore();
    app = await buildApp({ store, now: () => NOW });
  });
  afterAll(async () => {
    await app.close();
    await store.close();
  });

  it("GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("rejects malformed ingest payloads", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/observations", payload: { nope: true } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid observations but accepts valid ones", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: {
        observations: [
          { listingId: "abc", observedAt: day(30), surface: "search_card" }, // bad id
          { listingId: "222222", observedAt: "not-a-date", surface: "search_card" }, // bad date
          { listingId: "222222", observedAt: day(30), surface: "search_card", reviewCount: -5 }, // negative
          obs(30, { reviewCount: 380, searchPosition: 24 }),
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(3);
    expect(body.reasons.length).toBeGreaterThan(0);
  });

  it("builds a timeline and computes an analysis from it", async () => {
    // Simulated DAY 7 / DAY 14 / DAY 30 tracking observations.
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: {
        observations: [
          obs(23, { reviewCount: 394, searchPosition: 17 }),
          obs(16, { reviewCount: 417, searchPosition: 11 }),
          obs(0, { reviewCount: 451, searchPosition: 8, favoritesCount: 120 }),
        ],
      },
    });

    const meta = await app.inject({ method: "GET", url: "/v1/listings/222222" });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().listing.observationCount).toBe(4);

    const hist = await app.inject({ method: "GET", url: "/v1/listings/222222/history" });
    const snaps = hist.json().snapshots;
    expect(snaps.map((s: { reviewCount: number }) => s.reviewCount)).toEqual([380, 394, 417, 451]);

    const res = await app.inject({ method: "GET", url: "/v1/listings/222222/analysis" });
    expect(res.statusCode).toBe(200);
    const analysis: Analysis = res.json();

    // Real data is passed through untouched.
    expect(analysis.real.reviewCount).toBe(451);
    expect(analysis.real.price).toBe(19.99);
    expect(analysis.real.trackedDays).toBe(30);
    expect(analysis.real.bestSearchPosition).toBe(8);

    // Historical tracking produced a real velocity signal.
    const vel = analysis.signals.find((s) => s.signal === "review_velocity");
    expect(vel).toBeTruthy();
    expect(vel!.value).toBeGreaterThan(1.5); // (451-380)/30 ≈ 2.37 reviews/day
    expect(vel!.source).toBe("extension_history");

    // Monthly sales estimate exists and is a labelled range.
    const monthly = analysis.estimates.monthlySales;
    expect(monthly.available).toBe(true);
    expect(monthly.quantiles!.p10).toBeLessThan(monthly.quantiles!.p90);
    expect(monthly.limitations.join(" ")).toMatch(/estimate|not official/i);

    // Revenue derived from observed price.
    expect(analysis.estimates.monthlyRevenue.available).toBe(true);

    // Demand/competition/opportunity come from the real SERP cohort.
    expect(analysis.scores.demand.available).toBe(true);
    expect(analysis.scores.opportunity.available).toBe(true);
  });

  it("competition scoring uses peers observed on the same query", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/observations",
      payload: {
        observations: [
          obs(0, { listingId: "900001", reviewCount: 20, searchPosition: 9 }),
          obs(0, { listingId: "900002", reviewCount: 640, searchPosition: 10 }),
          obs(0, { listingId: "900003", reviewCount: 85, searchPosition: 11 }),
        ],
      },
    });
    const res = await app.inject({ method: "GET", url: "/v1/listings/222222/analysis" });
    const analysis: Analysis = res.json();
    expect(analysis.scores.competition.available).toBe(true);
    expect(analysis.scores.competition.value!).toBeGreaterThanOrEqual(0);
    expect(analysis.scores.competition.value!).toBeLessThanOrEqual(100);
  });

  it("404s for untracked listings", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/listings/000000/analysis" });
    expect(res.statusCode).toBe(404);
  });

  it("lists tracked listings", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/listings" });
    const ids = res.json().listings.map((l: { listingId: string }) => l.listingId);
    expect(ids).toContain("222222");
  });
});
