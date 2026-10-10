@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.datastore.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import kotlin.properties.ReadOnlyProperty

/** Mirrors androidx.datastore.preferences.preferencesDataStore (real package). */
fun preferencesDataStore(name: String): ReadOnlyProperty<Context, DataStore<Preferences>> =
    ReadOnlyProperty { _, _ ->
        object : DataStore<Preferences> {
            override val data: kotlinx.coroutines.flow.Flow<Preferences> =
                kotlinx.coroutines.flow.flowOf(Preferences.empty())

            override suspend fun updateData(
                transform: suspend (t: Preferences) -> Preferences
            ): Preferences = Preferences.empty()
        }
    }
