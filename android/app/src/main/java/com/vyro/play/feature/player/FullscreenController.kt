package com.vyro.play.feature.player

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Our own immersive fullscreen implementation.
 *
 * The YouTube IFrame player's built-in fullscreen button is disabled
 * (`IFramePlayerOptions.fullscreen(0)`) because the library hands the host a raw View
 * to re-parent, which does not compose well with a Compose layout. Driving it from the
 * Activity instead gives a single, predictable behaviour across devices and lets us
 * keep the screen awake while playing.
 */
class FullscreenController(
    private val activity: Activity,
) {
    private var isFullscreen = false

    fun isFullscreen(): Boolean = isFullscreen

    fun enter() {
        if (isFullscreen) return
        isFullscreen = true
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        WindowInsetsControllerCompat(activity.window, activity.window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    fun exit() {
        if (!isFullscreen) return
        isFullscreen = false
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_USER
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(activity.window, true)
        WindowInsetsControllerCompat(activity.window, activity.window.decorView)
            .show(WindowInsetsCompat.Type.systemBars())
    }

    fun toggle() {
        if (isFullscreen) exit() else enter()
    }

    /** Restores the normal orientation/insets when the screen leaves the composition. */
    fun release() {
        if (isFullscreen) exit()
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}

/** Walks up a ContextWrapper chain (Compose, themed contexts, …) to find the Activity. */
tailrec fun Context.findActivity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }
