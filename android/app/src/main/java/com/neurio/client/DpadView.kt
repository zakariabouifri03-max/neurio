package com.neurio.client

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View
import com.neurio.common.Protocol
import kotlin.math.abs

/** Directional pad. Reports one direction held at a time (up/down edges). */
class DpadView(context: Context) : View(context) {

    var onButton: ((buttonId: Int, pressed: Boolean) -> Unit)? = null

    private var activeId: Int = -1

    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(70, 34, 211, 238)
    }
    private val edgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1.6f * resources.displayMetrics.density
        color = Color.argb(140, 34, 211, 238)
    }
    private val activePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(190, 139, 92, 246)
    }

    private fun armPath(rotationDeg: Float): Path {
        // One arm pointing up, then rotated for the other directions.
        val w = width.toFloat()
        val h = height.toFloat()
        val cx = w / 2f
        val cy = h / 2f
        val armW = w * 0.30f
        val path = Path()
        path.moveTo(cx - armW / 2f, cy)
        path.lineTo(cx - armW / 2f, h * 0.04f)
        path.lineTo(cx + armW / 2f, h * 0.04f)
        path.lineTo(cx + armW / 2f, cy)
        path.close()
        val matrix = android.graphics.Matrix()
        matrix.postRotate(rotationDeg, cx, cy)
        path.transform(matrix)
        return path
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val arms = listOf(
            0f to Protocol.BTN_DP_UP,
            90f to Protocol.BTN_DP_RIGHT,
            180f to Protocol.BTN_DP_DOWN,
            270f to Protocol.BTN_DP_LEFT
        )
        for ((rot, id) in arms) {
            val p = armPath(rot)
            canvas.drawPath(p, if (id == activeId) activePaint else basePaint)
            canvas.drawPath(p, edgePaint)
        }
    }

    private fun hitDirection(x: Float, y: Float): Int {
        val dx = x - width / 2f
        val dy = y - height / 2f
        val dead = minOf(width, height) * 0.10f
        if (abs(dx) < dead && abs(dy) < dead) return -1
        return if (abs(dx) > abs(dy)) {
            if (dx > 0) Protocol.BTN_DP_RIGHT else Protocol.BTN_DP_LEFT
        } else {
            if (dy > 0) Protocol.BTN_DP_DOWN else Protocol.BTN_DP_UP
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                val dir = hitDirection(event.x, event.y)
                if (dir != activeId) {
                    if (activeId != -1) onButton?.invoke(activeId, false)
                    activeId = dir
                    if (dir != -1) onButton?.invoke(dir, true)
                    invalidate()
                }
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
