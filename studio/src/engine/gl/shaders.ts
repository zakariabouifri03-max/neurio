/** GLSL sources for the core passes. Effects and transitions live in the library registries. */

export const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const GLSL_COMMON = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float noise2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<4;i++){ v+=a*noise2(p); p*=2.03; a*=0.5;} return v; }
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec4 unpremul(vec4 c){ return c.a > 0.0001 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 premul(vec4 c){ return vec4(c.rgb * c.a, c.a); }
`;

export const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_tex; uniform float u_flipY;
void main(){ vec2 uv = v_uv; if(u_flipY > 0.5) uv.y = 1.0 - uv.y; outColor = texture(u_tex, uv); }`;

export const SOLID_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor; uniform vec4 u_color;
void main(){ outColor = u_color; }`;

/**
 * Combined color pipeline: basic adjustments, white balance, HSL, curves (via 256x4 LUT texture),
 * color wheels, 3D LUT, sharpen/clarity, fade, vignette, grain. Operates on premultiplied input.
 */
export const ADJUST_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_tex;
uniform sampler2D u_curves;     // 256 x 1, rgba = master,r,g,b curve
uniform highp sampler3D u_lut;
uniform vec2 u_res;
uniform float u_time;
// basic
uniform float u_brightness, u_contrast, u_saturation, u_exposure, u_highlights, u_shadows;
uniform float u_temperature, u_tint, u_sharpness, u_clarity, u_vibrance, u_fade, u_vignette, u_grain, u_whites, u_blacks;
uniform float u_useCurves, u_lutAmount, u_useHSL, u_useWheels;
uniform vec3 u_hslHue[8];   // not used directly; we pass packed arrays below
uniform float u_hsl[24];    // 8 bands * (hue, sat, lum)
uniform vec4 u_wheelS, u_wheelM, u_wheelH; // rgb offset, lum
${GLSL_COMMON}

vec3 applyHSL(vec3 c){
  vec3 hsv = rgb2hsv(c);
  float h = hsv.x * 360.0;
  // band centers: red 0, orange 30, yellow 60, green 120, aqua 180, blue 240, purple 280, magenta 320
  float centers[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);
  float dh = 0.0, ds = 0.0, dl = 0.0; float wsum = 0.0;
  for(int i=0;i<8;i++){
    float d = abs(mod(h - centers[i] + 180.0, 360.0) - 180.0);
    float w = max(0.0, 1.0 - d / 45.0);
    w *= w;
    dh += w * u_hsl[i*3]; ds += w * u_hsl[i*3+1]; dl += w * u_hsl[i*3+2]; wsum += w;
  }
  if (wsum > 0.0){ dh /= wsum; ds /= wsum; dl /= wsum; }
  float m = smoothstep(0.0, 0.25, hsv.y); // only affect saturated pixels
  hsv.x = fract(hsv.x + dh * m * 0.1);
  hsv.y = clamp(hsv.y * (1.0 + ds * m), 0.0, 1.0);
  hsv.z = clamp(hsv.z * (1.0 + dl * m * 0.6), 0.0, 1.0);
  return hsv2rgb(hsv);
}

vec3 applyWheels(vec3 c){
  float l = luma(c);
  float ws = 1.0 - smoothstep(0.0, 0.5, l);
  float wh = smoothstep(0.5, 1.0, l);
  float wm = 1.0 - ws - wh;
  c += (u_wheelS.rgb * 0.3 + u_wheelS.a * 0.2) * ws;
  c += (u_wheelM.rgb * 0.3 + u_wheelM.a * 0.2) * wm;
  c += (u_wheelH.rgb * 0.3 + u_wheelH.a * 0.2) * wh;
  return c;
}

void main(){
  vec4 src = texture(u_tex, v_uv);
  vec4 up = unpremul(src);
  vec3 c = up.rgb;
  vec2 px = 1.0 / u_res;

  // Sharpness / clarity (unsharp mask at different radii)
  if (u_sharpness != 0.0 || u_clarity != 0.0){
    vec3 blur1 = vec3(0.0);
    blur1 += unpremul(texture(u_tex, v_uv + px * vec2(1,0))).rgb; blur1 += unpremul(texture(u_tex, v_uv - px * vec2(1,0))).rgb;
    blur1 += unpremul(texture(u_tex, v_uv + px * vec2(0,1))).rgb; blur1 += unpremul(texture(u_tex, v_uv - px * vec2(0,1))).rgb;
    blur1 *= 0.25;
    c += (c - blur1) * u_sharpness * 1.5;
    if (u_clarity != 0.0){
      vec3 blur2 = vec3(0.0); float r = 6.0;
      for(int i=-2;i<=2;i++) for(int j=-2;j<=2;j++) blur2 += unpremul(texture(u_tex, v_uv + px * vec2(float(i), float(j)) * r)).rgb;
      blur2 /= 25.0;
      float lm = luma(c); float lb = luma(blur2);
      float mid = 1.0 - abs(lm * 2.0 - 1.0);
      c += (lm - lb) * u_clarity * 1.2 * mid;
    }
  }

  // exposure (stops) & white balance
  c *= pow(2.0, u_exposure);
  c += vec3(u_temperature * 0.1, u_tint * 0.08, -u_temperature * 0.1);
  c += u_tint * vec3(0.03, -0.06, 0.03);
  // brightness
  c += u_brightness * 0.5;
  // contrast around mid grey
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  // highlights / shadows / whites / blacks
  float l = luma(c);
  float hw = smoothstep(0.5, 1.0, l);
  float sw = 1.0 - smoothstep(0.0, 0.5, l);
  c += u_highlights * 0.4 * hw * (1.0 - l);
  c += u_shadows * 0.4 * sw * (1.0 - l);
  c = c * (1.0 + u_whites * 0.25 * hw);
  c = c - u_blacks * -0.25 * sw;
  // saturation / vibrance
  l = luma(c);
  float sat = length(c - vec3(l));
  c = mix(vec3(l), c, 1.0 + u_saturation);
  c = mix(vec3(l), c, 1.0 + u_vibrance * (1.0 - clamp(sat * 1.5, 0.0, 1.0)));
  if (u_useHSL > 0.5) c = applyHSL(clamp(c, 0.0, 1.0));
  if (u_useWheels > 0.5) c = applyWheels(c);
  // curves
  if (u_useCurves > 0.5){
    c = clamp(c, 0.0, 1.0);
    c.r = texture(u_curves, vec2(c.r, 0.5)).r; c.g = texture(u_curves, vec2(c.g, 0.5)).r; c.b = texture(u_curves, vec2(c.b, 0.5)).r;
    c.r = texture(u_curves, vec2(c.r, 0.5)).g; c.g = texture(u_curves, vec2(c.g, 0.5)).b; c.b = texture(u_curves, vec2(c.b, 0.5)).a;
  }
  // 3D LUT
  if (u_lutAmount > 0.0){
    vec3 lc = texture(u_lut, clamp(c, 0.0, 1.0) * (31.0/32.0) + (0.5/32.0)).rgb;
    c = mix(c, lc, u_lutAmount);
  }
  // fade (lifted blacks)
  c = mix(c, c * 0.8 + 0.15, u_fade);
  // vignette
  if (u_vignette != 0.0){
    vec2 d = v_uv - 0.5; float v = smoothstep(0.9, 0.2, length(d) * 1.1);
    c = mix(c, c * mix(1.0, v, u_vignette), u_vignette > 0.0 ? 1.0 : 0.0);
    if (u_vignette < 0.0) c = mix(c, c + (1.0 - v) * -u_vignette, 1.0);
  }
  // grain
  if (u_grain > 0.0){
    float g = hash12(v_uv * u_res + fract(u_time * 13.7) * 100.0) - 0.5;
    c += g * u_grain * 0.35 * (1.0 - abs(luma(c) * 2.0 - 1.0) * 0.5);
  }
  outColor = premul(vec4(clamp(c, 0.0, 1.0), up.a));
}`;

/** Chroma key + segmentation matte + geometric mask applied to alpha. */
export const MATTE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_tex;
uniform sampler2D u_segMask;
uniform float u_useSeg;
uniform float u_segBlur;        // background blur strength
uniform vec4 u_segColor;        // background color (a=0 => transparent)
uniform sampler2D u_segImage; uniform float u_useSegImage;
uniform vec2 u_res;
// chroma
uniform float u_chroma; uniform vec3 u_keyColor; uniform float u_strength, u_smooth, u_spill, u_edge, u_shadow;
// mask
uniform float u_maskOn; uniform int u_maskShape; uniform vec2 u_maskCenter, u_maskSize; uniform float u_maskRot, u_feather, u_maskOpacity, u_roundness, u_invert;
uniform vec2 u_maskPts[64]; uniform int u_maskPtCount;
uniform float u_aspect;
${GLSL_COMMON}

vec2 toYCbCr(vec3 c){ return vec2(-0.1687*c.r - 0.3313*c.g + 0.5*c.b, 0.5*c.r - 0.4187*c.g - 0.0813*c.b); }

float sdRoundBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r; }
float sdStar(vec2 p, float r){ float an = 3.141593/5.0; float en = 3.141593/3.0; vec2 acs = vec2(cos(an), sin(an)); vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0*an) - an; p = length(p)*vec2(cos(bn), abs(sin(bn))); p -= r*acs; p += ecs*clamp(-dot(p, ecs), 0.0, r*acs.y/ecs.y); return length(p)*sign(p.x); }
float sdHeart(vec2 p){ p.y = -p.y + 0.5; p.x = abs(p.x); if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0)/4.0;
  return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5*max(p.x + p.y, 0.0), p - 0.5*max(p.x + p.y, 0.0)))) * sign(p.x - p.y); }
float sdTriangle(vec2 p, float r){ const float k = sqrt(3.0); p.x = abs(p.x) - r; p.y = p.y + r/k; if (p.x + k*p.y > 0.0) p = vec2(p.x - k*p.y, -k*p.x - p.y)/2.0; p.x -= clamp(p.x, -2.0*r, 0.0); return -length(p)*sign(p.y); }
float sdHex(vec2 p, float r){ const vec3 k = vec3(-0.866025404, 0.5, 0.577350269); p = abs(p); p -= 2.0*min(dot(k.xy, p), 0.0)*k.xy; p -= vec2(clamp(p.x, -k.z*r, k.z*r), r); return length(p)*sign(p.y); }
float sdPolygon(vec2 p){ float d = dot(p - u_maskPts[0], p - u_maskPts[0]); float s = 1.0;
  for(int i=0, j=u_maskPtCount-1; i<u_maskPtCount; j=i, i++){ if(i>=64) break; vec2 e = u_maskPts[j] - u_maskPts[i]; vec2 w = p - u_maskPts[i];
    vec2 b = w - e*clamp(dot(w,e)/dot(e,e), 0.0, 1.0); d = min(d, dot(b,b)); bvec3 c = bvec3(p.y >= u_maskPts[i].y, p.y < u_maskPts[j].y, e.x*w.y > e.y*w.x); if(all(c) || all(not(c))) s *= -1.0; }
  return s*sqrt(d); }

float maskValue(vec2 uv){
  vec2 p = uv - 0.5 - u_maskCenter;
  p.x *= u_aspect; // to square space
  float cr = cos(-u_maskRot), sr = sin(-u_maskRot);
  p = vec2(p.x*cr - p.y*sr, p.x*sr + p.y*cr);
  vec2 hs = u_maskSize * 0.5; hs.x *= u_aspect;
  float d;
  if (u_maskShape == 0) d = sdRoundBox(p, hs, min(hs.x, hs.y) * u_roundness);
  else if (u_maskShape == 1) { vec2 q = p / max(hs, vec2(0.0001)); d = (length(q) - 1.0) * min(hs.x, hs.y); }
  else if (u_maskShape == 2) { d = -p.y; }
  else if (u_maskShape == 3) { d = sdPolygon(p / vec2(u_aspect, 1.0)) ; }
  else if (u_maskShape == 4) d = sdStar(p / hs.x, 1.0) * hs.x;
  else if (u_maskShape == 5) d = sdHeart(p / hs.y) * hs.y;
  else if (u_maskShape == 6) d = sdTriangle(p / hs.x, 1.0) * hs.x;
  else d = sdHex(p / hs.x, 1.0) * hs.x;
  float f = max(u_feather * 0.5, 0.0005);
  float m = 1.0 - smoothstep(-f, f, d);
  if (u_invert > 0.5) m = 1.0 - m;
  return mix(1.0, m, u_maskOpacity);
}

void main(){
  vec4 src = unpremul(texture(u_tex, v_uv));
  vec3 c = src.rgb; float a = src.a;

  if (u_chroma > 0.5){
    vec2 cc = toYCbCr(c); vec2 kc = toYCbCr(u_keyColor);
    float d = distance(cc, kc);
    float lo = u_strength * 0.45; float hi = lo + u_smooth * 0.4 + u_edge * 0.2 + 0.001;
    float k = smoothstep(lo, hi, d);
    // shadow preservation: darker key-coloured pixels keep some alpha
    float lum = luma(c); float keyLum = luma(u_keyColor);
    float shadowKeep = u_shadow * (1.0 - smoothstep(0.0, keyLum * 0.8, lum)) * (1.0 - k);
    k = clamp(k + shadowKeep * 0.6, 0.0, 1.0);
    // spill suppression
    if (u_spill > 0.0){
      float gDom = max(0.0, c.g - max(c.r, c.b));
      float bDom = max(0.0, c.b - max(c.r, c.g));
      float dom = u_keyColor.g > u_keyColor.b ? gDom : bDom;
      vec3 sup = c; if (u_keyColor.g > u_keyColor.b) sup.g -= dom; else sup.b -= dom;
      c = mix(c, sup, u_spill * (1.0 - smoothstep(0.0, 0.4, d)));
    }
    a *= k;
  }

  if (u_useSeg > 0.5){
    float m = texture(u_segMask, v_uv).r;
    if (u_useSegImage > 0.5){
      vec3 bg = texture(u_segImage, v_uv).rgb;
      c = mix(bg, c, m);
    } else if (u_segBlur > 0.0){
      vec3 bl = vec3(0.0); float r = u_segBlur * 12.0; vec2 px = 1.0 / u_res;
      for(int i=-3;i<=3;i++) for(int j=-3;j<=3;j++) bl += unpremul(texture(u_tex, v_uv + px * vec2(float(i), float(j)) * r)).rgb;
      bl /= 49.0;
      c = mix(bl, c, m);
    } else if (u_segColor.a > 0.0){
      c = mix(u_segColor.rgb, c, m);
    } else {
      a *= m;
    }
  }

  if (u_maskOn > 0.5) a *= maskValue(v_uv);
  outColor = premul(vec4(c, a));
}`;

/** Composite a transformed layer onto the backdrop with blend modes. All textures premultiplied. */
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_backdrop;
uniform sampler2D u_layer;
uniform mat3 u_invTransform;   // output uv -> layer uv
uniform vec4 u_crop;           // l, t, r, b (fractions)
uniform float u_opacity;
uniform int u_blend;
uniform vec2 u_flip;
${GLSL_COMMON}

vec3 blendMode(vec3 b, vec3 s, int mode){
  if (mode == 1) return b * s;
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (mode == 3) return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, b));
  if (mode == 4) return min(b + s, 1.0);
  if (mode == 5) return min(b, s);
  if (mode == 6) return max(b, s);
  if (mode == 7) return abs(b - s);
  if (mode == 8) return mix(2.0*b*s + b*b*(1.0-2.0*s), sqrt(b)*(2.0*s-1.0) + 2.0*b*(1.0-s), step(0.5, s));
  if (mode == 9) return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, s));
  return s;
}

void main(){
  vec4 bd = texture(u_backdrop, v_uv);
  vec3 p = u_invTransform * vec3(v_uv, 1.0);
  vec2 luv = p.xy;
  if (u_flip.x > 0.5) luv.x = 1.0 - luv.x;
  if (u_flip.y > 0.5) luv.y = 1.0 - luv.y;
  if (luv.x < u_crop.x || luv.x > 1.0 - u_crop.z || luv.y < u_crop.y || luv.y > 1.0 - u_crop.w){ outColor = bd; return; }
  vec4 s = texture(u_layer, luv) * u_opacity;
  if (u_blend == 0){ outColor = s + bd * (1.0 - s.a); return; }
  vec4 su = unpremul(s); vec4 bu = unpremul(bd);
  vec3 bl = blendMode(bu.rgb, su.rgb, u_blend);
  vec3 col = mix(su.rgb, bl, bu.a);
  vec4 res = vec4(col * su.a, su.a);
  outColor = res + bd * (1.0 - su.a);
}`;

/** Draw a texture scaled/translated — used for simple stabilisation translation and output scaling. */
export const TRANSFORM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_tex; uniform mat3 u_inv;
void main(){ vec3 p = u_inv * vec3(v_uv, 1.0); if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0){ outColor = vec4(0.0); return; } outColor = texture(u_tex, p.xy); }`;

export function effectShader(body: string): string {
  return `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;      // clip-relative seconds
uniform float u_progress;  // 0..1 through the clip
uniform float u_seed;
uniform float u_p[12];
${GLSL_COMMON}
vec4 tex(vec2 uv){ return texture(u_tex, clamp(uv, 0.0, 1.0)); }
vec4 texU(vec2 uv){ return unpremul(texture(u_tex, clamp(uv, 0.0, 1.0))); }
${body}
void main(){ outColor = effect(v_uv); }`;
}

export function transitionShader(body: string): string {
  return `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_from; uniform sampler2D u_to;
uniform float u_progress; uniform vec2 u_res; uniform float u_p[8];
${GLSL_COMMON}
vec4 getFrom(vec2 uv){ return texture(u_from, clamp(uv, 0.0, 1.0)); }
vec4 getTo(vec2 uv){ return texture(u_to, clamp(uv, 0.0, 1.0)); }
${body}
void main(){ outColor = transition(v_uv, u_progress); }`;
}
