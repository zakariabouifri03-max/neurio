package com.aivision4k.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aivision4k.app.AppViewModel
import com.aivision4k.app.UiState
import com.aivision4k.app.games.GameCatalog
import com.aivision4k.app.games.InstalledGame
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AccentViolet
import com.aivision4k.app.ui.Hint
import com.aivision4k.app.ui.MetricRow
import com.aivision4k.app.ui.PanelCard
import com.aivision4k.app.ui.SelectChips
import com.aivision4k.app.ui.StatusChip
import com.aivision4k.app.ui.SurfaceRaised
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.TextPrimary
import com.aivision4k.app.ui.resolutionArrow

@Composable
fun GamesScreen(vm: AppViewModel) {
    val state = vm.state
    var query by remember { mutableStateOf("") }
    var showAll by remember { mutableStateOf(false) }

    val visible = state.apps
        .filter { showAll || it.isGame }
        .filter {
            query.isEmpty() ||
                it.label.contains(query, ignoreCase = true) ||
                it.packageName.contains(query, ignoreCase = true)
        }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { SelectedGamePanel(vm, state) }
        item {
            PanelCard(title = "Installed applications", accent = AccentCyan) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("Search") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                SelectChips(
                    options = listOf("Games only", "All apps"),
                    selectedIndex = if (showAll) 1 else 0,
                    onSelect = { showAll = it == 1 },
                )
                Spacer(Modifier.height(8.dp))
                if (state.scanning) {
                    Hint("Reading the installed applications\u2026")
                } else {
                    Hint(
                        "${visible.size} shown \u00b7 the platform marks " +
                            "${state.apps.count { it.isGame }} of ${state.apps.size} as a game",
                    )
                }
            }
        }
        items(visible, key = { it.packageName }) { app ->
            AppRow(app, state, onSelect = { vm.selectGame(app.packageName, app.label) })
        }
        item {
            PanelCard(title = "How a profile is applied", accent = AccentViolet) {
                Text(
                    text = "A per-game profile is applied to the engine when you select the game here and when " +
                        "you start it from the dashboard. The engine exposes one active profile at a time; the " +
                        "app owns the library and writes it back on every change.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Suggested profiles in this screen are starting points for the sliders \u2014 they are " +
                        "not benchmark results for your device. The confirmation dialog you get when selecting a " +
                        "catalogue title says so too.",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                )
            }
        }
    }
}

@Composable
private fun SelectedGamePanel(vm: AppViewModel, state: UiState) {
    val profile = state.profile
    PanelCard(title = "Selected game", accent = AccentCyan) {
        if (state.selectedPackage.isEmpty()) {
            Text(
                text = "No game selected yet. Pick one from the list below to create its profile.",
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted,
            )
            return@PanelCard
        }
        Text(
            text = state.selectedTitle.ifEmpty { state.selectedPackage },
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary,
        )
        Text(
            text = state.selectedPackage,
            style = MaterialTheme.typography.labelSmall,
            color = TextMuted,
        )
        Spacer(Modifier.height(8.dp))
        val known = GameCatalog.match(state.selectedPackage, state.selectedTitle)
        if (known != null) {
            StatusChip(text = "Catalogue suggestion applied", color = AccentViolet)
            Spacer(Modifier.height(6.dp))
            Text(
                text = known.note,
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted,
            )
        } else {
            StatusChip(text = "Device-recommended profile", color = AccentCyan)
            Spacer(Modifier.height(6.dp))
            Text(
                text = "No catalogue entry for this title, so the profile comes from this device's tier and " +
                    "recommended resolution.",
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted,
            )
        }
        if (profile != null) {
            Spacer(Modifier.height(8.dp))
            MetricRow(
                label = "Resolution",
                value = resolutionArrow(profile.inputWidth, profile.inputHeight, profile.outputWidth, profile.outputHeight),
                accent = AccentCyan,
            )
            MetricRow("Render scale", "${profile.renderScalePercent} %")
            MetricRow("AI quality", profile.aiQuality.label)
            MetricRow("Sharpening", "${(profile.sharpening * 100).toInt()} %")
            MetricRow("Frame-rate target", if (profile.targetFps > 0) "${profile.targetFps} FPS" else "unlimited")
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = { vm.launchSelectedGame() }) { Text("Start") }
            OutlinedButton(onClick = { vm.resetProfileForSelectedGame() }) { Text("Reset profile") }
        }
    }
}

@Composable
private fun AppRow(app: InstalledGame, state: UiState, onSelect: () -> Unit) {
    val known = GameCatalog.match(app.packageName, app.label)
    val selected = app.packageName == state.selectedPackage
    PanelCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onSelect() },
        title = null,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = app.label,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (selected) AccentCyan else TextPrimary,
                )
                Text(
                    text = app.packageName,
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                )
            }
            if (app.isGame) StatusChip(text = "GAME", color = AccentCyan)
        }
        if (known != null) {
            Spacer(Modifier.height(6.dp))
            StatusChip(text = known.recommended.name, color = SurfaceRaised)
        }
    }
}
