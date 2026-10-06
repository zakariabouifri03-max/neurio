/**
 * Popup: settings, tracked listings, side-by-side comparison, history chart.
 * All data comes from the backend via the background worker — nothing here
 * fabricates metrics.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Analysis } from "@etsy-signal/shared";
import { fetchAnalysis, fetchHistory, ingestObservations } from "../content/api.js";
import { sendMessage, type HistoryResponse, type ListingsResponse } from "../common/messages.js";

type Tab = "tracked" | "compare" | "settings";

type ListingMeta = ListingsResponse["listings"][number];

export function App() {
  const [tab, setTab] = useState<Tab>("tracked");
  const [apiUrl, setApiUrl] = useState("http://localhost:8787");
  const [mode, setMode] = useState<"local" | "backend">("local");
  const [health, setHealth] = useState<"unknown" | "ok" | "down">("unknown");
  const [listings, setListings] = useState<ListingMeta[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, Analysis | null>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<ListingMeta | null>(null);

  useEffect(() => {
    void (async () => {
      const cfg = await sendMessage({ type: "config:get" });
      if (cfg.ok) {
        setApiUrl(cfg.data.apiUrl);
        setMode(cfg.data.mode);
      }
      await refreshListings();
      void checkHealth();
    })();
  }, []);

  async function checkHealth() {
    const res = await sendMessage({ type: "health" });
    setHealth(res.ok ? "ok" : "down");
  }

  async function refreshListings() {
    const res = await sendMessage({ type: "listings" });
    if (res.ok) setListings((res.data as ListingsResponse).listings);
  }

  async function ensureAnalysis(id: string): Promise<Analysis | null> {
    if (analyses[id] !== undefined) return analyses[id];
    const a = await fetchAnalysis(id);
    setAnalyses((prev) => ({ ...prev, [id]: a }));
    return a;
  }

  async function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
    void ensureAnalysis(id);
  }

  const compareAnalyses = useMemo(
    () => selected.map((id) => ({ id, a: analyses[id] ?? null })),
    [selected, analyses],
  );

  return (
    <div>
      <header>
        <h1>🔥 Etsy Signal</h1>
        <span className={`chip ${health === "ok" ? "good" : health === "down" ? "bad" : "na"}`}>
          {health === "ok"
            ? mode === "local"
              ? "local mode ✓"
              : "backend online"
            : health === "down"
              ? mode === "local"
                ? "error"
                : "backend offline"
              : "…"}
        </span>
      </header>

      <nav className="tabs">
        <button className={tab === "tracked" ? "active" : ""} onClick={() => setTab("tracked")}>Tracked ({listings.length})</button>
        <button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>Compare ({selected.length})</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings</button>
      </nav>

      <div className="content">
        {tab === "tracked" && (
          <TrackedList
            listings={listings}
            analyses={analyses}
            onOpen={(l) => {
              setDetail(l);
              void ensureAnalysis(l.listingId);
            }}
            onRefresh={refreshListings}
          />
        )}
        {tab === "compare" && <CompareView rows={compareAnalyses} />}
        {tab === "settings" && (
          <SettingsView
            apiUrl={apiUrl}
            setApiUrl={setApiUrl}
            mode={mode}
            onModeChange={async (m) => {
              await sendMessage({ type: "config:set", mode: m });
              setMode(m);
              void refreshListings();
              void checkHealth();
            }}
            onTest={checkHealth}
            health={health}
          />
        )}
      </div>

      {detail && (
        <DetailOverlay
          meta={detail}
          analysis={analyses[detail.listingId] ?? null}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function TrackedList({ listings, analyses, onOpen, onRefresh }: {
  listings: ListingMeta[];
  analyses: Record<string, Analysis | null>;
  onOpen: (l: ListingMeta) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="muted">Listings Etsy Signal has observed on pages you visited.</span>
        <button className="ghost" onClick={() => void onRefresh()}>↻</button>
      </div>
      {listings.length === 0 && (
        <div className="muted">
          Nothing tracked yet. Open etsy.com, search for a product, and the extension will
          record what it sees and show panels on each listing.
        </div>
      )}
      {listings.map((l) => {
        const a = analyses[l.listingId];
        return (
          <div key={l.listingId} className="row" onClick={() => onOpen(l)}>
            <div className="title">
              <b>{l.title ?? `Listing #${l.listingId}`}</b>
              <span>
                {l.shopName ? `${l.shopName} · ` : ""}seen {new Date(l.lastSeenAt).toLocaleDateString()} · {l.observationCount} obs
              </span>
            </div>
            {a?.scores.opportunity.available ? (
              <span className="chip good">Opp {a.scores.opportunity.value}</span>
            ) : (
              <span className="chip na">Opp —</span>
            )}
            {a?.real.trackedDays ? <span className="chip">📅 {a.real.trackedDays}d</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function CompareView({ rows }: { rows: { id: string; a: Analysis | null }[] }) {
  if (rows.length === 0) {
    return <div className="muted">Open listings from the Tracked tab to select up to 4 for comparison.</div>;
  }
  const metric = (label: string, get: (a: Analysis) => string, estimated: boolean) => (
    <tr key={label}>
      <th>{label}{estimated && <span className="est-flag">EST</span>}</th>
      {rows.map(({ id, a }) => (
        <td key={id}>{a ? get(a) : "…"}</td>
      ))}
    </tr>
  );
  return (
    <table className="compare">
      <thead>
        <tr>
          <th>metric</th>
          {rows.map(({ id, a }) => (
            <th key={id} title={a?.real.title ?? id}>{id}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {metric("Price", (a) => (a.real.price != null ? `$${a.real.price}` : "—"), false)}
        {metric("Rating", (a) => (a.real.rating != null ? `${a.real.rating.toFixed(1)}★` : "—"), false)}
        {metric("Reviews", (a) => (a.real.reviewCount != null ? a.real.reviewCount.toLocaleString() : "—"), false)}
        {metric(
          "Est. monthly sales",
          (a) => (a.estimates.monthlySales.available ? `${a.estimates.monthlySales.quantiles!.p10}–${a.estimates.monthlySales.quantiles!.p90}` : "insufficient data"),
          true,
        )}
        {metric(
          "Est. monthly revenue",
          (a) => (a.estimates.monthlyRevenue.available ? `$${a.estimates.monthlyRevenue.quantiles!.p10.toLocaleString()}–$${a.estimates.monthlyRevenue.quantiles!.p90.toLocaleString()}` : "unavailable"),
          true,
        )}
        {metric("Demand", (a) => (a.scores.demand.available ? `${a.scores.demand.value}/100` : "—"), true)}
        {metric("Competition", (a) => (a.scores.competition.available ? `${a.scores.competition.value}/100` : "—"), true)}
        {metric("Opportunity", (a) => (a.scores.opportunity.available ? `${a.scores.opportunity.value}/100` : "—"), true)}
        {metric("Confidence", (a) => `${Math.max(a.estimates.sales.confidencePct, a.estimates.monthlySales.confidencePct)}%`, true)}
        {metric("Tracked", (a) => (a.real.trackedDays != null ? `${a.real.trackedDays} days` : "just started"), false)}
      </tbody>
    </table>
  );
}

function SettingsView({ apiUrl, setApiUrl, mode, onModeChange, onTest, health }: {
  apiUrl: string;
  setApiUrl: (v: string) => void;
  mode: "local" | "backend";
  onModeChange: (m: "local" | "backend") => Promise<void>;
  onTest: () => Promise<void>;
  health: "unknown" | "ok" | "down";
}) {
  const [local, setLocal] = useState(apiUrl);
  const [saved, setSaved] = useState(false);
  useEffect(() => setLocal(apiUrl), [apiUrl]);
  return (
    <div>
      <div className="section">
        <h3>Data mode</h3>
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="radio" checked={mode === "local"} onChange={() => void onModeChange("local")} />
          <div className="title">
            <b>🖥 Local (recommended)</b>
            <span>The analysis engine runs inside your browser; history is stored in your browser only. Zero setup — works immediately.</span>
          </div>
        </label>
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="radio" checked={mode === "backend"} onChange={() => void onModeChange("backend")} />
          <div className="title">
            <b>🌐 Self-hosted backend</b>
            <span>Durable PostgreSQL history on your own server (see repo docs).</span>
          </div>
        </label>
      </div>

      {mode === "backend" && (
        <div className="section">
          <h3>Backend API</h3>
          <input type="url" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="http://localhost:8787" />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              className="primary"
              onClick={async () => {
                await sendMessage({ type: "config:set", apiUrl: local });
                setSaved(true);
                setTimeout(() => setSaved(false), 1500);
                void onTest();
              }}
            >
              {saved ? "Saved ✓" : "Save & test"}
            </button>
            <button className="ghost" onClick={() => void onTest()}>Test connection</button>
          </div>
          <p className="muted">
            Status: {health === "ok" ? "✅ connected" : health === "down" ? "❌ unreachable — start the backend (see README)" : "checking…"}
          </p>
        </div>
      )}

      <div className="section">
        <h3>Privacy & honesty</h3>
        <p className="muted">
          Etsy Signal only reads public listing information rendered by your own browser. In local mode
          everything stays inside your browser; in backend mode it goes only to your own server.
          Every estimate is clearly labelled, and the extension would rather show “Insufficient data”
          than invent a number.
        </p>
      </div>
    </div>
  );
}

function DetailOverlay({ meta, analysis, onClose }: { meta: ListingMeta; analysis: Analysis | null; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "94%", maxHeight: "92vh", overflow: "auto", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 8 }}>
          <b style={{ flex: 1 }}>{meta.title ?? `Listing #${meta.listingId}`}</b>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <a className="muted" href={meta.url ?? `https://www.etsy.com/listing/${meta.listingId}`} target="_blank" rel="noreferrer">
          open on Etsy ↗
        </a>
        {!analysis && <p className="muted">Loading analysis…</p>}
        {analysis && (
          <>
            <div className="section">
              <h3>Estimates</h3>
              <p className="muted">
                Lifetime sales: {fmtEst(analysis.estimates.sales)} · Monthly: {fmtEst(analysis.estimates.monthlySales)} · Revenue/mo: {fmtEst(analysis.estimates.monthlyRevenue)}
              </p>
              <p className="muted">
                Demand {analysis.scores.demand.available ? analysis.scores.demand.value : "—"} · Competition {analysis.scores.competition.available ? analysis.scores.competition.value : "—"} · Opportunity {analysis.scores.opportunity.available ? analysis.scores.opportunity.value : "—"} · Confidence {Math.max(analysis.estimates.sales.confidencePct, analysis.estimates.monthlySales.confidencePct)}%
              </p>
            </div>
            <HistoryChart listingId={meta.listingId} />
          </>
        )}
      </div>
    </div>
  );
}

function fmtEst(e: Analysis["estimates"]["sales"]): string {
  if (!e.available || !e.quantiles) return "insufficient data";
  const f = (v: number) => (e.unit === "USD" ? `$${v.toLocaleString()}` : v.toLocaleString());
  return `${f(e.quantiles.p10)}–${f(e.quantiles.p90)}`;
}

function HistoryChart({ listingId }: { listingId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<HistoryResponse | null>(null);

  useEffect(() => {
    void fetchHistory(listingId).then(setData);
  }, [listingId]);

  useEffect(() => {
    if (!data || !ref.current) return;
    const snaps = data.snapshots.filter((s) => s.reviewCount != null);
    if (snaps.length < 2) return;
    const xs = snaps.map((s) => Date.parse(s.observedAt) / 1000);
    const ys = snaps.map((s) => s.reviewCount);
    const chart = new uPlot(
      {
        width: 440,
        height: 160,
        series: [{}, { label: "reviews", stroke: "#22c55e", width: 2 }],
        axes: [{ stroke: "#94a3b8", grid: { stroke: "#33415522" } }, { stroke: "#94a3b8", grid: { stroke: "#33415522" } }],
        scales: { x: { time: true } },
      },
      [xs, ys],
      ref.current,
    );
    return () => chart.destroy();
  }, [data]);

  if (!data) return null;
  if (data.snapshots.filter((s) => s.reviewCount != null).length < 2) {
    return <p className="muted">Not enough historical observations yet for a chart — keep visiting this listing.</p>;
  }
  return <div className="detail-chart" ref={ref} />;
}
