package com.vyro.play.ui.screens

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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vyro.play.model.YouTubeVideo
import com.vyro.play.ui.components.VyroVideoCard
import com.vyro.play.ui.theme.VyroCyanAccent
import com.vyro.play.ui.theme.VyroPurpleDeep
import com.vyro.play.ui.theme.VyroPurplePrimary

private enum class FavoriteSortFilter(val label: String) {
    RECENT("Recently Saved"),
    TITLE_AZ("Title A–Z"),
    ONLY_4K("4K Ultra HD")
}

@Composable
fun FavoritesScreen(
    favorites: List<YouTubeVideo>,
    onPlayVideo: (YouTubeVideo) -> Unit,
    onToggleFavorite: (YouTubeVideo) -> Unit,
    onClearAllFavorites: () -> Unit,
    modifier: Modifier = Modifier
) {
    var filterQuery by remember { mutableStateOf("") }
    var sortFilter by remember { mutableStateOf(FavoriteSortFilter.RECENT) }
    var showClearDialog by remember { mutableStateOf(false) }

    val displayedFavorites = remember(favorites, filterQuery, sortFilter) {
        val filtered = favorites.filter { video ->
            val matchesQuery = filterQuery.isBlank() ||
                video.title.contains(filterQuery.trim(), ignoreCase = true) ||
                video.channelTitle.contains(filterQuery.trim(), ignoreCase = true)
            val matches4K = sortFilter != FavoriteSortFilter.ONLY_4K || video.supports4KHint
            matchesQuery && matches4K
        }
        when (sortFilter) {
            FavoriteSortFilter.RECENT -> filtered
            FavoriteSortFilter.TITLE_AZ -> filtered.sortedBy { it.title.lowercase() }
            FavoriteSortFilter.ONLY_4K -> filtered
        }
    }

    Column(modifier = modifier.fillMaxSize()) {
        // Header + Search & Sort Controls
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Saved Favorites (${favorites.size})",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        text = "Persisted locally on your device via Room Database",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                if (favorites.isNotEmpty()) {
                    IconButton(onClick = { showClearDialog = true }) {
                        Icon(
                            imageVector = Icons.Default.DeleteSweep,
                            contentDescription = "Clear all favorites",
                            tint = VyroCyanAccent
                        )
                    }
                }
            }

            if (favorites.isNotEmpty()) {
                OutlinedTextField(
                    value = filterQuery,
                    onValueChange = { filterQuery = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Filter saved favorites by title or channel...") },
                    leadingIcon = {
                        Icon(Icons.Default.Search, contentDescription = null, tint = VyroCyanAccent)
                    },
                    trailingIcon = {
                        if (filterQuery.isNotEmpty()) {
                            IconButton(onClick = { filterQuery = "" }) {
                                Icon(Icons.Default.Clear, contentDescription = "Clear filter")
                            }
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp)
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FavoriteSortFilter.entries.forEach { option ->
                        val selected = sortFilter == option
                        FilterChip(
                            selected = selected,
                            onClick = { sortFilter = option },
                            label = { Text(option.label) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = VyroPurpleDeep,
                                selectedLabelColor = VyroCyanAccent
                            )
                        )
                    }
                }
            }
        }

        if (displayedFavorites.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.FavoriteBorder,
                        contentDescription = null,
                        tint = VyroCyanAccent,
                        modifier = Modifier.size(56.dp)
                    )
                    Text(
                        text = if (favorites.isEmpty()) "No Favorites Yet" else "No Matching Favorites",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        text = if (favorites.isEmpty()) {
                            "Tap the heart icon on any video card or in the player to bookmark your favorite videos for instant access."
                        } else {
                            "Try clearing your search filter or switching the sort chip above."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 310.dp),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(
                    items = displayedFavorites,
                    key = { it.id },
                    contentType = { "favorite_video" }
                ) { video ->
                    VyroVideoCard(
                        video = video,
                        isFavorite = true,
                        onPlayClick = { onPlayVideo(video) },
                        onFavoriteToggle = { onToggleFavorite(video) }
                    )
                }
            }
        }
    }

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = { Text("Clear All Favorites?") },
            text = { Text("This will remove all ${favorites.size} saved videos from your Favorites library.") },
            confirmButton = {
                Button(
                    onClick = {
                        showClearDialog = false
                        onClearAllFavorites()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = VyroPurplePrimary)
                ) {
                    Text("Clear All")
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}
