/**
 * Product-detail-page extraction.
 *
 * Same rules as SERP extraction: read only what Etsy publicly renders on the
 * page the user is viewing; report missing fields honestly.
 */
import type { ExtractedCard, ListingObservation } from "@etsy-signal/shared";
import { parseListedOn, parseListingUrl, parseMoney, parseRating, parseReviewCount, parseSalesCount } from "./parse.js";

export function extractListingPage(doc: Document, url: string, observedAt: string): ExtractedCard | null {
  const found: string[] = [];
  const missing: string[] = [];
  const obs: ListingObservation = { listingId: "", observedAt, surface: "listing_page" };

  // 1) listing id
  const parsed = parseListingUrl(url) ?? parseListingUrl(doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "");
  if (parsed) {
    obs.listingId = parsed.listingId;
    obs.url = parsed.url;
    found.push("listingId", "url");
  } else return null; // Not a listing page — caller must not render the dashboard.

  // 2) title
  const title = doc.querySelector("h1")?.textContent?.trim();
  if (title) {
    obs.title = title.slice(0, 300);
    found.push("title");
  } else missing.push("title");

  const bodyText = doc.body?.textContent ?? "";
  const ariaText = Array.from(doc.querySelectorAll("[aria-label]"))
    .map((e) => e.getAttribute("aria-label"))
    .join(" \n ");
  const pool = `${bodyText}\n${ariaText}`;

  // 3) price: buy-box price element, else first prominent money text.
  const priceEl =
    doc.querySelector("[data-buy-box-price]") ??
    doc.querySelector('[class*="buy-box"] [class*="price"]') ??
    doc.querySelector("p[class*='price'], div[class*='price']");
  let price = parseMoney(priceEl?.textContent ?? "");
  if (price == null) {
    // Fallback: look for "Original price ..." structure indicating a sale.
    const origMatch = bodyText.match(/original price[:\s]*([^\d]*[\d.,]+)/i);
    if (origMatch) {
      const original = parseMoney(origMatch[1]);
      if (original != null) {
        obs.originalPrice = original;
        found.push("originalPrice");
      }
    }
  }
  if (price != null) {
    obs.price = price;
    found.push("price");
    const cur = (priceEl?.textContent ?? "").match(/[A-Z]{3}|[$€£]/)?.[0];
    if (cur) obs.currency = cur.length === 3 ? cur : cur === "€" ? "EUR" : cur === "£" ? "GBP" : "USD";
  } else missing.push("price");

  // Sale price: displayed price lower than the original price text.
  if (obs.originalPrice == null) {
    const origAria = Array.from(doc.querySelectorAll("[aria-label]"))
      .map((e) => e.getAttribute("aria-label") ?? "")
      .find((l) => /original price/i.test(l));
    if (origAria) {
      const original = parseMoney(origAria);
      if (original != null && price != null && original > price) {
        obs.originalPrice = original;
        found.push("originalPrice");
      }
    }
  }

  // 4) rating & reviews
  const rating = parseRating(pool);
  if (rating != null) {
    obs.rating = rating;
    found.push("rating");
  } else missing.push("rating");
  const reviews = parseReviewCount(pool);
  if (reviews != null) {
    obs.reviewCount = reviews;
    found.push("reviewCount");
  } else missing.push("reviewCount");

  // 5) shop info
  const shopEl = doc.querySelector("#shop-name, [data-shop-name], p[data-shop-name-anchor]");
  const shopName = shopEl?.textContent?.trim();
  if (shopName && shopName.length < 80) {
    obs.shopName = shopName;
    found.push("shopName");
  } else missing.push("shopName");

  const shopSales = parseSalesCount(pool);
  if (shopSales != null) {
    obs.shopSalesCount = shopSales;
    found.push("shopSalesCount");
  } else missing.push("shopSalesCount");

  // Shop-wide review count appears as "N shop reviews" on some layouts.
  const shopReviewsMatch = pool.match(/([\d.,]+)\s+shop reviews/i);
  if (shopReviewsMatch) {
    const v = Number(shopReviewsMatch[1]?.replace(/[.,]/g, ""));
    if (Number.isFinite(v)) {
      obs.shopReviewCount = v;
      found.push("shopReviewCount");
    }
  }

  // 6) listed-on date (when Etsy shows it)
  const listed = parseListedOn(pool);
  if (listed) found.push("listedOnDate");
  else missing.push("listedOnDate");

  // 7) badges
  const badges = ["Bestseller", "Popular now", "Star Seller", "Etsy's Pick", "Free shipping"].filter((b) => pool.includes(b));
  if (badges.length) {
    obs.badges = badges;
    found.push("badges");
  }

  // 8) favorites count — only when Etsy genuinely displays it.
  const favMatch = pool.match(/([\d.,]+)\s+(?:favorites?|favourites?)/i);
  if (favMatch) {
    const v = Number(favMatch[1]?.replace(/[.,]/g, ""));
    if (Number.isFinite(v) && v >= 0) {
      obs.favoritesCount = v;
      found.push("favoritesCount");
    }
  } else missing.push("favoritesCount");

  return { observation: obs, fieldsFound: found, fieldsMissing: missing, strategy: "listing_page_v1" };
}

/** Attach the parsed listed-on date to the observation via meta (returned separately). */
export function extractListedOnDate(doc: Document): string | null {
  const pool = doc.body?.textContent ?? "";
  return parseListedOn(pool);
}
