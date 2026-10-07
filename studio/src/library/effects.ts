/**
 * Effect registry. Each effect is a single full-screen GLSL pass with up to 12 numeric
 * parameters (u_p[i], in declaration order). Add new effects by appending to the list.
 */
import { EFFECTS_EXTRA } from './effectsExtra';

export interface EffectParam {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}
export interface EffectDef {
  id: string;
  name: string;
  category: EffectCategory;
  icon: string;
  params: EffectParam[];
  glsl: string; // defines vec4 effect(vec2 uv)
  tags?: string[];
}
export type EffectCategory =
  | 'Glitch'
  | 'Retro'
  | 'Cinematic'
  | 'Blur'
  | 'Motion'
  | 'Light'
  | 'Distortion'
  | 'Stylize'
  | 'Neon'
  | 'Horror'
  | 'Gaming'
  | 'Social'
  | 'Color'
  | 'Texture'
  | 'Basic';

const P = (key: string, label: string, min: number, max: number, def: number, step?: number): EffectParam => ({ key, label, min, max, default: def, step });

const EFFECTS_CORE: EffectDef[] = [
  // ---------------- Glitch ----------------
  {
    id: 'glitch',
    name: 'Glitch',
    category: 'Glitch',
    icon: '⚡',
    params: [P('intensity', 'Intensity', 0, 1, 0.5), P('speed', 'Speed', 0, 4, 1), P('blocks', 'Block size', 2, 40, 12), P('color', 'Color split', 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){
      float t = floor(u_time * 12.0 * u_p[1]);
      float row = floor(uv.y * u_p[2]);
      float r = hash12(vec2(row, t));
      float shift = (r - 0.5) * 0.3 * u_p[0] * step(0.6, hash12(vec2(row * 3.1, t + 7.0)));
      vec2 o = vec2(shift, 0.0);
      float cs = u_p[3] * 0.02 * u_p[0];
      vec4 c = tex(uv + o);
      c.r = tex(uv + o + vec2(cs, 0.0)).r; c.b = tex(uv + o - vec2(cs, 0.0)).b;
      float blockN = hash12(vec2(floor(uv.x * 8.0), row + t));
      if (blockN > 1.0 - u_p[0] * 0.15) c.rgb = c.rgb * 0.3 + vec3(hash12(uv + t)) * 0.7;
      return c; }`,
  },
  {
    id: 'rgbsplit',
    name: 'RGB Split',
    category: 'Glitch',
    icon: '🔴',
    params: [P('amount', 'Amount', 0, 1, 0.3), P('angle', 'Angle', 0, 360, 0, 1), P('animate', 'Animate', 0, 1, 0)],
    glsl: `vec4 effect(vec2 uv){ float a = radians(u_p[1]); float am = u_p[0] * 0.03 * (1.0 + u_p[2] * sin(u_time * 10.0));
      vec2 d = vec2(cos(a), sin(a)) * am; vec4 c = tex(uv); c.r = tex(uv + d).r; c.b = tex(uv - d).b; return c; }`,
  },
  {
    id: 'chromatic',
    name: 'Chromatic Aberration',
    category: 'Glitch',
    icon: '🌈',
    params: [P('amount', 'Amount', 0, 1, 0.4), P('falloff', 'Edge falloff', 0, 1, 0.7)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5); float f = mix(1.0, dot(d,d) * 4.0, u_p[1]); vec2 o = d * u_p[0] * 0.05 * f;
      vec4 c = tex(uv); c.r = tex(uv - o).r; c.b = tex(uv + o).b; return c; }`,
  },
  {
    id: 'digitalnoise',
    name: 'Digital Noise',
    category: 'Glitch',
    icon: '▦',
    params: [P('amount', 'Amount', 0, 1, 0.4), P('size', 'Pixel size', 1, 20, 4)],
    glsl: `vec4 effect(vec2 uv){ vec2 g = floor(uv * u_res / u_p[1]); float n = hash12(g + fract(u_time * 7.0) * 50.0);
      vec4 c = tex(uv); float m = step(1.0 - u_p[0] * 0.4, n); c.rgb = mix(c.rgb, vec3(hash12(g * 1.3 + u_time)) * c.a, m); return c; }`,
  },
  {
    id: 'datamosh',
    name: 'Datamosh',
    category: 'Glitch',
    icon: '🧩',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('blocks', 'Blocks', 4, 64, 16)],
    glsl: `vec4 effect(vec2 uv){ vec2 b = floor(uv * u_p[1]) / u_p[1]; float t = floor(u_time * 6.0);
      vec2 jump = (vec2(hash12(b + t), hash12(b * 2.0 + t)) - 0.5) * 0.2 * u_p[0] * step(0.7, hash12(b * 5.0 + t));
      vec4 c = tex(uv + jump); return c; }`,
  },
  {
    id: 'badsignal',
    name: 'Bad Signal',
    category: 'Glitch',
    icon: '📡',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('rolling', 'Rolling bar', 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ float wave = sin(uv.y * 80.0 + u_time * 20.0) * 0.003 * u_p[0];
      float bar = smoothstep(0.0, 0.15, abs(fract(uv.y - u_time * 0.3) - 0.5)) ; vec4 c = tex(uv + vec2(wave, 0.0));
      c.rgb *= mix(1.0, mix(0.6, 1.0, bar), u_p[1]); float n = hash12(uv * u_res + u_time); c.rgb += (n - 0.5) * 0.25 * u_p[0] * c.a; return c; }`,
  },
  // ---------------- Retro ----------------
  {
    id: 'vhs',
    name: 'VHS',
    category: 'Retro',
    icon: '📼',
    params: [P('intensity', 'Intensity', 0, 1, 0.6), P('tracking', 'Tracking', 0, 1, 0.4), P('noise', 'Noise', 0, 1, 0.4), P('bleed', 'Color bleed', 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){
      float tr = u_p[1] * 0.01 * sin(uv.y * 30.0 + u_time * 3.0) * step(0.8, noise2(vec2(u_time * 2.0, uv.y * 10.0)));
      uv.x += tr;
      vec4 c = tex(uv);
      float bl = u_p[3] * 0.008;
      c.r = tex(uv + vec2(bl, 0.0)).r; c.b = tex(uv - vec2(bl, 0.0)).b;
      float lines = sin(uv.y * u_res.y * 1.5) * 0.5 + 0.5;
      c.rgb *= mix(1.0, 0.75 + 0.25 * lines, u_p[0]);
      float n = hash12(uv * u_res + fract(u_time * 23.0) * 100.0);
      c.rgb += (n - 0.5) * u_p[2] * 0.3 * c.a;
      // bottom tape wobble band
      float band = smoothstep(0.08, 0.0, uv.y) * u_p[0];
      c.rgb = mix(c.rgb, vec3(hash12(vec2(uv.y * 400.0, u_time))) * c.a, band * 0.6);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.05, 0.95, 1.1), u_p[0]);
      c.rgb = mix(c.rgb, vec3(luma(c.rgb)), 0.2 * u_p[0]);
      return c; }`,
  },
  {
    id: 'scanlines',
    name: 'Scanlines',
    category: 'Retro',
    icon: '≡',
    params: [P('density', 'Density', 50, 600, 240, 1), P('strength', 'Strength', 0, 1, 0.5), P('roll', 'Roll speed', 0, 5, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); float s = sin((uv.y + u_time * u_p[2] * 0.1) * u_p[0] * 3.14159) * 0.5 + 0.5; c.rgb *= 1.0 - u_p[1] * (1.0 - s) * 0.8; return c; }`,
  },
  {
    id: 'crt',
    name: 'CRT Monitor',
    category: 'Retro',
    icon: '🖥️',
    params: [P('curvature', 'Curvature', 0, 1, 0.3), P('scanlines', 'Scanlines', 0, 1, 0.5), P('vignette', 'Vignette', 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r2 = dot(d,d); vec2 cuv = uv + d * r2 * u_p[0] * 0.5;
      if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) return vec4(0.0);
      vec4 c = tex(cuv); float s = sin(cuv.y * u_res.y * 1.2) * 0.5 + 0.5; c.rgb *= 1.0 - u_p[1] * (1.0 - s) * 0.6;
      c.rgb *= 1.0 - u_p[2] * smoothstep(0.2, 0.7, length(d)) ; c.r = tex(cuv + vec2(0.0015, 0.0)).r * (1.0 - u_p[1] * (1.0 - s) * 0.6); return c; }`,
  },
  {
    id: 'film',
    name: 'Film Grain',
    category: 'Retro',
    icon: '🎞️',
    params: [P('grain', 'Grain', 0, 1, 0.4), P('scratches', 'Scratches', 0, 1, 0.3), P('flicker', 'Flicker', 0, 1, 0.3), P('warmth', 'Warmth', 0, 1, 0.4)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv);
      float g = hash12(uv * u_res * 0.7 + fract(u_time * 17.0) * 100.0) - 0.5; c.rgb += g * u_p[0] * 0.3 * c.a;
      float sx = hash11(floor(u_time * 24.0)); float scratch = smoothstep(0.002, 0.0, abs(uv.x - sx)) * step(0.7, hash11(floor(u_time * 24.0) + 3.0)) * u_p[1];
      c.rgb += scratch * 0.6 * c.a;
      float fl = 1.0 + (hash11(floor(u_time * 24.0)) - 0.5) * 0.2 * u_p[2]; c.rgb *= fl;
      c.rgb = mix(c.rgb, c.rgb * vec3(1.08, 1.0, 0.86) + vec3(0.02, 0.01, 0.0) * c.a, u_p[3]);
      return c; }`,
  },
  {
    id: 'sepia',
    name: 'Vintage Sepia',
    category: 'Retro',
    icon: '🟤',
    params: [P('amount', 'Amount', 0, 1, 0.8), P('vignette', 'Vignette', 0, 1, 0.4)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 s = vec3(dot(c.rgb, vec3(0.393, 0.769, 0.189)), dot(c.rgb, vec3(0.349, 0.686, 0.168)), dot(c.rgb, vec3(0.272, 0.534, 0.131)));
      c.rgb = mix(c.rgb, s, u_p[0]); c.rgb *= 1.0 - u_p[1] * smoothstep(0.3, 0.8, length(uv - 0.5)); return premul(c); }`,
  },
  {
    id: 'oldtv',
    name: '8mm Projector',
    category: 'Retro',
    icon: '📽️',
    params: [P('jitter', 'Jitter', 0, 1, 0.4), P('dust', 'Dust', 0, 1, 0.4), P('fade', 'Fade', 0, 1, 0.4)],
    glsl: `vec4 effect(vec2 uv){ float f = floor(u_time * 18.0); vec2 j = (vec2(hash11(f), hash11(f + 9.0)) - 0.5) * 0.01 * u_p[0]; vec4 c = tex(uv + j);
      float d = step(0.995 - u_p[1] * 0.004, hash12(floor((uv + j) * 200.0) + f)); c.rgb = mix(c.rgb, vec3(0.1) * c.a, d);
      c.rgb = mix(c.rgb, (c.rgb * 0.8 + vec3(0.12, 0.09, 0.05) * c.a), u_p[2]); float edge = smoothstep(0.0, 0.3, 1.0 - length((uv - 0.5) * vec2(1.4, 1.0)) * 1.1);
      c.rgb *= mix(1.0, edge, 0.6); return c; }`,
  },
  // ---------------- Cinematic ----------------
  {
    id: 'letterbox',
    name: 'Letterbox',
    category: 'Cinematic',
    icon: '▬',
    params: [P('ratio', 'Aspect', 1.33, 3, 2.39, 0.01), P('softness', 'Softness', 0, 0.05, 0, 0.001)],
    glsl: `vec4 effect(vec2 uv){ float frameRatio = u_res.x / u_res.y; float h = frameRatio / u_p[0]; float bar = (1.0 - h) * 0.5;
      float m = smoothstep(bar - u_p[1], bar + u_p[1], uv.y) * smoothstep(bar - u_p[1], bar + u_p[1], 1.0 - uv.y); if (h >= 1.0) m = 1.0;
      vec4 c = tex(uv); return vec4(c.rgb * m, max(c.a, 1.0 - m)); }`,
  },
  {
    id: 'tealorange',
    name: 'Teal & Orange',
    category: 'Cinematic',
    icon: '🎬',
    params: [P('amount', 'Amount', 0, 1, 0.6), P('contrast', 'Contrast', 0, 1, 0.3)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 teal = vec3(0.0, 0.5, 0.6); vec3 orange = vec3(1.0, 0.55, 0.2);
      vec3 g = mix(teal, orange, smoothstep(0.2, 0.8, l)); vec3 o = mix(c.rgb, c.rgb * 0.6 + g * l * 0.6, u_p[0]); o = (o - 0.5) * (1.0 + u_p[1] * 0.5) + 0.5; c.rgb = clamp(o, 0.0, 1.0); return premul(c); }`,
  },
  {
    id: 'bleach',
    name: 'Bleach Bypass',
    category: 'Cinematic',
    icon: '🌫️',
    params: [P('amount', 'Amount', 0, 1, 0.7)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 bl = vec3(l); vec3 ov = mix(2.0 * c.rgb * bl, 1.0 - 2.0 * (1.0 - c.rgb) * (1.0 - bl), step(0.5, l));
      c.rgb = mix(c.rgb, ov, u_p[0]); return premul(c); }`,
  },
  {
    id: 'dreamglow',
    name: 'Dream Glow',
    category: 'Cinematic',
    icon: '✨',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('radius', 'Radius', 1, 30, 10), P('threshold', 'Threshold', 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec3 bl = vec3(0.0); vec2 px = u_p[1] / u_res; float w = 0.0;
      for(int i=-3;i<=3;i++) for(int j=-3;j<=3;j++){ float g = exp(-float(i*i+j*j) / 6.0); vec3 s = tex(uv + px * vec2(float(i), float(j))).rgb; bl += max(s - u_p[2], 0.0) * g; w += g; }
      bl /= w; c.rgb += bl * u_p[0] * 1.5; return c; }`,
  },
  {
    id: 'anamorphic',
    name: 'Anamorphic Flare',
    category: 'Cinematic',
    icon: '🔵',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('threshold', 'Threshold', 0, 1, 0.7), P('length', 'Length', 0.05, 1, 0.4)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec3 fl = vec3(0.0); int N = 24; for(int i=0;i<N;i++){ float o = (float(i) / float(N-1) - 0.5) * u_p[2]; vec3 s = tex(vec2(uv.x + o, uv.y)).rgb;
      fl += max(s - u_p[1], 0.0) * (1.0 - abs(o) / (u_p[2] * 0.5 + 1e-3)); } fl /= float(N) * 0.3; c.rgb += fl * vec3(0.3, 0.5, 1.0) * u_p[0] * 2.0; return c; }`,
  },
  {
    id: 'halation',
    name: 'Halation',
    category: 'Cinematic',
    icon: '🔆',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('radius', 'Radius', 1, 20, 6)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec3 bl = vec3(0.0); vec2 px = u_p[1] / u_res; for(int i=-2;i<=2;i++) for(int j=-2;j<=2;j++) bl += max(tex(uv + px * vec2(float(i), float(j))).rgb - 0.6, 0.0);
      bl /= 25.0; c.rgb += bl * vec3(1.0, 0.3, 0.1) * u_p[0] * 2.0; return c; }`,
  },
  // ---------------- Blur ----------------
  {
    id: 'blur',
    name: 'Gaussian Blur',
    category: 'Blur',
    icon: '◌',
    params: [P('radius', 'Radius', 0, 40, 8)],
    glsl: `vec4 effect(vec2 uv){ vec4 acc = vec4(0.0); float w = 0.0; vec2 px = u_p[0] / u_res / 3.0;
      for(int i=-3;i<=3;i++) for(int j=-3;j<=3;j++){ float g = exp(-float(i*i+j*j) / 5.0); acc += tex(uv + px * vec2(float(i), float(j))) * g; w += g; } return acc / w; }`,
  },
  {
    id: 'motionblur',
    name: 'Motion Blur',
    category: 'Blur',
    icon: '💨',
    params: [P('amount', 'Amount', 0, 1, 0.3), P('angle', 'Angle', 0, 360, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ float a = radians(u_p[1]); vec2 d = vec2(cos(a), sin(a)) * u_p[0] * 0.08; vec4 acc = vec4(0.0); const int N = 16;
      for(int i=0;i<N;i++){ float t = float(i) / float(N-1) - 0.5; acc += tex(uv + d * t); } return acc / float(N); }`,
  },
  {
    id: 'radialblur',
    name: 'Radial Blur',
    category: 'Blur',
    icon: '🌀',
    params: [P('amount', 'Amount', 0, 1, 0.3), P('cx', 'Center X', 0, 1, 0.5), P('cy', 'Center Y', 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 c = vec2(u_p[1], u_p[2]); vec2 d = (uv - c) * u_p[0] * 0.15; vec4 acc = vec4(0.0); const int N = 16;
      for(int i=0;i<N;i++){ acc += tex(uv - d * float(i) / float(N)); } return acc / float(N); }`,
  },
  {
    id: 'tiltshift',
    name: 'Tilt Shift',
    category: 'Blur',
    icon: '🏙️',
    params: [P('focus', 'Focus position', 0, 1, 0.5), P('width', 'Focus width', 0.05, 0.6, 0.25), P('blur', 'Blur', 0, 30, 10)],
    glsl: `vec4 effect(vec2 uv){ float m = smoothstep(0.0, u_p[1], abs(uv.y - u_p[0])); vec2 px = u_p[2] * m / u_res / 2.0; vec4 acc = vec4(0.0); float w = 0.0;
      for(int i=-2;i<=2;i++) for(int j=-2;j<=2;j++){ float g = exp(-float(i*i+j*j) / 3.0); acc += tex(uv + px * vec2(float(i), float(j))) * g; w += g; } return acc / w; }`,
  },
  {
    id: 'pixelate',
    name: 'Pixelate',
    category: 'Stylize',
    icon: '👾',
    params: [P('size', 'Pixel size', 1, 80, 12)],
    glsl: `vec4 effect(vec2 uv){ vec2 s = u_p[0] / u_res; vec2 q = (floor(uv / s) + 0.5) * s; return tex(q); }`,
  },
  // ---------------- Motion ----------------
  {
    id: 'shake',
    name: 'Camera Shake',
    category: 'Motion',
    icon: '📳',
    params: [P('amount', 'Amount', 0, 1, 0.4), P('speed', 'Speed', 0.5, 20, 8), P('rotation', 'Rotation', 0, 1, 0.2)],
    glsl: `vec4 effect(vec2 uv){ float t = u_time * u_p[1]; vec2 o = vec2(noise2(vec2(t, 1.3)) - 0.5, noise2(vec2(7.1, t)) - 0.5) * 0.08 * u_p[0];
      float r = (noise2(vec2(t * 0.7, 40.0)) - 0.5) * 0.1 * u_p[2] * u_p[0]; vec2 d = uv - 0.5; float cs = cos(r), sn = sin(r); d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
      float z = 1.0 + u_p[0] * 0.08; return tex(d / z + 0.5 + o); }`,
  },
  {
    id: 'zoompulse',
    name: 'Zoom Pulse',
    category: 'Motion',
    icon: '🔍',
    params: [P('amount', 'Amount', 0, 1, 0.3), P('bpm', 'BPM', 40, 200, 120, 1)],
    glsl: `vec4 effect(vec2 uv){ float beat = fract(u_time * u_p[1] / 60.0); float z = 1.0 + u_p[0] * 0.3 * exp(-beat * 6.0); return tex((uv - 0.5) / z + 0.5); }`,
  },
  {
    id: 'zoomblur',
    name: 'Zoom Burst',
    category: 'Motion',
    icon: '💥',
    params: [P('amount', 'Amount', 0, 1, 0.4)],
    glsl: `vec4 effect(vec2 uv){ vec4 acc = vec4(0.0); const int N = 14; for(int i=0;i<N;i++){ float z = 1.0 + u_p[0] * 0.5 * float(i) / float(N); acc += tex((uv - 0.5) / z + 0.5); } return acc / float(N); }`,
  },
  {
    id: 'spin',
    name: 'Spin',
    category: 'Motion',
    icon: '🔄',
    params: [P('speed', 'Speed', -4, 4, 1, 0.1), P('zoom', 'Zoom', 1, 2, 1.3, 0.01)],
    glsl: `vec4 effect(vec2 uv){ float a = u_time * u_p[0]; vec2 d = (uv - 0.5) / u_p[1]; d.x *= u_res.x / u_res.y; float cs = cos(a), sn = sin(a); d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs); d.x /= u_res.x / u_res.y; return tex(d + 0.5); }`,
  },
  {
    id: 'mirror',
    name: 'Mirror',
    category: 'Stylize',
    icon: '🪞',
    params: [P('mode', 'Mode', 0, 3, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ int m = int(u_p[0]); if (m == 0) uv.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x; else if (m == 1) uv.x = uv.x > 0.5 ? uv.x : 1.0 - uv.x; else if (m == 2) uv.y = uv.y < 0.5 ? uv.y : 1.0 - uv.y; else { uv = abs(uv - 0.5) + 0.5; } return tex(uv); }`,
  },
  {
    id: 'kaleido',
    name: 'Kaleidoscope',
    category: 'Stylize',
    icon: '🔮',
    params: [P('segments', 'Segments', 2, 16, 6, 1), P('rotation', 'Rotation', 0, 6.28, 0, 0.01)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; d.x *= u_res.x / u_res.y; float r = length(d); float a = atan(d.y, d.x) + u_p[1]; float seg = 6.2831853 / u_p[0]; a = mod(a, seg); a = abs(a - seg * 0.5);
      d = vec2(cos(a), sin(a)) * r; d.x /= u_res.x / u_res.y; return tex(d + 0.5); }`,
  },
  // ---------------- Light ----------------
  {
    id: 'flash',
    name: 'Flash',
    category: 'Light',
    icon: '⚪',
    params: [P('intensity', 'Intensity', 0, 1, 0.8), P('rate', 'Rate', 0.2, 10, 2), P('decay', 'Decay', 1, 20, 8)],
    glsl: `vec4 effect(vec2 uv){ float ph = fract(u_time * u_p[1]); float f = exp(-ph * u_p[2]) * u_p[0]; vec4 c = tex(uv); c.rgb = mix(c.rgb, vec3(c.a), f); return c; }`,
  },
  {
    id: 'lightleak',
    name: 'Light Leak',
    category: 'Light',
    icon: '🌅',
    params: [P('amount', 'Amount', 0, 1, 0.6), P('speed', 'Speed', 0, 2, 0.3), P('hue', 'Hue', 0, 1, 0.08, 0.01)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); float t = u_time * u_p[1]; vec2 p = uv * vec2(1.5, 1.0) + vec2(t * 0.2, -t * 0.1);
      float l = fbm(p * 2.0) * smoothstep(0.1, 0.9, uv.x + sin(t) * 0.3); vec3 col = hsv2rgb(vec3(u_p[2], 0.8, 1.0)); vec3 col2 = hsv2rgb(vec3(fract(u_p[2] + 0.1), 0.6, 1.0));
      c.rgb += mix(col, col2, uv.y) * l * l * u_p[0] * 1.6 * max(c.a, 0.001); return c; }`,
  },
  {
    id: 'lensflare',
    name: 'Lens Flare',
    category: 'Light',
    icon: '☀️',
    params: [P('amount', 'Amount', 0, 1, 0.6), P('x', 'Position X', 0, 1, 0.7), P('y', 'Position Y', 0, 1, 0.3), P('size', 'Size', 0.1, 2, 0.8)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec2 asp = vec2(u_res.x / u_res.y, 1.0); vec2 L = vec2(u_p[1], u_p[2]); vec2 d = (uv - L) * asp; float r = length(d) / u_p[3];
      float core = exp(-r * r * 12.0) + 0.25 * exp(-r * 3.0); float ang = atan(d.y, d.x); float rays = pow(abs(sin(ang * 6.0 + u_time * 0.2)), 12.0) * exp(-r * 2.5) * 0.5;
      vec2 mid = (vec2(0.5) - L); vec3 ghosts = vec3(0.0); for(int i=1;i<=4;i++){ vec2 g = L + mid * (float(i) * 0.6); float gr = length((uv - g) * asp) / (0.05 * float(i) + 0.02); ghosts += (1.0 - smoothstep(0.8, 1.0, gr)) * hsv2rgb(vec3(float(i) * 0.17, 0.7, 0.25)); }
      c.rgb += (vec3(1.0, 0.9, 0.75) * (core + rays) + ghosts) * u_p[0]; return c; }`,
  },
  {
    id: 'glow',
    name: 'Glow',
    category: 'Light',
    icon: '💡',
    params: [P('amount', 'Amount', 0, 2, 0.6), P('radius', 'Radius', 1, 30, 10)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec4 bl = vec4(0.0); vec2 px = u_p[1] / u_res; float w = 0.0; for(int i=-3;i<=3;i++) for(int j=-3;j<=3;j++){ float g = exp(-float(i*i+j*j)/6.0); bl += tex(uv + px * vec2(float(i), float(j))) * g; w += g; }
      bl /= w; return c + bl * u_p[0] * 0.6; }`,
  },
  {
    id: 'godrays',
    name: 'God Rays',
    category: 'Light',
    icon: '🌤️',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('x', 'Source X', 0, 1, 0.5), P('y', 'Source Y', 0, 1, 0.2), P('decay', 'Decay', 0.8, 1, 0.95, 0.005)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec2 L = vec2(u_p[1], u_p[2]); vec2 d = (uv - L) / 24.0; vec3 acc = vec3(0.0); float w = 1.0; vec2 p = uv;
      for(int i=0;i<24;i++){ p -= d; acc += max(tex(p).rgb - 0.4, 0.0) * w; w *= u_p[3]; } c.rgb += acc / 24.0 * u_p[0] * 3.0; return c; }`,
  },
  {
    id: 'strobe',
    name: 'Strobe',
    category: 'Light',
    icon: '🔦',
    params: [P('rate', 'Rate', 1, 30, 8), P('darkness', 'Darkness', 0, 1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); float on = step(0.5, fract(u_time * u_p[0])); c.rgb *= mix(1.0, on, u_p[1]); return c; }`,
  },
  // ---------------- Distortion ----------------
  {
    id: 'wave',
    name: 'Wave',
    category: 'Distortion',
    icon: '〰️',
    params: [P('amplitude', 'Amplitude', 0, 1, 0.3), P('frequency', 'Frequency', 1, 40, 10), P('speed', 'Speed', 0, 10, 2)],
    glsl: `vec4 effect(vec2 uv){ uv.x += sin(uv.y * u_p[1] + u_time * u_p[2]) * u_p[0] * 0.05; uv.y += cos(uv.x * u_p[1] * 0.7 + u_time * u_p[2]) * u_p[0] * 0.03; return tex(uv); }`,
  },
  {
    id: 'ripple',
    name: 'Ripple',
    category: 'Distortion',
    icon: '💧',
    params: [P('amount', 'Amount', 0, 1, 0.4), P('frequency', 'Frequency', 2, 60, 24), P('speed', 'Speed', 0, 10, 3)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r = length(d); float w = sin(r * u_p[1] - u_time * u_p[2]) * u_p[0] * 0.03; return tex(uv + normalize(d + 1e-5) * w); }`,
  },
  {
    id: 'fisheye',
    name: 'Fisheye',
    category: 'Distortion',
    icon: '🐟',
    params: [P('amount', 'Amount', -1, 1, 0.5, 0.01)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r = length(d); float k = 1.0 + u_p[0] * r * r * 2.0; return tex(d / k * (1.0 + u_p[0] * 0.5) + 0.5); }`,
  },
  {
    id: 'twirl',
    name: 'Twirl',
    category: 'Distortion',
    icon: '🌪️',
    params: [P('amount', 'Amount', -5, 5, 2, 0.1), P('radius', 'Radius', 0.1, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r = length(d); float a = u_p[0] * smoothstep(u_p[1], 0.0, r); float cs = cos(a), sn = sin(a); d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs); return tex(d + 0.5); }`,
  },
  {
    id: 'heatwave',
    name: 'Heat Haze',
    category: 'Distortion',
    icon: '🔥',
    params: [P('amount', 'Amount', 0, 1, 0.4), P('speed', 'Speed', 0, 5, 1.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 n = vec2(fbm(uv * 8.0 + vec2(0.0, u_time * u_p[1])), fbm(uv * 8.0 + vec2(5.2, u_time * u_p[1] * 1.3))) - 0.5; return tex(uv + n * 0.03 * u_p[0]); }`,
  },
  {
    id: 'liquid',
    name: 'Liquid',
    category: 'Distortion',
    icon: '🫧',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('scale', 'Scale', 1, 10, 3), P('speed', 'Speed', 0, 3, 0.8)],
    glsl: `vec4 effect(vec2 uv){ float t = u_time * u_p[2]; vec2 o = vec2(sin(uv.y * u_p[1] * 3.0 + t) + sin(uv.x * u_p[1] * 2.0 - t * 1.3), cos(uv.x * u_p[1] * 3.0 + t * 0.8)) * 0.02 * u_p[0]; return tex(uv + o); }`,
  },
  // ---------------- Stylize ----------------
  {
    id: 'cartoon',
    name: 'Cartoon',
    category: 'Stylize',
    icon: '🎨',
    params: [P('levels', 'Levels', 2, 12, 5, 1), P('edge', 'Edge strength', 0, 1, 0.6)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec2 px = 1.0 / u_res; float l[9]; int k = 0; for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++){ l[k++] = luma(texU(uv + px * vec2(float(j), float(i))).rgb); }
      float gx = -l[0] - 2.0*l[3] - l[6] + l[2] + 2.0*l[5] + l[8]; float gy = -l[0] - 2.0*l[1] - l[2] + l[6] + 2.0*l[7] + l[8]; float e = smoothstep(0.1, 0.4, length(vec2(gx, gy))) * u_p[1];
      vec3 hsv = rgb2hsv(c.rgb); hsv.z = floor(hsv.z * u_p[0] + 0.5) / u_p[0]; hsv.y = min(1.0, hsv.y * 1.2); c.rgb = hsv2rgb(hsv) * (1.0 - e); return premul(c); }`,
  },
  {
    id: 'comic',
    name: 'Comic Halftone',
    category: 'Stylize',
    icon: '💬',
    params: [P('dots', 'Dot size', 2, 20, 6), P('contrast', 'Contrast', 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec2 p = uv * u_res / u_p[0]; vec2 cell = fract(p) - 0.5; float l = luma(c.rgb); float d = length(cell); float dot_ = smoothstep(l * 0.7 + 0.05, l * 0.7 - 0.05, d);
      vec3 hsv = rgb2hsv(c.rgb); hsv.y = min(1.0, hsv.y * 1.5); hsv.z = floor(hsv.z * 4.0 + 0.5) / 4.0; vec3 col = hsv2rgb(hsv); col = mix(col, col * 0.2, dot_ * u_p[1]); c.rgb = col; return premul(c); }`,
  },
  {
    id: 'sketch',
    name: 'Pencil Sketch',
    category: 'Stylize',
    icon: '✏️',
    params: [P('amount', 'Amount', 0, 1, 1), P('detail', 'Detail', 0.5, 3, 1.2)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec2 px = u_p[1] / u_res; float l0 = luma(c.rgb); float gx = luma(texU(uv + vec2(px.x, 0.0)).rgb) - luma(texU(uv - vec2(px.x, 0.0)).rgb); float gy = luma(texU(uv + vec2(0.0, px.y)).rgb) - luma(texU(uv - vec2(0.0, px.y)).rgb);
      float e = 1.0 - clamp(length(vec2(gx, gy)) * 4.0, 0.0, 1.0); vec3 sk = vec3(e) * (0.7 + 0.3 * l0); c.rgb = mix(c.rgb, sk, u_p[0]); return premul(c); }`,
  },
  {
    id: 'posterize',
    name: 'Posterize',
    category: 'Stylize',
    icon: '🖼️',
    params: [P('levels', 'Levels', 2, 16, 4, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); c.rgb = floor(c.rgb * u_p[0] + 0.5) / u_p[0]; return premul(c); }`,
  },
  {
    id: 'duotone',
    name: 'Duotone',
    category: 'Stylize',
    icon: '🟣',
    params: [P('hue1', 'Shadow hue', 0, 1, 0.7, 0.01), P('hue2', 'Highlight hue', 0, 1, 0.1, 0.01), P('amount', 'Amount', 0, 1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 a = hsv2rgb(vec3(u_p[0], 0.8, 0.25)); vec3 b = hsv2rgb(vec3(u_p[1], 0.7, 1.0)); c.rgb = mix(c.rgb, mix(a, b, l), u_p[2]); return premul(c); }`,
  },
  {
    id: 'invert',
    name: 'Invert',
    category: 'Basic',
    icon: '◐',
    params: [P('amount', 'Amount', 0, 1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); c.rgb = mix(c.rgb, 1.0 - c.rgb, u_p[0]); return premul(c); }`,
  },
  {
    id: 'bw',
    name: 'Black & White',
    category: 'Basic',
    icon: '⬜',
    params: [P('amount', 'Amount', 0, 1, 1), P('red', 'Red filter', -1, 1, 0, 0.01)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = dot(c.rgb, normalize(vec3(0.3 + u_p[1] * 0.5, 0.59, 0.11 - u_p[1] * 0.1))); c.rgb = mix(c.rgb, vec3(l), u_p[0]); return premul(c); }`,
  },
  {
    id: 'watermark',
    name: 'Watermark Remover',
    category: 'Basic',
    icon: '🧽',
    tags: ['watermark', 'logo', 'remove', 'cover', 'inpaint', 'clean', 'erase'],
    params: [
      P('x', 'Region X', 0, 1, 0.75, 0.001),
      P('y', 'Region Y', 0, 1, 0.9, 0.001),
      P('w', 'Region width', 0.005, 1, 0.2, 0.001),
      P('h', 'Region height', 0.005, 1, 0.06, 0.001),
      P('feather', 'Feather', 0, 1, 0.3),
      P('mode', 'Mode (0 fill · 1 blur · 2 pixelate · 3 clone)', 0, 3, 0, 1),
      P('dx', 'Clone offset X', -0.5, 0.5, 0, 0.001),
      P('dy', 'Clone offset Y', -0.5, 0.5, -0.1, 0.001),
      P('strength', 'Strength', 0, 1, 0.6),
    ],
    glsl: `vec4 effect(vec2 uv){
      vec2 r0 = vec2(u_p[0], u_p[1]); vec2 r1 = r0 + vec2(u_p[2], u_p[3]);
      vec2 c = (r0 + r1) * 0.5; vec2 hs = (r1 - r0) * 0.5;
      vec2 dd = abs(uv - c) - hs; float outside = max(dd.x, dd.y);
      float fe = 0.002 + u_p[4] * 0.04;
      float m = 1.0 - smoothstep(-fe, 0.0015, outside);
      vec4 orig = tex(uv);
      if (m <= 0.001) return orig;
      vec4 fill = orig;
      if (u_p[5] < 0.5) {
        // content-aware fill: harmonic interpolation of the colours just outside the rectangle
        vec4 acc = vec4(0.0); float ws = 0.0;
        for (int i = 0; i < 24; i++) {
          float a = (float(i) + 0.5) / 24.0 * 6.2831853; vec2 dir = vec2(cos(a), sin(a));
          float tx = abs(dir.x) < 1e-4 ? 1e9 : (dir.x > 0.0 ? (r1.x - uv.x) : (r0.x - uv.x)) / dir.x;
          float ty = abs(dir.y) < 1e-4 ? 1e9 : (dir.y > 0.0 ? (r1.y - uv.y) : (r0.y - uv.y)) / dir.y;
          float t = max(0.0, min(tx, ty)) + 0.003;
          vec2 sp = uv + dir * t; vec2 n = vec2(-dir.y, dir.x) * 0.004;
          vec4 s = (tex(sp) + tex(sp + dir * 0.006) + tex(sp + n) + tex(sp - n)) * 0.25;
          float w = 1.0 / (t * t + 1e-5);
          acc += s * w; ws += w;
        }
        fill = acc / ws;
        float g = (hash12(uv * u_res + u_seed * 7.0) - 0.5) * 0.03 * u_p[8];
        fill.rgb = clamp(fill.rgb + g * fill.a, 0.0, 1.0);
      } else if (u_p[5] < 1.5) {
        vec4 acc = vec4(0.0); float ws = 0.0; vec2 px = (3.0 + 30.0 * u_p[8]) / u_res / 3.0;
        for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) { float g = exp(-float(i * i + j * j) / 5.0); acc += tex(uv + px * vec2(float(i), float(j))) * g; ws += g; }
        fill = acc / ws;
      } else if (u_p[5] < 2.5) {
        vec2 s = (4.0 + 40.0 * u_p[8]) / u_res; vec2 q = (floor(uv / s) + 0.5) * s; fill = tex(q);
      } else {
        fill = tex(uv + vec2(u_p[6], u_p[7]));
      }
      return mix(orig, fill, m);
    }`,
  },
  {
    id: 'thermal',
    name: 'Thermal',
    category: 'Stylize',
    icon: '🌡️',
    params: [P('amount', 'Amount', 0, 1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 t = l < 0.25 ? mix(vec3(0,0,0.3), vec3(0,0,1), l*4.0) : l < 0.5 ? mix(vec3(0,0,1), vec3(0,1,0), (l-0.25)*4.0) : l < 0.75 ? mix(vec3(0,1,0), vec3(1,1,0), (l-0.5)*4.0) : mix(vec3(1,1,0), vec3(1,0,0), (l-0.75)*4.0);
      c.rgb = mix(c.rgb, t, u_p[0]); return premul(c); }`,
  },
  {
    id: 'emboss',
    name: 'Emboss',
    category: 'Stylize',
    icon: '🪨',
    params: [P('amount', 'Amount', 0, 2, 1)],
    glsl: `vec4 effect(vec2 uv){ vec2 px = 1.0 / u_res; vec4 c = texU(uv); float a = luma(texU(uv - px).rgb); float b = luma(texU(uv + px).rgb); float e = (b - a) * 4.0 * u_p[0] + 0.5; c.rgb = mix(c.rgb, vec3(e), min(u_p[0], 1.0)); return premul(c); }`,
  },
  // ---------------- Neon ----------------
  {
    id: 'neonedges',
    name: 'Neon Edges',
    category: 'Neon',
    icon: '🟢',
    params: [P('amount', 'Amount', 0, 1, 0.8), P('hue', 'Hue', 0, 1, 0.5, 0.01), P('keep', 'Keep image', 0, 1, 0.2)],
    glsl: `vec4 effect(vec2 uv){ vec2 px = 1.5 / u_res; vec4 c = texU(uv); float gx = luma(texU(uv + vec2(px.x, 0.0)).rgb) - luma(texU(uv - vec2(px.x, 0.0)).rgb); float gy = luma(texU(uv + vec2(0.0, px.y)).rgb) - luma(texU(uv - vec2(0.0, px.y)).rgb);
      float e = clamp(length(vec2(gx, gy)) * 5.0, 0.0, 1.0); vec3 n = hsv2rgb(vec3(fract(u_p[1] + uv.x * 0.2), 1.0, 1.0)); c.rgb = mix(c.rgb * u_p[2], n * e * 1.5 + c.rgb * u_p[2], u_p[0]); return premul(c); }`,
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    category: 'Neon',
    icon: '🌃',
    params: [P('amount', 'Amount', 0, 1, 0.7), P('scan', 'Scanlines', 0, 1, 0.3)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 grade = mix(vec3(0.05, 0.0, 0.25), vec3(1.0, 0.1, 0.6), smoothstep(0.1, 0.6, l)); grade = mix(grade, vec3(0.1, 1.0, 1.0), smoothstep(0.6, 1.0, l));
      vec3 o = mix(c.rgb, c.rgb * 0.4 + grade * 0.7, u_p[0]); float s = sin(uv.y * u_res.y * 0.8) * 0.5 + 0.5; o *= 1.0 - u_p[1] * (1.0 - s) * 0.4; c.rgb = o; vec4 pc = premul(c); pc.r = premul(texU(uv + vec2(0.003 * u_p[0], 0.0))).r; return pc; }`,
  },
  {
    id: 'hologram',
    name: 'Hologram',
    category: 'Neon',
    icon: '👽',
    params: [P('amount', 'Amount', 0, 1, 0.8), P('flicker', 'Flicker', 0, 1, 0.3)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); float lines = step(0.5, fract(uv.y * 120.0 + u_time * 2.0)); float fl = 1.0 - u_p[1] * 0.3 * step(0.95, hash11(floor(u_time * 30.0)));
      vec3 h = vec3(0.2, 0.9, 1.0) * (l * 0.9 + 0.1) * (0.7 + 0.3 * lines) * fl; c.rgb = mix(c.rgb, h, u_p[0]); c.a *= mix(1.0, 0.85 + 0.15 * lines, u_p[0]); return premul(c); }`,
  },
  // ---------------- Horror ----------------
  {
    id: 'horror',
    name: 'Horror Grade',
    category: 'Horror',
    icon: '🩸',
    params: [P('amount', 'Amount', 0, 1, 0.7), P('flicker', 'Flicker', 0, 1, 0.4), P('vignette', 'Vignette', 0, 1, 0.7)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); vec3 g = mix(vec3(0.0, 0.02, 0.03), vec3(0.6, 0.65, 0.55), l); g = mix(g, vec3(0.8, 0.1, 0.05), smoothstep(0.6, 1.0, l) * 0.4);
      c.rgb = mix(c.rgb, g, u_p[0]); float fl = 1.0 - u_p[1] * 0.4 * noise2(vec2(u_time * 15.0, 0.0)); c.rgb *= fl; c.rgb *= 1.0 - u_p[2] * smoothstep(0.25, 0.75, length(uv - 0.5)); return premul(c); }`,
  },
  {
    id: 'nightvision',
    name: 'Night Vision',
    category: 'Horror',
    icon: '🥽',
    params: [P('amount', 'Amount', 0, 1, 1), P('noise', 'Noise', 0, 1, 0.4)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); float l = luma(c.rgb); l = pow(l, 0.6); float n = hash12(uv * u_res + fract(u_time * 20.0) * 100.0); vec3 nv = vec3(0.1, 1.0, 0.2) * (l + (n - 0.5) * u_p[1] * 0.4);
      float vig = 1.0 - smoothstep(0.35, 0.5, length(uv - 0.5)); c.rgb = mix(c.rgb, nv * vig, u_p[0]); return premul(c); }`,
  },
  {
    id: 'ghost',
    name: 'Ghost Trail',
    category: 'Horror',
    icon: '👻',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('offset', 'Offset', 0, 1, 0.3)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec2 o = vec2(sin(u_time * 1.3), cos(u_time * 0.9)) * 0.02 * u_p[1]; vec4 g = tex(uv + o); vec4 g2 = tex(uv - o * 1.7); c = c * (1.0 - u_p[0] * 0.5) + (g + g2) * 0.5 * u_p[0]; c.rgb = mix(c.rgb, vec3(luma(c.rgb)) * vec3(0.8, 0.9, 1.0), u_p[0] * 0.5); return c; }`,
  },
  // ---------------- Gaming ----------------
  {
    id: 'pixelart',
    name: 'Pixel Art',
    category: 'Gaming',
    icon: '🎮',
    params: [P('size', 'Pixel size', 2, 40, 8), P('palette', 'Palette levels', 2, 16, 5, 1)],
    glsl: `vec4 effect(vec2 uv){ vec2 s = u_p[0] / u_res; vec2 q = (floor(uv / s) + 0.5) * s; vec4 c = texU(q); c.rgb = floor(c.rgb * u_p[1] + 0.5) / u_p[1]; return premul(c); }`,
  },
  {
    id: 'hitmarker',
    name: 'Damage Flash',
    category: 'Gaming',
    icon: '🎯',
    params: [P('amount', 'Amount', 0, 1, 0.6), P('rate', 'Rate', 0.2, 5, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); float ph = fract(u_time * u_p[1]); float f = exp(-ph * 6.0) * u_p[0]; float vig = smoothstep(0.2, 0.8, length(uv - 0.5)); c.rgb = mix(c.rgb, vec3(1.0, 0.0, 0.0) * c.a, f * vig); return c; }`,
  },
  {
    id: 'speedlines',
    name: 'Speed Lines',
    category: 'Gaming',
    icon: '💫',
    params: [P('amount', 'Amount', 0, 1, 0.6), P('count', 'Density', 20, 200, 80, 1), P('inner', 'Inner radius', 0, 1, 0.3)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec2 d = uv - 0.5; d.x *= u_res.x / u_res.y; float a = atan(d.y, d.x); float r = length(d); float n = hash11(floor((a / 6.2831853 + 0.5) * u_p[1]) + floor(u_time * 20.0));
      float line = step(0.6, n) * smoothstep(u_p[2], u_p[2] + 0.3 + n * 0.2, r); c.rgb = mix(c.rgb, vec3(1.0) * c.a, line * u_p[0]); return c; }`,
  },
  {
    id: 'crosshatch',
    name: 'Retro Console',
    category: 'Gaming',
    icon: '🕹️',
    params: [P('size', 'Pixel size', 2, 16, 4), P('ghost', 'LCD ghosting', 0, 1, 0.3)],
    glsl: `vec4 effect(vec2 uv){ vec2 s = u_p[0] / u_res; vec2 q = (floor(uv / s) + 0.5) * s; vec4 c = texU(q); float l = luma(c.rgb); l = floor(l * 4.0 + 0.5) / 4.0; vec3 gb = mix(vec3(0.06, 0.22, 0.06), vec3(0.6, 0.74, 0.06), l);
      vec2 cell = fract(uv / s); float grid = smoothstep(0.0, 0.15, cell.x) * smoothstep(0.0, 0.15, cell.y); c.rgb = gb * mix(1.0, grid, u_p[1]); return premul(c); }`,
  },
  // ---------------- Social ----------------
  {
    id: 'beauty',
    name: 'Smooth Skin',
    category: 'Social',
    icon: '🧴',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('radius', 'Radius', 1, 10, 4)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 acc = vec3(0.0); float w = 0.0; vec2 px = u_p[1] / u_res;
      for(int i=-3;i<=3;i++) for(int j=-3;j<=3;j++){ vec3 s = texU(uv + px * vec2(float(i), float(j))).rgb; float g = exp(-float(i*i+j*j) / 8.0) * exp(-dot(s - c.rgb, s - c.rgb) * 40.0); acc += s * g; w += g; }
      acc /= w; float l = luma(c.rgb); float skin = smoothstep(0.15, 0.4, l) * (1.0 - smoothstep(0.85, 1.0, l)); c.rgb = mix(c.rgb, acc, u_p[0] * skin * 0.9); return premul(c); }`,
  },
  {
    id: 'trendy',
    name: 'Soft Aesthetic',
    category: 'Social',
    icon: '🌸',
    params: [P('amount', 'Amount', 0, 1, 0.6)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 o = c.rgb * 0.85 + 0.1; o = mix(o, o * vec3(1.05, 0.98, 1.08), 0.5); float l = luma(o); o = mix(vec3(l), o, 0.85); c.rgb = mix(c.rgb, o, u_p[0]); return premul(c); }`,
  },
  {
    id: 'sparkle',
    name: 'Sparkles',
    category: 'Social',
    icon: '🌟',
    params: [P('amount', 'Amount', 0, 1, 0.6), P('density', 'Density', 5, 60, 20, 1), P('size', 'Size', 0.5, 4, 1.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = tex(uv); vec2 asp = vec2(u_res.x / u_res.y, 1.0); vec2 g = uv * u_p[1]; vec2 id = floor(g); float ph = hash12(id); float on = 0.5 + 0.5 * sin(u_time * 3.0 + ph * 6.28);
      vec2 center = id + 0.5 + (vec2(hash12(id + 3.0), hash12(id + 7.0)) - 0.5) * 0.6; vec2 d = (g - center) * asp; float r = length(d) * (12.0 / u_p[2]); float s = (exp(-r * r) + exp(-abs(d.x) * 30.0 / u_p[2]) * exp(-abs(d.y) * 3.0) * 0.6 + exp(-abs(d.y) * 30.0 / u_p[2]) * exp(-abs(d.x) * 3.0) * 0.6) * on * step(0.5, ph);
      c.rgb += vec3(1.0, 0.95, 0.8) * s * u_p[0] * 1.2; return c; }`,
  },
  {
    id: 'vignetteblur',
    name: 'Dreamy Vignette',
    category: 'Social',
    icon: '🌙',
    params: [P('amount', 'Amount', 0, 1, 0.6), P('radius', 'Radius', 0.2, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ float m = smoothstep(u_p[1] * 0.6, u_p[1] + 0.3, length(uv - 0.5)); vec2 px = 8.0 * m * u_p[0] / u_res; vec4 acc = vec4(0.0); float w = 0.0;
      for(int i=-2;i<=2;i++) for(int j=-2;j<=2;j++){ float g = exp(-float(i*i+j*j) / 3.0); acc += tex(uv + px * vec2(float(i), float(j))) * g; w += g; } acc /= w; acc.rgb *= 1.0 - m * u_p[0] * 0.4; return acc; }`,
  },
  {
    id: 'splitscreen',
    name: 'Triple Split',
    category: 'Social',
    icon: '▥',
    params: [P('gap', 'Gap', 0, 0.05, 0.01, 0.001), P('zoom', 'Zoom', 1, 2, 1.2, 0.01)],
    glsl: `vec4 effect(vec2 uv){ float col = floor(uv.x * 3.0); float x = fract(uv.x * 3.0); if (x < u_p[0] * 3.0 || x > 1.0 - u_p[0] * 3.0) return vec4(0.0, 0.0, 0.0, 1.0); vec2 suv = (uv - 0.5) / u_p[1] + 0.5; suv.x += (col - 1.0) * 0.04; return tex(suv); }`,
  },
  {
    id: 'colorpop',
    name: 'Color Pop',
    category: 'Social',
    icon: '🎈',
    params: [P('hue', 'Keep hue', 0, 1, 0.0, 0.01), P('range', 'Range', 0.02, 0.5, 0.1), P('amount', 'Amount', 0, 1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 hsv = rgb2hsv(c.rgb); float dh = abs(mod(hsv.x - u_p[0] + 0.5, 1.0) - 0.5); float keep = 1.0 - smoothstep(u_p[1] * 0.5, u_p[1], dh); keep *= smoothstep(0.1, 0.3, hsv.y); c.rgb = mix(c.rgb, mix(vec3(luma(c.rgb)), c.rgb, keep), u_p[2]); return premul(c); }`,
  },
  {
    id: 'oldphoto',
    name: 'Faded Memory',
    category: 'Social',
    icon: '📷',
    params: [P('amount', 'Amount', 0, 1, 0.7)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = texU(uv); vec3 o = c.rgb * 0.75 + 0.18; o = mix(o, o * vec3(1.1, 1.0, 0.85), 0.6); o = mix(vec3(luma(o)), o, 0.7); o *= 1.0 - 0.4 * smoothstep(0.3, 0.9, length(uv - 0.5)); c.rgb = mix(c.rgb, o, u_p[0]); return premul(c); }`,
  },
  {
    id: 'sportsfreeze',
    name: 'Impact Zoom',
    category: 'Gaming',
    icon: '🏀',
    params: [P('amount', 'Amount', 0, 1, 0.5), P('rate', 'Rate', 0.2, 4, 1)],
    glsl: `vec4 effect(vec2 uv){ float ph = fract(u_time * u_p[1]); float z = 1.0 + u_p[0] * 0.25 * exp(-ph * 8.0); vec2 d = (uv - 0.5) / z; vec4 acc = vec4(0.0); for(int i=0;i<6;i++){ float zz = 1.0 + u_p[0] * 0.03 * float(i) * exp(-ph * 8.0); acc += tex(d / zz + 0.5); } return acc / 6.0; }`,
  },
];

/** Full registry: core effects + the extra batch (effectsExtra.ts). */
export const EFFECTS: EffectDef[] = [...EFFECTS_CORE, ...EFFECTS_EXTRA];
export const EFFECT_CATEGORIES: EffectCategory[] = ['Glitch', 'Retro', 'Cinematic', 'Color', 'Blur', 'Motion', 'Light', 'Distortion', 'Stylize', 'Texture', 'Neon', 'Horror', 'Gaming', 'Social', 'Basic'];

const byId = new Map(EFFECTS.map((e) => [e.id, e]));
export const getEffect = (id: string) => byId.get(id);
