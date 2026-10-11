package com.vyro.play.feature.localplayer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.vyro.core.util.Formatters
import com.vyro.play.R
import com.vyro.play.feature.player.FullscreenController
import com.vyro.play.feature.player.findActivity

/**
 * Plays a video file that lives on the device using Media3 (ExoPlayer).
 *
 * This path is completely offline and supports every resolution the file itself has,
 * including 4K, limited only by the device's decoder.
 */
@Composable
fun LocalPlayerScreen(
    uri: String,
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var hasError by remember { mutableStateOf(false) }
    var isFullscreen by rememberSaveable { mutableStateOf(false) }

    val activity = remember(context) { context.findActivity() }
    val fullscreenController = remember(activity) { activity?.let(::FullscreenController) }

    val player =
        remember(uri) {
            ExoPlayer.Builder(context).build().apply {
                setMediaItem(MediaItem.fromUri(uri))
                prepare()
                playWhenReady = true
                addListener(
                    object : Player.Listener {
                        override fun onPlayerError(error: PlaybackException) {
                            hasError = true
                        }
                    },
                )
            }
        }

    DisposableEffect(player) {
        onDispose {
            fullscreenController?.release()
            player.release()
        }
    }

    fun toggleFullscreen() {
        val next = !isFullscreen
        isFullscreen = next
        if (next) fullscreenController?.enter() else fullscreenController?.exit()
    }

    Box(
        modifier =
            modifier
                .fillMaxSize()
                .background(if (isFullscreen) Color.Black else MaterialTheme.colorScheme.background),
    ) {
        if (isFullscreen) {
            PlayerSurface(player = player, modifier = Modifier.fillMaxSize())
            Row(
                modifier =
                    Modifier
                        .align(Alignment.TopStart)
                        .fillMaxWidth()
                        .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(
                    onClick = {
                        isFullscreen = false
                        fullscreenController?.exit()
                    },
                    modifier =
                        Modifier
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.45f)),
                ) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_fullscreen_exit),
                        contentDescription = stringResource(R.string.player_exit_fullscreen),
                        tint = Color.White,
                        modifier = Modifier.size(22.dp),
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .height(240.dp)
                            .background(Color.Black),
                ) {
                    PlayerSurface(player = player, modifier = Modifier.fillMaxSize())
                    IconButton(
                        onClick = onBack,
                        modifier =
                            Modifier
                                .align(Alignment.TopStart)
                                .padding(6.dp)
                                .clip(CircleShape)
                                .background(Color.Black.copy(alpha = 0.45f)),
                    ) {
                        Icon(
                            painter = painterResource(id = R.drawable.ic_arrow_back),
                            contentDescription = stringResource(R.string.cd_navigate_back),
                            tint = Color.White,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }

                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    if (hasError) {
                        Text(
                            text = stringResource(R.string.local_player_error),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    } else {
                        Text(
                            text = stringResource(R.string.local_player_title),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { player.seekBack() }) {
                            Icon(
                                painter = painterResource(id = R.drawable.ic_skip_previous),
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                        IconButton(onClick = { if (player.isPlaying) player.pause() else player.play() }) {
                            Icon(
                                painter =
                                    painterResource(
                                        id = if (player.isPlaying) R.drawable.ic_pause else R.drawable.ic_play,
                                    ),
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.secondary,
                                modifier = Modifier.size(28.dp),
                            )
                        }
                        IconButton(onClick = { player.seekForward() }) {
                            Icon(
                                painter = painterResource(id = R.drawable.ic_skip_next),
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = Formatters.clockDuration(player.duration.coerceAtLeast(0L)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.weight(1f))
                        IconButton(onClick = ::toggleFullscreen) {
                            Icon(
                                painter = painterResource(id = R.drawable.ic_fullscreen),
                                contentDescription = stringResource(R.string.player_fullscreen),
                                tint = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayerSurface(
    player: ExoPlayer,
    modifier: Modifier = Modifier,
) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            PlayerView(context).apply {
                this.player = player
                useController = true
                setShowNextButton(false)
                setShowPreviousButton(false)
                controllerShowTimeoutMs = 3_000
                setKeepContentOnPlayerReset(false)
            }
        },
        onRelease = { view ->
            view.player = null
        },
    )
}
