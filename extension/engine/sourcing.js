/**
 * Hidden Winner Finder - Sourcing & Supplier Engine
 * Matches product opportunities to real, actionable sourcing channels:
 *  - Alibaba
 *  - AliExpress
 *  - CJdropshipping
 *  - Printful
 *  - Printify
 *  - Local manufacturers
 *  - Handmade / Custom suppliers
 *  - Digital-product alternatives (when applicable)
 *
 * Clearly marks all estimates and provides direct search links.
 */

const SourcingEngine = {
  /**
   * Generates supplier options based on product type, strategy, and base pricing.
   * @param {Object} product
   */
  getSources(product) {
    const title = product.name || 'Personalized Pet Ornament';
    const cleanQuery = encodeURIComponent(product.sourcingQuery || title);
    const sellingPrice = Number(product.price || 14.99);

    const isPodCompatible = product.podCompatible !== false;
    const isDigital = product.isDigital === true;
    const isHandmadeCustom = product.handmadeCustom !== false;

    const sources = [];

    // 1. AliExpress (Testing / Low MOQ / Dropshipping)
    const aliCost = Math.round((sellingPrice * 0.22) * 100) / 100;
    const aliShip = Math.round((sellingPrice * 0.12) * 100) / 100;
    const aliFees = Math.round((sellingPrice * 0.12) * 100) / 100;
    const aliProfit = Math.max(1.5, Math.round((sellingPrice - aliCost - aliShip - aliFees) * 100) / 100);

    sources.push({
      id: 'aliexpress',
      supplier: 'AliExpress (Direct / Fast Dropship)',
      badge: 'Best for Testing',
      type: 'Direct Manufacturer / Reseller',
      estimatedCost: `$${aliCost.toFixed(2)}`,
      shipping: `$${aliShip.toFixed(2)} (7–12 days ePacket)`,
      minimumOrder: '1 unit (No upfront inventory)',
      estimatedSellingPrice: `$${sellingPrice.toFixed(2)}`,
      estimatedProfit: `$${aliProfit.toFixed(2)} (${Math.round((aliProfit / sellingPrice) * 100)}% margin)`,
      supplierLink: `https://www.aliexpress.com/wholesale?SearchText=${cleanQuery}`,
      linkText: 'Search AliExpress Suppliers ↗',
      advantage: 'Zero upfront inventory risk, ideal for testing market demand.',
      isEstimate: true
    });

    // 2. Alibaba (Bulk Wholesale / Private Label / Best Margins)
    const babaCost = Math.max(0.75, Math.round((sellingPrice * 0.14) * 100) / 100);
    const babaShip = Math.max(0.50, Math.round((sellingPrice * 0.08) * 100) / 100);
    const babaFees = Math.round((sellingPrice * 0.12) * 100) / 100;
    const babaProfit = Math.max(3.0, Math.round((sellingPrice - babaCost - babaShip - babaFees) * 100) / 100);

    sources.push({
      id: 'alibaba',
      supplier: 'Alibaba (Wholesale / Private Label)',
      badge: 'Highest Profit Margin',
      type: 'Verified OEM / ODM Factory',
      estimatedCost: `$${babaCost.toFixed(2)}`,
      shipping: `$${babaShip.toFixed(2)} / unit (Sea/Air freight)`,
      minimumOrder: '50–100 units',
      estimatedSellingPrice: `$${sellingPrice.toFixed(2)}`,
      estimatedProfit: `$${babaProfit.toFixed(2)} (${Math.round((babaProfit / sellingPrice) * 100)}% margin)`,
      supplierLink: `https://www.alibaba.com/trade/search?SearchText=${cleanQuery}&tab=all`,
      linkText: 'Search Alibaba Factories ↗',
      advantage: 'Custom laser engraving, custom packaging, and maximum margin on re-orders.',
      isEstimate: true
    });

    // 3. CJdropshipping (Fast Agent / Automated Fulfillment)
    const cjCost = Math.round((sellingPrice * 0.25) * 100) / 100;
    const cjShip = Math.round((sellingPrice * 0.14) * 100) / 100;
    const cjProfit = Math.max(2.0, Math.round((sellingPrice - cjCost - cjShip - (sellingPrice * 0.12)) * 100) / 100);

    sources.push({
      id: 'cjdropshipping',
      supplier: 'CJdropshipping (Warehoused Dropship)',
      badge: 'Automated Sync',
      type: 'Sourcing Agent & 3PL',
      estimatedCost: `$${cjCost.toFixed(2)}`,
      shipping: `$${cjShip.toFixed(2)} (6–10 days CJ Packet)`,
      minimumOrder: '1 unit',
      estimatedSellingPrice: `$${sellingPrice.toFixed(2)}`,
      estimatedProfit: `$${cjProfit.toFixed(2)} (${Math.round((cjProfit / sellingPrice) * 100)}% margin)`,
      supplierLink: `https://cjdropshipping.com/listProduct.html?key=${cleanQuery}`,
      linkText: 'View on CJdropshipping ↗',
      advantage: 'Direct store API auto-fulfillment with custom inserts and faster delivery.',
      isEstimate: true
    });

    // 4. Printify (Print on Demand Network)
    if (isPodCompatible) {
      const pfyCost = Math.round((sellingPrice * 0.32) * 100) / 100;
      const pfyShip = 3.99;
      const pfyProfit = Math.max(2.5, Math.round((sellingPrice - pfyCost - (sellingPrice * 0.12)) * 100) / 100);

      sources.push({
        id: 'printify',
        supplier: 'Printify (Print-On-Demand Network)',
        badge: 'No Equipment Needed',
        type: 'On-Demand Printing & Fulfillment',
        estimatedCost: `$${pfyCost.toFixed(2)}`,
        shipping: `$${pfyShip.toFixed(2)} (Standard USA 3–5 days)`,
        minimumOrder: '1 unit (Print as orders come in)',
        estimatedSellingPrice: `$${sellingPrice.toFixed(2)}`,
        estimatedProfit: `$${pfyProfit.toFixed(2)} (${Math.round((pfyProfit / sellingPrice) * 100)}% margin)`,
        supplierLink: `https://printify.com/app/products?search=${cleanQuery}`,
        linkText: 'Search Printify Catalog ↗',
        advantage: 'Zero inventory cost, automatic integration with Etsy, Shopify, & TikTok Shop.',
        isEstimate: true
      });
    }

    // 5. Printful (Premium Print on Demand)
    if (isPodCompatible) {
      const pfulCost = Math.round((sellingPrice * 0.36) * 100) / 100;
      const pfulShip = 3.99;
      const pfulProfit = Math.max(2.0, Math.round((sellingPrice - pfulCost - (sellingPrice * 0.12)) * 100) / 100);

      sources.push({
        id: 'printful',
        supplier: 'Printful (Premium POD & Branding)',
        badge: 'Premium Brand Quality',
        type: 'In-House Print & Embroidery',
        estimatedCost: `$${pfulCost.toFixed(2)}`,
        shipping: `$${pfulShip.toFixed(2)} (2–5 days domestic)`,
        minimumOrder: '1 unit',
        estimatedSellingPrice: `$${sellingPrice.toFixed(2)}`,
        estimatedProfit: `$${pfulProfit.toFixed(2)} (${Math.round((pfulProfit / sellingPrice) * 100)}% margin)`,
        supplierLink: `https://www.printful.com/custom-products?search=${cleanQuery}`,
        linkText: 'Search Printful Catalog ↗',
        advantage: 'Premium garment/acrylic blanks, custom pack-ins, and consistent print quality.',
        isEstimate: true
      });
    }

    // 6. Local Manufacturers (USA / UK / Regional)
    const localCost = Math.round((sellingPrice * 0.35) * 100) / 100;
    const localShip = 2.99;
    const localProfit = Math.max(3.0, Math.round((sellingPrice - localCost - localShip - (sellingPrice * 0.12)) * 100) / 100);

    sources.push({
      id: 'local_mfg',
      supplier: 'Local Domestic Manufacturers (ThomasNet / MakerRow)',
      badge: 'Fast Domestic Shipping',
      type: 'Domestic Fabricator / Laser Cutters',
      estimatedCost: `$${localCost.toFixed(2)}`,
      shipping: `$${localShip.toFixed(2)} (1–3 days USPS Ground Advantage)`,
      minimumOrder: '25–50 units',
      estimatedSellingPrice: `$${sellingPrice.toFixed(2)}`,
      estimatedProfit: `$${localProfit.toFixed(2)} (${Math.round((localProfit / sellingPrice) * 100)}% margin)`,
      supplierLink: `https://www.thomasnet.com/search.html?cov=NA&what=${cleanQuery}`,
      linkText: 'Find Local Fabricators ↗',
      advantage: '"Made in USA" / domestic badge boosts conversion rate by 20–35% on Etsy.',
      isEstimate: true
    });

    // 7. Handmade / Custom Suppliers (Artisan Blanks & DIY assembly)
    if (isHandmadeCustom) {
      const craftCost = Math.round((sellingPrice * 0.20) * 100) / 100;
      const craftShip = 1.80;
      const craftProfit = Math.max(4.0, Math.round((sellingPrice - craftCost - craftShip - (sellingPrice * 0.12)) * 100) / 100);

      sources.push({
        id: 'handmade',
        supplier: 'Handmade / Custom Blanks (Laser blanks + Vinyl/UV)',
        badge: 'Craft Differentiation',
        type: 'Unfinished Wood / Acrylic / Ceramic Blanks',
        estimatedCost: `$${craftCost.toFixed(2)} (Raw blanks + ribbon/box)`,
        shipping: `$${craftShip.toFixed(2)} (First class mail)`,
        minimumOrder: '10–25 blank units',
        estimatedSellingPrice: `$${sellingPrice.toFixed(2)}`,
        estimatedProfit: `$${craftProfit.toFixed(2)} (${Math.round((craftProfit / sellingPrice) * 100)}% margin)`,
        supplierLink: `https://www.etsy.com/search?q=${encodeURIComponent(cleanQuery + ' craft blanks wholesale')}`,
        linkText: 'Search Craft Blanks on Etsy ↗',
        advantage: 'Add your own bespoke personalization, higher perceived artisan value.',
        isEstimate: true
      });
    }

    // 8. Digital-Product Alternatives (When applicable)
    if (isDigital || product.digitalAlternativeAvailable) {
      const digitalPrice = Math.min(sellingPrice, 9.99);
      const digitalCost = 0.00;
      const digitalShip = 0.00;
      const digitalFees = Math.round((digitalPrice * 0.10) * 100) / 100;
      const digitalProfit = Math.round((digitalPrice - digitalFees) * 100) / 100;

      sources.push({
        id: 'digital_alt',
        supplier: 'Digital Alternative (Canva Template / SVG / STL File)',
        badge: '90%+ Pure Profit',
        type: 'Instant Digital Download',
        estimatedCost: `$0.00 (Self-created or one-time designer fee)`,
        shipping: '$0.00 (Instant automatic delivery)',
        minimumOrder: '0 (Infinite inventory)',
        estimatedSellingPrice: `$${digitalPrice.toFixed(2)}`,
        estimatedProfit: `$${digitalProfit.toFixed(2)} (90% profit margin)`,
        supplierLink: `https://www.canva.com/templates/?query=${cleanQuery}`,
        linkText: 'Explore Canva / Digital Design ↗',
        advantage: 'Zero physical manufacturing, zero shipping headaches, 100% automated passive delivery.',
        isEstimate: true
      });
    }

    return sources;
  }
};

if (typeof module !== 'undefined') {
  module.exports = SourcingEngine;
}
