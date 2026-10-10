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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.AppViewModel
import com.neurio.aivibes.dsp.DspConfig
import com.neurio.aivibes.settings.Presets
import com.neurio.aivibes.ui.components.GlowPanel
import com.neurio.aivibes.ui.components.NeonChip
import com.neurio.aivibes.ui.components.NeonSlider
import com.neurio.aivibes.ui.components.SectionTitle
import com.neurio.aivibes.ui.components.ValueReadout
import com.neurio.aivibes.ui.components.VerticalFader
import com.neurio.aivibes.ui.theme.VibeColors

/**
 * The sound studio: professional 10-band EQ, Bass Studio, simulated spatial
 * processing and dynamics — each with live, persisted controls.
 */
@Composable
fun StudioScreen(vm: AppViewModel, initialTab: Int = 0) {
    var tab by remember { mutableIntStateOf(initialTab) }
    val config by vm.config.collectAsState()
    val activePreset by vm.activePresetId.collectAsState()

    Column(modifier = Modifier.fillMaxSize()) {
        TabRow(
            selectedTabIndex = tab,
            containerColor = VibeColors.Deep,
            contentColor = VibeColors.Cyan
        ) {
            listOf("EQ", "Bass", "Spatial", "Dynamics").forEachIndexed { i, name ->
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
        ) {
            when (tab) {
                0 -> EqTab(vm, config, activePreset)
                1 -> BassTab(vm, config)
                2 -> SpatialTab(vm, config)
                else -> DynamicsTab(vm, config)
            }
            Spacer(Modifier.height(28.dp))
        }
    }
}

// --------------------------------------------------------------------- EQ --
@Composable
private fun EqTab(vm: AppViewModel, config: DspConfig, activePreset: String) {
    Spacer(Modifier.height(18.dp))
    SectionTitle("10-band equalizer", "±12 dB per band · peaking filters")
    Spacer(Modifier.height(12.dp))

    GlowPanel(modifier = Modifier.fillMaxWidth()) {
        Column {
            NeonSlider(
                value = config.preampDb,
                onValueChange = { v -> vm.updateConfig { it.copy(preampDb = v) } },
                valueRange = -12f..12f,
                accent = VibeColors.Cyan,
                label = "Preamp",
                valueText = "%+.1f dB".format(config.preampDb)
            )
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(210.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                val labels = listOf("32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k")
                for (i in DspConfig.EQ_BANDS.indices) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        ValueReadout(
                            text = "%+.0f".format(config.eqGains[i]),
                            accent = if (config.eqGains[i] == 0f) VibeColors.Muted else VibeColors.Cyan
                        )
                        Spacer(Modifier.height(4.dp))
                        VerticalFader(
                            value = config.eqGains[i],
                            onValueChange = { v ->
                                vm.updateConfig { c ->
                                    val g = c.eqGains.copyOf()
                                    g[i] = v
                                    c.copyWithGains(g)
                                }
                            },
                            valueRange = -12f..12f,
                            accent = VibeColors.Purple
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(labels[i], style = MaterialTheme.typography.labelSmall, color = VibeColors.Muted)
                    }
                }
            }
        }
    }

    Spacer(Modifier.height(16.dp))
    SectionTitle("Presets")
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
}

// ------------------------------------------------------------------- BASS --
@Composable
private fun BassTab(vm: AppViewModel, config: DspConfig) {
    Spacer(Modifier.height(18.dp))
    SectionTitle("Bass Studio", "Low-shelf + sub-bass with anti-clip protection")
    Spacer(Modifier.height(12.dp))

    GlowPanel(modifier = Modifier.fillMaxWidth()) {
        Column {
            NeonSlider(
                value = config.bassIntensity,
                onValueChange = { v -> vm.updateConfig { it.copy(bassIntensity = v) } },
                accent = VibeColors.Purple,
                label = "Bass intensity",
                valueText = "${(config.bassIntensity * 100).toInt()}%"
            )
            Spacer(Modifier.height(8.dp))
            NeonSlider(
                value = config.bassFreq,
                onValueChange = { v -> vm.updateConfig { it.copy(bassFreq = v) } },
                valueRange = 40f..180f,
                accent = VibeColors.Blue,
                label = "Bass range (shelf corner)",
                valueText = "${config.bassFreq.toInt()} Hz"
            )
            Spacer(Modifier.height(8.dp))
            NeonSlider(
                value = config.subBass,
                onValueChange = { v -> vm.updateConfig { it.copy(subBass = v) } },
                accent = VibeColors.Cyan,
                label = "Sub-bass (38 Hz)",
                valueText = "${(config.subBass * 100).toInt()}%"
            )
            Spacer(Modifier.height(14.dp))
            Text(
                "The limiter stays on while you boost, so aggressive settings " +
                    "bend instead of clipping. Sub-bass only shows if your headphones " +
                    "can physically reproduce it — we never claim otherwise.",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeColors.Muted
            )
        }
    }
}

// ---------------------------------------------------------------- SPATIAL --
@Composable
private fun SpatialTab(vm: AppViewModel, config: DspConfig) {
    Spacer(Modifier.height(18.dp))
    SectionTitle("Spatial audio", "Simulated stereo widening — not hardware 3D")
    Spacer(Modifier.height(12.dp))

    GlowPanel(modifier = Modifier.fillMaxWidth()) {
        Column {
            NeonSlider(
                value = config.spatialWidth,
                onValueChange = { v -> vm.updateConfig { it.copy(spatialWidth = v) } },
                valueRange = 0f..2f,
                accent = VibeColors.Cyan,
                label = "Stereo width",
                valueText = "${(config.spatialWidth * 100).toInt()}%"
            )
            Spacer(Modifier.height(8.dp))
            NeonSlider(
                value = config.crossfeed,
                onValueChange = { v -> vm.updateConfig { it.copy(crossfeed = v) } },
                accent = VibeColors.Blue,
                label = "Headphone crossfeed",
                valueText = "${(config.crossfeed * 100).toInt()}%"
            )
            Spacer(Modifier.height(8.dp))
            NeonSlider(
                value = config.tilt,
                onValueChange = { v -> vm.updateConfig { it.copy(tilt = v) } },
                valueRange = -1f..1f,
                accent = VibeColors.Purple,
                label = "Tonal tilt (warm ↔ bright)",
                valueText = when {
                    config.tilt > 0.05f -> "+%.2f".format(config.tilt)
                    config.tilt < -0.05f -> "%.2f".format(config.tilt)
                    else -> "neutral"
                }
            )
            Spacer(Modifier.height(14.dp))
            Text(
                "Width uses mid/side processing on the app's own stereo stream. " +
                    "Crossfeed blends a little of each channel — a classic headphone " +
                    "technique for a more natural stage. True object-based spatial " +
                    "audio is a system/hardware feature we display but never fake.",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeColors.Muted
            )
        }
    }
}

// --------------------------------------------------------------- DYNAMICS --
@Composable
private fun DynamicsTab(vm: AppViewModel, config: DspConfig) {
    Spacer(Modifier.height(18.dp))
    SectionTitle("Dynamic audio", "Compression, loudness balance and a safety limiter")
    Spacer(Modifier.height(12.dp))

    GlowPanel(modifier = Modifier.fillMaxWidth()) {
        Column {
            NeonSlider(
                value = config.dynamics,
                onValueChange = { v -> vm.updateConfig { it.copy(dynamics = v) } },
                accent = VibeColors.Purple,
                label = "Dynamic control",
                valueText = "${(config.dynamics * 100).toInt()}%"
            )
            Spacer(Modifier.height(8.dp))
            NeonSlider(
                value = config.loudness,
                onValueChange = { v -> vm.updateConfig { it.copy(loudness = v) } },
                accent = VibeColors.Blue,
                label = "Loudness balancing",
                valueText = "${(config.loudness * 100).toInt()}%"
            )
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "Limiter (prevents clipping)",
                        style = MaterialTheme.typography.titleMedium,
                        color = VibeColors.White
                    )
                    Text(
                        "Ceiling at −1 dBFS with soft-clip",
                        style = MaterialTheme.typography.labelSmall,
                        color = VibeColors.Muted
                    )
                }
                Switch(
                    checked = config.limiterEnabled,
                    onCheckedChange = { v -> vm.updateConfig { it.copy(limiterEnabled = v) } },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = VibeColors.Cyan,
                        checkedTrackColor = VibeColors.Cyan.copy(alpha = 0.35f)
                    )
                )
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "Loudness balancing gently tracks the programme level toward " +
                    "about −18 dBFS so quiet and loud albums sit at similar comfort. " +
                    "Defaults are conservative; safe by design.",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeColors.Muted
            )
        }
    }

    Spacer(Modifier.height(16.dp))
    GlowPanel(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(44.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(VibeColors.Purple)
            )
            Spacer(Modifier.width(14.dp))
            Text(
                "Tip: keep the limiter ON when pushing bass hard — it's the " +
                    "difference between “huge” and “distorted”.",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeColors.Muted
            )
        }
    }
}
