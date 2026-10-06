package com.neurio.lanstream.input

import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent

/**
 * Reads a physical Bluetooth/USB gamepad attached to the *client* phone.
 *
 * The raw state is forwarded to the host, which maps it onto the same
 * configurable screen layout the virtual pad uses (see [GameInputAdapter]).
 * That keeps a single mapping model for sticks, D-pad and buttons.
 */
object GamepadReader {

    fun isGamepadEvent(event: MotionEvent): Boolean =
        event.source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
            event.source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK

    fun isGamepadKey(event: KeyEvent): Boolean {
        val source = event.source
        return source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
            source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK ||
            event.keyCode in GAMEPAD_KEYS
    }

    fun read(event: MotionEvent): InputEvent.Gamepad {
        val leftX = deadzone(event.getAxisValue(MotionEvent.AXIS_X))
        val leftY = deadzone(event.getAxisValue(MotionEvent.AXIS_Y))
        val rightX = deadzone(event.getAxisValue(MotionEvent.AXIS_Z))
        val rightY = deadzone(event.getAxisValue(MotionEvent.AXIS_RZ))
        val brake = event.getAxisValue(MotionEvent.AXIS_BRAKE)
        val gas = event.getAxisValue(MotionEvent.AXIS_GAS)
        val lTrigger = event.getAxisValue(MotionEvent.AXIS_LTRIGGER)
        val rTrigger = event.getAxisValue(MotionEvent.AXIS_RTRIGGER)
        val hatX = deadzone(event.getAxisValue(MotionEvent.AXIS_HAT_X))
        val hatY = deadzone(event.getAxisValue(MotionEvent.AXIS_HAT_Y))
        return InputEvent.Gamepad(
            buttons = dpadButtons(hatX, hatY, event),
            leftX = leftX,
            leftY = leftY,
            rightX = rightX,
            rightY = rightY,
            leftTrigger = if (lTrigger > 0f) lTrigger else brake,
            rightTrigger = if (rTrigger > 0f) rTrigger else gas,
            hatX = hatX,
            hatY = hatY
        )
    }

    /** Button mask from a key event (gamepads report A/B/X/Y as key events). */
    fun maskForKey(keyCode: Int): Int = when (keyCode) {
        KeyEvent.KEYCODE_BUTTON_A -> GamepadButtons.A
        KeyEvent.KEYCODE_BUTTON_B -> GamepadButtons.B
        KeyEvent.KEYCODE_BUTTON_X -> GamepadButtons.X
        KeyEvent.KEYCODE_BUTTON_Y -> GamepadButtons.Y
        KeyEvent.KEYCODE_BUTTON_L1 -> GamepadButtons.L1
        KeyEvent.KEYCODE_BUTTON_R1 -> GamepadButtons.R1
        KeyEvent.KEYCODE_BUTTON_L2 -> GamepadButtons.L2
        KeyEvent.KEYCODE_BUTTON_R2 -> GamepadButtons.R2
        KeyEvent.KEYCODE_BUTTON_START -> GamepadButtons.START
        KeyEvent.KEYCODE_BUTTON_SELECT -> GamepadButtons.SELECT
        KeyEvent.KEYCODE_BUTTON_THUMBL -> GamepadButtons.THUMB_L
        KeyEvent.KEYCODE_BUTTON_THUMBR -> GamepadButtons.THUMB_R
        KeyEvent.KEYCODE_DPAD_UP -> GamepadButtons.DPAD_UP
        KeyEvent.KEYCODE_DPAD_DOWN -> GamepadButtons.DPAD_DOWN
        KeyEvent.KEYCODE_DPAD_LEFT -> GamepadButtons.DPAD_LEFT
        KeyEvent.KEYCODE_DPAD_RIGHT -> GamepadButtons.DPAD_RIGHT
        else -> 0
    }

    private fun dpadButtons(hatX: Float, hatY: Float, event: MotionEvent): Int {
        var mask = 0
        if (hatY < -0.5f) mask = mask or GamepadButtons.DPAD_UP
        if (hatY > 0.5f) mask = mask or GamepadButtons.DPAD_DOWN
        if (hatX < -0.5f) mask = mask or GamepadButtons.DPAD_LEFT
        if (hatX > 0.5f) mask = mask or GamepadButtons.DPAD_RIGHT
        // Some pads report the D-pad through the hat axes only; others also
        // expose them as buttons, which arrive as key events instead.
        if (mask == 0) {
            val hat = event.getAxisValue(MotionEvent.AXIS_HAT_X)
            if (hat != 0f) Unit
        }
        return mask
    }

    private fun deadzone(value: Float, threshold: Float = 0.12f): Float =
        if (kotlin.math.abs(value) < threshold) 0f else value

    private val GAMEPAD_KEYS = setOf(
        KeyEvent.KEYCODE_BUTTON_A,
        KeyEvent.KEYCODE_BUTTON_B,
        KeyEvent.KEYCODE_BUTTON_X,
        KeyEvent.KEYCODE_BUTTON_Y,
        KeyEvent.KEYCODE_BUTTON_L1,
        KeyEvent.KEYCODE_BUTTON_L2,
        KeyEvent.KEYCODE_BUTTON_R1,
        KeyEvent.KEYCODE_BUTTON_R2,
        KeyEvent.KEYCODE_BUTTON_START,
        KeyEvent.KEYCODE_BUTTON_SELECT,
        KeyEvent.KEYCODE_BUTTON_THUMBL,
        KeyEvent.KEYCODE_BUTTON_THUMBR
    )
}
