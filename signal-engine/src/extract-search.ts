/**
 * Search-page (SERP) extraction.
 *
 * Reads ONLY what the user's browser is already displaying — public listing
 * info rendered by Etsy. Multiple selector strategies are tried in order so
 * the engine degrades gracefully (and reportably) when Etsy changes markup.
 *
 * Anything we cannot read is reported as missing, never guessed.
 */
import type { ExtractedCard, ListingObservation } from "@etsy-signal/shared";
import { parseListingUrl, parseMoney, parseRating, parseReviewCount } from "./parse.js";

const BADGE_TEXTS = ["Bestseller", "Popular now", "Star Seller", "Etsy's Pick", "Etsy Plus", "Free shipping", "Climate Pledge Friendly"];

export interface SerpScanOptions {
  query?: string;
  observedAt: string;
  /** Cap how many cards we analyze in one pass (performance guard). */
  maxCards?: number;
}

export interface SerpScanResult {
  query: string | null;
  totalResults: number | null;
  cards: ExtractedCard[];
}

/** Find listing-card containers using layered strategies. */
export function findCards(doc: Document): { elements: Element[]; strategy: string } {
  // Strategy 1: Etsy's canonical search grid.
  let els = Array.from(doc.querySelectorAll("ol[data-search-results] > li, ol[data-search-results] > div"));
  if (els.length > 0) return { elements: els, strategy: "ol[data-search-results] > li" };

  // Strategy 2: any list-item containers that hold a listing link.
  els = Array.from(doc.querySelectorAll("li")).filter((li) => li.querySelector('a[href*="/listing/"]'));
  if (els.length > 0) return { elements: els, strategy: "li:has(listing-link)" };

  // Strategy 3: grid items by class fragment.
  els = Array.from(doc.querySelectorAll('[class*="wt-grid__item"], [data-grid-item]')).filter((d) =>
    d.querySelector('a[href*="/listing/"]'),
  );
  if (els.length > 0) return { elements: els, strategy: "wt-grid__item" };

  // Strategy 4 (last resort): dedupe listing anchors to nearest block parent.
  const seen = new Set<Element>();
  for (const a of Array.from(doc.querySelectorAll('a[href*="/listing/"]'))) {
    const block = a.closest("li, article, [class*='card'], div") ?? a;
    seen.add(block);
  }
  return { elements: [...seen], strategy: "listing-anchor-blocks" };
}

export function extractSearchCard(card: Element, opts: { position: number; query?: string; totalResults?: number | null; observedAt: string; isAdHint?: boolean }): ExtractedCard {
  const found: string[] = [];
  const missing: string[] = [];
  const obs: ListingObservation = { listingId: "", observedAt: opts.observedAt, surface: "search_card" };
  let strategy = "none";

  // 1) listing id + url
  const link = card.querySelector('a[href*="/listing/"]');
  const href = link?.getAttribute("href") ?? "";
  const parsed = href ? parseListingUrl(href) : null;
  if (parsed) {
    obs.listingId = parsed.listingId;
    obs.url = parsed.url;
    found.push("listingId", "url");
    strategy = "listing-link";
  } else {
    missing.push("listingId");
  }

  // 2) title: h3 text, img alt, or link aria-label.
  const title =
    firstText(card.querySelector("h3")) ||
    card.querySelector("img")?.getAttribute("alt") ||
    link?.getAttribute("aria-label") ||
    link?.getAttribute("title") ||
    undefined;
  if (title && title.trim().length > 1) {
    obs.title = title.trim().slice(0, 300);
    found.push("title");
  } else missing.push("title");

  // 3) price
  const priceEl =
    card.querySelector("[data-search-grid-item-price]") ??
    card.querySelector('[class*="price"] [class*="currency-value"]') ??
    card.querySelector('[class*="price"]');
  const priceText = priceEl?.textContent ?? "";
  const price = parseMoney(priceText);
  if (price != null) {
    obs.price = price;
    found.push("price");
    const cur = priceText.match(/[A-Z]{3}|[$€£]/)?.[0];
    if (cur) obs.currency = cur.length === 3 ? cur : cur === "€" ? "EUR" : cur === "£" ? "GBP" : "USD";
  } else missing.push("price");

  // 4) rating + review count: try structured elements then aria/text regexes.
  const ratingAttr = card.querySelector("[data-star-rating]")?.getAttribute("data-star-rating");
  let rating = ratingAttr ? Number(ratingAttr) : null;
  let reviewCount: number | null = null;

  if (rating == null || !Number.isFinite(rating)) {
    const ariaEls = Array.from(card.querySelectorAll("[aria-label]")).map((e) => e.getAttribute("aria-label") ?? "");
    const textPool = [...ariaEls, card.textContent ?? ""].join(" \n ");
    rating = parseRating(textPool);
    reviewCount = parseReviewCount(textPool);
  } else {
    const textPool = card.textContent ?? "";
    reviewCount = parseReviewCount(textPool);
  }
  if (rating != null && Number.isFinite(rating) && rating > 0) {
    obs.rating = rating;
    found.push("rating");
  } else missing.push("rating");
  if (reviewCount != null) {
    obs.reviewCount = reviewCount;
    found.push("reviewCount");
  } else missing.push("reviewCount");

  // 5) badges
  const cardText = card.textContent ?? "";
  const ariaText = Array.from(card.querySelectorAll("[aria-label]"))
    .map((e) => e.getAttribute("aria-label"))
    .join(" ");
  const badges = BADGE_TEXTS.filter((b) => cardText.includes(b) || ariaText.includes(b));
  const isAd = opts.isAdHint || /Ad by Etsy/i.test(cardText) || /ad by etsy/i.test(ariaText);
  if (isAd) badges.push("Ad");
  if (badges.length > 0) {
    obs.badges = badges;
    found.push("badges");
  }
  obs.isAd = !!isAd;

  // 6) position & query context
  obs.searchPosition = opts.position;
  if (opts.query) obs.searchQuery = opts.query;
  if (opts.totalResults != null) obs.serpResultCount = opts.totalResults;
  found.push("searchPosition");

  return { observation: obs, fieldsFound: found, fieldsMissing: missing, strategy };
}

export function scanSearchPage(doc: Document, opts: SerpScanOptions): SerpScanResult {
  const query =
    opts.query ??
    (doc.querySelector<HTMLInputElement>("input#search-query, input[name='search_query']")?.value || null) ??
    parseQueryFromTitle(doc.title);

  const totalResults = parseTotalResults(doc.body?.textContent ?? "");
  const { elements } = findCards(doc);

  const cards: ExtractedCard[] = [];
  let organicPosition = 0;
  const limit = opts.maxCards ?? 60;
  for (const el of elements) {
    if (cards.length >= limit) break;
    if (!el.querySelector('a[href*="/listing/"]')) continue;
    const text = el.textContent ?? "";
    const isAd = /Ad by Etsy/i.test(text);
    if (!isAd) organicPosition += 1;
    const card = extractSearchCard(el, {
      position: isAd ? 0 : organicPosition,
      query: query ?? undefined,
      totalResults,
      observedAt: opts.observedAt,
      isAdHint: isAd,
    });
    if (card.observation.listingId) cards.push(card);
  }
  return { query, totalResults, cards };
}

export function parseTotalResults(pageText: string): number | null {
  const m = pageText.match(/([\d.,]+)\s+results?\b/i);
  if (!m) return null;
  const cleaned = m[1]?.replace(/[.,]/g, "");
  const v = Number(cleaned);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseQueryFromTitle(title: string): string | null {
  // Etsy titles look like: "halloween shirt - Etsy"
  const m = title.match(/^(.*?)\s*[-|–]\s*Etsy/i);
  return m?.[1]?.trim() ? (m[1] as string).trim() : null;
}

function firstText(el: Element | null | undefined): string | null {
  const t = el?.textContent?.trim();
  return t ? t : null;
}
