package com.neurio.lanstream.games

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import android.os.Build
import com.neurio.lanstream.core.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One launchable app the host can stream. */
data class GameApp(
    val packageName: String,
    val name: String,
    val isGame: Boolean,
    val versionName: String? = null,
    val installTimeMs: Long = 0L
)

/**
 * Reads the installed launcher apps (the same list Android's home screen shows).
 *
 * On Android 11+ package visibility is filtered, so the manifest declares a
 * <queries> block with the ACTION_MAIN / CATEGORY_LAUNCHER intent. That is the
 * documented way for a launcher-style app to enumerate apps without
 * QUERY_ALL_PACKAGES.
 *
 * Nothing is copied, extracted or transferred here: this is only a launcher.
 */
object GameLibrary {

    suspend fun load(context: Context): List<GameApp> = withContext(Dispatchers.Default) {
        val pm = context.packageManager
        val self = context.packageName
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = runCatching {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }.getOrElse { emptyList() }

        val games = ArrayList<GameApp>()
        val others = ArrayList<GameApp>()

        resolved.forEach { info ->
            val pkg = info.activityInfo?.packageName ?: return@forEach
            if (pkg == self) return@forEach
            val appInfo = runCatching { pm.getApplicationInfo(pkg, 0) }.getOrNull() ?: return@forEach
            val label = runCatching { pm.getApplicationLabel(appInfo).toString() }.getOrNull()
                ?: info.loadLabel(pm).toString()
            val isGame = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appInfo.category == ApplicationInfo.CATEGORY_GAME
            } else {
                (appInfo.flags and ApplicationInfo.FLAG_IS_GAME) != 0
            }
            val version = runCatching {
                pm.getPackageInfo(pkg, 0).versionName
            }.getOrNull()
            val entry = GameApp(
                packageName = pkg,
                name = label,
                isGame = isGame,
                versionName = version,
                installTimeMs = runCatching {
                    pm.getPackageInfo(pkg, 0).firstInstallTime
                }.getOrDefault(0L)
            )
            (if (isGame) games else others).add(entry)
        }

        val result = ArrayList<GameApp>(games.size + others.size)
        result.addAll(games.sortedBy { it.name.lowercase() })
        result.addAll(others.sortedBy { it.name.lowercase() })
        Log.i("Game library: ${result.size} apps (${games.size} flagged as games)")
        result
    }

    /** Standard, permission-free launch: exactly what the home screen does. */
    fun launchIntent(context: Context, packageName: String): Intent? {
        val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: return null
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        return intent
    }

    fun launch(context: Context, packageName: String): Boolean {
        val intent = launchIntent(context, packageName) ?: return false
        return try {
            context.startActivity(intent)
            true
        } catch (t: Throwable) {
            Log.w("Could not launch $packageName: ${t.message}")
            false
        }
    }

    fun icon(context: Context, packageName: String): Drawable? =
        runCatching { context.packageManager.getApplicationIcon(packageName) }.getOrNull()
}
