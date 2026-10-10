@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.core.database

import android.database.Cursor

fun Cursor.getLongOrNull(index: Int): Long? =
    if (isNull(index)) null else getLong(index)

fun Cursor.getStringOrNull(index: Int): String? =
    if (isNull(index)) null else getString(index)
