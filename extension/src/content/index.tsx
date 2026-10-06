/**
 * Etsy Signal content script bootstrap.
 *
 * Detects search pages vs listing pages, extracts only public on-page data,
 * ingests it through the background worker, and renders analysis panels.
 * Designed to never crash on layout changes: every step is guarded.
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Analysis } from "@etsy-signal/shared";
import type { ExtractedCard } from "@etsy-signal/signal-engine";
import { extractListingPage, scanSearchPage } from "@etsy-signal/signal-engine";
import { EXTENSION_CSS } from "./styles.js";
import { DetailDrawer, ErrorPanel, LoadingPanel, SignalPanel } from "./components.js";
import { fetchAnalysis, fetchHistory, ingestObservations } from "./api.js";

const AUTO_ANALYZE_CAP = 12; // visible-first; more via "Analyze more"
const BATCH_SIZE = 6;

function makeShadowHost(idSuffix: string): { host: HTMLDivElement; container: HTMLDivElement } {
  const host = document.createElement("div");
  host.id = `etsy-signal-${idSuffix}`;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = EXTENSION_CSS;
  const container = document.createElement("div");
  container.className = "es-root";
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  if (mq?.matches) container.classList.add("es-light");
  shadow.appendChild(style);
  shadow.appendChild(container);
  document.body.appendChild(host);
  return { host, container };
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

type SortMode = "none" | "opportunity" | "growth" | "revenue" | "low_competition" | "demand" | "new_rising";

interface ToolbarState {
  analyzed: number;
  total: number;
  busy: boolean;
  remaining: number;
  sort: SortMode;
}

class SearchController {
  private cards = new Map<string, { el: Element; extracted?: ExtractedCard; analysis?: Analysis; panelRoot?: Root; panelHost?: HTMLDivElement }>();
  private order: string[] = []; // original DOM order for reset
  private analyzedCount = 0;
  private busy = false;
  private toolbarRoot?: Root;
  private toolbarState: ToolbarState = { analyzed: 0, total: 0, busy: false, remaining: 0, sort: "none" };
  private observer?: IntersectionObserver;
  private visibleQueue: string[] = [];
  private autoBudget = AUTO_ANALYZE_CAP;

  start(): void {
    this.scan();
    this.mountToolbar();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.etsySignalId;
          if (!id) continue;
          if (e.isIntersecting && !this.visibleQueue.includes(id)) this.visibleQueue.push(id);
        }
        if (this.autoBudget > 0 && this.visibleQueue.length > 0) {
          void this.analyzeNext(Math.min(BATCH_SIZE, this.autoBudget), true);
        }
      },
      { rootMargin: "220px" },
    );
    for (const [id, c] of this.cards) {
      (c.el as HTMLElement).dataset.etsySignalId = id;
      this.observer.observe(c.el);
    }
    // Auto-analyze whatever is already visible.
    void this.analyzeNext(Math.min(BATCH_SIZE, this.autoBudget), true);
  }

  /** Detect (new) cards on the page. Idempotent. */
  scan(): void {
    try {
      const result = scanSearchPage(document, { observedAt: new Date().toISOString(), maxCards: 120 });
      const cardEls = new Map<string, Element>();
      for (const container of Array.from(document.querySelectorAll("ol[data-search-results] > li, ol[data-search-results] > div, li"))) {
        const a = container.querySelector('a[href*="/listing/"]');
        const m = a?.getAttribute("href")?.match(/\/listing\/(\d+)/);
        if (m?.[1] && !cardEls.has(m[1])) cardEls.set(m[1], container);
      }
      for (const card of result.cards) {
        const id = card.observation.listingId;
        if (this.cards.has(id)) continue;
        const el = cardEls.get(id);
        if (!el) continue;
        this.cards.set(id, { el, extracted: card });
        if (!this.order.includes(id)) this.order.push(id);
        if (this.observer) {
          (el as HTMLElement).dataset.etsySignalId = id;
          this.observer.observe(el);
        }
      }
      this.pushToolbar();
    } catch (err) {
      console.warn("[EtsySignal] scan failed", err);
    }
  }

  private mountToolbar(): void {
    const { container } = makeShadowHost("toolbar");
    this.toolbarRoot = createRoot(container);
    this.pushToolbar();
  }

  private pushToolbar(): void {
    if (!this.toolbarRoot) return;
    this.toolbarState = { ...this.toolbarState, analyzed: this.analyzedCount, total: this.cards.size, remaining: this.unanalyzedIds().length };
    this.toolbarRoot.render(
      <Toolbar
        state={this.toolbarState}
        onAnalyze={() => void this.analyzeNext(BATCH_SIZE, false)}
        onMore={() => void this.analyzeNext(BATCH_SIZE, false)}
        onSort={(mode) => this.applySort(mode)}
      />,
    );
  }

  private unanalyzedIds(): string[] {
    return [...this.cards.entries()].filter(([, c]) => !c.analysis && !c.panelRoot).map(([id]) => id);
  }

  /** Analyze the next batch (visible-first when auto). */
  async analyzeNext(count: number, auto: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.toolbarState.busy = true;
    this.pushToolbar();
    try {
      let ids: string[] = [];
      if (auto) {
        while (ids.length < count && this.visibleQueue.length > 0) {
          const id = this.visibleQueue.shift()!;
          const c = this.cards.get(id);
          if (c && !c.analysis && !c.panelRoot) ids.push(id);
        }
      }
      if (ids.length < count) {
        for (const id of this.unanalyzedIds()) {
          if (ids.length >= count) break;
          if (!ids.includes(id)) ids.push(id);
        }
      }
      if (ids.length === 0) return;
      if (auto) this.autoBudget -= ids.length;

      // 1) loading panels
      for (const id of ids) this.renderPanel(id, <LoadingPanel />);

      // 2) extract + ingest real observations
      const now = new Date().toISOString();
      const observations = [];
      for (const id of ids) {
        const entry = this.cards.get(id)!;
        let extracted = entry.extracted;
        if (!extracted) {
          const rescan = scanSearchPage(document, { observedAt: now, maxCards: 120 });
          extracted = rescan.cards.find((c) => c.observation.listingId === id);
        }
        if (extracted) {
          entry.extracted = extracted;
          observations.push(extracted.observation);
        }
      }
      const ingested = await ingestObservations(observations);
      if (!ingested) {
        for (const id of ids) this.renderPanel(id, <ErrorPanel message="Backend unreachable" />);
        return;
      }

      // 3) fetch analyses
      for (const id of ids) {
        const analysis = await fetchAnalysis(id);
        const entry = this.cards.get(id)!;
        if (analysis) {
          entry.analysis = analysis;
          this.analyzedCount++;
          this.renderPanel(id, <SignalPanel analysis={analysis} />);
        } else {
          this.renderPanel(id, <ErrorPanel message="No analysis returned" />);
        }
        this.pushToolbar();
      }
    } catch (err) {
      console.warn("[EtsySignal] analyze failed", err);
    } finally {
      this.busy = false;
      this.toolbarState.busy = false;
      this.pushToolbar();
    }
  }

  private renderPanel(id: string, node: React.ReactNode): void {
    const entry = this.cards.get(id);
    if (!entry) return;
    try {
      if (!entry.panelHost) {
        entry.panelHost = document.createElement("div");
        entry.panelHost.setAttribute("data-etsy-signal-panel", "1");
        entry.el.appendChild(entry.panelHost);
        entry.panelRoot = createRoot(entry.panelHost);
      }
      entry.panelRoot.render(node);
    } catch (err) {
      console.warn("[EtsySignal] panel render failed", id, err);
    }
  }

  private metricValue(id: string, mode: SortMode): number | null {
    const a = this.cards.get(id)?.analysis;
    if (!a) return null;
    switch (mode) {
      case "opportunity":
        return a.scores.opportunity.available ? a.scores.opportunity.value : null;
      case "growth":
        return a.scores.trend.available ? a.scores.trend.value : null;
      case "revenue":
        return a.estimates.monthlyRevenue.available ? a.estimates.monthlyRevenue.quantiles!.p50 : null;
      case "low_competition":
        return a.scores.competition.available ? 100 - a.scores.competition.value! : null;
      case "demand":
        return a.scores.demand.available ? a.scores.demand.value : null;
      case "new_rising": {
        if (!a.scores.trend.available || a.scores.trend.trend !== "rising") return null;
        const days = a.real.trackedDays ?? 0;
        return days <= 30 ? 100 - days : null;
      }
      default:
        return null;
    }
  }

  applySort(mode: SortMode): void {
    this.toolbarState.sort = mode;
    this.pushToolbar();
    const entries = [...this.cards.entries()].filter(([, c]) => c.el.isConnected);
    if (mode === "none") {
      // Restore original order.
      const sorted = entries.sort((a, b) => this.order.indexOf(a[0]) - this.order.indexOf(b[0]));
      const parent = sorted[0]?.[1].el.parentElement;
      if (parent) for (const [, c] of sorted) parent.appendChild(c.el);
      return;
    }
    const withScore = entries.map(([id, c]) => ({ id, c, v: this.metricValue(id, mode) }));
    withScore.sort((a, b) => {
      if (a.v == null && b.v == null) return 0;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      return b.v - a.v;
    });
    const parent = withScore[0]?.c.el.parentElement;
    if (parent) for (const { c } of withScore) parent.appendChild(c.el);
  }
}

function Toolbar({ state, onAnalyze, onMore, onSort }: {
  state: ToolbarState;
  onAnalyze: () => void;
  onMore: () => void;
  onSort: (m: SortMode) => void;
}) {
  return (
    <div className="es-toolbar">
      <button className="es-btn" onClick={onAnalyze} disabled={state.busy}>
        ⚡ Analyze Page
      </button>
      {state.remaining > 0 && (
        <button className="es-btn es-secondary" onClick={onMore} disabled={state.busy}>
          Analyze more ({state.remaining})
        </button>
      )}
      <select className="es-select" value={state.sort} onChange={(e) => onSort(e.target.value as SortMode)}>
        <option value="none">Sort: Etsy default</option>
        <option value="opportunity">🔥 Best Opportunity</option>
        <option value="growth">📈 Fastest Growing</option>
        <option value="revenue">💰 Highest Revenue Potential</option>
        <option value="low_competition">🥊 Lowest Competition</option>
        <option value="demand">⭐ Strongest Demand</option>
        <option value="new_rising">🆕 New Rising Products</option>
      </select>
      <span className="es-status">
        {state.busy ? "Analyzing…" : `Products analyzed: ${state.analyzed}${state.total ? ` / ${state.total} visible` : ""}`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Listing-page controller
// ---------------------------------------------------------------------------

class ListingController {
  private drawerRoot?: Root;

  async start(): Promise<void> {
    const extracted = extractListingPage(document, location.href, new Date().toISOString());
    if (!extracted) return;
    const { host, container } = makeShadowHost("drawer");
    this.drawerRoot = createRoot(container);
    const render = (node: React.ReactNode) => this.drawerRoot?.render(node);
    render(<div className="es-drawer"><div className="es-loading">Analyzing public signals…</div></div>);

    const ok = await ingestObservations([extracted.observation]);
    if (!ok) {
      render(<div className="es-drawer"><div className="es-error">⚠ Backend unreachable — start the Etsy Signal backend (see popup).</div></div>);
      return;
    }
    const analysis = await fetchAnalysis(extracted.observation.listingId);
    if (!analysis) {
      render(<div className="es-drawer"><div className="es-error">⚠ Analysis unavailable.</div></div>);
      return;
    }
    const history = await fetchHistory(extracted.observation.listingId);
    render(
      <DetailDrawer
        analysis={analysis}
        history={history?.snapshots ?? []}
        onClose={() => host.remove()}
      />,
    );
  }
}

// ---------------------------------------------------------------------------
// Bootstrap + SPA navigation handling
// ---------------------------------------------------------------------------

let activeSearch: SearchController | null = null;
let activeListing: ListingController | null = null;
let lastKey = "";

function pageKey(): string {
  return location.pathname + location.search;
}

function isListingPage(): boolean {
  return /\/listing\/\d+/.test(location.pathname);
}
function isSearchPage(): boolean {
  return location.pathname.includes("/search") || document.querySelector("ol[data-search-results]") != null;
}

function boot(): void {
  try {
    if (isListingPage()) {
      activeListing = new ListingController();
      void activeListing.start();
    } else if (isSearchPage()) {
      activeSearch = new SearchController();
      activeSearch.start();
    }
  } catch (err) {
    console.warn("[EtsySignal] boot error (non-fatal)", err);
  }
}

function teardown(): void {
  document.querySelectorAll('[id^="etsy-signal-"]').forEach((el) => el.remove());
  activeSearch = null;
  activeListing = null;
}

// Etsy is largely an SPA: watch URL + DOM without hammering the page.
setInterval(() => {
  try {
    const key = pageKey();
    if (key !== lastKey) {
      lastKey = key;
      teardown();
      setTimeout(boot, 600);
    } else if (activeSearch) {
      activeSearch.scan();
    }
  } catch {
    /* never crash the page */
  }
}, 1500);

let mutationTimer: number | undefined;
const mo = new MutationObserver(() => {
  if (mutationTimer) return;
  mutationTimer = window.setTimeout(() => {
    mutationTimer = undefined;
    try {
      if (activeSearch) activeSearch.scan();
    } catch {
      /* ignore */
    }
  }, 800);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    lastKey = pageKey();
    boot();
    mo.observe(document.body, { childList: true, subtree: true });
  });
} else {
  lastKey = pageKey();
  boot();
  if (document.body) mo.observe(document.body, { childList: true, subtree: true });
}
