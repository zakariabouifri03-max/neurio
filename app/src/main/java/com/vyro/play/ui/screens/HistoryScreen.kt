package com.vyro.play.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PauseCircleOutline
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import com.vyro.play.model.WatchHistoryItem
import com.vyro.play.model.WatchSourceType
import com.vyro.play.ui.components.WatchHistoryRowCard
import com.vyro.play.ui.theme.VyroCyanAccent
import com.vyro.play.ui.theme.VyroPurpleDeep
import com.vyro.play.ui.theme.VyroPurplePrimary

private enum class HistorySourceFilter(val label: String) {
    ALL("All Watched"),
    YOUTUBE("YouTube"),
    LOCAL("Local Files")
}

@Composable
fun HistoryScreen(
    watchHistory: List<WatchHistoryItem>,
    pauseWatchHistory: Boolean,
    onTogglePauseHistory: (Boolean) -> Unit,
    onResumeItem: (WatchHistoryItem) -> Unit,
    onDeleteItem: (String) -> Unit,
    onClearAllHistory: () -> Unit,
    modifier: Modifier = Modifier
) {
    var searchFilter by remember { mutableStateOf("") }
    var sourceFilter by remember { mutableStateOf(HistorySourceFilter.ALL) }
    var showClearDialog by remember { mutableStateOf(false) }

    val filteredHistory = remember(watchHistory, searchFilter, sourceFilter) {
        watchHistory.filter { item ->
            val matchesSource = when (sourceFilter) {
                HistorySourceFilter.ALL -> true
                HistorySourceFilter.YOUTUBE -> item.sourceType == WatchSourceType.YOUTUBE
                HistorySourceFilter.LOCAL -> item.sourceType == WatchSourceType.LOCAL
            }
            val matchesText = searchFilter.isBlank() ||
                item.title.contains(searchFilter.trim(), ignoreCase = true) ||
                item.channelOrFolder.contains(searchFilter.trim(), ignoreCase = true)
            matchesSource && matchesText
        }
    }

    Column(modifier = modifier.fillMaxSize()) {
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
                        text = "Watch History (${watchHistory.size})",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        text = "Resume YouTube & local videos from where you left off",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                if (watchHistory.isNotEmpty()) {
                    IconButton(onClick = { showClearDialog = true }) {
                        Icon(
                            imageVector = Icons.Default.DeleteSweep,
                            contentDescription = "Clear watch history",
                            tint = VyroCyanAccent
                        )
                    }
                }
            }

            // Pause Watch History Toggle Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.PauseCircleOutline,
                        contentDescription = null,
                        tint = VyroCyanAccent
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Pause Watch History",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = if (pauseWatchHistory) "New videos will not be recorded" else "Recording playback positions locally",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = pauseWatchHistory,
                        onCheckedChange = onTogglePauseHistory,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = VyroCyanAccent,
                            checkedTrackColor = VyroPurpleDeep
                        )
                    )
                }
            }

            if (watchHistory.isNotEmpty()) {
                OutlinedTextField(
                    value = searchFilter,
                    onValueChange = { searchFilter = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Search watch history...") },
                    leadingIcon = {
                        Icon(Icons.Default.Search, contentDescription = null, tint = VyroCyanAccent)
                    },
                    trailingIcon = {
                        if (searchFilter.isNotEmpty()) {
                            IconButton(onClick = { searchFilter = "" }) {
                                Icon(Icons.Default.Clear, contentDescription = "Clear search")
                            }
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp)
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HistorySourceFilter.entries.forEach { option ->
                        val selected = sourceFilter == option
                        FilterChip(
                            selected = selected,
                            onClick = { sourceFilter = option },
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

        if (filteredHistory.isEmpty()) {
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
                        imageVector = Icons.Default.History,
                        contentDescription = null,
                        tint = VyroCyanAccent,
                        modifier = Modifier.size(56.dp)
                    )
                    Text(
                        text = if (watchHistory.isEmpty()) "No Watch History Yet" else "No Matching History",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        text = "Videos you play on YouTube or from your local offline library will appear here with automatic resume progress.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(
                    items = filteredHistory,
                    key = { it.id },
                    contentType = { "watch_history_row" }
                ) { item ->
                    WatchHistoryRowCard(
                        item = item,
                        onResumeClick = { onResumeItem(item) },
                        onDeleteClick = { onDeleteItem(item.id) }
                    )
                }
            }
        }
    }

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = { Text("Clear Watch History?") },
            text = { Text("This will permanently remove all local watch history entries and saved resume timestamps.") },
            confirmButton = {
                Button(
                    onClick = {
                        showClearDialog = false
                        onClearAllHistory()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = VyroPurplePrimary)
                ) {
                    Text("Clear History")
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
