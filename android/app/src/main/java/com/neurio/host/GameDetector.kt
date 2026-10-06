package com.neurio.host

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import android.os.Build
import com.neurio.common.AppLog

/** One launchable app detected on the host device. */
data class GameInfo(
    val packageName: String,
    val label: String,
    val icon: Drawable?,
    val isGame: Boolean,
    val knownTitle: String?
) {
    val displayTitle: String get() = knownTitle ?: label
    val badge: String
        get() = when {
            knownTitle != null -> "KNOWN GAME"
            isGame -> "GAME"
            else -> "APP"
        }
}

/**
 * Detects launchable installed applications on the HOST device.
 *
 * Note: this only lists what is already installed on Phone 2. Nothing here
 * downloads or installs anything - the client (Phone 1) never receives game
 * files, only the live video/audio/input streams.
 */
class GameDetector(private val context: Context) {

    companion object {
        private const val TAG = "GameDetector"

        /** Curated well-known titles so the demo can flag eFootball etc. */
        val KNOWN_GAMES: Map<String, String> = mapOf(
            "jp.konami.pesam" to "eFootball™",
            "com.activision.callofduty.shooter" to "Call of Duty: Mobile",
            "com.tencent.ig" to "PUBG Mobile",
            "com.miHoYo.GenshinImpact" to "Genshin Impact",
            "com.roblox.client" to "Roblox",
            "com.supercell.clashofclans" to "Clash of Clans",
            "com.kiloo.subwaysurf" to "Subway Surfers",
            "com.king.candycrushsaga" to "Candy Crush Saga",
            "com.moonton.mobilehero" to "Mobile Legends: Bang Bang",
            "com.riotgames.league.wildrift" to "LoL: Wild Rift",
            "com.ea.gp.fifamobile" to "EA SPORTS FC Mobile",
            "com.firsttouchgames.dls7" to "Dream League Soccer"
        )
    }

    fun detect(): List<GameInfo> {
        val pm = context.packageManager
        val mainIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val self = context.packageName
        val out = ArrayList<GameInfo>()
        try {
            val activities = pm.queryIntentActivities(mainIntent, 0)
            for (info in activities) {
                val pkg = info.activityInfo?.packageName ?: continue
                if (pkg == self) continue
                val label = try {
                    info.loadLabel(pm)?.toString() ?: pkg
                } catch (e: Exception) {
                    pkg
                }
                val icon = try {
                    info.loadIcon(pm)
                } catch (e: Exception) {
                    null
                }
                val category = appCategory(pm, pkg)
                val isGame = category == ApplicationInfo.CATEGORY_GAME ||
                    KNOWN_GAMES.containsKey(pkg)
                out.add(GameInfo(pkg, label, icon, isGame, KNOWN_GAMES[pkg]))
            }
        } catch (e: Exception) {
            AppLog.e(TAG, "detect failed", e)
        }
        // Known titles first, then games, then everything else.
        return out.sortedWith(
            compareByDescending<GameInfo> { it.knownTitle != null }
                .thenByDescending { it.isGame }
                .thenBy { it.label.lowercase() }
        )
    }

    fun launchIntent(packageName: String): Intent? = try {
        context.packageManager.getLaunchIntentForPackage(packageName)
    } catch (e: Exception) {
        null
    }

    private fun appCategory(pm: PackageManager, pkg: String): Int {
        return try {
            if (Build.VERSION.SDK_INT >= 26) {
                pm.getApplicationInfo(pkg, 0).category
            } else {
                ApplicationInfo.CATEGORY_UNDEFINED
            }
        } catch (e: Exception) {
            ApplicationInfo.CATEGORY_UNDEFINED
        }
    }
}
