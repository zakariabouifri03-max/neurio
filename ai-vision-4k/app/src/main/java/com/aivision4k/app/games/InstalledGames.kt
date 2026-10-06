package com.aivision4k.app.games

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build

/** A launchable application as the package manager reports it. */
data class InstalledGame(
    val packageName: String,
    val label: String,
    /** `ApplicationInfo.CATEGORY_GAME` — true only when the platform says so. */
    val isGame: Boolean,
)

/**
 * Reads the installed applications.
 *
 * Android does not let an app read another app's frame rate or rendering
 * pipeline, so this is deliberately the whole of the "supported games" input:
 * what is installed and how the platform labelled it. The list is filtered to
 * launcher activities (the manifest declares the `<queries>` intent, not
 * QUERY_ALL_PACKAGES), which is all we need to offer a profile and a launch
 * button.
 */
object InstalledGames {

    fun scan(context: Context): List<InstalledGame> {
        val manager = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = runCatching {
            @Suppress("DEPRECATION")
            manager.queryIntentActivities(intent, 0)
        }.getOrNull().orEmpty()

        return resolved.mapNotNull { info ->
            val packageName = info.activityInfo?.packageName ?: return@mapNotNull null
            if (packageName == context.packageName) return@mapNotNull null
            InstalledGame(
                packageName = packageName,
                label = runCatching { info.loadLabel(manager).toString() }.getOrDefault(packageName),
                isGame = isGameCategory(manager, packageName),
            )
        }
            .distinctBy { it.packageName }
            .sortedWith(
                compareByDescending<InstalledGame> { it.isGame }
                    .thenBy { it.label.lowercase() },
            )
    }

    private fun isGameCategory(manager: PackageManager, packageName: String): Boolean = try {
        val info: ApplicationInfo = if (Build.VERSION.SDK_INT >= 33) {
            manager.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            manager.getApplicationInfo(packageName, 0)
        }
        info.category == ApplicationInfo.CATEGORY_GAME
    } catch (error: Throwable) {
        false
    }

    /** Returns false when the package has no launcher activity. */
    fun launch(context: Context, packageName: String): Boolean {
        val intent = runCatching {
            context.packageManager.getLaunchIntentForPackage(packageName)
        }.getOrNull() ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching {
            context.startActivity(intent)
            true
        }.getOrDefault(false)
    }

    fun installed(context: Context, packageName: String): Boolean = runCatching {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(packageName, 0)
        true
    }.getOrDefault(false)
}
