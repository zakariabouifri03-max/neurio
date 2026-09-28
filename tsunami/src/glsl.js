// glsl.js — shared GLSL snippets (noise + analytic sky) used by custom shaders
export const NOISE = /* glsl */`
float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float hash31(vec3 p){ p = fract(p*vec3(127.1,311.7,74.7)); p += dot(p,p+34.56); return fract(p.x*p.y*p.z); }
vec3 hash33(vec3 p){ p = fract(p*vec3(127.1,311.7,74.7)); p += dot(p,p+19.19); return fract(vec3(p.x*p.y, p.y*p.z, p.z*p.x)); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n000=hash31(i), n100=hash31(i+vec3(1,0,0)), n010=hash31(i+vec3(0,1,0)), n110=hash31(i+vec3(1,1,0));
  float n001=hash31(i+vec3(0,0,1)), n101=hash31(i+vec3(1,0,1)), n011=hash31(i+vec3(0,1,1)), n111=hash31(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y), mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z);
}
float fbm2(vec2 p, int oct){
  float s=0.0, a=0.5, n=0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s += a*vnoise(p); n += a; p *= 2.03; a *= 0.5; }
  return s/max(n,1e-4);
}
float fbm3(vec3 p, int oct){
  float s=0.0, a=0.5, n=0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s += a*vnoise3(p); n += a; p *= 2.02; a *= 0.5; }
  return s/max(n,1e-4);
}
// ridged noise for foam streaks
float ridged2(vec2 p, int oct){
  float s=0.0, a=0.5, n=0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; float v = 1.0-abs(vnoise(p)*2.0-1.0); s += a*v*v; n += a; p *= 2.07; a *= 0.5; }
  return s/max(n,1e-4);
}
`;

/** analytic sky — shared by the dome, water reflections & fog tinting */
export const SKY = /* glsl */`
// returns linear radiance for a view direction
vec3 skyRadiance(vec3 dir, vec3 sunDir, vec3 zenith, vec3 horizon, vec3 groundCol, vec3 sunCol, float sunSize){
  float h = max(dir.y, -0.12);
  float t = pow(clamp(1.0 - h, 0.0, 1.0), 3.4);
  vec3 col = mix(zenith, horizon, clamp(t, 0.0, 1.0));
  // below horizon
  col = mix(col, groundCol, smoothstep(0.0, -0.10, dir.y));
  // sun glow + disk
  float mu = max(dot(normalize(dir), normalize(sunDir)), 0.0);
  float glow = pow(mu, 8.0) * 0.35 + pow(mu, 220.0) * 1.2;
  float disk = smoothstep(0.9995 - sunSize, 0.99985, mu) * 8.0;
  col += sunCol * (glow + disk) * step(-0.03, sunDir.y);
  return col;
}
`;

/** ACES-ish filmic tone map (used by the post pass and by the no-post path) */
export const TONEMAP = /* glsl */`
vec3 acesFilm(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c){
  return mix(c*12.92, 1.055*pow(max(c, vec3(1e-5)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}
`;
