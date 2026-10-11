package com.vyro.play.data.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.vyro.core.model.PlaybackQuality
import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.ThemeMode
import com.vyro.core.model.UserSettings
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** File name is referenced by the backup rules: this file is excluded from backups. */
private const val API_KEY_STORE_NAME = "vyro_api_key"

private val Context.settingsDataStore by preferencesDataStore(name = "vyro_settings")
private val Context.apiKeyDataStore: DataStore<Preferences> by preferencesDataStore(name = API_KEY_STORE_NAME)

/**
 * DataStore-backed preferences.
 *
 * The API key lives in its own DataStore file so it can be excluded from cloud backups
 * independently of the (harmless) appearance settings.
 */
@Singleton
class UserPreferencesDataSource
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) {
        private object Keys {
            val THEME_MODE = stringPreferencesKey("theme_mode")
            val DYNAMIC_COLOR = booleanPreferencesKey("dynamic_color")
            val PURE_BLACK = booleanPreferencesKey("pure_black")
            val THUMBNAIL_QUALITY = stringPreferencesKey("thumbnail_quality")
            val PREFERRED_QUALITY = stringPreferencesKey("preferred_quality")
            val CAPTIONS_ENABLED = booleanPreferencesKey("captions_enabled")
            val CAPTIONS_LANGUAGE = stringPreferencesKey("captions_language")
            val AUTOPLAY_NEXT = booleanPreferencesKey("autoplay_next")
            val DATA_SAVER = booleanPreferencesKey("data_saver")
            val SAFE_SEARCH = booleanPreferencesKey("safe_search")
            val REGION_CODE = stringPreferencesKey("region_code")
            val REMEMBER_SEARCH = booleanPreferencesKey("remember_search")
            val HISTORY_LIMIT = intPreferencesKey("history_limit")
            val REDUCED_ANIMATIONS = booleanPreferencesKey("reduced_animations")
            val API_KEY = stringPreferencesKey("api_key")
        }

        val settings: Flow<UserSettings> =
            context.settingsDataStore.data
                .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
                .map { prefs ->
                    UserSettings(
                        themeMode =
                            prefs[Keys.THEME_MODE]?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() }
                                ?: UserSettings.DEFAULT.themeMode,
                        dynamicColor = prefs[Keys.DYNAMIC_COLOR] ?: UserSettings.DEFAULT.dynamicColor,
                        pureBlack = prefs[Keys.PURE_BLACK] ?: UserSettings.DEFAULT.pureBlack,
                        thumbnailQuality =
                            prefs[Keys.THUMBNAIL_QUALITY]
                                ?.let { runCatching { ThumbnailQuality.valueOf(it) }.getOrNull() }
                                ?: UserSettings.DEFAULT.thumbnailQuality,
                        preferredQuality =
                            prefs[Keys.PREFERRED_QUALITY]
                                ?.let { runCatching { PlaybackQuality.valueOf(it) }.getOrNull() }
                                ?: UserSettings.DEFAULT.preferredQuality,
                        captionsEnabled = prefs[Keys.CAPTIONS_ENABLED] ?: UserSettings.DEFAULT.captionsEnabled,
                        captionsLanguage = prefs[Keys.CAPTIONS_LANGUAGE] ?: UserSettings.DEFAULT.captionsLanguage,
                        autoplayNext = prefs[Keys.AUTOPLAY_NEXT] ?: UserSettings.DEFAULT.autoplayNext,
                        dataSaver = prefs[Keys.DATA_SAVER] ?: UserSettings.DEFAULT.dataSaver,
                        safeSearch = prefs[Keys.SAFE_SEARCH] ?: UserSettings.DEFAULT.safeSearch,
                        regionCode = prefs[Keys.REGION_CODE] ?: UserSettings.DEFAULT.regionCode,
                        rememberSearchHistory =
                            prefs[Keys.REMEMBER_SEARCH] ?: UserSettings.DEFAULT.rememberSearchHistory,
                        maxHistoryEntries =
                            (prefs[Keys.HISTORY_LIMIT] ?: UserSettings.DEFAULT.maxHistoryEntries)
                                .coerceIn(UserSettings.MIN_HISTORY_ENTRIES, UserSettings.MAX_HISTORY_ENTRIES),
                        reducedAnimations = prefs[Keys.REDUCED_ANIMATIONS] ?: UserSettings.DEFAULT.reducedAnimations,
                    )
                }

        val apiKeyOverride: Flow<String> =
            context.apiKeyDataStore.data
                .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
                .map { prefs -> prefs[Keys.API_KEY].orEmpty() }

        suspend fun currentSettings(): UserSettings = settings.first()

        suspend fun update(transform: (UserSettings) -> UserSettings) {
            val next = transform(currentSettings())
            context.settingsDataStore.edit { prefs ->
                prefs[Keys.THEME_MODE] = next.themeMode.name
                prefs[Keys.DYNAMIC_COLOR] = next.dynamicColor
                prefs[Keys.PURE_BLACK] = next.pureBlack
                prefs[Keys.THUMBNAIL_QUALITY] = next.thumbnailQuality.name
                prefs[Keys.PREFERRED_QUALITY] = next.preferredQuality.name
                prefs[Keys.CAPTIONS_ENABLED] = next.captionsEnabled
                prefs[Keys.CAPTIONS_LANGUAGE] = next.captionsLanguage
                prefs[Keys.AUTOPLAY_NEXT] = next.autoplayNext
                prefs[Keys.DATA_SAVER] = next.dataSaver
                prefs[Keys.SAFE_SEARCH] = next.safeSearch
                prefs[Keys.REGION_CODE] = next.regionCode
                prefs[Keys.REMEMBER_SEARCH] = next.rememberSearchHistory
                prefs[Keys.HISTORY_LIMIT] =
                    next.maxHistoryEntries.coerceIn(
                        UserSettings.MIN_HISTORY_ENTRIES,
                        UserSettings.MAX_HISTORY_ENTRIES,
                    )
                prefs[Keys.REDUCED_ANIMATIONS] = next.reducedAnimations
            }
        }

        suspend fun setApiKey(value: String) {
            context.apiKeyDataStore.edit { prefs ->
                if (value.isBlank()) prefs.remove(Keys.API_KEY) else prefs[Keys.API_KEY] = value.trim()
            }
        }

        suspend fun clearApiKey() {
            context.apiKeyDataStore.edit { prefs -> prefs.remove(Keys.API_KEY) }
        }
    }
