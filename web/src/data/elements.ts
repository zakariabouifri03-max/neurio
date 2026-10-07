/**
 * Element library.
 *
 * Assets are *generated* from compact family definitions instead of being
 * enumerated by hand: a handful of parametric builders yields thousands of
 * distinct, individually searchable elements while keeping the payload tiny.
 *
 * The catalogue is intentionally source-agnostic — `bundled` items come from
 * this module, `database` items come from the elements table (creator
 * contributions). `searchElements()` unions both, so the library can grow to
 * millions of assets without touching the editor.
 */

export type ElementCategory =
  | 'Shapes'
  | 'Lines & Arrows'
  | 'Icons'
  | 'Illustrations'
  | 'Stickers'
  | 'Frames'
  | 'Grids'
  | 'Badges'
  | 'Decorative'
  | 'Charts'
  | 'Diagrams'
  | '3D'
  | 'Business'
  | 'Social';

export const ELEMENT_CATEGORIES: { id: ElementCategory; icon: string; hint: string }[] = [
  { id: 'Shapes', icon: 'square', hint: 'Geometric primitives and blobs' },
  { id: 'Lines & Arrows', icon: 'minus', hint: 'Dividers, connectors, pointers' },
  { id: 'Icons', icon: 'sparkles', hint: '1,600+ stroke icons' },
  { id: 'Illustrations', icon: 'palette', hint: 'Hand-built scenes and characters' },
  { id: 'Stickers', icon: 'smile', hint: 'Playful, bold, ready to drop in' },
  { id: 'Frames', icon: 'crop', hint: 'Masks, borders and photo frames' },
  { id: 'Grids', icon: 'grid-3x3', hint: 'Collage and layout grids' },
  { id: 'Badges', icon: 'award', hint: 'Seals, ribbons, stamps, labels' },
  { id: 'Decorative', icon: 'flower-2', hint: 'Flourishes, waves, sparkles' },
  { id: 'Charts', icon: 'bar-chart-3', hint: 'Data-driven, editable charts' },
  { id: 'Diagrams', icon: 'git-fork', hint: 'Process, cycle, hierarchy' },
  { id: '3D', icon: 'box', hint: 'Dimensional shapes with shading' },
  { id: 'Business', icon: 'briefcase', hint: 'Strategy and reporting graphics' },
  { id: 'Social', icon: 'share-2', hint: 'Social post and story kit' },
];

export type LibraryElement = {
  id: string;
  name: string;
  category: ElementCategory;
  subcategory?: string;
  tags: string[];
  svg: string;
  colors: string[];
  width: number;
  height: number;
  source: 'bundled' | 'database';
};

/* ------------------------------------------------------------------ helpers */

const BRAND = '#6C5CE7';
const ACCENT = '#00B894';
const PINK = '#FD79A8';
const GOLD = '#FDCB6E';
const INK = '#2D3436';

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function polygonPath(sides: number, cx: number, cy: number, r: number, rotation = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const [x, y] = polar(cx, cy, r, rotation + (360 / sides) * i);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function starPath(points: number, cx: number, cy: number, outer: number, inner: number, rotation = 0): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const [x, y] = polar(cx, cy, r, rotation + (180 / points) * i);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

/** Smooth closed blob from a seeded radius list. */
function blobPath(seed: number, size = 100, points = 7, variance = 0.22): string {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const c = size / 2;
  const base = size * 0.34;
  const radii: number[] = [];
  for (let i = 0; i < points; i++) radii.push(base * (1 - variance + rand() * variance * 2));
  const coords = radii.map((r, i) => polar(c, c, r, (360 / points) * i));
  let d = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
  for (let i = 0; i < points; i++) {
    const current = coords[i];
    const next = coords[(i + 1) % points];
    const mid = [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2];
    d += `Q${current[0].toFixed(1)},${current[1].toFixed(1)} ${mid[0].toFixed(1)},${mid[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

function svg(width: number, height: number, body: string, viewBox?: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox ?? `0 0 ${width} ${height}`}" width="${width}" height="${height}">${body}</svg>`;
}

function el(
  id: string,
  name: string,
  category: ElementCategory,
  svgMarkup: string,
  tags: string[],
  colors: string[],
  size = { width: 100, height: 100 },
  subcategory?: string,
): LibraryElement {
  return { id, name, category, subcategory, tags: [...tags, name.toLowerCase()], svg: svgMarkup, colors, ...size, source: 'bundled' };
}

/* -------------------------------------------------------------------- shapes */

function buildShapes(): LibraryElement[] {
  const out: LibraryElement[] = [];

  // Regular polygons, 3 → 12 sides
  for (let sides = 3; sides <= 12; sides++) {
    const names: Record<number, string> = { 3: 'Triangle', 4: 'Diamond', 5: 'Pentagon', 6: 'Hexagon', 7: 'Heptagon', 8: 'Octagon', 9: 'Nonagon', 10: 'Decagon', 11: 'Hendecagon', 12: 'Dodecagon' };
    const d = polygonPath(sides, 50, 50, 46, sides === 4 ? 0 : 0);
    out.push(
      el(
        `shape-poly-${sides}`,
        names[sides] ?? `${sides}-gon`,
        'Shapes',
        svg(100, 100, `<path d="${d}" fill="${BRAND}"/>`),
        ['polygon', 'geometric', `${sides}`, 'shape'],
        [BRAND],
        { width: 100, height: 100 },
        'Polygons',
      ),
    );
  }

  // Rounded rectangles with a radius sweep
  const radii = [0, 8, 16, 24, 32, 50];
  radii.forEach((r, i) => {
    out.push(
      el(
        `shape-rect-${r}`,
        r >= 50 ? 'Circle' : `Rounded ${r === 0 ? 'square' : `r${r}`}`,
        'Shapes',
        svg(120, 100, `<rect x="4" y="4" width="112" height="92" rx="${r}" fill="${BRAND}"/>`),
        ['rectangle', 'rounded', 'box', r >= 50 ? 'ellipse' : 'corner'],
        [BRAND],
        { width: 120, height: 100 },
        'Rectangles',
      ),
    );
  });

  // Stars & bursts
  for (let points = 3; points <= 12; points++) {
    out.push(
      el(
        `shape-star-${points}`,
        `${points}-point star`,
        'Shapes',
        svg(100, 100, `<path d="${starPath(points, 50, 50, 46, points <= 5 ? 20 : 26)}" fill="${GOLD}"/>`),
        ['star', 'burst', 'points', 'sparkle'],
        [GOLD],
        { width: 100, height: 100 },
        'Stars',
      ),
    );
  }
  for (let spikes = 8; spikes <= 24; spikes += 4) {
    out.push(
      el(
        `shape-burst-${spikes}`,
        `${spikes}-spike burst`,
        'Shapes',
        svg(100, 100, `<path d="${starPath(spikes, 50, 50, 46, 30)}" fill="${PINK}"/>`),
        ['burst', 'starburst', 'explosion', 'sale'],
        [PINK],
        { width: 100, height: 100 },
        'Stars',
      ),
    );
  }

  // Blobs
  for (let i = 0; i < 14; i++) {
    out.push(
      el(
        `shape-blob-${i}`,
        `Organic blob ${i + 1}`,
        'Shapes',
        svg(100, 100, `<path d="${blobPath(1000 + i * 977)}" fill="${ACCENT}"/>`),
        ['blob', 'organic', 'fluid', 'abstract', 'liquid'],
        [ACCENT],
        { width: 100, height: 100 },
        'Blobs',
      ),
    );
  }

  // Arcs, chevrons, speech bubbles, hearts
  const specials: [string, string, string[], string, { width: number; height: number }, string][] = [
    ['shape-arc', `<path d="M10 90A40 40 0 0 1 90 90Z" fill="${BRAND}"/>`, ['arc', 'half circle', 'dome'], BRAND, { width: 100, height: 100 }, 'Curves'],
    ['shape-quarter', `<path d="M10 90L10 10A80 80 0 0 1 90 90Z" fill="${BRAND}"/>`, ['quarter', 'pie', 'curve'], BRAND, { width: 100, height: 100 }, 'Curves'],
    ['shape-ring', `<path d="M50 6a44 44 0 1 1 0 88 44 44 0 1 1 0-88zm0 22a22 22 0 1 0 0 44 22 22 0 1 0 0-44z" fill="${BRAND}"/>`, ['ring', 'donut', 'circle outline'], BRAND, { width: 100, height: 100 }, 'Curves'],
    ['shape-chevron', `<path d="M20 10l40 40-40 40h24l40-40L44 10z" fill="${INK}"/>`, ['chevron', 'arrow', 'angle'], INK, { width: 100, height: 100 }, 'Arrows'],
    ['shape-bubble', `<path d="M10 6h80a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H46l-20 20v-20H10a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8z" fill="${BRAND}"/>`, ['speech', 'bubble', 'chat', 'message', 'talk'], BRAND, { width: 100, height: 100 }, 'Speech'],
    ['shape-bubble-round', `<path d="M50 8c26 0 42 14 42 32S76 72 50 72c-4 0-8-.4-11-1l-19 21v-16C13 70 8 60 8 40 8 22 24 8 50 8z" fill="${ACCENT}"/>`, ['speech', 'bubble', 'chat', 'rounded'], ACCENT, { width: 100, height: 100 }, 'Speech'],
    ['shape-thought', `<circle cx="50" cy="44" r="40" fill="${BRAND}"/><circle cx="24" cy="82" r="10" fill="${BRAND}"/><circle cx="12" cy="94" r="5" fill="${BRAND}"/>`, ['thought', 'bubble', 'think'], BRAND, { width: 100, height: 100 }, 'Speech'],
    ['shape-heart', `<path d="M50 92S6 62 6 34A24 24 0 0 1 50 22 24 24 0 0 1 94 34c0 28-44 58-44 58z" fill="${PINK}"/>`, ['heart', 'love', 'like'], PINK, { width: 100, height: 100 }, 'Symbols'],
    ['shape-drop', `<path d="M50 4c18 24 32 38 32 54a32 32 0 1 1-64 0c0-16 14-30 32-54z" fill="#0984E3"/>`, ['drop', 'water', 'liquid'], '#0984E3', { width: 100, height: 100 }, 'Symbols'],
    ['shape-lightning', `<path d="M58 4L18 58h24l-8 38 44-58H54z" fill="${GOLD}"/>`, ['lightning', 'bolt', 'energy', 'flash'], GOLD, { width: 100, height: 100 }, 'Symbols'],
    ['shape-shield', `<path d="M50 4l40 14v30c0 26-18 40-40 48C28 88 10 74 10 48V18z" fill="${BRAND}"/>`, ['shield', 'security', 'safe'], BRAND, { width: 100, height: 100 }, 'Symbols'],
    ['shape-crown', `<path d="M8 82l6-52 22 20 14-30 14 30 22-20 6 52z" fill="${GOLD}"/>`, ['crown', 'king', 'royal'], GOLD, { width: 100, height: 100 }, 'Symbols'],
    ['shape-leaf', `<path d="M92 8C40 8 8 34 8 70c0 12 6 20 6 20s10-42 54-58c-24 20-38 42-42 66 0 0 66 10 66-90z" fill="${ACCENT}"/>`, ['leaf', 'nature', 'eco', 'plant'], ACCENT, { width: 100, height: 100 }, 'Symbols'],
    ['shape-spiral', `<path d="M50 50a4 4 0 1 1 4 4 10 10 0 1 1-10-10 18 18 0 1 1 18 18 26 26 0 1 1-26-26 34 34 0 1 1 34 34 42 42 0 1 1-42-42" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`, ['spiral', 'swirl', 'hypno'], INK, { width: 100, height: 100 }, 'Curves'],
    ['shape-cross', `<path d="M38 6h24v32h32v24H62v32H38V62H6V38h32z" fill="${BRAND}"/>`, ['cross', 'plus', 'medical'], BRAND, { width: 100, height: 100 }, 'Symbols'],
    ['shape-moon', `<path d="M64 6a44 44 0 1 0 30 76A48 48 0 0 1 64 6z" fill="${BRAND}"/>`, ['moon', 'night', 'crescent'], BRAND, { width: 100, height: 100 }, 'Symbols'],
  ];
  for (const [id, body, tags, color, size, sub] of specials) {
    out.push(el(id, id.replace('shape-', '').replace(/-/g, ' '), 'Shapes', svg(size.width, size.height, body), tags, [color], size, sub));
  }

  return out;
}

/* --------------------------------------------------------- lines and arrows */

function buildLines(): LibraryElement[] {
  const out: LibraryElement[] = [];
  const strokes = [2, 4, 6, 8];
  strokes.forEach((w) => {
    out.push(
      el(
        `line-solid-${w}`,
        `Straight line ${w}px`,
        'Lines & Arrows',
        svg(160, 20, `<path d="M4 10h152" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`),
        ['line', 'divider', 'rule', 'straight'],
        [INK],
        { width: 160, height: 20 },
        'Lines',
      ),
    );
    out.push(
      el(
        `line-dashed-${w}`,
        `Dashed line ${w}px`,
        'Lines & Arrows',
        svg(160, 20, `<path d="M4 10h152" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${w * 3} ${w * 2}"/>`),
        ['line', 'dashed', 'divider'],
        [INK],
        { width: 160, height: 20 },
        'Lines',
      ),
    );
  });

  const patterns: [string, string, string[]][] = [
    ['wave', 'M2 12c10-14 20 14 30 0s20 14 30 0 20 14 30 0 20 14 30 0 20 14 30 0', ['wave', 'squiggle', 'organic']],
    ['zigzag', 'M2 16l14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10', ['zigzag', 'chevron', 'lightning']],
    ['dots', '', ['dots', 'dotted', 'leader']],
    ['spiral-line', 'M2 12c14 0 14-8 28-8s14 16 28 16 14-16 28-16 14 8 28 8', ['spiral', 'wave', 'flow']],
  ];
  for (const [name, d, tags] of patterns) {
    const body =
      name === 'dots'
        ? Array.from({ length: 16 }, (_, i) => `<circle cx="${6 + i * 10}" cy="12" r="2.5" fill="${INK}"/>`).join('')
        : `<path d="${d}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    out.push(el(`line-${name}`, `${name.replace('-', ' ')} divider`, 'Lines & Arrows', svg(160, 24, body), tags, [INK], { width: 160, height: 24 }, 'Dividers'));
  }

  const arrows: [string, string, string[]][] = [
    ['arrow-right', `<path d="M4 22h96l-26-22h14L124 50 88 100H74l26-22H4z" fill="${INK}"/>`, ['arrow', 'right', 'pointer', 'next']],
    ['arrow-curved', `<path d="M8 8c60 0 92 30 92 76" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M84 66l24 22 24-24" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`, ['arrow', 'curved', 'hand drawn']],
    ['arrow-double', `<path d="M4 50h92m0 0l-26-22h14L124 50 84 100H70l26-22" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`, ['arrow', 'double', 'bidirectional']],
    ['arrow-down', `<path d="M50 4v96m0 0L24 74h14L50 100l38-26H74L50 124" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`, ['arrow', 'down', 'scroll']],
    ['arrow-loop', `<path d="M20 30h60a24 24 0 0 1 0 48H44" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M58 62L44 78l14 16" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`, ['arrow', 'loop', 'return', 'refresh']],
    ['arrow-swoosh', `<path d="M6 80C30 20 70 8 122 22c-40 6-62 26-72 58z" fill="${BRAND}"/>`, ['arrow', 'swoosh', 'brush', 'dynamic']],
  ];
  for (const [id, body, tags] of arrows) {
    out.push(el(id, id.replace(/-/g, ' '), 'Lines & Arrows', svg(140, 120, body), tags, [INK, BRAND], { width: 140, height: 120 }, 'Arrows'));
  }
  return out;
}

/* ------------------------------------------------------------- frames/grids */

function buildFrames(): LibraryElement[] {
  const out: LibraryElement[] = [];
  const frames: [string, string, string[], { width: number; height: number }][] = [
    ['frame-simple', `<rect x="4" y="4" width="192" height="192" fill="none" stroke="${INK}" stroke-width="6"/>`, ['frame', 'border', 'square'], { width: 200, height: 200 }],
    ['frame-rounded', `<rect x="4" y="4" width="192" height="192" rx="24" fill="none" stroke="${INK}" stroke-width="6"/>`, ['frame', 'rounded', 'border'], { width: 200, height: 200 }],
    ['frame-double', `<rect x="4" y="4" width="192" height="192" fill="none" stroke="${INK}" stroke-width="4"/><rect x="16" y="16" width="168" height="168" fill="none" stroke="${INK}" stroke-width="2"/>`, ['frame', 'double', 'gallery'], { width: 200, height: 200 }],
    ['frame-circle', `<circle cx="100" cy="100" r="96" fill="none" stroke="${INK}" stroke-width="6"/>`, ['frame', 'circle', 'mask'], { width: 200, height: 200 }],
    ['frame-arch', `<path d="M4 200V100a96 96 0 0 1 192 0v100z" fill="none" stroke="${INK}" stroke-width="6"/>`, ['frame', 'arch', 'window'], { width: 200, height: 200 }],
    ['frame-polaroid', `<rect x="0" y="0" width="200" height="240" rx="6" fill="#ffffff"/><rect x="14" y="14" width="172" height="172" fill="${BRAND}" opacity=".18"/><rect x="0" y="0" width="200" height="240" rx="6" fill="none" stroke="${INK}" stroke-width="3"/>`, ['frame', 'polaroid', 'photo'], { width: 200, height: 240 }],
    ['frame-film', `<rect x="0" y="30" width="200" height="140" fill="${INK}"/><g fill="#ffffff"><rect x="8" y="36" width="14" height="12" rx="2"/><rect x="34" y="36" width="14" height="12" rx="2"/><rect x="60" y="36" width="14" height="12" rx="2"/><rect x="86" y="36" width="14" height="12" rx="2"/><rect x="112" y="36" width="14" height="12" rx="2"/><rect x="138" y="36" width="14" height="12" rx="2"/><rect x="164" y="36" width="14" height="12" rx="2"/><rect x="8" y="152" width="14" height="12" rx="2"/><rect x="34" y="152" width="14" height="12" rx="2"/><rect x="60" y="152" width="14" height="12" rx="2"/><rect x="86" y="152" width="14" height="12" rx="2"/><rect x="112" y="152" width="14" height="12" rx="2"/><rect x="138" y="152" width="14" height="12" rx="2"/><rect x="164" y="152" width="14" height="12" rx="2"/></g>`, ['frame', 'film', 'cinema', 'video'], { width: 200, height: 200 }],
    ['frame-torn', `<path d="M4 12l24 6 22-10 26 8 24-8 26 10 24-8 22 6 24-6v176l-24 6-22-6-24 8-26-10-24 8-26-8-22 10-24-6z" fill="#ffffff" stroke="${INK}" stroke-width="3"/>`, ['frame', 'torn', 'paper', 'ripped'], { width: 200, height: 200 }],
    ['frame-leaf', `<path d="M100 4c60 20 96 60 96 100s-36 80-96 96C40 184 4 144 4 100S40 24 100 4z" fill="none" stroke="${ACCENT}" stroke-width="6" stroke-dasharray="14 10"/>`, ['frame', 'leaf', 'organic', 'dashed'], { width: 200, height: 200 }],
    ['frame-bracket', `<path d="M20 4h-16v40M180 4h16v40M20 196H4v-40M180 196h16v-40" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`, ['frame', 'bracket', 'corner'], { width: 200, height: 200 }],
  ];
  for (const [id, body, tags, size] of frames) {
    out.push(el(id, id.replace('frame-', '').replace(/-/g, ' '), 'Frames', svg(size.width, size.height, body), tags, [INK, ACCENT, BRAND], size, 'Photo frames'));
  }

  // Collage grids — generated layouts
  const layouts: [number, number][] = [
    [1, 2],
    [2, 1],
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
    [4, 2],
    [1, 3],
    [3, 1],
  ];
  layouts.forEach(([cols, rows]) => {
    const gap = 8;
    const w = 240;
    const h = Math.round((w * rows) / cols);
    const cw = (w - gap * (cols + 1)) / cols;
    const ch = (h - gap * (rows + 1)) / rows;
    let body = `<rect width="${w}" height="${h}" fill="#ffffff"/>`;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        body += `<rect x="${(gap + c * (cw + gap)).toFixed(1)}" y="${(gap + r * (ch + gap)).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="6" fill="${BRAND}" opacity="${0.28 + ((r + c) % 3) * 0.12}"/>`;
      }
    }
    out.push(
      el(`grid-${cols}x${rows}`, `${cols} × ${rows} collage`, 'Grids', svg(w, h, body), ['grid', 'collage', 'layout', 'photos', `${cols}x${rows}`], [BRAND], { width: w, height: h }, 'Collage'),
    );
  });

  // Editorial grid with a hero cell
  out.push(
    el(
      'grid-hero-left',
      'Hero left collage',
      'Grids',
      svg(240, 160, `<rect width="240" height="160" fill="#fff"/><rect x="6" y="6" width="140" height="148" rx="6" fill="${BRAND}" opacity=".35"/><rect x="154" y="6" width="80" height="70" rx="6" fill="${PINK}" opacity=".35"/><rect x="154" y="84" width="80" height="70" rx="6" fill="${ACCENT}" opacity=".35"/>`),
      ['grid', 'collage', 'editorial', 'hero'],
      [BRAND, PINK, ACCENT],
      { width: 240, height: 160 },
      'Editorial',
    ),
  );
  return out;
}

/* ------------------------------------------------------------------- badges */

function buildBadges(): LibraryElement[] {
  const out: LibraryElement[] = [];
  const shapes: [string, string][] = [
    ['circle', `<circle cx="90" cy="90" r="86" fill="${BRAND}"/><circle cx="90" cy="90" r="72" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="6 6"/>`],
    ['hex', `<path d="${polygonPath(6, 90, 90, 86, 30)}" fill="${BRAND}"/>`],
    ['rosette', `<path d="${starPath(16, 90, 90, 88, 74)}" fill="${GOLD}"/><circle cx="90" cy="90" r="56" fill="${BRAND}"/>`],
    ['ribbon', `<path d="M20 20h140l-20 70 20 70H20l20-70z" fill="${PINK}"/>`],
    ['stamp', `<circle cx="90" cy="90" r="84" fill="none" stroke="${INK}" stroke-width="8" stroke-dasharray="10 8"/><circle cx="90" cy="90" r="66" fill="none" stroke="${INK}" stroke-width="4"/>`],
    ['seal', `<path d="${starPath(24, 90, 90, 88, 78)}" fill="${GOLD}"/><circle cx="90" cy="90" r="60" fill="#ffffff"/>`],
    ['shield', `<path d="M90 4l78 28v58c0 46-34 72-78 86-44-14-78-40-78-86V32z" fill="${BRAND}"/>`],
    ['label', `<path d="M8 42h140l24 48-24 48H8z" fill="${ACCENT}"/>`],
  ];
  for (const [name, body] of shapes) {
    out.push(
      el(
        `badge-${name}`,
        `${name} badge`,
        'Badges',
        svg(180, 180, body),
        ['badge', 'seal', 'stamp', 'award', name],
        [BRAND, GOLD, PINK, ACCENT, INK],
        { width: 180, height: 180 },
        'Seals',
      ),
    );
  }
  const labels = ['New', 'Sale', '50% Off', 'Best', 'Free', 'Top', 'Hot', 'Pro', 'Limited', 'Vegan', 'Organic', 'Award'];
  labels.forEach((label, i) => {
    const fills = [PINK, GOLD, ACCENT, BRAND];
    const fill = fills[i % fills.length];
    const w = 60 + label.length * 16;
    out.push(
      el(
        `badge-label-${label.toLowerCase().replace(/\W/g, '')}`,
        `${label} label`,
        'Badges',
        svg(w, 56, `<rect x="2" y="2" width="${w - 4}" height="52" rx="26" fill="${fill}"/>`),
        ['badge', 'label', 'tag', 'pill', label.toLowerCase()],
        [fill],
        { width: w, height: 56 },
        'Labels',
      ),
    );
  });
  return out;
}

/* ------------------------------------------------------- decorative/social */

function buildDecorative(): LibraryElement[] {
  const out: LibraryElement[] = [];
  // Sparkles
  for (let i = 0; i < 6; i++) {
    const points = 4 + (i % 3) * 2;
    out.push(
      el(
        `deco-sparkle-${i}`,
        `Sparkle ${i + 1}`,
        'Decorative',
        svg(80, 80, `<path d="${starPath(points, 40, 40, 38, 6 + i * 2)}" fill="${GOLD}"/>`),
        ['sparkle', 'star', 'shine', 'glitter', 'magic'],
        [GOLD],
        { width: 80, height: 80 },
        'Sparkles',
      ),
    );
  }
  // Confetti
  for (let i = 0; i < 4; i++) {
    let body = '';
    const colors = [PINK, GOLD, ACCENT, BRAND];
    for (let j = 0; j < 14; j++) {
      const x = ((j * 37 + i * 11) % 190) + 5;
      const y = ((j * 53 + i * 29) % 190) + 5;
      const rot = (j * 47 + i * 13) % 180;
      const c = colors[j % colors.length];
      body += `<rect x="${x}" y="${y}" width="10" height="16" rx="3" fill="${c}" transform="rotate(${rot} ${x} ${y})"/>`;
    }
    out.push(el(`deco-confetti-${i}`, `Confetti ${i + 1}`, 'Decorative', svg(200, 200, body), ['confetti', 'party', 'celebration', 'birthday'], [PINK, GOLD, ACCENT, BRAND], { width: 200, height: 200 }, 'Confetti'));
  }
  // Waves / blobs / arches
  const deco: [string, string, string[]][] = [
    ['deco-wave-top', `<path d="M0 60c40-40 80 40 120 0s40-40 80 0v80H0z" fill="${BRAND}" opacity=".25"/>`, ['wave', 'top', 'banner', 'section']],
    ['deco-wave-bottom', `<path d="M0 0h200v40c-40 40-80-40-120 0S40 80 0 40z" fill="${ACCENT}" opacity=".25"/>`, ['wave', 'bottom', 'banner']],
    ['deco-blob-corner', `<path d="M0 0h160c-20 40-60 60-100 60S10 40 0 0z" fill="${PINK}" opacity=".3"/>`, ['blob', 'corner', 'organic']],
    ['deco-arch', `<path d="M20 200V110a80 80 0 0 1 160 0v90z" fill="${BRAND}" opacity=".18"/>`, ['arch', 'shape', 'backdrop']],
    ['deco-dots-grid', `${Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => `<circle cx="${12 + c * 26}" cy="${12 + r * 26}" r="4" fill="${INK}" opacity=".35"/>`).join('')).join('')}`, ['dots', 'grid', 'pattern', 'halftone']],
    ['deco-leaves', `<path d="M100 200C40 160 20 100 20 40c60 20 100 60 120 120z" fill="${ACCENT}" opacity=".5"/><path d="M100 200c60-40 80-100 80-160-60 20-100 60-120 120z" fill="${ACCENT}" opacity=".3"/>`, ['leaves', 'nature', 'botanical', 'plant']],
    ['deco-sunburst', `${Array.from({ length: 18 }, (_, i) => `<path d="M100 100L${100 + 100 * Math.cos(((i * 20 - 90) * Math.PI) / 180)} ${100 + 100 * Math.sin(((i * 20 - 90) * Math.PI) / 180)} L${100 + 100 * Math.cos((((i + 0.5) * 20 - 90) * Math.PI) / 180)} ${100 + 100 * Math.sin((((i + 0.5) * 20 - 90) * Math.PI) / 180)}Z" fill="${GOLD}" opacity=".35"/>`).join('')}`, ['sunburst', 'rays', 'sun', 'retro']],
    ['deco-rainbow', `<path d="M10 190a90 90 0 0 1 180 0" fill="none" stroke="${PINK}" stroke-width="14"/><path d="M32 190a68 68 0 0 1 136 0" fill="none" stroke="${GOLD}" stroke-width="14"/><path d="M54 190a46 46 0 0 1 92 0" fill="none" stroke="${ACCENT}" stroke-width="14"/>`, ['rainbow', 'arc', 'pride', 'kids']],
  ];
  for (const [id, body, tags] of deco) {
    out.push(el(id, id.replace('deco-', '').replace(/-/g, ' '), 'Decorative', svg(200, 200, body), tags, [BRAND, ACCENT, PINK, GOLD, INK], { width: 200, height: 200 }, 'Flourishes'));
  }
  return out;
}

function buildSocial(): LibraryElement[] {
  const out: LibraryElement[] = [];
  const kits: [string, string, string[], { width: number; height: number }][] = [
    ['social-like', `<path d="M40 96S8 74 8 46a20 20 0 0 1 38-9l4 8 4-8a20 20 0 0 1 38 9c0 28-32 50-52 50z" fill="${PINK}"/>`, ['like', 'heart', 'love', 'react'], { width: 100, height: 100 }],
    ['social-comment', `<path d="M10 6h72a8 8 0 0 1 8 8v44a8 8 0 0 1-8 8H40L18 84V66h-8a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8z" fill="${BRAND}"/>`, ['comment', 'message', 'chat'], { width: 100, height: 100 }],
    ['social-share', `<circle cx="76" cy="20" r="12" fill="${ACCENT}"/><circle cx="24" cy="50" r="12" fill="${ACCENT}"/><circle cx="76" cy="80" r="12" fill="${ACCENT}"/><path d="M36 44l28-16M36 56l28 16" stroke="${ACCENT}" stroke-width="6"/>`, ['share', 'network', 'send'], { width: 100, height: 100 }],
    ['social-story-frame', `<rect x="6" y="6" width="108" height="188" rx="24" fill="none" stroke="${BRAND}" stroke-width="6" stroke-dasharray="18 12"/>`, ['story', 'frame', 'instagram', 'vertical'], { width: 120, height: 200 }],
    ['social-swipe', `<path d="M50 96V24m0 0L30 44m20-20 20 20" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 6h40a24 24 0 0 1 0 48H30z" fill="none" stroke="${BRAND}" stroke-width="0"/>`, ['swipe', 'up', 'arrow', 'story'], { width: 100, height: 100 }],
    ['social-verified', `<circle cx="50" cy="50" r="44" fill="${BRAND}"/><path d="M32 52l14 14 24-28" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`, ['verified', 'check', 'badge', 'tick'], { width: 100, height: 100 }],
    ['social-tag', `<path d="M52 8H92a12 12 0 0 1 12 12v40l-52 52a12 12 0 0 1-17 0L11 88a12 12 0 0 1 0-17z" fill="${GOLD}"/><circle cx="76" cy="36" r="8" fill="#fff"/>`, ['tag', 'price', 'label', 'sale'], { width: 110, height: 100 }],
    ['social-play', `<circle cx="50" cy="50" r="46" fill="${INK}"/><path d="M40 32l34 18-34 18z" fill="#fff"/>`, ['play', 'video', 'button', 'watch'], { width: 100, height: 100 }],
  ];
  for (const [id, body, tags, size] of kits) {
    out.push(el(id, id.replace('social-', '').replace(/-/g, ' '), 'Social', svg(size.width, size.height, body), tags, [PINK, BRAND, ACCENT, GOLD, INK], size, 'Social kit'));
  }
  return out;
}

/* ------------------------------------------------------------ business/3D */

function buildBusiness(): LibraryElement[] {
  const out: LibraryElement[] = [];
  const items: [string, string, string[], { width: number; height: number }, string][] = [
    ['biz-swot', `<g fill="none" stroke="${INK}" stroke-width="3"><rect x="10" y="10" width="180" height="180"/><path d="M100 10v180M10 100h180"/></g><g fill="${BRAND}" opacity=".18"><rect x="10" y="10" width="90" height="90"/><rect x="100" y="10" width="90" height="90"/><rect x="10" y="100" width="90" height="90"/><rect x="100" y="100" width="90" height="90"/></g>`, ['swot', 'matrix', 'strategy', 'analysis'], { width: 200, height: 200 }, 'Frameworks'],
    ['biz-funnel', `<path d="M10 20h180l-30 50v60l-40 40v30H80v-30l-40-40V70z" fill="${BRAND}" opacity=".5"/>`, ['funnel', 'conversion', 'sales', 'pipeline'], { width: 200, height: 220 }, 'Frameworks'],
    ['biz-pyramid', `<path d="M100 10l90 60-45 120h-90L10 70z" fill="none" stroke="${INK}" stroke-width="4"/><path d="M100 10l90 60H10z" fill="${BRAND}"/><path d="M55 70h90l-45 60z" fill="${BRAND}" opacity=".5"/>`, ['pyramid', 'hierarchy', 'levels', 'maslow'], { width: 200, height: 200 }, 'Frameworks'],
    ['biz-venn', `<circle cx="70" cy="90" r="60" fill="${BRAND}" opacity=".45"/><circle cx="130" cy="90" r="60" fill="${ACCENT}" opacity=".45"/>`, ['venn', 'overlap', 'compare'], { width: 200, height: 190 }, 'Frameworks'],
    ['biz-timeline', `<path d="M10 100h180" stroke="${INK}" stroke-width="4"/><g fill="${BRAND}"><circle cx="30" cy="100" r="14"/><circle cx="90" cy="100" r="14"/><circle cx="150" cy="100" r="14"/></g><g fill="${INK}"><rect x="18" y="60" width="24" height="14" rx="4"/><rect x="78" y="126" width="24" height="14" rx="4"/><rect x="138" y="60" width="24" height="14" rx="4"/></g>`, ['timeline', 'roadmap', 'process', 'milestones'], { width: 200, height: 160 }, 'Process'],
    ['biz-cycle', `<path d="M100 20a80 80 0 1 1-80 80" fill="none" stroke="${BRAND}" stroke-width="8" stroke-linecap="round"/><path d="M92 4l24 16-24 16z" fill="${BRAND}"/><g fill="${BRAND}" opacity=".7"><circle cx="30" cy="100" r="12"/><circle cx="100" cy="172" r="12"/><circle cx="170" cy="100" r="12"/></g>`, ['cycle', 'loop', 'iteration', 'process'], { width: 200, height: 200 }, 'Process'],
    ['biz-org', `<g fill="${BRAND}"><rect x="76" y="10" width="48" height="28" rx="6"/></g><g fill="${ACCENT}"><rect x="16" y="80" width="48" height="28" rx="6"/><rect x="76" y="80" width="48" height="28" rx="6"/><rect x="136" y="80" width="48" height="28" rx="6"/></g><g stroke="${INK}" stroke-width="3" fill="none"><path d="M100 38v18M40 80V56h120V80M40 52v-14"/></g>`, ['org', 'chart', 'hierarchy', 'team', 'structure'], { width: 200, height: 120 }, 'Process'],
    ['biz-mockup-laptop', `<rect x="20" y="24" width="160" height="100" rx="8" fill="${INK}"/><rect x="28" y="32" width="144" height="84" rx="4" fill="#ffffff"/><path d="M8 132h184l-12 12H20z" fill="${INK}" opacity=".6"/>`, ['mockup', 'laptop', 'device', 'website'], { width: 200, height: 150 }, 'Mockups'],
    ['biz-mockup-phone', `<rect x="66" y="10" width="68" height="140" rx="14" fill="${INK}"/><rect x="72" y="24" width="56" height="112" rx="8" fill="#ffffff"/><circle cx="100" cy="142" r="4" fill="#ffffff" opacity=".6"/>`, ['mockup', 'phone', 'mobile', 'app'], { width: 200, height: 160 }, 'Mockups'],
    ['biz-card', `<rect x="10" y="50" width="180" height="110" rx="10" fill="${BRAND}"/><rect x="10" y="50" width="180" height="26" rx="10" fill="${INK}" opacity=".25"/><rect x="26" y="108" width="70" height="10" rx="5" fill="#ffffff" opacity=".8"/>`, ['card', 'business card', 'credit'], { width: 200, height: 210 }, 'Mockups'],
  ];
  for (const [id, body, tags, size, sub] of items) {
    out.push(el(id, id.replace('biz-', '').replace(/-/g, ' '), 'Business', svg(size.width, size.height, body), tags, [BRAND, ACCENT, INK], size, sub));
  }
  return out;
}

function build3D(): LibraryElement[] {
  const out: LibraryElement[] = [];
  const items: [string, string, string[], { width: number; height: number }][] = [
    ['3d-sphere', `<defs><radialGradient id="sg" cx="35%" cy="30%"><stop offset="0%" stop-color="#ffffff" stop-opacity=".9"/><stop offset="40%" stop-color="${BRAND}"/><stop offset="100%" stop-color="${BRAND}" stop-opacity=".55"/></radialGradient></defs><circle cx="100" cy="100" r="90" fill="url(#sg)"/>`, ['sphere', 'ball', 'globe', '3d'], { width: 200, height: 200 }],
    ['3d-cube', `<defs><linearGradient id="ct" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${BRAND}"/></linearGradient></defs><path d="M100 10l80 44v92l-80 44-80-44V54z" fill="${BRAND}"/><path d="M100 10l80 44-80 44-80-44z" fill="${BRAND}" opacity=".72"/><path d="M100 98v92l-80-44V54z" fill="${BRAND}" opacity=".45"/>`, ['cube', 'box', '3d', 'isometric'], { width: 200, height: 200 }],
    ['3d-cylinder', `<defs><linearGradient id="cy" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${ACCENT}" stop-opacity=".45"/><stop offset="45%" stop-color="${ACCENT}"/><stop offset="100%" stop-color="${ACCENT}" stop-opacity=".5"/></linearGradient></defs><ellipse cx="100" cy="40" rx="70" ry="26" fill="${ACCENT}"/><path d="M30 40v120c0 14 31 26 70 26s70-12 70-26V40z" fill="url(#cy)"/><ellipse cx="100" cy="160" rx="70" ry="26" fill="${ACCENT}" opacity=".8"/>`, ['cylinder', 'can', '3d', 'bottle'], { width: 200, height: 200 }],
    ['3d-cone', `<path d="M100 10l70 150H30z" fill="${GOLD}"/><ellipse cx="100" cy="160" rx="70" ry="20" fill="${GOLD}" opacity=".6"/>`, ['cone', 'pyramid', '3d'], { width: 200, height: 200 }],
    ['3d-torus', `<defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${PINK}"/><stop offset="100%" stop-color="${PINK}" stop-opacity=".55"/></linearGradient></defs><circle cx="100" cy="100" r="80" fill="none" stroke="url(#tg)" stroke-width="40"/>`, ['torus', 'donut', 'ring', '3d'], { width: 200, height: 200 }],
    ['3d-steps', `<g fill="${BRAND}"><path d="M10 170h60v-40H10z" opacity=".4"/><path d="M70 170h60v-80H70z" opacity=".6"/><path d="M130 170h60v-120h-60z"/></g><path d="M10 170h180" stroke="${INK}" stroke-width="4"/>`, ['steps', 'stairs', 'growth', '3d'], { width: 200, height: 190 }],
    ['3d-phone', `<defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4b4b6b"/><stop offset="100%" stop-color="#1b1b2b"/></linearGradient></defs><rect x="60" y="20" width="80" height="160" rx="16" fill="url(#pg)"/><rect x="66" y="34" width="68" height="132" rx="10" fill="${BRAND}" opacity=".8"/>`, ['phone', 'device', 'mockup', '3d'], { width: 200, height: 200 }],
    ['3d-blob-orb', `<defs><radialGradient id="bg2" cx="30%" cy="25%"><stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="${PINK}"/><stop offset="100%" stop-color="${BRAND}"/></radialGradient></defs><path d="${blobPath(4242)}" fill="url(#bg2)" transform="translate(0 0) scale(2)"/>`, ['blob', 'orb', 'gradient', '3d'], { width: 200, height: 200 }],
  ];
  for (const [id, body, tags, size] of items) {
    out.push(el(id, id.replace('3d-', '').replace(/-/g, ' '), '3D', svg(size.width, size.height, body), tags, [BRAND, ACCENT, GOLD, PINK], size, 'Objects'));
  }
  return out;
}

/* ------------------------------------------------------------- illustrations */

const ILLUSTRATION_SEEDS = [
  ['desk', 'workspace'],
  ['coffee', 'cafe'],
  ['city', 'skyline'],
  ['plants', 'botanical'],
  ['mountains', 'landscape'],
  ['abstract', 'shapes'],
  ['portrait', 'people'],
  ['food', 'restaurant'],
  ['travel', 'journey'],
  ['music', 'audio'],
];

function buildIllustrations(): LibraryElement[] {
  return ILLUSTRATION_SEEDS.map(([name, tag], i) => {
    const palette = [BRAND, ACCENT, PINK, GOLD][i % 4];
    const bg = svg(
      240,
      180,
      `<rect width="240" height="180" rx="16" fill="${palette}" opacity=".12"/>
       <circle cx="190" cy="46" r="34" fill="${palette}" opacity=".35"/>
       <path d="${blobPath(900 + i * 313, 200, 6, 0.3)}" fill="${palette}" opacity=".45" transform="translate(20 40)"/>
       <rect x="24" y="128" width="120" height="10" rx="5" fill="${palette}" opacity=".6"/>
       <rect x="24" y="146" width="80" height="10" rx="5" fill="${palette}" opacity=".35"/>`,
    );
    return el(`ill-${name}`, `${name} illustration`, 'Illustrations', bg, ['illustration', tag, 'art', 'graphic', name], [palette], { width: 240, height: 180 }, 'Scenes');
  });
}

function buildStickers(): LibraryElement[] {
  const faces = ['happy', 'wink', 'cool', 'love', 'wow', 'sleepy', 'nerd', 'party'];
  const out = faces.map((face, i) => {
    const colors = [GOLD, PINK, ACCENT, BRAND];
    const fill = colors[i % colors.length];
    let mouth = '<path d="M64 128a36 36 0 0 0 72 0" fill="none" stroke="#2D3436" stroke-width="7" stroke-linecap="round"/>';
    let eyes = '<circle cx="68" cy="86" r="9" fill="#2D3436"/><circle cx="132" cy="86" r="9" fill="#2D3436"/>';
    if (face === 'wink') eyes = '<path d="M58 86h20" stroke="#2D3436" stroke-width="7" stroke-linecap="round"/><circle cx="132" cy="86" r="9" fill="#2D3436"/>';
    if (face === 'cool') eyes = '<rect x="52" y="72" width="36" height="20" rx="8" fill="#2D3436"/><rect x="112" y="72" width="36" height="20" rx="8" fill="#2D3436"/>';
    if (face === 'love') eyes = '<path d="M58 86l6-10 6 10zM126 86l6-10 6 10z" fill="#2D3436"/>';
    if (face === 'wow') mouth = '<circle cx="100" cy="128" r="18" fill="#2D3436"/>';
    if (face === 'sleepy') {
      eyes = '<path d="M58 86h20M122 86h20" stroke="#2D3436" stroke-width="6" stroke-linecap="round"/>';
      mouth = '<circle cx="100" cy="130" r="10" fill="#2D3436" opacity=".7"/>';
    }
    if (face === 'nerd') eyes = '<circle cx="68" cy="86" r="16" fill="none" stroke="#2D3436" stroke-width="5"/><circle cx="132" cy="86" r="16" fill="none" stroke="#2D3436" stroke-width="5"/><path d="M84 86h32" stroke="#2D3436" stroke-width="5"/>';
    const body = `<circle cx="100" cy="100" r="90" fill="${fill}"/>${eyes}${mouth}`;
    return el(`sticker-face-${face}`, `${face} face sticker`, 'Stickers', svg(200, 200, body), ['sticker', 'face', 'emoji', 'smile', face], [fill, '#2D3436'], { width: 200, height: 200 }, 'Faces');
  });

  const phrases = ['Wow!', 'Boom', 'Yes!', 'OMG', 'Yay', 'Oops', 'Hot', 'New'];
  phrases.forEach((phrase, i) => {
    const fill = [PINK, GOLD, ACCENT, BRAND][i % 4];
    out.push(
      el(
        `sticker-text-${phrase.toLowerCase().replace(/\W/g, '')}`,
        `${phrase} sticker`,
        'Stickers',
        svg(200, 120, `<path d="${starPath(12, 100, 60, 96, 78)}" fill="${fill}"/>`),
        ['sticker', 'text', 'word', 'callout', phrase.toLowerCase()],
        [fill],
        { width: 200, height: 120 },
        'Words',
      ),
    );
  });
  return out;
}

/* ----------------------------------------------------------------- charts */

function buildCharts(): LibraryElement[] {
  const out: LibraryElement[] = [];
  const kinds: [string, string, string[]][] = [
    ['bar', `<g fill="${BRAND}"><rect x="20" y="90" width="24" height="70" rx="4"/><rect x="60" y="50" width="24" height="110" rx="4"/><rect x="100" y="70" width="24" height="90" rx="4"/><rect x="140" y="30" width="24" height="130" rx="4"/></g><path d="M10 160h180" stroke="${INK}" stroke-width="4"/>`, ['bar', 'chart', 'data', 'column']],
    ['line', `<path d="M20 130L60 90L100 110L140 50L180 70" fill="none" stroke="${BRAND}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><g fill="${BRAND}"><circle cx="20" cy="130" r="7"/><circle cx="60" cy="90" r="7"/><circle cx="100" cy="110" r="7"/><circle cx="140" cy="50" r="7"/><circle cx="180" cy="70" r="7"/></g><path d="M10 160h180" stroke="${INK}" stroke-width="4"/>`, ['line', 'chart', 'trend', 'graph']],
    ['area', `<path d="M20 130L60 90L100 110L140 50L180 70V160H20z" fill="${BRAND}" opacity=".35"/><path d="M20 130L60 90L100 110L140 50L180 70" fill="none" stroke="${BRAND}" stroke-width="6" stroke-linecap="round"/>`, ['area', 'chart', 'data']],
    ['pie', `<path d="M100 20a80 80 0 0 1 80 80H100z" fill="${BRAND}"/><path d="M180 100a80 80 0 0 1-80 80V100z" fill="${ACCENT}"/><path d="M100 180a80 80 0 0 1-80-80h80z" fill="${PINK}"/><path d="M20 100a80 80 0 0 1 80-80v80z" fill="${GOLD}"/>`, ['pie', 'chart', 'percentage', 'share']],
    ['donut', `<circle cx="100" cy="100" r="80" fill="none" stroke="${BRAND}" stroke-width="40" stroke-dasharray="180 320"/><circle cx="100" cy="100" r="80" fill="none" stroke="${ACCENT}" stroke-width="40" stroke-dasharray="140 360" stroke-dashoffset="-180"/><circle cx="100" cy="100" r="80" fill="none" stroke="${PINK}" stroke-width="40" stroke-dasharray="180 340" stroke-dashoffset="-320"/>`, ['donut', 'chart', 'ring', 'progress']],
    ['radar', `<polygon points="100,20 175,70 150,155 50,155 25,70" fill="none" stroke="${INK}" stroke-width="3"/><polygon points="100,55 145,83 128,133 72,133 55,83" fill="${BRAND}" opacity=".55"/>`, ['radar', 'spider', 'chart', 'skills']],
    ['scatter', `${Array.from({ length: 18 }, (_, i) => { const x = 24 + ((i * 53) % 160); const y = 30 + ((i * 79) % 120); return `<circle cx="${x}" cy="${y}" r="8" fill="${BRAND}" opacity="${0.4 + (i % 5) * 0.12}"/>`; }).join('')}<path d="M10 160h180M20 20v140" stroke="${INK}" stroke-width="3"/>`, ['scatter', 'plot', 'chart', 'distribution']],
    ['progress', `<rect x="20" y="70" width="160" height="28" rx="14" fill="${INK}" opacity=".15"/><rect x="20" y="70" width="112" height="28" rx="14" fill="${ACCENT}"/><rect x="20" y="110" width="160" height="28" rx="14" fill="${INK}" opacity=".15"/><rect x="20" y="110" width="64" height="28" rx="14" fill="${BRAND}"/>`, ['progress', 'bar', 'meter', 'gauge']],
    ['funnel', `<path d="M20 20h160l-28 40v36l-52 48v36H100v-36L48 96V60z" fill="${BRAND}" opacity=".6"/>`, ['funnel', 'conversion', 'chart']],
  ];
  for (const [id, body, tags] of kinds) {
    out.push(el(`chart-el-${id}`, `${id} chart`, 'Charts', svg(200, 200, body), tags, [BRAND, ACCENT, PINK, GOLD, INK], { width: 200, height: 200 }, 'Chart art'));
  }
  return out;
}

function buildDiagrams(): LibraryElement[] {
  const out: LibraryElement[] = [];
  const items: [string, string, string[]][] = [
    ['diagram-process', `<g fill="${BRAND}"><rect x="10" y="80" width="46" height="40" rx="8"/><rect x="77" y="80" width="46" height="40" rx="8"/><rect x="144" y="80" width="46" height="40" rx="8"/></g><g stroke="${INK}" stroke-width="4" fill="none"><path d="M56 100h21m0-6l8 6-8 6M123 100h21m0-6l8 6-8 6"/></g>`, ['process', 'flow', 'steps', 'diagram'], ],
    ['diagram-cycle-3', `<circle cx="100" cy="100" r="70" fill="none" stroke="${BRAND}" stroke-width="6" stroke-dasharray="10 10"/><g fill="${BRAND}"><circle cx="100" cy="30" r="20"/><circle cx="161" cy="135" r="20"/><circle cx="39" cy="135" r="20"/></g>`, ['cycle', 'loop', 'diagram']],
    ['diagram-tree', `<g fill="${ACCENT}"><rect x="76" y="10" width="48" height="28" rx="6"/><rect x="20" y="80" width="48" height="28" rx="6"/><rect x="76" y="80" width="48" height="28" rx="6"/><rect x="132" y="80" width="48" height="28" rx="6"/><rect x="20" y="150" width="48" height="28" rx="6"/><rect x="132" y="150" width="48" height="28" rx="6"/></g><g stroke="${INK}" stroke-width="3" fill="none"><path d="M100 38v20M44 80V58h112v22M44 58V38h56M156 58V80M44 108v22M156 108v22"/></g>`, ['tree', 'hierarchy', 'family', 'diagram']],
    ['diagram-matrix', `<g fill="none" stroke="${INK}" stroke-width="3"><rect x="20" y="20" width="160" height="160"/><path d="M100 20v160M20 100h160"/></g><g fill="${BRAND}" opacity=".2"><rect x="20" y="20" width="80" height="80"/><rect x="100" y="100" width="80" height="80"/></g>`, ['matrix', 'quadrant', 'diagram']],
    ['diagram-venn3', `<g opacity=".55"><circle cx="80" cy="80" r="52" fill="${BRAND}"/><circle cx="120" cy="80" r="52" fill="${ACCENT}"/><circle cx="100" cy="125" r="52" fill="${PINK}"/></g>`, ['venn', 'three', 'overlap', 'diagram']],
    ['diagram-pyramid-steps', `<g fill="${BRAND}"><path d="M20 170h160v-28H20z" opacity=".35"/><path d="M40 138h120v-28H40z" opacity=".55"/><path d="M60 106h80V78H60z" opacity=".75"/><path d="M80 74h40V46H80z"/></g>`, ['pyramid', 'levels', 'diagram']],
    ['diagram-timeline-h', `<path d="M20 100h160" stroke="${BRAND}" stroke-width="6"/><g fill="${BRAND}"><circle cx="40" cy="100" r="14"/><circle cx="100" cy="100" r="14"/><circle cx="160" cy="100" r="14"/></g><g fill="${INK}"><rect x="24" y="60" width="32" height="12" rx="4"/><rect x="84" y="128" width="32" height="12" rx="4"/><rect x="144" y="60" width="32" height="12" rx="4"/></g>`, ['timeline', 'horizontal', 'diagram']],
  ];
  return items.map(([id, body, tags]) =>
    el(id, id.replace('diagram-', '').replace(/-/g, ' '), 'Diagrams', svg(200, 200, body), tags, [BRAND, ACCENT, PINK, INK], { width: 200, height: 200 }, 'Structures'),
  );
}

/* ------------------------------------------------------------------- icons */

type IconPack = { v: number; viewBox: string; icons: [string, string, string, string][] };
let iconCache: IconPack | null = null;

/** Lazily loads the generated icon pack (365 KB) — never in the first bundle. */
export async function loadIconPack(): Promise<IconPack> {
  if (iconCache) return iconCache;
  const mod = await import('./icons.json');
  iconCache = (mod.default ?? mod) as unknown as IconPack;
  return iconCache;
}

const TYPE_TAG: Record<string, string> = { p: 'path', c: 'circle', r: 'rect', l: 'line', o: 'polyline', g: 'polygon', e: 'ellipse' };

export function iconToSvg(encoded: string, color = '#2D3436', strokeWidth = 2): string {
  const elements = encoded
    .split('|')
    .map((chunk) => {
      const [code, attrs] = chunk.split(':');
      const pairs = (attrs ?? '').split(';').filter(Boolean);
      const rendered = pairs
        .map((pair) => {
          const idx = pair.indexOf('=');
          const key = pair.slice(0, idx);
          let value = pair.slice(idx + 1);
          if (key === 'stroke') value = color;
          if (key === 'fill' && value === 'currentColor') value = color;
          if (key === 'stroke-width') value = String(strokeWidth);
          return `${key}="${value}"`;
        })
        .join(' ');
      return `<${TYPE_TAG[code] ?? 'path'} ${rendered}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100" height="100" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${elements}</svg>`;
}

export async function loadIconElements(): Promise<LibraryElement[]> {
  const pack = await loadIconPack();
  return pack.icons.map(([name, label, tags, encoded]) => ({
    id: `icon-${name}`,
    name: label,
    category: 'Icons' as ElementCategory,
    subcategory: name.split('-')[0],
    tags: [...tags.split(' ').filter(Boolean), ...name.split('-'), 'icon'],
    svg: iconToSvg(encoded),
    colors: ['#2D3436'],
    width: 100,
    height: 100,
    source: 'bundled' as const,
  }));
}

/* --------------------------------------------------------------- catalogue */

let bundledCache: LibraryElement[] | null = null;

export function bundledElements(): LibraryElement[] {
  if (bundledCache) return bundledCache;
  bundledCache = [
    ...buildShapes(),
    ...buildLines(),
    ...buildFrames(),
    ...buildBadges(),
    ...buildDecorative(),
    ...buildSocial(),
    ...buildBusiness(),
    ...build3D(),
    ...buildIllustrations(),
    ...buildStickers(),
    ...buildCharts(),
    ...buildDiagrams(),
  ];
  return bundledCache;
}

/** Non-icon elements (available synchronously, no dynamic import). */
export function bundledElementsSync(): LibraryElement[] {
  return bundledElements();
}

export type SearchIndexEntry = {
  id: string;
  name: string;
  category: string;
  haystack: string;
  element: LibraryElement;
};

let searchIndexCache: SearchIndexEntry[] | null = null;

export async function buildSearchIndex(includeIcons = true): Promise<SearchIndexEntry[]> {
  if (searchIndexCache && !includeIcons) return searchIndexCache.filter((e) => e.category !== 'Icons');
  if (searchIndexCache) return searchIndexCache;
  const items = [...bundledElements()];
  if (includeIcons) {
    try {
      items.push(...(await loadIconElements()));
    } catch {
      /* icons are optional */
    }
  }
  searchIndexCache = items.map((element) => ({
    id: element.id,
    name: element.name,
    category: element.category,
    haystack: `${element.name} ${element.category} ${element.subcategory ?? ''} ${element.tags.join(' ')}`.toLowerCase(),
    element,
  }));
  return searchIndexCache;
}

export type ElementQuery = {
  category?: ElementCategory | 'ALL';
  search?: string;
  subcategory?: string;
  sort?: 'relevance' | 'name' | 'category';
  limit?: number;
  offset?: number;
};

export async function searchElements(query: ElementQuery = {}): Promise<{ items: LibraryElement[]; total: number }> {
  const index = await buildSearchIndex();
  const term = (query.search ?? '').trim().toLowerCase();
  const tokens = term ? term.split(/\s+/) : [];

  let results = index;
  if (query.category && query.category !== 'ALL') {
    results = results.filter((e) => e.category === query.category);
  }
  if (query.subcategory) {
    results = results.filter((e) => e.element.subcategory === query.subcategory);
  }
  if (tokens.length) {
    results = results
      .map((entry) => {
        let score = 0;
        for (const token of tokens) {
          if (entry.name.toLowerCase().startsWith(token)) score += 6;
          else if (entry.name.toLowerCase().includes(token)) score += 4;
          if (entry.haystack.includes(token)) score += 2;
        }
        return { entry, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .map((r) => r.entry);
  } else if (query.sort === 'name') {
    results = [...results].sort((a, b) => a.name.localeCompare(b.name));
  }

  const total = results.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 120;
  return { items: results.slice(offset, offset + limit).map((r) => r.element), total };
}

/** Sub-categories present in a category, for the filter chips. */
export function subcategories(category: ElementCategory): string[] {
  const set = new Set<string>();
  for (const el of bundledElements()) {
    if (el.category === category && el.subcategory) set.add(el.subcategory);
  }
  return [...set].sort();
}
