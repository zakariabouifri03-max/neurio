/**
 * React components rendered inside the extension's Shadow DOM.
 * Real data and estimates are rendered from different types on purpose:
 * `analysis.real.*` vs `analysis.estimates.*` — they can never be mixed up.
 */
import React, { useState } from "react";
import type { Analysis, Estimate } from "@etsy-signal/shared";
import { ESTIMATE_DISCLAIMER } from "@etsy-signal/shared";
import { confColor, estText, fmtBand, fmtMoney, fmtNum, scoreColorClass } from "./format.js";

function ScorePill({ label, score, invert }: { label: string; score: Analysis["scores"]["demand"]; invert?: boolean }) {
  const cls = scoreColorClass(score, invert);
  return (
    <div className="es-score" title={score.available ? score.reasons.join("\n") : score.limitations.join("\n")}>
      <b className={cls}>{score.available ? score.value : "—"}</b>
      <span>{label}</span>
    </div>
  );
}

function EstimateRow({ label, est }: { label: string; est: Estimate }) {
  return (
    <div className="es-est-row">
      <span className="es-est-label">{label}</span>
      {est.available && est.quantiles ? (
        <span className="es-est-value" title={`Most likely ~${fmtNum(est.quantiles.p50)}`}>
          {fmtBand(est.unit, est.quantiles.p10, est.quantiles.p90)}
        </span>
      ) : (
        <span className="es-est-value es-unavailable" title={est.unavailableReason}>
          Insufficient data
        </span>
      )}
    </div>
  );
}

export function EvidenceModal({ analysis, onClose }: { analysis: Analysis; onClose: () => void }) {
  const est = analysis.estimates.monthlySales.available ? analysis.estimates.monthlySales : analysis.estimates.sales;
  const conf = Math.max(
    analysis.estimates.sales.confidencePct,
    analysis.estimates.monthlySales.confidencePct,
    analysis.estimates.monthlyRevenue.confidencePct,
  );
  return (
    <div className="es-modal-backdrop" onClick={onClose}>
      <div className="es-modal" onClick={(e) => e.stopPropagation()}>
        <button className="es-close" onClick={onClose}>✕</button>
        <h3>Why this estimate?</h3>
        <div className="es-note">Every number below traces back to a public observation or a documented assumption.</div>

        <h4>Data used</h4>
        <ul>
          {analysis.real.reviewCount != null && <li>✓ {analysis.real.reviewCount} public reviews</li>}
          {analysis.real.trackedDays != null && <li>✓ tracked by Etsy Signal for {analysis.real.trackedDays} days</li>}
          {analysis.real.observationCount > 0 && <li>✓ {analysis.real.observationCount} observations recorded</li>}
          {analysis.real.bestSearchPosition != null && <li>✓ best observed organic rank #{analysis.real.bestSearchPosition}</li>}
          {analysis.real.shopSalesCount != null && <li>✓ shop publicly shows {analysis.real.shopSalesCount.toLocaleString()} sales</li>}
          {analysis.signals.filter((s) => s.signal === "review_velocity").map((s, i) => (
            <li key={i}>✓ review velocity {s.value}/day over {s.period?.replace("_days", "")} days (reliability {s.reliability})</li>
          ))}
          {est.evidence.map((e, i) => (
            <li key={`e${i}`}>{e}</li>
          ))}
        </ul>

        <h4>Model breakdown</h4>
        <table>
          <thead>
            <tr><th>model</th><th>median</th><th>weight</th><th>basis</th></tr>
          </thead>
          <tbody>
            {est.modelBreakdown.map((m, i) => (
              <tr key={i}>
                <td>{m.model}</td>
                <td>{m.modelMedian != null ? fmtNum(m.modelMedian) : "—"}</td>
                <td>{m.weight.toFixed(2)}</td>
                <td className="es-note">{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4>Estimation quality</h4>
        <div>{est.confidenceLevel === "HIGH" ? "Strong" : est.confidenceLevel === "MEDIUM" ? "Moderate" : "Weak"} — confidence {est.confidencePct}%</div>

        <h4>Confidence</h4>
        <div>{conf}%</div>

        <h4>Limitations</h4>
        <ul>
          <li>Actual Etsy sales are not publicly disclosed.</li>
          {est.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SignalPanel({ analysis }: { analysis: Analysis }) {
  const [why, setWhy] = useState(false);
  const r = analysis.real;
  const anyEstimate =
    analysis.estimates.sales.available ||
    analysis.estimates.monthlySales.available ||
    analysis.estimates.monthlyRevenue.available;
  const conf = Math.max(
    analysis.estimates.sales.confidencePct,
    analysis.estimates.monthlySales.confidencePct,
    analysis.estimates.monthlyRevenue.confidencePct,
  );
  const confLevel =
    analysis.estimates.monthlySales.available ? analysis.estimates.monthlySales.confidenceLevel
      : analysis.estimates.sales.available ? analysis.estimates.sales.confidenceLevel
      : "LOW";

  return (
    <div className="es-panel">
      <div className="es-head">
        <span className="es-logo">🔥 Etsy Signal</span>
        {anyEstimate && <span className="es-est-badge">ESTIMATE</span>}
        <span className="es-spacer" />
        <button className="es-why" onClick={() => setWhy(true)}>Why?</button>
      </div>

      <div className="es-real">
        {r.price != null && <span>Price: <b>{fmtMoney(r.price)}</b></span>}
        {r.rating != null && <span>★ <b>{r.rating.toFixed(1)}</b></span>}
        {r.reviewCount != null && <span>Reviews: <b>{r.reviewCount.toLocaleString()}</b></span>}
        {r.badges?.filter((b) => b !== "Ad").map((b) => (
          <span key={b} className="es-tag">🏷 {b}</span>
        ))}
      </div>

      <div className="es-est">
        <EstimateRow label="Est. sales" est={analysis.estimates.sales} />
        <EstimateRow label="Est. monthly" est={analysis.estimates.monthlySales} />
        <EstimateRow label="Est. revenue/mo" est={analysis.estimates.monthlyRevenue} />
      </div>

      <div className="es-scores">
        <ScorePill label="Demand" score={analysis.scores.demand} />
        <ScorePill label="Compet." score={analysis.scores.competition} invert />
        <ScorePill label="Opportunity" score={analysis.scores.opportunity} />
      </div>

      {anyEstimate ? (
        <>
          <div className="es-conf">
            <span className="es-conf-label">Confidence {conf}%</span>
            <div className="es-conf-bar">
              <div className="es-conf-fill" style={{ width: `${conf}%`, background: confColor(confLevel) }} />
            </div>
          </div>
          {r.trackedDays != null && <div className="es-tracked">Tracked for {r.trackedDays} days — confidence grows with history.</div>}
        </>
      ) : (
        <div className="es-tracked">Not enough historical observations yet — keep tracking this listing.</div>
      )}

      <div className="es-disclaimer">Estimates from public signals only — not official Etsy data.</div>
      {why && <EvidenceModal analysis={analysis} onClose={() => setWhy(false)} />}
    </div>
  );
}

export function LoadingPanel() {
  return (
    <div className="es-panel">
      <div className="es-head"><span className="es-logo">🔥 Etsy Signal</span></div>
      <div className="es-loading">Analyzing public signals…</div>
    </div>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="es-panel">
      <div className="es-head"><span className="es-logo">🔥 Etsy Signal</span></div>
      <div className="es-error">⚠ {message}</div>
      <div className="es-disclaimer">Check that the Etsy Signal backend is running (see popup → settings).</div>
    </div>
  );
}

function Sparkline({ points }: { points: (number | null)[] }) {
  const vals = points.filter((p): p is number => p != null);
  if (vals.length < 2) return <div className="es-note">Not enough historical observations.</div>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const W = 340;
  const H = 56;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 6 - ((v - min) / Math.max(1, max - min)) * (H - 12);
  let d = "";
  points.forEach((p, i) => {
    if (p == null) return;
    d += (d === "" ? "M" : "L") + `${x(i).toFixed(1)},${y(p).toFixed(1)} `;
  });
  return (
    <svg className="es-spark" viewBox={`0 0 ${W} ${H}`}>
      <path d={d} fill="none" stroke="var(--es-green)" strokeWidth="2" />
    </svg>
  );
}

export function DetailDrawer({ analysis, history, onClose }: {
  analysis: Analysis;
  history: { observedAt: string; reviewCount: number | null; searchPosition: number | null }[];
  onClose: () => void;
}) {
  const r = analysis.real;
  const opp = analysis.scores.opportunity;
  return (
    <div className="es-drawer">
      <button className="es-why es-drawer-close" onClick={onClose}>✕ Close</button>
      <h2>🔥 Etsy Signal</h2>
      <div className="es-note">{r.title ?? `Listing #${analysis.listingId}`}</div>

      <h4>Overview — real data</h4>
      <div className="es-kv">
        <span className="k">Price</span><span className="v">{r.price != null ? fmtMoney(r.price) : "—"}</span>
        <span className="k">Rating</span><span className="v">{r.rating != null ? `${r.rating.toFixed(1)} ★` : "—"}</span>
        <span className="k">Reviews</span><span className="v">{r.reviewCount != null ? r.reviewCount.toLocaleString() : "—"}</span>
        <span className="k">Shop</span><span className="v">{r.shopName ?? "—"}</span>
        <span className="k">Shop sales (public)</span><span className="v">{r.shopSalesCount != null ? r.shopSalesCount.toLocaleString() : "—"}</span>
        <span className="k">Shop reviews (public)</span><span className="v">{r.shopReviewCount != null ? r.shopReviewCount.toLocaleString() : "—"}</span>
        <span className="k">Best rank seen</span><span className="v">{r.bestSearchPosition != null ? `#${r.bestSearchPosition}` : "—"}</span>
        <span className="k">Tracked</span><span className="v">{r.trackedDays != null ? `${r.trackedDays} days` : "just started"}</span>
      </div>
      {r.badges && r.badges.length > 0 && (
        <div className="es-pill-row">{r.badges.map((b) => <span key={b} className="es-pill">{b}</span>)}</div>
      )}

      <h4>Sales intelligence — estimates</h4>
      <div className="es-kv">
        <span className="k">Est. sales (lifetime)</span><span className="v">{estText(analysis.estimates.sales)}</span>
        <span className="k">Est. monthly sales</span><span className="v">{estText(analysis.estimates.monthlySales)}</span>
        <span className="k">Est. monthly revenue</span><span className="v">{estText(analysis.estimates.monthlyRevenue)}</span>
        <span className="k">Confidence</span>
        <span className="v">{Math.max(analysis.estimates.sales.confidencePct, analysis.estimates.monthlySales.confidencePct)}%</span>
      </div>

      <h4>Demand</h4>
      <div className="es-kv">
        <span className="k">Demand score</span><span className="v">{analysis.scores.demand.available ? `${analysis.scores.demand.value}/100` : "Insufficient public data"}</span>
        <span className="k">Trend</span><span className="v">{analysis.scores.trend.trend}</span>
      </div>

      <h4>Competition</h4>
      <div className="es-kv">
        <span className="k">Competition</span>
        <span className="v">{analysis.scores.competition.available ? `${analysis.scores.competition.value}/100 · ${analysis.scores.competition.interpretation}` : "Observe on a search page"}</span>
      </div>

      <h4>Opportunity</h4>
      <div className="es-kv">
        <span className="k">Opportunity</span><span className="v">{opp.available ? `${opp.value}/100` : "Insufficient evidence"}</span>
      </div>
      <ul>
        {opp.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
        {opp.limitations.map((l, i) => <li key={`l${i}`}>⚠ {l}</li>)}
      </ul>

      <h4>History (observed by you)</h4>
      <Sparkline points={history.map((h) => h.reviewCount)} />
      <div className="es-note">Review count across {history.length} observations.</div>

      <h4>Evidence</h4>
      <table style={{ width: "100%", fontSize: 11 }}>
        <thead><tr><th>signal</th><th>value</th><th>source</th><th>reliability</th></tr></thead>
        <tbody>
          {analysis.signals.map((s, i) => (
            <tr key={i}>
              <td>{s.signal}</td>
              <td>{s.value} {s.unit}</td>
              <td className="es-note">{s.source}</td>
              <td>{s.reliability.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="es-disclaimer" style={{ marginTop: 12 }}>{ESTIMATE_DISCLAIMER}</div>
    </div>
  );
}
