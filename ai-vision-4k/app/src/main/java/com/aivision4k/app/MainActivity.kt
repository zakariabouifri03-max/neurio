package com.aivision4k.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.aivision4k.app.settings.AppSettings
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AiVision4KTheme
import com.aivision4k.app.ui.DangerRed
import com.aivision4k.app.ui.GoodGreen
import com.aivision4k.app.ui.StrokeSoft
import com.aivision4k.app.ui.SurfaceNavy
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.TextPrimary
import com.aivision4k.app.ui.VoidBlack
import com.aivision4k.app.ui.compatColor
import com.aivision4k.app.ui.screens.AiEngineScreen
import com.aivision4k.app.ui.screens.BenchmarkScreen
import com.aivision4k.app.demo.DemoActivity
import com.aivision4k.app.ui.screens.DashboardScreen
import com.aivision4k.app.ui.screens.GamesScreen
import com.aivision4k.app.ui.screens.MonitorScreen
import com.aivision4k.app.ui.screens.ProfilesScreen
import com.aivision4k.app.ui.screens.SettingsScreen

class MainActivity : ComponentActivity() {

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* the app works either way */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AiVision4KTheme {
                AppRoot()
            }
        }
        maybeAskForNotifications()
    }

    /**
     * The monitoring foreground service shows a notification; on API 33+ that
     * needs a runtime permission. It is requested once, and a refusal only means
     * the readings stay inside the app — the thermal guard keeps working.
     */
    private fun maybeAskForNotifications() {
        if (Build.VERSION.SDK_INT < 33) return
        val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (granted) return
        val settings = AppSettings(this)
        if (settings.notificationPermissionAsked) return
        settings.notificationPermissionAsked = true
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

private enum class Tab(val label: String, val icon: ImageVector) {
    Dashboard("Dashboard", Icons.Default.Home),
    Games("Games", Icons.Default.PlayArrow),
    Profiles("Profiles", Icons.Default.Build),
    Monitor("Monitor", Icons.Default.Refresh),
    Engine("AI Engine", Icons.Default.Star),
}

private enum class Route { Settings, Benchmark }

@Composable
private fun AppRoot(vm: AppViewModel = viewModel()) {
    // The composition's context is the activity here; used to start the demo.
    val context = LocalContext.current
    val state = vm.state
    val snackbar = remember { SnackbarHostState() }
    var tab by remember { mutableStateOf(Tab.Dashboard) }
    var route by remember { mutableStateOf<Route?>(null) }

    LaunchedEffect(state.message) {
        val message = state.message
        if (message != null) {
            snackbar.showSnackbar(message)
            vm.dismissMessage()
        }
    }

    Scaffold(
        containerColor = VoidBlack,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar(containerColor = SurfaceNavy) {
                Tab.entries.forEach { entry ->
                    NavigationBarItem(
                        selected = route == null && tab == entry,
                        onClick = {
                            route = null
                            tab = entry
                        },
                        icon = { Icon(entry.icon, contentDescription = entry.label) },
                        label = { Text(entry.label, fontSize = 10.sp) },
                    )
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            AppHeader(
                vm = vm,
                onOpenSettings = { route = Route.Settings },
                onOpenBenchmark = { route = Route.Benchmark },
            )
            Box(modifier = Modifier.weight(1f)) {
                when (route) {
                    Route.Settings -> SettingsScreen(vm, onBack = { route = null })
                    Route.Benchmark -> BenchmarkScreen(vm, onBack = { route = null })
                    null -> when (tab) {
                        Tab.Dashboard -> DashboardScreen(
                            vm = vm,
                            onOpenBenchmark = { route = Route.Benchmark },
                            onOpenProfiles = { tab = Tab.Profiles },
                            onOpenGames = { tab = Tab.Games },
                            // Its own activity: the demo takes the whole screen,
                            // forces landscape and owns a Vulkan device, so it must
                            // not share a lifecycle with the dashboard. The context
                            // comes from the composition because AppRoot is a
                            // top-level composable, not a member of the activity --
                            // there is no Activity receiver to call startActivity on.
                            onOpenDemo = {
                                context.startActivity(Intent(context, DemoActivity::class.java))
                            },
                        )
                        Tab.Games -> GamesScreen(vm)
                        Tab.Profiles -> ProfilesScreen(vm)
                        Tab.Monitor -> MonitorScreen(vm)
                        Tab.Engine -> AiEngineScreen(vm)
                    }
                }
            }
        }
    }
}

@Composable
private fun AppHeader(vm: AppViewModel, onOpenSettings: () -> Unit, onOpenBenchmark: () -> Unit) {
    val state = vm.state
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(VoidBlack)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .background(if (state.engineReady) GoodGreen else DangerRed, CircleShape),
            )
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "AI VISION 4K",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary,
                    letterSpacing = 2.sp,
                )
                Text(
                    text = headerSubtitle(state),
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                )
            }
            IconButton(onClick = onOpenBenchmark) {
                Icon(Icons.Default.Info, contentDescription = "Benchmark", tint = TextMuted)
            }
            IconButton(onClick = onOpenSettings) {
                Icon(Icons.Default.Settings, contentDescription = "Settings", tint = TextMuted)
            }
        }
        val compatibility = state.compatibility
        if (compatibility != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                com.aivision4k.app.ui.StatusChip(
                    text = compatibility.status.label,
                    color = compatColor(compatibility.status),
                )
                com.aivision4k.app.ui.StatusChip(
                    text = "Tier: ${compatibility.tier.name}",
                    color = TextMuted,
                )
                val device = state.device
                if (device != null && device.vendor.isNotEmpty()) {
                    com.aivision4k.app.ui.StatusChip(
                        text = "${device.vendor} ${device.deviceName}".trim(),
                        color = AccentCyan,
                    )
                }
            }
        }
        if (state.engineError != null) {
            Spacer(Modifier.height(6.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DangerRed.copy(alpha = 0.12f))
                    .padding(8.dp),
            ) {
                Text(
                    text = state.engineError,
                    style = MaterialTheme.typography.labelSmall,
                    color = DangerRed,
                )
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp)
                .height(1.dp)
                .background(StrokeSoft),
        )
    }
}

private fun headerSubtitle(state: UiState): String {
    if (!state.engineReady) return "engine offline \u00b7 tap for details"
    val device = state.device
    val parts = mutableListOf<String>()
    parts.add("${state.snapshot?.engineVersion?.let { "v$it" } ?: "engine ready"}")
    if (device != null) {
        parts.add("Android ${device.sdkInt}")
        parts.add("${device.displayWidth}x${device.displayHeight} @ ${device.displayRefreshRate.toInt()} Hz")
    }
    return parts.joinToString(" \u00b7 ")
}
