package com.neurio.client

import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import com.neurio.common.Protocol

/**
 * Support for physical Bluetooth/USB gamepads connected to the CLIENT phone.
 * Standard Android gamepad keycodes/axes are mapped into the Neurio input
 * protocol, so a real controller works exactly like the virtual one.
 */
object PhysicalControllerHandler {

    private const val DEADZONE = 0.16f

    private val keyMap = mapOf(
        KeyEvent.KEYCODE_BUTTON_A to Protocol.BTN_A,
        KeyEvent.KEYCODE_BUTTON_B to Protocol.BTN_B,
        KeyEvent.KEYCODE_BUTTON_X to Protocol.BTN_X,
        KeyEvent.KEYCODE_BUTTON_Y to Protocol.BTN_Y,
        KeyEvent.KEYCODE_BUTTON_L1 to Protocol.BTN_L1,
        KeyEvent.KEYCODE_BUTTON_R1 to Protocol.BTN_R1,
        KeyEvent.KEYCODE_BUTTON_L2 to Protocol.BTN_L2,
        KeyEvent.KEYCODE_BUTTON_R2 to Protocol.BTN_R2,
        KeyEvent.KEYCODE_BUTTON_START to Protocol.BTN_START,
        KeyEvent.KEYCODE_BUTTON_SELECT to Protocol.BTN_SELECT,
        KeyEvent.KEYCODE_DPAD_UP to Protocol.BTN_DP_UP,
        KeyEvent.KEYCODE_DPAD_DOWN to Protocol.BTN_DP_DOWN,
        KeyEvent.KEYCODE_DPAD_LEFT to Protocol.BTN_DP_LEFT,
        KeyEvent.KEYCODE_DPAD_RIGHT to Protocol.BTN_DP_RIGHT
    )

    private val pressedState = HashMap<Int, Boolean>()

    fun reset() = pressedState.clear()

    fun isGamepadSource(source: Int): Boolean =
        (source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
            (source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK

    /** Only send on state edges; motion events arrive ~60x per second. */
    private fun edge(buttonId: Int, pressed: Boolean, sender: InputSender) {
        val prev = pressedState[buttonId]
        if (prev != pressed) {
            pressedState[buttonId] = pressed
            sender.button(buttonId, pressed)
        }
    }

    /** @return true when the key was consumed as controller input. */
    fun handleKey(keyCode: Int, down: Boolean, sender: InputSender): Boolean {
        val id = keyMap[keyCode] ?: return false
        edge(id, down, sender)
        return true
    }

    /** @return true when the motion event was consumed as controller input. */
    fun handleMotion(event: MotionEvent, sender: InputSender): Boolean {
        if (!isGamepadSource(event.source)) return false
        val x = deadzone(event.getAxisValue(MotionEvent.AXIS_X))
        val y = deadzone(event.getAxisValue(MotionEvent.AXIS_Y))
        sender.axis(Protocol.AXIS_JOYSTICK, x, y)

        val lt = event.getAxisValue(MotionEvent.AXIS_LTRIGGER)
        val rt = event.getAxisValue(MotionEvent.AXIS_RTRIGGER)
        edge(Protocol.BTN_L2, lt > 0.5f, sender)
        edge(Protocol.BTN_R2, rt > 0.5f, sender)

        val hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X)
        val hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y)
        edge(Protocol.BTN_DP_LEFT, hatX < -0.5f, sender)
        edge(Protocol.BTN_DP_RIGHT, hatX > 0.5f, sender)
        edge(Protocol.BTN_DP_UP, hatY < -0.5f, sender)
        edge(Protocol.BTN_DP_DOWN, hatY > 0.5f, sender)
        return true
    }

    private fun deadzone(v: Float): Float =
        if (Math.abs(v) < DEADZONE) 0f else v
}
