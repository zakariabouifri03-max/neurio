package com.neurio.lanstream.input

import kotlin.math.hypot

/**
 * Turns a physical gamepad state into the same touch events the virtual pad
 * produces, using the [PadLayout] the client sent during the handshake.
 *
 * This is the extension point for real game support: add per-package layouts
 * (or direct key mappings) here without touching transport or injection.
 */
class GameInputAdapter(private var layout: PadLayout = PadLayout.default()) {

    private var previousButtons = 0
    private var stickDown = false
    private var dpadPointer = -1

    @Volatile
    var lastStickX = 0f
        private set

    @Volatile
    var lastStickY = 0f
        private set

    fun setLayout(next: PadLayout) {
        layout = next
    }

    /** Stable pointer ids so a press and its release always pair up. */
    private fun pointerIdOf(controlId: String): Int = when (controlId) {
        PadLayout.JOYSTICK -> 1
        PadLayout.DPAD -> 12
        PadLayout.A -> 2
        PadLayout.B -> 3
        PadLayout.X -> 4
        PadLayout.Y -> 5
        PadLayout.L1 -> 6
        PadLayout.L2 -> 8
        PadLayout.R1 -> 7
        PadLayout.R2 -> 9
        PadLayout.START -> 10
        PadLayout.SELECT -> 11
        else -> 20
    }

    fun map(state: InputEvent.Gamepad): List<InputEvent> {
        val out = ArrayList<InputEvent>(6)
        val time = state.timestampMs

        // Triggers are reported both as axes and as buttons on most pads.
        var buttons = state.buttons
        if (state.leftTrigger > 0.5f) buttons = buttons or GamepadButtons.L2
        if (state.rightTrigger > 0.5f) buttons = buttons or GamepadButtons.R2

        BUTTON_CONTROLS.forEach { (mask, controlId) ->
            val spec = layout[controlId] ?: return@forEach
            val pressed = buttons and mask != 0
            val was = previousButtons and mask != 0
            if (pressed != was) {
                out.add(
                    InputEvent.Touch(
                        action = if (pressed) TouchAction.DOWN else TouchAction.UP,
                        pointerId = pointerIdOf(controlId),
                        x = spec.x,
                        y = spec.y,
                        timestampMs = time
                    )
                )
            }
        }
        previousButtons = buttons

        // Left stick -> the on-screen joystick (press at centre, then drag).
        val stick = layout[PadLayout.JOYSTICK]
        if (stick != null) {
            val magnitude = hypot(state.leftX, state.leftY)
            if (magnitude > STICK_DEADZONE) {
                val radius = stick.size * 0.5f
                val nx = (stick.x + state.leftX * radius).coerceIn(0f, 1f)
                val ny = (stick.y + state.leftY * radius).coerceIn(0f, 1f)
                if (!stickDown) {
                    out.add(
                        InputEvent.Touch(
                            TouchAction.DOWN,
                            pointerIdOf(PadLayout.JOYSTICK),
                            stick.x,
                            stick.y,
                            timestampMs = time
                        )
                    )
                    stickDown = true
                }
                out.add(
                    InputEvent.Touch(
                        TouchAction.MOVE,
                        pointerIdOf(PadLayout.JOYSTICK),
                        nx,
                        ny,
                        timestampMs = time
                    )
                )
                lastStickX = nx
                lastStickY = ny
            } else if (stickDown) {
                out.add(
                    InputEvent.Touch(
                        TouchAction.UP,
                        pointerIdOf(PadLayout.JOYSTICK),
                        lastStickX,
                        lastStickY,
                        timestampMs = time
                    )
                )
                stickDown = false
            }
        }

        // D-pad / hat -> eight-way taps around the D-pad control.
        val dpad = layout[PadLayout.DPAD]
        if (dpad != null) {
            val hatX = if (state.hatX != 0f) state.hatX else 0f
            val hatY = if (state.hatY != 0f) state.hatY else 0f
            val mask = directionMask(state.buttons, hatX, hatY)
            if (mask != dpadPointer) {
                if (dpadPointer != -1) {
                    out.add(
                        InputEvent.Touch(
                            TouchAction.UP,
                            pointerIdOf(PadLayout.DPAD),
                            lastStickX,
                            lastStickY,
                            timestampMs = time
                        )
                    )
                }
                if (mask != -1) {
                    val (dx, dy) = directionVector(mask)
                    val (px, py) = dpad.pointAt(dx, dy)
                    out.add(
                        InputEvent.Touch(
                            TouchAction.DOWN,
                            pointerIdOf(PadLayout.DPAD),
                            px,
                            py,
                            timestampMs = time
                        )
                    )
                    lastStickX = px
                    lastStickY = py
                }
                dpadPointer = mask
            }
        }
        return out
    }

    private fun directionMask(buttons: Int, hatX: Float, hatY: Float): Int = when {
        buttons and GamepadButtons.DPAD_UP != 0 || hatY < -0.5f -> GamepadButtons.DPAD_UP
        buttons and GamepadButtons.DPAD_DOWN != 0 || hatY > 0.5f -> GamepadButtons.DPAD_DOWN
        buttons and GamepadButtons.DPAD_LEFT != 0 || hatX < -0.5f -> GamepadButtons.DPAD_LEFT
        buttons and GamepadButtons.DPAD_RIGHT != 0 || hatX > 0.5f -> GamepadButtons.DPAD_RIGHT
        else -> -1
    }

    private fun directionVector(mask: Int): Pair<Float, Float> = when (mask) {
        GamepadButtons.DPAD_UP -> 0f to -1f
        GamepadButtons.DPAD_DOWN -> 0f to 1f
        GamepadButtons.DPAD_LEFT -> -1f to 0f
        GamepadButtons.DPAD_RIGHT -> 1f to 0f
        else -> 0f to 0f
    }

    companion object {
        private const val STICK_DEADZONE = 0.15f

        private val BUTTON_CONTROLS: List<Pair<Int, String>> = listOf(
            GamepadButtons.A to PadLayout.A,
            GamepadButtons.B to PadLayout.B,
            GamepadButtons.X to PadLayout.X,
            GamepadButtons.Y to PadLayout.Y,
            GamepadButtons.L1 to PadLayout.L1,
            GamepadButtons.L2 to PadLayout.L2,
            GamepadButtons.R1 to PadLayout.R1,
            GamepadButtons.R2 to PadLayout.R2,
            GamepadButtons.START to PadLayout.START,
            GamepadButtons.SELECT to PadLayout.SELECT
        )
    }
}
