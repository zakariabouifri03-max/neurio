import {
  AIProvider,
  AssistantContext,
  AssistantResult,
  CleanupOptions,
  ColorizeOptions,
  InterpOptions,
  MotionOptions,
  cloneImageData,
  yieldFrame,
} from "./provider";

function sample(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): [number, number, number, number] {
  const ix = Math.max(0, Math.min(w - 1, x | 0));
  const iy = Math.max(0, Math.min(h - 1, y | 0));
  const i = (iy * w + ix) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function bilinear(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const a = sample(data, w, h, x0, y0);
  const b = sample(data, w, h, x1, y0);
  const c = sample(data, w, h, x0, y1);
  const d = sample(data, w, h, x1, y1);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const i1 = a[k] + (b[k] - a[k]) * fx;
    const i2 = c[k] + (d[k] - c[k]) * fx;
    out[k] = i1 + (i2 - i1) * fy;
  }
  return out;
}

function downscale(img: ImageData, maxSide: number): { img: ImageData; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale === 1) return { img, scale: 1 };
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  const o = document.createElement("canvas");
  o.width = w;
  o.height = h;
  o.getContext("2d")!.drawImage(c, 0, 0, w, h);
  return { img: o.getContext("2d")!.getImageData(0, 0, w, h), scale };
}

function upscaleFlow(
  flow: Float32Array,
  bw: number,
  bh: number,
  w: number,
  h: number
): Float32Array {
  const out = new Float32Array(w * h * 2);
  const sx = bw / w;
  const sy = bh / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, x * sx);
      const fy = Math.min(bh - 1, y * sy);
      const i = (y * w + x) * 2;
      const j = ((fy | 0) * bw + (fx | 0)) * 2;
      out[i] = flow[j];
      out[i + 1] = flow[j + 1];
    }
  }
  return out;
}

function blockFlow(a: ImageData, b: ImageData, block = 12, search = 10): { flow: Float32Array; bw: number; bh: number } {
  const w = a.width;
  const h = a.height;
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const flow = new Float32Array(bw * bh * 2);
  const da = a.data;
  const db = b.data;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const ox = bx * block;
      const oy = by * block;
      let best = 1e15;
      let bdx = 0;
      let bdy = 0;
      for (let dy = -search; dy <= search; dy += 2) {
        for (let dx = -search; dx <= search; dx += 2) {
          let sad = 0;
          for (let y = 0; y < block; y += 2) {
            const sy = oy + y;
            if (sy >= h) break;
            for (let x = 0; x < block; x += 2) {
              const sx = ox + x;
              if (sx >= w) break;
              const tx = sx + dx;
              const ty = sy + dy;
              if (tx < 0 || ty < 0 || tx >= w || ty >= h) {
                sad += 64;
                continue;
              }
              const i = (sy * w + sx) * 4;
              const j = (ty * w + tx) * 4;
              sad += Math.abs(da[i] - db[j]) + Math.abs(da[i + 1] - db[j + 1]) + Math.abs(da[i + 2] - db[j + 2]);
            }
          }
          if (sad < best) {
            best = sad;
            bdx = dx;
            bdy = dy;
          }
        }
      }
      const fi = (by * bw + bx) * 2;
      flow[fi] = bdx;
      flow[fi + 1] = bdy;
    }
  }
  return { flow, bw, bh };
}

function warpBlend(a: ImageData, b: ImageData, flow: Float32Array, t: number): ImageData {
  const w = a.width;
  const h = a.height;
  const out = new ImageData(w, h);
  const da = a.data;
  const db = b.data;
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fi = (y * w + x) * 2;
      const mx = flow[fi];
      const my = flow[fi + 1];
      const ax = x - mx * t;
      const ay = y - my * t;
      const bx = x + mx * (1 - t);
      const by = y + my * (1 - t);
      const pa = bilinear(da, w, h, ax, ay);
      const pb = bilinear(db, w, h, bx, by);
      const i = (y * w + x) * 4;
      d[i] = pa[0] * (1 - t) + pb[0] * t;
      d[i + 1] = pa[1] * (1 - t) + pb[1] * t;
      d[i + 2] = pa[2] * (1 - t) + pb[2] * t;
      d[i + 3] = pa[3] * (1 - t) + pb[3] * t;
    }
  }
  return out;
}

function resizeImageData(img: ImageData, w: number, h: number): ImageData {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  const o = document.createElement("canvas");
  o.width = w;
  o.height = h;
  const ctx = o.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function parseColor(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
}

const COLOR_WORDS: Record<string, string> = {
  red: "#c0392b",
  blue: "#1f4e79",
  "dark blue": "#1a365d",
  navy: "#1a365d",
  green: "#1e7a46",
  yellow: "#f1c40f",
  orange: "#e67e22",
  purple: "#6c5ce7",
  pink: "#e84393",
  black: "#1a1a1a",
  white: "#f5f5f5",
  brown: "#6f4e37",
  gray: "#7f8c8d",
  grey: "#7f8c8d",
  teal: "#3ee0c5",
};

export class LocalProvider implements AIProvider {
  id = "local";
  name = "Local (offline)";
  kind = "local" as const;
  description = "On-device interpolation, cleanup, coloring and motion. No drawings leave this computer.";
  requiresCloud = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async interpolate(a: ImageData, b: ImageData, opts: InterpOptions): Promise<ImageData[]> {
    const count = opts.count;
    const smallA = downscale(a, 320);
    const smallB = downscale(b, 320);
    const { flow, bw, bh } = blockFlow(smallA.img, smallB.img);
    const hi = upscaleFlow(flow, bw, bh, a.width, a.height);
    const frames: ImageData[] = [];
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const small = warpBlend(smallA.img, smallB.img, upscaleFlow(flow, bw, bh, smallA.img.width, smallA.img.height), t);
      const full = warpBlend(a, b, hi, t);
      const mix = full;
      for (let p = 0; p < mix.data.length; p++) mix.data[p] = full.data[p];
      void small;
      frames.push(mix);
      opts.onProgress?.(i / count);
      await yieldFrame();
    }
    return frames;
  }

  async cleanup(image: ImageData, opts: CleanupOptions): Promise<ImageData> {
    const src = cloneImageData(image);
    const w = src.width;
    const h = src.height;
    const d = src.data;
    const out = cloneImageData(image);
    const od = out.data;
    const str = opts.strength;
    const detail = opts.detail;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        let lum = 0;
        let count = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const j = ((y + ky) * w + (x + kx)) * 4;
            lum += d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11;
            count++;
          }
        }
        lum /= count;
        const orig = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        const contrast = (orig - 128) * (1 + str) + 128;
        const mixed = orig * (1 - str) + contrast * str;
        const ink = mixed < 140 - detail * 40 ? Math.max(0, mixed * (1 - str * 0.6)) : Math.min(255, mixed + str * 40);
        const k = opts.preserveOriginal ? orig * 0.35 + ink * 0.65 : ink;
        od[i] = od[i + 1] = od[i + 2] = k;
        od[i + 3] = d[i + 3] < 20 ? 0 : Math.max(d[i + 3], k < 230 ? 255 : d[i + 3]);
      }
    }
    await yieldFrame();
    return out;
  }

  async colorize(image: ImageData, opts: ColorizeOptions): Promise<ImageData> {
    const w = image.width;
    const h = image.height;
    const src = image.data;
    const out = cloneImageData(image);
    const od = out.data;
    const palette = [...opts.palette];
    const desc = opts.description.toLowerCase();
    for (const [word, hex] of Object.entries(COLOR_WORDS)) {
      if (desc.includes(word) && !palette.includes(hex)) palette.push(hex);
    }
    if (!palette.length) palette.push("#3ee0c5", "#f4d19b", "#1f4e79", "#c0392b", "#f5f5f5");
    const visited = new Uint8Array(w * h);
    const regions: { x: number; y: number; area: number }[] = [];
    const isPaper = (i: number) => {
      const l = src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11;
      return src[i + 3] < 18 || l > 245;
    };
    const isLine = (i: number) => {
      const l = src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11;
      return src[i + 3] > 40 && l < 90;
    };
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const idx = y * w + x;
        if (visited[idx] || isLine(idx * 4) || isPaper(idx * 4)) continue;
        const stack = [x, y];
        let area = 0;
        visited[idx] = 1;
        while (stack.length) {
          const cy = stack.pop()!;
          const cx = stack.pop()!;
          area++;
          const nbs = [cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1];
          for (let n = 0; n < nbs.length; n += 2) {
            const nx = nbs[n];
            const ny = nbs[n + 1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (visited[ni]) continue;
            const pi = ni * 4;
            if (isLine(pi) || isPaper(pi)) continue;
            visited[ni] = 1;
            stack.push(nx, ny);
          }
        }
        if (area > 80) regions.push({ x, y, area });
      }
    }
    regions.sort((a, b) => b.area - a.area);
    const regionColor = new Map<string, [number, number, number]>();
    regions.forEach((r, i) => {
      regionColor.set(`${r.x},${r.y}`, parseColor(palette[i % palette.length]));
    });
    visited.fill(0);
    let ri = 0;
    for (const region of regions) {
      const col = parseColor(palette[ri++ % palette.length]);
      const stack = [region.x, region.y];
      const start = region.y * w + region.x;
      if (visited[start]) continue;
      visited[start] = 1;
      while (stack.length) {
        const cy = stack.pop()!;
        const cx = stack.pop()!;
        const pi = (cy * w + cx) * 4;
        if (isLine(pi)) continue;
        if (!isPaper(pi)) {
          od[pi] = od[pi] * 0.25 + col[0] * 0.75;
          od[pi + 1] = od[pi + 1] * 0.25 + col[1] * 0.75;
          od[pi + 2] = od[pi + 2] * 0.25 + col[2] * 0.75;
          od[pi + 3] = 255;
        }
        const nbs = [cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1];
        for (let n = 0; n < nbs.length; n += 2) {
          const nx = nbs[n];
          const ny = nbs[n + 1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni]) continue;
          const qi = ni * 4;
          if (isLine(qi)) continue;
          visited[ni] = 1;
          stack.push(nx, ny);
        }
      }
    }
    void regionColor;
    await yieldFrame();
    return out;
  }

  async generateMotion(image: ImageData, opts: MotionOptions): Promise<ImageData[]> {
    const n = Math.max(2, opts.frames);
    const motion = (opts.motion || opts.customPrompt || "idle").toLowerCase();
    const frames: ImageData[] = [];
    const w = image.width;
    const h = image.height;
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.putImageData(image, 0, 0);
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      tmp.getContext("2d")!.putImageData(image, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      let x = 0;
      let y = 0;
      let sx = 1;
      let sy = 1;
      let rot = 0;
      if (motion.includes("walk") || motion.includes("run")) {
        const speed = motion.includes("run") ? 0.18 : 0.1;
        x = (t - 0.5) * w * speed * 2;
        y = Math.abs(Math.sin(t * Math.PI * 4)) * (motion.includes("run") ? 18 : 10);
        rot = Math.sin(t * Math.PI * 4) * 4;
      } else if (motion.includes("jump")) {
        y = -Math.sin(t * Math.PI) * h * 0.22;
        sx = 1 + (t > 0.45 && t < 0.55 ? 0.06 : t < 0.15 || t > 0.85 ? 0.12 : 0);
        sy = 2 - sx;
      } else if (motion.includes("wave")) {
        rot = Math.sin(t * Math.PI * 4) * 12;
        y = Math.sin(t * Math.PI * 2) * 6;
      } else if (motion.includes("bounce") || motion.includes("ball")) {
        y = -Math.abs(Math.sin(t * Math.PI * 2)) * h * 0.28;
        const squash = Math.abs(Math.cos(t * Math.PI * 2));
        sx = 1 + (1 - squash) * 0.25;
        sy = 1 - (1 - squash) * 0.25;
      } else if (motion.includes("idle") || motion.includes("breathe") || motion.includes("stand")) {
        sy = 1 + Math.sin(t * Math.PI * 2) * 0.02;
        y = Math.sin(t * Math.PI * 2) * 3;
      } else if (motion.includes("sit")) {
        y = t * h * 0.08;
        sy = 1 - t * 0.08;
        sx = 1 + t * 0.06;
      } else if (motion.includes("turn")) {
        sx = Math.cos(t * Math.PI);
      } else if (motion.includes("dance")) {
        x = Math.sin(t * Math.PI * 4) * 28;
        rot = Math.sin(t * Math.PI * 4) * 10;
        y = Math.abs(Math.sin(t * Math.PI * 6)) * 12;
      } else if (motion.includes("fight") || motion.includes("punch")) {
        x = Math.sin(t * Math.PI * 3) * 36;
        rot = Math.sin(t * Math.PI * 3) * 8;
      } else if (motion.includes("talk")) {
        sy = 1 + Math.sin(t * Math.PI * 8) * 0.015;
      } else {
        x = Math.sin(t * Math.PI * 2) * 16;
        y = Math.cos(t * Math.PI * 2) * 8;
      }
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(sx || 0.05, sy);
      ctx.drawImage(tmp, -w / 2 + x, -h / 2 + y);
      ctx.restore();
      frames.push(ctx.getImageData(0, 0, w, h));
      await yieldFrame();
    }
    return frames;
  }

  async textToAnimation(prompt: string, width: number, height: number, frames: number): Promise<ImageData[]> {
    const p = prompt.toLowerCase();
    const n = Math.max(8, frames);
    const out: ImageData[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d")!;
      if (p.includes("rain") || p.includes("city")) {
        const g = ctx.createLinearGradient(0, 0, 0, height);
        g.addColorStop(0, "#0b1020");
        g.addColorStop(1, "#1c2740");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#152033";
        for (let b = 0; b < 8; b++) {
          const bx = (b / 8) * width;
          const bh = height * (0.3 + ((b * 37) % 40) / 100);
          ctx.fillRect(bx + 8, height - bh, width / 10, bh);
        }
        ctx.strokeStyle = "rgba(180,200,255,0.55)";
        ctx.lineWidth = 1;
        for (let r = 0; r < 70; r++) {
          const rx = ((r * 97 + i * 18) % width);
          const ry = ((r * 53 + i * 40) % height);
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 4, ry + 14);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = "#f3efe6";
        ctx.fillRect(0, 0, width, height);
      }
      const cx = width * 0.5 + (p.includes("walk") ? (t - 0.5) * width * 0.4 : 0);
      let cy = height * 0.62;
      if (p.includes("jump")) cy -= Math.sin(t * Math.PI) * height * 0.2;
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = Math.max(3, width / 400);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy - height * 0.16, height * 0.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - height * 0.11);
      ctx.lineTo(cx, cy + height * 0.02);
      ctx.stroke();
      const arm = p.includes("wave") ? Math.sin(t * Math.PI * 6) * 0.8 : Math.sin(t * Math.PI * 4) * 0.35;
      ctx.beginPath();
      ctx.moveTo(cx, cy - height * 0.08);
      ctx.lineTo(cx - height * 0.08, cy - height * 0.02 + arm * 20);
      ctx.moveTo(cx, cy - height * 0.08);
      ctx.lineTo(cx + height * 0.08, cy - height * 0.04 - arm * 30);
      ctx.stroke();
      const step = Math.sin(t * Math.PI * 4);
      ctx.beginPath();
      ctx.moveTo(cx, cy + height * 0.02);
      ctx.lineTo(cx - height * 0.07, cy + height * 0.16 + step * 8);
      ctx.moveTo(cx, cy + height * 0.02);
      ctx.lineTo(cx + height * 0.07, cy + height * 0.16 - step * 8);
      ctx.stroke();
      if (p.includes("umbrella") && t > 0.45) {
        ctx.beginPath();
        ctx.arc(cx + height * 0.08, cy - height * 0.22, height * 0.1, Math.PI, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + height * 0.08, cy - height * 0.22);
        ctx.lineTo(cx + height * 0.08, cy - height * 0.05);
        ctx.stroke();
      }
      if (p.includes("ball")) {
        const by = height * 0.75 - Math.abs(Math.sin(t * Math.PI * 2)) * height * 0.35;
        ctx.fillStyle = "#c0392b";
        ctx.beginPath();
        ctx.arc(width * 0.3 + t * width * 0.4, by, height * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      out.push(ctx.getImageData(0, 0, width, height));
      await yieldFrame();
    }
    return out;
  }

  async assistant(prompt: string, ctx: AssistantContext): Promise<AssistantResult> {
    const p = prompt.toLowerCase().trim();
    const num = Number((p.match(/(\d+)/) || [])[1]);

    if (/in-?between|interpolat|smooth transition|generate .*frames/.test(p)) {
      const count = [2, 4, 6, 8, 12].includes(num) ? num : 4;
      return {
        message: `I'll generate ${count} in-between frames between the current drawing and the next key using local motion estimation. You can edit every generated frame afterwards.`,
        action: { type: "interpolate", count },
      };
    }
    if (/clean/.test(p) && /sketch|line/.test(p)) {
      return {
        message: "Running local line cleanup on the current frame. The original stays untouched — result goes to a new layer.",
        action: { type: "cleanup", strength: /strong|heavy/.test(p) ? 0.85 : 0.55 },
      };
    }
    if (/color/.test(p)) {
      return {
        message: "I'll flatten the current line art and paint closed regions onto a new coloring layer.",
        action: { type: "colorize", description: prompt },
      };
    }
    if (/remove (the )?background/.test(p)) {
      return {
        message: "Background removal needs a stronger segmenter in cloud mode. Locally I can punch corner-connected paper to transparent — I'll run that cleanup pass.",
        action: { type: "cleanup", strength: 0.2 },
      };
    }
    if (/(walk|run|jump|wave|idle|fight|sit|stand|dance|turn|talk|bounce)/.test(p) || /generate motion|make .*move/.test(p)) {
      const m = (p.match(/walk|run|jump|wave|idle|fight|sit|stand|dance|turn|talk|bounce/) || ["idle"])[0];
      return {
        message: `Generating a ${m} cycle from the current drawing with the local motion generator. This preserves your pixels via transforms — swap in a cloud provider for full character-aware animation.`,
        action: { type: "motion", motion: m, frames: num || 8 },
      };
    }
    if (/blink/.test(p)) {
      return {
        message: "A true blink needs eyelid drawings. I'll generate a short squash on the current pose as a stand-in, then you can draw lids on the in-betweens.",
        action: { type: "motion", motion: "idle", frames: 4 },
      };
    }
    if (/hair|wind/.test(p)) {
      return {
        message: "Hair-in-wind is character-aware and marked Coming Soon for local mode. Enable a cloud provider in Settings → AI for full generation. Meanwhile I can add a gentle sway.",
        action: { type: "motion", motion: "idle", frames: 6 },
        cloudRequired: true,
      };
    }
    if (/text to animation|generate an animation|young character|rainy city/.test(p) || p.length > 40) {
      return {
        message: "Experimental local text-to-animation will storyboard this prompt as editable frames (stick-scene blocking). Cloud providers can replace this with full illustration later.",
        action: { type: "text-to-anim", prompt },
      };
    }
    if (/duplicate/.test(p)) {
      return { message: "Duplicating the current frame.", action: { type: "frames", op: "duplicate", count: num || 1 } };
    }
    if (/blank|empty frame|add frame/.test(p)) {
      return { message: "Inserting blank frame(s).", action: { type: "frames", op: "blank", count: num || 1 } };
    }
    if (/onion/.test(p)) {
      return { message: "Toggling onion skin.", action: { type: "onion", enabled: !/off|disable/.test(p) } };
    }
    if (/flip/.test(p)) {
      return { message: "Flipping the current cel.", action: { type: "transform", kind: /vert/.test(p) ? "flipV" : "flipH" } };
    }
    if (/consistent|character library|same character/.test(p)) {
      return {
        message: "Save the current drawing to the Character Library (right panel). Local generation will use it as the source sheet. Full identity lock is stronger with a cloud provider.",
        action: { type: "none" },
      };
    }
    return {
      message: ctx.hasDrawing
        ? `I can in-between, clean the sketch, colorize, or generate motion from the current frame (${ctx.layerName}, frame ${ctx.currentFrame + 1}/${ctx.frameCount}). Try: "generate 6 in-between frames" or "make this character jump".`
        : "Draw a pose first, then ask me to in-between, clean, color, or generate a motion cycle. Everything here runs locally unless you enable a cloud provider.",
      action: { type: "none" },
    };
  }
}
