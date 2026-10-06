package com.neurio.lanstream.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.neurio.lanstream.R
import com.neurio.lanstream.core.AudioStatus
import com.neurio.lanstream.core.HostBus
import com.neurio.lanstream.core.HostPhase
import com.neurio.lanstream.games.GameApp
import com.neurio.lanstream.games.GameLibrary
import com.neurio.lanstream.platform.Permissions
import com.neurio.lanstream.ui.UiActions
import com.neurio.lanstream.ui.components.AppIcon
import com.neurio.lanstream.ui.components.SectionCard
import com.neurio.lanstream.ui.components.StatChip
import com.neurio.lanstream.ui.components.StatusDot
import com.neurio.lanstream.ui.theme.Amber
import com.neurio.lanstream.ui.theme.HotRed
import com.neurio.lanstream.ui.theme.NeonCyan
import com.neurio.lanstream.ui.theme.NeonLime
import com.neurio.lanstream.ui.theme.NeonPurple
import com.neurio.lanstream.ui.theme.TextSecondary
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostScreen(actions: UiActions, onBack: () -> Unit) {
    val context = LocalContext.current
    val state by HostBus.state.collectAsState()
    val stats by HostBus.stats.collectAsState()

    val games = remember { mutableStateListOf<GameApp>() }
    var loading by remember { mutableStateOf(true) }
    var selected by remember { mutableStateOf<GameApp?>(null) }
    var accessibility by remember { mutableStateOf(Permissions.isAccessibilityEnabled(context)) }

    LaunchedEffect(Unit) {
        games.clear()
        games.addAll(GameLibrary.load(context))
        loading = false
    }
    LaunchedEffect(Unit) {
        while (true) {
            accessibility = Permissions.isAccessibilityEnabled(context)
            delay(2_000)
        }
    }

    val active = state.isActive

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.host_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            item {
                SectionCard(title = stringResource(R.string.host_status)) {
                    InfoRow(stringResource(R.string.host_device), state.deviceName.ifBlank { "—" })
                    InfoRow(stringResource(R.string.host_ip), state.localIp ?: "—")
                    InfoRow(
                        stringResource(R.string.host_network),
                        listOfNotNull(state.networkType, state.ssid).joinToString(" · ").ifBlank { "—" }
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    CodeBlock(
                        code = state.pairingCode,
                        enabled = active,
                        onRotate = actions.onRotateCode
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
                    ) {
                        StatusDot(active = state.isStreaming, color = NeonLime)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = statusText(state.phase, state.playerName),
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (state.isStreaming) NeonLime else TextSecondary
                        )
                    }
                    state.message?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Amber,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.host_stats)) {
                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Row(modifier = Modifier.fillMaxWidth()) {
                            StatChip(
                                label = stringResource(R.string.host_fps),
                                value = if (active) "${stats.fps.toInt()}/${stats.targetFps}" else "—",
                                modifier = Modifier.weight(1f)
                            )
                            StatChip(
                                label = stringResource(R.string.host_latency),
                                value = if (active) "${stats.pingMs} ms" else "—",
                                modifier = Modifier.weight(1f)
                            )
                            StatChip(
                                label = stringResource(R.string.host_bitrate),
                                value = if (active) "%.1f".format(stats.bitrateBps / 1_000_000f) else "—",
                                modifier = Modifier.weight(1f)
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(modifier = Modifier.fillMaxWidth()) {
                            StatChip(
                                label = stringResource(R.string.host_resolution),
                                value = stats.resolution.ifBlank { "—" },
                                modifier = Modifier.weight(1f)
                            )
                            StatChip(
                                label = stringResource(R.string.host_packets_lost),
                                value = if (active) "%.1f%%".format(stats.packetLoss * 100f) else "—",
                                modifier = Modifier.weight(1f)
                            )
                            StatChip(
                                label = stringResource(R.string.host_encoder),
                                value = stats.encoderName.takeIf { it.isNotBlank() }?.let {
                                    if (stats.hardwareEncoder) "HW" else "SW"
                                } ?: "—",
                                modifier = Modifier.weight(1f)
                            )
                        }
                        if (stats.adaptiveState.isNotBlank()) {
                            Text(
                                text = "adaptive: ${stats.adaptiveState}",
                                style = MaterialTheme.typography.labelSmall,
                                color = NeonCyan,
                                modifier = Modifier.padding(vertical = 6.dp)
                            )
                        }
                        InfoRow(
                            stringResource(R.string.host_audio),
                            audioText(state.audio, state.audioDetail)
                        )
                        if (state.inputDescription.isNotBlank()) {
                            Text(
                                text = state.inputDescription,
                                style = MaterialTheme.typography.labelSmall,
                                color = TextSecondary,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
                            )
                        }
                        if (!accessibility) {
                            OutlinedButton(
                                onClick = actions.onOpenAccessibilitySettings,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 6.dp)
                            ) {
                                Text(stringResource(R.string.diag_accessibility))
                            }
                        }
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.host_games)) {
                    when {
                        loading -> Text(
                            text = stringResource(R.string.host_searching_games),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary,
                            modifier = Modifier.padding(16.dp)
                        )
                        games.isEmpty() -> Text(
                            text = stringResource(R.string.host_no_games),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary,
                            modifier = Modifier.padding(16.dp)
                        )
                        else -> Column {
                            games.forEach { game ->
                                GameRow(
                                    game = game,
                                    selected = selected?.packageName == game.packageName,
                                    onClick = { selected = game }
                                )
                            }
                        }
                    }
                }
            }

            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (!active) {
                        Button(
                            onClick = { actions.onStartHost(selected) },
                            enabled = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(56.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = NeonPurple)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = if (selected == null) {
                                    stringResource(R.string.host_start_stream)
                                } else {
                                    "${stringResource(R.string.host_start_stream)} · ${selected?.name}"
                                },
                                style = MaterialTheme.typography.labelLarge
                            )
                        }
                        Text(
                            text = stringResource(R.string.host_select_game),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Text(
                            text = stringResource(R.string.host_capture_hint),
                            style = MaterialTheme.typography.labelSmall,
                            color = Amber,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth()
                        )
                    } else {
                        Button(
                            onClick = actions.onStopHost,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(52.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = HotRed)
                        ) {
                            Icon(Icons.Default.Stop, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(stringResource(R.string.host_stop_stream))
                        }
                        selected?.let { game ->
                            OutlinedButton(
                                onClick = { actions.onLaunchGame(game) },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Refresh, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("${stringResource(R.string.host_relaunch)} · ${game.name}")
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun statusText(phase: HostPhase, player: String?): String =
    when (phase) {
        HostPhase.IDLE -> stringResource(R.string.status_idle)
        HostPhase.PREPARING -> stringResource(R.string.host_preparing)
        HostPhase.WAITING -> stringResource(R.string.host_waiting)
        HostPhase.STREAMING -> stringResource(R.string.host_streaming_live, player ?: "player")
        HostPhase.STOPPING -> stringResource(R.string.common_stop)
        HostPhase.ERROR -> stringResource(R.string.status_error)
    }

@Composable
private fun audioText(status: AudioStatus, detail: String?): String {
    val base = when (status) {
        AudioStatus.UNKNOWN -> stringResource(R.string.status_unknown)
        AudioStatus.UNSUPPORTED_OS -> stringResource(R.string.status_android_10_required)
        AudioStatus.DISABLED -> stringResource(R.string.status_disabled)
        AudioStatus.STARTING -> stringResource(R.string.status_waiting)
        AudioStatus.CAPTURING -> stringResource(R.string.status_active)
        AudioStatus.SILENT -> stringResource(R.string.status_blocked)
        AudioStatus.BLOCKED -> stringResource(R.string.status_blocked)
        AudioStatus.FAILED -> stringResource(R.string.status_error)
    }
    return if (detail.isNullOrBlank()) base else "$base — $detail"
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            color = Color.White
        )
    }
}

@Composable
private fun CodeBlock(code: String, enabled: Boolean, onRotate: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.host_code),
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary
            )
            Text(
                text = code.chunked(3).joinToString(" ").ifBlank { "——————" },
                style = MaterialTheme.typography.displaySmall,
                color = NeonCyan
            )
            Text(
                text = stringResource(R.string.host_code_hint),
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary
            )
        }
        OutlinedButton(onClick = onRotate, enabled = enabled) {
            Text(stringResource(R.string.host_rotate_code))
        }
    }
}

@Composable
private fun GameRow(game: GameApp, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) NeonPurple.copy(alpha = 0.18f) else Color.Transparent)
            .border(
                width = if (selected) 1.dp else 0.dp,
                color = if (selected) NeonPurple else Color.Transparent,
                shape = RoundedCornerShape(12.dp)
            )
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AppIcon(packageName = game.packageName, modifier = Modifier.size(44.dp))
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = game.name, style = MaterialTheme.typography.titleMedium)
            Text(
                text = buildString {
                    append(game.packageName)
                    if (game.isGame) append(" · game")
                    game.versionName?.let { append(" · v$it") }
                },
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary
            )
        }
        if (selected) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(androidx.compose.foundation.shape.CircleShape)
                    .background(NeonPurple)
            )
        }
    }
}
