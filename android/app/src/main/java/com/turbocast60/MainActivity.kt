package com.turbocast60

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.turbocast60.capture.ScreenCaptureService
import com.turbocast60.capture.StreamUiState
import com.turbocast60.capture.StreamStateStore
import com.turbocast60.model.ReceiverDevice
import com.turbocast60.model.StreamProfile
import com.turbocast60.network.ReceiverDiscovery
import com.turbocast60.receiver.ReceiverActivity
import com.turbocast60.ui.TurboCastHomeScreen
import com.turbocast60.ui.TurboCastOnboardingScreen
import com.turbocast60.ui.theme.TurboCastTheme

private data class CaptureRequest(
    val profile: StreamProfile,
    val bitrate: Int,
    val cast: Boolean,
    val receiver: ReceiverDevice? = null,
    val pairingCode: String = ""
)

class MainActivity : ComponentActivity() {
    private lateinit var discovery: ReceiverDiscovery
    private var castContext: CastContext? = null
    private var castSession: CastSession? = null
    private var isCastConnected by mutableStateOf(false)
    private var castAvailable by mutableStateOf(false)
    private var castPlayback by mutableStateOf("Choose a Google Cast receiver")
    private var castLoadMessage by mutableStateOf<String?>(null)
    private var lastCastUrl: String? = null
    private var castCallbackClient: RemoteMediaClient? = null

    private val remoteMediaCallback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() = updateCastPlayback()
        override fun onMetadataUpdated() = updateCastPlayback()
    }

    private val sessionManagerListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) { castPlayback = "Connecting to Cast receiver…" }
        override fun onSessionStarted(session: CastSession, sessionId: String) { activateCastSession(session) }
        override fun onSessionStartFailed(session: CastSession, error: Int) {
            clearCastSession()
            castLoadMessage = "Google Cast could not start. Verify the receiver and Wi-Fi."
        }
        override fun onSessionEnding(session: CastSession) { castPlayback = "Disconnecting from Cast receiver…" }
        override fun onSessionEnded(session: CastSession, error: Int) {
            clearCastSession()
            val active = StreamStateStore.state.value
            if ((active is StreamUiState.Active && active.transport.startsWith("Google Cast")) ||
                (active is StreamUiState.Starting && active.detail.contains("Google Cast"))) ScreenCaptureService.stop(this@MainActivity)
        }
        override fun onSessionResuming(session: CastSession, sessionId: String) { castPlayback = "Reconnecting to Cast receiver…" }
        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) { activateCastSession(session) }
        override fun onSessionResumeFailed(session: CastSession, error: Int) {
            clearCastSession()
            castLoadMessage = "Cast reconnection failed. Select the receiver again."
        }
        override fun onSessionSuspended(session: CastSession, reason: Int) { castPlayback = "Cast connection paused" }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        discovery = ReceiverDiscovery(this)
        castContext = runCatching { CastContext.getSharedInstance(applicationContext) }.getOrNull()
        castAvailable = castContext != null

        setContent {
            val devices by discovery.devices.collectAsStateWithLifecycle()
            val discoveryStatus by discovery.status.collectAsStateWithLifecycle()
            val streamState by StreamStateStore.state.collectAsStateWithLifecycle()
            var showOnboarding by remember { mutableStateOf(!getPreferences(MODE_PRIVATE).getBoolean(KEY_ONBOARDING_DONE, false)) }
            var darkTheme by remember { mutableStateOf(getPreferences(MODE_PRIVATE).getBoolean(KEY_DARK_THEME, true)) }
            var captureRequest by remember { mutableStateOf<CaptureRequest?>(null) }

            val captureLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                val request = captureRequest
                captureRequest = null
                if (result.resultCode != RESULT_OK || result.data == null || request == null) {
                    Toast.makeText(this@MainActivity, "Screen sharing was not started. No capture is active.", Toast.LENGTH_SHORT).show()
                } else if (request.cast && !isCastConnected) {
                    Toast.makeText(this@MainActivity, "Cast disconnected before screen sharing was approved. Select the receiver and retry.", Toast.LENGTH_LONG).show()
                } else if (request.cast) {
                    ScreenCaptureService.startCast(this@MainActivity, result.resultCode, result.data!!, request.profile, request.bitrate)
                } else {
                    val target = request.receiver
                    if (target == null) {
                        Toast.makeText(this@MainActivity, "Select a TurboCast receiver first.", Toast.LENGTH_SHORT).show()
                    } else {
                        ScreenCaptureService.startDirect(
                            this@MainActivity,
                            result.resultCode,
                            result.data!!,
                            request.profile,
                            request.bitrate,
                            target.name,
                            target.host,
                            target.port,
                            request.pairingCode
                        )
                    }
                }
            }

            val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
                // NSD discovery is attempted either way; Android can still report a permission denial per device.
                discovery.start()
            }

            androidx.compose.runtime.LaunchedEffect(Unit) {
                val requested = buildList {
                    if (Build.VERSION.SDK_INT >= 33) {
                        add(Manifest.permission.NEARBY_WIFI_DEVICES)
                        add(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
                val missing = requested.filter { ContextCompat.checkSelfPermission(this@MainActivity, it) != PackageManager.PERMISSION_GRANTED }
                if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray()) else discovery.start()
            }

            androidx.compose.runtime.LaunchedEffect(streamState) {
                val url = (streamState as? StreamUiState.Active)?.castUrl
                if (url != null) loadCastStream(url)
                if (url == null && streamState is StreamUiState.Idle) lastCastUrl = null
            }

            TurboCastTheme(darkTheme = darkTheme) {
                if (showOnboarding) {
                    TurboCastOnboardingScreen(onFinish = {
                        getPreferences(MODE_PRIVATE).edit().putBoolean(KEY_ONBOARDING_DONE, true).apply()
                        showOnboarding = false
                    })
                } else {
                    TurboCastHomeScreen(
                        devices = devices,
                        streamState = streamState,
                        castConnected = isCastConnected,
                        castAvailable = castAvailable,
                        castPlayback = castPlayback,
                        castLoadMessage = castLoadMessage,
                        darkTheme = darkTheme,
                        receiverStatus = discoveryStatus,
                        onDarkThemeChange = {
                            darkTheme = it
                            getPreferences(MODE_PRIVATE).edit().putBoolean(KEY_DARK_THEME, it).apply()
                        },
                        onRefreshDiscovery = discovery::restart,
                        onOpenReceiverMode = { startActivity(Intent(this@MainActivity, ReceiverActivity::class.java)) },
                        onRequestCapture = { profile, bitrate, cast, receiver, pin ->
                            if (cast && !isCastConnected) {
                                Toast.makeText(this@MainActivity, "Choose a Cast receiver with the cast button first.", Toast.LENGTH_LONG).show()
                            } else {
                                captureRequest = CaptureRequest(profile, bitrate, cast, receiver, pin)
                                val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                                captureLauncher.launch(manager.createScreenCaptureIntent())
                            }
                        },
                        onStop = {
                            if (isCastConnected) runCatching { castSession?.remoteMediaClient?.stop() }
                            ScreenCaptureService.stop(this@MainActivity)
                        }
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val context = castContext ?: return
        runCatching {
            context.sessionManager.addSessionManagerListener(sessionManagerListener, CastSession::class.java)
            context.sessionManager.currentCastSession?.let(::activateCastSession)
        }.onFailure {
            castAvailable = false
            castLoadMessage = "Google Play services Cast support is not available on this device."
        }
    }

    override fun onStop() {
        castContext?.let { context ->
            runCatching { context.sessionManager.removeSessionManagerListener(sessionManagerListener, CastSession::class.java) }
        }
        detachRemoteClient()
        super.onStop()
    }

    override fun onDestroy() {
        discovery.close()
        super.onDestroy()
    }

    private fun activateCastSession(session: CastSession) {
        detachRemoteClient()
        castSession = session
        isCastConnected = session.isConnected
        castPlayback = if (session.isConnected) "Connected · waiting for a stream" else "Connecting to Cast receiver…"
        session.remoteMediaClient?.let { client ->
            castCallbackClient = client
            client.registerCallback(remoteMediaCallback)
        }
        castLoadMessage = null
        lastCastUrl?.let(::loadCastStream)
        updateCastPlayback()
    }

    private fun clearCastSession() {
        detachRemoteClient()
        castSession = null
        isCastConnected = false
        castPlayback = "Choose a Google Cast receiver"
        lastCastUrl = null
    }

    private fun detachRemoteClient() {
        castCallbackClient?.unregisterCallback(remoteMediaCallback)
        castCallbackClient = null
    }

    private fun loadCastStream(url: String) {
        if (url == lastCastUrl && isCastConnected) return
        val session = castSession?.takeIf { it.isConnected } ?: return
        val client = session.remoteMediaClient ?: return
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
            putString(MediaMetadata.KEY_TITLE, "TurboCast 60 · Live screen")
            putString(MediaMetadata.KEY_SUBTITLE, "Local network screen mirror")
        }
        val media = MediaInfo.Builder(url)
            .setStreamType(MediaInfo.STREAM_TYPE_LIVE)
            .setContentType("application/x-mpegURL")
            .setMetadata(metadata)
            .build()
        lastCastUrl = url
        castLoadMessage = "Requesting the live stream from the Cast receiver…"
        runCatching {
            client.load(media, true).setResultCallback { result ->
                if (!result.status.isSuccess) {
                    castLoadMessage = "Cast rejected the live HLS stream. Check receiver support and network isolation."
                } else {
                    castLoadMessage = "Load accepted by Cast; waiting for actual playback status."
                }
                updateCastPlayback()
            }
        }.onFailure {
            lastCastUrl = null
            castLoadMessage = "Could not send the stream to this Cast receiver."
        }
    }

    private fun updateCastPlayback() {
        val mediaStatus = castSession?.remoteMediaClient?.mediaStatus
        castPlayback = when (mediaStatus?.playerState) {
            MediaStatus.PLAYER_STATE_PLAYING -> "Playing on Google Cast"
            MediaStatus.PLAYER_STATE_BUFFERING -> "Cast receiver is buffering"
            MediaStatus.PLAYER_STATE_PAUSED -> "Paused on Google Cast"
            MediaStatus.PLAYER_STATE_IDLE -> if (isCastConnected) "Connected · waiting for a stream" else "Choose a Google Cast receiver"
            else -> if (isCastConnected) "Connected · playback status not reported yet" else "Choose a Google Cast receiver"
        }
    }

    companion object {
        private const val KEY_ONBOARDING_DONE = "onboarding_done"
        private const val KEY_DARK_THEME = "dark_theme"
    }
}
