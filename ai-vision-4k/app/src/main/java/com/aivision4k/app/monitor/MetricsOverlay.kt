package com.aivision4k.app.monitor

import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView
import com.aivision4k.sdk.AIUpscaler
import java.util.Locale

/**
 * A real system overlay that shows live readings over another app — within the
 * limits Android allows.
 *
 * It can only **display** numbers: an overlay window is a separate composition
 * that the touched application never sees, so nothing here modifies a game. That
 * is the honest reason the overlay exists: it is for watching temperature and
 * memory while a game runs, not for "enhancing" one.
 *
 * Requires `SYSTEM_ALERT_WINDOW`, which the user grants in system settings.
 */
object MetricsOverlay {

    private var view: TextView? = null
    private var windowManager: WindowManager? = null
    private var handler: Handler? = null
    private var updater: Runnable? = null

    val isVisible: Boolean get() = view != null

    fun canShow(context: Context): Boolean = Settings.canDrawOverlays(context)

    /** Returns null on success, or a message to show the user. */
    fun show(context: Context): String? {
        if (isVisible) return null
        if (!canShow(context)) {
            return "Overlay permission is not granted. Android requires it for any window drawn over another app."
        }
        val application = context.applicationContext
        val text = TextView(application).apply {
            setTextColor(0xFFE8EDF7.toInt())
            textSize = 11f
            setPadding(24, 14, 24, 14)
            setBackgroundColor(0xCC05070E.toInt())
            text = "AI Vision 4K \u00b7 starting\u2026"
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 24
            y = 120
        }
        val manager = application.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            ?: return "This device exposes no window service."
        return try {
            manager.addView(text, params)
            view = text
            windowManager = manager
            startUpdates(application)
            null
        } catch (error: Throwable) {
            "Could not add the overlay window: ${error.message ?: error.javaClass.simpleName}"
        }
    }

    fun hide() {
        stopUpdates()
        val text = view
        val manager = windowManager
        if (text != null && manager != null) {
            runCatching { manager.removeView(text) }
        }
        view = null
        windowManager = null
    }

    private fun startUpdates(context: Context) {
        val looper = Handler(Looper.getMainLooper())
        val runnable = object : Runnable {
            override fun run() {
                val text = view ?: return
                AIUpscaler.updateThermal(context)
                val snapshot = AIUpscaler.status()
                text.text = if (snapshot == null) {
                    "AI Vision 4K \u00b7 engine not running"
                } else {
                    String.format(
                        Locale.US,
                        "AI Vision 4K \u00b7 %s\nFPS %s  frame %s\nCPU %s  RAM %s\ntemp %s  %s",
                        snapshot.thermalLevel.label,
                        snapshot.fps?.let { String.format(Locale.US, "%.0f", it) } ?: "\u2014",
                        snapshot.frameTimeMs?.let { String.format(Locale.US, "%.1f ms", it) } ?: "\u2014",
                        snapshot.cpuLoadFraction?.let { String.format(Locale.US, "%.0f%%", it * 100) } ?: "\u2014",
                        snapshot.ramUsedFraction?.let { String.format(Locale.US, "%.0f%%", it * 100) } ?: "\u2014",
                        snapshot.batteryTemperatureC?.let { String.format(Locale.US, "%.1f \u00b0C", it) } ?: "n/a",
                        snapshot.note,
                    )
                }
                looper.postDelayed(this, 1000L)
            }
        }
        looper.post(runnable)
        handler = looper
        updater = runnable
    }

    private fun stopUpdates() {
        val runnable = updater
        val looper = handler
        if (runnable != null && looper != null) looper.removeCallbacks(runnable)
        updater = null
        handler = null
    }
}
