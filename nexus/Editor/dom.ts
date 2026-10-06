// NEXUS EDITOR — tiny DOM helper
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, any> = {}, ...children: any[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else (el as any).setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

export function el(tag: string, className = '', html?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function clear(el: Element) { while (el.firstChild) el.removeChild(el.firstChild); }

/** Debounce helper. */
export function debounce<F extends (...a: any[]) => void>(fn: F, ms: number): F {
  let t: any;
  return ((...args: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }) as F;
}

/** Simple fuzzy match — returns score or -1; also produces highlight ranges. */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase(), t = target.toLowerCase();
  let qi = 0, score = 0, streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++; streak++;
      score += 10 + streak * 4 + (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '.' ? 8 : 0);
    } else streak = 0;
  }
  return qi === q.length ? score : -1;
}

/** Escape HTML text content. */
export function escape(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
