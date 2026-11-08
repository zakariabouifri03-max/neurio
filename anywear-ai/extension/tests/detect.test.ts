import { describe, expect, it } from "vitest";
import {
  scoreCandidate,
  looksIconish,
  looksAvatarish,
  collectCandidates,
  MIN_SCORE,
} from "../src/content/detect";
import type { ScoreInput } from "../src/content/detect";

const base: ScoreInput = {
  width: 600,
  height: 800,
  src: "https://cdn.example.com/product-images/shirt-blue.jpg",
  alt: "Cotton shirt in blue",
  hasDataSrc: false,
  hasSrcset: false,
  nearPrice: false,
  nearProductCard: false,
  isMainGallery: false,
  isAvatarish: false,
  isIconish: false,
};

describe("scoreCandidate", () => {
  it("scores a classic product photo well above the threshold", () => {
    const s = scoreCandidate({ ...base, nearProductCard: true, nearPrice: true });
    expect(s).toBeGreaterThan(MIN_SCORE);
    expect(s).toBeGreaterThan(70);
  });

  it("penalizes logos and icons", () => {
    const s = scoreCandidate({
      ...base,
      src: "https://cdn.example.com/logos/logo-dark.png",
      alt: "Store logo",
      isIconish: true,
    });
    expect(s).toBeLessThan(MIN_SCORE);
  });

  it("penalizes avatars", () => {
    const s = scoreCandidate({
      ...base,
      src: "https://cdn.example.com/avatar-128.png",
      alt: "User avatar",
      isAvatarish: true,
    });
    expect(s).toBeLessThan(MIN_SCORE);
  });

  it("boosts lazy-loaded images near prices", () => {
    const lazy = scoreCandidate({ ...base, hasDataSrc: true, nearPrice: true });
    const plain = scoreCandidate({ ...base });
    expect(lazy).toBeGreaterThan(plain);
  });

  it("handles square product photos (hoodie on white)", () => {
    const s = scoreCandidate({ ...base, width: 800, height: 800, nearProductCard: true });
    expect(s).toBeGreaterThan(MIN_SCORE);
  });
});

describe("looksIconish", () => {
  it("detects sprite strips", () => {
    expect(looksIconish("https://cdn/icons-sprite.png", 2000, 200)).toBe(true);
  });
  it("passes normal photos", () => {
    expect(looksIconish("https://cdn/product.jpg", 600, 800)).toBe(false);
  });
});

describe("looksAvatarish", () => {
  it("detects avatar URLs", () => {
    expect(looksAvatarish("https://cdn/avatar_42.png", "")).toBe(true);
  });
  it("detects avatar alt text", () => {
    expect(looksAvatarish("https://cdn/user.jpg", "Profile picture")).toBe(true);
  });
});

describe("collectCandidates", () => {
  it("parses og:image and JSON-LD from a minimal DOM", () => {
    const html = `<!doctype html><html><head>
      <meta property="og:image" content="https://cdn/og-product.jpg">
      <script type="application/ld+json">
        {"@type":"Product","name":"Linen Dress","image":"https://cdn/dress.jpg"}
      </script>
    </head><body></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = collectCandidates(doc);
    expect(out.length).toBe(2);
    expect(out[0].score).toBe(90);
    expect(out.map((c) => c.src)).toContain("https://cdn/dress.jpg");
  });

  it("dedupes repeated sources", () => {
    const html = `<!doctype html><html><head>
      <meta property="og:image" content="https://cdn/a.jpg">
      <meta property="og:image" content="https://cdn/a.jpg">
    </head><body></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(collectCandidates(doc)).toHaveLength(1);
  });

  it("ignores malformed JSON-LD", () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{not json</script>
    </head><body></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(collectCandidates(doc)).toHaveLength(0);
  });
});
