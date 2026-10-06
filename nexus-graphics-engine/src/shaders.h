// NEXUS GRAPHICS ENGINE - real-time enhancement pipeline shaders (HLSL, ps_5_0).
//
// Every pass performs real pixel processing. The pipeline runs in LINEAR light:
//   import (sRGB->linear) -> temporal reconstruction -> reconstruction filter ->
//   AA (edge detect + neighborhood blend) -> shadow -> light -> AO -> reflection ->
//   detail -> distant -> vegetation -> particles -> water -> LOD smoothing ->
//   color engine -> artifact reduction -> output (linear->sRGB, split view, HUD)
//
// Shaders are compiled at runtime with D3DCompile (d3dcompiler_47.dll).
#pragma once

typedef struct { const char* name; const char* entry; const char* src; } NShaderDef;

// ------------------------------------------------------------------ common preamble
#define SH_COMMON \
"float3 S2L(float3 c){ c = max(c, 0.0); float3 lo = c * (1.0 / 12.92); float3 hi = pow(max((c + 0.055) / 1.055, 0.0), float3(2.4,2.4,2.4)); return (c <= float3(0.04045,0.04045,0.04045)) ? lo : hi; }\n" \
"float3 L2S(float3 c){ c = max(c, 0.0); float3 lo = c * 12.92; float3 hi = 1.055 * pow(max(c, 0.0), float3(1.0/2.4,1.0/2.4,1.0/2.4)) - 0.055; return (c <= float3(0.0031308,0.0031308,0.0031308)) ? lo : hi; }\n" \
"float Luma_(float3 c){ return dot(c, float3(0.2126, 0.7152, 0.0722)); }\n" \
"float2 Rot2(float2 v, float a){ float s = sin(a); float c = cos(a); return float2(c*v.x - s*v.y, s*v.x + c*v.y); }\n" \
"float fractf_(float v){ return v - floor(v); }\n" \
"float stepf_(float e, float x){ return x < e ? 0.0 : 1.0; }\n" \
"float smstep_(float e0, float e1, float x){ float t = clamp((x - e0) / max(e1 - e0, 1e-7), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }\n" \
"float fmodf_(float a, float b){ return a - floor(a / b) * b; }\n" \
"float2 fract2_(float2 v){ return v - floor(v); }\n" \
"float Hash21_(float2 p){ p = fract2_(p * float2(234.34, 435.345)); p += p * (p.x + p.y + 34.23); return fractf_(p.x * p.y); }\n" \
"float Noise2_(float2 p){ float2 i = floor(p); float2 f = fract2_(p); f = f*f*(3.0-2.0*f); float a = Hash21_(i); float b = Hash21_(i + float2(1,0)); float c = Hash21_(i + float2(0,1)); float d = Hash21_(i + float2(1,1)); return lerp(lerp(a,b,f.x), lerp(c,d,f.x), f.y); }\n" \
"float FBM_(float2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 3; i++){ v += a * Noise2_(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }\n" \
"float3 ACES_(float3 x){ float a = 2.51, b = 2.43, c2 = 0.59, d = 0.14, e = 0.02; return clamp((x*(a*x + c2)) / (x*(b*x + d) + e), 0.0, 1.0); }\n" \
"float Sat_(float3 c){ float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b)); return mx - mn; }\n"

// ------------------------------------------------------------------ vertex
#define SH_VS \
"struct VSIn { float2 p : POSITION; };\n" \
"struct VSOut { float4 pos : SV_POSITION; };\n" \
"VSOut main(VSIn v){ VSOut o; o.pos = float4(v.p, 0.0, 1.0); return o; }\n"

// ------------------------------------------------------------------ import (upscale + linearize)
// 3x3 edge-aware reconstruction kernel at output resolution.
#define SH_IMPORT \
"struct CB { float4 outSize; float4 srcFull; float4 crop; float4 pad; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D src : register(t0);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float2 c0 = uv * c.crop.zw + c.crop.xy;\n" \
"    float2 st = 1.0 / c.srcFull.xy;\n" \
"    float3 cc = src.Sample(smp, c0 * st).rgb;\n" \
"    cc = S2L(cc);\n" \
"    float ecenter = 0.0;\n" \
"    float3 acc = 0.0; float wsum = 0.0;\n" \
"    for (int j = -1; j <= 1; j++)\n" \
"    {\n" \
"        for (int i = -1; i <= 1; i++)\n" \
"        {\n" \
"            float2 o = float2(i, j);\n" \
"            float2 p = (c0 + o) * st;\n" \
"            float3 col = S2L(src.Sample(smp, p).rgb);\n" \
"            float d = length(o);\n" \
"            float w = max(0.0, 1.6 - d);\n" \
"            if (d > 0.0)\n" \
"            {\n" \
"                float de = distance(col, cc);\n" \
"                ecenter = max(ecenter, de);\n" \
"                w *= max(0.15, 1.0 - de * 14.0);\n" \
"            }\n" \
"            acc += col * w; wsum += w;\n" \
"        }\n" \
"    }\n" \
"    float3 res = acc / max(wsum, 1e-5);\n" \
"    res = mix(cc, res, stepf_(0.004, ecenter));\n" \
"    return float4(res, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ luma
#define SH_LUMA \
"struct CB { float4 outSize; float4 pad; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    return float4(Luma_(tex.Sample(smp, uv).rgb), 0, 0, 1);\n" \
"}\n"

// ------------------------------------------------------------------ downsample (4x)
#define SH_DOWN \
"struct CB { float4 outSize; float4 pad; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = (sv.xy + 0.5) / c.outSize.xy;\n" \
"    float2 ts = uv * 4.0 - 0.5;\n" \
"    float2 st = 0.25 / c.outSize.xy * 4.0;\n" \
"    float4 a = tex.Sample(smp, (ts + float2(0.0, 0.0)) / 4.0);\n" \
"    float4 b = tex.Sample(smp, (ts + float2(1.0, 0.0)) / 4.0);\n" \
"    float4 d = tex.Sample(smp, (ts + float2(0.0, 1.0)) / 4.0);\n" \
"    float4 e = tex.Sample(smp, (ts + float2(1.0, 1.0)) / 4.0);\n" \
"    return (a + b + d + e) * 0.25;\n" \
"}\n"

// ------------------------------------------------------------------ motion mask
// frame-difference motion estimation between current and previous frame luma
#define SH_MOTION \
"struct CB { float4 outSize; float gain; float bias; float pad; float pad2; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D cur : register(t0);\n" \
"Texture2D prev : register(t1);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float l = cur.Sample(smp, uv).r;\n" \
"    float m = 0.0;\n" \
"    for (int j = -1; j <= 1; j++)\n" \
"        for (int i = -1; i <= 1; i++)\n" \
"        {\n" \
"            float2 o = float2(i, j) * px;\n" \
"            float d = abs(cur.Sample(smp, uv + o).r - prev.Sample(smp, uv + o).r);\n" \
"            m = max(m, d);\n" \
"        }\n" \
"    float mm = clamp((m - c.bias) * c.gain, 0.0, 1.0);\n" \
"    return float4(mm, mm, mm, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ temporal reconstruction
// edge-adaptive 8-tap accumulation over the previous enhanced frame,
// motion-gated, with reprojection-style clamp to suppress ghosting
#define SH_TEMPORAL \
"struct CB { float4 outSize; float amt; float sharp; float gate; float first; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D cur : register(t0);\n" \
"Texture2D prev : register(t1);\n" \
"Texture2D motion : register(t2);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float3 cc = cur.Sample(smp, uv).rgb;\n" \
"    if (c.first > 0.5 || c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float3 pc = prev.Sample(smp, uv).rgb;\n" \
"    float m = motion.Sample(smp, uv).r;\n" \
"    float2 offs[8];\n" \
"    offs[0]=float2(-1,0); offs[1]=float2(1,0); offs[2]=float2(0,-1); offs[3]=float2(0,1);\n" \
"    offs[4]=float2(-1,-1); offs[5]=float2(1,-1); offs[6]=float2(-1,1); offs[7]=float2(1,1);\n" \
"    float3 acc = 0.0; float wsum = 0.0;\n" \
"    for (int i = 0; i < 8; i++)\n" \
"    {\n" \
"        float3 s = prev.Sample(smp, uv + offs[i] * px).rgb;\n" \
"        float de = distance(s, cc);\n" \
"        float w = exp(-de * (30.0 + 60.0 * c.sharp));\n" \
"        acc += s * w; wsum += w;\n" \
"    }\n" \
"    float3 recon = acc / max(wsum, 1e-5);\n" \
"    float g = clamp(m * c.gate, 0.0, 1.0);\n" \
"    recon = mix(recon, cc, g * 0.9);\n" \
"    float3 lo = min(cc, pc) * 0.72;\n" \
"    float3 hi = max(cc, pc) * 1.28;\n" \
"    recon = clamp(recon, lo, hi);\n" \
"    float3 outc = mix(cc, recon, c.amt);\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ reconstruction filter (super-res refinement)
// RCAS-style edge-aware 12-tap ring over the upsampled image
#define SH_RECON \
"struct CB { float4 outSize; float amt; float edgeK; float pad; float pad2; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float3 acc = 0.0; float wsum = 0.0;\n" \
"    for (int i = 0; i < 12; i++)\n" \
"    {\n" \
"        float a = (float)(i) * 0.5235988;\n" \
"        float2 o = float2(cos(a), sin(a)) * 2.0 * px;\n" \
"        float3 s = tex.Sample(smp, uv + o).rgb;\n" \
"        float de = distance(s, cc);\n" \
"        float w = exp(-de * c.edgeK);\n" \
"        acc += s * w; wsum += w;\n" \
"    }\n" \
"    float3 res = acc / max(wsum, 1e-5);\n" \
"    float3 outc = mix(cc, res, c.amt);\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ AA edge detection
#define SH_AAE \
"struct CB { float4 outSize; float thr; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D luma : register(t1);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lx = luma.Sample(smp, uv + float2(px, 0)).r;\n" \
"    float ly = luma.Sample(smp, uv + float2(0, px)).r;\n" \
"    float lxx = luma.Sample(smp, uv - float2(px, 0)).r;\n" \
"    float lyy = luma.Sample(smp, uv - float2(0, px)).r;\n" \
"    float gx = (lx - lxx) * 0.5;\n" \
"    float gy = (ly - lyy) * 0.5;\n" \
"    float g = sqrt(gx * gx + gy * gy);\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    float3 cr = tex.Sample(smp, uv + float2(px, 0)).rgb;\n" \
"    float3 cu = tex.Sample(smp, uv + float2(0, px)).rgb;\n" \
"    float ce = max(distance(cc, cr), distance(cc, cu));\n" \
"    float e = max(g * 3.0, ce * 6.0);\n" \
"    float m = smoothstep(c.thr, c.thr * 2.5, e);\n" \
"    return float4(m, m, m, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ AA neighborhood blend (SMAA-style)
#define SH_AAB \
"struct CB { float4 outSize; float radius; float blend; float pad; float pad2; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D edges : register(t1);\n" \
"SamplerState smp : register(s0);\n" \
"float2 search_(float2 uv, float2 dir, float px, float r)\n" \
"{\n" \
"    float2 euv = uv + dir * px;\n" \
"    float e = edges.Sample(smp, euv).r;\n" \
"    if (e < 0.5) return float2(0.0, 0.0);\n" \
"    float w = 0.0;\n" \
"    for (float d = px; d <= r * px; d += px)\n" \
"    {\n" \
"        e = edges.Sample(smp, uv + dir * d).r;\n" \
"        if (e < 0.5) break;\n" \
"        w = d;\n" \
"    }\n" \
"    return float2(w, 1.0);\n" \
"}\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    float e = edges.Sample(smp, uv).r;\n" \
"    if (e < 0.5 || c.blend <= 0.001) return float4(cc, 1.0);\n" \
"    float3 outc = cc; float wa = 1.0;\n" \
"    float2 dr = search_(uv, float2(1, 0), px, c.radius);\n" \
"    float2 dl = search_(uv, float2(-1, 0), px, c.radius);\n" \
"    if (dr.x > 0.0 && dl.x > 0.0)\n" \
"    {\n" \
"        float d = dr.x + dl.x;\n" \
"        float2 euv = uv + float2(0.5, 0.0) * (dl.x - dr.x) / max(d, px) * px * (dl.x + dr.x) / px;\n" \
"        euv = uv - dl.x * px;\n" \
"        float2 n = float2(d, 0.0);\n" \
"        float w = min(dr.x, dl.x) / d;\n" \
"        float3 a = tex.Sample(smp, uv + n * 0.5).rgb;\n" \
"        outc = mix(outc, a, w * c.blend); wa += w * c.blend;\n" \
"    }\n" \
"    else if (dr.x > 0.0)\n" \
"    {\n" \
"        float w = dr.x * 0.5 / max(c.radius * px, px);\n" \
"        float3 a = tex.Sample(smp, uv + float2(dr.x * 0.5 * px, 0)).rgb;\n" \
"        outc = mix(outc, a, clamp(w, 0.0, 0.6) * c.blend); wa += w;\n" \
"    }\n" \
"    else if (dl.x > 0.0)\n" \
"    {\n" \
"        float w = dl.x * 0.5 / max(c.radius * px, px);\n" \
"        float3 a = tex.Sample(smp, uv + float2(-dl.x * 0.5 * px, 0)).rgb;\n" \
"        outc = mix(outc, a, clamp(w, 0.0, 0.6) * c.blend); wa += w;\n" \
"    }\n" \
"    float2 du = search_(uv, float2(0, 1), px, c.radius);\n" \
"    float2 dd = search_(uv, float2(0, -1), px, c.radius);\n" \
"    if (du.x > 0.0 && dd.x > 0.0)\n" \
"    {\n" \
"        float d = du.x + dd.x;\n" \
"        float w = min(du.x, dd.x) / d;\n" \
"        float3 a = tex.Sample(smp, uv + float2(0.0, d * 0.5 * px)).rgb;\n" \
"        outc = mix(outc, a, w * c.blend); wa += w * c.blend;\n" \
"    }\n" \
"    else if (du.x > 0.0)\n" \
"    {\n" \
"        float w = du.x * 0.5 / max(c.radius * px, px);\n" \
"        float3 a = tex.Sample(smp, uv + float2(0.0, du.x * 0.5 * px)).rgb;\n" \
"        outc = mix(outc, a, clamp(w, 0.0, 0.6) * c.blend); wa += w;\n" \
"    }\n" \
"    else if (dd.x > 0.0)\n" \
"    {\n" \
"        float w = dd.x * 0.5 / max(c.radius * px, px);\n" \
"        float3 a = tex.Sample(smp, uv + float2(0.0, -dd.x * 0.5 * px)).rgb;\n" \
"        outc = mix(outc, a, clamp(w, 0.0, 0.6) * c.blend); wa += w;\n" \
"    }\n" \
"    return float4(outc / max(wa, 0.001), 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ shadow enhancer
// detects real shadow regions (dark, desaturated, low-contrast),
// lifts local detail inside them, softens noise, refines contact shadows
#define SH_SHADOW \
"struct CB { float4 outSize; float quality; float detail; float stability; float softness; float contact; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D luma : register(t1);\n" \
"Texture2D lumaQ : register(t2);\n" \
"Texture2D colorQ : register(t3);\n" \
"Texture2D prev : register(t4);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lq = lumaQ.Sample(smp, uv).r;\n" \
"    float3 cq = colorQ.Sample(smp, uv).rgb;\n" \
"    float lpc = prev.Sample(smp, uv).r;\n" \
"    float dark = smoothstep(0.34, 0.12, l);\n" \
"    float lowsat = 1.0 - smoothstep(0.05, 0.22, Sat_(cc));\n" \
"    float flat = 1.0 - smoothstep(0.01, 0.06, abs(l - lq));\n" \
"    float mask = dark * lowsat * (0.35 + 0.65 * flat);\n" \
"    mask *= c.quality;\n" \
"    if (mask <= 0.002) return float4(cc, 1.0);\n" \
"    float3 outc = cc;\n" \
"    // local contrast / detail inside shadow\n" \
"    float3 lc = cc - cq;\n" \
"    outc += lc * (0.35 + 0.9 * c.detail) * mask;\n" \
"    // softness: pull toward local average to settle noise in soft shadows\n" \
"    outc = mix(outc, cq + (outc - cc), clamp(c.softness, 0.0, 1.0) * 0.35 * mask);\n" \
"    // contact shadow: darken thin dark regions adjacent to bright surfaces\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float bmax = max(luma.Sample(smp, uv + float2(px,0)).r, luma.Sample(smp, uv + float2(0,px)).r);\n" \
"    float bmax2 = max(luma.Sample(smp, uv - float2(px,0)).r, luma.Sample(smp, uv - float2(0,px)).r);\n" \
"    float adj = max(bmax, bmax2);\n" \
"    float contact = smoothstep(0.18, 0.45, adj - l) * (1.0 - flat) * dark;\n" \
"    outc *= 1.0 - contact * c.contact * 0.14;\n" \
"    // temporal stability against flicker\n" \
"    float3 pcv = prev.Sample(smp, uv).rgb;\n" \
"    float stab = c.stability * 0.45 * mask * (1.0 - smoothstep(0.02, 0.08, abs(lpc - l)));\n" \
"    outc = mix(outc, pcv + (outc - cc), stab);\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ lighting
// exposure, adaptive local contrast, highlight-band detail, filmic tone response
#define SH_LIGHT \
"struct CB { float4 outSize; float exposure; float local; float detail; float dyn; float quality; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D luma : register(t1);\n" \
"Texture2D lumaQ : register(t2);\n" \
"Texture2D colorQ : register(t3);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float3 cq = colorQ.Sample(smp, uv).rgb;\n" \
"    float3 outc = cc;\n" \
"    float q = c.quality;\n" \
"    if (q <= 0.001) return float4(outc, 1.0);\n" \
"    // exposure (50 = neutral)\n" \
"    float ev = (c.exposure - 0.5) * 0.7;\n" \
"    outc *= exp2(ev);\n" \
"    // adaptive local contrast\n" \
"    float3 lc = outc - cq;\n" \
"    outc += lc * c.local * 0.85;\n" \
"    // highlight detail\n" \
"    float band = smoothstep(0.5, 0.9, Luma_(outc));\n" \
"    float3 hd = outc - cq;\n" \
"    outc += hd * c.detail * 0.55 * band;\n" \
"    // dynamic range: filmic response (keeps colors natural)\n" \
"    float3 film = ACES_(outc * 1.15);\n" \
"    film = film / max(ACES_(float3(1.15,1.15,1.15)), 0.001) * 0.92;\n" \
"    outc = mix(outc, film, c.dyn * 0.85);\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ AO (depth-free screen-space approximation)
// cavity detection from the luminance field + halo suppression
#define SH_AO \
"struct CB { float4 outSize; float amt; float radius; float halo; float pad; float pad2; float pad3; float pad4; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D luma : register(t1);\n" \
"Texture2D lumaQ : register(t2);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lq = lumaQ.Sample(smp, uv).r;\n" \
"    float d = lq - l;\n" \
"    float flat = 1.0 - smoothstep(0.015, 0.09, abs(l - lq));\n" \
"    float cavity = smoothstep(0.015, 0.14, d) * flat;\n" \
"    // halo suppression: dilate cavity over a small ring\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float dil = 0.0;\n" \
"    for (int i = 0; i < 8; i++)\n" \
"    {\n" \
"        float a = (float)(i) * 0.7853982;\n" \
"        float2 o = float2(cos(a), sin(a)) * (c.radius * px);\n" \
"        float l2 = luma.Sample(smp, uv + o).r;\n" \
"        float lq2 = lumaQ.Sample(smp, uv + o).r;\n" \
"        float flat2 = 1.0 - smoothstep(0.015, 0.09, abs(l2 - lq2));\n" \
"        dil = max(dil, smoothstep(0.015, 0.14, lq2 - l2) * flat2);\n" \
"    }\n" \
"    float ao = cavity - dil * c.halo * 0.55;\n" \
"    ao = max(ao, 0.0);\n" \
"    float3 outc = cc * (1.0 - ao * c.amt * 0.42);\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ reflection stabilizer
// temporal low-pass on high-frequency specular flicker
#define SH_REFLECT \
"struct CB { float4 outSize; float amt; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D prev : register(t1);\n" \
"Texture2D luma : register(t2);\n" \
"Texture2D motion : register(t3);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float lmax = l;\n" \
"    for (int j = -1; j <= 1; j++)\n" \
"        for (int i = -1; i <= 1; i++)\n" \
"            lmax = max(lmax, luma.Sample(smp, uv + float2(i, j) * px).r);\n" \
"    float spec = smoothstep(0.06, 0.3, lmax - l);\n" \
"    float desat = 1.0 - smoothstep(0.1, 0.4, Sat_(cc)) * 0.6;\n" \
"    float m = motion.Sample(smp, uv).r;\n" \
"    float3 pv = prev.Sample(smp, uv).rgb;\n" \
"    float flick = max(0.0, abs(l - luma.Sample(smp, uv).r) + abs(Luma_(cc) - Luma_(pv)) - 0.02);\n" \
"    float stab = spec * desat * clamp(flick * 8.0, 0.0, 1.0) * (1.0 - m * 2.5);\n" \
"    float3 outc = mix(cc, (cc + pv) * 0.5 + (cc - (cc + pv) * 0.5) * 0.4, clamp(stab, 0.0, 1.0) * c.amt);\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ detail boost
// multi-band high-frequency enhancement with texture-energy masking
#define SH_DETAIL \
"struct CB { float4 outSize; float sharp; float fine; float texcl; float edge; float denoise; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D luma : register(t1);\n" \
"Texture2D edges : register(t2);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    float3 sR = tex.Sample(smp, uv + float2(px,0)).rgb;\n" \
"    float3 sL = tex.Sample(smp, uv - float2(px,0)).rgb;\n" \
"    float3 sU = tex.Sample(smp, uv + float2(0,px)).rgb;\n" \
"    float3 sD = tex.Sample(smp, uv - float2(0,px)).rgb;\n" \
"    float3 avg4 = (sR + sL + sU + sD) * 0.25;\n" \
"    float3 hp = cc - avg4;\n" \
"    float e = edges.Sample(smp, uv).r;\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lR = luma.Sample(smp, uv + float2(px,0)).r;\n" \
"    float lL = luma.Sample(smp, uv - float2(px,0)).r;\n" \
"    float lU = luma.Sample(smp, uv + float2(0,px)).r;\n" \
"    float lD = luma.Sample(smp, uv - float2(0,px)).r;\n" \
"    float avg4l = (lR + lL + lU + lD) * 0.25;\n" \
"    float hpl = l - avg4l;\n" \
"    float energy = clamp(abs(hpl) * 9.0, 0.0, 1.0);\n" \
"    float3 outc = cc;\n" \
"    outc += hp * c.sharp * 0.42 * energy;\n" \
"    // fine detail (tighter band)\n" \
"    float3 sA = tex.Sample(smp, uv + float2(px, px)).rgb;\n" \
"    float3 sB = tex.Sample(smp, uv - float2(px, px)).rgb;\n" \
"    float3 sC = tex.Sample(smp, uv + float2(px, -px)).rgb;\n" \
"    float3 sDd = tex.Sample(smp, uv - float2(px, -px)).rgb;\n" \
"    float3 hp2 = cc - (sA + sB + sC + sDd) * 0.25;\n" \
"    outc += hp2 * c.fine * 0.3 * energy;\n" \
"    // edge definition\n" \
"    outc += hp * c.edge * 0.28 * e;\n" \
"    // mid-frequency texture clarity (opposite of edge: interior of surfaces)\n" \
"    outc += hp * c.texcl * 0.24 * (1.0 - e) * energy;\n" \
"    // denoise in flat regions\n" \
"    float flatw = (1.0 - energy) * c.denoise;\n" \
"    outc = mix(outc, avg4 + (outc - cc), clamp(flatw * 0.6, 0.0, 1.0));\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ distant detail
// mid-band enhancement where local contrast is low and detail exists
#define SH_DISTANT \
"struct CB { float4 outSize; float amt; float stab; float pad; float pad2; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D luma : register(t1);\n" \
"Texture2D lumaQ : register(t2);\n" \
"Texture2D colorQ : register(t3);\n" \
"Texture2D motion : register(t4);\n" \
"Texture2D prev : register(t5);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lq = lumaQ.Sample(smp, uv).r;\n" \
"    float3 cq = colorQ.Sample(smp, uv).rgb;\n" \
"    float m = motion.Sample(smp, uv).r;\n" \
"    float lowC = 1.0 - smoothstep(0.02, 0.09, abs(l - lq));\n" \
"    float3 mid = cc - cq;\n" \
"    float midE = length(mid) * 3.0;\n" \
"    float mask = lowC * smoothstep(0.004, 0.02, midE) * (1.0 - m * 3.0);\n" \
"    float3 outc = cc + mid * c.amt * 1.15 * mask;\n" \
"    // temporal stabilization of shimmering distant detail\n" \
"    float3 pv = prev.Sample(smp, uv).rgb;\n" \
"    float flick = max(0.0, abs(l - luma.Sample(smp, uv).r) + abs(Luma_(cc) - Luma_(pv)) - 0.015);\n" \
"    float stab = mask * clamp(flick * 6.0, 0.0, 1.0) * (1.0 - m * 3.0) * c.stab;\n" \
"    outc = mix(outc, (outc + pv + (pv - (outc + pv) * 0.5)) * 0.5, clamp(stab, 0.0, 0.6));\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ vegetation
// green high-frequency mask: edge AA + temporal stabilization + detail
#define SH_VEG \
"struct CB { float4 outSize; float amt; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D prev : register(t1);\n" \
"Texture2D luma : register(t2);\n" \
"Texture2D motion : register(t3);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float green = max(0.0, cc.g - max(cc.r, cc.b));\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lR = luma.Sample(smp, uv + float2(px,0)).r;\n" \
"    float lL = luma.Sample(smp, uv - float2(px,0)).r;\n" \
"    float lU = luma.Sample(smp, uv + float2(0,px)).r;\n" \
"    float lD = luma.Sample(smp, uv - float2(0,px)).r;\n" \
"    float hf = abs(l - (lR + lL + lU + lD) * 0.25);\n" \
"    float mask = smoothstep(0.02, 0.09, green) * smoothstep(0.004, 0.03, hf);\n" \
"    float m = motion.Sample(smp, uv).r;\n" \
"    float3 outc = cc;\n" \
"    // edge anti-aliasing along leaf edges\n" \
"    float3 nR = tex.Sample(smp, uv + float2(px,0)).rgb;\n" \
"    float3 nL = tex.Sample(smp, uv - float2(px,0)).rgb;\n" \
"    float3 nU = tex.Sample(smp, uv + float2(0,px)).rgb;\n" \
"    float3 nD = tex.Sample(smp, uv - float2(0,px)).rgb;\n" \
"    outc = mix(outc, (nR + nL + nU + nD) * 0.25, mask * c.amt * 0.3);\n" \
"    // temporal stabilization (kills grass flicker/shimmer)\n" \
"    float3 pv = prev.Sample(smp, uv).rgb;\n" \
"    outc = mix(outc, (outc + pv) * 0.5, mask * c.amt * 0.4 * (1.0 - m * 2.5));\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ particles
// sparse high-contrast specks: temporal denoise (motion-gated) + bright-speck sharpen
#define SH_PARTICLE \
"struct CB { float4 outSize; float amt; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D prev : register(t1);\n" \
"Texture2D luma : register(t2);\n" \
"Texture2D lumaQ : register(t3);\n" \
"Texture2D motion : register(t4);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lq = lumaQ.Sample(smp, uv).r;\n" \
"    float sp = abs(l - lq);\n" \
"    float sparse = smoothstep(0.08, 0.22, sp);\n" \
"    float m = motion.Sample(smp, uv).r;\n" \
"    float3 pv = prev.Sample(smp, uv).rgb;\n" \
"    // temporal denoise: keep fast-moving particles crisp\n" \
"    float w = sparse * (1.0 - clamp(m * 4.0, 0.0, 1.0)) * c.amt;\n" \
"    float3 outc = mix(cc, (cc + pv) * 0.5 + (cc - (cc + pv) * 0.5) * 0.5, clamp(w * 0.8, 0.0, 1.0));\n" \
"    // sharpen bright specks (sparks/fire)\n" \
"    float bright = smoothstep(0.55, 0.85, l);\n" \
"    float3 hp = outc - (outc + (outc - (outc + pv) * 0.5)) * 0.0;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float3 avg = (tex.Sample(smp, uv + float2(px,0)).rgb + tex.Sample(smp, uv - float2(px,0)).rgb + tex.Sample(smp, uv + float2(0,px)).rgb + tex.Sample(smp, uv - float2(0,px)).rgb) * 0.25;\n" \
"    outc += (cc - avg) * bright * sparse * c.amt * 0.4;\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ water
// blue + horizontal streak mask: temporal stabilization + specular sharpen
#define SH_WATER \
"struct CB { float4 outSize; float amt; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D prev : register(t1);\n" \
"Texture2D luma : register(t2);\n" \
"Texture2D motion : register(t3);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float blue = max(0.0, cc.b - max(cc.r, cc.g));\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lR = luma.Sample(smp, uv + float2(px,0)).r;\n" \
"    float lL = luma.Sample(smp, uv - float2(px,0)).r;\n" \
"    float lU = luma.Sample(smp, uv + float2(0,px)).r;\n" \
"    float lD = luma.Sample(smp, uv - float2(0,px)).r;\n" \
"    float hfreq = abs(lR - lL);\n" \
"    float vfreq = abs(lU - lD);\n" \
"    float streak = smoothstep(0.004, 0.03, hfreq) * (1.0 - smoothstep(0.006, 0.05, vfreq));\n" \
"    float mask = smoothstep(0.015, 0.07, blue) * (0.4 + 0.6 * streak);\n" \
"    float m = motion.Sample(smp, uv).r;\n" \
"    float3 pv = prev.Sample(smp, uv).rgb;\n" \
"    float flick = max(0.0, abs(Luma_(cc) - Luma_(pv)) - 0.01);\n" \
"    float3 outc = mix(cc, (cc + pv) * 0.5 + (cc - (cc + pv) * 0.5) * 0.45, clamp(flick * 5.0, 0.0, 1.0) * (1.0 - m * 2.0) * c.amt * mask);\n" \
"    // sharpen water surface highlights\n" \
"    float spec = smoothstep(0.35, 0.7, l) * streak;\n" \
"    float3 avg = (tex.Sample(smp, uv + float2(px,0)).rgb + tex.Sample(smp, uv - float2(px,0)).rgb + tex.Sample(smp, uv + float2(0,px)).rgb + tex.Sample(smp, uv - float2(0,px)).rgb) * 0.25;\n" \
"    outc += (cc - avg) * spec * c.amt * 0.35 * mask;\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ LOD transition smoothing
// detects high-frequency band changes between frames (LOD switches) and crossfades
#define SH_LOD \
"struct CB { float4 outSize; float amt; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D luma : register(t1);\n" \
"Texture2D lumaPrev : register(t2);\n" \
"Texture2D lumaQ : register(t3);\n" \
"Texture2D motion : register(t4);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lp = lumaPrev.Sample(smp, uv).r;\n" \
"    float lq = lumaQ.Sample(smp, uv).r;\n" \
"    float e0 = abs(l - lq);\n" \
"    float e1 = abs(lp - lq);\n" \
"    float m = motion.Sample(smp, uv).r;\n" \
"    float trans = smoothstep(0.025, 0.09, abs(e0 - e1)) * (1.0 - m * 3.0);\n" \
"    float band = l - lq;\n" \
"    float bandPrev = lp - lq;\n" \
"    float3 outc = mix(cc, cc + (bandPrev - band) * 0.5 * float3(1.0, 1.0, 1.0) * sign(band) * 0.5, clamp(trans * c.amt, 0.0, 0.5));\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ color engine
#define SH_COLOR \
"struct CB { float4 outSize; float bright; float contrast; float sat; float hi; float sh; float gamma; float temp; float hdr; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    float3 outc = cc;\n" \
"    outc *= 1.0 + (c.bright - 0.5) * 0.3;\n" \
"    float k = 1.0 + (c.contrast - 0.5) * 0.85;\n" \
"    outc = (outc - 0.5) * k + 0.5;\n" \
"    float l = Luma_(outc);\n" \
"    outc = mix(float3(l, l, l), outc, 1.0 + (c.sat - 0.5) * 1.3);\n" \
"    // highlights: compress or lift top band\n" \
"    float hb = smoothstep(0.62, 1.0, l);\n" \
"    outc *= 1.0 - (c.hi - 0.5) * 0.35 * hb;\n" \
"    // shadows: lift or deepen bottom band\n" \
"    float sb = smoothstep(0.38, 0.0, l);\n" \
"    outc += (c.sh - 0.5) * 0.22 * sb;\n" \
"    // gamma\n" \
"    float g = exp2((0.5 - c.gamma) * 0.9);\n" \
"    outc = pow(max(outc, 0.0), float3(g, g, g));\n" \
"    // temperature\n" \
"    float t = (c.temp - 0.5) * 0.16;\n" \
"    outc.r *= 1.0 + t * l;\n" \
"    outc.b *= 1.0 - t * l;\n" \
"    // internal HDR pipeline: extended response for deeper range\n" \
"    if (c.hdr > 0.001)\n" \
"    {\n" \
"        float3 f = ACES_(outc * (1.0 + c.hdr * 0.5));\n" \
"        outc = mix(outc, f, c.hdr * 0.4);\n" \
"    }\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ artifact reduction (debanding + denoise)
#define SH_DEBAND \
"struct CB { float4 outSize; float amt; float pad; float pad2; float pad3; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D tex : register(t0);\n" \
"Texture2D luma : register(t1);\n" \
"Texture2D lumaQ : register(t2);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 cc = tex.Sample(smp, uv).rgb;\n" \
"    if (c.amt <= 0.001) return float4(cc, 1.0);\n" \
"    float l = luma.Sample(smp, uv).r;\n" \
"    float lq = lumaQ.Sample(smp, uv).r;\n" \
"    float px = 1.0 / c.outSize.x;\n" \
"    float d0 = abs(l - luma.Sample(smp, uv + float2(px, 0)).r);\n" \
"    float d1 = abs(l - luma.Sample(smp, uv - float2(px, 0)).r);\n" \
"    float d2 = abs(l - luma.Sample(smp, uv + float2(0, px)).r);\n" \
"    float d3 = abs(l - luma.Sample(smp, uv - float2(0, px)).r);\n" \
"    float flat = 1.0 - smoothstep(0.006, 0.03, abs(l - lq));\n" \
"    float band = (1.0 - smoothstep(0.0, 0.0035, d0)) * (1.0 - smoothstep(0.0, 0.0035, d1));\n" \
"    float band2 = (1.0 - smoothstep(0.0, 0.0035, d2)) * (1.0 - smoothstep(0.0, 0.0035, d3));\n" \
"    float mask = max(band, band2 * 0.7) * flat;\n" \
"    float3 avg = (tex.Sample(smp, uv + float2(px,0)).rgb + tex.Sample(smp, uv - float2(px,0)).rgb + tex.Sample(smp, uv + float2(0,px)).rgb + tex.Sample(smp, uv - float2(0,px)).rgb) * 0.25;\n" \
"    float3 outc = mix(cc, avg, clamp(mask * c.amt * 0.7, 0.0, 1.0));\n" \
"    // dither to dissolve residual banding\n" \
"    float n = Hash21_(sv.xy) - 0.5;\n" \
"    outc += n * 0.0022 * c.amt * flat;\n" \
"    return float4(outc, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ output
// split view / before-after, sRGB encode, HUD composite
#define SH_OUTPUT \
"struct CB { float4 outSize; float split; float beforeAfter; float hdrOut; float4 hudRect; float pad; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D enh : register(t0);\n" \
"Texture2D orig : register(t1);\n" \
"Texture2D hud : register(t2);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float3 e = enh.Sample(smp, uv).rgb;\n" \
"    float3 o = orig.Sample(smp, uv).rgb;\n" \
"    float3 col;\n" \
"    if (c.beforeAfter > 0.5)\n" \
"        col = o;\n" \
"    else if (c.split > 0.5 && c.split < 999.0)\n" \
"    {\n" \
"        float x = sv.x / c.outSize.x;\n" \
"        float sx = c.split / 1000.0;\n" \
"        col = (x < sx) ? o : e;\n" \
"        float dl = abs(x - sx);\n" \
"        if (dl < 2.0 / c.outSize.x) col = float3(0.35, 0.85, 1.0);\n" \
"    }\n" \
"    else\n" \
"        col = e;\n" \
"    if (c.hdrOut < 0.5)\n" \
"        col = L2S(clamp(col, 0.0, 1.0));\n" \
"    else\n" \
"        col = L2S(clamp(col, 0.0, 2.0)) * 0.5 + L2S(clamp(col, 0.0, 1.0)) * 0.5;\n" \
"    // HUD (top-left region 0..1 of hud texture mapped to 0.5x0.5 area)\n" \
"    float4 h = float4(0,0,0,0);\n" \
"    if (c.hudRect.z > 0.001 && c.hudRect.w > 0.001 && uv.x < c.hudRect.z && uv.y < c.hudRect.w)\n" \
"        h = hud.Sample(smp, uv / c.hudRect.zw);\n" \
"    col = mix(col, h.rgb, h.a);\n" \
"    return float4(col, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ HUD-only pass (standby screen)
#define SH_STANDBY \
"struct CB { float4 outSize; float bg; float pad; float pad2; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"Texture2D hud : register(t0);\n" \
"SamplerState smp : register(s0);\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 uv = sv.xy / c.outSize.xy;\n" \
"    float vig = 1.0 - 0.35 * length(uv - 0.5);\n" \
"    float3 c = float3(c.bg, c.bg, c.bg) * vig;\n" \
"    float4 h = (uv.x < 0.6 && uv.y < 0.6) ? hud.Sample(smp, uv * 1.2) : float4(0,0,0,0);\n" \
"    c = mix(c, h.rgb, h.a);\n" \
"    return float4(L2S(c), 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ self-test scene
// real 3D rendering: SDF raymarched scene with soft shadows, AO, specular,
// distance fog, animated camera - used to verify the enhancement pipeline
#define SH_SELFTEST \
"struct CB { float4 time; float4 res; float4 pad; float4 pad2; };\n" \
"cbuffer cb : register(b0) { CB c; }\n" \
"float sdSphere_(float3 p, float r){ return length(p) - r; }\n" \
"float sdBox_(float3 p, float3 b){ float3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }\n" \
"float sdCapsule_(float3 p, float3 a, float3 b, float r){ float3 pa = p - a; float3 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }\n" \
"float sdTorus_(float3 p, float R, float r){ float2 q = float2(length(p.xz) - R, p.y); return length(q) - r; }\n" \
"float mapScene_(float3 p, out float mat)\n" \
"{\n" \
"    float d = p.y;\n" \
"    mat = 0.0;\n" \
"    // ground\n" \
"    float2 g = float2(p.xz);\n" \
"    // sphere with stripes\n" \
"    float d1 = sdSphere_(p - float3(-1.35, 0.55, -0.25), 0.55);\n" \
"    if (d1 < d){ d = d1; mat = 1.0; }\n" \
"    // rotating checker cube\n" \
"    float3 q = p - float3(1.35, 0.62, 0.35);\n" \
"    q.xz = Rot2(q.xz, c.time.x * 0.7).xy;\n" \
"    float d2 = sdBox_(q, float3(0.42));\n" \
"    if (d2 < d){ d = d2; mat = 2.0; }\n" \
"    // capsule character\n" \
"    float d3 = sdCapsule_(p, float3(0.1, 0.12, 1.15), float3(0.1, 1.25, 1.15), 0.3);\n" \
"    float head = sdSphere_(p - float3(0.1, 1.62, 1.15), 0.24);\n" \
"    float dc = min(d3, head);\n" \
"    if (dc < d){ d = dc; mat = 3.0; }\n" \
"    // torus ring\n" \
"    float d4 = sdTorus_(p - float3(0.2, 1.15, -1.7), 0.55, 0.14);\n" \
"    if (d4 < d){ d = d4; mat = 4.0; }\n" \
"    // orbiting small spheres (particles)\n" \
"    for (int i = 0; i < 3; i++)\n" \
"    {\n" \
"        float a = c.time.x * (0.5 + 0.18 * (float)(i)) + (float)(i) * 2.0944;\n" \
"        float r = 2.3 + 0.3 * sin(c.time.x * 0.4 + (float)(i));\n" \
"        float3 sp = float3(cos(a) * r, 0.9 + 0.5 * sin(c.time.x * 0.6 + (float)(i) * 1.7), sin(a) * r);\n" \
"        float d5 = sdSphere_(p - sp, 0.16);\n" \
"        if (d5 < d){ d = d5; mat = 5.0 + (float)(i) * 0.1; }\n" \
"    }\n" \
"    return d;\n" \
"}\n" \
"float3 matColor_(float mat, float3 p, float3 n)\n" \
"{\n" \
"    if (mat < 0.5)\n" \
"    {\n" \
"        // ground: fine grid + checker + noise\n" \
"        float2 g = p.xz;\n" \
"        float grid = 0.0;\n" \
"        float2 f1 = abs(fract2_(g / 0.25) - 0.5);\n" \
"        grid += smoothstep(0.47, 0.5, max(f1.x, f1.y)) * 0.55;\n" \
"        float2 f2 = abs(fract2_(g / 1.0) - 0.5);\n" \
"        grid += smoothstep(0.485, 0.5, max(f2.x, f2.y)) * 0.9;\n" \
"        float chk = (fmodf_(floor(g.x / 0.5) + floor(g.y / 0.5), 2.0) < 0.5) ? 0.72 : 0.6;\n" \
"        float3 base = float3(0.32, 0.34, 0.36) * chk;\n" \
"        base = mix(base, float3(0.55, 0.57, 0.6), grid);\n" \
"        base *= 0.92 + 0.08 * Noise2_(p.xz * 2.0);\n" \
"        return base;\n" \
"    }\n" \
"    if (mat < 1.5)\n" \
"    {\n" \
"        // striped sphere\n" \
"        float a = atan2(p.y, length(p.xz)) * 8.0;\n" \
"        float s = (sin(a) > 0.0) ? 1.0 : 0.0;\n" \
"        float3 col = mix(float3(0.85, 0.3, 0.22), float3(0.92, 0.88, 0.8), s);\n" \
"        col *= 0.85 + 0.15 * Noise2_(float2(atan2(p.z, p.x) * 6.0, p.y * 12.0));\n" \
"        return col;\n" \
"    }\n" \
"    if (mat < 2.5)\n" \
"    {\n" \
"        // checker cube\n" \
"        float3 q = p - float3(1.35, 0.62, 0.35);\n" \
"        float2 uv = q.xz + q.xy;\n" \
"        float chk = (fmodf_(floor(uv.x / 0.15) + floor(uv.y / 0.15), 2.0) < 0.5) ? 1.0 : 0.15;\n" \
"        return float3(0.8, 0.78, 0.75) * chk;\n" \
"    }\n" \
"    if (mat < 3.5)\n" \
"    {\n" \
"        // capsule: torso + head + visor\n" \
"        float y = p.y;\n" \
"        float3 col = float3(0.25, 0.45, 0.85);\n" \
"        if (y > 1.45) col = float3(0.9, 0.85, 0.78);\n" \
"        if (y > 1.52 && y < 1.68) col = float3(0.05, 0.08, 0.12);\n" \
"        return col;\n" \
"    }\n" \
"    if (mat < 4.5)\n" \
"    {\n" \
"        // metallic torus\n" \
"        float n = Noise2_(float2(atan2(p.x, p.z) * 10.0, length(p.xz) * 8.0));\n" \
"        return float3(0.55, 0.57, 0.62) * (0.8 + 0.4 * n);\n" \
"    }\n" \
"    // orbiters\n" \
"    float t = frac(mat - 5.0);\n" \
"    return mix(float3(1.0, 0.55, 0.1), float3(0.1, 0.8, 0.9), t);\n" \
"}\n" \
"float3 skyColor_(float3 rd)\n" \
"{\n" \
"    float t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);\n" \
"    float3 sky = mix(float3(0.75, 0.82, 0.9), float3(0.25, 0.45, 0.75), t);\n" \
"    float3 sun = normalize(float3(0.55, 0.85, 0.35));\n" \
"    float sd = max(dot(rd, sun), 0.0);\n" \
"    sky += float3(1.0, 0.85, 0.6) * pow(sd, 900.0) * 8.0;\n" \
"    sky += float3(1.0, 0.9, 0.7) * pow(sd, 12.0) * 0.18;\n" \
"    float cl = FBM_(rd.xz / max(rd.y + 0.2, 0.05) * 0.6 + c.time.x * 0.01);\n" \
"    float cw = smoothstep(0.52, 0.72, cl) * smoothstep(0.05, 0.4, rd.y);\n" \
"    sky = mix(sky, float3(0.95, 0.96, 1.0) * (1.0 + 0.2 * sd), cw * 0.8);\n" \
"    return sky;\n" \
"}\n" \
"float softShadow_(float3 ro, float3 rd)\n" \
"{\n" \
"    float res = 1.0;\n" \
"    float t = 0.05;\n" \
"    float k = 9.0;\n" \
"    for (int i = 0; i < 16; i++)\n" \
"    {\n" \
"        float mat;\n" \
"        float h = mapScene_(ro + rd * t, mat);\n" \
"        res = min(res, k * h / t);\n" \
"        if (res < 0.004 || t > 9.0) break;\n" \
"        t += clamp(h, 0.03, 0.35);\n" \
"    }\n" \
"    return clamp(res, 0.0, 1.0);\n" \
"}\n" \
"float calcAO_(float3 p, float3 n)\n" \
"{\n" \
"    float occ = 0.0; float sca = 1.0;\n" \
"    for (int i = 0; i < 5; i++)\n" \
"    {\n" \
"        float mat;\n" \
"        float hd = 0.02 + 0.11 * float(i);\n" \
"        float d = mapScene_(p + n * hd, mat);\n" \
"        occ += (hd - d) * sca;\n" \
"        sca *= 0.7;\n" \
"    }\n" \
"    return clamp(1.0 - 1.6 * occ, 0.0, 1.0);\n" \
"}\n" \
"float3 trace_(float3 ro, float3 rd)\n" \
"{\n" \
"    float t = 0.0;\n" \
"    float mat = 0.0;\n" \
"    float3 p = ro;\n" \
"    for (int i = 0; i < 96; i++)\n" \
"    {\n" \
"        float mat2;\n" \
"        float d = mapScene_(p, mat2);\n" \
"        if (d < 0.0015)\n" \
"        {\n" \
"            mat = mat2;\n" \
"            break;\n" \
"        }\n" \
"        t += d;\n" \
"        p = ro + rd * t;\n" \
"        if (t > 24.0) { mat = -1.0; break; }\n" \
"    }\n" \
"    if (mat < -0.5) return skyColor_(rd);\n" \
"    // normal via central differences (x on xz plane, y on yz plane)\n" \
"    float e = 0.0015;\n" \
"    float3 n = normalize(float3(\n" \
"        mapScene_(p - float3(e, 0.0, 0.0), mat) - mapScene_(p + float3(e, 0.0, 0.0), mat),\n" \
"        mapScene_(p - float3(0.0, e, 0.0), mat) - mapScene_(p + float3(0.0, e, 0.0), mat),\n" \
"        mapScene_(p - float3(0.0, 0.0, e), mat) - mapScene_(p + float3(0.0, 0.0, e), mat)));\n" \
"    float3 sun = normalize(float3(0.55, 0.85, 0.35));\n" \
"    float3 albedo = matColor_(mat, p - ro * 0.0, n);\n" \
"    float dif = clamp(dot(n, sun), 0.0, 1.0);\n" \
"    float sh = (dif > 0.001) ? softShadow_(p + n * 0.02, sun) : 1.0;\n" \
"    float ao = calcAO_(p, n);\n" \
"    float3 hal = normalize(sun - rd);\n" \
"    float spe = pow(clamp(dot(n, hal), 0.0, 1.0), 70.0);\n" \
"    float spec = (mat > 3.5 && mat < 4.5) ? 0.9 : (mat < 0.5 ? 0.08 : 0.35);\n" \
"    float3 col = albedo * (dif * sh * 1.35 + 0.22) * ao;\n" \
"    col += float3(1.0, 0.9, 0.7) * spe * sh * spec;\n" \
"    // sky ambient\n" \
"    float skyA = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);\n" \
"    col += albedo * mix(float3(0.25, 0.3, 0.4), float3(0.5, 0.6, 0.75), skyA) * ao * 0.35;\n" \
"    // distance fog\n" \
"    float fog = 1.0 - exp(-t * t * 0.0016);\n" \
"    col = mix(col, skyColor_(rd), clamp(fog, 0.0, 1.0));\n" \
"    return col;\n" \
"}\n" \
"float4 main(float4 sv : SV_POSITION) : SV_TARGET\n" \
"{\n" \
"    float2 px = sv.xy;\n" \
"    float2 sub = (px - floor(px)) - 0.5;\n" \
"    float2 uv = (floor(px) + 0.5) / c.res.xy;\n" \
"    float yaw = c.time.x * 0.13;\n" \
"    float3 ro = float3(sin(yaw) * 4.3, 1.6 + 0.12 * sin(c.time.x * 0.23), cos(yaw) * 4.3);\n" \
"    float3 ta = float3(0.1, 0.75, 0.1);\n" \
"    float3 fw = normalize(ta - ro);\n" \
"    float3 rt = normalize(cross(fw, float3(0, 1, 0)));\n" \
"    float3 up = cross(rt, fw);\n" \
"    float asp = c.res.x / c.res.y;\n" \
"    float3 rd = normalize(fw * 1.6 + rt * (uv.x - 0.5) * asp * 2.2 + up * (uv.y - 0.5) * 2.2);\n" \
"    float3 c1 = trace_(ro, rd);\n" \
"    // 2x2 supersampling with fixed subpixel offset (temporal AA friendly)\n" \
"    float3 rd2 = normalize(fw * 1.6 + rt * (uv.x - 0.5 + 0.25 * sub.x * 2.0) * asp * 2.2 + up * (uv.y - 0.5 + 0.25 * sub.y * 2.0) * 2.2);\n" \
"    float3 c2 = trace_(ro, rd2);\n" \
"    float3 col = (c1 + c2) * 0.5;\n" \
"    col = S2L(max(col, 0.0));\n" \
"    return float4(col, 1.0);\n" \
"}\n"

// ------------------------------------------------------------------ table
static const NShaderDef NShaders[] = {
    { "vs",        "main", SH_VS },
    { "import",    "main", SH_IMPORT },
    { "luma",      "main", SH_LUMA },
    { "down",      "main", SH_DOWN },
    { "motion",    "main", SH_MOTION },
    { "temporal",  "main", SH_TEMPORAL },
    { "recon",     "main", SH_RECON },
    { "aaEdge",    "main", SH_AAE },
    { "aaBlend",   "main", SH_AAB },
    { "shadow",    "main", SH_SHADOW },
    { "light",     "main", SH_LIGHT },
    { "ao",        "main", SH_AO },
    { "reflect",   "main", SH_REFLECT },
    { "detail",    "main", SH_DETAIL },
    { "distant",   "main", SH_DISTANT },
    { "veg",       "main", SH_VEG },
    { "particle",  "main", SH_PARTICLE },
    { "water",     "main", SH_WATER },
    { "lod",       "main", SH_LOD },
    { "color",     "main", SH_COLOR },
    { "deband",    "main", SH_DEBAND },
    { "output",    "main", SH_OUTPUT },
    { "standby",   "main", SH_STANDBY },
    { "selftest",  "main", SH_SELFTEST },
};
static const int NShaderCount = (int)(sizeof NShaders / sizeof NShaders[0]);
