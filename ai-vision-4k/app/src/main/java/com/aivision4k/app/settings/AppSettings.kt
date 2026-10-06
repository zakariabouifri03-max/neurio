package com.aivision4k.app.settings

import android.content.Context
import com.aivision4k.sdk.GraphicsProfile
import com.aivision4k.sdk.IntegrationKind
import org.json.JSONObject

/**
 * Everything the app remembers between runs.
 *
 * Per-game profiles live here (not in the engine) because the engine holds
 * exactly one active profile: the app applies the stored profile of the selected
 * game and keeps the library. That also means a profile survives a reboot and
 * can be exported by hand.
 */
class AppSettings(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("ai_vision_4k", Context.MODE_PRIVATE)

    var selectedPackage: String
        get() = prefs.getString(KEY_SELECTED_PACKAGE, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_SELECTED_PACKAGE, value).apply()

    /** How the app is allowed to present itself to the engine (see `IntegrationKind`). */
    var integration: IntegrationKind
        get() = IntegrationKind.fromValue(prefs.getInt(KEY_INTEGRATION, IntegrationKind.None.value))
        set(value) = prefs.edit().putInt(KEY_INTEGRATION, value.value).apply()

    var monitorEnabled: Boolean
        get() = prefs.getBoolean(KEY_MONITOR, true)
        set(value) = prefs.edit().putBoolean(KEY_MONITOR, value).apply()

    var overlayEnabled: Boolean
        get() = prefs.getBoolean(KEY_OVERLAY, false)
        set(value) = prefs.edit().putBoolean(KEY_OVERLAY, value).apply()

    var notificationPermissionAsked: Boolean
        get() = prefs.getBoolean(KEY_NOTIFICATIONS_ASKED, false)
        set(value) = prefs.edit().putBoolean(KEY_NOTIFICATIONS_ASKED, value).apply()

    var sandboxDisclaimerSeen: Boolean
        get() = prefs.getBoolean(KEY_SANDBOX_SEEN, false)
        set(value) = prefs.edit().putBoolean(KEY_SANDBOX_SEEN, value).apply()

    /** The last profile the user edited interactively, restored on next launch. */
    var lastProfile: GraphicsProfile?
        get() = readProfile(KEY_LAST_PROFILE)
        set(value) {
            if (value == null) {
                prefs.edit().remove(KEY_LAST_PROFILE).apply()
            } else {
                prefs.edit().putString(KEY_LAST_PROFILE, value.toJson().toString()).apply()
            }
        }

    fun profileFor(packageName: String): GraphicsProfile? {
        if (packageName.isEmpty()) return null
        val store = profileStore()
        val entry = store.optJSONObject(packageName) ?: return null
        return runCatching { GraphicsProfile.parse(entry) }.getOrNull()
    }

    fun saveProfile(profile: GraphicsProfile) {
        if (profile.packageName.isEmpty()) return
        val store = profileStore()
        store.put(profile.packageName, profile.toJson())
        prefs.edit().putString(KEY_PROFILES, store.toString()).apply()
    }

    fun removeProfile(packageName: String) {
        val store = profileStore()
        store.remove(packageName)
        prefs.edit().putString(KEY_PROFILES, store.toString()).apply()
    }

    fun profiledPackages(): List<String> {
        val store = profileStore()
        return store.keys().asSequence().toList()
    }

    private fun profileStore(): JSONObject {
        val raw = prefs.getString(KEY_PROFILES, null) ?: return JSONObject()
        return runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
    }

    private fun readProfile(key: String): GraphicsProfile? {
        val raw = prefs.getString(key, null) ?: return null
        return runCatching { GraphicsProfile.parse(JSONObject(raw)) }.getOrNull()
    }

    private companion object {
        const val KEY_SELECTED_PACKAGE = "selected_package"
        const val KEY_INTEGRATION = "integration_kind"
        const val KEY_MONITOR = "monitor_enabled"
        const val KEY_OVERLAY = "overlay_enabled"
        const val KEY_NOTIFICATIONS_ASKED = "notifications_asked"
        const val KEY_SANDBOX_SEEN = "sandbox_disclaimer_seen"
        const val KEY_LAST_PROFILE = "last_profile"
        const val KEY_PROFILES = "game_profiles"
    }
}
