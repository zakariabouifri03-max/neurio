package com.neurio.aivibes.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.neurio.aivibes.dsp.DspConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "aivibes")

/**
 * Everything the user can tweak, persisted locally and restored on restart:
 * DSP parameters, visualizer options, headphone auto-preset behaviour and
 * battery-efficient mode.
 */
class SettingsStore(private val context: Context) {

    private object Keys {
        val BASS = floatPreferencesKey("bass")
        val BASS_FREQ = floatPreferencesKey("bass_freq")
        val SUB = floatPreferencesKey("sub")
        val CLARITY = floatPreferencesKey("clarity")
        val TILT = floatPreferencesKey("tilt")
        val WIDTH = floatPreferencesKey("width")
        val CROSSFEED = floatPreferencesKey("crossfeed")
        val DYNAMICS = floatPreferencesKey("dynamics")
        val LOUDNESS = floatPreferencesKey("loudness")
        val LIMITER = booleanPreferencesKey("limiter")
        val PREAMP = floatPreferencesKey("preamp")
        val EQ = stringPreferencesKey("eq")               // "1.0,0.0,..." 10 values
        val PRESET_ID = stringPreferencesKey("preset_id")
        val AUTO_PRESET = booleanPreferencesKey("auto_preset")
        val DEVICE_PRESET_PREFIX = stringPreferencesKey("device_preset")   // + deviceKey
        val VIZ_STYLE = intPreferencesKey("viz_style")
        val VIZ_SENSITIVITY = floatPreferencesKey("viz_sensitivity")
        val BATTERY_SAVER = booleanPreferencesKey("battery_saver")
        val DEVICE_ASSIST = booleanPreferencesKey("device_assist")
        val ONBOARDED = booleanPreferencesKey("onboarded")
    }

    data class Prefs(
        val config: DspConfig = DspConfig(),
        val presetId: String = "flat",
        val autoPreset: Boolean = true,
        val vizStyle: Int = 0,
        val vizSensitivity: Float = 0.6f,
        val batterySaver: Boolean = false,
        val deviceAssist: Boolean = false,
        val onboarded: Boolean = false
    )

    val prefs: Flow<Prefs> = context.dataStore.data.map { p ->
        Prefs(
            config = DspConfig(
                bassIntensity = p[Keys.BASS] ?: DspConfig().bassIntensity,
                bassFreq = p[Keys.BASS_FREQ] ?: DspConfig().bassFreq,
                subBass = p[Keys.SUB] ?: DspConfig().subBass,
                eqGains = parseEq(p[Keys.EQ]),
                preampDb = p[Keys.PREAMP] ?: 0f,
                clarity = p[Keys.CLARITY] ?: DspConfig().clarity,
                tilt = p[Keys.TILT] ?: 0f,
                spatialWidth = p[Keys.WIDTH] ?: DspConfig().spatialWidth,
                crossfeed = p[Keys.CROSSFEED] ?: DspConfig().crossfeed,
                dynamics = p[Keys.DYNAMICS] ?: DspConfig().dynamics,
                loudness = p[Keys.LOUDNESS] ?: DspConfig().loudness,
                limiterEnabled = p[Keys.LIMITER] ?: true,
                enabled = true
            ),
            presetId = p[Keys.PRESET_ID] ?: "flat",
            autoPreset = p[Keys.AUTO_PRESET] ?: true,
            vizStyle = p[Keys.VIZ_STYLE] ?: 0,
            vizSensitivity = p[Keys.VIZ_SENSITIVITY] ?: 0.6f,
            batterySaver = p[Keys.BATTERY_SAVER] ?: false,
            deviceAssist = p[Keys.DEVICE_ASSIST] ?: false,
            onboarded = p[Keys.ONBOARDED] ?: false
        )
    }

    suspend fun current(): Prefs = prefs.first()

    suspend fun saveConfig(config: DspConfig, presetId: String = "custom") {
        context.dataStore.edit { p ->
            p[Keys.BASS] = config.bassIntensity
            p[Keys.BASS_FREQ] = config.bassFreq
            p[Keys.SUB] = config.subBass
            p[Keys.CLARITY] = config.clarity
            p[Keys.TILT] = config.tilt
            p[Keys.WIDTH] = config.spatialWidth
            p[Keys.CROSSFEED] = config.crossfeed
            p[Keys.DYNAMICS] = config.dynamics
            p[Keys.LOUDNESS] = config.loudness
            p[Keys.LIMITER] = config.limiterEnabled
            p[Keys.PREAMP] = config.preampDb
            p[Keys.EQ] = config.eqGains.joinToString(",")
            p[Keys.PRESET_ID] = presetId
        }
    }

    suspend fun saveViz(style: Int, sensitivity: Float) {
        context.dataStore.edit { p ->
            p[Keys.VIZ_STYLE] = style
            p[Keys.VIZ_SENSITIVITY] = sensitivity
        }
    }

    suspend fun saveBatterySaver(on: Boolean) {
        context.dataStore.edit { it[Keys.BATTERY_SAVER] = on }
    }

    suspend fun saveAutoPreset(on: Boolean) {
        context.dataStore.edit { it[Keys.AUTO_PRESET] = on }
    }

    suspend fun saveDeviceAssist(on: Boolean) {
        context.dataStore.edit { it[Keys.DEVICE_ASSIST] = on }
    }

    suspend fun setOnboarded() {
        context.dataStore.edit { it[Keys.ONBOARDED] = true }
    }

    /** Per-headphone preset assignment (auto-loaded when that device connects). */
    suspend fun saveDevicePreset(deviceKey: String, presetId: String) {
        context.dataStore.edit {
            it[stringPreferencesKey(Keys.DEVICE_PRESET_PREFIX.name + "_" + deviceKey)] = presetId
        }
    }

    suspend fun loadDevicePreset(deviceKey: String): String? {
        return context.dataStore.data.first()[
            stringPreferencesKey(Keys.DEVICE_PRESET_PREFIX.name + "_" + deviceKey)
        ]
    }

    /** Reset every DSP parameter to the neutral default. */
    suspend fun resetToDefaults() {
        saveConfig(DspConfig(), presetId = "flat")
    }

    private fun parseEq(raw: String?): FloatArray {
        if (raw == null) return FloatArray(DspConfig.EQ_BANDS.size)
        return try {
            val parts = raw.split(",").map { it.toFloat() }
            val out = FloatArray(DspConfig.EQ_BANDS.size)
            for (i in out.indices) out[i] = parts.getOrElse(i) { 0f }
            out
        } catch (t: Throwable) {
            FloatArray(DspConfig.EQ_BANDS.size)
        }
    }
}
