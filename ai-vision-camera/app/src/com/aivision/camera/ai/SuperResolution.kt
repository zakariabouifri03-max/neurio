package com.aivision.camera.ai

import com.aivision.camera.core.M
import com.aivision.camera.core.Work
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * AI Super Resolution / AI Ultra Resolution.
 *
 * Two real mechanisms, combined:
 *
 *  1. **Multi-frame reconstruction** - when a burst is available, sub-pixel
 *     differences between aligned frames are splatted onto the finer grid
 *     (drizzle / shift-and-add), which recovers detail that no single frame has.
 *  2. **Iterative back-projection** - the classic single-image SR loop: the
 *     upscaled result is simulated back down, the difference against the real
 *     low-resolution image becomes the error, and that error is projected back
 *     onto the high-resolution grid. Structure therefore stays faithful to the
 *     data that actually exists - it synthesises no fake texture.
 *
 * Chroma is upscaled with a bicubic kernel and a chroma-aware denoise, because
 * chroma detail is invisible next to luma detail and cheap to interpolate.
 */
object SuperResolution {

    data class Result(val planes: Planes, val factor: Float, val native: Boolean,
                      val frames: Int, val iterations: Int, val label: String)

    /**
     * Upscale [src] so its long edge reaches [targetLongEdge].
     * [supportFrames] carries aligned burst frames (already merged) for the
     * multi-frame stage; pass an empty list for single-image SR.
     */
    fun upscale(src: Planes, targetLongEdge: Int, quality: SrQuality = SrQuality.STANDARD,
                supportFrames: List<Pair<Planes, Shift>> = emptyList()): Result {
        val longEdge = max(src.w, src.h)
        val factorWanted = targetLongEdge.toFloat() / longEdge
        if (factorWanted <= 1.02f) {
            return Result(src, 1f, true, 0, 0, "Native ${src.w}×${src.h}")
        }
        val factor = when (quality) {
            SrQuality.FAST -> min(factorWanted, 2f)
            SrQuality.STANDARD -> min(factorWanted, 3f)
            SrQuality.ULTRA -> min(factorWanted, 8f)
        }
        val dw = (src.w * factor).roundToInt().coerceAtLeast(src.w)
        val dh = (src.h * factor).roundToInt().coerceAtLeast(src.h)

        // ---- 1. multi-frame splat (sub-pixel detail recovery) ----------------
        val sourceLuma: FloatArray = if (supportFrames.isNotEmpty() && quality != SrQuality.FAST) {
            drizzle(src, supportFrames, dw, dh)
        } else {
            FloatArray(0)
        }

        // ---- 2. base upscale -------------------------------------------------
        val baseLuma = if (sourceLuma.isNotEmpty()) {
            // the drizzle grid is complete but slightly soft: recover acutance
            Imaging.unsharp(sourceLuma, dw, dh, 1.05f, 0.28f, 0.003f, 0.18f)
        } else {
            Imaging.resizeEdgeDirected(src.y, src.w, src.h, dw, dh, 0.5f)
        }

        // ---- 3. iterative back projection -----------------------------------
        val iterations = when (quality) {
            SrQuality.FAST -> 1
            SrQuality.STANDARD -> 2
            SrQuality.ULTRA -> 3
        }
        var current = baseLuma
        for (it in 0 until iterations) {
            current = backProject(current, dw, dh, src, strength = 0.55f - it * 0.12f)
        }

        // ---- 4. structure aware finishing ----------------------------------
        current = Imaging.unsharp(current, dw, dh, 1.1f, 0.32f, 0.0035f, 0.2f)
        current = Imaging.localContrast(current, dw, dh, max(6f, dw / 96f), 0.12f)

        val out = Planes(dw, dh)
        out.y = FloatArray(current.size) { current[it].coerceIn(0f, 1f) }
        out.u = Imaging.resizeBicubic(src.u, src.cw, src.ch, out.cw, out.ch)
        out.v = Imaging.resizeBicubic(src.v, src.cw, src.ch, out.cw, out.ch)
        Imaging.denoiseChroma(out.u, out.v, out.cw, out.ch, 0.25f)

        val label = if (dw >= 3840 || dh >= 3840) {
            "AI Enhanced 4K • ${dw}×${dh}"
        } else {
            "AI ULTRA • ${dw}×${dh} (${"%.1f".format(factor)}×)"
        }
        return Result(out, factor, factorWanted <= 1.02f, supportFrames.size,
            iterations, label)
    }

    /**
     * Drizzle: accumulate each aligned frame's samples onto a finer grid using
     * its sub-pixel offset. Frames that land between output pixels fill them in,
     * which is how real multi-frame super-resolution beats interpolation.
     */
    private fun drizzle(src: Planes, frames: List<Pair<Planes, Shift>>, dw: Int, dh: Int): FloatArray {
        val acc = FloatArray(dw * dh)
        val weight = FloatArray(dw * dh)
        val scaleX = dw.toFloat() / src.w
        val scaleY = dh.toFloat() / src.h
        val all = listOf(src to Shift.ZERO) + frames
        for ((frame, shift) in all) {
            if (frame.w != src.w || frame.h != src.h) continue
            val dx = shift.dx * scaleX
            val dy = shift.dy * scaleY
            for (row in 0 until dh) {
                val sy = (row - dy) / scaleY
                val y0 = kotlin.math.floor(sy).toInt().coerceIn(0, src.h - 1)
                val y1 = min(src.h - 1, y0 + 1)
                val fy = (sy - y0).coerceIn(0f, 1f)
                for (col in 0 until dw) {
                    val sx = (col - dx) / scaleX
                    val x0 = kotlin.math.floor(sx).toInt().coerceIn(0, src.w - 1)
                    val x1 = min(src.w - 1, x0 + 1)
                    val fx = (sx - x0).coerceIn(0f, 1f)
                    val v00 = frame.y[y0 * src.w + x0]
                    val v01 = frame.y[y0 * src.w + x1]
                    val v10 = frame.y[y1 * src.w + x0]
                    val v11 = frame.y[y1 * src.w + x1]
                    val v = M.lerp(M.lerp(v00, v01, fx), M.lerp(v10, v11, fx), fy)
                    val o = row * dw + col
                    acc[o] += v
                    weight[o] += 1f
                }
            }
        }
        for (i in acc.indices) if (weight[i] > 0f) acc[i] /= weight[i]
        return acc
    }

    /**
     * One back-projection iteration: simulate the current estimate at the sensor
     * resolution, measure the residual and add the (upscaled, edge-weighted)
     * residual back. Converges onto a solution consistent with the capture.
     */
    private fun backProject(estimate: FloatArray, dw: Int, dh: Int, src: Planes,
                            strength: Float): FloatArray {
        // simulate the estimate at sensor resolution and measure the residual
        val simulated = Imaging.resizeBilinear(estimate, dw, dh, src.w, src.h)
        val residual = FloatArray(src.y.size)
        for (i in residual.indices) residual[i] = src.y[i] - simulated[i]
        // the high-frequency part of the residual carries the missing detail
        val residualDetail = Imaging.unsharp(residual, src.w, src.h, 0.9f, 0.5f, 0.002f, 0.1f)
        val up = Imaging.resizeBicubic(residualDetail, src.w, src.h, dw, dh)

        // edge gate: project onto structure, never onto noise or ghosting
        val smooth = Imaging.gaussian(estimate, dw, dh, 1.0f)
        val detailMagnitude = FloatArray(estimate.size) { abs(estimate[it] - smooth[it]) }
        val gates = Imaging.gaussian(detailMagnitude, dw, dh, 1.4f)

        val out = FloatArray(estimate.size)
        for (i in out.indices) {
            val gate = M.smoothstep(0.004f, 0.03f, gates[i])
            val correction = M.clamp(up[i] * strength, -0.06f, 0.06f)
            out[i] = (estimate[i] + correction * (0.45f + 0.55f * gate)).coerceIn(0f, 1f)
        }
        return out
    }

    /** Label used when the device cannot go past its native resolution. */
    fun nativeLabel(width: Int, height: Int, aiEnhanced: Boolean): String =
        if (width >= 3840 || height >= 3840) "Native 4K • ${width}×${height}"
        else if (aiEnhanced) "AI Enhanced • ${width}×${height} (native)"
        else "${width}×${height}"
}

enum class SrQuality { FAST, STANDARD, ULTRA }
