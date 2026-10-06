package com.aivision.camera.ai.test;

import com.aivision.camera.ai.Panorama;
import com.aivision.camera.ai.core.Img;

import java.util.Random;

/**
 * Host-JVM check for the panorama stitcher: a synthetic wide "world" is scanned in overlapping
 * windows the way a phone pans across a scene, and the stitched result must line up with the original
 * world image. This is the same code path the app runs when the user sweeps.
 */
public final class PanoramaTest {

    private static int passed = 0, failed = 0;

    public static void main(String[] args) {
        System.out.println("Panorama stitching test");
        System.out.println("-----------------------------------------------------------");
        try {
            testStitch();
        } catch (Throwable t) {
            t.printStackTrace();
            failed++;
        }
        System.out.println("-----------------------------------------------------------");
        System.out.println("passed: " + passed + "   failed: " + failed);
        if (failed > 0) System.exit(1);
    }

    private static void testStitch() {
        final int worldW = 1600, worldH = 640, winW = 700, winH = 640, step = 120, frames = 7;
        Random rnd = new Random(7);
        Img world = new Img(worldW, worldH);
        for (int y = 0; y < worldH; y++) {
            for (int x = 0; x < worldW; x++) {
                // structured content: gradients plus a few hard edges and texture
                float base = 0.25f + 0.45f * (x / (float) worldW) + 0.15f * (float) Math.sin(x * 0.021)
                        + 0.10f * (float) Math.sin(y * 0.037);
                if (x % 97 < 3) base += 0.18f;
                base += (rnd.nextFloat() - 0.5f) * 0.05f;
                int v = Img.clamp255((int) (base * 255));
                world.px[y * worldW + x] = Img.rgb(v, Img.clamp255((int) (v * 0.92)), Img.clamp255((int) (v * 0.85)));
            }
        }
        long t0 = System.currentTimeMillis();
        Panorama pano = new Panorama(frames);
        int rejects = 0;
        for (int f = 0; f < frames; f++) {
            int ox = f * step;
            Img frame = new Img(winW, winH);
            for (int y = 0; y < winH; y++) {
                System.arraycopy(world.px, y * worldW + ox, frame.px, y * winW, winW);
            }
            // a little sensor noise so alignment is not trivially perfect
            Random nr = new Random(11 + f);
            for (int i = 0; i < frame.px.length; i++) {
                int c = frame.px[i];
                int n = (int) ((nr.nextFloat() - 0.5f) * 8);
                frame.px[i] = Img.rgb(Img.clamp255(Img.R(c) + n), Img.clamp255(Img.G(c) + n), Img.clamp255(Img.B(c) + n));
            }
            if (!pano.add(frame)) rejects++;
        }
        Img out = pano.finish();
        long ms = System.currentTimeMillis() - t0;

        check("frames accepted", pano.count() >= frames - 1, pano.count() + " of " + frames
                + " accepted (" + rejects + " rejected), " + ms + " ms");
        if (out == null) {
            check("stitched image produced", false, "null");
            return;
        }
        int expectedW = winW + step * (frames - 1);
        check("stitched width matches the sweep", Math.abs(out.w - expectedW) <= 30,
                "stitched " + out.w + "x" + out.h + ", expected about " + expectedW + " px wide");
        // compare the middle of the stitched image against the corresponding world window
        double err = 0;
        int counted = 0;
        int marginX = out.w / 6;
        int top = Math.max(0, out.h / 4);
        int bottom = Math.min(out.h * 3 / 4, worldH);
        for (int y = top; y < bottom; y++) {
            for (int x = marginX; x < out.w - marginX; x += 3) {
                if (x >= worldW) continue;
                int stitched = out.px[y * out.w + x];
                int ref = world.px[y * worldW + x];
                err += Math.abs(Img.luma(stitched) - Img.luma(ref)) * 255.0;
                counted++;
            }
        }
        double mean = err / Math.max(1, counted);
        check("stitched pixels line up with the real scene", mean < 9.0,
                String.format(java.util.Locale.US, "mean luma error %.2f / 255 over %d samples", mean, counted));
    }

    private static void check(String name, boolean ok, String detail) {
        if (ok) passed++;
        else failed++;
        System.out.println((ok ? "  PASS  " : "  FAIL  ") + name);
        System.out.println("        " + detail);
    }
}
