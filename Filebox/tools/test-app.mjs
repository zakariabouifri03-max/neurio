// Smoke test for the app logic that does not need a DOM:
//   · every T() key used in the UI exists in all three languages
//   · every import resolves to a real export
//   · a full "import → vault → verify → extract" workflow using the REAL zip.js
//
//   node tools/test-app.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
let failures = 0;
const check = (ok, label, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
};

// ── 1. i18n coverage ────────────────────────────────────────────────────────
const { STRINGS } = await import('../web/src/i18n.js');
const langs = Object.keys(STRINGS);
const usedKeys = new Set();
for (const f of ['app.js', 'util.js']) {
  const src = readFileSync(join(WEB, 'src', f), 'utf8');
  for (const m of src.matchAll(/\bT\(\s*'([a-z0-9_]+)'/g)) usedKeys.add(m[1]);
}
const missing = [];
for (const k of usedKeys) for (const l of langs) if (STRINGS[l][k] == null) missing.push(`${l}:${k}`);
check(missing.length === 0, `all ${usedKeys.size} T() keys exist in ${langs.join('/')}`,
  missing.length ? '\n      missing: ' + missing.join(', ') : '');

// placeholder arity must match across languages
const arityBad = [];
for (const k of usedKeys) {
  const arities = langs.map((l) => (STRINGS[l][k]?.match(/\{\d+\}/g) || []).length);
  if (new Set(arities).size > 1) arityBad.push(k);
}
check(arityBad.length === 0, 'placeholder counts agree across languages', arityBad.join(', '));

// ── 2. import/export consistency ────────────────────────────────────────────
const modules = {
  'util.js': await import('../web/src/util.js'),
  'zip.js': await import('../web/src/zip.js'),
  'i18n.js': await import('../web/src/i18n.js'),
  'db.js': await import('../web/src/db.js'),   // opens IndexedDB lazily, safe to import
};
const importBad = [];
for (const f of ['app.js', 'db.js', 'util.js']) {
  const src = readFileSync(join(WEB, 'src', f), 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([a-z]+)\.js'/g)) {
    const mod = modules[m[2] + '.js'];
    if (!mod) { importBad.push(`${f}: unknown module ./${m[2]}.js`); continue; }
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name && !(name in mod)) importBad.push(`${f}: ./${m[2]}.js has no export "${name}"`);
    }
  }
  for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s*from\s*'\.\/([a-z]+)\.js'/g)) {
    if (!modules[m[2] + '.js']) importBad.push(`${f}: unknown module ./${m[2]}.js`);
  }
}
// app.js calls DB.<fn>() — make sure each one exists
const appSrc = readFileSync(join(WEB, 'src', 'app.js'), 'utf8');
const dbMod = modules['db.js'] ?? null;
const dbUsed = new Set([...appSrc.matchAll(/\bDB\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
check(importBad.length === 0, 'every named import resolves', importBad.join('; '));

// db.js exports are checked by reading its source (importing it needs indexedDB)
const dbSrc = readFileSync(join(WEB, 'src', 'db.js'), 'utf8');
const dbExports = new Set([...dbSrc.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z]+)/g)].map((m) => m[1]));
[...dbSrc.matchAll(/export\s*\{([^}]+)\}/g)].forEach((m) =>
  m[1].split(',').forEach((n) => dbExports.add(n.trim())));
const dbMissing = [...dbUsed].filter((n) => !dbExports.has(n));
check(dbMissing.length === 0, `app.js uses ${dbUsed.size} DB.* functions, all exported`,
  dbMissing.length ? 'missing: ' + dbMissing.join(', ') : '');

// ── 3. assets referenced by index.html / sw.js exist ────────────────────────
const swSrc = readFileSync(join(WEB, 'sw.js'), 'utf8');
const assets = [...swSrc.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter((p) => p !== '');
const missingAssets = assets.filter((p) => !existsSync(join(WEB, p)));
check(missingAssets.length === 0, `all ${assets.length} service-worker assets exist`,
  missingAssets.join(', '));

const html = readFileSync(join(WEB, 'index.html'), 'utf8');
const htmlRefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !u.startsWith('http') && !u.startsWith('#'));
const missingHtml = htmlRefs.filter((p) => !existsSync(join(WEB, p)));
check(missingHtml.length === 0, `all ${htmlRefs.length} index.html references exist`, missingHtml.join(', '));

// manifest is valid JSON with the icons it claims
const manifest = JSON.parse(readFileSync(join(WEB, 'manifest.webmanifest'), 'utf8'));
const missingIcons = manifest.icons.map((i) => i.src).filter((p) => !existsSync(join(WEB, p)));
check(missingIcons.length === 0, 'manifest icons exist', missingIcons.join(', '));
check(manifest.start_url === './index.html', 'manifest start_url points at index.html');

// ── 4. end-to-end vault workflow on the real zip.js ─────────────────────────
const { zipCreate, zipList, zipExtractAll, zipVerify, zipExtractEntry } = modules['zip.js'];
const { fingerprint, kindOf, iconOf, fmtBytes } = modules['util.js'];

const text = (s) => new TextEncoder().encode(s);
function randomBytes(n) {           // getRandomValues caps at 64 KB per call
  const out = new Uint8Array(n);
  for (let o = 0; o < n; o += 65536) crypto.getRandomValues(out.subarray(o, Math.min(o + 65536, n)));
  return out;
}
const files = [
  { name: 'photo-2024.jpg', data: randomBytes(120000) },
  { name: 'contrat.pdf', data: text('%PDF-1.4\n' + 'x'.repeat(80000)) },
  { name: 'notes/ideas.txt', data: text('afkar dyali\n'.repeat(2000)) },
];

// import phase: fingerprints must be stable and kind detection sane
const Blobs = files.map((f) => new Blob([f.data]));
const fps = await Promise.all(Blobs.map((b) => fingerprint(b)));
check(new Set(fps).size === 3, 'fingerprints are distinct for distinct files');
const fp2 = await fingerprint(Blobs[0]);
check(fp2 === fps[0], 'fingerprint is stable across calls (duplicate detection works)');
check(kindOf('photo-2024.jpg') === 'image' && kindOf('contrat.pdf') === 'pdf'
  && kindOf('notes/ideas.txt') === 'text' && kindOf('app.apk') === 'app',
  'file kind detection', ['photo.jpg→' + kindOf('photo.jpg'), 'a.pdf→' + kindOf('a.pdf'),
    'a.txt→' + kindOf('a.txt'), 'a.apk→' + kindOf('a.apk'), 'a.mp4→' + kindOf('a.mp4')].join(' '));
check(!!iconOf('x.mp4') && !!iconOf('x.unknownext'), 'every kind has an icon');
check(fmtBytes(0) === '0 B' && fmtBytes(1536).includes('KB') && fmtBytes(5 * 1024 * 1024).includes('MB'),
  'byte formatting', [0, 1536, 5 * 1024 * 1024].map(fmtBytes).join(' / '));

// vault phase
const origSize = files.reduce((a, f) => a + f.data.length, 0);
const blob = await zipCreate(files.map((f) => ({ name: f.name, data: f.data })),
  { level: 'normal', password: 'khouya2024', cipher: 'gcm' });
const saved = origSize - blob.size;
check(blob.size < origSize, `vault is smaller than its contents`,
  `${fmtBytes(origSize)} → ${fmtBytes(blob.size)} (−${fmtBytes(saved)})`);

const list = await zipList(blob);
check(list.length === 3 && list.every((e) => e.encrypted && e.scheme === 'gcm'),
  'vault lists 3 encrypted entries');

const verify = await zipVerify(blob, 'khouya2024');
check(verify.ok && verify.entries === 3, 'vault passes integrity check', JSON.stringify(verify));

const back = await zipExtractAll(blob, 'khouya2024');
const same = files.every((f) => {
  const got = back.find((b) => b.name === f.name);
  return got && Buffer.from(got.data).equals(Buffer.from(f.data));
});
check(same, 'every file comes back byte-identical');

// single-entry extraction (used by the preview/download button)
const one = await zipExtractEntry(blob, list.find((e) => e.name === 'contrat.pdf'), 'khouya2024');
check(Buffer.from(one).equals(Buffer.from(files[1].data)), 'single-entry extraction works');

// a wrong password must not silently produce garbage
let rejected = false;
try { await zipExtractAll(blob, 'ghalat'); } catch { rejected = true; }
check(rejected, 'wrong password is refused, not silently decoded');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall app checks passed');
process.exit(failures ? 1 : 0);
