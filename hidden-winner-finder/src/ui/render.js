/**
 * render.js - pure render functions: state in, HTML string out.
 *
 * No DOM access and no side effects, which keeps the UI testable (a Node test can
 * render every section and assert that estimates carry their labels) and lets the
 * preview build reuse the exact markup the extension ships.
 */

import {
  currency, count, compact, estimate, percent, range, score as fmtScore,
  timeAgo, signedPercent, escapeHtml as esc,
} from '../core/format.js';
import { getMarketplace } from '../data/marketplaces.js';
import { CATEGORIES, COUNTRIES, BUDGETS, DATA_SOURCES, DISCLAIMER_TEXT } from '../data/taxonomy.js';
import { SUPPLIER_DUE_DILIGENCE } from '../data/suppliers.js';

/* ─────────────────────────── small pieces ─────────────────────────── */

const tagClassForBasis = (basis) => (basis === 'observed' ? 'observed' : basis === 'snapshot' ? 'snapshot' : 'modelled');
const tagLabelForBasis = (basis) => (basis === 'observed' ? 'Observed on page' : basis === 'snapshot' ? 'Public-data based' : 'Modelled estimate');

export const basisTag = (basis) => `<span class="tag ${tagClassForBasis(basis)}">${esc(tagLabelForBasis(basis))}</span>`;

export const confidenceTag = (level) => {
  const id = String(level || 'Low');
  const cls = id === 'High' ? 'high' : id === 'Medium' ? 'medium' : 'low';
  return `<span class="tag ${cls}" title="Confidence: ${esc(id)}">${esc(id)} confidence</span>`;
};

export const scoreClass = (value, { invert = false } = {}) => {
  if (!Number.isFinite(value)) return '';
  const v = invert ? 100 - value : value;
  return v >= 70 ? 'good' : v >= 45 ? 'warn' : 'bad';
};

export const bar = (value, { invert = false, fire = false } = {}) => {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, invert ? 100 - value : value)) : 0;
  return `<div class="bar ${fire ? 'fire' : ''}"><span style="width:${v.toFixed(1)}%"></span></div>`;
};

export const metricTile = (label, value, sub = '') => `
  <div class="metric-tile">
    <div class="k">${esc(label)}</div>
    <div class="v">${value}</div>
    ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
  </div>`;

export function metricRows(metrics) {
  return `<div class="metric-list">${metrics.map((m) => `
    <div class="metric-row">
      <div class="name">${esc(m.label)}</div>
      <div class="val">${Number.isFinite(m.value) ? `${Math.round(m.value)}/100` : '—'}</div>
      <div class="note">${esc(m.note || '')} ${m.basis ? basisTag(m.basis) : ''}</div>
    </div>`).join('')}</div>`;
}

export function sparkline(values, id = 'spark') {
  const nums = (values || []).filter((v) => Number.isFinite(v));
  if (nums.length < 3) return '';
  const w = 300;
  const h = 46;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = w / (nums.length - 1);
  const points = nums.map((v, i) => [i * step, h - 6 - ((v - min) / span) * (h - 14)]);
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Momentum over the last months">
    <defs><linearGradient id="${esc(id)}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#6ee7b7"/><stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient></defs>
    <path class="area" d="${area}"/>
    <path d="${line}" stroke="url(#${esc(id)})"/>
  </svg>`;
}

export function progressPanel(steps, activeIndex) {
  return `<div class="card"><h3>Working…</h3><div class="progress">
    ${steps.map((step, i) => `
      <div class="progress-step ${i < activeIndex ? 'done' : i === activeIndex ? 'active' : ''}">
        <span class="dot"></span><span>${esc(step)}</span>
      </div>`).join('')}
  </div></div>`;
}

export const emptyState = (icon, title, text) => `
  <div class="empty"><div class="big">${icon}</div><strong>${esc(title)}</strong><p class="note">${esc(text)}</p></div>`;

export const errorBox = (message, hint) => `
  <div class="error-box"><strong>${esc(message)}</strong>${hint ? `<div class="note">${esc(hint)}</div>` : ''}</div>`;

/* ─────────────────────────── controls ─────────────────────────── */

export function controls(options, mode = 'popup') {
  const select = (id, label, items, value, labelKey = 'label') => `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      <select id="${id}" data-action="option" data-key="${id}">
        ${items.map((item) => `<option value="${esc(item.id)}" ${item.id === value ? 'selected' : ''}>${esc(item[labelKey])}</option>`).join('')}
      </select>
    </div>`;

  return `<div class="controls">
    ${select('marketplaceId', 'Market', [
      { id: 'etsy', label: 'Etsy ▼' }, { id: 'amazon', label: 'Amazon ▼' }, { id: 'ebay', label: 'eBay ▼' },
      { id: 'walmart', label: 'Walmart Marketplace ▼' }, { id: 'tiktok', label: 'TikTok Shop ▼' }, { id: 'shopify', label: 'Own store (Shopify) ▼' },
    ].map((m) => ({ id: m.id, label: m.label.replace(' ▼', '') })), options.marketplaceId)}
    ${select('countryId', 'Country', COUNTRIES.map((c) => ({ id: c.id, label: `${c.flag} ${c.label}` })), options.countryId)}
    ${select('categoryId', 'Category', CATEGORIES.map((c) => ({ id: c.id, label: `${c.icon} ${c.label}` })), options.categoryId)}
    ${select('budgetId', 'Budget', BUDGETS, options.budgetId)}
  </div>`;
}

/* ─────────────────────────── hero / winner ─────────────────────────── */

export function heroCard(row, analysis, { saved = false, mode = 'popup' } = {}) {
  if (!row || !analysis) return emptyState('🔎', 'No winner yet', 'Press FIND MY WINNING PRODUCT to analyse the market.');
  const product = analysis.product;
  const a = analysis;
  const marketplace = getMarketplace(a.marketplace.id);
  const productUrl = marketplace.searchUrl(`${product.name} personalized`);
  const competitorUrl = marketplace.searchUrl(product.name);
  const supplierSearchUrl = `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(product.name)}`;

  return `
  <div class="card hero">
    <div class="badge-hero">🔥 BEST OPPORTUNITY</div>
    <div class="hero-top" style="margin-top:6px">
      <div class="hero-emoji">${esc(product.emoji || '📦')}</div>
      <div style="min-width:0">
        <h2 class="hero-title">${esc(row.product)}</h2>
        <div class="hero-sub">${esc(product.blurb || '')}</div>
        <div class="row tight" style="margin-top:6px">
          ${confidenceTag(a.opportunity.confidence.label)}
          <span class="tag">${esc(marketplace.icon)} ${esc(marketplace.name)}</span>
          ${row.observed ? '<span class="tag observed">Live page observed</span>' : '<span class="tag snapshot">Public-data snapshot</span>'}
        </div>
      </div>
    </div>

    <div class="score-grid">
      ${metricTile('Demand', `${fmtScore(a.demand.score)}`, a.demand.label)}
      ${metricTile('Competition', `${fmtScore(a.competition.score)}`, a.competition.band)}
      ${metricTile('Profit', `${fmtScore(a.opportunity.metrics.find((m) => m.id === 'profit')?.value)}`, a.profit ? `~$${a.profit.unit.estimatedProfit.toFixed(2)}/sale` : '—')}
      ${metricTile('Trend', `${fmtScore(a.trend.score)}`, `${a.trend.band.icon} ${a.trend.band.label}`)}
    </div>

    <div class="kv" style="margin-top:10px">
      <div class="k">Estimated monthly sales <span class="tag snapshot">Public-data based</span></div>
      <div class="v">${a.demand.volume ? `${count(a.demand.volume.nicheUnits.low)} – ${count(a.demand.volume.nicheUnits.high)} units` : '—'}</div>
      <div class="k">Estimated monthly revenue <span class="tag modelled">Estimated</span></div>
      <div class="v">${a.demand.volume?.nicheRevenue ? range(a.demand.volume.nicheRevenue.low, a.demand.volume.nicheRevenue.high, (v) => currency(v, { decimals: 0 })) : '—'}</div>
      <div class="k">Average price</div>
      <div class="v">${esc(currency(a.price))}</div>
      <div class="k">Estimated profit margin</div>
      <div class="v">${a.profit ? esc(percent(a.profit.unit.profitMargin)) : '—'}</div>
      <div class="k">Trend</div>
      <div class="v">${esc(a.trend.band.icon)} ${esc(a.trend.band.label)}</div>
    </div>
    <p class="note">Whole-niche estimates inferred from public review activity (model shown in the demand section) — not counted sales.</p>

    <div class="big-score">
      <div>
        <div class="label">⭐ Opportunity score</div>
        <div class="num">${fmtScore(a.opportunity.score)}</div>
      </div>
      <div style="flex:1">
        ${bar(a.opportunity.score, { fire: true })}
        <div class="out note" style="margin-top:6px">
          ${esc(a.opportunity.label)} · raw ${a.opportunity.rawScore ?? '—'} − ${a.opportunity.adjustments.total} deductions, then ${a.opportunity.confidence.label.toLowerCase()}-confidence shrink
        </div>
      </div>
    </div>

    <div class="verdict ${a.verdict.tone}">
      <strong>${esc(a.verdict.headline)}</strong>${esc(a.verdict.text)}
    </div>

    <div class="row">
      <button class="btn" data-action="open" data-url="${esc(productUrl)}">👁️ View product</button>
      <button class="btn" data-action="tab" data-target="#source">📦 Find suppliers</button>
      <button class="btn" data-action="open" data-url="${esc(competitorUrl)}">🥊 See competitors</button>
      <button class="btn ${saved ? 'ghost' : ''}" data-action="${saved ? 'unsave' : 'save'}"
        data-product-id="${esc(product.id)}" data-name="${esc(row.product)}" data-score="${a.opportunity.score}"
        data-confidence="${esc(a.opportunity.confidence.label)}" data-marketplace="${esc(marketplace.name)}">
        ${saved ? '✅ Saved' : '⭐ Save product'}
      </button>
      ${mode === 'popup' ? '<button class="btn ghost" data-action="dashboard">🔎 Full report</button>' : `
        <button class="btn ghost" data-action="copy-markdown">📋 Copy as Markdown</button>
        <button class="btn ghost" data-action="export-report">⬇️ Export JSON</button>`}
    </div>
    <p class="note" style="margin-top:8px">
      Every figure below is an estimate built from ${a.observedLive ? 'the page you scanned plus published fee schedules' : 'a public-data snapshot plus published fee schedules'}.
      None of it is verified sales data — see the honesty panel.
    </p>
  </div>`;
}

export function alternativesCard(rows) {
  if (!rows?.length) return '';
  return `<div class="card">
    <h3>Runners-up (kept out of the recommendation)</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Product</th><th class="num">Demand</th><th class="num">Comp.</th><th class="num">Trend</th><th class="num">Opportunity</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="rank">#${r.rank}</td>
          <td>${esc(r.product)}<div class="note">${esc(r.competitionBand)} competition · ${esc(r.confidence)} confidence</div></td>
          <td class="num">${r.demand ?? '—'}</td>
          <td class="num">${r.competition ?? '—'}</td>
          <td class="num">${r.trendBand?.icon || ''} ${r.trend ?? '—'}</td>
          <td class="num"><strong>${r.opportunity ?? '—'}</strong></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <p class="note">The extension deliberately returns ONE recommendation. Runners-up are listed so you can see what was rejected and why.</p>
  </div>`;
}

/* ─────────────────────────── sections ─────────────────────────── */

export function whyCard(analysis) {
  return `<div class="card" id="why">
    <h3>Why this product?</h3>
    <ul class="bullets">
      ${analysis.why.map((w) => `<li><strong>${esc(w.title)}.</strong> ${esc(w.text)} ${w.basis ? basisTag(w.basis) : ''}</li>`).join('')}
    </ul>
  </div>`;
}

export function marketSection(analysis) {
  const { marketFit } = analysis;
  return `<div class="card" id="markets">
    <h3>Where to sell it</h3>
    <p><strong>Best marketplace:</strong> ${esc(marketFit.best?.icon || '')} ${esc(marketFit.best?.name || '—')} ·
      Competition ${esc(marketFit.best?.competition || '—')} · Demand ${esc(marketFit.best?.demand || '—')} ·
      Opportunity ${esc(marketFit.best?.opportunity || '—')}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Marketplace</th><th class="num">Fit</th><th>Demand</th><th>Competition</th><th>Opportunity</th><th class="num">Est. fees/unit</th><th></th></tr></thead>
      <tbody>
        ${marketFit.rows.map((row) => `<tr class="${row.id === marketFit.best?.id ? 'row-winner' : ''}">
          <td>${row.icon} ${esc(row.name)}<div class="note">${esc(row.audience)}</div></td>
          <td class="num">${row.score ?? '—'}</td>
          <td>${esc(row.demand)}</td>
          <td>${esc(row.competition)}</td>
          <td>${esc(row.opportunity)}</td>
          <td class="num">${row.feesPerUnit != null ? esc(currency(row.feesPerUnit)) : '—'}</td>
          <td><button class="btn small ghost" data-action="open" data-url="${esc(row.searchUrl)}">Open</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <p class="note">${esc(marketFit.note)} Fee figures come from each marketplace's published schedule: <a href="${esc(marketFit.best?.feeSource || '#')}" target="_blank" rel="noopener noreferrer">verify here</a>.</p>
  </div>`;
}

export function sourcingSection(analysis) {
  const { sourcing } = analysis;
  const rows = sourcing.rows;
  const rec = sourcing.recommended;
  return `<div class="card" id="sourcing">
    <h3>Find where to source it</h3>
    ${rec ? `<p><strong>Recommended starting route:</strong> ${esc(rec.icon)} ${esc(rec.supplier)} — ${esc(estimate(range(rec.landedCost[0], rec.landedCost[1], (v) => currency(v))))} landed per unit,
      ${rec.moq} unit minimum, ${rec.leadTimeDays[0]}–${rec.leadTimeDays[1]} days. ${rec.withinBudget ? 'Fits your selected budget.' : '⚠️ First order is above your selected budget.'}</p>` : ''}
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Supplier / product</th><th>Est. unit cost</th><th>Shipping</th><th class="num">MOQ</th>
        <th class="num">Est. sell price</th><th class="num">Est. profit</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map((row) => `<tr class="${row.id === rec?.id ? 'row-winner' : ''}">
          <td>${row.icon} <strong>${esc(row.supplier)}</strong>
            <div class="note">Search: “${esc(row.productQuery)}” · ${esc(row.inventoryRisk)} inventory risk</div>
            <div class="note">${esc(row.bestFor)}</div>
          </td>
          <td>${esc(estimate(range(row.unitCost[0], row.unitCost[1], (v) => currency(v))))}<div class="note">Landed ${esc(range(row.landedCost[0], row.landedCost[1], (v) => currency(v)))}</div></td>
          <td>${esc(range(row.shippingPerUnit[0], row.shippingPerUnit[1], (v) => currency(v)))}</td>
          <td class="num">${row.moq}</td>
          <td class="num">${row.sellingPrice != null ? esc(currency(row.sellingPrice)) : '—'}</td>
          <td class="num ${row.estimatedProfitPerUnit >= 0 ? 'pos' : ''}">${row.estimatedProfitPerUnit != null ? esc(currency(row.estimatedProfitPerUnit)) : '—'}
            <div class="note">${row.estimatedMargin != null ? esc(percent(row.estimatedMargin)) : ''}</div></td>
          <td><button class="btn small ghost" data-action="open" data-url="${esc(row.link)}">Supplier link</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${sourcing.digitalAlternative ? `<details class="disclosure"><summary>⬇️ Digital-product alternative (${esc(sourcing.digitalAlternative.supplier)})</summary>
      <p>${esc(sourcing.digitalAlternative.bestFor)}</p>
      <p class="note">${esc(sourcing.digitalAlternative.watchOut)} Estimated profit at this route: ${esc(currency(sourcing.digitalAlternative.estimatedProfitPerUnit || 0))} per sale (assumes you produce the file yourself - your own time is not costed).</p>
      <button class="btn small ghost" data-action="open" data-url="${esc(sourcing.digitalAlternative.link)}">Open search</button></details>` : ''}
    <h4>Before you pay any supplier</h4>
    <ul class="bullets">${SUPPLIER_DUE_DILIGENCE.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
    <p class="note">${esc(sourcing.note)}</p>
  </div>`;
}

export function profitSection(analysis) {
  const { profit } = analysis;
  if (!profit) return '';
  return `<div class="card" id="profit">
    <h3>Profit calculator <span class="tag modelled">Estimated</span></h3>
    <div class="kv">
      <div class="k">Selling price (${esc(profit.priceBasis === 'observed' ? 'observed on page' : 'public-data snapshot')})</div><div class="v">${esc(currency(profit.unit.sellingPrice))}</div>
      <div class="k">Product cost (est. band ${esc(range(profit.unit.landedCostRange[0], profit.unit.landedCostRange[1], (v) => currency(v)))})</div><div class="v">${esc(currency(profit.unit.productCost))}</div>
      <div class="k">Shipping / inbound</div><div class="v">${esc(currency(profit.unit.shipping))}</div>
      <div class="k">Marketplace fees (${esc(profit.marketplace.name)})</div><div class="v">${esc(currency(profit.unit.fees))}</div>
      <div class="k"><strong>Estimated profit per sale</strong></div><div class="v ${profit.unit.estimatedProfit >= 0 ? 'pos' : 'neg'}"><strong>${esc(currency(profit.unit.estimatedProfit))}</strong></div>
      <div class="k">Profit margin</div><div class="v">${esc(percent(profit.unit.profitMargin))}</div>
      <div class="k">Return on each $1 of cost</div><div class="v">${profit.unit.roi != null ? `${(1 + profit.unit.roi).toFixed(2)}×` : '—'}</div>
      <div class="k">Break-even units (fixed costs only)</div><div class="v">${profit.unit.breakEvenUnits ?? '—'}</div>
    </div>
    <h4>Monthly projection (estimate)</h4>
    <div class="kv">
      <div class="k">Assumed sales per month for a new seller</div><div class="v">${profit.targetUnits}</div>
      <div class="k">Estimated monthly profit</div><div class="v">${esc(range(profit.monthlyAtTarget?.low, profit.monthlyAtTarget?.high, (v) => currency(v, { decimals: 0 })))}</div>
      <div class="k">Estimated monthly revenue</div><div class="v">${esc(range(analysis.demand.volume?.newSellerRevenue?.low, analysis.demand.volume?.newSellerRevenue?.high, (v) => currency(v, { decimals: 0 })))}</div>
    </div>
    <h4>What-if pricing</h4>
    <div class="table-wrap"><table>
      <thead><tr><th>Price point</th><th class="num">Fees</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
      <tbody>${profit.priceBands.map((band) => `<tr>
        <td>${esc(currency(band.price))}</td><td class="num">${esc(currency(band.fees))}</td>
        <td class="num ${band.profit >= 0 ? 'pos' : 'neg'}">${esc(currency(band.profit))}</td><td class="num">${esc(percent(band.margin))}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <ul class="bullets">${profit.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    <p class="note">Fee schedule source: <a href="${esc(profit.feeSource)}" target="_blank" rel="noopener noreferrer">${esc(profit.feeSource)}</a> ${confidenceTag(profit.confidence.label)}</p>
  </div>`;
}

export function competitionSection(analysis) {
  const { competition, product } = analysis;
  return `<div class="card" id="competition">
    <h3>Low-competition detector</h3>
    <div class="big-score">
      <div><div class="label">Competition score</div><div class="num">${fmtScore(competition.score)}</div></div>
      <div style="flex:1">${bar(competition.score, { invert: true })}
        <div class="note" style="margin-top:6px">${esc(competition.band)} competition —
          0–30 Low · 31–60 Medium · 61–80 High · 81–100 Very High</div></div>
    </div>
    <p>${esc(competition.summary)}</p>
    ${metricRows(competition.metrics)}
    ${competition.missing.length ? `<p class="note">Not measurable from public data: ${esc(competition.missing.join(', '))}.</p>` : ''}
    ${product.differentiation?.length ? `<h4>Ways to differentiate</h4><ul class="bullets">${product.differentiation.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    <p class="note">${esc(competition.note)}</p>
  </div>`;
}

export function demandSection(analysis) {
  const { demand } = analysis;
  const volume = demand.volume;
  return `<div class="card" id="demand">
    <h3>Demand detector</h3>
    <div class="big-score">
      <div><div class="label">Demand score</div><div class="num">${fmtScore(demand.score)}</div></div>
      <div style="flex:1">${bar(demand.score)}
        <div class="note" style="margin-top:6px">${esc(demand.label)} · ${esc(demand.confidence.label)} confidence</div></div>
    </div>
    <ul class="bullets">${demand.reasons.map((r) => `<li class="${r.tone === 'caution' ? 'note' : ''}">${esc(r.text)}</li>`).join('')}</ul>
    ${volume ? `<h4>Estimated sales volume <span class="tag modelled">Estimated</span></h4>
      <div class="kv">
        <div class="k">Niche volume (all sellers)</div><div class="v">${esc(count(volume.nicheUnits.low))}–${esc(count(volume.nicheUnits.high))} units/month</div>
        <div class="k">Niche revenue</div><div class="v">${esc(range(volume.nicheRevenue.low, volume.nicheRevenue.high, (v) => currency(v, { decimals: 0 })))}</div>
        <div class="k">Realistic for a brand-new seller</div><div class="v">${esc(count(volume.newSellerUnits.low))}–${esc(count(volume.newSellerUnits.high))} units/month</div>
        <div class="k">Estimated price used</div><div class="v">${esc(currency(volume.avgPrice))}</div>
      </div>
      <p class="note"><strong>Model:</strong> ${esc(volume.model || volume.nicheUnits?.model || 'inferred from public review activity')}. Confidence ${esc(volume.confidence || volume.nicheUnits?.confidence || 'Low')}. These are inferred units, never counted sales.</p>` : ''}
    ${metricRows(demand.metrics)}
    ${demand.missing.length ? `<p class="note">Not published by this marketplace: ${esc(demand.missing.join(', '))}.</p>` : ''}
    <p class="note">${esc(demand.note)}</p>
  </div>`;
}

export function trendSection(analysis) {
  const { trend, product } = analysis;
  return `<div class="card" id="trend">
    <h3>Trend analysis</h3>
    <div class="big-score">
      <div><div class="label">${esc(trend.band.icon)} ${esc(trend.band.label)}</div><div class="num">${fmtScore(trend.score)}</div></div>
      <div style="flex:1">${sparkline(trend.spark, `spark-${esc(product.id)}`)}
        <div class="note">Momentum shape from the 30/90-day public-interest read.</div></div>
    </div>
    <div class="kv">
      ${trend.windows.map((w) => `<div class="k">${esc(w.label)}</div><div class="v">${w.icon} ${esc(w.movement)}${Number.isFinite(w.rate) ? ` (${esc(signedPercent(w.rate))})` : ''}</div>`).join('')}
      <div class="k">Seasonality</div><div class="v">${esc(trend.seasonality.label)}</div>
      ${product.trend?.seasonPeakMonths?.length ? `<div class="k">Peak months</div><div class="v">${esc(trend.seasonality.peakMonths.join(', '))}</div>` : ''}
    </div>
    <p class="note">${esc(trend.seasonality.note)} ${esc(trend.note)} ${confidenceTag(trend.confidence)}</p>
    ${trend.historyUsed ? `<p class="note good">Observed change: ${esc(trend.historyUsed.metric)} moved ${esc(signedPercent(trend.historyUsed.change))} over ${trend.historyUsed.days} days between your own scans.</p>` : ''}
  </div>`;
}

export function ideasSection(analysis) {
  const { ideaPack } = analysis;
  const list = (title, items, render = (i) => esc(i)) => `
    <details class="disclosure" open><summary>${esc(title)} (${items.length})</summary>
      <ul class="bullets">${items.map((i) => `<li>${render(i)}</li>`).join('')}</ul>
    </details>`;
  return `<div class="card" id="ideas">
    <h3>Product ideas</h3>
    <p><strong>Main product:</strong> ${esc(ideaPack.mainProduct)}</p>
    ${list('5 variations', ideaPack.variations)}
    ${list('5 unique angles', ideaPack.angles)}
    ${list('5 target customers', ideaPack.audiences)}
    ${list(`5 title ideas (${ideaPack.titles[0]?.marketplace || 'marketplace'} style)`, ideaPack.titles, (t) => `${esc(t.title)} <span class="note">— ${esc(t.uses)}</span>`)}
    ${list('10 keyword ideas', ideaPack.keywords, (k) => `<strong>${esc(k.keyword)}</strong> <span class="tag">${esc(k.intent)}</span> <span class="note">${esc(k.priority)} · ${esc(k.where)}</span>`)}
    <h4>Suggested price range</h4>
    <div class="kv">
      <div class="k">Entry — win the first reviews</div><div class="v">${esc(currency(ideaPack.priceRange.entry.price))}</div>
      <div class="k">Target — recommended</div><div class="v">${esc(currency(ideaPack.priceRange.target.price))}</div>
      <div class="k">Premium — bundle / personalisation</div><div class="v">${esc(currency(ideaPack.priceRange.premium.price))}</div>
    </div>
    <p class="note">${esc(ideaPack.priceRange.note)}</p>
    <button class="btn small ghost" data-action="copy-keywords">📋 Copy keywords</button>
  </div>`;
}

export function channelsSection(analysis) {
  const { channels } = analysis;
  return `<div class="card" id="channels">
    <h3>Where to find customers</h3>
    <p><strong>Best starting channel:</strong> ${esc(channels.best?.icon || '')} ${esc(channels.best?.label || '—')} (${channels.best?.score ?? '—'}/100) — ${esc(channels.best?.why || '')}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Channel</th><th class="num">Fit</th><th>Cost to start</th><th>Why it fits</th></tr></thead>
      <tbody>${channels.rows.map((row) => `<tr>
        <td>${row.icon} <strong>${esc(row.label)}</strong></td>
        <td class="num">${row.score ?? '—'}</td>
        <td>${esc(row.cost)}</td>
        <td class="note">${esc(row.why)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${channels.best?.firstSteps?.length ? `<h4>First week on ${esc(channels.best.label)}</h4>
      <ul class="bullets">${channels.best.firstSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    <p class="note">${esc(channels.note)}</p>
  </div>`;
}

export function riskSection(analysis) {
  const { risks, opportunity } = analysis;
  return `<div class="card" id="risks">
    <h3>Risks &amp; score adjustments</h3>
    <p>Risk level: <strong>${esc(risks.level)}</strong>
      ${risks.counts.high ? `· ${risks.counts.high} high-severity flag(s)` : ''}
      ${risks.counts.medium ? `· ${risks.counts.medium} medium` : ''}</p>
    ${risks.risks.length ? `<ul class="bullets">${risks.risks.map((r) => `<li>
      <strong>${esc(r.label)}</strong> <span class="tag ${r.severity === 'high' ? 'low' : r.severity === 'medium' ? 'medium' : ''}">${esc(r.severity)}</span>
      <div class="note">${esc(r.advice)}${r.details?.length ? ` <em>(${esc(r.details.join('; '))})</em>` : ''}</div></li>`).join('')}</ul>`
      : '<p class="note good">No specific risk flags fired for this niche.</p>'}
    ${opportunity.blockers.length ? `<h4>Blockers to clear first</h4>
      <ul class="bullets">${opportunity.blockers.map((b) => `<li class="note bad">${esc(b.text)}</li>`).join('')}</ul>` : ''}
    ${opportunity.adjustments.items.length ? `<h4>Score deductions (${opportunity.adjustments.total} points)</h4>
      <ul class="bullets">${opportunity.adjustments.items.map((i) => `<li>${esc(i.label)} <span class="note">−${i.points}</span></li>`).join('')}</ul>` : ''}
    <p class="note">${esc(opportunity.note)}</p>
  </div>`;
}

export function scanTable(scan, mode = 'dashboard') {
  if (!scan?.rows?.length) return emptyState('📊', 'Market not scanned yet', 'Press SCAN MARKET to rank every candidate niche.');
  return `<div class="card" id="scan">
    <h3>Market scan — ${scan.total} niches ranked</h3>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>#</th><th>Product</th><th class="num">Demand</th><th class="num">Competition</th>
        <th class="num">Profit</th><th class="num">Trend</th><th class="num">Opportunity</th><th></th>
      </tr></thead>
      <tbody>
        ${scan.rows.map((row) => `<tr class="${row.rank === 1 ? 'row-winner' : ''}">
          <td class="rank">#${row.rank}</td>
          <td>${esc(row.product)}
            <div class="note">${esc(row.competitionBand)} competition · ${esc(row.confidence)} confidence${row.observed ? ' · live observed' : ''}${row.blockers ? ` · ${row.blockers} blocker(s)` : ''}</div>
          </td>
          <td class="num">${row.demand ?? '—'}</td>
          <td class="num">${row.competition ?? '—'}</td>
          <td class="num ${row.profit >= 0 ? 'pos' : 'neg'}">${row.profit != null ? esc(currency(row.profit, { decimals: 2 })) : '—'}
            <div class="note">${row.margin != null ? esc(percent(row.margin)) : ''}</div></td>
          <td class="num">${row.trendBand?.icon || ''} ${row.trend ?? '—'}</td>
          <td class="num"><strong>${row.opportunity ?? '—'}</strong><div class="note">${esc(row.opportunityLabel || '')}</div></td>
          <td>${mode === 'dashboard' ? `<button class="btn small ghost" data-action="inspect" data-product-id="${esc(row.productId)}">Inspect</button>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <p class="note">${esc(scan.note)} Ranking order: opportunity score → confidence → competitive room → profit per unit.</p>
  </div>`;
}

export function honestySection(meta, { observed = [], local = false } = {}) {
  return `<div class="card" id="honesty">
    <h3>Data &amp; honesty</h3>
    <p>${esc(DISCLAIMER_TEXT)}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Source</th><th>Basis</th><th>What it covers</th><th>Limits</th></tr></thead>
      <tbody>${DATA_SOURCES.map((s) => `<tr>
        <td><strong>${esc(s.label)}</strong></td>
        <td>${basisTag(s.basis)}<div class="note">${esc(s.confidence)}</div></td>
        <td class="note">${esc(s.describes)}</td>
        <td class="note">${esc(s.limits)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <h4>Confidence levels</h4>
    <ul class="bullets">
      <li><strong>High</strong> — read from a public page in your browser (observed).</li>
      <li><strong>Medium</strong> — curated public-data snapshot or a published fee schedule.</li>
      <li><strong>Low</strong> — modelled from assumptions; verify before you invest.</li>
    </ul>
    ${meta?.assumptions?.length ? `<h4>Assumptions behind this report</h4><ul class="bullets">${meta.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${observed.length ? `<h4>Pages you scanned (${observed.length})</h4>
      <ul class="bullets">${observed.slice(0, 8).map((o) => `<li>${esc(o.summary)} <span class="note">${esc(timeAgo(o.scannedAt))}${o.fresh ? '' : ' · expired'}</span></li>`).join('')}</ul>
      <button class="btn small ghost" data-action="clear-observed">🗑️ Forget scanned pages</button>` : ''}
    ${local ? `<p class="note warn">Running as a standalone page (no extension host): live page scanning is simulated with a fixture so the UI stays explorable.</p>` : ''}
  </div>`;
}

export function reportsList(reports) {
  if (!reports?.length) return emptyState('🗂️', 'No saved reports yet', 'Every FIND MY WINNING PRODUCT run is stored locally for 25 reports.');
  return `<div class="card" id="reports">
    <h3>Saved reports (${reports.length})</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Product</th><th class="num">Opportunity</th><th>Market</th><th></th></tr></thead>
      <tbody>${reports.map((r) => `<tr>
        <td>${esc(timeAgo(r.createdAt))}</td>
        <td>${esc(r.emoji || '')} ${esc(r.product || '—')}<div class="note">${esc(r.confidence || '')} confidence</div></td>
        <td class="num"><strong>${r.score ?? '—'}</strong></td>
        <td>${esc(r.marketplace || '—')}</td>
        <td class="row tight">
          <button class="btn small ghost" data-action="open-report" data-id="${esc(r.id)}">Open</button>
          <button class="btn small ghost" data-action="delete-report" data-id="${esc(r.id)}">Delete</button>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

export function savedList(saved) {
  if (!saved?.length) return emptyState('⭐', 'Nothing saved yet', 'Use SAVE PRODUCT on a recommendation to keep it here.');
  return `<div class="card" id="saved">
    <h3>Saved products (${saved.length})</h3>
    <ul class="bullets">${saved.map((s) => `<li>
      <strong>${esc(s.name)}</strong> — opportunity ${s.score ?? '—'}/100 · ${esc(s.marketplace || '')}
      <span class="note">saved ${esc(timeAgo(s.savedAt))}</span>
      <button class="btn small ghost" data-action="unsave" data-product-id="${esc(s.productId)}">Remove</button>
    </li>`).join('')}</ul>
  </div>`;
}

export function watchListSection(observed) {
  if (!observed?.length) return '';
  return `<div class="card">
    <h3>Observed pages (your own scans)</h3>
    <ul class="bullets">${observed.slice(0, 6).map((o) => `<li>${esc(o.summary)} <span class="note">${esc(timeAgo(o.scannedAt))}</span></li>`).join('')}</ul>
  </div>`;
}

export function statsRow(stats, scanSummary) {
  return `<div class="card">
    <h3>Local activity</h3>
    <div class="kv">
      <div class="k">Scans run</div><div class="v">${stats?.scans ?? 0}</div>
      <div class="k">Winning-product searches</div><div class="v">${stats?.winnerFinds ?? 0}</div>
      <div class="k">Last scan</div><div class="v">${esc(stats?.lastScanAt ? timeAgo(stats.lastScanAt) : 'never')}</div>
    </div>
    ${scanSummary ? `<p class="note">Last page scan: ${esc(scanSummary.summary)}</p>` : ''}
    <p class="note">All analysis happens on your device. The extension makes no network requests and sends nothing anywhere.</p>
  </div>`;
}

export function settingsSection(settings, { observed = [] } = {}) {
  return `<div class="card" id="settings">
    <h3>Settings &amp; data</h3>
    <div class="row">
      <button class="btn" data-action="export-data">⬇️ Export all data (JSON)</button>
      <label class="btn" style="cursor:pointer">⬆️ Import backup
        <input type="file" accept="application/json" class="sr-only" data-action="import-data">
      </label>
      <button class="btn ghost" data-action="copy-markdown">📋 Copy winning product as Markdown</button>
      <button class="btn ghost" data-action="clear-observed">🧹 Forget scanned pages</button>
      <button class="btn ghost" data-action="delete-all">🗑️ Delete everything</button>
    </div>
    <h4>Permissions</h4>
    <p class="note">The extension only reads a page when you press SCAN PAGE (or the keyboard shortcut). Granting access to all marketplaces makes that work without Chrome re-asking each time.</p>
    <div class="row"><button class="btn small" data-action="grant">🔐 Grant marketplace access</button>
      <button class="btn small ghost" data-action="check-grant">Check status</button></div>
    <h4>Stored data</h4>
    <div class="kv">
      <div class="k">Observed pages</div><div class="v">${observed.length}</div>
      <div class="k">Autoscan on open</div><div class="v">${settings?.autoScanOnOpen ? 'on' : 'off'}</div>
    </div>
  </div>`;
}


