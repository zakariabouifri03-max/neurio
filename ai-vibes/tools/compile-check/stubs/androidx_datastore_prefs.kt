@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.datastore.preferences.core

import android.content.Context
import androidx.datastore.core.DataStore
import kotlin.properties.ReadOnlyProperty

class Preferences internal constructor() {
    class Key<T> internal constructor(val name: String)

    operator fun <T> get(key: Key<T>): T? = null
    fun toMutablePreferences(): MutablePreferences = MutablePreferences()

    companion object {
        fun empty(): Preferences = Preferences()
    }
}

class MutablePreferences internal constructor() {
    operator fun <T> set(key: Preferences.Key<T>, value: T) {}
}

fun booleanPreferencesKey(name: String): Preferences.Key<Boolean> = Preferences.Key(name)
fun floatPreferencesKey(name: String): Preferences.Key<Float> = Preferences.Key(name)
fun intPreferencesKey(name: String): Preferences.Key<Int> = Preferences.Key(name)
fun stringPreferencesKey(name: String): Preferences.Key<String> = Preferences.Key(name)

suspend fun DataStore<Preferences>.edit(
    transform: suspend (MutablePreferences) -> Unit
): Preferences {
    updateData { p ->
        transform(p.toMutablePreferences())
        p
    }
    return Preferences.empty()
}
