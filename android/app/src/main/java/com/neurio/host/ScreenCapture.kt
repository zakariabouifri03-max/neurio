package com.neurio.host

import android.content.Context
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.view.Surface
import com.neurio.common.AppLog

/**
 * Mirrors the host display into a VirtualDisplay whose Surface is the
 * hardware encoder's input surface. No frame copies: the GPU renders the
 * display content directly into the encoder.
 *
 * MediaProjection consent is requested by HostActivity before this is used.
 */
class ScreenCapture(private val context: Context) {

    companion object {
        private const val TAG = "ScreenCapture"
    }

    private var virtualDisplay: VirtualDisplay? = null

    var width: Int = 0
        private set
    var height: Int = 0
        private set

    fun start(projection: MediaProjection, width: Int, height: Int, surface: Surface) {
        stop()
        val dpi = context.resources.displayMetrics.densityDpi
        virtualDisplay = projection.createVirtualDisplay(
            "NeurioStream",
            width,
            height,
            dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            surface,
            null,
            null
        )
        this.width = width
        this.height = height
        AppLog.i(TAG, "virtual display ${width}x${height} dpi=$dpi")
    }

    fun stop() {
        try {
            virtualDisplay?.release()
        } catch (e: Exception) {
            AppLog.w(TAG, "release: ${e.message}")
        }
        virtualDisplay = null
    }
}
