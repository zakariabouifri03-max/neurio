package com.aivision4k.sdk

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.util.DisplayMetrics
import android.view.Display
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Collects the device facts only the Java/Kotlin side can read, as the JSON
 * document `v4k::Engine::updateAndroidCaps` expects.
 *
 * Two rules govern this file:
 *
 *  1. **Only report what was actually read.** A field the platform refuses to
 *     give us is left out (or set to zero/empty) and the engine's compatibility
 *     rules treat it as unknown — they never assume the best case.
 *  2. **No hidden capability claims.** Android gives normal apps no way to
 *     enumerate NPUs or to read a SoC temperature, so this collector does not
 *     pretend to: it reports NNAPI *presence* (an OS level fact) and explains in
 *     `note` why the accelerator list is empty.
 */
object AndroidCapsCollector {

    fun collect(context: Context): JSONObject = JSONObject().apply {
        put("android", androidCaps(context))
        put("memory", memoryCaps(context))
        put("neural", neuralCaps())
        put("thermal", thermalCaps(context))
        put("gles", glesCaps())
    }

    // -----------------------------------------------------------------------
    // Android / display
    // -----------------------------------------------------------------------
    private fun androidCaps(context: Context): JSONObject {
        val metrics = displayMetrics(context)
        return JSONObject().apply {
            put("sdkInt", Build.VERSION.SDK_INT)
            put("release", Build.VERSION.RELEASE ?: "")
            // SOC_MODEL / SOC_MANUFACTURER exist from API 31; below that the
            // board/hardware strings are all the platform publishes.
            put("socModel", if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL ?: "" else "")
            put("socManufacturer", if (Build.VERSION.SDK_INT >= 31) Build.SOC_MANUFACTURER ?: "" else "")
            put("hardware", Build.HARDWARE ?: "")
            put("board", Build.BOARD ?: "")
            put("cpuCoreCount", Runtime.getRuntime().availableProcessors())
            put("cpuArch", cpuArch())
            put("supportsArm64", Build.SUPPORTED_ABIS.any { it == "arm64-v8a" })
            put("isEmulator", isEmulator())
            put("hdrDisplay", hdrDisplay(context))
            put("displayRefreshRate", refreshRate(context))
            put("displayWidth", metrics?.widthPixels ?: 0)
            put("displayHeight", metrics?.heightPixels ?: 0)
            put("displayDensityDpi", metrics?.densityDpi ?: 0)
        }
    }

    /** 0 unknown, 1 arm32, 2 arm64, 3 x86_64 — matches the native enum. */
    private fun cpuArch(): Int {
        val abi = Build.SUPPORTED_ABIS.firstOrNull() ?: return 0
        return when (abi) {
            "arm64-v8a" -> 2
            "armeabi-v7a", "armeabi" -> 1
            "x86_64" -> 3
            else -> 0
        }
    }

    private fun isEmulator(): Boolean {
        val fingerprint = Build.FINGERPRINT ?: ""
        val model = Build.MODEL ?: ""
        val hardware = Build.HARDWARE ?: ""
        return fingerprint.startsWith("generic") ||
            fingerprint.contains("emulator") ||
            model.contains("google_sdk") ||
            model.contains("Emulator") ||
            model.contains("Android SDK built for") ||
            hardware.contains("goldfish") ||
            hardware.contains("ranchu")
    }

    private fun hdrDisplay(context: Context): Boolean {
        val display = display(context) ?: return false
        return try {
            display.hdrCapabilities?.supportedHdrTypes?.isNotEmpty() == true
        } catch (error: Throwable) {
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun display(context: Context): Display? = try {
        val manager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        manager?.defaultDisplay
    } catch (error: Throwable) {
        null
    }

    /**
     * Current refresh rate in Hz.
     *
     * `DisplayMetrics.refreshRate` is not part of the public platform jar on
     * every SDK level, so the rate is read from the `Display` itself, which has
     * exposed it since API 1. Falling back to 60 Hz is a deliberate, visible
     * default: the engine treats the rate as a hint, never as a measurement.
     */
    @Suppress("DEPRECATION")
    private fun refreshRate(context: Context): Float = try {
        val manager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        manager?.defaultDisplay?.refreshRate?.takeIf { it > 0f } ?: 60.0f
    } catch (error: Throwable) {
        60.0f
    }

    @Suppress("DEPRECATION")
    private fun displayMetrics(context: Context): DisplayMetrics? = try {
        val manager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        val metrics = DisplayMetrics()
        manager?.defaultDisplay?.getRealMetrics(metrics)
        metrics
    } catch (error: Throwable) {
        null
    }

    // -----------------------------------------------------------------------
    // Memory
    // -----------------------------------------------------------------------
    private fun memoryCaps(context: Context): JSONObject {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val info = ActivityManager.MemoryInfo()
        return JSONObject().apply {
            if (manager != null) {
                manager.getMemoryInfo(info)
                put("totalRamBytes", info.totalMem)
                put("availableRamBytes", info.availMem)
                put("lowRamDevice", info.lowMemory || manager.isLowRamDevice)
                put("memoryClassMb", manager.memoryClass)
                put("largeMemoryClassMb", manager.largeMemoryClass)
            } else {
                put("totalRamBytes", 0)
                put("availableRamBytes", 0)
                put("lowRamDevice", false)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Neural acceleration
    // -----------------------------------------------------------------------
    private fun neuralCaps(): JSONObject {
        val available = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1
        return JSONObject().apply {
            put("nnapiAvailable", available)
            // The NNAPI *feature level* and the accelerator list are only
            // reachable through the NNAPI NDK API (ANeuralNetworks_*), which
            // this build does not include: reporting a made-up level would let
            // the compatibility engine promise an NPU path that is not there.
            put("nnapiFeatureLevel", 0)
            put("supportsFloat16", false)
            put("supportsQuant8", false)
            put("supportsQuant8Signed", false)
            put("hasAccelerator", false)
            put("acceleratorNames", JSONArray())
            put(
                "note",
                if (available) {
                    "NNAPI is present (Android 8.1+). Accelerator enumeration needs the NNAPI " +
                        "NDK backend, which is not part of this build — the GPU (Vulkan) backend " +
                        "is the only inference path reported as available."
                } else {
                    "This Android version has no NNAPI (needs 8.1). The GPU backend is unaffected."
                },
            )
        }
    }

    // -----------------------------------------------------------------------
    // GLES fallback
    // -----------------------------------------------------------------------
    /**
     * Probed with an off-screen EGL context (see [GlesProbe]). A driver that
     * refuses to give us a context is reported as unavailable — that is a real
     * answer, not an error to hide.
     */
    private fun glesCaps(): JSONObject = GlesProbe.probe().toJson()

    // -----------------------------------------------------------------------
    // Thermal
    // -----------------------------------------------------------------------
    private fun thermalCaps(context: Context): JSONObject {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val status = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && powerManager != null) {
            try {
                powerManager.currentThermalStatus
            } catch (error: Throwable) {
                0
            }
        } else {
            0
        }
        val batteryTemp = batteryTemperatureC(context)
        return JSONObject().apply {
            put("powerManagerThermalApi", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            // HardwarePropertiesManager is restricted to system apps since
            // Android 10; asking for it from a normal app returns null and
            // looks like a bug in the UI, so it is reported as unavailable.
            put("hardwarePropertiesApi", false)
            put("batteryTemperature", batteryTemp != null)
            put("batteryTemperatureC", batteryTemp ?: 0.0f)
            put("platformThermalStatus", status)
            put("cpuHeadroomAvailable", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            put("gameManagerAvailable", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            put("gameModeSupported", false)
            put(
                "note",
                "Temperatures: battery via BatteryManager, thermal pressure via " +
                    "PowerManager. Android does not expose a SoC temperature to normal apps.",
            )
        }
    }

    /** Battery temperature in Celsius, or null when the sticky broadcast has none. */
    fun batteryTemperatureC(context: Context): Float? = try {
        val intent: Intent? = context.registerReceiver(
            null,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED),
        )
        val tenths = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
            ?: Int.MIN_VALUE
        if (tenths == Int.MIN_VALUE || tenths <= 0) null else tenths / 10.0f
    } catch (error: Throwable) {
        null
    }

    /** `PowerManager.THERMAL_STATUS_*`, or 0 on platforms without it. */
    fun platformThermalStatus(context: Context): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return try {
            powerManager?.currentThermalStatus ?: 0
        } catch (error: Throwable) {
            0
        }
    }
}
