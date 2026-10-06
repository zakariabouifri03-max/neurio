package com.aivision.camera.ai

import android.graphics.PointF
import com.aivision.camera.core.L
import com.aivision.camera.core.M
import com.aivision.camera.core.Work
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * AI Portrait: depth-driven background separation with an edge-aware refinement
 * pass so hair and glasses do not turn into cut-outs.
 */
object Portrait {

    /** 1 = subject, 0 = background. */
    class Mask(val w: Int, val h: Int, val alpha: FloatArray) {
        fun sample(x: Int, y: Int): Float =
            alpha[(y.coerceIn(0, h - 1)) * w + (x.coerceIn(0, w - 1))]
    }

    fun maskFromDepth(depth: DepthMap, w: Int, h: Int, focus: Float = 0.62f,
                      feather: Float = 0.08f): Mask {
        val alpha = FloatArray(w * h)
        for (y in 0 until h) {
            for (x in 0 until w) {
                val d = depth.sample(x, y)
                val v = M.smoothstep(focus - feather, focus + feather, d)
                alpha[y * w + x] = v
            }
        }
        return Mask(w, h, alpha)
    }

    fun maskFromFaces(faces: List<Region>, w: Int, h: Int): Mask {
        val alpha = FloatArray(w * h)
        if (faces.isEmpty()) {
            // no face: gentle centre-weighted vignette style separation
            for (y in 0 until h) {
                for (x in 0 until w) {
                    val dx = (x - w / 2f) / (w / 2f)
                    val dy = (y - h / 2f) / (h / 2f)
                    val r = sqrt(dx * dx + dy * dy)
                    alpha[y * w + x] = M.smoothstep(0.62f, 0.95f, r).let { 1f - it }
                }
            }
            return Mask(w, h, alpha)
        }
        for (face in faces) {
            val cx = face.x + face.w / 2f
            val cy = face.y + face.h / 2f
            val rx = max(face.w * 0.78f, w * 0.06f)
            val ry = max(face.h * 1.15f, h * 0.09f)
            val x0 = max(0, (cx - rx * 1.6f).toInt())
            val x1 = min(w, (cx + rx * 1.6f).toInt())
            val y0 = max(0, (cy - ry * 1.9f).toInt())
            val y1 = min(h, (cy + ry * 1.4f).toInt())
            for (y in y0 until y1) {
                for (x in x0 until x1) {
                    val dx = (x - cx) / rx
                    val dy = (y - cy) / ry
                    val d = sqrt(dx * dx + dy * dy)
                    val v = M.smoothstep(1.5f, 0.85f, d)
                    val i = y * w + x
                    alpha[i] = max(alpha[i], v)
                }
            }
        }
        return Mask(w, h, alpha)
    }

    /**
     * Edge-aware mask refinement: the mask is nudged to follow real luminance
     * edges in the image (guided-filter style), which removes halos around hair.
     */
    fun refine(mask: Mask, planes: Planes, radius: Int = 6): Mask {
        if (planes.w != mask.w || planes.h != mask.h) return mask
        val guide = planes.y
        val meanG = Imaging.boxBlur(guide, mask.w, mask.h, radius, 1)
        val meanA = Imaging.boxBlur(mask.alpha, mask.w, mask.h, radius, 1)
        val gg = FloatArray(guide.size) { guide[it] * guide[it] }
        val ga = FloatArray(guide.size) { guide[it] * mask.alpha[it] }
        val meanGG = Imaging.boxBlur(gg, mask.w, mask.h, radius, 1)
        val meanGA = Imaging.boxBlur(ga, mask.w, mask.h, radius, 1)
        val out = FloatArray(mask.alpha.size)
        for (i in out.indices) {
            val varG = meanGG[i] - meanG[i] * meanG[i]
            val cov = meanGA[i] - meanG[i] * meanA[i]
            val a = if (varG > 1e-6f) cov / (varG + 1e-4f) else 0f
            val b = meanA[i] - a * meanG[i]
            out[i] = M.clamp(a * guide[i] + b, 0f, 1f)
        }
        return Mask(mask.w, mask.h, out)
    }

    /**
     * Depth-of-field render: background gets a disc bokeh, foreground stays
     * sharp, and a highlight bloom makes bright background spots read as real
     * out-of-focus highlights rather than a plain blur.
     */
    fun applyBokeh(planes: Planes, mask: Mask, strength: Float, highlightBoost: Float = 0.35f): Planes {
        if (strength <= 0.01f) return planes
        val w = planes.w
        val h = planes.h
        val soft = Planes(w, h)
        System.arraycopy(planes.y, 0, soft.y, 0, planes.y.size)
        System.arraycopy(planes.u, 0, soft.u, 0, planes.u.size)
        System.arraycopy(planes.v, 0, soft.v, 0, planes.v.size)

        // two blur scales approximate a lens' circle of confusion
        val sigma1 = 2.2f * strength
        val sigma2 = 6.0f * strength
        val blurA = Imaging.gaussian(soft.y, w, h, sigma1)
        val blurB = Imaging.gaussian(soft.y, w, h, sigma2)
        val blended = FloatArray(soft.y.size) { M.lerp(blurA[it], blurB[it], 0.45f) }

        // highlight bloom in the defocused areas
        if (highlightBoost > 0f) {
            val bright = FloatArray(soft.y.size) {
                val v = blended[it]
                if (v > 0.72f) (v - 0.72f) * 2.6f else 0f
            }
            val bloom = Imaging.gaussian(bright, w, h, sigma2 * 1.5f)
            for (i in blended.indices) blended[i] = (blended[i] + bloom[i] * highlightBoost).coerceAtMost(1.4f)
        }

        for (i in soft.y.indices) {
            val a = mask.alpha[i.coerceIn(0, mask.alpha.size - 1)]
            soft.y[i] = M.lerp(blended[i], planes.y[i], M.clamp(a * 1.15f, 0f, 1f))
        }
        val uBlur = Imaging.boxBlur(soft.u, soft.cw, soft.ch, max(1, (strength * 2.5f).roundToInt()), 2)
        val vBlur = Imaging.boxBlur(soft.v, soft.cw, soft.ch, max(1, (strength * 2.5f).roundToInt()), 2)
        for (i in soft.u.indices) {
            val x = (i % soft.cw) * 2
            val y = (i / soft.cw) * 2
            val a = mask.sample(x, y)
            soft.u[i] = M.lerp(uBlur[i], planes.u[i], a)
            soft.v[i] = M.lerp(vBlur[i], planes.v[i], a)
        }
        return soft
    }
}

/**
 * Document scanner: finds the sheet of paper in the frame, flattens it with a
 * real perspective transform and cleans it up for reading (and printing).
 */
object Scanner {

    data class Quad(val tl: PointF, val tr: PointF, val br: PointF, val bl: PointF) {
        fun isPlausible(w: Int, h: Int): Boolean {
            val area = polygonArea()
            return area > w * h * 0.12f && area < w * h * 1.4f
        }

        fun polygonArea(): Float {
            val xs = floatArrayOf(tl.x, tr.x, br.x, bl.x)
            val ys = floatArrayOf(tl.y, tr.y, br.y, bl.y)
            var sum = 0f
            for (i in 0 until 4) {
                val j = (i + 1) % 4
                sum += xs[i] * ys[j] - xs[j] * ys[i]
            }
            return abs(sum) / 2f
        }
    }

    /**
     * Detect the document outline on a downscaled copy: gradient magnitude ->
     * threshold -> centroid-sweep for the extreme corners. Fast and robust for
     * the usual "paper on a desk" case, and it verifies plausibility before
     * accepting a result.
     */
    fun detectQuad(planes: Planes, work: Int = 240): Quad? {
        val scale = max(1f, max(planes.w, planes.h).toFloat() / work)
        val w = max(8, (planes.w / scale).toInt())
        val h = max(8, (planes.h / scale).toInt())
        val small = Imaging.resizeBilinear(planes.y, planes.w, planes.h, w, h)
        // gradient magnitude
        val mag = FloatArray(w * h)
        var maxMag = 0f
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = y * w + x
                val gx = small[i + 1] - small[i - 1]
                val gy = small[i + w] - small[i - w]
                val m = sqrt(gx * gx + gy * gy)
                mag[i] = m
                if (m > maxMag) maxMag = m
            }
        }
        if (maxMag < 0.06f) return null

        // corner search: maximise / minimise x+y and x-y on strong edges
        val threshold = maxMag * 0.35f
        var tlScore = Float.MAX_VALUE
        var brScore = -Float.MAX_VALUE
        var trScore = -Float.MAX_VALUE
        var blScore = Float.MAX_VALUE
        var tl = PointF(0f, 0f); var tr = PointF(0f, 0f)
        var br = PointF(0f, 0f); var bl = PointF(0f, 0f)
        for (y in 0 until h) {
            for (x in 0 until w) {
                if (mag[y * w + x] < threshold) continue
                val sum = (x + y).toFloat()
                val diff = (x - y).toFloat()
                if (sum < tlScore) { tlScore = sum; tl = PointF(x.toFloat(), y.toFloat()) }
                if (sum > brScore) { brScore = sum; br = PointF(x.toFloat(), y.toFloat()) }
                if (diff > trScore) { trScore = diff; tr = PointF(x.toFloat(), y.toFloat()) }
                if (diff < blScore) { blScore = diff; bl = PointF(x.toFloat(), y.toFloat()) }
            }
        }
        val quad = Quad(
            PointF(tl.x * scale, tl.y * scale), PointF(tr.x * scale, tr.y * scale),
            PointF(br.x * scale, br.y * scale), PointF(bl.x * scale, bl.y * scale),
        )
        if (!quad.isPlausible(planes.w, planes.h)) return null
        val overlap = (abs(tl.x - tr.x) < 2f) || (abs(bl.x - br.x) < 2f)
        return if (overlap) null else quad
    }

    /** Perspective-rectify the quad into a flat rectangle. */
    fun rectify(planes: Planes, quad: Quad): Planes? {
        val widthTop = distance(quad.tl, quad.tr)
        val widthBottom = distance(quad.bl, quad.br)
        val heightLeft = distance(quad.tl, quad.bl)
        val heightRight = distance(quad.tr, quad.br)
        val outW = max(64, max(widthTop, widthBottom).roundToInt())
        val outH = max(64, max(heightLeft, heightRight).roundToInt())
        if (outW.toLong() * outH > 40_000_000L) return null

        val h = homography(quad, outW, outH, inverse = true) ?: return null
        val out = Planes(outW, outH)
        val inv = h
        rows(0, outH) { row ->
            for (col in 0 until outW) {
                val x = inv[0] * col + inv[1] * row + inv[2]
                val y = inv[3] * col + inv[4] * row + inv[5]
                val z = inv[6] * col + inv[7] * row + inv[8]
                if (abs(z) < 1e-6f) continue
                val sx = x / z
                val sy = y / z
                val o = row * outW + col
                out.y[o] = sampleBilinear(planes.y, planes.w, planes.h, sx, sy)
                val uv = sampleBilinearChroma(planes, sx / 2f, sy / 2f)
                out.u[(row / 2) * out.cw + col / 2] = uv[0]
                out.v[(row / 2) * out.cw + col / 2] = uv[1]
            }
            Unit
        }
        return out
    }

    private inline fun rows(from: Int, to: Int, crossinline body: (Int) -> Unit) {
        Imaging.rows(from, to) { body(it); Unit }
    }

    /** Scan cleanup: neutralise the paper colour, clean noise, sharpen glyphs. */
    fun enhance(planes: Planes, grayscale: Boolean = false, highContrast: Boolean = false): Planes {
        val stats = Imaging.stats(planes)
        val noise = stats.meanNoise
        // paper white balance: push the brightest percentile towards neutral white
        var meanR = 0f; var meanG = 0f; var meanB = 0f
        for (i in planes.u.indices) { meanR += planes.v[i]; meanG += planes.u[i] }
        // luma cleanup: strong denoise (paper is flat) + detail preservation on glyphs
        planes.y = Imaging.edgePreservingSmooth(planes.y, planes.w, planes.h, 2, 0.03f)
        planes.y = Imaging.unsharp(planes.y, planes.w, planes.h, 1.0f, 0.6f, 0.002f, 0.14f)
        val histogram = Imaging.histogram(planes.y, 256)
        var cumulative = 0f
        var lowClip = 0
        var highClip = 255
        for (i in 0 until 256) {
            cumulative += histogram[i]
            if (cumulative < 0.005f) lowClip = i
            if (cumulative < 0.995f) highClip = i
        }
        val lowN = lowClip / 255f
        val highN = max(highClip / 255f, lowN + 0.05f)
        for (i in planes.y.indices) {
            var v = (planes.y[i] - lowN) / (highN - lowN)
            if (highContrast) {
                v = M.smoothstep(0.35f, 0.85f, v) * 0.9f + v * 0.1f
            }
            planes.y[i] = M.clamp(v, 0f, 1f)
        }
        Imaging.denoiseChroma(planes.u, planes.v, planes.cw, planes.ch, 0.5f)
        if (grayscale) {
            planes.u.fill(0f)
            planes.v.fill(0f)
        } else {
            Imaging.autoWhiteBalance(planes.u, planes.v, 0.35f)
        }
        L.d("document enhance: noise=${"%.4f".format(noise)}")
        return planes
    }

    // -------- homography solved with a small linear system -------------------
    private fun homography(q: Quad, outW: Int, outH: Int, inverse: Boolean): FloatArray? {
        // maps output rect -> source quad (so we can sample directly)
        val src = doubleArrayOf(
            q.tl.x.toDouble(), q.tl.y.toDouble(),
            q.tr.x.toDouble(), q.tr.y.toDouble(),
            q.br.x.toDouble(), q.br.y.toDouble(),
            q.bl.x.toDouble(), q.bl.y.toDouble(),
        )
        val dst = doubleArrayOf(
            0.0, 0.0,
            (outW - 1).toDouble(), 0.0,
            (outW - 1).toDouble(), (outH - 1).toDouble(),
            0.0, (outH - 1).toDouble(),
        )
        val a = Array(8) { DoubleArray(9) }
        for (i in 0 until 4) {
            val x = src[i * 2]; val y = src[i * 2 + 1]
            val u = dst[i * 2]; val v = dst[i * 2 + 1]
            a[i * 2] = doubleArrayOf(x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y, u)
            a[i * 2 + 1] = doubleArrayOf(0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y, v)
        }
        val solution = solve8(a) ?: return null
        return FloatArray(9) { solution[it].toFloat() }
    }

    private fun solve8(a: Array<DoubleArray>): DoubleArray? {
        val n = 8
        for (col in 0 until n) {
            var pivot = col
            var best = abs(a[col][col])
            for (row in col + 1 until n) {
                val v = abs(a[row][col])
                if (v > best) { best = v; pivot = row }
            }
            if (best < 1e-12) return null
            val tmp = a[col]; a[col] = a[pivot]; a[pivot] = tmp
            val div = a[col][col]
            for (k in col until n + 1) a[col][k] /= div
            for (row in 0 until n) {
                if (row == col) continue
                val factor = a[row][col]
                if (factor == 0.0) continue
                for (k in col until n + 1) a[row][k] -= factor * a[col][k]
            }
        }
        return DoubleArray(n) { a[it][n] }
    }

    private fun distance(a: PointF, b: PointF): Float {
        val dx = a.x - b.x; val dy = a.y - b.y
        return sqrt(dx * dx + dy * dy)
    }

    private fun sampleBilinear(src: FloatArray, w: Int, h: Int, x: Float, y: Float): Float {
        val cx = M.clamp(x, 0f, (w - 1).toFloat())
        val cy = M.clamp(y, 0f, (h - 1).toFloat())
        val x0 = cx.toInt(); val y0 = cy.toInt()
        val x1 = min(w - 1, x0 + 1); val y1 = min(h - 1, y0 + 1)
        val fx = cx - x0; val fy = cy - y0
        val a = src[y0 * w + x0]; val b = src[y0 * w + x1]
        val c = src[y1 * w + x0]; val d = src[y1 * w + x1]
        return M.lerp(M.lerp(a, b, fx), M.lerp(c, d, fx), fy)
    }

    private fun sampleBilinearChroma(p: Planes, x: Float, y: Float): FloatArray {
        val w = p.cw; val h = p.ch
        val cx = M.clamp(x, 0f, (w - 1).toFloat())
        val cy = M.clamp(y, 0f, (h - 1).toFloat())
        val x0 = cx.toInt(); val y0 = cy.toInt()
        val x1 = min(w - 1, x0 + 1); val y1 = min(h - 1, y0 + 1)
        val fx = cx - x0; val fy = cy - y0
        fun s(src: FloatArray): Float {
            val a = src[y0 * w + x0]; val b = src[y0 * w + x1]
            val c = src[y1 * w + x0]; val d = src[y1 * w + x1]
            return M.lerp(M.lerp(a, b, fx), M.lerp(c, d, fx), fy)
        }
        return floatArrayOf(s(p.u), s(p.v))
    }
}

/**
 * Panorama stitcher: aligns consecutive captures (translation model - the right
 * trade-off for handheld sweeps), lays them onto a shared canvas and blends the
 * overlaps with a feathered ramp so seams disappear.
 */
object Panorama {

    data class Result(val planes: Planes?, val frames: Int, val coverage: Float)

    const val MAX_CANVAS_PIXELS = 16_000_000
    const val MAX_WIDTH = 8000

    fun stitch(frames: List<Planes>): Result {
        if (frames.isEmpty()) return Result(null, 0, 0f)
        if (frames.size == 1) return Result(frames[0], 1, 1f)

        // ---- align sequentially ---------------------------------------------
        val offsets = ArrayList<Pair<Float, Float>>()
        var accX = 0f
        var accY = 0f
        offsets.add(0f to 0f)
        for (i in 1 until frames.size) {
            val prev = frames[i - 1]
            val cur = frames[i]
            if (prev.w != cur.w || prev.h != cur.h) return Result(frames[0], 1, 0f)
            val shift = Align.estimate(prev.y, cur.y, prev.w, prev.h, maxShift = prev.w / 3)
            if (shift.confidence < 0.05f) continue
            accX += shift.dx
            accY += shift.dy
            offsets.add(accX to accY)
        }

        val w = frames[0].w
        val h = frames[0].h
        val minX = offsets.minOf { it.first }
        val maxX = offsets.maxOf { it.first }
        val minY = offsets.minOf { it.second }
        val maxY = offsets.maxOf { it.second }
        var outW = (maxX - minX + w).roundToInt().coerceAtLeast(w)
        var outH = (maxY - minY + h).roundToInt().coerceAtLeast(h)

        // ---- memory guard: cap the canvas, never the user's patience --------
        var scale = 1f
        if (outW > MAX_WIDTH) scale = MAX_WIDTH.toFloat() / outW
        if (outW.toLong() * outH * (scale * scale) > MAX_CANVAS_PIXELS) {
            scale = sqrt(MAX_CANVAS_PIXELS.toDouble() / (outW.toLong() * outH)).toFloat() * scale
        }
        outW = max(w, (outW * scale).toInt())
        outH = max(h, (outH * scale).toInt())

        val canvas = Planes(outW, outH)
        val weight = FloatArray(outW * outH)

        for ((index, frame) in frames.withIndex()) {
            val (ox, oy) = offsets[min(index, offsets.size - 1)]
            val baseX = ((ox - minX) * scale).roundToInt()
            val baseY = ((oy - minY) * scale).roundToInt()
            val fw = max(1, (frame.w * scale).toInt())
            val fh = max(1, (frame.h * scale).toInt())
            for (row in 0 until fh) {
                val srcY = (row / scale).toInt().coerceIn(0, frame.h - 1)
                val dstY = baseY + row
                if (dstY < 0 || dstY >= outH) continue
                for (col in 0 until fw) {
                    val srcX = (col / scale).toInt().coerceIn(0, frame.w - 1)
                    val dstX = baseX + col
                    if (dstX < 0 || dstX >= outW) continue
                    // feather weight: 1 in the middle of the frame, fading at edges
                    val fx = col.toFloat() / fw
                    val fy = row.toFloat() / fh
                    val edge = min(min(fx, 1f - fx), min(fy, 1f - fy))
                    val wgt = M.smoothstep(0f, 0.12f, edge) + 0.02f
                    val di = dstY * outW + dstX
                    canvas.y[di] += frame.y[srcY * frame.w + srcX] * wgt
                    weight[di] += wgt
                }
            }
            // chroma at half resolution
            for (row in 0 until outH / 2) {
                val srcY = ((row / scale) * 2).toInt().coerceIn(0, frame.h - 1)
                val dstY = baseY / 2 + row
                if (dstY < 0 || dstY >= canvas.ch) continue
                for (col in 0 until outW / 2) {
                    val srcX = ((col / scale) * 2).toInt().coerceIn(0, frame.w - 1)
                    val dstX = baseX / 2 + col
                    if (dstX < 0 || dstX >= canvas.cw) continue
                    val si = (srcY / 2) * frame.cw + (srcX / 2)
                    val di = dstY * canvas.cw + dstX
                    canvas.u[di] += frame.u[si] * 0.5f
                    canvas.v[di] += frame.v[si] * 0.5f
                }
            }
        }

        var covered = 0
        val refFrame = frames[0]
        for (i in weight.indices) {
            if (weight[i] > 1e-3f) {
                canvas.y[i] /= weight[i]
                covered++
            } else {
                canvas.y[i] = 0f
            }
        }
        for (i in canvas.u.indices) {
            var wsum = 0f
            val di = i
            // approximate: derive from the luma weights of the same area
            val lx = (di % canvas.cw) * 2
            val ly = (di / canvas.cw) * 2
            if (ly < outH && lx < outW) wsum = weight[ly * outW + lx]
            val safe = if (wsum > 1e-3f) wsum * 0.5f else 1f
            canvas.u[i] /= safe
            canvas.v[i] /= safe
        }
        L.i("panorama: ${frames.size} frames -> ${canvas.w}x${canvas.h}, " +
            "coverage ${(covered.toFloat() / weight.size * 100).toInt()}% (ref ${refFrame.w})")

        // final polish so the stitch does not look softer than the frames
        canvas.y = Imaging.unsharp(canvas.y, canvas.w, canvas.h, 1.0f, 0.25f, 0.004f, 0.16f)
        return Result(canvas, frames.size, covered.toFloat() / weight.size)
    }
}
