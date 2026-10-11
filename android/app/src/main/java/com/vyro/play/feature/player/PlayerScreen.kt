package com.vyro.play.feature.player

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.PlayerConstants
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.YouTubePlayer
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.views.YouTubePlayerView
import com.vyro.core.domain.QualityResolver
import com.vyro.core.model.Outcome
import com.vyro.core.model.PlaybackQuality
import com.vyro.core.model.Video
import com.vyro.core.util.Formatters
import com.vyro.play.R
import com.vyro.play.ui.components.ErrorState
import com.vyro.play.ui.components.LoadingState
import com.vyro.play.ui.components.VideoRowCard
import com.vyro.play.ui.components.errorBody
import com.vyro.play.ui.components.errorTitle
import com.vyro.play.ui.components.isRetryable
import com.vyro.play.ui.navigation.youTubeWatchUri

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerScreen(
    onBack: () -> Unit,
    onVideoClick: (Video) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var playerView by remember { mutableStateOf<YouTubePlayerView?>(null) }
    var youTubePlayer by remember { mutableStateOf<YouTubePlayer?>(null) }
    var playbackState by remember { mutableStateOf(PlayerConstants.PlayerState.UNKNOWN) }
    var availableQualities by remember { mutableStateOf<List<PlaybackQuality>>(emptyList()) }
    var activeQuality by remember { mutableStateOf<PlaybackQuality?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isFullscreen by rememberSaveable { mutableStateOf(false) }
    var showQualityMenu by remember { mutableStateOf(false) }
    var descriptionExpanded by remember { mutableStateOf(false) }

    val activity = remember(context) { context.findActivity() }
    val fullscreenController = remember(activity) { activity?.let(::FullscreenController) }

    DisposableEffect(fullscreenController) {
        onDispose { fullscreenController?.release() }
    }

    BackHandler(enabled = isFullscreen) {
        isFullscreen = false
        fullscreenController?.exit()
    }

    val resolvedQuality =
        remember(state.settings.preferredQuality, availableQualities, state.network, state.settings.dataSaver) {
            QualityResolver.resolve(
                preferred = state.settings.preferredQuality,
                available = availableQualities,
                network = state.network,
                dataSaver = state.settings.dataSaver,
            )
        }

    // Apply the resolved quality whenever the player (or the choice) changes.
    LaunchedEffect(playerView, resolvedQuality) {
        playerView?.applyQuality(resolvedQuality)
    }

    // The list of streams is only known once the IFrame API has settled.
    LaunchedEffect(playerView, playbackState) {
        if (playbackState == PlayerConstants.PlayerState.PLAYING ||
            playbackState == PlayerConstants.PlayerState.VIDEO_CUED
        ) {
            playerView?.readAvailableQualities { availableQualities = it }
        }
    }

    fun toggleFullscreen() {
        val controller = fullscreenController ?: return
        val next = !isFullscreen
        isFullscreen = next
        if (next) controller.enter() else controller.exit()
    }

    Box(
        modifier =
            modifier
                .fillMaxSize()
                .background(if (isFullscreen) Color.Black else MaterialTheme.colorScheme.background),
    ) {
        when (val outcome = state.video) {
            Outcome.Loading -> LoadingState()

            is Outcome.Failure ->
                ErrorState(
                    title = errorTitle(outcome.error),
                    body = errorBody(outcome.error),
                    onRetry = if (isRetryable(outcome.error)) viewModel::retry else null,
                )

            is Outcome.Success ->
                PlayerContent(
                    video = outcome.data,
                    state = state,
                    isFullscreen = isFullscreen,
                    playbackState = playbackState,
                    errorMessage = errorMessage,
                    resolvedQuality = resolvedQuality,
                    availableQualities = availableQualities,
                    activeQuality = activeQuality,
                    showQualityMenu = showQualityMenu,
                    descriptionExpanded = descriptionExpanded,
                    onQualityMenuDismiss = { showQualityMenu = false },
                    onQualityMenuOpen = { showQualityMenu = true },
                    onToggleFullscreen = ::toggleFullscreen,
                    onToggleDescription = { descriptionExpanded = !descriptionExpanded },
                    onBack = onBack,
                    onFavoriteClick = viewModel::toggleFavorite,
                    onVideoClick = onVideoClick,
                    onShare = {
                        val intent =
                            Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, youTubeWatchUri(outcome.data.id).toString())
                            }
                        runCatching { context.startActivity(Intent.createChooser(intent, outcome.data.title)) }
                    },
                    onOpenExternally = {
                        val intent = Intent(Intent.ACTION_VIEW, youTubeWatchUri(outcome.data.id))
                        runCatching { context.startActivity(intent) }
                    },
                    player = {
                        YouTubePlayer(
                            videoId = outcome.data.id,
                            captionsEnabled = state.settings.captionsEnabled,
                            captionsLanguage = state.settings.captionsLanguage,
                            autoplay = true,
                            startSeconds = state.resumeSeconds,
                            onViewReady = { playerView = it },
                            onReady = { player ->
                                youTubePlayer = player
                                viewModel.onPlaybackStarted()
                            },
                            onStateChange = { next ->
                                playbackState = next
                                if (next == PlayerConstants.PlayerState.PLAYING) {
                                    viewModel.onPlaybackStarted()
                                }
                            },
                            onError = { error ->
                                errorMessage = playbackErrorText(error)
                                playbackState = PlayerConstants.PlayerState.UNKNOWN
                            },
                            onCurrentSecond = { second -> viewModel.onProgress(second) },
                            onDuration = { },
                            onPlaybackQualityChange = { activeQuality = it },
                            modifier = Modifier.fillMaxSize(),
                        )
                    },
                )
        }
    }
}

@Composable
private fun PlayerContent(
    video: Video,
    state: PlayerUiState,
    isFullscreen: Boolean,
    playbackState: PlayerConstants.PlayerState,
    errorMessage: String?,
    resolvedQuality: PlaybackQuality,
    availableQualities: List<PlaybackQuality>,
    activeQuality: PlaybackQuality?,
    showQualityMenu: Boolean,
    descriptionExpanded: Boolean,
    onQualityMenuOpen: () -> Unit,
    onQualityMenuDismiss: () -> Unit,
    onToggleFullscreen: () -> Unit,
    onToggleDescription: () -> Unit,
    onBack: () -> Unit,
    onFavoriteClick: () -> Unit,
    onVideoClick: (Video) -> Unit,
    onShare: () -> Unit,
    onOpenExternally: () -> Unit,
    player: @Composable () -> Unit,
) {
    if (isFullscreen) {
        Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
            player()
            FullscreenChrome(
                title = video.title,
                onExit = onToggleFullscreen,
                modifier = Modifier.align(Alignment.TopStart),
            )
        }
        return
    }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .background(Color.Black),
        ) {
            player()
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

        if (errorMessage != null) {
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        PlayerControlsRow(
            resolvedQuality = resolvedQuality,
            activeQuality = activeQuality,
            availableQualities = availableQualities,
            showQualityMenu = showQualityMenu,
            onQualityMenuOpen = onQualityMenuOpen,
            onQualityMenuDismiss = onQualityMenuDismiss,
            isFavorite = state.isFavorite,
            onFavoriteClick = onFavoriteClick,
            onShare = onShare,
            onOpenExternally = onOpenExternally,
            onToggleFullscreen = onToggleFullscreen,
        )

        Column(modifier = Modifier.padding(horizontal = 16.dp)) {
            Text(
                text = video.title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(6.dp))

            val meta =
                buildList {
                    if (video.viewCount > 0L) add("${Formatters.compactCount(video.viewCount)} views")
                    if (video.publishedAtMillis > 0L) add(Formatters.shortDate(video.publishedAtMillis))
                }.joinToString(" • ")

            if (meta.isNotBlank()) {
                Text(
                    text = meta,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(modifier = Modifier.height(12.dp))

            ChannelRow(channelTitle = video.channelTitle)

            Spacer(modifier = Modifier.height(12.dp))

            Surface(
                onClick = onToggleDescription,
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .animateContentSize(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text(
                        text = video.description.ifBlank { video.title },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = if (descriptionExpanded) Int.MAX_VALUE else 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = if (descriptionExpanded) "Show less" else "Show more",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(18.dp))

            Text(
                text = stringResource(R.string.player_up_next),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(bottom = 4.dp),
            )
        }

        when (val related = state.related) {
            Outcome.Loading -> {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.CircularProgressIndicator(
                        modifier = Modifier.size(26.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }

            is Outcome.Success -> {
                Column {
                    related.data.forEach { item ->
                        VideoRowCard(
                            video = item,
                            thumbnailQuality = state.settings.thumbnailQuality,
                            isFavorite = false,
                            onClick = { onVideoClick(item) },
                            onFavoriteClick = { },
                        )
                    }
                }
            }

            is Outcome.Failure -> Unit // related videos are optional; fail silently
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun PlayerControlsRow(
    resolvedQuality: PlaybackQuality,
    activeQuality: PlaybackQuality?,
    availableQualities: List<PlaybackQuality>,
    showQualityMenu: Boolean,
    onQualityMenuOpen: () -> Unit,
    onQualityMenuDismiss: () -> Unit,
    isFavorite: Boolean,
    onFavoriteClick: () -> Unit,
    onShare: () -> Unit,
    onOpenExternally: () -> Unit,
    onToggleFullscreen: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onFavoriteClick) {
                Icon(
                    painter = painterResource(id = if (isFavorite) R.drawable.ic_heart else R.drawable.ic_heart_outline),
                    contentDescription = stringResource(R.string.cd_favorite_toggle),
                    tint = if (isFavorite) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
            }
            IconButton(onClick = onShare) {
                Icon(
                    painter = painterResource(id = R.drawable.ic_share),
                    contentDescription = stringResource(R.string.player_share),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
            }
            IconButton(onClick = onOpenExternally) {
                Icon(
                    painter = painterResource(id = R.drawable.ic_open_in_new),
                    contentDescription = stringResource(R.string.player_open_on_youtube),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box {
                TextButton(onClick = onQualityMenuOpen) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_quality),
                        contentDescription = stringResource(R.string.player_quality),
                        tint = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = (activeQuality ?: resolvedQuality).label,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
                QualityMenu(
                    expanded = showQualityMenu,
                    available = availableQualities,
                    selected = activeQuality ?: resolvedQuality,
                    onDismiss = onQualityMenuDismiss,
                )
            }

            IconButton(onClick = onToggleFullscreen) {
                Icon(
                    painter = painterResource(id = R.drawable.ic_fullscreen),
                    contentDescription = stringResource(R.string.player_fullscreen),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
}

@Composable
private fun QualityMenu(
    expanded: Boolean,
    available: List<PlaybackQuality>,
    selected: PlaybackQuality,
    onDismiss: () -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        val options =
            if (available.isEmpty()) {
                listOf(PlaybackQuality.AUTO)
            } else {
                listOf(PlaybackQuality.AUTO) + available.filter { it != PlaybackQuality.AUTO }
            }
        options.forEach { option ->
            DropdownMenuItem(
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = option.label,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f),
                        )
                        if (option == selected) {
                            Icon(
                                painter = painterResource(id = R.drawable.ic_check),
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.secondary,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                },
                onClick = { onDismiss() },
            )
        }
        if (available.isEmpty()) {
            DropdownMenuItem(
                text = {
                    Text(
                        text = "Available streams are reported once playback starts",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                },
                onClick = onDismiss,
                enabled = false,
            )
        }
    }
}

@Composable
private fun ChannelRow(channelTitle: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = channelTitle.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = channelTitle,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "YouTube channel",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        OutlinedActionChip(text = "Subscribe disabled") {
            // VYRO PLAY deliberately does not implement subscriptions: that would
            // require an OAuth scope this app does not ask for.
        }
    }
}

@Composable
private fun OutlinedActionChip(
    text: String,
    onClick: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .clip(RoundedCornerShape(50))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .clickable(onClick = onClick)
                .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun FullscreenChrome(
    title: String,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .background(
                    androidx.compose.ui.graphics.Brush.verticalGradient(
                        listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent),
                    ),
                )
                .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onExit) {
            Icon(
                painter = painterResource(id = R.drawable.ic_fullscreen_exit),
                contentDescription = stringResource(R.string.player_exit_fullscreen),
                tint = Color.White,
                modifier = Modifier.size(22.dp),
            )
        }
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            color = Color.White,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun playbackErrorText(error: PlayerConstants.PlayerError): String =
    when (error) {
        PlayerConstants.PlayerError.VIDEO_NOT_FOUND -> stringResource(R.string.player_video_not_found)
        PlayerConstants.PlayerError.HTML_5_PLAYER,
        PlayerConstants.PlayerError.VIDEO_NOT_PLAYABLE_IN_EMBEDDED_PLAYER,
        -> stringResource(R.string.player_not_playable)

        PlayerConstants.PlayerError.INVALID_PARAMETER_IN_REQUEST,
        PlayerConstants.PlayerError.UNKNOWN,
        -> stringResource(R.string.player_unknown_error)
    }
