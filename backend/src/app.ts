/**
 * Fastify app factory. The store is injected so tests run against MemoryStore
 * and production runs against PostgresStore — same routes either way.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { analyze } from "@etsy-signal/estimation-engine";
import type { IngestRequest, IngestResponse, Analysis } from "@etsy-signal/shared";
import { assembleEstimationInput } from "./assemble.js";
import type { SignalStore, StoredObservation } from "./store.js";

const MAX_BATCH = 60;

export interface AppOptions {
  store: SignalStore;
  corsOrigins?: string[];
  now?: () => string; // injectable clock for deterministic tests
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  const now = opts.now ?? (() => new Date().toISOString());

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow extension contexts (chrome-extension://) and configured origins.
      if (!origin || origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) return cb(null, true);
      const ok = (opts.corsOrigins ?? []).some((o) => o === "*" || o === origin || (o.endsWith("*") && origin.startsWith(o.slice(0, -1))));
      cb(null, ok);
    },
  });

  app.get("/health", async () => ({ ok: true, service: "etsy-signal-backend", time: now() }));

  /** Ingest observations captured by the extension. */
  app.post<{ Body: IngestRequest }>("/v1/observations", async (req, reply) => {
    const body = req.body;
    if (!body || !Array.isArray(body.observations)) {
      return reply.code(400).send({ accepted: 0, rejected: 0, reasons: ["body.observations must be an array"] } satisfies IngestResponse);
    }
    const batch = body.observations.slice(0, MAX_BATCH);
    let accepted = 0;
    let rejected = 0;
    const reasons: string[] = [];
    for (const obs of batch) {
      const valid = validateObservation(obs);
      if (!valid.ok) {
        rejected++;
        if (reasons.length < 5) reasons.push(valid.reason);
        continue;
      }
      await opts.store.ingest(obs as StoredObservation);
      accepted++;
    }
    return { accepted, rejected, reasons } satisfies IngestResponse;
  });

  /** All tracked listings (most recently seen first). */
  app.get("/v1/listings", async (req) => {
    const limit = Math.min(200, Number((req.query as Record<string, string>)?.limit ?? 50));
    return { listings: await opts.store.listListings(limit) };
  });

  /** Real data only — no estimates. */
  app.get<{ Params: { id: string } }>("/v1/listings/:id", async (req, reply) => {
    const meta = await opts.store.getListing(req.params.id);
    if (!meta) return reply.code(404).send({ error: "listing not tracked yet" });
    const observations = await opts.store.getObservations(req.params.id);
    return { listing: meta, observations };
  });

  /** Historical snapshots (for charts + auditability). */
  app.get<{ Params: { id: string } }>("/v1/listings/:id/history", async (req, reply) => {
    const observations = await opts.store.getObservations(req.params.id);
    if (observations.length === 0) return reply.code(404).send({ error: "listing not tracked yet" });
    return {
      listingId: req.params.id,
      snapshots: observations.map((o) => ({
        observedAt: o.observedAt,
        reviewCount: o.reviewCount ?? null,
        searchPosition: o.searchPosition ?? null,
        price: o.price ?? null,
        favoritesCount: o.favoritesCount ?? null,
      })),
    };
  });

  /**
   * THE analysis endpoint: runs the deterministic estimation engine over
   * stored observations. Response clearly separates real vs estimated data.
   */
  app.get<{ Params: { id: string } }>("/v1/listings/:id/analysis", async (req, reply) => {
    const assembled = await assembleEstimationInput(opts.store, req.params.id, now());
    if (!assembled) return reply.code(404).send({ error: "listing not tracked yet — ingest an observation first" });
    const analysis: Analysis = analyze(assembled.input);
    return analysis;
  });

  app.setErrorHandler((err, _req, reply) => {
    reply.code(500).send({ error: "internal error", message: err.message });
  });

  return app;
}

function validateObservation(obs: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof obs !== "object" || obs == null) return { ok: false, reason: "observation must be an object" };
  const o = obs as Record<string, unknown>;
  if (typeof o.listingId !== "string" || !/^\d{3,20}$/.test(o.listingId)) return { ok: false, reason: "listingId must be numeric string" };
  if (typeof o.observedAt !== "string" || !Number.isFinite(Date.parse(o.observedAt))) return { ok: false, reason: "observedAt must be ISO date" };
  if (o.surface !== "search_card" && o.surface !== "listing_page" && o.surface !== "etsy_api") return { ok: false, reason: "bad surface" };
  for (const k of ["price", "originalPrice", "rating", "reviewCount", "shopReviewCount", "shopSalesCount", "favoritesCount", "searchPosition", "serpResultCount"]) {
    const v = o[k];
    if (v != null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) return { ok: false, reason: `${k} must be a non-negative number` };
  }
  return { ok: true };
}
