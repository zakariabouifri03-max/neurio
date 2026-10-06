package com.neurio.lanstream.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.neurio.lanstream.R
import com.neurio.lanstream.core.NetworkInfo
import com.neurio.lanstream.media.CodecCapabilities
import com.neurio.lanstream.platform.Permissions
import com.neurio.lanstream.ui.components.RowSetting
import com.neurio.lanstream.ui.components.SectionCard
import com.neurio.lanstream.ui.components.StatusDot
import com.neurio.lanstream.ui.theme.NeonCyan
import com.neurio.lanstream.ui.theme.NeonLime
import com.neurio.lanstream.ui.theme.TextSecondary

/**
 * Diagnostics: everything needed to explain "why is this not working on my
 * phone" without guessing — codecs, network and which capabilities are granted.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiagnosticsScreen(onBack: () -> Unit, onCopy: (String) -> Unit) {
    val context = LocalContext.current
    var report by remember { mutableStateOf("") }

    val info = remember { NetworkInfo.snapshot(context) }
    val accessibility = remember { Permissions.isAccessibilityEnabled(context) }
    val overlay = remember { Permissions.canDrawOverlays(context) }
    val notifications = remember { Permissions.hasNotificationPermission(context) }
    val recordAudio = remember { Permissions.hasRecordAudio(context) }
    val codecs = remember { CodecCapabilities.describe() }
    val videoEncoder = remember { CodecCapabilities.preferEncoder(CodecCapabilities.H264) }
    val videoDecoder = remember { CodecCapabilities.preferDecoder(CodecCapabilities.H264) }

    report = buildString {
        appendLine("Neurio diagnostics")
        appendLine("device: ${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})")
        appendLine("android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        appendLine("network: ${info.type} ${info.ssid ?: ""} ip=${info.ip ?: "-"}")
        appendLine("addresses: ${info.allAddresses.joinToString()}")
        appendLine("screen-capture: ${if (Build.VERSION.SDK_INT >= 21) "MediaProjection available" else "no"}")
        appendLine("audio-capture: ${if (Build.VERSION.SDK_INT >= 29) "playback capture API available" else "needs Android 10+"}")
        appendLine("accessibility: $accessibility")
        appendLine("overlay: $overlay notifications: $notifications record-audio: $recordAudio")
        appendLine("encoder: ${videoEncoder?.name} hw=${videoEncoder?.let { CodecCapabilities.isHardware(it) }}")
        appendLine("decoder: ${videoDecoder?.name} hw=${videoDecoder?.let { CodecCapabilities.isHardware(it) }}")
        appendLine("hevc-encode: ${CodecCapabilities.supportsHevcEncoding()}")
        appendLine("codecs:")
        appendLine(codecs)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.diag_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(padding)
                .verticalScroll(rememberScrollState())
        ) {
            SectionCard(title = stringResource(R.string.diag_device)) {
                DiagRow("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                DiagRow("android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
                DiagRow("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "-")
            }
            Spacer(modifier = Modifier.height(8.dp))
            SectionCard(title = stringResource(R.string.diag_network)) {
                DiagRow("type", info.type)
                DiagRow("ssid", info.ssid ?: "—")
                DiagRow("ip", info.ip ?: "—")
                DiagRow("all", info.allAddresses.joinToString().ifBlank { "—" })
            }
            Spacer(modifier = Modifier.height(8.dp))
            SectionCard(title = stringResource(R.string.diag_codecs)) {
                DiagRow(
                    "encoder",
                    videoEncoder?.let {
                        "${it.name} (${if (CodecCapabilities.isHardware(it)) "hw" else "sw"})"
                    } ?: "none"
                )
                DiagRow(
                    "decoder",
                    videoDecoder?.let {
                        "${it.name} (${if (CodecCapabilities.isHardware(it)) "hw" else "sw"})"
                    } ?: "none"
                )
                DiagRow("hevc", if (CodecCapabilities.supportsHevcEncoding()) "yes" else "no")
                Text(
                    text = codecs,
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondary,
                    modifier = Modifier.padding(16.dp)
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            SectionCard(title = stringResource(R.string.diag_permissions)) {
                CapabilityRow(stringResource(R.string.diag_screen_capture), true)
                CapabilityRow(
                    stringResource(R.string.diag_audio_capture),
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                )
                CapabilityRow(stringResource(R.string.diag_accessibility), accessibility)
                CapabilityRow(stringResource(R.string.diag_overlay), overlay)
                CapabilityRow(stringResource(R.string.diag_notifications), notifications)
                CapabilityRow("RECORD_AUDIO", recordAudio)
            }
            Spacer(modifier = Modifier.height(12.dp))
            Button(
                onClick = {
                    copyToClipboard(context, report)
                    onCopy(report)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            ) {
                Text(stringResource(R.string.diag_copy))
            }
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun DiagRow(label: String, value: String) {
    RowSetting(title = label, subtitle = value)
}

@Composable
private fun CapabilityRow(label: String, enabled: Boolean) {
    RowSetting(
        title = label,
        subtitle = if (enabled) {
            stringResource(R.string.status_granted)
        } else {
            stringResource(R.string.status_missing)
        },
        trailing = { StatusDot(active = enabled, color = if (enabled) NeonLime else NeonCyan) }
    )
}

private fun copyToClipboard(context: Context, text: String) {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    manager?.setPrimaryClip(ClipData.newPlainText("neurio-diagnostics", text))
}
