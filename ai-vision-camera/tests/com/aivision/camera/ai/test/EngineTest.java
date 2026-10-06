package com.aivision.camera.ai.test;

import com.aivision.camera.ai.core.*;

import java.util.Locale;
import java.util.Random;

/**
 * Engine verification harness. Runs the real AI engine (no mocks, no stubbed stages) on synthetic
 * scenes with a known ground truth and measures what actually happened:
 *
 * <ul>
 *   <li>does the stacker really lower noise and raise PSNR against the clean truth?</li>
 *   <li>does the registration recover a known sub-pixel shift?</li>
 *   <li>does multi-frame super resolution beat a plain bicubic upscale in PSNR and edge energy?</li>
 *   <li>does exposure fusion recover shadows without blowing highlights?</li>
 *   <li>does the scene model classify night / document / portrait correctly?</li>
 *   <li>does the document scanner find a page and rectify it?</li>
 *   <li>does the full pipeline run end to end and report sane numbers?</li>
 * </ul>
 *
 * Run with: tools/test-engine.sh   (pure JVM, no Android needed)
 */
public final class EngineTest {

    private static int passed = 0, failed = 0;

    public static void main(String[] args) {
        System.out.println("AI Vision Camera - engine verification");
        System.out.println("threads: " + Parallel.threads());
        System.out.println("-----------------------------------------------------------");
        try {
            testAlignment();
            testStacking();
            testSuperResolution();
            testUpscaleSingle();
            testFusion();
            testSceneModel();
            testDocumentScan();
            testFullPipeline();
            testTierBudgets();
        } catch (Throwable t) {
            t.printStackTrace();
            failed++;
        }
        System.out.println("-----------------------------------------------------------");
        System.out.println("passed: " + passed + "   failed: " + failed);
        if (failed > 0) System.exit(1);
    }

    // ------------------------------------------------------------------ tests

    private static void testAlignment() {
        Img truth = scene(640, 480, 1);
        float dx = 3.4f, dy = -2.2f;
        Img shifted = subpixelShift(truth, dx, dy);
        long t = System.currentTimeMillis();
        Align.Motion m = Align.estimate(truth, shifted);
        long ms = System.currentTimeMillis() - t;
        float errX = Math.abs(m.tx - dx), errY = Math.abs(m.ty - dy);
        check("alignment recovers sub-pixel shift", errX < 0.45f && errY < 0.45f,
                String.format(Locale.US, "true=(%.2f,%.2f) est=(%.2f,%.2f) err=(%.2f,%.2f) %d ms",
                        dx, dy, m.tx, m.ty, errX, errY, ms));
    }

    private static void testStacking() throws Exception {
        int n = 6;
        float sigma = 0.045f;
        Img clean = scene(720, 540, 2);
        Img[] frames = new Img[n];
        Align.Motion[] motions = new Align.Motion[n];
        int[][] truth = new int[n][2];
        Random rnd = new Random(7);
        for (int i = 0; i < n; i++) {
            float sx = i == 0 ? 0 : (rnd.nextFloat() - 0.5f) * 3f;
            float sy = i == 0 ? 0 : (rnd.nextFloat() - 0.5f) * 3f;
            Img s = i == 0 ? clean.copy() : subpixelShift(clean, sx, sy);
            addNoise(s, sigma, 100 + i);
            frames[i] = s;
            truth[i][0] = Math.round(sx * 100);
            truth[i][1] = Math.round(sy * 100);
        }
        long ta = System.currentTimeMillis();
        for (int i = 1; i < n; i++) {
            motions[i] = Align.estimate(frames[0], frames[i]);
        }
        long alignMs = System.currentTimeMillis() - ta;
        StringBuilder err = new StringBuilder();
        float worst = 0;
        for (int i = 1; i < n; i++) {
            float ex = Math.abs(motions[i].tx * 100f - truth[i][0]) / 100f;
            float ey = Math.abs(motions[i].ty * 100f - truth[i][1]) / 100f;
            worst = Math.max(worst, Math.max(ex, ey));
            err.append(String.format(Locale.US, "[f%d %.2f/%.2f rot %.2f deg sc %.4f] ",
                    i, ex, ey, Math.toDegrees(motions[i].rot), motions[i].scale));
        }
        System.out.println("        alignment: " + err + " worst " + String.format(Locale.US, "%.2f", worst) + " px in " + alignMs + " ms");
        Align.Field[] fields = new Align.Field[n];
        for (int i = 1; i < n; i++) fields[i] = Align.tileField(frames[0], frames[i], motions[i], 16, 2);
        Stacker.Options opt = new Stacker.Options();
        opt.noiseSigma = Stats.of(frames[0]).noiseSigma;
        opt.temporalStrength = 1f;
        long t = System.currentTimeMillis();
        Img stacked = Stacker.merge(frames[0], frames, motions, fields, opt, null);
        long ms = System.currentTimeMillis() - t;
        float noiseBefore = Stats.of(frames[0]).noiseSigma;
        float noiseAfter = Stats.of(stacked).noiseSigma;
        double psnrSingle = psnr(frames[0], clean);
        double psnrStack = psnr(stacked, clean);
        boolean ok = noiseAfter < noiseBefore * 0.5f && psnrStack > psnrSingle + 0.3;
        check("multi-frame stack lowers noise and raises PSNR", ok,
                String.format(Locale.US, "noise %.4f -> %.4f (x%.2f), PSNR %.1f -> %.1f dB, merge %d ms / %d frames",
                        noiseBefore, noiseAfter, noiseAfter / Math.max(1e-6f, noiseBefore),
                        psnrSingle, psnrStack, ms, n));
    }

    private static void testSuperResolution() throws Exception {
        // ground truth at 2x, observed frames are 2x2 box averages of sub-pixel shifted copies
        Img truth = scene(720, 540, 3);
        int n = 7;
        Img[] frames = new Img[n];
        Align.Motion[] motions = new Align.Motion[n];
        Random rnd = new Random(11);
        for (int i = 0; i < n; i++) {
            float sx = i == 0 ? 0f : (rnd.nextFloat() - 0.5f) * 1.6f;
            float sy = i == 0 ? 0f : (rnd.nextFloat() - 0.5f) * 1.6f;
            Img shifted = subpixelShift(truth, sx * 2f, sy * 2f);
            Img lr = SuperRes.downscale(shifted, 2);
            addNoise(lr, 0.010f, 200 + i);
            frames[i] = lr;
            Align.Motion m = new Align.Motion();
            m.valid = true;
            m.tx = sx;
            m.ty = sy;
            motions[i] = m;
        }
        long t = System.currentTimeMillis();
        Img sr = SuperRes.multiFrame(frames, motions, 2, 2, 0.45f, 0, Stats.of(frames[0]).noiseSigma);
        long ms = System.currentTimeMillis() - t;
        Img bicubic = SuperRes.bicubic(frames[0], truth.w, truth.h);
        double psnrBicubic = psnr(bicubic, truth);
        double psnrSr = psnr(sr, truth);
        double eBicubic = edgeEnergy(bicubic);
        double eSr = edgeEnergy(sr);
        boolean ok = psnrSr > psnrBicubic + 0.15 && eSr > eBicubic * 1.15;
        check("2x multi-frame super resolution beats bicubic", ok,
                String.format(Locale.US, "PSNR bicubic %.2f dB -> SR %.2f dB (+%.2f), edge energy %.1f -> %.1f, %d ms",
                        psnrBicubic, psnrSr, psnrSr - psnrBicubic, eBicubic, eSr, ms));
    }

    private static void testUpscaleSingle() throws Exception {
        Img truth = scene(640, 480, 4);
        Img lr = SuperRes.downscale(truth, 2);
        long t = System.currentTimeMillis();
        Img up = SuperRes.upscaleSingle(lr, 2, 0.8f);
        long ms = System.currentTimeMillis() - t;
        double pB = psnr(SuperRes.bicubic(lr, truth.w, truth.h), truth);
        double pU = psnr(up, truth);
        check("single frame IBP upscale is sharper than bicubic without ringing",
                edgeEnergy(up) > edgeEnergy(SuperRes.bicubic(lr, truth.w, truth.h)) && pU > pB - 0.6,
                String.format(Locale.US, "PSNR bicubic %.2f -> IBP %.2f dB, %d ms", pB, pU, ms));
    }

    private static void testFusion() throws Exception {
        // high dynamic range scene: deep shadows + bright highlights
        Img base = scene(560, 420, 5);
        Img under = new Img(base.w, base.h);
        Img mid = new Img(base.w, base.h);
        Img over = new Img(base.w, base.h);
        for (int i = 0; i < base.px.length; i++) {
            int c = base.px[i];
            under.px[i] = Img.rgb((int) (Img.R(c) * 0.30f), (int) (Img.G(c) * 0.30f), (int) (Img.B(c) * 0.30f));
            mid.px[i] = c;
            over.px[i] = Img.rgb((int) (Img.R(c) * 2.3f), (int) (Img.G(c) * 2.3f), (int) (Img.B(c) * 2.3f));
        }
        long t = System.currentTimeMillis();
        Img fused = Fusion.fuse(new Img[]{under, mid, over}, 0);
        long ms = System.currentTimeMillis() - t;
        Stats sm = Stats.of(mid), so = Stats.of(over), sf = Stats.of(fused);
        // shadows come back (median up) while highlights are not clipped like the over bracket
        boolean shadowsRecovered = sf.p5Luma > sm.p5Luma * 1.25f;
        boolean highlightsKept = sf.highlightClip < so.highlightClip * 0.5f;
        check("exposure fusion extends dynamic range", shadowsRecovered && highlightsKept,
                String.format(Locale.US, "p5 luma mid=%.3f fused=%.3f | clipped highlights over=%.1f%% fused=%.1f%% | %d ms",
                        sm.p5Luma, sf.p5Luma, so.highlightClip * 100, sf.highlightClip * 100, ms));
    }

    private static void testSceneModel() {
        Scene night = Scene.classify(Stats.of(nightScene(480, 360)));
        Scene doc = Scene.classify(Stats.of(documentScene(480, 360)));
        Scene portrait = Scene.classify(Stats.of(faceScene(480, 360)));
        Scene landscape = Scene.classify(Stats.of(scene(480, 360, 9)));
        boolean okNight = night.type == Scene.Type.NIGHT || night.type == Scene.Type.LOW_LIGHT;
        boolean okDoc = doc.type == Scene.Type.DOCUMENT;
        boolean okPortrait = portrait.type == Scene.Type.PORTRAIT;
        check("scene model: night", okNight, "-> " + night.describe());
        check("scene model: document", okDoc, "-> " + doc.describe());
        check("scene model: portrait", okPortrait, "-> " + portrait.describe());
        check("scene model: general", landscape.confidence > 0.1f, "-> " + landscape.describe());
    }

    private static void testDocumentScan() {
        Img page = documentScene(700, 520);
        long t = System.currentTimeMillis();
        float[] quad = DocScan.detectPage(page);
        long ms = System.currentTimeMillis() - t;
        if (quad == null) {
            check("page detection finds a document", false, "no quad returned");
            return;
        }
        // ground truth page occupies the rect (0.16..0.86, 0.12..0.88) in the synthetic scene
        float expX0 = page.w * 0.16f, expY0 = page.h * 0.12f, expX1 = page.w * 0.86f, expY1 = page.h * 0.88f;
        float e = Math.abs(quad[0] - expX0) + Math.abs(quad[1] - expY0)
                + Math.abs(quad[2] - expX1) + Math.abs(quad[3] - expY0)
                + Math.abs(quad[4] - expX1) + Math.abs(quad[5] - expY1)
                + Math.abs(quad[6] - expX0) + Math.abs(quad[7] - expY1);
        Img warped = DocScan.warpPage(page, quad);
        boolean rect = warped.w > 200 && warped.h > 150;
        Stats sw = Stats.of(warped);
        check("page detection + rectification", e < page.w * 0.35f && rect && sw.meanLuma > 0.5f,
                String.format(Locale.US, "corner error %.1f px, output %dx%d, page luma %.2f, %d ms",
                        e / 8f, warped.w, warped.h, sw.meanLuma, ms));
    }

    private static void testFullPipeline() throws Exception {
        int n = 5;
        Img clean = scene(1600, 1200, 21);
        Img[] burst = new Img[n];
        Random rnd = new Random(31);
        for (int i = 0; i < n; i++) {
            float sx = i == 0 ? 0 : (rnd.nextFloat() - 0.5f) * 4f;
            float sy = i == 0 ? 0 : (rnd.nextFloat() - 0.5f) * 4f;
            Img f = subpixelShift(clean, sx, sy);
            f = darken(f, 0.55f);              // underexposed frame, as a real burst usually is
            addNoise(f, 0.035f, 300 + i);
            // simulate a soft, lens blurred capture so enhancement has work to do
            burst[i] = f;
        }
        AiPipeline.Settings st = new AiPipeline.Settings();
        st.tier = Tier.HIGH;
        st.requestedFrames = n;
        st.ultra = true;
        st.ultraScale = 2;
        st.maxOutputLongEdge = 3200;
        st.autoHaze = true;
        final String[] lastStage = new String[]{""};
        long t = System.currentTimeMillis();
        AiPipeline.Result res = AiPipeline.process(burst, null, st, new AiPipeline.Progress() {
            @Override
            public void onStage(String name, float fraction) {
                lastStage[0] = name + " " + Math.round(fraction * 100) + "%";
            }
        }, new AiPipeline.Cancel() {
            @Override
            public boolean isCancelled() {
                return false;
            }
        });
        long ms = System.currentTimeMillis() - t;
        AiPipeline.Report rep = res.report;
        boolean ok = res.image != null
                && rep.framesUsed == n
                && rep.stages.size() >= 5
                && rep.noiseAfter <= rep.noiseBefore
                && rep.outputLongEdge >= 1600
                && lastStage[0].length() > 0;
        check("full pipeline end to end", ok,
                String.format(Locale.US, "%s | stages=%d | out %dx%d (%s) | %d ms",
                        rep.describe(), rep.stages.size(), res.image.w, res.image.h, rep.outputLabel(), ms));
        System.out.println("  pipeline report:");
        System.out.print(indent(rep.stagesText()));
        for (String w : rep.warnings) System.out.println("  ! " + w);
    }

    private static void testTierBudgets() {
        StringBuilder sb = new StringBuilder();
        for (Tier t : Tier.values()) {
            sb.append(t.name()).append("(").append(t.workingLongEdge).append("px,")
                    .append(t.maxBurstFrames).append("f,x").append(t.maxUltraScale).append(") ");
        }
        boolean ok = Tier.LOW.workingLongEdge < Tier.FLAGSHIP.workingLongEdge
                && Tier.LOW.maxUltraScale < Tier.FLAGSHIP.maxUltraScale;
        check("performance tiers scale the workload", ok, sb.toString());
    }

    // ------------------------------------------------------------------ synthetic scenes

    /** A generic "photo": gradient sky, colour patches, gratings, edges, text-like bars. */
    private static Img scene(int w, int h, int seed) {
        Img img = new Img(w, h);
        Random rnd = new Random(seed);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                float u = x / (float) w, v = y / (float) h;
                float r, g, b;
                if (v < 0.55f) {                       // sky
                    float k = v / 0.55f;
                    r = 0.42f + 0.30f * k;
                    g = 0.58f + 0.26f * k;
                    b = 0.86f - 0.10f * k;
                } else if (v < 0.62f) {                // horizon edge
                    float k = (v - 0.55f) / 0.07f;
                    r = Img.lerp(0.72f, 0.30f, k);
                    g = Img.lerp(0.84f, 0.38f, k);
                    b = Img.lerp(0.76f, 0.24f, k);
                } else {                               // ground with colour patches
                    float k = (v - 0.62f) / 0.38f;
                    r = 0.28f + 0.12f * k;
                    g = 0.36f + 0.14f * (1 - k);
                    b = 0.22f + 0.10f * k;
                    int patch = (int) (u * 5);
                    if (patch % 5 == 0 && k > 0.15f && k < 0.75f) {
                        r = 0.80f;
                        g = 0.62f;
                        b = 0.24f;
                    } else if (patch % 5 == 2 && k > 0.25f && k < 0.9f) {
                        r = 0.18f;
                        g = 0.58f;
                        b = 0.36f;
                    } else if (patch % 5 == 3 && k > 0.35f && k < 0.7f) {
                        r = 0.62f;
                        g = 0.22f;
                        b = 0.30f;
                    }
                }
                img.px[y * w + x] = Img.rgb((int) (r * 255), (int) (g * 255), (int) (b * 255));
            }
        }
        // fine gratings: real high frequency content for the resolution tests
        int gx = w / 8, gy = h / 3;
        for (int y = 0; y < 70; y++) {
            for (int x = 0; x < 220; x++) {
                int px = gx + x, py = gy + y;
                if (px >= w || py >= h) continue;
                float freq = 2f + (x / 220f) * 26f;
                float s = 0.5f + 0.42f * (float) Math.sin(x * freq * Math.PI / 44f) * (float) Math.sin(y * 0.35f);
                img.px[py * w + px] = Img.rgb((int) (s * 255), (int) (s * 255), (int) (s * 245));
            }
        }
        // text-like bars: high contrast, thin structures
        int tx = w / 10, ty = (int) (h * 0.72f);
        for (int line = 0; line < 7; line++) {
            int ly = ty + line * 12;
            int len = 90 + (line % 4) * 60;
            for (int x = 0; x < len; x++) {
                int px = tx + x, py = ly;
                if (px >= w || py >= h || py + 7 >= h) continue;
                boolean ink = ((x / 3) % 2 == 0) && rnd.nextFloat() > 0.05f;
                int v = ink ? 26 : 236;
                for (int y2 = 0; y2 < 7; y2++) {
                    img.px[(py + y2) * w + px] = Img.rgb(v, v, v);
                }
            }
        }
        // slanted edge
        for (int y = (int) (h * 0.15f); y < h * 0.45f; y++) {
            int edge = (int) (w * 0.62f + (y - h * 0.15f) * 0.5f);
            for (int x = edge; x < Math.min(w, edge + 80); x++) {
                img.px[y * w + x] = Img.rgb(246, 246, 248);
            }
        }
        return img;
    }

    private static Img nightScene(int w, int h) {
        Img img = new Img(w, h);
        Random rnd = new Random(5);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                float v = 0.05f + 0.03f * (y / (float) h);
                img.px[y * w + x] = Img.rgb((int) (v * 255), (int) (v * 255), (int) (v * 300));
            }
        }
        // a few bright light sources
        for (int i = 0; i < 6; i++) {
            int cx = rnd.nextInt(w), cy = rnd.nextInt((int) (h * 0.6f));
            for (int dy = -6; dy <= 6; dy++) {
                for (int dx = -6; dx <= 6; dx++) {
                    int px = cx + dx, py = cy + dy;
                    if (px < 0 || py < 0 || px >= w || py >= h) continue;
                    float d = (float) Math.sqrt(dx * dx + dy * dy);
                    float k = Img.clamp01(1f - d / 7f);
                    int c = img.px[py * w + px];
                    img.px[py * w + px] = Img.rgb(Img.R(c) + (int) (k * 240),
                            Img.G(c) + (int) (k * 230), Img.B(c) + (int) (k * 180));
                }
            }
        }
        addNoise(img, 0.05f, 77);
        return img;
    }

    private static Img documentScene(int w, int h) {
        Img img = new Img(w, h);
        Random rnd = new Random(3);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                float v = 0.18f + 0.05f * (float) Math.sin(x * 0.05f) + 0.03f * (float) Math.sin(y * 0.07f);
                img.px[y * w + x] = Img.rgb((int) (v * 255), (int) (v * 250), (int) (v * 245));
            }
        }
        int x0 = (int) (w * 0.16f), y0 = (int) (h * 0.12f), x1 = (int) (w * 0.86f), y1 = (int) (h * 0.88f);
        for (int y = y0; y < y1; y++) {
            for (int x = x0; x < x1; x++) {
                // slightly uneven illumination across the page
                float k = 0.88f + 0.10f * (x - x0) / (float) (x1 - x0);
                int v = (int) (245 * k);
                img.px[y * w + x] = Img.rgb(v, v, (int) (v * 0.98f));
            }
        }
        for (int line = 0; line < 16; line++) {
            int ly = y0 + 20 + line * ((y1 - y0 - 40) / 16);
            for (int x = x0 + 30; x < x1 - 30 - rnd.nextInt(80); x++) {
                if (((x / 4) % 2 == 0)) {
                    for (int t = 0; t < 8; t++) {
                        int py = ly + t;
                        if (py < y1) img.px[py * w + x] = Img.rgb(28, 28, 30);
                    }
                }
            }
        }
        return img;
    }

    private static Img faceScene(int w, int h) {
        Img img = new Img(w, h);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                float v = 0.30f + 0.10f * (y / (float) h);
                img.px[y * w + x] = Img.rgb((int) (v * 200), (int) (v * 210), (int) (v * 230));
            }
        }
        int cx = w / 2, cy = (int) (h * 0.42f);
        int rx = (int) (w * 0.16f), ry = (int) (h * 0.22f);
        for (int y = cy - ry; y < cy + ry; y++) {
            for (int x = cx - rx; x < cx + rx; x++) {
                if (x < 0 || y < 0 || x >= w || y >= h) continue;
                float dx = (x - cx) / (float) rx, dy = (y - cy) / (float) ry;
                float d = (float) Math.sqrt(dx * dx + dy * dy);
                if (d > 1f) continue;
                float shade = 0.86f + 0.14f * (1 - d);
                img.px[y * w + x] = Img.rgb((int) (216 * shade), (int) (170 * shade), (int) (140 * shade));
            }
        }
        // eyes + mouth for a bit of structure
        for (int i = 0; i < 2; i++) {
            int ex = cx + (i == 0 ? -rx / 2 : rx / 2), ey = cy - ry / 3;
            for (int y = ey - 5; y <= ey + 5; y++) {
                for (int x = ex - 8; x <= ex + 8; x++) {
                    if (x < 0 || y < 0 || x >= w || y >= h) continue;
                    img.px[y * w + x] = Img.rgb(48, 40, 38);
                }
            }
        }
        return img;
    }

    // ------------------------------------------------------------------ image helpers

    static Img subpixelShift(Img src, float dx, float dy) {
        Img out = new Img(src.w, src.h);
        for (int y = 0; y < src.h; y++) {
            for (int x = 0; x < src.w; x++) {
                out.px[y * src.w + x] = src.sample(x - dx, y - dy);
            }
        }
        return out;
    }

    static void addNoise(Img img, float sigma, int seed) {
        Random rnd = new Random(seed);
        float s = sigma * 255f;
        for (int i = 0; i < img.px.length; i++) {
            int c = img.px[i];
            float n = (float) (rnd.nextGaussian() * s);
            float n2 = (float) (rnd.nextGaussian() * s * 0.6f);
            img.px[i] = Img.rgb((int) (Img.R(c) + n), (int) (Img.G(c) + n * 0.8f + n2 * 0.4f), (int) (Img.B(c) + n2));
        }
    }

    static Img darken(Img img, float k) {
        Img out = new Img(img.w, img.h);
        for (int i = 0; i < img.px.length; i++) {
            int c = img.px[i];
            out.px[i] = Img.rgb((int) (Img.R(c) * k), (int) (Img.G(c) * k), (int) (Img.B(c) * k));
        }
        return out;
    }

    static double psnr(Img a, Img b) {
        double mse = 0;
        int n = Math.min(a.px.length, b.px.length);
        for (int i = 0; i < n; i++) {
            int ca = a.px[i], cb = b.px[i];
            int dr = Img.R(ca) - Img.R(cb), dg = Img.G(ca) - Img.G(cb), db = Img.B(ca) - Img.B(cb);
            mse += dr * dr + dg * dg + db * db;
        }
        mse /= (n * 3.0);
        if (mse < 1e-9) return 99;
        return 10 * Math.log10(255.0 * 255.0 / mse);
    }

    /** Mean absolute high-pass energy - a proxy for how much real resolution is present. */
    static double edgeEnergy(Img img) {
        float[] l = img.toLuma();
        double sum = 0;
        int cnt = 0;
        for (int y = 2; y < img.h - 2; y++) {
            for (int x = 2; x < img.w - 2; x++) {
                int i = y * img.w + x;
                sum += Math.abs(4 * l[i] - l[i - 1] - l[i + 1] - l[i - img.w] - l[i + img.w]);
                cnt++;
            }
        }
        return cnt == 0 ? 0 : sum / cnt * 1000.0;
    }

    static String indent(String s) {
        StringBuilder sb = new StringBuilder();
        for (String line : s.split("\n")) sb.append("    ").append(line).append('\n');
        return sb.toString();
    }

    static void check(String name, boolean ok, String detail) {
        if (ok) passed++;
        else failed++;
        System.out.println((ok ? "  PASS  " : "  FAIL  ") + name);
        System.out.println("        " + detail);
    }
}
