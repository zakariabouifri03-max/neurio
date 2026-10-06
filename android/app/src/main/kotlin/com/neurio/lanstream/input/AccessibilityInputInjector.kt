package com.neurio.lanstream.input

import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.neurio.lanstream.core.InputMode
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.platform.NeurioAccessibilityService
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Delivers the player's input using the accessibility gesture API — the only
 * stock-Android mechanism that lets an ordinary app perform real touches.
 *
 * Limitations we do not hide:
 *  * one gesture at a time: dispatching a new one cancels the previous;
 *  * a gesture always ends with a finger lift, so "hold" is emulated by
 *    repeating short presses (the pacing lives in [RemoteInputController]);
 *  * games using FLAG_SECURE surfaces or their own input pipeline may ignore
 *    injected gestures, and some OEMs throttle dispatchGesture.
 */
class AccessibilityInputInjector(
    private val service: NeurioAccessibilityService
) : InputInjector {

    //TODO(platform-limit): the service can never be enabled from code — Android
    // requires the user to turn it on in Settings > Accessibility. We can only
    // detect the state and deep-link to the settings screen.
    //
    //TODO(platform-limit): dispatchGesture() is serialised: a new gesture
    // cancels the previous one and every gesture ends with an implicit finger
    // lift, so a true "press and hold" has to be replayed as a chain of short
    // strokes (see RemoteInputController.HOLD_*). Multi-touch is possible (one
    // Path per finger) but only inside a single atomic gesture.
    //
    //TODO(platform-limit): some games (anti-cheat / FLAG_SECURE / custom input
    // pipelines) ignore injected gestures entirely, and a few OEM ROMs throttle
    // dispatchGesture. There is no API to detect that up front, which is why
    // the host UI reports "available but unverified" rather than promising it
    // works. Best real fix: none available to a third-party app. Restricted
    // alternative: ship a companion root/system helper (see the ROOT injector).

    override val mode: InputMode = InputMode.ACCESSIBILITY

    private val handler = Handler(Looper.getMainLooper())
    private val lastDispatchOk = AtomicBoolean(true)

    override fun isAvailable(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && service.isConnected

    override fun describe(): String =
        "AccessibilityService.dispatchGesture — real touches, one gesture at a time"

    override fun injectStroke(
        fromX: Float,
        fromY: Float,
        toX: Float,
        toY: Float,
        durationMs: Long
    ): Boolean {
        if (!isAvailable()) return false
        val duration = durationMs.coerceIn(1L, MAX_DURATION_MS)
        val path = Path().apply {
            moveTo(fromX, fromY)
            lineTo(toX, toY)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, duration))
            .build()
        val posted = handler.post {
            lastDispatchOk.set(
                runCatching {
                    service.dispatchGesture(gesture, null, null)
                }.onFailure { Log.w("dispatchGesture failed: ${it.message}") }
                    .getOrDefault(false)
            )
        }
        return posted && lastDispatchOk.get()
    }

    /**
     * Only global actions are available to an accessibility service: it cannot
     * deliver arbitrary key events into another app.
     */
    override fun injectKey(keyCode: Int, down: Boolean): Boolean {
        if (!down) return false
        if (!isAvailable()) return false
        val action = when (keyCode) {
            android.view.KeyEvent.KEYCODE_BACK -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK
            android.view.KeyEvent.KEYCODE_HOME -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME
            android.view.KeyEvent.KEYCODE_APP_SWITCH -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_RECENTS
            else -> return false
        }
        handler.post { runCatching { service.performGlobalAction(action) } }
        return true
    }

    companion object {
        /** Some devices silently drop extremely long gestures. */
        private const val MAX_DURATION_MS = 5_000L
    }
}
