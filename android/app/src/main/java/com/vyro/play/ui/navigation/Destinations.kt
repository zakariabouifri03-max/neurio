package com.vyro.play.ui.navigation

import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import com.vyro.core.util.YouTubeLink

/** Navigation graph contract: one object holding every route and argument name. */
object Routes {
    const val HOME = "home"
    const val SEARCH = "search"
    const val LIBRARY = "library"
    const val SETTINGS = "settings"
    const val OFFLINE = "offline"
    const val LOCAL_VIDEOS = "local_videos"
    const val PLAYER = "player/{videoId}"
    const val LOCAL_PLAYER = "local_player?uri={uri}&title={title}"

    fun player(videoId: String) = "player/$videoId"

    fun localPlayer(
        uri: String,
        title: String,
    ) = "local_player?uri=${Uri.encode(uri)}&title=${Uri.encode(title)}"
}

object Args {
    const val VIDEO_ID = "videoId"
    const val URI = "uri"
    const val TITLE = "title"
    const val TAB = "tab"
}

/** Top-level destinations that appear in the navigation bar / rail. */
enum class TopDestination(
    val route: String,
    val labelRes: Int,
    val iconRes: Int,
) {
    HOME(Routes.HOME, com.vyro.play.R.string.nav_home, com.vyro.play.R.drawable.ic_home),
    SEARCH(Routes.SEARCH, com.vyro.play.R.string.nav_search, com.vyro.play.R.drawable.ic_search),
    LIBRARY(Routes.LIBRARY, com.vyro.play.R.string.nav_library, com.vyro.play.R.drawable.ic_folder),
    SETTINGS(Routes.SETTINGS, com.vyro.play.R.string.nav_settings, com.vyro.play.R.drawable.ic_settings),
}

/** Something the app was asked to open from outside (a link, or a local file). */
sealed interface DeepLink {
    data class YouTube(val videoId: String) : DeepLink

    data class LocalFile(val uri: String) : DeepLink
}

/**
 * Maps an incoming [Intent] onto an in-app destination.
 *
 * Supported:
 *  - https://www.youtube.com/watch?v=... and https://youtu.be/...
 *  - ACTION_VIEW with a video file shared from a file manager
 */
fun resolveDeepLink(intent: Intent?): DeepLink? {
    if (intent == null) return null
    val action = intent.action
    if (action != Intent.ACTION_VIEW && action != Intent.ACTION_SEND) return null

    if (action == Intent.ACTION_SEND) {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        val id = YouTubeLink.extractVideoId(text)
        if (id != null) return DeepLink.YouTube(id)
        return null
    }

    val uri = intent.data ?: return null
    val scheme = uri.scheme.orEmpty()

    if (scheme == "content" || scheme == "file") {
        return DeepLink.LocalFile(uri.toString())
    }

    val id = YouTubeLink.extractVideoId(uri.toString())
    if (id != null) return DeepLink.YouTube(id)

    if (intent.type?.startsWith("video/") == true) {
        return DeepLink.LocalFile(uri.toString())
    }
    return null
}

fun youTubeWatchUri(videoId: String): Uri = "https://www.youtube.com/watch?v=$videoId".toUri()
