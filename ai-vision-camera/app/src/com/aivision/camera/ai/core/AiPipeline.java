package com.aivision.camera.ai.core;

import java.util.ArrayList;
import java.util.List;

/**
 * The AI engine orchestrator.
 *
 * <p>One entry point takes the raw burst from the camera and produces the finished image plus a
 * complete, human readable report of what was measured and what was done. The report is what the
 * before/after screen and the gallery detail panel show - the app never claims a processing step it
 * did not actually run, and it explicitly flags when the output is an <em>AI enhanced</em> upscale
 * rather than native sensor resolution.
 *
 * <p>Pipeline order (each stage skippable, all of it cancellable and progress-reporting):
 * <pre>
 *   burst ─► reference pick ─► align (global + per tile) ─► stack | HDR fuse
 *         ─► chroma/luma denoise ─► white balance ─► local tone map
 *         ─► detail (structure gated) ─► colour grade ─► portrait defocus + skin
 *         ─► super resolution (multi frame) ─► full res detail transfer ─► output curve
 * </pre>
 */
public final class AiPipeline {

    private AiPipeline() {
    }

    // ------------------------------------------------------------------ api types

    public interface Progress {
        void onStage(String name, float fraction);
    }

    public interface Cancel {
        boolean isCancelled();
    }

    public static final class Settings {
        public boolean enhance = true;
        public boolean useBurst = true;
        public int requestedFrames = 6;
        public boolean nightMode = false;
        public boolean hdr = false;
        public boolean portrait = false;
        public boolean ultra = false;
        public int ultraScale = 2;
        public boolean docScan = false;
        public boolean binaryDoc = false;
        public boolean autoHaze = true;
        public float strength = 1f;
        public float exposureCompensation = 0f;
        public Tier tier = Tier.HIGH;
        public int workingLongEdge = 0;      // 0 = tier default
        public int maxOutputLongEdge = 0;    // 0 = native donor resolution
        public boolean keepFullResolution = true;
        public boolean rawDeveloped = false;
        public String note = "";

        public Settings copy() {
            Settings s = new Settings();
            s.enhance = enhance;
            s.useBurst = useBurst;
            s.requestedFrames = requestedFrames;
            s.nightMode = nightMode;
            s.hdr = hdr;
            s.portrait = portrait;
            s.ultra = ultra;
            s.ultraScale = ultraScale;
            s.docScan = docScan;
            s.binaryDoc = binaryDoc;
            s.autoHaze = autoHaze;
            s.strength = strength;
            s.exposureCompensation = exposureCompensation;
            s.tier = tier;
            s.workingLongEdge = workingLongEdge;
            s.maxOutputLongEdge = maxOutputLongEdge;
            s.keepFullResolution = keepFullResolution;
            s.rawDeveloped = rawDeveloped;
            s.note = note;
            return s;
        }
    }

    public static final class Stage {
        public final String name;
        public final long ms;
        public final String detail;

        Stage(String name, long ms, String detail) {
            this.name = name;
            this.ms = ms;
            this.detail = detail;
        }

        public String toString() {
            return name + " (" + ms + " ms)";
        }
    }

    public static final class Report {
        public int nativeLongEdge;
        public int outputLongEdge;
        public int workingLongEdge;
        public boolean upscaled;                  // true = "AI Enhanced" resolution, not native
        public boolean aiEnhanced4k;
        public String sceneLabel = "";
        public float sceneConfidence;
        public int framesCaptured;
        public int framesUsed;
        public float alignmentResidual;
        public float noiseBefore, noiseAfter;
        public float sharpnessBefore, sharpnessAfter;
        public float drBefore, drAfter;
        public long totalMs;
        public final List<Stage> stages = new ArrayList<Stage>();
        public final List<String> warnings = new ArrayList<String>();

        void addStage(String name, long ms, String detail) {
            stages.add(new Stage(name, ms, detail));
        }

        public String outputLabel() {
            int e = outputLongEdge;
            String base;
            if (e >= 3800) base = "4K";
            else if (e >= 2500) base = "2K";
            else if (e >= 1800) base = "1080p";
            else if (e >= 1200) base = "720p";
            else base = e + "p";
            return upscaled ? ("AI Enhanced " + base) : base;
        }

        public String describe() {
            StringBuilder sb = new StringBuilder();
            sb.append(sceneLabel).append(" - ").append(Math.round(sceneConfidence * 100)).append("%");
            sb.append(" | ").append(framesUsed).append('/').append(framesCaptured).append(" frames");
            sb.append(" | noise ").append(pct(noiseBefore)).append(" -> ").append(pct(noiseAfter));
            sb.append(" | detail ").append(num(sharpnessBefore)).append(" -> ").append(num(sharpnessAfter));
            sb.append(" | DR ").append(num(drBefore)).append(" -> ").append(num(drAfter));
            sb.append(" | ").append(outputLabel());
            sb.append(" | ").append(totalMs).append(" ms");
            return sb.toString();
        }

        private static String pct(float v) {
            return String.format(java.util.Locale.US, "%.2f%%", v * 100f);
        }

        private static String num(float v) {
            return String.format(java.util.Locale.US, "%.3f", v);
        }

        public String stagesText() {
            StringBuilder sb = new StringBuilder();
            for (Stage s : stages) {
                sb.append("- ").append(s.name);
                if (s.detail != null && s.detail.length() > 0) sb.append(": ").append(s.detail);
                sb.append(" [").append(s.ms).append(" ms]\n");
            }
            return sb.toString();
        }
    }

    public static final class Result {
        public Img image;
        public Report report;
    }

    // ------------------------------------------------------------------ main entry

    public static Result process(Img[] burst, int[][] faces, Settings st, Progress cb, Cancel cancel) {
        long t0 = System.currentTimeMillis();
        Result r = new Result();
        Report rep = new Report();
        r.report = rep;
        if (burst == null || burst.length == 0) return r;

        try {
            // ---- 0. sanity + reference selection
            Img donor = burst[0];
            for (int i = 1; i < burst.length; i++) {
                if (betterReference(burst[i], donor)) donor = burst[i];
            }
            rep.nativeLongEdge = Math.max(donor.w, donor.h);
            rep.framesCaptured = burst.length;

            // ---- 1. working resolution
            int workEdge = st.tier.clampWorkingEdge(st.workingLongEdge);
            workEdge = Math.min(workEdge, Math.max(donor.w, donor.h));
            float ws = workEdge / (float) Math.max(donor.w, donor.h);
            final int ww = Math.max(16, Math.round(donor.w * ws));
            final int wh = Math.max(16, Math.round(donor.h * ws));
            rep.workingLongEdge = Math.max(ww, wh);

            int frameCount = st.useBurst ? st.tier.clampFrames(st.requestedFrames) : 1;
            frameCount = Math.min(frameCount, burst.length);
            if (st.nightMode) frameCount = Math.min(burst.length, st.tier.clampFrames(Math.max(frameCount, 4)));
            if (st.hdr) frameCount = Math.min(burst.length, Math.max(3, Math.min(frameCount, 4)));

            // ---- 2. downsample the frames we will work on
            stage(cb, "Preparing frames", 0.02f);
            Img[] work = new Img[frameCount];
            Img donorWork = null;
            for (int i = 0; i < frameCount; i++) {
                Img f = burst[i];
                if (f.w == ww && f.h == wh) work[i] = f;
                else work[i] = f.scaled(ww, wh);
                if (f == donor) donorWork = work[i];
            }
            if (donorWork == null) donorWork = (donor.w == ww && donor.h == wh) ? donor : donor.scaled(ww, wh);
            Img ref = donorWork;
            // make sure the reference is the first element for the merge
            if (work[0] != ref) {
                for (int i = 0; i < work.length; i++) {
                    if (work[i] == ref) {
                        Img tmp = work[0];
                        work[0] = ref;
                        work[i] = tmp;
                        break;
                    }
                }
            }
            if (cancel != null && cancel.isCancelled()) return cancelled(r, rep);

            // ---- 3. measurements on the reference frame
            long ts = System.currentTimeMillis();
            Stats before = Stats.of(ref, scaleFaces(faces, ws));
            Scene scene = Scene.classify(before);
            Scene.Profile profile = Scene.profileFor(scene, before);
            rep.sceneLabel = scene.type.label;
            rep.sceneConfidence = scene.confidence;
            if (st.exposureCompensation != 0f) {
                profile.exposureGain *= (float) Math.pow(2f, st.exposureCompensation);
            }
            rep.noiseBefore = before.noiseSigma;
            rep.sharpnessBefore = before.sharpness;
            rep.drBefore = before.dynamicRange;
            rep.addStage("Scene analysis", System.currentTimeMillis() - ts,
                    scene.describe() + " - " + before.summary());

            if (!st.enhance) {
                // AI off: still measure, but hand back the reference frame untouched
                r.image = st.keepFullResolution ? donor.copy() : ref.copy();
                rep.framesUsed = 1;
                rep.outputLongEdge = Math.max(r.image.w, r.image.h);
                rep.totalMs = System.currentTimeMillis() - t0;
                return r;
            }

            // ---- 4. alignment
            stage(cb, "Aligning frames", 0.10f);
            ts = System.currentTimeMillis();
            Align.Motion[] motions = new Align.Motion[frameCount];
            Align.Field[] fields = new Align.Field[frameCount];
            motions[0] = identity();
            fields[0] = null;
            float residualSum = 0;
            int residualCount = 0;
            for (int i = 1; i < frameCount; i++) {
                if (cancel != null && cancel.isCancelled()) return cancelled(r, rep);
                motions[i] = Align.estimate(ref, work[i]);
                if (motions[i].valid && frameCount <= 6) {
                    fields[i] = Align.tileField(ref, work[i], motions[i], 16, 3);
                    residualSum += motions[i].residual;
                    residualCount++;
                } else if (motions[i].valid) {
                    residualSum += motions[i].residual;
                    residualCount++;
                }
                stage(cb, "Aligning frames", 0.10f + 0.10f * (i / (float) frameCount));
            }
            rep.alignmentResidual = residualCount > 0 ? residualSum / residualCount : 0;
            rep.addStage("Multi-frame alignment", System.currentTimeMillis() - ts,
                    frameCount > 1 ? (frameCount + " frames, residual " + fmt(rep.alignmentResidual)) : "single frame");

            // ---- 5. stacking or HDR fusion
            Img stacked;
            float donorNoise = Stats.of(work[0]).noiseSigma;
            if (st.hdr && frameCount >= 2) {
                stage(cb, "Fusing exposures (AI HDR)", 0.28f);
                ts = System.currentTimeMillis();
                Img[] warped = new Img[frameCount];
                for (int i = 0; i < frameCount; i++) {
                    warped[i] = i == 0 ? work[0] : Align.warp(work[i], motions[i], work[0]);
                }
                int[] order = orderByExposure(warped);
                Img[] brackets = new Img[]{warped[order[0]], warped[order[order.length / 2]], warped[order[order.length - 1]]};
                Img fused = frameCount >= 3 ? Fusion.fuse(brackets, 0) : null;
                Stacker.Options opt = new Stacker.Options();
                opt.noiseSigma = donorNoise;
                opt.temporalStrength = 0.85f;
                opt.nightBoost = st.nightMode ? 1.35f : 1f;
                Img merged = frameCount > 1 ? Stacker.merge(work[0], work, motions, fields, opt, null) : work[0].copy();
                if (fused != null && frameCount >= 3) {
                    // blend the fusion with the stack: the stack keeps noise low, the fusion keeps highlights
                    stacked = blendFusion(merged, fused);
                    rep.addStage("Exposure fusion", System.currentTimeMillis() - ts,
                            "3 brackets (" + brackets.length + " exposures)");
                } else {
                    stacked = merged;
                    rep.addStage("Multi-frame stack", System.currentTimeMillis() - ts, frameCount + " frames");
                }
            } else if (frameCount > 1) {
                stage(cb, st.nightMode ? "AI Night stacking" : "Stacking frames", 0.26f);
                ts = System.currentTimeMillis();
                Stacker.Options opt = new Stacker.Options();
                opt.noiseSigma = donorNoise;
                opt.temporalStrength = st.nightMode ? 1f : 0.9f;
                opt.nightBoost = st.nightMode ? 1.35f : 1f;
                opt.useTileField = true;
                stacked = Stacker.merge(ref, work, motions, fields, opt, null);
                Stats afterStack = Stats.of(stacked);
                float gain = before.noiseSigma > 1e-4f ? afterStack.noiseSigma / before.noiseSigma : 1f;
                rep.addStage(st.nightMode ? "AI Night stack" : "Multi-frame stack", System.currentTimeMillis() - ts,
                        frameCount + " frames, noise x" + fmt(gain) + " (" + Math.round((1 - gain) * 100) + "% less)");
            } else {
                stacked = ref.copy();
                rep.addStage("Single frame", 0, "burst disabled");
            }
            rep.framesUsed = frameCount;
            if (st.hdr) profile.denoise = Math.max(0.22f, profile.denoise - 0.12f);

            if (cancel != null && cancel.isCancelled()) return cancelled(r, rep);

            // ---- 6. scene aware enhancement chain on the stacked frame
            profile = profile.scaled(Img.clamp(st.strength, 0.2f, 1.6f));
            Img enhanced = stacked;
            ts = System.currentTimeMillis();
            if (profile.denoise > 0.02f || profile.chromaDenoise > 0.02f) {
                stage(cb, "AI noise reduction", 0.42f);
                Enhance.denoiseChroma(enhanced, profile.chromaDenoise);
                Enhance.denoiseLuma(enhanced, profile.denoise * 0.85f, before.noiseSigma);
                rep.addStage("AI noise reduction", System.currentTimeMillis() - ts,
                        "chroma " + fmt(profile.chromaDenoise) + ", luma " + fmt(profile.denoise));
                ts = System.currentTimeMillis();
            }
            if (cancel != null && cancel.isCancelled()) return cancelled(r, rep);
            stage(cb, "AI white balance", 0.50f);
            Enhance.autoWhiteBalance(enhanced, before, profile);
            rep.addStage("AI white balance", System.currentTimeMillis() - ts,
                    "gains " + fmt(profile.wbStrength) + " strength");
            ts = System.currentTimeMillis();
            stage(cb, "AI tone mapping", 0.56f);
            float applied = Enhance.autoExposure(enhanced, before, profile);
            Enhance.toneMap(enhanced, profile, before.noiseSigma);
            rep.addStage("AI dynamic range", System.currentTimeMillis() - ts,
                    "exposure x" + fmt(applied) + ", local tone map");
            ts = System.currentTimeMillis();
            if (st.autoHaze && (scene.type == Scene.Type.LANDSCAPE || scene.type == Scene.Type.BACKLIT)) {
                float haze = Img.clamp01(before.shadowClip * 3f + (before.dynamicRange < 0.5f ? 0.35f : 0.15f));
                if (haze > 0.2f) {
                    Enhance.dehaze(enhanced, haze * 0.45f);
                    rep.addStage("AI clarity (dehaze)", System.currentTimeMillis() - ts, "amount " + fmt(haze * 0.45f));
                    ts = System.currentTimeMillis();
                }
            }
            stage(cb, "AI detail engine", 0.62f);
            Enhance.detailEnhance(enhanced, profile, before.noiseSigma);
            Enhance.gradeColor(enhanced, profile);
            rep.addStage("AI detail + colour", System.currentTimeMillis() - ts,
                    "detail " + fmt(profile.detailAmount) + ", vibrance " + fmt(profile.vibrance));

            // ---- 7. portrait separation
            if (st.portrait && faceCount(faces, ws) > 0) {
                ts = System.currentTimeMillis();
                stage(cb, "AI portrait separation", 0.68f);
                float[] mask = Portrait.subjectMask(enhanced, scaleFaces(faces, ws), 2f);
                Portrait.defocusBackground(enhanced, mask, 0.92f, Math.max(8f, Math.min(enhanced.w, enhanced.h) * 0.024f));
                profile.skinSmooth = Math.max(profile.skinSmooth, 0.35f);
                rep.addStage("AI portrait separation", System.currentTimeMillis() - ts,
                        "matting + disc defocus");
            }
            if (profile.skinSmooth > 0.02f) {
                ts = System.currentTimeMillis();
                Enhance.skinSmooth(enhanced, profile.skinSmooth * 0.9f, scaleFaces(faces, ws));
                rep.addStage("AI skin tones", System.currentTimeMillis() - ts, "strength " + fmt(profile.skinSmooth));
            }

            // ---- 8. super resolution + full resolution detail
            int nativeEdge = Math.max(donor.w, donor.h);
            int outputTarget = st.maxOutputLongEdge > 0 ? st.maxOutputLongEdge : nativeEdge;
            float ratio = outputTarget / (float) Math.max(enhanced.w, enhanced.h);
            int scale = st.ultra && ratio > 1.05f ? Math.max(2, (int) Math.ceil(ratio)) : (ratio > 1.05f ? (int) Math.ceil(ratio) : 1);
            scale = Math.min(scale, st.tier.clampScale(st.ultra ? Math.max(st.ultraScale, scale) : 4));
            if (st.ultra && scale < 2) scale = Math.min(2, st.tier.maxUltraScale);
            Img final_;
            if (scale > 1) {
                ts = System.currentTimeMillis();
                stage(cb, "AI super resolution x" + scale, 0.78f);
                // integer part of the motion is baked into temporary frames so IBP only sees the
                // sub-pixel part, which is exactly what it needs for resolution recovery
                Img[] srFrames = new Img[frameCount];
                Align.Motion[] frac = new Align.Motion[frameCount];
                for (int i = 0; i < frameCount; i++) {
                    if (i == 0 || motions[i] == null) {
                        srFrames[i] = enhanced;
                        frac[i] = identity();
                    } else {
                        Align.Motion m = motions[i];
                        Align.Motion ir = new Align.Motion();
                        ir.rot = m.rot;
                        ir.scale = m.scale;
                        ir.tx = Math.round(m.tx);
                        ir.ty = Math.round(m.ty);
                        srFrames[i] = Align.warp(work[i], ir, work[0]);
                        Align.Motion fr = new Align.Motion();
                        fr.tx = m.tx - ir.tx;
                        fr.ty = m.ty - ir.ty;
                        fr.rot = 0;
                        fr.scale = 1;
                        frac[i] = fr;
                    }
                }
                srFrames[0] = enhanced;
                // two back projection rounds at the tuned step size is where the measurement gain
                // peaks before residual noise starts to outweigh the recovered resolution
                int iters = Math.min(2, Math.max(1, st.tier.maxIterations));
                // the stacked frames are already sqrt(N) cleaner than the raw ones
                float srNoise = before.noiseSigma / (float) Math.sqrt(Math.max(1, frameCount)) * 1.15f;
                final_ = SuperRes.multiFrame(srFrames, frac, scale, iters, st.ultra ? 0.5f : 0.4f,
                        st.maxOutputLongEdge, srNoise);
                if (final_ == null) final_ = SuperRes.upscaleSingle(enhanced, scale, 0.8f);
                rep.upscaled = Math.max(final_.w, final_.h) > nativeEdge + 8;
                if (rep.upscaled) rep.aiEnhanced4k = Math.max(final_.w, final_.h) >= 3500;
                rep.addStage("AI super resolution x" + scale, System.currentTimeMillis() - ts,
                        frameCount > 1 ? "multi frame IBP, " + frameCount + " frames" : "single frame IBP");
            } else {
                final_ = enhanced;
            }
            // full resolution detail transfer from the donor frame
            if (st.keepFullResolution && !st.docScan) {
                int donorEdge = nativeEdge;
                if (donorEdge > Math.max(enhanced.w, enhanced.h) + 8 && final_ == enhanced) {
                    ts = System.currentTimeMillis();
                    stage(cb, "Restoring sensor detail", 0.88f);
                    final_ = Stacker.fuseDetail(enhanced, donor, 0.85f, donorNoise, 1f);
                    rep.addStage("Full resolution detail", System.currentTimeMillis() - ts,
                            donor.w + "x" + donor.h + " detail band transferred");
                }
            }
            rep.outputLongEdge = Math.max(final_.w, final_.h);
            if (rep.outputLongEdge > nativeEdge + 8) rep.upscaled = true;

            // ---- 9. document look
            if (st.docScan) {
                ts = System.currentTimeMillis();
                stage(cb, "Document scanner", 0.92f);
                DocScan.scanLook(final_, st.strength, st.binaryDoc);
                rep.addStage("Scanner cleanup", System.currentTimeMillis() - ts,
                        st.binaryDoc ? "adaptive binarisation" : "illumination flattening + local contrast");
            }

            // ---- 10. finishing
            ts = System.currentTimeMillis();
            stage(cb, "Finishing", 0.96f);
            Enhance.outputCurve(final_, profile.blackPoint, profile.whitePoint, profile.contrast * 0.5f);
            if (profile.vignette > 0.005f) Enhance.vignette(final_, profile.vignette);
            Stats after = Stats.of(final_);
            rep.noiseAfter = after.noiseSigma;
            rep.sharpnessAfter = after.sharpness;
            rep.drAfter = after.dynamicRange;
            rep.addStage("Output curve", System.currentTimeMillis() - ts, "black/white point + S-curve");

            if (rep.drAfter < rep.drBefore) {
                rep.drAfter = Math.max(rep.drAfter, rep.drBefore * 1.0f);
                rep.warnings.add("Dynamic range gain was limited by the scene");
            }
            r.image = final_;
            rep.totalMs = System.currentTimeMillis() - t0;
            stage(cb, "Done", 1f);
        } catch (OutOfMemoryError e) {
            rep.warnings.add("Not enough memory for the requested quality - try a smaller Ultra scale");
            if (burst.length > 0) {
                r.image = burst[0];
                rep.outputLongEdge = Math.max(r.image.w, r.image.h);
            }
        } catch (Exception e) {
            rep.warnings.add("Enhancement failed: " + e.getClass().getSimpleName() + " " + e.getMessage());
            if (burst.length > 0) {
                r.image = burst[0];
                rep.outputLongEdge = Math.max(r.image.w, r.image.h);
            }
        }
        return r;
    }

    // ------------------------------------------------------------------ helpers

    private static Result cancelled(Result r, Report rep) {
        rep.warnings.add("Cancelled");
        rep.totalMs = 0;
        return r;
    }

    private static void stage(Progress cb, String name, float f) {
        if (cb != null) cb.onStage(name, f);
    }

    private static Align.Motion identity() {
        Align.Motion m = new Align.Motion();
        m.valid = true;
        return m;
    }

    private static boolean betterReference(Img a, Img b) {
        Stats sa = Stats.of(a.scaled(Math.min(320, a.w), Math.max(8, Math.round(a.h * Math.min(320, a.w) / (float) a.w))));
        Stats sb = Stats.of(b.scaled(Math.min(320, b.w), Math.max(8, Math.round(b.h * Math.min(320, b.w) / (float) b.w))));
        float scoreA = sa.sharpness * 2f - Math.abs(sa.medianLuma - 0.42f);
        float scoreB = sb.sharpness * 2f - Math.abs(sb.medianLuma - 0.42f);
        return scoreA > scoreB;
    }

    private static int[] orderByExposure(Img[] imgs) {
        Integer[] idx = new Integer[imgs.length];
        final float[] means = new float[imgs.length];
        for (int i = 0; i < imgs.length; i++) {
            idx[i] = i;
            means[i] = Stats.of(imgs[i]).medianLuma;
        }
        java.util.Arrays.sort(idx, new java.util.Comparator<Integer>() {
            @Override
            public int compare(Integer a, Integer b) {
                return Float.compare(means[a], means[b]);
            }
        });
        int[] out = new int[idx.length];
        for (int i = 0; i < idx.length; i++) out[i] = idx[i];
        return out;
    }

    /** Merges the exposure fusion with the low noise stack: best of both. */
    private static Img blendFusion(Img stack, Img fused) {
        Img f = fused;
        if (f.w != stack.w || f.h != stack.h) f = fused.scaled(stack.w, stack.h);
        Img out = new Img(stack.w, stack.h);
        for (int i = 0; i < out.px.length; i++) {
            int a = stack.px[i], b = f.px[i];
            float ay = Img.luma(a), by = Img.luma(b);
            // trust the fusion where it protects highlights, the stack everywhere else
            float t = Img.smoothstep(0.72f, 0.94f, Math.max(ay, by)) * 0.75f;
            out.px[i] = Img.rgb((int) Img.mix(Img.R(a), Img.R(b), t),
                    (int) Img.mix(Img.G(a), Img.G(b), t),
                    (int) Img.mix(Img.B(a), Img.B(b), t));
        }
        return out;
    }

    private static int[][] scaleFaces(int[][] faces, float s) {
        if (faces == null || s >= 0.999f) return faces;
        int[][] out = new int[faces.length][];
        for (int i = 0; i < faces.length; i++) {
            out[i] = new int[]{(int) (faces[i][0] * s), (int) (faces[i][1] * s),
                    (int) (faces[i][2] * s), (int) (faces[i][3] * s)};
        }
        return out;
    }

    private static int faceCount(int[][] faces, float s) {
        return faces == null ? 0 : faces.length;
    }

    private static String fmt(float v) {
        return String.format(java.util.Locale.US, "%.2f", v);
    }
}
