package com.vyro.play.feature.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SearchBar
import androidx.compose.material3.SearchBarDefaults
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vyro.core.model.Outcome
import com.vyro.core.model.SearchQuery
import com.vyro.core.model.Video
import com.vyro.play.R
import com.vyro.play.ui.components.EmptyState
import com.vyro.play.ui.components.ErrorState
import com.vyro.play.ui.components.LoadingSkeletonList
import com.vyro.play.ui.components.VideoRowCard
import com.vyro.play.ui.components.errorBody
import com.vyro.play.ui.components.errorTitle
import com.vyro.play.ui.components.isRetryable

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    onVideoClick: (Video) -> Unit,
    modifier: Modifier = Modifier,
    initialQuery: String = "",
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var expanded by rememberSaveable { mutableStateOf(initialQuery.isNotEmpty()) }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(initialQuery) {
        if (initialQuery.isNotBlank()) viewModel.submit(initialQuery, remember = false)
    }

    Column(modifier = modifier.fillMaxSize()) {
        SearchBar(
            query = state.query,
            onQueryChange = viewModel::onQueryChange,
            onSearch = { text ->
                viewModel.submit(text)
                expanded = false
            },
            active = expanded,
            onActiveChange = { expanded = it },
            modifier =
                Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester)
                    .padding(horizontal = if (expanded) 0.dp else 16.dp)
                    .padding(top = if (expanded) 0.dp else 8.dp),
            placeholder = {
                Text(
                    text = stringResource(R.string.search_placeholder),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
            leadingIcon = {
                Icon(
                    painter = painterResource(id = R.drawable.ic_search),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            },
            trailingIcon = {
                if (state.query.isNotEmpty()) {
                    IconButton(onClick = { viewModel.onQueryChange("") }) {
                        Icon(
                            painter = painterResource(id = R.drawable.ic_close),
                            contentDescription = stringResource(R.string.cd_clear_query),
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            },
            colors =
                SearchBarDefaults.colors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    dividerColor = MaterialTheme.colorScheme.outline,
                ),
        ) {
            SuggestionsPane(
                suggestions = state.suggestions,
                rememberHistory = state.rememberHistory,
                onSuggestionClick = { entry ->
                    viewModel.onQueryChange(entry.text)
                    viewModel.submit(entry.text)
                    expanded = false
                },
                onRemove = viewModel::removeHistoryEntry,
                onClearAll = viewModel::clearHistory,
            )
        }

        if (!expanded) {
            ResultsPane(
                state = state,
                onVideoClick = onVideoClick,
                onFavoriteClick = viewModel::toggleFavorite,
                onRetry = viewModel::retry,
                onLoadMore = viewModel::loadMore,
                onVisibleIndexChanged = viewModel::onVisibleIndexChanged,
            )
        }
    }
}

@Composable
private fun SuggestionsPane(
    suggestions: List<SearchQuery>,
    rememberHistory: Boolean,
    onSuggestionClick: (SearchQuery) -> Unit,
    onRemove: (SearchQuery) -> Unit,
    onClearAll: () -> Unit,
) {
    if (!rememberHistory) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 18.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(
                text = stringResource(R.string.search_history_disabled),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    if (suggestions.isEmpty()) return

    LazyColumn(modifier = Modifier.fillMaxWidth()) {
        item {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = stringResource(R.string.search_recent),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = onClearAll) {
                    Text(
                        text = stringResource(R.string.search_clear_recent),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }
        }
        items(items = suggestions, key = { it.text }) { entry ->
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable { onSuggestionClick(entry) }
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    painter = painterResource(id = R.drawable.ic_history),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
                Column(modifier = Modifier.weight(1f).padding(horizontal = 14.dp)) {
                    Text(
                        text = entry.text,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (entry.useCount > 1) {
                        Text(
                            text = "${entry.useCount} searches",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                IconButton(onClick = { onRemove(entry) }) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_close),
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ResultsPane(
    state: SearchUiState,
    onVideoClick: (Video) -> Unit,
    onFavoriteClick: (Video) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onVisibleIndexChanged: (Int) -> Unit,
) {
    when (val results = state.results) {
        Outcome.Loading ->
            if (state.submittedQuery.isBlank()) {
                SearchIdleState()
            } else {
                LoadingSkeletonList()
            }

        is Outcome.Failure ->
            ErrorState(
                title = errorTitle(results.error),
                body = errorBody(results.error),
                onRetry = if (isRetryable(results.error)) onRetry else null,
            )

        is Outcome.Success ->
            if (results.data.isEmpty()) {
                EmptyState(
                    title = stringResource(R.string.search_no_results_title, state.submittedQuery),
                    body = stringResource(R.string.search_no_results_body),
                    iconRes = R.drawable.ic_search,
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 24.dp),
                ) {
                    if (state.submittedQuery.isNotBlank()) {
                        item {
                            Text(
                                text = stringResource(R.string.search_result_count, results.data.size.toString()),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                            )
                        }
                    }
                    itemsIndexed(
                        items = results.data,
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
                    item {
                        when {
                            state.isAppending -> {
                                Box(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 20.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(28.dp),
                                        strokeWidth = 2.dp,
                                        color = MaterialTheme.colorScheme.secondary,
                                    )
                                }
                            }

                            !state.endReached -> {
                                LaunchedEffect(Unit) { onLoadMore() }
                            }
                        }
                    }
                }
            }
    }
}

@Composable
private fun SearchIdleState() {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(horizontal = 40.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            painter = painterResource(id = R.drawable.ic_search),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.secondary,
            modifier = Modifier.size(44.dp),
        )
        androidx.compose.foundation.layout.Spacer(modifier = Modifier.size(16.dp))
        Text(
            text = stringResource(R.string.search_empty_title),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        androidx.compose.foundation.layout.Spacer(modifier = Modifier.size(6.dp))
        Text(
            text = stringResource(R.string.search_empty_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
