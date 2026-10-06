package com.aivision.camera.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.view.MotionEvent
import android.view.View
import com.aivision.camera.core.Draw
import com.aivision.camera.core.M
import com.aivision.camera.core.L
import com.aivision.camera.core.Ui
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Viewfinder overlay: composition grid, focus ring with lock animation, horizon
 * level, face boxes, AI status HUD and the processing indicator. Drawn in one
 * pass with a single Paint to stay cheap over a live camera preview.
 */
class ViewfinderOverlay(context: Context) : View(context) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()

    var gridMode = 1
    var showLevel = true
    var focusX = -1f
    var focusY = -1f
    var focusLocked = false
    var focusProgress = 0f
    var tiltDegrees = 0f
    var faces: List<Rect> = emptyList()
    var trackFaces = true

    var aiHeadline: String = ""
    var aiDetail: String = ""
    var sceneLine: String = ""
    var exposureLine: String = ""
    var zoomLabel: String = ""
    var zoomIsAi = false
    var processing: Boolean = false
    var processingStage: String = ""
    var processingProgress: Float = 0f
    var hint: String = ""

    private val density = resources.displayMetrics.density

    fun focusAt(x: Float, y: Float) {
        focusX = x
        focusY = y
        focusProgress = 0f
        invalidate()
    }

    fun clearFocusRing() {
        focusX = -1f
        focusY = -1f
        invalidate()
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        drawGrid(canvas, w, h)
        if (showLevel) drawLevel(canvas, w, h)
        drawFaces(canvas)
        drawFocus(canvas)
        drawHud(canvas, w, h)
        drawProcessing(canvas, w, h)
    }

    private fun drawGrid(canvas: Canvas, w: Float, h: Float) {
        if (gridMode <= 0) return
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1f * density
        paint.color = Draw.withAlpha(Color.WHITE, 46)
        when (gridMode) {
            1 -> {   // rule of thirds
                for (i in 1..2) {
                    val x = w * i / 3f
                    val y = h * i / 3f
                    canvas.drawLine(x, 0f, x, h, paint)
                    canvas.drawLine(0f, y, w, y, paint)
                }
            }
            2 -> {   // golden ratio
                val gx = w * 0.382f
                val gx2 = w * 0.618f
                val gy = h * 0.382f
                val gy2 = h * 0.618f
                canvas.drawLine(gx, 0f, gx, h, paint)
                canvas.drawLine(gx2, 0f, gx2, h, paint)
                canvas.drawLine(0f, gy, w, gy, paint)
                canvas.drawLine(0f, gy2, w, gy2, paint)
            }
            3 -> {   // square framing guide
                val size = min(w, h) * 0.92f
                val left = (w - size) / 2f
                val top = (h - size) / 2f
                canvas.drawRect(left, top, left + size, top + size, paint)
            }
        }
    }

    private fun drawLevel(canvas: Canvas, w: Float, h: Float) {
        if (abs(tiltDegrees) > 12f) return
        val cy = h * 0.5f
        val half = w * 0.14f
        val cx = w * 0.5f
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f * density
        val aligned = abs(tiltDegrees) < 1.2f
        paint.color = if (aligned) Theme.accent else Draw.withAlpha(Color.WHITE, 120)
        val offset = tiltDegrees / 12f * half * 0.5f
        canvas.drawLine(cx - half + offset, cy, cx - half * 0.18f + offset, cy, paint)
        canvas.drawLine(cx + half * 0.18f + offset, cy, cx + half + offset, cy, paint)
        if (aligned) {
            canvas.drawLine(cx - 6f * density, cy, cx + 6f * density, cy, paint)
        }
    }

    private fun drawFaces(canvas: Canvas) {
        if (!trackFaces || faces.isEmpty()) return
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.6f * density
        paint.color = Draw.withAlpha(Theme.accent, 170)
        for (r in faces) {
            val rect = RectF(r.left.toFloat(), r.top.toFloat(), r.right.toFloat(), r.bottom.toFloat())
            // corner brackets read better than full boxes over a busy preview
            val c = min(rect.width(), rect.height()) * 0.22f
            canvas.drawLine(rect.left, rect.top, rect.left + c, rect.top, paint)
            canvas.drawLine(rect.left, rect.top, rect.left, rect.top + c, paint)
            canvas.drawLine(rect.right, rect.top, rect.right - c, rect.top, paint)
            canvas.drawLine(rect.right, rect.top, rect.right, rect.top + c, paint)
            canvas.drawLine(rect.left, rect.bottom, rect.left + c, rect.bottom, paint)
            canvas.drawLine(rect.left, rect.bottom, rect.left, rect.bottom - c, paint)
            canvas.drawLine(rect.right, rect.bottom, rect.right - c, rect.bottom, paint)
            canvas.drawLine(rect.right, rect.bottom, rect.right, rect.bottom - c, paint)
        }
    }

    private fun drawFocus(canvas: Canvas) {
        val x = focusX
        val y = focusY
        if (x < 0 || y < 0) return
        val size = 34f * density * (1f + (1f - focusProgress) * 0.35f)
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f * density
        paint.color = if (focusLocked) Theme.ok else Color.WHITE
        canvas.drawRect(x - size, y - size, x + size, y + size, paint)
        paint.style = Paint.Style.FILL
        paint.color = Draw.withAlpha(if (focusLocked) Theme.ok else Theme.accent, 200)
        canvas.drawCircle(x, y, 3f * density, paint)
    }

    private fun drawHud(canvas: Canvas, w: Float, h: Float) {
        var y = 0f
        if (aiHeadline.isNotEmpty()) {
            val padding = 10f * density
            paint.reset(); paint.isAntiAlias = true
            paint.textSize = 12f * density
            val textWidth = paint.measureText(aiHeadline)
            val rect = RectF(12f * density, 8f * density, 12f * density + textWidth + padding * 2,
                8f * density + 24f * density)
            paint.style = Paint.Style.FILL
            paint.color = Draw.withAlpha(Theme.accentDim, 210)
            canvas.drawRoundRect(rect, rect.height() / 2f, rect.height() / 2f, paint)
            paint.color = Color.WHITE
            canvas.drawText(aiHeadline, rect.left + padding, rect.top + 16f * density, paint)
            y = rect.bottom
        }
        if (aiDetail.isNotEmpty() || sceneLine.isNotEmpty() || exposureLine.isNotEmpty()) {
            paint.reset(); paint.isAntiAlias = true
            paint.style = Paint.Style.FILL
            paint.textSize = 11f * density
            paint.color = Draw.withAlpha(Color.WHITE, 210)
            var lineY = max(y, 8f * density) + 18f * density
            if (aiDetail.isNotEmpty()) {
                canvas.drawText(aiDetail, 14f * density, lineY, paint)
                lineY += 15f * density
            }
            if (sceneLine.isNotEmpty()) {
                paint.color = Draw.withAlpha(Theme.accent, 230)
                canvas.drawText(sceneLine, 14f * density, lineY, paint)
                lineY += 15f * density
            }
            if (exposureLine.isNotEmpty()) {
                paint.color = Draw.withAlpha(Theme.textSecondary, 230)
                canvas.drawText(exposureLine, 14f * density, lineY, paint)
            }
        }
        if (zoomLabel.isNotEmpty()) {
            paint.reset(); paint.isAntiAlias = true
            paint.textSize = 13f * density
            paint.style = Paint.Style.FILL
            val label = zoomLabel
            val tw = paint.measureText(label)
            val cx = w / 2f
            val cy = h - 118f * density
            val rect = RectF(cx - tw / 2f - 12f * density, cy - 14f * density,
                cx + tw / 2f + 12f * density, cy + 10f * density)
            paint.color = Draw.withAlpha(if (zoomIsAi) Theme.ultra else Theme.surface, 200)
            canvas.drawRoundRect(rect, rect.height() / 2f, rect.height() / 2f, paint)
            paint.color = Color.WHITE
            canvas.drawText(label, cx - tw / 2f, cy + 4f * density, paint)
        }
        if (hint.isNotEmpty()) {
            paint.reset(); paint.isAntiAlias = true
            paint.textSize = 11.5f * density
            paint.style = Paint.Style.FILL
            paint.color = Draw.withAlpha(Color.WHITE, 230)
            val tw = paint.measureText(hint)
            val cx = w / 2f
            val cy = h * 0.72f
            paint.color = Draw.withAlpha(Theme.surface, 220)
            val rect = RectF(cx - tw / 2f - 14f * density, cy - 16f * density,
                cx + tw / 2f + 14f * density, cy + 12f * density)
            canvas.drawRoundRect(rect, rect.height() / 2f, rect.height() / 2f, paint)
            paint.color = Color.WHITE
            canvas.drawText(hint, cx - tw / 2f, cy + 4f * density, paint)
        }
    }

    private fun drawProcessing(canvas: Canvas, w: Float, h: Float) {
        if (!processing) return
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = Draw.withAlpha(Color.BLACK, 150)
        canvas.drawRect(0f, 0f, w, h, paint)

        val cx = w / 2f
        val cy = h / 2f
        val radius = 34f * density
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 3f * density
        paint.color = Draw.withAlpha(Color.WHITE, 60)
        canvas.drawCircle(cx, cy, radius, paint)
        paint.color = Theme.accent
        paint.strokeCap = Paint.Cap.ROUND
        canvas.drawArc(RectF(cx - radius, cy - radius, cx + radius, cy + radius),
            -90f, 360f * M.clamp(processingProgress, 0f, 1f), false, paint)
        paint.style = Paint.Style.FILL
        paint.textSize = 13f * density
        val text = processingStage.ifEmpty { "AI processing" }
        val tw = paint.measureText(text)
        canvas.drawText(text, cx - tw / 2f, cy + radius + 28f * density, paint)
    }
}

/** Big round shutter button with an AI glow when enhancement is enabled. */
class ShutterButton(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    var mode: String = "PHOTO"
    var recording = false
    var aiActive = true
    var busy = false

    init {
        setOnTouchListener { _, _ -> false }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = Ui.dp(context, 86f)
        setMeasuredDimension(size, size)
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val outer = min(width, height) / 2f - Ui.dp(context, 2f).toFloat()
        val ringColor = when {
            busy -> Theme.warning
            aiActive && !recording -> Theme.accent
            else -> Color.WHITE
        }
        Draw.ring(canvas, paint, cx, cy, outer, Ui.dp(context, 3f).toFloat(), ringColor, glow = aiActive)
        val innerRadius = when {
            recording -> Ui.dp(context, 20f).toFloat()
            mode == "VIDEO" -> Ui.dp(context, 28f).toFloat()
            else -> outer * 0.82f
        }
        val innerColor = when {
            recording -> Theme.danger
            mode == "VIDEO" -> Theme.warning
            else -> Color.WHITE
        }
        paint.reset(); paint.isAntiAlias = true
        if (recording) {
            paint.style = Paint.Style.FILL
            paint.color = innerColor
            val r = RectF(cx - innerRadius, cy - innerRadius, cx + innerRadius, cy + innerRadius)
            canvas.drawRoundRect(r, Ui.dp(context, 6f).toFloat(), Ui.dp(context, 6f).toFloat(), paint)
        } else {
            paint.style = Paint.Style.FILL
            paint.color = innerColor
            canvas.drawCircle(cx, cy, innerRadius, paint)
        }
        if (aiActive && !recording) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = Ui.dp(context, 1.5f).toFloat()
            paint.color = Draw.withAlpha(Theme.accent, 120)
            canvas.drawCircle(cx, cy, outer + Ui.dp(context, 5f).toFloat(), paint)
        }
    }
}

/** One tap per capture mode: PHOTO | VIDEO | PRO | NIGHT | AI. */
class ModeBar(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    var modes = listOf("PHOTO", "VIDEO", "PRO", "NIGHT", "AI")
    var selected = 0
        set(value) { field = value; invalidate() }
    var onSelect: ((String) -> Unit)? = null

    private val rects = ArrayList<RectF>()

    init {
        textPaint.textAlign = Paint.Align.CENTER
        isClickable = true
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(w, Ui.dp(context, 46f))
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        rects.clear()
        val padding = Ui.dp(context, 10f).toFloat()
        val available = w - padding * 2
        val itemWidth = available / modes.size
        for (i in modes.indices) {
            val left = padding + i * itemWidth
            rects.add(RectF(left, Ui.dp(context, 4f).toFloat(), left + itemWidth,
                h - Ui.dp(context, 4f).toFloat()))
        }
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        for (i in rects.indices) {
            val r = rects[i]
            val isSelected = i == selected
            paint.reset(); paint.isAntiAlias = true
            paint.style = Paint.Style.FILL
            paint.color = if (isSelected) {
                Draw.withAlpha(Theme.accent, 40)
            } else Color.TRANSPARENT
            if (isSelected) canvas.drawRoundRect(r, r.height() / 2f, r.height() / 2f, paint)

            textPaint.textSize = Ui.sp(context, 12f)
            textPaint.color = if (isSelected) Theme.accent else Draw.withAlpha(Color.WHITE, 165)
            textPaint.typeface = if (isSelected)
                android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
            else android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL)
            val baseline = r.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
            canvas.drawText(modes[i], r.centerX(), baseline, textPaint)

            if (isSelected) {
                paint.style = Paint.Style.FILL
                paint.color = Theme.accent
                val y = r.bottom - Ui.dp(context, 2f).toFloat()
                canvas.drawCircle(r.centerX(), y, Ui.dp(context, 2f).toFloat(), paint)
            }
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            for (i in rects.indices) {
                if (rects[i].contains(event.x, event.y)) {
                    if (i != selected) {
                        selected = i
                        onSelect?.invoke(modes[i])
                    }
                    return true
                }
            }
        }
        if (event.action == MotionEvent.ACTION_DOWN) return true
        return super.onTouchEvent(event)
    }
}

/** Glowing AI action buttons (AI ENHANCE / AI ULTRA). */
class AiActionButton(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    var title: String = "AI ENHANCE"
    var subtitle: String = ""
    var active = false
    var accentColor = Theme.accent
    var onToggle: ((Boolean) -> Unit)? = null

    init {
        textPaint.textAlign = Paint.Align.CENTER
        isClickable = true
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(w, Ui.dp(context, 40f))
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        val r = RectF(Ui.dp(context, 1f).toFloat(), Ui.dp(context, 1f).toFloat(),
            width - Ui.dp(context, 1f).toFloat(), height - Ui.dp(context, 1f).toFloat())
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = if (active) Draw.withAlpha(accentColor, 55) else Draw.withAlpha(Theme.surface, 190)
        canvas.drawRoundRect(r, r.height() / 2f, r.height() / 2f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = Ui.dp(context, 1.2f).toFloat()
        paint.color = if (active) accentColor else Draw.withAlpha(Color.WHITE, 60)
        if (active && android.os.Build.VERSION.SDK_INT >= 21) {
            paint.setShadowLayer(Ui.dp(context, 6f).toFloat(), 0f, 0f, accentColor)
        }
        canvas.drawRoundRect(r, r.height() / 2f, r.height() / 2f, paint)
        paint.clearShadowLayer()

        textPaint.textSize = Ui.sp(context, 12.5f)
        textPaint.color = if (active) Color.WHITE else Draw.withAlpha(Color.WHITE, 200)
        textPaint.typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
        textPaint.letterSpacing = 0.06f
        val baseline = r.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
        canvas.drawText(title, r.centerX(), baseline, textPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            active = !active
            invalidate()
            onToggle?.invoke(active)
            return true
        }
        return true
    }
}

/** Horizontal zoom dial with snap points for the optical lenses. */
class ZoomDial(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    var minZoom = 0.5f
    var maxZoom = 100f
    var zoom = 1f
        set(value) { field = value; invalidate() }
    var stops: List<Pair<String, Float>> = listOf("1" to 1f)
    var aiZoomActive = false
    var onZoomChange: ((Float) -> Unit)? = null

    private val stopRects = ArrayList<Pair<RectF, Float>>()

    init { textPaint.textAlign = Paint.Align.CENTER }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), Ui.dp(context, 42f))
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        stopRects.clear()
        if (stops.isEmpty()) return
        val itemWidth = w.toFloat() / stops.size
        for (i in stops.indices) {
            val left = i * itemWidth
            stopRects.add(RectF(left, 0f, left + itemWidth, h - Ui.dp(context, 10f).toFloat()) to stops[i].second)
        }
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = Draw.withAlpha(Theme.surface, 180)
        val track = RectF(0f, height - Ui.dp(context, 6f).toFloat(), width.toFloat(), height.toFloat())
        canvas.drawRoundRect(track, 3f, 3f, paint)

        // progress of the zoom within the dial's log scale
        val t = logScale(zoom)
        paint.color = if (aiZoomActive) Theme.ultra else Theme.accent
        val progress = RectF(0f, track.top, width * t, track.bottom)
        canvas.drawRoundRect(progress, 3f, 3f, paint)

        for ((rect, value) in stopRects) {
            val selected = abs(logScale(value) - t) < 0.02f
            textPaint.textSize = Ui.sp(context, if (selected) 13f else 12f)
            textPaint.color = if (selected) Color.WHITE else Draw.withAlpha(Color.WHITE, 170)
            textPaint.typeface = android.graphics.Typeface.create("sans-serif-medium",
                if (selected) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            val baseline = rect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
            val label = stops.first { it.second == value }.first
            canvas.drawText(if (label.endsWith("x")) label else "${label}×", rect.centerX(), baseline, textPaint)
        }
    }

    private fun logScale(z: Float): Float {
        val clamped = M.clamp(z, minZoom, maxZoom)
        val l = kotlin.math.ln(clamped.toDouble()).toFloat()
        val lo = kotlin.math.ln(minZoom.toDouble()).toFloat()
        val hi = kotlin.math.ln(maxZoom.toDouble()).toFloat()
        return M.clamp((l - lo) / (hi - lo), 0f, 1f)
    }

    fun zoomFromFraction(fraction: Float): Float {
        val lo = kotlin.math.ln(minZoom.toDouble()).toFloat()
        val hi = kotlin.math.ln(maxZoom.toDouble()).toFloat()
        val l = lo + (hi - lo) * M.clamp(fraction, 0f, 1f)
        return kotlin.math.exp(l.toDouble()).toFloat()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                // tapping a stop jumps to it, dragging scrubs continuously
                for ((rect, value) in stopRects) {
                    if (rect.contains(event.x, event.y)) {
                        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
                            zoom = value
                            onZoomChange?.invoke(value)
                            return true
                        }
                    }
                }
                val fraction = event.x / width.toFloat()
                val newZoom = zoomFromFraction(fraction)
                zoom = newZoom
                onZoomChange?.invoke(newZoom)
                return true
            }
        }
        return true
    }
}

/** Slider used by Pro mode and settings (with live value readout). */
class ProSlider(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    var label = "ISO"
    var value = 0.5f
    var displayValue = ""
    var accent = Theme.accent
    var auto = true
    var onValueChange: ((Float) -> Unit)? = null
    var onAutoToggle: (() -> Unit)? = null

    private val trackRect = RectF()
    private val autoRect = RectF()

    init { textPaint.textAlign = Paint.Align.CENTER }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), Ui.dp(context, 34f))
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val labelWidth = Ui.dp(context, 66f).toFloat()
        trackRect.set(labelWidth, h * 0.32f, w - Ui.dp(context, 76f).toFloat(), h * 0.68f)
        autoRect.set(w - Ui.dp(context, 66f).toFloat(), Ui.dp(context, 5f).toFloat(),
            w - Ui.dp(context, 6f).toFloat(), h - Ui.dp(context, 5f).toFloat())
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        textPaint.textSize = Ui.sp(context, 10.5f)
        textPaint.color = Draw.withAlpha(Color.WHITE, 190)
        textPaint.typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
        textPaint.textAlign = Paint.Align.LEFT
        val baseline = trackRect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
        canvas.drawText(label, 0f, baseline, textPaint)

        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = Draw.withAlpha(Color.WHITE, 40)
        canvas.drawRoundRect(trackRect, trackRect.height() / 2f, trackRect.height() / 2f, paint)
        paint.color = if (auto) Draw.withAlpha(accent, 120) else accent
        val filled = RectF(trackRect.left, trackRect.top,
            trackRect.left + trackRect.width() * M.clamp(value, 0f, 1f), trackRect.bottom)
        canvas.drawRoundRect(filled, filled.height() / 2f, filled.height() / 2f, paint)
        paint.color = Color.WHITE
        canvas.drawCircle(trackRect.left + trackRect.width() * M.clamp(value, 0f, 1f),
            trackRect.centerY(), Ui.dp(context, 7f).toFloat(), paint)

        textPaint.textAlign = Paint.Align.RIGHT
        textPaint.color = Draw.withAlpha(Color.WHITE, 230)
        canvas.drawText(displayValue, autoRect.left - Ui.dp(context, 8f).toFloat(), baseline, textPaint)

        // AUTO pill
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = if (auto) Draw.withAlpha(accent, 200) else Draw.withAlpha(Color.WHITE, 28)
        canvas.drawRoundRect(autoRect, autoRect.height() / 2f, autoRect.height() / 2f, paint)
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.textSize = Ui.sp(context, 10f)
        textPaint.color = if (auto) Color.BLACK else Draw.withAlpha(Color.WHITE, 200)
        val ab = autoRect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
        canvas.drawText("AUTO", autoRect.centerX(), ab, textPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (autoRect.contains(event.x, event.y)) {
                    onAutoToggle?.invoke()
                    return true
                }
                updateFromTouch(event.x)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                updateFromTouch(event.x)
                return true
            }
        }
        return true
    }

    private fun updateFromTouch(x: Float) {
        val fraction = M.clamp((x - trackRect.left) / max(1f, trackRect.width()), 0f, 1f)
        value = fraction
        invalidate()
        onValueChange?.invoke(fraction)
    }
}

/** Small pill toggles (flash, timer, grid, RAW, stabilisation, ...). */
class ChipButton(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    var text = "AUTO"
    var active = false
    var accent = Theme.accent
    var onClick: (() -> Unit)? = null

    init {
        textPaint.textAlign = Paint.Align.CENTER
        isClickable = true
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val spec = widthMeasureSpec
        if (MeasureSpec.getMode(spec) == MeasureSpec.UNSPECIFIED) {
            val w = (textPaint.measureText(text) + Ui.dp(context, 26f)).toInt()
            setMeasuredDimension(w, Ui.dp(context, 30f))
        } else {
            setMeasuredDimension(MeasureSpec.getSize(spec), Ui.dp(context, 30f))
        }
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        val r = RectF(Ui.dp(context, 1f).toFloat(), Ui.dp(context, 1f).toFloat(),
            width - Ui.dp(context, 1f).toFloat(), height - Ui.dp(context, 1f).toFloat())
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = if (active) Draw.withAlpha(accent, 60) else Draw.withAlpha(Color.BLACK, 110)
        canvas.drawRoundRect(r, r.height() / 2f, r.height() / 2f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = Ui.dp(context, 1f).toFloat()
        paint.color = if (active) accent else Draw.withAlpha(Color.WHITE, 45)
        canvas.drawRoundRect(r, r.height() / 2f, r.height() / 2f, paint)
        textPaint.textSize = Ui.sp(context, 11f)
        textPaint.color = if (active) Color.WHITE else Draw.withAlpha(Color.WHITE, 190)
        textPaint.typeface = android.graphics.Typeface.create("sans-serif-medium",
            android.graphics.Typeface.BOLD)
        val baseline = r.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
        canvas.drawText(text, r.centerX(), baseline, textPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            active = !active
            invalidate()
            onClick?.invoke()
            return true
        }
        return true
    }
}

/**
 * Before / after AI comparison: drag the divider to reveal the original under
 * the enhanced result. This is the honest way to show what the AI actually did.
 */
class CompareSlider(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    var before: android.graphics.Bitmap? = null
        set(value) { field = value; invalidate() }
    var after: android.graphics.Bitmap? = null
        set(value) { field = value; invalidate() }
    var split = 0.5f
        private set
    var labelBefore = "ORIGINAL"
    var labelAfter = "AI ENHANCED"

    init {
        paint.isFilterBitmap = true
        isClickable = true
    }

    /** Load both sides of the comparison at once. */
    fun setBitmaps(original: android.graphics.Bitmap?, enhanced: android.graphics.Bitmap?) {
        before = original
        after = enhanced
        split = 0.5f
        invalidate()
    }

    private fun destRect(w: Int, h: Int): RectF {
        val b = before ?: after ?: return RectF(0f, 0f, w.toFloat(), h.toFloat())
        val scale = min(w.toFloat() / b.width, h.toFloat() / b.height)
        val dw = b.width * scale
        val dh = b.height * scale
        val left = (w - dw) / 2f
        val top = (h - dh) / 2f
        return RectF(left, top, left + dw, top + dh)
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        val dest = destRect(width, height)
        val left = after
        val right = before
        if (left != null) {
            val src = Rect(0, 0, left.width, left.height)
            val cropped = RectF(dest.left, dest.top, dest.left + dest.width(), dest.bottom)
            canvas.drawBitmap(left, src, cropped, paint)
        }
        if (right != null) {
            val splitX = dest.left + dest.width() * split
            canvas.save()
            canvas.clipRect(splitX, dest.top, dest.right, dest.bottom)
            val src = Rect(0, 0, right.width, right.height)
            canvas.drawBitmap(right, src, dest, paint)
            canvas.restore()

            // divider handle
            paint.reset(); paint.isAntiAlias = true
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = Ui.dp(context, 2f).toFloat()
            paint.color = Color.WHITE
            if (android.os.Build.VERSION.SDK_INT >= 21) {
                paint.setShadowLayer(Ui.dp(context, 4f).toFloat(), 0f, 0f, Color.BLACK)
            }
            canvas.drawLine(splitX, dest.top, splitX, dest.bottom, paint)
            paint.clearShadowLayer()
            paint.style = Paint.Style.FILL
            canvas.drawCircle(splitX, dest.centerY(), Ui.dp(context, 15f).toFloat(), paint)
            paint.color = Color.BLACK
            canvas.drawCircle(splitX, dest.centerY(), Ui.dp(context, 13f).toFloat(), paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = Ui.dp(context, 1.4f).toFloat()
            paint.color = Color.WHITE
            val arrow = Ui.dp(context, 5f).toFloat()
            val path = Path()
            path.moveTo(splitX - arrow, dest.centerY() - arrow)
            path.lineTo(splitX - arrow * 1.8f, dest.centerY())
            path.lineTo(splitX - arrow, dest.centerY() + arrow)
            path.moveTo(splitX + arrow, dest.centerY() - arrow)
            path.lineTo(splitX + arrow * 1.8f, dest.centerY())
            path.lineTo(splitX + arrow, dest.centerY() + arrow)
            canvas.drawPath(path, paint)

            // labels
            paint.style = Paint.Style.FILL
            paint.textSize = Ui.sp(context, 11f)
            paint.color = Draw.withAlpha(Color.WHITE, 220)
            paint.textAlign = Paint.Align.LEFT
            canvas.drawText(labelBefore, dest.left + Ui.dp(context, 10f).toFloat(),
                dest.top + Ui.dp(context, 22f).toFloat(), paint)
            paint.textAlign = Paint.Align.RIGHT
            canvas.drawText(labelAfter, dest.right - Ui.dp(context, 10f).toFloat(),
                dest.top + Ui.dp(context, 22f).toFloat(), paint)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                val dest = destRect(width, height)
                split = M.clamp((event.x - dest.left) / max(1f, dest.width()), 0f, 1f)
                invalidate()
                return true
            }
        }
        return true
    }
}

/** A single thumbnail in the recent-shots strip. */
class ThumbView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    var bitmap: android.graphics.Bitmap? = null
        set(value) { field = value; invalidate() }
    var badge: String = ""
    var onClick: (() -> Unit)? = null

    init {
        paint.isFilterBitmap = true
        isClickable = true
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = Ui.dp(context, 52f)
        setMeasuredDimension(size, size)
    }

    /** Never let a drawing mistake take the whole app down. */
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        try {
            drawSelf(canvas)
        } catch (t: Throwable) {
            L.e("view draw failed", t)
        }
    }

    private fun drawSelf(canvas: Canvas) {
        val r = RectF(0f, 0f, width.toFloat(), height.toFloat())
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = Theme.surfaceHigh
        canvas.drawRoundRect(r, Ui.dp(context, 12f).toFloat(), Ui.dp(context, 12f).toFloat(), paint)
        val bmp = bitmap
        if (bmp != null) {
            paint.isFilterBitmap = true
            val scale = max(width.toFloat() / bmp.width, height.toFloat() / bmp.height)
            val dw = bmp.width * scale
            val dh = bmp.height * scale
            val src = Rect(((dw - width) / 2 / scale).toInt(), ((dh - height) / 2 / scale).toInt(),
                ((dw + width) / 2 / scale).toInt(), ((dh + height) / 2 / scale).toInt())
            canvas.save()
            val clip = Path().apply {
                addRoundRect(r, Ui.dp(context, 12f).toFloat(), Ui.dp(context, 12f).toFloat(),
                    Path.Direction.CW)
            }
            canvas.clipPath(clip)
            canvas.drawBitmap(bmp, src, r, paint)
            canvas.restore()
        }
        if (badge.isNotEmpty()) {
            paint.reset(); paint.isAntiAlias = true
            paint.style = Paint.Style.FILL
            paint.color = Draw.withAlpha(Theme.accentDim, 220)
            val tw = paint.measureText(badge)
            paint.textSize = Ui.sp(context, 8.5f)
            val rect = RectF(r.centerX() - tw / 2f - Ui.dp(context, 5f).toFloat(),
                r.bottom - Ui.dp(context, 15f).toFloat(),
                r.centerX() + tw / 2f + Ui.dp(context, 5f).toFloat(),
                r.bottom - Ui.dp(context, 4f).toFloat())
            canvas.drawRoundRect(rect, rect.height() / 2f, rect.height() / 2f, paint)
            paint.color = Color.WHITE
            paint.textAlign = Paint.Align.CENTER
            canvas.drawText(badge, r.centerX(), rect.centerY() + Ui.dp(context, 3f).toFloat(), paint)
        }
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = Ui.dp(context, 1f).toFloat()
        paint.color = Draw.withAlpha(Color.WHITE, 40)
        canvas.drawRoundRect(r, Ui.dp(context, 12f).toFloat(), Ui.dp(context, 12f).toFloat(), paint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            onClick?.invoke()
            return true
        }
        return true
    }
}
