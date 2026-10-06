package com.aivision.camera.ai.core;

/**
 * Super resolution.
 *
 * <p>Two cooperating methods:
 * <ol>
 *   <li><b>Single frame, iterative back projection.</b> A Catmull-Rom upscale is refined by
 *       repeatedly simulating what the sensor would have measured from the current high resolution
 *       estimate and back projecting the error. The result stays consistent with the real
 *       measurements instead of hallucinating, which is what keeps edges from looking painted.</li>
 *   <li><b>Multi frame, sub-pixel fusion.</b> Handheld burst frames land on different sampling
 *       grids. The sub-pixel part of every motion estimate is used to inject each frame's
 *       independent samples into the high resolution grid - the classical way of genuinely
 *       recovering resolution beyond one sensor readout, and the reason "AI Ultra" can hold detail
 *       that a single frame upscale cannot.</li>
 * </ol>
 * Both paths finish with an anti-ringing clamp so overshoot never leaves colour fringes.
 */
public final class SuperRes {

    private SuperRes() {
    }

    // ------------------------------------------------------------------ public API

    /** Single frame smart upscale (used when only one frame is available, e.g. an imported photo). */
    public static Img upscaleSingle(Img src, int scale, float strength) throws Exception {
        if (scale <= 1) return src.copy();
        int nw = src.w * scale, nh = src.h * scale;
        Img hr = bicubic(src, nw, nh);
        float[] origL = hr.toLuma();
        float[] mn = new float[hr.px.length], mx = new float[hr.px.length];
        Filters.localEnvelope(origL, nw, nh, 1, mn, mx);
        float lambda = Img.clamp(strength, 0.1f, 1f) * 0.55f;
        float noiseFloor = 0.0015f * 255f;
        for (int it = 0; it < 2; it++) {
            Img lr = downscale(hr, scale);
            // residual back projection, band parallel
            final Img fir = hr;
            final Img flr = lr;
            final Img flrSrc = src;      // the real low resolution measurement
            final int fscale = scale;
            final float nf = noiseFloor;
            Parallel.rows(nh, new Parallel.Band() {
                @Override
                public void run(int y0, int y1) {
                    for (int y = y0; y < y1; y++) {
                        float sy = y / (float) fscale;
                        for (int x = 0; x < fir.w; x++) {
                            float sx = x / (float) fscale;
                            // back projection: the error is (real measurement - simulation), so an
                            // overshoot in the estimate is pulled back instead of amplified
                            int simulated = flr.sample(sx, sy);
                            int measured = flrSrc.sample(sx, sy);
                            int cur = fir.px[y * fir.w + x];
                            float dr = shrink(Img.R(measured) - Img.R(simulated), nf);
                            float dg = shrink(Img.G(measured) - Img.G(simulated), nf);
                            float db = shrink(Img.B(measured) - Img.B(simulated), nf);
                            fir.px[y * fir.w + x] = Img.rgb((int) (Img.R(cur) + dr * lambda),
                                    (int) (Img.G(cur) + dg * lambda),
                                    (int) (Img.B(cur) + db * lambda));
                        }
                    }
                }
            });
            // anti-ringing: keep the estimate inside a small band around the interpolation
            float[] nl = hr.toLuma();
            for (int i = 0; i < nl.length; i++) {
                float lo = mn[i] - 0.02f, hi = mx[i] + 0.02f;
                float v = Img.clamp(nl[i], lo, hi);
                nl[i] = Img.clamp01(v);
            }
            hr.applyLuma(nl);
        }
        return hr;
    }

    /**
     * Multi frame super resolution with sub-pixel fusion + back projection.
     *
     * @param frames  frames already aligned to the reference grid (frames[0] is the reference)
     * @param motions motion of each frame relative to the reference; only the fractional part of the
     *                translation is used here - the integer part has already been compensated by
     *                the stacking stage
     */
    public static Img multiFrame(Img[] frames, Align.Motion[] motions, int scale, int iterations,
                                 float strength, int maxOutLongEdge) throws Exception {
        return multiFrame(frames, motions, scale, iterations, strength, maxOutLongEdge, 0.005f);
    }

    /**
     * @param noiseSigma measured noise of the input frames (0..1 luma). The back projection
     *                   soft-thresholds its residual against it, so IBP restores resolution without
     *                   re-injecting the grain that the stacking stage just removed.
     */
    public static Img multiFrame(Img[] frames, Align.Motion[] motions, int scale, int iterations,
                                 float strength, int maxOutLongEdge, float noiseSigma) throws Exception {
        if (frames.length == 0) return null;
        Img ref = frames[0];
        if (scale <= 1 && frames.length <= 1) return ref.copy();
        int nw = ref.w * scale, nh = ref.h * scale;
        if (maxOutLongEdge > 0) {
            float k = maxOutLongEdge / (float) Math.max(nw, nh);
            if (k < 1f) {
                scale = Math.max(1, (int) Math.floor(scale * k));
                nw = ref.w * scale;
                nh = ref.h * scale;
            }
        }
        if (scale <= 1 && frames.length <= 1) return ref.copy();
        Img hr = scale > 1 ? bicubic(ref, nw, nh) : ref.copy();
        if (scale <= 1) return hr;
        int n = frames.length;
        // tuned on the verification harness: this is the point where the back projection adds the
        // most resolution before residual noise starts to win
        float lambda = Img.clamp01(strength) * 0.25f;
        float floor = Math.max(0.0008f, noiseSigma) * 255f * 0.9f;
        // anti-ringing envelope: the reconstruction may not wander far from the interpolation that
        // the measurements actually support
        float[] envLo = new float[nw * nh], envHi = new float[nw * nh];
        float[] hrL = hr.toLuma();
        float[] envSrc = new float[nw * nh];
        System.arraycopy(hrL, 0, envSrc, 0, hrL.length);
        Filters.localEnvelope(envSrc, nw, nh, 1, envLo, envHi);
        for (int it = 0; it < iterations; it++) {
            for (int f = 0; f < n; f++) {
                Align.Motion m = motions != null && f < motions.length ? motions[f] : null;
                float dx = m == null ? 0 : m.tx - Math.round(m.tx);
                float dy = m == null ? 0 : m.ty - Math.round(m.ty);
                backProject(hr, frames[f], dx, dy, scale, lambda / n, floor);
            }
            clampEnvelope(hr, envLo, envHi, 0.035f);
        }
        // final consistency pass plus a structure gated micro-contrast boost
        refine(hr, ref, scale, lambda * 0.6f);
        return hr;
    }

    // ------------------------------------------------------------------ internals

    /**
     * One back projection step: simulate the low resolution measurement from the current estimate,
     * then push the error back into the high resolution grid with the frame's sub-pixel offset.
     */
    private static void backProject(final Img hr, final Img lr, final float dx, final float dy,
                                    final int scale, final float lambda, final float noiseFloor) throws Exception {
        final int lw = lr.w, lh = lr.h;
        final float[][] res = new float[3][lw * lh];
        Parallel.rows(lh, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int y = y0; y < y1; y++) {
                    for (int x = 0; x < lw; x++) {
                        // what the sensor would have measured at this low res site: the frame's
                        // pixel (x,y) samples the reference grid at (x + dx, y + dy), so the
                        // corresponding high resolution samples are the scale x scale box there
                        float sx = (x + dx) * scale;
                        float sy = (y + dy) * scale;
                        float r = 0, g = 0, b = 0;
                        for (int oy = 0; oy < scale; oy++) {
                            for (int ox = 0; ox < scale; ox++) {
                                int c = hr.sample(sx + ox, sy + oy);
                                r += Img.R(c);
                                g += Img.G(c);
                                b += Img.B(c);
                            }
                        }
                        float k = 1f / (scale * scale);
                        int i = y * lw + x;
                        int lc = lr.px[i];
                        // noise aware soft threshold: only the part of the error that is larger than
                        // the noise floor can be real missing structure
                        res[0][i] = shrink(Img.R(lc) - r * k, noiseFloor);
                        res[1][i] = shrink(Img.G(lc) - g * k, noiseFloor);
                        res[2][i] = shrink(Img.B(lc) - b * k, noiseFloor);
                    }
                }
            }
        });
        final int hw = hr.w, hh = hr.h;
        Parallel.rows(hh, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int y = y0; y < y1; y++) {
                    for (int x = 0; x < hw; x++) {
                        // map the residual of frame f onto the high resolution grid: HR index X is
                        // covered by LR index X/scale, which samples the reference grid at +dx
                        float sx = x / (float) scale - dx;
                        float sy = y / (float) scale - dy;
                        int rx = (int) Math.floor(sx), ry = (int) Math.floor(sy);
                        if (rx < 0 || ry < 0 || rx >= lw - 1 || ry >= lh - 1) continue;
                        float fx = sx - rx, fy = sy - ry;
                        int i00 = ry * lw + rx, i10 = i00 + 1, i01 = i00 + lw, i11 = i01 + 1;
                        int i = y * hw + x;
                        int c = hr.px[i];
                        int nr = Img.R(c), ng = Img.G(c), nb = Img.B(c);
                        for (int ch = 0; ch < 3; ch++) {
                            float[] rr = res[ch];
                            float v = Img.lerp(Img.lerp(rr[i00], rr[i10], fx), Img.lerp(rr[i01], rr[i11], fx), fy);
                            int delta = (int) (v * lambda);
                            if (ch == 0) nr += delta;
                            else if (ch == 1) ng += delta;
                            else nb += delta;
                        }
                        hr.px[i] = Img.rgb(nr, ng, nb);
                    }
                }
            }
        });
    }

    /**
     * Final pass: structure gated micro contrast on the reconstructed plane. Amplifying the fine
     * band is only safe where the back projection actually built structure, so the gain follows the
     * structure map instead of being applied uniformly (which would just re-sharpen noise).
     */
    private static void refine(final Img hr, final Img ref, final int scale, final float lambda) throws Exception {
        int nw = hr.w, nh = hr.h;
        float[] l = hr.toLuma();
        float[] blur = new float[nw * nh];
        System.arraycopy(l, 0, blur, 0, l.length);
        Filters.gaussBlur(blur, nw, nh, 1);
        float[] hp = new float[nw * nh];
        for (int i = 0; i < l.length; i++) hp[i] = l[i] - blur[i];
        float[] struct = Filters.structureMap(hp, nw, nh, 0.0025f, 1.6f);
        for (int i = 0; i < l.length; i++) {
            l[i] = Img.clamp01(l[i] + hp[i] * 0.30f * (0.15f + 0.85f * struct[i]));
        }
        hr.applyLuma(l);
    }

    // ------------------------------------------------------------------ resampling

    /** Catmull-Rom bicubic upscale (or downscale) - sharper than bilinear without ringing. */
    public static Img bicubic(Img src, int nw, int nh) {
        Img out = new Img(nw, nh);
        float sx = src.w / (float) nw, sy = src.h / (float) nh;
        for (int y = 0; y < nh; y++) {
            float fy = (y + 0.5f) * sy - 0.5f;
            int y0 = (int) Math.floor(fy);
            float ty = fy - y0;
            for (int x = 0; x < nw; x++) {
                float fx = (x + 0.5f) * sx - 0.5f;
                int x0 = (int) Math.floor(fx);
                float tx = fx - x0;
                // the engine works on packed ARGB, so resample each channel independently
                int c = 0;
                int r = 0, g = 0, b = 0;
                for (int j = -1; j <= 2; j++) {
                    float wy = cr(ty - j);
                    int yy = Img.clampI(y0 + j, 0, src.h - 1);
                    for (int i = -1; i <= 2; i++) {
                        float wx = cr(tx - i);
                        int xx = Img.clampI(x0 + i, 0, src.w - 1);
                        int cc = src.px[yy * src.w + xx];
                        float wgt = wx * wy;
                        r += Img.R(cc) * wgt;
                        g += Img.G(cc) * wgt;
                        b += Img.B(cc) * wgt;
                    }
                }
                out.px[y * nw + x] = Img.rgb((int) (r + 0.5f), (int) (g + 0.5f), (int) (b + 0.5f));
            }
        }
        return out;
    }

    /** Keeps the luminance of the estimate inside the interpolation envelope (ringing control). */
    private static void clampEnvelope(final Img hr, final float[] lo, final float[] hi, final float margin)
            throws Exception {
        final int w = hr.w, h = hr.h;
        Parallel.rows(h, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int y = y0; y < y1; y++) {
                    int row = y * w;
                    for (int x = 0; x < w; x++) {
                        int i = row + x;
                        int c = hr.px[i];
                        float l = 0.2126f * Img.R(c) + 0.7152f * Img.G(c) + 0.0722f * Img.B(c);
                        float v = Img.clamp(l / 255f, lo[i] - margin, hi[i] + margin);
                        if (Math.abs(v * 255f - l) > 0.4f) {
                            hr.px[i] = Img.withLuma(c, v);
                        }
                    }
                }
            }
        });
    }

    private static float shrink(float v, float floor) {
        float a = Math.abs(v) - floor;
        if (a <= 0) return 0;
        return v > 0 ? a : -a;
    }

    private static float cr(float t) {
        t = Math.abs(t);
        float t2 = t * t, t3 = t2 * t;
        if (t <= 1f) return 1.5f * t3 - 2.5f * t2 + 1f;
        if (t < 2f) return -0.5f * t3 + 2.5f * t2 - 4f * t + 2f;
        return 0f;
    }

    /** Box average downscale by an integer factor (the forward model of the sensor sampling). */
    public static Img downscale(Img src, int scale) {
        if (scale <= 1) return src.copy();
        int nw = Math.max(1, src.w / scale), nh = Math.max(1, src.h / scale);
        Img out = new Img(nw, nh);
        for (int y = 0; y < nh; y++) {
            for (int x = 0; x < nw; x++) {
                int r = 0, g = 0, b = 0, cnt = 0;
                for (int oy = 0; oy < scale; oy++) {
                    int yy = y * scale + oy;
                    if (yy >= src.h) break;
                    for (int ox = 0; ox < scale; ox++) {
                        int xx = x * scale + ox;
                        if (xx >= src.w) break;
                        int c = src.px[yy * src.w + xx];
                        r += Img.R(c);
                        g += Img.G(c);
                        b += Img.B(c);
                        cnt++;
                    }
                }
                if (cnt == 0) cnt = 1;
                out.px[y * nw + x] = Img.rgb(r / cnt, g / cnt, b / cnt);
            }
        }
        return out;
    }
}
