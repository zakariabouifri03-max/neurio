package com.neurio.lanstream.host

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import com.neurio.lanstream.model.InstalledGame

object GameLibrary {
    fun loadLaunchableApps(context: Context): List<InstalledGame> {
        val packageManager = context.packageManager
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return try {
            packageManager.queryIntentActivities(launcherIntent, 0)
                .asSequence()
                .mapNotNull { resolve ->
                    val info = resolve.activityInfo?.applicationInfo ?: return@mapNotNull null
                    if (info.packageName == context.packageName) return@mapNotNull null
                    val label = resolve.loadLabel(packageManager)?.toString()?.takeIf { it.isNotBlank() }
                        ?: info.packageName
                    InstalledGame(
                        packageName = info.packageName,
                        label = label,
                        isGame = info.category == ApplicationInfo.CATEGORY_GAME,
                    )
                }
                .distinctBy { it.packageName }
                .sortedWith(compareBy<InstalledGame> { !it.isGame }.thenBy { it.label.lowercase() })
                .toList()
        } catch (_: Exception) {
            emptyList()
        }
    }
}
