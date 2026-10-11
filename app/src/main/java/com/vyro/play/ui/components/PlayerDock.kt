package com.vyro.play.ui.components

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.ClosedCaptionDisabled
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vyro.play.data.remote.YouTubeMetadataParser
import com.vyro.play.model.LocalVideoFile
import com.vyro.play.model.PlaybackSpeedOption
import com.vyro.play.model.VideoQualityOption
import com.vyro.play.model.YouTubeVideo
import com.vyro.play.player.LocalVideoExoPlayerView
import com.vyro.play.player.OfficialYouTubePlayerView
import com.vyro.play.player.YouTubePlayerController
import com.vyro.play.player.openInOfficialYouTubeApp
import com.vyro.play.ui.theme.VyroCyanAccent
import com.vyro.play.ui.theme.VyroObsidianBlack
import com.vyro.play.ui.theme.VyroPurpleDeep
import com.vyro.play.ui.theme.VyroPurplePrimary

@Composable
fun VyroPlayerDock(
    activeYouTubeVideo: YouTubeVideo?,
    youTubeStartSeconds: Long,
    activeLocalVideo: LocalVideoFile?,
    isFavorite: Boolean,
    preferredQuality: VideoQualityOption,
    captionsDefaultEnabled: Boolean,
    captionsLanguage: String,
    isFullscreen: Boolean,
    onToggleFullscreen: (Boolean) -> Unit,
    onToggleFavorite: (YouTubeVideo) -> Unit,
    onQualitySelected: (VideoQualityOption) -> Unit,
    onYouTubeProgress: (Long, Long) -> Unit,
    onLocalProgress: (Long, Long) -> Unit,
    onClosePlayer: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val ytController = remember { YouTubePlayerController() }

    var showQualityDialog by remember { mutableStateOf(false) }
    var showSpeedDialog by remember { mutableStateOf(false) }

    var localCaptionsEnabled by remember(captionsDefaultEnabled) { mutableStateOf(captionsDefaultEnabled) }
    var localSpeed by remember { mutableStateOf(PlaybackSpeedOption.SPEED_1_0) }
    var localZoomCrop by remember { mutableStateOf(false) }

    LaunchedEffect(activeYouTubeVideo?.id) {
        if (activeYouTubeVideo != null) {
            ytController.captionsEnabled = captionsDefaultEnabled
            ytController.activeQuality = preferredQuality
        }
    }

    if (isFullscreen) {
        BackHandler {
            onToggleFullscreen(false)
        }
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = VyroObsidianBlack,
        border = if (!isFullscreen) {
            BorderStroke(1.dp, VyroPurplePrimary.copy(alpha = 0.55f))
        } else {
            null
        }
    ) {
        Column(
            modifier = if (isFullscreen) Modifier.fillMaxSize() else Modifier.fillMaxWidth()
        ) {
            // Video Viewport (Full screen in landscape fullscreen mode, 16:9 in docked mode)
            Box(
                modifier = if (isFullscreen) {
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .background(Color.Black)
                } else {
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 9f)
                        .background(Color.Black)
                }
            ) {
                if (activeYouTubeVideo != null) {
                    OfficialYouTubePlayerView(
                        videoId = activeYouTubeVideo.id,
                        initialStartSeconds = youTubeStartSeconds,
                        preferredQuality = preferredQuality,
                        captionsDefaultEnabled = captionsDefaultEnabled,
                        captionsLanguage = captionsLanguage,
                        controller = ytController,
                        onProgressUpdate = onYouTubeProgress,
                        onVideoEnded = {},
                        modifier = Modifier.fillMaxSize()
                    )

                    // Embed restriction fallback overlay (e.g. error 101 / 150)
                    if (ytController.playerErrorCode != 0) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(VyroObsidianBlack.copy(alpha = 0.92f))
                                .padding(20.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Text(
                                    text = "External Playback Requested by Creator (Code ${ytController.playerErrorCode})",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Color.White
                                )
                                Text(
                                    text = "The uploader of this video has restricted embedded playback or requires opening directly in the official YouTube application.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Button(
                                    onClick = { openInOfficialYouTubeApp(context, activeYouTubeVideo.id) },
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = VyroPurplePrimary,
                                        contentColor = Color.White
                                    )
                                ) {
                                    Icon(Icons.Default.OpenInNew, contentDescription = null)
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Watch in Official YouTube App")
                                }
                            }
                        }
                    }
                } else if (activeLocalVideo != null) {
                    LocalVideoExoPlayerView(
                        videoUri = activeLocalVideo.uri,
                        initialPositionMs = activeLocalVideo.lastPositionMs,
                        playbackSpeed = localSpeed,
                        captionsEnabled = localCaptionsEnabled,
                        zoomCropMode = localZoomCrop,
                        onProgressMs = onLocalProgress,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                // Floating Top-Right Fullscreen & Close quick actions
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Surface(
                        shape = CircleShape,
                        color = Color.Black.copy(alpha = 0.68f),
                        border = BorderStroke(1.dp, VyroCyanAccent.copy(alpha = 0.6f))
                    ) {
                        IconButton(
                            onClick = { onToggleFullscreen(!isFullscreen) },
                            modifier = Modifier.size(34.dp)
                        ) {
                            Icon(
                                imageVector = if (isFullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                                contentDescription = if (isFullscreen) "Exit Fullscreen" else "Enter Fullscreen",
                                tint = VyroCyanAccent,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                    Surface(
                        shape = CircleShape,
                        color = Color.Black.copy(alpha = 0.68f),
                        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.35f))
                    ) {
                        IconButton(
                            onClick = onClosePlayer,
                            modifier = Modifier.size(34.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Close Player",
                                tint = Color.White,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }

            // VYRO PLAY Synchronized Control Bar & Quality / Captions Deck
            if (activeYouTubeVideo != null) {
                YouTubeControlDeck(
                    video = activeYouTubeVideo,
                    controller = ytController,
                    isFavorite = isFavorite,
                    isFullscreen = isFullscreen,
                    onToggleFavorite = { onToggleFavorite(activeYouTubeVideo) },
                    onOpenQualityDialog = { showQualityDialog = true },
                    onOpenSpeedDialog = { showSpeedDialog = true },
                    onToggleCaptions = {
                        ytController.setCaptions(!ytController.captionsEnabled, captionsLanguage)
                    },
                    onToggleFullscreen = { onToggleFullscreen(!isFullscreen) },
                    onOpenInYouTubeApp = { openInOfficialYouTubeApp(context, activeYouTubeVideo.id) },
                    onShareVideo = {
                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(
                                Intent.EXTRA_TEXT,
                                "${activeYouTubeVideo.title}\nhttps://www.youtube.com/watch?v=${activeYouTubeVideo.id}"
                            )
                        }
                        context.startActivity(Intent.createChooser(shareIntent, "Share Video"))
                    }
                )
            } else if (activeLocalVideo != null) {
                LocalVideoControlDeck(
                    video = activeLocalVideo,
                    isFullscreen = isFullscreen,
                    captionsEnabled = localCaptionsEnabled,
                    playbackSpeed = localSpeed,
                    zoomCrop = localZoomCrop,
                    onToggleCaptions = { localCaptionsEnabled = !localCaptionsEnabled },
                    onOpenSpeedDialog = { showSpeedDialog = true },
                    onToggleZoomCrop = { localZoomCrop = !localZoomCrop },
                    onToggleFullscreen = { onToggleFullscreen(!isFullscreen) }
                )
            }
        }
    }

    // Quality Selector Dialog (Up to 2160p 4K Ultra HD)
    if (showQualityDialog) {
        AlertDialog(
            onDismissRequest = { showQualityDialog = false },
            containerColor = MaterialTheme.colorScheme.surface,
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.HighQuality,
                        contentDescription = null,
                        tint = VyroCyanAccent
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Playback Quality (Up to 4K)")
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "Select preferred resolution for the Official YouTube Player. 4K (2160p) and 2K (1440p) activate automatically when supported by the video stream.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    val reportedAvailable = ytController.availableQualities.toSet()
                    VideoQualityOption.entries.forEach { option ->
                        val isSelected = ytController.activeQuality == option || preferredQuality == option
                        val isStreamReported = reportedAvailable.isEmpty() ||
                            option == VideoQualityOption.AUTO ||
                            reportedAvailable.contains(option)
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    ytController.setPreferredQuality(option)
                                    onQualitySelected(option)
                                    showQualityDialog = false
                                },
                            shape = RoundedCornerShape(10.dp),
                            color = if (isSelected) {
                                VyroPurpleDeep.copy(alpha = 0.65f)
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
                            },
                            border = BorderStroke(
                                width = 1.dp,
                                color = if (isSelected) VyroCyanAccent else Color.Transparent
                            )
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                QualityBadgePill(
                                    text = option.badge,
                                    is4K = option == VideoQualityOption.UHD_4K
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = option.label,
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                    Text(
                                        text = if (isStreamReported) option.description else "${option.description} (If available)",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                if (isSelected) {
                                    Icon(
                                        imageVector = Icons.Default.Check,
                                        contentDescription = "Selected",
                                        tint = VyroCyanAccent
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showQualityDialog = false }) {
                    Text("Done", color = VyroCyanAccent)
                }
            }
        )
    }

    // Playback Speed Dialog
    if (showSpeedDialog) {
        AlertDialog(
            onDismissRequest = { showSpeedDialog = false },
            containerColor = MaterialTheme.colorScheme.surface,
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Speed, contentDescription = null, tint = VyroCyanAccent)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Playback Speed")
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val currentSpeed = if (activeYouTubeVideo != null) ytController.playbackSpeed else localSpeed
                    PlaybackSpeedOption.entries.forEach { speedOption ->
                        val selected = currentSpeed == speedOption
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (activeYouTubeVideo != null) {
                                        ytController.setSpeed(speedOption)
                                    } else {
                                        localSpeed = speedOption
                                    }
                                    showSpeedDialog = false
                                },
                            shape = RoundedCornerShape(10.dp),
                            color = if (selected) VyroPurpleDeep.copy(alpha = 0.65f) else Color.Transparent,
                            border = BorderStroke(1.dp, if (selected) VyroCyanAccent else Color.Transparent)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = speedOption.label,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.weight(1f)
                                )
                                if (selected) {
                                    Icon(Icons.Default.Check, contentDescription = null, tint = VyroCyanAccent)
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showSpeedDialog = false }) {
                    Text("Close", color = VyroCyanAccent)
                }
            }
        )
    }
}

@Composable
private fun YouTubeControlDeck(
    video: YouTubeVideo,
    controller: YouTubePlayerController,
    isFavorite: Boolean,
    isFullscreen: Boolean,
    onToggleFavorite: () -> Unit,
    onOpenQualityDialog: () -> Unit,
    onOpenSpeedDialog: () -> Unit,
    onToggleCaptions: () -> Unit,
    onToggleFullscreen: () -> Unit,
    onOpenInYouTubeApp: () -> Unit,
    onShareVideo: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(VyroObsidianBlack)
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        // Timeline Scrubber + Transport Controls
        val duration = controller.durationSeconds.coerceAtLeast(video.durationSeconds).coerceAtLeast(1L)
        val current = controller.currentSeconds.coerceIn(0L, duration)

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = { controller.togglePlayPause() },
                modifier = Modifier.size(34.dp)
            ) {
                Icon(
                    imageVector = if (controller.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (controller.isPlaying) "Pause" else "Play",
                    tint = VyroCyanAccent
                )
            }
            IconButton(
                onClick = { controller.seekBy(-10L) },
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Replay10,
                    contentDescription = "Rewind 10 seconds",
                    tint = Color.White
                )
            }
            IconButton(
                onClick = { controller.seekBy(10L) },
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Forward10,
                    contentDescription = "Forward 10 seconds",
                    tint = Color.White
                )
            }

            Text(
                text = YouTubeMetadataParser.formatDurationSeconds(current),
                style = MaterialTheme.typography.labelSmall,
                color = VyroCyanAccent,
                modifier = Modifier.padding(horizontal = 4.dp)
            )

            Slider(
                value = current.toFloat(),
                onValueChange = { controller.seekTo(it.toLong()) },
                valueRange = 0f..duration.toFloat(),
                modifier = Modifier
                    .weight(1f)
                    .height(24.dp),
                colors = SliderDefaults.colors(
                    thumbColor = VyroCyanAccent,
                    activeTrackColor = VyroPurplePrimary,
                    inactiveTrackColor = Color.White.copy(alpha = 0.2f)
                )
            )

            Text(
                text = YouTubeMetadataParser.formatDurationSeconds(duration),
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.75f),
                modifier = Modifier.padding(horizontal = 4.dp)
            )

            IconButton(
                onClick = { controller.setMute(!controller.isMuted) },
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    imageVector = if (controller.isMuted) Icons.Default.VolumeOff else Icons.Default.VolumeUp,
                    contentDescription = if (controller.isMuted) "Unmute" else "Mute",
                    tint = if (controller.isMuted) Color.Gray else Color.White
                )
            }
        }

        if (!isFullscreen) {
            // Video Title & Channel Summary
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = video.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "${video.channelTitle} • ${video.viewCountFormatted}",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.7f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                IconButton(onClick = onToggleFavorite) {
                    Icon(
                        imageVector = if (isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        contentDescription = "Favorite",
                        tint = if (isFavorite) VyroCyanAccent else Color.White
                    )
                }
            }
        }

        // Scrollable Action & Quality Chip Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            FilterChip(
                selected = true,
                onClick = onOpenQualityDialog,
                label = {
                    Text(
                        text = "Quality: ${controller.activeQuality.badge}",
                        style = MaterialTheme.typography.labelMedium
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.HighQuality,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = VyroPurpleDeep,
                    selectedLabelColor = VyroCyanAccent,
                    selectedLeadingIconColor = VyroCyanAccent
                )
            )

            FilterChip(
                selected = controller.captionsEnabled,
                onClick = onToggleCaptions,
                label = {
                    Text(
                        text = if (controller.captionsEnabled) "Captions: ON" else "Captions: OFF",
                        style = MaterialTheme.typography.labelMedium
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = if (controller.captionsEnabled) {
                            Icons.Default.ClosedCaption
                        } else {
                            Icons.Default.ClosedCaptionDisabled
                        },
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = VyroPurpleDeep,
                    selectedLabelColor = VyroCyanAccent,
                    selectedLeadingIconColor = VyroCyanAccent
                )
            )

            FilterChip(
                selected = controller.playbackSpeed != PlaybackSpeedOption.SPEED_1_0,
                onClick = onOpenSpeedDialog,
                label = {
                    Text(
                        text = "Speed: ${controller.playbackSpeed.label}",
                        style = MaterialTheme.typography.labelMedium
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Speed,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )

            FilterChip(
                selected = isFullscreen,
                onClick = onToggleFullscreen,
                label = {
                    Text(
                        text = if (isFullscreen) "Exit Fullscreen" else "Fullscreen",
                        style = MaterialTheme.typography.labelMedium
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = if (isFullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )

            OutlinedButton(
                onClick = onShareVideo,
                border = BorderStroke(1.dp, VyroPurplePrimary.copy(alpha = 0.6f))
            ) {
                Icon(
                    imageVector = Icons.Default.Share,
                    contentDescription = null,
                    tint = VyroCyanAccent,
                    modifier = Modifier.size(15.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("Share", style = MaterialTheme.typography.labelMedium, color = Color.White)
            }

            OutlinedButton(
                onClick = onOpenInYouTubeApp,
                border = BorderStroke(1.dp, VyroCyanAccent.copy(alpha = 0.6f))
            ) {
                Icon(
                    imageVector = Icons.Default.OpenInNew,
                    contentDescription = null,
                    tint = VyroCyanAccent,
                    modifier = Modifier.size(15.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("YouTube App", style = MaterialTheme.typography.labelMedium, color = VyroCyanAccent)
            }
        }

        HorizontalDivider(
            modifier = Modifier.padding(top = 6.dp),
            color = VyroPurplePrimary.copy(alpha = 0.25f)
        )
    }
}

@Composable
private fun LocalVideoControlDeck(
    video: LocalVideoFile,
    isFullscreen: Boolean,
    captionsEnabled: Boolean,
    playbackSpeed: PlaybackSpeedOption,
    zoomCrop: Boolean,
    onToggleCaptions: () -> Unit,
    onOpenSpeedDialog: () -> Unit,
    onToggleZoomCrop: () -> Unit,
    onToggleFullscreen: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(VyroObsidianBlack)
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        if (!isFullscreen) {
            Text(
                text = video.displayName,
                style = MaterialTheme.typography.titleSmall,
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Local Offline Video • ${video.resolution} • ${video.sizeFormatted}",
                style = MaterialTheme.typography.bodySmall,
                color = VyroCyanAccent
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            FilterChip(
                selected = captionsEnabled,
                onClick = onToggleCaptions,
                label = { Text(if (captionsEnabled) "Subtitles: ON" else "Subtitles: OFF") },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.ClosedCaption,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )
            FilterChip(
                selected = playbackSpeed != PlaybackSpeedOption.SPEED_1_0,
                onClick = onOpenSpeedDialog,
                label = { Text("Speed: ${playbackSpeed.label}") },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Speed,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )
            FilterChip(
                selected = zoomCrop,
                onClick = onToggleZoomCrop,
                label = { Text(if (zoomCrop) "Aspect: Zoom" else "Aspect: Fit") },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.AspectRatio,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )
            FilterChip(
                selected = isFullscreen,
                onClick = onToggleFullscreen,
                label = { Text(if (isFullscreen) "Exit Fullscreen" else "Fullscreen") },
                leadingIcon = {
                    Icon(
                        imageVector = if (isFullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )
        }
    }
}
