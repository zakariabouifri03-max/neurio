/**
 * Etsy Signal — shared type contracts.
 *
 * The single most important design decision in this codebase:
 *
 *   REAL DATA and ESTIMATED DATA are different types and can never be
 *   silently converted into one another. A renderer physically cannot
 *   print an `EstimatedBand` into a slot typed for a `RealMetric`.
 *
 * Real data is always "value + source + observedAt".
 * Estimates are always "range + confidence + evidence + limitations".
 */

// ---------------------------------------------------------------------------
// REAL DATA — things we actually saw on a public page the user was viewing.
// ---------------------------------------------------------------------------

/**
 * One raw observation captured from a public Etsy page.
 *
 * Every field is optional except identity+time: a card may be missing a
 * rating, a price, etc. Missing means missing — we never fill these in.
 */
export interface ListingObservation {
  /** Etsy listing id (numeric in the URL /listing/<id>/...). */
  listingId: string;
  /** Canonical listing URL as seen on the page. */
  url?: string;
  /** Title text shown on the card/page (public listing info). */
  title?: string;
  /** Shop name if shown (public listing info). */
  shopName?: string;
  /** Listing price as displayed, in `currency`. */
  price?: number;
  /** Original (pre-discount) price if Etsy shows a strike-through. */
  originalPrice?: number;
  /** ISO-4217-ish code as displayed, e.g. "USD". */
  currency?: string;
  /** Star rating 0–5 as displayed. */
  rating?: number;
  /** Number of reviews shown for this listing. */
  reviewCount?: number;
  /** Shop-wide review count, when publicly shown. */
  shopReviewCount?: number;
  /** Shop-wide sales count, when publicly shown ("1,234 sales"). */
  shopSalesCount?: number;
  /** Favorites count, only when Etsy actually shows it. */
  favoritesCount?: number;
  /** Text badges visible on the card: "Bestseller", "Popular now", "Star Seller"... */
  badges?: string[];
  /** 1-based position among organic results on the SERP this was seen on. */
  searchPosition?: number;
  /** The query whose results this listing appeared in. */
  searchQuery?: string;
  /** Whether this slot was a paid placement ("Ad by Etsy"). */
  isAd?: boolean;
  /** Total number of result slots visible on that SERP page. */
  serpResultCount?: number;
  /** ISO timestamp of when the user's browser saw this. */
  observedAt: string;
  /** Where the observation came from. */
  surface: "search_card" | "listing_page" | "etsy_api";
}

/** A recorded historical snapshot used for velocity/trend math. */
export interface HistoricalSnapshot {
  observedAt: string;
  reviewCount?: number;
  searchPosition?: number;
  price?: number;
  favoritesCount?: number;
}

/** What the extension could extract from one DOM card. */
export interface ExtractedCard {
  observation: ListingObservation;
  /** Which fields we managed to read from the DOM. */
  fieldsFound: string[];
  /** Which fields we looked for but could not read. */
  fieldsMissing: string[];
  /** Selector strategy that matched (for debugging layout changes). */
  strategy: string;
}

// ---------------------------------------------------------------------------
// SIGNALS — normalized evidence fed to the estimation engine.
// ---------------------------------------------------------------------------

export type SignalKind =
  | "review_count"
  | "review_velocity"
  | "listing_age_days"
  | "shop_review_velocity"
  | "search_position"
  | "search_visibility"
  | "favorites_count"
  | "price"
  | "price_discount"
  | "badge"
  | "shop_sales_count"
  | "category_competition"
  | "serp_density";

export type SignalSource =
  | "observed_public_data"
  | "extension_history"
  | "user_authorized_api";

export interface Signal {
  signal: SignalKind;
  /** Numeric value in a canonical unit for that signal kind. */
  value: number;
  /** Human-readable unit, e.g. "reviews/day", "days", "USD". */
  unit: string;
  /** Aggregation period when meaningful, e.g. "30_days", "lifetime". */
  period?: string;
  source: SignalSource;
  /** ISO timestamp of the underlying observation. */
  timestamp: string;
  /**
   * 0..1 reliability weight. Derived from source trustworthiness and data
   * freshness, documented in ESTIMATION_METHODOLOGY.md.
   */
  reliability: number;
}

// ---------------------------------------------------------------------------
// ESTIMATES — always ranges + confidence + evidence. Never point values.
// ---------------------------------------------------------------------------

export interface QuantileSet {
  p10: number;
  p50: number;
  p90: number;
}

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export interface Estimate {
  /** What is being estimated. */
  metric: "sales" | "monthly_sales" | "monthly_revenue";
  /** False unless we had enough legitimate signal to emit a range. */
  available: boolean;
  /** null when !available — we do NOT invent numbers. */
  quantiles?: QuantileSet;
  /** ISO currency or "sales". */
  unit: "USD" | "sales";
  /** 0..100 */
  confidencePct: number;
  confidenceLevel: ConfidenceLevel;
  /** The signals actually used, in human-readable form. */
  evidence: string[];
  /** Named model contributions for the "Why?" panel. */
  modelBreakdown: ModelContribution[];
  /** Known limitations / caveats for this estimate. */
  limitations: string[];
  /** If !available, why not ("Not enough historical observations"...). */
  unavailableReason?: string;
}

export interface ModelContribution {
  model: string;
  /** What the model alone would say (median), for transparency. */
  modelMedian: number | null;
  weight: number;
  reliability: number;
  note: string;
}

// ---------------------------------------------------------------------------
// SCORES
// ---------------------------------------------------------------------------

export type TrendDirection = "rising" | "flat" | "falling" | "unknown";

export interface ScoreComponent {
  name: string;
  /** 0..100 normalized, or null when not enough data. */
  value: number | null;
  weight: number;
  note: string;
}

export interface Score {
  metric: "demand" | "competition" | "opportunity" | "trend";
  available: boolean;
  /** 0..100 — null when unavailable. */
  value: number | null;
  trend?: TrendDirection;
  components: ScoreComponent[];
  interpretation?: string;
  reasons: string[];
  limitations: string[];
}

// ---------------------------------------------------------------------------
// FULL ANALYSIS BUNDLE — what the UI renders for one listing.
// ---------------------------------------------------------------------------

export interface Analysis {
  listingId: string;
  generatedAt: string;
  /** Everything directly observed — always rendered as REAL. */
  real: {
    title?: string;
    url?: string;
    shopName?: string;
    price?: number;
    currency?: string;
    rating?: number;
    reviewCount?: number;
    shopReviewCount?: number;
    shopSalesCount?: number;
    badges?: string[];
    bestSearchPosition?: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
    observationCount: number;
    trackedDays?: number;
  };
  estimates: {
    sales: Estimate;
    monthlySales: Estimate;
    monthlyRevenue: Estimate;
  };
  scores: {
    demand: Score;
    competition: Score;
    opportunity: Score;
    trend: Score;
  };
  /** Raw normalized signals used, for the evidence panel. */
  signals: Signal[];
}

export const ESTIMATE_DISCLAIMER =
  "ESTIMATE — computed by Etsy Signal from publicly observable signals. " +
  "Not official Etsy data. Etsy does not disclose sales figures publicly.";

// ---------------------------------------------------------------------------
// API request/response envelopes
// ---------------------------------------------------------------------------

export interface IngestRequest {
  observations: ListingObservation[];
}

export interface IngestResponse {
  accepted: number;
  rejected: number;
  reasons?: string[];
}

export interface AnalysisRequest {
  listingId: string;
  /** Extra SERP observations for competition scoring. */
  serpPeers?: ListingObservation[];
}

export interface SerpContext {
  query: string;
  observedAt: string;
  resultCount: number;
  medianReviews: number | null;
  medianPrice: number | null;
  adShare: number;
}
