package com.neurio.host

import android.content.Context
import com.neurio.common.AppLog

/** Launches the selected game on the host; the game keeps running locally. */
object GameLauncher {

    private const val TAG = "GameLauncher"

    /** @return true when the launch intent was dispatched successfully. */
    fun launch(context: Context, packageName: String): Boolean {
        val intent = try {
            context.packageManager.getLaunchIntentForPackage(packageName)
        } catch (e: Exception) {
            AppLog.e(TAG, "no launch intent for $packageName", e)
            null
        }
        if (intent == null) {
            AppLog.w(TAG, "game $packageName is not launchable (uninstalled?)")
            return false
        }
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            AppLog.i(TAG, "launched $packageName")
            true
        } catch (e: Exception) {
            AppLog.e(TAG, "launch failed for $packageName", e)
            false
        }
    }
}
