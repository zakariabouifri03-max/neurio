package com.neurio.aivibes.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.AppViewModel
import com.neurio.aivibes.ui.components.GlowPanel
import com.neurio.aivibes.ui.components.NeonChip
import com.neurio.aivibes.ui.components.NeonSlider
import com.neurio.aivibes.ui.components.SectionTitle
import com.neurio.aivibes.ui.components.Viz
import com.neurio.aivibes.ui.theme.VibeColors

/**
 * Live Vibe Visualizer — three modes rendered from the real post-DSP spectrum.
 * Sensitivity scales the visual response; battery saver halves the analysis
 * rate (handled in the view-model polling loop).
 */
@Composable
fun VisualizerScreen(vm: AppViewModel) {
    val viz by vm.viz.collectAsState()
    val prefs by vm.prefs.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
    ) {
        Spacer(Modifier.height(18.dp))
        SectionTitle("Vibe visualizer", "Spectrum of the audio actually playing")
        Spacer(Modifier.height(12.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NeonChip("Spectrum", prefs.vizStyle == Viz.STYLE_SPECTRUM) {
                vm.saveViz(Viz.STYLE_SPECTRUM, prefs.vizSensitivity)
            }
            NeonChip("Circular", prefs.vizStyle == Viz.STYLE_CIRCULAR) {
                vm.saveViz(Viz.STYLE_CIRCULAR, prefs.vizSensitivity)
            }
            NeonChip("Neon pulse", prefs.vizStyle == Viz.STYLE_PULSE) {
                vm.saveViz(Viz.STYLE_PULSE, prefs.vizSensitivity)
            }
        }

        Spacer(Modifier.height(14.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                AnimatedContent(
                    targetState = prefs.vizStyle,
                    transitionSpec = { fadeIn() togetherWith fadeOut() },
                    label = "vizSwitch"
                ) { style ->
                    when (style) {
                        Viz.STYLE_CIRCULAR -> Viz.CircularWaves(snap = viz, height = 320.dp)
                        Viz.STYLE_PULSE -> Viz.NeonPulse(
                            snap = viz,
                            beatAtMs = com.neurio.aivibes.audio.AudioEngine.analyzer.lastBeatAtMs,
                            height = 320.dp
                        )
                        else -> Viz.SpectrumBars(snap = viz, height = 320.dp)
                    }
                }
            }
        }

        Spacer(Modifier.height(14.dp))
        if (viz.level <= 0.00001f) {
            GlowPanel(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Waiting for audio… The visualizer shows the real spectrum of " +
                        "tracks played inside AI VIBES — it goes quiet when nothing plays.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
        }

        Spacer(Modifier.height(14.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                NeonSlider(
                    value = prefs.vizSensitivity,
                    onValueChange = { v -> vm.saveViz(prefs.vizStyle, v) },
                    accent = VibeColors.Cyan,
                    label = "Visualizer sensitivity",
                    valueText = "${(prefs.vizSensitivity * 100).toInt()}%"
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Battery-efficient mode",
                            style = MaterialTheme.typography.titleMedium,
                            color = VibeColors.White,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "Halves the analysis rate (≈20 fps)",
                            style = MaterialTheme.typography.labelSmall,
                            color = VibeColors.Muted
                        )
                    }
                    NeonChip("On", prefs.batterySaver) { vm.saveBatterySaver(true) }
                    Spacer(Modifier.padding(4.dp))
                    NeonChip("Off", !prefs.batterySaver) { vm.saveBatterySaver(false) }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
