package com.aivision.camera

import android.app.Application
import com.aivision.camera.core.Crash
import com.aivision.camera.core.L

/**
 * Application entry point: installs the crash recorder before anything else so
 * that even a failure while building the camera screen leaves a readable trace.
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Crash.install(this)
        Crash.beginBoot(this, BuildConfig.VERSION_NAME)
        L.i("AI Vision Camera ${BuildConfig.VERSION_NAME} starting on API ${android.os.Build.VERSION.SDK_INT}")
    }
}

/** Tiny build metadata holder (there is no generated BuildConfig in this build). */
object BuildConfig {
    const val VERSION_NAME = "1.0.1"
    const val VERSION_CODE = 2
}
