package com.neurio.lanstream.input

import com.neurio.lanstream.net.Protocol
import java.nio.ByteBuffer

/**
 * Binary encoding of input events.
 *
 * Input is the one channel where latency beats reliability, so it rides on UDP
 * and every event is at most 32 bytes of payload. Each datagram repeats the
 * session id + token, and the host drops anything that does not match the
 * session it authenticated.
 */
object InputWire {

    fun typeOf(event: InputEvent): Byte = when (event) {
        is InputEvent.Touch -> when (event.action) {
            TouchAction.DOWN -> Protocol.INPUT_TOUCH_DOWN
            TouchAction.MOVE -> Protocol.INPUT_TOUCH_MOVE
            TouchAction.UP -> Protocol.INPUT_TOUCH_UP
        }
        is InputEvent.Key -> if (event.down) Protocol.INPUT_KEY_DOWN else Protocol.INPUT_KEY_UP
        is InputEvent.Gamepad -> Protocol.INPUT_GAMEPAD
    }

    fun encode(event: InputEvent): ByteArray = when (event) {
        is InputEvent.Touch -> {
            val out = ByteArray(16)
            val bb = ByteBuffer.wrap(out)
            bb.putInt(event.pointerId)
            bb.putFloat(event.x)
            bb.putFloat(event.y)
            bb.putFloat(event.pressure)
            out
        }
        is InputEvent.Key -> {
            val out = ByteArray(8)
            val bb = ByteBuffer.wrap(out)
            bb.putInt(event.keyCode)
            bb.putInt(if (event.down) 1 else 0)
            out
        }
        is InputEvent.Gamepad -> {
            val out = ByteArray(36)
            val bb = ByteBuffer.wrap(out)
            bb.putInt(event.buttons)
            bb.putFloat(event.leftX)
            bb.putFloat(event.leftY)
            bb.putFloat(event.rightX)
            bb.putFloat(event.rightY)
            bb.putFloat(event.leftTrigger)
            bb.putFloat(event.rightTrigger)
            bb.putFloat(event.hatX)
            bb.putFloat(event.hatY)
            out
        }
    }

    /**
     * Decodes an input payload. Coordinates are clamped to 0..1 so a corrupt or
     * malicious datagram can never make the host touch outside of its screen.
     */
    fun decode(type: Byte, payload: ByteArray, offset: Int, length: Int, timestampMs: Long): InputEvent? {
        if (offset < 0 || length < 0 || offset + length > payload.size) return null
        val bb = ByteBuffer.wrap(payload, offset, length)
        return runCatching {
            when (type) {
                Protocol.INPUT_TOUCH_DOWN, Protocol.INPUT_TOUCH_MOVE, Protocol.INPUT_TOUCH_UP -> {
                    if (length < 16) return null
                    val pointerId = bb.int
                    val x = bb.float
                    val y = bb.float
                    val pressure = bb.float
                    if (x.isNaN() || y.isNaN()) return null
                    InputEvent.Touch(
                        action = when (type) {
                            Protocol.INPUT_TOUCH_DOWN -> TouchAction.DOWN
                            Protocol.INPUT_TOUCH_MOVE -> TouchAction.MOVE
                            else -> TouchAction.UP
                        },
                        pointerId = pointerId,
                        x = x.coerceIn(0f, 1f),
                        y = y.coerceIn(0f, 1f),
                        pressure = if (pressure.isNaN()) 1f else pressure.coerceIn(0f, 1f)
                    )
                }
                Protocol.INPUT_KEY_DOWN, Protocol.INPUT_KEY_UP -> {
                    if (length < 8) return null
                    InputEvent.Key(bb.int, bb.int == 1, timestampMs)
                }
                Protocol.INPUT_GAMEPAD -> {
                    if (length < 36) return null
                    InputEvent.Gamepad(
                        buttons = bb.int,
                        leftX = bb.float.coerceIn(-1f, 1f),
                        leftY = bb.float.coerceIn(-1f, 1f),
                        rightX = bb.float.coerceIn(-1f, 1f),
                        rightY = bb.float.coerceIn(-1f, 1f),
                        leftTrigger = bb.float.coerceIn(0f, 1f),
                        rightTrigger = bb.float.coerceIn(0f, 1f),
                        hatX = bb.float.coerceIn(-1f, 1f),
                        hatY = bb.float.coerceIn(-1f, 1f)
                    )
                }
                else -> null
            }
        }.getOrNull()
    }
}
