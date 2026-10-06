package com.neurio.lanstream.input

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Point
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import java.util.concurrent.ConcurrentHashMap

/**
 * Optional, user-enabled host input adapter. It uses the public AccessibilityService gesture API;
 * it is not shell/root injection and is not guaranteed to work with protected/anti-cheat games.
 */
class RemoteGameAccessibilityService : AccessibilityService(), GameInputAdapter {
    private data class ActiveStroke(
        var stroke: GestureDescription.StrokeDescription?,
        var x: Float,
        var y: Float,
    )

    private val active = ConcurrentHashMap<Int, ActiveStroke>()
    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: android.view.accessibility.AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        releaseAll()
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun releaseAll() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            active.clear()
            return
        }
        synchronized(active) {
            val builder = GestureDescription.Builder()
            var count = 0
            active.values.forEach { state ->
                val stroke = state.stroke ?: return@forEach
                try {
                    builder.addStroke(stroke.continueStroke(linePath(state.x, state.y, state.x + .5f, state.y), 0, 35, false))
                    count++
                } catch (_: Exception) {
                }
            }
            active.clear()
            if (count > 0) {
                try { dispatchGesture(builder.build(), null, mainHandler) } catch (_: Exception) { }
            }
        }
    }

    override fun pointer(event: RemotePointer): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        if (event.action !in RemoteInputType.POINTER_DOWN..RemoteInputType.POINTER_UP) return false
        val point = toDisplayPoint(event.x, event.y)
        synchronized(active) {
            if (event.action == RemoteInputType.POINTER_DOWN) {
                active[event.pointerId] = ActiveStroke(null, point.x, point.y)
            }
            val target = active[event.pointerId] ?: return false
            val builder = GestureDescription.Builder()
            val updated = HashMap<Int, GestureDescription.StrokeDescription>()
            var strokeCount = 0
            for ((id, state) in active) {
                val isTarget = id == event.pointerId
                val endThisPointer = isTarget && event.action == RemoteInputType.POINTER_UP
                val next = try {
                    when {
                        isTarget && event.action == RemoteInputType.POINTER_DOWN -> {
                            GestureDescription.StrokeDescription(linePath(point.x, point.y, point.x + .5f, point.y), 0, 60_000, true)
                        }
                        state.stroke != null && endThisPointer -> state.stroke!!.continueStroke(linePath(state.x, state.y, point.x, point.y), 0, 45, false)
                        state.stroke != null -> {
                            val destination = if (isTarget) point else PointF(state.x, state.y)
                            val duration = if (isTarget) 35L else 60_000L
                            state.stroke!!.continueStroke(linePath(state.x, state.y, destination.x, destination.y), 0, duration, true)
                        }
                        endThisPointer -> null
                        else -> GestureDescription.StrokeDescription(
                            linePath(if (isTarget) point.x else state.x, if (isTarget) point.y else state.y,
                                (if (isTarget) point.x else state.x) + .5f, if (isTarget) point.y else state.y),
                            0,
                            60_000,
                            true,
                        )
                    }
                } catch (_: Exception) {
                    null
                }
                if (next != null) {
                    builder.addStroke(next)
                    strokeCount++
                    if (!endThisPointer) updated[id] = next
                }
                if (isTarget && !endThisPointer) {
                    state.x = point.x
                    state.y = point.y
                }
            }
            val wasHeld = target.stroke != null
            if (event.action == RemoteInputType.POINTER_UP) active.remove(event.pointerId)
            if (strokeCount == 0) {
                if (event.action == RemoteInputType.POINTER_UP && !wasHeld) dispatchTap(point.x, point.y)
                return true
            }
            updated.forEach { (id, stroke) -> active[id]?.stroke = stroke }
            val accepted = try { dispatchGesture(builder.build(), callbackForAllPointers(), mainHandler) } catch (_: Exception) { false }
            if (!accepted) {
                active.values.forEach { it.stroke = null }
                if (event.action == RemoteInputType.POINTER_UP) dispatchTap(point.x, point.y)
            }
            true
        }
    }

    override fun key(keyCode: Int, down: Boolean, clientTimeNanos: Long): Boolean {
        val positions = when (keyCode) {
            android.view.KeyEvent.KEYCODE_BUTTON_A, android.view.KeyEvent.KEYCODE_DPAD_CENTER -> .86f to .78f
            android.view.KeyEvent.KEYCODE_BUTTON_B -> .95f to .65f
            android.view.KeyEvent.KEYCODE_BUTTON_X -> .77f to .65f
            android.view.KeyEvent.KEYCODE_BUTTON_Y -> .86f to .52f
            android.view.KeyEvent.KEYCODE_BUTTON_L1 -> .14f to .15f
            android.view.KeyEvent.KEYCODE_BUTTON_R1 -> .86f to .15f
            android.view.KeyEvent.KEYCODE_BUTTON_L2 -> .14f to .26f
            android.view.KeyEvent.KEYCODE_BUTTON_R2 -> .86f to .26f
            android.view.KeyEvent.KEYCODE_BUTTON_START -> .55f to .91f
            android.view.KeyEvent.KEYCODE_BUTTON_SELECT -> .45f to .91f
            android.view.KeyEvent.KEYCODE_DPAD_UP -> .16f to .69f
            android.view.KeyEvent.KEYCODE_DPAD_DOWN -> .16f to .87f
            android.view.KeyEvent.KEYCODE_DPAD_LEFT -> .08f to .78f
            android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> .24f to .78f
            else -> return false
        }
        val id = 1000 + keyCode
        return pointer(RemotePointer(if (down) RemoteInputType.POINTER_DOWN else RemoteInputType.POINTER_UP, id, positions.first, positions.second, clientTimeNanos))
    }

    override fun axes(x: Float, y: Float, clientTimeNanos: Long): Boolean {
        val magnitude = kotlin.math.sqrt(x * x + y * y)
        val id = 2000
        if (magnitude < 0.12f) {
            val state = active[id] ?: return true
            return pointer(RemotePointer(RemoteInputType.POINTER_UP, id, state.x, state.y, clientTimeNanos))
        }
        val targetX = (0.16f + x.coerceIn(-1f, 1f) * .085f).coerceIn(.04f, .30f)
        val targetY = (0.78f + y.coerceIn(-1f, 1f) * .12f).coerceIn(.60f, .94f)
        return pointer(RemotePointer(if (active.containsKey(id)) RemoteInputType.POINTER_MOVE else RemoteInputType.POINTER_DOWN, id, targetX, targetY, clientTimeNanos))
    }

    @Suppress("DEPRECATION")
    private fun toDisplayPoint(x: Float, y: Float): PointF {
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val size = Point()
        wm.defaultDisplay.getRealSize(size)
        return PointF(
            (x.coerceIn(0f, 1f) * (size.x - 1).coerceAtLeast(1)).coerceIn(0f, (size.x - 1).toFloat()),
            (y.coerceIn(0f, 1f) * (size.y - 1).coerceAtLeast(1)).coerceIn(0f, (size.y - 1).toFloat()),
        )
    }

    private fun linePath(fromX: Float, fromY: Float, toX: Float, toY: Float) = Path().apply {
        moveTo(fromX, fromY)
        if (fromX == toX && fromY == toY) lineTo(fromX + .1f, fromY) else lineTo(toX, toY)
    }

    private fun dispatchTap(x: Float, y: Float) {
        try {
            dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(linePath(x, y, x + .5f, y), 0, 55)).build(), null, mainHandler)
        } catch (_: Exception) {
        }
    }

    private fun callbackForAllPointers() = object : GestureResultCallback() {
        override fun onCancelled(gestureDescription: GestureDescription?) {
            // Games/vendor policy can cancel a combined multi-touch gesture; transport/video remain alive.
            synchronized(active) { active.values.forEach { it.stroke = null } }
        }
    }

    private data class PointF(val x: Float, val y: Float)

    companion object {
        @Volatile
        var instance: RemoteGameAccessibilityService? = null
            private set
    }
}
