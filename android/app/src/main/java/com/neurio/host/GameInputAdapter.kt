package com.neurio.host

import android.content.Context
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityManager
import com.neurio.common.AppLog
import com.neurio.common.Protocol

/**
 * Input abstraction on the host: remote input events -> something Android
 * legitimately allows.
 *
 * REALITY CHECK (stock Android):
 *  - There is NO public API that lets an app inject touch events into another
 *    arbitrary app's window. Root or system signing would be required for the
 *    `InputManager.injectInputEvent` path, and Neurio does not attempt that.
 *  - The legitimate mechanism Android ships is AccessibilityService's
 *    `dispatchGesture`, which the system executes on the user's behalf after
 *    they explicitly enable the service. Neurio uses exactly that.
 *  - Games that require a physical controller, or that actively block
 *    accessibility-injected gestures (some anti-cheat setups), will not
 *    respond. Neurio reports this instead of pretending otherwise.
 */
interface GameInputAdapter {
    val name: String
    val active: Boolean
    val limitations: List<String>
    fun start(displayWidth: Int, displayHeight: Int)
    fun stop()
    fun onInput(event: Protocol.InputEvent)
}

/** Injection backend. Bound instance of InputAccessibilityService provides it. */
interface GestureDispatcher {
    val available: Boolean
    fun tap(x: Float, y: Float): Boolean
    fun gestureStart(id: Int, x: Float, y: Float): Boolean
    fun gestureMove(id: Int, x: Float, y: Float): Boolean
    fun gestureEnd(id: Int, x: Float, y: Float): Boolean
    fun globalAction(action: Int): Boolean
}

/** Static hand-over point between the accessibility service and the stream server. */
object InputInjector {
    @Volatile
    var dispatcher: GestureDispatcher? = null

    fun isEnabled(context: Context): Boolean {
        val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        return try {
            am.getEnabledAccessibilityServiceList(android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
                .any { it.resolveInfo?.serviceInfo?.packageName == context.packageName }
        } catch (e: Exception) {
            dispatcher != null
        }
    }
}

/**
 * Maps normalized (0..1) stream coordinates onto host display pixels and
 * converts the input protocol into synthesized touch gestures.
 *
 * Because the VirtualDisplay mirrors the host display, a widget at relative
 * position (nx, ny) on the client corresponds to the same relative position
 * on the host screen - which is where the game's own touch controls sit.
 */
class InputMapper(var displayWidth: Int, var displayHeight: Int) {
    fun px(nx: Float): Float = nx * displayWidth
    fun py(ny: Float): Float = ny * displayHeight
}

/**
 * The actual adapter: touch-through + virtual widgets become accessibility
 * gestures. One synthesized pointer per control id.
 */
class TouchInjectionAdapter(private val context: Context) : GameInputAdapter {

    companion object {
        private const val TAG = "TouchInjection"
        // Default anchors for widgets, matching common mobile game HUD layouts.
        private const val JOY_BASE_X = 0.16f
        private const val JOY_BASE_Y = 0.74f
        private const val BTN_CLUSTER_X = 0.84f
        private const val BTN_CLUSTER_Y = 0.72f
        private const val DPAD_X = 0.16f
        private const val DPAD_Y = 0.40f
        private const val L1_X = 0.10f
        private const val R1_X = 0.90f
        private const val SHOULDER_Y = 0.08f
        private const val START_X = 0.50f
        private const val START_Y = 0.05f
    }

    override val name: String = "Accessibility gesture injection"

    override val active: Boolean
        get() = InputInjector.dispatcher?.available == true

    override val limitations: List<String> = listOf(
        "Requires the Neurio Input Service (Accessibility) enabled on the host",
        "Injected as synthesized touch: games needing a physical controller won't respond",
        "Single synthesized pointer per control; multi-touch combos are limited",
        "Anti-cheat protected titles may ignore or block injected gestures"
    )

    private var mapper = InputMapper(1920, 1080)
    private var joystickEngaged = false

    override fun start(displayWidth: Int, displayHeight: Int) {
        mapper = InputMapper(displayWidth, displayHeight)
        joystickEngaged = false
        AppLog.i(TAG, "adapter ready for ${displayWidth}x${displayHeight} display")
    }

    override fun stop() {
        val d = InputInjector.dispatcher
        if (d != null && joystickEngaged) {
            d.gestureEnd(Protocol.AXIS_JOYSTICK, mapper.px(JOY_BASE_X), mapper.py(JOY_BASE_Y))
        }
        joystickEngaged = false
    }

    override fun onInput(event: Protocol.InputEvent) {
        val d = InputInjector.dispatcher
        if (d == null || !d.available) return
        when (event.evType) {
            Protocol.INPUT_TOUCH_DOWN ->
                d.gestureStart(100, mapper.px(event.x), mapper.py(event.y))
            Protocol.INPUT_TOUCH_MOVE ->
                d.gestureMove(100, mapper.px(event.x), mapper.py(event.y))
            Protocol.INPUT_TOUCH_UP ->
                d.gestureEnd(100, mapper.px(event.x), mapper.py(event.y))
            Protocol.INPUT_TAP ->
                d.tap(mapper.px(event.x), mapper.py(event.y))
            Protocol.INPUT_AXIS -> handleAxis(d, event)
            Protocol.INPUT_BUTTON -> handleButton(d, event)
            Protocol.INPUT_KEY -> handleKey(d, event)
            else -> Unit
        }
    }

    private fun handleAxis(d: GestureDispatcher, event: Protocol.InputEvent) {
        if (event.code != Protocol.AXIS_JOYSTICK) return
        val deflection = Math.hypot(event.x.toDouble(), event.y.toDouble()).toFloat()
        val range = minOf(mapper.displayWidth, mapper.displayHeight) * 0.13f
        val tx = mapper.px(JOY_BASE_X) + event.x * range
        val ty = mapper.py(JOY_BASE_Y) + event.y * range
        if (!joystickEngaged) {
            if (deflection < 0.12f) return // inside deadzone, nothing pressed yet
            if (d.gestureStart(Protocol.AXIS_JOYSTICK, mapper.px(JOY_BASE_X), mapper.py(JOY_BASE_Y))) {
                joystickEngaged = true
                d.gestureMove(Protocol.AXIS_JOYSTICK, tx, ty)
            }
        } else {
            if (deflection < 0.08f) {
                d.gestureEnd(Protocol.AXIS_JOYSTICK, mapper.px(JOY_BASE_X), mapper.py(JOY_BASE_Y))
                joystickEngaged = false
            } else {
                d.gestureMove(Protocol.AXIS_JOYSTICK, tx, ty)
            }
        }
    }

    private fun handleButton(d: GestureDispatcher, event: Protocol.InputEvent) {
        if (event.value < 0.5f) return // release: taps are instantaneous
        val pos = when (event.code) {
            Protocol.BTN_A -> Pair(BTN_CLUSTER_X, BTN_CLUSTER_Y + 0.06f)
            Protocol.BTN_B -> Pair(BTN_CLUSTER_X + 0.06f, BTN_CLUSTER_Y)
            Protocol.BTN_X -> Pair(BTN_CLUSTER_X - 0.06f, BTN_CLUSTER_Y)
            Protocol.BTN_Y -> Pair(BTN_CLUSTER_X, BTN_CLUSTER_Y - 0.06f)
            Protocol.BTN_L1, Protocol.BTN_L2 -> Pair(L1_X, SHOULDER_Y)
            Protocol.BTN_R1, Protocol.BTN_R2 -> Pair(R1_X, SHOULDER_Y)
            Protocol.BTN_START -> Pair(START_X, START_Y)
            Protocol.BTN_SELECT -> Pair(START_X - 0.08f, START_Y)
            Protocol.BTN_DP_UP -> Pair(DPAD_X, DPAD_Y - 0.06f)
            Protocol.BTN_DP_DOWN -> Pair(DPAD_X, DPAD_Y + 0.06f)
            Protocol.BTN_DP_LEFT -> Pair(DPAD_X - 0.06f, DPAD_Y)
            Protocol.BTN_DP_RIGHT -> Pair(DPAD_X + 0.06f, DPAD_Y)
            else -> null
        } ?: return
        d.tap(mapper.px(pos.first), mapper.py(pos.second))
    }

    private fun handleKey(d: GestureDispatcher, event: Protocol.InputEvent) {
        if (event.value < 0.5f) return
        val action = when (event.code) {
            4 -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK
            3 -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME
            187 -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_RECENTS
            else -> return
        }
        d.globalAction(action)
    }
}

/** Used when we cannot build the real adapter; keeps the stream alive. */
class NullInputAdapter : GameInputAdapter {
    override val name: String = "None (input service disabled)"
    override val active: Boolean = false
    override val limitations: List<String> = listOf(
        "Enable the Neurio Input Service (Accessibility) on the host to forward controls"
    )

    override fun start(displayWidth: Int, displayHeight: Int) {}
    override fun stop() {}
    override fun onInput(event: Protocol.InputEvent) {}
}

/**
 * AccessibilityService acting as the gesture dispatcher. The user must enable
 * it manually in system settings - Android requires explicit consent, which
 * is exactly why this path is legitimate.
 */
class InputAccessibilityService : android.accessibilityservice.AccessibilityService(),
    GestureDispatcher {

    companion object {
        private const val TAG = "InputA11yService"
        private const val SEGMENT_MS = 40L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val continuations = HashMap<Int, android.accessibilityservice.GestureDescription.StrokeDescription>()

    override fun onServiceConnected() {
        super.onServiceConnected()
        InputInjector.dispatcher = this
        AppLog.i(TAG, "connected; gesture injection available")
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        if (InputInjector.dispatcher === this) InputInjector.dispatcher = null
        AppLog.i(TAG, "disconnected")
        return super.onUnbind(intent)
    }

    override val available: Boolean get() = true

    override fun onAccessibilityEvent(event: android.view.accessibility.AccessibilityEvent?) {
        // Not used: this service exists purely for dispatchGesture.
    }

    override fun onInterrupt() {}

    override fun tap(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val stroke = android.accessibilityservice.GestureDescription.StrokeDescription(
            path, 0, 55
        )
        return dispatchGestureSafe(android.accessibilityservice.GestureDescription.Builder().addStroke(stroke).build())
    }

    override fun gestureStart(id: Int, x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val stroke = android.accessibilityservice.GestureDescription.StrokeDescription(
            path, 0, SEGMENT_MS, true
        )
        continuations[id] = stroke
        return dispatchGestureSafe(
            android.accessibilityservice.GestureDescription.Builder().addStroke(stroke).build()
        )
    }

    override fun gestureMove(id: Int, x: Float, y: Float): Boolean {
        val prev = continuations[id] ?: return false
        val path = Path().apply { moveTo(x, y) }
        val next = try {
            prev.continueStroke(path, 0, SEGMENT_MS, true)
        } catch (e: Exception) {
            AppLog.w(TAG, "continueStroke failed: ${e.message}")
            return false
        }
        continuations[id] = next
        return dispatchGestureSafe(
            android.accessibilityservice.GestureDescription.Builder().addStroke(next).build()
        )
    }

    override fun gestureEnd(id: Int, x: Float, y: Float): Boolean {
        val prev = continuations.remove(id) ?: return false
        val path = Path().apply { moveTo(x, y) }
        val next = try {
            prev.continueStroke(path, 0, SEGMENT_MS, false)
        } catch (e: Exception) {
            return false
        }
        return dispatchGestureSafe(
            android.accessibilityservice.GestureDescription.Builder().addStroke(next).build()
        )
    }

    override fun globalAction(action: Int): Boolean = try {
        performGlobalAction(action)
    } catch (e: Exception) {
        false
    }

    private fun dispatchGestureSafe(gesture: android.accessibilityservice.GestureDescription): Boolean {
        return try {
            dispatchGesture(gesture, null, handler)
        } catch (e: Exception) {
            AppLog.w(TAG, "dispatchGesture failed: ${e.message}")
            false
        }
    }
}
