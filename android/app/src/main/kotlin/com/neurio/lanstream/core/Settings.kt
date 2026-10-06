package com.neurio.lanstream.core

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Encoded long edge of the streamed picture (16:9-ish, adapted to the host screen). */
enum class ResolutionTier(val label: String, val longSide: Int) {
    P480("480p", 854),
    P720("720p", 1280),
    P1080("1080p", 1920);

    companion object {
        fun fromName(name: String?): ResolutionTier =
            values().firstOrNull { it.name == name } ?: P720
    }
}

enum class FpsMode(val label: String, val fps: Int) {
    FPS30("30", 30),
    FPS60("60", 60);

    companion object {
        fun fromName(name: String?): FpsMode =
            values().firstOrNull { it.name == name } ?: FPS60
    }
}

enum class BitratePreset(val label: String) {
    LOW("Low"), MEDIUM("Medium"), HIGH("High"), CUSTOM("Custom");

    /** Bits per pixel per frame. Values tuned for low-latency game content. */
    val bitsPerPixel: Float
        get() = when (this) {
            LOW -> 0.045f
            MEDIUM -> 0.075f
            HIGH -> 0.130f
            CUSTOM -> 0.075f
        }

    companion object {
        fun fromName(name: String?): BitratePreset =
            values().firstOrNull { it.name == name } ?: MEDIUM
    }
}

/**
 * How the host is allowed to replay the player's input.
 *
 * AUTO          -> pick the first one that is actually usable on this device.
 * ACCESSIBILITY -> GestureDescription dispatch (real touches, no privileges needed,
 *                  but the user must enable the accessibility service).
 * ROOT          -> `su -c input ...` (works, but ~50-100 ms per event).
 * OVERLAY       -> does not inject anything, only draws the touch point (diagnostics).
 * DISABLED      -> receive + measure input but never touch the screen.
 */
enum class InputMode(val label: String) {
    AUTO("auto"),
    ACCESSIBILITY("accessibility"),
    ROOT("root"),
    OVERLAY("overlay"),
    DISABLED("disabled");

    companion object {
        fun fromName(name: String?): InputMode =
            values().firstOrNull { it.name == name } ?: AUTO
    }
}

data class Settings(
    val resolution: ResolutionTier = ResolutionTier.P720,
    val fpsMode: FpsMode = FpsMode.FPS60,
    val bitratePreset: BitratePreset = BitratePreset.MEDIUM,
    val customBitrateMbps: Int = 8,
    val adaptive: Boolean = true,
    val lowLatency: Boolean = true,
    val audioEnabled: Boolean = true,
    val inputMode: InputMode = InputMode.AUTO,
    val deviceName: String = "",
    val showStats: Boolean = true,
    val controlLayoutJson: String = ""
)

/**
 * SharedPreferences + StateFlow. No DataStore dependency: the prototype only
 * needs a dozen scalars and this keeps the dependency graph minimal.
 */
class SettingsRepository(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(load())
    val settings: StateFlow<Settings> get() = _settings

    val current: Settings get() = _settings.value

    fun update(mutator: Settings.() -> Settings) {
        val next = _settings.value.mutator()
        save(next)
        _settings.value = next
    }

    private fun load(): Settings = Settings(
        resolution = ResolutionTier.fromName(prefs.getString(KEY_RESOLUTION, null)),
        fpsMode = FpsMode.fromName(prefs.getString(KEY_FPS, null)),
        bitratePreset = BitratePreset.fromName(prefs.getString(KEY_BITRATE, null)),
        customBitrateMbps = prefs.getInt(KEY_CUSTOM_BITRATE, 8),
        adaptive = prefs.getBoolean(KEY_ADAPTIVE, true),
        lowLatency = prefs.getBoolean(KEY_LOW_LATENCY, true),
        audioEnabled = prefs.getBoolean(KEY_AUDIO, true),
        inputMode = InputMode.fromName(prefs.getString(KEY_INPUT_MODE, null)),
        deviceName = prefs.getString(KEY_DEVICE_NAME, "") ?: "",
        showStats = prefs.getBoolean(KEY_SHOW_STATS, true),
        controlLayoutJson = prefs.getString(KEY_CONTROL_LAYOUT, "") ?: ""
    )

    private fun save(s: Settings) {
        prefs.edit()
            .putString(KEY_RESOLUTION, s.resolution.name)
            .putString(KEY_FPS, s.fpsMode.name)
            .putString(KEY_BITRATE, s.bitratePreset.name)
            .putInt(KEY_CUSTOM_BITRATE, s.customBitrateMbps)
            .putBoolean(KEY_ADAPTIVE, s.adaptive)
            .putBoolean(KEY_LOW_LATENCY, s.lowLatency)
            .putBoolean(KEY_AUDIO, s.audioEnabled)
            .putString(KEY_INPUT_MODE, s.inputMode.name)
            .putString(KEY_DEVICE_NAME, s.deviceName)
            .putBoolean(KEY_SHOW_STATS, s.showStats)
            .putString(KEY_CONTROL_LAYOUT, s.controlLayoutJson)
            .apply()
    }

    companion object {
        private const val PREFS = "neurio_settings"
        private const val KEY_RESOLUTION = "resolution"
        private const val KEY_FPS = "fps"
        private const val KEY_BITRATE = "bitrate"
        private const val KEY_CUSTOM_BITRATE = "custom_bitrate_mbps"
        private const val KEY_ADAPTIVE = "adaptive"
        private const val KEY_LOW_LATENCY = "low_latency"
        private const val KEY_AUDIO = "audio"
        private const val KEY_INPUT_MODE = "input_mode"
        private const val KEY_DEVICE_NAME = "device_name"
        private const val KEY_SHOW_STATS = "show_stats"
        private const val KEY_CONTROL_LAYOUT = "control_layout"
    }
}
