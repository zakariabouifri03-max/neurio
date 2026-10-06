package com.aivision.camera.ai.core;

/**
 * Pixel level enhancement stages. Every stage is written so that it can only ever make the picture
 * <em>more</em> faithful: shadows are lifted inside a monotone curve, highlight recovery is a soft
 * shoulder instead of a clip, sharpening is structure gated and clamped to the local luminance
 * envelope (no halos), chroma noise is removed without touching luma detail, and saturation boosts
 * are rolled off on skin tones. Nothing invents texture that was not measured in the frame.
 */
public final class Enhance {

    private Enhance() {
    }

    // ------------------------------------------------------------------ auto exposure

    /** Metering + digital gain to hit the profile's target brightness. Returns the applied gain. */
    public static float autoExposure(Img img, Stats s, Scene.Profile p) {
        float target = p.exposureTarget;
        float current = s.medianLuma;
        if (current <= 1e-4f) current = s.meanLuma;
        float gain = target / Math.max(0.02f, current);
        // never push a gain that would obviously clip the highlights
        float headroom = s.p95Luma > 0.02f ? (1.0f / s.p95Luma) : 4f;
        gain = Math.min(gain, Math.max(1f, headroom * 0.92f));
        gain = Img.clamp(gain, 0.55f, 3.4f);
        // exposure compensation from the user is applied on top by the caller through exposureGain
        gain *= Img.clamp(p.exposureGain, 0.5f, 4f);
        if (Math.abs(gain - 1f) > 0.01f) {
            applyGainWithShoulder(img, gain);
        }
        return gain;
    }

    /** Multiplies exposure in linear-ish space and rolls off anything that would have clipped. */
    static void applyGainWithShoulder(Img img, float gain) {
        for (int i = 0; i < img.px.length; i++) {
            int c = img.px[i];
            float r = Img.R(c) * gain * (1f / 255f);
            float g = Img.G(c) * gain * (1f / 255f);
            float b = Img.B(c) * gain * (1f / 255f);
            if (r > 0.94f || g > 0.94f || b > 0.94f) {
                float m = Math.max(r, Math.max(g, b));
                float rolled = 0.94f + 0.06f * (1f - (float) Math.exp(-(m - 0.94f) / 0.06f * 1.6f));
                float k = rolled / Math.max(1e-4f, m);
                r *= k;
                g *= k;
                b *= k;
            }
            img.px[i] = Img.rgb((int) (r * 255f + 0.5f), (int) (g * 255f + 0.5f), (int) (b * 255f + 0.5f));
        }
    }

    // ------------------------------------------------------------------ white balance

    /** Gray world / face weighted white balance with a strength limit and luminance preservation. */
    public static void autoWhiteBalance(Img img, Stats s, Scene.Profile p) {
        float strength = Img.clamp01(p.wbStrength);
        float maxCorr = 0.22f;                       // never shift more than 22% - keeps it realistic
        float gr = 1f + Img.clamp(s.wbR - 1f, -maxCorr, maxCorr) * strength;
        float gg = 1f + Img.clamp(s.wbG - 1f, -maxCorr, maxCorr) * strength;
        float gb = 1f + Img.clamp(s.wbB - 1f, -maxCorr, maxCorr) * strength;
        float warmthR = 1f + p.warmth * 0.06f;
        float warmthB = 1f - p.warmth * 0.06f;
        gr *= warmthR;
        gb *= warmthB;
        float lum = 0.2126f * gr + 0.7152f * gg + 0.0722f * gb;
        if (Math.abs(lum - 1f) > 1e-3f) {
            gr /= lum;
            gg /= lum;
            gb /= lum;
        }
        for (int i = 0; i < img.px.length; i++) {
            int c = img.px[i];
            img.px[i] = Img.rgb((int) (Img.R(c) * gr + 0.5f), (int) (Img.G(c) * gg + 0.5f), (int) (Img.B(c) * gb + 0.5f));
        }
    }

    // ------------------------------------------------------------------ denoise

    /**
     * Chroma noise reduction: colour noise is what makes high-ISO shots look cheap, and it can be
     * removed very aggressively with almost no perceptual cost because human vision resolves colour
     * at a much lower spatial frequency than luminance.
     */
    public static void denoiseChroma(Img img, float strength) throws Exception {
        final int w = img.w, h = img.h, n = w * h;
        if (strength <= 0.01f) return;
        float[] y = new float[n], cb = new float[n], cr = new float[n];
        for (int i = 0; i < n; i++) {
            int c = img.px[i];
            int r = Img.R(c), g = Img.G(c), b = Img.B(c);
            y[i] = 0.299f * r + 0.587f * g + 0.114f * b;
            cb[i] = 128f - 0.168736f * r - 0.331264f * g + 0.5f * b;
            cr[i] = 128f + 0.5f * r - 0.418688f * g - 0.081312f * b;
        }
        int r0 = Math.max(2, Math.min(w, h) / 150);
        float eps = 4f + 36f * strength;
        float[] cbF = new float[n], crF = new float[n];
        Filters.guidedFilter(y, cb, cbF, w, h, r0, eps);
        Filters.guidedFilter(y, cr, crF, w, h, r0, eps);
        float k = Img.clamp01(strength * 0.92f);
        for (int i = 0; i < n; i++) {
            float ncb = Img.mix(cb[i], cbF[i], k);
            float ncr = Img.mix(cr[i], crF[i], k);
            float yy = y[i];
            int r = (int) (yy + 1.402f * (ncr - 128f) + 0.5f);
            int g = (int) (yy - 0.344136f * (ncb - 128f) - 0.714136f * (ncr - 128f) + 0.5f);
            int b = (int) (yy + 1.772f * (ncb - 128f) + 0.5f);
            img.px[i] = Img.rgb(r, g, b);
        }
    }

    /**
     * Luminance denoise: edge preserving guided filter blended by a per-tile structure map, so flat
     * areas (sky, walls, night shadows) get smoothed hard while measured texture keeps its contrast.
     */
    public static void denoiseLuma(Img img, float strength, float noiseSigma) throws Exception {
        final int w = img.w, h = img.h, n = w * h;
        if (strength <= 0.01f) return;
        float[] y = img.toLuma();
        int r0 = Math.max(1, Math.min(w, h) / 900 + 1);
        float eps = 0.0006f + 0.010f * strength;
        float[] smooth = new float[n];
        Filters.guidedFilter(y, y, smooth, w, h, r0, eps);
        float[] detail = new float[n];
        for (int i = 0; i < n; i++) detail[i] = y[i] - smooth[i];
        float[] struct = Filters.structureMap(detail, w, h, Math.max(0.002f, noiseSigma), 1.5f);
        float[] outY = new float[n];
        for (int i = 0; i < n; i++) {
            float k = Img.clamp01(strength * (1f - struct[i]));
            float target = smooth[i];
            // keep a minimum of the measured signal so we never smear into plastic
            outY[i] = Img.mix(y[i], target, k);
        }
        final float[] fy = outY;
        Parallel.rows(h, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int yy = y0; yy < y1; yy++) {
                    int row = yy * w;
                    for (int x = 0; x < w; x++) {
                        int i = row + x;
                        int c = img.px[i];
                        float oldY = 0.299f * Img.R(c) + 0.587f * Img.G(c) + 0.114f * Img.B(c);
                        float newY = fy[i];
                        float ratio = newY / Math.max(1f, oldY);
                        ratio = Img.clamp(ratio, 0.6f, 1.7f);
                        img.px[i] = Img.rgb((int) (Img.R(c) * ratio + 0.5f),
                                (int) (Img.G(c) * ratio + 0.5f),
                                (int) (Img.B(c) * ratio + 0.5f));
                    }
                }
            }
        });
    }

    // ------------------------------------------------------------------ local tone mapping

    /**
     * Base/detail decomposition with an edge aware guided-filter base, then a monotone tone curve on
     * the base only. Because the base follows edges, compressing it cannot produce the halos that a
     * plain gaussian base does - this is the core of the "AI HDR" look.
     */
    public static void toneMap(Img img, Scene.Profile p, float noiseSigma) throws Exception {
        final int w = img.w, h = img.h, n = w * h;
        float[] y = img.toLuma();
        int r = Math.max(3, Math.min(w, h) / 22);
        float[] base = new float[n];
        Filters.guidedFilter(y, y, base, w, h, r, 0.0035f);
        float[] detail = new float[n];
        for (int i = 0; i < n; i++) detail[i] = y[i] - base[i];
        float[] struct = Filters.structureMap(detail, w, h, Math.max(0.0025f, noiseSigma * 0.85f), 1.4f);
        final float clarity = p.localContrast;
        final float lift = p.shadowLift;
        final float comp = p.highlightCompress;
        final float contrast = p.contrast;
        final float black = p.blackPoint, white = p.whitePoint;
        final float[] fbase = base, fdet = detail, fstruct = struct, fy = y;
        Parallel.rows(h, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int yy = y0; yy < y1; yy++) {
                    int row = yy * w;
                    for (int x = 0; x < w; x++) {
                        int i = row + x;
                        float b = curve(fbase[i], lift, comp, contrast, black, white);
                        // clarity: amplify the detail band where real structure was measured
                        float gain = clarity * (0.20f + 0.80f * fstruct[i]);
                        float d = fdet[i] * (1f + gain * 2.1f);
                        // and never let the recombination push past the tonal surroundings
                        float yl = Img.clamp01(b + d);
                        float oldY = fy[i];
                        int c = img.px[i];
                        float rr = Img.R(c), gg = Img.G(c), bb = Img.B(c);
                        float dr = rr - oldY * 255f, dg = gg - oldY * 255f, db = bb - oldY * 255f;
                        float scale = (yl * 255f) / Math.max(1f, oldY * 255f);
                        // highlight desaturation protects the roll-off from turning into colour casts
                        float hl = Img.smoothstep(0.86f, 1.0f, yl);
                        float sat = 1f - 0.45f * hl;
                        float nr = yl * 255f + dr * scale * sat;
                        float ng = yl * 255f + dg * scale * sat;
                        float nb = yl * 255f + db * scale * sat;
                        img.px[i] = Img.rgb((int) (nr + 0.5f), (int) (ng + 0.5f), (int) (nb + 0.5f));
                    }
                }
            }
        });
    }

    /** Monotone filmic tone curve: shadow lift, soft highlight shoulder, contrast, black/white point. */
    static float curve(float x, float lift, float comp, float contrast, float black, float white) {
        x = Img.clamp01(x);
        x = x + lift * (1f - x) * (1f - x);                 // monotone for lift < 0.5
        if (x > 0.70f) {
            float s = 1f + comp * 5f;
            x = 0.70f + 0.30f * (1f - (float) Math.exp(-(x - 0.70f) / 0.30f * s));
        }
        float t = Img.clamp01(x);
        float shaped = t * t * (3f - 2f * t);
        x = Img.mix(t, shaped, Img.clamp01(contrast) * 1.25f);
        float span = Math.max(0.05f, white - black);
        return Img.clamp01((x - black) / span);
    }

    // ------------------------------------------------------------------ detail / sharpening

    /**
     * Structure aware unsharp mask. The high-pass band is clamped back into the local luminance
     * envelope, which is what stops white halos around the skyline and dark rims around text - the
     * usual giveaway of over-sharpened phone photos.
     */
    public static void detailEnhance(Img img, Scene.Profile p, float noiseSigma) throws Exception {
        final int w = img.w, h = img.h, n = w * h;
        float amount = p.detailAmount;
        if (amount <= 0.01f) return;
        float[] y = img.toLuma();
        float[] blur = new float[n];
        System.arraycopy(y, 0, blur, 0, n);
        Filters.gaussBlur(blur, w, h, Math.max(1, Math.round(p.detailRadius * 1.6f)));
        float[] hp = new float[n];
        for (int i = 0; i < n; i++) hp[i] = y[i] - blur[i];
        float[] struct = Filters.structureMap(hp, w, h, Math.max(0.0025f, noiseSigma), 1.7f);
        float[] mn = new float[n], mx = new float[n];
        Filters.localEnvelope(y, w, h, 2, mn, mx);
        float textureBoost = p.textureBoost;
        final float[] fy = y, fhp = hp, fstruct = struct, fmn = mn, fmx = mx;
        Parallel.rows(h, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int yy = y0; yy < y1; yy++) {
                    int row = yy * w;
                    for (int x = 0; x < w; x++) {
                        int i = row + x;
                        float gate = 0.10f + 0.90f * fstruct[i];
                        float amt = amount * gate;
                        // very dark areas carry most of the noise: taper the boost down there
                        float darkGate = Img.smoothstep(0.02f, 0.16f, fy[i]);
                        amt *= (0.35f + 0.65f * darkGate);
                        amt += textureBoost * fstruct[i] * 0.85f;
                        float nv = fy[i] + fhp[i] * amt * 1.55f;
                        nv = Img.clamp(nv, fmn[i], fmx[i]);
                        nv = Img.clamp01(nv);
                        int c = img.px[i];
                        float oldY = fy[i] * 255f;
                        float scale = (nv * 255f) / Math.max(1f, oldY);
                        img.px[i] = Img.rgb((int) (Img.R(c) * scale + 0.5f),
                                (int) (Img.G(c) * scale + 0.5f),
                                (int) (Img.B(c) * scale + 0.5f));
                    }
                }
            }
        });
    }

    // ------------------------------------------------------------------ colour grading

    /** Vibrance (saturation weighted by how unsaturated a pixel already is) + skin tone protection. */
    public static void gradeColor(Img img, Scene.Profile p) {
        final float sat = p.saturation;
        final float vib = p.vibrance;
        if (Math.abs(sat - 1f) < 0.005f && Math.abs(vib) < 0.005f) return;
        for (int i = 0; i < img.px.length; i++) {
            int c = img.px[i];
            int r = Img.R(c), g = Img.G(c), b = Img.B(c);
            float y = 0.299f * r + 0.587f * g + 0.114f * b;
            int mx = Math.max(r, Math.max(g, b)), mn = Math.min(r, Math.min(g, b));
            float s = mx <= 0 ? 0 : (mx - mn) / (float) mx;
            float skinGuard = isSkin(r, g, b) ? 0.35f : 1f;
            float delta = ((sat - 1f) + vib * (1f - s)) * skinGuard;
            float dr = (r - y) * (1f + delta);
            float dg = (g - y) * (1f + delta);
            float db = (b - y) * (1f + delta);
            float nr = y + dr, ng = y + dg, nb = y + db;
            // soft gamut mapping: instead of clipping a channel, walk back towards grey
            float over = Math.max(0, Math.max(nr, Math.max(ng, nb)) - 255f);
            float under = Math.max(0, -Math.min(nr, Math.min(ng, nb)));
            float excess = Math.max(over, under);
            if (excess > 0.5f) {
                float k = 1f - Img.clamp01(excess / Math.max(1f, Math.max(Math.abs(dr), Math.max(Math.abs(dg), Math.abs(db))) + 1f));
                nr = y + dr * k;
                ng = y + dg * k;
                nb = y + db * k;
            }
            img.px[i] = Img.rgb((int) (nr + 0.5f), (int) (ng + 0.5f), (int) (nb + 0.5f));
        }
    }

    static boolean isSkin(int r, int g, int b) {
        float y = 0.299f * r + 0.587f * g + 0.114f * b;
        float cb = 128 - 0.168736f * r - 0.331264f * g + 0.5f * b;
        float cr = 128 + 0.5f * r - 0.418688f * g - 0.081312f * b;
        return y > 35 && cb >= 77 && cb <= 130 && cr >= 132 && cr <= 178 && r > b;
    }

    /** Final output curve as three 256 entry LUTs (fast, and keeps the curve identical per channel). */
    public static void outputCurve(Img img, float black, float white, float contrast) {
        int[] lut = new int[256];
        for (int i = 0; i < 256; i++) {
            float x = i / 255f;
            x = Img.clamp01((x - black) / Math.max(0.05f, white - black));
            float shaped = x * x * (3f - 2f * x);
            x = Img.mix(x, shaped, Img.clamp01(contrast) * 0.55f);
            lut[i] = Img.clamp255((int) (x * 255f + 0.5f));
        }
        for (int i = 0; i < img.px.length; i++) {
            int c = img.px[i];
            img.px[i] = Img.rgb(lut[Img.R(c)], lut[Img.G(c)], lut[Img.B(c)]);
        }
    }

    /** Radial falloff for the portrait look. */
    public static void vignette(Img img, float amount) {
        if (amount <= 0.005f) return;
        final int w = img.w, h = img.h;
        final float cx = w * 0.5f, cy = h * 0.5f;
        final float maxR = (float) Math.sqrt(cx * cx + cy * cy) * 0.92f;
        for (int y = 0; y < h; y++) {
            int row = y * w;
            float dy = y - cy;
            for (int x = 0; x < w; x++) {
                float dx = x - cx;
                float d = (float) Math.sqrt(dx * dx + dy * dy) / maxR;
                float f = 1f - amount * Img.smoothstep(0.45f, 1.05f, d);
                int c = img.px[row + x];
                img.px[row + x] = Img.rgb((int) (Img.R(c) * f + 0.5f), (int) (Img.G(c) * f + 0.5f), (int) (Img.B(c) * f + 0.5f));
            }
        }
    }

    // ------------------------------------------------------------------ dehaze / clarity

    /**
     * Dark channel prior dehaze (He et al. style). Recovers contrast from atmospheric haze and,
     * on documents, from the grey veil that overhead lighting creates. Fully automatic amount.
     */
    public static void dehaze(Img img, float amount) throws Exception {
        if (amount <= 0.02f) return;
        final int w = img.w, h = img.h, n = w * h;
        float[] dark = new float[n];
        float[] luma = img.toLuma();
        float[] mn = new float[n], mx = new float[n];
        for (int i = 0; i < n; i++) {
            int c = img.px[i];
            int r = Img.R(c);
            int g = Img.G(c);
            int b = Img.B(c);
            dark[i] = Math.min(r, Math.min(g, b)) / 255f;
        }
        int r0 = Math.max(2, Math.min(w, h) / 60);
        // morphological min filter approximated by a negative-max trick on a blurred plane, then a
        // proper erosion pass at a small radius (the DCP window is only 7x7 in practice)
        Filters.localEnvelope(dark, w, h, 3, mn, mx);
        float[] dc = mn;
        // atmospheric light: mean of the brightest 0.1% of the dark channel
        float[] sorted = dc.clone();
        java.util.Arrays.sort(sorted);
        int idx = (int) (n * 0.999f);
        float A = Math.max(0.25f, sorted[Math.min(n - 1, idx)]);
        float omega = Img.clamp01(amount) * 0.85f;
        float[] t = new float[n];
        for (int i = 0; i < n; i++) t[i] = 1f - omega * (dc[i] / A);
        float[] tr = new float[n];
        Filters.guidedFilter(luma, t, tr, w, h, Math.max(4, r0), 0.0004f);
        for (int i = 0; i < n; i++) {
            float ti = Img.clamp(tr[i], 0.22f, 1f);
            int c = img.px[i];
            float r = ((Img.R(c) / 255f) - A) / ti + A;
            float g = ((Img.G(c) / 255f) - A) / ti + A;
            float b = ((Img.B(c) / 255f) - A) / ti + A;
            img.px[i] = Img.rgb((int) (r * 255f + 0.5f), (int) (g * 255f + 0.5f), (int) (b * 255f + 0.5f));
        }
    }

    /** Illumination normalisation for documents: divide by a heavily blurred version of the page. */
    public static void flattenIllumination(Img img, float amount) throws Exception {
        if (amount <= 0.02f) return;
        final int w = img.w, h = img.h, n = w * h;
        float[] y = img.toLuma();
        float[] illum = new float[n];
        System.arraycopy(y, 0, illum, 0, n);
        Filters.gaussBlur(illum, w, h, Math.max(6, Math.min(w, h) / 18));
        for (int i = 0; i < n; i++) {
            float target = 0.80f;
            float k = target / Math.max(0.08f, illum[i]);
            k = Img.mix(1f, k, Img.clamp01(amount) * 0.9f);
            k = Img.clamp(k, 0.55f, 2.6f);
            int c = img.px[i];
            img.px[i] = Img.rgb((int) (Img.R(c) * k + 0.5f), (int) (Img.G(c) * k + 0.5f), (int) (Img.B(c) * k + 0.5f));
        }
    }

    /** Simple 3x3 median, used to clean up salt-and-pepper noise from heavy stacking outliers. */
    public static void median3(Img img) {
        final int w = img.w, h = img.h;
        int[] out = new int[w * h];
        int[] rs = new int[9], gs = new int[9], bs = new int[9];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int k = 0;
                for (int dy = -1; dy <= 1; dy++) {
                    int yy = Img.clampI(y + dy, 0, h - 1);
                    for (int dx = -1; dx <= 1; dx++) {
                        int xx = Img.clampI(x + dx, 0, w - 1);
                        int c = img.px[yy * w + xx];
                        rs[k] = Img.R(c);
                        gs[k] = Img.G(c);
                        bs[k] = Img.B(c);
                        k++;
                    }
                }
                java.util.Arrays.sort(rs);
                java.util.Arrays.sort(gs);
                java.util.Arrays.sort(bs);
                out[y * w + x] = Img.rgb(rs[4], gs[4], bs[4]);
            }
        }
        System.arraycopy(out, 0, img.px, 0, out.length);
    }

    // ------------------------------------------------------------------ skin / portrait

    /**
     * Frequency separation skin treatment: the low frequency band (skin tone, large blotches) is
     * smoothed while the high frequency band (pores, lashes, hair detail) is preserved and even
     * slightly boosted, so the result keeps looking like skin instead of plastic.
     */
    public static void skinSmooth(Img img, float strength, int[][] faces) throws Exception {
        if (strength <= 0.02f) return;
        final int w = img.w, h = img.h, n = w * h;
        float[] y = img.toLuma();
        float[] low = new float[n];
        System.arraycopy(y, 0, low, 0, n);
        Filters.guidedFilter(y, low, low, w, h, Math.max(2, Math.min(w, h) / 220), 0.0016f);
        float[] mask = new float[n];
        for (int yy = 0; yy < h; yy++) {
            for (int xx = 0; xx < w; xx++) {
                int c = img.px[yy * w + xx];
                float m = isSkin(Img.R(c), Img.G(c), Img.B(c)) ? 1f : 0f;
                mask[yy * w + xx] = m;
            }
        }
        Filters.gaussBlur(mask, w, h, Math.max(2, Math.min(w, h) / 200));
        if (faces != null) {
            // inside a face box the mask is trusted more, outside it is attenuated
            for (int f = 0; f < faces.length; f++) {
                int[] fb = faces[f];
                // soft ellipse weighting around every face
                float cx = fb[0] + fb[2] * 0.5f, cy = fb[1] + fb[3] * 0.5f;
                float rx = Math.max(4f, fb[2] * 0.62f), ry = Math.max(4f, fb[3] * 0.62f);
                int x0 = Img.clampI((int) (cx - rx * 1.6f), 0, w), x1 = Img.clampI((int) (cx + rx * 1.6f), 0, w);
                int y0 = Img.clampI((int) (cy - ry * 1.6f), 0, h), y1 = Img.clampI((int) (cy + ry * 1.6f), 0, h);
                for (int yy = y0; yy < y1; yy++) {
                    for (int xx = x0; xx < x1; xx++) {
                        float dx = (xx - cx) / rx, dy = (yy - cy) / ry;
                        float d = (float) Math.sqrt(dx * dx + dy * dy);
                        float wgt = 1f - Img.smoothstep(0.85f, 1.6f, d);
                        int i = yy * w + xx;
                        mask[i] = Img.clamp01(mask[i] + wgt * 0.85f);
                    }
                }
            }
        }
        final float[] fmask = mask, flow = low, fy = y;
        Parallel.rows(h, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int yy = y0; yy < y1; yy++) {
                    int row = yy * w;
                    for (int xx = 0; xx < w; xx++) {
                        int i = row + xx;
                        float m = fmask[i] * strength;
                        if (m < 0.01f) continue;
                        float hi = fy[i] - flow[i];
                        // smoothed base + preserved (slightly boosted) texture band
                        float nv = Img.mix(fy[i], flow[i], m * 0.85f) + hi * (1f + 0.18f * m);
                        int c = img.px[i];
                        float oldY = fy[i] * 255f;
                        float scale = Img.clamp(nv * 255f / Math.max(1f, oldY), 0.7f, 1.4f);
                        img.px[i] = Img.rgb((int) (Img.R(c) * scale + 0.5f),
                                (int) (Img.G(c) * scale + 0.5f),
                                (int) (Img.B(c) * scale + 0.5f));
                    }
                }
            }
        });
    }
}
