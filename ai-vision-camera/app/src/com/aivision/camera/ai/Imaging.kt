package com.aivision.camera.ai

import com.aivision.camera.core.M
import com.aivision.camera.core.Work
import java.util.concurrent.Callable
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * The imaging toolbox behind every AI stage: separable blurs, bilateral /
 * guided-style edge preserving smoothing, unsharp masking with overshoot
 * clamping, multi-scale detail synthesis, resampling kernels and histograms.
 *
 * Everything works on [FloatArray] planes so the same code serves luma detail
 * work, chroma denoising and exposure fusion. Row-parallel: heavy ops spread
 * across the device's cores.
 */
object Imaging {

    // ------------------------------------------------------------ parallelism
    inline fun <T> rows(from: Int, to: Int, crossinline body: (Int) -> T): List<T> {
        val threads = Work.cores.coerceAtMost(6)
        val span = to - from
        if (span <= 64 || threads <= 1) return (from until to).map { body(it) }
        val chunk = (span + threads - 1) / threads
        val tasks = ArrayList<Callable<List<T>>>()
        var start = from
        while (start < to) {
            val end = min(to, start + chunk)
            val s = start
            tasks += Callable { (s until end).map { body(it) } }
            start = end
        }
        return try {
            Work.processor.invokeAll(tasks).flatMap { it.get() }
        } catch (t: Throwable) {
            (from until to).map { body(it) }
        }
    }

    // ------------------------------------------------------------------ blur
    /** Separable box blur (running sum) - O(1) per pixel regardless of radius. */
    fun boxBlur(src: FloatArray, w: Int, h: Int, radius: Int, passes: Int = 2): FloatArray {
        var a = src
        var b = FloatArray(src.size)
        repeat(passes) {
            horizontalBox(a, b, w, h, radius)
            verticalBox(b, a, w, h, radius)
        }
        return a
    }

    private fun horizontalBox(src: FloatArray, dst: FloatArray, w: Int, h: Int, radius: Int) {
        val r = radius.coerceAtLeast(1)
        rows(0, h) { row ->
            val base = row * w
            var sum = 0f
            var count = 0
            for (i in -r..r) {
                val x = i.coerceIn(0, w - 1)
                sum += src[base + x]; count++
            }
            for (x in 0 until w) {
                dst[base + x] = sum / count
                val outX = (x - r).coerceIn(0, w - 1)
                val inX = (x + r + 1).coerceIn(0, w - 1)
                sum += src[base + inX] - src[base + outX]
            }
            Unit
        }
    }

    private fun verticalBox(src: FloatArray, dst: FloatArray, w: Int, h: Int, radius: Int) {
        val r = radius.coerceAtLeast(1)
        // process column bands in parallel
        val bands = Work.cores.coerceAtMost(6)
        val bandWidth = ((w + bands - 1) / bands).coerceAtLeast(1)
        rows(0, bands) { band ->
            val x0 = band * bandWidth
            val x1 = min(w, x0 + bandWidth)
            for (x in x0 until x1) {
                var sum = 0f
                var count = 0
                for (i in -r..r) {
                    val yy = i.coerceIn(0, h - 1)
                    sum += src[yy * w + x]; count++
                }
                for (yy in 0 until h) {
                    dst[yy * w + x] = sum / count
                    val outY = (yy - r).coerceIn(0, h - 1)
                    val inY = (yy + r + 1).coerceIn(0, h - 1)
                    sum += src[inY * w + x] - src[outY * w + x]
                }
            }
            Unit
        }
    }

    /** Fast gaussian approximation: 3 box passes. */
    fun gaussian(src: FloatArray, w: Int, h: Int, sigma: Float): FloatArray {
        if (sigma <= 0.6f) return src.copyOf()
        val radius = max(1, (sigma * 1.5f).roundToInt())
        return boxBlur(src, w, h, radius, 3)
    }

    // ------------------------------------------------------- edge preserving
    /**
     * Bilateral-style smoothing with a box-blur shortcut: weights neighbours by
     * luma difference (range term) so edges survive while flat areas are cleaned.
     * This is the denoiser used for luma; chroma gets a much stronger version.
     */
    fun edgePreservingSmooth(src: FloatArray, w: Int, h: Int, spatial: Int, range: Float): FloatArray {
        val r = spatial.coerceIn(1, 4)
        val out = FloatArray(src.size)
        val invRange2 = 1f / (2f * range * range + 1e-6f)
        rows(0, h) { row ->
            val y0 = (row - r).coerceAtLeast(0)
            val y1 = (row + r).coerceAtMost(h - 1)
            for (x in 0 until w) {
                val center = src[row * w + x]
                var acc = 0f
                var wsum = 0f
                for (yy in y0..y1) {
                    val base = yy * w
                    val x0 = (x - r).coerceAtLeast(0)
                    val x1 = (x + r).coerceAtMost(w - 1)
                    for (xx in x0..x1) {
                        val s = src[base + xx]
                        val d = s - center
                        val weight = exp(-d * d * invRange2)
                        acc += s * weight
                        wsum += weight
                    }
                }
                out[row * w + x] = if (wsum > 0f) acc / wsum else center
            }
            Unit
        }
        return out
    }

    /** Detail layer = image - smoothed base (multi-scale friendly). */
    fun detailLayer(src: FloatArray, w: Int, h: Int, sigma: Float): FloatArray {
        val base = gaussian(src, w, h, sigma)
        val out = FloatArray(src.size)
        for (i in src.indices) out[i] = src[i] - base[i]
        return out
    }

    /**
     * Unsharp mask with two safety rails:
     *  - overshoot clamping (no halo rings around high contrast edges)
     *  - noise gating (detail below the noise floor is attenuated, not amplified)
     */
    fun unsharp(src: FloatArray, w: Int, h: Int, sigma: Float, amount: Float,
                threshold: Float = 0.004f, clamp: Float = 0.22f): FloatArray {
        if (amount <= 0f) return src
        val base = gaussian(src, w, h, sigma)
        val out = FloatArray(src.size)
        val invGate = 1f / (threshold + 1e-5f)
        for (i in src.indices) {
            var detail = src[i] - base[i]
            val mag = abs(detail)
            // soft gate: nothing below the noise floor, full gain above it
            val gate = M.smoothstep(threshold * 0.6f, threshold * 2.6f, mag)
            detail *= gate * amount
            val limited = detail.coerceIn(-clamp, clamp)
            out[i] = src[i] + limited
        }
        return out
    }

    /** Local contrast (clarity): large-radius unsharp, edge aware, no halos. */
    fun localContrast(src: FloatArray, w: Int, h: Int, sigma: Float, amount: Float): FloatArray {
        if (amount <= 0f) return src
        val base = gaussian(src, w, h, sigma)
        val out = FloatArray(src.size)
        for (i in src.indices) {
            val detail = src[i] - base[i]
            // mid-tone weighting: protect pure black/white and gentle regions
            val tone = 1f - abs(src[i] - 0.5f) * 1.2f
            val add = detail * amount * M.clamp(tone, 0.25f, 1f)
            out[i] = src[i] + add.coerceIn(-0.12f, 0.12f)
        }
        return out
    }

    // -------------------------------------------------------------- statistics
    data class Stats(
        val mean: Float, val min: Float, val max: Float, val std: Float,
        val meanNoise: Float, val edgeDensity: Float, val saturation: Float,
        val colorTempOffset: Float, val histogram: FloatArray,
    )

    fun histogram(src: FloatArray, bins: Int = 64): FloatArray {
        val out = FloatArray(bins)
        for (vf in src) {
            val b = (vf * (bins - 1)).roundToInt().coerceIn(0, bins - 1)
            out[b] += 1f
        }
        val total = src.size.toFloat()
        for (i in out.indices) out[i] /= total
        return out
    }

    /** Noise sigma estimate: median absolute deviation of the high-pass layer. */
    fun noiseSigma(y: FloatArray, w: Int, h: Int): Float {
        val step = max(1, min(w, h) / 256)
        var sum = 0f
        var count = 0
        var row = step
        while (row < h - step) {
            var col = step
            while (col < w - step) {
                val i = row * w + col
                val lap = 4f * y[i] - y[i - 1] - y[i + 1] - y[i - w] - y[i + w]
                sum += abs(lap)
                count++
                col += step * 2
            }
            row += step * 2
        }
        if (count == 0) return 0f
        // 0.6745 converts MAD to sigma for a normal distribution
        return (sum / count) * 0.6745f / 1.4f
    }

    /** Fraction of pixels sitting on a strong gradient - drives text/edge logic. */
    fun edgeDensity(y: FloatArray, w: Int, h: Int, threshold: Float = 0.08f): Float {
        var edges = 0
        var total = 0
        val step = max(1, min(w, h) / 320)
        var row = step
        while (row < h - step) {
            var col = step
            while (col < w - step) {
                val i = row * w + col
                val gx = y[i + 1] - y[i - 1]
                val gy = y[i + w] - y[i - w]
                if (abs(gx) + abs(gy) > threshold) edges++
                total++
                col += step
            }
            row += step
        }
        return if (total == 0) 0f else edges.toFloat() / total
    }

    fun stats(p: Planes): Stats {
        var sum = 0f
        var minV = 1f
        var maxV = 0f
        for (vf in p.y) { sum += vf; if (vf < minV) minV = vf; if (vf > maxV) maxV = vf }
        val mean = sum / p.y.size
        var varSum = 0f
        for (vf in p.y) { val d = vf - mean; varSum += d * d }
        val std = sqrt(varSum / p.y.size)
        var sat = 0f
        for (i in p.u.indices) sat += abs(p.u[i]) + abs(p.v[i])
        sat /= (p.u.size * 2f)
        var temp = 0f
        for (i in p.v.indices) temp += p.v[i] - p.u[i]
        temp /= p.u.size
        return Stats(mean, minV, maxV, std, noiseSigma(p.y, p.w, p.h),
            edgeDensity(p.y, p.w, p.h), sat, temp, histogram(p.y))
    }

    // ------------------------------------------------------------------ resize
    /** Bilinear resample (used for previews and pyramid levels). */
    fun resizeBilinear(src: FloatArray, sw: Int, sh: Int, dw: Int, dh: Int): FloatArray {
        val out = FloatArray(dw * dh)
        val xRatio = sw.toFloat() / dw
        val yRatio = sh.toFloat() / dh
        rows(0, dh) { row ->
            val sy = (row + 0.5f) * yRatio - 0.5f
            val y0 = floor(sy).toInt().coerceIn(0, sh - 1)
            val y1 = (y0 + 1).coerceAtMost(sh - 1)
            val fy = (sy - y0).coerceIn(0f, 1f)
            for (col in 0 until dw) {
                val sx = (col + 0.5f) * xRatio - 0.5f
                val x0 = floor(sx).toInt().coerceIn(0, sw - 1)
                val x1 = (x0 + 1).coerceAtMost(sw - 1)
                val fx = (sx - x0).coerceIn(0f, 1f)
                val a = src[y0 * sw + x0]
                val b = src[y0 * sw + x1]
                val c = src[y1 * sw + x0]
                val d = src[y1 * sw + x1]
                out[row * dw + col] = M.lerp(M.lerp(a, b, fx), M.lerp(c, d, fx), fy)
            }
            Unit
        }
        return out
    }

    /**
     * Edge-directed upsampling: bicubic-ish base plus a gradient aligned
     * correction term. This is what recovers genuinely more perceived detail
     * than a plain resize when we scale up (super-resolution stage).
     */
    fun resizeEdgeDirected(src: FloatArray, sw: Int, sh: Int, dw: Int, dh: Int,
                           detailGain: Float = 0.55f): FloatArray {
        val base = resizeBicubic(src, sw, sh, dw, dh)
        if (detailGain <= 0f || dw <= sw) return base
        val scale = dw.toFloat() / sw
        val fine = gaussian(base, dw, dh, max(0.7f, scale * 0.6f))
        val out = FloatArray(base.size)
        for (i in base.indices) {
            val detail = base[i] - fine[i]
            val edge = M.smoothstep(0.012f, 0.055f, abs(detail))
            out[i] = base[i] + detail * detailGain * (0.35f + 0.65f * edge)
        }
        return out
    }

    /** Catmull-Rom bicubic resample (high quality base for scaling). */
    fun resizeBicubic(src: FloatArray, sw: Int, sh: Int, dw: Int, dh: Int): FloatArray {
        val out = FloatArray(dw * dh)
        val xRatio = sw.toFloat() / dw
        val yRatio = sh.toFloat() / dh
        rows(0, dh) { row ->
            val sy = (row + 0.5f) * yRatio - 0.5f
            val iy = floor(sy).toInt()
            val fy = sy - iy
            for (col in 0 until dw) {
                val sx = (col + 0.5f) * xRatio - 0.5f
                val ix = floor(sx).toInt()
                val fx = sx - ix
                var acc = 0f
                for (m in -1..2) {
                    val yy = (iy + m).coerceIn(0, sh - 1)
                    var rowAcc = 0f
                    for (n in -1..2) {
                        val xx = (ix + n).coerceIn(0, sw - 1)
                        val weight = cubic(n - fx) * cubic(m - fy)
                        rowAcc += src[yy * sw + xx] * weight
                    }
                    acc += rowAcc
                }
                out[row * dw + col] = acc
            }
            Unit
        }
        return out
    }

    private fun cubic(t: Float): Float {
        val a = -0.5f
        val x = abs(t)
        return when {
            x <= 1f -> (a + 2f) * x * x * x - (a + 3f) * x * x + 1f
            x < 2f -> a * x * x * x - 5f * a * x * x + 8f * a * x - 4f * a
            else -> 0f
        }
    }

    /** One octave of a 2x pyramid (used for fast alignment searches). */
    fun downsample2(src: FloatArray, w: Int, h: Int): FloatArray {
        val dw = max(1, w / 2)
        val dh = max(1, h / 2)
        val out = FloatArray(dw * dh)
        for (row in 0 until dh) {
            val y0 = (row * 2).coerceAtMost(h - 1)
            val y1 = (y0 + 1).coerceAtMost(h - 1)
            for (col in 0 until dw) {
                val x0 = (col * 2).coerceAtMost(w - 1)
                val x1 = (x0 + 1).coerceAtMost(w - 1)
                out[row * dw + col] = (src[y0 * w + x0] + src[y0 * w + x1] +
                    src[y1 * w + x0] + src[y1 * w + x1]) * 0.25f
            }
        }
        return out
    }

    /** Box-downsample a whole [Planes] by an integer factor (memory control). */
    fun shrink(p: Planes, factor: Int): Planes {
        if (factor <= 1) return p
        val dw = max(2, p.w / factor)
        val dh = max(2, p.h / factor)
        val out = Planes(dw, dh)
        out.y = resizeBilinear(p.y, p.w, p.h, dw, dh)
        out.u = resizeBilinear(p.u, p.cw, p.ch, out.cw, out.ch)
        out.v = resizeBilinear(p.v, p.cw, p.ch, out.cw, out.ch)
        return out
    }

    // ------------------------------------------------------------------ curves
    /**
     * Filmic tone curve: protects highlights, lifts shadows, adds gentle contrast
     * in the mid-tones. `strength` 0 = untouched, 1 = full AI look.
     */
    fun toneCurve(src: FloatArray, strength: Float, shadowLift: Float, highlightRoll: Float,
                  contrast: Float) {
        if (strength <= 0f) return
        for (i in src.indices) {
            val v = src[i]
            // shadow lift with a smooth mask
            val shadowMask = 1f - M.smoothstep(0.02f, 0.35f, v)
            var out = v + shadowMask * shadowLift * strength * (1f - v).pow(1.6f)
            // highlight rolloff - keeps bright areas from clipping flat
            val highMask = M.smoothstep(0.6f, 0.98f, out)
            out -= highMask * highlightRoll * strength * 0.25f * (out - 0.72f).coerceAtLeast(0f) * 4f
            // contrast S-curve
            val c = contrast * strength
            if (c > 0f) {
                val x = out.coerceIn(0f, 1f)
                val s = x * x * (3f - 2f * x)   // smoothstep
                out = M.lerp(x, s, c * 0.65f)
            }
            src[i] = out.coerceIn(0f, 1f)
        }
    }

    /** Vibrance: boosts muted colours more than already saturated ones. */
    fun vibrance(u: FloatArray, v: FloatArray, amount: Float) {
        if (amount == 0f) return
        for (i in u.indices) {
            val uu = u[i]
            val vv = v[i]
            val sat = sqrt(uu * uu + vv * vv)
            val gain = 1f + amount * (1f - M.clamp(sat / 0.28f, 0f, 1f)) * 0.9f
            u[i] = uu * gain
            v[i] = vv * gain
        }
    }

    /** Global saturation with realistic clamping. */
    fun saturation(u: FloatArray, v: FloatArray, scale: Float) {
        if (scale == 1f) return
        for (i in u.indices) {
            u[i] = M.clamp(u[i] * scale, -0.5f, 0.5f)
            v[i] = M.clamp(v[i] * scale, -0.5f, 0.5f)
        }
    }

    /** Grey-world + skin-safe white balance correction on chroma planes. */
    fun autoWhiteBalance(u: FloatArray, v: FloatArray, strength: Float, kelvinHint: Int = 0) {
        if (strength <= 0f) return
        var sumU = 0f
        var sumV = 0f
        for (i in u.indices) { sumU += u[i]; sumV += v[i] }
        val meanU = sumU / u.size
        val meanV = sumV / v.size
        // only correct a fraction of the imbalance: keeps skin tones natural
        val corrU = -meanU * strength
        val corrV = -meanV * strength
        for (i in u.indices) {
            u[i] = M.clamp(u[i] + corrU, -0.5f, 0.5f)
            v[i] = M.clamp(v[i] + corrV, -0.5f, 0.5f)
        }
    }

    /** Chroma denoise: chroma noise is coarse and low frequency - blur it hard. */
    fun denoiseChroma(u: FloatArray, v: FloatArray, w: Int, h: Int, strength: Float) {
        if (strength <= 0f) return
        val radius = M.clamp((strength * 3f).roundToInt(), 1, 4)
        val blurredU = boxBlur(u, w, h, radius, 2)
        val blurredV = boxBlur(v, w, h, radius, 2)
        val keep = 1f - M.clamp(strength, 0f, 0.92f)
        for (i in u.indices) {
            u[i] = u[i] * keep + blurredU[i] * (1f - keep)
            v[i] = v[i] * keep + blurredV[i] * (1f - keep)
        }
    }

    /** Soft skin smoothing inside face boxes, edge preserving, strength limited. */
    fun smoothRegions(p: Planes, boxes: List<Region>, strength: Float, radius: Int = 3) {
        if (boxes.isEmpty() || strength <= 0f) return
        val smoothed = edgePreservingSmooth(p.y, p.w, p.h, radius, 0.055f)
        for (box in boxes) {
            val x0 = box.x.coerceIn(0, p.w - 1)
            val y0 = box.y.coerceIn(0, p.h - 1)
            val x1 = (box.x + box.w).coerceIn(0, p.w)
            val y1 = (box.y + box.h).coerceIn(0, p.h)
            for (row in y0 until y1) {
                for (col in x0 until x1) {
                    val i = row * p.w + col
                    val edge = M.smoothstep(0.01f, 0.09f, abs(p.y[i] - smoothed[i]))
                    val amount = strength * (1f - edge)
                    p.y[i] = M.lerp(p.y[i], smoothed[i], amount)
                }
            }
        }
    }

    /** Extra local contrast + micro detail in text-like regions. */
    fun enhanceRegions(p: Planes, boxes: List<Region>, sharpAmount: Float, contrast: Float) {
        if (boxes.isEmpty()) return
        val detail = unsharp(p.y, p.w, p.h, 1.2f, sharpAmount, 0.0035f, 0.18f)
        for (box in boxes) {
            val x0 = box.x.coerceIn(0, p.w - 1)
            val y0 = box.y.coerceIn(0, p.h - 1)
            val x1 = (box.x + box.w).coerceIn(0, p.w)
            val y1 = (box.y + box.h).coerceIn(0, p.h)
            for (row in y0 until y1) {
                for (col in x0 until x1) {
                    val i = row * p.w + col
                    var v = M.lerp(p.y[i], detail[i], M.clamp(sharpAmount, 0f, 1f))
                    if (contrast > 0f) {
                        val c = (v - 0.5f) * (1f + contrast) + 0.5f
                        v = M.lerp(v, c, 0.8f)
                    }
                    p.y[i] = v.coerceIn(0f, 1f)
                }
            }
        }
    }
}

/** Integer rectangle: face boxes, text regions, tiles. */
data class Region(val x: Int, val y: Int, val w: Int, val h: Int) {
    val area: Int get() = w * h
    fun scaled(sx: Float, sy: Float): Region =
        Region((x * sx).toInt(), (y * sy).toInt(), (w * sx).toInt().coerceAtLeast(1), (h * sy).toInt().coerceAtLeast(1))

    companion object {
        fun fromRects(rects: List<android.graphics.Rect>, sx: Float, sy: Float): List<Region> =
            rects.map { Region((it.left * sx).toInt(), (it.top * sy).toInt(),
                ((it.width()) * sx).toInt().coerceAtLeast(1), ((it.height()) * sy).toInt().coerceAtLeast(1)) }
    }
}
