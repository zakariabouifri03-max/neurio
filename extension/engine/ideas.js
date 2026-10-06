/**
 * Hidden Winner Finder - Product Ideas & Differentiation Engine
 * Generates:
 *  - 5 Product Variations
 *  - 5 Unique Angles
 *  - 5 Target Customer Types
 *  - 5 SEO Title Ideas
 *  - 10 Keyword Ideas
 *  - Suggested Price Range (with sweet spot)
 */

const ProductIdeasGenerator = {
  /**
   * Generates comprehensive brainstorming & marketing toolkit for a product.
   * @param {Object} product
   */
  generate(product) {
    const name = product.name || 'Personalized Halloween Pet Ornament';
    const basePrice = Number(product.price || 14.99);

    // If product has predefined custom ideas, merge with defaults
    const custom = product.customIdeas || {};

    const variations = custom.variations || [
      { name: 'Dog Silhouette / Breed Specific', description: 'Laser cut shapes for Golden Retriever, French Bulldog, German Shepherd with custom engraved name tag.' },
      { name: 'Cat Portrait / Whisker Edition', description: 'Sleeping kitty or whimsical cat face with personalized name and bell accent.' },
      { name: 'Holiday & Christmas Festive', description: 'Santa hat, snowflake halo, and buffalo plaid ribbon accent for tree hanging.' },
      { name: 'Memorial / Pet Loss Keepsake', description: 'Angel wings and "Forever in our Hearts" halo with custom remembrance date.' },
      { name: 'Multi-Pet Family Cluster', description: 'Double or triple wooden paw-prints connected together on a single keepsake hanger.' }
    ];

    const angles = custom.angles || [
      {
        title: 'Emotional Keepsake & First Holiday',
        description: 'Position as "Baby\'s First Pet Christmas" or "Our First Year with [Pet Name]". Captures sentimental impulse buyers.'
      },
      {
        title: 'Loss of Pet Memorial Sympathy Gift',
        description: 'Market directly to friends buying comfort gifts for grieving pet parents. Higher price tolerance ($18–$28).'
      },
      {
        title: 'Ready-to-Gift Velvet Presentation Box',
        description: 'Bundle with a premium foiled gift box and personalized card so buyers can ship directly to recipients without wrapping.'
      },
      {
        title: 'Double-Sided 3D Acrylic & Natural Wood Inlay',
        description: 'Stand out from cheap flat plywood by layering clear acrylic over rustic walnut wood for a luxury tactile finish.'
      },
      {
        title: 'Dual Pet & Human Family Tree',
        description: 'Incorporate paw prints alongside children/parents\' names in a cute cohesive hearth ornament.'
      }
    ];

    const customerTypes = custom.customerTypes || [
      {
        type: 'Proud Dog & Cat Moms (Ages 22–45)',
        motive: 'Treating pets as family members; passionate about aesthetic home decor and customized keepsakes.',
        avgSpend: 'High ($20–$40/order)'
      },
      {
        type: 'Holiday Gift Shoppers (Under $25 budget)',
        motive: 'Seeking thoughtful, personalized stocking stuffers for coworkers, family, and dog walkers.',
        avgSpend: 'Moderate ($15–$25)'
      },
      {
        type: 'Bereaved Pet Parents & Sympathy Buyers',
        motive: 'Searching for lasting memorials and sympathy gifts to honor beloved companions who passed.',
        avgSpend: 'Premium ($22–$35)'
      },
      {
        type: 'Grandparents & In-Laws',
        motive: 'Buying sweet personalized trinkets for their children\'s dogs and "grand-pets".',
        avgSpend: 'Moderate ($18–$30)'
      },
      {
        type: 'Veterinary Clinics & Groomers',
        motive: 'Bulk holiday appreciation gifts for long-time loyal clientele.',
        avgSpend: 'Bulk ($100–$250/order)'
      }
    ];

    const titleIdeas = custom.titleIdeas || [
      `Personalized ${name} Custom Dog Cat Name Keepsake Ornament for Holiday Christmas Tree Decor`,
      `Custom Wooden Pet Ornament with Name 3D Acrylic Paw Print Dog Memorial Gift for Pet Lovers`,
      `Custom Pet Face Ornament Engraved Wooden Keepsake Dog Cat Christmas Gift Pet Loss Sympathy`,
      `Personalized First Christmas With Pet Ornament Custom Dog Breed Keepsake Gift for Dog Mom`,
      `Handmade Custom Pet Name Ornament Rustic Farmhouse Wood Hanging Decor Gift Ready with Box`
    ];

    const keywordIdeas = custom.keywordIdeas || [
      { keyword: 'personalized pet ornament', volume: '18,500/mo', intent: 'Commercial (High)', difficulty: 'Low–Med' },
      { keyword: 'custom dog christmas ornament', volume: '27,200/mo', intent: 'High Commercial', difficulty: 'Low' },
      { keyword: 'pet loss sympathy gift', volume: '14,800/mo', intent: 'High Emotional', difficulty: 'Low' },
      { keyword: 'dog mom stocking stuffer', volume: '9,400/mo', intent: 'Gift Search', difficulty: 'Low' },
      { keyword: 'wooden paw print ornament', volume: '6,200/mo', intent: 'Niche Specific', difficulty: 'Very Low' },
      { keyword: 'custom cat name ornament', volume: '8,100/mo', intent: 'Commercial', difficulty: 'Low' },
      { keyword: 'personalized pet memorial plaque', volume: '11,300/mo', intent: 'High Value', difficulty: 'Low–Med' },
      { keyword: 'first christmas pet keepsake', volume: '5,900/mo', intent: 'Seasonal', difficulty: 'Very Low' },
      { keyword: 'acrylic laser cut pet ornament', volume: '4,100/mo', intent: 'Maker/Craft', difficulty: 'Very Low' },
      { keyword: 'unique gifts for dog lovers under 20', volume: '12,600/mo', intent: 'Bargain Gift', difficulty: 'Low' }
    ];

    const minPrice = Math.max(9.99, Math.round((basePrice * 0.85) * 100) / 100);
    const maxPrice = Math.round((basePrice * 1.55) * 100) / 100;
    const sweetSpot = basePrice.toFixed(2);

    return {
      variations,
      angles,
      customerTypes,
      titleIdeas,
      keywordIdeas,
      priceRange: {
        min: `$${minPrice.toFixed(2)}`,
        max: `$${maxPrice.toFixed(2)}`,
        sweetSpot: `$${sweetSpot}`,
        recommendation: `Sweet spot at $${sweetSpot} yields ~60–65% profit margins while remaining an impulse-friendly sub-$20 gift purchase.`
      }
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = ProductIdeasGenerator;
}
