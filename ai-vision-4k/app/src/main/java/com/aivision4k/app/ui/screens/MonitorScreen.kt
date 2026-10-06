package com.aivision4k.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aivision4k.app.AppViewModel
import com.aivision4k.app.UiState
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AccentViolet
import com.aivision4k.app.ui.BarSparkline
import com.aivision4k.app.ui.DASH
import com.aivision4k.app.ui.GoodGreen
import com.aivision4k.app.ui.Hint
import com.aivision4k.app.ui.MetricRow
import com.aivision4k.app.ui.PanelCard
import com.aivision4k.app.ui.StatTile
import com.aivision4k.app.ui.StatusChip
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.ToggleRow
import com.aivision4k.app.ui.WarnAmber
import com.aivision4k.app.ui.bytes
import com.aivision4k.app.ui.fmt
import com.aivision4k.app.ui.loadColor
import com.aivision4k.app.ui.percent
import com.aivision4k.app.ui.thermalColor

@Composable
fun MonitorScreen(vm: AppViewModel) {
    val state = vm.state
    val snapshot = state.snapshot
    val metrics = state.metrics

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PanelCard(title = "Session", accent = AccentCyan) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(
                        label = "FPS",
                        value = snapshot?.fps?.let { fmt(it, 0) } ?: DASH,
                        modifier = Modifier.weight(1f),
                        accent = AccentCyan,
                    )
                    StatTile(
                        label = "Average",
                        value = snapshot?.averageFps?.let { fmt(it, 0) } ?: DASH,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(
                        label = "1% low",
                        value = snapshot?.onePercentLowFps?.let { fmt(it, 0) } ?: DASH,
                        modifier = Modifier.weight(1f),
                        accent = WarnAmber,
                    )
                    StatTile(
                        label = "Frame time",
                        value = snapshot?.frameTimeMs?.let { fmt(it, 2) } ?: DASH,
                        unit = "ms",
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(10.dp))
                MetricRow("Jitter (\u03c3)", snapshot?.jitterMs?.let { fmt(it, 2, " ms") } ?: DASH)
                MetricRow("Worst frame", snapshot?.worstFrameMs?.let { fmt(it, 2, " ms") } ?: DASH)
                MetricRow("AI processing", snapshot?.aiProcessingMs?.let { fmt(it, 2, " ms") } ?: DASH)
                MetricRow("AI stages total", snapshot?.aiStageTotalMs?.let { fmt(it, 2, " ms") } ?: DASH)
                MetricRow(
                    label = snapshot?.gpuBusyLabel ?: "GPU busy",
                    value = snapshot?.gpuBusyMs?.let { fmt(it, 2, " ms") } ?: DASH,
                )
                MetricRow(
                    label = "GPU utilisation",
                    value = snapshot?.gpuBusyFraction?.let { percent(it) } ?: DASH,
                    accent = loadColor(snapshot?.gpuBusyFraction),
                )
                MetricRow("CPU load", snapshot?.cpuLoadFraction?.let { percent(it) } ?: DASH)
                MetricRow("RAM used", snapshot?.ramUsedFraction?.let { percent(it) } ?: DASH)
                MetricRow("RAM total", bytes(snapshot?.ramTotalBytes ?: 0L))
            }
        }
        item {
            PanelCard(title = "Frame times \u00b7 newest 48 samples", accent = AccentViolet) {
                BarSparkline(values = metrics?.frameTimesMs ?: emptyList())
                Hint(
                    "Samples come from the app's own render loop; the engine computes the averages " +
                        "(frameCount = ${metrics?.frameCount ?: 0}).",
                )
            }
        }
        item {
            PanelCard(title = "CPU-side stage timers") {
                val stages = metrics?.stages.orEmpty()
                if (stages.isEmpty()) {
                    Text(
                        text = "No samples yet. The table fills when a session processes frames.",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted,
                    )
                } else {
                    rows(stages.map { it.stage }, stages.map { it.lastUs }, stages.map { it.emaUs })
                }
                Hint("last / EMA in milliseconds. \u201c$DASH\u201d means the stage has not run yet.")
            }
        }
        item {
            PanelCard(title = "GPU stage timings") {
                val timings = metrics?.gpuTimings
                if (timings == null || !timings.available) {
                    Text(
                        text = "Not reported. GPU timestamps require a device that exposes timestamp queries " +
                            "on a compute queue; when it does not, the engine reports no number instead of " +
                            "estimating one.",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted,
                    )
                } else {
                    MetricRow("Preprocess", timings.preprocessMs?.let { fmt(it, 3, " ms") } ?: DASH)
                    MetricRow("Neural", timings.neuralMs?.let { fmt(it, 3, " ms") } ?: DASH)
                    MetricRow("Denoise", timings.denoiseMs?.let { fmt(it, 3, " ms") } ?: DASH)
                    MetricRow("Temporal", timings.temporalMs?.let { fmt(it, 3, " ms") } ?: DASH)
                    MetricRow("Anti-aliasing", timings.aaMs?.let { fmt(it, 3, " ms") } ?: DASH)
                    MetricRow("Sharpening", timings.sharpenMs?.let { fmt(it, 3, " ms") } ?: DASH)
                    MetricRow("Total", timings.totalMs?.let { fmt(it, 3, " ms") } ?: DASH, accent = AccentCyan)
                    if (!timings.countersAvailable) {
                        Hint("Per-stage counters are unavailable on this driver, so only the total is meaningful.")
                    }
                }
            }
        }
        item { ThermalGovernorPanel(state) }
        item {
            PanelCard(title = "Monitoring while you play", accent = GoodGreen) {
                ToggleRow(
                    title = "Background monitoring service",
                    subtitle = "Keeps the thermal guard and the readings alive behind a game",
                    checked = state.monitorEnabled,
                    onCheckedChange = { vm.setMonitorEnabled(it) },
                )
                ToggleRow(
                    title = "On-screen metrics overlay",
                    subtitle = "Draws the readings over another app (needs the overlay permission)",
                    checked = state.overlayVisible,
                    onCheckedChange = { vm.setOverlayEnabled(it) },
                )
                Hint(
                    "The overlay can only draw. While another app is in front this process receives no frames, " +
                        "so the overlay shows thermal, CPU and memory figures \u2014 never an invented FPS.",
                )
            }
        }
    }
}

@Composable
private fun rows(stageNames: List<String>, last: List<Double?>, ema: List<Double?>) {
    Column {
        stageNames.forEachIndexed { index, name ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                MetricRow(
                    label = name,
                    value = "last ${micro(last.getOrNull(index))}   \u00b7   ema ${micro(ema.getOrNull(index))}",
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

private fun micro(microseconds: Double?): String =
    if (microseconds == null || microseconds < 0.0) DASH else String.format(java.util.Locale.US, "%.2f ms", microseconds / 1000.0)

@Composable
private fun ThermalGovernorPanel(state: UiState) {
    val snapshot = state.snapshot
    val level = snapshot?.thermalLevel
    PanelCard(title = "Thermal safety", accent = if (level != null) thermalColor(level) else TextMuted) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (level != null) {
                StatusChip(text = level.label.uppercase(), color = thermalColor(level))
            }
        }
        Spacer(Modifier.height(8.dp))
        MetricRow(
            label = "Battery temperature",
            value = snapshot?.batteryTempC?.let { fmt(it, 1, " \u00b0C") } ?: DASH,
        )
        MetricRow(
            label = "SoC temperature",
            value = snapshot?.socTempC?.let { fmt(it, 1, " \u00b0C") } ?: DASH,
        )
        MetricRow("Platform thermal status", if ((snapshot?.platformThermalStatus ?: -1) >= 0) "${snapshot?.platformThermalStatus}" else DASH)
        if (snapshot?.socTempC == null) {
            Hint("Android exposes no SoC temperature to applications. This field stays empty by design rather than being filled with the battery value.")
        }
        Spacer(Modifier.height(6.dp))
        if (snapshot != null && snapshot.governorReason.isNotEmpty()) {
            Text(
                text = snapshot.governorReason,
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted,
            )
        }
        if (snapshot != null && snapshot.governorActions.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            snapshot.governorActions.forEach { action ->
                Text(
                    text = "\u2022  $action",
                    style = MaterialTheme.typography.bodySmall,
                    color = WarnAmber,
                )
            }
        } else {
            Spacer(Modifier.height(6.dp))
            Text(
                text = "The governor is idle: temperatures are inside the safe band, so nothing is being reduced.",
                style = MaterialTheme.typography.bodySmall,
                color = GoodGreen,
            )
        }
        Hint("Quality steps down before the device throttles: Ultra \u2192 High \u2192 Medium and 4K \u2192 1440p \u2192 1080p, one step at a time, with hysteresis so it does not oscillate.")
    }
}
