// NEXUS GRAPHICS ENGINE - HLSL compute pipeline (compiled at runtime with d3dcompiler_47)
//
// All kernels below implement real image/graphics processing:
//  - CS_LINEARIZE : sRGB -> linear light
//  - CS_LOWCUR    : 4x4 downsampled luma (motion base)
//  - CS_MOTION    : hierarchical block-matching motion estimation (prev vs cur luma)
//  - CS_UPSCALE   : edge-directed spatial upscaling (directional bicubic w/ anti-ring)
//  - CS_TEMPORAL  : motion-compensated temporal accumulation with neighbourhood clamp
//  - CS_DOWN      : 2x2 downsample chain (local means for contrast/AO/shadow masks)
//  - CS_AA        : luma-edge directed anti-aliasing
//  - CS_DETAIL    : multi-scale detail recovery (fine/mid), local contrast, distant
//                   detail restoration (dehaze-lite), edge-aware denoise
//  - CS_LIGHT     : screen-space AO-proxy (crease/contact), shadow quality masks,
//                   lighting/exposure/highlights, reflection specular enhancement
//  - CS_SCENE     : vegetation shimmer control, particle contrast, water streak
//                   stabilisation, character (skin) protection
//  - CS_COLOR     : brightness/contrast/saturation/temp/gamma/shadows/highlights/HDR shoulder
//  - CS_FINAL     : overshoot-controlled sharpen, deband dither, split-view & bypass
//  - CS_BYPASS    : untouched original -> output (before/after comparison path)
//  - CS_TEST      : synthetic scene generator (self-test / no-game demo mode)
#pragma once

static const char* SHADER_COMMON = R"NXSH(
SamplerState sPoint : register(s0);
SamplerState sLinear : register(s1);

cbuffer Cb : register(b0) {
    float4 uSizes;      // outW, outH, inW, inH
    float4 uTexel;      // 1/outW, 1/outH, 1/inW, 1/inH
    float4 uFrame;      // hasHist, frameIndex, time, viewMode (0 enh,1 orig,2 split)
    float4 uSplit;      // splitX, aaStrength, aaThreshold, aaRadius
    float4 uTemporal;   // base(currentWeight), clampK, detailProtect, aoStrength
    float4 uDetail;     // fineDetail, textureClarity, edgeDetail, localContrast
    float4 uDetail2;    // distantDetail, denoise, deband, detailBoost
    float4 uShadow;     // shadowQuality, shadowDetail, shadowStability, shadowSoftness
    float4 uLight;      // contactShadow, lightingQuality, lightDetail, exposure
    float4 uLight2;     // dynamicRange, highlightsAmount, reflectionStrength, reflectionStabilize
    float4 uScene;      // veg, particles, water, charProtect
    float4 uColor;      // brightness, contrast, saturation, gamma
    float4 uColor2;     // highlights, shadows, temperature, hdrAmount
    float4 uFinal;      // sharpen, hdrOut, master, unused
};

float Luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }
float Hash12(float2 p) {
    float3 p3 = frac(float3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return frac((p3.x + p3.y) * p3.z);
}
float3 SrgbToLinear(float3 c) { return pow(max(c, 0.0), 2.2); }
float3 LinearToSrgb(float3 c) { return pow(max(c, 0.0), 1.0 / 2.2); }
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_LINEARIZE = R"NXSH(
Texture2D<float4> tSrc : register(t0);
RWTexture2D<float4> uLin : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 inSize = (uint2)uSizes.zw;
    if (id.x >= inSize.x || id.y >= inSize.y) return;
    float3 c = tSrc[id.xy].rgb;
    uLin[id.xy] = float4(SrgbToLinear(c), 1.0);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_LOWCUR = R"NXSH(
Texture2D<float4> tLin : register(t0);
RWTexture2D<float> uLow : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 lowSize = (uint2)(uSizes.zw / 4.0);
    if (id.x >= lowSize.x || id.y >= lowSize.y) return;
    uint2 base = id.xy * 4;
    float sum = 0;
    [unroll]
    for (int y = 0; y < 4; y++)
    [unroll]
    for (int x = 0; x < 4; x++)
        sum += Luma(tLin[min(base + uint2(x, y), (uint2)uSizes.zw - 1)].rgb);
    uLow[id.xy] = sum / 16.0;
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_MOTION = R"NXSH(
Texture2D<float> tPrev : register(t0);
Texture2D<float> tCur  : register(t1);
RWTexture2D<float2> uMotion : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 lowSize = (uint2)(uSizes.zw / 4.0);
    uint2 blkSize = lowSize / 8;
    if (id.x >= blkSize.x || id.y >= blkSize.y) return;
    uint2 blk = id.xy * 8;
    float best = 1e30; int2 bestOff = int2(0, 0);
    static const int2 coarse[13] = {
        int2(0,0), int2(-2,0), int2(2,0), int2(0,-2), int2(0,2),
        int2(-4,0), int2(4,0), int2(0,-4), int2(0,4),
        int2(-6,0), int2(6,0), int2(0,-6), int2(0,6) };
    [unroll]
    for (int ci = 0; ci < 13; ci++) {
        int2 off = coarse[ci];
        float sad = 0;
        [unroll]
        for (int y = 0; y < 8; y += 2)
        [unroll]
        for (int x = 0; x < 8; x += 2) {
            uint2 p = min(blk + uint2(x, y), lowSize - 1);
            int2 q = clamp(int2(p) + off, int2(0, 0), int2(lowSize) - 1);
            sad += abs(tCur[p] - tPrev[q]);
        }
        if (sad < best) { best = sad; bestOff = off; }
    }
    int2 c = bestOff;
    [unroll]
    for (int ry = -1; ry <= 1; ry++)
    [unroll]
    for (int rx = -1; rx <= 1; rx++) {
        if (rx == 0 && ry == 0) continue;
        int2 off = bestOff + int2(rx, ry);
        float sad = 0;
        [unroll]
        for (int y = 0; y < 8; y += 2)
        [unroll]
        for (int x = 0; x < 8; x += 2) {
            uint2 p = min(blk + uint2(x, y), lowSize - 1);
            int2 q = clamp(int2(p) + off, int2(0, 0), int2(lowSize) - 1);
            sad += abs(tCur[p] - tPrev[q]);
        }
        if (sad < best) { best = sad; c = off; }
    }
    uMotion[id.xy] = float2(c) * 4.0;   // motion in INPUT pixels (cur -> prev)
}
)NXSH";

// ---------------------------------------------------------------------------
// Edge-directed upscaling: classify dominant edge direction from the 3x3 luma
// neighbourhood, then apply a sharper cubic across the edge and a smoother
// cubic along it (real edge-adaptive reconstruction, not bilinear stretch).
static const char* CS_UPSCALE = R"NXSH(
Texture2D<float4> tLin : register(t0);
RWTexture2D<float4> uUp : register(u0);
float4 CubicWeights(float f, float B, float C) {
    float f2 = f * f, f3 = f2 * f;
    float w0 = ((-B - 6*C)*f3 + (6*B + 30*C)*f2 + (-12*B - 48*C)*f + (8*B + 24*C)) / 6;
    float w1 = ((12*B - 9*C)*f3 + (-18*B + 12*C)*f2 + (6*B - 3*C)*f + 0) / 6;
    float w2 = ((-12*B + 9*C)*f3 + (18*B - 15*C)*f2 + (6*B + 3*C)*f + 0) / 6;
    float w3 = ((B + 6*C)*f3 + (-6*B - 18*C)*f2 + (12*B - 6*C)*f + 0) / 6;
    return float4(w0, w1, w2, w3);
}
float3 SampleCubic(Texture2D<float4> tex, float2 pos, float2 inSize, bool sharpX) {
    float2 tc = pos + 0.5;
    float2 f = frac(tc);
    int2 i = int2(floor(tc));
    // Catmull-Rom family; sharp variant keeps edges crisp across the edge axis
    float B = sharpX ? 0.0 : 0.35;
    float C = sharpX ? 0.5 : 0.30;
    float4 wx = CubicWeights(f.x, B, C);
    float4 wy = CubicWeights(f.y, B, C);
    float3 acc = 0; float wsum = 0;
    [unroll]
    for (int y = -1; y <= 2; y++) {
        float wyv = wy[y + 1];
        [unroll]
        for (int x = -1; x <= 2; x++) {
            float wxv = wx[x + 1];
            int2 p = clamp(i + int2(x, y), int2(0,0), int2(inSize) - 1);
            acc += tex[p].rgb * wxv * wyv;
            wsum += wxv * wyv;
        }
    }
    return acc / max(wsum, 1e-5);
}
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    uint2 inSize = (uint2)uSizes.zw;
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    float2 pos = (id.xy + 0.5) * (float2(inSize) / float2(outSize)) - 0.5;
    // luma gradients from nearest input texels
    int2 base = int2(floor(pos + 0.5));
    int2 p0 = clamp(base + int2(-1,0), 0, int2(inSize)-1);
    int2 p1 = clamp(base + int2( 1,0), 0, int2(inSize)-1);
    int2 p2 = clamp(base + int2(0,-1), 0, int2(inSize)-1);
    int2 p3 = clamp(base + int2(0, 1), 0, int2(inSize)-1);
    float l0 = Luma(tLin[p0].rgb), l1 = Luma(tLin[p1].rgb);
    float l2 = Luma(tLin[p2].rgb), l3 = Luma(tLin[p3].rgb);
    float gx = abs(l1 - l0), gy = abs(l3 - l2);
    float3 c;
    if (gx > gy * 1.25)      c = SampleCubic(tLin, pos, float2(inSize), true);  // horizontal edge: sharp in x
    else if (gy > gx * 1.25) c = SampleCubic(tLin, pos, float2(inSize), false); // vertical edge: sharp in y
    else                     c = SampleCubic(tLin, pos, float2(inSize), true);
    // anti-ring: soft clamp into 3x3 input min/max
    int2 bi = int2(floor(pos));
    float3 mn = 10, mx = -10;
    [unroll]
    for (int y = -1; y <= 2; y++)
    [unroll]
    for (int x = -1; x <= 2; x++) {
        int2 q = clamp(bi + int2(x, y), 0, int2(inSize)-1);
        float3 v = tLin[q].rgb;
        mn = min(mn, v); mx = max(mx, v);
    }
    float3 cl = clamp(c, mn, mx);
    c = lerp(c, cl, 0.5);
    uUp[id.xy] = float4(max(c, 0), 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_TEMPORAL = R"NXSH(
Texture2D<float4> tUp   : register(t0);
Texture2D<float4> tHist : register(t1);
Texture2D<float2> tMotion : register(t2);
RWTexture2D<float4> uCur : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    uint2 lowSize = (uint2)(uSizes.zw / 4.0);
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    float2 pos = id.xy;
    float2 mvOut = 0;
    if (uFrame.x > 0.5) {
        float2 mc = (pos + 0.5) * (float2(lowSize) / float2(outSize));
        float2 mv = tMotion.SampleLevel(sLinear, mc / float2(lowSize), 0);
        mvOut = mv * 4.0 * (float2(outSize) / float2(uSizes.zw)); // lowres->input->output px
    }
    float3 cur = tUp[id.xy].rgb;
    if (uFrame.x < 0.5) { uCur[id.xy] = float4(cur, 1); return; }
    float2 prevPos = pos + 0.5 + mvOut;
    float3 hist = tHist.SampleLevel(sLinear, prevPos / float2(outSize), 0).rgb;
    // neighbourhood clamp (3x3 of current upscaled frame)
    float3 mn = 10, mx = -10;
    [unroll]
    for (int y = -1; y <= 1; y++)
    [unroll]
    for (int x = -1; x <= 1; x++) {
        uint2 q = clamp(pos + int2(x, y), uint2(0,0), outSize - 1);
        float3 v = tUp[q].rgb;
        mn = min(mn, v); mx = max(mx, v);
    }
    float3 mid = (mn + mx) * 0.5;
    float3 ext = (mx - mn);
    float k = uTemporal.y;
    float3 clampedHist = clamp(hist, mid - ext * (0.5 + k), mid + ext * (0.5 + k));
    float clampDist = length((hist - clampedHist)) / (length(ext) * 0.5 + 1e-4);
    float motionMag = length(mvOut);
    float conf = saturate(1.0 - motionMag / 14.0);          // large motion -> less history
    conf *= saturate(1.0 - clampDist * 1.5);                // disocclusion -> history rejected
    float alpha = uTemporal.x;                              // base current-frame weight
    alpha += (1.0 - alpha) * (1.0 - conf);
    // thin geometry / vegetation protection: high local variance keeps more current
    float variance = length(mx - mn);
    alpha += saturate(variance * 2.0) * uTemporal.z * 0.25;
    alpha = saturate(alpha);
    float3 outC = lerp(clampedHist, cur, alpha);
    uCur[id.xy] = float4(outC, 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_DOWN = R"NXSH(
Texture2D<float4> tSrc : register(t0);
RWTexture2D<float4> uDst : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 dstSize;
    uDst.GetDimensions(dstSize.x, dstSize.y);
    if (id.x >= dstSize.x || id.y >= dstSize.y) return;
    uint2 srcSize = dstSize * 2;
    uint2 b = id.xy * 2;
    float3 s = tSrc[min(b, srcSize-1)].rgb + tSrc[min(b+uint2(1,0), srcSize-1)].rgb
             + tSrc[min(b+uint2(0,1), srcSize-1)].rgb + tSrc[min(b+uint2(1,1), srcSize-1)].rgb;
    uDst[id.xy] = float4(s * 0.25, 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_AA = R"NXSH(
Texture2D<float4> tSrc : register(t0);
RWTexture2D<float4> uDst : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    int2 p = id.xy;
    #define LD(ox,oy) tSrc[clamp(p+int2(ox,oy), int2(0,0), int2(outSize)-1)].rgb
    float3 c = LD(0,0);
    float l  = Luma(c);
    float lu = Luma(LD(0,-1)), ld = Luma(LD(0,1)), ll = Luma(LD(-1,0)), lr = Luma(LD(1,0));
    float gx = abs(lr - ll) * 0.5 + abs(l - (lu + ld) * 0.5) * 0.25;
    float gy = abs(ld - lu) * 0.5 + abs(l - (ll + lr) * 0.5) * 0.25;
    float edge = sqrt(gx * gx + gy * gy);
    float thr = uSplit.z;
    if (edge > thr && uSplit.y > 0) {
        // blend along the edge tangent (perpendicular to gradient)
        float2 grad = normalize(float2(gx, gy) + 1e-6);
        float rad = uSplit.w;
        float3 acc = c; float wsum = 1.0;
        [unroll]
        for (int s = -2; s <= 2; s++) {
            if (s == 0) continue;
            float2 off = -grad * float(s) * rad;
            bool xdom = abs(grad.x) < abs(grad.y);
            int2 o = xdom ? int2(round(off.x), 0) : int2(0, round(off.y));
            float2 q = clamp(float2(p) + off, float2(0,0), float2(outSize) - 1.001);
            float3 v = tSrc.SampleLevel(sLinear, q / float2(outSize), 0).rgb;
            float w = (abs(s) == 1) ? 1.0 : 0.55;
            acc += v * w; wsum += w;
        }
        float3 smoothed = acc / wsum;
        // keep the pixel only as close as strength says; preserve luma to avoid blur feel
        float l2 = Luma(smoothed);
        smoothed *= (l / (l2 + 1e-4));
        c = lerp(c, smoothed, uSplit.y);
    }
    uDst[id.xy] = float4(c, 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_DETAIL = R"NXSH(
Texture2D<float4> tSrc  : register(t0);
Texture2D<float4> tChain : register(t1);   // chain level 3 (out/8) bilinear
RWTexture2D<float4> uDst : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    int2 p = id.xy;
    #define LD(ox,oy) tSrc[clamp(p+int2(ox,oy), int2(0,0), int2(outSize)-1)].rgb
    float3 c = LD(0,0);
    float y = Luma(c);
    // small blur (RGB)
    float3 b3 = LD(-1,-1)+LD(0,-1)+LD(1,-1)+LD(-1,0)+c+LD(1,0)+LD(-1,1)+LD(0,1)+LD(1,1);
    b3 /= 9.0;
    // medium blur (luma only, 5x5 sparse)
    float lm = 0;
    [unroll]
    for (int yy = -2; yy <= 2; yy += 1)
    [unroll]
    for (int xx = -2; xx <= 2; xx += 1) {
        uint2 q = clamp(p + int2(xx, yy), uint2(0,0), outSize - 1);
        lm += Luma(tSrc[q].rgb);
    }
    lm /= 25.0;
    float yb3 = Luma(b3);
    float3 base = tChain.SampleLevel(sLinear, (p + 0.5) / float2(outSize), 0).rgb;
    float lbase = Luma(base);
    float edgeMag = abs(y - yb3) * 3.0;
    float edgeProt = 1.0 / (1.0 + edgeMag * 4.0);       // avoid halos on strong edges
    // fine detail (edge detail)
    c += (c - b3) * uDetail.z * (0.35 + 0.65 * edgeProt) * uDetail2.w;
    // mid detail (texture clarity) - luma-guided chroma transfer
    float midDetail = yb3 - lm;
    float midScale = saturate(lm / (max(y, 1e-4)));
    c += (c - b3) * uDetail.y * midDetail * midScale * 2.0;
    // distant detail: haze proxy = low local contrast + bright flat areas
    float localContrast = abs(y - lm);
    float haze = saturate(1.0 - localContrast * 14.0) * saturate(y * 1.2 - 0.1);
    haze *= uDetail2.x;
    if (haze > 0.001) {
        float3 airlight = base;
        float w = haze * 0.35;
        c = (c - airlight * w) / max(1.0 - w * 0.55, 0.3);
        c += (c - b3) * haze * 0.8;                      // restore lost micro detail
    }
    // local contrast (CLAHE-like, large radius via chain)
    c += (c - lerp(c, base, 0.85)) * uDetail.w * 0.8;
    // edge-aware denoise (artifact reduction)
    if (uDetail2.y > 0.001) {
        float3 mn = 10, mx = -10;
        [unroll]
        for (int yy = -1; yy <= 1; yy++)
        [unroll]
        for (int xx = -1; xx <= 1; xx++) {
            float3 v = LD(xx, yy);
            mn = min(mn, v); mx = max(mx, v);
        }
        float range = length(mx - mn);
        float k = uDetail2.y * saturate(1.0 - range * 3.0);
        c = lerp(c, b3, k * 0.6);
    }
    uDst[id.xy] = float4(max(c, 0), 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_LIGHT = R"NXSH(
Texture2D<float4> tSrc  : register(t0);
Texture2D<float4> tChain3 : register(t1);  // out/8
Texture2D<float4> tChain5 : register(t2);  // out/32
Texture2D<float4> tPrevMask : register(t3);
Texture2D<float2> tMotion : register(t4);
RWTexture2D<float4> uDst : register(u0);
RWTexture2D<float4> uMask : register(u1);  // r=ao g=shadow b=spec a=unused
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    int2 p = id.xy;
    float3 c = tSrc[p].rgb;
    float y = Luma(c);
    float3 b3 = tSrc[clamp(p+int2(1,0), int2(0,0), int2(outSize)-1)].rgb
              + tSrc[clamp(p-int2(1,0), int2(0,0), int2(outSize)-1)].rgb
              + tSrc[clamp(p+int2(0,1), int2(0,0), int2(outSize)-1)].rgb
              + tSrc[clamp(p-int2(0,1), int2(0,0), int2(outSize)-1)].rgb;
    b3 = (b3 + c) * 0.2;
    float yb3 = Luma(b3);
    float3 base = tChain5.SampleLevel(sLinear, (p + 0.5) / float2(outSize), 0).rgb;
    float lbase = Luma(base);
    float edgeMag = abs(y - yb3) * 3.0;

    // ---- screen-space AO proxy: crease darkening in structured concavities ----
    float ao = 0;
    if (uTemporal.w > 0.001) {
        float crease = saturate((lbase - y) * 5.0) * saturate(edgeMag * 6.0);
        crease = min(crease, edgeMag * 2.5);              // halo guard
        float contact = saturate((yb3 * 0.65 - y) * 4.0) * saturate(1.0 - lbase * 2.0);
        ao = saturate(crease + contact * uLight.x) * uTemporal.w;
        c *= 1.0 - ao * 0.45;                             // multiplicative occlusion
    }

    // ---- shadow enhancement: quality mask + in-mask detail + stability ----
    float shMask = smoothstep(0.45, 0.05, y);
    float shSoft = smoothstep(0.55, 0.15, lbase * 1.2);
    shMask = lerp(shMask, min(shMask, shSoft + 0.25), uShadow.w * 0.6);
    if (uShadow.z > 0.001) {
        uint2 lowSize = (uint2)(uSizes.zw / 4.0);
        float2 mv = tMotion.SampleLevel(sLinear, ((p + 0.5) * (float2(lowSize) / float2(outSize))) / float2(lowSize), 0);
        float2 prevPos = (p + 0.5 + mv * 4.0 * (float2(outSize) / float2(uSizes.zw))) / float2(outSize);
        float pm = tPrevMask.SampleLevel(sLinear, prevPos, 0).g;
        shMask = lerp(shMask, pm, uShadow.z * 0.6);
    }
    if (uShadow.x > 0.001) {
        // reveal detail inside shadows, lift shadow gamma slightly
        c += (c - b3) * uShadow.y * shMask * 1.6;
        c = lerp(c, pow(max(c, 0), 1.0 - 0.15 * uShadow.x), shMask * 0.8);
    }

    // ---- lighting: exposure, highlight compression, local light detail ----
    c *= uLight.w;
    if (uLight2.y > 0.001) {
        float hThr = lerp(0.55, 0.85, uLight2.y);
        float over = saturate((y - hThr) / max(1.0 - hThr, 0.05));
        float roll = 1.0 - over * over * uLight2.y * 0.55;   // soft shoulder
        c *= lerp(1.0, roll, saturate(over * 1.4)) * (1.0 + over * 0.05);
    }
    c += (c - b3) * uLight.z * 0.5 * uLight.y;

    // ---- reflection enhancement: specular stabilise + sharpen ----
    float spec = 0;
    if (uLight2.z > 0.001) {
        float3 sat = c - Luma(c);
        float specM = saturate((y - Luma(b3) * 1.35) * 5.0) * saturate(1.0 - length(sat) * 3.0);
        spec = specM * uLight2.z;
        if (uLight2.w > 0.001) {
            uint2 lowSize = (uint2)(uSizes.zw / 4.0);
            float2 mv = tMotion.SampleLevel(sLinear, ((p + 0.5) * (float2(lowSize) / float2(outSize))) / float2(lowSize), 0);
            float2 prevPos = (p + 0.5 + mv * 4.0 * (float2(outSize) / float2(uSizes.zw))) / float2(outSize);
            float ps = tPrevMask.SampleLevel(sLinear, prevPos, 0).b;
            spec = lerp(spec, ps, uLight2.w * 0.5);
        }
        c += (c - b3) * spec * 1.2;
    }

    uMask[id.xy] = float4(ao, shMask, spec, 1);
    uDst[id.xy] = float4(max(c, 0), 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_SCENE = R"NXSH(
Texture2D<float4> tSrc : register(t0);
RWTexture2D<float4> uDst : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    int2 p = id.xy;
    #define LD(ox,oy) tSrc[clamp(p+int2(ox,oy), int2(0,0), int2(outSize)-1)].rgb
    float3 c = LD(0,0);
    float y = Luma(c);
    float3 b3 = (LD(-1,-1)+LD(0,-1)+LD(1,-1)+LD(-1,0)+c+LD(1,0)+LD(-1,1)+LD(0,1)+LD(1,1)) / 9.0;
    float hf = abs(y - Luma(b3)) * 4.0;                  // high frequency energy

    // vegetation: shimmer control + natural clarity
    float veg = saturate((c.g - max(c.r, c.b) * 0.92) * 3.0) * saturate(hf * 2.0);
    if (veg > 0.001 && uScene.x > 0.001) {
        c = lerp(c, b3, veg * uScene.x * 0.35);          // calm high-frequency shimmer
        c = lerp(c, saturate(c * 1.04 + (c - b3) * uScene.x * 0.5), veg);
    }

    // particles: small bright blobs -> gentle contrast + flicker smoothing
    float bright = saturate((y - Luma(b3) * 1.5) * 4.0);
    bool localMax = y >= max(max(Luma(LD(1,0)), Luma(LD(-1,0))), max(Luma(LD(0,1)), Luma(LD(0,-1))));
    float pk = bright * (localMax ? 1.0 : 0.4);
    if (pk > 0.001 && uScene.y > 0.001) {
        c *= 1.0 + pk * 0.10 * uScene.y;
        c = lerp(c, b3, pk * uScene.y * 0.2);
    }

    // water: blue-cyan low-sat horizontal streaks -> streak stability + sharpening
    float sat = length(c - y);
    float wm = saturate((c.b - c.r) * 2.0) * saturate(1.0 - sat * 3.0) * saturate(hf * 1.5);
    if (wm > 0.001 && uScene.z > 0.001) {
        float hl = Luma(LD(2,0)), hr = Luma(LD(-2,0));
        float streak = (y - (hl + hr) * 0.5);
        c += streak * wm * uScene.z * 0.6;
    }

    // character (skin) protection: keep faces clean of overshoot artifacts
    float skin = saturate((c.r - c.b) * 1.6) * saturate((c.r - c.g * 0.85) * 1.4) * saturate(y * 2.2);
    if (skin > 0.001 && uScene.w > 0.001) c = lerp(c, b3, skin * uScene.w * 0.22);

    uDst[id.xy] = float4(max(c, 0), 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_COLOR = R"NXSH(
Texture2D<float4> tSrc : register(t0);
RWTexture2D<float4> uDst : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    float3 c = tSrc[id.xy].rgb;

    c *= uColor.x;                                        // brightness
    c = (c - 0.18) * uColor.y + 0.18;                     // contrast around mid grey
    float temp = uColor2.z;
    c *= float3(1.0 + temp * 0.06, 1.0, 1.0 - temp * 0.06);

    float y = Luma(c);
    c = lerp(float3(y, y, y), c, uColor.z);               // saturation

    // shadows lift / highlight rolloff (0..1 amounts)
    float sh = uColor2.y;
    if (sh > 0.001) {
        float sm = smoothstep(0.30, 0.0, y);
        c += sm * sh * 0.10;
    }
    float hl = uColor2.x;
    if (hl > 0.001) {
        float hm = smoothstep(0.6, 1.0, y);
        c = lerp(c, 1.0 - (1.0 - c) * (1.0 - c), hm * hl * 0.35);
    }

    c = max(c, 0);
    if (uColor2.w > 0.001) {                              // HDR-like soft shoulder
        float peak = 1.0 + uColor2.w * 2.0;
        c *= peak;
        c = c / (1.0 + c) * (1.0 + uColor2.w);            // reinhard to target range
    }
    c = pow(max(c, 0), 1.0 / max(uColor.w, 0.2));         // gamma

    uDst[id.xy] = float4(c, 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_FINAL = R"NXSH(
Texture2D<float4> tCol    : register(t0);
Texture2D<float4> tSrcRaw : register(t1);   // raw capture (BGRA8, input res) for ORIGINAL view
RWTexture2D<float4> uOut  : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    uint2 inSize = (uint2)uSizes.zw;
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    int mode = (int)uFrame.w;

    float3 c;
    bool original = (mode == 1) || (mode == 2 && (float)id.x < uSplit.x * (float)outSize.x);
    if (original) {
        c = tSrcRaw.SampleLevel(sLinear, (id.xy + 0.5) / float2(outSize), 0).rgb;
        if ((int)uFinal.y == 0) c = SrgbToLinear(c); // kept linear path consistent below
    } else {
        c = tCol[id.xy].rgb;
        int2 p = id.xy;
        #define LD(ox,oy) tCol[clamp(p+int2(ox,oy), int2(0,0), int2(outSize)-1)].rgb
        float shp = uFinal.x;
        if (shp > 0.001) {
            float3 b = (LD(-1,-1)+LD(0,-1)+LD(1,-1)+LD(-1,0)+c+LD(1,0)+LD(-1,1)+LD(0,1)+LD(1,1)) / 9.0;
            float3 s = c + (c - b) * shp * 1.6;
            float3 mn = min(c, min(min(LD(-1,0), LD(1,0)), min(LD(0,-1), LD(0,1))));
            float3 mx = max(c, max(max(LD(-1,0), LD(1,0)), max(LD(0,-1), LD(0,1))));
            s = s - (s - clamp(s, mn, mx)) * 0.55;    // overshoot control
            c = s;
        }
        if ((int)uFinal.y == 0) {
            c = LinearToSrgb(max(c, 0));
            if (uFrame.z > 0 || uDetail2.z > 0.001) { /* dither below */ }
            float d = (Hash12((float2)id.xy + frac(uFrame.z)) - 0.5) * (uDetail2.z * 1.2 + 0.4) / 255.0;
            c += d;
        }
    }
    if (mode == 2) {
        float dpx = abs((float)id.x - uSplit.x * (float)outSize.x);
        if (dpx < 1.2) c = float3(1, 1, 1);
    }
    float3 o;
    if ((int)uFinal.y == 0) {
        // SDR: enhanced path was re-encoded to sRGB above; original path kept as-is
        o = original ? c : saturate(c);
    } else {
        o = max(c, 0); // HDR: linear scRGB
    }
    uOut[id.xy] = float4(o.b, o.g, o.r, 1);   // swap to BGRA
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_BYPASS = R"NXSH(
Texture2D<float4> tSrcRaw : register(t0);
RWTexture2D<float4> uOut  : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 outSize = (uint2)uSizes.xy;
    if (id.x >= outSize.x || id.y >= outSize.y) return;
    float3 c = tSrcRaw.SampleLevel(sLinear, (id.xy + 0.5) / float2(outSize), 0).rgb;
    uOut[id.xy] = float4(c.b, c.g, c.r, 1);
}
)NXSH";

// ---------------------------------------------------------------------------
static const char* CS_TEST = R"NXSH(
// Synthetic animated scene for the built-in self test / demo mode.
RWTexture2D<float4> uLin : register(u0);
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
    uint2 inSize = (uint2)uSizes.zw;
    if (id.x >= inSize.x || id.y >= inSize.y) return;
    float2 uv = (float2)id.xy / float2(inSize);
    float t = uFrame.z;
    // sky gradient
    float3 c = lerp(float3(0.18, 0.30, 0.48), float3(0.75, 0.82, 0.92), pow(uv.y, 0.8));
    // moving checker grid (fine detail)
    float2 g = (id.xy + float2(t * 60.0, t * 30.0)) / 8.0;
    float ch = frac(floor(g.x) + floor(g.y)) < 0.5 ? 1.0 : 0.86;
    // buildings (parallax boxes)
    for (int i = 0; i < 5; i++) {
        float fi = i;
        float x = frac(uv.x * (0.7 + fi * 0.13) + t * (0.02 + fi * 0.012));
        float h = 0.35 + 0.28 * sin(fi * 2.3 + floor(t) * 0.7);
        if (uv.y > h && abs(x - 0.5) < 0.045) {
            c = float3(0.22 + 0.05 * fi, 0.24 + 0.05 * fi, 0.3 + 0.05 * fi);
            float win = step(0.5, frac(floor(id.y / 6.0) + floor(id.x / 4.0) + fi));
            c += win * float3(0.25, 0.22, 0.1);
        }
    }
    // ground plane with checker
    if (uv.y > 0.72) c = lerp(float3(0.10, 0.11, 0.12), float3(0.16, 0.17, 0.18), ch);
    // moving ball (temporal motion test)
    float2 bp = float2(0.5 + 0.35 * sin(t * 1.4), 0.45 + 0.18 * cos(t * 2.1)) * float2(inSize);
    float d = length((float2)id.xy - bp);
    if (d < 42) c = lerp(float3(0.95, 0.35, 0.2), float3(1, 1, 1), saturate(1 - d / 42) * 0.6);
    // thin grass strip (vegetation shimmer test)
    if (uv.y > 0.70 && uv.y < 0.72) {
        float blade = step(0.5, frac(sin(floor(id.x / 2.0) * 12.9898 + floor(t * 3) % 7) * 43758.5453));
        c = lerp(c, float3(0.15, 0.5, 0.18) * (0.7 + 0.3 * blade), 0.8);
    }
    uLin[id.xy] = float4(max(c, 0), 1);
}
)NXSH";
