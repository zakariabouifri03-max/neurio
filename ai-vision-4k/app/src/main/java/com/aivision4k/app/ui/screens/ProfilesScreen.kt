package com.aivision4k.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aivision4k.app.AppViewModel
import com.aivision4k.app.UiState
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AccentViolet
import com.aivision4k.app.ui.Hint
import com.aivision4k.app.ui.MetricRow
import com.aivision4k.app.ui.PanelCard
import com.aivision4k.app.ui.SelectChips
import com.aivision4k.app.ui.SliderRow
import com.aivision4k.app.ui.StatusChip
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.TextPrimary
import com.aivision4k.app.ui.ToggleRow
import com.aivision4k.app.ui.WarnAmber
import com.aivision4k.app.ui.resolutionArrow
import com.aivision4k.sdk.ProfilePresetOption
import com.aivision4k.sdk.ReconstructionMode
import com.aivision4k.sdk.UpscalingQuality

private val OUTPUT_RESOLUTIONS = listOf(
    "720p" to (1280 to 720),
    "900p" to (1600 to 900),
    "1080p" to (1920 to 1080),
    "1440p" to (2560 to 1440),
    "4K" to (3840 to 2160),
)

private val RENDER_SCALES = listOf(50, 60, 67, 75, 83, 100)
private val FRAME_TARGETS = listOf(0, 30, 45, 60, 90, 120, 144)

@Composable
fun ProfilesScreen(vm: AppViewModel) {
    val state = vm.state
    val profile = state.profile

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PanelCard(title = "Presets tuned for this device", accent = AccentViolet) {
                if (state.presets.isEmpty()) {
                    Text(
                        text = "The engine reports no presets yet. They appear once it has probed the device.",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted,
                    )
                } else {
                    Text(
                        text = "Presets come from the engine and are already clamped to what this device can " +
                            "sustain: a preset that had to be reduced says so.",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                    )
                }
            }
        }
        items(state.presets, key = { it.preset.code }) { option ->
            PresetCard(option, onApply = { vm.applyPreset(option) })
        }
        item {
            PanelCard(title = "Manual profile", accent = AccentCyan) {
                if (profile == null) {
                    Text(
                        text = "No profile loaded. Select a game or apply a preset first.",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted,
                    )
                    return@PanelCard
                }
                MetricRow(
                    label = "Render \u2192 output",
                    value = resolutionArrow(profile.inputWidth, profile.inputHeight, profile.outputWidth, profile.outputHeight),
                    accent = AccentCyan,
                )
                MetricRow("Applied to", profile.gameTitle.ifEmpty { "global profile" })
                Spacer(Modifier.height(10.dp))

                Text("Output resolution", style = MaterialTheme.typography.labelMedium, color = TextMuted)
                Spacer(Modifier.height(6.dp))
                SelectChips(
                    options = OUTPUT_RESOLUTIONS.map { it.first },
                    selectedIndex = OUTPUT_RESOLUTIONS.indexOfFirst {
                        it.second.first == profile.outputWidth && it.second.second == profile.outputHeight
                    },
                    onSelect = { index ->
                        val (width, height) = OUTPUT_RESOLUTIONS[index].second
                        vm.setOutputResolution(width, height)
                    },
                )
                Spacer(Modifier.height(12.dp))

                Text("Render scale (what the game draws)", style = MaterialTheme.typography.labelMedium, color = TextMuted)
                Spacer(Modifier.height(6.dp))
                SelectChips(
                    options = RENDER_SCALES.map { "$it%" },
                    selectedIndex = RENDER_SCALES.indexOf(profile.renderScalePercent),
                    onSelect = { vm.setRenderScale(RENDER_SCALES[it]) },
                )
                Spacer(Modifier.height(12.dp))

                Text("AI quality", style = MaterialTheme.typography.labelMedium, color = TextMuted)
                Spacer(Modifier.height(6.dp))
                val qualities = listOf(
                    UpscalingQuality.Off,
                    UpscalingQuality.Low,
                    UpscalingQuality.Medium,
                    UpscalingQuality.High,
                    UpscalingQuality.Ultra,
                )
                SelectChips(
                    options = qualities.map { it.label },
                    selectedIndex = qualities.indexOf(profile.aiQuality),
                    onSelect = { vm.setQuality(qualities[it]) },
                )
                Hint(
                    "The engine caps this at ${state.compatibility?.maximumAiQuality?.label ?: "the device maximum"}; " +
                        "a stronger setting is reported back as clamped rather than silently ignored.",
                )
                Spacer(Modifier.height(12.dp))

                SliderRow(
                    title = "Sharpening",
                    value = profile.sharpening,
                    valueLabel = "${(profile.sharpening * 100).toInt()} %",
                    range = 0f..1f,
                    steps = 9,
                    onValueChange = { vm.setSharpening((it * 100).toInt()) },
                )
                SliderRow(
                    title = "Noise reduction",
                    value = profile.noiseReduction,
                    valueLabel = "${(profile.noiseReduction * 100).toInt()} %",
                    range = 0f..1f,
                    steps = 9,
                    onValueChange = { vm.setNoiseReduction((it * 100).toInt()) },
                )
                Spacer(Modifier.height(8.dp))

                Text("Frame-rate target", style = MaterialTheme.typography.labelMedium, color = TextMuted)
                Spacer(Modifier.height(6.dp))
                SelectChips(
                    options = FRAME_TARGETS.map { if (it == 0) "Unlimited" else "$it" },
                    selectedIndex = FRAME_TARGETS.indexOf(profile.targetFps),
                    onSelect = { vm.setTargetFps(FRAME_TARGETS[it]) },
                )
                Hint("The limiter is the engine's own pacing for AI Vision work; it is not a system-wide FPS cap.")
                Spacer(Modifier.height(12.dp))

                ToggleRow(
                    title = "AI upscaling",
                    subtitle = "Master switch for the neural stage",
                    checked = profile.aiUpscaling,
                    onCheckedChange = { vm.setAiEnabled(it) },
                )
                ToggleRow(
                    title = "Anti-aliasing",
                    subtitle = "Resolve pass after reconstruction",
                    checked = profile.antiAliasing,
                    onCheckedChange = { vm.setAntiAliasing(it) },
                )
                ToggleRow(
                    title = "Motion-aware reconstruction",
                    subtitle = "Use motion vectors when the renderer provides them",
                    checked = profile.motionAware,
                    onCheckedChange = { vm.setMotionAware(it) },
                )
                ToggleRow(
                    title = "Dynamic resolution scaling",
                    subtitle = "Let the engine trade resolution for a stable frame time",
                    checked = profile.dynamicResolution,
                    onCheckedChange = { vm.setDynamicResolution(it) },
                )
                ToggleRow(
                    title = "Performance mode",
                    subtitle = "Favour frame rate over the strongest AI model",
                    checked = profile.performanceMode,
                    onCheckedChange = { vm.setPerformanceMode(it) },
                )
                ToggleRow(
                    title = "Battery mode",
                    subtitle = "Lower output resolution and quality, stop when the battery is warm",
                    checked = profile.batteryMode,
                    onCheckedChange = { vm.setBatteryMode(it) },
                )
                ToggleRow(
                    title = "Thermal guard",
                    subtitle = "Reduce AI quality and output resolution before the device throttles",
                    checked = profile.thermalGuard,
                    onCheckedChange = { vm.setThermalGuard(it) },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { vm.resetProfileForSelectedGame() }) {
                    Text("Reset to the recommended profile")
                }
            }
        }
        item {
            PanelCard(title = "Preset definitions", accent = AccentViolet) {
                MetricRow("Quality", "High AI quality, largest output")
                MetricRow("Balanced", "Medium AI quality, 1080p\u20131440p")
                MetricRow("Performance", "Low AI quality, frame rate first")
                MetricRow("Extreme", "Experimental: 4K output, maximum quality", accent = WarnAmber)
                Hint("Extreme is marked experimental because it depends on a flagship-tier memory budget and will be clamped on smaller devices.")
            }
        }
    }
}

@Composable
private fun PresetCard(option: ProfilePresetOption, onApply: () -> Unit) {
    PanelCard(
        title = option.preset.label,
        accent = if (option.experimental) WarnAmber else AccentCyan,
    ) {
        Text(
            text = option.preset.description,
            style = MaterialTheme.typography.labelSmall,
            color = TextMuted,
        )
        Spacer(Modifier.height(8.dp))
        MetricRow("Render scale", "${option.renderScalePercent} %")
        MetricRow(
            label = "Output",
            value = option.outputLabel.ifEmpty { "${option.outputWidth}x${option.outputHeight}" },
            accent = AccentCyan,
        )
        MetricRow("AI quality", option.aiQuality.label)
        MetricRow("Sharpening", "${option.sharpeningPercent} %")
        MetricRow("Frame target", if (option.targetFps > 0) "${option.targetFps} FPS" else "unlimited")
        val mode = option.profile.let { profile ->
            when {
                !profile.aiUpscaling -> ReconstructionMode.Analytical
                profile.motionAware -> ReconstructionMode.NeuralTemporal
                else -> ReconstructionMode.Neural
            }
        }
        MetricRow("Reconstruction", mode.label)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onApply) {
                Text("Apply", fontWeight = FontWeight.SemiBold)
            }
            if (option.experimental) StatusChip(text = "EXPERIMENTAL", color = WarnAmber)
            if (option.clampedForThisDevice) StatusChip(text = "CLAMPED FOR THIS DEVICE", color = AccentViolet)
        }
    }
}
