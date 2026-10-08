/** Original vector artwork authored for Lumora Studio (simple SVG path data). */

export interface VectorAsset {
  id: string;
  name: string;
  group: string;
  path: string;
  viewBox?: number;
}

export const SHAPES = [
  { id: 'rect', name: 'Rectangle' },
  { id: 'rounded', name: 'Rounded' },
  { id: 'circle', name: 'Circle' },
  { id: 'ellipse', name: 'Ellipse' },
  { id: 'triangle', name: 'Triangle' },
  { id: 'polygon', name: 'Hexagon' },
  { id: 'star', name: 'Star' },
  { id: 'heart', name: 'Heart' },
  { id: 'line', name: 'Line' },
  { id: 'arrow', name: 'Arrow' }
];

export const ICONS: VectorAsset[] = [
  { id: 'play', name: 'Play', group: 'Media', path: 'M8 5 L40 24 L8 43 Z' },
  { id: 'pause', name: 'Pause', group: 'Media', path: 'M12 6 H20 V42 H12 Z M28 6 H36 V42 H28 Z' },
  { id: 'camera', name: 'Camera', group: 'Media', path: 'M6 14 H16 L20 8 H28 L32 14 H42 V40 H6 Z M24 20 a7 7 0 1 0 0.1 0 Z' },
  { id: 'heart', name: 'Heart', group: 'Social', path: 'M24 42 C4 28 6 12 16 10 C21 9 24 14 24 14 C24 14 27 9 32 10 C42 12 44 28 24 42 Z' },
  { id: 'star', name: 'Star', group: 'Social', path: 'M24 4 L30 18 L45 20 L34 30 L37 45 L24 38 L11 45 L14 30 L3 20 L18 18 Z' },
  { id: 'bolt', name: 'Bolt', group: 'Social', path: 'M26 2 L8 26 H22 L18 46 L38 20 H24 Z' },
  { id: 'check', name: 'Check', group: 'UI', path: 'M6 26 L18 38 L42 10 L38 6 L18 30 L10 22 Z' },
  { id: 'cross', name: 'Close', group: 'UI', path: 'M8 12 L12 8 L24 20 L36 8 L40 12 L28 24 L40 36 L36 40 L24 28 L12 40 L8 36 L20 24 Z' },
  { id: 'arrow-right', name: 'Arrow', group: 'UI', path: 'M4 20 H28 V10 L46 24 L28 38 V28 H4 Z' },
  { id: 'cart', name: 'Cart', group: 'Commerce', path: 'M4 6 H10 L16 30 H38 L44 12 H14 M18 40 a3 3 0 1 0 0.1 0 M36 40 a3 3 0 1 0 0.1 0' },
  { id: 'tag', name: 'Tag', group: 'Commerce', path: 'M6 6 H26 L44 24 L26 42 L6 24 Z M14 14 a3 3 0 1 0 0.1 0' },
  { id: 'badge', name: 'Badge', group: 'Commerce', path: 'M24 2 L30 8 L38 7 L40 15 L46 20 L42 27 L44 35 L36 38 L32 45 L24 42 L16 45 L12 38 L4 35 L6 27 L2 20 L8 15 L10 7 L18 8 Z' },
  { id: 'leaf', name: 'Leaf', group: 'Nature', path: 'M8 40 C8 16 28 6 44 6 C44 26 30 42 8 40 Z' },
  { id: 'sun', name: 'Sun', group: 'Nature', path: 'M24 12 a12 12 0 1 0 0.1 0 M24 0 v6 M24 42 v6 M0 24 h6 M42 24 h6 M7 7 l4 4 M37 37 l4 4 M41 7 l-4 4 M11 37 l-4 4' },
  { id: 'moon', name: 'Moon', group: 'Nature', path: 'M32 4 A20 20 0 1 0 44 30 A16 16 0 0 1 32 4 Z' },
  { id: 'chat', name: 'Chat', group: 'Social', path: 'M4 8 H44 V34 H26 L14 44 V34 H4 Z' },
  { id: 'pin', name: 'Pin', group: 'UI', path: 'M24 2 C14 2 7 9 7 19 C7 32 24 46 24 46 C24 46 41 32 41 19 C41 9 34 2 24 2 Z M24 14 a5 5 0 1 0 0.1 0' },
  { id: 'music', name: 'Music', group: 'Media', path: 'M18 38 a6 6 0 1 0 0.1 0 M18 38 V8 L42 4 V34 M42 34 a6 6 0 1 0 0.1 0' }
];

export const BADGES: VectorAsset[] = [
  { id: 'ribbon', name: 'Ribbon', group: 'Badges', path: 'M4 8 H44 V32 H30 L24 40 L18 32 H4 Z' },
  { id: 'burst', name: 'Burst', group: 'Badges', path: 'M24 0 L28 10 L38 6 L36 17 L47 18 L39 25 L47 32 L36 33 L38 44 L28 40 L24 50 L20 40 L10 44 L12 33 L1 32 L9 25 L1 18 L12 17 L10 6 L20 10 Z' },
  { id: 'shield', name: 'Shield', group: 'Badges', path: 'M24 2 L44 10 V26 C44 38 24 46 24 46 C24 46 4 38 4 26 V10 Z' }
];

export const FRAMES: VectorAsset[] = [
  { id: 'frame-square', name: 'Square Frame', group: 'Frames', path: 'M2 2 H46 V46 H2 Z M8 8 V40 H40 V8 Z' },
  { id: 'frame-circle', name: 'Circle Frame', group: 'Frames', path: 'M24 1 a23 23 0 1 0 0.1 0 Z M24 7 a17 17 0 1 1 -0.1 0 Z' },
  { id: 'frame-corner', name: 'Corner Frame', group: 'Frames', path: 'M2 2 H18 V6 H6 V18 H2 Z M46 2 V18 H42 V6 H30 V2 Z M2 46 V30 H6 V42 H18 V46 Z M46 46 H30 V42 H42 V30 H46 Z' }
];

export const DECORATIONS: VectorAsset[] = [
  { id: 'swirl', name: 'Swirl', group: 'Decorations', path: 'M2 36 C14 10 34 10 46 36 M8 40 C18 20 30 20 40 40' },
  { id: 'dots', name: 'Dot Row', group: 'Decorations', path: 'M6 24 a4 4 0 1 0 0.1 0 M20 24 a4 4 0 1 0 0.1 0 M34 24 a4 4 0 1 0 0.1 0' },
  { id: 'zigzag', name: 'Zigzag', group: 'Decorations', path: 'M2 34 L12 14 L22 34 L32 14 L42 34' },
  { id: 'underline', name: 'Brush Underline', group: 'Decorations', path: 'M2 30 C14 20 34 38 46 24 L46 32 C34 44 14 28 2 36 Z' }
];

export const STICKERS: VectorAsset[] = [
  { id: 'sticker-fire', name: 'Flame', group: 'Stickers', path: 'M24 2 C30 14 40 18 38 30 C37 40 31 46 24 46 C17 46 10 40 10 30 C10 22 18 20 18 12 C22 16 22 10 24 2 Z' },
  { id: 'sticker-ghost', name: 'Ghost', group: 'Stickers', path: 'M24 2 C13 2 6 10 6 22 V46 L12 40 L18 46 L24 40 L30 46 L36 40 L42 46 V22 C42 10 35 2 24 2 Z' },
  { id: 'sticker-pumpkin', name: 'Pumpkin', group: 'Stickers', path: 'M24 10 C10 10 4 18 4 28 C4 38 12 44 24 44 C36 44 44 38 44 28 C44 18 38 10 24 10 Z M22 4 H26 V12 H22 Z' },
  { id: 'sticker-cat', name: 'Cat', group: 'Stickers', path: 'M8 14 L14 2 L22 12 H26 L34 2 L40 14 V34 C40 42 32 46 24 46 C16 46 8 42 8 34 Z' },
  { id: 'sticker-cloud', name: 'Cloud', group: 'Stickers', path: 'M12 36 C4 36 2 28 8 24 C6 14 20 10 24 18 C30 10 44 14 42 26 C48 30 44 36 38 36 Z' }
];

export const GRADIENT_PRESETS = [
  { id: 'aurora', name: 'Aurora', from: '#7c5cff', to: '#22d3ee' },
  { id: 'sunset', name: 'Sunset', from: '#ff9770', to: '#ff5f6d' },
  { id: 'mint', name: 'Mint', from: '#06d6a0', to: '#118ab2' },
  { id: 'candy', name: 'Candy', from: '#ff3d9a', to: '#ffd166' },
  { id: 'noir', name: 'Noir', from: '#2b2b35', to: '#0b0b10' },
  { id: 'sand', name: 'Sand', from: '#e8d8b9', to: '#c08457' },
  { id: 'ocean', name: 'Ocean', from: '#90e0ef', to: '#03045e' },
  { id: 'berry', name: 'Berry', from: '#8a2d6b', to: '#201335' }
];

export const SOLID_BACKGROUNDS = [
  '#ffffff',
  '#0d0d14',
  '#10131f',
  '#f6efe7',
  '#ffd166',
  '#7c5cff',
  '#ff3d9a',
  '#22d3ee',
  '#06d6a0',
  '#e8d8b9',
  '#1b4965',
  '#2f2a26'
];

export const FONT_STACKS = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Impact',
  'Comic Sans MS',
  'Consolas',
  'Palatino Linotype'
];
