package com.neurio.client

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.MotionEvent
import android.view.View
import com.neurio.common.Protocol

/** ABXY diamond cluster with press/release reporting. */
class ButtonClusterView(context: Context) : View(context) {

    var onButton: ((buttonId: Int, pressed: Boolean) -> Unit)? = null

    private data class Pad(val id: Int, val label: String, val fx: Float, val fy: Float, val color: Int)

    private val pads = listOf(
        Pad(Protocol.BTN_Y, "Y", 0.5f, 0.16f, Color.argb(200, 251, 191, 36)),
        Pad(Protocol.BTN_X, "X", 0.16f, 0.5f, Color.argb(200, 96, 165, 250)),
        Pad(Protocol.BTN_B, "B", 0.84f, 0.5f, Color.argb(200, 251, 85, 101)),
        Pad(Protocol.BTN_A, "A", 0.5f, 0.84f, Color.argb(200, 52, 211, 153))
    )

    private var activeId: Int = -1

    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val edgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f * resources.displayMetrics.density
        color = Color.argb(170, 234, 239, 248)
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(240, 10, 14, 24)
        textSize = 14f * resources.displayMetrics.density
        textAlign = Paint.Align.CENTER
        isFakeBoldText = true
    }

    private fun padRadius(): Float = minOf(width, height) * 0.19f

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val r = padRadius()
        for (pad in pads) {
            val cx = pad.fx * width
            val cy = pad.fy * height
            fillPaint.color = if (pad.id == activeId) pad.color else dim(pad.color)
            canvas.drawCircle(cx, cy, r, fillPaint)
            canvas.drawCircle(cx, cy, r, edgePaint)
            canvas.drawText(pad.label, cx, cy + textPaint.textSize * 0.35f, textPaint)
        }
    }

    private fun dim(color: Int): Int =
        Color.argb((Color.alpha(color) * 0.55f).toInt(), Color.red(color), Color.green(color), Color.blue(color))

    private fun hitPad(x: Float, y: Float): Pad? {
        val r = padRadius() * 1.35f
        for (pad in pads) {
            val dx = x - pad.fx * width
            val dy = y - pad.fy * height
            if (dx * dx + dy * dy <= r * r) return pad
        }
        return null
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val pad = hitPad(event.x, event.y) ?: return true
                activeId = pad.id
                onButton?.invoke(pad.id, true)
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (activeId != -1) {
                    onButton?.invoke(activeId, false)
                    activeId = -1
                    invalidate()
                }
                return true
            }
        }
        return super.onTouchEvent(event)
    }
}
