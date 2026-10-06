/* Etsy Insight Pro — test/dom-tests.mjs
 * Real DOM tests for the Etsy extractors using jsdom + fixture HTML that
 * mirrors etsy.com markup (see test/fixtures/*).
 * Run: `npm run dom` (or `npm test`) from extension/test after `npm install`.
 * Skips gracefully with exit 0 when jsdom is not installed.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (e) {
  console.log('jsdom not installed — skipping DOM tests (run `npm install` in extension/test).');
  process.exit(0);
}

// Load shared libs + extractors (classic scripts; they attach to globalThis.EIP).
for (const lib of ['namespace', 'utils', 'settings', 'storage', 'estimation', 'scores', 'keywords', 'tracking']) {
  await import(pathToFileURL(join(ROOT, 'src/lib', lib + '.js')).href);
}
for (const f of ['common', 'product', 'shop', 'search']) {
  await import(pathToFileURL(join(ROOT, 'src/content/extractors', f + '.js')).href);
}
const EIP = globalThis.EIP;

function loadFixture(name, url) {
  const html = readFileSync(join(ROOT, 'test/fixtures', name), 'utf8');
  const dom = new JSDOM(html, { url });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  return dom;
}

function loadInline(html, url) {
  const dom = new JSDOM(html, { url });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  return dom;
}

// ---------------- product ----------------
console.log('\n[DOM] product extractor');
loadFixture('product.html', 'https://www.etsy.com/listing/1234567890/sample-handmade-ceramic-mug');
{
  const x = EIP.extract.product.extractProduct(document);
  ok('listingId', x.listingId === '1234567890', x.listingId);
  ok('title exact', x.title === 'Sample Handmade Ceramic Mug — Speckled Stoneware Coffee Cup', x.title);
  ok('price 24.99', x.price === 24.99, x.price);
  ok('currency USD', x.currency === 'USD', x.currency);
  ok('listing reviews 1243 (not shop 8930)', x.reviews === 1243, x.reviews);
  ok('rating 4.8', x.rating === 4.8, x.rating);
  ok('shopName', x.shopName === 'SampleStudio', x.shopName);
  ok('shop sales 45210', x.shopTotalSales === 45210, x.shopTotalSales);
  ok('shop since 2016 / age', x.shopSinceYear === 2016 && x.shopAgeYears === new Date().getFullYear() - 2016, `${x.shopSinceYear}/${x.shopAgeYears}`);
  ok('favorites 3800', x.favorites === 3800, x.favorites);
  ok('in carts 17', x.inCarts === 17, x.inCarts);
  ok('category Mugs + path', x.category === 'Mugs' && x.categoryPath.length === 4, `${x.category} [${x.categoryPath}]`);
  ok('physical (not digital)', x.isDigital === false, x.isDigital);
  ok('bestseller badge', x.isBestseller === true);
  ok('star seller badge', x.isStarSeller === true);
  ok('listed date + ageDays>0', x.listedDate === '2022-03-14' && x.listingAgeDays > 1000, `${x.listedDate}/${x.listingAgeDays}`);
  ok('recent reviews counted (2 within 30d)', x.recentReviews30d === 2, x.recentReviews30d);
  ok('image from og/jsonld', x.image === 'https://example.com/img/mug.jpg', x.image);
  ok('availability in_stock', x.availability === 'in_stock', x.availability);
  ok('provenance hints recorded', Object.keys(x._hints || {}).length >= 10, Object.keys(x._hints || {}).length);
}

// variant price range: must capture low+high, not a mangled number
console.log('\n[DOM] product variant price range');
loadInline(`<!DOCTYPE html><html><head>
<meta property="product:price:amount" content="19.95"/><meta property="product:price:currency" content="USD"/></head>
<body><main><div data-buy-box>
<h1 data-buy-box-listing-title>Variant Mug</h1>
<p data-buy-box-listing-price><span class="currency-symbol">$</span><span class="currency-value">19.95 - 34.95</span></p>
<a href="#reviews"><span aria-label="5 out of 5 stars">x</span>(42)</a>
</div></main></body></html>`, 'https://www.etsy.com/listing/555/x');
{
  const x = EIP.extract.product.extractProduct(document);
  ok('range low 19.95', x.price === 19.95, x.price);
  ok('range high 34.95', x.priceHigh === 34.95, x.priceHigh);
  ok('display price shows range', typeof x.priceDisplay === 'string' && x.priceDisplay.includes('34.95'), x.priceDisplay);
}

// digital detection
console.log('\n[DOM] digital product detection');
loadInline(`<!DOCTYPE html><html><body><main><div data-buy-box>
<h1 data-buy-box-listing-title>SVG Bundle</h1>
<p data-buy-box-listing-price><span class="currency-value">3.50</span></p>
<p>This is a digital item. Instant download, file type: ZIP + SVG.</p>
</div></main></body></html>`, 'https://www.etsy.com/listing/777/x');
{
  const x = EIP.extract.product.extractProduct(document);
  ok('digital detected', x.isDigital === true, x.isDigital);
  ok('price 3.50', x.price === 3.5, x.price);
}

// ---------------- shop ----------------
console.log('\n[DOM] shop extractor');
loadFixture('shop.html', 'https://www.etsy.com/shop/SampleStudio');
{
  const x = EIP.extract.shop.extractShop(document);
  ok('shopName', x.shopName === 'SampleStudio', x.shopName);
  ok('totalSales 45210', x.totalSales === 45210, x.totalSales);
  ok('activeListings 86', x.activeListings === 86, x.activeListings);
  ok('reviewCount 8930', x.reviewCount === 8930, x.reviewCount);
  ok('rating 4.9', x.rating === 4.9, x.rating);
  ok('since 2016', x.sinceYear === 2016, x.sinceYear);
  ok('3 grid listings', x.listings.length === 3, x.listings.length);
  ok('card 1 fields', x.listings[0].price === 24.99 && x.listings[0].reviews === 1243 && x.listings[0].rating === 4.8 && x.listings[0].isBestseller === true, JSON.stringify(x.listings[0]));
  ok('card 3 no reviews → null', x.listings[2].reviews === null, x.listings[2].reviews);
  ok('avgPrice ≈ 32.83', Math.abs(x.avgPrice - 32.83) < 0.01, x.avgPrice);
  ok('niche guessed', typeof x.niche === 'string' && x.niche.length > 3, x.niche);
}

// ---------------- search ----------------
console.log('\n[DOM] search extractor');
loadFixture('search.html', 'https://www.etsy.com/search?q=ceramic+mug');
{
  const x = EIP.extract.search.extractSearch(document);
  ok('query', x.query === 'ceramic mug', x.query);
  ok('totalResults 48213', x.totalResults === 48213, x.totalResults);
  ok('3 cards', x.items.length === 3, x.items.length);
  ok('ranks sequential', x.items.map(i => i.rank).join(',') === '1,2,3');
  ok('card 2 reviews 3211', x.items[1].reviews === 3211 && x.items[1].price === 19.95, `${x.items[1].reviews}/${x.items[1].price}`);
  ok('card 1 bestseller', x.items[0].isBestseller === true);
  ok('clean listing URLs', x.items.every(i => /^https:\/\/www\.etsy\.com\/listing\/\d+/.test(i.url)), x.items[1].url);
}

// market URL query fallback
loadInline(`<!DOCTYPE html><html><body><main><p>12 Results</p></main></body></html>`, 'https://www.etsy.com/market/ceramic_mug');
{
  const x = EIP.extract.search.extractSearch(document);
  ok('market slug → query words', x.query === 'ceramic mug', x.query);
}

// ---------------- estimation edge cases ----------------
console.log('\n[DOM] estimation accuracy edges');
{
  const S = EIP.settings.DEFAULTS;
  // Variant range revenue uses midpoint.
  const sales = EIP.estimation.estimateMonthlySales({ listingReviews: 120, listingAgeDays: 365, historyPoints: 0 }, S);
  const rev = EIP.estimation.estimateRevenue(sales, { low: 10, high: 20 }, 'USD');
  ok('range revenue uses midpoint', Math.abs(rev.price - 15) < 1e-9 && Math.abs(rev.monthly.mid - sales.mid * 15) < 0.5, rev.price);
  // New unreviewed listing: bounded small range, Low confidence.
  const fresh = EIP.estimation.estimateMonthlySales({ listingReviews: 0, listingAgeDays: 10, historyPoints: 0 }, S);
  ok('unreviewed → 0 low, small high', fresh.low === 0 && fresh.high > 0 && fresh.high <= 5 && fresh.confidence === 'Low', `${fresh.low}/${fresh.high}/${fresh.confidence}`);
  // Shop throughput cap prevents absurd hero estimates on big old shops.
  const capped = EIP.estimation.estimateMonthlySales(
    { listingReviews: 5000, listingAgeDays: 60, shopSales: 100000, shopReviews: 15000, shopAgeMonths: 120, shopListings: 200, historyPoints: 0 }, S);
  ok('shop cap applied + disclosed', capped.inputs.cappedByShop === true && capped.steps.some(s => /shop throughput/i.test(s)), capped.inputs.cappedByShop);
  // Tracked velocity preferred over noisy on-page sample.
  const v = EIP.tracking.bestVelocity(
    [{ t: Date.now() - 20 * 864e5, reviews: 100 }, { t: Date.now(), reviews: 130 }], 99);
  ok('tracked velocity wins (45/mo)', Math.abs(v.value - 45) < 0.5 && v.source === 'tracked', `${v.value}/${v.source}`);
}

// ---------------- summary ----------------
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) { console.log('Failures:', failures.join(', ')); process.exit(1); }
console.log('All DOM tests passed ✓');
