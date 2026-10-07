/**
 * Additional GPU effects (second batch). Same contract as effects.ts: one full-screen GLSL pass,
 * `vec4 effect(vec2 uv)` with u_p[0..11] parameters, u_time (clip seconds), u_progress, u_res, u_seed.
 * Textures are premultiplied — use texU()/premul() for colour math, tex() for pure sampling.
 */
import type { EffectDef, EffectParam, EffectCategory } from './effects';

const P = (key: string, label: string, min: number, max: number, def: number, step?: number): EffectParam => ({ key, label, min, max, default: def, step });
const fx = (id: string, name: string, category: EffectCategory, icon: string, params: EffectParam[], glsl: string, tags?: string[]): EffectDef => ({ id, name, category, icon, params, glsl, tags });

export const EFFECTS_EXTRA: EffectDef[] = [
  // ---------------- Glitch ----------------
  fx('blockglitch', 'Block Glitch', 'Glitch', '🧱', [P('amount', 'Amount', 0, 1, 0.5), P('size', 'Block size', 2, 32, 8, 1), P('speed', 'Speed', 0, 4, 1)],
    `vec4 effect(vec2 uv){ float t = floor(u_time * 8.0 * u_p[2]); vec2 b = floor(uv * u_p[1]); float r = hash12(b + t * 0.37 + u_seed);
      vec2 o = vec2(0.0); if (r > 1.0 - u_p[0] * 0.35) o = (vec2(hash12(b + 1.3 + t), hash12(b + 2.7 + t)) - 0.5) * 0.2 * u_p[0];
      vec4 c = tex(uv + o); if (r > 1.0 - u_p[0] * 0.08) c.rgb = c.rgb.gbr; return c; }`, ['digital', 'broken']),
  fx('screentear', 'Screen Tear', 'Glitch', '📺', [P('amount', 'Amount', 0, 1, 0.5), P('bands', 'Bands', 1, 8, 3, 1), P('speed', 'Speed', 0, 4, 1)],
    `vec4 effect(vec2 uv){ float t = u_time * u_p[2]; float o = 0.0;
      for (int i = 0; i < 8; i++) { if (float(i) >= u_p[1]) break; float y = fract(hash11(float(i) * 7.1 + u_seed) + t * (0.2 + 0.1 * float(i))); float h = 0.02 + 0.06 * hash11(float(i) * 3.3); if (abs(uv.y - y) < h) o += (hash11(float(i) + floor(t * 10.0)) - 0.5) * 0.3 * u_p[0]; }
      vec4 c = tex(uv + vec2(o, 0.0)); if (abs(o) > 0.001) { c.r = tex(uv + vec2(o * 1.5, 0.0)).r; } return c; }`, ['tear', 'vhs']),
  fx('interlace', 'Interlace', 'Glitch', '〰️', [P('amount', 'Amount', 0, 1, 0.6), P('offset', 'Field offset', 0, 1, 0.3), P('lines', 'Line height', 1, 8, 2, 1)],
    `vec4 effect(vec2 uv){ float line = floor(uv.y * u_res.y / u_p[2]); float odd = mod(line, 2.0); float o = odd * u_p[1] * 0.02 * sin(u_time * 30.0 + uv.y * 20.0);
      vec4 c = tex(uv + vec2(o, 0.0)); c.rgb *= 1.0 - odd * 0.35 * u_p[0]; return c; }`, ['tv', 'fields']),
  fx('pixelsort', 'Pixel Smear', 'Glitch', '🧪', [P('threshold', 'Threshold', 0, 1, 0.5), P('length', 'Length', 0, 1, 0.3), P('vertical', 'Vertical', 0, 1, 1, 1)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); float l = luma(unpremul(c).rgb); if (l < u_p[0]) return c;
      vec2 dir = u_p[2] > 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0); vec4 acc = vec4(0.0); float n = 0.0;
      for (int i = 0; i < 24; i++) { float f = float(i) / 24.0; vec2 p = uv - dir * f * u_p[1] * 0.4; vec4 s = tex(p); if (luma(unpremul(s).rgb) < u_p[0]) break; acc += s; n += 1.0; }
      return n > 0.0 ? acc / n : c; }`, ['sort', 'smear', 'datamosh']),
  fx('signaldrop', 'Signal Drop', 'Glitch', '📡', [P('amount', 'Amount', 0, 1, 0.5), P('rate', 'Rate', 0.2, 6, 2)],
    `vec4 effect(vec2 uv){ float t = floor(u_time * u_p[1] * 4.0); float drop = step(1.0 - u_p[0] * 0.3, hash11(t + u_seed)); float roll = drop * fract(u_time * 3.0) * 0.5;
      vec2 p = fract(uv + vec2(0.0, roll)); vec4 c = tex(p); float n = hash12(uv * u_res + t) ; c.rgb = mix(c.rgb, vec3(n) * c.a, drop * 0.5 + u_p[0] * 0.08 * n); c.rgb *= 1.0 - drop * 0.3; return c; }`, ['lost', 'static']),

  // ---------------- Retro ----------------
  fx('gameboy', 'Game Boy', 'Retro', '🎮', [P('pixels', 'Pixel size', 2, 16, 6, 1), P('amount', 'Amount', 0, 1, 1)],
    `vec4 effect(vec2 uv){ vec2 px = u_p[0] / u_res; vec2 q = (floor(uv / px) + 0.5) * px; vec4 c = texU(q); float l = luma(c.rgb); float s = floor(l * 3.999) / 3.0;
      vec3 pal = mix(mix(vec3(0.06, 0.22, 0.06), vec3(0.19, 0.38, 0.19), clamp(s * 3.0, 0.0, 1.0)), mix(vec3(0.55, 0.67, 0.06), vec3(0.61, 0.74, 0.06), clamp(s * 3.0 - 2.0, 0.0, 1.0)), step(0.5, s));
      c.rgb = mix(c.rgb, pal, u_p[1]); return premul(c); }`, ['nintendo', 'green', '8bit']),
  fx('dither', 'Ordered Dither', 'Retro', '▦', [P('levels', 'Levels', 2, 8, 2, 1), P('scale', 'Dot scale', 1, 6, 2, 1), P('amount', 'Amount', 0, 1, 1)],
    `float bayer(vec2 p){ p = floor(mod(p, 4.0)); float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
      int i = int(p.y) * 4 + int(p.x); float v = 0.0; for (int k = 0; k < 16; k++) if (k == i) v = m[k]; return (v + 0.5) / 16.0; }
    vec4 effect(vec2 uv){ vec4 c = texU(uv); float th = bayer(uv * u_res / u_p[1]); float lv = u_p[0] - 1.0; vec3 d = floor(c.rgb * lv + th) / lv; c.rgb = mix(c.rgb, d, u_p[2]); return premul(c); }`, ['bayer', 'pixel', '1bit']),
  fx('super8', 'Super 8', 'Retro', '🎞️', [P('amount', 'Amount', 0, 1, 0.7), P('jitter', 'Gate jitter', 0, 1, 0.4), P('grain', 'Grain', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ float fr = floor(u_time * 18.0); vec2 j = (vec2(hash11(fr), hash11(fr + 9.0)) - 0.5) * 0.006 * u_p[1]; vec4 c = texU(uv + j);
      vec3 w = c.rgb * vec3(1.12, 1.0, 0.8); w = mix(vec3(luma(w)), w, 0.85); w = pow(w, vec3(0.95)); float fl = 1.0 - 0.08 * hash11(fr + 3.0); w *= fl;
      float g = (hash12(uv * u_res + fr) - 0.5) * 0.25 * u_p[2]; w += g; w *= 1.0 - 0.5 * smoothstep(0.4, 1.0, length(uv - 0.5)) ; c.rgb = mix(c.rgb, w, u_p[0]); return premul(c); }`, ['8mm', 'home video', 'vintage']),
  fx('ntsc', 'NTSC Bleed', 'Retro', '📼', [P('bleed', 'Color bleed', 0, 1, 0.5), P('amount', 'Amount', 0, 1, 1)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 acc = vec3(0.0); float n = 0.0; for (int i = -6; i <= 6; i++) { float f = float(i); vec3 s = texU(uv + vec2(f * u_p[0] * 2.5 / u_res.x, 0.0)).rgb; acc += s; n += 1.0; }
      vec3 bl = acc / n; float y = luma(c.rgb); vec3 chroma = bl - vec3(luma(bl)); vec3 o = vec3(y) + chroma * 1.1; c.rgb = mix(c.rgb, o, u_p[1]); return premul(c); }`, ['tv', 'composite']),
  fx('crossprocess', 'Cross Process', 'Retro', '🧫', [P('amount', 'Amount', 0, 1, 0.8)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 o; o.r = smoothstep(0.0, 1.0, c.r) * 1.05; o.g = pow(c.g, 0.9); o.b = c.b * 0.8 + 0.1 * (1.0 - c.b); o = mix(o, o * vec3(1.05, 1.0, 0.9) + vec3(0.0, 0.02, -0.03), 0.5); c.rgb = mix(c.rgb, clamp(o, 0.0, 1.0), u_p[0]); return premul(c); }`, ['film', 'xpro', 'lomo']),
  fx('polaroid', 'Polaroid', 'Retro', '🖼️', [P('amount', 'Amount', 0, 1, 0.8), P('frame', 'Frame', 0, 1, 0, 1)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 o = c.rgb * 0.9 + 0.08; o = mix(vec3(luma(o)), o, 0.8); o *= vec3(1.03, 1.0, 0.92); o = o * 0.9 + 0.05 * vec3(0.9, 0.85, 0.7);
      c.rgb = mix(c.rgb, o, u_p[0]); if (u_p[1] > 0.5) { float b = 0.04; float bb = 0.14; if (uv.x < b || uv.x > 1.0 - b || uv.y < bb || uv.y > 1.0 - b) return vec4(0.96, 0.95, 0.92, 1.0); } return premul(c); }`, ['instant', 'photo']),

  // ---------------- Cinematic ----------------
  fx('bloom', 'Bloom', 'Cinematic', '✨', [P('threshold', 'Threshold', 0, 1, 0.6), P('radius', 'Radius', 0, 1, 0.4), P('intensity', 'Intensity', 0, 2, 0.8)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec3 acc = vec3(0.0); float n = 0.0; float r = u_p[1] * 0.03;
      for (int i = 0; i < 16; i++) { float a = float(i) * 0.3927; for (int k = 1; k <= 2; k++) { vec2 o = vec2(cos(a), sin(a)) * r * float(k) * 0.5; vec3 s = tex(uv + o).rgb; acc += max(s - u_p[0], 0.0); n += 1.0; } }
      c.rgb += acc / n * u_p[2] * 2.0; return c; }`, ['glow', 'soft', 'highlights']),
  fx('promist', 'Pro-Mist Diffusion', 'Cinematic', '🌫️', [P('amount', 'Amount', 0, 1, 0.5), P('radius', 'Radius', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec4 acc = vec4(0.0); float r = u_p[1] * 0.02; for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; acc += tex(uv + vec2(cos(a), sin(a)) * r); acc += tex(uv + vec2(cos(a), sin(a)) * r * 0.5); } acc /= 24.0;
      vec3 hl = max(acc.rgb - 0.35, 0.0); c.rgb = mix(c.rgb, max(c.rgb, acc.rgb) * 0.9 + hl * 0.5, u_p[0] * 0.8); return c; }`, ['halation', 'dreamy', 'filter']),
  fx('dayfornight', 'Day for Night', 'Cinematic', '🌙', [P('amount', 'Amount', 0, 1, 0.8), P('blue', 'Blue cast', 0, 1, 0.6)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 o = c.rgb * 0.45; float l = luma(o); o = mix(vec3(l), o, 0.5); o = mix(o, o * vec3(0.6, 0.75, 1.2) + vec3(0.0, 0.01, 0.05), u_p[1]); o = pow(o, vec3(1.15)); c.rgb = mix(c.rgb, clamp(o, 0.0, 1.0), u_p[0]); return premul(c); }`, ['night', 'moonlight', 'dark']),
  fx('goldenhour', 'Golden Hour', 'Cinematic', '🌇', [P('amount', 'Amount', 0, 1, 0.7), P('warmth', 'Warmth', 0, 1, 0.6)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 warm = c.rgb * mix(vec3(1.0), vec3(1.18, 1.02, 0.78), u_p[1]); warm += vec3(0.08, 0.04, 0.0) * smoothstep(0.3, 1.0, l) * u_p[1]; warm = mix(warm, warm * vec3(0.95, 0.9, 1.0), 1.0 - l);
      float sun = smoothstep(1.1, 0.2, length(uv - vec2(0.8, 0.15))); warm += vec3(0.25, 0.15, 0.03) * sun * u_p[1]; c.rgb = mix(c.rgb, clamp(warm, 0.0, 1.0), u_p[0]); return premul(c); }`, ['sunset', 'warm', 'glow']),
  fx('moody', 'Moody Matte', 'Cinematic', '🎭', [P('amount', 'Amount', 0, 1, 0.8), P('lift', 'Black lift', 0, 0.3, 0.08), P('desat', 'Desaturate', 0, 1, 0.35)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 o = c.rgb * (1.0 - u_p[1]) + u_p[1]; o = mix(o, vec3(luma(o)), u_p[2] * (1.0 - luma(o))); o = mix(o, o * vec3(0.95, 1.0, 1.08), 0.5); o = pow(o, vec3(1.05)); c.rgb = mix(c.rgb, o, u_p[0]); return premul(c); }`, ['faded', 'matte', 'grade']),
  fx('filmburn', 'Film Burn', 'Cinematic', '🔥', [P('amount', 'Amount', 0, 1, 0.7), P('speed', 'Speed', 0, 3, 0.6)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); float t = u_time * u_p[1]; float n = fbm(uv * 2.0 + vec2(t * 0.7, -t * 0.3)); float edge = smoothstep(0.35, 0.8, n + (uv.x - 0.5) * 0.4 * sin(t)); vec3 burn = mix(vec3(1.0, 0.45, 0.05), vec3(1.0, 0.85, 0.5), n);
      c.rgb += burn * edge * u_p[0] * 0.9 * c.a; c.rgb = mix(c.rgb, c.rgb * 1.3, edge * u_p[0] * 0.3); return c; }`, ['light leak', 'overlay', 'film']),
  fx('cinemagrain', 'Fine Grain', 'Cinematic', '🎬', [P('amount', 'Amount', 0, 1, 0.35), P('size', 'Size', 1, 4, 1.5), P('shadows', 'In shadows', 0, 1, 0.7)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec2 g = floor(uv * u_res / u_p[1]); float n = hash12(g + fract(u_time * 7.0) * 100.0 + u_seed) - 0.5; float l = luma(c.rgb); float w = mix(1.0, 1.0 - l, u_p[2]); c.rgb += n * 0.3 * u_p[0] * w; return premul(c); }`, ['noise', 'film', 'texture']),

  // ---------------- Blur ----------------
  fx('directionalblur', 'Directional Blur', 'Blur', '➡️', [P('amount', 'Amount', 0, 1, 0.3), P('angle', 'Angle', 0, 360, 0, 1)],
    `vec4 effect(vec2 uv){ float a = radians(u_p[1]); vec2 d = vec2(cos(a), sin(a)) * u_p[0] * 0.05; vec4 acc = vec4(0.0); for (int i = -8; i <= 8; i++) acc += tex(uv + d * float(i) / 8.0); return acc / 17.0; }`, ['motion', 'streak']),
  fx('bokehblur', 'Bokeh Blur', 'Blur', '🔘', [P('radius', 'Radius', 0, 1, 0.4), P('highlights', 'Highlight boost', 0, 2, 1)],
    `vec4 effect(vec2 uv){ float r = u_p[0] * 0.03; vec4 acc = vec4(0.0); float wsum = 0.0;
      for (int ring = 1; ring <= 3; ring++) { for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236 + float(ring) * 0.2; vec2 o = vec2(cos(a), sin(a)) * r * float(ring) / 3.0; vec4 s = tex(uv + o); float w = 1.0 + pow(luma(s.rgb), 4.0) * u_p[1] * 8.0; acc += s * w; wsum += w; } }
      vec4 c = tex(uv); float w0 = 1.0 + pow(luma(c.rgb), 4.0) * u_p[1] * 8.0; return (acc + c * w0) / (wsum + w0); }`, ['lens', 'depth', 'disc']),
  fx('edgeblur', 'Edge Blur', 'Blur', '🫧', [P('amount', 'Amount', 0, 1, 0.5), P('size', 'Clear area', 0.1, 1, 0.55), P('roundness', 'Roundness', 0, 1, 1)],
    `vec4 effect(vec2 uv){ vec2 d = abs(uv - 0.5) * 2.0; float dist = mix(max(d.x, d.y), length(d), u_p[2]); float m = smoothstep(u_p[1], 1.0, dist) * u_p[0]; float r = m * 0.03; vec4 acc = vec4(0.0);
      for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; acc += tex(uv + vec2(cos(a), sin(a)) * r); } acc /= 12.0; return mix(tex(uv), acc, step(0.001, m)); }`, ['vignette', 'focus']),
  fx('smartblur', 'Surface Blur', 'Blur', '🧴', [P('amount', 'Amount', 0, 1, 0.5), P('threshold', 'Threshold', 0, 1, 0.2)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec4 acc = c; float n = 1.0; float r = u_p[0] * 0.012; for (int i = 0; i < 16; i++) { float a = float(i) * 0.3927; vec4 s = tex(uv + vec2(cos(a), sin(a)) * r * (0.5 + 0.5 * mod(float(i), 2.0))); float d = distance(s.rgb, c.rgb); float w = 1.0 - smoothstep(0.0, u_p[1] + 0.001, d); acc += s * w; n += w; } return acc / n; }`, ['skin', 'smooth', 'denoise']),

  // ---------------- Motion ----------------
  fx('bounce', 'Bounce', 'Motion', '🏀', [P('height', 'Height', 0, 1, 0.3), P('rate', 'Rate', 0.2, 4, 1), P('squash', 'Squash', 0, 1, 0.3)],
    `vec4 effect(vec2 uv){ float ph = fract(u_time * u_p[1]); float y = abs(sin(ph * 3.14159)) ; float sq = 1.0 + u_p[2] * 0.3 * (1.0 - y) * smoothstep(0.2, 0.0, y); vec2 p = uv; p.y = (p.y - 1.0) / (1.0 / sq) + 1.0; p.x = (p.x - 0.5) * sq + 0.5; p.y += y * u_p[0] * 0.3; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0); return tex(p); }`, ['jump', 'fun']),
  fx('jitter', 'Jitter', 'Motion', '🫨', [P('amount', 'Amount', 0, 1, 0.3), P('rate', 'Rate', 1, 30, 12, 1)],
    `vec4 effect(vec2 uv){ float f = floor(u_time * u_p[1]); vec2 o = (vec2(hash11(f + u_seed), hash11(f + 17.0 + u_seed)) - 0.5) * 0.06 * u_p[0]; vec2 p = uv + o; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0); return tex(p); }`, ['nervous', 'stop motion']),
  fx('swing', 'Swing', 'Motion', '🪀', [P('angle', 'Angle', 0, 45, 8, 1), P('rate', 'Rate', 0.1, 4, 0.8), P('pivot', 'Pivot Y', 0, 1, 0)],
    `vec4 effect(vec2 uv){ float a = radians(u_p[0]) * sin(u_time * u_p[1] * 6.2831); vec2 piv = vec2(0.5, u_p[2]); vec2 d = uv - piv; d.x *= u_res.x / u_res.y; float cs = cos(a), sn = sin(a); d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs); d.x /= u_res.x / u_res.y; vec2 p = d + piv; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0); return tex(p); }`, ['pendulum', 'rotate']),
  fx('earthquake', 'Earthquake', 'Motion', '🌋', [P('amount', 'Amount', 0, 1, 0.6), P('rate', 'Rate', 5, 40, 20, 1), P('blur', 'Blur', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ float f = floor(u_time * u_p[1]); vec2 o = (vec2(hash11(f + u_seed), hash11(f + 31.0 + u_seed)) - 0.5) * 0.08 * u_p[0]; float z = 1.0 + 0.04 * u_p[0]; vec2 p = (uv - 0.5) / z + 0.5 + o;
      vec4 acc = vec4(0.0); for (int i = 0; i < 5; i++) { acc += tex(p + o * float(i - 2) * 0.25 * u_p[2]); } vec4 c = acc / 5.0; c.r = tex(p + o * 0.3).r; return c; }`, ['shake', 'impact', 'violent']),
  fx('rollingshutter', 'Wobble', 'Motion', '🫠', [P('amount', 'Amount', 0, 1, 0.4), P('rate', 'Rate', 0.5, 10, 3), P('freq', 'Frequency', 1, 20, 6)],
    `vec4 effect(vec2 uv){ float o = sin(uv.y * u_p[2] + u_time * u_p[1] * 6.2831) * 0.03 * u_p[0]; return tex(uv + vec2(o, 0.0)); }`, ['jelly', 'wave']),
  fx('slidein', 'Slide Loop', 'Motion', '↔️', [P('amount', 'Distance', 0, 1, 0.5), P('rate', 'Rate', 0.1, 3, 0.5), P('direction', 'Direction', 0, 3, 0, 1)],
    `vec4 effect(vec2 uv){ float ph = sin(u_time * u_p[1] * 6.2831) * 0.5 * u_p[0]; vec2 o = u_p[2] < 0.5 ? vec2(ph, 0.0) : u_p[2] < 1.5 ? vec2(0.0, ph) : u_p[2] < 2.5 ? vec2(ph, ph) : vec2(ph, -ph); vec2 p = uv + o; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0); return tex(p); }`, ['pan', 'move']),

  // ---------------- Light ----------------
  fx('spotlight', 'Spotlight', 'Light', '🔦', [P('x', 'X', 0, 1, 0.5), P('y', 'Y', 0, 1, 0.5), P('size', 'Size', 0.05, 1, 0.3), P('softness', 'Softness', 0, 1, 0.5), P('dark', 'Darkness', 0, 1, 0.85)],
    `vec4 effect(vec2 uv){ vec2 d = uv - vec2(u_p[0], u_p[1]); d.x *= u_res.x / u_res.y; float r = length(d); float m = 1.0 - smoothstep(u_p[2] * (1.0 - u_p[3]), u_p[2], r); vec4 c = tex(uv); c.rgb *= mix(1.0 - u_p[4], 1.0, m); return c; }`, ['stage', 'focus', 'circle']),
  fx('lightsweep', 'Light Sweep', 'Light', '🌟', [P('intensity', 'Intensity', 0, 1, 0.6), P('width', 'Width', 0.02, 0.5, 0.15), P('rate', 'Rate', 0.1, 3, 0.5), P('angle', 'Angle', 0, 180, 30, 1)],
    `vec4 effect(vec2 uv){ float a = radians(u_p[3]); float x = dot(uv - 0.5, vec2(cos(a), sin(a))) + 0.5; float ph = fract(u_time * u_p[2]) * 1.6 - 0.3; float m = 1.0 - smoothstep(0.0, u_p[1], abs(x - ph)); vec4 c = tex(uv); c.rgb += m * u_p[0] * 0.8 * c.a; return c; }`, ['shine', 'reflection', 'gloss']),
  fx('lightrays', 'Light Rays', 'Light', '🌤️', [P('intensity', 'Intensity', 0, 1, 0.5), P('x', 'Source X', 0, 1, 0.5), P('y', 'Source Y', 0, 1, 0), P('rays', 'Rays', 2, 40, 12, 1), P('speed', 'Speed', 0, 3, 0.4)],
    `vec4 effect(vec2 uv){ vec2 s = vec2(u_p[1], u_p[2]); vec2 d = uv - s; float ang = atan(d.y, d.x); float r = length(d); float ray = 0.5 + 0.5 * sin(ang * u_p[3] + u_time * u_p[4] * 3.0); ray *= 0.6 + 0.4 * sin(ang * u_p[3] * 0.37 - u_time * u_p[4] * 2.0); ray *= smoothstep(1.4, 0.0, r); vec4 c = tex(uv); c.rgb += vec3(1.0, 0.95, 0.8) * ray * u_p[0] * 0.5 * c.a; return c; }`, ['sun', 'beams', 'volumetric']),
  fx('prism', 'Prism Streak', 'Light', '🔮', [P('intensity', 'Intensity', 0, 1, 0.6), P('position', 'Position', 0, 1, 0.3), P('width', 'Width', 0.05, 0.6, 0.25), P('angle', 'Angle', 0, 180, 45, 1)],
    `vec4 effect(vec2 uv){ float a = radians(u_p[3]); float x = dot(uv - 0.5, vec2(cos(a), sin(a))) + 0.5; float t = (x - u_p[1]) / u_p[2]; float m = 1.0 - smoothstep(0.0, 1.0, abs(t)); vec3 rainbow = hsv2rgb(vec3(clamp(t * 0.5 + 0.5, 0.0, 1.0) * 0.8, 0.8, 1.0)); vec4 c = tex(uv); c.rgb += rainbow * m * u_p[0] * 0.6 * c.a; return c; }`, ['rainbow', 'lens', 'flare']),
  fx('discoball', 'Disco Lights', 'Light', '🪩', [P('intensity', 'Intensity', 0, 1, 0.6), P('speed', 'Speed', 0, 3, 1), P('size', 'Size', 2, 20, 8, 1)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec3 acc = vec3(0.0); for (int i = 0; i < 6; i++) { float fi = float(i); vec2 p = vec2(0.5 + 0.45 * sin(u_time * u_p[1] * (0.6 + fi * 0.13) + fi * 1.7), 0.5 + 0.45 * cos(u_time * u_p[1] * (0.5 + fi * 0.11) + fi * 2.3)); vec2 d = uv - p; d.x *= u_res.x / u_res.y; float m = 1.0 - smoothstep(0.0, 1.5 / u_p[2], length(d)); acc += hsv2rgb(vec3(fi / 6.0 + u_time * 0.1, 0.9, 1.0)) * m; } c.rgb += acc * u_p[0] * 0.5 * c.a; return c; }`, ['party', 'colors', 'club']),

  // ---------------- Distortion ----------------
  fx('bulge', 'Bulge / Pinch', 'Distortion', '🫧', [P('amount', 'Amount', -1, 1, 0.5), P('radius', 'Radius', 0.1, 1, 0.5), P('x', 'X', 0, 1, 0.5), P('y', 'Y', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec2 c = vec2(u_p[2], u_p[3]); vec2 d = uv - c; d.x *= u_res.x / u_res.y; float r = length(d) / u_p[1]; if (r < 1.0) { float k = pow(r, 1.0 - u_p[0] * 0.8) / max(r, 1e-4); d *= k; } d.x /= u_res.x / u_res.y; return tex(c + d); }`, ['lens', 'magnify', 'fisheye']),
  fx('barrel', 'Lens Distortion', 'Distortion', '📷', [P('amount', 'Amount', -1, 1, 0.3), P('zoom', 'Zoom', 0.5, 1.5, 1)],
    `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * 2.0; d.x *= u_res.x / u_res.y; float r2 = dot(d, d); d *= 1.0 + u_p[0] * 0.3 * r2; d.x /= u_res.x / u_res.y; vec2 p = d * 0.5 / u_p[1] + 0.5; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0); return tex(p); }`, ['wide', 'gopro', 'optics']),
  fx('glassblocks', 'Glass Blocks', 'Distortion', '🧊', [P('size', 'Block size', 2, 40, 10, 1), P('amount', 'Refraction', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec2 g = uv * u_p[0]; vec2 f = fract(g) - 0.5; vec2 o = f * f * f * u_p[1] * 0.4; return tex(uv + o); }`, ['tiles', 'refract', 'shower']),
  fx('melt', 'Melt', 'Distortion', '🫠', [P('amount', 'Amount', 0, 1, 0.5), P('speed', 'Speed', 0, 3, 0.5), P('detail', 'Detail', 1, 20, 6)],
    `vec4 effect(vec2 uv){ float n = noise2(vec2(uv.x * u_p[2], u_time * u_p[1])); float drip = n * n * u_p[0] * 0.5 * smoothstep(0.0, 1.0, uv.y + 0.2); float y = uv.y - drip * (1.0 - uv.y); return tex(vec2(uv.x, max(y, 0.0))); }`, ['drip', 'liquid', 'psychedelic']),
  fx('stretch', 'Stretch', 'Distortion', '↕️', [P('x', 'Horizontal', -1, 1, 0), P('y', 'Vertical', -1, 1, 0.3), P('center', 'Center hold', 0, 1, 0.4)],
    `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; vec2 a = abs(d) * 2.0; vec2 w = smoothstep(u_p[2], 1.0, a); vec2 s = vec2(1.0 - u_p[0] * 0.6 * w.x, 1.0 - u_p[1] * 0.6 * w.y); return tex(d * s + 0.5); }`, ['scale', 'warp']),
  fx('quadmirror', 'Quad Mirror', 'Distortion', '🪞', [P('mode', 'Mode', 0, 2, 0, 1)],
    `vec4 effect(vec2 uv){ vec2 p = uv; if (u_p[0] < 0.5) { p = abs(uv - 0.5) + 0.5; } else if (u_p[0] < 1.5) { p = 0.5 - abs(uv - 0.5); } else { p = vec2(abs(uv.x - 0.5) + 0.5, uv.y); } return tex(p); }`, ['symmetry', 'reflect']),
  fx('wavywarp', 'Wavy Warp', 'Distortion', '🌊', [P('amount', 'Amount', 0, 1, 0.3), P('scale', 'Scale', 1, 20, 6), P('speed', 'Speed', 0, 3, 1)],
    `vec4 effect(vec2 uv){ float t = u_time * u_p[2]; vec2 o = vec2(noise2(uv * u_p[1] + t), noise2(uv * u_p[1] + 7.3 - t)) - 0.5; return tex(uv + o * 0.1 * u_p[0]); }`, ['underwater', 'noise', 'warp']),
  fx('hexpixel', 'Hex Mosaic', 'Distortion', '⬡', [P('size', 'Cell size', 4, 80, 24, 1)],
    `vec4 effect(vec2 uv){ vec2 res = u_res; vec2 p = uv * res / u_p[0]; vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5; vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h; vec2 g = dot(a, a) < dot(b, b) ? p - a : p - b; return tex(g * u_p[0] / res); }`, ['honeycomb', 'cells']),

  // ---------------- Stylize ----------------
  fx('halftone', 'Halftone', 'Stylize', '⚫', [P('size', 'Dot size', 2, 24, 8, 1), P('angle', 'Angle', 0, 90, 45, 1), P('color', 'Color', 0, 1, 0, 1)],
    `vec4 effect(vec2 uv){ float a = radians(u_p[1]); mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a)); vec2 p = R * (uv * u_res); vec2 g = floor(p / u_p[0]) * u_p[0] + u_p[0] * 0.5; vec2 c = transpose(R) * g / u_res; vec4 s = texU(c); float d = length(p - g) / (u_p[0] * 0.7);
      if (u_p[2] > 0.5) { vec3 r = step(d, sqrt(s.rgb)); return premul(vec4(r, s.a)); } float l = luma(s.rgb); float m = step(d, sqrt(l)); return premul(vec4(vec3(m), s.a)); }`, ['print', 'dots', 'newspaper']),
  fx('oilpaint', 'Oil Paint', 'Stylize', '🖌️', [P('radius', 'Brush size', 1, 6, 3, 1), P('amount', 'Amount', 0, 1, 1)],
    `vec4 effect(vec2 uv){ vec2 px = 1.0 / u_res; float r = u_p[0]; vec3 m[4]; vec3 s[4]; for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); }
      float n = (r + 1.0) * (r + 1.0);
      for (int j = -6; j <= 0; j++) for (int i = -6; i <= 0; i++) { if (float(-j) > r || float(-i) > r) continue; vec3 c = texU(uv + vec2(float(i), float(j)) * px).rgb; m[0] += c; s[0] += c * c; }
      for (int j = -6; j <= 0; j++) for (int i = 0; i <= 6; i++) { if (float(-j) > r || float(i) > r) continue; vec3 c = texU(uv + vec2(float(i), float(j)) * px).rgb; m[1] += c; s[1] += c * c; }
      for (int j = 0; j <= 6; j++) for (int i = 0; i <= 6; i++) { if (float(j) > r || float(i) > r) continue; vec3 c = texU(uv + vec2(float(i), float(j)) * px).rgb; m[2] += c; s[2] += c * c; }
      for (int j = 0; j <= 6; j++) for (int i = -6; i <= 0; i++) { if (float(j) > r || float(-i) > r) continue; vec3 c = texU(uv + vec2(float(i), float(j)) * px).rgb; m[3] += c; s[3] += c * c; }
      float minS = 1e9; vec3 best = m[0] / n; for (int k = 0; k < 4; k++) { m[k] /= n; s[k] = abs(s[k] / n - m[k] * m[k]); float sg = s[k].r + s[k].g + s[k].b; if (sg < minS) { minS = sg; best = m[k]; } }
      vec4 c = texU(uv); c.rgb = mix(c.rgb, best, u_p[1]); return premul(c); }`, ['kuwahara', 'painting', 'art']),
  fx('watercolor', 'Watercolor', 'Stylize', '🎨', [P('amount', 'Amount', 0, 1, 0.7), P('levels', 'Levels', 3, 12, 6, 1)],
    `vec4 effect(vec2 uv){ vec2 o = (vec2(fbm(uv * 12.0 + u_seed), fbm(uv * 12.0 + 5.0 + u_seed)) - 0.5) * 0.02 * u_p[0]; vec4 c = texU(uv + o); vec3 q = floor(c.rgb * u_p[1] + 0.5) / u_p[1]; float paper = 0.9 + 0.1 * fbm(uv * u_res * 0.1); vec3 w = mix(q, q * paper, 0.6); w = 1.0 - (1.0 - w) * (0.85 + 0.15 * fbm(uv * 30.0)); c.rgb = mix(c.rgb, w, u_p[0]); return premul(c); }`, ['paint', 'paper', 'art']),
  fx('stainedglass', 'Stained Glass', 'Stylize', '🪟', [P('cells', 'Cells', 4, 60, 18, 1), P('border', 'Border', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * u_p[0]; vec2 i = floor(p); float d1 = 9.0, d2 = 9.0; vec2 best = vec2(0.0);
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = i + vec2(x, y); vec2 pt = g + vec2(hash12(g + u_seed), hash12(g + 3.1 + u_seed)); float d = length(p - pt); if (d < d1) { d2 = d1; d1 = d; best = pt; } else if (d < d2) d2 = d; }
      vec2 cuv = best / (vec2(u_res.x / u_res.y, 1.0) * u_p[0]); vec4 c = texU(clamp(cuv, 0.0, 1.0)); float edge = smoothstep(0.0, 0.08 * u_p[1], d2 - d1); c.rgb *= mix(1.0, edge, u_p[1]); return premul(c); }`, ['voronoi', 'mosaic', 'church']),
  fx('lineart', 'Line Art', 'Stylize', '✏️', [P('threshold', 'Threshold', 0, 1, 0.2), P('thickness', 'Thickness', 1, 4, 1.5), P('invert', 'Dark lines', 0, 1, 1, 1)],
    `vec4 effect(vec2 uv){ vec2 px = u_p[1] / u_res; float tl = luma(texU(uv + vec2(-px.x, px.y)).rgb), t = luma(texU(uv + vec2(0.0, px.y)).rgb), tr = luma(texU(uv + px).rgb); float l = luma(texU(uv - vec2(px.x, 0.0)).rgb), r = luma(texU(uv + vec2(px.x, 0.0)).rgb); float bl = luma(texU(uv - px).rgb), b = luma(texU(uv - vec2(0.0, px.y)).rgb), br = luma(texU(uv + vec2(px.x, -px.y)).rgb);
      float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br; float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br; float e = smoothstep(u_p[0], u_p[0] + 0.3, length(vec2(gx, gy))); float v = u_p[2] > 0.5 ? 1.0 - e : e; float a = texU(uv).a; return vec4(vec3(v) * a, a); }`, ['sketch', 'outline', 'edges']),
  fx('popart', 'Pop Art', 'Stylize', '🟡', [P('amount', 'Amount', 0, 1, 1), P('levels', 'Levels', 2, 6, 3, 1)],
    `vec4 effect(vec2 uv){ vec2 cell = floor(uv * 2.0); vec2 q = fract(uv * 2.0); vec4 c = texU(q); float l = floor(luma(c.rgb) * u_p[1]) / (u_p[1] - 1.0); float idx = cell.x + cell.y * 2.0;
      vec3 a = idx < 0.5 ? vec3(0.95, 0.85, 0.1) : idx < 1.5 ? vec3(0.1, 0.6, 0.9) : idx < 2.5 ? vec3(0.95, 0.2, 0.5) : vec3(0.3, 0.85, 0.3);
      vec3 b = idx < 0.5 ? vec3(0.9, 0.1, 0.2) : idx < 1.5 ? vec3(0.95, 0.9, 0.2) : idx < 2.5 ? vec3(0.1, 0.2, 0.6) : vec3(0.6, 0.1, 0.6);
      vec3 o = mix(b, a, l); c.rgb = mix(c.rgb, o, u_p[0]); return premul(c); }`, ['warhol', 'grid', 'colors']),
  fx('outlineglow', 'Outline', 'Stylize', '🖍️', [P('thickness', 'Thickness', 1, 6, 2), P('hue', 'Color', 0, 1, 0.5), P('mix', 'Keep image', 0, 1, 0.8)],
    `vec4 effect(vec2 uv){ vec2 px = u_p[0] / u_res; float c0 = luma(texU(uv).rgb); float e = 0.0; e += abs(luma(texU(uv + vec2(px.x, 0.0)).rgb) - c0); e += abs(luma(texU(uv - vec2(px.x, 0.0)).rgb) - c0); e += abs(luma(texU(uv + vec2(0.0, px.y)).rgb) - c0); e += abs(luma(texU(uv - vec2(0.0, px.y)).rgb) - c0); e = smoothstep(0.05, 0.4, e); vec4 c = texU(uv); vec3 col = hsv2rgb(vec3(u_p[1], 1.0, 1.0)); c.rgb = mix(c.rgb * u_p[2], col, e); return premul(c); }`, ['edges', 'contour']),
  fx('asciiblocks', 'Glyph Mosaic', 'Stylize', '🔡', [P('size', 'Cell size', 4, 32, 10, 1), P('color', 'Colored', 0, 1, 1, 1)],
    `vec4 effect(vec2 uv){ vec2 px = u_p[0] / u_res; vec2 cell = floor(uv / px); vec2 f = fract(uv / px); vec4 c = texU((cell + 0.5) * px); float l = luma(c.rgb); float lv = floor(l * 5.0);
      float m = 0.0; vec2 g = floor(f * 3.0); float gi = g.x + g.y * 3.0;
      float mask = lv < 0.5 ? 0.0 : lv < 1.5 ? (gi == 4.0 ? 1.0 : 0.0) : lv < 2.5 ? (g.x == 1.0 || g.y == 1.0 ? 1.0 : 0.0) : lv < 3.5 ? (gi != 0.0 && gi != 2.0 && gi != 6.0 && gi != 8.0 ? 1.0 : 0.0) : 1.0;
      m = mask * step(0.1, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)) + 0.1) ; vec3 col = u_p[1] > 0.5 ? c.rgb / max(l, 0.05) * 0.9 : vec3(1.0); return premul(vec4(col * m, c.a)); }`, ['ascii', 'matrix', 'text']),

  // ---------------- Neon ----------------
  fx('neonglow', 'Neon Edges Glow', 'Neon', '💡', [P('intensity', 'Intensity', 0, 2, 1), P('hueSpeed', 'Hue cycle', 0, 2, 0.3), P('keep', 'Keep image', 0, 1, 0.2)],
    `vec4 effect(vec2 uv){ vec2 px = 1.5 / u_res; float c0 = luma(texU(uv).rgb); float e = abs(luma(texU(uv + vec2(px.x, 0.0)).rgb) - c0) + abs(luma(texU(uv + vec2(0.0, px.y)).rgb) - c0); e = smoothstep(0.03, 0.3, e);
      float glow = 0.0; for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; vec2 o = vec2(cos(a), sin(a)) * px * 4.0; float cc = luma(texU(uv + o).rgb); glow += abs(luma(texU(uv + o + vec2(px.x, 0.0)).rgb) - cc); } glow = smoothstep(0.02, 0.6, glow / 8.0);
      vec3 col = hsv2rgb(vec3(fract(u_time * u_p[1] + uv.y * 0.3), 0.9, 1.0)); vec4 c = texU(uv); c.rgb = c.rgb * u_p[2] + col * (e + glow * 0.6) * u_p[0]; return premul(c); }`, ['edges', 'tron', 'rainbow']),
  fx('laserscan', 'Laser Scan', 'Neon', '🔺', [P('speed', 'Speed', 0.1, 3, 0.7), P('hue', 'Color', 0, 1, 0.0), P('width', 'Width', 0.005, 0.1, 0.02), P('darken', 'Darken rest', 0, 1, 0.3)],
    `vec4 effect(vec2 uv){ float y = fract(u_time * u_p[0]); float d = abs(uv.y - y); float line = 1.0 - smoothstep(0.0, u_p[2], d); float trail = exp(-max(y - uv.y, 0.0) * 12.0) * step(uv.y, y) * 0.4; vec3 col = hsv2rgb(vec3(u_p[1], 1.0, 1.0)); vec4 c = tex(uv); c.rgb *= 1.0 - u_p[3] * (1.0 - trail); c.rgb += col * (line + trail * 0.6) * c.a; return c; }`, ['scanner', 'sci-fi', 'line']),
  fx('neonsign', 'Neon Sign', 'Neon', '🪧', [P('hue', 'Color', 0, 1, 0.85), P('flicker', 'Flicker', 0, 1, 0.3), P('threshold', 'Threshold', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); float m = smoothstep(u_p[2] - 0.15, u_p[2] + 0.15, l); float fl = 1.0 - u_p[1] * step(0.92, hash11(floor(u_time * 24.0) + u_seed)) * 0.7; vec3 col = hsv2rgb(vec3(u_p[0], 0.85, 1.0));
      vec3 glow = vec3(0.0); for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; glow += smoothstep(u_p[2] - 0.15, u_p[2] + 0.15, luma(texU(uv + vec2(cos(a), sin(a)) * 6.0 / u_res).rgb)); } glow /= 8.0;
      c.rgb = (col * m * 1.2 + col * glow * 0.5 + vec3(0.02, 0.0, 0.04)) * fl; return premul(c); }`, ['glow', 'tube', 'pink']),

  // ---------------- Horror ----------------
  fx('doublevision', 'Double Vision', 'Horror', '👀', [P('amount', 'Amount', 0, 1, 0.4), P('rate', 'Rate', 0, 3, 0.7)],
    `vec4 effect(vec2 uv){ vec2 o = vec2(sin(u_time * u_p[1] * 2.0), cos(u_time * u_p[1] * 1.3)) * 0.03 * u_p[0]; vec4 a = tex(uv + o); vec4 b = tex(uv - o); vec4 c = tex(uv); return mix(c, (a + b) * 0.5, 0.6 + 0.3 * u_p[0]); }`, ['drunk', 'dizzy', 'ghost']),
  fx('tunnelvision', 'Tunnel Vision', 'Horror', '🕳️', [P('amount', 'Amount', 0, 1, 0.6), P('pulse', 'Pulse', 0, 3, 1)],
    `vec4 effect(vec2 uv){ float p = 0.5 + 0.5 * sin(u_time * u_p[1] * 6.2831); float r = length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0)); float v = smoothstep(0.15 + 0.2 * (1.0 - u_p[0]) + p * 0.08, 0.7, r) * u_p[0]; vec4 c = tex(uv); c.rgb = mix(c.rgb, vec3(0.0), v); c.rgb = mix(c.rgb, vec3(luma(c.rgb)), v * 0.8); return c; }`, ['faint', 'dark', 'passout']),
  fx('bloodpulse', 'Blood Pulse', 'Horror', '🩸', [P('amount', 'Amount', 0, 1, 0.6), P('rate', 'Heartbeat', 0.3, 3, 1.2)],
    `vec4 effect(vec2 uv){ float t = fract(u_time * u_p[1]); float beat = exp(-t * 8.0) + 0.6 * exp(-max(t - 0.25, 0.0) * 10.0) * step(0.25, t); float r = length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0)); float v = smoothstep(0.25, 0.8, r); vec4 c = texU(uv); c.rgb = mix(c.rgb, vec3(0.45, 0.0, 0.0), v * beat * u_p[0]); c.rgb = mix(c.rgb, c.rgb * vec3(1.1, 0.8, 0.8), beat * u_p[0] * 0.5); return premul(c); }`, ['damage', 'red', 'heartbeat']),
  fx('staticflicker', 'Haunted Flicker', 'Horror', '👻', [P('amount', 'Amount', 0, 1, 0.5), P('rate', 'Rate', 1, 30, 10, 1)],
    `vec4 effect(vec2 uv){ float f = floor(u_time * u_p[1]); float r = hash11(f + u_seed); float dark = step(0.85, r) * u_p[0]; float neg = step(0.97, r); vec4 c = texU(uv); c.rgb = mix(c.rgb, vec3(luma(c.rgb)) * 0.7, dark); if (neg > 0.5 && u_p[0] > 0.3) c.rgb = 1.0 - c.rgb; c.rgb += (hash12(uv * u_res + f) - 0.5) * 0.2 * dark; return premul(c); }`, ['scary', 'cuts', 'glimpse']),

  // ---------------- Gaming ----------------
  fx('lowhealth', 'Low Health', 'Gaming', '❤️‍🩹', [P('amount', 'Amount', 0, 1, 0.7), P('rate', 'Rate', 0.3, 3, 1.5)],
    `vec4 effect(vec2 uv){ float p = 0.5 + 0.5 * sin(u_time * u_p[1] * 6.2831); float r = length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0)); float v = smoothstep(0.3, 0.75, r) * (0.5 + 0.5 * p) * u_p[0]; vec4 c = texU(uv); c.rgb = mix(c.rgb, vec3(0.7, 0.05, 0.05), v); c.rgb = mix(c.rgb, vec3(luma(c.rgb)), v * 0.6); return premul(c); }`, ['fps', 'damage', 'hud']),
  fx('killcam', 'Kill Cam', 'Gaming', '🎯', [P('amount', 'Amount', 0, 1, 0.8), P('bars', 'Bars', 0, 0.3, 0.1)],
    `vec4 effect(vec2 uv){ if (uv.y < u_p[1] || uv.y > 1.0 - u_p[1]) return vec4(0.0, 0.0, 0.0, 1.0); vec4 c = texU(uv); vec3 o = mix(vec3(luma(c.rgb)), c.rgb, 0.4); o = o * vec3(0.95, 1.0, 1.1); o *= 1.0 - 0.6 * smoothstep(0.3, 0.9, length(uv - 0.5)); o = pow(o, vec3(1.1)); c.rgb = mix(c.rgb, o, u_p[0]); return premul(c); }`, ['replay', 'cod', 'cinematic']),
  fx('minecraft', 'Blocky', 'Gaming', '🟫', [P('size', 'Block size', 4, 48, 16, 1), P('saturation', 'Saturation', 0.5, 2, 1.3), P('shade', 'Shade', 0, 1, 0.3)],
    `vec4 effect(vec2 uv){ vec2 px = u_p[0] / u_res; vec2 cell = floor(uv / px); vec4 c = texU((cell + 0.5) * px); vec3 hsv = rgb2hsv(c.rgb); hsv.y = clamp(hsv.y * u_p[1], 0.0, 1.0); c.rgb = hsv2rgb(hsv); vec2 f = fract(uv / px); float sh = 1.0 - u_p[2] * 0.3 * (step(0.9, f.x) + step(f.y, 0.1)) + u_p[2] * 0.15 * (step(f.x, 0.1) + step(0.9, f.y)); c.rgb *= sh; return premul(c); }`, ['pixel', 'blocks', 'voxel']),
  fx('damageflash', 'Damage Flash', 'Gaming', '💥', [P('rate', 'Rate', 0.2, 4, 1), P('hue', 'Color', 0, 1, 0), P('amount', 'Amount', 0, 1, 0.7)],
    `vec4 effect(vec2 uv){ float t = fract(u_time * u_p[0]); float f = exp(-t * 10.0) * u_p[2]; vec3 col = hsv2rgb(vec3(u_p[1], 0.9, 1.0)); float z = 1.0 + f * 0.05; vec4 c = texU((uv - 0.5) / z + 0.5); c.rgb = mix(c.rgb, col, f * 0.7); return premul(c); }`, ['hit', 'flash', 'red']),
  fx('retrohud', 'Retro HUD', 'Gaming', '🕹️', [P('amount', 'Amount', 0, 1, 0.7), P('hue', 'Color', 0, 1, 0.33)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 col = hsv2rgb(vec3(u_p[1], 0.8, 1.0)); float l = luma(c.rgb); float scan = 0.85 + 0.15 * sin(uv.y * u_res.y * 3.14159); float grid = step(0.98, fract(uv.x * 20.0)) + step(0.98, fract(uv.y * 20.0 * u_res.y / u_res.x)); vec3 o = col * l * scan + col * grid * 0.25; float b = step(uv.x, 0.02) + step(0.98, uv.x) + step(uv.y, 0.02) + step(0.98, uv.y); o += col * b * 0.8; c.rgb = mix(c.rgb, o, u_p[0]); return premul(c); }`, ['terminal', 'grid', 'green']),

  // ---------------- Social ----------------
  fx('punchzoom', 'Punch Zoom', 'Social', '👊', [P('amount', 'Amount', 0, 1, 0.5), P('rate', 'Rate', 0.2, 4, 1), P('hold', 'Hold', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ float t = fract(u_time * u_p[1]); float z = 1.0 + u_p[0] * 0.4 * (t < u_p[2] ? 1.0 : exp(-(t - u_p[2]) * 10.0)); return tex((uv - 0.5) / z + 0.5); }`, ['zoom in', 'beat', 'meme']),
  fx('rainbowcycle', 'Rainbow Cycle', 'Social', '🌈', [P('amount', 'Amount', 0, 1, 0.5), P('speed', 'Speed', 0, 3, 0.5), P('scale', 'Scale', 0, 4, 1)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 col = hsv2rgb(vec3(fract(u_time * u_p[1] + (uv.x + uv.y) * 0.25 * u_p[2]), 0.8, 1.0)); c.rgb = mix(c.rgb, c.rgb * col * 1.4, u_p[0]); return premul(c); }`, ['tint', 'pride', 'color']),
  fx('pastel', 'Pastel Dream', 'Social', '🍭', [P('amount', 'Amount', 0, 1, 0.7)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 o = c.rgb * 0.8 + 0.18; vec3 hsv = rgb2hsv(o); hsv.y *= 0.75; o = hsv2rgb(hsv); o = mix(o, o * vec3(1.03, 0.98, 1.05), 0.6); c.rgb = mix(c.rgb, o, u_p[0]); return premul(c); }`, ['soft', 'aesthetic', 'pink']),
  fx('y2k', 'Y2K Chrome', 'Social', '💿', [P('amount', 'Amount', 0, 1, 0.6), P('speed', 'Speed', 0, 3, 0.6)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); float band = sin(l * 18.0 + u_time * u_p[1] * 4.0 + uv.y * 6.0); vec3 chrome = hsv2rgb(vec3(fract(l * 0.6 + u_time * u_p[1] * 0.1 + 0.5), 0.5, 0.9 + 0.1 * band)); vec3 o = mix(c.rgb, chrome * (0.6 + 0.4 * l), smoothstep(0.3, 0.9, l) * 0.8 + 0.1); c.rgb = mix(c.rgb, o, u_p[0]); return premul(c); }`, ['metallic', 'holo', '2000s']),
  fx('softvignette', 'Soft Frame', 'Social', '🖼️', [P('amount', 'Amount', 0, 1, 0.5), P('size', 'Size', 0.2, 1.2, 0.7), P('hue', 'Tint', 0, 1, 0.1), P('light', 'Light frame', 0, 1, 0, 1)],
    `vec4 effect(vec2 uv){ float r = length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0)); float v = smoothstep(u_p[1] * 0.5, u_p[1], r) * u_p[0]; vec4 c = texU(uv); vec3 col = u_p[3] > 0.5 ? mix(vec3(1.0), hsv2rgb(vec3(u_p[2], 0.3, 1.0)), 0.5) : hsv2rgb(vec3(u_p[2], 0.4, 0.1)); c.rgb = mix(c.rgb, col, v); return premul(c); }`, ['frame', 'vignette', 'tint']),

  // ---------------- Color ----------------
  fx('hueshift', 'Hue Shift', 'Color', '🎡', [P('shift', 'Shift', 0, 360, 180, 1), P('amount', 'Amount', 0, 1, 1)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 hsv = rgb2hsv(c.rgb); hsv.x = fract(hsv.x + u_p[0] / 360.0); c.rgb = mix(c.rgb, hsv2rgb(hsv), u_p[1]); return premul(c); }`, ['hue', 'rotate', 'color']),
  fx('colorcycle', 'Hue Cycle', 'Color', '🔄', [P('speed', 'Speed', 0, 3, 0.5), P('amount', 'Amount', 0, 1, 1)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 hsv = rgb2hsv(c.rgb); hsv.x = fract(hsv.x + u_time * u_p[0] * 0.25); c.rgb = mix(c.rgb, hsv2rgb(hsv), u_p[1]); return premul(c); }`, ['animated', 'psychedelic']),
  fx('gradientmap', 'Gradient Map', 'Color', '🎚️', [P('h1', 'Shadow hue', 0, 1, 0.65), P('h2', 'Highlight hue', 0, 1, 0.1), P('sat', 'Saturation', 0, 1, 0.8), P('amount', 'Amount', 0, 1, 0.8)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 a = hsv2rgb(vec3(u_p[0], u_p[2], 0.15)); vec3 b = hsv2rgb(vec3(u_p[1], u_p[2] * 0.6, 1.0)); vec3 m = mix(a, b, smoothstep(0.0, 1.0, l)); c.rgb = mix(c.rgb, m, u_p[3]); return premul(c); }`, ['map', 'tone', 'two color']),
  fx('splittone', 'Split Tone', 'Color', '🌓', [P('sh', 'Shadow hue', 0, 1, 0.6), P('hl', 'Highlight hue', 0, 1, 0.1), P('amount', 'Amount', 0, 1, 0.4), P('balance', 'Balance', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 s = hsv2rgb(vec3(u_p[0], 1.0, 1.0)); vec3 h = hsv2rgb(vec3(u_p[1], 1.0, 1.0)); float w = smoothstep(u_p[3] - 0.3, u_p[3] + 0.3, l); vec3 tint = mix(s, h, w); c.rgb = mix(c.rgb, c.rgb * mix(vec3(1.0), tint * 1.5, 0.5) + tint * 0.08, u_p[2]); return premul(c); }`, ['grade', 'teal', 'warm']),
  fx('filmnegative', 'Film Negative', 'Color', '🎞️', [P('amount', 'Amount', 0, 1, 1), P('mask', 'Orange mask', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 n = 1.0 - c.rgb; n = mix(n, n * vec3(1.0, 0.72, 0.45) + vec3(0.1, 0.03, 0.0), u_p[1]); c.rgb = mix(c.rgb, n, u_p[0]); return premul(c); }`, ['invert', 'negative', 'analog']),
  fx('tritone', 'Tritone', 'Color', '🎨', [P('h1', 'Shadows', 0, 1, 0.7), P('h2', 'Midtones', 0, 1, 0.95), P('h3', 'Highlights', 0, 1, 0.12), P('amount', 'Amount', 0, 1, 0.8)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 a = hsv2rgb(vec3(u_p[0], 0.8, 0.2)); vec3 b = hsv2rgb(vec3(u_p[1], 0.7, 0.6)); vec3 d = hsv2rgb(vec3(u_p[2], 0.4, 1.0)); vec3 m = l < 0.5 ? mix(a, b, l * 2.0) : mix(b, d, (l - 0.5) * 2.0); c.rgb = mix(c.rgb, m, u_p[3]); return premul(c); }`, ['three color', 'duotone', 'grade']),
  fx('selectivesat', 'Selective Saturation', 'Color', '🎯', [P('hue', 'Hue', 0, 1, 0.0), P('range', 'Range', 0.02, 0.5, 0.12), P('boost', 'Boost', 0, 2, 1.5), P('others', 'Others', 0, 1, 0.6)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 hsv = rgb2hsv(c.rgb); float dh = abs(mod(hsv.x - u_p[0] + 0.5, 1.0) - 0.5); float m = 1.0 - smoothstep(u_p[1] * 0.5, u_p[1], dh); hsv.y = clamp(hsv.y * mix(u_p[3], u_p[2], m), 0.0, 1.0); c.rgb = hsv2rgb(hsv); return premul(c); }`, ['hue', 'isolate', 'pop']),
  fx('channelswap', 'Channel Swap', 'Color', '🔀', [P('mode', 'Mode', 0, 4, 0, 1), P('amount', 'Amount', 0, 1, 1)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 s = u_p[0] < 0.5 ? c.gbr : u_p[0] < 1.5 ? c.brg : u_p[0] < 2.5 ? c.bgr : u_p[0] < 3.5 ? c.rbg : c.grb; c.rgb = mix(c.rgb, s, u_p[1]); return premul(c); }`, ['rgb', 'swap', 'weird']),

  // ---------------- Texture / overlays ----------------
  fx('dust', 'Dust & Scratches', 'Texture', '🪶', [P('dust', 'Dust', 0, 1, 0.5), P('scratches', 'Scratches', 0, 1, 0.4), P('speed', 'Speed', 0, 3, 1)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); float fr = floor(u_time * 24.0 * u_p[2]); float d = 0.0; for (int i = 0; i < 6; i++) { float fi = float(i); vec2 p = vec2(hash11(fr * 1.3 + fi + u_seed), hash11(fr * 2.1 + fi * 7.0 + u_seed)); vec2 dd = (uv - p) * vec2(u_res.x / u_res.y, 1.0); d += 1.0 - smoothstep(0.0, 0.004 + 0.004 * hash11(fi + fr), length(dd)); }
      float s = 0.0; for (int i = 0; i < 3; i++) { float fi = float(i); float x = hash11(floor(u_time * 6.0 * u_p[2]) + fi * 13.0 + u_seed); float on = step(0.6, hash11(floor(u_time * 6.0 * u_p[2]) * 3.0 + fi)); s += on * (1.0 - smoothstep(0.0, 1.2 / u_res.x, abs(uv.x - x))) * smoothstep(0.0, 0.3, noise2(vec2(uv.y * 30.0, fi + u_time * 4.0))); }
      c.rgb = mix(c.rgb, vec3(1.0) * c.a, clamp(d * u_p[0] * 0.8 + s * u_p[1] * 0.5, 0.0, 1.0)); return c; }`, ['film', 'old', 'overlay']),
  fx('rain', 'Rain', 'Texture', '🌧️', [P('amount', 'Amount', 0, 1, 0.6), P('speed', 'Speed', 0.2, 4, 1.5), P('angle', 'Angle', -30, 30, 8, 1)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); float a = radians(u_p[2]); vec2 p = uv; p.x += p.y * tan(a); float r = 0.0;
      for (int i = 0; i < 3; i++) { float fi = float(i) + 1.0; vec2 g = p * vec2(60.0 * fi, 6.0 * fi); g.y += u_time * u_p[1] * 6.0 * fi; vec2 id = floor(g); vec2 f = fract(g); float h = hash12(id + u_seed * fi); float drop = step(h, u_p[0] * 0.5) * (1.0 - smoothstep(0.0, 0.12, abs(f.x - 0.5))) * smoothstep(0.0, 0.5, f.y) * step(f.y, 0.9); r += drop / fi; }
      c.rgb += vec3(0.8, 0.9, 1.0) * r * 0.6 * c.a; c.rgb = mix(c.rgb, c.rgb * vec3(0.9, 0.95, 1.05), u_p[0] * 0.3); return c; }`, ['weather', 'storm', 'overlay']),
  fx('snow', 'Snow', 'Texture', '❄️', [P('amount', 'Amount', 0, 1, 0.6), P('speed', 'Speed', 0.1, 3, 0.6), P('size', 'Size', 0.5, 3, 1)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); float s = 0.0; for (int i = 0; i < 4; i++) { float fi = float(i) + 1.0; float sc = 12.0 * fi; vec2 g = uv * vec2(sc * u_res.x / u_res.y, sc); g.y += u_time * u_p[1] * 1.5 * fi; g.x += sin(u_time * 0.7 + fi) * 0.5 + noise2(g * 0.1 + u_time * 0.2) ; vec2 id = floor(g); vec2 f = fract(g) - 0.5; float h = hash12(id + u_seed); vec2 o = (vec2(hash12(id + 1.0), hash12(id + 2.0)) - 0.5) * 0.6; float d = length(f - o); s += step(h, u_p[0] * 0.6) * (1.0 - smoothstep(0.0, 0.08 * u_p[2] / fi * 2.0, d)) / fi; }
      c.rgb += vec3(1.0) * s * 0.9 * c.a; return c; }`, ['winter', 'particles', 'overlay']),
  fx('fog', 'Fog', 'Texture', '🌁', [P('amount', 'Amount', 0, 1, 0.5), P('speed', 'Speed', 0, 2, 0.3), P('bottom', 'Ground fog', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 2.0; float t = u_time * u_p[1]; float n = fbm(p + vec2(t * 0.4, t * 0.1)) * 0.6 + fbm(p * 2.3 - vec2(t * 0.2, -t * 0.15)) * 0.4; float grad = mix(1.0, smoothstep(0.1, 0.9, uv.y), u_p[2]); float f = clamp(n * 1.3 * grad, 0.0, 1.0) * u_p[0]; c.rgb = mix(c.rgb, vec3(0.85, 0.87, 0.9) * c.a, f); return c; }`, ['mist', 'smoke', 'atmosphere']),
  fx('bokehlights', 'Bokeh Lights', 'Texture', '🎇', [P('amount', 'Amount', 0, 1, 0.6), P('size', 'Size', 0.2, 3, 1), P('speed', 'Speed', 0, 2, 0.3), P('hue', 'Hue', 0, 1, 0.1), P('colorful', 'Colorful', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec3 acc = vec3(0.0); for (int i = 0; i < 14; i++) { float fi = float(i); float h = hash11(fi + u_seed); vec2 p = vec2(fract(h * 7.0 + sin(u_time * u_p[2] * (0.3 + h) + fi) * 0.08), fract(h * 13.0 + u_time * u_p[2] * 0.05 * (0.5 + h))); vec2 d = (uv - p) * vec2(u_res.x / u_res.y, 1.0); float rad = 0.03 * u_p[1] * (0.6 + 0.8 * hash11(fi * 3.0)); float m = (1.0 - smoothstep(rad * 0.75, rad, length(d))) * (0.6 + 0.4 * sin(u_time * (1.0 + h) + fi)); vec3 col = hsv2rgb(vec3(mix(u_p[3], fract(h * 3.0), u_p[4]), 0.6, 1.0)); acc += col * m * 0.35; } c.rgb += acc * u_p[0] * c.a; return c; }`, ['lights', 'party', 'overlay']),
  fx('paper', 'Paper Texture', 'Texture', '📜', [P('amount', 'Amount', 0, 1, 0.5), P('scale', 'Scale', 0.5, 4, 1.5)],
    `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec2 p = uv * u_res * 0.05 * u_p[1]; float n = fbm(p) * 0.6 + fbm(p * 3.7 + 11.0) * 0.4; float fibers = noise2(vec2(uv.x * 400.0 * u_p[1], uv.y * 20.0)) * 0.5; vec3 tex_ = vec3(0.92, 0.88, 0.8) * (0.8 + 0.25 * n + 0.1 * fibers); c.rgb = mix(c.rgb, c.rgb * tex_ * 1.1, u_p[0]); return premul(c); }`, ['grain', 'vintage', 'overlay']),
  fx('gridoverlay', 'Grid Overlay', 'Texture', '▦', [P('cells', 'Cells', 2, 40, 8, 1), P('thickness', 'Thickness', 0.5, 4, 1), P('opacity', 'Opacity', 0, 1, 0.5), P('hue', 'Hue', 0, 1, 0.5)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec2 g = uv * vec2(u_p[0] * u_res.x / u_res.y, u_p[0]); vec2 f = abs(fract(g) - 0.5); float px = u_p[1] * u_p[0] / u_res.y; float line = step(0.5 - px, f.x) + step(0.5 - px, f.y); vec3 col = hsv2rgb(vec3(u_p[3], 0.6, 1.0)); c.rgb = mix(c.rgb, col * c.a, clamp(line, 0.0, 1.0) * u_p[2]); return c; }`, ['lines', 'tech', 'overlay']),
  fx('confetti', 'Confetti', 'Texture', '🎊', [P('amount', 'Amount', 0, 1, 0.6), P('speed', 'Speed', 0.2, 3, 1), P('size', 'Size', 0.5, 3, 1)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec3 acc = vec3(0.0); for (int i = 0; i < 3; i++) { float fi = float(i) + 1.0; float sc = 10.0 * fi; vec2 g = uv * vec2(sc * u_res.x / u_res.y, sc); g.y += u_time * u_p[1] * 1.2 * fi; g.x += sin(u_time * 2.0 + fi + g.y) * 0.3; vec2 id = floor(g); vec2 f = fract(g) - 0.5; float h = hash12(id + u_seed); float ang = h * 6.28 + u_time * 3.0 * (h - 0.5); mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)); vec2 q = R * (f - (vec2(hash12(id + 1.0), hash12(id + 2.0)) - 0.5) * 0.5); vec2 sz = vec2(0.12, 0.07) * u_p[2] / fi * 2.0; float m = step(abs(q.x), sz.x) * step(abs(q.y), sz.y) * step(h, u_p[0] * 0.5); acc += hsv2rgb(vec3(fract(h * 5.0), 0.85, 1.0)) * m; } c.rgb = mix(c.rgb, acc, clamp(length(acc), 0.0, 1.0) * c.a); return c; }`, ['party', 'celebrate', 'overlay']),
  fx('sparkles', 'Sparkles', 'Texture', '✨', [P('amount', 'Amount', 0, 1, 0.6), P('size', 'Size', 0.3, 3, 1), P('speed', 'Speed', 0.2, 4, 1.5)],
    `vec4 effect(vec2 uv){ vec4 c = tex(uv); float s = 0.0; for (int i = 0; i < 20; i++) { float fi = float(i); float h = hash11(fi * 1.7 + u_seed); vec2 p = vec2(hash11(fi * 3.1 + u_seed), hash11(fi * 5.3 + u_seed)); float tw = pow(0.5 + 0.5 * sin(u_time * u_p[2] * (2.0 + h * 3.0) + fi), 6.0); vec2 d = (uv - p) * vec2(u_res.x / u_res.y, 1.0); float r = 0.012 * u_p[1]; float star = (1.0 - smoothstep(0.0, r * 0.25, abs(d.x))) * (1.0 - smoothstep(0.0, r, abs(d.y))) + (1.0 - smoothstep(0.0, r * 0.25, abs(d.y))) * (1.0 - smoothstep(0.0, r, abs(d.x))); s += star * tw * step(fi / 20.0, u_p[0]); } c.rgb += vec3(1.0, 0.98, 0.9) * s * c.a; return c; }`, ['glitter', 'shine', 'overlay']),
];
