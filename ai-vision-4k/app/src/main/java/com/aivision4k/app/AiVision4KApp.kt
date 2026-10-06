package com.aivision4k.app

import android.app.Application
import android.util.Log
import com.aivision4k.app.settings.AppSettings
import com.aivision4k.sdk.AIUpscaler

/**
 * Process entry point.
 *
 * The engine is initialised once, here, so that the compatibility report and the
 * device probe exist before the first screen draws and so that a background
 * monitoring session (started from the UI) talks to an engine that is already
 * running.
 *
 * Nothing here is allowed to take the app down: a device that fails the probe
 * must still show the reason, which is exactly what a non-null message from
 * `initialize` is.
 */
class AiVision4KApp : Application() {

    override fun onCreate() {
        super.onCreate()
        val settings = AppSettings(this)
        runCatching {
            val error = AIUpscaler.initialize(this, settings.integration)
            if (error != null) Log.w(TAG, "Engine initialisation reported: $error")
        }.onFailure { error ->
            // A native crash-free failure (missing .so, refused probe) lands here.
            Log.e(TAG, "Engine initialisation threw", error)
        }
    }

    override fun onTerminate() {
        runCatching { AIUpscaler.shutdown() }
        super.onTerminate()
    }

    private companion object {
        const val TAG = "AiVision4K"
    }
}
