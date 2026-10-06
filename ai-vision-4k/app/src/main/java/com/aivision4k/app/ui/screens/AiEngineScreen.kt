package com.aivision4k.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.aivision4k.app.AppViewModel
import com.aivision4k.app.UiState
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AccentViolet
import com.aivision4k.app.ui.Hint
import com.aivision4k.app.ui.MetricRow
import com.aivision4k.app.ui.PanelCard
import com.aivision4k.app.ui.SDK_SAMPLE
import com.aivision4k.app.ui.StatusChip
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.WarnAmber
import com.aivision4k.app.ui.bytes
import com.aivision4k.app.ui.fmt

@Composable
fun AiEngineScreen(vm: AppViewModel) {
    val state = vm.state
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.installModelFromUri(uri)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { EngineStatePanel(state) }
        item {
            PanelCard(title = "Model manager", accent = AccentViolet) {
                val model = state.model
                Text(
                    text = model?.displayName ?: "No model state yet",
                    style = MaterialTheme.typography.titleMedium,
                    color = if (model?.installed == true) AccentCyan else TextMuted,
                )
                Spacer(Modifier.height(8.dp))
                MetricRow("Preferred id", model?.preferredModelId?.ifEmpty { "\u2014" } ?: "\u2014")
                MetricRow("Installed id", model?.id?.ifEmpty { "\u2014" } ?: "\u2014")
                MetricRow("Version", if ((model?.version ?: 0) > 0) "${model?.version}" else "\u2014")
                MetricRow("Scale factor", if ((model?.scaleFactor ?: 0) > 0) "x${model?.scaleFactor}" else "\u2014")
                MetricRow("Operators", if ((model?.opCount ?: 0) > 0) "${model?.opCount}" else "\u2014")
                MetricRow("File size", bytes(model?.fileBytes ?: 0L))
                MetricRow("Temporal model", if (model?.temporal == true) "yes" else "no")
                MetricRow("Global residual", if (model?.globalResidual == true) "yes" else "no")
                if (model?.experimental == true) {
                    Spacer(Modifier.height(6.dp))
                    StatusChip(text = "EXPERIMENTAL MODEL", color = WarnAmber)
                }
                if (!model?.sha256.isNullOrEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "SHA-256 ${model?.sha256}",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { picker.launch(arrayOf("*/*")) }) {
                        Text("Import .v4kmodel")
                    }
                    OutlinedButton(onClick = { vm.removeModel() }) { Text("Remove") }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { vm.installBundledCalibrationModel() }) {
                        Text("Install calibration model")
                    }
                }
                Hint(
                    "The engine verifies the file (magic, header, operator table, weights and the body " +
                        "SHA-256) before installing it. Without a model the neural stage is unavailable and " +
                        "the engine says so instead of silently doing something else.",
                )
            }
        }
        item {
            PanelCard(title = "Model tiers") {
                MetricRow("Mobile SR Lite", "smallest, fastest \u2014 1\u20132x scale")
                MetricRow("Mobile SR Balanced", "default for mid and high tier devices")
                MetricRow("Mobile SR Quality", "largest working set, flagship tier")
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "No trained model ships and no download server is configured, so the three tiers are " +
                        "listed as targets rather than as buttons that would fail. What does ship are two " +
                        "calibration models (button above): linear graphs whose output must equal bilinear or " +
                        "bicubic upscaling, which is how the container, the planner and the kernels are checked " +
                        "on a real device. They are a pipeline check, not an image-quality model - bilinear " +
                        "quality is exactly what they produce. A trained model is written into the same " +
                        "container with tools/model/generate-calibration-models.sh's writer, and the engine " +
                        "reports the model it actually loaded.",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                )
            }
        }
        item {
            PanelCard(title = "Inference backends", accent = AccentCyan) {
                val device = state.device
                MetricRow("Vulkan compute", if (device?.vulkanAvailable == true) "available" else "unavailable")
                MetricRow("FP16 storage", if (device?.hasFloat16Storage == true) "supported" else "not supported")
                MetricRow("INT8 storage", if (device?.hasInt8Storage == true) "supported" else "not supported")
                MetricRow("NNAPI", if (device?.nnapiAvailable == true) "present" else "absent")
                MetricRow("GLES fallback", if (device?.glesAvailable == true) device.glesVersion else "unavailable")
                MetricRow("Selected path", state.compatibility?.achievableBackend?.name ?: "\u2014")
                MetricRow("Session", if (state.snapshot?.session?.active == true) "active" else "idle")
                MetricRow("Reconstruction", state.snapshot?.session?.modeName?.ifEmpty { "\u2014" } ?: "\u2014")
                MetricRow("Working set", bytes(state.snapshot?.session?.workingSetBytes ?: 0L))
                MetricRow("Weights", bytes(state.snapshot?.session?.weightBytes ?: 0L))
                MetricRow("AI processing", state.snapshot?.aiProcessingMs?.let { fmt(it, 2, " ms") } ?: "\u2014")
                Hint(
                    "The AI stage runs on Vulkan compute when a renderer hands the engine its device; NNAPI is " +
                        "used for the model's operators where the driver provides an accelerator. Both are " +
                        "reported from the probe, never assumed.",
                )
            }
        }
        item {
            PanelCard(title = "Integrating the SDK in a game", accent = AccentViolet) {
                Text(
                    text = SDK_SAMPLE.trim(),
                    style = MaterialTheme.typography.labelSmall,
                    color = AccentCyan,
                    fontFamily = FontFamily.Monospace,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "That is the whole contract: the game keeps its device and queues, the engine records " +
                        "its passes into the game's command buffer and the result lands in the output image the " +
                        "game already owns.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                )
            }
        }
    }
}

@Composable
private fun EngineStatePanel(state: UiState) {
    PanelCard(title = "Engine", accent = AccentCyan) {
        MetricRow("Version", state.snapshot?.engineVersion?.ifEmpty { "\u2014" } ?: "\u2014")
        MetricRow("Initialised", if (state.engineReady) "yes" else "no")
        MetricRow("Integration", state.integration.name)
        MetricRow("Device tier", state.compatibility?.tier?.name ?: "\u2014")
        MetricRow("Compatibility", state.compatibility?.status?.label ?: "\u2014")
        MetricRow("Maximum AI quality", state.compatibility?.maximumAiQuality?.label ?: "\u2014")
        if (state.engineError != null) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = state.engineError,
                style = MaterialTheme.typography.bodySmall,
                color = WarnAmber,
            )
        }
    }
}
