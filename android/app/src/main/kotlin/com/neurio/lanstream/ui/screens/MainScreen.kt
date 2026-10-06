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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.neurio.lanstream.R
import com.neurio.lanstream.media.CodecCapabilities
import com.neurio.lanstream.ui.theme.NeonCyan
import com.neurio.lanstream.ui.theme.NeonPurple
import com.neurio.lanstream.ui.theme.SurfaceElevated
import com.neurio.lanstream.ui.theme.SurfaceOutline
import com.neurio.lanstream.ui.theme.TextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    onHost: () -> Unit,
    onJoin: () -> Unit,
    onSettings: () -> Unit,
    onAbout: () -> Unit,
    onDiagnostics: () -> Unit
) {
    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.main_title),
                        style = MaterialTheme.typography.displaySmall
                    )
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.main_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(20.dp))

            MenuCard(
                title = stringResource(R.string.main_host),
                description = stringResource(R.string.main_host_desc),
                icon = Icons.Default.Cast,
                accent = NeonPurple,
                onClick = onHost
            )
            Spacer(modifier = Modifier.height(12.dp))
            MenuCard(
                title = stringResource(R.string.main_join),
                description = stringResource(R.string.main_join_desc),
                icon = Icons.Default.SportsEsports,
                accent = NeonCyan,
                onClick = onJoin
            )
            Spacer(modifier = Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SmallMenuCard(
                    title = stringResource(R.string.main_settings),
                    icon = Icons.Default.Settings,
                    modifier = Modifier.weight(1f),
                    onClick = onSettings
                )
                Spacer(modifier = Modifier.width(12.dp))
                SmallMenuCard(
                    title = stringResource(R.string.main_about),
                    icon = Icons.Default.Info,
                    modifier = Modifier.weight(1f),
                    onClick = onAbout
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            SmallMenuCard(
                title = stringResource(R.string.main_diagnostics),
                icon = Icons.Default.Wifi,
                modifier = Modifier.fillMaxWidth(),
                onClick = onDiagnostics
            )

            Spacer(modifier = Modifier.weight(1f))
            CapabilityFooter()
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun MenuCard(
    title: String,
    description: String,
    icon: ImageVector,
    accent: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(
                Brush.horizontalGradient(
                    listOf(accent.copy(alpha = 0.22f), SurfaceElevated)
                )
            )
            .border(1.dp, SurfaceOutline, RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
            .padding(18.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(34.dp)
            )
            Spacer(modifier = Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = accent
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary
                )
            }
        }
    }
}

@Composable
private fun SmallMenuCard(
    title: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(SurfaceElevated)
            .border(1.dp, SurfaceOutline, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(imageVector = icon, contentDescription = null, tint = TextSecondary)
            Spacer(modifier = Modifier.width(8.dp))
            Text(text = title, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun CapabilityFooter() {
    val hardwareEncoder = CodecCapabilities.preferEncoder(CodecCapabilities.H264)?.let {
        CodecCapabilities.isHardware(it)
    } ?: false
    val hevc = CodecCapabilities.supportsHevcEncoding()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(SurfaceElevated)
            .border(1.dp, SurfaceOutline, RoundedCornerShape(12.dp))
            .padding(12.dp)
    ) {
        Text(
            text = stringResource(R.string.main_role_hint),
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "H.264 ${if (hardwareEncoder) "hardware" else "software"} encoder · " +
                "HEVC ${if (hevc) "available" else "n/a"}",
            style = MaterialTheme.typography.labelSmall,
            color = NeonCyan
        )
    }
}
