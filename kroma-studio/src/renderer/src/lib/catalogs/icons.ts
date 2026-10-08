/**
 * Original icon set drawn on a 24×24 grid, single-path, `currentColor`.
 * Hand-authored for this product — no third-party icon pack is bundled.
 */

const wrap = (body: string, stroke = false): string =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${body
    .split('|')
    .map((d) => (stroke ? `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="${d}" fill="currentColor"/>`))
    .join('')}</svg>`

export interface IconDef {
  id: string
  label: string
  category: string
  svg: string
}

const I = (id: string, label: string, category: string, body: string, stroke = false): IconDef => ({
  id,
  label,
  category,
  svg: wrap(body, stroke)
})

export const ICON_CATALOG: IconDef[] = [
  // Media / video
  I('play', 'Play', 'Media', 'M7 4l13 8-13 8z'),
  I('pause', 'Pause', 'Media', 'M7 4h4v16H7z|M13 4h4v16h-4z'),
  I('video', 'Video', 'Media', 'M3 5h11a2 2 0 012 2v10a2 2 0 01-2 2H3z|M16 9l5-3v12l-5-3z'),
  I('mic', 'Microphone', 'Media', 'M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z|M6 11a6 6 0 0012 0|M12 17v4|M8 21h8', true),
  I('headphones', 'Headphones', 'Media', 'M4 14v-2a8 8 0 0116 0v2|M4 14h3v6H4z|M17 14h3v6h-3z', true),
  I('volume', 'Volume', 'Media', 'M4 9h4l5-4v14l-5-4H4z|M17 8a5 5 0 010 8', true),
  I('camera', 'Camera', 'Media', 'M4 7h4l2-2h4l2 2h4v12H4z|M12 9a4 4 0 100 8 4 4 0 000-8z', true),
  I('film', 'Film', 'Media', 'M3 4h18v16H3z|M8 4v16|M16 4v16', true),

  // Social
  I('heart', 'Heart', 'Social', 'M12 21s-8-4.9-8-10.5C4 6.6 6.8 4 10 4c1.6 0 2 .9 2 .9S12.4 4 14 4c3.2 0 6 2.6 6 6.5C20 16.1 12 21 12 21z'),
  I('heart-outline', 'Heart outline', 'Social', 'M12 21s-8-4.9-8-10.5C4 6.6 6.8 4 10 4c1.6 0 2 .9 2 .9S12.4 4 14 4c3.2 0 6 2.6 6 6.5C20 16.1 12 21 12 21z', true),
  I('star', 'Star', 'Social', 'M12 2l2.9 6.9 7.1.6-5.4 4.8 1.6 7.2L12 17.8 5.8 21.5l1.6-7.2L2 9.5l7.1-.6z'),
  I('comment', 'Comment', 'Social', 'M4 4h16v12H9l-5 4z', true),
  I('share', 'Share', 'Social', 'M14 4h6v6|M20 4l-9 9|M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5', true),
  I('bell', 'Bell', 'Social', 'M12 3a6 6 0 016 6v4l2 3H4l2-3V9a6 6 0 016-6z|M10 19a2 2 0 004 0', true),
  I('thumbs-up', 'Thumbs up', 'Social', 'M7 21V10l5-7 1 1 1 5h5a2 2 0 012 2l-1.5 7a2 2 0 01-2 1.6z|M7 10H4v11h3z'),
  I('bookmark', 'Bookmark', 'Social', 'M6 3h12v18l-6-5-6 5z', true),

  // Arrows & UI
  I('arrow-right', 'Arrow right', 'Arrows', 'M4 11h12l-4-4 1.5-1.5L20 12l-6.5 6.5L12 17l4-4H4z'),
  I('arrow-left', 'Arrow left', 'Arrows', 'M20 13H8l4 4-1.5 1.5L4 12l6.5-6.5L12 7l-4 4h12z'),
  I('arrow-up', 'Arrow up', 'Arrows', 'M13 20V8l4 4 1.5-1.5L12 4l-6.5 6.5L7 12l4-4v12z'),
  I('arrow-down', 'Arrow down', 'Arrows', 'M11 4v12l-4-4L5.5 13.5 12 20l6.5-6.5L17 12l-4 4V4z'),
  I('chevron-right', 'Chevron right', 'Arrows', 'M8 4l10 8-10 8v-5l5-3-5-3z'),
  I('chevron-down', 'Chevron down', 'Arrows', 'M4 8l8 10 8-10h-5L12 13 9 8z'),
  I('refresh', 'Refresh', 'Arrows', 'M20 12a8 8 0 11-2.3-5.7|M20 4v5h-5', true),
  I('plus', 'Plus', 'Arrows', 'M11 4h2v16h-2z|M4 11h16v2H4z'),
  I('minus', 'Minus', 'Arrows', 'M4 11h16v2H4z'),
  I('close', 'Close', 'Arrows', 'M6 6l12 12M18 6L6 18', true),
  I('check', 'Check', 'Arrows', 'M4 12l5 5L20 6', true),

  // Business
  I('briefcase', 'Briefcase', 'Business', 'M3 7h7V5a1 1 0 011-1h2a1 1 0 011 1v2h7v13H3z|M3 12h18', true),
  I('chart', 'Chart', 'Business', 'M4 20h16|M7 20V10|M12 20V4|M17 20v-7', true),
  I('trending', 'Trending up', 'Business', 'M3 17l6-6 4 4 8-8|M15 7h6v6', true),
  I('coin', 'Coin', 'Business', 'M12 3a9 9 0 100 18 9 9 0 000-18z|M12 7v10|M9.5 9.5h5M9.5 14.5h5', true),
  I('target', 'Target', 'Business', 'M12 3a9 9 0 100 18 9 9 0 000-18z|M12 8a4 4 0 100 8 4 4 0 000-8z|M12 11a1 1 0 100 2 1 1 0 000-2z', true),
  I('badge', 'Verified', 'Business', 'M12 2l2.4 1.8 3 .2 1 2.8 2.6-1.5 2.6 1.5-1 2.8 1 2.8-2.6 1.5L18.4 20l-3-.2L12 21.5 9.6 19.8l-3 .2-1-2.8-2.6-1.5 1-2.8-1-2.8L5.6 8l3-.2z|M9 12l2 2 4-4', true),
  I('calendar', 'Calendar', 'Business', 'M4 5h16v15H4z|M4 10h16|M8 3v4|M16 3v4', true),
  I('clock', 'Clock', 'Business', 'M12 3a9 9 0 100 18 9 9 0 000-18z|M12 7v5l4 2', true),

  // Nature
  I('leaf', 'Leaf', 'Nature', 'M20 4C10 4 4 9 4 16c0 1.5.4 2.8 1 4|M20 4c0 9-5 14-13 14', true),
  I('sun', 'Sun', 'Nature', 'M12 7a5 5 0 100 10 5 5 0 000-10z|M12 1v3|M12 20v3|M1 12h3|M20 12h3|M4.5 4.5l2 2|M17.5 17.5l2 2|M19.5 4.5l-2 2|M6.5 17.5l-2 2', true),
  I('moon', 'Moon', 'Nature', 'M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z'),
  I('drop', 'Drop', 'Nature', 'M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z', true),
  I('flame', 'Flame', 'Nature', 'M12 2s5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 2 0 2-4 1-9z'),
  I('mountain', 'Mountain', 'Nature', 'M2 20l7-14 4 7 2-3 7 10z'),
  I('bolt', 'Bolt', 'Nature', 'M13 2L5 13h6l-1 9 8-11h-6z'),

  // Festive
  I('gift', 'Gift', 'Festive', 'M3 8h18v4H3z|M5 12h14v9H5z|M12 8v13|M12 8S10 3 8 4s1 4 4 4zM12 8s2-5 4-4-1 4-4 4z', true),
  I('party', 'Party popper', 'Festive', 'M3 21l7-7|M6 6l3 3 9-9-3-3z|M15 3l6 6-3 3-6-6z|M9 9l3 3', true),
  I('sparkle', 'Sparkle', 'Festive', 'M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z|M18 15l.9 2.6L21.5 19l-2.6.9L18 22.5l-.9-2.6L14.5 19l2.6-.9z'),
  I('crown', 'Crown', 'Festive', 'M3 18h18l-2-9-5 4-2-6-2 6-5-4z'),
  I('ghost', 'Ghost', 'Festive', 'M4 20V10a8 8 0 0116 0v10l-3-2-2.5 2-2.5-2-2.5 2z|M9 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM15 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3z'),
  I('pumpkin', 'Pumpkin', 'Festive', 'M12 4c-5 0-8 4-8 9s3 7 8 7 8-2 8-7-3-9-8-9z|M12 4c0-2 1-3 3-3|M9 11l1.5 2.5L9 16|M15 11l-1.5 2.5L15 16', true),

  // Tech
  I('cpu', 'CPU', 'Tech', 'M8 8h8v8H8z|M4 4h16v16H4z|M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4', true),
  I('wifi', 'Wi-Fi', 'Tech', 'M2 8a15 15 0 0120 0|M6 12a10 10 0 0112 0|M9.5 16a5 5 0 015 0|M12 20h.01', true),
  I('cloud', 'Cloud', 'Tech', 'M6 18a4 4 0 010-8 5.5 5.5 0 0110.6-1.4A3.7 3.7 0 0118 18z', true),
  I('lock', 'Lock', 'Tech', 'M6 11h12v9H6z|M8 11V8a4 4 0 018 0v3', true),
  I('shield', 'Shield', 'Tech', 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z|M9 12l2 2 4-4', true),
  I('code', 'Code', 'Tech', 'M8 6l-5 6 5 6|M16 6l5 6-5 6', true),
  I('robot', 'Robot', 'Tech', 'M6 8h12v10H6z|M12 8V5|M9 13h.01M15 13h.01|M10 16h4|M4 12v3|M20 12v3', true),
  I('globe', 'Globe', 'Tech', 'M12 3a9 9 0 100 18 9 9 0 000-18z|M3 12h18|M12 3c3 3.5 3 14 0 17zM12 3c-3 3.5-3 14 0 17z', true)
]

export const ICON_CATEGORIES = ['All', 'Media', 'Social', 'Arrows', 'Business', 'Nature', 'Festive', 'Tech'] as const

export const iconsByCategory = (category: string): IconDef[] =>
  category === 'All' ? ICON_CATALOG : ICON_CATALOG.filter((icon) => icon.category === category)

/** Recolour an icon's artwork to a specific colour. */
export const tintSvg = (svg: string, color: string): string => svg.replace(/currentColor/g, color)
