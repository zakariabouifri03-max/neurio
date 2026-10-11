package com.vyro.play.feature.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vyro.core.domain.WatchHistoryPolicy
import com.vyro.core.model.HistorySort
import com.vyro.core.model.LocalVideo
import com.vyro.core.model.Video
import com.vyro.core.model.WatchHistoryEntry
import com.vyro.core.util.Formatters
import com.vyro.play.R
import com.vyro.play.feature.offline.OfflineGuideScreen
import com.vyro.play.ui.components.EmptyState
import com.vyro.play.ui.components.VideoRowCard

@Composable
fun LibraryScreen(
    onVideoClick: (Video) -> Unit,
    onLocalVideoClick: (LocalVideo) -> Unit,
    initialTab: LibraryTab = LibraryTab.FAVORITES,
    modifier: Modifier = Modifier,
    viewModel: LibraryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var selectedTab by rememberSaveable { mutableStateOf(initialTab) }
    var showClearHistoryDialog by remember { mutableStateOf(false) }
    var showClearFavoritesDialog by remember { mutableStateOf(false) }

    LaunchedEffect(selectedTab) {
        if (selectedTab == LibraryTab.LOCAL && !state.hasScanned) viewModel.scanLocalVideos()
    }

    Column(modifier = modifier.fillMaxSize()) {
        ScrollableTabRow(
            selectedTabIndex = selectedTab.ordinal,
            edgePadding = 8.dp,
            containerColor = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.secondary,
            indicator = { positions ->
                TabRowDefaults.SecondaryIndicator(
                    modifier = Modifier.tabIndicatorOffset(positions[selectedTab.ordinal]),
                    color = MaterialTheme.colorScheme.secondary,
                )
            },
        ) {
            LibraryTab.entries.forEach { tab ->
                Tab(
                    selected = selectedTab == tab,
                    onClick = { selectedTab = tab },
                    text = {
                        Text(
                            text = tab.label,
                            style = MaterialTheme.typography.labelLarge,
                            color =
                                if (selectedTab == tab) {
                                    MaterialTheme.colorScheme.secondary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                        )
                    },
                )
            }
        }

        when (selectedTab) {
            LibraryTab.FAVORITES ->
                FavoritesTab(
                    videos = state.favorites,
                    thumbnailQuality = state.thumbnailQuality,
                    onVideoClick = onVideoClick,
                    onRemove = viewModel::removeFavorite,
                    onClearAll = { showClearFavoritesDialog = true },
                )

            LibraryTab.HISTORY ->
                HistoryTab(
                    entries = state.history,
                    sort = state.historySort,
                    onSortChange = viewModel::setHistorySort,
                    onVideoClick = { entry ->
                        onVideoClick(entry.toVideo())
                    },
                    onRemove = viewModel::removeFromHistory,
                    onClearAll = { showClearHistoryDialog = true },
                )

            LibraryTab.OFFLINE ->
                OfflineGuideScreen(onOpenLocalVideos = { selectedTab = LibraryTab.LOCAL })

            LibraryTab.LOCAL ->
                LocalVideosTab(
                    videos = state.localVideos,
                    isScanning = state.isScanning,
                    onScan = viewModel::scanLocalVideos,
                    onVideoClick = onLocalVideoClick,
                )
        }
    }

    if (showClearHistoryDialog) {
        ConfirmDialog(
            text = stringResource(R.string.library_clear_history_confirm),
            onConfirm = {
                viewModel.clearHistory()
                showClearHistoryDialog = false
            },
            onDismiss = { showClearHistoryDialog = false },
        )
    }
    if (showClearFavoritesDialog) {
        ConfirmDialog(
            text = stringResource(R.string.library_clear_favorites),
            onConfirm = {
                viewModel.clearFavorites()
                showClearFavoritesDialog = false
            },
            onDismiss = { showClearFavoritesDialog = false },
        )
    }
}

@Composable
private fun FavoritesTab(
    videos: List<Video>,
    thumbnailQuality: com.vyro.core.model.ThumbnailQuality,
    onVideoClick: (Video) -> Unit,
    onRemove: (String) -> Unit,
    onClearAll: () -> Unit,
) {
    if (videos.isEmpty()) {
        EmptyState(
            title = stringResource(R.string.favorites_empty_title),
            body = stringResource(R.string.favorites_empty_body),
            iconRes = R.drawable.ic_heart_outline,
        )
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "${videos.size} saved",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = onClearAll) {
                    Text(
                        text = "Clear all",
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }
        }
        items(items = videos, key = { it.id }) { video ->
            VideoRowCard(
                video = video,
                thumbnailQuality = thumbnailQuality,
                isFavorite = true,
                onClick = { onVideoClick(video) },
                onFavoriteClick = { onRemove(video.id) },
            )
        }
    }
}

@Composable
private fun HistoryTab(
    entries: List<WatchHistoryEntry>,
    sort: HistorySort,
    onSortChange: (HistorySort) -> Unit,
    onVideoClick: (WatchHistoryEntry) -> Unit,
    onRemove: (String) -> Unit,
    onClearAll: () -> Unit,
) {
    if (entries.isEmpty()) {
        EmptyState(
            title = stringResource(R.string.history_empty_title),
            body = stringResource(R.string.history_empty_body),
            iconRes = R.drawable.ic_history,
        )
        return
    }

    var showSortMenu by rememberSaveable { mutableStateOf(false) }

    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "${entries.size} watched",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        TextButton(onClick = { showSortMenu = true }) {
                            Icon(
                                painter = painterResource(id = R.drawable.ic_filter),
                                contentDescription = stringResource(R.string.library_sort),
                                tint = MaterialTheme.colorScheme.secondary,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(text = sort.label, color = MaterialTheme.colorScheme.secondary)
                        }
                        androidx.compose.material3.DropdownMenu(
                            expanded = showSortMenu,
                            onDismissRequest = { showSortMenu = false },
                        ) {
                            HistorySort.entries.forEach { option ->
                                androidx.compose.material3.DropdownMenuItem(
                                    text = { Text(option.label) },
                                    onClick = {
                                        onSortChange(option)
                                        showSortMenu = false
                                    },
                                )
                            }
                        }
                    }
                    TextButton(onClick = onClearAll) {
                        Text(text = "Clear", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }

        items(items = entries, key = { it.videoId }) { entry ->
            HistoryRow(
                entry = entry,
                onClick = { onVideoClick(entry) },
                onRemove = { onRemove(entry.videoId) },
            )
        }
    }
}

@Composable
private fun HistoryRow(
    entry: WatchHistoryEntry,
    onClick: () -> Unit,
    onRemove: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier =
                Modifier
                    .width(150.dp)
                    .aspectRatio(16f / 9f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            if (entry.thumbnailUrl.isNotBlank()) {
                coil.compose.AsyncImage(
                    model = entry.thumbnailUrl,
                    contentDescription = null,
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            if (entry.durationMillis > 0L) {
                Box(
                    modifier =
                        Modifier
                            .align(Alignment.BottomEnd)
                            .padding(5.dp)
                            .clip(RoundedCornerShape(5.dp))
                            .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.8f))
                            .padding(horizontal = 5.dp, vertical = 1.dp),
                ) {
                    Text(
                        text = Formatters.clockDuration(entry.durationMillis),
                        style = MaterialTheme.typography.labelSmall,
                        color = androidx.compose.ui.graphics.Color.White,
                    )
                }
            }
            LinearProgressIndicator(
                progress = { WatchHistoryPolicy.progressFraction(entry) },
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .height(3.dp),
                color = MaterialTheme.colorScheme.secondary,
                trackColor = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.2f),
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.title,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = entry.channelTitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text =
                    listOf(
                        Formatters.relativeTime(entry.lastWatchedMillis, System.currentTimeMillis()),
                        if (entry.watchCount > 1) "watched ${entry.watchCount}×" else "",
                    ).filter { it.isNotBlank() }.joinToString(" • "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onRemove, modifier = Modifier.size(36.dp)) {
            Icon(
                painter = painterResource(id = R.drawable.ic_close),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun LocalVideosTab(
    videos: List<LocalVideo>,
    isScanning: Boolean,
    onScan: () -> Unit,
    onVideoClick: (LocalVideo) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "${videos.size} on device",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = onScan) {
                Text(text = stringResource(R.string.library_scan), color = MaterialTheme.colorScheme.secondary)
            }
        }

        when {
            isScanning -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(32.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }

            videos.isEmpty() ->
                EmptyState(
                    title = stringResource(R.string.local_empty_title),
                    body = stringResource(R.string.local_empty_body),
                    iconRes = R.drawable.ic_folder,
                    actionLabel = stringResource(R.string.library_scan),
                    onAction = onScan,
                )

            else ->
                LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                    items(items = videos, key = { it.uri }) { video ->
                        LocalVideoRow(video = video, onClick = { onVideoClick(video) })
                    }
                }
        }
    }
}

@Composable
private fun LocalVideoRow(
    video: LocalVideo,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .size(width = 96.dp, height = 56.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(id = R.drawable.ic_play),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(24.dp),
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = video.displayName,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(3.dp))
            Text(
                text =
                    listOf(
                        Formatters.clockDuration(video.durationMillis),
                        Formatters.fileSize(video.sizeBytes),
                        video.qualityLabel,
                    ).joinToString(" • "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ConfirmDialog(
    text: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = text,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(text = "Confirm", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(text = "Cancel", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        containerColor = MaterialTheme.colorScheme.surface,
    )
}

private fun WatchHistoryEntry.toVideo(): Video =
    Video(
        id = videoId,
        title = title,
        description = "",
        channelId = "",
        channelTitle = channelTitle,
        publishedAtMillis = 0L,
        publishedAtRaw = "",
        thumbnails =
            com.vyro.core.model.Thumbnails(
                defaultUrl = thumbnailUrl,
                mediumUrl = thumbnailUrl,
                highUrl = thumbnailUrl,
                standardUrl = null,
                maxResUrl = null,
            ),
        durationMillis = durationMillis,
        viewCount = 0L,
        likeCount = 0L,
        commentCount = 0L,
        isLive = false,
    )
