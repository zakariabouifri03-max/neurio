package com.aivision.camera.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.os.Environment
import android.util.Log
import android.util.Size
import android.util.TypedValue
import android.view.View
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Centralised logging. */
object L {
    private const val TAG = "AIVision"
    var verbose = true

    fun d(msg: String) { if (verbose) Log.d(TAG, msg) }
    fun i(msg: String) = Log.i(TAG, msg)
    fun w(msg: String, t: Throwable? = null) { if (t == null) Log.w(TAG, msg) else Log.w(TAG, msg, t) }
    fun e(msg: String, t: Throwable? = null) { if (t == null) Log.e(TAG, msg) else Log.e(TAG, msg, t) }
}

/** Shared executors: heavy image work runs off the UI thread, in parallel. */
object Work {
    val cores: Int = Runtime.getRuntime().availableProcessors().coerceIn(1, 8)

    private fun factory(name: String) = object : ThreadFactory {
        private val n = AtomicInteger(1)
        override fun newThread(r: Runnable): Thread {
            val t = Thread(r, "$name-${n.getAndIncrement()}")
            t.priority = Thread.NORM_PRIORITY + 1
            return t
        }
    }

    /** CPU pool used for pixel processing (tiled + row-parallel). */
    val processor = Executors.newFixedThreadPool(cores.coerceAtMost(6), factory("aiv-work"))

    /** Single-thread queue for serialising camera + save operations. */
    val serial = Executors.newSingleThreadExecutor(factory("aiv-serial"))

    /** Small pool for thumbnails / MediaStore queries. */
    val io = Executors.newFixedThreadPool(2, factory("aiv-io"))
}

object Ui {
    fun dp(ctx: Context, v: Float): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics).roundToInt()

    fun sp(ctx: Context, v: Float): Float =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, ctx.resources.displayMetrics)
}

/** Maths helpers used across the imaging code. */
object M {
    fun clamp(v: Float, lo: Float, hi: Float) = if (v < lo) lo else if (v > hi) hi else v
    fun clamp(v: Int, lo: Int, hi: Int) = if (v < lo) lo else if (v > hi) hi else v
    fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t
    fun smoothstep(edge0: Float, edge1: Float, x: Float): Float {
        val t = clamp((x - edge0) / (edge1 - edge0 + 1e-6f), 0f, 1f)
        return t * t * (3f - 2f * t)
    }
    /** Fast gaussian-ish weight for bilateral style filters. */
    fun gauss(d2: Float, sigma: Float): Float = exp(-d2 / (2f * sigma * sigma + 1e-6f))
    fun luminance(r: Int, g: Int, b: Int): Float = (0.2126f * r + 0.7152f * g + 0.0722f * b)
    fun argb(a: Int, r: Int, g: Int, b: Int) =
        (a shl 24) or (r.coerceIn(0, 255) shl 16) or (g.coerceIn(0, 255) shl 8) or b.coerceIn(0, 255)
    fun pow22(x: Float) = x * x
}

/** Colour helpers (HSV + simple tone curves). */
object Col {
    fun rgbToHsv(r: Float, g: Float, b: Float, out: FloatArray) {
        val max = max(r, max(g, b)); val min = min(r, min(g, b)); val d = max - min
        out[2] = max
        out[1] = if (max <= 0f) 0f else d / max
        out[0] = when {
            d == 0f -> 0f
            max == r -> 60f * (((g - b) / d) % 6f)
            max == g -> 60f * (((b - r) / d) + 2f)
            else -> 60f * (((r - g) / d) + 4f)
        }.let { if (it < 0) it + 360f else it }
    }

    fun hsvToRgb(h: Float, s: Float, v: Float, out: FloatArray) {
        val c = v * s
        val hp = (h % 360f) / 60f
        val x = c * (1 - abs(hp % 2f - 1))
        val (r1, g1, b1) = when (hp.toInt()) {
            0 -> Triple(c, x, 0f); 1 -> Triple(x, c, 0f); 2 -> Triple(0f, c, x)
            3 -> Triple(0f, x, c); 4 -> Triple(x, 0f, c); else -> Triple(c, 0f, x)
        }
        val m = v - c
        out[0] = r1 + m; out[1] = g1 + m; out[2] = b1 + m
    }
}

/**
 * Planar YUV (NV-ish) container used by the AI pipeline. Kept as three planes so
 * the processing code can work on luma alone for most stages (fast + memory light).
 */
class YuvFrame(
    val width: Int,
    val height: Int,
    val y: ByteArray,
    val u: ByteArray,
    val v: ByteArray,
    val yRowStride: Int,
    val uvRowStride: Int,
    val uvPixelStride: Int,
) {
    val luma: FloatArray by lazy(LazyThreadSafetyMode.NONE) {
        val out = FloatArray(width * height)
        var i = 0
        for (row in 0 until height) {
            val base = row * yRowStride
            for (col in 0 until width) out[i++] = (y[base + col].toInt() and 0xFF) / 255f
        }
        out
    }

    /** Full-resolution ARGB bitmap (used after enhancement). */
    fun toBitmap(): Bitmap {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(width * height)
        var i = 0
        for (row in 0 until height) {
            val yBase = row * yRowStride
            val uvBase = (row / 2) * uvRowStride
            for (col in 0 until width) {
                val yy = (y[yBase + col].toInt() and 0xFF)
                val uvIdx = uvBase + (col / 2) * uvPixelStride
                val uu = (u[uvIdx.coerceIn(0, u.size - 1)].toInt() and 0xFF) - 128
                val vv = (v[uvIdx.coerceIn(0, v.size - 1)].toInt() and 0xFF) - 128
                val yf = yy - 16
                val r = (1.164f * yf + 1.596f * vv)
                val g = (1.164f * yf - 0.392f * uu - 0.813f * vv)
                val b = (1.164f * yf + 2.017f * uu)
                pixels[i++] = M.argb(255, r.toInt(), g.toInt(), b.toInt())
            }
        }
        bmp.setPixels(pixels, 0, width, 0, 0, width, height)
        return bmp
    }
}

/** Storage helpers - images/videos go through MediaStore so they show in any gallery. */
object Storage {
    fun appDir(ctx: Context): File {
        val dir = File(ctx.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "AIVision")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    fun tempFile(ctx: Context, name: String): File {
        val dir = File(ctx.cacheDir, "work")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, name)
    }

    fun humanSize(bytes: Long): String = when {
        bytes >= 1_000_000_000 -> "%.2f GB".format(bytes / 1_000_000_000.0)
        bytes >= 1_000_000 -> "%.1f MB".format(bytes / 1_000_000.0)
        bytes >= 1_000 -> "%.0f KB".format(bytes / 1_000.0)
        else -> "$bytes B"
    }
}

/** Geometry helpers for view/touch math. */
object Geo {
    fun fitCenter(srcW: Int, srcH: Int, dstW: Int, dstH: Int): RectF {
        if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return RectF()
        val scale = min(dstW.toFloat() / srcW, dstH.toFloat() / srcH)
        val w = srcW * scale
        val h = srcH * scale
        val l = (dstW - w) / 2f
        val t = (dstH - h) / 2f
        return RectF(l, t, l + w, t + h)
    }

    fun centerCropRect(src: Size, dst: Size): Rect {
        if (src.width <= 0 || src.height <= 0) return Rect(0, 0, dst.width, dst.height)
        val srcAspect = src.width.toFloat() / src.height
        val dstAspect = dst.width.toFloat() / dst.height
        return if (srcAspect > dstAspect) {
            val w = (src.height * dstAspect).roundToInt()
            val x = (src.width - w) / 2
            Rect(x, 0, x + w, src.height)
        } else {
            val h = (src.width / dstAspect).roundToInt()
            val y = (src.height - h) / 2
            Rect(0, y, src.width, y + h)
        }
    }
}

/** Rounded-rect + glow drawing used by the custom dark UI. */
object Draw {
    fun roundedFill(canvas: Canvas, paint: Paint, rect: RectF, radius: Float, color: Int) {
        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = color
        canvas.drawRoundRect(rect, radius, radius, paint)
    }

    fun ring(canvas: Canvas, paint: Paint, cx: Float, cy: Float, radius: Float,
             stroke: Float, color: Int, glow: Boolean = false) {
        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = stroke
        paint.color = color
        if (glow && Build.VERSION.SDK_INT >= 21) {
            paint.setShadowLayer(stroke * 2.2f, 0f, 0f, color)
        }
        canvas.drawCircle(cx, cy, radius, paint)
    }

    fun chevron(canvas: Canvas, paint: Paint, x: Float, y: Float, size: Float, color: Int, down: Boolean) {
        paint.reset(); paint.isAntiAlias = true; paint.style = Paint.Style.FILL; paint.color = color
        val p = android.graphics.Path()
        if (down) {
            p.moveTo(x - size, y - size / 2f); p.lineTo(x + size, y - size / 2f); p.lineTo(x, y + size / 2f)
        } else {
            p.moveTo(x - size, y + size / 2f); p.lineTo(x + size, y + size / 2f); p.lineTo(x, y - size / 2f)
        }
        p.close()
        canvas.drawPath(p, paint)
    }

    fun withAlpha(color: Int, alpha: Int): Int =
        Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
}

/** Bitmap utilities (scaling, rotation, memory-safe decode). */
object Img {
    fun rotate(bmp: Bitmap, degrees: Int): Bitmap {
        if (degrees % 360 == 0) return bmp
        val m = Matrix().apply { postRotate(degrees.toFloat()) }
        val out = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        if (out != bmp) bmp.recycle()
        return out
    }

    fun scale(bmp: Bitmap, dstW: Int, dstH: Int): Bitmap {
        if (bmp.width == dstW && bmp.height == dstH) return bmp
        val out = Bitmap.createScaledBitmap(bmp, dstW, dstH, true)
        if (out != bmp) bmp.recycle()
        return out
    }

    /** Sample size so the decoded bitmap stays under [maxPixels]. */
    fun sampleSize(w: Int, h: Int, maxPixels: Int): Int {
        var sample = 1
        while ((w / sample) * (h / sample) > maxPixels) sample *= 2
        return sample
    }

    fun downsample(src: Bitmap, factor: Int): Bitmap {
        if (factor <= 1) return src.copy(Bitmap.Config.ARGB_8888, false)
        val out = Bitmap.createScaledBitmap(src, max(1, src.width / factor), max(1, src.height / factor), true)
        return out
    }

    /** Luma plane (0..1) of an ARGB bitmap, downscaled by [factor]. */
    fun lumaOf(src: Bitmap, factor: Int = 1): FloatArray {
        val w = max(1, src.width / factor)
        val h = max(1, src.height / factor)
        val bmp = if (factor == 1) src else Bitmap.createScaledBitmap(src, w, h, true)
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        if (bmp != src) bmp.recycle()
        val out = FloatArray(w * h)
        for (i in px.indices) {
            val c = px[i]
            val r = (c shr 16) and 0xFF
            val g = (c shr 8) and 0xFF
            val b = c and 0xFF
            out[i] = (0.2126f * r + 0.7152f * g + 0.0722f * b) / 255f
        }
        return out
    }

    fun toIntArray(bmp: Bitmap): IntArray {
        val px = IntArray(bmp.width * bmp.height)
        bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        return px
    }

    fun fromIntArray(px: IntArray, w: Int, h: Int): Bitmap {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setPixels(px, 0, w, 0, 0, w, h)
        return bmp
    }
}

/** Simple exponential smoothing used by focus/zoom animations. */
class Smoother(private var value: Float = 0f, private val rate: Float = 0.25f) {
    fun set(v: Float) { value = v }
    fun target(v: Float): Float {
        value += (v - value) * rate
        return value
    }
    fun current() = value
}

/** Single-producer/single-consumer ring buffer for burst frames. */
class FrameRing(private val capacity: Int) {
    private val items = arrayOfNulls<Any?>(capacity)
    private var head = 0
    private var count = 0
    @Synchronized fun push(item: Any?) {
        items[head] = item
        head = (head + 1) % capacity
        if (count < capacity) count++
    }
    @Synchronized fun snapshot(): List<Any?> = (0 until count).map { items[(head - count + it + capacity) % capacity] }
    @Synchronized fun clear() { items.fill(null); head = 0; count = 0 }
}

/** Small helper view for scrims used in the premium dark UI. */
fun View.setVisible(visible: Boolean, animate: Boolean = false) {
    if (animate) {
        this.animate().cancel()
        if (visible) {
            if (this.visibility != View.VISIBLE) this.alpha = 0f
            this.visibility = View.VISIBLE
            this.animate().alpha(1f).setDuration(140).start()
        } else {
            this.animate().alpha(0f).setDuration(140).withEndAction { this.visibility = View.GONE }.start()
        }
    } else {
        this.visibility = if (visible) View.VISIBLE else View.GONE
    }
}

fun FloatArray.mean(): Float = if (isEmpty()) 0f else sum() / size

fun sigmoid(x: Float, k: Float = 1f, x0: Float = 0f) = 1f / (1f + exp(-k * (x - x0)))

fun Float.powf(p: Float) = this.toDouble().pow(p.toDouble()).toFloat()

fun hypot(x: Float, y: Float) = sqrt(x * x + y * y)
