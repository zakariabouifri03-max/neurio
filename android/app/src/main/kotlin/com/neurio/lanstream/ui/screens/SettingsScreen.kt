package com.neurio.lanstream.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.neurio.lanstream.R
import com.neurio.lanstream.core.BitratePreset
import com.neurio.lanstream.core.FpsMode
import com.neurio.lanstream.core.InputMode
import com.neurio.lanstream.core.ResolutionTier
import com.neurio.lanstream.input.InputInjectors
import com.neurio.lanstream.platform.neurioApp
import com.neurio.lanstream.ui.components.RowSetting
import com.neurio.lanstream.ui.components.SectionCard
import com.neurio.lanstream.ui.components.SegmentedChoice
import com.neurio.lanstream.ui.theme.NeonPurple
import com.neurio.lanstream.ui.theme.SurfaceOutline
import com.neurio.lanstream.ui.theme.TextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, onControls: () -> Unit) {
    val context = LocalContext.current
    val repository = context.neurioApp.settings
    val settings by repository.settings.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
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
            SectionCard(title = stringResource(R.string.settings_section_stream)) {
                SettingLabel(stringResource(R.string.settings_resolution))
                SegmentedChoice(
                    options = listOf(
                        ResolutionTier.P480 to "480p",
                        ResolutionTier.P720 to "720p",
                        ResolutionTier.P1080 to "1080p"
                    ),
                    selected = settings.resolution,
                    onSelected = { repository.update { copy(resolution = it) } }
                )
                SettingLabel(stringResource(R.string.settings_fps))
                SegmentedChoice(
                    options = listOf(
                        FpsMode.FPS30 to "30",
                        FpsMode.FPS60 to "60"
                    ),
                    selected = settings.fpsMode,
                    onSelected = { repository.update { copy(fpsMode = it) } }
                )
                SettingLabel(stringResource(R.string.settings_bitrate))
                SegmentedChoice(
                    options = listOf(
                        BitratePreset.LOW to stringResource(R.string.preset_low),
                        BitratePreset.MEDIUM to stringResource(R.string.preset_medium),
                        BitratePreset.HIGH to stringResource(R.string.preset_high),
                        BitratePreset.CUSTOM to stringResource(R.string.preset_custom)
                    ),
                    selected = settings.bitratePreset,
                    onSelected = { repository.update { copy(bitratePreset = it) } }
                )
                if (settings.bitratePreset == BitratePreset.CUSTOM) {
                    Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                        Text(
                            text = stringResource(
                                R.string.settings_custom_bitrate,
                                settings.customBitrateMbps
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                        Slider(
                            value = settings.customBitrateMbps.toFloat(),
                            onValueChange = {
                                repository.update {
                                    copy(customBitrateMbps = it.toInt().coerceIn(1, 60))
                                }
                            },
                            valueRange = 1f..40f,
                            steps = 38
                        )
                    }
                }
                RowSetting(
                    title = stringResource(R.string.settings_adaptive),
                    subtitle = stringResource(R.string.settings_adaptive_desc)
                ) {
                    Switch(
                        checked = settings.adaptive,
                        onCheckedChange = { repository.update { copy(adaptive = it) } }
                    )
                }
                RowSetting(
                    title = stringResource(R.string.settings_low_latency),
                    subtitle = stringResource(R.string.settings_low_latency_desc)
                ) {
                    Switch(
                        checked = settings.lowLatency,
                        onCheckedChange = { repository.update { copy(lowLatency = it) } }
                    )
                }
                RowSetting(
                    title = stringResource(R.string.settings_audio),
                    subtitle = stringResource(R.string.settings_audio_desc)
                ) {
                    Switch(
                        checked = settings.audioEnabled,
                        onCheckedChange = { repository.update { copy(audioEnabled = it) } }
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            SectionCard(title = stringResource(R.string.settings_section_device)) {
                Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    OutlinedTextField(
                        value = settings.deviceName,
                        onValueChange = { repository.update { copy(deviceName = it.take(24)) } },
                        label = { Text(stringResource(R.string.settings_device_name)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                RowSetting(title = stringResource(R.string.settings_show_stats)) {
                    Switch(
                        checked = settings.showStats,
                        onCheckedChange = { repository.update { copy(showStats = it) } }
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            SectionCard(title = stringResource(R.string.settings_section_input)) {
                Text(
                    text = stringResource(R.string.settings_input_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
                )
                ChoiceColumn(
                    options = listOf(
                        InputMode.AUTO to stringResource(R.string.input_mode_auto),
                        InputMode.ACCESSIBILITY to stringResource(R.string.input_mode_accessibility),
                        InputMode.ROOT to stringResource(R.string.input_mode_root),
                        InputMode.OVERLAY to stringResource(R.string.input_mode_overlay),
                        InputMode.DISABLED to stringResource(R.string.input_mode_disabled)
                    ),
                    selected = settings.inputMode,
                    onSelected = { repository.update { copy(inputMode = it) } }
                )
                Text(
                    text = InputInjectors.limitationNote(settings.inputMode),
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
                )
                RowSetting(
                    title = stringResource(R.string.settings_controls),
                    subtitle = stringResource(R.string.settings_controls_desc),
                    trailing = {
                        Text(
                            text = stringResource(R.string.common_open_settings),
                            style = MaterialTheme.typography.labelLarge,
                            color = NeonPurple,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable(onClick = onControls)
                                .padding(8.dp)
                        )
                    }
                )
            }
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun SettingLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = TextSecondary,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)
    )
}

/** Vertical radio list — no experimental Material3 APIs involved. */
@Composable
private fun <T> ChoiceColumn(
    options: List<Pair<T, String>>,
    selected: T,
    onSelected: (T) -> Unit
) {
    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
        options.forEach { (value, label) ->
            val isSelected = value == selected
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (isSelected) NeonPurple.copy(alpha = 0.15f) else Color.Transparent)
                    .clickable { onSelected(value) }
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                BoxRadio(selected = isSelected)
                Spacer(modifier = Modifier.width(12.dp))
                Text(text = label, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun BoxRadio(selected: Boolean) {
    Box(
        modifier = Modifier
            .size(18.dp)
            .clip(CircleShape)
            .border(2.dp, if (selected) NeonPurple else SurfaceOutline, CircleShape),
        contentAlignment = Alignment.Center
    ) {
        if (selected) {
            Box(
                modifier = Modifier
                    .size(9.dp)
                    .clip(CircleShape)
                    .background(NeonPurple)
            )
        }
    }
}
