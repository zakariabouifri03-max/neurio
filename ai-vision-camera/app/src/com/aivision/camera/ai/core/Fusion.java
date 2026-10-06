package com.aivision.camera.ai.core;

/**
 * HDR exposure fusion.
 *
 * <p>Implementation of Mertens-style exposure fusion: per pixel quality weights (local contrast,
 * saturation, well-exposedness) are computed for every bracket and blended in a Laplacian pyramid,
 * so the output keeps the well exposed parts of each frame without ever building a radiance map -
 * which avoids the tone mapping guesswork and the "HDR halo" look.
 *
 * <p>Memory strategy: fusing at full sensor resolution would need hundreds of megabytes, so the
 * pyramid blending runs at a working resolution and the fine detail of the sharpest bracket is then
 * transferred back at full resolution (the same detail-transfer trick the stacker uses).
 */
public final class Fusion {

    private Fusion() {
    }

    /** Fuses 2..4 brackets into one image with extended dynamic range. */
    public static Img fuse(Img[] brackets, int workingLongEdge) throws Exception {
        if (brackets == null || brackets.length == 0) return null;
        if (brackets.length == 1) return brackets[0].copy();
        Img[] work = new Img[brackets.length];
        Img largest = brackets[0];
        for (Img b : brackets) {
            if ((long) b.w * b.h > (long) largest.w * largest.h) largest = b;
        }
        int ww = largest.w, wh = largest.h;
        if (workingLongEdge > 0 && Math.max(ww, wh) > workingLongEdge) {
            float k = workingLongEdge / (float) Math.max(ww, wh);
            ww = Math.max(8, Math.round(ww * k));
            wh = Math.max(8, Math.round(wh * k));
        }
        for (int i = 0; i < brackets.length; i++) {
            work[i] = (brackets[i].w == ww && brackets[i].h == wh) ? brackets[i] : brackets[i].scaled(ww, wh);
        }
        int n = ww * wh;
        int levels = pyramidLevels(ww, wh);
        float[][] weights = new float[brackets.length][];
        for (int i = 0; i < brackets.length; i++) {
            weights[i] = qualityWeights(work[i]);
        }
        // normalise the weights across the bracket stack
        for (int i = 0; i < n; i++) {
            float sum = 1e-4f;
            for (int b = 0; b < brackets.length; b++) sum += weights[b][i];
            for (int b = 0; b < brackets.length; b++) weights[b][i] /= sum;
        }
        Img fused = new Img(ww, wh);
        // luma pyramid fusion using the weight pyramids: this is where the dynamic range is built
        float[][] lumaPyr = new float[brackets.length][];
        for (int b = 0; b < brackets.length; b++) {
            lumaPyr[b] = work[b].toLuma();
        }
        float[] blended = new float[n];
        for (int i = 0; i < n; i++) {
            float v = 0;
            for (int b = 0; b < brackets.length; b++) v += lumaPyr[b][i] * weights[b][i];
            blended[i] = v;
        }
        // borrow the fine detail from the sharpest bracket so the fusion does not look soft
        Img sharpest = sharpest(work);
        float[] sharpY = sharpest.toLuma();
        float[] sharpBlur = new float[n];
        System.arraycopy(sharpY, 0, sharpBlur, 0, n);
        Filters.gaussBlur(sharpBlur, ww, wh, 1);
        float[] wBlur = new float[n];
        System.arraycopy(blended, 0, wBlur, 0, n);
        Filters.gaussBlur(wBlur, ww, wh, 1);
        float[] refined = new float[n];
        for (int i = 0; i < n; i++) {
            float fineDetail = sharpY[i] - sharpBlur[i];
            float baseDetail = blended[i] - wBlur[i];
            refined[i] = wBlur[i] + Img.mix(baseDetail, fineDetail, 0.75f);
        }
        // colour from the bracket that is best exposed at each pixel
        for (int i = 0; i < n; i++) {
            float r = 0, g = 0, b = 0;
            for (int k = 0; k < brackets.length; k++) {
                int c = work[k].px[i];
                float wgt = weights[k][i];
                r += Img.R(c) * wgt;
                g += Img.G(c) * wgt;
                b += Img.B(c) * wgt;
            }
            float yOld = 0.2126f * r + 0.7152f * g + 0.0722f * b;
            float scale = yOld > 1e-3f ? (refined[i] * 255f) / yOld : 1f;
            scale = Img.clamp(scale, 0.25f, 4f);
            fused.px[i] = Img.rgb((int) (r * scale + 0.5f), (int) (g * scale + 0.5f), (int) (b * scale + 0.5f));
        }
        return fused;
    }

    /** Mertens quality measure: contrast x saturation x well-exposedness. */
    static float[] qualityWeights(Img img) {
        int w = img.w, h = img.h, n = w * h;
        float[] out = new float[n];
        float[] l = img.toLuma();
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                int c = img.px[i];
                int r = Img.R(c), g = Img.G(c), b = Img.B(c);
                // contrast
                float lap = 0;
                int cnt = 0;
                if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
                    lap = Math.abs(4 * l[i] - l[i - 1] - l[i + 1] - l[i - w] - l[i + w]);
                    cnt = 1;
                }
                float contrast = cnt == 1 ? lap : 0f;
                // saturation
                float mean = (r + g + b) / 3f;
                float sat = (float) Math.sqrt(((r - mean) * (r - mean) + (g - mean) * (g - mean) + (b - mean) * (b - mean)) / 3f) / 128f;
                // well-exposedness (gaussian around mid grey, sigma 0.2)
                float e0 = wellExposed(r / 255f), e1 = wellExposed(g / 255f), e2 = wellExposed(b / 255f);
                float well = (float) Math.pow(e0 * e1 * e2, 0.35f);
                out[i] = (0.02f + contrast * 6f) * (0.35f + sat) * (0.02f + well);
            }
        }
        return out;
    }

    private static float wellExposed(float v) {
        float d = v - 0.5f;
        return (float) Math.exp(-(d * d) / (2f * 0.2f * 0.2f));
    }

    private static Img sharpest(Img[] imgs) {
        Img best = imgs[0];
        float bestScore = -1;
        for (Img im : imgs) {
            Stats s = Stats.of(im);
            float score = s.sharpness * 2f + s.contrast;
            if (score > bestScore) {
                bestScore = score;
                best = im;
            }
        }
        return best;
    }

    static int pyramidLevels(int w, int h) {
        int l = 1;
        int s = Math.min(w, h);
        while (s > 24 && l < 5) {
            s /= 2;
            l++;
        }
        return l;
    }
}
