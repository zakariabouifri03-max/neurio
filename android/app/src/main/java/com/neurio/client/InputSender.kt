package com.neurio.client

import android.os.SystemClock
import com.neurio.common.Protocol

/**
 * Client -> host input path. Widgets and the touch layer feed this class;
 * events go out over UDP immediately (fire and forget, latency first).
 */
class InputSender(private val client: StreamClient) {

    private val sessionStartMs = SystemClock.elapsedRealtime()

    private fun ts(): Int = (SystemClock.elapsedRealtime() - sessionStartMs).toInt()

    fun touchDown(x: Float, y: Float) =
        send(Protocol.INPUT_TOUCH_DOWN, 0, x, y, 1f)

    fun touchMove(x: Float, y: Float) =
        send(Protocol.INPUT_TOUCH_MOVE, 0, x, y, 1f)

    fun touchUp(x: Float, y: Float) =
        send(Protocol.INPUT_TOUCH_UP, 0, x, y, 0f)

    fun tap(x: Float, y: Float) =
        send(Protocol.INPUT_TAP, 0, x, y, 1f)

    fun axis(axisId: Int, x: Float, y: Float) =
        send(Protocol.INPUT_AXIS, axisId, x, y, 0f)

    fun button(buttonId: Int, pressed: Boolean) =
        send(Protocol.INPUT_BUTTON, buttonId, 0f, 0f, if (pressed) 1f else 0f)

    fun key(keyCode: Int, pressed: Boolean) =
        send(Protocol.INPUT_KEY, keyCode, 0f, 0f, if (pressed) 1f else 0f)

    private fun send(evType: Int, code: Int, x: Float, y: Float, value: Float) {
        client.sendInput(
            Protocol.InputEvent(
                evType = evType,
                code = code,
                flags = 0,
                x = x,
                y = y,
                value = value,
                seq = 0, // filled by InputPacketizer
                tsMs = ts()
            )
        )
    }
}
