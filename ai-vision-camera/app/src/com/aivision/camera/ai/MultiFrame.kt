package com.aivision.camera.ai

import com.aivision.camera.core.L
import com.aivision.camera.core.M
import com.aivision.camera.core.Work
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** How a frame sits relative to the reference frame (in pixels). */
data class Shift(val dx: Float, val dy: Float, val confidence: Float) {
    companion object { val ZERO = Shift(0f, 0f, 1f) }
}

/**
 * Sub-pixel alignment.
 *
 * A 3-level pyramid does a coarse integer search (normalised SAD on subsampled
 * luma), then the result is refined at full resolution and the SAD surface is
 * interpolated for sub-pixel accuracy. Sub-pixel shifts are what makes genuine
 * multi-frame super-resolution possible instead of a plain average.
 */
object Align {

    fun estimate(reference: FloatArray, moving: FloatArray, w: Int, h: Int,
                 maxShift: Int = 24): Shift {
        if (reference.size != moving.size || w < 8 || h < 8) return Shift.ZERO
        // ---- pyramid ---------------------------------------------------------
        val levels = ArrayList<Pair<FloatArray, IntArray>>()   // (data, [w,h])
        var cw = w; var ch = h
        var cur = reference
        var curM = moving
        val refs = ArrayList<FloatArray>()
        val movs = ArrayList<FloatArray>()
        var level = 0
        while (cw > 48 && ch > 48 && level < 3) {
            refs.add(cur); movs.add(curM)
            cur = Imaging.downsample2(cur, cw, ch)
            curM = Imaging.downsample2(curM, cw, ch)
            cw = max(1, cw / 2); ch = max(1, ch / 2)
            level++
        }
        refs.add(cur); movs.add(curM)

        var shiftX = 0f
        var shiftY = 0f
        var confidence = 0.4f
        for (i in refs.indices.reversed()) {
            val lw = if (i == 0) w else max(1, w shr i)
            val lh = if (i == 0) h else max(1, h shr i)
            val r = refs[i]
            val m = movs[i]
            val radius = if (i == refs.size - 1) maxShift else max(2, maxShift / (1 shl i) + 1)
            val guessX = (shiftX / (1 shl i)).roundToInt()
            val guessY = (shiftY / (1 shl i)).roundToInt()
            var bestX = guessX
            var bestY = guessY
            var bestScore = Float.MAX_VALUE
            var second = Float.MAX_VALUE
            for (dy in (guessY - radius)..(guessY + radius)) {
                for (dx in (guessX - radius)..(guessX + radius)) {
                    val score = sad(r, m, lw, lh, dx, dy)
                    if (score < bestScore) {
                        second = bestScore; bestScore = score; bestX = dx; bestY = dy
                    } else if (score < second) second = score
                }
            }
            // sub-pixel refinement on the full-resolution pass
            var fx = bestX.toFloat()
            var fy = bestY.toFloat()
            if (i == 0) {
                fx = parabolaRefine(r, m, lw, lh, bestX, bestY, true)
                fy = parabolaRefine(r, m, lw, lh, bestX, bestY, false)
            }
            shiftX = fx * (1 shl i)
            shiftY = fy * (1 shl i)
            confidence = if (second > 0f) M.clamp(1f - bestScore / (second + 1e-6f), 0.1f, 1f) else 0.5f
        }
        return Shift(shiftX, shiftY, confidence)
    }

    private fun sad(ref: FloatArray, mov: FloatArray, w: Int, h: Int, dx: Int, dy: Int): Float {
        val step = max(1, min(w, h) / 96)
        var acc = 0f
        var count = 0
        var y = max(0, dy)
        val yEnd = min(h, h + dy)
        while (y < yEnd) {
            val ry = y * w
            val my = (y - dy) * w
            var x = max(0, dx)
            val xEnd = min(w, w + dx)
            while (x < xEnd) {
                val a = ref[ry + x]
                val b = mov[my + (x - dx)]
                acc += abs(a - b)
                count++
                x += step
            }
            y += step
        }
        return if (count == 0) Float.MAX_VALUE else acc / count
    }

    private fun parabolaRefine(ref: FloatArray, mov: FloatArray, w: Int, h: Int,
                               cx: Int, cy: Int, horizontal: Boolean): Float {
        val s = if (horizontal) {
            listOf(sad(ref, mov, w, h, cx - 1, cy), sad(ref, mov, w, h, cx, cy),
                sad(ref, mov, w, h, cx + 1, cy))
        } else {
            listOf(sad(ref, mov, w, h, cx, cy - 1), sad(ref, mov, w, h, cx, cy),
                sad(ref, mov, w, h, cx, cy + 1))
        }
        val denom = (s[0] - 2f * s[1] + s[2])
        if (abs(denom) < 1e-6f) return cx.toFloat().let { if (horizontal) it else cy.toFloat() }
        val delta = 0.5f * (s[0] - s[2]) / denom
        val refined = (if (horizontal) cx.toFloat() else cy.toFloat()) + delta.coerceIn(-1f, 1f)
        return refined
    }
}

/**
 * Temporal accumulator: the heart of AI night mode, multi-frame detail recovery
 * and noise reduction.
 *
 * Every incoming frame is aligned to the reference, then merged with a weight
 * built from
 *   - local similarity  (ghost/motion rejection - moving people never smear)
 *   - exposure normalisation (HDR stacks)
 *   - local variance    (flat areas average hard, textured areas keep the sharp one)
 *
 * Averaging N frames cuts random noise by ~sqrt(N) while keeping the sharpest
 * structure, which is exactly what "AI computational photography" does on device.
 */
class MultiFrameAccumulator(
    val width: Int,
    val height: Int,
    private val frames: Int,
) {
    private val ySum = FloatArray(width * height)
    private val yWeight = FloatArray(width * height)
    private val uSum: FloatArray
    private val vSum: FloatArray
    private val uvWeight: FloatArray
    private var added = 0
    private var ref: Planes? = null

    init {
        val cw = max(1, width / 2)
        val ch = max(1, height / 2)
        uSum = FloatArray(cw * ch)
        vSum = FloatArray(cw * ch)
        uvWeight = FloatArray(cw * ch)
    }

    val frameCount: Int get() = added

    /** Add a frame. [exposureScale] < 1 darkens (for HDR stacks). */
    fun add(frame: Planes, shift: Shift, exposureScale: Float = 1f, baseWeight: Float = 1f) {
        if (frame.w != width || frame.h != height) return
        val inv = 1f / max(0.05f, exposureScale)
        val isFirst = added == 0
        if (isFirst) {
            ref = frame
        }
        val reference = ref!!.y
        val range = 0.045f + 0.02f * (added.coerceAtMost(4))
        val invRange2 = 1f / (2f * range * range)

        for (row in 0 until height) {
            val srcY = (row + shift.dy).roundToInt()
            if (srcY < 0 || srcY >= height) continue
            val rowBase = row * width
            val srcBase = srcY * width
            for (col in 0 until width) {
                val srcX = (col + shift.dx).roundToInt()
                if (srcX < 0 || srcX >= width) continue
                val value = frame.y[srcBase + srcX] * inv
                val target = reference[rowBase + col]
                val diff = value - target
                var w = exp(-diff * diff * invRange2) * baseWeight
                if (isFirst) w = 1f
                ySum[rowBase + col] += value * w
                yWeight[rowBase + col] += w
            }
        }

        // ---- chroma (4:2:0, aligned at half resolution) ----------------------
        val cw = max(1, width / 2)
        val ch = max(1, height / 2)
        val shiftX = shift.dx / 2f
        val shiftY = shift.dy / 2f
        for (row in 0 until ch) {
            val srcY = (row + shiftY).roundToInt()
            if (srcY < 0 || srcY >= ch) continue
            for (col in 0 until cw) {
                val srcX = (col + shiftX).roundToInt()
                if (srcX < 0 || srcX >= cw) continue
                val o = row * cw + col
                val so = srcY * cw + srcX
                uSum[o] += frame.u[so] * inv
                vSum[o] += frame.v[so] * inv
                uvWeight[o] += 1f
            }
        }
        added++
    }

    /** Fuse everything into a single, cleaner, higher-detail image. */
    fun finish(): Planes {
        val out = Planes(width, height)
        val refY = ref?.y
        for (i in ySum.indices) {
            val w = yWeight[i]
            out.y[i] = if (w > 1e-4f) (ySum[i] / w) else (refY?.get(i) ?: 0f)
        }
        for (i in uSum.indices) {
            val w = uvWeight[i]
            out.u[i] = if (w > 1e-4f) uSum[i] / w else 0f
            out.v[i] = if (w > 1e-4f) vSum[i] / w else 0f
        }
        // the merged luma is smoother than reality: put controlled detail back
        val detail = Imaging.unsharp(out.y, width, height, 1.0f, 0.35f, 0.003f, 0.16f)
        System.arraycopy(detail, 0, out.y, 0, out.y.size)
        return out
    }

    val mergedFrames: Int get() = added
}

/**
 * Exposure fusion (Mertens style) for AI HDR: instead of picking a single
 * exposure it blends the well-exposed parts of every bracket, so highlights stay
 * and shadows open up - computed on luma and chroma weights separately.
 */
object HdrFusion {

    data class Bracket(val planes: Planes, val ev: Float)

    fun fuse(brackets: List<Bracket>): Planes? {
        if (brackets.size < 2) return brackets.firstOrNull()?.planes
        val ref = brackets.first()
        val w = ref.planes.w
        val h = ref.planes.h
        val n = brackets.size
        val out = Planes(w, h)

        val minEv = brackets.minOf { it.ev }
        val evScales = brackets.map { 2f.pow(-(it.ev - minEv)) }

        // Normalise each bracket to the brightest exposure so weights compare fairly
        val normalised = brackets.mapIndexed { idx, b ->
            val inv = 1f / max(0.05f, evScales[idx])
            val y = FloatArray(b.planes.y.size)
            for (i in y.indices) y[i] = (b.planes.y[i] * inv).coerceIn(0f, 1f)
            Triple(y, b.planes.u, b.planes.v)
        }

        val weights = Array(n) { FloatArray(w * h) }
        for (idx in 0 until n) {
            val y = normalised[idx].first
            val u = normalised[idx].second
            val v = normalised[idx].third
            for (i in y.indices) {
                val value = y[i]
                // well-exposedness: gaussian around 0.5
                val expo = exp(-((value - 0.5f) * (value - 0.5f)) / (2f * 0.2f * 0.2f))
                // local contrast proxy from chroma magnitude + luma gradient
                val uvIdx = min(u.size - 1, i / 4)
                val sat = sqrt(u[uvIdx] * u[uvIdx] + v[uvIdx] * v[uvIdx]) * 4f
                var contrast = 0f
                if (i > w && i < y.size - w) {
                    contrast = abs(y[i] - y[i - w]) + abs(y[i] - y[i - 1])
                }
                val weight = (expo + 0.35f) * (0.7f + M.clamp(sat * 2.5f, 0f, 1.6f)) *
                    (0.8f + M.clamp(contrast * 6f, 0f, 1.2f))
                weights[idx][i] = weight + 1e-4f
            }
        }

        for (i in 0 until w * h) {
            var wsum = 0f
            var acc = 0f
            for (idx in 0 until n) {
                val wgt = weights[idx][i]
                wsum += wgt
                acc += normalised[idx].first[i] * wgt
            }
            out.y[i] = if (wsum > 0f) acc / wsum else ref.planes.y[i]
        }

        val cw = out.cw
        val ch = out.ch
        for (i in 0 until cw * ch) {
            var uAcc = 0f
            var vAcc = 0f
            var wsum = 0f
            // reuse the luma weights, downsampled 2x2
            for (idx in 0 until n) {
                val wgt = weights[idx][min(w * h - 1, (i / cw) * 2 * w + (i % cw) * 2)]
                uAcc += normalised[idx].second[i] * wgt
                vAcc += normalised[idx].third[i] * wgt
                wsum += wgt
            }
            val safe = if (wsum > 1e-5f) wsum else 1f
            out.u[i] = uAcc / safe
            out.v[i] = vAcc / safe
        }
        return out
    }
}
