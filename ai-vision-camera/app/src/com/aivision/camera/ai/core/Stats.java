package com.aivision.camera.ai.core;

/**
 * Image measurements driving every automatic decision in the app: exposure, white balance, noise
 * level, sharpness, dynamic range, colourfulness, skin ratio, texture/text likelihood and motion
 * risk. All of it is O(n) single pass work (plus a couple of cheap blurs) so it can run on the live
 * preview stream as well as on a full resolution still.
 */
public final class Stats {

    public float meanLuma;
    public float medianLuma;
    public float p1Luma, p5Luma, p95Luma, p99Luma;
    public float shadowClip;      // fraction of pixels crushed to black
    public float highlightClip;   // fraction of pixels blown to white
    public float dynamicRange;    // p99 - p1 (0..1)
    public float noiseSigma;      // estimated sensor/luma noise (0..1 scale)
    public float sharpness;       // variance of laplacian, normalised
    public float colorfulness;    // Hasler & Suesstrunk
    public float saturation;      // mean HSV saturation
    public float skinRatio;       // fraction of skin-like pixels
    public float faceFill;        // fraction of frame covered by detected faces
    public float textureEnergy;   // mean |gradient|
    public float textScore;       // 0..1 likelihood of a text/document scene
    public float meanR, meanG, meanB;
    public float wbR = 1f, wbG = 1f, wbB = 1f;  // gray world gains
    public float greenCast;       // >0 = too green (common under fluorescent), <0 = magenta
    public float blueCast;        // >0 = too blue (shade/incandescent mis-WB)
    public float contrast;        // std of luma

    private Stats() {
    }

    public boolean isDark() {
        return meanLuma < 0.22f;
    }

    public boolean isVeryDark() {
        return meanLuma < 0.11f;
    }

    public boolean isBright() {
        return meanLuma > 0.68f;
    }

    public String summary() {
        StringBuilder sb = new StringBuilder();
        sb.append("luma=").append(f(meanLuma)).append(" range=").append(f(dynamicRange));
        sb.append(" clip[lo/hi]=").append(f(shadowClip)).append('/').append(f(highlightClip));
        sb.append(" noise=").append(f(noiseSigma)).append(" sharp=").append(f(sharpness));
        sb.append(" color=").append(f(colorfulness)).append(" skin=").append(f(skinRatio));
        sb.append(" text=").append(f(textScore));
        return sb.toString();
    }

    private static String f(float v) {
        return String.format(java.util.Locale.US, "%.3f", v);
    }

    // ------------------------------------------------------------------

    public static Stats of(Img img) {
        return of(img, null);
    }

    /**
     * @param faceBoxes optional face rectangles {x, y, w, h} (already in image coordinates) used for
     *                  face weighted metering and white balance.
     */
    public static Stats of(Img img, int[][] faceBoxes) {
        final int w = img.w, h = img.h, n = w * h;
        Stats s = new Stats();
        int[] hist = new int[256];
        float[] luma = new float[n];
        double sr = 0, sg = 0, sb = 0;
        double satSum = 0;
        int skin = 0;
        double sumRG = 0, sumYB = 0, sumRG2 = 0, sumYB2 = 0;
        for (int i = 0; i < n; i++) {
            int c = img.px[i];
            int r = Img.R(c), g = Img.G(c), b = Img.B(c);
            float l = (0.2126f * r + 0.7152f * g + 0.0722f * b) * (1f / 255f);
            luma[i] = l;
            hist[(int) (l * 255f) & 0xFF]++;
            sr += r;
            sg += g;
            sb += b;
            int mx = Math.max(r, Math.max(g, b)), mn = Math.min(r, Math.min(g, b));
            satSum += mx == 0 ? 0 : (mx - mn) / (float) mx;
            // YCbCr skin rule (stricter in the blue channel to avoid grey/blue false positives)
            float y = 0.299f * r + 0.587f * g + 0.114f * b;
            float cb = 128 - 0.168736f * r - 0.331264f * g + 0.5f * b;
            float cr = 128 + 0.5f * r - 0.418688f * g - 0.081312f * b;
            if (y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && r > g && r > b) skin++;
            float rg = r - g, yb = 0.5f * (r + g) - b;
            sumRG += rg;
            sumYB += yb;
            sumRG2 += rg * rg;
            sumYB2 += yb * yb;
        }
        s.meanR = (float) (sr / n);
        s.meanG = (float) (sg / n);
        s.meanB = (float) (sb / n);
        s.meanLuma = (float) (0.2126 * s.meanR + 0.7152 * s.meanG + 0.0722 * s.meanB) / 255f;
        s.saturation = (float) (satSum / n);
        s.skinRatio = skin / (float) n;
        s.medianLuma = percentile(hist, n, 0.5f);
        s.p1Luma = percentile(hist, n, 0.01f);
        s.p5Luma = percentile(hist, n, 0.05f);
        s.p95Luma = percentile(hist, n, 0.95f);
        s.p99Luma = percentile(hist, n, 0.99f);
        s.shadowClip = countUpTo(hist, 3) / (float) n;
        s.highlightClip = (n - countUpTo(hist, 252)) / (float) n;
        s.dynamicRange = Math.max(0, s.p99Luma - s.p1Luma);
        double varL = 0;
        for (int i = 0; i < n; i += 7) {
            float d = luma[i] - s.meanLuma;
            varL += d * d;
        }
        s.contrast = (float) Math.sqrt(varL / Math.max(1, n / 7));
        double mRG = sumRG / n, mYB = sumYB / n;
        double stdRG = Math.sqrt(Math.max(0, sumRG2 / n - mRG * mRG));
        double stdYB = Math.sqrt(Math.max(0, sumYB2 / n - mYB * mYB));
        s.colorfulness = (float) (Math.sqrt(stdRG * stdRG + stdYB * stdYB) * 0.0268
                + 0.3 * Math.sqrt(mRG * mRG + mYB * mYB) * 0.0268);

        // ---- noise floor from the flattest patches
        // Splitting the frame into blocks and taking the low percentile of the per block standard
        // deviation measures the sensor noise itself. Unlike a high-pass MAD it is not fooled by a
        // blurred frame (a blurred frame still shows its true noise) nor by heavy texture.
        int bs = 8;
        int bw = Math.max(1, w / bs), bh = Math.max(1, h / bs);
        float[] blockStd = new float[bw * bh];
        int bp = 0;
        for (int by = 0; by < bh; by++) {
            for (int bx = 0; bx < bw; bx++) {
                float sum = 0, sum2 = 0;
                int c2 = 0;
                for (int y = by * bs; y < (by + 1) * bs && y < h; y++) {
                    for (int x = bx * bs; x < (bx + 1) * bs && x < w; x++) {
                        float v = luma[y * w + x];
                        sum += v;
                        sum2 += v * v;
                        c2++;
                    }
                }
                float mean = c2 > 0 ? sum / c2 : 0;
                float var = c2 > 1 ? Math.max(0, sum2 / c2 - mean * mean) : 0;
                blockStd[bp++] = (float) Math.sqrt(var);
            }
        }
        float[] sortedStd = new float[bp];
        System.arraycopy(blockStd, 0, sortedStd, 0, bp);
        java.util.Arrays.sort(sortedStd);
        // 12th percentile: flat enough to be dominated by noise, still a real measurement
        float flatStd = bp > 0 ? sortedStd[Math.max(0, (int) (bp * 0.12f))] : 0.003f;
        float minStd = bp > 0 ? sortedStd[0] : 0.003f;
        s.noiseSigma = Img.clamp01(0.35f * minStd + 0.65f * flatStd + 0.0012f);

        // ---- sharpness: normalised variance of laplacian on a small central crop
        float[] lap = Filters.laplacian(luma, w, h);
        float v = 0, m = 0;
        int c0x = w / 4, c0y = h / 4, c1x = 3 * w / 4, c1y = 3 * h / 4, cn = 0;
        for (int y = c0y; y < c1y; y += 2) {
            for (int x = c0x; x < c1x; x += 2) {
                m += lap[y * w + x];
                cn++;
            }
        }
        m = cn > 0 ? m / cn : 0;
        for (int y = c0y; y < c1y; y += 2) {
            for (int x = c0x; x < c1x; x += 2) {
                float d = lap[y * w + x] - m;
                v += d * d;
            }
        }
        s.sharpness = cn > 0 ? Img.clamp01((float) Math.sqrt(v / cn) * 2.2f) : 0;

        // ---- texture + text likelihood
        float[] gm = Filters.gradientMag(luma, w, h);
        double gsum = 0;
        int strong = 0;
        for (int i = 0; i < n; i += 3) {
            gsum += gm[i];
            if (gm[i] > 0.16f) strong++;
        }
        s.textureEnergy = (float) (gsum / Math.max(1, n / 3));
        float edgeDensity = strong / (float) Math.max(1, n / 3);
        // text scenes: many strong edges, high contrast locally, low saturation, bimodal luma
        float bimodal = 0;
        int peakA = 0, peakB = 0;
        for (int i = 0; i < 128; i++) peakA += hist[i];
        for (int i = 128; i < 256; i++) peakB += hist[i];
        float balance = 1f - Math.abs(peakA - peakB) / (float) Math.max(1, peakA + peakB);
        bimodal = Img.clamp01(edgeDensity * 4f) * (0.4f + 0.6f * balance)
                * (1f - Img.clamp01(s.saturation * 1.4f));
        s.textScore = Img.clamp01(bimodal * (0.5f + s.contrast * 2f));

        // ---- faces
        if (faceBoxes != null && faceBoxes.length > 0) {
            long area = 0;
            for (int[] f : faceBoxes) area += (long) f[2] * f[3];
            s.faceFill = Img.clamp01(area / (float) n);
            // face weighted WB/metering: re-measure on the largest face
            int best = 0;
            for (int i = 1; i < faceBoxes.length; i++) {
                if ((long) faceBoxes[i][2] * faceBoxes[i][3] > (long) faceBoxes[best][2] * faceBoxes[best][3]) best = i;
            }
            int[] fb = faceBoxes[best];
            int x0 = Img.clampI(fb[0], 0, w - 1), y0 = Img.clampI(fb[1], 0, h - 1);
            int x1 = Img.clampI(fb[0] + fb[2], 0, w), y1 = Img.clampI(fb[1] + fb[3], 0, h);
            double fr = 0, fg = 0, fbb = 0;
            int fn = 0;
            for (int y = y0; y < y1; y += 2) {
                for (int x = x0; x < x1; x += 2) {
                    int c = img.px[y * w + x];
                    fr += Img.R(c);
                    fg += Img.G(c);
                    fbb += Img.B(c);
                    fn++;
                }
            }
            if (fn > 16) {
                double frm = fr / fn, fgm = fg / fn, fbm = fbb / fn;
                s.meanR = Img.mix(s.meanR, (float) frm, 0.65f);
                s.meanG = Img.mix(s.meanG, (float) fgm, 0.65f);
                s.meanB = Img.mix(s.meanB, (float) fbm, 0.65f);
            }
        }

        // ---- gray world / cast estimation
        double gm2 = Math.max(1.0, (s.meanR + s.meanG + s.meanB) / 3.0);
        s.wbR = (float) (gm2 / Math.max(8.0, s.meanR));
        s.wbG = (float) (gm2 / Math.max(8.0, s.meanG));
        s.wbB = (float) (gm2 / Math.max(8.0, s.meanB));
        float rg2 = s.meanR / Math.max(1f, s.meanG);
        float bg2 = s.meanB / Math.max(1f, s.meanG);
        // green/magenta axis and blue/yellow axis, both relative to the green channel
        s.greenCast = (rg2 + bg2) * 0.5f - 1f;
        s.blueCast = bg2 - 1f;

        // normalise the WB gains so the luminance is preserved
        float lum = 0.2126f * s.wbR + 0.7152f * s.wbG + 0.0722f * s.wbB;
        if (lum > 1e-4f) {
            s.wbR /= lum;
            s.wbG /= lum;
            s.wbB /= lum;
        }
        return s;
    }

    private static float percentile(int[] hist, int n, float p) {
        int target = (int) (n * p);
        int acc = 0;
        for (int i = 0; i < 256; i++) {
            acc += hist[i];
            if (acc >= target) return i / 255f;
        }
        return 1f;
    }

    private static int countUpTo(int[] hist, int v) {
        int acc = 0;
        for (int i = 0; i <= v && i < 256; i++) acc += hist[i];
        return acc;
    }
}
