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
      const t = (document.body && document.body.innerText) || '';
      return t.slice(0, maxLen || 120000);
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
    parseJsonLd, findProductJsonLd, bodyText, findInPageText,
    detectPageType, listingIdFromUrl, shopNameFromUrl,
    waitForAny, numberNearStars
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
