/* Etsy Insight Pro — export.js
 * CSV / JSON export. Pure string builders (testable) + a download helper
 * for extension pages (popup/dashboard/panel).
 */
(function initExport(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('exporter');

  function csvCell(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(rows, columns) {
    const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
    const lines = [cols.map(csvCell).join(',')];
    for (const row of rows) {
      lines.push(cols.map(c => csvCell(row[c])).join(','));
    }
    return lines.join('\r\n');
  }

  function toJSON(data, pretty) {
    return JSON.stringify(data, null, pretty === false ? 0 : 2);
  }

  /** Flatten a research session into export rows. */
  function researchRows(session) {
    const items = (session && session.items) || [];
    return items.map((it, i) => ({
      rank: it.rank !== undefined ? it.rank : i + 1,
      product: it.title || '',
      price: it.price !== null && it.price !== undefined ? it.price : '',
      currency: it.currency || session.currency || '',
      reviews: it.reviews !== null && it.reviews !== undefined ? it.reviews : '',
      rating: it.rating !== null && it.rating !== undefined ? it.rating : '',
      shop: it.shop || '',
      url: it.url || '',
      position: it.position !== undefined ? it.position : (i + 1),
      est_monthly_sales_low: it.sales ? it.sales.low : '',
      est_monthly_sales_mid: it.sales ? it.sales.mid : '',
      est_monthly_sales_high: it.sales ? it.sales.high : '',
      est_monthly_revenue_mid: it.revenue && it.revenue.monthly ? it.revenue.monthly.mid : '',
      demand: it.scores ? it.scores.demand.value : '',
      competition: it.scores ? it.scores.competition.value : '',
      opportunity: it.scores ? it.scores.opportunity.value : '',
      confidence: it.sales ? it.sales.confidence : ''
    }));
  }

  function shopRows(extracted) {
    const items = (extracted && extracted.listings) || [];
    return items.map(it => ({
      product: it.title || '',
      price: it.price !== null && it.price !== undefined ? it.price : '',
      reviews: it.reviews !== null && it.reviews !== undefined ? it.reviews : '',
      est_monthly_sales_mid: it.sales ? it.sales.mid : '',
      est_monthly_revenue_mid: it.revenue && it.revenue.monthly ? it.revenue.monthly.mid : '',
      demand: it.scores ? it.scores.demand.value : '',
      competition: it.scores ? it.scores.competition.value : '',
      opportunity: it.scores ? it.scores.opportunity.value : '',
      url: it.url || ''
    }));
  }

  function keywordRows(keywordResult) {
    return ((keywordResult && keywordResult.rows) || []).map(r => ({
      keyword: r.keyword,
      frequency: r.frequency,
      share_pct: r.sharePct,
      avg_price: r.avgPrice !== null && r.avgPrice !== undefined ? Math.round(r.avgPrice * 100) / 100 : '',
      avg_reviews: r.avgReviews !== null && r.avgReviews !== undefined ? Math.round(r.avgReviews * 10) / 10 : '',
      demand: r.demand,
      competition: r.competition,
      opportunity: r.opportunity,
      long_tail: r.longTail ? 'yes' : 'no'
    }));
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function downloadCSV(filename, rows, columns) {
    download(filename, toCSV(rows, columns), 'text/csv;charset=utf-8');
  }

  function downloadJSON(filename, data) {
    download(filename, toJSON(data), 'application/json;charset=utf-8');
  }

  EIP.exporter = { toCSV, toJSON, csvCell, researchRows, shopRows, keywordRows, download, downloadCSV, downloadJSON };
})(typeof globalThis !== 'undefined' ? globalThis : this);
