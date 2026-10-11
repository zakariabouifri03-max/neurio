package com.vyro.play.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.store by preferencesDataStore("vyro_preferences")
data class UserSettings(val apiKey: String = "", val theme: String = "System", val quality: String = "Auto", val history: Boolean = true, val warnings: Boolean = true)
class Preferences(private val context: Context) {
    private object Keys {
        val key = stringPreferencesKey("youtube_api_key")
        val theme = stringPreferencesKey("theme")
        val quality = stringPreferencesKey("quality")
        val history = booleanPreferencesKey("history")
        val warnings = booleanPreferencesKey("warnings")
    }
    val settings: Flow<UserSettings> = context.store.data.map { UserSettings(it[Keys.key] ?: "", it[Keys.theme] ?: "System", it[Keys.quality] ?: "Auto", it[Keys.history] ?: true, it[Keys.warnings] ?: true) }
    suspend fun key(value: String) { context.store.edit { it[Keys.key] = value.trim() } }
    suspend fun theme(value: String) { context.store.edit { it[Keys.theme] = value } }
    suspend fun quality(value: String) { context.store.edit { it[Keys.quality] = value } }
    suspend fun history(value: Boolean) { context.store.edit { it[Keys.history] = value } }
    suspend fun warnings(value: Boolean) { context.store.edit { it[Keys.warnings] = value } }
}
