package com.aivision.camera.ai

import android.graphics.Bitmap
import android.graphics.Rect
import com.aivision.camera.core.DeviceReport
import com.aivision.camera.core.L
import com.aivision.camera.core.M
import com.aivision.camera.core.QualityPolicy
import com.aivision.camera.core.Work
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** What the AI produced, plus everything the UI wants to tell the user about it. */
data class AiResult(
    val planes: Planes?,
    val headline: String,
    val details: List<String>,
    val framesUsed: Int,
    val upscale: Float,
    val nativeResolution: Boolean,
    val label: String,
    val aiApplied: Boolean,
    val before: Bitmap? = null,
    val after: Bitmap? = null,
)

/**
 * The AI brain.
 *
 * Decides how many frames to shoot, whether to bracket, how hard to denoise,
 * when to super-resolve and how to grade - then runs the whole pipeline on
 * device so nothing ever leaves the phone.
 *
 * Everything is bounded by the [QualityPolicy] derived from the actual hardware,
 * which is what keeps a 4 GB entry phone and a 16 GB flagship both smooth.
 */
class AiEngine(
    private val policy: QualityPolicy,
    private val report: DeviceReport,
) {
    val analyzer = SceneAnalyzer()

    var lastScene: SceneReport? = null
        private set

    var aiEnhance = true
    var aiUltra = false
    var nightMode = false
    var portraitMode = false
    var documentMode = false
    var autoZoomAi = true

    interface Progress { fun onProgress(stage: String, fraction: Float) }
    private var progress: Progress? = null
    fun setProgressListener(p: Progress?) { progress = p }

    private fun progress(stage: String, fraction: Float) {
        progress?.onProgress(stage, fraction)
    }

    // ------------------------------------------------------------- live scene
    fun analysePreview(luma: ByteArray, width: Int, height: Int, rowStride: Int,
                       faces: List<Rect>, zoom: Float, motionHint: Float = 0f): SceneReport? {
        val sr = if (aiUltra) policy.ultraUpscaleFactor else if (aiEnhance) 1.5f else 1f
        val report = analyzer.analyse(
            luma, width, height, rowStride, faces, zoom,
            aiEnabled = aiEnhance || aiUltra,
            nightForced = nightMode,
            superResRequested = sr,
            motionHint = motionHint,
        )
        lastScene = report
        return report
    }

    /**
     * How many frames / which exposure ladder to capture for the current mode.
     * Real decisions: night mode wants long+clean, HDR wants a bracket, action
     * wants a single frame.
     */
    fun planCapture(zoom: Float, scene: SceneReport?, isAction: Boolean = false): CapturePlan {
        val base = scene?.profile ?: EnhanceProfile.neutral()
        var frames = when {
            nightMode -> policy.nightFrames
            aiUltra -> max(3, policy.burstFrames / 2)
            aiEnhance -> min(policy.burstFrames, max(3, base.multiFrameFrames))
            else -> 1
        }
        if (isAction) frames = min(frames, 2)
        if (zoom > 6f) frames = min(frames, max(3, policy.burstFrames - 2))

        val bracket = nightMode || (base.hdrFuse && frames >= 3)
        val evs = if (!bracket || frames < 3) emptyList() else {
            val steps = min(policy.hdrBrackets, frames)
            buildEvLadder(steps)
        }
        // Night: manual exposure when the sensor can hold it, else AE + stacking
        val nightIso = if (nightMode) M.clamp(800, 100, 6400) else 0
        val nightExposure = if (nightMode) 120_000_000L else 0L   // 1/8 s, clamped later

        return CapturePlan(
            frames = frames,
            evLadder = evs,
            manualIso = nightIso,
            manualExposureNs = nightExposure,
            useHardwareZsl = !nightMode && !bracket,
            wantDepth = portraitMode,
            wantRaw = false,
            wantHdrFusion = base.hdrFuse || nightMode,
        )
    }

    private fun buildEvLadder(steps: Int): List<Int> = when {
        steps <= 1 -> emptyList()
        steps == 2 -> listOf(0, -2)
        steps == 3 -> listOf(0, -2, 2)
        steps == 4 -> listOf(0, -2, 2, -4)
        else -> listOf(0, -2, 2, -4, 4).take(steps)
    }

    /**
     * Run the full enhancement pipeline over the captured frames.
     * Called on a background thread; reports progress to the UI.
     */
    fun processCapture(
        frames: List<Planes>,
        shifts: List<Shift>,
        evs: List<Int>,
        depth: DepthMap?,
        faceRegions: List<Region>,
        zoom: Float,
        wantUltra: Boolean,
        wantEnhance: Boolean,
        wantPortrait: Boolean,
        wantDocument: Boolean,
        nativeLongEdge: Int,
    ): AiResult {
        if (frames.isEmpty()) return AiResult(null, "Capture failed", emptyList(), 0, 1f, false, "", false)
        val notes = ArrayList<String>()
        val scene = lastScene
        var profile = scene?.profile ?: EnhanceProfile.neutral()
        if (wantDocument) profile = profile.copy(documentMode = true, textEnhance = true)
        val enhance = wantEnhance || wantUltra

        val before = frames[0].toBitmap(1080)

        // ---- 1. merge frames ------------------------------------------------
        progress("AI multi-frame fusion", 0.1f)
        var working: Planes
        var framesUsed = 1
        if (frames.size > 1 && (enhance || evs.isNotEmpty())) {
            working = if (evs.isNotEmpty() && (profile.hdrFuse || evs.any { it != 0 })) {
                val brackets = frames.mapIndexed { i, p -> HdrFusion.Bracket(p, (evs.getOrNull(i) ?: 0).toFloat()) }
                HdrFusion.fuse(brackets) ?: frames[0]
            } else {
                val acc = MultiFrameAccumulator(frames[0].w, frames[0].h, frames.size)
                for ((i, frame) in frames.withIndex()) {
                    if (frame.w != frames[0].w || frame.h != frames[0].h) continue
                    val shift = shifts.getOrNull(i) ?: Shift.ZERO
                    acc.add(frame, shift)
                }
                framesUsed = acc.mergedFrames
                acc.finish()
            }
            if (evs.isNotEmpty()) notes += "HDR fusion (${frames.size} exposures)"
            else notes += "Multi-frame stack (${max(framesUsed, frames.size)} frames, √N noise cut)"
        } else {
            working = frames[0]
        }

        if (!enhance) {
            val after = working.toBitmap(1080)
            return AiResult(working, "Original", notes, framesUsed, 1f, true,
                "Native ${working.w}×${working.h}", false, before, after)
        }

        // ---- 2. scene aware restore -----------------------------------------
        progress("AI noise reduction", 0.3f)
        val stats = Imaging.stats(working)
        val noiseGate = M.clamp(stats.meanNoise / 0.045f, 0.4f, 2f)

        // luma: edge preserving, strength from the measured noise
        val denoiseStrength = profile.denoiseLuma * M.clamp(noiseGate, 0.5f, 1.6f)
        if (denoiseStrength > 0.05f) {
            val radius = if (denoiseStrength > 0.6f) 2 else 1
            val smoothed = Imaging.edgePreservingSmooth(working.y, working.w, working.h, radius,
                0.02f + denoiseStrength * 0.05f)
            val keep = M.clamp(1f - denoiseStrength, 0.05f, 1f)
            for (i in working.y.indices) working.y[i] = M.lerp(smoothed[i], working.y[i], keep)
        }
        Imaging.denoiseChroma(working.u, working.v, working.cw, working.ch, profile.denoiseChroma)

        progress("AI detail enhancement", 0.5f)
        // ---- 3. detail: fine + mid + clarity, noise gated -------------------
        var luma = working.y
        luma = Imaging.unsharp(luma, working.w, working.h, 1.0f, profile.sharpenFine, 0.0035f, 0.2f)
        luma = Imaging.unsharp(luma, working.w, working.h, 2.0f, profile.sharpenMid, 0.005f, 0.16f)
        luma = Imaging.localContrast(luma, working.w, working.h, max(8f, working.w / 90f), profile.clarity)
        working.y = luma

        // ---- 4. tone + colour ------------------------------------------------
        progress("AI tone mapping", 0.62f)
        Imaging.toneCurve(working.y, profile.toneStrength, profile.shadowLift,
            profile.highlightRoll, profile.contrast)
        Imaging.autoWhiteBalance(working.u, working.v, profile.whiteBalanceStrength)
        Imaging.vibrance(working.u, working.v, profile.vibrance)
        Imaging.saturation(working.u, working.v, profile.saturation)

        // ---- 5. faces + text -------------------------------------------------
        if (profile.faceEnhance && faceRegions.isNotEmpty()) {
            progress("AI portrait refinement", 0.7f)
            val smooth = M.clamp(0.35f * (1f - M.clamp(stats.meanNoise * 12f, 0f, 0.6f)), 0.1f, 0.4f)
            Imaging.smoothRegions(working, faceRegions, smooth, 3)
            notes += "Face enhancement (${faceRegions.size} face${if (faceRegions.size > 1) "s" else ""})"
        }
        if (profile.textEnhance) {
            val textRegions = detectTextRegions(working)
            if (textRegions.isNotEmpty()) {
                Imaging.enhanceRegions(working, textRegions, 0.55f, 0.18f)
                notes += "Text enhancement (${textRegions.size} region${if (textRegions.size > 1) "s" else ""})"
            }
        }

        // ---- 6. portrait separation -----------------------------------------
        if ((wantPortrait || profile.portraitBokeh) && !profile.documentMode) {
            progress("AI background separation", 0.78f)
            val mask = if (depth != null) {
                val dm = Portrait.maskFromDepth(depth, working.w, working.h)
                Portrait.refine(dm, working, 5)
            } else {
                Portrait.refine(Portrait.maskFromFaces(faceRegions, working.w, working.h), working, 6)
            }
            val bokeh = if (depth != null) 0.85f else 0.6f
            val separated = Portrait.applyBokeh(working, mask, bokeh)
            working = separated
            notes += if (depth != null) "Depth-based portrait bokeh"
            else "AI portrait separation (face-guided)"
        }

        // ---- 7. document clean-up -------------------------------------------
        if (wantDocument || profile.documentMode) {
            progress("AI document cleanup", 0.8f)
            Scanner.enhance(working, grayscale = false, highContrast = profile.contrast > 0.25f)
            notes += "Document cleanup"
        }

        // ---- 8. super resolution --------------------------------------------
        var upscale = 1f
        var native = true
        var label = SuperResolution.nativeLabel(working.w, working.h, true)
        val longEdge = max(working.w, working.h)
        if (wantUltra || (enhance && longEdge < 3840)) {
            progress("AI super resolution", 0.88f)
            val target = when {
                wantUltra -> min(policy.upscaleCapLongEdge,
                    (longEdge * policy.ultraUpscaleFactor).roundToInt())
                else -> min(3840, policy.upscaleCapLongEdge)
            }
            if (target > longEdge * 1.02f) {
                val support = if (frames.size > 1) frames.drop(1).zip(shifts.drop(1))
                    .filter { it.first.w == working.w } else emptyList()
                val quality = if (wantUltra) SrQuality.ULTRA else SrQuality.STANDARD
                val sr = SuperResolution.upscale(working, target, quality, support)
                working = sr.planes
                upscale = sr.factor
                native = false
                label = sr.label
                if (wantUltra) notes += "AI Ultra Resolution ${"%.1f".format(sr.factor)}× (${working.w}×${working.h})"
                else notes += "AI Super Resolution → 4K (${working.w}×${working.h})"
            }
        }

        // ---- 9. realism guard: keep the result believable --------------------
        // Hard limits on how far the AI may push contrast/saturation so photos
        // never look like a filter was sprayed over them.
        enforceRealism(working, frames[0])

        progress("AI finishing", 0.98f)
        val after = working.toBitmap(1080)
        val headline = when {
            wantUltra -> "AI ULTRA"
            !native -> "AI Enhanced 4K"
            else -> "AI ENHANCE"
        }
        return AiResult(
            planes = working, headline = headline, details = notes,
            framesUsed = max(frames.size, framesUsed), upscale = upscale,
            nativeResolution = native, label = label, aiApplied = true,
            before = before, after = after,
        )
    }

    /**
     * Keep the processed frame close to the capture: limits the mean luma and
     * chroma shift, so "AI enhanced" never becomes "AI invented".
     */
    private fun enforceRealism(processed: Planes, original: Planes) {
        if (processed.w != original.w || processed.h != original.h) return
        var sumBefore = 0f
        var sumAfter = 0f
        for (i in processed.y.indices) {
            sumBefore += original.y[i]
            sumAfter += processed.y[i]
        }
        val meanBefore = sumBefore / processed.y.size
        val meanAfter = sumAfter / processed.y.size
        val drift = meanAfter - meanBefore
        // allow at most ±9% brightness change from the RAW capture
        if (kotlin.math.abs(drift) > 0.09f) {
            val targetShift = if (drift > 0) 0.09f else -0.09f
            val delta = targetShift - drift
            for (i in processed.y.indices) processed.y[i] = M.clamp(processed.y[i] + delta * 0.5f, 0f, 1f)
            L.d("realism guard: luma drift ${"%.3f".format(drift)} -> ${"%.3f".format(targetShift)}")
        }
        var chroma = 0f
        for (i in processed.u.indices) chroma += kotlin.math.abs(processed.u[i]) + kotlin.math.abs(processed.v[i])
        chroma /= (processed.u.size * 2f)
        if (chroma > 0.16f) {
            val scale = 0.16f / chroma
            Imaging.saturation(processed.u, processed.v,
                kotlin.math.max(scale, 0.75f))
            L.d("realism guard: chroma ${"%.3f".format(chroma)} clamped")
        }
    }

    /**
     * Text region finder: row/column projection of edge energy. Text blocks show
     * up as dense, regular edge clusters - which is what we then sharpen.
     */
    fun detectTextRegions(p: Planes, maxRegions: Int = 4): List<Region> {
        val step = max(1, p.w / 480)
        val w = p.w / step
        val h = p.h / step
        if (w < 16 || h < 16) return emptyList()
        val edge = FloatArray(w * h)
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = (y * step) * p.w + x * step
                val gx = p.y[i + 1] - p.y[i - 1]
                val gy = p.y[i + p.w] - p.y[i - p.w]
                edge[y * w + x] = kotlin.math.abs(gx) + kotlin.math.abs(gy)
            }
        }
        val rowEnergy = FloatArray(h)
        for (y in 0 until h) {
            var s = 0f
            for (x in 0 until w) s += edge[y * w + x]
            rowEnergy[y] = s
        }
        val mean = rowEnergy.average().toFloat()
        var y = 0
        val regions = ArrayList<Region>()
        while (y < h && regions.size < maxRegions) {
            if (rowEnergy[y] > mean * 1.9f) {
                val start = y
                while (y < h && rowEnergy[y] > mean * 1.3f) y++
                val end = y
                if (end - start >= 4) {
                    // horizontal extent of the block
                    var minX = w
                    var maxX = 0
                    for (yy in start until end) {
                        for (x in 0 until w) {
                            if (edge[yy * w + x] > mean * 1.1f) {
                                if (x < minX) minX = x
                                if (x > maxX) maxX = x
                            }
                        }
                    }
                    if (maxX > minX && (maxX - minX) > w / 12) {
                        regions += Region(minX * step, start * step,
                            (maxX - minX) * step, (end - start) * step)
                    }
                }
            } else y++
        }
        return regions
    }

    // --------------------------------------------------- gallery / editor path
    /** Enhance an existing photo (gallery editor, "AI Ultra" re-process). */
    fun enhanceBitmap(source: Bitmap, ultra: Boolean, enhance: Boolean = true): Bitmap {
        val planes = Planes.fromBitmap(source)
        val result = processCapture(
            frames = listOf(planes), shifts = listOf(Shift.ZERO), evs = emptyList(),
            depth = null, faceRegions = emptyList(), zoom = 1f,
            wantUltra = ultra, wantEnhance = enhance, wantPortrait = false,
            wantDocument = false, nativeLongEdge = max(planes.w, planes.h),
        )
        return result.planes?.toBitmap() ?: source
    }

    /** Stitch a captured sweep into a panorama. */
    fun buildPanorama(frames: List<Planes>): AiResult {
        progress("AI panorama stitch", 0.5f)
        val result = Panorama.stitch(frames)
        val planes = result.planes
        if (planes == null) {
            return AiResult(null, "Panorama failed", listOf("Not enough overlap"), frames.size, 1f, true, "", false)
        }
        val polished = processCapture(
            frames = listOf(planes), shifts = listOf(Shift.ZERO), evs = emptyList(),
            depth = null, faceRegions = emptyList(), zoom = 1f,
            wantUltra = false, wantEnhance = true, wantPortrait = false,
            wantDocument = false, nativeLongEdge = max(planes.w, planes.h),
        )
        return polished.copy(
            headline = "AI Panorama",
            details = polished.details + "${result.frames} frames, ${(result.coverage * 100).toInt()}% coverage",
        )
    }

    /** Document scan: detect the sheet, flatten it and clean it up. */
    fun scanDocument(frame: Planes, grayscale: Boolean, highContrast: Boolean): AiResult {
        progress("AI document scan", 0.3f)
        val quad = Scanner.detectQuad(frame)
        val rectified = if (quad != null) Scanner.rectify(frame, quad) else null
        val working = rectified ?: frame
        progress("AI document cleanup", 0.7f)
        Scanner.enhance(working, grayscale, highContrast)
        val details = mutableListOf<String>()
        details += if (rectified != null) "Perspective corrected ${working.w}×${working.h}"
        else "Sheet not detected - full frame enhanced"
        if (grayscale) details += "Greyscale text mode"
        val after = working.toBitmap(1200)
        return AiResult(working, "AI Document", details, 1, 1f, rectified == null,
            if (rectified != null) "Scanner ${working.w}×${working.h}" else "Full frame",
            true, frame.toBitmap(1200), after)
    }

    /** Human readable device line for the HUD. */
    fun deviceSummary(): String =
        "${report.soc} • ${report.gpuRenderer} • ${"%.1f".format(report.ramGb)} GB • ${policy.tierLabel} AI"
}

/** Capture plan produced by the AI before it asks the camera for frames. */
data class CapturePlan(
    val frames: Int,
    val evLadder: List<Int>,
    val manualIso: Int,
    val manualExposureNs: Long,
    val useHardwareZsl: Boolean,
    val wantDepth: Boolean,
    val wantRaw: Boolean,
    val wantHdrFusion: Boolean,
) {
    fun describe(): String = buildString {
        append("$frames frame")
        if (frames > 1) append("s")
        if (evLadder.isNotEmpty()) append(" • bracket ${evLadder.joinToString("/")} EV")
        if (manualIso > 0) append(" • ISO $manualIso / ${formatExposure(manualExposureNs)}")
        if (wantDepth) append(" • depth")
        if (wantRaw) append(" • RAW")
    }

    companion object {
        fun formatExposure(ns: Long): String = when {
            ns <= 0L -> "auto"
            ns >= 1_000_000_000L -> "%.1fs".format(ns / 1e9)
            ns >= 1_000_000L -> "1/%.0fs".format(1e9 / ns)
            else -> "1/${(1e9 / ns).toInt()}s"
        }
    }
}
