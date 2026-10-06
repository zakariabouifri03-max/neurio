package com.neurio.app

import android.content.Context
import android.content.SharedPreferences
import com.neurio.common.AudioMode
import com.neurio.common.QualityTier
import com.neurio.common.StreamConfig
import com.neurio.common.VideoCodec

/** All user settings + the saved controller layout in one place. */
class PrefsStore(context: Context) {

    companion object {
        private const val NAME = "neurio_prefs"
        private const val KEY_RESOLUTION = "resolution"   // AUTO|1080|720|480
        private const val KEY_FPS = "fps"                 // AUTO|60|30
        private const val KEY_CODEC = "codec"             // AUTO|H264|H265
        private const val KEY_AUDIO = "audio"             // AUTO|INTERNAL|MIC|OFF
        private const val KEY_MAX_BITRATE = "max_bitrate" // kbps
        private const val KEY_MIRROR_TOUCH = "mirror_touch_default"
        private const val KEY_LAYOUT_JSON = "controller_layout_json"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun resolutionPref(): String = prefs.getString(KEY_RESOLUTION, "AUTO") ?: "AUTO"
    fun fpsPref(): String = prefs.getString(KEY_FPS, "AUTO") ?: "AUTO"
    fun codecPref(): String = prefs.getString(KEY_CODEC, "AUTO") ?: "AUTO"
    fun audioPref(): String = prefs.getString(KEY_AUDIO, "AUTO") ?: "AUTO"
    fun maxBitrateKbps(): Int = prefs.getInt(KEY_MAX_BITRATE, 16000)

    fun setResolutionPref(value: String) = prefs.edit().putString(KEY_RESOLUTION, value).apply()
    fun setFpsPref(value: String) = prefs.edit().putString(KEY_FPS, value).apply()
    fun setCodecPref(value: String) = prefs.edit().putString(KEY_CODEC, value).apply()
    fun setAudioPref(value: String) = prefs.edit().putString(KEY_AUDIO, value).apply()
    fun setMaxBitrateKbps(value: Int) = prefs.edit().putInt(KEY_MAX_BITRATE, value).apply()

    fun mirrorTouchDefault(): Boolean = prefs.getBoolean(KEY_MIRROR_TOUCH, true)
    fun setMirrorTouchDefault(value: Boolean) =
        prefs.edit().putBoolean(KEY_MIRROR_TOUCH, value).apply()

    fun controllerLayoutJson(): String? = prefs.getString(KEY_LAYOUT_JSON, null)
    fun saveControllerLayoutJson(json: String) =
        prefs.edit().putString(KEY_LAYOUT_JSON, json).apply()
    fun clearControllerLayout() = prefs.edit().remove(KEY_LAYOUT_JSON).apply()

    /**
     * Initial session configuration. AUTO means the adaptive controller starts
     * at 720p60 and climbs or drops based on the measured link.
     */
    fun streamConfigFromPrefs(): StreamConfig {
        val res = resolutionPref()
        val fps = fpsPref()
        val tier = if (res == "AUTO") QualityTier.GOOD else QualityTier.fromResolutionPref(res, fps)
        val codecPref = codecPref()
        val codec = when (codecPref) {
            "H265" -> VideoCodec.H265
            else -> VideoCodec.H264 // AUTO keeps H.264 for decoder compatibility
        }
        val audioMode = runCatching { AudioMode.valueOf(audioPref()) }.getOrDefault(AudioMode.AUTO)
        return StreamConfig(tier, codec, audioMode, maxBitrateKbps())
    }
}
