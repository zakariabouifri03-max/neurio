package com.neurio.aivibes.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.AppViewModel
import com.neurio.aivibes.playback.Playlist
import com.neurio.aivibes.playback.Track
import com.neurio.aivibes.ui.components.GlowPanel
import com.neurio.aivibes.ui.components.NeonButton
import com.neurio.aivibes.ui.components.SectionTitle
import com.neurio.aivibes.ui.theme.VibeColors

/** Music library: all local tracks + user playlists. */
@Composable
fun LibraryScreen(vm: AppViewModel) {
    val tracks by vm.tracks.collectAsState()
    val playlists by vm.playlists.collectAsState()
    var tab by remember { mutableIntStateOf(0) }

    Column(modifier = Modifier.fillMaxSize()) {
        TabRow(
            selectedTabIndex = tab,
            containerColor = VibeColors.Deep,
            contentColor = VibeColors.Cyan
        ) {
            listOf("Songs", "Playlists").forEachIndexed { i, name ->
                Tab(
                    selected = tab == i,
                    onClick = { tab = i },
                    text = {
                        Text(
                            name,
                            color = if (tab == i) VibeColors.Cyan else VibeColors.Muted,
                            style = MaterialTheme.typography.labelLarge
                        )
                    }
                )
            }
        }
        when {
            tracks.isEmpty() -> EmptyLibrary()
            tab == 0 -> LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
                item { Spacer(Modifier.height(16.dp)) }
                items(tracks) { track ->
                    TrackRow(track = track, onClick = { vm.playTrack(track) })
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
            else -> LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
                item { Spacer(Modifier.height(16.dp)) }
                item {
                    NeonButton(
                        text = "New playlist",
                        modifier = Modifier.fillMaxWidth()
                    ) { vm.createPlaylist("Playlist ${playlists.size + 1}") }
                    Spacer(Modifier.height(14.dp))
                }
                items(playlists) { pl ->
                    PlaylistRow(
                        playlist = pl,
                        trackCount = pl.trackIds.size,
                        onPlay = { vm.playPlaylist(pl) },
                        onDelete = { vm.deletePlaylist(pl.id) }
                    )
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun EmptyLibrary() {
    Box(modifier = Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                SectionTitle("No music found", null)
                Spacer(Modifier.height(10.dp))
                Text(
                    "AI VIBES plays the audio files stored on your phone. Grant the " +
                        "music permission (or add some songs) and they will appear here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
        }
    }
}

@Composable
private fun TrackRow(track: Track, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(46.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Brush.linearGradient(listOf(VibeColors.Purple.copy(alpha = 0.5f), VibeColors.Blue.copy(alpha = 0.5f)))),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Filled.MusicNote, contentDescription = null, tint = VibeColors.White)
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                track.title,
                style = MaterialTheme.typography.titleMedium,
                color = VibeColors.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                "${track.artist} · ${track.album}",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeColors.Muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Text(track.displayDuration, style = MaterialTheme.typography.labelSmall, color = VibeColors.Muted)
        Spacer(Modifier.width(4.dp))
        Icon(
            Icons.Filled.PlayArrow,
            contentDescription = "Play ${track.title}",
            tint = VibeColors.Cyan
        )
    }
}

@Composable
private fun PlaylistRow(
    playlist: Playlist,
    trackCount: Int,
    onPlay: () -> Unit,
    onDelete: () -> Unit
) {
    GlowPanel(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f).clickable { onPlay() }) {
                Text(
                    playlist.name,
                    style = MaterialTheme.typography.titleMedium,
                    color = VibeColors.White,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "$trackCount tracks",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
            IconButton(onClick = onPlay) {
                Icon(Icons.Filled.PlayArrow, contentDescription = "Play", tint = VibeColors.Cyan)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = VibeColors.Muted)
            }
        }
    }
}
