package com.aivision.camera.ai

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.Image
import com.aivision.camera.core.L
import com.aivision.camera.core.M
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Working image format of the AI pipeline: planar, float, full chroma-aware.
 *
 * Luma is kept at full resolution, chroma at quarter resolution (4:2:0) which is
 * exactly what the camera gives us and exactly what JPEG wants back. Working in
 * planes instead of ARGB halves memory traffic and lets the detail stages run on
 * luma alone - which is what actually matters for perceived sharpness.
 */
class Planes(val w: Int, val h: Int) {
    var y = FloatArray(w * h)
    val cw = max(1, w / 2)
    val ch = max(1, h / 2)
    var u = FloatArray(cw * ch)
    var v = FloatArray(cw * ch)

    val pixels: Int get() = w * h

    fun copyOf(): Planes {
        val p = Planes(w, h)
        System.arraycopy(y, 0, p.y, 0, y.size)
        System.arraycopy(u, 0, p.u, 0, u.size)
        System.arraycopy(v, 0, p.v, 0, v.size)
        return p
    }

    fun recycle() {
        // FloatArrays are GC'd; nothing to free explicitly, kept for symmetry.
    }

    companion object {
        /** Straight from a camera YUV_420_888 / DEPTH16 / RAW image. */
        fun fromImage(image: Image): Planes? {
            try {
                val w = image.width
                val h = image.height
                when (image.format) {
                    ImageFormat.YUV_420_888 -> {
                        val out = Planes(w, h)
                        val yPlane = image.planes[0]
                        val uPlane = image.planes[1]
                        val vPlane = image.planes[2]
                        val yBuf = yPlane.buffer
                        val uBuf = uPlane.buffer
                        val vBuf = vPlane.buffer
                        val yRow = yPlane.rowStride
                        val yPix = yPlane.pixelStride
                        val uRow = uPlane.rowStride
                        val uPix = uPlane.pixelStride
                        val vRow = vPlane.rowStride
                        val vPix = vPlane.pixelStride
                        val yBytes = ByteArray(yBuf.remaining())
                        yBuf.get(yBytes)
                        var i = 0
                        for (row in 0 until h) {
                            val rowBase = row * yRow
                            for (col in 0 until w) {
                                val idx = rowBase + col * yPix
                                out.y[i++] = if (idx < yBytes.size) (yBytes[idx].toInt() and 0xFF) / 255f else 0f
                            }
                        }
                        val uw = out.cw
                        val uh = out.ch
                        val uBytes = ByteArray(uBuf.remaining())
                        uBuf.get(uBytes)
                        val vBytes = ByteArray(vBuf.remaining())
                        vBuf.get(vBytes)
                        for (row in 0 until uh) {
                            val uBase = row * uRow
                            val vBase = row * vRow
                            for (col in 0 until uw) {
                                val ui = uBase + col * uPix
                                val vi = vBase + col * vPix
                                val o = row * uw + col
                                out.u[o] = ((if (ui < uBytes.size) (uBytes[ui].toInt() and 0xFF) else 128) - 128) / 255f
                                out.v[o] = ((if (vi < vBytes.size) (vBytes[vi].toInt() and 0xFF) else 128) - 128) / 255f
                            }
                        }
                        return out
                    }
                    ImageFormat.RAW_SENSOR, ImageFormat.DEPTH16 -> {
                        // Bayer/depth content: handled by their own consumers
                        return null
                    }
                    else -> return null
                }
            } catch (t: Throwable) {
                L.w("fromImage failed: ${t.message}")
                return null
            }
        }

        /** From a decoded JPEG/PNG bitmap (gallery re-processing). */
        fun fromBitmap(bmp: Bitmap): Planes {
            val w = bmp.width
            val h = bmp.height
            val out = Planes(w, h)
            val px = IntArray(w * h)
            bmp.getPixels(px, 0, w, 0, 0, w, h)
            val uw = out.cw
            val uh = out.ch
            for (row in 0 until h) {
                for (col in 0 until w) {
                    val c = px[row * w + col]
                    val r = ((c shr 16) and 0xFF) / 255f
                    val g = ((c shr 8) and 0xFF) / 255f
                    val b = (c and 0xFF) / 255f
                    // BT.601 limited range, matching camera YUV conventions
                    val yy = 0.299f * r + 0.587f * g + 0.114f * b
                    out.y[row * w + col] = (yy * 0.859f) + 0.0625f
                    val uu = -0.168736f * r - 0.331264f * g + 0.5f * b
                    val vv = 0.5f * r - 0.418688f * g - 0.081312f * b
                    if (row % 2 == 0 && col % 2 == 0) {
                        val o = (row / 2) * uw + col / 2
                        out.u[o] = uu
                        out.v[o] = vv
                    }
                }
            }
            return out
        }
    }

    /** Luma at a pixel (0..1). */
    fun lumaAt(x: Int, row: Int): Float =
        y[minOf(y.size - 1, max(0, row * w + x))]

    /** NV21 (YUV420sp) byte array - the layout YuvImage/JPEG encoders want. */
    fun toNv21(): ByteArray {
        val out = ByteArray(w * h + 2 * cw * ch)
        var i = 0
        for (idx in 0 until w * h) {
            val value = (y[idx] * 255f).roundToInt().coerceIn(0, 255)
            out[i++] = value.toByte()
        }
        for (row in 0 until ch) {
            for (col in 0 until cw) {
                val o = row * cw + col
                val uVal = (u[o] * 255f + 128f).roundToInt().coerceIn(0, 255)
                val vVal = (v[o] * 255f + 128f).roundToInt().coerceIn(0, 255)
                out[i++] = uVal.toByte()
                out[i++] = vVal.toByte()
            }
        }
        return out
    }

    /** ARGB bitmap, optionally downscaled to keep memory sane for previews. */
    fun toBitmap(maxDim: Int = 0): Bitmap {
        val step = if (maxDim > 0 && max(w, h) > maxDim) {
            max(1, (max(w, h).toFloat() / maxDim).ceilInt())
        } else 1
        val outW = max(1, w / step)
        val outH = max(1, h / step)
        val px = IntArray(outW * outH)
        var o = 0
        for (row in 0 until outH) {
            val sy = (row * step).coerceAtMost(h - 1)
            for (col in 0 until outW) {
                val sx = (col * step).coerceAtMost(w - 1)
                val yy = y[sy * w + sx]
                val uvIdx = (sy / 2) * cw + (sx / 2)
                val uu = u[uvIdx]
                val vv = v[uvIdx]
                // limited range ITU-R BT.601 -> RGB
                val yl = (yy - 0.0625f) / 0.859f
                val r = yl + 1.402f * vv
                val g = yl - 0.344136f * uu - 0.714136f * vv
                val b = yl + 1.772f * uu
                px[o++] = M.argb(255, (r * 255f).roundToInt(), (g * 255f).roundToInt(), (b * 255f).roundToInt())
            }
        }
        val bmp = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
        bmp.setPixels(px, 0, outW, 0, 0, outW, outH)
        return bmp
    }
}

fun Float.ceilInt(): Int = kotlin.math.ceil(this).toInt()

/** Depth map attached to a capture (from the depth stream or computed). */
class DepthMap(val w: Int, val h: Int, val depth: FloatArray) {
    fun sample(x: Int, y: Int): Float {
        val cx = ((x.toFloat() / w) * this.w).toInt().coerceIn(0, this.w - 1)
        val cy = ((y.toFloat() / h) * this.h).toInt().coerceIn(0, this.h - 1)
        return depth[cy * this.w + cx]
    }

    companion object {
        /** DEPTH16 image -> normalised near(1)..far(0) confidence map. */
        fun fromImage(image: Image): DepthMap? {
            return try {
                val w = image.width
                val h = image.height
                val plane = image.planes[0]
                val buf = plane.buffer
                val bytes = ByteArray(buf.remaining())
                buf.get(bytes)
                val rowStride = plane.rowStride
                val out = FloatArray(w * h)
                var minV = Int.MAX_VALUE
                var maxV = 0
                val raw = IntArray(w * h)
                for (row in 0 until h) {
                    val base = row * rowStride
                    for (col in 0 until w) {
                        val idx = base + col * 2
                        if (idx + 1 < bytes.size) {
                            val lo = bytes[idx].toInt() and 0xFF
                            val hi = bytes[idx + 1].toInt() and 0xFF
                            val value = lo or (hi shl 8)
                            raw[row * w + col] = value
                            if (value < minV) minV = value
                            if (value > maxV) maxV = value
                        }
                    }
                }
                val range = (maxV - minV).coerceAtLeast(1)
                for (i in raw.indices) {
                    // closer = brighter
                    out[i] = 1f - ((raw[i] - minV).toFloat() / range)
                }
                DepthMap(w, h, out)
            } catch (t: Throwable) {
                L.w("depth decode failed: ${t.message}")
                null
            }
        }
    }
}
