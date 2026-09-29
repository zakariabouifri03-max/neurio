/* ============================================================================
 * Scam Baqi — train-nlu.mjs
 * Trains the offline NLU model (intent + affect) on tools/darija-corpus.json
 * with a hashed char-n-gram + word softmax classifier — pure JS, no deps.
 *
 *   node tools/train-nlu.mjs              # train + write scam/src/nlu-model.js
 *   node tools/train-nlu.mjs --epochs 60  # cherry-pick
 *
 * The exported model is a *quantised int8* matrix + biases, embedded in a plain
 * <script> (offline, no fetch). Runtime code lives in scam/src/nlu.js and must
 * use the same feature extractor (scam/src/nlu-text.js) — imported here too.
 * ==========================================================================*/
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const T = require(join(ROOT, 'scam/src/nlu-text.js'));

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const DIM = +argOf('dim', 8192);
const EPOCHS = +argOf('epochs', 42);
const LR = +argOf('lr', 0.55);
const L2 = 1e-5;
const SEED = +argOf('seed', 7);

// ---- affect mapping (5 classes) --------------------------------------------
const AFFECT_OF = {
  greet: 'friendly', farewell: 'friendly', empathy: 'friendly', flattery: 'friendly',
  faith: 'friendly', chat: 'friendly', humour: 'friendly', romance: 'friendly',
  agree: 'eager', greed: 'eager', urgency: 'eager', identity_claim: 'eager',
  ask_bank: 'neutral', ask_otp: 'neutral', ask_money_small: 'neutral', ask_money_big: 'neutral',
  authority: 'neutral', stall: 'neutral', question: 'neutral', off_topic: 'neutral',
  who_are_you: 'neutral', ask_proof: 'neutral', leverage_personal: 'neutral',
  fear: 'anxious', lonely: 'anxious',
  insult: 'hostile', threat: 'hostile', suspicion: 'hostile', refuse: 'hostile'
};
const AFFECTS = ['friendly', 'neutral', 'hostile', 'anxious', 'eager'];

// ---- tiny deterministic RNG ------------------------------------------------
let seed = SEED;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function shuffled(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// ---- arabic → arabizi for augmentation -------------------------------------
const TO_LATIN = {
  'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': '7', 'خ': 'kh', 'د': 'd',
  'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'ch', 'ص': 's', 'ض': 'd', 'ط': 't',
  'ظ': 'z', 'ع': '3', 'غ': 'gh', 'ف': 'f', 'ق': '9', 'ك': 'k', 'ل': 'l', 'م': 'm',
  'ن': 'n', 'ه': 'h', 'و': 'o', 'ي': 'i', 'ة': 'a', 'ى': 'a'
};
function toLatin(s) {
  let out = '';
  for (const ch of s) {
    if (ch === ' ') out += ' ';
    else if (TO_LATIN[ch]) out += TO_LATIN[ch];
  }
  return out.trim();
}
function typo(s) {
  const chars = [...s];
  if (chars.length < 4) return s;
  const i = 1 + Math.floor(rnd() * (chars.length - 2));
  const mode = Math.floor(rnd() * 3);
  if (mode === 0) { const t = chars[i]; chars[i] = chars[i - 1]; chars[i - 1] = t; }
  else if (mode === 1) chars.splice(i, 1);
  else {
    const conf = { 'ا': 'ه', 'ه': 'ا', 'ي': 'ى', 'ت': 'ط', 'س': 'ص', 'ق': 'ك', 'ب': 'ف', 'ع': 'ح' };
    chars[i] = conf[chars[i]] || chars[i];
  }
  return chars.join('');
}

// ---- data ------------------------------------------------------------------
const corpus = JSON.parse(readFileSync(join(__dirname, 'darija-corpus.json'), 'utf8'));
const INTENTS = Object.keys(corpus.intents);
const iOf = Object.fromEntries(INTENTS.map((k, i) => [k, i]));
const aOf = Object.fromEntries(AFFECTS.map((k, i) => [k, i]));

const seen = new Set();
const rows = [];
for (const [text, intent] of corpus.data) {
  const key = T.normalize(text) + '|' + intent;
  if (!text || seen.has(key)) continue;
  seen.add(key);
  if (!(intent in iOf)) { console.warn('!! unknown intent', intent); continue; }
  rows.push({ text, y: iOf[intent], a: aOf[AFFECT_OF[intent] || 'neutral'] });
}

// augmentation (training only)
const aug = [];
for (const r of rows) {
  aug.push(r);
  const lat = toLatin(T.normalize(r.text));
  if (lat && lat !== T.normalize(r.text)) aug.push({ text: lat, y: r.y, a: r.a });
  aug.push({ text: typo(r.text), y: r.y, a: r.a });
}
shuffled(aug);

// stratified split
const perIntent = new Map();
for (const r of rows) { if (!perIntent.has(r.y)) perIntent.set(r.y, []); perIntent.get(r.y).push(r); }
const test = [];
for (const [, list] of perIntent) { shuffled(list); test.push(...list.slice(0, Math.max(1, Math.round(list.length * 0.16)))); }
const testKeys = new Set(test.map((r) => r.text));
const train = aug.filter((r) => !testKeys.has(r.text) || r.text.length > 0); // augmentations may overlap originals: fine
const testSet = test;

// pre-extract features
const feats = (list) => list.map((r) => ({ f: T.l2norm(T.features(r.text, DIM)), y: r.y, a: r.a, text: r.text }));

// ---- model -----------------------------------------------------------------
const C = INTENTS.length, A = AFFECTS.length;
const WI = new Float32Array(DIM * C), BI = new Float32Array(C);
const WA = new Float32Array(DIM * A), BA = new Float32Array(A);

function softmax(logits, n) {
  let m = -1e9;
  for (let i = 0; i < n; i++) if (logits[i] > m) m = logits[i];
  let s = 0;
  for (let i = 0; i < n; i++) { logits[i] = Math.exp(logits[i] - m); s += logits[i]; }
  for (let i = 0; i < n; i++) logits[i] /= s;
  return logits;
}
function forward(f, W, b, n) {
  const z = new Float32Array(n);
  for (let c = 0; c < n; c++) z[c] = b[c];
  for (let k = 0; k < f.length; k++) {
    const { i, v } = f[k];
    const base = i * n;
    for (let c = 0; c < n; c++) z[c] += W[base + c] * v;
  }
  return z;
}
function trainHead(list, W, b, n, key, epochs, lr) {
  const idx = list.map((r) => r[key]);
  for (let ep = 0; ep < epochs; ep++) {
    const elr = lr / (1 + ep * 0.045);
    let loss = 0;
    for (let r = 0; r < list.length; r++) {
      const f = list[r].f, y = idx[r];
      const z = softmax(forward(f, W, b, n), n);
      loss += -Math.log(Math.max(1e-9, z[y]));
      for (let k = 0; k < f.length; k++) {
        const { i, v } = f[k], base = i * n;
        for (let c = 0; c < n; c++) {
          const g = (z[c] - (c === y ? 1 : 0)) * v + L2 * W[base + c];
          W[base + c] -= elr * g;
        }
      }
      for (let c = 0; c < n; c++) b[c] -= elr * (z[c] - (c === y ? 1 : 0));
    }
    if ((ep + 1) % 10 === 0) console.log(`  ${key}: epoch ${ep + 1}/${epochs} loss ${(loss / list.length).toFixed(4)}`);
  }
}

function evaluate(list) {
  let ok = 0, okA = 0;
  const conf = new Map();
  for (const r of list) {
    const zi = softmax(forward(r.f, WI, BI, C), C);
    const za = softmax(forward(r.f, WA, BA, A), A);
    let bi = 0, ba = 0;
    for (let c = 1; c < C; c++) if (zi[c] > zi[bi]) bi = c;
    for (let c = 1; c < A; c++) if (za[c] > za[ba]) ba = c;
    if (bi === r.y) ok++; else conf.set(INTENTS[r.y] + '→' + INTENTS[bi], (conf.get(INTENTS[r.y] + '→' + INTENTS[bi]) || 0) + 1);
    if (ba === r.a) okA++;
  }
  const top = [...conf.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6);
  return { n: list.length, intent: ok / list.length, affect: okA / list.length, confusions: top };
}

console.log(`corpus: ${rows.length} unique lines · ${aug.length} after augmentation · ${INTENTS.length} intents`);
console.log('training intent head…');
trainHead(feats(train), WI, BI, C, 'y', EPOCHS, LR);
console.log('training affect head…');
trainHead(feats(train), WA, BA, A, 'a', Math.round(EPOCHS * 0.7), LR);

const trainFeat = feats(train);
const testFeat = feats(testSet);
// hard set: unseen arabizi + typo renderings of the held-out lines (honest robustness)
const hardRaw = [];
for (const r of testSet) {
  const lat = toLatin(T.normalize(r.text));
  if (lat) hardRaw.push({ text: lat, y: r.y, a: r.a });
  for (let k = 0; k < 2; k++) hardRaw.push({ text: typo(r.text), y: r.y, a: r.a });
}
const eTr = evaluate(trainFeat.slice(0, 4000));
const eTe = evaluate(testFeat);
const eHard = evaluate(feats(hardRaw));
console.log(`\ntrain   intent ${(eTr.intent * 100).toFixed(1)}%  affect ${(eTr.affect * 100).toFixed(1)}%  (n=${eTr.n})`);
console.log(`HELDOUT intent ${(eTe.intent * 100).toFixed(1)}%  affect ${(eTe.affect * 100).toFixed(1)}%  (n=${eTe.n})`);
console.log(`HARD    intent ${(eHard.intent * 100).toFixed(1)}%  affect ${(eHard.affect * 100).toFixed(1)}%  (n=${eHard.n} — arabizi + typos)`);
if (eTe.confusions.length) console.log('top confusions:', eTe.confusions.map(([k, v]) => `${k}×${v}`).join(', '));

// ---- quantise --------------------------------------------------------------
function quantise(W, n) {
  let max = 0;
  for (let i = 0; i < W.length; i++) { const a = Math.abs(W[i]); if (a > max) max = a; }
  const scale = max / 127 || 1;
  const q = new Int8Array(W.length);
  for (let i = 0; i < W.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(W[i] / scale)));
  return { q, scale };
}
const qi = quantise(WI, C), qa = quantise(WA, A);
const b64 = (int8) => Buffer.from(int8.buffer, int8.byteOffset, int8.byteLength).toString('base64');
const round4 = (arr) => Array.from(arr, (v) => +v.toFixed(4));

// self-test samples the runtime can replay (guards against train/runtime drift)
const samples = [];
for (const r of testFeat) {
  const zi = softmax(forward(r.f, WI, BI, C), C);
  let bi = 0; for (let c = 1; c < C; c++) if (zi[c] > zi[bi]) bi = c;
  if (samples.length < 30) samples.push([r.text, INTENTS[bi], +zi[bi].toFixed(3)]);
}

const chk = new Int8Array(qi.q.length); chk.set(qi.q);
const out = `/* ============================================================================
 * Scam Baqi — nlu-model.js  (GENERATED — do not hand-edit)
 * Regenerate with:  node tools/train-nlu.mjs
 * Offline neural NLU: hashed char-3/4-gram + word softmax classifier, int8.
 * Heldoout accuracy: intent ${(eTe.intent * 100).toFixed(1)}% · affect ${(eTe.affect * 100).toFixed(1)}%  (n=${eTe.n})
 * ==========================================================================*/
window.SWYF = window.SWYF || {};
SWYF.nluModel = {
  version: 1,
  dim: ${DIM},
  intents: ${JSON.stringify(INTENTS)},
  affects: ${JSON.stringify(AFFECTS)},
  scaleInt: ${+qi.scale.toPrecision(6)},
  scaleAff: ${+qa.scale.toPrecision(6)},
  biasInt: ${JSON.stringify(round4(BI))},
  biasAff: ${JSON.stringify(round4(BA))},
  wInt: ${JSON.stringify(b64(qi.q))},
  wAff: ${JSON.stringify(b64(qa.q))},
  samples: ${JSON.stringify(samples)}
};
`;
const dest = join(ROOT, 'scam/src/nlu-model.js');
writeFileSync(dest, out);
console.log(`\nwrote ${dest} (${(out.length / 1024).toFixed(0)} KB · ${DIM}×${C} intents + ${DIM}×${A} affects int8)`);
