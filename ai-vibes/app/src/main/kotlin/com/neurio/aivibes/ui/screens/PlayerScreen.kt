package com.neurio.aivibes.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.AppViewModel
import com.neurio.aivibes.ui.components.GlowPanel
import com.neurio.aivibes.ui.components.NeonSlider
import com.neurio.aivibes.ui.components.StatusPill
import com.neurio.aivibes.ui.theme.VibeColors
import kotlinx.coroutines.delay

/** Full now-playing screen with transport, seek and engine status. */
@Composable
fun PlayerScreen(vm: AppViewModel) {
    val nowPlaying by vm.nowPlaying.collectAsState()
    val headphones by vm.headphones.collectAsState()
    val viz by vm.viz.collectAsState()

    // Local seekbar position, refreshed while playing.
    var position by remember { mutableLongStateOf(0L) }
    LaunchedEffect(nowPlaying.track?.id, nowPlaying.isPlaying) {
        while (true) {
            position = nowPlaying.positionMs
            if (!nowPlaying.isPlaying) break
            delay(500)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(28.dp))

        // Artwork / neon disc.
        Box(
            modifier = Modifier
                .size(260.dp)
                .shadow(24.dp, CircleShape, spotColor = VibeColors.Purple.copy(alpha = 0.5f))
                .clip(CircleShape)
                .background(Brush.sweepGradient(listOf(VibeColors.Purple, VibeColors.Blue, VibeColors.Cyan, VibeColors.Purple))),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .size(210.dp)
                    .clip(CircleShape)
                    .background(VibeColors.Black),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Filled.MusicNote,
                    contentDescription = null,
                    tint = VibeColors.Cyan,
                    modifier = Modifier.size(64.dp)
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        Text(
            nowPlaying.track?.title ?: "Nothing playing",
            style = MaterialTheme.typography.headlineMedium,
            color = VibeColors.White,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center
        )
        Text(
            nowPlaying.track?.artist ?: "Choose a song from your library",
            style = MaterialTheme.typography.bodyLarge,
            color = VibeColors.Muted
        )

        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatusPill(headphones.label, headphones.connected)
            StatusPill("DSP on", true, VibeColors.Purple)
        }

        Spacer(Modifier.height(20.dp))
        NeonSlider(
            value = position.toFloat().coerceAtMost(nowPlaying.durationMs.coerceAtLeast(1).toFloat()),
            onValueChange = {
                position = it.toLong()
                vm.seekTo(it.toLong())
            },
            valueRange = 0f..nowPlaying.durationMs.coerceAtLeast(1).toFloat(),
            accent = VibeColors.Cyan
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(formatMs(position), style = MaterialTheme.typography.labelSmall, color = VibeColors.Muted)
            Text(formatMs(nowPlaying.durationMs), style = MaterialTheme.typography.labelSmall, color = VibeColors.Muted)
        }

        Spacer(Modifier.height(16.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(28.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = { vm.previous() }, modifier = Modifier.size(56.dp)) {
                Icon(
                    Icons.Filled.SkipPrevious,
                    contentDescription = "Previous",
                    tint = VibeColors.White,
                    modifier = Modifier.size(38.dp)
                )
            }
            Box(
                modifier = Modifier
                    .size(78.dp)
                    .shadow(16.dp, CircleShape, spotColor = VibeColors.Cyan.copy(alpha = 0.6f))
                    .clip(CircleShape)
                    .background(Brush.linearGradient(listOf(VibeColors.Purple, VibeColors.Blue))),
                contentAlignment = Alignment.Center
            ) {
                IconButton(onClick = { vm.togglePlayPause() }) {
                    Icon(
                        if (nowPlaying.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = "Play/Pause",
                        tint = VibeColors.White,
                        modifier = Modifier.size(42.dp)
                    )
                }
            }
            IconButton(onClick = { vm.next() }, modifier = Modifier.size(56.dp)) {
                Icon(
                    Icons.Filled.SkipNext,
                    contentDescription = "Next",
                    tint = VibeColors.White,
                    modifier = Modifier.size(38.dp)
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Text(
                    "Processing chain",
                    style = MaterialTheme.typography.titleMedium,
                    color = VibeColors.White,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "EQ → Bass → Clarity → Spatial → Dynamics → Limiter",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Cyan
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Every effect above is applied in real time to the audio you " +
                        "hear from the in-app player.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
        }
        Spacer(Modifier.height(28.dp))
    }
}

private fun formatMs(ms: Long): String {
    val totalSec = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(totalSec / 60, totalSec % 60)
}
