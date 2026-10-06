package com.neurio.lanstream.input

import android.content.Context
import com.neurio.lanstream.core.InputMode
import com.neurio.lanstream.platform.NeurioAccessibilityService

/**
 * The single abstraction that isolates Android's input restrictions.
 *
 * Android deliberately does NOT let app A inject touches into app B. The only
 * legitimate paths that exist today are:
 *
 *  1. AccessibilityService.dispatchGesture()  - real touches/swipes, no special
 *     privileges, but the user must enable the service, every gesture is
 *     atomic (it always ends with a finger lift), and only one gesture can be
 *     in flight at a time.
 *  2. Hidden InputManager.injectInputEvent()  - requires INJECT_EVENTS, which
 *     is a signature/privileged permission. Reachable through `su` on a rooted
 *     phone via the `input` command.
 *  3. Nothing - i.e. visualise the input only, which is what the overlay
 *     injector does so you can still measure and debug the transport.
 *
 * Everything above the injector (transport, mapping, pacing) is platform
 * independent: plug in a different [InputInjector] and the rest keeps working.
 * See docs/LIMITATIONS.md.
 */
interface InputInjector {

    val mode: InputMode

    fun isAvailable(): Boolean

    /** Short human readable description shown in the host UI. */
    fun describe(): String

    /**
     * One finger gesture: press at (fromX, fromY), optionally move to
     * (toX, toY) over [durationMs], then lift.
     *
     * All coordinates are host screen pixels.
     */
    fun injectStroke(fromX: Float, fromY: Float, toX: Float, toY: Float, durationMs: Long): Boolean

    fun injectKey(keyCode: Int, down: Boolean): Boolean

    /** Called when the phone rotates or the stream resolution changes. */
    fun onDisplayChanged(width: Int, height: Int) {}
}

/** Does nothing: used for DISABLED and as a safe fallback. */
class NullInputInjector(override val mode: InputMode = InputMode.DISABLED) : InputInjector {
    override fun isAvailable(): Boolean = true
    override fun describe(): String = "Disabled (input received and measured, never applied)"
    override fun injectStroke(fx: Float, fy: Float, tx: Float, ty: Float, durationMs: Long): Boolean = false
    override fun injectKey(keyCode: Int, down: Boolean): Boolean = false
}

object InputInjectors {

    /**
     * Resolves the requested mode into an injector that can actually run here.
     * AUTO tries accessibility first (works on every stock phone once the user
     * enables the service), then root, then the visualiser.
     */
    fun create(context: Context, mode: InputMode): InputInjector {
        val accessibility = NeurioAccessibilityService.instance?.let { AccessibilityInputInjector(it) }
        val privileged = PrivilegedInputInjector()
        val overlay = OverlayInputInjector(context.applicationContext)

        return when (mode) {
            InputMode.AUTO -> when {
                accessibility?.isAvailable() == true -> accessibility
                privileged.isAvailable() -> privileged
                overlay.isAvailable() -> overlay
                else -> NullInputInjector()
            }
            InputMode.ACCESSIBILITY -> accessibility ?: NullInputInjector(InputMode.ACCESSIBILITY)
            InputMode.ROOT -> privileged
            InputMode.OVERLAY -> overlay
            InputMode.DISABLED -> NullInputInjector()
        }
    }

    /** Human readable explanation of what the chosen injector can and cannot do. */
    fun limitationNote(mode: InputMode): String = when (mode) {
        InputMode.AUTO -> "Best available method is selected automatically."
        InputMode.ACCESSIBILITY ->
            "Real gestures via AccessibilityService: taps, swipes and repeated presses. " +
                "A continuous hold cannot be expressed (each gesture ends with a lift), so " +
                "holding is emulated by repeating the press ~8x/second."
        InputMode.ROOT ->
            "Uses `input` through root/shell privileges. Slower (~50-100 ms per event) but " +
                "supports genuine press-and-hold."
        InputMode.OVERLAY ->
            "Does not inject anything: draws the incoming touch point on top of the game so " +
                "you can verify the transport and measure latency."
        InputMode.DISABLED -> "Input is received and measured but never applied to the screen."
    }
}
