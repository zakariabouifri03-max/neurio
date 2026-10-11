package com.vyro.play.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PlayCircleOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vyro.play.model.ApiErrorCode
import com.vyro.play.model.DiscoveryCategory
import com.vyro.play.model.SearchHistoryEntry
import com.vyro.play.model.YouTubeVideo
import com.vyro.play.ui.components.VyroVideoCard
import com.vyro.play.ui.components.VyroVideoCardSkeleton
import com.vyro.play.ui.theme.VyroCyanAccent
import com.vyro.play.ui.theme.VyroPurpleDeep
import com.vyro.play.ui.theme.VyroPurplePrimary

@Composable
fun ExploreScreen(
    searchQuery: String,
    activeCategory: DiscoveryCategory,
    videos: List<YouTubeVideo>,
    favoriteIds: Set<String>,
    searchHistory: List<SearchHistoryEntry>,
    isLoading: Boolean,
    isFromCache: Boolean,
    errorMessage: String?,
    errorCode: ApiErrorCode?,
    hasConfiguredApiKey: Boolean,
    onSearchQueryChange: (String) -> Unit,
    onExecuteSearch: (String) -> Unit,
    onSelectCategory: (DiscoveryCategory) -> Unit,
    onRefresh: () -> Unit,
    onPlayVideo: (YouTubeVideo) -> Unit,
    onPlayUrlOrId: (String) -> Unit,
    onToggleFavorite: (YouTubeVideo) -> Unit,
    onDeleteSearchHistory: (String) -> Unit,
    onClearSearchHistory: () -> Unit,
    onSaveApiKey: (String) -> Unit,
    onNavigateToSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    val focusManager = LocalFocusManager.current
    var showSearchHistoryDropdown by remember { mutableStateOf(false) }
    var showDirectUrlDialog by remember { mutableStateOf(false) }
    var showApiKeyQuickDialog by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxSize()) {
        // Search Bar + Direct URL / ID Action Row
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = {
                        onSearchQueryChange(it)
                        showSearchHistoryDropdown = true
                    },
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        Text(
                            text = "Search YouTube 4K videos, channels, or paste URL...",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = "Search",
                            tint = VyroCyanAccent
                        )
                    },
                    trailingIcon = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (searchQuery.isNotEmpty()) {
                                IconButton(
                                    onClick = {
                                        onSearchQueryChange("")
                                        showSearchHistoryDropdown = true
                                    }
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Clear,
                                        contentDescription = "Clear search",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            } else if (searchHistory.isNotEmpty()) {
                                IconButton(
                                    onClick = { showSearchHistoryDropdown = !showSearchHistoryDropdown }
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.History,
                                        contentDescription = "Toggle search history",
                                        tint = if (showSearchHistoryDropdown) VyroCyanAccent else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(
                        onSearch = {
                            showSearchHistoryDropdown = false
                            focusManager.clearFocus()
                            onExecuteSearch(searchQuery)
                        }
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = VyroCyanAccent,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline,
                        focusedContainerColor = MaterialTheme.colorScheme.surface,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surface
                    )
                )

                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = VyroPurpleDeep,
                    border = BorderStroke(1.dp, VyroCyanAccent.copy(alpha = 0.65f)),
                    modifier = Modifier.clickable { showDirectUrlDialog = true }
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Link,
                            contentDescription = "Play YouTube URL or Video ID",
                            tint = VyroCyanAccent,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "URL / ID",
                            style = MaterialTheme.typography.labelLarge,
                            color = Color.White
                        )
                    }
                }
            }

            // Expandable Search History Panel
            AnimatedVisibility(
                visible = showSearchHistoryDropdown && searchHistory.isNotEmpty(),
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                    border = BorderStroke(1.dp, VyroPurplePrimary.copy(alpha = 0.45f))
                ) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Recent Searches",
                                style = MaterialTheme.typography.labelLarge,
                                color = VyroCyanAccent
                            )
                            TextButton(
                                onClick = {
                                    onClearSearchHistory()
                                    showSearchHistoryDropdown = false
                                }
                            ) {
                                Text("Clear All", style = MaterialTheme.typography.labelMedium)
                            }
                        }

                        searchHistory.take(6).forEach { entry ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        showSearchHistoryDropdown = false
                                        focusManager.clearFocus()
                                        onSearchQueryChange(entry.query)
                                        onExecuteSearch(entry.query)
                                    }
                                    .padding(vertical = 6.dp, horizontal = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.History,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Text(
                                    text = entry.query,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.weight(1f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                IconButton(
                                    onClick = { onDeleteSearchHistory(entry.query) },
                                    modifier = Modifier.size(26.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Close,
                                        contentDescription = "Delete search item",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(15.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // Discovery Category Filter Chips + Refresh Button
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            items(
                items = DiscoveryCategory.entries,
                key = { it.id }
            ) { category ->
                val isSelected = activeCategory == category && searchQuery.isBlank()
                FilterChip(
                    selected = isSelected,
                    onClick = {
                        onSearchQueryChange("")
                        showSearchHistoryDropdown = false
                        onSelectCategory(category)
                    },
                    label = {
                        Text(
                            text = category.label,
                            style = MaterialTheme.typography.labelLarge
                        )
                    },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = VyroPurpleDeep,
                        selectedLabelColor = VyroCyanAccent,
                        containerColor = MaterialTheme.colorScheme.surface
                    ),
                    border = FilterChipDefaults.filterChipBorder(
                        enabled = true,
                        selected = isSelected,
                        selectedBorderColor = VyroCyanAccent,
                        borderColor = MaterialTheme.colorScheme.outline
                    )
                )
            }

            item(key = "refresh_button") {
                IconButton(onClick = onRefresh) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Refresh feed",
                        tint = VyroCyanAccent
                    )
                }
            }
        }

        // Main Responsive Video Grid (LazyVerticalGrid with stable keys & contentTypes)
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 310.dp),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // API Key Setup Card when no API key is configured yet
            if (!hasConfiguredApiKey || errorCode == ApiErrorCode.MISSING_API_KEY || errorCode == ApiErrorCode.INVALID_API_KEY) {
                item(
                    key = "api_key_setup_banner",
                    span = { GridItemSpan(maxLineSpan) },
                    contentType = "banner"
                ) {
                    ApiKeySetupCard(
                        errorMessage = errorMessage,
                        onOpenQuickKeyDialog = { showApiKeyQuickDialog = true },
                        onOpenDirectUrlDialog = { showDirectUrlDialog = true },
                        onNavigateToSettings = onNavigateToSettings
                    )
                }
            } else if (errorMessage != null && videos.isEmpty()) {
                item(
                    key = "error_state_banner",
                    span = { GridItemSpan(maxLineSpan) },
                    contentType = "error"
                ) {
                    ErrorRetryCard(
                        message = errorMessage,
                        onRetry = onRefresh,
                        onOpenDirectUrlDialog = { showDirectUrlDialog = true }
                    )
                }
            }

            if (isFromCache && videos.isNotEmpty()) {
                item(
                    key = "cache_notice",
                    span = { GridItemSpan(maxLineSpan) },
                    contentType = "notice"
                ) {
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = VyroPurpleDeep.copy(alpha = 0.45f),
                        border = BorderStroke(1.dp, VyroCyanAccent.copy(alpha = 0.4f))
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "Serving cached YouTube Data API v3 results (15-min quota policy).",
                                style = MaterialTheme.typography.bodySmall,
                                color = VyroCyanAccent,
                                modifier = Modifier.weight(1f)
                            )
                            TextButton(onClick = onRefresh) {
                                Text("Refresh Live", color = Color.White, style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                }
            }

            if (isLoading && videos.isEmpty()) {
                items(
                    count = 6,
                    key = { "skeleton_$it" },
                    contentType = { "skeleton" }
                ) {
                    VyroVideoCardSkeleton()
                }
            } else {
                items(
                    items = videos,
                    key = { it.id },
                    contentType = { "video_card" }
                ) { video ->
                    VyroVideoCard(
                        video = video,
                        isFavorite = favoriteIds.contains(video.id),
                        onPlayClick = { onPlayVideo(video) },
                        onFavoriteToggle = { onToggleFavorite(video) }
                    )
                }
            }
        }
    }

    // Direct YouTube URL / Video ID Playback Dialog
    if (showDirectUrlDialog) {
        var urlInput by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showDirectUrlDialog = false },
            containerColor = MaterialTheme.colorScheme.surface,
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.PlayCircleOutline, contentDescription = null, tint = VyroCyanAccent)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Play YouTube URL or Video ID")
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "Paste any official YouTube link (youtube.com/watch?v=..., youtu.be/..., shorts/...) or an 11-character Video ID to play immediately in the Official YouTube Player.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = urlInput,
                        onValueChange = { urlInput = it },
                        placeholder = { Text("https://www.youtube.com/watch?v=aqz-KE-bpKQ") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Text(
                        text = "Or test official 4K Ultra HD playback immediately with real YouTube streams:",
                        style = MaterialTheme.typography.labelMedium,
                        color = VyroCyanAccent
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                showDirectUrlDialog = false
                                onPlayUrlOrId("https://www.youtube.com/watch?v=LXb3EKWsInQ")
                            },
                            modifier = Modifier.weight(1f),
                            border = BorderStroke(1.dp, VyroCyanAccent.copy(alpha = 0.6f))
                        ) {
                            Text("Costa Rica 4K", style = MaterialTheme.typography.labelSmall)
                        }
                        OutlinedButton(
                            onClick = {
                                showDirectUrlDialog = false
                                onPlayUrlOrId("https://www.youtube.com/watch?v=aqz-KE-bpKQ")
                            },
                            modifier = Modifier.weight(1f),
                            border = BorderStroke(1.dp, VyroPurplePrimary.copy(alpha = 0.6f))
                        ) {
                            Text("Big Buck Bunny 4K", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (urlInput.isNotBlank()) {
                            showDirectUrlDialog = false
                            onPlayUrlOrId(urlInput)
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = VyroPurplePrimary)
                ) {
                    Text("Play Now")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDirectUrlDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Quick API Key Input Dialog
    if (showApiKeyQuickDialog) {
        var keyText by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showApiKeyQuickDialog = false },
            containerColor = MaterialTheme.colorScheme.surface,
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Key, contentDescription = null, tint = VyroCyanAccent)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Configure YouTube Data API v3 Key")
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "Enter your Google Cloud Console YouTube Data API v3 key. It is stored securely on your device using Android Jetpack DataStore and never hardcoded.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = keyText,
                        onValueChange = { keyText = it },
                        placeholder = { Text("AIzaSy...") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showApiKeyQuickDialog = false
                        onSaveApiKey(keyText)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = VyroPurplePrimary)
                ) {
                    Text("Save & Verify Key")
                }
            },
            dismissButton = {
                TextButton(onClick = { showApiKeyQuickDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun ApiKeySetupCard(
    errorMessage: String?,
    onOpenQuickKeyDialog: () -> Unit,
    onOpenDirectUrlDialog: () -> Unit,
    onNavigateToSettings: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        border = BorderStroke(1.5.dp, VyroCyanAccent.copy(alpha = 0.65f))
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = null,
                    tint = VyroCyanAccent
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Connect YouTube Data API v3",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold
                )
            }

            Text(
                text = errorMessage
                    ?: "VYRO PLAY uses real YouTube Data API v3 data rather than fake content, and never hardcodes private credentials. Enter your YouTube Data API v3 key to unlock live search & trending feeds, or play any YouTube URL/ID immediately.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Button(
                    onClick = onOpenQuickKeyDialog,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = VyroPurplePrimary,
                        contentColor = Color.White
                    ),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Key, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Enter API Key")
                }

                OutlinedButton(
                    onClick = onOpenDirectUrlDialog,
                    border = BorderStroke(1.dp, VyroCyanAccent),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        Icons.Default.PlayCircleOutline,
                        contentDescription = null,
                        tint = VyroCyanAccent,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Play URL / 4K Test", color = VyroCyanAccent)
                }
            }

            TextButton(
                onClick = onNavigateToSettings,
                modifier = Modifier.align(Alignment.End)
            ) {
                Text("View Full API Setup Instructions in Settings →", color = VyroCyanAccent)
            }
        }
    }
}

@Composable
private fun ErrorRetryCard(
    message: String,
    onRetry: () -> Unit,
    onOpenDirectUrlDialog: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.7f))
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.WarningAmber,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Unable to Load Feed",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = onRetry,
                    colors = ButtonDefaults.buttonColors(containerColor = VyroPurplePrimary)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Retry")
                }
                OutlinedButton(
                    onClick = onOpenDirectUrlDialog,
                    border = BorderStroke(1.dp, VyroCyanAccent)
                ) {
                    Text("Play Direct URL / ID", color = VyroCyanAccent)
                }
            }
        }
    }
}
