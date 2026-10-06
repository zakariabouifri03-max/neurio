package com.aivision.camera.ai.core;

/**
 * Blur / edge-preserving-filter primitives for the AI engine. Everything works on planar
 * <code>float[]</code> buffers and is O(1) per pixel for the box based filters, which is what makes
 * the multi-frame pipeline fast enough to run on a phone inside a few seconds.
 */
final class Filters {

    private Filters() {
    }

    // ------------------------------------------------------------------ box blur

    static void boxH(float[] src, float[] dst, int w, int h, int r) {
        if (r <= 0) {
            System.arraycopy(src, 0, dst, 0, Math.min(src.length, dst.length));
            return;
        }
        final float inv = 1f / (2 * r + 1);
        for (int y = 0; y < h; y++) {
            final int row = y * w;
            float sum = 0;
            for (int i = -r; i <= r; i++) sum += src[row + Img.clampI(i, 0, w - 1)];
            for (int x = 0; x < w; x++) {
                dst[row + x] = sum * inv;
                sum += src[row + Img.clampI(x + r + 1, 0, w - 1)] - src[row + Img.clampI(x - r, 0, w - 1)];
            }
        }
    }

    static void boxV(float[] src, float[] dst, int w, int h, int r) {
        if (r <= 0) {
            System.arraycopy(src, 0, dst, 0, Math.min(src.length, dst.length));
            return;
        }
        final float inv = 1f / (2 * r + 1);
        for (int x = 0; x < w; x++) {
            float sum = 0;
            for (int i = -r; i <= r; i++) sum += src[Img.clampI(i, 0, h - 1) * w + x];
            for (int y = 0; y < h; y++) {
                dst[y * w + x] = sum * inv;
                sum += src[Img.clampI(y + r + 1, 0, h - 1) * w + x] - src[Img.clampI(y - r, 0, h - 1) * w + x];
            }
        }
    }

    private static float[] s_tmp;

    /** In-place separable box blur (radius r). */
    static void boxBlur(float[] p, int w, int h, int r) {
        if (r <= 0) return;
        float[] tmp = new float[p.length];
        boxH(p, tmp, w, h, r);
        boxV(tmp, p, w, h, r);
    }

    static float[] boxBlurred(float[] p, int w, int h, int r) {
        float[] out = new float[p.length];
        if (r <= 0) {
            System.arraycopy(p, 0, out, 0, p.length);
            return out;
        }
        float[] tmp = new float[p.length];
        boxH(p, tmp, w, h, r);
        boxV(tmp, out, w, h, r);
        return out;
    }

    /** Gaussian approximation: 3 box passes (very close to a true Gaussian, 3x cheaper). */
    static void gaussBlur(float[] p, int w, int h, int radius) {
        if (radius <= 0) return;
        int r = Math.max(1, (int) Math.round(radius * 0.55));
        boxBlur(p, w, h, r);
        boxBlur(p, w, h, r);
        boxBlur(p, w, h, r);
    }

    static float[] gaussBlurred(float[] p, int w, int h, int radius) {
        float[] out = new float[p.length];
        System.arraycopy(p, 0, out, 0, p.length);
        gaussBlur(out, w, h, radius);
        return out;
    }

    // ------------------------------------------------------------------ guided filter

    /**
     * He et al. guided filter (single channel). Edge preserving smoothing whose result is a
     * least-squares fit of {@code src} against {@code guide} inside a box window - the workhorse
     * behind base/detail separation (tone mapping) and edge safe denoising.
     */
    static void guidedFilter(float[] guide, float[] src, float[] out, int w, int h, int r, float eps) {
        int n = w * h;
        float[] meanG = new float[n], meanS = new float[n];
        float[] gg = new float[n], gs = new float[n];
        for (int i = 0; i < n; i++) {
            float g = guide[i];
            gg[i] = g * g;
            gs[i] = g * src[i];
        }
        float[] tmp = new float[n];
        boxH(guide, tmp, w, h, r);
        boxV(tmp, meanG, w, h, r);
        boxH(src, tmp, w, h, r);
        boxV(tmp, meanS, w, h, r);
        boxH(gg, tmp, w, h, r);
        boxV(tmp, gg, w, h, r);
        boxH(gs, tmp, w, h, r);
        boxV(tmp, gs, w, h, r);
        float[] a = new float[n], b = new float[n];
        for (int i = 0; i < n; i++) {
            float mg = meanG[i], ms = meanS[i];
            float var = gg[i] - mg * mg;
            float cov = gs[i] - mg * ms;
            float ai = cov / (var + eps);
            a[i] = ai;
            b[i] = ms - ai * mg;
        }
        float[] ma = new float[n], mb = new float[n];
        boxH(a, tmp, w, h, r);
        boxV(tmp, ma, w, h, r);
        boxH(b, tmp, w, h, r);
        boxV(tmp, mb, w, h, r);
        for (int i = 0; i < n; i++) out[i] = ma[i] * guide[i] + mb[i];
    }

    /** Fast circular (disc) blur, giving a more natural defocus/bokeh look than a box blur. */
    static void discBlur(float[] p, int w, int h, int radius) {
        if (radius < 1) return;
        float[] tmp = new float[p.length];
        // horizontal pass with a per-row disc chord length, then vertical with the same chords:
        // a separable two-pass disc is an excellent approximation of a true disc kernel.
        float norm = weightedCount(radius);
        for (int y = 0; y < h; y++) {
            int row = y * w;
            for (int x = 0; x < w; x++) {
                float sum = 0;
                for (int i = -radius; i <= radius; i++) {
                    int xi = Img.clampI(x + i, 0, w - 1);
                    float wgt = 1f - Math.abs(i) / (float) (radius + 1);
                    sum += p[row + xi] * wgt;
                }
                tmp[row + x] = sum / norm;
            }
        }
        for (int x = 0; x < w; x++) {
            for (int y = 0; y < h; y++) {
                float sum = 0;
                for (int i = -radius; i <= radius; i++) {
                    int yi = Img.clampI(y + i, 0, h - 1);
                    float wgt = 1f - Math.abs(i) / (float) (radius + 1);
                    sum += tmp[yi * w + x] * wgt;
                }
                p[y * w + x] = sum / weightedCount(radius);
            }
        }
    }

    private static float weightedCount(int radius) {
        float s = 0;
        for (int i = -radius; i <= radius; i++) s += 1f - Math.abs(i) / (float) (radius + 1);
        return s;
    }

    // ------------------------------------------------------------------ morphology / envelope

    /**
     * Local min/max envelope (5x5 by default) used to clamp sharpening overshoot, which removes the
     * white/black halos that naive unsharp masking produces around high contrast edges.
     */
    static void localEnvelope(float[] p, int w, int h, int r, float[] mn, float[] mx) {
        int n = w * h;
        float[] tmn = new float[n], tmx = new float[n];
        for (int y = 0; y < h; y++) {
            int row = y * w;
            for (int x = 0; x < w; x++) {
                float lo = Float.MAX_VALUE, hi = -Float.MAX_VALUE;
                for (int i = -r; i <= r; i++) {
                    float v = p[row + Img.clampI(x + i, 0, w - 1)];
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
                tmn[row + x] = lo;
                tmx[row + x] = hi;
            }
        }
        for (int x = 0; x < w; x++) {
            for (int y = 0; y < h; y++) {
                float lo = Float.MAX_VALUE, hi = -Float.MAX_VALUE;
                for (int i = -r; i <= r; i++) {
                    int idx = Img.clampI(y + i, 0, h - 1) * w + x;
                    float v = tmn[idx];
                    if (v < lo) lo = v;
                    v = tmx[idx];
                    if (v > hi) hi = v;
                }
                mn[y * w + x] = lo;
                mx[y * w + x] = hi;
            }
        }
    }

    /**
     * Robust per-pixel signal/noise map. Structure (real texture) and noise both live in the fine
     * detail band; a 12x12 tile MAD tells them apart so the engine can amplify texture without
     * amplifying grain. Result: 0 = pure noise, 1 = solid structure.
     */
    static float[] structureMap(float[] detail, int w, int h, float noiseSigma, float gain) {
        int bs = 12;
        int bw = (w + bs - 1) / bs, bh = (h + bs - 1) / bs;
        float[] map = new float[bw * bh];
        for (int by = 0; by < bh; by++) {
            for (int bx = 0; bx < bw; bx++) {
                int x0 = bx * bs, y0 = by * bs;
                int x1 = Math.min(w, x0 + bs), y1 = Math.min(h, y0 + bs);
                float sum = 0, sumAbs = 0;
                int cnt = 0;
                for (int y = y0; y < y1; y++) {
                    int row = y * w;
                    for (int x = x0; x < x1; x++) {
                        float d = detail[row + x];
                        sum += d * d;
                        sumAbs += Math.abs(d);
                        cnt++;
                    }
                }
                if (cnt == 0) {
                    map[by * bw + bx] = 0;
                    continue;
                }
                float rms = (float) Math.sqrt(sum / cnt);
                float meanAbs = sumAbs / cnt;
                // noise floor: for pure gaussian noise rms ~ sigma, meanAbs ~ 0.8 sigma
                float snr = (rms - noiseSigma) / Math.max(1e-5f, rms);
                float snrAbs = (meanAbs - noiseSigma * 0.8f) / Math.max(1e-5f, meanAbs);
                float v = Img.clamp01(0.5f * (snr + snrAbs) * gain);
                map[by * bw + bx] = v;
            }
        }
        // smooth the tile map so it does not create blocky artefacts
        float[] smooth = Filters.boxBlurred(map, bw, bh, 1);
        // bilinear upsample to full res
        float[] out = new float[w * h];
        for (int y = 0; y < h; y++) {
            float fy = (float) y / bs - 0.5f;
            int y0 = (int) Math.floor(fy);
            float ty = fy - y0;
            int y0c = Img.clampI(y0, 0, bh - 1), y1c = Img.clampI(y0 + 1, 0, bh - 1);
            for (int x = 0; x < w; x++) {
                float fx = (float) x / bs - 0.5f;
                int x0 = (int) Math.floor(fx);
                float tx = fx - x0;
                int x0c = Img.clampI(x0, 0, bw - 1), x1c = Img.clampI(x0 + 1, 0, bw - 1);
                float v00 = smooth[y0c * bw + x0c], v10 = smooth[y0c * bw + x1c];
                float v01 = smooth[y1c * bw + x0c], v11 = smooth[y1c * bw + x1c];
                out[y * w + x] = Img.lerp(Img.lerp(v00, v10, tx), Img.lerp(v01, v11, tx), ty);
            }
        }
        return out;
    }

    /** Separable 2D gradient magnitude (Sobel) on a normalised luma plane. */
    static float[] gradientMag(float[] l, int w, int h) {
        float[] out = new float[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int xm = Img.clampI(x - 1, 0, w - 1), xp = Img.clampI(x + 1, 0, w - 1);
                int ym = Img.clampI(y - 1, 0, h - 1), yp = Img.clampI(y + 1, 0, h - 1);
                float tl = l[ym * w + xm], tc = l[ym * w + x], tr = l[ym * w + xp];
                float ml = l[y * w + xm], mr = l[y * w + xp];
                float bl = l[yp * w + xm], bc = l[yp * w + x], br = l[yp * w + xp];
                // Scharr operator: better rotational symmetry than Sobel
                float gx = (3 * tr + 10 * mr + 3 * br) - (3 * tl + 10 * ml + 3 * bl);
                float gy = (3 * bl + 10 * bc + 3 * br) - (3 * tl + 10 * tc + 3 * tr);
                out[y * w + x] = (float) Math.sqrt(gx * gx + gy * gy) * (1f / 16f);
            }
        }
        return out;
    }

    static float[] laplacian(float[] l, int w, int h) {
        float[] out = new float[w * h];
        for (int y = 1; y < h - 1; y++) {
            for (int x = 1; x < w - 1; x++) {
                int i = y * w + x;
                out[i] = 4 * l[i] - l[i - 1] - l[i + 1] - l[i - w] - l[i + w];
            }
        }
        return out;
    }
}
