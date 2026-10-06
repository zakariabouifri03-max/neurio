package com.aivision.camera.ai.core;

/**
 * Packed ARGB image buffer used by the whole AI engine.
 *
 * <p>The engine is deliberately written against plain <code>int[]</code> ARGB buffers and
 * <code>float[]</code> planes so that it is 100% pure Java: no Android classes are used in
 * {@code com.aivision.camera.ai.core}. That makes the compute-photography core unit-testable on a
 * normal JVM (see {@code tests/}) and keeps the Android layer thin (Bitmap &lt;-&gt; int[]).
 */
public final class Img {
    public final int w;
    public final int h;
    public final int[] px;

    public Img(int w, int h) {
        this.w = w;
        this.h = h;
        this.px = new int[w * h];
    }

    public Img(int w, int h, int[] px) {
        this.w = w;
        this.h = h;
        this.px = px;
        if (px.length != w * h) throw new IllegalArgumentException("buffer size mismatch");
    }

    public Img copy() {
        int[] c = new int[px.length];
        System.arraycopy(px, 0, c, 0, px.length);
        return new Img(w, h, c);
    }

    public int size() {
        return px.length;
    }

    public int get(int x, int y) {
        return px[y * w + x];
    }

    public void set(int x, int y, int argb) {
        px[y * w + x] = argb;
    }

    /** Bilinear sample with edge clamping, coordinates in image space. */
    public int sample(float x, float y) {
        if (x < 0) x = 0;
        else if (x > w - 1) x = w - 1;
        if (y < 0) y = 0;
        else if (y > h - 1) y = h - 1;
        int x0 = (int) x, y0 = (int) y;
        int x1 = x0 + 1 < w ? x0 + 1 : x0;
        int y1 = y0 + 1 < h ? y0 + 1 : y0;
        float fx = x - x0, fy = y - y0;
        int c00 = px[y0 * w + x0], c10 = px[y0 * w + x1];
        int c01 = px[y1 * w + x0], c11 = px[y1 * w + x1];
        float w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
        float w01 = (1 - fx) * fy, w11 = fx * fy;
        int a = (int) (A(c00) * w00 + A(c10) * w10 + A(c01) * w01 + A(c11) * w11 + 0.5f);
        int r = (int) (R(c00) * w00 + R(c10) * w10 + R(c01) * w01 + R(c11) * w11 + 0.5f);
        int g = (int) (G(c00) * w00 + G(c10) * w10 + G(c01) * w01 + G(c11) * w11 + 0.5f);
        int b = (int) (B(c00) * w00 + B(c10) * w10 + B(c01) * w01 + B(c11) * w11 + 0.5f);
        return argb(a, r, g, b);
    }

    /**
     * Catmull-Rom (bicubic) sample with edge clamping. Used wherever a frame has to be resampled by
     * a sub-pixel amount: bilinear sampling would low-pass the frame and quietly destroy exactly the
     * fine detail the engine is trying to protect.
     */
    public int sampleCubic(float x, float y) {
        int xi = (int) Math.floor(x), yi = (int) Math.floor(y);
        float fx = x - xi, fy = y - yi;
        // early out over the flat case keeps the cost reasonable in practice
        float r = 0, g = 0, b = 0;
        for (int j = -1; j <= 2; j++) {
            float wy = crw(fy - j);
            int yy = Img.clampI(yi + j, 0, h - 1);
            int row = yy * w;
            for (int i = -1; i <= 2; i++) {
                float wgt = wy * crw(fx - i);
                if (wgt == 0) continue;
                int c = px[row + Img.clampI(xi + i, 0, w - 1)];
                r += R(c) * wgt;
                g += G(c) * wgt;
                b += B(c) * wgt;
            }
        }
        return rgb((int) (r + 0.5f), (int) (g + 0.5f), (int) (b + 0.5f));
    }

    private static float crw(float t) {
        t = Math.abs(t);
        float t2 = t * t, t3 = t2 * t;
        if (t <= 1f) return 1.5f * t3 - 2.5f * t2 + 1f;
        if (t < 2f) return -0.5f * t3 + 2.5f * t2 - 4f * t + 2f;
        return 0f;
    }

    public Img scaled(int nw, int nh) {
        Img out = new Img(nw, nh);
        float sx = (float) w / nw, sy = (float) h / nh;
        for (int y = 0; y < nh; y++) {
            float fy = (y + 0.5f) * sy - 0.5f;
            for (int x = 0; x < nw; x++) {
                out.px[y * nw + x] = sample((x + 0.5f) * sx - 0.5f, fy);
            }
        }
        return out;
    }

    public Img cropped(int x0, int y0, int cw, int ch) {
        if (x0 < 0) x0 = 0;
        if (y0 < 0) y0 = 0;
        if (x0 + cw > w) cw = w - x0;
        if (y0 + ch > h) ch = h - y0;
        Img out = new Img(cw, ch);
        for (int y = 0; y < ch; y++) {
            System.arraycopy(px, (y0 + y) * w + x0, out.px, y * cw, cw);
        }
        return out;
    }

    // ---------------------------------------------------------------- packed helpers

    public static int argb(int a, int r, int g, int b) {
        return (a << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
    }

    public static int rgb(int r, int g, int b) {
        return 0xFF000000 | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
    }

    public static int A(int c) {
        return (c >>> 24) & 0xFF;
    }

    public static int R(int c) {
        return (c >> 16) & 0xFF;
    }

    public static int G(int c) {
        return (c >> 8) & 0xFF;
    }

    public static int B(int c) {
        return c & 0xFF;
    }

    public static int clamp255(int v) {
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    public static float clamp(float v, float lo, float hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    public static float clamp01(float v) {
        return v < 0 ? 0 : (v > 1 ? 1 : v);
    }

    public static int clampI(int v, int lo, int hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    public static float lerp(float a, float b, float t) {
        return a + (b - a) * t;
    }

    /** Rec.709 luma, normalised to 0..1. */
    public static float luma(int argb) {
        return (0.2126f * R(argb) + 0.7152f * G(argb) + 0.0722f * B(argb)) * (1f / 255f);
    }

    /** Returns the pixel with a new luminance, keeping its chroma (hue/saturation) intact. */
    public static int withLuma(int argb, float l) {
        int r = R(argb), g = G(argb), b = B(argb);
        float oldY = 0.299f * r + 0.587f * g + 0.114f * b;
        float target = l * 255f;
        if (oldY < 1f) {
            int v = clamp255((int) (target + 0.5f));
            return rgb(v, v, v);
        }
        float k = target / oldY;
        return rgb((int) (r * k + 0.5f), (int) (g * k + 0.5f), (int) (b * k + 0.5f));
    }

    public float[] toLuma() {
        float[] out = new float[px.length];
        for (int i = 0; i < px.length; i++) out[i] = luma(px[i]);
        return out;
    }

    public void applyLuma(float[] l) {
        for (int i = 0; i < px.length; i++) px[i] = withLuma(px[i], l[i]);
    }

    /** SmoothStep-ish S curve, 0..1 in, 0..1 out. */
    public static float sCurve(float x, float contrast) {
        float t = clamp01(x);
        float s = t * t * (3f - 2f * t);
        return lerp(t, s, contrast);
    }

    public static float smoothstep(float e0, float e1, float x) {
        float t = clamp01((x - e0) / (e1 - e0 + 1e-6f));
        return t * t * (3f - 2f * t);
    }

    public static float mix(float a, float b, float t) {
        return a + (b - a) * t;
    }
}
