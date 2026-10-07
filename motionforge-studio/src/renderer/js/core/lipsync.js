// Smart lip sync. Two sources:
//  • Audio  – short-time spectral analysis (RMS, zero-crossings, band energies, F1/F2 spectral peaks) → A E I O U M F L Rest
//  • Script – text → phoneme-ish visemes timed across the voiced span of the audio (or a given duration)
// Output: one viseme index (see VISEMES in rig.js) per project frame, written to the character's `mouth` track as hold keys.
export const VIS = ['rest', 'A', 'E', 'I', 'O', 'U', 'M', 'F', 'L']; // must match rig.js VISEMES
export const MIN_HOLD = 2; // frames

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2; const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
}
function mono(buf, t0, t1) {
  const sr = buf.sampleRate, a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(buf.length, Math.floor(t1 * sr));
  const n = Math.max(0, b - a); const out = new Float32Array(n); const chn = buf.numberOfChannels || 1;
  for (let c = 0; c < chn; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[a + i] / chn; }
  return { data: out, sr };
}
const percentile = (arr, p) => { const s = Array.from(arr).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const yieldNow = () => new Promise((r) => setTimeout(r, 0));

/** Spectral features for hops of `hop` seconds. */
export async function analyze(buf, { t0 = 0, t1 = buf.duration, hop = 0.01, onProgress } = {}) {
  const { data, sr } = mono(buf, t0, t1); const N = 1024; const hopS = Math.max(1, Math.round(hop * sr));
  const nH = Math.max(0, Math.floor((data.length - N) / hopS) + 1);
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N); const binHz = sr / N;
  const F = []; const sm = new Float64Array(N / 2);
  for (let h = 0; h < nH; h++) {
    const s = h * hopS; let e = 0, zc = 0, prev = 0;
    for (let i = 0; i < N; i++) { const x = data[s + i]; const y = x - 0.95 * prev; prev = x; re[i] = y * win[i]; im[i] = 0; e += x * x; if (i && (x >= 0) !== (data[s + i - 1] >= 0)) zc++; }
    const rms = Math.sqrt(e / N); fft(re, im);
    const mag = new Float64Array(N / 2); let tot = 0, low = 0, hi = 0, mid = 0;
    for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); mag[k] = m; const f = k * binHz; const p = m * m; tot += p; if (f < 500) low += p; else if (f < 3500) mid += p; else if (f < 9000) hi += p; }
    // smoothed log envelope (~170 Hz) for formant picking
    const w = Math.max(1, Math.round(85 / binHz)); let acc = 0; const L = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) L[k] = Math.log(mag[k] + 1e-9);
    for (let k = 0; k < N / 2; k++) { acc = 0; let c = 0; for (let j = Math.max(0, k - w); j <= Math.min(N / 2 - 1, k + w); j++) { acc += L[j]; c++; } sm[k] = acc / c; }
    const peak = (fa, fb) => { let bk = -1, bv = -1e9; for (let k = Math.ceil(fa / binHz); k <= Math.min(N / 2 - 2, Math.floor(fb / binHz)); k++) { if (sm[k] >= sm[k - 1] && sm[k] >= sm[k + 1] && sm[k] > bv) { bv = sm[k]; bk = k; } } return bk > 0 ? bk * binHz : 0; };
    const f1 = peak(230, 1000); let f2 = peak(Math.max(f1 + 350, 800), 3300); if (!f2) f2 = peak(800, 3300);
    F.push({ rms, zcr: zc / N * sr / 2, low: low / (tot + 1e-12), mid: mid / (tot + 1e-12), hi: hi / (tot + 1e-12), f1, f2 });
    if (h % 150 === 0) { onProgress && onProgress(h / nH); await yieldNow(); }
  }
  return { feats: F, hop: hopS / sr, t0 };
}

/** Classify hops into visemes, then resample onto project frames. */
export function classify(an, { fps, frames, sens = 1 }) {
  const F = an.feats; if (!F.length) return new Array(frames).fill(0);
  const rmsAll = F.map((f) => f.rms); const ref = percentile(rmsAll, 0.95) || 1e-4; const floor = Math.max(percentile(rmsAll, 0.1) * 1.5, ref * 0.06 / sens, 1e-4);
  const raw = F.map((f, i) => {
    if (f.rms < floor) return 0;
    const fric = f.hi > 0.45 && f.zcr > 2500 && f.low < 0.25;
    if (fric) return 7; // F (f, v, s, sh …)
    // bilabial closure: a dip inside voiced speech
    const nb = [F[i - 3], F[i + 3]].filter(Boolean); const around = nb.length ? nb.reduce((a, b) => a + b.rms, 0) / nb.length : f.rms;
    if (nb.length === 2 && f.rms < around * 0.38 && f.low > 0.7 && f.rms > floor) return 6; // M
    const f1 = f.f1 || 500, f2 = f.f2 || 1500;
    if (f.hi > 0.3 && f.zcr > 2000) return 7;
    if (f1 > 640) return 1; // A (open)
    if (f1 > 440) { if (f2 > 1750) return 2; return f2 < 1100 ? 4 : 1; } // E / O
    if (f2 > 2050) return 3; // I
    if (f2 < 1050) return f1 < 380 ? 5 : 4; // U / O
    if (f.rms < ref * 0.35 && f2 > 1150 && f2 < 1800) return 8; // L (liquid / weak voiced)
    return f2 > 1600 ? 3 : 5;
  });
  // majority smoothing over 5 hops
  const sm = raw.map((_, i) => { const c = new Array(9).fill(0); for (let j = -2; j <= 2; j++) { const v = raw[i + j]; if (v != null) c[v] += (j === 0 ? 1.5 : 1); } let b = 0; for (let k = 1; k < 9; k++) if (c[k] > c[b]) b = k; return c[b] > 0 ? b : raw[i]; });
  const out = new Array(frames).fill(0);
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f / fps / an.hop), b = Math.max(a + 1, Math.floor((f + 1) / fps / an.hop)); const c = new Array(9).fill(0);
    for (let i = a; i < b && i < sm.length; i++) c[sm[i]] += 1 + (sm[i] === 6 ? 2 : 0);
    let best = 0, bv = 0; for (let k = 0; k < 9; k++) if (c[k] > bv) { bv = c[k]; best = k; } out[f] = best;
  }
  return enforceHold(out, MIN_HOLD);
}
/** Min-hold: runs shorter than `min` frames are absorbed by the neighbour (rest between identical shapes disappears). */
export function enforceHold(seq, min = MIN_HOLD) {
  const s = seq.slice();
  for (let pass = 0; pass < 3; pass++) {
    let i = 0;
    while (i < s.length) {
      let j = i; while (j + 1 < s.length && s[j + 1] === s[i]) j++;
      const len = j - i + 1;
      if (len < min && !(i === 0 && j === s.length - 1)) {
        const prev = i > 0 ? s[i - 1] : null, next = j + 1 < s.length ? s[j + 1] : null;
        const fill = prev == null ? next : next == null ? prev : (s[i] === 0 ? prev : (prev === 0 ? next : prev));
        if (fill != null) for (let k = i; k <= j; k++) s[k] = fill;
      }
      i = j + 1;
    }
  }
  return s;
}

// ───────────── script mode ─────────────
const VOW = { a: 1, e: 2, i: 3, o: 4, u: 5 };
export function textToVisemeUnits(text) {
  const t = text.toLowerCase().replace(/[^a-z'\s]/g, ' ').replace(/'/g, ''); const words = t.split(/\s+/).filter(Boolean); const units = [];
  const push = (v, w = 1) => units.push({ v, w });
  words.forEach((word, wi) => {
    for (let i = 0; i < word.length; i++) {
      const c = word[i], n = word[i + 1], d = c + (n || '');
      if (d === 'ee' || d === 'ea' || d === 'ie') { push(3, 1.6); i++; continue; }
      if (d === 'oo' || d === 'ou' || d === 'ew') { push(5, 1.6); i++; continue; }
      if (d === 'ai' || d === 'ay') { push(2, 1.6); i++; continue; }
      if (d === 'oa' || d === 'ow' || d === 'au' || d === 'aw') { push(4, 1.6); i++; continue; }
      if (d === 'th' || d === 'sh' || d === 'ch') { push(d === 'th' ? 8 : 7, 0.8); i++; continue; }
      if (d === 'ph') { push(7, 0.8); i++; continue; }
      if (VOW[c]) { push(VOW[c], 1.4); continue; }
      if (c === 'y') { push(word.length === 1 || i === word.length - 1 ? 3 : 8, 1); continue; }
      if ('mbp'.includes(c)) { push(6, 0.9); continue; }
      if ('fvsz'.includes(c)) { push(7, 0.8); continue; }
      if ('lrnt'.includes(c) && c !== 't') { push(8, 0.7); continue; }
      if ('dtkgjcqxwh'.includes(c)) { if (c === 'w') push(5, 0.8); else if ('tdkg'.includes(c) && units.length) units[units.length - 1].w += 0.25; continue; }
    }
    if (wi < words.length - 1) push(0, 0.9);
  });
  return units;
}
/** Distribute script units across [0, frames). Returns viseme-per-frame array. */
export function scriptToFrames(text, frames, { from = 0, to = frames - 1 } = {}) {
  const units = textToVisemeUnits(text); const out = new Array(frames).fill(0); if (!units.length || to <= from) return out;
  const total = units.reduce((a, u) => a + u.w, 0); const span = to - from + 1; let acc = 0;
  for (const u of units) { const a = from + Math.round(acc / total * span); acc += u.w; const b = from + Math.round(acc / total * span); for (let f = a; f < Math.max(b, a + 1) && f <= to; f++) out[f] = u.v; }
  return enforceHold(out, MIN_HOLD);
}
/** Voiced span (first/last non-rest frame) of a classified sequence. */
export function voicedSpan(seq) { let a = seq.findIndex((v) => v !== 0); let b = seq.length - 1; while (b >= 0 && seq[b] === 0) b--; return a < 0 ? null : { from: a, to: b }; }

/** Combine: use the audio's rest/voiced pattern for timing, script for the shapes. */
export function mergeScriptWithAudio(audioSeq, text) {
  const span = voicedSpan(audioSeq); if (!span) return audioSeq;
  const scr = scriptToFrames(text, audioSeq.length, span);
  // keep audio pauses (long rests) as rest
  return enforceHold(scr.map((v, f) => (f >= span.from && f <= span.to && audioSeq[f] === 0 && isPause(audioSeq, f) ? 0 : v)), MIN_HOLD);
}
function isPause(seq, f) { let a = f, b = f; while (a > 0 && seq[a - 1] === 0) a--; while (b < seq.length - 1 && seq[b + 1] === 0) b++; return b - a + 1 >= 4; }

/** Write keys on layer.tracks.mouth over [start, start+seq.length). */
export async function applyVisemeFrames(layer, seq, start) {
  const { setKey } = await import('./anim.js'); const { H } = await import('./history.js'); const { S, bus } = await import('./state.js');
  return H.tx('Lip sync', () => {
    layer.tracks = layer.tracks || {}; const tr = (layer.tracks.mouth = layer.tracks.mouth || []);
    const end = start + seq.length;
    for (let i = tr.length - 1; i >= 0; i--) if (tr[i].f >= start && tr[i].f <= end) tr.splice(i, 1);
    let prev = -1, n = 0;
    for (let i = 0; i < seq.length; i++) if (seq[i] !== prev) { setKey(tr, start + i, seq[i], 'hold'); prev = seq[i]; n++; }
    if (prev !== 0) { setKey(tr, end, 0, 'hold'); n++; }
    bus.emit('change'); return n;
  });
}
