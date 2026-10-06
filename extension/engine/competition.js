/**
 * Hidden Winner Finder - Low-Competition Detector
 * Calculates competition using 8 observable marketplace signals.
 *
 * Scoring Scale:
 *   0–30   = Low Competition (Green / Prime Opportunity)
 *   31–60  = Medium Competition (Yellow / Moderate Effort)
 *   61–80  = High Competition (Orange / Saturated)
 *   81–100 = Very High Competition (Red / Severe Moat)
 */

const CompetitionDetector = {
  /**
   * Evaluates competition metrics and calculates a 0–100 score.
   * @param {Object} metrics
   * @param {number} metrics.competingListings - Total search results count
   * @param {number} metrics.strongCompetitors - Sellers with >100 reviews on page 1
   * @param {number} metrics.medianReviews - Median review count of top 10 sellers
   * @param {number} metrics.listingQualityDeficit - Estimated % of listings with poor images/descriptions (0-100)
   * @param {number} metrics.establishedSellerShare - % of page 1 taken by established high-tier sellers (0-100)
   * @param {number} metrics.searchDensity - Ads/sponsored ratio on page 1 (0-100)
   * @param {number} metrics.priceClustering - Degree of price war / race to bottom (0-100)
   * @param {number} metrics.productSimilarity - Degree to which all listings look identical (0-100)
   */
  evaluate(metrics = {}) {
    const {
      competingListings = 1200,
      strongCompetitors = 3,
      medianReviews = 45,
      listingQualityDeficit = 65, // high deficit = good for newcomer = low competition
      establishedSellerShare = 25,
      searchDensity = 20,
      priceClustering = 30,
      productSimilarity = 40
    } = metrics;

    // 1. Competing Listings factor (weight: 20 pts)
    // < 500 = 3 pts, 500-2000 = 7 pts, 2000-8000 = 13 pts, >8000 = 20 pts
    let fListings = 5;
    if (competingListings < 500) fListings = 3;
    else if (competingListings < 1500) fListings = 6;
    else if (competingListings < 4000) fListings = 11;
    else if (competingListings < 10000) fListings = 16;
    else fListings = 20;

    // 2. Strong Competitors with >100 reviews (weight: 18 pts)
    // 0-2 = 4 pts, 3-5 = 9 pts, 6-10 = 14 pts, >10 = 18 pts
    let fStrong = 4;
    if (strongCompetitors <= 2) fStrong = 4;
    else if (strongCompetitors <= 5) fStrong = 9;
    else if (strongCompetitors <= 10) fStrong = 14;
    else fStrong = 18;

    // 3. Median Review Count of top listings (weight: 18 pts)
    // <30 = 3 pts, 30-80 = 7 pts, 80-250 = 12 pts, >250 = 18 pts
    let fReviews = 5;
    if (medianReviews < 30) fReviews = 3;
    else if (medianReviews < 80) fReviews = 7;
    else if (medianReviews < 250) fReviews = 12;
    else fReviews = 18;

    // 4. Listing Quality Factor (weight: 12 pts)
    // High deficit means existing listings have weak photos/copy -> low competitive barrier
    // Score reflects competition, so higher quality deficit lowers competition
    const fQuality = Math.max(2, Math.round((100 - listingQualityDeficit) * 0.12));

    // 5. Established Seller Dominance (weight: 12 pts)
    const fEstablished = Math.round(establishedSellerShare * 0.12);

    // 6. Search Result Density / Sponsored load (weight: 8 pts)
    const fDensity = Math.round(searchDensity * 0.08);

    // 7. Price War / Price Compression (weight: 7 pts)
    const fPrice = Math.round(priceClustering * 0.07);

    // 8. Product Similarity / Generic saturation (weight: 5 pts)
    const fSimilarity = Math.round(productSimilarity * 0.05);

    // Aggregate score bounded 0 - 100
    const rawScore = fListings + fStrong + fReviews + fQuality + fEstablished + fDensity + fPrice + fSimilarity;
    const score = Math.max(5, Math.min(98, rawScore));

    const levelInfo = this.getLevel(score);

    return {
      score,
      level: levelInfo.label,
      levelKey: levelInfo.key,
      color: levelInfo.color,
      badgeClass: levelInfo.badgeClass,
      description: levelInfo.description,
      beginnerFriendly: score <= 35,
      factors: [
        {
          name: 'Competing Listings',
          value: competingListings.toLocaleString() + ' listings',
          rating: fListings <= 6 ? 'Low' : fListings <= 13 ? 'Moderate' : 'High',
          detail: fListings <= 6 ? 'Uncrowded search results' : 'Moderate result count'
        },
        {
          name: 'Strong Competitors (>100 rev)',
          value: strongCompetitors + ' sellers',
          rating: strongCompetitors <= 3 ? 'Very Low' : strongCompetitors <= 6 ? 'Moderate' : 'High',
          detail: strongCompetitors <= 3 ? 'Market is not dominated by giants' : 'A few established stores'
        },
        {
          name: 'Median Top Review Count',
          value: medianReviews + ' reviews',
          rating: medianReviews < 60 ? 'Easy to Outrank' : 'Moderate Threshold',
          detail: medianReviews < 60 ? 'A new seller can match review count in 30–60 days' : 'Requires steady review strategy'
        },
        {
          name: 'Competitor Listing Quality',
          value: (100 - listingQualityDeficit) + '% optimized',
          rating: listingQualityDeficit >= 50 ? 'Weak (Advantage)' : 'Average',
          detail: listingQualityDeficit >= 50 ? 'Competitors have basic photos & poor SEO descriptions' : 'Decent competitor mockups'
        },
        {
          name: 'Brand Dominance',
          value: establishedSellerShare + '% established',
          rating: establishedSellerShare < 30 ? 'Open to Newcomers' : 'Moderate',
          detail: 'Room for independent creators and first-time stores'
        },
        {
          name: 'Price Competition',
          value: priceClustering < 40 ? 'Healthy Spreads' : 'Clustered',
          rating: priceClustering < 40 ? 'Low War Risk' : 'Fair',
          detail: 'Customers buy based on design & value, not just lowest price'
        }
      ]
    };
  },

  getLevel(score) {
    if (score <= 30) {
      return {
        key: 'low',
        label: 'Low Competition',
        color: '#10b981', // emerald
        badgeClass: 'badge-low-competition',
        description: 'Prime opportunity: Few dominant competitors and low review barriers make it easy for a new seller to rank on page 1.'
      };
    }
    if (score <= 60) {
      return {
        key: 'medium',
        label: 'Medium Competition',
        color: '#f59e0b', // amber
        badgeClass: 'badge-medium-competition',
        description: 'Moderate competition: Well-differentiated designs, better photography, or faster shipping can readily capture sales.'
      };
    }
    if (score <= 80) {
      return {
        key: 'high',
        label: 'High Competition',
        color: '#f97316', // orange
        badgeClass: 'badge-high-competition',
        description: 'High competition: Multiple established stores with hundreds of reviews. Requires a standout unique angle.'
      };
    }
    return {
      key: 'very-high',
      label: 'Very High Competition',
      color: '#ef4444', // red
      badgeClass: 'badge-very-high-competition',
      description: 'Severe saturation: Dominated by high-volume sellers with thousands of reviews and tight margins.'
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = CompetitionDetector;
}
