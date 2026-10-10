@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.core.content

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter

object ContextCompat {
    const val RECEIVER_NOT_EXPORTED = 4

    @JvmStatic
    fun registerReceiver(
        context: Context,
        receiver: BroadcastReceiver?,
        filter: IntentFilter,
        flags: Int
    ): Intent? = null

    @JvmStatic
    fun getMainExecutor(context: Context): java.util.concurrent.Executor =
        java.util.concurrent.Executor { it.run() }
}
