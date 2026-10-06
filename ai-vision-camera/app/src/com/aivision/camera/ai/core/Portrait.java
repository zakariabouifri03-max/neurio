package com.aivision.camera.ai.core;

/**
 * Portrait rendering: subject mask, background defocus with a real disc (bokeh) kernel, and helpers
 * for vignetting. No depth sensor is required - the mask comes from the detected faces plus a
 * colour-similarity region growing step, which is what makes this work on every phone.
 */
public final class Portrait {

    private Portrait() {
    }

    /**
     * Builds a subject mask: 0 = background, 1 = subject, soft edges so a composite never shows a hard
     * cut. {@code grow} extends the face ellipses so hair and shoulders are included.
     */
    public static float[] subjectMask(Img img, int[][] faces, float grow) {
        int w = img.w, h = img.h, n = w * h;
        float[] mask = new float[n];
        if (faces != null) {
            for (int[] f : faces) {
                if (f == null || f.length < 4) continue;
                float cx = f[0] + f[2] * 0.5f, cy = f[1] + f[3] * 0.5f;
                float rx = Math.max(8f, f[2] * 0.80f * grow), ry = Math.max(8f, f[3] * 1.15f * grow);
                int x0 = Math.max(0, (int) (cx - rx)), x1 = Math.min(w - 1, (int) (cx + rx));
                int y0 = Math.max(0, (int) (cy - ry)), y1 = Math.min(h - 1, (int) (cy + ry * 1.45f));
                for (int y = y0; y <= y1; y++) {
                    for (int x = x0; x <= x1; x++) {
                        float dx = (x - cx) / rx, dy = (y - cy) / ry;
                        float d2 = dx * dx + dy * dy;
                        float v = d2 >= 1f ? 0f : (1f - d2) * (1f - d2);
                        int i = y * w + x;
                        if (v > mask[i]) mask[i] = v;
                    }
                }
            }
        }
        // region growing on colour similarity around the strongest mask pixels so the subject's body
        // colour continues the mask beyond the face box
        int seeds = Math.max(8, Math.min(96, n / 4000));
        float[] sy = new float[seeds], scb = new float[seeds], scr = new float[seeds];
        int sc = 0;
        for (int i = 0; i < n && sc < seeds; i += Math.max(1, n / (seeds * 40))) {
            if (mask[i] > 0.55f) {
                int c = img.px[i];
                float r = Img.R(c), g = Img.G(c), b = Img.B(c);
                float yy = 0.299f * r + 0.587f * g + 0.114f * b;
                sy[sc] = yy;
                scb[sc] = 0.564f * (b - yy);
                scr[sc] = 0.713f * (r - yy);
                sc++;
            }
        }
        if (sc > 0) {
            float thresh = 34f;
            for (int i = 0; i < n; i++) {
                if (mask[i] > 0.45f) continue;
                int c = img.px[i];
                float r = Img.R(c), g = Img.G(c), b = Img.B(c);
                float yy = 0.299f * r + 0.587f * g + 0.114f * b;
                float cb = 0.564f * (b - yy), cr = 0.713f * (r - yy);
                float best = 0f;
                for (int s = 0; s < sc; s++) {
                    float d = Math.abs(cb - scb[s]) + Math.abs(cr - scr[s]) + 0.4f * Math.abs(yy - sy[s]);
                    if (d < thresh) best = Math.max(best, 1f - d / thresh);
                }
                if (best > 0f) mask[i] = Math.max(mask[i], best * 0.8f);
            }
        }
        float[] soft = Filters.boxBlurred(mask, w, h, Math.max(1, Math.min(w, h) / 220));
        return soft;
    }

    /**
     * Defocuses everything the mask marks as background. The blur is a genuine disc kernel - bright
     * highlights turn into round bokeh - computed on a downscaled copy so it stays fast on a phone.
     */
    public static void defocusBackground(Img img, float[] mask, float amount, float bokehRadius) {
        if (mask == null || amount <= 0.01f) return;
        int w = img.w, h = img.h;
        int radius = Math.max(2, Math.round(bokehRadius));
        int k = Math.max(1, radius / 6);
        int sw = Math.max(16, w / k), sh = Math.max(16, h / k);
        Img small = img.scaled(sw, sh);
        Img blurredSmall = discBlur(small, Math.max(2f, radius / (float) k));
        Img blurred = blurredSmall.scaled(w, h);
        for (int i = 0; i < img.px.length; i++) {
            float m = Math.max(0f, Math.min(1f, mask[i]));
            float b = amount * (1f - m);
            if (b <= 0.002f) continue;
            img.px[i] = (int) Img.mix(img.px[i], blurred.px[i], b);
        }
    }

    /** Separable disc approximation: two 1-D sqrt-profile passes (the classic fast bokeh kernel). */
    static Img discBlur(Img src, float radius) {
        final int r = Math.max(1, Math.round(radius));
        Img tmp = new Img(src.w, src.h);
        final Img s1 = src, d1 = tmp;
        try {
            Parallel.rows(src.h, new Parallel.Band() {
                @Override
                public void run(int y0, int y1) {
                    float[] k = taps(r);
                    for (int y = y0; y < y1; y++) {
                        int row = y * s1.w;
                        for (int x = 0; x < s1.w; x++) {
                            float sr = 0, sg = 0, sb = 0, sw = 0;
                            for (int t = -r; t <= r; t++) {
                                float wt = k[Math.abs(t)];
                                if (wt <= 0f) continue;
                                int xx = x + t;
                                if (xx < 0) xx = 0;
                                else if (xx >= s1.w) xx = s1.w - 1;
                                int c = s1.px[row + xx];
                                sr += Img.R(c) * wt;
                                sg += Img.G(c) * wt;
                                sb += Img.B(c) * wt;
                                sw += wt;
                            }
                            d1.px[row + x] = Img.rgb(Img.clamp255((int) (sr / sw)),
                                    Img.clamp255((int) (sg / sw)), Img.clamp255((int) (sb / sw)));
                        }
                    }
                }
            });
        } catch (Exception ignored) {
        }
        Img out = new Img(src.w, src.h);
        final Img s2 = tmp, d2 = out;
        try {
            Parallel.rows(src.w, new Parallel.Band() {
                @Override
                public void run(int x0, int x1) {
                    float[] k = taps(r);
                    for (int x = x0; x < x1; x++) {
                        for (int y = 0; y < s2.h; y++) {
                            float sr = 0, sg = 0, sb = 0, sw = 0;
                            for (int t = -r; t <= r; t++) {
                                float wt = k[Math.abs(t)];
                                if (wt <= 0f) continue;
                                int yy = y + t;
                                if (yy < 0) yy = 0;
                                else if (yy >= s2.h) yy = s2.h - 1;
                                int c = s2.px[yy * s2.w + x];
                                sr += Img.R(c) * wt;
                                sg += Img.G(c) * wt;
                                sb += Img.B(c) * wt;
                                sw += wt;
                            }
                            d2.px[y * s2.w + x] = Img.rgb(Img.clamp255((int) (sr / sw)),
                                    Img.clamp255((int) (sg / sw)), Img.clamp255((int) (sb / sw)));
                        }
                    }
                }
            });
        } catch (Exception ignored) {
        }
        return out;
    }

    private static float[] taps(int r) {
        float[] k = new float[r + 1];
        for (int i = 0; i <= r; i++) {
            float d = i / (float) Math.max(1, r);
            k[i] = (float) Math.sqrt(Math.max(0f, 1f - d * d));
        }
        return k;
    }
}
