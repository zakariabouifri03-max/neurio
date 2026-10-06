/**
 * Hidden Winner Finder - Marketplace Analysis Engine
 * Compares multi-channel opportunity across Etsy, Amazon, eBay, Walmart, TikTok Shop, Shopify.
 * Recommends the single BEST marketplace for the specific product.
 */

const MarketplaceAnalyzer = {
  /**
   * Analyzes where the product opportunity is strongest.
   * @param {Object} product
   */
  analyze(product) {
    const category = (product.category || '').toLowerCase();
    const isPersonalized = product.name.toLowerCase().includes('personalized') || product.name.toLowerCase().includes('custom');
    const isViralImpulse = product.price <= 25 && (product.trend || '').toLowerCase().includes('rising');
    const isDigital = product.isDigital === true;

    // Platform configurations
    const platforms = [
      {
        id: 'etsy',
        name: 'Etsy',
        icon: '🧶',
        tagline: 'Personalized, Handmade, Gifts & Vintage',
        demand: isPersonalized || isDigital || category.includes('craft') ? 'High' : 'Medium',
        competition: isPersonalized ? 'Low' : 'Medium',
        opportunity: isPersonalized ? 'Excellent' : 'Great',
        feeSummary: '6.5% transaction + $0.20 listing fee',
        suitabilityScore: isPersonalized ? 96 : 82,
        bestFor: 'Personalized gifts, laser-cut decor, handmade items, and digital templates.',
        pros: ['Built-in audience of gift shoppers willing to pay premium', 'High search intent for personalized goods', 'Low barrier to open a store'],
        cons: ['Listing fees renew every 4 months', 'Platform ads can be aggressive']
      },
      {
        id: 'tiktok',
        name: 'TikTok Shop',
        icon: '📱',
        tagline: 'Viral Impulse Buys & Creator Affiliate Sales',
        demand: isViralImpulse ? 'High' : 'Medium',
        competition: 'Low',
        opportunity: isViralImpulse ? 'Excellent' : 'Good',
        feeSummary: '6% referral commission',
        suitabilityScore: isViralImpulse ? 92 : 75,
        bestFor: 'Visually satisfying products, emotional pet gifts, unboxing hooks.',
        pros: ['Uncapped organic algorithmic reach', 'Enormous affiliate army will promote for 15% commission', 'Lowest platform fee rate'],
        cons: ['Requires short-form video creation or sending samples to creators']
      },
      {
        id: 'amazon',
        name: 'Amazon',
        icon: '📦',
        tagline: 'Massive Traffic & Prime Customer Base',
        demand: 'Very High',
        competition: 'Medium',
        opportunity: 'Great',
        feeSummary: '15% referral fee + FBA/shipping',
        suitabilityScore: 84,
        bestFor: 'Functional products, evergreen gifts with FBM or Amazon Custom.',
        pros: ['Largest e-commerce buyer volume on the planet', 'Amazon Custom program allows name personalization', 'High repeat purchase rate'],
        cons: ['Stricter seller performance metrics and return policies']
      },
      {
        id: 'ebay',
        name: 'eBay',
        icon: '🏷️',
        tagline: 'Collectible, Niche, and Bargain Shoppers',
        demand: 'Medium',
        competition: 'Low',
        opportunity: 'Good',
        feeSummary: '13.25% final value fee + $0.30',
        suitabilityScore: 72,
        bestFor: 'Niche hobbyists, replacement parts, vintage & retro styles.',
        pros: ['Lenient listing policies and global shipping program', 'Low start-up friction'],
        cons: ['Customers are more price sensitive than on Etsy']
      },
      {
        id: 'walmart',
        name: 'Walmart Marketplace',
        icon: '🛒',
        tagline: 'Rapidly Growing US Domestic Marketplace',
        demand: 'Medium',
        competition: 'Low',
        opportunity: 'Great',
        feeSummary: '15% referral commission',
        suitabilityScore: 78,
        bestFor: 'Household essentials, pet supplies, seasonal family gifts.',
        pros: ['Far less seller competition than Amazon', 'Walmart+ customer expansion'],
        cons: ['Application approval required for new sellers']
      },
      {
        id: 'shopify',
        name: 'Shopify / DTC Store',
        icon: '🛍️',
        tagline: 'Independent Brand & Full Customer Ownership',
        demand: 'Channel-Driven',
        competition: 'Zero on your own domain',
        opportunity: 'Great (Scale Stage)',
        feeSummary: '2.9% + $0.30 payment processing',
        suitabilityScore: 80,
        bestFor: 'Building long-term brand equity, email lists, and high average order value.',
        pros: ['Keep 100% customer emails and repeat marketing data', 'Zero platform rules or deactivation risk'],
        cons: ['Must drive your own paid ads (Meta/TikTok/Google) or SEO traffic']
      }
    ];

    // Select the best marketplace
    let best = platforms[0];
    if (product.preferredMarketplace) {
      const match = platforms.find(p => p.name.toLowerCase().includes(product.preferredMarketplace.toLowerCase()) || p.id === product.preferredMarketplace.toLowerCase());
      if (match) best = match;
    } else {
      // sort by suitability score
      const sorted = [...platforms].sort((a, b) => b.suitabilityScore - a.suitabilityScore);
      best = sorted[0];
    }

    return {
      bestMarketplace: {
        name: best.name,
        icon: best.icon,
        competition: best.competition,
        demand: best.demand,
        opportunity: best.opportunity,
        reason: best.bestFor,
        suitabilityScore: best.suitabilityScore,
        feeSummary: best.feeSummary,
        pros: best.pros
      },
      allPlatforms: platforms
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = MarketplaceAnalyzer;
}
