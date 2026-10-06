package com.neurio.lanstream.media

import android.content.Context
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.os.Handler
import android.view.Surface
import com.neurio.lanstream.core.Log

/**
 * Owns the MediaProjection virtual display.
 *
 * The virtual display is created at the *encoded* resolution, so the GPU does
 * the downscale once while mirroring, instead of encoding a 1440p/4K picture
 * and throwing most of it away.
 */
class ScreenCapture(
    private val context: Context,
    private val projection: MediaProjection
) {
    //TODO(platform-limit): surfaces flagged FLAG_SECURE (banking, DRM video,
    // some game launchers and anti-cheat overlays) mirror as pure black — the
    // compositor refuses to hand those layers to a virtual display. There is no
    // detection API and no workaround for a normal app, so the host simply
    // streams what it is allowed to see and the UI says so.
    @Volatile
    private var display: VirtualDisplay? = null

    private val densityDpi: Int
        get() = context.resources.displayMetrics.densityDpi

    fun start(
        width: Int,
        height: Int,
        surface: Surface,
        handler: Handler? = null,
        callback: VirtualDisplay.Callback? = null
    ) {
        release()
        display = projection.createVirtualDisplay(
            DISPLAY_NAME,
            width,
            height,
            densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            surface,
            callback,
            handler
        )
        Log.i("VirtualDisplay started at ${width}x${height}@$densityDpi")
    }

    /** Used when the adaptive controller changes the resolution tier. */
    fun resize(width: Int, height: Int, surface: Surface) {
        start(width, height, surface)
    }

    fun release() {
        try {
            display?.release()
        } catch (t: Throwable) {
            Log.w("VirtualDisplay release: ${t.message}")
        }
        display = null
    }

    companion object {
        private const val DISPLAY_NAME = "neurio-game-capture"
    }
}
