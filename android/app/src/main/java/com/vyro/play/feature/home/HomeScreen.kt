package com.vyro.play.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vyro.core.model.AppError
import com.vyro.core.model.ExploreCategory
import com.vyro.core.model.NetworkClass
import com.vyro.core.model.Outcome
import com.vyro.core.model.Video
import com.vyro.play.R
import com.vyro.play.ui.components.ErrorState
import com.vyro.play.ui.components.LoadingSkeletonList
import com.vyro.play.ui.components.VideoRowCard
import com.vyro.play.ui.components.errorBody
import com.vyro.play.ui.components.errorTitle
import com.vyro.play.ui.components.isRetryable

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onVideoClick: (Video) -> Unit,
    onOpenLocalVideos: () -> Unit,
    onOpenOfflineGuide: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val pullToRefreshState = rememberPullToRefreshState()

    PullToRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = viewModel::refresh,
        state = pullToRefreshState,
        modifier = modifier.fillMaxSize(),
    ) {
        when (val feed = state.feed) {
            Outcome.Loading -> LoadingSkeletonList()

            is Outcome.Failure ->
                ErrorState(
                    title = errorTitle(feed.error),
                    body = errorBody(feed.error),
                    onRetry = if (isRetryable(feed.error)) viewModel::refresh else null,
                    modifier = Modifier.fillMaxSize(),
                )

            is Outcome.Success ->
                HomeContent(
                    videos = feed.data,
                    state = state,
                    onVideoClick = onVideoClick,
                    onFavoriteClick = viewModel::toggleFavorite,
                    onCategorySelected = viewModel::selectCategory,
                    onOpenLocalVideos = onOpenLocalVideos,
                    onOpenOfflineGuide = onOpenOfflineGuide,
                    onOpenSettings = onOpenSettings,
                    onVisibleIndexChanged = viewModel::onVisibleIndexChanged,
                    onLoadMore = viewModel::loadMore,
                )
        }
    }
}

@Composable
private fun HomeContent(
    videos: List<Video>,
    state: HomeUiState,
    onVideoClick: (Video) -> Unit,
    onFavoriteClick: (Video) -> Unit,
    onCategorySelected: (ExploreCategory) -> Unit,
    onOpenLocalVideos: () -> Unit,
    onOpenOfflineGuide: () -> Unit,
    onOpenSettings: () -> Unit,
    onVisibleIndexChanged: (Int) -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()

    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 24.dp),
    ) {
        item(key = "header") { HomeHeader(offline = state.network == NetworkClass.NONE, onOpenSettings = onOpenSettings) }

        item(key = "chips") { CategoryChips(selected = state.category, onSelected = onCategorySelected) }

        item(key = "feature-cards") {
            FeatureCards(
                onOpenLocalVideos = onOpenLocalVideos,
                onOpenOfflineGuide = onOpenOfflineGuide,
            )
        }

        if (videos.isEmpty()) {
            item(key = "empty") {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(R.string.search_no_results_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            itemsIndexed(
                items = videos,
                key = { _, video -> video.id },
                contentType = { _, _ -> "video" },
            ) { index, video ->
                VideoRowCard(
                    video = video,
                    thumbnailQuality = state.thumbnailQuality,
                    isFavorite = state.favoriteIds.contains(video.id),
                    onClick = { onVideoClick(video) },
                    onFavoriteClick = { onFavoriteClick(video) },
                )
                LaunchedEffect(index) { onVisibleIndexChanged(index) }
            }
        }

        item(key = "footer") {
            when {
                state.isAppending -> {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 20.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        androidx.compose.material3.CircularProgressIndicator(
                            modifier = Modifier.size(28.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                    }
                }

                state.endReached && videos.isNotEmpty() -> {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 20.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = stringResource(R.string.state_end_of_list),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                else -> {
                    LaunchedEffect(Unit) { onLoadMore() }
                    Spacer(modifier = Modifier.height(1.dp))
                }
            }
        }
    }
}

@Composable
private fun HomeHeader(
    offline: Boolean,
    onOpenSettings: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = 18.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "VYRO",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                text = "PLAY",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.secondary,
                fontWeight = FontWeight.ExtraBold,
            )
        }
        if (offline) {
            OfflineChip(modifier = Modifier.padding(end = 8.dp))
        }
    }
}

@Composable
private fun OfflineChip(modifier: Modifier = Modifier) {
    Row(
        modifier =
            modifier
                .clip(RoundedCornerShape(50))
                .background(MaterialTheme.colorScheme.error.copy(alpha = 0.16f))
                .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(id = R.drawable.ic_offline),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(14.dp),
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = stringResource(R.string.state_offline_title),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.error,
        )
    }
}

@Composable
private fun CategoryChips(
    selected: ExploreCategory,
    onSelected: (ExploreCategory) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(items = ExploreCategory.entries, key = { it.id }) { category ->
            val isSelected = category == selected
            FilterChip(
                selected = isSelected,
                onClick = { onSelected(category) },
                label = {
                    Text(
                        text = category.label,
                        style = MaterialTheme.typography.labelLarge,
                    )
                },
                leadingIcon =
                    if (isSelected) {
                        {
                            Icon(
                                painter = painterResource(id = R.drawable.ic_check),
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    } else {
                        null
                    },
                shape = RoundedCornerShape(50),
                colors =
                    FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.secondary.copy(alpha = 0.18f),
                        selectedLabelColor = MaterialTheme.colorScheme.secondary,
                        selectedLeadingIconColor = MaterialTheme.colorScheme.secondary,
                    ),
            )
        }
    }
}

@Composable
private fun FeatureCards(
    onOpenLocalVideos: () -> Unit,
    onOpenOfflineGuide: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        FeatureCard(
            title = stringResource(R.string.home_local_card_title),
            body = stringResource(R.string.home_local_card_body),
            iconRes = R.drawable.ic_folder,
            onClick = onOpenLocalVideos,
        )
        FeatureCard(
            title = stringResource(R.string.home_offline_card_title),
            body = stringResource(R.string.home_offline_card_body),
            iconRes = R.drawable.ic_offline,
            onClick = onOpenOfflineGuide,
        )
    }
}

@Composable
private fun FeatureCard(
    title: String,
    body: String,
    iconRes: Int,
    onClick: () -> Unit,
) {
    val gradient =
        Brush.linearGradient(
            colors =
                listOf(
                    MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.85f),
                    MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.55f),
                ),
        )
    Row(
        modifier =
            Modifier
                .width(300.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(gradient)
                .clickable(onClick = onClick)
                .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(id = iconRes),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.size(26.dp),
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
            )
        }
    }
}
