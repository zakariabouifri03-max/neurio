package com.aivision.camera.ai.core;

/**
 * Multi-frame stacking - the reason a burst from a phone can beat a single long exposure.
 *
 * <p>N aligned frames are merged with motion adaptive, outlier rejecting weights, which:
 * <ul>
 *   <li>lowers random noise by up to sqrt(N) (the real "night mode" gain),</li>
 *   <li>rejects moving subjects, so a person walking through the burst is not smeared,</li>
 *   <li>keeps the sharpest frame's detail while borrowing the others' noise floor.</li>
 * </ul>
 * The merge runs at the working resolution; {@link #fuseDetail} then borrows the full sensor
 * resolution detail band from a single "donor" frame, which is how the output can be full
 * resolution without paying for N full resolution buffers in memory.
 */
public final class Stacker {

    private Stacker() {
    }

    public static final class Options {
        public float temporalStrength = 1f;
        public float noiseSigma = 0.010f;      // 0..1 luma domain
        public boolean outlierReject = true;
        public boolean useTileField = true;
        public float ghostTolerance = 3.2f;    // multiples of the expected noise floor
        public float nightBoost = 1f;          // >1 favours noise reduction over motion acuity
    }

    /**
     * @param ref     reference frame (the grid everything is aligned to)
     * @param frames  all frames including the reference (may contain it at index 0)
     * @param motions motion of every frame relative to the reference (index 0 may be {@code null})
     * @param fields  optional per-tile displacement fields (parallel to {@code frames})
     * @param out     pre-allocated output image (same size as ref) or {@code null}
     */
    public static Img merge(Img ref, Img[] frames, Align.Motion[] motions, Align.Field[] fields,
                            Options opt, Img out) throws Exception {
        final int w = ref.w, h = ref.h, n = w * h;
        final Img outImg = out != null ? out : new Img(w, h);
        final float[] sumR = new float[n], sumG = new float[n], sumB = new float[n], sumW = new float[n];
        final float noise = Math.max(0.0015f, opt.noiseSigma);
        final float tol = noise * opt.ghostTolerance * 255f * (1f / Math.max(0.35f, opt.nightBoost));
        final float strength = Img.clamp01(opt.temporalStrength);

        // ---- pass 1: provisional mean (unweighted, full frame) used to measure deviations
        for (int f = 0; f < frames.length; f++) {
            final Img fr = frames[f];
            final Align.Motion mo = motions != null && f < motions.length ? motions[f] : null;
            final Align.Field fld = fields != null && f < fields.length ? fields[f] : null;
            final boolean identity = f == 0 || (mo == null && fld == null);
            Parallel.rows(h, new Parallel.Band() {
                @Override
                public void run(int y0, int y1) {
                    float cos = 1, sin = 0;
                    if (mo != null && !identity) {
                        cos = (float) Math.cos(mo.rot);
                        sin = (float) Math.sin(mo.rot);
                    }
                    for (int y = y0; y < y1; y++) {
                        for (int x = 0; x < w; x++) {
                            int i = y * w + x;
                            int c;
                            if (identity) {
                                c = fr.px[i];
                            } else {
                                // shared motion convention: sample the frame at F(x,y)
                                float sx = x, sy = y;
                                if (mo != null) {
                                    float cx = x - w * 0.5f, cy = y - h * 0.5f;
                                    float px = cx * mo.scale, py = cy * mo.scale;
                                    sx = px * cos - py * sin + w * 0.5f + mo.tx;
                                    sy = px * sin + py * cos + h * 0.5f + mo.ty;
                                }
                                if (fld != null && opt.useTileField) {
                                    // the field only carries the residual the global model missed
                                    sx -= fld.dxAt(x, y);
                                    sy -= fld.dyAt(x, y);
                                }
                                c = fr.sampleCubic(sx, sy);
                            }
                            sumR[i] += Img.R(c);
                            sumG[i] += Img.G(c);
                            sumB[i] += Img.B(c);
                        }
                    }
                }
            });
        }
        final float invN = 1f / frames.length;
        Parallel.rows(h, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int i = y0 * w; i < y1 * w; i++) {
                    sumR[i] *= invN;
                    sumG[i] *= invN;
                    sumB[i] *= invN;
                }
            }
        });

        // ---- pass 2: robust re-accumulation around the provisional mean
        Parallel.rows(h, new Parallel.Band() {
            @Override
            public void run(int y0, int y1) {
                for (int y = y0; y < y1; y++) {
                    int row = y * w;
                    for (int x = 0; x < w; x++) {
                        int i = row + x;
                        float muR = sumR[i], muG = sumG[i], muB = sumB[i];
                        float accR = muR, accG = muG, accB = muB, accW = 1f;
                        for (int f = 0; f < frames.length; f++) {
                            if (f == 0) continue;
                            Img fr = frames[f];
                            Align.Motion mo = motions != null && f < motions.length ? motions[f] : null;
                            Align.Field fld = fields != null && f < fields.length ? fields[f] : null;
                            float sx = x, sy = y;
                            if (mo != null) {
                                float cos = (float) Math.cos(mo.rot), sin = (float) Math.sin(mo.rot);
                                float cx = x - w * 0.5f, cy = y - h * 0.5f;
                                float px = cx * mo.scale, py = cy * mo.scale;
                                sx = px * cos - py * sin + w * 0.5f + mo.tx;
                                sy = px * sin + py * cos + h * 0.5f + mo.ty;
                            }
                            if (fld != null && opt.useTileField) {
                                sx -= fld.dxAt(x, y);
                                sy -= fld.dyAt(x, y);
                            }
                            int c = fr.sampleCubic(sx, sy);
                            float dr = Img.R(c) - muR, dg = Img.G(c) - muG, db = Img.B(c) - muB;
                            float d = (float) Math.sqrt(dr * dr + dg * dg + db * db);
                            float wgt = 1f;
                            if (opt.outlierReject && d > tol) {
                                // soft roll-off: moving objects get de-weighted, not blended, while
                                // ordinary noise (which lives well inside tol) keeps full weight
                                float excess = (d - tol) / (tol * 1.6f);
                                wgt = 1f / (1f + excess * excess * 1.8f);
                            }
                            accR += Img.R(c) * wgt;
                            accG += Img.G(c) * wgt;
                            accB += Img.B(c) * wgt;
                            accW += wgt;
                        }
                        // blend provisional mean with the robust mean according to strength
                        float rR = accR / accW, rG = accG / accW, rB = accB / accW;
                        rR = Img.mix(muR, rR, strength);
                        rG = Img.mix(muG, rG, strength);
                        rB = Img.mix(muB, rB, strength);
                        sumW[i] = accW;
                        outImg.px[i] = Img.rgb((int) (rR + 0.5f), (int) (rG + 0.5f), (int) (rB + 0.5f));
                    }
                }
            }
        });
        return outImg;
    }

    /** How many frames effectively contributed to each pixel (used for confidence reporting). */
    public static float coverage(Align.Field[] fields) {
        if (fields == null || fields.length == 0) return 1f;
        float sum = 0;
        int cnt = 0;
        for (Align.Field f : fields) {
            if (f == null) continue;
            for (float c : f.confidence) {
                sum += c;
                cnt++;
            }
        }
        return cnt == 0 ? 1f : sum / cnt;
    }

    /**
     * Borrows the full resolution detail band from a single donor frame.
     *
     * <p>The stacked image supplies the low frequency (its noise floor is already sqrt(N) lower) and
     * the donor supplies the high frequency, with a soft-shrinkage on the high pass so the donor's
     * own grain is not re-injected, and structure gating so only real texture is transferred.
     */
    public static Img fuseDetail(Img stack, Img donor, float detailStrength, float donorNoise, float scaleCap) {
        int dw = donor.w, dh = donor.h;
        Img low = stack;
        if (low.w != dw || low.h != dh) {
            low = stack.scaled(dw, dh);
        }
        int n = dw * dh;
        float[] lowY = low.toLuma();
        float[] donY = donor.toLuma();
        float[] blur = new float[n];
        System.arraycopy(donY, 0, blur, 0, n);
        Filters.gaussBlur(blur, dw, dh, 1);
        float[] det = new float[n];
        for (int i = 0; i < n; i++) det[i] = donY[i] - blur[i];
        // soft shrinkage kills the donor's grain while leaving genuine edges untouched
        float lambda = Math.max(0.0015f, donorNoise) * 0.85f;
        for (int i = 0; i < n; i++) {
            float d = det[i];
            float a = Math.abs(d) - lambda;
            det[i] = a <= 0 ? 0 : (d > 0 ? a : -a);
        }
        float[] struct = Filters.structureMap(det, dw, dh, Math.max(0.002f, donorNoise), 1.8f);
        float k = Img.clamp01(detailStrength);
        Img out = new Img(dw, dh);
        float[] newY = new float[n];
        for (int i = 0; i < n; i++) {
            newY[i] = Img.clamp01(lowY[i] + det[i] * k * (0.25f + 0.75f * struct[i]));
        }
        for (int i = 0; i < n; i++) {
            int c = low.px[i];
            float oldY = lowY[i] * 255f;
            float scale = Img.clamp(newY[i] * 255f / Math.max(1f, oldY), 0.5f, 2f);
            out.px[i] = Img.rgb((int) (Img.R(c) * scale + 0.5f),
                    (int) (Img.G(c) * scale + 0.5f),
                    (int) (Img.B(c) * scale + 0.5f));
        }
        return out;
    }
}
