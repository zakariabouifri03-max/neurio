/**
 * DOM extraction tests. The fixtures mimic Etsy's public markup patterns
 * (data attributes + aria-labels) so selector regressions are caught.
 * These are TEST FIXTURES — they never ship with the product.
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { scanSearchPage, findCards } from "../src/extract-search.js";
import { extractListingPage } from "../src/extract-listing.js";

const NOW = "2026-10-06T12:00:00.000Z";

const SEARCH_HTML = `
<!doctype html><html><head><title>halloween shirt - Etsy</title></head><body>
<input id="search-query" value="halloween shirt" />
<p>12,345 results</p>
<ol data-search-results>
  <li class="wt-grid__item-xs-6">
    <div class="card">
      <p class="wt-text-caption wt-text-gray">Ad by Etsy</p>
      <a class="listing-link" href="https://www.etsy.com/listing/111111/spooky-ad-shirt?ref=sr_1" aria-label="Spooky Ad Shirt">
        <img alt="Spooky Ad Shirt PNG" />
      </a>
      <h3>Spooky Ad Shirt</h3>
      <div data-search-grid-item-price><span class="currency-symbol">$</span><span class="currency-value">24.99</span></div>
      <div aria-label="4.6 out of 5 stars">(210)</div>
    </div>
  </li>
  <li class="wt-grid__item-xs-6">
    <div class="card">
      <a class="listing-link" href="https://www.etsy.com/listing/222222/halloween-shirt-pumpkin?ref=sr_2" aria-label="Halloween Shirt Pumpkin">
        <img alt="Halloween Shirt Pumpkin" />
      </a>
      <h3>Halloween Shirt Pumpkin</h3>
      <div data-search-grid-item-price><span class="currency-symbol">$</span><span class="currency-value">19.99</span></div>
      <div class="stars" aria-label="4.8 out of 5 stars">(386)</div>
      <span class="wt-badge wt-badge--check">Bestseller</span>
      <span>Free shipping</span>
    </div>
  </li>
  <li class="wt-grid__item-xs-6">
    <div class="card">
      <a class="listing-link" href="https://www.etsy.com/listing/333333/ghost-tee?ref=sr_3">
        <img alt="Ghost Tee" />
      </a>
      <h3>Ghost Tee</h3>
      <div data-search-grid-item-price><span>SGD</span> <span class="currency-value">1,234.56</span></div>
    </div>
  </li>
</ol>
</body></html>`;

describe("scanSearchPage", () => {
  const dom = new JSDOM(SEARCH_HTML);
  const doc = dom.window.document;
  const result = scanSearchPage(doc, { observedAt: NOW });

  it("reads the query and total results", () => {
    expect(result.query).toBe("halloween shirt");
    expect(result.totalResults).toBe(12345);
  });

  it("extracts all cards with listing ids", () => {
    expect(result.cards.length).toBe(3);
    expect(result.cards.map((c) => c.observation.listingId)).toEqual(["111111", "222222", "333333"]);
  });

  it("marks the ad and assigns organic positions only", () => {
    const ad = result.cards[0]!;
    expect(ad.observation.isAd).toBe(true);
    expect(ad.observation.badges).toContain("Ad");
    const organic1 = result.cards[1]!;
    expect(organic1.observation.isAd).toBe(false);
    expect(organic1.observation.searchPosition).toBe(1);
    expect(result.cards[2]!.observation.searchPosition).toBe(2);
  });

  it("extracts price / rating / reviews / badges from public card data", () => {
    const card = result.cards[1]!.observation;
    expect(card.price).toBe(19.99);
    expect(card.rating).toBe(4.8);
    expect(card.reviewCount).toBe(386);
    expect(card.badges).toEqual(expect.arrayContaining(["Bestseller", "Free shipping"]));
    expect(card.title).toBe("Halloween Shirt Pumpkin");
    expect(card.searchQuery).toBe("halloween shirt");
    expect(card.serpResultCount).toBe(12345);
  });

  it("reports missing fields honestly instead of guessing", () => {
    const card = result.cards[2]!;
    expect(card.observation.reviewCount).toBeUndefined();
    expect(card.fieldsMissing).toContain("reviewCount");
    expect(card.observation.price).toBe(1234.56); // international format parsed
  });

  it("findCards uses the canonical grid strategy", () => {
    const { strategy } = findCards(doc);
    expect(strategy).toContain("data-search-results");
  });
});

const LISTING_HTML = `
<!doctype html><html><head><link rel="canonical" href="https://www.etsy.com/listing/222222/halloween-shirt-pumpkin" /></head><body>
<h1 data-buy-box-title>Halloween Shirt Pumpkin — Unisex Tee</h1>
<div data-buy-box-price><p class="wt-text-title-large">$19.99</p></div>
<section aria-label="Reviews">
  <span aria-label="4.8 out of 5 stars">4.8 out of 5 stars</span>
  <span>386 reviews</span>
</section>
<p id="shop-name">SpookyShirtsCo</p>
<div class="shop-stats">Star Seller · 12,345 sales · 400 shop reviews</div>
<div class="item-details">Listed on Sep 1, 2025</div>
<span class="wt-badge">Popular now</span>
</body></html>`;

describe("extractListingPage", () => {
  const dom = new JSDOM(LISTING_HTML);
  const doc = dom.window.document;
  const result = extractListingPage(doc, "https://www.etsy.com/listing/222222/halloween-shirt-pumpkin?ref=shop", NOW);

  it("extracts the real public fields", () => {
    expect(result).toBeTruthy();
    const obs = result!.observation;
    expect(obs.listingId).toBe("222222");
    expect(obs.title).toContain("Halloween Shirt Pumpkin");
    expect(obs.price).toBe(19.99);
    expect(obs.rating).toBe(4.8);
    expect(obs.reviewCount).toBe(386);
    expect(obs.shopName).toBe("SpookyShirtsCo");
    expect(obs.shopSalesCount).toBe(12345);
    expect(obs.shopReviewCount).toBe(400);
    expect(obs.badges).toContain("Popular now");
    expect(obs.surface).toBe("listing_page");
  });

  it("parses the public listed-on date when present", () => {
    expect(result!.fieldsFound).toContain("listedOnDate");
  });

  it("returns null on non-listing pages", () => {
    const dom2 = new JSDOM("<html><body><h1>Shop</h1></body></html>");
    const r = extractListingPage(dom2.window.document, "https://www.etsy.com/shop/foo", NOW);
    expect(r).toBeNull();
  });
});
