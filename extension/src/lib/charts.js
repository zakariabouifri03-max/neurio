/* Etsy Insight Pro — charts.js
 * Tiny dependency-free canvas charts (line + bar + sparkline + donut gauge)
 * styled for the extension theme. No external libraries (keeps the bundle
 * light and CSP-clean). No-ops gracefully when document/canvas is missing
 * (Node tests, service worker).
 */
(function initCharts(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('charts');

  function canRender() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  function themeColors(dark) {
    return dark
      ? { text: '#cbd5e1', grid: 'rgba(148,163,184,0.16)', line: '#f97316', fill: 'rgba(249,115,22,0.18)', bar: '#fb923c', track: 'rgba(148,163,184,0.2)' }
      : { text: '#475569', grid: 'rgba(15,23,42,0.08)', line: '#ea580c', fill: 'rgba(234,88,12,0.12)', bar: '#f97316', track: 'rgba(15,23,42,0.08)' };
  }

  function isDark() {
    try {
      if (document.documentElement.dataset.theme === 'dark') return true;
      if (document.documentElement.dataset.theme === 'light') return false;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) { return false; }
  }

  function setupCanvas(canvas, height) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const h = height || 220;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = '100%';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }

  function niceMax(values) {
    const m = Math.max(0, ...values.filter(Number.isFinite));
    if (m <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(m)));
    const n = m / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p * 1.1;
  }

  /** Line chart. series: [{ label, color?, points: [{t, v, label?}] }]. */
  function lineChart(canvas, series, options) {
    if (!canRender() || !canvas) return;
    const opts = options || {};
    const { ctx, w, h } = setupCanvas(canvas, opts.height || 220);
    const C = themeColors(opts.dark !== undefined ? opts.dark : isDark());
    const pad = { l: 44, r: 12, t: 14, b: 26 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const allV = [];
    (series || []).forEach(s => (s.points || []).forEach(p => { if (Number.isFinite(p.v)) allV.push(p.v); }));
    if (!allV.length) {
      ctx.fillStyle = C.text; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(opts.emptyText || 'Not enough history yet — visit this item again to build a trend.', w / 2, h / 2);
      return;
    }
    const max = niceMax(allV);
    const min = Math.min(0, ...allV);
    const allT = [];
    (series || []).forEach(s => (s.points || []).forEach(p => { if (Number.isFinite(p.t)) allT.push(p.t); }));
    const t0 = Math.min(...allT), t1 = Math.max(...allT);
    const X = (t) => pad.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
    const Y = (v) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;

    // Grid + y labels.
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.text;
    ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4;
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(compact(v), pad.l - 6, y + 3);
    }
    // X labels (first / mid / last dates).
    ctx.textAlign = 'center';
    const fmtD = (t) => { try { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
    ctx.fillText(fmtD(t0), pad.l + 24, h - 8);
    ctx.fillText(fmtD(t1), w - pad.r - 24, h - 8);

    (series || []).forEach((s, si) => {
      const pts = (s.points || []).filter(p => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
      if (!pts.length) return;
      const color = s.color || (si === 0 ? C.line : '#0ea5e9');
      // Fill.
      ctx.beginPath();
      ctx.moveTo(X(pts[0].t), Y(min));
      pts.forEach(p => ctx.lineTo(X(p.t), Y(p.v)));
      ctx.lineTo(X(pts[pts.length - 1].t), Y(min));
      ctx.closePath();
      ctx.fillStyle = s.fill || C.fill;
      ctx.fill();
      // Line.
      ctx.beginPath();
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.t), Y(p.v)); else ctx.lineTo(X(p.t), Y(p.v)); });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      // Dots.
      ctx.fillStyle = color;
      pts.forEach(p => { ctx.beginPath(); ctx.arc(X(p.t), Y(p.v), 2.5, 0, Math.PI * 2); ctx.fill(); });
    });
  }

  /** Horizontal bar list rendered as divs (accessible, no canvas needed). Returns HTML string. */
  function barListHTML(rows, options) {
    const opts = options || {};
    const max = Math.max(1, ...(rows || []).map(r => r.value).filter(Number.isFinite));
    const esc = (EIP.utils && EIP.utils.escapeHtml) || ((s) => String(s));
    return (rows || []).map(r => {
      const pct = Math.max(2, Math.round(((r.value || 0) / max) * 100));
      return `<div class="eip-bar-row"><span class="eip-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>` +
        `<span class="eip-bar-track"><span class="eip-bar-fill" style="width:${pct}%"></span></span>` +
        `<span class="eip-bar-value">${esc(r.display !== undefined ? r.display : r.value)}</span></div>`;
    }).join('');
  }

  /** Score gauge (SVG donut). value 0–100. */
  function gaugeSVG(value, options) {
    const opts = options || {};
    const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    const size = opts.size || 92;
    const stroke = opts.stroke || 9;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - v / 100);
    const color = v >= 75 ? '#16a34a' : v >= 60 ? '#65a30d' : v >= 45 ? '#d97706' : v >= 30 ? '#ea580c' : '#dc2626';
    const track = 'currentTrack';
    return `<svg class="eip-gauge" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${v} out of 100">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--eip-track, #e2e8f0)" stroke-width="${stroke}"/>` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" ` +
      `stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` +
      `<text x="50%" y="50%" dy="1" text-anchor="middle" dominant-baseline="central" font-size="${size * 0.24}" font-weight="700" fill="var(--eip-ink, #0f172a)">${v}</text></svg>`;
  }

  /** Tiny sparkline into a canvas. values: number[]. */
  function sparkline(canvas, values, options) {
    if (!canRender() || !canvas) return;
    const opts = options || {};
    const nums = (values || []).filter(Number.isFinite);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = opts.width || 96, h = opts.height || 28;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    if (nums.length < 2) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui'; ctx.fillText('—', 4, h - 8);
      return;
    }
    const C = themeColors(opts.dark !== undefined ? opts.dark : isDark());
    const min = Math.min(...nums), max = Math.max(...nums);
    const X = (i) => 2 + (i / (nums.length - 1)) * (w - 4);
    const Y = (v) => max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6);
    ctx.beginPath();
    nums.forEach((v, i) => { if (i === 0) ctx.moveTo(X(i), Y(v)); else ctx.lineTo(X(i), Y(v)); });
    ctx.strokeStyle = opts.color || C.line; ctx.lineWidth = 1.6; ctx.stroke();
  }

  function compact(v) {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1000000) return trim(v / 1000000) + 'M';
    if (abs >= 1000) return trim(v / 1000) + 'K';
    return String(Math.round(v * 10) / 10);
  }
  function trim(v) { return String(Math.round(v * 10) / 10); }

  EIP.charts = { lineChart, barListHTML, gaugeSVG, sparkline };
})(typeof globalThis !== 'undefined' ? globalThis : this);
