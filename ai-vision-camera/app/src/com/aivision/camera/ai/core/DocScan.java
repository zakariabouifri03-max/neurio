package com.aivision.camera.ai.core;

/**
 * Document capture engine: page detection, perspective correction and scanner grade cleanup.
 *
 * <p>Page detection runs on a downscaled copy: Otsu threshold, largest bright region, then the
 * quadrilateral is read off the region's extreme points and refined against the actual image
 * gradient. The perspective transform is a true 8-DOF homography solved with Gaussian elimination,
 * so a page shot at an angle comes out rectangular and square-cornered.
 */
public final class DocScan {

    private DocScan() {
    }

    /** Detected page corners in image coordinates, ordered TL, TR, BR, BL. Null when nothing found. */
    public static float[] detectPage(Img img) {
        int w = img.w, h = img.h;
        int dw = Math.min(360, w), dh = Math.max(8, Math.round(h * (dw / (float) w)));
        Img small = img.scaled(dw, dh);
        float[] y = small.toLuma();
        int[] hist = new int[256];
        for (float v : y) hist[Img.clampI((int) (v * 255f), 0, 255)]++;
        int otsu = otsuThreshold(hist, y.length);
        // flood-free connected component: label rows of the bright mask, keep the biggest blob
        boolean[] bright = new boolean[dw * dh];
        for (int i = 0; i < y.length; i++) bright[i] = y[i] * 255f > otsu;
        int[] label = new int[dw * dh];
        int best = 0, bestSize = 0;
        int[] stack = new int[dw * dh];
        for (int i = 0; i < bright.length; i++) {
            if (!bright[i] || label[i] != 0) continue;
            int id = best + 1;
            int sp = 0;
            stack[sp++] = i;
            label[i] = id;
            int size = 0;
            while (sp > 0) {
                int p = stack[--sp];
                size++;
                int px = p % dw, py = p / dw;
                for (int d = 0; d < 4; d++) {
                    int nx = px + (d == 0 ? -1 : d == 1 ? 1 : 0);
                    int ny = py + (d == 2 ? -1 : d == 3 ? 1 : 0);
                    if (nx < 0 || ny < 0 || nx >= dw || ny >= dh) continue;
                    int q = ny * dw + nx;
                    if (bright[q] && label[q] == 0) {
                        label[q] = id;
                        stack[sp++] = q;
                    }
                }
            }
            if (size > bestSize) {
                bestSize = size;
                best = id;
            }
        }
        float area = bestSize / (float) (dw * dh);
        if (best == 0 || area < 0.14f) return null;
        // extreme points of the blob = the quad corners (works for convex pages)
        float minSum = Float.MAX_VALUE, maxSum = -Float.MAX_VALUE, minDiff = Float.MAX_VALUE, maxDiff = -Float.MAX_VALUE;
        float[] tl = new float[2], tr = new float[2], br = new float[2], bl = new float[2];
        for (int py = 0; py < dh; py++) {
            for (int px = 0; px < dw; px++) {
                if (label[py * dw + px] != best) continue;
                float s = px + py, d = px - py;
                if (s < minSum) {
                    minSum = s;
                    tl[0] = px;
                    tl[1] = py;
                }
                if (s > maxSum) {
                    maxSum = s;
                    br[0] = px;
                    br[1] = py;
                }
                if (d > maxDiff) {
                    maxDiff = d;
                    tr[0] = px;
                    tr[1] = py;
                }
                if (d < minDiff) {
                    minDiff = d;
                    bl[0] = px;
                    bl[1] = py;
                }
            }
        }
        float scale = w / (float) dw;
        float[] quad = new float[]{tl[0] * scale, tl[1] * scale, tr[0] * scale, tr[1] * scale,
                br[0] * scale, br[1] * scale, bl[0] * scale, bl[1] * scale};
        // sanity: reject degenerate quads (too small, or self intersecting)
        float qw = dist(quad, 0, 1), qh = dist(quad, 0, 3);
        if (qw < w * 0.2f || qh < h * 0.15f) return null;
        if (!convex(quad)) return null;
        return refineCorners(img, quad);
    }

    private static boolean convex(float[] q) {
        int sign = 0;
        for (int i = 0; i < 4; i++) {
            int j = (i + 1) % 4, k = (i + 2) % 4;
            float ax = q[j * 2] - q[i * 2], ay = q[j * 2 + 1] - q[i * 2 + 1];
            float bx = q[k * 2] - q[j * 2], by = q[k * 2 + 1] - q[j * 2 + 1];
            float cross = ax * by - ay * bx;
            int s = cross > 0 ? 1 : (cross < 0 ? -1 : 0);
            if (s != 0) {
                if (sign == 0) sign = s;
                else if (s != sign) return false;
            }
        }
        return true;
    }

    /** Nudges each corner to the strongest nearby gradient so the crop hugs the real page edge. */
    private static float[] refineCorners(Img img, float[] quad) {
        float[] out = quad.clone();
        int search = Math.max(6, Math.min(img.w, img.h) / 60);
        float[] gray = Align.toGray(img);
        for (int c = 0; c < 4; c++) {
            float cx = quad[c * 2], cy = quad[c * 2 + 1];
            float bxx = cx, byy = cy, be = Float.MAX_VALUE;
            for (int dy = -search; dy <= search; dy++) {
                for (int dx = -search; dx <= search; dx++) {
                    float px = cx + dx, py = cy + dy;
                    if (px < 2 || py < 2 || px >= img.w - 3 || py >= img.h - 3) continue;
                    float e = 0;
                    // local edge energy + darkness penalty (page corners sit where border meets page)
                    for (int o = -2; o <= 2; o++) {
                        float a = Align.sampleGray(gray, img.w, img.h, px - 3, py + o);
                        float b = Align.sampleGray(gray, img.w, img.h, px + 3, py + o);
                        e += Math.abs(a - b);
                        float a2 = Align.sampleGray(gray, img.w, img.h, px + o, py - 3);
                        float b2 = Align.sampleGray(gray, img.w, img.h, px + o, py + 3);
                        e += Math.abs(a2 - b2);
                    }
                    if (e < be) {
                        be = e;
                        bxx = px;
                        byy = py;
                    }
                }
            }
            if (be > 0) {
                out[c * 2] = Img.mix(cx, bxx, 0.7f);
                out[c * 2 + 1] = Img.mix(cy, byy, 0.7f);
            }
        }
        return out;
    }

    private static float dist(float[] q, int a, int b) {
        float dx = q[a * 2] - q[b * 2], dy = q[a * 2 + 1] - q[b * 2 + 1];
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    private static int otsuThreshold(int[] hist, int total) {
        double sum = 0;
        for (int i = 0; i < 256; i++) sum += i * (double) hist[i];
        double sumB = 0;
        int wB = 0;
        double best = -1;
        int th = 128;
        for (int t = 0; t < 256; t++) {
            wB += hist[t];
            if (wB == 0) continue;
            int wF = total - wB;
            if (wF == 0) break;
            sumB += t * (double) hist[t];
            double mB = sumB / wB;
            double mF = (sum - sumB) / wF;
            double between = (double) wB * wF * (mB - mF) * (mB - mF);
            if (between > best) {
                best = between;
                th = t;
            }
        }
        return th;
    }

    /** Warps the detected page into a rectangular, maximally sized output. */
    public static Img warpPage(Img src, float[] quad) {
        float wTop = dist(quad, 0, 1), wBot = dist(quad, 3, 2);
        float hLeft = dist(quad, 0, 3), hRight = dist(quad, 1, 2);
        int outW = Math.max(64, Math.round(Math.max(wTop, wBot)));
        int outH = Math.max(64, Math.round(Math.max(hLeft, hRight)));
        outW = Math.min(outW, src.w * 2);
        outH = Math.min(outH, src.h * 2);
        // homography from the destination rectangle into the source image
        float[] dst = new float[]{0, 0, outW - 1f, 0, outW - 1f, outH - 1f, 0, outH - 1f};
        float[] hm = solveHomography(dst, quad);
        if (hm == null) return src.copy();
        Img out = new Img(outW, outH);
        for (int y = 0; y < outH; y++) {
            for (int x = 0; x < outW; x++) {
                float den = hm[6] * x + hm[7] * y + 1f;
                if (Math.abs(den) < 1e-6f) den = 1e-6f;
                float sx = (hm[0] * x + hm[1] * y + hm[2]) / den;
                float sy = (hm[3] * x + hm[4] * y + hm[5]) / den;
                out.px[y * outW + x] = src.sample(sx, sy);
            }
        }
        return out;
    }

    /** Solves the 8 DOF homography that maps the (x,y) set onto the (u,v) set. */
    static float[] solveHomography(float[] from, float[] to) {
        double[][] m = new double[8][9];
        for (int i = 0; i < 4; i++) {
            double x = from[i * 2], y = from[i * 2 + 1];
            double u = to[i * 2], v = to[i * 2 + 1];
            m[i * 2][0] = x;
            m[i * 2][1] = y;
            m[i * 2][2] = 1;
            m[i * 2][6] = -x * u;
            m[i * 2][7] = -y * u;
            m[i * 2][8] = u;
            m[i * 2 + 1][3] = x;
            m[i * 2 + 1][4] = y;
            m[i * 2 + 1][5] = 1;
            m[i * 2 + 1][6] = -x * v;
            m[i * 2 + 1][7] = -y * v;
            m[i * 2 + 1][8] = v;
        }
        // Gaussian elimination with partial pivoting
        for (int col = 0; col < 8; col++) {
            int piv = col;
            for (int r = col + 1; r < 8; r++) {
                if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
            }
            if (Math.abs(m[piv][col]) < 1e-9) return null;
            double[] tmp = m[col];
            m[col] = m[piv];
            m[piv] = tmp;
            for (int r = 0; r < 8; r++) {
                if (r == col) continue;
                double f = m[r][col] / m[col][col];
                if (f == 0) continue;
                for (int c = col; c < 9; c++) m[r][c] -= f * m[col][c];
            }
        }
        float[] h = new float[8];
        for (int i = 0; i < 8; i++) h[i] = (float) (m[i][8] / m[i][i]);
        return h;
    }

    /**
     * Scanner look: illumination flattening, white point normalisation, local contrast, and
     * optional adaptive-threshold binarisation for a crisp "scan" appearance.
     */
    public static void scanLook(Img img, float strength, boolean binary) throws Exception {
        final int w = img.w, h = img.h;
        Enhance.flattenIllumination(img, Img.clamp01(strength) * 1.1f);
        // white point from the 95th percentile of luminance
        Stats s = Stats.of(img);
        float wp = Img.clamp(s.p95Luma + 0.04f, 0.6f, 1f);
        Enhance.outputCurve(img, 0.012f, wp, 0.35f + 0.25f * strength);
        if (binary) {
            float[] y = img.toLuma();
            float[] local = new float[y.length];
            System.arraycopy(y, 0, local, 0, y.length);
            Filters.gaussBlur(local, w, h, Math.max(6, Math.min(w, h) / 40));
            for (int i = 0; i < y.length; i++) {
                float t = local[i] - 0.055f + 0.02f * strength;
                int v = y[i] > t ? 255 : 0;
                img.px[i] = Img.rgb(v, v, v);
            }
        } else {
            // local contrast for text: structure gated, keeps paper white and ink black
            float[] y = img.toLuma();
            float[] blur = new float[y.length];
            System.arraycopy(y, 0, blur, 0, y.length);
            Filters.gaussBlur(blur, w, h, 1);
            for (int i = 0; i < y.length; i++) {
                float hp = y[i] - blur[i];
                float nv = Img.clamp01(y[i] + hp * (0.55f + 0.35f * strength));
                img.px[i] = Img.withLuma(img.px[i], nv);
            }
        }
    }
}
