/**
 * channels.js - "where to find customers".
 *
 * Ranks the traffic sources that actually suit the niche (not a generic list),
 * and recommends the single best starting channel with a first-week plan.
 */

import { CHANNELS } from '../data/taxonomy.js';
import { BASIS, clamp, weightedMeanDetailed, metric, scoreBand } from './metrics.js';

const TAG_AFFINITY = (channel, product) => {
  const tags = product?.tags || [];
  const overlaps = tags.filter((t) => channel.strengths.includes(t)).length;
  if (!tags.length) return 0.45;
  return clamp(0.28 + overlaps * 0.18, 0, 1);
};

export function computeChannels(product, ctx = {}) {
  const trend = ctx.trendScore;
  const price = ctx.price;

  const rows = CHANNELS.map((channel) => {
    const affinity = TAG_AFFINITY(channel, product);
    const visual = ['pinterest', 'instagram', 'tiktok', 'youtube-shorts'].includes(channel.id);
    const visualScore = visual ? clamp((ctx.visualAppeal ?? 0.7) * 100, 0, 100) : 60;
    const costScore = channel.cost.includes('Free') ? 78 : 55;
    const speedScore = ['tiktok', 'youtube-shorts', 'pinterest'].includes(channel.id) ? 74 : channel.type === 'search' ? 66 : 58;
    const trendBoost = Number.isFinite(trend) ? clamp(50 + (trend - 50) * 0.6, 10, 100) : 55;

    const fused = weightedMeanDetailed([
      metric({ id: 'affinity', label: 'Niche fit', value: affinity * 100, weight: 1.6, basis: BASIS.MODELLED }),
      metric({ id: 'visual', label: 'Visual/demo suitability', value: visualScore, weight: 1.0, basis: BASIS.MODELLED }),
      metric({ id: 'cost', label: 'Cost to start', value: costScore, weight: 0.8, basis: BASIS.MODELLED }),
      metric({ id: 'speed', label: 'Time to first traffic', value: speedScore, weight: 0.8, basis: BASIS.MODELLED }),
      metric({ id: 'trend', label: 'Rides current trend', value: trendBoost, weight: 0.7, basis: BASIS.SNAPSHOT }),
    ]);

    const score = fused.value == null ? null : Math.round(fused.value);
    return {
      id: channel.id,
      label: channel.label,
      icon: channel.icon,
      type: channel.type,
      cost: channel.cost,
      score,
      verdict: scoreBand(score),
      fit: affinity,
      why: buildWhy(channel, affinity, product),
      firstSteps: firstSteps(channel, product, price),
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return {
    rows,
    best: rows[0] || null,
    secondary: rows[1] || null,
    note: 'Channel ranking is modelled from the niche’s tags and the content type each channel rewards. Test one channel properly before adding a second.',
    confidence: { id: 'Medium', label: 'Medium', blurb: 'Modelled from niche tags and platform format, not from your account data.' },
  };
}

function buildWhy(channel, affinity, product) {
  if (affinity >= 0.8) return `${product.name} is a visual, giftable product - ${channel.label} buyers search in exactly this mood.`;
  if (affinity >= 0.6) return `${channel.label} matches the audience for this niche (${Math.round(affinity * 100)}% tag overlap).`;
  if (affinity >= 0.45) return `Workable as a secondary channel, but the audience match is only ${Math.round(affinity * 100)}%.`;
  return `Weak fit for this niche - keep it off the first-month plan.`;
}

function firstSteps(channel, product, price) {
  const name = product.name.toLowerCase();
  const base = {
    'etsy-search': [`Put the exact phrase "${name}" in the title, the first tag and the first image alt text.`, 'Publish 3 listings: the product, a bundle, and a personalised version.', 'Run Etsy Ads at a $3/day cap for 10 days and judge by views, not sales.'],
    'amazon-search': ['Match the top 3 conversion-led titles for this niche, then beat them on images.', 'Add every attribute and A+ content - attribute completeness drives placement.', 'Launch with a $9.99-$12.99 opening price to collect the first 15 reviews, then reprice.'],
    pinterest: ['Create 10 vertical pins (1000x1500) from one photo shoot - different hooks, same product.', 'Target descriptive keyword phrases, not hashtags.', 'Post 3 pins a day for 2 weeks and check saves before clicks.'],
    tiktok: ['Film 5 short demos: unboxing, before/after, personalisation reveal.', 'Hook in the first 1.5 seconds with the result, then show the process.', 'Post daily for 10 days; remake whatever passes 2,000 views.'],
    instagram: ['Shoot a 6-post grid: hero, process, before/after, lifestyle, gift wrap, review.', 'Use 5 niche hashtags instead of 25 generic ones.', 'DM 10 micro-creators in the niche for a product-for-post swap.'],
    google: ['Write one landing page answering "is this worth buying" for the niche.', 'Add product structured data so Shopping can index the price and reviews.', 'Start a small Search campaign on 10 long-tail commercial keywords only.'],
    'youtube-shorts': ['Post 3 process shorts (60s max) with the finished result first.', 'Pin a comment with the listing link - descriptions get ignored.', 'Reuse the same clips as TikTok/Pinterest pins.'],
    'facebook-groups': ['Join 5 niche groups and answer questions for a week before posting anything.', 'Post a genuine photo + story, not a link dump.', 'Offer a group-only bundle code to track which community converts.'],
  }[channel.id] || [];
  const priceNote = Number.isFinite(price) && price < 15
    ? 'At this price point, push bundles rather than single units to lift order value.'
    : 'This price point can absorb a small paid test after the organic read.';
  return [...base, priceNote];
}
