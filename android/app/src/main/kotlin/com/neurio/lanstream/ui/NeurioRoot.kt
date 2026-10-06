package com.neurio.lanstream.ui

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.neurio.lanstream.core.ClientBus
import com.neurio.lanstream.core.ClientPhase
import com.neurio.lanstream.discovery.HostEndpoint
import com.neurio.lanstream.games.GameApp
import com.neurio.lanstream.ui.screens.AboutScreen
import com.neurio.lanstream.ui.screens.ClientScreen
import com.neurio.lanstream.ui.screens.ControlsScreen
import com.neurio.lanstream.ui.screens.DiagnosticsScreen
import com.neurio.lanstream.ui.screens.HostScreen
import com.neurio.lanstream.ui.screens.MainScreen
import com.neurio.lanstream.ui.screens.SettingsScreen
import com.neurio.lanstream.ui.screens.StreamScreen

enum class Screen { MAIN, HOST, CLIENT, STREAM, SETTINGS, CONTROLS, ABOUT, DIAGNOSTICS }

/**
 * Everything the Compose tree is allowed to do to the rest of the app.
 * Keeping these as lambdas means the screens stay free of Context and of
 * Android framework details (except where a preview genuinely needs them).
 */
data class UiActions(
    val onStartHost: (GameApp?) -> Unit = {},
    val onStopHost: () -> Unit = {},
    val onLaunchGame: (GameApp) -> Unit = {},
    val onRotateCode: () -> Unit = {},
    val onConnect: (HostEndpoint, String) -> Unit = {},
    val onDisconnect: () -> Unit = {},
    val onOpenAccessibilitySettings: () -> Unit = {},
    val onOpenOverlaySettings: () -> Unit = {},
    val onOpenNotificationSettings: () -> Unit = {},
    val onCopy: (String) -> Unit = {}
)

@Composable
fun NeurioRoot(
    startScreen: Screen = Screen.MAIN,
    actions: UiActions
) {
    var screen by remember { mutableStateOf(startScreen) }
    val clientState by ClientBus.state.collectAsState()

    // Follow the session: entering/leaving a stream is driven by the service,
    // not by the UI, so we only react to it here.
    LaunchedEffect(clientState.phase) {
        when (clientState.phase) {
            ClientPhase.STREAMING -> if (screen != Screen.STREAM) screen = Screen.STREAM
            ClientPhase.IDLE -> if (screen == Screen.STREAM) screen = Screen.MAIN
            else -> Unit
        }
    }

    BackHandler(enabled = screen != Screen.MAIN) {
        screen = when (screen) {
            Screen.STREAM -> Screen.CLIENT
            Screen.CONTROLS -> Screen.SETTINGS
            else -> Screen.MAIN
        }
    }

    when (screen) {
        Screen.MAIN -> MainScreen(
            onHost = { screen = Screen.HOST },
            onJoin = { screen = Screen.CLIENT },
            onSettings = { screen = Screen.SETTINGS },
            onAbout = { screen = Screen.ABOUT },
            onDiagnostics = { screen = Screen.DIAGNOSTICS }
        )
        Screen.HOST -> HostScreen(actions = actions, onBack = { screen = Screen.MAIN })
        Screen.CLIENT -> ClientScreen(actions = actions, onBack = { screen = Screen.MAIN })
        Screen.STREAM -> StreamScreen(actions = actions, onExit = { screen = Screen.CLIENT })
        Screen.SETTINGS -> SettingsScreen(
            onBack = { screen = Screen.MAIN },
            onControls = { screen = Screen.CONTROLS }
        )
        Screen.CONTROLS -> ControlsScreen(onBack = { screen = Screen.SETTINGS })
        Screen.ABOUT -> AboutScreen(onBack = { screen = Screen.MAIN })
        Screen.DIAGNOSTICS -> DiagnosticsScreen(
            onBack = { screen = Screen.MAIN },
            onCopy = actions.onCopy
        )
    }
}
