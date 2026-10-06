package com.neurio.lanstream.platform

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.neurio.lanstream.R
import com.neurio.lanstream.core.AudioStatus
import com.neurio.lanstream.core.FpsMeter
import com.neurio.lanstream.core.HostBus
import com.neurio.lanstream.core.HostPhase
import com.neurio.lanstream.core.HostStats
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.core.NetworkInfo
import com.neurio.lanstream.core.SessionManager
import com.neurio.lanstream.discovery.AdvertiseInfo
import com.neurio.lanstream.games.GameApp
import com.neurio.lanstream.input.InputEvent
import com.neurio.lanstream.input.InputInjector
import com.neurio.lanstream.input.InputInjectors
import com.neurio.lanstream.input.InputReceiver
import com.neurio.lanstream.input.OverlayInputInjector
import com.neurio.lanstream.input.PadLayout
import com.neurio.lanstream.input.RemoteInputController
import com.neurio.lanstream.media.AdaptiveController
import com.neurio.lanstream.media.AudioProfile
import com.neurio.lanstream.media.HostPipeline
import com.neurio.lanstream.media.StreamProfile
import com.neurio.lanstream.net.ControlMessages
import com.neurio.lanstream.net.ControlServer
import com.neurio.lanstream.net.ControlSession
import com.neurio.lanstream.net.Protocol
import com.neurio.lanstream.net.StreamServer
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * HOST MODE (phone 2).
 *
 * Responsibilities
 *   1. own the MediaProjection session (foreground service, type mediaProjection);
 *   2. advertise itself over mDNS + UDP beacon so phone 1 can find it;
 *   3. run the pairing handshake and reject unknown clients;
 *   4. start the capture/encode pipeline once the client says "ready";
 *   5. receive input and hand it to the best available [InputInjector];
 *   6. publish live statistics and adapt the bitrate to the Wi-Fi.
 */
class HostStreamService : LifecycleService() {

    private lateinit var sessionManager: SessionManager

    private val fpsMeter = FpsMeter()

    @Volatile
    private var projection: MediaProjection? = null

    @Volatile
    private var controlServer: ControlServer? = null

    @Volatile
    private var streamServer: StreamServer? = null

    @Volatile
    private var pipeline: HostPipeline? = null

    @Volatile
    private var inputReceiver: InputReceiver? = null

    @Volatile
    private var remoteInput: RemoteInputController? = null

    @Volatile
    private var injector: InputInjector? = null

    @Volatile
    private var overlayInjector: OverlayInputInjector? = null

    @Volatile
    private var adaptive: AdaptiveController? = null

    @Volatile
    private var displayListener: DisplayManager.DisplayListener? = null

    @Volatile
    private var statsJob: Job? = null

    @Volatile
    private var gameName: String? = null

    @Volatile
    private var gamePackage: String? = null

    @Volatile
    private var audioStatus: AudioStatus = AudioStatus.UNKNOWN

    @Volatile
    private var clientLoss = 0f

    @Volatile
    private var clientRttMs = 0L

    @Volatile
    private var clientDroppedFps = 0f

    @Volatile
    private var clientReportedFps = 0f

    @Volatile
    private var playerLayout: PadLayout = PadLayout.default()

    @Volatile
    private var lastAdaptiveBitrate = 0

    private val hostName: String
        get() = neurioApp.settings.current.deviceName.ifBlank { NetworkInfo.deviceName() }

    // --------------------------------------------------------------- lifecycle

    override fun onCreate() {
        super.onCreate()
        sessionManager = SessionManager()
        HostController.attach(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_START -> startHost(intent)
            ACTION_STOP, ACTION_STOP_ALT -> stopHost("host_stopped")
        }
        return START_NOT_STICKY
    }

    private fun startHost(intent: Intent) {
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }
        gamePackage = intent.getStringExtra(EXTRA_GAME_PACKAGE)
        gameName = intent.getStringExtra(EXTRA_GAME_NAME)

        if (resultCode != Activity.RESULT_OK || data == null) {
            Log.w("Screen capture permission was not granted")
            HostBus.updateState {
                copy(phase = HostPhase.ERROR, message = getString(R.string.host_capture_denied))
            }
            stopHost("permission_denied")
            return
        }

        startForegroundCompat()

        val manager = getSystemService(MediaProjectionManager::class.java)
        val mediaProjection = manager.getMediaProjection(resultCode, data)
        mediaProjection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                Log.i("MediaProjection stopped by the system")
                stopHost("projection_stopped")
            }
        }, Handler(Looper.getMainLooper()))
        projection = mediaProjection

        injector = InputInjectors.create(this, neurioApp.settings.current.inputMode)
        if (injector is OverlayInputInjector) overlayInjector = injector as OverlayInputInjector

        startAdvertising()
        startControlServer()
        registerDisplayListener()
        publishState(HostPhase.WAITING)
        Log.i("Host service started, waiting for a player")
    }

    private fun startForegroundCompat() {
        val notification = Notifications.host(
            this,
            getString(R.string.host_notif_title),
            getString(R.string.host_waiting)
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                ServiceCompat.startForeground(
                    this,
                    Notifications.HOST_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
                return
            } catch (se: SecurityException) {
                Log.w("Typed startForeground refused: ${se.message}")
            }
        }
        startForeground(Notifications.HOST_ID, notification)
    }

    // --------------------------------------------------------------- discovery

    private fun startAdvertising() {
        neurioApp.discovery.advertise(
            AdvertiseInfo(
                name = hostName,
                controlPort = Protocol.CONTROL_PORT,
                gameName = gameName,
                busy = false
            )
        )
    }

    // ----------------------------------------------------------- control plane

    private fun startControlServer() {
        controlServer?.stop()
        controlServer = ControlServer(
            port = Protocol.CONTROL_PORT,
            sessionManager = sessionManager,
            hostName = hostName,
            listener = controlListener
        ).also { it.start(lifecycleScope) }
    }

    private val controlListener = object : ControlServer.Listener {

        override fun buildAuthOk(
            session: ControlSession,
            clientName: String?,
            layoutJson: String?
        ): JSONObject {
            playerLayout = PadLayout.fromJson(layoutJson)
            val settings = neurioApp.settings.current
            val profile = sessionManager.profile ?: HostPipeline.profileFor(this@HostStreamService, settings)
            sessionManager.profile = profile
            sessionManager.audioProfile = AudioProfile()

            val server = StreamServer(sessionManager.sessionId, sessionManager.token)
            server.open(profile.mime, AudioProfile().mime)
            streamServer = server

            val receiver = InputReceiver(
                sessionId = sessionManager.sessionId,
                token = sessionManager.token,
                onEvent = { event -> remoteInput?.onEvent(event) },
                onPing = { clientSendMs, hostReceiveMs ->
                    server.sendPong(clientSendMs, hostReceiveMs)
                },
                onRejected = { Log.w("Dropped an input datagram with a bad session token") }
            )
            inputReceiver = receiver
            server.startInputReceiver(lifecycleScope, receiver)

            publishState(HostPhase.WAITING)
            return ControlMessages.authOk(
                sessionId = sessionManager.sessionId,
                token = sessionManager.token,
                video = profile,
                audio = AudioProfile(),
                audioEnabled = settings.audioEnabled,
                gameName = gameName,
                screenWidth = pipeline?.screenSize()?.first ?: profile.width,
                screenHeight = pipeline?.screenSize()?.second ?: profile.height,
                padLayout = null
            )
        }

        override fun onClientReady(
            session: ControlSession,
            videoPort: Int,
            audioPort: Int,
            inputPort: Int
        ) {
            if (videoPort <= 0) {
                Log.w("Client reported no video port")
                return
            }
            streamServer?.setClient(session.remoteAddress.address, videoPort, audioPort, inputPort)
            startPipeline()
            controlServer?.sendToClient(
                ControlMessages.inputStatus(
                    mode = injector?.mode?.name ?: "AUTO",
                    note = InputInjectors.limitationNote(injector?.mode ?: com.neurio.lanstream.core.InputMode.AUTO),
                    available = injector?.isAvailable() ?: false
                )
            )
            startAdvertising()
            publishState(HostPhase.STREAMING)
            Log.i("Session started with ${session.clientName} (${session.remoteAddress.address.hostAddress})")
        }

        override fun onKeyframeRequested(session: ControlSession) {
            pipeline?.requestKeyframe()
        }

        override fun onClientStats(session: ControlSession, json: JSONObject) {
            clientReportedFps = json.optDouble("fps", 0.0).toFloat()
            clientLoss = json.optDouble("loss", 0.0).toFloat()
            clientDroppedFps = json.optDouble("drops", 0.0).toFloat()
            clientRttMs = json.optLong("rtt", 0L)
        }

        override fun onClientDisconnected(session: ControlSession, reason: String) {
            Log.i("Client disconnected: $reason")
            stopSession()
            startAdvertising()
            publishState(HostPhase.WAITING)
        }
    }

    // ------------------------------------------------------------ media plane

    private val mediaSink = object : HostPipeline.Sink {
        override fun sendVideo(
            payload: ByteArray,
            isConfig: Boolean,
            isKeyframe: Boolean,
            ptsUs: Long,
            captureWallMs: Long
        ) {
            streamServer?.video()?.sendFrame(payload, ptsUs, captureWallMs, isKeyframe, isConfig)
            if (!isConfig) fpsMeter.frame()
        }

        override fun sendAudio(payload: ByteArray, isConfig: Boolean, ptsUs: Long) {
            streamServer?.audio()?.sendFrame(payload, ptsUs, System.currentTimeMillis(), false, isConfig)
        }
    }

    private val pipelineListener = object : HostPipeline.Listener {
        override fun onEncoderReady(name: String, hardware: Boolean, profile: StreamProfile) {
            HostBus.updateState { copy(profile = profile) }
            Log.i("Encoder ready: $name (hardware=$hardware)")
        }

        override fun onAudioStatus(status: AudioStatus, detail: String?) {
            audioStatus = status
            HostBus.updateState { copy(audio = status, audioDetail = detail) }
            controlServer?.sendToClient(ControlMessages.audioStatus(status.name, detail))
        }

        override fun onError(message: String) {
            Log.e(message)
            HostBus.updateState { copy(message = message) }
        }

        override fun onProfileChanged(profile: StreamProfile) {
            sessionManager.profile = profile
            HostBus.updateState { copy(profile = profile) }
            controlServer?.sendToClient(
                ControlMessages.videoConfig(profile, pipeline?.lastConfig?.first, pipeline?.lastConfig?.second)
            )
        }
    }

    private fun startPipeline() {
        val mediaProjection = projection
        if (mediaProjection == null) {
            Log.w("No MediaProjection: cannot start capture")
            return
        }
        stopPipeline()
        val settings = neurioApp.settings.current
        val profile = sessionManager.profile ?: HostPipeline.profileFor(this, settings)
        sessionManager.profile = profile

        val pipe = HostPipeline(
            context = this,
            projection = mediaProjection,
            settings = settings,
            startProfile = profile,
            sink = mediaSink,
            listener = pipelineListener
        )
        pipeline = pipe
        pipe.start()

        adaptive = AdaptiveController(profile.bitrateBps)
        lastAdaptiveBitrate = profile.bitrateBps

        remoteInput?.stop()
        val activeInjector = injector ?: InputInjectors.create(this, settings.inputMode)
        injector = activeInjector
        remoteInput = RemoteInputController(
            injector = activeInjector,
            screenSize = { pipe.screenSize() }
        ).apply {
            setLayout(playerLayout)
            start(lifecycleScope)
        }

        startStats()
    }

    private fun stopPipeline() {
        statsJob?.cancel()
        statsJob = null
        remoteInput?.stop()
        remoteInput = null
        pipeline?.stop()
        pipeline = null
        streamServer?.close()
        streamServer = null
        inputReceiver = null
        fpsMeter.reset()
        clientLoss = 0f
        clientDroppedFps = 0f
        clientRttMs = 0L
        clientReportedFps = 0f
    }

    private fun stopSession() {
        stopPipeline()
        sessionManager.reset()
        overlayInjector?.detach()
    }

    // ------------------------------------------------------------------- stats

    private fun startStats() {
        statsJob?.cancel()
        statsJob = lifecycleScope.launch {
            while (isActive) {
                delay(STATS_INTERVAL_MS)
                val server = streamServer ?: break
                server.updateCounters()
                val pipe = pipeline ?: break
                val controller = adaptive
                var adaptiveState = "off"
                if (controller != null && neurioApp.settings.current.adaptive) {
                    val decision = controller.update(clientLoss, clientRttMs, clientDroppedFps)
                    if (decision.bitrateBps != lastAdaptiveBitrate) {
                        pipe.setBitrate(decision.bitrateBps)
                        lastAdaptiveBitrate = decision.bitrateBps
                    }
                    val tier = decision.lowResolutionTier
                    if (tier != null) {
                        val (w, h) = pipe.screenSize()
                        val settings = neurioApp.settings.current
                        val next = StreamProfile.compute(
                            w, h, tier, settings.fpsMode, settings.bitratePreset, settings.customBitrateMbps
                        )
                        pipe.applyProfile(next, tier)
                        controller.setTarget(next.bitrateBps)
                        lastAdaptiveBitrate = next.bitrateBps
                    }
                    adaptiveState = decision.state
                }

                val stats = HostStats(
                    fps = fpsMeter.fps(),
                    targetFps = pipe.currentProfile.fps,
                    bitrateBps = server.videoBitrate.bps(),
                    targetBitrateBps = lastAdaptiveBitrate.toLong(),
                    pingMs = clientRttMs,
                    resolution = pipe.currentProfile.label(),
                    droppedFrames = 0L,
                    encoderName = pipe.encoderName(),
                    hardwareEncoder = pipe.encoderHardware(),
                    packetLoss = clientLoss,
                    encodeMs = 0f,
                    adaptiveState = adaptiveState,
                    inputEventsPerSec = remoteInput?.eventsPerSec ?: 0f,
                    inputLatencyMs = remoteInput?.lastLatencyMs ?: 0f,
                    playerReportedFps = clientReportedFps
                )
                HostBus.setStats(stats)
                controlServer?.sendToClient(
                    ControlMessages.stats(
                        fps = stats.fps,
                        bitrateBps = stats.bitrateBps,
                        dropped = stats.droppedFrames,
                        loss = stats.packetLoss,
                        encodeMs = stats.encodeMs,
                        pingMs = stats.pingMs
                    )
                )
                updateNotification(stats)
            }
        }
    }

    private fun updateNotification(stats: HostStats) {
        val text = getString(
            R.string.host_notif_text,
            sessionManager.pairingCode,
            "${stats.resolution} · ${stats.fps.toInt()} fps"
        )
        val manager = getSystemService(android.app.NotificationManager::class.java)
        manager?.notify(
            Notifications.HOST_ID,
            Notifications.host(this, getString(R.string.host_notif_title), text)
        )
    }

    private fun publishState(phase: HostPhase) {
        val info = NetworkInfo.snapshot(this)
        HostBus.updateState {
            copy(
                phase = phase,
                deviceName = hostName,
                localIp = info.ip,
                networkType = info.type,
                ssid = info.ssid,
                pairingCode = sessionManager.pairingCode,
                playerName = sessionManager.clientName,
                inputDescription = injector?.let {
                    "${it.describe()} — ${InputInjectors.limitationNote(it.mode)}"
                } ?: "",
                profile = pipeline?.currentProfile
            )
        }
    }

    private fun registerDisplayListener() {
        val dm = getSystemService(DisplayManager::class.java) ?: return
        displayListener?.let { dm.unregisterDisplayListener(it) }
        displayListener = HostPipeline.displayListener {
            runCatching { pipeline?.refreshDisplay() }
        }.also { dm.registerDisplayListener(it, Handler(Looper.getMainLooper())) }
    }

    // ----------------------------------------------------------------- teardown

    private fun stopHost(reason: String) {
        Log.i("Stopping host ($reason)")
        controlServer?.sendToClient(ControlMessages.sessionStopped(reason))
        stopSession()
        controlServer?.stop()
        controlServer = null
        neurioApp.discovery.stopAdvertising()
        runCatching { projection?.stop() }
        projection = null
        displayListener?.let {
            runCatching { getSystemService(DisplayManager::class.java)?.unregisterDisplayListener(it) }
        }
        displayListener = null
        HostBus.updateState {
            copy(
                phase = HostPhase.IDLE,
                playerName = null,
                message = null,
                audio = AudioStatus.UNKNOWN,
                profile = null
            )
        }
        HostBus.resetStats()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    override fun onDestroy() {
        stopSession()
        controlServer?.stop()
        HostController.attach(null)
        super.onDestroy()
    }

    /** Called by the UI (HostController) when the user rotates the pairing code. */
    fun rotateCode(): String {
        val code = sessionManager.rotateCode()
        publishState(HostBus.state.value.phase)
        return code
    }

    fun currentCode(): String = sessionManager.pairingCode

    fun sendInputLocally(event: InputEvent) {
        remoteInput?.onEvent(event)
    }

    companion object {
        private const val STATS_INTERVAL_MS = 1_000L

        const val ACTION_START = "com.neurio.lanstream.host.START"
        const val ACTION_STOP = "com.neurio.lanstream.host.STOP"
        const val ACTION_STOP_ALT = "com.neurio.lanstream.host.KICK"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_GAME_PACKAGE = "game_package"
        const val EXTRA_GAME_NAME = "game_name"

        fun startIntent(context: Context, resultCode: Int, data: Intent, game: GameApp?): Intent =
            Intent(context, HostStreamService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, data)
                putExtra(EXTRA_GAME_PACKAGE, game?.packageName)
                putExtra(EXTRA_GAME_NAME, game?.name)
            }

        fun stopIntent(context: Context): Intent =
            Intent(context, HostStreamService::class.java).apply { action = ACTION_STOP }
    }
}
