const SHAPES: Record<string, string> = {
  circle: '<svg viewBox="0 0 24 24" fill="#6C5CE7"><circle cx="12" cy="12" r="10"/></svg>',
  square: '<svg viewBox="0 0 24 24" fill="#6C5CE7"><rect x="2" y="2" width="20" height="20" rx="4"/></svg>',
  triangle: '<svg viewBox="0 0 24 24" fill="#6C5CE7"><path d="M12 3 22 21H2z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="#FDCB6E"><path d="m12 2 2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 16.8 6 20.4l1.5-6.8L2.2 9l6.9-.7z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="#FD79A8"><path d="M12 21s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 3.8C20 16.1 12 21 12 21z"/></svg>',
  hexagon: '<svg viewBox="0 0 24 24" fill="#00B894"><path d="M12 2l8.7 5v10L12 22 3.3 17V7z"/></svg>',
  'arrow-right': '<svg viewBox="0 0 24 24" fill="#6C5CE7"><path d="M13 5l7 7-7 7v-4H4v-6h9z"/></svg>',
  'arrow-up': '<svg viewBox="0 0 24 24" fill="#6C5CE7"><path d="M12 3l7 7h-4v10h-6V10H5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="#00B894"><path d="M20 6 9 17l-5-5 1.4-1.4L9 14.2 18.6 4.6z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="#6C5CE7"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="#FDCB6E"><path d="M12 2l1.8 5.6L19.5 9l-4 3.9 1 5.6-4.5-3-4.5 3 1-5.6L4.5 9l5.7-1.4z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="#FDCB6E"><path d="M13 2 5 14h5l-1 8 8-12h-5z"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="#6C5CE7"><path d="M7 7h5v5H9.5c.4 2 1.6 3.4 3.5 4v2C9.5 17.5 7 14.6 7 10zm10 0h-5v5h2.5c.4 2 1.6 3.4 3.5 4v2C19.5 17.5 17 14.6 17 10z"/></svg>',
  badge: '<svg viewBox="0 0 24 24" fill="#00B894"><path d="M12 2l2.4 2.1 3.1-.4 1 3 2.5 2-1.3 2.9 1.3 2.9-2.5 2-1 3-3.1-.4L12 21l-2.4-1.9-3.1.4-1-3-2.5-2L4.3 11 3 8.1l2.5-2 1-3 3.1.4z"/></svg>',
  ribbon: '<svg viewBox="0 0 24 24" fill="#FD79A8"><path d="M6 3h12v4a4 4 0 0 1-3 3.9V13H9V10.9A4 4 0 0 1 6 7zm3 12h6v5l-3-2-3 2z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="#6C5CE7"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="#FDCB6E"><path d="M3 8l4 4 5-8 5 8 4-4-2 11H5z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="#00B894"><path d="M4 20c0-8 6-14 16-14 0 10-6 14-12 14z"/></svg>',
};

/** Inline SVG set used by the media panel's quick-insert strip. */
export const SPARK_ICONS: { name: string; svg: string }[] = [
  'circle', 'square', 'triangle', 'star', 'heart', 'hexagon', 'arrow-right', 'arrow-up', 'check', 'plus',
  'sparkle', 'bolt', 'quote', 'badge', 'ribbon', 'shield', 'crown', 'leaf',
].map((name) => ({ name, svg: SHAPES[name] ?? SHAPES.circle! }));

