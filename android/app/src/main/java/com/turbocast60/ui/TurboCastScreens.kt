package com.turbocast60.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.framework.CastButtonFactory
import com.turbocast60.capture.StreamUiState
import com.turbocast60.model.ReceiverDevice
import com.turbocast60.model.StreamProfile
import java.util.Locale

@Composable
fun TurboCastOnboardingScreen(onFinish: () -> Unit) {
    var page by remember { mutableStateOf(0) }
    val headings = listOf("Mirror your screen.\nOn your network.", "Your TV needs a receiver.", "60 FPS depends on your setup.")
    val body = listOf(
        "TurboCast captures only after you approve Android's screen-sharing prompt. A persistent notification stays visible while mirroring is active.",
        "Use a Google Cast / Chromecast receiver, or install TurboCast 60 on a compatible Android TV or Android device and open Receiver Mode. A normal TV alone is not enough.",
        "Performance depends on the phone's H.264 encoder, display refresh rate, Wi-Fi congestion, and the receiver. Secure or DRM-protected screens may appear black."
    )
    val icon = when (page) {
        0 -> Icons.Filled.Security
        1 -> Icons.Filled.Tv
        else -> Icons.Filled.Wifi
    }
    Box(
        modifier = Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(MaterialTheme.colorScheme.background, MaterialTheme.colorScheme.surfaceVariant))
        ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 26.dp).clip(RoundedCornerShape(32.dp))
                .background(MaterialTheme.colorScheme.surface).padding(26.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)) {
                    Icon(icon, null, modifier = Modifier.padding(14.dp).size(28.dp), tint = MaterialTheme.colorScheme.primary)
                }
                Column {
                    Text("TURBOCAST 60", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, letterSpacing = 1.8.sp)
                    Text("Screen mirroring", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(headings[page], style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, lineHeight = 34.sp)
                Text(body[page], style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 25.sp)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                repeat(3) { index ->
                    Box(Modifier.size(if (index == page) 24.dp else 7.dp, 7.dp).clip(CircleShape).background(if (index == page) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                if (page > 0) {
                    TextButton(onClick = { page-- }) { Icon(Icons.Filled.ArrowBack, null); Spacer(Modifier.width(7.dp)); Text("Back") }
                }
                Button(
                    onClick = { if (page < 2) page++ else onFinish() },
                    modifier = Modifier.weight(1f).height(54.dp),
                    shape = RoundedCornerShape(17.dp)
                ) { Text(if (page < 2) "Continue" else "Get started", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

private enum class DestinationChoice { COMPANION, CAST }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TurboCastHomeScreen(
    devices: List<ReceiverDevice>,
    streamState: StreamUiState,
    castConnected: Boolean,
    castAvailable: Boolean,
    castPlayback: String,
    castLoadMessage: String?,
    darkTheme: Boolean,
    receiverStatus: String,
    onDarkThemeChange: (Boolean) -> Unit,
    onRefreshDiscovery: () -> Unit,
    onOpenReceiverMode: () -> Unit,
    onRequestCapture: (StreamProfile, Int, Boolean, ReceiverDevice?, String) -> Unit,
    onStop: () -> Unit
) {
    var selectedProfile by remember { mutableStateOf(StreamProfile.PERFORMANCE) }
    var selectedBitrate by remember { mutableStateOf(StreamProfile.PERFORMANCE.startBitrate) }
    var selectedDeviceId by remember { mutableStateOf<String?>(null) }
    var destination by remember { mutableStateOf(DestinationChoice.COMPANION) }
    var showPairingDialog by remember { mutableStateOf(false) }
    var enteredCode by remember { mutableStateOf("") }
    var showTroubleshooting by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val selectedDevice = devices.firstOrNull { it.id == selectedDeviceId }
    val inProgress = streamState is StreamUiState.Starting || streamState is StreamUiState.Active

    LaunchedEffect(castConnected) { if (castConnected) destination = DestinationChoice.CAST }
    LaunchedEffect(devices) {
        if (selectedDeviceId != null && devices.none { it.id == selectedDeviceId }) selectedDeviceId = null
        if (selectedDeviceId == null && devices.size == 1) selectedDeviceId = devices.first().id
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Surface(shape = RoundedCornerShape(11.dp), color = MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)) {
                            Icon(Icons.Filled.Cast, null, Modifier.padding(8.dp).size(19.dp), tint = MaterialTheme.colorScheme.primary)
                        }
                        Column {
                            Text("TurboCast 60", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("LOCAL SCREEN MIRRORING", style = MaterialTheme.typography.labelSmall, letterSpacing = 1.35.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { onDarkThemeChange(!darkTheme) }) {
                        Icon(if (darkTheme) Icons.Filled.LightMode else Icons.Filled.DarkMode, "Toggle color theme")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        }
    ) { inner ->
        Column(
            Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            HeroCard(
                streamState = streamState,
                isCast = destination == DestinationChoice.CAST,
                castPlayback = castPlayback,
                inProgress = inProgress,
                onConnect = {
                    notice = null
                    if (inProgress) onStop()
                    else if (destination == DestinationChoice.CAST) {
                        if (castConnected) onRequestCapture(selectedProfile, selectedBitrate, true, null, "")
                        else notice = if (!castAvailable) "Google Cast sender support needs Google Play services on this phone." else "Choose a Cast receiver with the Cast button below first."
                    } else if (selectedDevice == null) {
                        notice = "No TurboCast TV receiver selected. Install the companion app on an Android TV or choose Google Cast."
                    } else {
                        enteredCode = ""
                        showPairingDialog = true
                    }
                }
            )

            if (notice != null) NoticeCard(notice!!, onDismiss = { notice = null })
            if (streamState is StreamUiState.Starting) {
                StatusCard("Starting", streamState.detail, MaterialTheme.colorScheme.primary)
            }
            if (streamState is StreamUiState.Active) ActiveStreamCard(streamState)
            if (streamState is StreamUiState.Failed) StatusCard("Could not mirror", streamState.reason, MaterialTheme.colorScheme.error)

            SectionHeading("01", "Choose a receiver", "Both devices must be on the same local Wi-Fi network.")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                DestinationCard(
                    modifier = Modifier.weight(1f),
                    title = "TurboCast TV",
                    subtitle = "Companion receiver app",
                    icon = Icons.Filled.Tv,
                    selected = destination == DestinationChoice.COMPANION,
                    onClick = { destination = DestinationChoice.COMPANION }
                )
                DestinationCard(
                    modifier = Modifier.weight(1f),
                    title = "Google Cast",
                    subtitle = "Chromecast / Cast TV",
                    icon = Icons.Filled.Cast,
                    selected = destination == DestinationChoice.CAST,
                    onClick = { destination = DestinationChoice.CAST }
                )
            }

            if (destination == DestinationChoice.COMPANION) {
                ReceiverPicker(devices, selectedDeviceId, receiverStatus, onSelect = { selectedDeviceId = it }, onRefresh = onRefreshDiscovery)
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.62f)),
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Filled.Tv, null, tint = MaterialTheme.colorScheme.primary)
                        Column(Modifier.weight(1f)) {
                            Text("Use this device as a TV receiver", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text("Install the same app on Android TV / Google TV, then open Receiver Mode.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(onClick = onOpenReceiverMode) { Text("Open") }
                    }
                }
            } else {
                CastReceiverCard(
                    connected = castConnected,
                    available = castAvailable,
                    playback = castPlayback,
                    loadMessage = castLoadMessage
                )
            }

            SectionHeading("02", "Choose stream quality", "The encoder may choose a lower supported mode on this phone.")
            ProfilePicker(
                selected = selectedProfile,
                bitrate = selectedBitrate,
                castMode = destination == DestinationChoice.CAST,
                onSelect = {
                    selectedProfile = it
                    selectedBitrate = it.startBitrate
                },
                onBitrateChange = { selectedBitrate = it }
            )

            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(20.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        Icon(Icons.Filled.Lock, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(19.dp))
                        Text("Private by design", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    }
                    Text(
                        "Companion streams are encrypted for this session after pairing. Google Cast streams stay on your LAN and are buffered in memory only. TurboCast does not record video or collect browsing history.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 19.sp
                    )
                }
            }

            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.fillMaxWidth().clickable { showTroubleshooting = !showTroubleshooting }
            ) {
                Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        Icon(Icons.Filled.HelpOutline, null, tint = MaterialTheme.colorScheme.primary)
                        Text("TV compatibility & troubleshooting", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Text(if (showTroubleshooting) "−" else "+", color = MaterialTheme.colorScheme.primary, fontSize = 22.sp)
                    }
                    if (showTroubleshooting) {
                        Text("• Google Cast works only with a Cast-enabled receiver on the same network.\n• The companion receiver is for Android TV / Google TV or another Android device running TurboCast 60.\n• AirPlay, Miracast, DLNA, and an ordinary HDMI TV are not automatically compatible.\n• If discovery is empty, start Receiver Mode, disable Wi-Fi client isolation, and keep both devices on the same LAN.\n• Protected/secure windows may be black; TurboCast does not bypass DRM.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 20.sp)
                    }
                }
            }

            Text("Bluetooth is not used for video. Actual quality and delay depend on the devices and Wi-Fi.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp))
        }
    }

    if (showPairingDialog && selectedDevice != null) {
        AlertDialog(
            onDismissRequest = { showPairingDialog = false },
            icon = { Icon(Icons.Filled.Lock, null, tint = MaterialTheme.colorScheme.primary) },
            title = { Text("Pair with ${selectedDevice.name}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Enter the six-digit code displayed in TurboCast Receiver Mode on the TV. The code authenticates and encrypts this local session.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = enteredCode,
                        onValueChange = { value -> enteredCode = value.filter(Char::isDigit).take(6) },
                        label = { Text("TV pairing code") },
                        placeholder = { Text("000000") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    enabled = enteredCode.length == 6,
                    onClick = {
                        showPairingDialog = false
                        onRequestCapture(selectedProfile, selectedBitrate, false, selectedDevice, enteredCode)
                        enteredCode = ""
                    }
                ) { Text("Continue to screen permission") }
            },
            dismissButton = { TextButton(onClick = { showPairingDialog = false }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun HeroCard(streamState: StreamUiState, isCast: Boolean, castPlayback: String, inProgress: Boolean, onConnect: () -> Unit) {
    val connectedLine = when (streamState) {
        is StreamUiState.Active -> if (isCast) castPlayback else "Encrypted link · ${streamState.receiverName}"
        is StreamUiState.Starting -> streamState.detail
        is StreamUiState.Failed -> streamState.reason
        else -> if (isCast) castPlayback else "Choose a discovered TurboCast receiver"
    }
    Card(
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.background(Brush.linearGradient(listOf(Color(0xFF153C32), Color(0xFF0C211C), Color(0xFF10211D)))).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(19.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                Surface(color = Color(0x3380F2CE), shape = CircleShape) {
                    Box(Modifier.size(11.dp).background(if (streamState is StreamUiState.Active) Color(0xFF80F2CE) else Color(0xFFFFC879), CircleShape))
                }
                Column {
                    Text(if (streamState is StreamUiState.Active) "MIRRORING" else if (streamState is StreamUiState.Starting) "CONNECTING" else "READY TO CONNECT", style = MaterialTheme.typography.labelMedium, color = Color(0xFF80F2CE), fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
                    Text(connectedLine, style = MaterialTheme.typography.bodySmall, color = Color(0xFFD1E1DA), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(if (inProgress) "Your screen is\non the big screen." else "Your screen.\nBigger picture.", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = Color.White, lineHeight = 36.sp)
                Text("Local Wi-Fi mirroring with AVC/H.264 encoding", style = MaterialTheme.typography.bodyMedium, color = Color(0xFFB5C9C0))
            }
            Button(
                onClick = onConnect,
                modifier = Modifier.fillMaxWidth().height(58.dp),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(containerColor = if (inProgress) Color(0xFF2C413A) else Color(0xFF80F2CE), contentColor = if (inProgress) Color.White else Color(0xFF07110F))
            ) {
                Icon(if (inProgress) Icons.Filled.Stop else Icons.Filled.PlayArrow, null, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(9.dp))
                Text(if (inProgress) "Stop mirroring" else "Connect to TV", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HeroPill(if (streamState is StreamUiState.Active && streamState.hardwareAccelerated) "H.264 hardware" else "H.264 encoder")
                HeroPill("Local network")
                HeroPill("No recording")
            }
        }
    }
}

@Composable
private fun HeroPill(text: String) {
    Surface(color = Color(0x1FFFFFFF), shape = RoundedCornerShape(50)) {
        Text(text, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.labelSmall, color = Color(0xFFD0E0D8), maxLines = 1)
    }
}

@Composable
private fun SectionHeading(number: String, title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(number, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun DestinationCard(modifier: Modifier, title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, selected: Boolean, onClick: () -> Unit) {
    Card(
        modifier = modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(19.dp),
        border = BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        colors = CardDefaults.cardColors(containerColor = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.09f) else MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, minLines = 2)
        }
    }
}

@Composable
private fun ReceiverPicker(
    devices: List<ReceiverDevice>,
    selectedId: String?,
    receiverStatus: String,
    onSelect: (String) -> Unit,
    onRefresh: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("TurboCast receivers", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(if (devices.isEmpty()) "Searching local network…" else "${devices.size} compatible receiver${if (devices.size == 1) "" else "s"} found", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Filled.Refresh, "Refresh receiver discovery", tint = MaterialTheme.colorScheme.primary) }
            }
            if (devices.isEmpty()) {
                Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f)) {
                    Row(Modifier.fillMaxWidth().padding(13.dp), horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Info, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                        Text("$receiverStatus\nOpen Receiver Mode on an Android TV running TurboCast 60. Ordinary TVs won't appear unless they have compatible receiver software.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                devices.forEach { device ->
                    val selected = selectedId == device.id
                    Surface(
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(15.dp)).clickable { onSelect(device.id) },
                        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                        shape = RoundedCornerShape(15.dp),
                        border = if (selected) BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)) else null
                    ) {
                        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                            Surface(color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f), shape = RoundedCornerShape(11.dp)) {
                                Icon(Icons.Filled.Tv, null, Modifier.padding(9.dp).size(19.dp), tint = MaterialTheme.colorScheme.primary)
                            }
                            Column(Modifier.weight(1f)) {
                                Text(device.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("Available · TurboCast TV receiver", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (selected) Icon(Icons.Filled.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }
            if (devices.isNotEmpty() && receiverStatus.contains("Could not", true)) Text(receiverStatus, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun CastReceiverCard(connected: Boolean, available: Boolean, playback: String, loadMessage: String?) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(color = MaterialTheme.colorScheme.primary.copy(alpha = 0.13f), shape = RoundedCornerShape(12.dp)) {
                    Icon(Icons.Filled.Cast, null, Modifier.padding(10.dp).size(21.dp), tint = MaterialTheme.colorScheme.primary)
                }
                Column(Modifier.weight(1f)) {
                    Text(if (connected) "Cast receiver selected" else "Find Google Cast receiver", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(if (connected) playback else if (!available) "Cast SDK isn't available on this phone" else "Tap the Cast icon to choose a Chromecast or Cast-enabled TV", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                CastRouteButton()
            }
            if (loadMessage != null) Text(loadMessage, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Cast sends a live HLS stream from this phone over Wi-Fi. Some receivers buffer more than others; this app does not report an estimated end-to-end delay.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 19.sp)
        }
    }
}

@Composable
private fun CastRouteButton() {
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f), modifier = Modifier.size(48.dp)) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context: Context ->
                MediaRouteButton(context).also { button ->
                    runCatching { CastButtonFactory.setUpMediaRouteButton(context, button) }
                }
            }
        )
    }
}

@Composable
private fun ProfilePicker(
    selected: StreamProfile,
    bitrate: Int,
    castMode: Boolean,
    onSelect: (StreamProfile) -> Unit,
    onBitrateChange: (Int) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        StreamProfile.entries.forEach { profile ->
            val active = selected == profile
            Surface(
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { onSelect(profile) },
                color = if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(if (active) 1.4.dp else 1.dp, if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.8f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
            ) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(18.dp).clip(CircleShape).background(if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                        if (active) Box(Modifier.size(7.dp).clip(CircleShape).background(MaterialTheme.colorScheme.onPrimary))
                    }
                    Column(Modifier.weight(1f)) {
                        Text(profile.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Text(profile.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (profile.adaptive) AssistChip(onClick = { onSelect(profile) }, label = { Text("AUTO") })
                }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(17.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(horizontal = 15.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Target bitrate", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Text(formatBitrate(bitrate), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                }
                Slider(
                    value = bitrate / 1_000_000f,
                    onValueChange = { onBitrateChange((it * 1_000_000).toInt()) },
                    valueRange = 1f..(selected.maxBitrate / 1_000_000f)
                )
                Text(
                    when {
                        castMode && selected.adaptive -> "Cast receivers do not report per-frame congestion here; Adaptive bitrate feedback is available with TurboCast TV receivers."
                        selected.adaptive -> "Starting target. The companion receiver can adjust bitrate/resolution from measured loss and RTT."
                        else -> "Encoder target only; the device may clamp this to a supported bitrate."
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun ActiveStreamCard(state: StreamUiState.Active) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("STREAM STATUS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                    Text(state.receiverName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(state.transport, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Surface(color = MaterialTheme.colorScheme.primary.copy(alpha = 0.13f), shape = CircleShape) {
                    Icon(Icons.Filled.CheckCircle, null, Modifier.padding(10.dp).size(22.dp), tint = MaterialTheme.colorScheme.primary)
                }
            }
            Text(
                "Encoder: ${state.encoderName} · ${if (state.hardwareAccelerated) "hardware accelerated" else "hardware acceleration not confirmed"} · target up to ${state.targetFps} FPS",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                MetricCell("OUTPUT", "${state.width}×${state.height}", Modifier.weight(1f))
                MetricCell("ENCODED FPS", if (state.encodedFps > 0) String.format(Locale.US, "%.0f", state.encodedFps) else "measuring", Modifier.weight(1f))
                MetricCell("TARGET BITRATE", formatBitrate(state.bitrate), Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                MetricCell("NETWORK RTT", state.rttMs?.let { "$it ms" } ?: "not reported", Modifier.weight(1f))
                MetricCell("PACKET LOSS", state.packetLossPercent?.let { String.format(Locale.US, "%.1f%%", it) } ?: "not reported", Modifier.weight(1f))
                MetricCell("WI-FI RSSI", state.wifiRssiDbm?.let { "$it dBm" } ?: "unavailable", Modifier.weight(1f))
            }
            state.note?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text("RTT is a measured network round trip, not end-to-end screen latency. FPS/bitrate are local encoder telemetry.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun MetricCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.clip(RoundedCornerShape(13.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, fontSize = 9.sp)
        Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun StatusCard(title: String, message: String, tint: Color) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, tint.copy(alpha = 0.42f)), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Filled.Info, null, tint = tint)
            Column {
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun NoticeCard(message: String, onDismiss: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant), shape = RoundedCornerShape(17.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Filled.Info, null, tint = MaterialTheme.colorScheme.primary)
            Text(message, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss) { Text("OK") }
        }
    }
}

private fun formatBitrate(bitsPerSecond: Int): String = when {
    bitsPerSecond <= 0 -> "—"
    bitsPerSecond >= 1_000_000 -> String.format(Locale.US, "%.1f Mbps", bitsPerSecond / 1_000_000.0)
    else -> "${bitsPerSecond / 1000} kbps"
}
