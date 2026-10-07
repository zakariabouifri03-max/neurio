/**
 * Renderer — composites a Project frame at time `t` with WebGL2.
 *
 * Pipeline per visual clip:  source → color pipeline (adjust) → effects → matte (chroma/seg/mask)
 *                            → composite (transform, crop, flip, opacity, blend) onto the output.
 * Transitions render both neighbours into layers and mix them with a transition shader.
 */
import type { Clip, ColorGrade, Mask, Project, Track, VisualClip, VideoClip, TextClip, CaptionClip, StickerClip } from '@/core/types';
import { GLContext, type FBO, type Program } from './gl/GLContext';
import { ADJUST_FRAG, COMPOSITE_FRAG, COPY_FRAG, MATTE_FRAG, SOLID_FRAG, TRANSFORM_FRAG, VERT, effectShader, transitionShader } from './gl/shaders';
import { getEffect, EFFECTS } from '@/library/effects';
import { getTransition, TRANSITIONS } from '@/library/transitions';
import { num, vec } from '@/core/keyframes';
import { curvesTextureData, getLut, isDefaultCurve, lutData, LUT_SIZE } from '@/library/luts';
import { renderText } from './TextRenderer';
import { renderSticker } from './StickerRenderer';
import { hexToRgb, hashString } from '@/core/util';
import { timelineToSourceOffset } from '@/core/commands';

export interface FrameSource {
  source: TexImageSource;
  width: number;
  height: number;
  /** Changes whenever the pixels change (e.g. video currentTime) so uploads can be skipped. */
  version: number;
}

export interface FrameProvider {
  /** Return the current frame for a video clip (already seeked by the playback/export engine). */
  videoFrame(clip: VideoClip, sourceTime: number): FrameSource | null;
  imageFrame(mediaId: string): FrameSource | null;
  /** Optional segmentation mask (R8, same orientation as the frame) for AI background removal. */
  segmentationMask?(clip: VisualClip, frame: FrameSource): { data: Uint8Array; width: number; height: number; version: number } | null;
}

export interface RenderOptions {
  width: number;
  height: number;
  /** Render into the canvas default framebuffer (true) or keep in an FBO for readback. */
  toCanvas?: boolean;
  /** Skip heavy per-pixel work while scrubbing. */
  fast?: boolean;
}

interface TexEntry {
  tex: WebGLTexture;
  version: number;
  width: number;
  height: number;
  lastUsed: number;
}

const BLEND_INDEX: Record<string, number> = { normal: 0, multiply: 1, screen: 2, overlay: 3, add: 4, darken: 5, lighten: 6, difference: 7, softlight: 8, hardlight: 9 };
const MASK_INDEX: Record<string, number> = { rectangle: 0, circle: 1, linear: 2, freehand: 3, star: 4, heart: 5, triangle: 6, hexagon: 7 };

export class Renderer {
  ctx: GLContext;
  private textures = new Map<string, TexEntry>();
  private lutTextures = new Map<string, WebGLTexture>();
  private curveTex: WebGLTexture;
  private curveKey = '';
  private whiteTex: WebGLTexture;
  private blackTex: WebGLTexture;
  private identityLut: WebGLTexture;
  private frameCounter = 0;
  lastFrameMs = 0;
  frameStats = { clips: 0, passes: 0 };

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.ctx = new GLContext(canvas);
    const gl = this.ctx.gl;
    this.curveTex = this.ctx.createTexture(gl.LINEAR);
    this.whiteTex = this.ctx.createTexture(gl.NEAREST);
    this.ctx.uploadData(this.whiteTex, 1, 1, new Uint8Array([255, 255, 255, 255]));
    this.blackTex = this.ctx.createTexture(gl.NEAREST);
    this.ctx.uploadData(this.blackTex, 1, 1, new Uint8Array([0, 0, 0, 0]));
    const id = new Uint8Array(LUT_SIZE ** 3 * 3);
    let i = 0;
    for (let b = 0; b < LUT_SIZE; b++) for (let g = 0; g < LUT_SIZE; g++) for (let r = 0; r < LUT_SIZE; r++) { id[i++] = (r * 255) / (LUT_SIZE - 1); id[i++] = (g * 255) / (LUT_SIZE - 1); id[i++] = (b * 255) / (LUT_SIZE - 1); }
    this.identityLut = this.ctx.create3DTexture(LUT_SIZE, id);
    // warm up core programs
    this.prog('copy', COPY_FRAG);
    this.prog('solid', SOLID_FRAG);
    this.prog('adjust', ADJUST_FRAG);
    this.prog('matte', MATTE_FRAG);
    this.prog('composite', COMPOSITE_FRAG);
    this.prog('transform', TRANSFORM_FRAG);
  }

  private prog(key: string, frag: string): Program {
    return this.ctx.program(key, VERT, frag);
  }

  /** Compile every registered effect/transition shader; returns the failures. Used by diagnostics/tests. */
  selfTest(): { kind: 'effect' | 'transition'; id: string; error: string }[] {
    const out: { kind: 'effect' | 'transition'; id: string; error: string }[] = [];
    for (const def of EFFECTS) {
      try {
        this.ctx.program(`fx_${def.id}`, VERT, effectShader(def.glsl));
      } catch (e: any) {
        out.push({ kind: 'effect', id: def.id, error: String(e?.message || e) });
      }
    }
    for (const def of TRANSITIONS) {
      try {
        this.ctx.program(`tr_${def.id}`, VERT, transitionShader(def.glsl));
      } catch (e: any) {
        out.push({ kind: 'transition', id: def.id, error: String(e?.message || e) });
      }
    }
    return out;
  }

  private effectProgram(type: string): Program | null {
    const key = `fx_${type}`;
    if (this.ctx.hasProgram(key)) return this.ctx.program(key, VERT, '');
    const def = getEffect(type);
    if (!def) return null;
    try {
      return this.ctx.program(key, VERT, effectShader(def.glsl));
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  private transitionProgram(type: string): Program | null {
    const key = `tr_${type}`;
    if (this.ctx.hasProgram(key)) return this.ctx.program(key, VERT, '');
    const def = getTransition(type);
    if (!def) return null;
    try {
      return this.ctx.program(key, VERT, transitionShader(def.glsl));
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  /** Upload (or reuse) a texture for a source keyed by id. */
  private texFor(key: string, src: TexImageSource, version: number, width: number, height: number, premultiply = true): WebGLTexture {
    let e = this.textures.get(key);
    if (!e) {
      e = { tex: this.ctx.createTexture(), version: -1, width: 0, height: 0, lastUsed: 0 };
      this.textures.set(key, e);
    }
    e.lastUsed = this.frameCounter;
    if (e.version !== version || e.width !== width || e.height !== height) {
      try {
        this.ctx.upload(e.tex, src, premultiply);
        e.version = version;
        e.width = width;
        e.height = height;
      } catch (err) {
        // video not ready yet — keep previous texture
      }
    }
    return e.tex;
  }

  private gcTextures() {
    if (this.frameCounter % 120 !== 0) return;
    for (const [k, e] of this.textures) {
      if (this.frameCounter - e.lastUsed > 600) {
        this.ctx.gl.deleteTexture(e.tex);
        this.textures.delete(k);
      }
    }
  }

  private lutTexture(id: string): WebGLTexture | null {
    let t = this.lutTextures.get(id);
    if (t) return t;
    const def = getLut(id);
    if (!def) return null;
    const data = lutData(def);
    if (!data) return null;
    t = this.ctx.create3DTexture(def.size || LUT_SIZE, data);
    this.lutTextures.set(id, t);
    return t;
  }

  invalidateLut(id: string) {
    const t = this.lutTextures.get(id);
    if (t) {
      this.ctx.gl.deleteTexture(t);
      this.lutTextures.delete(id);
    }
  }

  /* ------------------------------------------------------------------ */

  render(project: Project, time: number, provider: FrameProvider, opts: RenderOptions): FBO | null {
    const t0 = performance.now();
    const { ctx } = this;
    const gl = ctx.gl;
    this.frameCounter++;
    this.frameStats = { clips: 0, passes: 0 };
    const W = opts.width, H = opts.height;
    this.projectSize = { w: project.settings.width, h: project.settings.height };
    ctx.releaseAll();

    let out = ctx.acquireFBO(W, H);
    ctx.bind(out);
    const bg = hexToRgb(project.settings.background || '#000000');
    ctx.clear(bg.r, bg.g, bg.b, 1);

    // Iterate tracks bottom → top (tracks array is top → bottom). Audio tracks skipped.
    for (let ti = project.tracks.length - 1; ti >= 0; ti--) {
      const track = project.tracks[ti];
      if (track.kind === 'audio' || track.hidden) continue;
      const items = this.visibleItems(track, time);
      for (const item of items) {
        if (item.kind === 'clip') {
          const layer = this.renderClipLayer(project, item.clip, time, provider, W, H, opts);
          if (layer) {
            out = this.compositeLayer(out, layer, item.clip, time - item.clip.start, W, H);
            ctx.release(layer);
          }
        } else {
          // transition between a and b
          const la = this.renderClipLayer(project, item.a, time, provider, W, H, opts, true);
          const lb = this.renderClipLayer(project, item.b, time, provider, W, H, opts, true);
          const fa = la ? this.flatten(la, item.a, time - item.a.start, W, H) : null;
          const fb = lb ? this.flatten(lb, item.b, time - item.b.start, W, H) : null;
          ctx.release(la);
          ctx.release(lb);
          const mixed = this.renderTransition(fa, fb, item.type, item.params, item.progress, W, H);
          ctx.release(fa);
          ctx.release(fb);
          if (mixed) {
            out = this.compositeFlat(out, mixed, W, H);
            ctx.release(mixed);
          }
        }
        this.frameStats.clips++;
      }
    }

    if (opts.toCanvas !== false) {
      // blit to canvas
      ctx.bind(null, this.canvas.width, this.canvas.height);
      const p = this.prog('copy', COPY_FRAG);
      ctx.use(p);
      ctx.tex(p, 'u_tex', 0, out.tex);
      ctx.u1f(p, 'u_flipY', 1);
      ctx.draw();
    }
    this.gcTextures();
    this.lastFrameMs = performance.now() - t0;
    gl.flush();
    return out;
  }

  /** Items to draw on a track at time: clips, or transitions (pairs) when inside a transition window. */
  private visibleItems(track: Track, time: number): Array<{ kind: 'clip'; clip: VisualClip } | { kind: 'transition'; a: VisualClip; b: VisualClip; type: string; params: Record<string, number>; progress: number }> {
    const clips = track.clips as VisualClip[];
    const out: ReturnType<Renderer['visibleItems']> = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const end = c.start + c.duration;
      // transition with the next clip?
      const next = clips[i + 1];
      const tr = c.transitionOut || (next && next.start - end < 1e-3 ? next.transitionIn : null);
      if (next && tr && next.start - end < 1e-3) {
        const d = Math.min(tr.duration, c.duration, next.duration);
        const t0 = end - d / 2, t1 = end + d / 2;
        if (time >= t0 && time < t1) {
          out.push({ kind: 'transition', a: c, b: next, type: tr.type, params: tr.params, progress: (time - t0) / d });
          i++; // skip next (it's part of the transition)
          continue;
        }
      }
      const prev = clips[i - 1];
      const trIn = c.transitionIn || (prev && c.start - (prev.start + prev.duration) < 1e-3 ? prev.transitionOut : null);
      if (prev && trIn && c.start - (prev.start + prev.duration) < 1e-3) {
        const d = Math.min(trIn.duration, c.duration, prev.duration);
        if (time < c.start + d / 2 && time >= c.start - d / 2) continue; // handled as transition from prev
      }
      if (time >= c.start && time < end) out.push({ kind: 'clip', clip: c });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */

  private sourceFor(project: Project, clip: VisualClip, time: number, provider: FrameProvider, W: number, H: number, extend: boolean): { tex: WebGLTexture; width: number; height: number; frame?: FrameSource } | null {
    const rel = time - clip.start;
    switch (clip.kind) {
      case 'video': {
        const vc = clip as VideoClip;
        const relClamped = extend ? Math.max(0, Math.min(vc.duration, rel)) : rel;
        const srcT = vc.mediaIn + timelineToSourceOffset(vc, relClamped);
        const f = provider.videoFrame(vc, srcT);
        if (!f) return null;
        return { tex: this.texFor(`clip_${clip.id}`, f.source, f.version, f.width, f.height), width: f.width, height: f.height, frame: f };
      }
      case 'image': {
        const f = provider.imageFrame((clip as any).mediaId);
        if (!f) return null;
        return { tex: this.texFor(`img_${(clip as any).mediaId}`, f.source, f.version, f.width, f.height), width: f.width, height: f.height, frame: f };
      }
      case 'color': {
        const c = hexToRgb((clip as any).color);
        const key = `color_${(clip as any).color}`;
        let e = this.textures.get(key);
        if (!e) {
          const tex = this.ctx.createTexture(this.ctx.gl.NEAREST);
          this.ctx.uploadData(tex, 1, 1, new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]));
          e = { tex, version: 0, width: 1, height: 1, lastUsed: this.frameCounter };
          this.textures.set(key, e);
        }
        e.lastUsed = this.frameCounter;
        return { tex: e.tex, width: W, height: H };
      }
      case 'text':
      case 'caption': {
        const tc = clip as TextClip | CaptionClip;
        const scale = Math.min(1, Math.max(0.25, W / project.settings.width));
        const key = `text_${clip.id}`;
        const styleHash = hashString(JSON.stringify([tc.text, tc.style, tc.animation, (tc as CaptionClip).words, (tc as CaptionClip).caption]));
        const res = renderText(tc, rel, project.settings.width, project.settings.height, scale, key);
        const version = res.animated ? styleHash ^ Math.round(rel * 1000) : styleHash;
        return { tex: this.texFor(key, res.canvas as any, version, res.width, res.height), width: res.width / scale, height: res.height / scale };
      }
      case 'sticker': {
        const sc = clip as StickerClip;
        const key = `stk_${clip.id}`;
        const res = renderSticker(sc, rel, project.settings.width, provider, key);
        if (!res) return null;
        return { tex: this.texFor(key, res.canvas as any, res.version, res.width, res.height), width: res.width / res.scale, height: res.height / res.scale };
      }
    }
    return null;
  }

  /**
   * Render a clip into an FBO (in source pixel space, capped to output size), applying
   * color pipeline, effects and matte. Returned FBO has the clip's aspect ratio.
   */
  private renderClipLayer(project: Project, clip: VisualClip, time: number, provider: FrameProvider, W: number, H: number, opts: RenderOptions, extend = false): FBO | null {
    const ctx = this.ctx;
    const src = this.sourceFor(project, clip, time, provider, W, H, extend);
    if (!src) return null;
    const rel = time - clip.start;
    // Working resolution: source size capped so that the longer side <= max(W,H)*1.0
    const cap = Math.max(W, H);
    const sc = Math.min(1, cap / Math.max(src.width, src.height, 1));
    const lw = Math.max(1, Math.round(src.width * sc)), lh = Math.max(1, Math.round(src.height * sc));

    let cur: FBO | null = null;
    let curTex = src.tex;
    const passes: Array<(inTex: WebGLTexture, out: FBO) => void> = [];

    // 1. color pipeline
    const gradeActive = this.gradeActive(clip.grade, rel);
    if (gradeActive) passes.push((inTex, out) => this.adjustPass(inTex, out, clip.grade, rel, lw, lh));
    // 2. effects
    for (const fx of clip.effects) {
      if (!fx.enabled) continue;
      const def = getEffect(fx.type);
      const prog = this.effectProgram(fx.type);
      if (!def || !prog) continue;
      passes.push((inTex, out) => {
        ctx.bind(out);
        ctx.use(prog);
        ctx.tex(prog, 'u_tex', 0, inTex);
        ctx.u2f(prog, 'u_res', lw, lh);
        ctx.u1f(prog, 'u_time', rel);
        ctx.u1f(prog, 'u_progress', clip.duration > 0 ? rel / clip.duration : 0);
        ctx.u1f(prog, 'u_seed', hashString(clip.id) % 1000);
        const p = new Float32Array(12);
        def.params.forEach((pd, i) => (p[i] = num(fx.params[pd.key], rel, pd.default)));
        ctx.u1fv(prog, 'u_p', p);
        ctx.draw();
      });
    }
    // 3. matte
    const seg = clip.segmentation?.enabled && provider.segmentationMask && src.frame ? provider.segmentationMask(clip, src.frame) : null;
    const chromaOn = !!clip.chroma?.enabled;
    const maskOn = !!clip.mask?.enabled;
    if (chromaOn || maskOn || seg) passes.push((inTex, out) => this.mattePass(inTex, out, clip, rel, lw, lh, seg, provider));
    // 4. stabilization translation (video only)
    if (clip.kind === 'video') {
      const st = (clip as VideoClip).stabilization;
      if (st.enabled && st.analysis && st.analysis.smoothed.length) {
        passes.push((inTex, out) => {
          const vc = clip as VideoClip;
          const srcT = vc.mediaIn + timelineToSourceOffset(vc, rel);
          const fi = Math.min(st.analysis!.smoothed.length / 2 - 1, Math.max(0, Math.round(srcT * st.analysis!.fps)));
          const dx = st.analysis!.smoothed[fi * 2] / src.width, dy = st.analysis!.smoothed[fi * 2 + 1] / src.height;
          const z = st.cropZoom;
          // inverse: output uv -> input uv = (uv-0.5)/z + 0.5 + (dx,dy)
          const inv = [1 / z, 0, 0, 0, 1 / z, 0, 0.5 - 0.5 / z + dx, 0.5 - 0.5 / z - dy, 1];
          ctx.bind(out);
          const p = this.prog('transform', TRANSFORM_FRAG);
          ctx.use(p);
          ctx.tex(p, 'u_tex', 0, inTex);
          ctx.umat3(p, 'u_inv', inv);
          ctx.draw();
        });
      }
    }

    const kx = W / project.settings.width, ky = H / project.settings.height;
    if (passes.length === 0) {
      // copy into an FBO so downstream can treat uniformly
      cur = ctx.acquireFBO(lw, lh);
      this.copy(curTex, cur);
      this.nativeSize.set(cur, { w: src.width * kx, h: src.height * ky });
      return cur;
    }
    for (const pass of passes) {
      const out = ctx.acquireFBO(lw, lh);
      pass(curTex, out);
      this.frameStats.passes++;
      if (cur) ctx.release(cur);
      cur = out;
      curTex = out.tex;
    }
    this.nativeSize.set(cur!, { w: src.width * kx, h: src.height * ky });
    return cur;
  }

  private copy(tex: WebGLTexture, out: FBO, flipY = false) {
    const ctx = this.ctx;
    ctx.bind(out);
    const p = this.prog('copy', COPY_FRAG);
    ctx.use(p);
    ctx.tex(p, 'u_tex', 0, tex);
    ctx.u1f(p, 'u_flipY', flipY ? 1 : 0);
    ctx.draw();
  }

  private gradeActive(g: ColorGrade, t: number): boolean {
    for (const k of Object.keys(g.adjustments)) if (Math.abs(num((g.adjustments as any)[k], t, 0)) > 1e-4) return true;
    if (g.lutId && g.lutId !== 'none' && (g.lutIntensity ?? 1) > 0) return true;
    if (g.curves && !(isDefaultCurve(g.curves.master) && isDefaultCurve(g.curves.red) && isDefaultCurve(g.curves.green) && isDefaultCurve(g.curves.blue))) return true;
    if (g.hsl && Object.values(g.hsl).some((b) => b.hue || b.saturation || b.luminance)) return true;
    if (g.wheels && Object.values(g.wheels).some((w) => w.r || w.g || w.b || w.lum)) return true;
    if (g.whiteBalance && (g.whiteBalance.temperature || g.whiteBalance.tint)) return true;
    return false;
  }

  private adjustPass(inTex: WebGLTexture, out: FBO, g: ColorGrade, t: number, w: number, h: number) {
    const ctx = this.ctx;
    const gl = ctx.gl;
    ctx.bind(out);
    const p = this.prog('adjust', ADJUST_FRAG);
    ctx.use(p);
    ctx.tex(p, 'u_tex', 0, inTex);
    ctx.u2f(p, 'u_res', w, h);
    ctx.u1f(p, 'u_time', t);
    const a = g.adjustments;
    const v = (k: string) => num((a as any)[k], t, 0) / 100;
    ctx.u1f(p, 'u_brightness', v('brightness'));
    ctx.u1f(p, 'u_contrast', v('contrast'));
    ctx.u1f(p, 'u_saturation', v('saturation'));
    ctx.u1f(p, 'u_exposure', v('exposure') * 2);
    ctx.u1f(p, 'u_highlights', v('highlights'));
    ctx.u1f(p, 'u_shadows', v('shadows'));
    ctx.u1f(p, 'u_temperature', v('temperature') + (g.whiteBalance?.temperature || 0) / 100);
    ctx.u1f(p, 'u_tint', v('tint') + (g.whiteBalance?.tint || 0) / 100);
    ctx.u1f(p, 'u_sharpness', Math.max(0, v('sharpness')));
    ctx.u1f(p, 'u_clarity', v('clarity'));
    ctx.u1f(p, 'u_vibrance', v('vibrance'));
    ctx.u1f(p, 'u_fade', Math.max(0, v('fade')));
    ctx.u1f(p, 'u_vignette', v('vignette'));
    ctx.u1f(p, 'u_grain', Math.max(0, v('grain')));
    ctx.u1f(p, 'u_whites', v('whites'));
    ctx.u1f(p, 'u_blacks', v('blacks'));
    // curves
    let useCurves = 0;
    if (g.curves && !(isDefaultCurve(g.curves.master) && isDefaultCurve(g.curves.red) && isDefaultCurve(g.curves.green) && isDefaultCurve(g.curves.blue))) {
      useCurves = 1;
      const key = JSON.stringify(g.curves);
      if (key !== this.curveKey) {
        ctx.uploadData(this.curveTex, 256, 1, curvesTextureData(g.curves));
        this.curveKey = key;
      }
    }
    ctx.u1f(p, 'u_useCurves', useCurves);
    ctx.tex(p, 'u_curves', 1, useCurves ? this.curveTex : this.whiteTex);
    // HSL
    const hsl = new Float32Array(24);
    let useHSL = 0;
    if (g.hsl) {
      const order = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
      order.forEach((k, i) => {
        const b = g.hsl![k];
        hsl[i * 3] = b.hue / 100;
        hsl[i * 3 + 1] = b.saturation / 100;
        hsl[i * 3 + 2] = b.luminance / 100;
        if (b.hue || b.saturation || b.luminance) useHSL = 1;
      });
    }
    ctx.u1f(p, 'u_useHSL', useHSL);
    ctx.u1fv(p, 'u_hsl', hsl);
    // wheels
    let useWheels = 0;
    if (g.wheels) {
      const { shadows: s, midtones: m, highlights: hh } = g.wheels;
      if (s.r || s.g || s.b || s.lum || m.r || m.g || m.b || m.lum || hh.r || hh.g || hh.b || hh.lum) useWheels = 1;
      ctx.u4f(p, 'u_wheelS', s.r, s.g, s.b, s.lum);
      ctx.u4f(p, 'u_wheelM', m.r, m.g, m.b, m.lum);
      ctx.u4f(p, 'u_wheelH', hh.r, hh.g, hh.b, hh.lum);
    }
    ctx.u1f(p, 'u_useWheels', useWheels);
    // LUT
    let lutAmount = 0;
    let lutTex: WebGLTexture | null = null;
    if (g.lutId && g.lutId !== 'none') {
      lutTex = this.lutTexture(g.lutId);
      if (lutTex) lutAmount = g.lutIntensity ?? 1;
    }
    ctx.u1f(p, 'u_lutAmount', lutAmount);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, lutTex || this.identityLut);
    ctx.u1i(p, 'u_lut', 2);
    ctx.draw();
  }

  private segTextures = new Map<string, { tex: WebGLTexture; version: number }>();

  private mattePass(inTex: WebGLTexture, out: FBO, clip: VisualClip, t: number, w: number, h: number, seg: { data: Uint8Array; width: number; height: number; version: number } | null, provider: FrameProvider) {
    const ctx = this.ctx;
    const gl = ctx.gl;
    ctx.bind(out);
    const p = this.prog('matte', MATTE_FRAG);
    ctx.use(p);
    ctx.tex(p, 'u_tex', 0, inTex);
    ctx.u2f(p, 'u_res', w, h);
    ctx.u1f(p, 'u_aspect', w / h);
    const ch = clip.chroma;
    ctx.u1f(p, 'u_chroma', ch?.enabled ? 1 : 0);
    if (ch?.enabled) {
      ctx.u3f(p, 'u_keyColor', ch.color.r, ch.color.g, ch.color.b);
      ctx.u1f(p, 'u_strength', num(ch.strength, t, 0.4));
      ctx.u1f(p, 'u_smooth', num(ch.smoothness, t, 0.1));
      ctx.u1f(p, 'u_spill', num(ch.spill, t, 0.5));
      ctx.u1f(p, 'u_edge', num(ch.edgeSoftness, t, 0.02));
      ctx.u1f(p, 'u_shadow', num(ch.shadowPreservation, t, 0.3));
    }
    // segmentation
    ctx.u1f(p, 'u_useSeg', seg ? 1 : 0);
    if (seg) {
      let e = this.segTextures.get(clip.id);
      if (!e) {
        const tex = ctx.createTexture(gl.LINEAR);
        e = { tex, version: -1 };
        this.segTextures.set(clip.id, e);
      }
      if (e.version !== seg.version) {
        gl.bindTexture(gl.TEXTURE_2D, e.tex);
        ctx.uploadData(e.tex, seg.width, seg.height, seg.data, 'r8'); // top-down, same as the frame
        e.version = seg.version;
      }
      ctx.tex(p, 'u_segMask', 1, e.tex);
      const s = clip.segmentation!;
      ctx.u1f(p, 'u_segBlur', s.background === 'blur' ? s.blur : 0);
      const col = hexToRgb(s.color || '#000000');
      ctx.u4f(p, 'u_segColor', col.r, col.g, col.b, s.background === 'color' ? 1 : 0);
      let useImg = 0;
      if (s.background === 'image' && s.imageMediaId) {
        const f = provider.imageFrame(s.imageMediaId);
        if (f) {
          ctx.tex(p, 'u_segImage', 3, this.texFor(`img_${s.imageMediaId}`, f.source, f.version, f.width, f.height));
          useImg = 1;
        }
      }
      ctx.u1f(p, 'u_useSegImage', useImg);
      if (!useImg) ctx.tex(p, 'u_segImage', 3, this.blackTex);
    } else {
      ctx.tex(p, 'u_segMask', 1, this.whiteTex);
      ctx.tex(p, 'u_segImage', 3, this.blackTex);
    }
    // mask
    const m: Mask | null = clip.mask;
    ctx.u1f(p, 'u_maskOn', m?.enabled ? 1 : 0);
    if (m?.enabled) {
      const c = vec(m.center, t), s = vec(m.size, t, { x: 0.5, y: 0.5 });
      ctx.u1i(p, 'u_maskShape', MASK_INDEX[m.shape] ?? 0);
      ctx.u2f(p, 'u_maskCenter', c.x, c.y);
      ctx.u2f(p, 'u_maskSize', s.x, s.y);
      ctx.u1f(p, 'u_maskRot', (num(m.rotation, t) * Math.PI) / 180);
      ctx.u1f(p, 'u_feather', num(m.feather, t, 0.05));
      ctx.u1f(p, 'u_maskOpacity', num(m.opacity, t, 1));
      ctx.u1f(p, 'u_roundness', num(m.roundness, t, 0));
      ctx.u1f(p, 'u_invert', m.invert ? 1 : 0);
      const pts = (m.points || []).slice(0, 64);
      const arr = new Float32Array(128);
      pts.forEach((pt, i) => {
        arr[i * 2] = pt.x;
        arr[i * 2 + 1] = pt.y;
      });
      ctx.u2fv(p, 'u_maskPts', arr);
      ctx.u1i(p, 'u_maskPtCount', pts.length);
    }
    ctx.draw();
  }

  private projectSize = { w: 0, h: 0 };

  /** Compute the 3x3 matrix mapping output uv → layer uv for the clip transform. */
  private invTransform(clip: VisualClip, t: number, layerW: number, layerH: number, W: number, H: number, projW: number, projH: number): Float32Array {
    const pos = vec(clip.transform.position, t);
    const sc = vec(clip.transform.scale, t, { x: 1, y: 1 });
    const rot = (num(clip.transform.rotation, t) * Math.PI) / 180;
    // Fit layer into project frame (contain) at scale 1
    const fit = Math.min(projW / layerW, projH / layerH);
    const dw = layerW * fit * sc.x, dh = layerH * fit * sc.y; // in project px
    // sticker/text: at scale 1 they are drawn at native size (not fit)
    const isNative = clip.kind === 'text' || clip.kind === 'caption' || clip.kind === 'sticker';
    const w = isNative ? layerW * sc.x : dw, h = isNative ? layerH * sc.y : dh;
    // position is stored in project pixels; the output may be rendered at a different resolution
    const pk = projW / (this.projectSize.w || projW);
    const cx = projW / 2 + pos.x * pk + clip.transform.anchor.x * w;
    const cy = projH / 2 + pos.y * pk + clip.transform.anchor.y * h;
    // forward: layer uv (0..1) -> project px: p = R * ((uv-0.5) * (w,h)) + (cx,cy); output uv = p / (projW, projH)
    // inverse: uv = R^-1 * (out*proj - c) / (w,h) + 0.5
    const cos = Math.cos(rot), sin = Math.sin(rot);
    // out uv -> px
    const sxW = projW, syH = projH;
    // matrix M: uvL = A * (outUV) + b
    // d = (outUV * proj - c); r = R^-1 d = [cos sin; -sin cos] d ; uvL = r / (w,h) + 0.5
    const a00 = (cos * sxW) / w, a01 = (sin * syH) / w;
    const a10 = (-sin * sxW) / h, a11 = (cos * syH) / h;
    const b0 = (-(cos * cx + sin * cy)) / w + 0.5;
    const b1 = (-(-sin * cx + cos * cy)) / h + 0.5;
    void W;
    void H;
    // column-major mat3
    return new Float32Array([a00, a10, 0, a01, a11, 0, b0, b1, 1]);
  }

  private compositeLayer(backdrop: FBO, layer: FBO, clip: VisualClip, t: number, W: number, H: number): FBO {
    const ctx = this.ctx;
    const out = ctx.acquireFBO(W, H);
    ctx.bind(out);
    const p = this.prog('composite', COMPOSITE_FRAG);
    ctx.use(p);
    ctx.tex(p, 'u_backdrop', 0, backdrop.tex);
    ctx.tex(p, 'u_layer', 1, layer.tex);
    const projW = W, projH = H;
    // layer dims in "project space": layers are rendered at capped resolution, but aspect is preserved,
    // so we use layer w/h directly for fit computations (only the ratio matters).
    ctx.umat3(p, 'u_invTransform', this.invTransformForLayer(clip, t, layer, projW, projH));
    ctx.u4f(p, 'u_crop', clip.crop.left, clip.crop.top, clip.crop.right, clip.crop.bottom);
    ctx.u1f(p, 'u_opacity', num(clip.transform.opacity, t, 1));
    ctx.u1i(p, 'u_blend', BLEND_INDEX[clip.blend] ?? 0);
    ctx.u2f(p, 'u_flip', clip.flipH ? 1 : 0, clip.flipV ? 1 : 0);
    ctx.draw();
    this.frameStats.passes++;
    ctx.release(backdrop);
    return out;
  }

  private invTransformForLayer(clip: VisualClip, t: number, layer: FBO, W: number, H: number) {
    // Text/sticker layers were rasterized at `scale` relative to project width; their native size
    // in project px is layer.width / scale. We stored that ratio via nativeScale.
    const native = this.nativeSize.get(layer) || { w: layer.width, h: layer.height };
    // project px are W,H of the *output*, so map native (project-space) sizes to output space
    return this.invTransform(clip, t, native.w, native.h, W, H, W, H);
  }

  /** Track the project-space size of layers (needed because text layers are native-sized). */
  private nativeSize = new WeakMap<FBO, { w: number; h: number }>();

  /** Flatten a clip layer into a full-frame FBO (transparent background) — used for transitions. */
  private flatten(layer: FBO, clip: VisualClip, t: number, W: number, H: number): FBO {
    const ctx = this.ctx;
    const empty = ctx.acquireFBO(W, H);
    ctx.bind(empty);
    ctx.clear(0, 0, 0, 0);
    return this.compositeLayer(empty, layer, clip, t, W, H);
  }

  private compositeFlat(backdrop: FBO, layer: FBO, W: number, H: number): FBO {
    const ctx = this.ctx;
    const out = ctx.acquireFBO(W, H);
    ctx.bind(out);
    const p = this.prog('composite', COMPOSITE_FRAG);
    ctx.use(p);
    ctx.tex(p, 'u_backdrop', 0, backdrop.tex);
    ctx.tex(p, 'u_layer', 1, layer.tex);
    ctx.umat3(p, 'u_invTransform', new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    ctx.u4f(p, 'u_crop', 0, 0, 0, 0);
    ctx.u1f(p, 'u_opacity', 1);
    ctx.u1i(p, 'u_blend', 0);
    ctx.u2f(p, 'u_flip', 0, 0);
    ctx.draw();
    ctx.release(backdrop);
    return out;
  }

  private renderTransition(a: FBO | null, b: FBO | null, type: string, params: Record<string, number>, progress: number, W: number, H: number): FBO | null {
    const ctx = this.ctx;
    const prog = this.transitionProgram(type) || this.transitionProgram('fade');
    if (!prog) return null;
    const def = getTransition(type) || getTransition('fade')!;
    const out = ctx.acquireFBO(W, H);
    ctx.bind(out);
    ctx.use(prog);
    ctx.tex(prog, 'u_from', 0, a ? a.tex : this.blackTex);
    ctx.tex(prog, 'u_to', 1, b ? b.tex : this.blackTex);
    ctx.u1f(prog, 'u_progress', Math.max(0, Math.min(1, progress)));
    ctx.u2f(prog, 'u_res', W, H);
    const p = new Float32Array(8);
    def.params.forEach((pd, i) => (p[i] = params[pd.key] ?? pd.default));
    ctx.u1fv(prog, 'u_p', p);
    ctx.draw();
    this.frameStats.passes++;
    return out;
  }

  /** Expose native-size registration for text/sticker layers. */
  registerNative(f: FBO, w: number, h: number) {
    this.nativeSize.set(f, { w, h });
  }

  /** Read back pixels of an FBO (RGBA, top-down). */
  readPixels(f: FBO): Uint8ClampedArray {
    const gl = this.ctx.gl;
    this.ctx.bind(f);
    const buf = new Uint8ClampedArray(f.width * f.height * 4);
    gl.readPixels(0, 0, f.width, f.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // FBOs are y-down (row 0 = top of frame), so no flip is needed for ImageData/VideoFrame consumers
    return buf;
  }

  dispose() {
    const gl = this.ctx.gl;
    for (const e of this.textures.values()) gl.deleteTexture(e.tex);
    for (const t of this.lutTextures.values()) gl.deleteTexture(t);
    this.textures.clear();
    this.ctx.dispose();
  }
}
