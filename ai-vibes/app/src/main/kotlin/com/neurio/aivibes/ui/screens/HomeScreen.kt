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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Waves
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.AppViewModel
import com.neurio.aivibes.ui.components.GlowPanel
import com.neurio.aivibes.ui.components.NeonChip
import com.neurio.aivibes.ui.components.SectionTitle
import com.neurio.aivibes.ui.components.StatusPill
import com.neurio.aivibes.ui.components.Viz
import com.neurio.aivibes.ui.theme.VibeColors
import com.neurio.aivibes.settings.Presets

/** Dashboard: status, mini visualizer, quick presets, navigation tiles. */
@Composable
fun HomeScreen(
    vm: AppViewModel,
    onOpenStudio: () -> Unit,
    onOpenVisualizer: () -> Unit,
    onOpenHeadphones: () -> Unit,
    onOpenPlayer: () -> Unit
) {
    val headphones by vm.headphones.collectAsState()
    val nowPlaying by vm.nowPlaying.collectAsState()
    val viz by vm.viz.collectAsState()
    val activePreset by vm.activePresetId.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
    ) {
        Spacer(Modifier.height(20.dp))
        Text("AI VIBES", style = MaterialTheme.typography.headlineMedium, color = VibeColors.White)
        Text(
            "Premium headphone audio, on-device",
            style = MaterialTheme.typography.bodyMedium,
            color = VibeColors.Muted
        )

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            StatusPill(headphones.label, headphones.connected)
            StatusPill("Engine active", true, VibeColors.Purple)
        }

        Spacer(Modifier.height(18.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                SectionTitle("Live spectrum", "Real processed audio — not a mock")
                Spacer(Modifier.height(12.dp))
                Viz.SpectrumBars(snap = viz, height = 120.dp)
            }
        }

        Spacer(Modifier.height(18.dp))
        GlowPanel(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onOpenPlayer() }
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Brush.linearGradient(listOf(VibeColors.Purple, VibeColors.Blue))),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = VibeColors.White)
                }
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        nowPlaying.track?.title ?: "Nothing playing",
                        style = MaterialTheme.typography.titleMedium,
                        color = VibeColors.White
                    )
                    Text(
                        nowPlaying.track?.artist ?: "Pick a track from your library",
                        style = MaterialTheme.typography.bodyMedium,
                        color = VibeColors.Muted
                    )
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        SectionTitle("Quick presets")
        Spacer(Modifier.height(10.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(Presets.factory) { preset ->
                NeonChip(
                    text = preset.name,
                    selected = preset.id == activePreset,
                    onClick = { vm.applyPreset(preset) }
                )
            }
        }

        Spacer(Modifier.height(18.dp))
        SectionTitle("Explore")
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HomeTile("Studio", Icons.Filled.Tune, "EQ · Bass · Space", Modifier.weight(1f), onOpenStudio)
            HomeTile("Visualizer", Icons.Filled.GraphicEq, "3 neon modes", Modifier.weight(1f), onOpenVisualizer)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HomeTile("Headphones", Icons.Filled.Headphones, "Per-device presets", Modifier.weight(1f), onOpenHeadphones)
            HomeTile("Spatial", Icons.Filled.Waves, "Width & crossfeed", Modifier.weight(1f), onOpenStudio)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun HomeTile(
    title: String,
    icon: ImageVector,
    subtitle: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    GlowPanel(modifier = modifier.clickable { onClick() }) {
        Column {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF1E1E36)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = title, tint = VibeColors.Cyan)
            }
            Spacer(Modifier.height(10.dp))
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                color = VibeColors.White,
                fontWeight = FontWeight.Bold
            )
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = VibeColors.Muted)
        }
    }
}
