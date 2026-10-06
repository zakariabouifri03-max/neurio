package com.neurio.lanstream.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.neurio.lanstream.R
import com.neurio.lanstream.core.ClientBus
import com.neurio.lanstream.input.PadLayout
import com.neurio.lanstream.platform.ClientController
import com.neurio.lanstream.platform.neurioApp
import com.neurio.lanstream.ui.UiActions
import com.neurio.lanstream.ui.components.GameSurface
import com.neurio.lanstream.ui.components.VirtualGamepad
import com.neurio.lanstream.ui.theme.NeonCyan

/**
 * Fullscreen streamed gameplay.
 *
 * The decoded frames are rendered by the hardware decoder straight into the
 * SurfaceView below; everything drawn by Compose is just an overlay.
 */
@Composable
fun StreamScreen(actions: UiActions, onExit: () -> Unit) {
    val context = LocalContext.current
    val stats by ClientBus.stats.collectAsState()
    val state by ClientBus.state.collectAsState()
    val settings by context.neurioApp.settings.settings.collectAsState()
    var controlsVisible by remember { mutableStateOf(true) }
    val padLayout = remember(settings.controlLayoutJson) {
        PadLayout.fromJson(settings.controlLayoutJson)
    }
    val aspect = remember(stats.resolution) { aspectOf(stats.resolution) }

    DisposableEffect(Unit) {
        onDispose { ClientController.attachSurface(null) }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        val screenRatio = (maxWidth.value / maxHeight.value).coerceAtLeast(0.1f)
        val videoModifier = if (aspect > screenRatio) {
            Modifier.fillMaxWidth().aspectRatio(aspect)
        } else {
            Modifier.fillMaxHeight().aspectRatio(aspect)
        }

        Box(modifier = videoModifier.align(Alignment.Center)) {
            GameSurface(
                modifier = Modifier.fillMaxSize(),
                onSurfaceChanged = { surface -> ClientController.attachSurface(surface) }
            )
            if (controlsVisible && state.videoReady) {
                VirtualGamepad(
                    layout = padLayout,
                    onTouch = { event -> ClientController.sendTouch(event) }
                )
            }
        }

        // Tap anywhere to toggle the controls (indication disabled: nothing
        // should flash on top of the game).
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) { controlsVisible = !controlsVisible }
        )

        StatsOverlay(
            fps = stats.fps.toInt(),
            pingMs = stats.pingMs,
            bitrateMbps = stats.bitrateBps / 1_000_000f,
            latencyMs = stats.latencyMs.toInt(),
            visible = settings.showStats,
            modifier = Modifier.align(Alignment.TopEnd)
        )

        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onExit) {
                Icon(
                    imageVector = Icons.Default.ArrowBack,
                    contentDescription = stringResource(R.string.common_back),
                    tint = Color.White
                )
            }
            IconButton(onClick = actions.onDisconnect) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = stringResource(R.string.client_disconnect),
                    tint = Color.White
                )
            }
        }

        if (!state.videoReady) {
            Text(
                text = stringResource(R.string.stream_waiting),
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White,
                modifier = Modifier.align(Alignment.Center)
            )
        } else if (!controlsVisible) {
            Text(
                text = stringResource(R.string.stream_tap_hint),
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xAAFFFFFF),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 24.dp)
            )
        }
    }
}

@Composable
private fun StatsOverlay(
    fps: Int,
    pingMs: Long,
    bitrateMbps: Float,
    latencyMs: Int,
    visible: Boolean,
    modifier: Modifier = Modifier
) {
    if (!visible) return
    Surface(
        color = Color(0x990B0B14),
        shape = RoundedCornerShape(10.dp),
        modifier = modifier.padding(10.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "$fps fps",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White
            )
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = "$pingMs ms",
                style = MaterialTheme.typography.labelSmall,
                color = NeonCyan
            )
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = "%.1f Mbps".format(bitrateMbps),
                style = MaterialTheme.typography.labelSmall,
                color = Color.White
            )
            if (latencyMs > 0) {
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = "~$latencyMs ms lag",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFA3E635)
                )
            }
            Spacer(modifier = Modifier.size(0.dp))
        }
    }
}

private fun aspectOf(resolution: String): Float {
    val parts = resolution.split('x')
    if (parts.size != 2) return 16f / 9f
    val width = parts[0].trim().toFloatOrNull() ?: return 16f / 9f
    val height = parts[1].trim().toFloatOrNull() ?: return 16f / 9f
    if (height <= 0f) return 16f / 9f
    return width / height
}
