/**
 * Canvas2D text rasterizer with layout (wrapping), styling (gradient, outline, shadow,
 * glow, background) and per-unit (block / line / word / char) animation.
 */
import type { CaptionClip, TextClip, TextStyle, TextAnimUnit, CaptionWord } from '@/core/types';
import { getTextAnimation, type UnitState } from '@/library/textAnimations';
import { applyEasing } from '@/core/easing';
import { hashString } from '@/core/util';

interface Glyph {
  text: string;
  x: number; // left position in px (layout space, unscaled)
  y: number; // baseline
  w: number;
  lineIndex: number;
  wordIndex: number;
  charIndex: number;
  wordRef?: CaptionWord;
}

interface Layout {
  glyphs: Glyph[];
  lines: { y: number; x: number; w: number; glyphs: Glyph[] }[];
  width: number;
  height: number;
  wordCount: number;
  lineCount: number;
}

const measureCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
const mctx = measureCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;

export function fontString(style: TextStyle, size = style.fontSize): string {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${size}px "${style.fontFamily}", "Inter", system-ui, sans-serif`;
}

function layoutText(text: string, style: TextStyle, maxWidth: number, words?: CaptionWord[]): Layout {
  mctx.font = fontString(style);
  const letter = style.letterSpacing;
  const lineH = style.fontSize * style.lineHeight;
  const paragraphs = (style.uppercase ? text.toUpperCase() : text).split('\n');
  const glyphs: Glyph[] = [];
  const lines: Layout['lines'] = [];
  let wordIndex = 0;
  let charIndex = 0;
  let lineIndex = 0;
  let maxW = 0;
  const wordRefs = words ? [...words] : undefined;
  let wordRefIdx = 0;

  for (const para of paragraphs) {
    const wordsIn = para.split(/(\s+)/).filter((w) => w.length);
    let cur: Glyph[] = [];
    let curW = 0;
    const flush = () => {
      // trim trailing space glyphs
      while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) {
        curW -= cur[cur.length - 1].w;
        cur.pop();
      }
      lines.push({ y: lineIndex * lineH, x: 0, w: curW, glyphs: cur });
      maxW = Math.max(maxW, curW);
      lineIndex++;
      cur = [];
      curW = 0;
    };
    for (const w of wordsIn) {
      const isSpace = /^\s+$/.test(w);
      const chars = Array.from(w);
      const widths = chars.map((c) => mctx.measureText(c).width + letter);
      const ww = widths.reduce((a, b) => a + b, 0);
      if (!isSpace && curW + ww > maxWidth && cur.length) flush();
      if (isSpace && cur.length === 0) continue;
      const ref = !isSpace && wordRefs ? wordRefs[wordRefIdx++] : undefined;
      let x = curW;
      chars.forEach((c, i) => {
        cur.push({ text: c, x, y: 0, w: widths[i], lineIndex, wordIndex, charIndex, wordRef: ref });
        x += widths[i];
        if (!isSpace) charIndex++;
      });
      curW += ww;
      if (!isSpace) wordIndex++;
    }
    flush();
  }
  // Align lines
  for (const l of lines) {
    const dx = style.align === 'left' ? 0 : style.align === 'right' ? maxW - l.w : (maxW - l.w) / 2;
    l.x = dx;
    for (const g of l.glyphs) {
      g.x += dx;
      g.y = l.y + style.fontSize * 0.8; // approximate baseline
      glyphs.push(g);
    }
  }
  return { glyphs, lines, width: maxW, height: lines.length * lineH, wordCount: wordIndex, lineCount: lines.length };
}

const layoutCache = new Map<string, Layout>();
function getLayout(text: string, style: TextStyle, maxWidth: number, words?: CaptionWord[]): Layout {
  const key = `${hashString(text)}|${JSON.stringify(style)}|${maxWidth}|${words ? words.length : 0}`;
  let l = layoutCache.get(key);
  if (!l) {
    l = layoutText(text, style, maxWidth, words);
    if (layoutCache.size > 200) layoutCache.clear();
    layoutCache.set(key, l);
  }
  return l;
}

function unitIndex(g: Glyph, unit: TextAnimUnit): number {
  return unit === 'char' ? g.charIndex : unit === 'word' ? g.wordIndex : unit === 'line' ? g.lineIndex : 0;
}
function unitCount(l: Layout, unit: TextAnimUnit): number {
  return unit === 'char' ? Math.max(1, l.glyphs.filter((g) => !/^\s+$/.test(g.text)).length) : unit === 'word' ? Math.max(1, l.wordCount) : unit === 'line' ? Math.max(1, l.lineCount) : 1;
}

/** Compute the animation state for a glyph at clip-relative time t. */
function unitState(clip: TextClip | CaptionClip, g: Glyph, layout: Layout, t: number): UnitState {
  const st: UnitState = { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0, blur: 0, skew: 0 };
  const merge = (s: Partial<UnitState>) => {
    if (s.alpha !== undefined) st.alpha *= s.alpha;
    if (s.dx) st.dx += s.dx;
    if (s.dy) st.dy += s.dy;
    if (s.scale !== undefined) st.scale *= s.scale;
    if (s.rotate) st.rotate += s.rotate;
    if (s.blur) st.blur += s.blur;
    if (s.skew) st.skew += s.skew;
    if (s.colorShift !== undefined) st.colorShift = s.colorShift;
    if (s.trackingDelta) st.trackingDelta = (st.trackingDelta || 0) + s.trackingDelta;
  };
  const anim = clip.animation;
  const dur = clip.duration;
  // IN
  if (anim.in.type !== 'none' && anim.in.duration > 0) {
    const n = unitCount(layout, anim.in.unit);
    const idx = unitIndex(g, anim.in.unit);
    const stagger = anim.in.unit === 'block' ? 0 : anim.in.stagger;
    const total = anim.in.duration + stagger * (n - 1);
    const start = (idx * stagger * anim.in.duration) / Math.max(anim.in.duration, 1e-6);
    void total;
    let p = (t - start) / anim.in.duration;
    p = Math.max(0, Math.min(1, p));
    if (p < 1) merge(getTextAnimation(anim.in.type).fn(applyEasing('easeOut', p), idx, n, t));
  }
  // OUT
  if (anim.out.type !== 'none' && anim.out.duration > 0) {
    const n = unitCount(layout, anim.out.unit);
    const idx = unitIndex(g, anim.out.unit);
    const stagger = anim.out.unit === 'block' ? 0 : anim.out.stagger;
    const outStart = dur - anim.out.duration - stagger * (n - 1);
    const start = outStart + idx * stagger;
    let p = (t - start) / anim.out.duration;
    p = Math.max(0, Math.min(1, p));
    if (p > 0) merge(getTextAnimation(anim.out.type).fn(applyEasing('easeIn', 1 - p), idx, n, t));
  }
  // LOOP
  if (anim.loop && anim.loop.type !== 'none') {
    const n = unitCount(layout, 'char');
    const lt = t * anim.loop.speed;
    const s = getTextAnimation(anim.loop.type).fn(0, g.charIndex, n, lt);
    const k = anim.loop.intensity;
    merge({
      alpha: s.alpha !== undefined ? 1 - (1 - s.alpha) * k : undefined,
      dx: (s.dx || 0) * k,
      dy: (s.dy || 0) * k,
      scale: s.scale !== undefined ? 1 + (s.scale - 1) * k : undefined,
      rotate: (s.rotate || 0) * k,
      skew: (s.skew || 0) * k,
      colorShift: s.colorShift,
    });
  }
  return st;
}

export interface TextRenderResult {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  animated: boolean;
}

const canvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
function getCanvas(key: string, w: number, h: number) {
  let c = canvases.get(key);
  if (!c) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    canvases.set(key, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

export function isTextAnimated(clip: TextClip | CaptionClip): boolean {
  const a = clip.animation;
  return clip.kind === 'caption' || (a.in.type !== 'none' && a.in.duration > 0) || (a.out.type !== 'none' && a.out.duration > 0) || !!(a.loop && a.loop.type !== 'none');
}

/**
 * Render the text clip to a canvas the size of the project frame (times `scale`).
 * The text block is centered; the clip transform positions it in the compositor.
 */
export function renderText(clip: TextClip | CaptionClip, t: number, projW: number, projH: number, scale: number, cacheKey: string): TextRenderResult {
  const style = clip.style;
  const maxWidth = projW * style.maxWidth;
  const words = clip.kind === 'caption' ? (clip as CaptionClip).words : undefined;
  const layout = getLayout(clip.text, style, maxWidth, words);
  const pad = style.fontSize * 1.5 + (style.glow?.blur || 0) + (style.shadow ? Math.abs(style.shadow.blur) + Math.abs(style.shadow.y) : 0);
  const W = Math.ceil(Math.min(projW, layout.width + pad * 2) * scale);
  const H = Math.ceil(Math.min(projH * 2, layout.height + pad * 2) * scale);
  const canvas = getCanvas(cacheKey, Math.max(2, W), Math.max(2, H));
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  const ox = (W / scale - layout.width) / 2;
  const oy = (H / scale - layout.height) / 2;
  ctx.font = fontString(style);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const caption = clip.kind === 'caption' ? (clip as CaptionClip) : null;
  const activeWord = caption ? caption.words.find((w) => t >= w.start && t < w.end) : undefined;

  // Background box (whole block, uses block alpha from first glyph)
  const blockState = layout.glyphs.length ? unitState(clip, layout.glyphs[0], layout, t) : null;
  if (style.background && blockState) {
    ctx.save();
    ctx.globalAlpha = blockState.alpha;
    ctx.fillStyle = style.background.color;
    const p = style.background.padding;
    for (const l of layout.lines) {
      const x = ox + l.x - p, y = oy + l.y - p * 0.5, w = l.w + p * 2, h = style.fontSize * style.lineHeight + p;
      roundRect(ctx, x, y, w, h, style.background.radius);
      ctx.fill();
    }
    ctx.restore();
  }

  // Build fill style
  let fill: string | CanvasGradient = style.color;
  if (style.gradient) {
    const a = (style.gradient.angle * Math.PI) / 180;
    const cx = ox + layout.width / 2, cy = oy + layout.height / 2;
    const r = Math.max(layout.width, layout.height) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, style.gradient.from);
    g.addColorStop(1, style.gradient.to);
    fill = g;
  }

  const drawGlyph = (g: Glyph, st: UnitState, pass: 'shadow' | 'glow' | 'outline' | 'fill' | 'highlightbg') => {
    if (st.alpha <= 0.001 || /^\s+$/.test(g.text)) return;
    const fs = style.fontSize;
    const cx = ox + g.x + g.w / 2 + (st.dx + (st.trackingDelta || 0) * (g.charIndex - layout.glyphs.length / 2) * 0.2) * fs;
    const cy = oy + g.y - fs * 0.35 + st.dy * fs;
    ctx.save();
    ctx.globalAlpha = Math.min(1, st.alpha);
    ctx.translate(cx, cy);
    if (st.rotate) ctx.rotate((st.rotate * Math.PI) / 180);
    if (st.skew) ctx.transform(1, 0, Math.tan((st.skew * Math.PI) / 180) * 0.5, 1, 0, 0);
    let sc = st.scale;
    let isActive = false;
    if (caption && activeWord && g.wordRef === activeWord && caption.caption.mode !== 'none') {
      isActive = true;
      if (caption.caption.mode === 'word' || caption.caption.mode === 'box') sc *= caption.caption.highlightScale;
    }
    if (sc !== 1) ctx.scale(sc, sc);
    if (st.blur > 0) ctx.filter = `blur(${st.blur * fs}px)`;
    const tx = -g.w / 2 + style.letterSpacing / 2, ty = fs * 0.35;
    if (pass === 'highlightbg') {
      if (isActive && (caption!.caption.mode === 'box' || caption!.caption.highlightBackground)) {
        ctx.fillStyle = caption!.caption.highlightBackground || caption!.caption.highlightColor;
        roundRect(ctx, -g.w / 2 - fs * 0.12, -fs * 0.5, g.w + fs * 0.24, fs * 1.05, fs * 0.15);
        ctx.fill();
      }
    } else if (pass === 'shadow' && style.shadow) {
      ctx.shadowColor = style.shadow.color;
      ctx.shadowBlur = style.shadow.blur * scale;
      ctx.shadowOffsetX = style.shadow.x * scale;
      ctx.shadowOffsetY = style.shadow.y * scale;
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillText(g.text, tx, ty);
    } else if (pass === 'glow' && style.glow) {
      ctx.shadowColor = style.glow.color;
      ctx.shadowBlur = style.glow.blur * scale;
      ctx.fillStyle = style.glow.color;
      ctx.fillText(g.text, tx, ty);
      ctx.fillText(g.text, tx, ty);
    } else if (pass === 'outline' && style.outline && style.outline.width > 0) {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = style.outline.color;
      ctx.lineWidth = style.outline.width * 2;
      ctx.strokeText(g.text, tx, ty);
    } else if (pass === 'fill') {
      let f: string | CanvasGradient = fill;
      if (isActive && caption!.caption.mode !== 'box') f = caption!.caption.highlightColor;
      if (isActive && caption!.caption.mode === 'box') f = '#000000';
      if (caption && caption.caption.mode === 'karaoke' && !isActive && activeWord && g.wordRef && g.wordRef.start > activeWord.start) ctx.globalAlpha *= 0.55;
      if (st.colorShift !== undefined) ctx.filter = `hue-rotate(${st.colorShift}deg)`;
      ctx.fillStyle = f;
      ctx.fillText(g.text, tx, ty);
      if (style.underline) {
        ctx.fillRect(tx, ty + fs * 0.12, g.w, Math.max(1, fs * 0.06));
      }
    }
    ctx.restore();
  };

  const states = layout.glyphs.map((g) => unitState(clip, g, layout, t));
  // typewriter: clip based on char reveal
  if (clip.animation.in.type === 'typewriter') {
    const n = unitCount(layout, 'char');
    const per = clip.animation.in.duration / Math.max(1, n);
    layout.glyphs.forEach((g, i) => {
      states[i].alpha = t >= g.charIndex * per ? states[i].alpha : 0;
    });
  }
  const passes: ('shadow' | 'glow' | 'outline' | 'highlightbg' | 'fill')[] = ['shadow', 'glow', 'highlightbg', 'outline', 'fill'];
  for (const pass of passes) {
    if (pass === 'shadow' && !style.shadow) continue;
    if (pass === 'glow' && !style.glow) continue;
    if (pass === 'outline' && !style.outline) continue;
    if (pass === 'highlightbg' && !caption) continue;
    layout.glyphs.forEach((g, i) => drawGlyph(g, states[i], pass));
  }
  return { canvas, width: W, height: H, animated: isTextAnimated(clip) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Measure the natural block size of a text clip (project pixels), used for selection boxes. */
export function measureText(clip: TextClip | CaptionClip, projW: number): { width: number; height: number } {
  const l = getLayout(clip.text, clip.style, projW * clip.style.maxWidth, clip.kind === 'caption' ? clip.words : undefined);
  return { width: l.width, height: l.height };
}
