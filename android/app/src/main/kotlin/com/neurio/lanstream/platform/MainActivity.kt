package com.neurio.lanstream.platform

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.neurio.lanstream.core.ClientBus
import com.neurio.lanstream.core.ClientPhase
import com.neurio.lanstream.core.HostBus
import com.neurio.lanstream.core.HostPhase
import com.neurio.lanstream.games.GameApp
import com.neurio.lanstream.games.GameLibrary
import com.neurio.lanstream.input.GamepadReader
import com.neurio.lanstream.input.InputEvent
import com.neurio.lanstream.ui.NeurioRoot
import com.neurio.lanstream.ui.Screen
import com.neurio.lanstream.ui.UiActions
import com.neurio.lanstream.ui.theme.NeurioTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Single activity of the prototype.
 *
 * It owns everything that *must* live in an Activity:
 *   * the MediaProjection consent dialog (Android forces this);
 *   * runtime permissions;
 *   * physical gamepad capture;
 *   * orientation while a stream is being played.
 */
class MainActivity : ComponentActivity() {

    private var pendingGame: GameApp? = null

    private val captureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            if (result.resultCode == Activity.RESULT_OK && data != null) {
                HostController.start(this, result.resultCode, data, pendingGame)
                val game = pendingGame
                pendingGame = null
                if (game != null) {
                    // Give the capture a moment to start before the game covers
                    // the screen, so the very first frames are already the game.
                    lifecycleScope.launch {
                        delay(CAPTURE_SETTLE_MS)
                        launchGame(game)
                    }
                }
            } else {
                pendingGame = null
                HostBus.updateState {
                    copy(
                        phase = HostPhase.ERROR,
                        message = getString(com.neurio.lanstream.R.string.host_capture_denied)
                    )
                }
            }
        }

    private val notificationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            com.neurio.lanstream.core.Log.i("Notification permission granted: $granted")
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        observeClientPhase()

        setContent {
            NeurioTheme {
                NeurioRoot(
                    startScreen = screenFromIntent(intent),
                    actions = uiActions()
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    private fun uiActions(): UiActions = UiActions(
        onStartHost = { game -> startHost(game) },
        onStopHost = { HostController.stop(this) },
        onLaunchGame = { game -> launchGame(game) },
        onRotateCode = { HostController.rotateCode() },
        onConnect = { endpoint, code -> ClientController.connect(this, endpoint, code) },
        onDisconnect = { ClientController.disconnect(this) },
        onOpenAccessibilitySettings = {
            runCatching { startActivity(Permissions.accessibilitySettingsIntent()) }
        },
        onOpenOverlaySettings = {
            runCatching { startActivity(Permissions.overlaySettingsIntent(this)) }
        },
        onOpenNotificationSettings = {
            runCatching { startActivity(Permissions.notificationSettingsIntent(this)) }
        },
        onCopy = { text -> copyText(text) }
    )

    // ------------------------------------------------------------------ hosting

    private fun startHost(game: GameApp?) {
        pendingGame = game
        val manager = getSystemService(MediaProjectionManager::class.java)
        captureLauncher.launch(manager.createScreenCaptureIntent())
    }

    private fun launchGame(game: GameApp) {
        // Standard, permission-free launch: exactly what the home screen does.
        // The game runs locally on this phone - the client never receives it.
        val started = GameLibrary.launch(this, game.packageName)
        com.neurio.lanstream.core.Log.i("Launched ${game.packageName}: $started")
    }

    // ------------------------------------------------------------- gamepad input

    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
        if (ClientController.isStreaming() && GamepadReader.isGamepadEvent(ev)) {
            ClientController.sendGamepad(GamepadReader.read(ev))
            return true
        }
        return super.dispatchGenericMotionEvent(ev)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (ClientController.isStreaming() && GamepadReader.isGamepadKey(event)) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> ClientController.updateKeyMask(event.keyCode, true)
                KeyEvent.ACTION_UP -> ClientController.updateKeyMask(event.keyCode, false)
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // ---------------------------------------------------------------- plumbing

    private fun observeClientPhase() {
        lifecycleScope.launch {
            ClientBus.state.collect { state ->
                requestedOrientation = if (state.phase == ClientPhase.STREAMING) {
                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                } else {
                    ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (!Permissions.hasNotificationPermission(this)) {
                notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun screenFromIntent(intent: Intent?): Screen {
        return when (intent?.getStringExtra(EXTRA_OPEN)) {
            OPEN_HOST -> Screen.HOST
            OPEN_CLIENT -> Screen.CLIENT
            OPEN_STREAM -> if (ClientBus.state.value.phase == ClientPhase.STREAMING) {
                Screen.STREAM
            } else {
                Screen.CLIENT
            }
            else -> Screen.MAIN
        }
    }

    private fun copyText(text: String) {
        val manager = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
        manager?.setPrimaryClip(android.content.ClipData.newPlainText("neurio", text))
    }

    companion object {
        const val EXTRA_OPEN = "open"
        const val OPEN_HOST = "host"
        const val OPEN_CLIENT = "client"
        const val OPEN_STREAM = "stream"
        private const val CAPTURE_SETTLE_MS = 600L

        /** Debug hook so `adb shell` can fake an input event on a rooted host. */
        fun debugInputEvent(): InputEvent = InputEvent.Key(KeyEvent.KEYCODE_BACK, true)
    }
}
