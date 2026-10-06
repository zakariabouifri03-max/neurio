package com.neurio.lanstream.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.neurio.lanstream.R
import com.neurio.lanstream.core.ClientBus
import com.neurio.lanstream.core.ClientPhase
import com.neurio.lanstream.discovery.HostEndpoint
import com.neurio.lanstream.platform.neurioApp
import com.neurio.lanstream.ui.UiActions
import com.neurio.lanstream.ui.components.SectionCard
import com.neurio.lanstream.ui.components.StatusDot
import com.neurio.lanstream.ui.theme.Amber
import com.neurio.lanstream.ui.theme.NeonCyan
import com.neurio.lanstream.ui.theme.NeonLime
import com.neurio.lanstream.ui.theme.NeonPurple
import com.neurio.lanstream.ui.theme.SurfaceElevated
import com.neurio.lanstream.ui.theme.SurfaceOutline
import com.neurio.lanstream.ui.theme.TextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientScreen(actions: UiActions, onBack: () -> Unit) {
    val context = LocalContext.current
    val state by ClientBus.state.collectAsState()
    val hosts by context.neurioApp.discovery.hosts.collectAsState()
    var code by remember { mutableStateOf(ClientBus.code.value) }
    var manualIp by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        context.neurioApp.discovery.startScan()
        ClientBus.updateState { copy(phase = ClientPhase.SCANNING) }
    }
    DisposableEffect(Unit) {
        onDispose {
            context.neurioApp.discovery.stopScan()
            if (ClientBus.state.value.phase != ClientPhase.STREAMING) {
                ClientBus.updateState { copy(phase = ClientPhase.IDLE) }
            }
        }
    }

    val busy = state.phase == ClientPhase.CONNECTING || state.phase == ClientPhase.AUTHENTICATING

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.client_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { context.neurioApp.discovery.startScan() }) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.common_refresh))
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
                SectionCard(title = stringResource(R.string.client_status)) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (hosts.isEmpty()) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = NeonCyan
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                        } else {
                            StatusDot(active = true, color = NeonLime)
                            Spacer(modifier = Modifier.width(10.dp))
                        }
                        Text(
                            text = if (hosts.isEmpty()) {
                                stringResource(R.string.client_scanning)
                            } else {
                                stringResource(R.string.client_found) + " (${hosts.size})"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                    }
                    state.message?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Amber,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                        )
                    }
                }
            }

            item {
                SectionCard(title = stringResource(R.string.client_code_label)) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = stringResource(R.string.client_enter_code),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = code,
                            onValueChange = { input ->
                                val digits = input.filter { it.isDigit() }.take(6)
                                code = digits
                                ClientBus.setCode(digits)
                            },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            textStyle = MaterialTheme.typography.displaySmall,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            placeholder = {
                                Text(
                                    text = "000000",
                                    style = MaterialTheme.typography.displaySmall,
                                    color = TextSecondary
                                )
                            }
                        )
                    }
                }
            }

            if (hosts.isEmpty()) {
                item {
                    Text(
                        text = stringResource(R.string.client_no_hosts),
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(24.dp)
                    )
                }
            } else {
                items(hosts, key = { it.id }) { host ->
                    HostRow(
                        host = host,
                        enabled = !busy && code.length == 6,
                        onConnect = { actions.onConnect(host, code) }
                    )
                }
            }

            item {
                SectionCard(title = stringResource(R.string.client_manual)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = manualIp,
                            onValueChange = { manualIp = it },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            placeholder = { Text(stringResource(R.string.client_manual_hint)) }
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        OutlinedButton(onClick = {
                            if (manualIp.isNotBlank()) {
                                context.neurioApp.discovery.addManual(manualIp)
                                manualIp = ""
                            }
                        }) {
                            Text(stringResource(R.string.client_add))
                        }
                    }
                }
            }

            item {
                if (state.phase == ClientPhase.STREAMING) {
                    Button(
                        onClick = {
                            actions.onDisconnect()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                            .height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = com.neurio.lanstream.ui.theme.HotRed)
                    ) {
                        Text(stringResource(R.string.client_disconnect))
                    }
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun HostRow(host: HostEndpoint, enabled: Boolean, onConnect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(SurfaceElevated)
            .border(1.dp, SurfaceOutline, RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        StatusDot(active = true, color = if (host.busy) Amber else NeonLime)
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = host.name, style = MaterialTheme.typography.titleMedium)
            Text(
                text = "${host.hostAddress}:${host.controlPort}" +
                    (host.gameName?.let { " · $it" } ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary
            )
            Row(
                modifier = Modifier.padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "${stringResource(R.string.client_ping)}: " +
                        if (host.rttMs >= 0) "${host.rttMs} ms" else "—",
                    style = MaterialTheme.typography.labelSmall,
                    color = NeonCyan
                )
                Text(
                    text = stringResource(
                        if (host.busy) R.string.client_status_streaming else R.string.client_status_available
                    ),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (host.busy) Amber else TextSecondary
                )
                Text(
                    text = host.source,
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondary
                )
            }
        }
        Button(
            onClick = onConnect,
            enabled = enabled,
            colors = ButtonDefaults.buttonColors(containerColor = NeonPurple)
        ) {
            Text(stringResource(R.string.client_connect))
        }
    }
}
