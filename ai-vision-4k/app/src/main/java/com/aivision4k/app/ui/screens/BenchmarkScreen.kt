package com.aivision4k.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aivision4k.app.AppViewModel
import com.aivision4k.app.UiState
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AccentViolet
import com.aivision4k.app.ui.DASH
import com.aivision4k.app.ui.GoodGreen
import com.aivision4k.app.ui.Hint
import com.aivision4k.app.ui.MetricRow
import com.aivision4k.app.ui.PanelCard
import com.aivision4k.app.ui.SelectChips
import com.aivision4k.app.ui.StatusChip
import com.aivision4k.app.ui.StrokeSoft
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.WarnAmber
import com.aivision4k.app.ui.fmt
import com.aivision4k.app.ui.loadColor
import com.aivision4k.app.ui.percent
import com.aivision4k.app.ui.seconds

@Composable
fun BenchmarkScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state = vm.state
    var duration by remember { mutableStateOf(30) }
    var phase by remember { mutableStateOf(0f) }

    // A deliberate render load: one recomposition and a moving bar per vsync, so
    // the cadence probe measures a busy loop rather than an idle screen.
    if (state.benchmarkRunning) {
        LaunchedEffect(Unit) {
            while (true) {
                withFrameNanos { }
                phase = (phase + 0.025f) % 1f
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PanelCard(title = "What this measures", accent = AccentViolet) {
                Text(
                    text = "A Choreographer-driven run of this app's own render loop. It reports the frame " +
                        "cadence Android actually granted this process: mean frame time, jitter, worst frame, " +
                        "the 1% low, and how the device's thermal state moves during the run.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "It is not a game benchmark and it does not measure the AI pipeline: an app cannot " +
                        "read another app's frame rate, and the \u201cnative vs AI upscaling\u201d comparison needs a " +
                        "renderer that hands its Vulkan device to the engine (the demo host). Nothing here is " +
                        "extrapolated into a number for a game you did not measure.",
                    style = MaterialTheme.typography.bodySmall,
                    color = WarnAmber,
                )
            }
        }
        item {
            PanelCard(title = "Run", accent = AccentCyan) {
                SelectChips(
                    options = listOf("15 s", "30 s", "60 s"),
                    selectedIndex = when (duration) {
                        15 -> 0
                        60 -> 2
                        else -> 1
                    },
                    onSelect = { duration = listOf(15, 30, 60)[it] },
                )
                Spacer(Modifier.height(12.dp))
                if (state.benchmarkRunning) {
                    Text(
                        text = "Running \u00b7 ${seconds(state.benchmarkElapsed)} \u00b7 ${state.benchmarkSamples} frames",
                        style = MaterialTheme.typography.bodyMedium,
                        color = AccentCyan,
                    )
                    Spacer(Modifier.height(8.dp))
                    PhaseBar(phase)
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(onClick = { vm.cancelBenchmark() }) { Text("Cancel") }
                } else {
                    Button(
                        onClick = { vm.startBenchmark(duration) },
                        enabled = state.engineReady,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = AccentCyan,
                            contentColor = Color(0xFF001318),
                        ),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text("Start $duration second run", fontWeight = FontWeight.SemiBold)
                    }
                    if (!state.engineReady) {
                        Hint("The engine is offline, so samples cannot be recorded.", accent = WarnAmber)
                    }
                }
            }
        }
        item { ResultPanel(state) }
        item { EngineViewPanel(state) }
        item {
            PanelCard(title = "Native vs AI upscaling") {
                Text(
                    text = "Not available in this build. That comparison needs the Vulkan demo host: a real " +
                        "renderer that draws a scene at a low resolution, hands its device to the engine, and " +
                        "measures presentation with and without the AI passes. Until that component is in the " +
                        "APK, this screen shows no number for it \u2014 an estimate would be a fabrication.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                )
            }
        }
        item { OutlinedButton(onClick = onBack) { Text("Back to the dashboard") } }
    }
}

@Composable
private fun PhaseBar(phase: Float) {
    val activeIndex = (phase * 16f).toInt().coerceIn(0, 15)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(8.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        repeat(16) { index ->
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(8.dp)
                    .background(
                        if (index == activeIndex) AccentCyan else StrokeSoft,
                        RoundedCornerShape(2.dp),
                    ),
            )
        }
    }
}

@Composable
private fun ResultPanel(state: UiState) {
    val result = state.benchmarkResult
    PanelCard(title = "Result", accent = GoodGreen) {
        if (result == null) {
            Text(
                text = "No run yet.",
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted,
            )
            return@PanelCard
        }
        if (result.samples == 0) {
            Text(
                text = "The run produced no frames \u2014 that itself is a measurement: the loop never got a vsync.",
                style = MaterialTheme.typography.bodySmall,
                color = WarnAmber,
            )
            return@PanelCard
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(text = "${result.samples} frames", color = AccentCyan)
            StatusChip(text = "${fmt(result.durationSeconds, 1, " s")}", color = TextMuted)
            StatusChip(text = "screen ${fmt(result.displayRefreshRate.toDouble(), 0, " Hz")}", color = TextMuted)
        }
        Spacer(Modifier.height(10.dp))
        MetricRow("Mean frame time", fmt(result.meanFrameMs, 2, " ms"), accent = AccentCyan)
        MetricRow("Mean frame rate", fmt(result.meanFps, 1, " FPS"))
        MetricRow("1% low", fmt(result.onePercentLowFps, 1, " FPS"), accent = loadColor(1.0 - result.onePercentLowFps / 120.0))
        MetricRow("Worst frame", fmt(result.worstFrameMs, 2, " ms"))
        MetricRow("Jitter (\u03c3)", fmt(result.jitterMs, 3, " ms"))
        Hint(
            "Compare the mean frame time with the screen's refresh interval: " +
                fmt(1000.0 / result.displayRefreshRate.coerceAtLeast(1f), 2, " ms") +
                " for one vsync at ${fmt(result.displayRefreshRate.toDouble(), 0)} Hz.",
        )
    }
}

@Composable
private fun EngineViewPanel(state: UiState) {
    val snapshot = state.snapshot ?: return
    PanelCard(title = "Engine view of the same samples") {
        MetricRow("Frames recorded", "${state.metrics?.frameCount ?: 0}")
        MetricRow("Engine FPS", snapshot.fps?.let { fmt(it, 1) } ?: DASH)
        MetricRow("Engine 1% low", snapshot.onePercentLowFps?.let { fmt(it, 1) } ?: DASH)
        MetricRow("Jitter", snapshot.jitterMs?.let { fmt(it, 2, " ms") } ?: DASH)
        MetricRow("Worst frame", snapshot.worstFrameMs?.let { fmt(it, 2, " ms") } ?: DASH)
        MetricRow("CPU load", snapshot.cpuLoadFraction?.let { percent(it) } ?: DASH)
        MetricRow("RAM used", snapshot.ramUsedFraction?.let { percent(it) } ?: DASH)
        MetricRow("Thermal level", snapshot.thermalLevel.label)
        MetricRow("Battery", snapshot.batteryTempC?.let { fmt(it, 1, " \u00b0C") } ?: DASH)
        Hint("These aggregates are computed by the native engine from the same samples the probe produced.")
    }
}
