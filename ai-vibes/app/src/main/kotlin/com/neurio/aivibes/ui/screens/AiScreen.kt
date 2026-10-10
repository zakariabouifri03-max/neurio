package com.neurio.aivibes.ui.screens

import androidx.compose.foundation.layout.Arrangement
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
import com.neurio.aivibes.ui.components.NeonButton
import com.neurio.aivibes.ui.components.SectionTitle
import com.neurio.aivibes.ui.theme.VibeColors

/**
 * AI Sound Enhancement. Everything shown here maps to a real, implemented
 * function (see SmartSound.kt): live spectrum analysis, tonal-balance
 * measurement and gentle on-device correction. No exaggerated claims.
 */
@Composable
fun AiScreen(vm: AppViewModel) {
    val smart by vm.smart.collectAsState()
    val config by vm.config.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
    ) {
        Spacer(Modifier.height(18.dp))
        SectionTitle("AI sound enhancement", "On-device analysis of what you actually play")
        Spacer(Modifier.height(12.dp))

        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Text(
                    "Smart Match",
                    style = MaterialTheme.typography.titleLarge,
                    color = VibeColors.White,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Measures the live spectrum of the current track — bass / mid / " +
                        "treble energy — then recommends the closest profile and applies " +
                        "gentle corrections (max ±3 dB per band).",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MetricChip("Bass", smart.bassShare, Modifier.weight(1f))
                    MetricChip("Mids", smart.midShare, Modifier.weight(1f))
                    MetricChip("Highs", smart.trebleShare, Modifier.weight(1f))
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    smart.explanation,
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Cyan
                )
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NeonButton("Analyse now", modifier = Modifier.weight(1f)) { vm.analyzeNow() }
                    NeonButton("Apply smart match", modifier = Modifier.weight(1f)) { vm.runSmartMatch() }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Text(
                    "Clarity & tonal balance",
                    style = MaterialTheme.typography.titleLarge,
                    color = VibeColors.White,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Independent presence and tilt controls live in Studio → Spatial " +
                        "and Studio → EQ. Current clarity: ${(config.clarity * 100).toInt()}%, " +
                        "tilt: ${"%.2f".format(config.tilt)}.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Text(
                    "How “AI” works here",
                    style = MaterialTheme.typography.titleLarge,
                    color = VibeColors.White,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Smart Match is signal analysis plus an on-device statistical " +
                        "controller — not a cloud model and not a neural network. We " +
                        "only claim what the code does: FFT measurement, target-curve " +
                        "comparison and bounded correction. Everything runs offline.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun MetricChip(label: String, share: Float, modifier: Modifier = Modifier) {
    GlowPanel(modifier = modifier) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = VibeColors.Muted)
            Text(
                "${(share * 100).toInt()}%",
                style = MaterialTheme.typography.titleLarge,
                color = VibeColors.White,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
