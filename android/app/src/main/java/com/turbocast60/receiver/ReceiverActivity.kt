package com.turbocast60.receiver

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import com.turbocast60.ui.theme.TurboCastTheme
import java.util.Locale

class ReceiverActivity : ComponentActivity() {
    private lateinit var receiverServer: ReceiverServer
    private val nearbyPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) receiverServer.start()
        else ReceiverStateStore.publish(ReceiverUiState(status = "Nearby devices permission is needed to advertise this receiver on Wi-Fi"))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        receiverServer = ReceiverServer(this)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
            nearbyPermissionLauncher.launch(Manifest.permission.NEARBY_WIFI_DEVICES)
        } else {
            receiverServer.start()
        }
        setContent {
            val state by ReceiverStateStore.state.collectAsStateWithLifecycle()
            TurboCastTheme(darkTheme = true) {
                ReceiverScreen(
                    state = state,
                    onBack = { finish() },
                    onSurfaceReady = receiverServer::attachSurface
                )
            }
        }
    }

    override fun onDestroy() {
        if (::receiverServer.isInitialized) receiverServer.close()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }
}

@Composable
private fun ReceiverScreen(state: ReceiverUiState, onBack: () -> Unit, onSurfaceReady: (android.view.Surface?) -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                SurfaceView(context).apply {
                    holder.addCallback(object : SurfaceHolder.Callback {
                        override fun surfaceCreated(holder: SurfaceHolder) { onSurfaceReady(holder.surface) }
                        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) { onSurfaceReady(holder.surface) }
                        override fun surfaceDestroyed(holder: SurfaceHolder) { onSurfaceReady(null) }
                    })
                }
            }
        )
        Column(
            modifier = Modifier.fillMaxWidth().align(Alignment.TopStart).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                Surface(color = Color(0xFF80F2CE), shape = RoundedCornerShape(14.dp)) {
                    Icon(Icons.Filled.Tv, null, Modifier.padding(10.dp).size(22.dp), tint = Color(0xFF07110F))
                }
                Column {
                    Text("TURBOCAST TV", style = MaterialTheme.typography.labelMedium, color = Color(0xFF80F2CE), fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp)
                    Text("Secure local receiver", style = MaterialTheme.typography.bodySmall, color = Color(0xFFB8C8C1))
                }
            }
            if (state.connected && state.width != null && state.height != null) {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xCC0D1916)), shape = RoundedCornerShape(17.dp)) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 11.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("${state.width}×${state.height}  ·  ${String.format(Locale.US, "%.0f", state.fps)} decoded FPS", color = Color.White, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Text("Packet loss ${String.format(Locale.US, "%.1f%%", state.lossPercent)} · live receiver statistics", color = Color(0xFFB8C8C1), style = MaterialTheme.typography.labelSmall)
                    }
                }
            } else {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xDD0D1916)), shape = RoundedCornerShape(23.dp)) {
                    Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Filled.Lock, null, tint = Color(0xFF80F2CE))
                            Text("PAIR THIS RECEIVER", style = MaterialTheme.typography.labelMedium, color = Color(0xFF80F2CE), fontWeight = FontWeight.Bold, letterSpacing = 1.3.sp)
                        }
                        Text(state.pairingCode, style = MaterialTheme.typography.displayMedium, color = Color.White, fontWeight = FontWeight.Bold, letterSpacing = 8.sp)
                        Text(state.status, style = MaterialTheme.typography.bodyMedium, color = Color(0xFFD0DDD7))
                        Text("On the phone, choose this TurboCast TV and enter the code above. The code is used to authenticate the encrypted session.", style = MaterialTheme.typography.bodySmall, color = Color(0xFFB8C8C1), lineHeight = 20.sp)
                    }
                }
            }
        }
        Row(
            modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(22.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text("${state.status}", style = MaterialTheme.typography.labelMedium, color = Color(0xFFB8C8C1), maxLines = 1)
            Button(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(7.dp))
                Text("Exit receiver")
            }
        }
    }
}
