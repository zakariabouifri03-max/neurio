/**
 * Product image detection heuristics for arbitrary ecommerce pages.
 * No hardcoded store support — generic signals only:
 *  - OpenGraph / Twitter card meta images
 *  - JSON-LD Product (schema.org) images
 *  - <img> elements scored by aspect ratio, lazy-load patterns,
 *    src-URL vocabulary, and proximity to price/product-card landmarks.
 *
 * The scoring functions are pure (exported for unit tests).
 */

import type { CandidateImage } from "../lib/messages";

export interface ScoreInput {
  width: number;
  height: number;
  src: string;
  alt: string;
  hasDataSrc: boolean;
  hasSrcset: boolean;
  nearPrice: boolean;
  nearProductCard: boolean;
  isMainGallery: boolean;
  isAvatarish: boolean;
  isIconish: boolean;
}

/** Score 0..100 — higher is more likely a product garment photo. */
export function scoreCandidate(s: ScoreInput): number {
  let score = 0;

  // Portrait-ish clothing photos are far more common than square icons.
  const ar = s.width / s.height;
  if (ar > 0.3 && ar < 4) score += 12;
  if (ar > 0.55 && ar < 1.9) score += 12; // ~2:3 garment ratio

  if (s.nearProductCard) score += 20;
  if (s.nearPrice) score += 14;
  if (s.isMainGallery) score += 18;
  if (s.hasDataSrc) score += 8; // lazy-loaded product images are common
  if (s.hasSrcset) score += 4;

  // URL vocabulary
  const src = s.src.toLowerCase();
  const positive = [
    "product", "pdp", "item", "garment", "clothing", "clothes", "fashion",
    "dress", "shirt", "jacket", "trouser", "skirt", "main", "gallery", "zoom",
    "media", "cdn", "imgix", "cloudfront", "akamaized", "fastly",
  ];
  const negative = [
    "logo", "icon", "sprite", "avatar", "badge", "flag", "payment", "social",
    "share", "star", "rating", "utc", "spritesheet",
  ];
  for (const p of positive) {
    if (src.includes(p)) {
      score += 10;
      break;
    }
  }
  for (const n of negative) {
    if (src.includes(n)) {
      score -= 22;
      break;
    }
  }

  // Alt text hints
  const alt = s.alt.toLowerCase();
  if (alt.length > 6 && !/^(image|photo|png|jpg)/.test(alt)) score += 8;
  for (const n of ["logo", "icon", "button", "add-to", "wishlist", "cart"]) {
    if (alt.includes(n)) score -= 20;
  }

  if (s.isAvatarish) score -= 25;
  if (s.isIconish) score -= 25;

  return Math.max(0, Math.min(100, score));
}

export const MIN_SCORE = 30;
export const MAX_CANDIDATES = 24;

/** URL/alt heuristics that make an <img> "iconish" (sprite/icon strips). */
export function looksIconish(src: string, width: number, height: number): boolean {
  const s = src.toLowerCase();
  if (/sprite|icons?[-_.]|pwa|favicon/.test(s)) return true;
  // A very wide short image is usually a sprite strip.
  if (width >= 1000 && width / height >= 4) return true;
  return false;
}

export function looksAvatarish(src: string, alt: string): boolean {
  const s = src.toLowerCase();
  const a = alt.toLowerCase();
  return /avatar|profile|user|account|headshot/.test(s) || /avatar|profile|user/.test(a);
}

/** Extract candidates from a live document. */
export function collectCandidates(doc: Document, max = MAX_CANDIDATES): CandidateImage[] {
  const seen = new Set<string>();
  const out: CandidateImage[] = [];

  const push = (c: Omit<CandidateImage, "id">) => {
    if (!c.src || seen.has(c.src)) return;
    if (out.length >= max) return;
    seen.add(c.src);
    out.push({ id: `c${out.length}`, ...c });
  };

  // 1. Meta tags — usually the cleanest product shot on the page.
  for (const meta of Array.from(doc.querySelectorAll('meta[property], meta[name]'))) {
    const key = (meta.getAttribute("property") || meta.getAttribute("name") || "").toLowerCase();
    const content = meta.getAttribute("content") || "";
    if (!content) continue;
    if (key === "og:image" || key === "og:image:url" || key === "twitter:image") {
      push({ src: content, width: 0, height: 0, score: 90, source: "meta", name: doc.title });
    }
  }

  // 2. JSON-LD Product images.
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent || "{}");
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const prod = item?.["@type"] === "Product" ? item : item?.mainEntity;
        if (!prod || prod["@type"] !== "Product") continue;
        const images = prod.image;
        const list = Array.isArray(images) ? images : images ? [images] : [];
        for (const im of list) {
          if (typeof im === "string") push({ src: im, width: 0, height: 0, score: 88, source: "ldjson", name: prod.name });
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  // 3. <img> elements.
  const imgs = Array.from(doc.images).filter((img) => img.complete || img.getAttribute("src"));
  const priceEls = Array.from(doc.querySelectorAll('[class*="price" i], [data-price], .money, .product-price'));
  const cardEls = Array.from(doc.querySelectorAll('[class*="product" i], [data-product], [itemtype], [data-testid*="product" i]'));

  const near = (img: HTMLImageElement, els: Element[]): boolean => {
    if (!els.length) return false;
    const r = img.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    for (const el of els) {
      const er = el.getBoundingClientRect();
      if (
        r.left < er.right + 400 &&
        r.right > er.left - 400 &&
        r.top < er.bottom + 400 &&
        r.bottom > er.top - 400
      ) {
        return true;
      }
    }
    return false;
  };

  for (const img of imgs) {
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src || src.startsWith("data:") && src.length > 30000) continue;
    const dataSrc = img.getAttribute("data-src") || img.getAttribute("data-original") || "";
    const effective = dataSrc || src;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    const isMainGallery = /main|gallery|zoom|hero|primary/i.test(img.className || "") ||
      /main|gallery|zoom|hero|primary/i.test(img.id || "") ||
      /main-image|main-img/i.test(img.getAttribute("alt") || "");

    const score = scoreCandidate({
      width: w,
      height: h,
      src: effective,
      alt: img.getAttribute("alt") || "",
      hasDataSrc: Boolean(dataSrc),
      hasSrcset: Boolean(img.srcset),
      nearPrice: near(img, priceEls),
      nearProductCard: near(img, cardEls),
      isMainGallery,
      isAvatarish: looksAvatarish(effective, img.getAttribute("alt") || ""),
      isIconish: looksIconish(effective, w, h),
    });

    if (score >= MIN_SCORE) {
      push({
        src: effective,
        width: w,
        height: h,
        score,
        source: "img",
        name: img.getAttribute("alt") || doc.title,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Quick re-scan without DOM mutation (used on demand). */
export function scanDocument(): CandidateImage[] {
  return collectCandidates(document);
}
