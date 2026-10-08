/**
 * Compact GIF89a encoder (256-color, looping).
 * Used so GIF export works fully offline with no native binaries.
 */

function popularityPalette(frames: Uint8ClampedArray[], maxColors = 256): Uint8Array {
  const counts = new Map<number, number>();
  for (const data of frames) {
    const step = Math.max(4, Math.floor(data.length / 40000) * 4);
    for (let i = 0; i < data.length; i += step) {
      const r = data[i] >> 3;
      const g = data[i + 1] >> 3;
      const b = data[i + 2] >> 3;
      const key = (r << 10) | (g << 5) | b;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors - 1);
  const pal = new Uint8Array(256 * 3);
  pal[0] = 0;
  pal[1] = 0;
  pal[2] = 0;
  sorted.forEach((entry, i) => {
    const key = entry[0];
    const idx = (i + 1) * 3;
    pal[idx] = ((key >> 10) & 31) << 3;
    pal[idx + 1] = ((key >> 5) & 31) << 3;
    pal[idx + 2] = (key & 31) << 3;
  });
  return pal;
}

function nearestIndex(pal: Uint8Array, r: number, g: number, b: number, cache: Int32Array): number {
  const key = ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  const hit = cache[key & 0x3ffff];
  if (hit >= 0 && hit < 256) {
    const i = hit * 3;
    if (pal[i] === (r & 0xf8) || true) {
      /* loose cache */
    }
  }
  let best = 0;
  let bestD = 1e15;
  for (let i = 0; i < 256; i++) {
    const p = i * 3;
    const dr = pal[p] - r;
    const dg = pal[p + 1] - g;
    const db = pal[p + 2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
      if (d === 0) break;
    }
  }
  cache[key & 0x3ffff] = best;
  return best;
}

function indexFrame(data: Uint8ClampedArray, pal: Uint8Array, cache: Int32Array): Uint8Array {
  const out = new Uint8Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] < 16) {
      out[p] = 0;
      continue;
    }
    out[p] = nearestIndex(pal, data[i], data[i + 1], data[i + 2], cache);
  }
  return out;
}

class BitWriter {
  bytes: number[] = [];
  acc = 0;
  bits = 0;
  write(code: number, size: number): void {
    this.acc |= (code & ((1 << size) - 1)) << this.bits;
    this.bits += size;
    while (this.bits >= 8) {
      this.bytes.push(this.acc & 255);
      this.acc >>= 8;
      this.bits -= 8;
    }
  }
  flush(): void {
    if (this.bits > 0) this.bytes.push(this.acc & 255);
    this.acc = 0;
    this.bits = 0;
  }
}

function lzw(indices: Uint8Array, minCode = 8): number[] {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let codeSize = minCode + 1;
  let nextCode = eoi + 1;
  const dict = new Map<string, number>();
  const bw = new BitWriter();
  const reset = () => {
    dict.clear();
    codeSize = minCode + 1;
    nextCode = eoi + 1;
    bw.write(clear, codeSize);
  };
  reset();
  let w = String.fromCharCode(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const c = String.fromCharCode(indices[i]);
    const wc = w + c;
    if (dict.has(wc)) w = wc;
    else {
      const code = w.length === 1 ? w.charCodeAt(0) : dict.get(w)!;
      bw.write(code, codeSize);
      if (nextCode < 4096) {
        dict.set(wc, nextCode++);
        if (nextCode >= 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        reset();
      }
      w = c;
    }
  }
  const last = w.length === 1 ? w.charCodeAt(0) : dict.get(w)!;
  bw.write(last, codeSize);
  bw.write(eoi, codeSize);
  bw.flush();
  return bw.bytes;
}

function chunkBytes(data: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const slice = data.slice(i, i + 255);
    out.push(slice.length, ...slice);
  }
  out.push(0);
  return out;
}

export function encodeGif(
  frames: { width: number; height: number; data: Uint8ClampedArray }[],
  delayCs: number,
  onProgress?: (t: number) => void
): Uint8Array {
  if (!frames.length) throw new Error("No frames");
  const w = frames[0].width;
  const h = frames[0].height;
  const pal = popularityPalette(frames.map((f) => f.data));
  const cache = new Int32Array(0x40000).fill(-1);
  const out: number[] = [];
  const u16 = (n: number) => {
    out.push(n & 255, (n >> 8) & 255);
  };
  out.push(71, 73, 70, 56, 57, 97); // GIF89a
  u16(w);
  u16(h);
  out.push(0xf7, 0, 0);
  for (let i = 0; i < 256 * 3; i++) out.push(pal[i]);
  out.push(0x21, 0xff, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0);
  frames.forEach((frame, fi) => {
    onProgress?.(fi / frames.length);
    const indexed = indexFrame(frame.data, pal, cache);
    out.push(0x21, 0xf9, 4, 0x08, delayCs & 255, (delayCs >> 8) & 255, 0, 0);
    out.push(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    out.push(0);
    out.push(8);
    out.push(...chunkBytes(lzw(indexed, 8)));
  });
  out.push(0x3b);
  onProgress?.(1);
  return new Uint8Array(out);
}
