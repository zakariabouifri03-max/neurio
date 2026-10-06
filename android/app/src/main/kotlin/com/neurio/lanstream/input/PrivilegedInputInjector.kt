package com.neurio.lanstream.input

import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import com.neurio.lanstream.core.InputMode
import com.neurio.lanstream.core.Log
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Privileged injection: the honest "power user" path.
 *
 * Two attempts, in order:
 *
 *  1. Reflection on the hidden `InputManager.injectInputEvent()`. It only
 *     succeeds when the app holds android.permission.INJECT_EVENTS, i.e. when
 *     the APK is installed as a privileged/system app or runs as the shell
 *     user. From an ordinary install this throws SecurityException, which we
 *     catch and report as unavailable.
 *
 *  2. `su -c input ...` on a rooted device. This is real injection through the
 *     shell user, but each command costs tens of milliseconds, so it is fine
 *     for taps and menus and poor for driving a racing game.
 *
 * Nothing here pretends to be possible on a stock, un-rooted, non-system app.
 */
class PrivilegedInputInjector : InputInjector {

    //TODO(platform-limit): InputManager.injectInputEvent() is hidden and guarded
    // by android.permission.INJECT_EVENTS, a signature|privileged permission a
    // normal APK can never hold; since Android 11 the hidden-API blocklist also
    // stops the reflective lookup. We try it, catch the failure and fall back.
    //
    //TODO(platform-limit): the `su -c input ...` fallback only exists on rooted
    // devices, costs tens of ms per event and cannot express multi-touch or
    // pressure, so it is usable for menus and taps, not for driving gameplay.
    // Replacing it properly would mean a privileged/system companion app, which
    // is outside what can be shipped as an ordinary APK.

    override val mode: InputMode = InputMode.ROOT

    private val executor = Executors.newSingleThreadExecutor()

    @Volatile
    private var rooted: Boolean = false

    @Volatile
    private var reflectionReady: Boolean = false

    @Volatile
    private var probeDone: Boolean = false

    private val probing = AtomicBoolean(false)

    private var inputManager: Any? = null
    private var injectMethod: java.lang.reflect.Method? = null

    private fun probe() {
        if (probeDone || !probing.compareAndSet(false, true)) return
        executor.execute {
            try {
                rooted = runCommand("su", "-c", "id")
                val managerClass = Class.forName("android.hardware.input.InputManager")
                val getInstance = managerClass.getDeclaredMethod("getInstance")
                getInstance.isAccessible = true
                val instance = getInstance.invoke(null)
                val method = managerClass.getMethod(
                    "injectInputEvent",
                    android.view.InputEvent::class.java,
                    Int::class.javaPrimitiveType
                )
                method.isAccessible = true
                inputManager = instance
                injectMethod = method
                // Prove it is callable right now, not just present.
                val now = SystemClock.uptimeMillis()
                val probeEvent = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, 0f, 0f, 0)
                runCatching { method.invoke(instance, probeEvent, INJECT_MODE_ASYNC) }
                    .onFailure { throw it }
                probeEvent.recycle()
                reflectionReady = true
                Log.i("Privileged injection available via reflection")
            } catch (t: Throwable) {
                reflectionReady = false
                Log.i("Privileged injection unavailable: ${t.javaClass.simpleName}")
            } finally {
                probeDone = true
                probing.set(false)
            }
        }
    }

    override fun isAvailable(): Boolean {
        probe()
        if (probeDone) return rooted || reflectionReady
        // First call happens before the probe thread finishes: report the
        // optimistic answer and let the caller retry later.
        return false
    }

    override fun describe(): String =
        "Root/shell injection (`input` command" +
            if (reflectionReady) " + InputManager reflection)" else ")"

    override fun injectStroke(
        fromX: Float,
        fromY: Float,
        toX: Float,
        toY: Float,
        durationMs: Long
    ): Boolean {
        probe()
        val method = injectMethod
        val manager = inputManager
        if (reflectionReady && method != null && manager != null) {
            executor.execute {
                runCatching { performMotion(method, manager, fromX, fromY, toX, toY, durationMs) }
                    .onFailure { Log.w("injectInputEvent failed: ${it.message}") }
            }
            return true
        }
        if (!rooted) return false
        executor.execute {
            val duration = durationMs.coerceIn(1L, 10_000L)
            runCommand(
                "su", "-c",
                "input touchscreen swipe " +
                    "${fromX.toInt()} ${fromY.toInt()} ${toX.toInt()} ${toY.toInt()} $duration"
            )
        }
        return true
    }

    private fun performMotion(
        method: java.lang.reflect.Method,
        manager: Any,
        fromX: Float,
        fromY: Float,
        toX: Float,
        toY: Float,
        durationMs: Long
    ) {
        val start = SystemClock.uptimeMillis()
        val steps = (durationMs / 20).toInt().coerceIn(1, 8)
        injectMotion(method, manager, MotionEvent.ACTION_DOWN, fromX, fromY, start)
        for (i in 1..steps) {
            val fraction = i.toFloat() / steps
            val x = fromX + (toX - fromX) * fraction
            val y = fromY + (toY - fromY) * fraction
            SystemClock.sleep((durationMs / steps).coerceAtMost(50))
            injectMotion(method, manager, MotionEvent.ACTION_MOVE, x, y, SystemClock.uptimeMillis())
        }
        injectMotion(method, manager, MotionEvent.ACTION_UP, toX, toY, SystemClock.uptimeMillis())
    }

    private fun injectMotion(
        method: java.lang.reflect.Method,
        manager: Any,
        action: Int,
        x: Float,
        y: Float,
        time: Long
    ) {
        val event = MotionEvent.obtain(time, time, action, x, y, 0)
        event.source = InputDevice.SOURCE_TOUCHSCREEN
        try {
            method.invoke(manager, event, INJECT_MODE_ASYNC)
        } finally {
            event.recycle()
        }
    }

    override fun injectKey(keyCode: Int, down: Boolean): Boolean {
        if (!down) return false
        probe()
        if (!rooted) return false
        executor.execute { runCommand("su", "-c", "input keyevent $keyCode") }
        return true
    }

    private fun runCommand(vararg args: String): Boolean {
        return try {
            val process = ProcessBuilder(*args)
                .redirectErrorStream(true)
                .start()
            val finished = process.waitFor(3, TimeUnit.SECONDS)
            if (finished) {
                process.exitValue() == 0
            } else {
                process.destroy()
                false
            }
        } catch (t: Throwable) {
            Log.w("Shell command failed (${args.joinToString(" ")}): ${t.message}")
            false
        }
    }

    companion object {
        /** InputManager.INJECT_INPUT_EVENT_MODE_ASYNC */
        private const val INJECT_MODE_ASYNC = 0

        fun overlayPermissionRequired(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
        fun canDrawOverlays(context: android.content.Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

        fun keyName(keyCode: Int): String = KeyEvent.keyCodeToString(keyCode)
    }
}
