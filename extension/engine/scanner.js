/**
 * Hidden Winner Finder - Scanner & Ranking Engine
 * Coordinates discovery, multi-platform ranking, and singles out the #1 WINNING PRODUCT.
 */

const MarketScanner = {
  /**
   * Scans the market with user filters and returns a ranked list of opportunities.
   * @param {Object} filters
   * @returns {Array} Ranked opportunities
   */
  scanMarket(filters = {}) {
    const list = CuratedDatabase.findOpportunities(filters);
    return list.map((item, index) => ({
      rank: index + 1,
      ...item
    }));
  },

  /**
   * The CORE FEATURE:
   * "FIND MY WINNING PRODUCT"
   * Analyzes available marketplace data and returns ONLY the single best opportunity (#1)
   * with its complete enriched intelligence dossier.
   *
   * @param {Object} filters
   */
  findWinningProduct(filters = {}) {
    const ranked = this.scanMarket(filters);
    if (!ranked || ranked.length === 0) {
      return null;
    }

    const winner = ranked[0]; // #1 best opportunity
    return this.enrichWinningDossier(winner, filters);
  },

  /**
   * Enriches a product with full analysis dossiers:
   *  - Why this product
   *  - Sourcing options
   *  - Marketplaces
   *  - Ideas & keywords
   *  - Customer channels
   *  - Confidence score
   */
  enrichWinningDossier(product, filters = {}) {
    const marketplaceAnalysis = MarketplaceAnalyzer.analyze(product);
    const sourcingOptions = SourcingEngine.getSources(product);
    const ideasToolkit = ProductIdeasGenerator.generate(product);
    const customerChannels = CustomerChannelsEngine.evaluate(product);

    // Compute Confidence Score based on data signals
    const signalCount = (product.competingListings ? 1 : 0) +
                        (product.medianReviews ? 1 : 0) +
                        (product.inCartSignalCount ? 1 : 0) +
                        (product.favoritesSignalCount ? 1 : 0) +
                        (product.reviewVelocityMonthly ? 1 : 0);

    const confidence = signalCount >= 4 ? 'High' : signalCount >= 2 ? 'Medium' : 'Low';

    return {
      rank: 1,
      isWinner: true,
      id: product.id,
      name: product.name,
      category: product.category,
      subCategory: product.subCategory,
      price: product.price,
      cost: product.cost,
      shippingCost: product.shippingCost,
      opportunityScore: product.opportunityScore,
      demandScore: product.demandScore,
      demandLevel: product.demandLevel,
      demandData: product.demandData,
      competitionScore: product.competitionScore,
      competitionLevel: product.competitionLevel,
      competitionColor: product.competitionColor,
      competitionData: product.competitionData,
      profitScore: product.profitScore,
      profitMargin: product.profitMargin,
      profitMarginFormatted: product.profitMarginFormatted,
      profitData: product.profitData,
      trendScore: product.trendScore,
      trendLabel: product.trendLabel,
      trendData: product.trendData,
      estimatedMonthlySales: product.demandData.estimatedMonthlySales,
      estimatedMonthlyRevenue: product.demandData.estimatedMonthlyRevenue,
      averagePrice: `$${Number(product.price).toFixed(2)}`,
      beginnerFriendly: product.beginnerFriendly !== false,
      whySelected: product.whySelected || [
        'Strong customer demand driven by frequent daily transactions and high wishlist saves.',
        'Few strong competitors with defensive review moats; top sellers have under 100 reviews.',
        `Healthy profit margin (${product.profitMarginFormatted}) with low cost of goods.`,
        'Growing search interest and positive trajectory over the last 90 days.',
        'Multiple angles for custom differentiation (design, materials, packaging, bundles).',
        'Extremely beginner friendly with easy order fulfillment and low upfront risk.'
      ],
      sourcing: sourcingOptions,
      marketplaces: marketplaceAnalysis,
      ideas: ideasToolkit,
      channels: customerChannels,
      confidence: {
        level: confidence,
        badgeClass: confidence === 'High' ? 'badge-conf-high' : 'badge-conf-med',
        dataPointsCount: signalCount,
        disclaimer: 'Based on publicly observable marketplace signals, search result counts, review accumulation velocity, and category fee models. Sales and revenue metrics are estimates.'
      }
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = MarketScanner;
}
