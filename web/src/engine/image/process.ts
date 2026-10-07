/**
 * Image processing primitives — pure functions over ImageData.
 *
 * Everything runs locally with no external service: background removal
 * (flood fill + edge matting), upscaling (bicubic + unsharp), auto-enhance
 * (histogram stretch), saliency crop and 20+ filters.
 */

export type RGBA = Uint8ClampedArray;

export type ImageOp =
  | { kind: 'removeBackground'; tolerance?: number; feather?: number; sample?: 'corners' | 'edges' }
  | { kind: 'upscale'; factor: 2 | 3 | 4; sharpen?: number }
  | { kind: 'enhance'; contrast?: number; saturation?: number; sharpen?: number }
  | { kind: 'filter'; name: FilterName; intensity?: number }
  | { kind: 'adjust'; brightness?: number; contrast?: number; saturation?: number; temperature?: number; hue?: number; gamma?: number; vignette?: number }
  | { kind: 'smartCrop'; width: number; height: number }
  | { kind: 'posterize'; levels?: number };

export type FilterName =
  | 'original'
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'noir'
  | 'vintage'
  | 'cinematic'
  | 'cool'
  | 'warm'
  | 'dramatic'
  | 'pastel'
  | 'muted'
  | 'vivid'
  | 'duotone'
  | 'crossprocess'
  | 'faded'
  | 'moody'
  | 'sunset'
  | 'forest'
  | 'ocean'
  | 'neon'
  | 'matte'
  | 'bw-contrast';

/* --------------------------------------------------------------- utilities */

export function clone(data: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

/* -------------------------------------------------------- background removal */

/**
 * Flood fill from the border pixels; anything within tolerance of the sampled
 * border colour becomes transparent. The alpha mask is feathered and the
 * boundary is smoothed with a coverage pass so edges do not look cut out.
 */
export function removeBackground(
  image: ImageData,
  { tolerance = 42, feather = 2.5 }: { tolerance?: number; feather?: number } = {},
): ImageData {
  const { width, height, data } = image;
  const out = clone(image);
  const alpha = new Uint8ClampedArray(width * height);

  const samples: number[][] = [];
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    samples.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  };
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 40))) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 40))) {
    push(0, y);
    push(width - 1, y);
  }
  const mean = samples.length
    ? samples.reduce((acc, c) => [acc[0]! + c[0]!, acc[1]! + c[1]!, acc[2]! + c[2]!], [0, 0, 0]).map((v) => v / samples.length)
    : [255, 255, 255];

  const threshold = tolerance * tolerance * 3;
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const seen = new Uint8Array(width * height);

  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (seen[idx]) return;
    seen[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }

  const dist = (i: number) => {
    const dr = data[i]! - mean[0]!;
    const dg = data[i + 1]! - mean[1]!;
    const db = data[i + 2]! - mean[2]!;
    return dr * dr + dg * dg + db * db;
  };

  while (head < tail) {
    const idx = queue[head++]!;
    const i = idx * 4;
    if (dist(i) > threshold) continue;
    alpha[idx] = 1;
    const x = idx % width;
    const y = (idx - x) / width;
    seed(x + 1, y);
    seed(x - 1, y);
    seed(x, y + 1);
    seed(x, y - 1);
  }

  // Convert hard mask → soft alpha using a distance-weighted blur.
  const blurred = boxBlurMask(alpha, width, height, Math.max(1, Math.round(feather * 2)));
  for (let idx = 0; idx < width * height; idx++) {
    const a = 1 - Math.min(1, Math.max(0, (blurred[idx]! - 0.35) * 2.6));
    out.data[idx * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

function boxBlurMask(mask: Uint8ClampedArray, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const step = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += mask[Math.min(width - 1, Math.max(0, x)) + y * width]!;
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / step;
      sum -= mask[y * width + Math.min(width - 1, Math.max(0, x - radius))]!;
      sum += mask[y * width + Math.min(width - 1, Math.max(0, x + radius + 1))]!;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[x + Math.min(height - 1, Math.max(0, y)) * width]!;
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / step;
      sum -= tmp[x + Math.min(height - 1, Math.max(0, y - radius)) * width]!;
      sum += tmp[x + Math.min(height - 1, Math.max(0, y + radius + 1)) * width]!;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ upscaling */

export function upscale(image: ImageData, factor: 2 | 3 | 4 = 2): ImageData {
  const width = image.width * factor;
  const height = image.height * factor;
  const out = new Uint8ClampedArray(width * height * 4);
  const src = image.data;

  const cubic = (t: number, a: number, b: number, c: number, d: number) => {
    const t2 = t * t;
    const t3 = t2 * t;
    const p0 = -0.5 * a + 1.5 * b - 1.5 * c + 0.5 * d;
    const p1 = a - 2.5 * b + 2 * c - 0.5 * d;
    const p2 = -0.5 * a + 0.5 * c;
    const p3 = b;
    return p0 * t3 + p1 * t2 + p2 * t + p3;
  };

  const sample = (channel: number, x: number, y: number) => {
    const sx = Math.min(image.width - 1, Math.max(0, Math.round(x / factor)));
    const sy = Math.min(image.height - 1, Math.max(0, Math.round(y / factor)));
    return src[(sy * image.width + sx) * 4 + channel]!;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        // Bicubic (Catmull-Rom) in two passes approximated by direct sampling.
        const gx = Math.floor(x / factor);
        const gy = Math.floor(y / factor);
        const tx = x / factor - gx;
        const ty = y / factor - gy;
        const rows: number[] = [];
        for (let row = -1; row <= 2; row++) {
          const a = sample(channel, (gx - 1) * factor, (gy + row) * factor);
          const b = sample(channel, gx * factor, (gy + row) * factor);
          const c = sample(channel, (gx + 1) * factor, (gy + row) * factor);
          const d = sample(channel, (gx + 2) * factor, (gy + row) * factor);
          rows.push(cubic(tx, a, b, c, d));
        }
        out[target + channel] = clamp255(cubic(ty, rows[0]!, rows[1]!, rows[2]!, rows[3]!));
      }
    }
  }

  const scaled = new ImageData(out, width, height);
  return sharpen(scaled, 0.35);
}

export function sharpen(image: ImageData, amount = 0.5): ImageData {
  const { width, height, data } = image;
  const out = clone(image);
  const kernel = [0, -amount, 0, -amount, 1 + amount * 4, -amount, 0, -amount, 0];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            sum += data[((y + ky) * width + (x + kx)) * 4 + channel]! * kernel[(ky + 1) * 3 + (kx + 1)]!;
          }
        }
        out.data[(y * width + x) * 4 + channel] = clamp255(sum);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------- enhance */

export function enhance(image: ImageData, { contrast = 1.15, saturation = 1.12, sharpenAmount = 0.3 } = {}): ImageData {
  const out = clone(image);
  const { data } = out;

  // Histogram stretch per channel (0.5% clip).
  const channels = [0, 1, 2].map((channel) => {
    const histogram = new Uint32Array(256);
    for (let i = channel; i < data.length; i += 4) histogram[data[i]!]! += 1;
    const total = data.length / 4;
    const clip = Math.round(total * 0.005);
    let low = 0;
    let high = 255;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += histogram[i]!;
      if (acc > clip) {
        low = i;
        break;
      }
    }
    acc = 0;
    for (let i = 255; i >= 0; i--) {
      acc += histogram[i]!;
      if (acc > clip) {
        high = i;
        break;
      }
    }
    return { low: Math.min(low, 250), high: Math.max(high, low + 8) };
  });

  for (let i = 0; i < data.length; i += 4) {
    let r = channels[0]!;
    let g = channels[1]!;
    let b = channels[2]!;
    const rs = ((data[i]! - r.low) / (r.high - r.low)) * 255;
    const gs = ((data[i + 1]! - g.low) / (g.high - g.low)) * 255;
    const bs = ((data[i + 2]! - b.low) / (b.high - b.low)) * 255;
    const rc = (rs - 128) * contrast + 128;
    const gc = (gs - 128) * contrast + 128;
    const bc = (bs - 128) * contrast + 128;
    const [h, s, l] = rgbToHsl(clamp255(rc), clamp255(gc), clamp255(bc));
    const [fr, fg, fb] = hslToRgb(h, Math.min(1, s * saturation), l);
    data[i] = clamp255(fr);
    data[i + 1] = clamp255(fg);
    data[i + 2] = clamp255(fb);
  }

  return sharpen(out, sharpenAmount);
}

/* -------------------------------------------------------------------- adjust */

export function adjust(
  image: ImageData,
  { brightness = 0, contrast = 1, saturation = 1, temperature = 0, hue = 0, gamma = 1, vignette = 0 } = {},
): ImageData {
  const out = clone(image);
  const { data, width, height } = out;
  const gammaTable = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) gammaTable[i] = clamp255(Math.pow(i / 255, 1 / Math.max(0.1, gamma)) * 255);

  const cx = width / 2;
  const cy = height / 2;
  const maxDistance = Math.hypot(cx, cy) || 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = gammaTable[data[i]!]! + brightness + temperature;
      let g = gammaTable[data[i + 1]!]! + brightness;
      let b = gammaTable[data[i + 2]!]! + brightness - temperature;

      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;

      const [h, s, l] = rgbToHsl(clamp255(r), clamp255(g), clamp255(b));
      const [fr, fg, fb] = hslToRgb((h + hue / 360 + 1) % 1, Math.min(1, s * saturation), l);
      r = fr;
      g = fg;
      b = fb;

      if (vignette) {
        const distance = Math.hypot(x - cx, y - cy) / maxDistance;
        const factor = 1 - vignette * Math.pow(distance, 2.2);
        r *= factor;
        g *= factor;
        b *= factor;
      }

      data[i] = clamp255(r);
      data[i + 1] = clamp255(g);
      data[i + 2] = clamp255(b);
    }
  }
  return out;
}

/* ------------------------------------------------------------------- filters */

const FILTER_LUT: Record<FilterName, (r: number, g: number, b: number) => [number, number, number]> = {
  original: (r, g, b) => [r, g, b],
  grayscale: (r, g, b) => {
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    return [l, l, l];
  },
  sepia: (r, g, b) => [
    0.393 * r + 0.769 * g + 0.189 * b,
    0.349 * r + 0.686 * g + 0.168 * b,
    0.272 * r + 0.534 * g + 0.131 * b,
  ],
  invert: (r, g, b) => [255 - r, 255 - g, 255 - b],
  noir: (r, g, b) => {
    const l = (0.299 * r + 0.587 * g + 0.114 * b - 128) * 1.6 + 110;
    return [l, l, l];
  },
  vintage: (r, g, b) => [r * 1.08 + 12, g * 0.98 + 6, b * 0.86 - 4],
  cinematic: (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    const [fr, fg, fb] = hslToRgb(h < 0.6 ? h + 0.02 : h, s * 0.85, l < 0.5 ? l * 0.92 : l * 1.06);
    return [fr, fg, fb];
  },
  cool: (r, g, b) => [r * 0.95, g * 0.99, b * 1.12],
  warm: (r, g, b) => [r * 1.1, g * 1.02, b * 0.92],
  dramatic: (r, g, b) => {
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const boosted = (l - 128) * 1.9 + 108;
    return [boosted + 8, boosted, boosted - 6];
  },
  pastel: (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h, s * 0.55, l * 0.5 + 0.42);
  },
  muted: (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h, s * 0.6, l);
  },
  vivid: (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h, Math.min(1, s * 1.65), l);
  },
  duotone: (r, g, b) => {
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return [40 + l * 105, 30 + l * 96, 90 + l * 140];
  },
  crossprocess: (r, g, b) => [r * 1.05 + 8, g * 0.96, b * 1.14 - 6],
  faded: (r, g, b) => [r * 0.9 + 26, g * 0.9 + 26, b * 0.9 + 26],
  moody: (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h + 0.03, s * 0.7, l * 0.82);
  },
  sunset: (r, g, b) => [r * 1.18 + 10, g * 0.95, b * 0.86 - 8],
  forest: (r, g, b) => [r * 0.9, g * 1.08, b * 0.94],
  ocean: (r, g, b) => [r * 0.86, g * 0.98, b * 1.2],
  neon: (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h, Math.min(1, s * 1.9), l * 1.05);
  },
  matte: (r, g, b) => [r * 0.94 + 18, g * 0.94 + 18, b * 0.94 + 18],
  'bw-contrast': (r, g, b) => {
    const l = (0.299 * r + 0.587 * g + 0.114 * b - 128) * 1.35 + 128;
    return [l, l, l];
  },
};

export const FILTER_NAMES = Object.keys(FILTER_LUT) as FilterName[];

export function applyFilter(image: ImageData, name: FilterName, intensity = 1): ImageData {
  const out = clone(image);
  const fn = FILTER_LUT[name] ?? FILTER_LUT.original;
  const { data } = out;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = fn(data[i]!, data[i + 1]!, data[i + 2]!);
    data[i] = clamp255(data[i]! + (r - data[i]!) * intensity);
    data[i + 1] = clamp255(data[i + 1]! + (g - data[i + 1]!) * intensity);
    data[i + 2] = clamp255(data[i + 2]! + (b - data[i + 2]!) * intensity);
  }
  return out;
}

export function posterize(image: ImageData, levels = 6): ImageData {
  const out = clone(image);
  const step = 255 / Math.max(2, levels - 1);
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      out.data[i + c] = Math.round(Math.round(out.data[i + c]! / step) * step);
    }
  }
  return out;
}

/* --------------------------------------------------------------- smart crop */

export type CropBox = { x: number; y: number; width: number; height: number };

/**
 * Saliency crop: scores each candidate window with an edge-energy map plus a
 * mild centre bias, then returns the best-scoring window of the target aspect.
 */
export function smartCrop(image: ImageData, targetWidth: number, targetHeight: number): CropBox {
  const { width, height, data } = image;
  const targetRatio = targetWidth / targetHeight;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) * (data[i + 3]! / 255);
  }
  const energy = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = gray[i + 1]! - gray[i - 1]!;
      const gy = gray[i + width]! - gray[i - width]!;
      energy[i] = Math.hypot(gx, gy);
    }
  }
  // Integral image for fast window sums.
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      integral[(y + 1) * (width + 1) + (x + 1)] =
        energy[y * width + x]! +
        integral[y * (width + 1) + (x + 1)]! +
        integral[(y + 1) * (width + 1) + x]! -
        integral[y * (width + 1) + x]!;
    }
  }
  const windowSum = (x: number, y: number, w: number, h: number) => {
    const x2 = Math.min(width, x + w);
    const y2 = Math.min(height, y + h);
    return (
      integral[y2 * (width + 1) + x2]! -
      integral[y * (width + 1) + x2]! -
      integral[y2 * (width + 1) + x]! +
      integral[y * (width + 1) + x]!
    );
  };

  let cropWidth = width;
  let cropHeight = Math.round(cropWidth / targetRatio);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.round(cropHeight * targetRatio);
  }

  let bestScore = -Infinity;
  let best = { x: 0, y: 0, width: cropWidth, height: cropHeight };
  const stepX = Math.max(1, Math.floor(width / 24));
  const stepY = Math.max(1, Math.floor(height / 24));
  for (let y = 0; y + cropHeight <= height; y += stepY) {
    for (let x = 0; x + cropWidth <= width; x += stepX) {
      const energyScore = windowSum(x, y, cropWidth, cropHeight) / (cropWidth * cropHeight);
      const cx = (x + cropWidth / 2 - width / 2) / width;
      const cy = (y + cropHeight / 2 - height / 2) / height;
      const centreBias = 1 - 0.25 * Math.hypot(cx, cy);
      const score = energyScore * centreBias;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, width: cropWidth, height: cropHeight };
      }
    }
  }
  return best;
}

/* ---------------------------------------------------------------- dispatcher */

export function runOp(image: ImageData, op: ImageOp): ImageData | CropBox {
  switch (op.kind) {
    case 'removeBackground':
      return removeBackground(image, op);
    case 'upscale':
      return upscale(image, op.factor);
    case 'enhance':
      return enhance(image, op);
    case 'filter':
      return applyFilter(image, op.name, op.intensity ?? 1);
    case 'adjust':
      return adjust(image, op);
    case 'posterize':
      return posterize(image, op.levels ?? 6);
    case 'smartCrop':
      return smartCrop(image, op.width, op.height);
    default:
      return image;
  }
}
