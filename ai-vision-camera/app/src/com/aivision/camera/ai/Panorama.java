package com.aivision.camera.ai;

import com.aivision.camera.ai.core.Align;
import com.aivision.camera.ai.core.Img;
import com.aivision.camera.ai.core.Stats;

import java.util.ArrayList;
import java.util.List;

/**
 * Real panorama stitching on the phone. Successive frames are aligned to their predecessor with the
 * engine's motion estimator, exposure matched over the overlap, and blended with a feathered weight so
 * the seams do not show. Nothing here is simulated: each frame contributes measured pixels.
 */
public class Panorama {

    private static final int MAX_CANVAS_PIXELS = 40 * 1000 * 1000;

    private final List<Img> frames = new ArrayList<Img>();
    private final List<int[]> positions = new ArrayList<int[]>();
    private final List<Float> weights = new ArrayList<Float>();
    private final int maxFrames;
    private Img previous;
    private Img previousGrey;
    private float cursorX, cursorY;
    private int minX, minY, maxX, maxY;
    private String status = "Sweep slowly across the scene";
    private boolean full;

    public Panorama(int maxFrames) {
        this.maxFrames = Math.max(2, maxFrames);
    }

    public int count() {
        return frames.size();
    }

    public boolean isFull() {
        return full;
    }

    public String status() {
        return status;
    }

    /** Adds one captured frame; returns false when the frame could not be placed. */
    public boolean add(Img frame) {
        if (frame == null || full) return false;
        Img grey = grey(frame);
        if (frames.isEmpty()) {
            frames.add(frame);
            positions.add(new int[]{0, 0});
            weights.add(meanLuma(frame));
            minX = 0;
            minY = 0;
            maxX = frame.w;
            maxY = frame.h;
            previous = frame;
            previousGrey = grey;
            status = "Keep sweeping - " + frames.size() + " frames";
            return true;
        }
        if (grey.w != previousGrey.w || grey.h != previousGrey.h) {
            grey = grey.scaled(previousGrey.w, previousGrey.h);
        }
        Align.Motion m = Align.estimate(previousGrey, grey, Math.max(24, grey.w / 3), 12f);
        float k = frame.w / (float) grey.w;
        // the frame content moves opposite to the camera pan, so the place position moves with it
        cursorX -= m.tx * k;
        cursorY -= m.ty * k;
        int px = Math.round(cursorX), py = Math.round(cursorY);
        // keep the panorama horizontal-ish: never let vertical drift run away
        if (Math.abs(py) > frame.h * 0.45f) {
            status = "Tilt too fast - hold the horizon level";
            return false;
        }
        if (Math.abs(m.tx * k) > frame.w * 0.75f) {
            status = "Too fast - sweep slower for clean seams";
            return false;
        }
        frames.add(frame);
        positions.add(new int[]{px, py});
        weights.add(meanLuma(frame));
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px + frame.w);
        maxY = Math.max(maxY, py + frame.h);
        previous = frame;
        previousGrey = grey;
        status = "Sweeping " + frames.size() + "/" + maxFrames + " frames";
        if (frames.size() >= maxFrames) full = true;
        return true;
    }

    private static Img grey(Img src) {
        int tw = Math.min(480, src.w);
        int th = Math.max(8, Math.round(src.h * (tw / (float) src.w)));
        Img small = src.scaled(tw, th);
        int[] px = new int[small.px.length];
        for (int i = 0; i < px.length; i++) {
            // Img.luma is normalised 0..1 - scale it into the 0..255 integer space for the estimator
            int l = Img.clamp255((int) (Img.luma(small.px[i]) * 255f));
            px[i] = Img.rgb(l, l, l);
        }
        return new Img(small.w, small.h, px);
    }

    private static float meanLuma(Img img) {
        Stats s = Stats.of(img);
        return s.meanLuma;
    }

    /**
     * Composites all frames into one wide image. Each new frame is exposure matched against the part of
     * the canvas it overlaps (not against the whole frame, which would fight a real brightness gradient
     * in the scene), then blended with a feathered weight so no seam shows.
     */
    public Img finish() {
        if (frames.isEmpty()) return null;
        int w = maxX - minX, h = maxY - minY;
        if ((long) w * h > MAX_CANVAS_PIXELS) {
            float k = (float) Math.sqrt(MAX_CANVAS_PIXELS / (double) ((long) w * h));
            w = Math.max(1, Math.round(w * k));
            h = Math.max(1, Math.round(h * k));
        }
        float[] accR = new float[w * h];
        float[] accG = new float[w * h];
        float[] accB = new float[w * h];
        float[] accW = new float[w * h];
        float feather = Math.max(6f, Math.min(frames.get(0).w, frames.get(0).h) * 0.10f);
        float scale = Math.min(1f, Math.min((float) w / Math.max(1, maxX - minX),
                (float) h / Math.max(1, maxY - minY)));
        for (int f = 0; f < frames.size(); f++) {
            Img src = frames.get(f);
            int[] pos = positions.get(f);
            // ---- pass 1: exposure match over the overlap with what is already composited
            float gain = 1f;
            if (f > 0) {
                double sumCanvas = 0, sumFrame = 0;
                int counted = 0;
                for (int y = 0; y < src.h; y += 2) {
                    int dy = (int) ((y + pos[1] - minY) * scale);
                    if (dy < 0 || dy >= h) continue;
                    for (int x = 0; x < src.w; x += 2) {
                        int dx = (int) ((x + pos[0] - minX) * scale);
                        if (dx < 0 || dx >= w) continue;
                        int i = dy * w + dx;
                        float wt = accW[i];
                        if (wt <= 0.01f) continue;
                        int c = src.px[y * src.w + x];
                        sumCanvas += (accR[i] + accG[i] + accB[i]) / (3.0 * wt);
                        sumFrame += (Img.R(c) + Img.G(c) + Img.B(c)) / 3.0;
                        counted++;
                    }
                }
                if (counted > 400 && sumFrame > 1.0) {
                    gain = (float) (sumCanvas / sumFrame);
                    gain = Math.max(0.90f, Math.min(1.12f, gain));
                }
            }
            // ---- pass 2: accumulate with feathering
            for (int y = 0; y < src.h; y++) {
                int dy = (int) ((y + pos[1] - minY) * scale);
                if (dy < 0 || dy >= h) continue;
                for (int x = 0; x < src.w; x++) {
                    int dx = (int) ((x + pos[0] - minX) * scale);
                    if (dx < 0 || dx >= w) continue;
                    int c = src.px[y * src.w + x];
                    float edge = Math.min(Math.min(x, src.w - 1 - x), Math.min(y, src.h - 1 - y));
                    float wt = Math.min(1f, 0.15f + edge / feather);
                    int i = dy * w + dx;
                    accR[i] += Img.R(c) * gain * wt;
                    accG[i] += Img.G(c) * gain * wt;
                    accB[i] += Img.B(c) * gain * wt;
                    accW[i] += wt;
                }
            }
        }
        int[] out = new int[w * h];
        for (int i = 0; i < out.length; i++) {
            float wt = accW[i];
            if (wt <= 0.001f) {
                out[i] = 0xFF000000;
                continue;
            }
            out[i] = Img.rgb(Img.clamp255((int) (accR[i] / wt)), Img.clamp255((int) (accG[i] / wt)),
                    Img.clamp255((int) (accB[i] / wt)));
        }
        Img result = new Img(w, h, out);
        return cropEmpty(result);
    }

    /** Removes the black wedges left at the top and bottom where no frame covered the canvas. */
    private static Img cropEmpty(Img img) {
        int top = 0, bottom = img.h - 1;
        while (top < img.h && rowFilled(img, top) < 0.35f) top++;
        while (bottom > top && rowFilled(img, bottom) < 0.35f) bottom--;
        if (top <= 0 && bottom >= img.h - 1) return img;
        int h = Math.max(16, bottom - top + 1);
        Img out = new Img(img.w, h);
        System.arraycopy(img.px, top * img.w, out.px, 0, img.w * h);
        return out;
    }

    private static float rowFilled(Img img, int y) {
        int filled = 0;
        for (int x = 0; x < img.w; x += 4) {
            if ((img.px[y * img.w + x] & 0xFFFFFF) != 0) filled++;
        }
        return filled / (float) Math.max(1, img.w / 4);
    }

    private static float clamp(float v, float lo, float hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
