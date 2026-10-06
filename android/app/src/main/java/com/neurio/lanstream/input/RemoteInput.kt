package com.neurio.lanstream.input

import android.view.KeyEvent
import com.neurio.lanstream.protocol.LanProtocol

object RemoteInputType {
    const val POINTER_DOWN = 1
    const val POINTER_MOVE = 2
    const val POINTER_UP = 3
    const val KEY = 4
    const val AXIS = 5
}

interface InputTransport {
    fun sendPointer(action: Int, pointerId: Int, x: Float, y: Float, clientTimeNanos: Long)
    fun sendKey(keyCode: Int, down: Boolean, clientTimeNanos: Long)
    fun sendAxes(x: Float, y: Float, clientTimeNanos: Long)
}

data class RemotePointer(
    val action: Int,
    val pointerId: Int,
    val x: Float,
    val y: Float,
    val clientTimeNanos: Long,
)

/** The narrow adapter boundary. Stock Android may require the user to opt into Accessibility gestures. */
interface GameInputAdapter {
    fun pointer(event: RemotePointer): Boolean
    fun key(keyCode: Int, down: Boolean, clientTimeNanos: Long): Boolean
    fun axes(x: Float, y: Float, clientTimeNanos: Long): Boolean
    fun releaseAll()
}

class RemoteInputController(
    private val adapterProvider: () -> GameInputAdapter?,
    private val onAvailabilityChanged: (Boolean) -> Unit,
) {
    @Volatile private var lastAvailable: Boolean? = null
    private val keyPointerIds = HashMap<Int, Int>()
    private var axesActive = false
    private val axesPointerId = 2000

    fun handlePointer(event: RemotePointer) {
        checkAvailability()
        adapterProvider()?.pointer(event)
    }

    @Synchronized
    fun handleKey(keyCode: Int, down: Boolean, timeNanos: Long) {
        val adapter = adapterProvider()
        setAvailability(adapter != null)
        val position = keyPosition(keyCode) ?: return
        val pointerId = keyPointerIds.getOrPut(keyCode) { 1000 + keyCode }
        val action = if (down) RemoteInputType.POINTER_DOWN else RemoteInputType.POINTER_UP
        adapter?.pointer(RemotePointer(action, pointerId, position.first, position.second, timeNanos))
        if (!down) keyPointerIds.remove(keyCode)
    }

    @Synchronized
    fun handleAxes(x: Float, y: Float, timeNanos: Long) {
        val adapter = adapterProvider()
        setAvailability(adapter != null)
        if (adapter == null) return
        val clampedX = x.coerceIn(-1f, 1f)
        val clampedY = y.coerceIn(-1f, 1f)
        val magnitude = kotlin.math.sqrt(clampedX * clampedX + clampedY * clampedY)
        if (magnitude < 0.12f) {
            if (axesActive) adapter.pointer(RemotePointer(RemoteInputType.POINTER_UP, axesPointerId, 0.16f, 0.78f, timeNanos))
            axesActive = false
            return
        }
        val px = (0.16f + clampedX * 0.085f).coerceIn(0.04f, 0.30f)
        val py = (0.78f + clampedY * 0.12f).coerceIn(0.60f, 0.94f)
        adapter.pointer(RemotePointer(if (axesActive) RemoteInputType.POINTER_MOVE else RemoteInputType.POINTER_DOWN, axesPointerId, px, py, timeNanos))
        axesActive = true
    }

    @Synchronized
    fun releaseAll() {
        adapterProvider()?.releaseAll()
        keyPointerIds.clear()
        axesActive = false
    }

    private fun checkAvailability() {
        setAvailability(adapterProvider() != null)
    }

    @Synchronized
    private fun setAvailability(available: Boolean) {
        if (lastAvailable != available) {
            lastAvailable = available
            onAvailabilityChanged(available)
        }
    }

    private fun keyPosition(keyCode: Int): Pair<Float, Float>? = when (keyCode) {
        KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_DPAD_CENTER -> .86f to .78f
        KeyEvent.KEYCODE_BUTTON_B -> .95f to .65f
        KeyEvent.KEYCODE_BUTTON_X -> .77f to .65f
        KeyEvent.KEYCODE_BUTTON_Y -> .86f to .52f
        KeyEvent.KEYCODE_BUTTON_L1 -> .14f to .15f
        KeyEvent.KEYCODE_BUTTON_R1 -> .86f to .15f
        KeyEvent.KEYCODE_BUTTON_L2 -> .14f to .26f
        KeyEvent.KEYCODE_BUTTON_R2 -> .86f to .26f
        KeyEvent.KEYCODE_BUTTON_START -> .55f to .91f
        KeyEvent.KEYCODE_BUTTON_SELECT -> .45f to .91f
        KeyEvent.KEYCODE_DPAD_UP -> .16f to .69f
        KeyEvent.KEYCODE_DPAD_DOWN -> .16f to .87f
        KeyEvent.KEYCODE_DPAD_LEFT -> .08f to .78f
        KeyEvent.KEYCODE_DPAD_RIGHT -> .24f to .78f
        else -> null
    }
}
