package com.neurio.lanstream.input

/**
 * A single input action.
 *
 * [timestampMs] is the *sender's wall clock* (System.currentTimeMillis()).
 * Both phones are normally NTP-synced, and RemoteInputController additionally
 * subtracts the smallest observed one-way delta, so the reported input latency
 * stays meaningful even when the two clocks are a few hundred ms apart.
 */
sealed class InputEvent {
    abstract val timestampMs: Long

    /** [x] and [y] are normalised (0..1) positions inside the streamed picture. */
    data class Touch(
        val action: TouchAction,
        val pointerId: Int,
        val x: Float,
        val y: Float,
        val pressure: Float = 1f,
        override val timestampMs: Long = System.currentTimeMillis()
    ) : InputEvent()

    data class Key(
        val keyCode: Int,
        val down: Boolean,
        override val timestampMs: Long = System.currentTimeMillis()
    ) : InputEvent()

    /** Raw physical gamepad state (client -> host), mapped on the host side. */
    data class Gamepad(
        val buttons: Int,
        val leftX: Float,
        val leftY: Float,
        val rightX: Float,
        val rightY: Float,
        val leftTrigger: Float,
        val rightTrigger: Float,
        val hatX: Float,
        val hatY: Float,
        override val timestampMs: Long = System.currentTimeMillis()
    ) : InputEvent()
}

enum class TouchAction { DOWN, MOVE, UP }

/** Bit flags mirroring Android's gamepad button constants (see GamepadReader). */
object GamepadButtons {
    const val A = 1 shl 0
    const val B = 1 shl 1
    const val X = 1 shl 2
    const val Y = 1 shl 3
    const val L1 = 1 shl 4
    const val R1 = 1 shl 5
    const val L2 = 1 shl 6
    const val R2 = 1 shl 7
    const val START = 1 shl 8
    const val SELECT = 1 shl 9
    const val THUMB_L = 1 shl 10
    const val THUMB_R = 1 shl 11
    const val DPAD_UP = 1 shl 12
    const val DPAD_DOWN = 1 shl 13
    const val DPAD_LEFT = 1 shl 14
    const val DPAD_RIGHT = 1 shl 15
}
