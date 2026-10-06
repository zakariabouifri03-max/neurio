/**
 * format-report.js - Markdown / plain-text serialisation of a report.
 * Used by the "Copy as Markdown" and "Download .md" buttons. Keeps the estimate
 * labelling and confidence scores visible in the exported text too.
 */

import { currency, count, percent, range, score } from './format.js';

const bullet = (items) => (items || []).map((i) => `- ${i}`).join('\n');

export function formatReport(report) {
  if (!report) return 'No report available.';
  const lines = [];
  const L = (s = '') => lines.push(s);

  L(`# 🔎 Hidden Winner Finder — research report`);
  L('');
  L(`**Product:** ${report.product.emoji || ''} ${report.product.name}  `);
  L(`**Opportunity score:** ${score(report.scores.opportunity)} (${report.scores.label}) · confidence: **${report.confidence.overall}**  `);
  L(`**Market:** ${report.selection.marketplace} · **Country:** ${report.selection.country} · **Category:** ${report.selection.category} · **Budget:** ${report.selection.budget}  `);
  L(`_Generated ${new Date(report.createdAt).toLocaleString()} · report v${report.version}_`);
  L('');
  L(report.product.blurb || '');
  L('');

  L('## Scores');
  L('');
  L('| Metric | Score |');
  L('| --- | --- |');
  L(`| Demand | ${score(report.scores.demand)} |`);
  L(`| Competition (lower is better) | ${score(report.scores.competition)} (${report.competition.band}) |`);
  L(`| Profit potential | ${score(report.scores.profit)} |`);
  L(`| Trend | ${score(report.scores.trend)} (${report.trend.band.icon} ${report.trend.band.label}) |`);
  L(`| **Opportunity** | **${score(report.scores.opportunity)}** |`);
  L(`| Risk penalty applied | -${report.scores.riskPenalty} |`);
  L('');
  L(`> ${report.verdict.headline} — ${report.verdict.text}`);
  L('');

  L('## Why this product?');
  L('');
  for (const w of report.why || []) {
    L(`- **${w.title}** — ${w.text}`);
  }
  L('');

  L('## Where to sell it');
  L('');
  L(`**Best marketplace:** ${report.marketFit.best?.name} — ${report.marketFit.best?.opportunity} opportunity, ${report.marketFit.best?.competition} competition, ${report.marketFit.best?.demand} demand.`);
  L('');
  L('| Marketplace | Opportunity | Demand | Competition | Est. fees/unit | Confidence |');
  L('| --- | --- | --- | --- | --- | --- |');
  for (const row of report.marketFit.rows || []) {
    L(`| ${row.icon} ${row.name} | ${row.score ?? '—'}/100 (${row.opportunity}) | ${row.demand} | ${row.competition} | ${row.feesPerUnit != null ? currency(row.feesPerUnit) : '—'} | ${row.confidence} |`);
  }
  L('');
  L(`_${report.marketFit.note}_`);
  L('');

  L('## Profit calculator (estimated)');
  L('');
  if (report.profit) {
    const u = report.profit.unit;
    L('| Line | Amount |');
    L('| --- | --- |');
    L(`| Selling price | ${currency(u.sellingPrice)} |`);
    L(`| Product cost | ${currency(u.productCost)} |`);
    L(`| Shipping / inbound | ${currency(u.shipping)} |`);
    L(`| Marketplace fees | ${currency(u.fees)} |`);
    L(`| **Estimated profit per sale** | **${currency(u.estimatedProfit)}** |`);
    L(`| Estimated margin | ${percent(u.profitMargin)} |`);
    L('');
    L(`Estimated monthly profit at ${report.profit.targetUnits} sales: ${range(report.profit.monthlyAtTarget?.low, report.profit.monthlyAtTarget?.high)} (estimate).`);
    L('');
    L(bullet(report.profit.notes));
    L('');
    L(`Fee source (public schedule): ${report.profit.feeSource}`);
  }
  L('');

  L('## Where to source it (estimates — request live quotes)');
  L('');
  L('| Supplier | Product search | Est. unit cost | Shipping | MOQ | Sell price | Est. profit/unit | Link |');
  L('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.sourcing.rows || []) {
    L(`| ${row.icon} ${row.supplier} | ${row.productQuery} | ${range(row.unitCost[0], row.unitCost[1], (v) => currency(v))} | ${range(row.shippingPerUnit[0], row.shippingPerUnit[1], (v) => currency(v))} | ${row.moq} | ${row.sellingPrice != null ? currency(row.sellingPrice) : '—'} | ${row.estimatedProfitPerUnit != null ? currency(row.estimatedProfitPerUnit) : '—'} | ${row.link} |`);
  }
  L('');
  L(`_${report.sourcing.note}_`);
  L('');

  L('## Competition breakdown');
  L('');
  for (const m of report.competition.metrics.filter((m) => Number.isFinite(m.value))) {
    L(`- ${m.label}: ${Math.round(m.value)}/100 (weight ${m.weight}) — ${m.note}`);
  }
  L('');
  L('## Demand breakdown');
  L('');
  for (const m of report.demand.metrics.filter((m) => Number.isFinite(m.value))) {
    L(`- ${m.label}: ${Math.round(m.value)}/100 — ${m.note}`);
  }
  if (report.demand.volume) {
    L('');
    L(`Estimated niche volume: ${count(report.demand.volume.nicheUnits.low)}–${count(report.demand.volume.nicheUnits.high)} units/month (${count(report.demand.volume.nicheRevenue.low)}–${count(report.demand.volume.nicheRevenue.high)} revenue).`);
    L(`Estimated volume for a brand-new seller: ${count(report.demand.volume.newSellerUnits.low)}–${count(report.demand.volume.newSellerUnits.high)} units/month.`);
    L(`Model: ${report.demand.volume.model || report.demand.volume.nicheUnits?.model}. Confidence: ${report.demand.volume.confidence || report.demand.volume.nicheUnits?.confidence}.`);
  }
  L('');

  L('## Trend');
  L('');
  for (const w of report.trend.windows || []) {
    L(`- ${w.label}: ${w.icon} ${w.movement}${Number.isFinite(w.rate) ? ` (${(w.rate * 100).toFixed(0)}%)` : ''}`);
  }
  L(`- Seasonality: ${report.trend.seasonality.label} — ${report.trend.seasonality.note}`);
  L(`- Basis: ${report.trend.basis}, confidence ${report.trend.confidence}`);
  L('');

  L('## Where to find customers');
  L('');
  L(`**Best starting channel:** ${report.channels.best?.icon} ${report.channels.best?.label} (${report.channels.best?.score}/100)`);
  L('');
  for (const row of report.channels.rows || []) {
    L(`- ${row.icon} ${row.label} — ${row.verdict} (${row.score}/100) · ${row.cost}`);
  }
  L('');

  L('## Product ideas');
  L('');
  const idea = report.ideaPack;
  L(`**Main product:** ${idea.mainProduct}`);
  L('');
  L(`**5 variations:** ${idea.variations.join(' · ')}`);
  L('');
  L(`**5 angles:**`);
  L(bullet(idea.angles));
  L('');
  L(`**5 target customers:**`);
  L(bullet(idea.audiences));
  L('');
  L(`**5 title ideas (${idea.titles[0]?.marketplace || 'marketplace'} style):**`);
  L(bullet(idea.titles.map((t) => t.title)));
  L('');
  L(`**10 keywords:**`);
  L(bullet(idea.keywords.map((k) => `${k.keyword} — ${k.intent} (${k.priority})`)));
  L('');
  L(`**Suggested price range:** entry ${currency(idea.priceRange.entry.price)} · target ${currency(idea.priceRange.target.price)} · premium ${currency(idea.priceRange.premium.price)}`);
  L(`_${idea.priceRange.note}_`);
  L('');

  if (report.risks.risks.length) {
    L(`## Risks (${report.risks.level})`);
    L('');
    for (const r of report.risks.risks) {
      L(`- **${r.label}** (${r.severity}) — ${r.advice}${r.details?.length ? ` _(${r.details.join('; ')})_` : ''}`);
    }
    L('');
  }

  if (report.opportunity.blockers.length) {
    L('## Blockers to clear first');
    L('');
    L(bullet(report.opportunity.blockers.map((b) => b.text)));
    L('');
  }

  L('## Confidence & honesty notes');
  L('');
  L(`- Overall confidence: **${report.confidence.overall}** (demand ${report.confidence.demand}, competition ${report.confidence.competition}, trend ${report.confidence.trend}, profit ${report.confidence.profit}, sourcing ${report.confidence.sourcing}).`);
  L(`- ${report.demand.note}`);
  L(`- ${report.competition.note}`);
  L(`- ${report.trend.note}`);
  L('- Every number in this report is either **Observed on page**, **Public-data based** (snapshot) or **Modelled**. Sales volume, demand and profit are estimates — never verified sales data.');
  L('');

  return lines.join('\n');
}
