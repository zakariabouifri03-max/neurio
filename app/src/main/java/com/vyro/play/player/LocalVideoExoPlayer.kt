package com.vyro.play.player

import android.net.Uri
import android.view.ViewGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.vyro.play.model.PlaybackSpeedOption
import kotlinx.coroutines.delay

/**
 * AndroidX Media3 ExoPlayer integration for playing the user's own local video files
 * (MP4, MKV, WebM, MOV, up to 4K UHD local files) in the Offline section.
 */
@Composable
fun LocalVideoExoPlayerView(
    videoUri: String,
    initialPositionMs: Long,
    playbackSpeed: PlaybackSpeedOption,
    captionsEnabled: Boolean,
    zoomCropMode: Boolean,
    onProgressMs: (Long, Long) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var isPlaying by remember { mutableStateOf(true) }
    var currentPosMs by remember { mutableLongStateOf(initialPositionMs) }

    val exoPlayer = remember(context) {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
        }
    }

    LaunchedEffect(videoUri) {
        val parsedUri = Uri.parse(videoUri)
        val mediaItem = MediaItem.fromUri(parsedUri)
        exoPlayer.setMediaItem(mediaItem)
        exoPlayer.prepare()
        if (initialPositionMs > 0L) {
            exoPlayer.seekTo(initialPositionMs)
        }
        exoPlayer.playWhenReady = true
    }

    LaunchedEffect(playbackSpeed) {
        exoPlayer.playbackParameters = PlaybackParameters(playbackSpeed.rate)
    }

    LaunchedEffect(captionsEnabled) {
        exoPlayer.trackSelectionParameters = exoPlayer.trackSelectionParameters
            .buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !captionsEnabled)
            .build()
    }

    // Report playback position every 1.5s while playing
    LaunchedEffect(exoPlayer, isPlaying) {
        while (true) {
            val pos = exoPlayer.currentPosition.coerceAtLeast(0L)
            val dur = exoPlayer.duration.coerceAtLeast(0L)
            currentPosMs = pos
            if (pos > 0L) {
                onProgressMs(pos, dur)
            }
            delay(1500L)
        }
    }

    DisposableEffect(lifecycleOwner, exoPlayer) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }
        }
        exoPlayer.addListener(listener)

        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> {
                    onProgressMs(exoPlayer.currentPosition.coerceAtLeast(0L), exoPlayer.duration.coerceAtLeast(0L))
                    exoPlayer.pause()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)

        onDispose {
            onProgressMs(exoPlayer.currentPosition.coerceAtLeast(0L), exoPlayer.duration.coerceAtLeast(0L))
            lifecycleOwner.lifecycle.removeObserver(observer)
            exoPlayer.removeListener(listener)
            exoPlayer.release()
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            PlayerView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                player = exoPlayer
                useController = true
                setShowSubtitleButton(true)
                resizeMode = if (zoomCropMode) {
                    AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                } else {
                    AspectRatioFrameLayout.RESIZE_MODE_FIT
                }
            }
        },
        update = { playerView ->
            playerView.resizeMode = if (zoomCropMode) {
                AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            } else {
                AspectRatioFrameLayout.RESIZE_MODE_FIT
            }
        }
    )
}
