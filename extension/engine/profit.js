/**
 * Hidden Winner Finder - Profit & Fee Calculator
 * Calculates product margins, marketplace fees, net profit, and ROI.
 */

const ProfitCalculator = {
  // Typical platform fee rates
  feeSchedules: {
    etsy: {
      name: 'Etsy',
      transactionRate: 0.065, // 6.5% transaction fee
      listingFee: 0.20,      // $0.20 per listing
      paymentRate: 0.03,     // 3% payment processing
      paymentFixed: 0.25     // $0.25 flat
    },
    amazon: {
      name: 'Amazon (FBM/Referral)',
      transactionRate: 0.15, // 15% standard category referral
      listingFee: 0.00,
      paymentRate: 0.00,
      paymentFixed: 0.00
    },
    ebay: {
      name: 'eBay',
      transactionRate: 0.1325, // 13.25% final value
      listingFee: 0.00,
      paymentRate: 0.00,
      paymentFixed: 0.30
    },
    walmart: {
      name: 'Walmart Marketplace',
      transactionRate: 0.15,
      listingFee: 0.00,
      paymentRate: 0.00,
      paymentFixed: 0.00
    },
    tiktok: {
      name: 'TikTok Shop',
      transactionRate: 0.06, // 6% referral commission
      listingFee: 0.00,
      paymentRate: 0.00,
      paymentFixed: 0.30
    },
    shopify: {
      name: 'Shopify / DTC',
      transactionRate: 0.00,
      listingFee: 0.00,
      paymentRate: 0.029, // 2.9% + 30c
      paymentFixed: 0.30
    }
  },

  /**
   * Calculates comprehensive profit metrics.
   * @param {Object} params
   * @param {number} params.sellingPrice
   * @param {number} params.productCost
   * @param {number} params.shippingCost
   * @param {string} [params.marketplace='etsy']
   * @param {number} [params.customFees=null]
   */
  calculate({
    sellingPrice = 19.99,
    productCost = 5.20,
    shippingCost = 2.10,
    marketplace = 'etsy',
    customFees = null
  }) {
    const sp = Math.max(0.01, Number(sellingPrice) || 0);
    const cost = Math.max(0, Number(productCost) || 0);
    const ship = Math.max(0, Number(shippingCost) || 0);

    let fees = 0;
    if (customFees !== null && customFees !== undefined) {
      fees = Number(customFees);
    } else {
      const schedule = this.feeSchedules[marketplace.toLowerCase()] || this.feeSchedules.etsy;
      fees = (sp * schedule.transactionRate) +
             schedule.listingFee +
             (sp * schedule.paymentRate) +
             schedule.paymentFixed;
    }

    // Round fees to 2 decimal places
    const roundedFees = Math.round(fees * 100) / 100;
    const totalCost = cost + ship + roundedFees;
    const netProfit = Math.round((sp - totalCost) * 100) / 100;
    const profitMargin = sp > 0 ? Math.round((netProfit / sp) * 100) : 0;
    const roi = totalCost > 0 ? Math.round((netProfit / (cost + ship)) * 100) : 0;

    return {
      sellingPrice: sp.toFixed(2),
      productCost: cost.toFixed(2),
      shippingCost: ship.toFixed(2),
      marketplaceFees: roundedFees.toFixed(2),
      totalExpenses: totalCost.toFixed(2),
      estimatedProfit: netProfit.toFixed(2),
      profitMargin: profitMargin,
      profitMarginFormatted: `${profitMargin}%`,
      roi: roi,
      roiFormatted: `${roi}%`,
      isProfitable: netProfit > 0,
      marketplaceName: (this.feeSchedules[marketplace.toLowerCase()] || {}).name || 'Marketplace'
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = ProfitCalculator;
}
