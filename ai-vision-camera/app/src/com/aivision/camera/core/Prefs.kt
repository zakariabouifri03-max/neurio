package com.aivision.camera.core

import android.content.Context
import android.content.SharedPreferences

/**
 * Persistent settings. Everything the camera UI can change lives here so the app
 * behaves like a real camera: your choices survive restarts.
 */
class Prefs(ctx: Context) {
    private val sp: SharedPreferences = ctx.getSharedPreferences("aivision", Context.MODE_PRIVATE)

    var aiEnhance: Boolean
        get() = sp.getBoolean("ai_enhance", true)
        set(v) = sp.edit().putBoolean("ai_enhance", v).apply()

    var aiUltra: Boolean
        get() = sp.getBoolean("ai_ultra", false)
        set(v) = sp.edit().putBoolean("ai_ultra", v).apply()

    var nightStack: Int
        get() = sp.getInt("night_stack", 8)
        set(v) = sp.edit().putInt("night_stack", v).apply()

    var hdrBracketing: Boolean
        get() = sp.getBoolean("hdr_bracket", true)
        set(v) = sp.edit().putBoolean("hdr_bracket", v).apply()

    var grid: Int  // 0 off, 1 thirds, 2 golden, 3 square
        get() = sp.getInt("grid", 1)
        set(v) = sp.edit().putInt("grid", v).apply()

    var timerSeconds: Int
        get() = sp.getInt("timer", 0)
        set(v) = sp.edit().putInt("timer", v).apply()

    var mirrorFront: Boolean
        get() = sp.getBoolean("mirror", true)
        set(v) = sp.edit().putBoolean("mirror", v).apply()

    var saveRaw: Boolean
        get() = sp.getBoolean("save_raw", false)
        set(v) = sp.edit().putBoolean("save_raw", v).apply()

    var saveOriginal: Boolean
        get() = sp.getBoolean("save_original", true)
        set(v) = sp.edit().putBoolean("save_original", v).apply()

    var hybridStabilization: Boolean
        get() = sp.getBoolean("stab", true)
        set(v) = sp.edit().putBoolean("stab", v).apply()

    var videoResolution: String
        get() = sp.getString("video_res", "auto") ?: "auto"
        set(v) = sp.edit().putString("video_res", v).apply()

    var videoFps: Int
        get() = sp.getInt("video_fps", 30)
        set(v) = sp.edit().putInt("video_fps", v).apply()

    var aiEnhancedVideo: Boolean
        get() = sp.getBoolean("ai_video", true)
        set(v) = sp.edit().putBoolean("ai_video", v).apply()

    var sceneDetection: Boolean
        get() = sp.getBoolean("scene", true)
        set(v) = sp.edit().putBoolean("scene", v).apply()

    var autoZoomAi: Boolean
        get() = sp.getBoolean("auto_zoom_ai", true)
        set(v) = sp.edit().putBoolean("auto_zoom_ai", v).apply()

    var faceEnhance: Boolean
        get() = sp.getBoolean("face_enh", true)
        set(v) = sp.edit().putBoolean("face_enh", v).apply()

    var textEnhance: Boolean
        get() = sp.getBoolean("text_enh", true)
        set(v) = sp.edit().putBoolean("text_enh", v).apply()

    var showHud: Boolean
        get() = sp.getBoolean("hud", true)
        set(v) = sp.edit().putBoolean("hud", v).apply()

    var proIso: Int
        get() = sp.getInt("pro_iso", 0)
        set(v) = sp.edit().putInt("pro_iso", v).apply()

    var proShutterNs: Long
        get() = sp.getLong("pro_shutter", 0L)
        set(v) = sp.edit().putLong("pro_shutter", v).apply()

    var proFocusDiopters: Float
        get() = sp.getFloat("pro_focus", -1f)
        set(v) = sp.edit().putFloat("pro_focus", v).apply()

    var proWbKelvin: Int
        get() = sp.getInt("pro_wb", 0)
        set(v) = sp.edit().putInt("pro_wb", v).apply()

    var proEv: Int
        get() = sp.getInt("pro_ev", 0)
        set(v) = sp.edit().putInt("pro_ev", v).apply()

    var proRaw: Boolean
        get() = sp.getBoolean("pro_raw", false)
        set(v) = sp.edit().putBoolean("pro_raw", v).apply()

    var lastMode: String
        get() = sp.getString("mode", "PHOTO") ?: "PHOTO"
        set(v) = sp.edit().putString("mode", v).apply()

    var lastFacing: Int
        get() = sp.getInt("facing", 0)
        set(v) = sp.edit().putInt("facing", v).apply()

    var tierOverride: Int
        get() = sp.getInt("tier_override", -1)
        set(v) = sp.edit().putInt("tier_override", v).apply()
}
