package com.aivision4k.app.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aivision4k.app.AppViewModel
import com.aivision4k.app.UiState
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AccentViolet
import com.aivision4k.app.ui.Hint
import com.aivision4k.app.ui.MetricRow
import com.aivision4k.app.ui.PanelCard
import com.aivision4k.app.ui.SDK_SAMPLE
import com.aivision4k.app.ui.SandboxExplainer
import com.aivision4k.app.ui.SelectChips
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.ToggleRow
import com.aivision4k.app.ui.bytes
import com.aivision4k.sdk.IntegrationKind

private val INTEGRATIONS = listOf(
    IntegrationKind.None,
    IntegrationKind.SdkIntegrated,
    IntegrationKind.SampleDemo,
    IntegrationKind.ScreenEnhance,
)

@Composable
fun SettingsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state = vm.state
    val context = LocalContext.current
    val version = remember {
        runCatching {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: "1.0.0"
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text(
                    text = "Settings",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = AccentCyan,
                    modifier = Modifier.weight(1f),
                )
                OutlinedButton(onClick = onBack) { Text("Close") }
            }
        }
        item {
            PanelCard(title = "How this app presents itself", accent = AccentViolet) {
                SelectChips(
                    options = INTEGRATIONS.map { it.name },
                    selectedIndex = INTEGRATIONS.indexOf(state.integration),
                    onSelect = { vm.setIntegration(INTEGRATIONS[it]) },
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = integrationDescription(state.integration),
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                )
                Hint(
                    "This only tells the engine which relationship it is in. It cannot conjure access to " +
                        "another app's pipeline: the supported path stays a game linking the SDK.",
                )
            }
        }
        item {
            PanelCard(title = "Monitoring", accent = AccentCyan) {
                ToggleRow(
                    title = "Background monitoring service",
                    subtitle = "Thermal guard and readings behind a game",
                    checked = state.monitorEnabled,
                    onCheckedChange = { vm.setMonitorEnabled(it) },
                )
                ToggleRow(
                    title = "Metrics overlay",
                    subtitle = "Requires the \u201cdraw over other apps\u201d permission",
                    checked = state.overlayVisible,
                    onCheckedChange = { vm.setOverlayEnabled(it) },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { vm.reprobeDevice() }) { Text("Re-read device capabilities") }
                Hint("Useful after a display, battery or driver change; the engine re-probes and re-runs the compatibility rules.")
            }
        }
        item {
            PanelCard(title = "Android limitations \u00b7 the full explanation") {
                SandboxExplainer()
            }
        }
        item {
            PanelCard(title = "For game developers", accent = AccentViolet) {
                Text(
                    text = SDK_SAMPLE.trim(),
                    style = MaterialTheme.typography.labelSmall,
                    color = AccentCyan,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                )
            }
        }
        item { DevicePanel(state) }
        item {
            PanelCard(title = "About") {
                MetricRow("Application", "AI Vision 4K")
                MetricRow("Version", version)
                MetricRow("Engine", state.snapshot?.engineVersion?.ifEmpty { "\u2014" } ?: "\u2014")
                MetricRow("Engine library", "libaivision4k.so")
                MetricRow("Native ABIs", "arm64-v8a, x86_64")
                MetricRow("Build", if (state.engineReady) "native engine loaded" else "engine offline")
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "No telemetry, no account, no server: this build talks to no network endpoint at all. " +
                        "Model downloads would be the only network feature and none is configured.",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                )
            }
        }
    }
}

@Composable
private fun DevicePanel(state: UiState) {
    val device = state.device ?: return
    PanelCard(title = "Device report") {
        MetricRow("Description", device.description.ifEmpty { "\u2014" })
        MetricRow("SoC", device.socModel.ifEmpty { "\u2014" })
        MetricRow("Manufacturer", device.socManufacturer.ifEmpty { "\u2014" })
        MetricRow("Android", "${device.sdkInt} (${device.release})")
        MetricRow("CPU cores", "${device.cpuCoreCount}")
        MetricRow("Arm64 ABI", if (device.totalRamBytes > 0) "reported" else "\u2014")
        MetricRow("Total RAM", bytes(device.totalRamBytes))
        MetricRow("Low-RAM device", if (device.lowRamDevice) "yes" else "no")
        MetricRow("Emulator", if (device.isEmulator) "yes" else "no")
        MetricRow("HDR display", if (device.displayRefreshRate > 0f) "reported" else "\u2014")
        MetricRow("Refresh rate", "${device.displayRefreshRate} Hz")
        MetricRow("Display", "${device.displayWidth}x${device.displayHeight}")
        MetricRow("Battery temperature", if (device.batteryTemperatureAvailable) "readable" else "not readable")
    }
}

private fun integrationDescription(kind: IntegrationKind): String = when (kind) {
    IntegrationKind.None ->
        "Third-party application. The engine measures, advises and applies its own thermal policy, and " +
            "reports in-pipeline upscaling as unsupported for games it cannot touch."
    IntegrationKind.SdkIntegrated ->
        "A game that links the AIUpscaler SDK. This is the only configuration in which the engine can " +
            "replace a render resolution, because the game hands over its own Vulkan device."
    IntegrationKind.SampleDemo ->
        "The bundled Vulkan demo / comparison harness. Marked experimental until the demo host ships in " +
            "this build."
    IntegrationKind.ScreenEnhance ->
        "MediaProjection frame enhancement: experimental, needs an explicit consent prompt per session, " +
            "and it cannot change a game's render resolution \u2014 it can only re-scale the composited frames. " +
            "Latency and DRM-protected surfaces make it unsuitable for competitive play."
}
