package com.neurio.lanstream.input

import com.neurio.lanstream.core.Ema
import com.neurio.lanstream.core.FpsMeter
import com.neurio.lanstream.core.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.hypot

/**
 * Host side of the input channel: receives [InputEvent]s, maps them onto the
 * host screen and paces them into the active [InputInjector].
 *
 * Why pacing exists: the accessibility API can only run one gesture at a time
 * and every gesture is atomic, so raw 120 Hz touch moves would cancel each
 * other and flood the system. Instead we:
 *   * replay a *new* press immediately (a tap must feel instant),
 *   * coalesce moves and replay them at ~30 Hz as short swipes,
 *   * keep a held finger alive by repeating the press every [HOLD_REPEAT_MS].
 */
class RemoteInputController(
    private val injector: InputInjector,
    private val screenSize: () -> Pair<Int, Int>
) {
    private val lock = Any()
    private val pointers = HashMap<Int, PointerState>()
    private val adapter = GameInputAdapter()

    private val fps = FpsMeter()
    private val latency = Ema(0.15f)

    @Volatile
    private var minDeltaMs = Long.MAX_VALUE

    @Volatile
    var eventsPerSec: Float = 0f
        private set

    @Volatile
    var lastLatencyMs: Float = 0f
        private set

    @Volatile
    var totalEvents: Long = 0L
        private set

    @Volatile
    var lastEventMs: Long = 0L
        private set

    @Volatile
    private var running = false

    fun setLayout(layout: PadLayout) {
        synchronized(lock) { adapter.setLayout(layout) }
    }

    fun onEvent(event: InputEvent) {
        totalEvents++
        lastEventMs = System.currentTimeMillis()
        fps.frame()

        val now = System.currentTimeMillis()
        val delta = now - event.timestampMs
        if (delta in 0..60_000) {
            if (delta < minDeltaMs) minDeltaMs = delta
            val estimate = (delta - minDeltaMs).coerceAtLeast(0L).toFloat()
            lastLatencyMs = latency.add(estimate)
        }

        when (event) {
            is InputEvent.Key -> injector.injectKey(event.keyCode, event.down)
            is InputEvent.Touch -> apply(event)
            is InputEvent.Gamepad -> {
                val mapped = synchronized(lock) { adapter.map(event) }
                mapped.forEach { apply(it) }
            }
        }
    }

    private fun apply(touch: InputEvent.Touch) {
        val (width, height) = screenSize()
        if (width <= 0 || height <= 0) return
        val x = touch.x * width
        val y = touch.y * height

        // Immediate gestures are collected and dispatched *outside* the lock so
        // a slow injector can never block the receive loop.
        var immediate: FloatArray? = null
        synchronized(lock) {
            when (touch.action) {
                TouchAction.DOWN -> {
                    pointers[touch.pointerId] = PointerState(
                        x = x, y = y, lastX = x, lastY = y,
                        lastDispatchMs = System.currentTimeMillis()
                    )
                    immediate = floatArrayOf(x, y, x, y, TAP_DURATION_MS.toFloat())
                }
                TouchAction.MOVE -> {
                    val state = pointers[touch.pointerId]
                    if (state == null) {
                        // Move that lost its DOWN: start the press here.
                        pointers[touch.pointerId] = PointerState(
                            x = x, y = y, lastX = x, lastY = y,
                            lastDispatchMs = System.currentTimeMillis()
                        )
                        immediate = floatArrayOf(x, y, x, y, TAP_DURATION_MS.toFloat())
                    } else {
                        state.x = x
                        state.y = y
                        state.moved = true
                    }
                }
                TouchAction.UP -> {
                    pointers.remove(touch.pointerId)
                }
            }
        }
        immediate?.let { stroke ->
            injector.injectStroke(stroke[0], stroke[1], stroke[2], stroke[3], stroke[4].toLong())
        }
    }

    fun start(scope: CoroutineScope): Job {
        running = true
        return scope.launch {
            while (isActive && running) {
                tick()
                delay(TICK_MS)
            }
        }
    }

    private fun tick() {
        val now = System.currentTimeMillis()
        val strokes = ArrayList<FloatArray>(4)
        synchronized(lock) {
            val iterator = pointers.entries.iterator()
            while (iterator.hasNext()) {
                val state = iterator.next().value
                if (!state.active) {
                    iterator.remove()
                    continue
                }
                val distance = hypot(state.x - state.lastX, state.y - state.lastY)
                when {
                    state.moved && distance >= MIN_MOVE_PX -> {
                        strokes.add(
                            floatArrayOf(
                                state.lastX, state.lastY, state.x, state.y, SWIPE_DURATION_MS.toFloat()
                            )
                        )
                        state.lastX = state.x
                        state.lastY = state.y
                        state.moved = false
                        state.lastDispatchMs = now
                    }
                    now - state.lastDispatchMs >= HOLD_REPEAT_MS -> {
                        strokes.add(
                            floatArrayOf(state.x, state.y, state.x, state.y, HOLD_DURATION_MS.toFloat())
                        )
                        state.lastDispatchMs = now
                    }
                }
            }
        }
        strokes.forEach { stroke ->
            injector.injectStroke(
                stroke[0], stroke[1], stroke[2], stroke[3], stroke[4].toLong()
            )
        }
        eventsPerSec = fps.fps(now)
    }

    fun reset() {
        synchronized(lock) { pointers.clear() }
        minDeltaMs = Long.MAX_VALUE
        totalEvents = 0
        latency.reset()
        fps.reset()
    }

    fun stop() {
        running = false
        synchronized(lock) { pointers.clear() }
        Log.i("RemoteInputController stopped (${injector.describe()})")
    }

    private class PointerState(
        var x: Float,
        var y: Float,
        var lastX: Float,
        var lastY: Float,
        var active: Boolean = true,
        var moved: Boolean = false,
        var lastDispatchMs: Long = 0L
    )

    companion object {
        private const val TICK_MS = 33L
        private const val TAP_DURATION_MS = 30L
        private const val SWIPE_DURATION_MS = 45L
        private const val HOLD_DURATION_MS = 90L
        private const val HOLD_REPEAT_MS = 130L
        private const val MIN_MOVE_PX = 4f
    }
}
