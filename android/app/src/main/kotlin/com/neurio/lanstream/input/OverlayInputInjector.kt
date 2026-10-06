package com.neurio.lanstream.input

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import com.neurio.lanstream.core.InputMode
import com.neurio.lanstream.core.Log

/**
 * Diagnostic injector: draws every incoming touch on top of the game instead of
 * injecting it.
 *
 * Why it exists: it is the only mode that works on *every* device, so it lets
 * you verify that (a) the input transport is alive, (b) the coordinates land
 * where you expect, and (c) the end-to-end latency, without pretending we can
 * control a third party game.
 */
class OverlayInputInjector(private val context: Context) : InputInjector {

    //TODO(platform-limit): SYSTEM_ALERT_WINDOW only lets an app *draw* over
    // other apps — it grants no input capability whatsoever. This mode is
    // therefore honest about being a visualiser: it proves the transport, the
    // coordinate mapping and the latency, and injects nothing. It is the
    // guaranteed-to-work fallback for every stock device.

    override val mode: InputMode = InputMode.OVERLAY

    private val windowManager =
        context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var marker: MarkerView? = null

    @Volatile
    private var attached = false

    override fun isAvailable(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

    override fun describe(): String = "Overlay visualiser (draws the touch point, no injection)"

    override fun injectStroke(
        fromX: Float,
        fromY: Float,
        toX: Float,
        toY: Float,
        durationMs: Long
    ): Boolean {
        if (!isAvailable()) return false
        handler.post {
            show(toX, toY, pressed = true)
            handler.postDelayed({ show(toX, toY, pressed = false) }, 220L)
        }
        return true
    }

    override fun injectKey(keyCode: Int, down: Boolean): Boolean = false

    private fun show(x: Float, y: Float, pressed: Boolean) {
        val view = marker ?: MarkerView(context).also { marker = it }
        val params = createParams()
        params.x = (x - MARKER_SIZE / 2f).toInt()
        params.y = (y - MARKER_SIZE / 2f).toInt()
        try {
            if (!attached) {
                windowManager.addView(view, params)
                attached = true
            } else {
                windowManager.updateViewLayout(view, params)
            }
            view.touching = pressed
        } catch (t: Throwable) {
            Log.w("Overlay show failed: ${t.message}")
            attached = false
        }
    }

    @SuppressLint("InflateParams")
    private fun createParams(): WindowManager.LayoutParams = WindowManager.LayoutParams(
        MARKER_SIZE,
        MARKER_SIZE,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        },
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
        gravity = android.view.Gravity.TOP or android.view.Gravity.START
    }

    /** Removes the marker from the screen (called when the session ends). */
    fun detach() {
        handler.post {
            try {
                marker?.let { if (attached) windowManager.removeView(it) }
            } catch (t: Throwable) {
                Log.w("Overlay detach failed: ${t.message}")
            }
            marker = null
            attached = false
        }
    }

    private class MarkerView(context: Context) : View(context) {

        // NOTE: not called "pressed" - View already has setPressed(boolean),
        // and a Kotlin property with that name would generate the same JVM
        // signature (accidental override).
        var touching: Boolean = false
            set(value) {
                field = value
                invalidate()
            }

        private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 4f
            color = Color.CYAN
        }

        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.argb(120, 0, 229, 255)
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val centre = MARKER_SIZE / 2f
            val radius = centre - 6f
            canvas.drawCircle(centre, centre, radius, ringPaint)
            if (touching) {
                canvas.drawCircle(centre, centre, radius * 0.55f, fillPaint)
            }
        }
    }

    companion object {
        private const val MARKER_SIZE = 72
    }
}
