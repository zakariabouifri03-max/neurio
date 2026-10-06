/* Etsy Insight Pro — keywords.js
 * On-page keyword research: extracts terms from the titles/descriptions
 * visible on a search-results page or shop page. No external API, no fake
 * search-volume numbers — frequency and competition come from the visible
 * results only, and the UI must say so.
 */
(function initKeywords(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('keywords');

  const STOPWORDS = new Set((
    'a,an,the,and,or,for,with,without,of,to,in,on,at,by,from,as,is,are,was,were,be,been,' +
    'this,that,these,those,it,its,you,your,our,we,they,their,them,his,her,she,he,i,me,my,' +
    'new,sale,free,custom,handmade,etsy,shop,gift,gifts,personalized,personalised,unique,' +
    'best,seller,original,authentic,vintage,style,design,art,decor,home,set,lot,pack,kit,' +
    'small,large,medium,big,mini,bulk,wholesale,made,usa,uk,prime,day,deal,deals,top,hot'
  ).split(','));

  /** Split a title into candidate keywords (1–3 word phrases). */
  function phrasesFromTitle(title) {
    const U = EIP.utils;
    const words = U.tokenize(title).filter(w => !STOPWORDS.has(w) && w.length >= 2);
    const out = [];
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const phrase = words.slice(i, i + n).join(' ');
        if (phrase.length >= 3) out.push(phrase);
      }
    }
    return out;
  }

  /**
   * Analyse a list of { title, price, reviews, rating } items.
   * @returns { rows, suggestions, coverage }
   * rows: [{ keyword, frequency, productsUsing, sharePct, avgPrice, avgReviews,
   *          avgRating, demand, competition, opportunity }]
   */
  function analyzeKeywords(items, options) {
    const U = EIP.utils;
    const opts = options || {};
    const minFrequency = opts.minFrequency || 2;
    const maxRows = opts.maxRows || 60;
    const list = Array.isArray(items) ? items : [];
    const total = list.length;

    const stats = new Map(); // phrase → { count, priceSum, priceN, revSum, revN, rateSum, rateN, idx:Set }
    list.forEach((item, idx) => {
      const seen = new Set();
      for (const phrase of phrasesFromTitle(item && item.title)) {
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        if (!stats.has(phrase)) stats.set(phrase, { count: 0, priceSum: 0, priceN: 0, revSum: 0, revN: 0, rateSum: 0, rateN: 0 });
        const st = stats.get(phrase);
        st.count++;
        if (Number.isFinite(item.price)) { st.priceSum += item.price; st.priceN++; }
        if (Number.isFinite(item.reviews)) { st.revSum += item.reviews; st.revN++; }
        if (Number.isFinite(item.rating)) { st.rateSum += item.rating; st.rateN++; }
      }
    });

    const rows = [];
    for (const [keyword, st] of stats) {
      if (st.count < minFrequency && !keyword.includes(' ')) continue; // keep bar low for long-tail
      if (st.count < minFrequency && st.count < 2) continue;
      const share = total ? st.count / total : 0;
      const avgPrice = st.priceN ? st.priceSum / st.priceN : null;
      const avgReviews = st.revN ? st.revSum / st.revN : null;
      const avgRating = st.rateN ? st.rateSum / st.rateN : null;
      // Competition ≈ share of results using it (more = tougher), 0–100.
      const competition = U.score(share * 100);
      // Demand ≈ review gravity of products using it (log scale), 0–100.
      const demand = U.score(U.logNorm(avgReviews || 0, 500) * 70 + U.logNorm(st.count, 30) * 30);
      const opportunity = EIP.scores
        ? EIP.scores.opportunityScore(demand, competition, U.score(U.logNorm((avgPrice || 0) * (avgReviews || 0) / 10, 5000) * 100)).value
        : Math.round(demand * 0.6 + (100 - competition) * 0.4);
      rows.push({
        keyword, frequency: st.count, productsUsing: st.count,
        sharePct: Math.round(share * 1000) / 10, avgPrice, avgReviews, avgRating,
        demand, competition, opportunity,
        longTail: keyword.trim().split(/\s+/).length >= 3
      });
    }
    rows.sort((a, b) => b.opportunity - a.opportunity || b.frequency - a.frequency);

    // Suggestions: high-opportunity long-tail + frequent modifiers.
    const longTail = rows.filter(r => r.longTail).slice(0, 8).map(r => r.keyword);
    const frequent = rows.filter(r => !r.longTail).slice(0, 8).map(r => r.keyword);
    const suggestions = [...longTail, ...frequent].slice(0, 12);

    return {
      rows: rows.slice(0, maxRows),
      totalPhrases: stats.size,
      suggestions,
      coverage: { itemsAnalysed: total, note: total < 10 ? 'Few visible results — scroll Etsy to load more, then re-analyse.' : `${total} visible listings analysed.` }
    };
  }

  EIP.keywords = { analyzeKeywords, phrasesFromTitle, STOPWORDS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
