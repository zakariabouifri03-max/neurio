package com.neurio.aivibes.ui.screens

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
import com.neurio.aivibes.ui.components.NeonChip
import com.neurio.aivibes.ui.components.SectionTitle
import com.neurio.aivibes.ui.theme.VibeColors

/** Settings, customization and the honest limitations explainer. */
@Composable
fun SettingsScreen(vm: AppViewModel) {
    val prefs by vm.prefs.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
    ) {
        Spacer(Modifier.height(18.dp))
        SectionTitle("Settings", "Everything is stored on this device")
        Spacer(Modifier.height(12.dp))

        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                SettingToggle(
                    "Battery-efficient mode",
                    "Reduces visualizer work on budget phones",
                    prefs.batterySaver,
                    onTrue = { vm.saveBatterySaver(true) },
                    onFalse = { vm.saveBatterySaver(false) }
                )
                Spacer(Modifier.height(12.dp))
                SettingToggle(
                    "Auto-load preset on headphone connect",
                    "Uses the per-device assignment from the Headphones tab",
                    prefs.autoPreset,
                    onTrue = { vm.saveAutoPreset(true) },
                    onFalse = { vm.saveAutoPreset(false) }
                )
                Spacer(Modifier.height(12.dp))
                SettingToggle(
                    "Device DSP assist",
                    "Also drive the phone's own BassBoost/Virtualizer when supported",
                    prefs.deviceAssist,
                    onTrue = { vm.saveDeviceAssist(true) },
                    onFalse = { vm.saveDeviceAssist(false) }
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Text(
                    "Visualizer style",
                    style = MaterialTheme.typography.titleMedium,
                    color = VibeColors.White,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(10.dp))
                Row {
                    NeonChip("Spectrum", prefs.vizStyle == 0) { vm.saveViz(0, prefs.vizSensitivity) }
                    Spacer(Modifier.padding(4.dp))
                    NeonChip("Circular", prefs.vizStyle == 1) { vm.saveViz(1, prefs.vizSensitivity) }
                    Spacer(Modifier.padding(4.dp))
                    NeonChip("Neon pulse", prefs.vizStyle == 2) { vm.saveViz(2, prefs.vizSensitivity) }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Text(
                    "What AI VIBES can (and cannot) do",
                    style = MaterialTheme.typography.titleLarge,
                    color = VibeColors.White,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "✓ Real DSP on every track played inside the app: bass, 10-band " +
                        "EQ, clarity, simulated spatial width, dynamics and a limiter.\n\n" +
                        "✓ Background playback with notification and lock-screen controls.\n\n" +
                        "✓ Headphone detection with per-device presets; battery shown only " +
                        "when the device reports it.\n\n" +
                        "✗ System-wide processing of Spotify/YouTube/games — Android does " +
                        "not allow ordinary apps to touch other apps' audio. Audio capture " +
                        "exists but is restricted and app-controlled; we don't pretend.\n\n" +
                        "✗ Changing Bluetooth bandwidth or exceeding your headphones' " +
                        "physical capabilities — impossible for any app.\n\n" +
                        "✗ Hardware 3D spatial audio — that lives in the phone and the " +
                        "headset. Our spatial effect is honest stereo processing.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        NeonButton("Reset all sound settings to default", modifier = Modifier.fillMaxWidth()) {
            vm.resetToDefaults()
        }

        Spacer(Modifier.height(16.dp))
        GlowPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Text(
                    "About",
                    style = MaterialTheme.typography.titleMedium,
                    color = VibeColors.White,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "AI VIBES 1.0.0 — built with Kotlin, Jetpack Compose and Media3. " +
                        "No analytics, no network permission, no account. Your music " +
                        "and settings never leave the phone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibeColors.Muted
                )
            }
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun SettingToggle(
    title: String,
    subtitle: String,
    value: Boolean,
    onTrue: () -> Unit,
    onFalse: () -> Unit
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = VibeColors.White)
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = VibeColors.Muted)
        }
        NeonChip("On", value) { onTrue() }
        Spacer(Modifier.padding(3.dp))
        NeonChip("Off", !value) { onFalse() }
    }
}
