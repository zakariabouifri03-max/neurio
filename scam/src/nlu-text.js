/* ============================================================================
 * Scam Baqi — nlu-text.js
 * Text normalisation + feature extraction shared by the offline neural NLU
 * (scam/src/nlu.js) and its trainer (tools/train-nlu.mjs).
 *
 * Dual target: browser (window.SWYF_NLU_TEXT) and Node (module.exports) so the
 * training code and the game provably use the *same* features.
 *
 * 100% offline, zero dependencies.
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SWYF_NLU_TEXT = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

  // ---- Arabizi (Latin/Darija typed in latin letters + digits) → Arabic ------
  // Longest patterns first.
  var DIGRAPHS = [
    ['ch', 'ش'], ['sh', 'ش'], ['kh', 'خ'], ['gh', 'غ'], ['th', 'ث'], ['dh', 'ذ'],
    ['aa', 'ا'], ['ee', 'ي'], ['oo', 'و'], ['ou', 'و'], ['ai', 'اي'], ['ay', 'اي'],
    ['ei', 'اي'], ['ss', 'س'], ['tt', 'ت'], ['ll', 'ل'], ['mm', 'م'], ['nn', 'ن'],
    ['rr', 'ر'], ['bb', 'ب'], ['dd', 'د'], ['zz', 'ز'], ['ff', 'ف'], ['kk', 'ك']
  ];
  var SINGLE = {
    a: 'ا', b: 'ب', c: 'ك', d: 'د', e: 'ي', f: 'ف', g: 'ق', h: 'ه', i: 'ي',
    j: 'ج', k: 'ك', l: 'ل', m: 'م', n: 'ن', o: 'و', p: 'ب', q: 'ق', r: 'ر',
    s: 'س', t: 'ت', u: 'و', v: 'ف', w: 'و', x: 'كس', y: 'ي', z: 'ز',
    '2': 'ا', '3': 'ع', '4': 'غ', '5': 'خ', '6': 'ط', '7': 'ح', '8': 'ق', '9': 'ق',
    é: 'ي', è: 'ي', ê: 'ي', à: 'ا', â: 'ا', î: 'ي', ô: 'و', û: 'و', ç: 'س', ñ: 'ن'
  };

  function latinToArabic(word) {
    var w = word.toLowerCase(), out = '', i = 0;
    while (i < w.length) {
      var two = w.substr(i, 2), hit = null;
      for (var d = 0; d < DIGRAPHS.length; d++) if (DIGRAPHS[d][0] === two) { hit = DIGRAPHS[d][1]; break; }
      if (hit) { out += hit; i += 2; continue; }
      var c = w[i];
      out += SINGLE[c] != null ? SINGLE[c] : (/[a-z0-9]/.test(c) ? '' : c);
      i++;
    }
    return out;
  }

  function arabicNorm(s) {
    return String(s || '')
      .replace(AR_DIAC, '')
      .replace(/[\u0623\u0625\u0622\u0671\u0622]/g, '\u0627')   // أ إ آ ٱ → ا
      .replace(/\u0649/g, '\u064A')                              // ى → ي
      .replace(/\u0624/g, '\u0648')                              // ؤ → و
      .replace(/\u0626/g, '\u064A')                              // ئ → ي
      .replace(/\u0629/g, '\u0647')                              // ة → ه
      .replace(/[\u0660-\u0669]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48); })
      .replace(/\u0621/g, '');                                   // ء → (drop: too noisy)
  }

  /**
   * Normalise free text (Arabic script, Darija in Latin script, or a mix) into a
   * single canonical Arabic-script-ish form.
   */
  function normalize(s) {
    s = String(s == null ? '' : s).toLowerCase();
    if (!s) return '';
    var tokens = s.split(/[^0-9a-zA-Z\u0600-\u06FF]+/);
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t) continue;
      if (/[a-z]/.test(t)) {
        // word has latin letters → transliterate arabizi (even if it has digits)
        out.push(arabicNorm(latinToArabic(t)));
      } else {
        out.push(arabicNorm(t));
      }
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  // ---- FNV-1a hashing -------------------------------------------------------
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * Sparse feature extraction: word unigrams + char 3/4-grams (with boundary
   * markers) + a couple of shape features. Returns [{i, v}] pairs with v>0.
   * `dim` buckets. Same code path in training and at runtime.
   */
  function features(text, dim) {
    dim = dim || 8192;
    var norm = normalize(text);
    var acc = {};                                  // bucket → count
    function add(key, w) {
      var b = fnv(key) % dim;
      acc[b] = (acc[b] || 0) + (w == null ? 1 : w);
    }
    if (norm) {
      var words = norm.split(' ');
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        add('w:' + w);
        if (i + 1 < words.length) add('b:' + w + '_' + words[i + 1], 0.7);
        var padded = '^' + w + '$';
        for (var n = 3; n <= 4; n++) {
          for (var j = 0; j + n <= padded.length; j++) add('c' + n + ':' + padded.substr(j, n), 0.8);
        }
      }
      add('len:' + Math.min(12, words.length));
      add('q:' + (/[?؟]/.test(text) ? 'y' : 'n'));
    } else {
      add('empty');
    }
    var keys = Object.keys(acc), out = new Array(keys.length);
    for (var k = 0; k < keys.length; k++) out[k] = { i: +keys[k], v: acc[keys[k]] };
    return out;
  }

  function l2norm(pairs) {
    var s = 0;
    for (var i = 0; i < pairs.length; i++) s += pairs[i].v * pairs[i].v;
    s = Math.sqrt(s) || 1;
    for (var j = 0; j < pairs.length; j++) pairs[j].v /= s;
    return pairs;
  }

  // ---- char n-gram set (for similarity / novelty checks) --------------------
  function charGrams(text, n) {
    n = n || 3;
    var norm = normalize(text).replace(/ /g, '^');
    var set = {};
    for (var i = 0; i + n <= norm.length; i++) set[norm.substr(i, n)] = 1;
    return set;
  }
  function similarity(a, b) {
    var A = charGrams(a, 3), B = charGrams(b, 3), inter = 0, ka = 0, kb = 0, k;
    for (k in A) { ka++; if (B[k]) inter++; }
    for (k in B) kb++;
    if (!ka || !kb) return 0;
    return inter / Math.sqrt(ka * kb);            // cosine over char-3gram sets
  }

  return {
    normalize: normalize,
    features: features,
    l2norm: l2norm,
    fnv: fnv,
    similarity: similarity,
    charGrams: charGrams,
    arabize: function (s) { return normalize(s); }
  };
});
