package com.aivision.camera.ai.core;

/**
 * On-device scene model.
 *
 * <p>The classifier is a compact, fully transparent inference graph: 14 hand-measured image
 * features -> soft membership functions -> weighted evidence per scene class -> normalised
 * posterior. It is the piece that decides <em>how</em> the rest of the engine behaves (how much
 * shadow lifting, how aggressive the noise reduction, how much micro-contrast a landscape gets
 * versus a face). It runs in well under a millisecond, which is why the app can re-evaluate the
 * scene on every preview frame instead of only at capture time.
 */
public final class Scene {

    public enum Type {
        NIGHT("Night", "AI Night Mode"),
        LOW_LIGHT("Low light", "AI Low-Light Boost"),
        PORTRAIT("Portrait", "AI Portrait"),
        LANDSCAPE("Landscape", "AI Landscape"),
        FOOD("Food", "AI Food"),
        DOCUMENT("Document", "AI Document"),
        MACRO("Macro", "AI Macro"),
        BACKLIT("Backlit", "AI Backlit Rescue"),
        INDOOR("Indoor", "AI Indoor"),
        ACTION("Action", "AI Action"),
        SNOW_BRIGHT("Bright", "AI Bright Scene");

        public final String label;
        public final String aiLabel;

        Type(String label, String aiLabel) {
            this.label = label;
            this.aiLabel = aiLabel;
        }
    }

    public Type type = Type.INDOOR;
    public float confidence = 0.5f;
    public float[] evidence = new float[Type.values().length];
    public boolean textDetected;
    public boolean faceDetected;
    public boolean motionRisk;

    public String describe() {
        return type.aiLabel + " (" + Math.round(confidence * 100) + "%)";
    }

    /** All the knobs the enhancement stages read. 1.0 = neutral. */
    public static final class Profile {
        public String name = "Standard";
        public float exposureTarget = 0.46f;   // target median luma after auto exposure
        public float exposureGain = 1f;        // extra digital gain (clamped) to reach the target
        public float shadowLift = 0.10f;
        public float highlightCompress = 0.35f;
        public float contrast = 0.25f;         // final S-curve strength
        public float localContrast = 0.25f;    // clarity / structure-aware micro contrast
        public float detailAmount = 0.55f;     // unsharp amount (structure gated)
        public float detailRadius = 1.2f;
        public float denoise = 0.45f;          // luma+chroma NR strength
        public float chromaDenoise = 0.6f;
        public float saturation = 1.04f;
        public float vibrance = 0.22f;
        public float warmth = 0f;              // -1 cool .. +1 warm
        public float wbStrength = 0.55f;       // gray-world correction strength
        public float blackPoint = 0.004f;
        public float whitePoint = 0.996f;
        public float vignette = 0f;
        public float skinSmooth = 0f;
        public float textureBoost = 0f;        // for text/document/food
        public float realisticBias = 1f;       // 1 = strictly realistic output guard rails

        public Profile copy() {
            Profile p = new Profile();
            p.name = name;
            p.exposureTarget = exposureTarget;
            p.exposureGain = exposureGain;
            p.shadowLift = shadowLift;
            p.highlightCompress = highlightCompress;
            p.contrast = contrast;
            p.localContrast = localContrast;
            p.detailAmount = detailAmount;
            p.detailRadius = detailRadius;
            p.denoise = denoise;
            p.chromaDenoise = chromaDenoise;
            p.saturation = saturation;
            p.vibrance = vibrance;
            p.warmth = warmth;
            p.wbStrength = wbStrength;
            p.blackPoint = blackPoint;
            p.whitePoint = whitePoint;
            p.vignette = vignette;
            p.skinSmooth = skinSmooth;
            p.textureBoost = textureBoost;
            p.realisticBias = realisticBias;
            return p;
        }

        /** Scales every "amount" style knob, used by the quality tiers and by user strength presets. */
        public Profile scaled(float k) {
            Profile p = copy();
            p.shadowLift *= k;
            p.highlightCompress = Img.clamp(p.highlightCompress * (0.5f + 0.5f * k), 0f, 0.85f);
            p.contrast *= k;
            p.localContrast *= k;
            p.detailAmount *= k;
            p.vibrance *= k;
            p.saturation = 1f + (p.saturation - 1f) * k;
            p.vignette *= k;
            p.skinSmooth *= k;
            p.textureBoost *= k;
            return p;
        }
    }

    // ------------------------------------------------------------------ classifier

    private static float gauss(float x, float mu, float sigma) {
        float d = (x - mu) / sigma;
        return (float) Math.exp(-0.5 * d * d);
    }

    private static float up(float x, float edge, float soft) {
        return Img.smoothstep(edge - soft, edge + soft, x);
    }

    private static float down(float x, float edge, float soft) {
        return 1f - up(x, edge, soft);
    }

    public static Scene classify(Stats s) {
        Scene sc = new Scene();
        float[] e = sc.evidence;
        int i = 0;
        float dark = down(s.meanLuma, 0.16f, 0.05f);
        float veryDark = down(s.meanLuma, 0.085f, 0.035f);
        float bright = up(s.meanLuma, 0.62f, 0.08f);
        float highNoise = up(s.noiseSigma, 0.020f, 0.010f);
        float veryHighNoise = up(s.noiseSigma, 0.034f, 0.012f);
        float face = up(s.skinRatio, 0.020f, 0.012f);
        float bigFace = up(s.faceFill, 0.03f, 0.02f);
        float flat = down(s.textureEnergy, 0.030f, 0.012f);
        float textured = up(s.textureEnergy, 0.055f, 0.02f);
        float colorful = up(s.colorfulness, 0.22f, 0.08f);
        float saturated = up(s.saturation, 0.33f, 0.10f);
        float text = up(s.textScore, 0.42f, 0.12f);
        float greenish = up(s.textureEnergy, 0.09f, 0.03f) * down(s.colorfulness, 0.18f, 0.06f);
        float skinClose = up(s.skinRatio, 0.06f, 0.03f);
        float backlit = up(s.highlightClip, 0.02f, 0.01f) * down(s.medianLuma, 0.40f, 0.10f);
        float wide = up(s.dynamicRange, 0.62f, 0.12f) * up(s.textureEnergy, 0.05f, 0.02f);

        e[i++] = 0.30f + 1.6f * veryDark + 0.9f * dark + 0.6f * highNoise;                    // NIGHT
        e[i++] = 0.25f + 0.9f * dark + 0.7f * highNoise * (1f - veryDark) + 0.3f * flat;     // LOW_LIGHT
        e[i++] = 0.20f + 1.9f * skinClose + 1.5f * bigFace + 0.4f * (1f - textured);         // PORTRAIT
        e[i++] = 0.22f + 1.2f * wide + 0.9f * bright * textured + 0.5f * up(s.sharpness, 0.35f, 0.15f); // LANDSCAPE
        e[i++] = 0.10f + 1.1f * (1f - greenish) * saturated * up(s.meanLuma, 0.28f, 0.08f) * Img.clamp01(s.textureEnergy * 12f); // FOOD
        e[i++] = 0.08f + 2.2f * text * (1f - saturated * 0.5f);                              // DOCUMENT
        e[i++] = 0.10f + 0.9f * skinClose * up(s.sharpness, 0.45f, 0.2f) * (1f - bigFace);   // MACRO
        e[i++] = 0.12f + 1.8f * backlit;                                                     // BACKLIT
        e[i++] = 0.35f + 0.5f * (1f - dark) * (1f - bright) * (1f - skinClose);              // INDOOR
        e[i++] = 0.12f + 0.7f * up(s.sharpness, 0.5f, 0.2f) * (1f - dark);                   // ACTION
        e[i++] = 0.14f + 1.3f * bright * (1f - saturated * 0.5f) * up(s.meanLuma, 0.7f, 0.06f); // SNOW_BRIGHT

        int best = 0;
        float sum = 0;
        for (int k = 0; k < e.length; k++) {
            if (e[k] > e[best]) best = k;
            sum += Math.max(0, e[k]);
        }
        sc.type = Type.values()[best];
        sc.confidence = Img.clamp(sum > 0 ? e[best] / sum : 0.3f, 0.15f, 0.99f);
        sc.textDetected = text > 0.45f;
        sc.faceDetected = s.faceFill > 0.012f || s.skinRatio > 0.045f;
        sc.motionRisk = s.sharpness < 0.16f && s.meanLuma < 0.4f;
        return sc;
    }

    // ------------------------------------------------------------------ tuning per scene

    public static Profile profileFor(Scene scene, Stats s) {
        Profile p = new Profile();
        p.name = scene.type.label;
        switch (scene.type) {
            case NIGHT:
                p.exposureTarget = 0.30f;
                p.shadowLift = 0.30f;
                p.highlightCompress = 0.40f;
                p.contrast = 0.30f;
                p.localContrast = 0.34f;
                p.detailAmount = 0.48f;
                p.denoise = 0.85f;
                p.chromaDenoise = 0.92f;
                p.saturation = 1.05f;
                p.vibrance = 0.26f;
                p.warmth = 0.06f;
                p.blackPoint = 0.010f;
                p.vignette = 0.05f;
                break;
            case LOW_LIGHT:
                p.exposureTarget = 0.38f;
                p.shadowLift = 0.22f;
                p.detailAmount = 0.52f;
                p.denoise = 0.68f;
                p.chromaDenoise = 0.78f;
                p.vibrance = 0.24f;
                p.blackPoint = 0.007f;
                break;
            case PORTRAIT:
                p.exposureTarget = 0.47f;
                p.shadowLift = 0.16f;
                p.highlightCompress = 0.30f;
                p.contrast = 0.20f;
                p.localContrast = 0.16f;
                p.detailAmount = 0.34f;
                p.denoise = 0.35f;
                p.saturation = 1.02f;
                p.vibrance = 0.18f;
                p.skinSmooth = 0.45f;
                p.vignette = 0.08f;
                p.warmth = 0.05f;
                break;
            case LANDSCAPE:
                p.exposureTarget = 0.45f;
                p.shadowLift = 0.20f;
                p.highlightCompress = 0.45f;
                p.contrast = 0.34f;
                p.localContrast = 0.46f;
                p.detailAmount = 0.72f;
                p.detailRadius = 1.4f;
                p.denoise = 0.30f;
                p.saturation = 1.06f;
                p.vibrance = 0.34f;
                break;
            case FOOD:
                p.exposureTarget = 0.48f;
                p.shadowLift = 0.14f;
                p.contrast = 0.24f;
                p.localContrast = 0.40f;
                p.detailAmount = 0.60f;
                p.saturation = 1.06f;
                p.vibrance = 0.30f;
                p.warmth = 0.08f;
                p.textureBoost = 0.35f;
                break;
            case DOCUMENT:
                p.exposureTarget = 0.66f;
                p.shadowLift = 0.26f;
                p.highlightCompress = 0.55f;
                p.contrast = 0.36f;
                p.localContrast = 0.52f;
                p.detailAmount = 0.80f;
                p.detailRadius = 1.0f;
                p.denoise = 0.40f;
                p.chromaDenoise = 0.55f;
                p.saturation = 0.72f;
                p.vibrance = 0.05f;
                p.textureBoost = 0.75f;
                p.blackPoint = 0.012f;
                break;
            case MACRO:
                p.exposureTarget = 0.47f;
                p.detailAmount = 0.62f;
                p.localContrast = 0.30f;
                p.denoise = 0.42f;
                p.vibrance = 0.26f;
                p.textureBoost = 0.25f;
                break;
            case BACKLIT:
                p.exposureTarget = 0.40f;
                p.shadowLift = 0.34f;
                p.highlightCompress = 0.60f;
                p.contrast = 0.26f;
                p.localContrast = 0.36f;
                p.detailAmount = 0.50f;
                p.denoise = 0.45f;
                p.vibrance = 0.24f;
                break;
            case ACTION:
                p.exposureTarget = 0.46f;
                p.contrast = 0.28f;
                p.localContrast = 0.26f;
                p.detailAmount = 0.58f;
                p.denoise = 0.35f;
                p.vibrance = 0.22f;
                break;
            case SNOW_BRIGHT:
                p.exposureTarget = 0.62f;
                p.highlightCompress = 0.65f;
                p.shadowLift = 0.10f;
                p.contrast = 0.22f;
                p.saturation = 1.03f;
                p.vibrance = 0.16f;
                p.blackPoint = 0.006f;
                break;
            case INDOOR:
            default:
                p.exposureTarget = 0.46f;
                p.warmth = 0.02f;
                break;
        }
        // adaptive refinements: these make the profile track the actual frame, not just the class
        float noise = Img.clamp01((s.noiseSigma - 0.006f) * 26f);
        p.denoise = Img.clamp01(p.denoise + noise * 0.55f);
        p.chromaDenoise = Img.clamp01(p.chromaDenoise + noise * 0.45f);
        p.detailAmount = Img.clamp(p.detailAmount * (1f - noise * 0.45f), 0.12f, 0.95f);
        // underexposed frames need more lift, overexposed ones more roll-off
        if (s.medianLuma < 0.30f) p.shadowLift += (0.30f - s.medianLuma) * 0.8f;
        if (s.highlightClip > 0.03f) p.highlightCompress = Img.clamp01(p.highlightCompress + s.highlightClip * 2.2f);
        // a blurred frame cannot be sharpened into a sharp one: protect against sharpening artefacts
        if (s.sharpness < 0.12f) p.detailAmount *= 0.75f;
        return p;
    }
}
