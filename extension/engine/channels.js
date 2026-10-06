/**
 * Hidden Winner Finder - Customer Traffic Channels Engine
 * Evaluates 7 core acquisition channels:
 *  - Etsy Search
 *  - Pinterest
 *  - TikTok
 *  - Instagram
 *  - Google
 *  - YouTube Shorts
 *  - Facebook Groups
 *
 * Identifies the #1 primary channel and provides actionable marketing playbooks.
 */

const CustomerChannelsEngine = {
  /**
   * Evaluates acquisition channels for a product.
   * @param {Object} product
   */
  evaluate(product) {
    const isVisual = true;
    const isGift = product.name.toLowerCase().includes('ornament') || product.name.toLowerCase().includes('gift') || product.name.toLowerCase().includes('personalized');
    const isImpulse = Number(product.price || 15) <= 25;

    const channels = [
      {
        id: 'etsy_search',
        name: 'Etsy Search',
        icon: '🧶',
        fitScore: isGift ? 97 : 85,
        type: 'Organic Search Engine',
        difficulty: 'Low',
        cost: 'Free Organic (Listing fee only)',
        verdict: 'Highest Intent Buyers',
        strategy: 'Include exact long-tail keywords in your first 40 title characters and all 13 tags. Add 10 clear lifestyle photos and a 15-second product video to trigger Etsy\'s algorithm boost.'
      },
      {
        id: 'pinterest',
        name: 'Pinterest',
        icon: '📌',
        fitScore: isGift ? 94 : 88,
        type: 'Visual Discovery & Gift Curation',
        difficulty: 'Low–Medium',
        cost: 'Free Organic / Low CPC',
        verdict: 'Long-Term Evergreen Traffic',
        strategy: 'Create vertical 2:3 pins with text overlays like "Thoughtful Pet Gifts Under $20". Pins stay active and drive sales for 6–12 months without expiring.'
      },
      {
        id: 'tiktok',
        name: 'TikTok',
        icon: '🎵',
        fitScore: isImpulse ? 91 : 78,
        type: 'Short-Form Viral Video',
        difficulty: 'Medium',
        cost: 'Free Organic or TikTok Shop Affiliates',
        verdict: 'Instant Explosive Virality',
        strategy: 'Post behind-the-scenes packing orders or laser engraving satisfying ASMR videos. Use sound bites like "Tell me your dog\'s name and watch me make this".'
      },
      {
        id: 'instagram',
        name: 'Instagram (Reels & DMs)',
        icon: '📸',
        fitScore: 86,
        type: 'Visual Lifestyle & Community',
        difficulty: 'Medium',
        cost: 'Free Organic / Micro-influencers',
        verdict: 'Brand Loyalty & Aesthetic',
        strategy: 'Partner with micro pet influencers (5k–25k followers) by gifting them free personalized samples in exchange for an unboxing reel.'
      },
      {
        id: 'google',
        name: 'Google (SEO & Shopping)',
        icon: '🔍',
        fitScore: 82,
        type: 'High-Intent Search',
        difficulty: 'Medium–High',
        cost: 'Free Organic or Google Shopping Ads',
        verdict: 'Year-Round Buying Volume',
        strategy: 'Target high-intent search terms ("personalized pet ornament fast shipping"). Optimized Etsy listings automatically appear in Google Shopping free listings.'
      },
      {
        id: 'youtube_shorts',
        name: 'YouTube Shorts',
        icon: '▶️',
        fitScore: 79,
        type: 'Short-Form Evergreen Video',
        difficulty: 'Medium',
        cost: 'Free Organic',
        verdict: 'Searchable Video Reach',
        strategy: 'Upload 30-second maker videos demonstrating the craftsmanship. YouTube Shorts index in regular Google search results for long-term residual traffic.'
      },
      {
        id: 'facebook_groups',
        name: 'Facebook Groups',
        icon: '👥',
        fitScore: 84,
        type: 'Niche Community Discussions',
        difficulty: 'Low',
        cost: 'Free Organic',
        verdict: 'Warm Dedicated Enthusiasts',
        strategy: 'Participate genuinely in breed-specific dog/cat lover groups. Share photos asking for feedback or running a free holiday giveaway to capture group interest.'
      }
    ];

    // Sort by fit score
    channels.sort((a, b) => b.fitScore - a.fitScore);
    const primary = channels[0];

    return {
      primaryChannel: {
        name: primary.name,
        icon: primary.icon,
        fitScore: primary.fitScore,
        verdict: primary.verdict,
        strategy: primary.strategy
      },
      allChannels: channels
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = CustomerChannelsEngine;
}
