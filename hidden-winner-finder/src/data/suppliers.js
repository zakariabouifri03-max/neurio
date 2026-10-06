/**
 * suppliers.js - sourcing routes (public platforms only) + the family model that
 * maps a niche to realistic unit economics.
 *
 * IMPORTANT: the cost figures here are planning ranges derived from publicly
 * listed prices and typical wholesale bands. They are ESTIMATES. Every sourcing
 * row the UI renders is labelled "Estimated" and links to the public search page
 * so the user can verify the real quote themselves. The extension never quotes
 * an unverified supplier price as fact, and never contacts a supplier.
 */

import { BASIS } from '../core/metrics.js';

/**
 * Sourcing family = the manufacturing reality of a product.
 * unitCost is the landed unit cost band a small seller typically pays.
 */
export const FAMILIES = {
  'personalized-keepsake': {
    label: 'Personalization / keepsake production',
    icon: '🎨',
    weight: 'light',
    unitCost: [2.1, 4.4],
    shipping: [0.9, 2.6],
    podCapable: true,
    digitalCapable: true,
    leadTime: [2, 7],
    keywords: ['engraved', 'blank ornament', 'sublimation blank'],
  },
  'metal-jewelry': {
    label: 'Metal / jewelry production',
    icon: '💎',
    weight: 'light',
    unitCost: [3.6, 9.8],
    shipping: [1.4, 3.4],
    podCapable: false,
    digitalCapable: false,
    leadTime: [5, 14],
    keywords: ['stainless steel necklace blank', 'engravable pendant wholesale'],
  },
  'small-goods': {
    label: 'Small goods / accessories',
    icon: '🔧',
    weight: 'light',
    unitCost: [0.9, 3.0],
    shipping: [0.5, 1.6],
    podCapable: true,
    digitalCapable: false,
    leadTime: [5, 15],
    keywords: ['keychain blank bulk', 'pvc charm wholesale'],
  },
  'soft-goods': {
    label: 'Textile / sewn goods',
    icon: '🧵',
    weight: 'medium',
    unitCost: [5.5, 13.0],
    shipping: [1.9, 4.6],
    podCapable: true,
    digitalCapable: false,
    leadTime: [7, 21],
    keywords: ['custom bandana printing', 'weighted blanket manufacturer'],
  },
  'hard-goods': {
    label: 'Hard goods / plastic-metal parts',
    icon: '⚙️',
    weight: 'heavy',
    unitCost: [3.0, 11.0],
    shipping: [1.8, 5.2],
    podCapable: false,
    digitalCapable: false,
    leadTime: [10, 25],
    keywords: ['injection moulded part', 'wholesale household gadget'],
  },
  'wood-toy': {
    label: 'Wooden / toy manufacturing',
    icon: '🪵',
    weight: 'heavy',
    unitCost: [10.0, 24.0],
    shipping: [3.2, 7.5],
    podCapable: false,
    digitalCapable: false,
    leadTime: [14, 30],
    keywords: ['montessori busy board manufacturer', 'wooden toy OEM'],
  },
  'tool-kit': {
    label: 'Multi-part kit / accessory bundle',
    icon: '🧰',
    weight: 'medium',
    unitCost: [6.5, 14.5],
    shipping: [2.2, 5.1],
    podCapable: false,
    digitalCapable: true,
    leadTime: [8, 22],
    keywords: ['bread baking tools wholesale', 'kit components OEM'],
  },
  electronics: {
    label: 'Consumer electronics',
    icon: '🔌',
    weight: 'medium',
    unitCost: [3.2, 6.4],
    shipping: [1.4, 3.2],
    podCapable: false,
    digitalCapable: false,
    leadTime: [12, 30],
    keywords: ['led lamp manufacturer', 'usb rechargeable projector wholesale'],
  },
  'print-goods': {
    label: 'Printed goods (large format / textiles)',
    icon: '🖨️',
    weight: 'medium',
    unitCost: [4.0, 9.5],
    shipping: [1.6, 4.0],
    podCapable: true,
    digitalCapable: true,
    leadTime: [4, 12],
    keywords: ['desk mat printing', 'custom print on demand large format'],
  },
  'digital-pattern': {
    label: 'Digital product (no manufacturing)',
    icon: '💾',
    weight: 'none',
    unitCost: [0, 0],
    shipping: [0, 0],
    podCapable: false,
    digitalCapable: true,
    leadTime: [0, 0],
    keywords: ['digital download', 'pdf template'],
  },
  'digital-art': {
    label: 'Digital artwork + print fulfilment',
    icon: '🖼️',
    weight: 'none',
    unitCost: [0, 9.0],
    shipping: [0, 3.9],
    podCapable: true,
    digitalCapable: true,
    leadTime: [1, 6],
    keywords: ['custom portrait artist', 'print on demand wall art'],
  },
};

/**
 * Sourcing platforms. `affinity` lists the families each platform genuinely
 * serves - a supplier that cannot make the product is simply not shown.
 */
export const SUPPLIERS = [
  {
    id: 'alibaba',
    name: 'Alibaba',
    icon: '🏭',
    type: 'bulk-import',
    basis: BASIS.MODELLED,
    affinity: ['personalized-keepsake', 'metal-jewelry', 'small-goods', 'soft-goods', 'hard-goods', 'tool-kit', 'wood-toy', 'electronics', 'print-goods'],
    moqByFamily: {
      'tool-kit': 100,
      'personalized-keepsake': 100,
      'metal-jewelry': 50,
      'small-goods': 300,
      'soft-goods': 100,
      'hard-goods': 100,
      'wood-toy': 50,
      electronics: 100,
      'print-goods': 100,
    },
    costFactor: 0.6,
    shippingFactor: 0.9,
    leadTime: [15, 40],
    inventoryRisk: 'medium',
    bestFor: 'Lowest unit cost, custom branding and packaging at volume.',
    watchOut: 'MOQ + shipping + customs duty. Always order a sample first and check the supplier’s trade assurance.',
    searchUrl: (q) => `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(q)}`,
    queryFor: (product) => `${product.name} ${FAMILIES[product.family]?.keywords?.[1] || ''}`.trim(),
  },
  {
    id: 'aliexpress',
    name: 'AliExpress',
    icon: '🧾',
    type: 'small-batch',
    basis: BASIS.MODELLED,
    affinity: ['personalized-keepsake', 'metal-jewelry', 'small-goods', 'soft-goods', 'hard-goods', 'tool-kit', 'electronics', 'print-goods'],
    moqByFamily: { 'small-goods': 10, default: 1 },
    costFactor: 1.0,
    shippingFactor: 1.0,
    leadTime: [10, 25],
    inventoryRisk: 'low',
    bestFor: 'Testing with almost no MOQ and buy-single units.',
    watchOut: 'Long shipping, inconsistent quality, and the same product is often sold by dozens of other sellers.',
    searchUrl: (q) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`,
    queryFor: (product) => `${product.name} ${FAMILIES[product.family]?.keywords?.[0] || ''}`.trim(),
  },
  {
    id: 'cjdropshipping',
    name: 'CJdropshipping',
    icon: '🚚',
    type: 'dropshipping',
    basis: BASIS.MODELLED,
    affinity: ['personalized-keepsake', 'small-goods', 'soft-goods', 'hard-goods', 'tool-kit', 'electronics', 'print-goods', 'wood-toy'],
    moqByFamily: { default: 1 },
    costFactor: 1.12,
    shippingFactor: 1.15,
    leadTime: [7, 20],
    inventoryRisk: 'very low',
    bestFor: 'No inventory at all, plus print-on-demand and fulfilment services in one account.',
    watchOut: 'Per-unit cost is higher and shipping times can break marketplace delivery promises. Track your on-time rate.',
    searchUrl: (q) => `https://cjdropshipping.com/search?keyword=${encodeURIComponent(q)}`,
    queryFor: (product) => `${product.name}`,
  },
  {
    id: 'printful',
    name: 'Printful',
    icon: '🎽',
    type: 'print-on-demand',
    basis: BASIS.MODELLED,
    affinity: ['personalized-keepsake', 'soft-goods', 'small-goods', 'print-goods', 'digital-art'],
    moqByFamily: { default: 1 },
    costFactor: 1.3,
    shippingFactor: 1.1,
    leadTime: [5, 12],
    inventoryRisk: 'very low',
    bestFor: 'Apparel, textiles and wall art with no stock and decent print quality.',
    watchOut: 'Highest per-unit cost of the POD options; margins only work at a premium price point.',
    searchUrl: () => 'https://www.printful.com/custom-products',
    queryFor: (product) => `${product.name} print on demand`,
  },
  {
    id: 'printify',
    name: 'Printify',
    icon: '🖨️',
    type: 'print-on-demand',
    basis: BASIS.MODELLED,
    affinity: ['personalized-keepsake', 'soft-goods', 'small-goods', 'print-goods', 'digital-art'],
    moqByFamily: { default: 1 },
    costFactor: 1.22,
    shippingFactor: 1.05,
    leadTime: [5, 14],
    inventoryRisk: 'very low',
    bestFor: 'Cheapest POD entry - pick the supplier with the best reviews for your country.',
    watchOut: 'Print quality varies per print provider. Order your own sample from the exact provider you choose.',
    searchUrl: () => 'https://printify.com/catalog/',
    queryFor: (product) => `${product.name} print provider`,
  },
  {
    id: 'handmade-supplier',
    name: 'Handmade / custom suppliers (Etsy, Faire)',
    icon: '🪡',
    type: 'handmade-wholesale',
    basis: BASIS.MODELLED,
    affinity: ['personalized-keepsake', 'metal-jewelry', 'small-goods', 'soft-goods', 'wood-toy', 'digital-art'],
    moqByFamily: { default: 5, 'wood-toy': 10 },
    costFactor: 1.08,
    shippingFactor: 1.0,
    leadTime: [4, 12],
    inventoryRisk: 'low',
    bestFor: 'Personalised and small-batch items where craft quality is the differentiator.',
    watchOut: 'Human capacity is limited - confirm turnaround in writing before you promise dates to buyers.',
    searchUrl: (q) => `https://www.etsy.com/search?q=${encodeURIComponent(`${q} supplies wholesale`)}`,
    queryFor: (product) => `${product.name} blanks`,
  },
  {
    id: 'local-manufacturer',
    name: 'Local manufacturers / makers',
    icon: '📍',
    type: 'local-production',
    basis: BASIS.MODELLED,
    affinity: ['personalized-keepsake', 'metal-jewelry', 'small-goods', 'soft-goods', 'hard-goods', 'tool-kit', 'wood-toy', 'electronics', 'print-goods'],
    moqByFamily: { default: 25, 'small-goods': 50 },
    costFactor: 1.18,
    shippingFactor: 0.6,
    leadTime: [3, 10],
    inventoryRisk: 'low',
    bestFor: 'Faster delivery, lower shipping, easier communication - and a "made locally" story you can sell.',
    watchOut: 'Higher unit cost. Get 3 written quotes and ask about their capacity in your peak month.',
    searchUrl: (q, country) => `https://www.google.com/maps/search/${encodeURIComponent(`${q} manufacturer ${country || ''}`.trim())}`,
    queryFor: (product) => `${product.name} supplier`,
  },
  {
    id: 'digital-alternative',
    name: 'Digital-product alternative (no supplier)',
    icon: '⬇️',
    type: 'digital',
    basis: BASIS.MODELLED,
    affinity: ['personalized-keepsake', 'print-goods', 'tool-kit', 'digital-pattern', 'digital-art', 'small-goods'],
    moqByFamily: { default: 1 },
    costFactor: 0,
    shippingFactor: 0,
    leadTime: [0, 1],
    inventoryRisk: 'none',
    bestFor: 'Sell a printable / template / pattern version at ~95% margin and instant delivery.',
    watchOut: 'Digital files get copied. Expect refund requests and price competition on the cheapest end.',
    searchUrl: (q) => `https://creativemarket.com/search?q=${encodeURIComponent(q)}`,
    queryFor: (product) => `${product.name} template`,
  },
];

export const SUPPLIER_IDS = SUPPLIERS.map((s) => s.id);

export const getSupplier = (id) => SUPPLIERS.find((s) => s.id === id) || null;

export const getFamily = (id) => FAMILIES[id] || FAMILIES['hard-goods'];

export const suppliersForFamily = (familyId, { includeDigital = true } = {}) =>
  SUPPLIERS.filter((s) => {
    if (!s.affinity.includes(familyId)) return false;
    if (!includeDigital && s.id === 'digital-alternative') return false;
    return true;
  });

export const moqFor = (supplier, familyId) =>
  supplier.moqByFamily?.[familyId] ?? supplier.moqByFamily?.default ?? 1;

/** Public information only: how to vet any supplier before paying. */
export const SUPPLIER_DUE_DILIGENCE = [
  'Order a paid sample and photograph it yourself - never trust catalogue renders.',
  'Ask for the exact material, dimensions and packaging; get it in writing.',
  'Check the platform’s buyer protection / trade assurance before transferring money.',
  'Confirm the production lead time for your peak month, not the quiet month.',
  'Ask two suppliers for the same spec so you can compare quotes.',
  'For personalised items, test the proofing workflow end-to-end yourself first.',
];
