package com.neurio.client

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View

/**
 * Virtual analog stick. Reports a normalized deflection vector in [-1, 1].
 * Visual style follows the dark gaming theme.
 */
class JoystickView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    /** (x, y, isActive) - y grows downwards, matching screen coordinates. */
    var onVector: ((x: Float, y: Float, active: Boolean) -> Unit)? = null

    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(2f)
        color = Color.argb(150, 34, 211, 238)
    }
    private val baseFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(46, 34, 211, 238)
    }
    private val knobPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(220, 139, 92, 246)
    }
    private val knobEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(1.5f)
        color = Color.argb(230, 234, 239, 248)
    }

    private var knobX = 0f
    private var knobY = 0f
    private var tracking = false

    private fun dp(value: Float): Float = value * resources.displayMetrics.density

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f
        val radius = minOf(width, height) / 2f - dp(2)
        canvas.drawCircle(cx, cy, radius, baseFill)
        canvas.drawCircle(cx, cy, radius, basePaint)
        val kx = cx + knobX * radius
        val ky = cy + knobY * radius
        canvas.drawCircle(kx, ky, radius * 0.42f, knobPaint)
        canvas.drawCircle(kx, ky, radius * 0.42f, knobEdge)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                val cx = width / 2f
                val cy = height / 2f
                val radius = minOf(width, height) / 2f
                var dx = (event.x - cx) / radius
                var dy = (event.y - cy) / radius
                val len = Math.hypot(dx.toDouble(), dy.toDouble()).toFloat()
                if (len > 1f) {
                    dx /= len
                    dy /= len
                }
                knobX = dx
                knobY = dy
                tracking = true
                onVector?.invoke(dx, dy, true)
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                knobX = 0f
                knobY = 0f
                tracking = false
                onVector?.invoke(0f, 0f, false)
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }
}
