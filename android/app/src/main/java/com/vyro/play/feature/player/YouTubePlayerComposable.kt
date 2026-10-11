package com.vyro.play.feature.player

import android.annotation.SuppressLint
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.PlayerConstants
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.YouTubePlayer
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.listeners.AbstractYouTubePlayerListener
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.options.IFramePlayerOptions
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.views.YouTubePlayerView
import com.vyro.core.model.PlaybackQuality

/**
 * Compose wrapper around the officially permitted
 * [android-youtube-player](https://github.com/PierfrancescoSoffritti/android-youtube-player)
 * library, which embeds YouTube's own IFrame Player API in a WebView.
 *
 * Nothing here downloads, extracts or proxies media: every frame is delivered by
 * YouTube inside the player, exactly as it is on the web.
 *
 * @param captionsEnabled forwarded to the IFrame player as `cc_load_policy`.
 * @param captionsLanguage ISO 639-1 code forwarded as `cc_lang_pref`.
 * @param onViewReady hands the raw view back so the screen can drive quality and
 *                    read the list of available streams (including 4K when present).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun YouTubePlayer(
    videoId: String,
    captionsEnabled: Boolean,
    captionsLanguage: String,
    autoplay: Boolean,
    startSeconds: Float,
    onViewReady: (YouTubePlayerView) -> Unit,
    onReady: (YouTubePlayer) -> Unit,
    onStateChange: (PlayerConstants.PlayerState) -> Unit,
    onError: (PlayerConstants.PlayerError) -> Unit,
    onCurrentSecond: (Float) -> Unit,
    onDuration: (Float) -> Unit,
    onPlaybackQualityChange: (PlaybackQuality) -> Unit,
    modifier: Modifier = Modifier,
) {
    val lifecycleOwner = LocalLifecycleOwner.current

    // Rebuilt only when an option that is baked into the IFrame changes.
    val options =
        remember(captionsEnabled, captionsLanguage) {
            IFramePlayerOptions.Builder()
                .controls(1) // the official YouTube control bar (play, seek, quality, CC)
                .ccLoadPolicy(if (captionsEnabled) 1 else 0)
                .langPref(captionsLanguage)
                .fullscreen(0) // VYRO PLAY owns fullscreen: see FullscreenController
                .rel(0)
                .modestBranding(1)
                .ivLoadPolicy(3)
                .build()
        }

    val listener =
        remember(videoId, startSeconds, autoplay) {
            object : AbstractYouTubePlayerListener() {
                override fun onReady(youTubePlayer: YouTubePlayer) {
                    if (autoplay) {
                        youTubePlayer.loadVideo(videoId, startSeconds)
                    } else {
                        youTubePlayer.cueVideo(videoId, startSeconds)
                    }
                    onReady(youTubePlayer)
                }

                override fun onStateChange(
                    youTubePlayer: YouTubePlayer,
                    state: PlayerConstants.PlayerState,
                ) {
                    onStateChange(state)
                }

                override fun onError(
                    youTubePlayer: YouTubePlayer,
                    error: PlayerConstants.PlayerError,
                ) {
                    onError(error)
                }

                override fun onCurrentSecond(
                    youTubePlayer: YouTubePlayer,
                    second: Float,
                ) {
                    onCurrentSecond(second)
                }

                override fun onVideoDuration(
                    youTubePlayer: YouTubePlayer,
                    duration: Float,
                ) {
                    onDuration(duration)
                }

                override fun onPlaybackQualityChange(
                    youTubePlayer: YouTubePlayer,
                    playbackQuality: PlayerConstants.PlaybackQuality,
                ) {
                    onPlaybackQualityChange(mapQuality(playbackQuality))
                }
            }
        }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            @Suppress("InflateParams")
            val view =
                LayoutInflater.from(context)
                    .inflate(com.vyro.play.R.layout.youtube_player_view, null) as YouTubePlayerView

            // Already false via the layout's app:enableAutomaticInitialization attribute;
            // restated here so the requirement is obvious at the call site.
            view.enableAutomaticInitialization = false
            view.matchParent()
            view.initialize(listener, handleNetworkEvents = true, options)

            // YouTubePlayerView is itself a LifecycleEventObserver: it pauses the
            // WebView when the activity stops and releases it on destroy.
            lifecycleOwner.lifecycle.addObserver(view)
            view
        },
        update = { view -> onViewReady(view) },
        onRelease = { view ->
            lifecycleOwner.lifecycle.removeObserver(view)
            view.release()
        },
    )
}

/**
 * Requests a specific playback quality on the running player.
 *
 * The library does not expose `setPlaybackQuality` on [YouTubePlayer], but the object it
 * creates inside the page is the standard IFrame player, so the documented
 * `setPlaybackQuality` method is invoked directly - the same call the YouTube website
 * makes. No stream is extracted and no DRM is touched. If the WebView or the JS object
 * is unavailable (for example if a future library release changes its internals) the
 * call is skipped and the player keeps its default adaptive behaviour.
 */
fun YouTubePlayerView.applyQuality(quality: PlaybackQuality) {
    if (quality == PlaybackQuality.AUTO) return
    val webView = findWebView(this) ?: return
    webView.post {
        runCatching {
            webView.evaluateJavascript(
                "(function(){try{" +
                    "if(typeof player!=='undefined'&&player&&player.setPlaybackQuality){" +
                    "player.setPlaybackQuality('" + quality.rawValue + "');return true;}" +
                    "}catch(e){}return false;})()",
                null,
            )
        }
    }
}

/**
 * Reads `getAvailableQualityLevels()` from the IFrame player so the quality menu can
 * offer only the streams this video actually has (2160p/4K included when present).
 */
fun YouTubePlayerView.readAvailableQualities(onResult: (List<PlaybackQuality>) -> Unit) {
    val webView = findWebView(this) ?: return
    webView.post {
        runCatching {
            webView.evaluateJavascript(
                "(function(){try{" +
                    "if(typeof player!=='undefined'&&player&&player.getAvailableQualityLevels){" +
                    "return JSON.stringify(player.getAvailableQualityLevels());}" +
                    "}catch(e){}return '[]';})()",
            ) { value ->
                val parsed = parseQualityLevels(value)
                if (parsed.isNotEmpty()) onResult(parsed)
            }
        }
    }
}

/** Depth-first search for the WebView that hosts the IFrame player. */
internal fun findWebView(root: View): WebView? {
    if (root is WebView) return root
    if (root is ViewGroup) {
        for (index in 0 until root.childCount) {
            val found = findWebView(root.getChildAt(index))
            if (found != null) return found
        }
    }
    return null
}
