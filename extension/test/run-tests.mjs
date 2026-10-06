/* Etsy Insight Pro — test/run-tests.mjs
 * Run: `node test/run-tests.mjs` from the extension/ directory.
 * 1. Manifest validation (schema + referenced files exist)
 * 2. JS syntax check (node --check) for every shipped .js file
 * 3. Unit tests for pure libs (utils, estimation, scores, keywords, export, tracking, storage)
 * No network, no browser needed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------- 1. manifest ----------
console.log('\n[1] manifest.json');
try {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  ok('valid JSON', true);
  ok('manifest_version === 3', manifest.manifest_version === 3);
  ok('has name/version/action/background', !!(manifest.name && manifest.version && manifest.action && manifest.background));
  ok('service_worker file exists', exists(manifest.background.service_worker), manifest.background.service_worker);
  ok('popup file exists', exists(manifest.action.default_popup));
  for (const [size, p] of Object.entries(manifest.icons || {})) ok(`icon ${size} exists`, exists(p), p);
  const cs = (manifest.content_scripts || [])[0] || {};
  const missing = (cs.js || []).filter(f => !exists(f));
  ok(`content_scripts (${(cs.js || []).length} files) all exist`, missing.length === 0, missing.join(','));
  ok('matches Etsy https only', JSON.stringify(cs.matches || []).includes('etsy.com'));
  const jsEntries = [...(cs.js || []), manifest.background.service_worker, manifest.action.default_popup];
  ok('no remote code (all scripts are local files)', jsEntries.every(f => typeof f === 'string' && !/^https?:\/\//.test(f)));
} catch (e) { ok('manifest parses', false, e.message); }

function exists(rel) {
  try { return statSync(join(ROOT, rel)).isFile(); } catch { return false; }
}

// ---------- 2. syntax ----------
console.log('\n[2] syntax (node --check)');
const jsFiles = walk(join(ROOT, 'src')).filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    ok(short(f), true);
  } catch (e) { ok(short(f), false, 'syntax error'); }
}
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
function short(f) { return f.slice(ROOT.length + 1); }

// ---------- 3. unit tests ----------
console.log('\n[3] unit tests');
for (const lib of ['namespace', 'utils', 'settings', 'storage', 'estimation', 'scores', 'keywords', 'tracking', 'export', 'charts']) {
  await import(pathToFileURL(join(ROOT, 'src/lib', lib + '.js')).href);
}
const EIP = globalThis.EIP;
ok('EIP namespace loaded with 9 lib modules', EIP && EIP.__modules.length >= 9, (EIP && EIP.__modules.join(',')) || 'none');
const U = EIP.utils;

// utils
ok('parseCount 1.2k', U.parseCount('1.2k') === 1200);
ok('parseCount 3,400', U.parseCount('3,400') === 3400);
ok('parseCount garbage → null', U.parseCount('abc') === null);
ok('parsePrice $1,234.56', U.parsePrice('$1,234.56').value === 1234.56);
ok('parsePrice €12,99 → 12.99', U.parsePrice('€12,99').value === 12.99);
ok('parseRating aria', U.parseRating('4.8 out of 5 stars') === 4.8);
ok('formatRange', U.formatRange(25, 45) === '25–45');
ok('escapeHtml', U.escapeHtml('<b>"&"') === '&lt;b&gt;&quot;&amp;&quot;');
ok('clamp NaN → min', U.clamp(NaN, 2, 5) === 2);

// settings
const clean = EIP.settings.sanitize({ reviewRate: 9, theme: 'nope', currency: 'usd' });
ok('settings sanitize clamps reviewRate', clean.reviewRate === 0.5);
ok('settings sanitize rejects bad theme', clean.theme === 'auto');
ok('settings sanitize rejects lowercase currency', clean.currency === 'USD');

// estimation — sample product
const sample = JSON.parse(readFileSync(join(ROOT, 'sample-data/sample-product.json'), 'utf8'));
const sales = EIP.estimation.estimateMonthlySales({
  listingReviews: sample.reviews, recentReviews30d: sample.recentReviews30d,
  hasRecentActivity: true, listingAgeDays: sample.listingAgeDays,
  favorites: sample.favorites, shopSales: sample.shopTotalSales, shopReviews: 8930, historyPoints: 4
}, EIP.settings.DEFAULTS);
ok('sales estimate returns range', sales.low !== null && sales.high !== null && sales.low <= sales.mid && sales.mid <= sales.high);
ok('sales confidence High with rich evidence', sales.confidence === 'High', sales.confidence);
ok('sales explanation steps present', sales.steps.length >= 4);
ok('sales disclaimer present', /not exact/i.test(sales.disclaimer));
const rev = EIP.estimation.estimateRevenue(sales, sample.price, 'USD');
ok('revenue = sales × price', Math.abs(rev.monthly.mid - sales.mid * sample.price) < 0.01);
const views = EIP.estimation.estimateViews({ monthlyOrdersMid: sales.mid, monthlyOrdersLo: sales.low, monthlyOrdersHi: sales.high, favorites: sample.favorites, historyPoints: 0 }, EIP.settings.DEFAULTS);
ok('views estimate sane (orders/conv)', views.mid > sales.mid, `${views.mid} vs ${sales.mid}`);
ok('views labelled estimated', views.exact === false);
const empty = EIP.estimation.estimateMonthlySales({}, EIP.settings.DEFAULTS);
ok('empty signals → null estimate, Low confidence', empty.mid === null && empty.confidence === 'Low');
const zeroRev = EIP.estimation.estimateMonthlySales({ listingReviews: 0 }, EIP.settings.DEFAULTS);
ok('zero reviews → zero sales', zeroRev.mid === 0);

// scores
const all = EIP.scores.allScores({ reviews: 1243, rating: 4.8, favorites: 3800, recentReviews30d: 28, isBestseller: true, monthlyOrdersMid: sales.mid, reviewGrowthPct: 12, searchResults: 48213, avgCompetitorReviews: 800, pricePosition: 'mid', shopListings: 86, price: 24.99, monthlySalesMid: sales.mid });
for (const k of ['demand', 'competition', 'revenue', 'opportunity']) {
  ok(`score ${k} in 0–100`, all[k].value >= 0 && all[k].value <= 100, all[k].value);
  ok(`score ${k} has formula`, typeof all[k].formula === 'string' && all[k].formula.length > 10);
}
ok('opportunity math = 45/25/30 blend', all.opportunity.value === Math.round(0.45 * all.demand.value + 0.25 * (100 - all.competition.value) + 0.30 * all.revenue.value));

// keywords
const searchSample = JSON.parse(readFileSync(join(ROOT, 'sample-data/sample-search.json'), 'utf8'));
const kw = EIP.keywords.analyzeKeywords(searchSample.items, { minFrequency: 1, maxRows: 20 });
ok('keywords extracted', kw.rows.length > 0);
ok('keyword rows have opportunity', kw.rows.every(r => Number.isFinite(r.opportunity)));
ok('suggestions present', kw.suggestions.length > 0);
ok('no fake search volume field', !JSON.stringify(kw).includes('searchVolume'));

// export
const rows = EIP.exporter.researchRows({ items: [{ rank: 1, title: 'A, "quoted"', price: 9.99, sales: { low: 1, mid: 2, high: 3 }, revenue: { monthly: { mid: 20 } }, scores: { demand: { value: 50 }, competition: { value: 40 }, revenue: { value: 60 }, opportunity: { value: 70 } } }], currency: 'USD' });
const csv = EIP.exporter.toCSV(rows);
ok('CSV escapes quotes', csv.includes('"A, ""quoted"""'));
ok('CSV header present', csv.startsWith('rank,'));

// tracking (pure parts)
const now = Date.now();
const hist = [0, 10, 20, 30].map((d, i) => ({ t: now - (30 - d) * 86400000 + 60000, reviews: 100 + i * 10, price: 20 }));
const sum = EIP.tracking.summarizeHistory(hist, 30);
ok('history reviewDelta', sum.reviewDelta === 30, sum.reviewDelta);
ok('history trend up', sum.trend === 'up');
ok('recentVelocity ≈ 30/mo (+30 reviews / 30 days)', Math.abs(EIP.tracking.recentVelocity(hist, 30) - 30) < 0.5, EIP.tracking.recentVelocity(hist, 30));

// storage (memory fallback in Node)
EIP.storage.__resetMemoryForTests();
await EIP.storage.saveSettings({ ...EIP.settings.DEFAULTS, currency: 'EUR' });
const loaded = await EIP.storage.loadSettings();
ok('storage settings roundtrip', loaded.currency === 'EUR');
await EIP.tracking.recordProductObservation('999', { title: 'T' }, { t: Date.now(), price: 5, reviews: 10 }, { trackingMinIntervalHours: 6, historyRetentionDays: 365 });
const prods = await EIP.storage.loadProducts();
ok('tracking record roundtrip', prods['999'] && prods['999'].observations.length === 1);
const backup = await EIP.storage.exportAll();
ok('exportAll shape', backup.app === 'Etsy Insight Pro' && backup.products['999']);

// extractors — degrade gracefully with no DOM (Node has no document)
for (const f of ['common', 'product', 'shop', 'search']) {
  await import(pathToFileURL(join(ROOT, 'src/content/extractors', f + '.js')).href);
}
ok('extractors loaded', !!(EIP.extract && EIP.extract.product && EIP.extract.shop && EIP.extract.search));
const dProduct = EIP.extract.common.detectPageType('https://www.etsy.com/listing/1234567890/foo');
const dShop = EIP.extract.common.detectPageType('https://www.etsy.com/shop/SomeShop');
const dSearch = EIP.extract.common.detectPageType('https://www.etsy.com/search?q=mug');
const dOther = EIP.extract.common.detectPageType('https://www.etsy.com/cart');
ok('detect product page + id', dProduct.type === 'product' && dProduct.listingId === '1234567890');
ok('detect shop page + name', dShop.type === 'shop' && dShop.shopName === 'SomeShop');
ok('detect search page + query', dSearch.type === 'search' && dSearch.query === 'mug');
ok('detect unsupported page', dOther.type === 'other');
const emptyProduct = EIP.extract.product.extractProduct(undefined);
const emptyShop = EIP.extract.shop.extractShop(undefined);
const emptySearch = EIP.extract.search.extractSearch(undefined);
ok('product extractor null-safe (no DOM)', emptyProduct && emptyProduct.pageType === 'product' && emptyProduct.title === null);
ok('shop extractor null-safe (no DOM)', emptyShop && emptyShop.pageType === 'shop' && emptyShop.listings.length === 0);
ok('search extractor null-safe (no DOM)', emptySearch && emptySearch.pageType === 'search' && emptySearch.items.length === 0);

// ---------- summary ----------
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) { console.log('Failures:', failures.join(', ')); process.exit(1); }
console.log('All tests passed ✓');
