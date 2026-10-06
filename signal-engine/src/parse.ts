/**
 * Robust parsers for the text formats Etsy displays publicly.
 * Pure functions — fully unit-testable, no DOM required.
 */

/**
 * Parse a displayed money string into a number.
 * Handles: "$19.99", "SGD 1,234.56", "1.234,56 €", "€12,34", "US$ 38.56".
 * Returns null when no sensible number can be read.
 */
export function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null;
  let s = text.replace(/[^\d.,\-]/g, "").trim();
  if (!s || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the right-most is the decimal separator.
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    const commaDigits = s.length - lastComma - 1;
    const commaCount = (s.match(/,/g) ?? []).length;
    if (commaCount === 1 && (commaDigits === 1 || commaDigits === 2)) {
      s = s.replace(",", "."); // European decimal comma: "12,34"
    } else {
      s = s.replace(/,/g, ""); // thousands separators: "1,234"
    }
  }
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

/** Parse "1,234" / "1.2k" / "3m" style counts. */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.,kKmM]/g, "");
  if (!cleaned) return null;
  const multiplier = /[mM]$/.test(cleaned) ? 1_000_000 : /[kK]$/.test(cleaned) ? 1_000 : 1;
  const body = cleaned.replace(/[kKmM]$/, "");
  const v = parseMoney(body);
  if (v == null) return null;
  return Math.round(v * multiplier);
}

/** Extract "4.8" from aria/text like '4.8 out of 5 stars'. */
export function parseRating(text: string): number | null {
  const m = text.match(/([\d.,]+)\s*(?:\/\s*5|out of 5)/i);
  if (!m) return null;
  const v = parseMoney(m[1]);
  if (v == null || v < 0 || v > 5) return null;
  return v;
}

/** Extract review counts from text like "(386)" next to stars, or "386 reviews". */
export function parseReviewCount(text: string): number | null {
  let m = text.match(/([\d.,]+[kKmM]?)\s+reviews?/i);
  if (m) return parseCount(m[1]);
  m = text.match(/\(\s*([\d.,]+)\s*\)/);
  if (m) return parseCount(m[1]);
  return null;
}

/** Extract listing id + slug from an Etsy listing URL. */
export function parseListingUrl(href: string): { listingId: string; url: string } | null {
  const m = href.match(/\/listing\/(\d+)(?:\/([^?#]+))?/);
  if (!m) return null;
  return { listingId: m[1] as string, url: href.split("?")[0] as string };
}

/** "Listed on Oct 1, 2025" -> ISO date (or null). */
export function parseListedOn(text: string): string | null {
  const m = text.match(/listed on\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/i);
  if (!m) return null;
  const t = Date.parse(m[1] as string);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/** "1,234 sales" -> 1234 */
export function parseSalesCount(text: string): number | null {
  const m = text.match(/([\d.,]+[kKmM]?)\s+sales/i);
  if (!m) return null;
  return parseCount(m[1]);
}
