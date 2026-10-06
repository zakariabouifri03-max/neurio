import { describe, expect, it } from "vitest";
import {
  parseCount,
  parseListedOn,
  parseListingUrl,
  parseMoney,
  parseRating,
  parseReviewCount,
  parseSalesCount,
} from "../src/parse.js";

describe("parseMoney", () => {
  it("handles common Etsy formats", () => {
    expect(parseMoney("$19.99")).toBe(19.99);
    expect(parseMoney("SGD 1,234.56")).toBe(1234.56);
    expect(parseMoney("US$ 38.56")).toBe(38.56);
    expect(parseMoney("€12,34")).toBe(12.34);
    expect(parseMoney("1.234,56 €")).toBe(1234.56);
    expect(parseMoney("$1,299")).toBe(1299);
  });
  it("rejects junk", () => {
    expect(parseMoney("Free shipping")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe("parseCount", () => {
  it("parses plain and suffixed counts", () => {
    expect(parseCount("1,234")).toBe(1234);
    expect(parseCount("1.2k")).toBe(1200);
    expect(parseCount("3m")).toBe(3_000_000);
  });
});

describe("parseRating / parseReviewCount", () => {
  it("reads aria-style rating text", () => {
    expect(parseRating("Rated 4.8 out of 5 stars")).toBe(4.8);
    expect(parseRating("4,8 / 5")).toBe(4.8);
    expect(parseRating("no rating")).toBeNull();
    expect(parseRating("9 out of 5 stars")).toBeNull(); // invalid -> null
  });
  it("reads review counts", () => {
    expect(parseReviewCount("386 reviews")).toBe(386);
    expect(parseReviewCount("1,234 reviews")).toBe(1234);
    expect(parseReviewCount("(386)")).toBe(386);
    expect(parseReviewCount("nothing here")).toBeNull();
  });
});

describe("parseListingUrl", () => {
  it("extracts id and strips query strings", () => {
    const r = parseListingUrl("https://www.etsy.com/listing/1234567/halloween-shirt?ref=sr_1_2");
    expect(r?.listingId).toBe("1234567");
    expect(r?.url).toBe("https://www.etsy.com/listing/1234567/halloween-shirt");
    expect(parseListingUrl("https://www.etsy.com/shop/foo")).toBeNull();
  });
});

describe("parseListedOn / parseSalesCount", () => {
  it("parses publicly displayed listing date", () => {
    const iso = parseListedOn("Item details Listed on Sep 1, 2025 · Handmade");
    expect(iso).toBeTruthy();
    expect(iso!.startsWith("2025-09-0")).toBe(true);
  });
  it("parses shop sales counts", () => {
    expect(parseSalesCount("Star Seller 12,345 sales")).toBe(12345);
  });
});
