package com.vyro.play.data.preferences

import android.app.ActivityManager
import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.vyro.play.model.AppSettings
import com.vyro.play.model.SafeSearchMode
import com.vyro.play.model.ThemeMode
import com.vyro.play.model.VideoQualityOption
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

private val Context.vyroDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "vyro_play_settings"
)

class SettingsDataStore(context: Context) {

    private val appContext = context.applicationContext
    private val isDeviceLowRam: Boolean = runCatching {
        val am = appContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        am?.isLowRamDevice == true
    }.getOrDefault(false)

    private object Keys {
        val THEME_MODE = stringPreferencesKey("theme_mode")
        val PREFERRED_QUALITY = stringPreferencesKey("preferred_quality")
        val CAPTIONS_ENABLED = booleanPreferencesKey("captions_enabled")
        val CAPTIONS_LANGUAGE = stringPreferencesKey("captions_language")
        val LOW_END_MODE = booleanPreferencesKey("low_end_performance_mode")
        val SAFE_SEARCH = stringPreferencesKey("safe_search_mode")
        val AUTOPLAY = booleanPreferencesKey("autoplay_enabled")
        val PAUSE_HISTORY = booleanPreferencesKey("pause_watch_history")
        val REGION_CODE = stringPreferencesKey("region_code")
        val CUSTOM_API_KEY = stringPreferencesKey("custom_youtube_api_key")
    }

    val settingsFlow: Flow<AppSettings> = appContext.vyroDataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { prefs ->
            val themeName = prefs[Keys.THEME_MODE] ?: ThemeMode.DARK.name
            val theme = runCatching { ThemeMode.valueOf(themeName) }.getOrDefault(ThemeMode.DARK)

            val defaultQuality = if (isDeviceLowRam) VideoQualityOption.HD_720P else VideoQualityOption.UHD_4K
            val qualityName = prefs[Keys.PREFERRED_QUALITY] ?: defaultQuality.name
            val quality = runCatching { VideoQualityOption.valueOf(qualityName) }.getOrDefault(defaultQuality)

            val safeSearchName = prefs[Keys.SAFE_SEARCH] ?: SafeSearchMode.MODERATE.name
            val safeSearch = runCatching { SafeSearchMode.valueOf(safeSearchName) }.getOrDefault(SafeSearchMode.MODERATE)

            AppSettings(
                themeMode = theme,
                preferredQuality = quality,
                captionsEnabledByDefault = prefs[Keys.CAPTIONS_ENABLED] ?: false,
                captionsLanguage = prefs[Keys.CAPTIONS_LANGUAGE] ?: "en",
                lowEndPerformanceMode = prefs[Keys.LOW_END_MODE] ?: isDeviceLowRam,
                safeSearchMode = safeSearch,
                autoplayEnabled = prefs[Keys.AUTOPLAY] ?: true,
                pauseWatchHistory = prefs[Keys.PAUSE_HISTORY] ?: false,
                regionCode = prefs[Keys.REGION_CODE] ?: "US",
                customApiKey = prefs[Keys.CUSTOM_API_KEY] ?: ""
            )
        }

    suspend fun setThemeMode(mode: ThemeMode) {
        appContext.vyroDataStore.edit { it[Keys.THEME_MODE] = mode.name }
    }

    suspend fun setPreferredQuality(quality: VideoQualityOption) {
        appContext.vyroDataStore.edit { it[Keys.PREFERRED_QUALITY] = quality.name }
    }

    suspend fun setCaptionsEnabled(enabled: Boolean) {
        appContext.vyroDataStore.edit { it[Keys.CAPTIONS_ENABLED] = enabled }
    }

    suspend fun setCaptionsLanguage(lang: String) {
        appContext.vyroDataStore.edit { it[Keys.CAPTIONS_LANGUAGE] = lang.trim().ifEmpty { "en" } }
    }

    suspend fun setLowEndPerformanceMode(enabled: Boolean) {
        appContext.vyroDataStore.edit { it[Keys.LOW_END_MODE] = enabled }
    }

    suspend fun setSafeSearchMode(mode: SafeSearchMode) {
        appContext.vyroDataStore.edit { it[Keys.SAFE_SEARCH] = mode.name }
    }

    suspend fun setAutoplayEnabled(enabled: Boolean) {
        appContext.vyroDataStore.edit { it[Keys.AUTOPLAY] = enabled }
    }

    suspend fun setPauseWatchHistory(paused: Boolean) {
        appContext.vyroDataStore.edit { it[Keys.PAUSE_HISTORY] = paused }
    }

    suspend fun setRegionCode(regionCode: String) {
        appContext.vyroDataStore.edit {
            it[Keys.REGION_CODE] = regionCode.trim().uppercase().take(2).ifEmpty { "US" }
        }
    }

    suspend fun setCustomApiKey(apiKey: String) {
        appContext.vyroDataStore.edit {
            it[Keys.CUSTOM_API_KEY] = apiKey.trim()
        }
    }
}
