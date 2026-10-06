/* Etsy Insight Pro — content/extractors/common.js
 * Resilient DOM helpers + page-type detection + JSON-LD parsing.
 * Every extractor is defensive: Etsy changes markup often, so each field
 * tries multiple selectors and JSON-LD fallbacks, and records WHICH source
 * produced each value (sourceHints) for debugging + transparency.
 */
(function initCommon(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('extract-common');
  const U = () => EIP.utils;

  function $(sel, scope) {
    try { return (scope || document).querySelector(sel); }
    catch (e) { return null; }
  }

  function $all(sel, scope) {
    try { return Array.from((scope || document).querySelectorAll(sel)); }
    catch (e) { return []; }
  }

  function textOf(el) {
    if (!el) return null;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t || null;
  }

  /** First non-empty text across selectors. Returns { value, source }. */
  function firstText(selectors, scope) {
    for (const sel of selectors) {
      const el = $(sel, scope);
      const t = textOf(el);
      if (t) return { value: t, source: `dom:${sel}` };
    }
    return { value: null, source: null };
  }

  function firstAttr(selectors, attr, scope) {
    for (const sel of selectors) {
      const el = $(sel, scope);
      if (el && el.getAttribute) {
        const v = el.getAttribute(attr);
        if (v) return { value: v, source: `dom:${sel}@${attr}` };
      }
    }
    return { value: null, source: null };
  }

  function metaContent(names) {
    for (const n of names) {
      const el = $(`meta[property="${n}"], meta[name="${n}"]`);
      if (el && el.content) return { value: el.content, source: `meta:${n}` };
    }
    return { value: null, source: null };
  }

  function parseJsonLd() {
    const out = [];
    for (const el of $all('script[type="application/ld+json"]')) {
      try {
        const raw = el.textContent || '';
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) out.push(...parsed);
        else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed['@graph'])) out.push(...parsed['@graph']);
          else out.push(parsed);
        }
      } catch (e) { /* skip malformed blocks */ }
    }
    return out;
  }

  function findProductJsonLd(blocks) {
    for (const b of blocks || []) {
      const type = b && b['@type'];
      if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return b;
    }
    return null;
  }

  function bodyText(maxLen) {
    try {
      const body = document.body;
      const t = (body && (body.innerText || body.textContent)) || '';
      return t.replace(/\s+/g, ' ').trim().slice(0, maxLen || 120000);
    } catch (e) { return ''; }
  }

  /** Search visible page text for a regex; returns first match groups + context. */
  function findInPageText(regex) {
    const t = bodyText();
    const m = t.match(regex);
    return m ? m : null;
  }

  function detectPageType(url) {
    const u = String(url || (typeof location !== 'undefined' ? location.href : ''));
    try {
      const parsed = new URL(u, 'https://www.etsy.com');
      const path = parsed.pathname || '';
      if (/\/listing\/\d+/.test(path)) {
        const id = (path.match(/\/listing\/(\d+)/) || [])[1] || null;
        return { type: 'product', listingId: id };
      }
      if (/\/shop\/[^/]+/.test(path)) {
        const name = decodeURIComponent((path.match(/\/shop\/([^/?#]+)/) || [])[1] || '');
        return { type: 'shop', shopName: name || null };
      }
      if (/^\/(search|market)\b/.test(path) || parsed.searchParams.has('q') || parsed.searchParams.has('search_query')) {
        return { type: 'search', query: parsed.searchParams.get('q') || parsed.searchParams.get('search_query') || null };
      }
      // Shop sub-pages (/shop/.../items etc.) still count as shop.
      if (path.startsWith('/shop')) return { type: 'shop', shopName: null };
      return { type: 'other', query: null };
    } catch (e) {
      return { type: 'other', query: null };
    }
  }

  function listingIdFromUrl(url) {
    const m = String(url || '').match(/\/listing\/(\d+)/);
    return m ? m[1] : null;
  }

  function shopNameFromUrl(url) {
    const m = String(url || '').match(/\/shop\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /** Wait for at least one selector to appear (SPA / lazy content). */
  function waitForAny(selectors, timeoutMs) {
    return new Promise((resolve) => {
      const list = Array.isArray(selectors) ? selectors : [selectors];
      for (const sel of list) {
        try { if (document.querySelector(sel)) return resolve(sel); } catch (e) { /* ignore */ }
      }
      let done = false;
      const finish = (val) => { if (!done) { done = true; try { obs.disconnect(); } catch (e) {} resolve(val); } };
      const obs = new MutationObserver(() => {
        for (const sel of list) {
          try { if (document.querySelector(sel)) return finish(sel); } catch (e) { /* ignore */ }
        }
      });
      try { obs.observe(document.documentElement, { childList: true, subtree: true }); }
      catch (e) { return resolve(null); }
      setTimeout(() => finish(null), timeoutMs || 6000);
    });
  }

  /* ---------- accuracy: validators + consensus ---------- */

  function validPrice(v) {
    return Number.isFinite(v) && v > 0 && v < 10000000 ? Math.round(v * 100) / 100 : null;
  }

  function validRating(v) {
    return Number.isFinite(v) && v >= 0 && v <= 5 ? Math.round(v * 100) / 100 : null;
  }

  function validCount(v, max) {
    const m = max || 100000000;
    return Number.isFinite(v) && v >= 0 && v < m ? Math.round(v) : null;
  }

  /**
   * Consensus picker: candidates = [{ value, source, trust }].
   * Returns { value, source } — prefers values confirmed by 2+ independent
   * sources (within tolerance), else the highest-trust candidate.
   * This is what keeps one stale/mis-parsed element from corrupting results.
   */
  function consensus(candidates, tolerance) {
    const tol = tolerance === undefined ? 0.011 : tolerance;
    const list = (candidates || []).filter(c => c && c.value !== null && c.value !== undefined);
    if (!list.length) return { value: null, source: null };
    // Group numeric candidates by proximity; exact match for strings.
    const groups = [];
    for (const c of list) {
      let placed = false;
      for (const g of groups) {
        const same = (typeof c.value === 'number' && typeof g.value === 'number')
          ? Math.abs(c.value - g.value) <= Math.max(tol, Math.abs(g.value) * tol)
          : c.value === g.value;
        if (same) {
          g.members.push(c);
          g.trust += (c.trust || 1);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push({ value: c.value, trust: (c.trust || 1), members: [c] });
    }
    groups.sort((a, b) => {
      // Confirmed-by-multiple first, then trust.
      const ac = a.members.length > 1 ? 1 : 0, bc = b.members.length > 1 ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return b.trust - a.trust;
    });
    const win = groups[0];
    const src = win.members.map(m => m.source).filter(Boolean).join(' + ');
    return { value: win.value, source: `consensus(${src || 'single'})` };
  }

  function scopedText(container, maxLen) {
    try {
      const t = (container && (container.innerText || container.textContent)) || '';
      return t.replace(/\s+/g, ' ').trim().slice(0, maxLen || 20000);
    } catch (e) { return ''; }
  }

  /** "(1,234)" style count near a given element (walks up 3 levels). */
  function countNearElement(el, parseCount) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      const t = scopedText(node, 2000);
      const m = t.match(/\(([0-9][0-9,.\s\u00a0\u202fKkMm]*)\)/);
      if (m) {
        const n = parseCount(m[1]);
        if (n !== null && n < 10000000) return n;
      }
      node = node.parentElement;
    }
    return null;
  }

  function findBreadcrumbLd(blocks) {
    for (const b of blocks || []) {
      const type = b && b['@type'];
      if (type === 'BreadcrumbList' || (Array.isArray(type) && type.includes('BreadcrumbList'))) return b;
    }
    return null;
  }

  function breadcrumbNames(bc) {
    try {
      const items = (bc && bc.itemListElement) || [];
      return items.map(it => (it && it.name ? String(it.name).trim() : '')).filter(Boolean);
    } catch (e) { return []; }
  }

  /** Extract a number near a label, e.g. "(1,234)" after stars. */
  function numberNearStars(scope) {
    const candidates = $all('a[href*="#reviews"], [data-review-count], .wt-display-inline-flex, span', scope).slice(0, 400);
    for (const el of candidates) {
      const t = textOf(el);
      if (!t) continue;
      const m = t.match(/\(([0-9][0-9,.\s\u00a0\u202fKkMm]*)\)/);
      if (m) {
        const n = U().parseCount(m[1]);
        if (n !== null && n < 10000000) return { value: n, source: 'dom:review-count-parens' };
      }
    }
    return { value: null, source: null };
  }

  EIP.extract = EIP.extract || {};
  EIP.extract.common = {
    $, $all, textOf, firstText, firstAttr, metaContent,
    parseJsonLd, findProductJsonLd, findBreadcrumbLd, breadcrumbNames,
    bodyText, findInPageText,
    detectPageType, listingIdFromUrl, shopNameFromUrl,
    waitForAny, numberNearStars,
    validPrice, validRating, validCount, consensus, scopedText, countNearElement
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
