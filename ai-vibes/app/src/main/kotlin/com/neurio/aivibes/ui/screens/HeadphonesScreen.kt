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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.AppViewModel
import com.neurio.aivibes.headphones.HeadphoneMonitor
import com.neurio.aivibes.settings.Presets
import com.neurio.aivibes.ui.components.GlowPanel
import com.neurio.aivibes.ui.components.NeonChip
import com.neurio.aivibes.ui.components.SectionTitle
import com.neurio.aivibes.ui.components.StatusPill
import com.neurio.aivibes.ui.theme.VibeColors

/**
 * Headphone experience: connection status (wired / USB / Bluetooth), battery
 * only when the device reports it, and per-device automatic presets.
 */
@Composable
fun HeadphonesScreen(vm: AppViewModel) {
    val state by vm.headphones.collectAsState()
    val prefs by vm.prefs.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
    ) {
        Spacer(Modifier.height(18.dp))
        SectionTitle("Headphones", "Detected with Android's audio device APIs")
        Spacer(Modifier.height(12.dp))

        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(58.dp)
                        .clip(CircleShape)
                        .background(
                            if (state.connected) Brush.linearGradient(listOf(VibeColors.Purple, VibeColors.Blue))
                            else Brush.linearGradient(listOf(androidx.compose.ui.graphics.Color(0xFF22223A), androidx.compose.ui.graphics.Color(0xFF18182B)))
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Filled.Headphones, contentDescription = null, tint = VibeColors.White)
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(
                        state.label,
                        style = MaterialTheme.typography.titleLarge,
                        color = VibeColors.White,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        when (state.kind) {
                            HeadphoneMonitor.Kind.BLUETOOTH -> "Bluetooth output"
                            HeadphoneMonitor.Kind.USB -> "USB audio output"
                            HeadphoneMonitor.Kind.WIRED -> "Wired output"
                            HeadphoneMonitor.Kind.NONE -> "Speaker output"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = VibeColors.Muted
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                StatusPill(
                    "Battery: ${state.batteryPercent?.let { "$it%" } ?: "not reported"}",
                    active = state.batteryPercent != null
                )
                StatusPill(
                    if (state.connected) "Connected" else "Not connected",
                    active = state.connected
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                "Battery appears only when your headset actually reports it to " +
                    "Android — we never estimate or fake a level.",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeColors.Muted
            )
        }

        Spacer(Modifier.height(18.dp))
        SectionTitle("Automatic presets", "Load a preset when this device connects")
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Auto-load preset on connect", style = MaterialTheme.typography.titleMedium, color = VibeColors.White)
                Text(
                    "Applies to the device you assign below",
                    style = MaterialTheme.typography.labelSmall,
                    color = VibeColors.Muted
                )
            }
            NeonChip("On", prefs.autoPreset) { vm.saveAutoPreset(true) }
            Spacer(Modifier.padding(3.dp))
            NeonChip("Off", !prefs.autoPreset) { vm.saveAutoPreset(true) }
        }

        Spacer(Modifier.height(12.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Text(
                    "Preset for: ${state.label}",
                    style = MaterialTheme.typography.titleMedium,
                    color = VibeColors.White
                )
                Spacer(Modifier.height(10.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(Presets.factory) { preset ->
                        NeonChip(
                            text = preset.name,
                            selected = preset.id == prefs.presetId,
                            onClick = {
                                vm.applyPreset(preset)
                                vm.assignDevicePreset(vm.currentDeviceKey(), preset.id)
                            }
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    "Tap a preset to bind it to the current output device. " +
                        "Disconnecting and reconnecting the headphones reloads it " +
                        "automatically (when auto-load is on).",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
