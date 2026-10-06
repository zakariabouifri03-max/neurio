package com.aivision4k.app.ui.screens

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aivision4k.app.AppViewModel
import com.aivision4k.app.UiState
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AccentViolet
import com.aivision4k.app.ui.DASH
import com.aivision4k.app.ui.DangerRed
import com.aivision4k.app.ui.GoodGreen
import com.aivision4k.app.ui.Hint
import com.aivision4k.app.ui.MetricRow
import com.aivision4k.app.ui.PanelCard
import com.aivision4k.app.ui.SandboxExplainer
import com.aivision4k.app.ui.StatTile
import com.aivision4k.app.ui.StatusChip
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.TextPrimary
import com.aivision4k.app.ui.WarnAmber
import com.aivision4k.app.ui.bytes
import com.aivision4k.app.ui.compatColor
import com.aivision4k.app.ui.fmt
import com.aivision4k.app.ui.loadColor
import com.aivision4k.app.ui.percent
import com.aivision4k.app.ui.resolutionArrow
import com.aivision4k.app.ui.resolutionName
import com.aivision4k.app.ui.thermalColor

@Composable
fun DashboardScreen(
    vm: AppViewModel,
    onOpenBenchmark: () -> Unit,
    onOpenProfiles: () -> Unit,
    onOpenGames: () -> Unit,
) {
    val state = vm.state
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { UpscalingHero(vm, state, onOpenGames) }
        item { LiveStats(state) }
        item { CompatibilityCard(state) }
        item { DeviceCard(state) }
        item {
            PanelCard(title = "Benchmark", accent = AccentViolet) {
                Text(
                    text = "Measure this app's real frame cadence, the thermal response and whether the " +
                        "device holds its refresh rate. The in-game \u201cnative vs AI upscaling\u201d comparison runs " +
                        "in the Vulkan demo host, which hands a real renderer's device to the engine.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = onOpenBenchmark) { Text("Open benchmark") }
            }
        }
        item {
            PanelCard(title = "Android limits \u00b7 read this") {
                SandboxExplainer()
            }
        }
    }
}

@Composable
private fun UpscalingHero(vm: AppViewModel, state: UiState, onOpenGames: () -> Unit) {
    val profile = state.profile
    PanelCard(title = "AI upscaling", accent = AccentCyan) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = when {
                        !state.engineReady -> "Engine offline"
                        profile?.aiUpscaling == true -> "AI upscaling ON"
                        else -> "AI upscaling OFF"
                    },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = if (profile?.aiUpscaling == true) AccentCyan else TextMuted,
                )
                Text(
                    text = profile?.aiQuality?.label?.let { "AI quality: $it" } ?: "no profile loaded",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                )
            }
            Switch(
                checked = profile?.aiUpscaling == true,
                onCheckedChange = { vm.setAiEnabled(it) },
                enabled = state.engineReady && profile != null,
            )
        }
        Spacer(Modifier.height(12.dp))
        if (profile != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StatusChip(
                    text = resolutionArrow(
                        profile.inputWidth,
                        profile.inputHeight,
                        profile.outputWidth,
                        profile.outputHeight,
                    ),
                    color = AccentCyan,
                )
                StatusChip(text = "${profile.renderScalePercent}% render scale", color = TextMuted)
            }
            Spacer(Modifier.height(6.dp))
            MetricRow("Profile", profile.name.ifEmpty { profile.id })
            MetricRow("Sharpening", "${(profile.sharpening * 100).toInt()} %")
            MetricRow("Frame-rate target", if (profile.targetFps > 0) "${profile.targetFps} FPS" else "unlimited")
            MetricRow("Anti-aliasing", if (profile.antiAliasing) "on" else "off")
            MetricRow("Temporal / motion aware", if (profile.motionAware) "on" else "off")
            MetricRow("Dynamic resolution", if (profile.dynamicResolution) "on" else "off")
        } else {
            Hint("The engine has no profile yet. Open Profiles to build one.")
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = state.selectedTitle.ifEmpty { "No game selected" },
                    style = MaterialTheme.typography.bodyLarge,
                    color = TextPrimary,
                )
                Text(
                    text = state.selectedPackage.ifEmpty { "pick one in Games" },
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                )
            }
            OutlinedButton(onClick = onOpenGames) { Text("Change") }
        }
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { vm.launchSelectedGame() },
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = AccentCyan,
                contentColor = Color(0xFF001318),
            ),
            enabled = state.selectedPackage.isNotEmpty(),
        ) {
            Text("START GAME", fontWeight = FontWeight.Bold)
        }
        Hint("Launching a game cannot change how that game renders. The monitoring overlay and the thermal guard keep running in the background.")
    }
}

@Composable
private fun LiveStats(state: UiState) {
    val snapshot = state.snapshot
    PanelCard(title = "Live \u00b7 this app and the device", accent = GoodGreen) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(
                label = "FPS",
                value = snapshot?.fps?.let { fmt(it, 0) } ?: DASH,
                modifier = Modifier.weight(1f),
                accent = AccentCyan,
                footnote = "app render loop",
            )
            StatTile(
                label = "Frame time",
                value = snapshot?.frameTimeMs?.let { fmt(it, 1) } ?: DASH,
                unit = "ms",
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(
                label = "GPU busy",
                value = snapshot?.gpuBusyFraction?.let { percent(it) } ?: DASH,
                modifier = Modifier.weight(1f),
                accent = loadColor(snapshot?.gpuBusyFraction),
                footnote = snapshot?.gpuBusyLabel ?: "AI Vision passes",
            )
            StatTile(
                label = "Battery temp",
                value = snapshot?.batteryTempC?.let { fmt(it, 1) } ?: DASH,
                unit = "\u00b0C",
                modifier = Modifier.weight(1f),
                footnote = if (snapshot?.socTempC == null) "SoC temp not exposed by Android" else null,
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(
                label = "CPU load",
                value = snapshot?.cpuLoadFraction?.let { percent(it) } ?: DASH,
                modifier = Modifier.weight(1f),
                accent = loadColor(snapshot?.cpuLoadFraction),
                footnote = "all cores, /proc/stat",
            )
            StatTile(
                label = "RAM used",
                value = snapshot?.ramUsedFraction?.let { percent(it) } ?: DASH,
                modifier = Modifier.weight(1f),
                footnote = snapshot?.ramTotalBytes?.takeIf { it > 0 }?.let { bytes(it) + " total" },
            )
        }
        Spacer(Modifier.height(10.dp))
        val thermal = snapshot?.thermalLevel
        MetricRow(
            label = "Thermal level",
            value = thermal?.label ?: DASH,
            accent = if (thermal != null) thermalColor(thermal) else TextMuted,
        )
        MetricRow(label = "AI processing", value = snapshot?.aiProcessingMs?.let { fmt(it, 2, " ms") } ?: DASH)
        MetricRow(
            label = "Upscaling mode",
            value = snapshot?.session?.let { session ->
                if (session.active) session.mode.label else "idle"
            } ?: "idle",
        )
        if (snapshot != null && snapshot.note.isNotEmpty()) {
            Hint(snapshot.note)
        }
        Hint("Every value above is measured on this device. A field the platform refuses to report stays \u201c$DASH\u201d instead of turning into a zero.")
    }
}

@Composable
private fun CompatibilityCard(state: UiState) {
    val compatibility = state.compatibility ?: return
    var expanded by remember { mutableStateOf(false) }
    PanelCard(title = "Compatibility", accent = compatColor(compatibility.status)) {
        Text(
            text = compatibility.headline.ifEmpty { compatibility.status.label },
            style = MaterialTheme.typography.bodyMedium,
            color = TextPrimary,
        )
        Spacer(Modifier.height(8.dp))
        MetricRow("Status", compatibility.status.label, accent = compatColor(compatibility.status))
        MetricRow("Device tier", compatibility.tier.name)
        MetricRow("Recommended output", compatibility.recommendedOutputLabel.ifEmpty {
            resolutionName(compatibility.recommendedOutputWidth, compatibility.recommendedOutputHeight)
        })
        MetricRow("Recommended render scale", "${compatibility.recommendedRenderScalePercent} %")
        MetricRow("Maximum AI quality", compatibility.maximumAiQuality.label)
        MetricRow("Best achievable path", compatibility.achievableMode.name)
        MetricRow("Inference backend", compatibility.achievableBackend.name)
        MetricRow("Monitoring", if (compatibility.monitoringAvailable) "available" else "not available")
        MetricRow("Metrics overlay", if (compatibility.overlayAvailable) "available" else "not available")
        Spacer(Modifier.height(6.dp))
        OutlinedButton(onClick = { expanded = !expanded }) {
            Text(if (expanded) "Hide the reasons" else "Why? Show every reason (${compatibility.reasons.size})")
        }
        if (expanded) {
            Spacer(Modifier.height(8.dp))
            compatibility.reasons.forEach { reason ->
                val color = compatColor(reason.cap)
                Column(modifier = Modifier.padding(vertical = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        StatusChip(
                            text = if (reason.blocking) "BLOCKING" else reason.cap.label.uppercase(),
                            color = if (reason.blocking) DangerRed else color,
                        )
                    }
                    Text(
                        text = reason.message,
                        style = MaterialTheme.typography.bodySmall,
                        color = TextPrimary,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    if (reason.detail.isNotEmpty()) {
                        Text(
                            text = reason.detail,
                            style = MaterialTheme.typography.labelSmall,
                            color = TextMuted,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DeviceCard(state: UiState) {
    val device = state.device ?: return
    PanelCard(title = "Device", accent = AccentViolet) {
        MetricRow("SoC", device.socModel.ifEmpty { device.description.ifEmpty { "not reported" } })
        MetricRow("Vulkan", if (device.vulkanAvailable) "available" else "unavailable")
        MetricRow("GPU", "${device.vendor} ${device.deviceName}".trim().ifEmpty { DASH })
        MetricRow("Driver", device.driverName.ifEmpty { DASH })
        MetricRow("Vulkan API", "${device.apiVersionMajor}.${device.apiVersionMinor}")
        MetricRow("Compute queue", if (device.hasComputeQueue) "yes" else "no")
        MetricRow("Max workgroup", "${device.maxComputeWorkGroupInvocations}")
        MetricRow("Max image dimension", "${device.maxImageDimension2D} px")
        MetricRow("Device-local memory", bytes(device.deviceLocalMemoryBytes))
        MetricRow("Memory budget", bytes(device.memoryBudgetBytes))
        MetricRow("FP16 storage", if (device.hasFloat16Storage) "supported" else "not supported")
        MetricRow("INT8 storage", if (device.hasInt8Storage) "supported" else "not supported")
        MetricRow("GPU timestamps", if (device.hasTimestampCompute) "supported" else "not supported")
        MetricRow("GLES", if (device.glesAvailable) device.glesVersion else "unavailable")
        MetricRow("GLES compute shaders", if (device.glesComputeShaders) "yes" else "no")
        MetricRow("NNAPI", if (device.nnapiAvailable) "present" else "absent")
        MetricRow("NNAPI accelerator", if (device.nnapiHasAccelerator) "reported" else "not reported")
        MetricRow("Thermal API", if (device.thermalApiAvailable) "available" else "unavailable")
        MetricRow("Game mode hints", if (device.gameManagerAvailable) "available" else "unavailable")
        if (device.nnapiNote.isNotEmpty()) Hint(device.nnapiNote)
        if (device.softwareRenderer) {
            Hint("Software renderer detected (emulator or a device without a real GPU driver): AI upscaling is not offered.", accent = WarnAmber)
        }
    }
}
