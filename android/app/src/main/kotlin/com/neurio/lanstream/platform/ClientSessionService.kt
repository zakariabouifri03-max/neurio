package com.neurio.lanstream.platform

import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Base64
import android.view.Surface
import androidx.core.app.ServiceCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.neurio.lanstream.R
import com.neurio.lanstream.core.ClientBus
import com.neurio.lanstream.core.ClientPhase
import com.neurio.lanstream.core.ClientStats
import com.neurio.lanstream.core.ClockSync
import com.neurio.lanstream.core.Ema
import com.neurio.lanstream.core.FpsMeter
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.core.NetworkInfo
import com.neurio.lanstream.input.InputEvent
import com.neurio.lanstream.input.PadLayout
import com.neurio.lanstream.media.AnnexB
import com.neurio.lanstream.media.AudioDecoder
import com.neurio.lanstream.media.VideoDecoder
import com.neurio.lanstream.net.ControlClient
import com.neurio.lanstream.net.FrameAssembler
import com.neurio.lanstream.net.Protocol
import com.neurio.lanstream.net.StreamClient
import com.neurio.lanstream.discovery.HostEndpoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.InetAddress

/**
 * CLIENT MODE (phone 1).
 *
 * Responsibilities
 *   1. pair with the host over the TCP control channel;
 *   2. open three ephemeral UDP ports and tell the host about them;
 *   3. hardware-decode the video straight into the Surface the UI gives us;
 *   4. play the audio when the host captured any;
 *   5. forward touch / key / gamepad input back to the host.
 *
 * The game itself is never downloaded: this phone only ever receives an
 * already-encoded video stream plus small control messages.
 */
class ClientSessionService : LifecycleService() {

    private val clockSync = ClockSync()
    private val fpsMeter = FpsMeter()
    private val latency = Ema(0.2f)

    @Volatile
    private var controlClient: ControlClient? = null

    @Volatile
    private var streamClient: StreamClient? = null

    @Volatile
    private var videoDecoder: VideoDecoder? = null

    @Volatile
    private var audioDecoder: AudioDecoder? = null

    @Volatile
    private var pendingSurface: Surface? = null

    @Volatile
    private var session: ControlClient.Session? = null

    @Volatile
    private var statsJob: Job? = null

    @Volatile
    private var videoWidth = 0

    @Volatile
    private var videoHeight = 0

    @Volatile
    private var framesDropped = 0L

    @Volatile
    private var lastKeyframeRequestMs = 0L

    @Volatile
    private var lastCaptureWallMs = 0L

    @Volatile
    private var lastLatencyMs = 0f

    @Volatile
    private var hostLabel: String = "host"

    @Volatile
    private var padLayout: PadLayout = PadLayout.default()

    @Volatile
    private var audioPlaying = false

    @Volatile
    private var hostAddress: InetAddress? = null

    private val deviceName: String
        get() = neurioApp.settings.current.deviceName.ifBlank { NetworkInfo.deviceName() }

    // --------------------------------------------------------------- lifecycle

    override fun onCreate() {
        super.onCreate()
        padLayout = PadLayout.fromJson(neurioApp.settings.current.controlLayoutJson)
        ClientController.attach(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_START -> startSession(intent)
            ACTION_STOP -> stopSession("client_stopped")
        }
        return START_NOT_STICKY
    }

    private fun startSession(intent: Intent) {
        val host = intent.getStringExtra(EXTRA_HOST)
        val port = intent.getIntExtra(EXTRA_PORT, Protocol.CONTROL_PORT)
        val code = intent.getStringExtra(EXTRA_CODE) ?: ""
        hostLabel = intent.getStringExtra(EXTRA_HOST_NAME) ?: "host"
        if (host.isNullOrBlank()) {
            fail("No host address")
            return
        }

        startForegroundCompat()
        ClientBus.updateState {
            copy(phase = ClientPhase.CONNECTING, message = null, nowPlaying = hostLabel)
        }

        lifecycleScope.launch {
            val address = try {
                withContext(Dispatchers.IO) { InetAddress.getByName(host) }
            } catch (t: Throwable) {
                fail("Cannot resolve $host")
                return@launch
            }
            val endpoint = HostEndpoint(
                id = HostEndpoint.key(address, port),
                name = hostLabel,
                address = address,
                controlPort = port,
                source = "manual"
            )
            hostAddress = address
            val client = ControlClient(endpoint, code, deviceName, padLayout, controlListener)
            controlClient = client
            ClientBus.updateState { copy(phase = ClientPhase.AUTHENTICATING) }
            val ok = client.connect(lifecycleScope)
            if (!ok) {
                fail("Pairing failed — check the code on the host")
            }
        }
    }

    private fun startForegroundCompat() {
        val notification = Notifications.client(
            this,
            getString(R.string.client_notif_title),
            getString(R.string.client_notif_text, hostLabel)
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                ServiceCompat.startForeground(
                    this,
                    Notifications.CLIENT_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                )
                return
            } catch (se: SecurityException) {
                Log.w("Typed startForeground refused: ${se.message}")
            }
        }
        startForeground(Notifications.CLIENT_ID, notification)
    }

    // ------------------------------------------------------------ control plane

    private val controlListener = object : ControlClient.Listener {

        override fun onAuthOk(json: JSONObject) {
            val negotiated = controlClient?.negotiated
            if (negotiated == null) {
                fail("Host did not send a session description")
                return
            }
            session = negotiated
            videoWidth = negotiated.videoWidth
            videoHeight = negotiated.videoHeight
            val client = StreamClient(negotiated.sessionId, negotiated.token)
            val ports = client.open()
            streamClient = client

            val target = hostAddress
            if (target == null) {
                fail("Lost the host address")
                return
            }
            client.start(
                scope = lifecycleScope,
                host = target,
                inputPort = negotiated.inputPort,
                videoMime = negotiated.videoMime,
                onVideoFrame = ::onVideoFrame,
                onAudioFrame = ::onAudioFrame,
                onVideoDropped = ::onVideoDropped,
                onPong = ::onPong
            )

            val settings = neurioApp.settings.current
            val decoder = VideoDecoder(
                mime = negotiated.videoMime,
                lowLatency = settings.lowLatency,
                onFrameRendered = ::onFrameRendered,
                onError = { t -> Log.e("Decoder error: ${t.message}") }
            )
            videoDecoder = decoder
            decoder.applyConfig(null, null, videoWidth, videoHeight)
            pendingSurface?.let { decoder.setSurface(it) }

            if (negotiated.audioEnabled) {
                audioDecoder = AudioDecoder(
                    sampleRate = negotiated.audioSampleRate,
                    channelCount = negotiated.audioChannels
                ) { t -> Log.w("Audio decoder error: ${t.message}") }
            }

            controlClient?.sendReady(ports.video, ports.audio, ports.input)
            ClientBus.updateState {
                copy(phase = ClientPhase.STREAMING, nowPlaying = negotiated.gameName.ifBlank { hostLabel })
            }
            startStats()
            Log.i("Client session started: ${negotiated.videoWidth}x${negotiated.videoHeight} ${negotiated.videoMime}")
        }

        override fun onAuthFailed(reason: String) {
            fail(
                when (reason) {
                    "bad_code" -> "Wrong pairing code"
                    "host_busy" -> "That host already has a player"
                    "locked" -> "Too many attempts — the host is locked for 30 s"
                    else -> "Pairing rejected ($reason)"
                }
            )
        }

        override fun onSessionStarted() {
            ClientBus.updateState { copy(phase = ClientPhase.STREAMING, message = null) }
        }

        override fun onSessionStopped(reason: String) {
            stopSession(reason)
        }

        override fun onVideoConfig(json: org.json.JSONObject) {
            val width = json.optInt("w", videoWidth)
            val height = json.optInt("h", videoHeight)
            val sps = decodeBase64(json.optString("sps"))
            val pps = decodeBase64(json.optString("pps"))
            videoWidth = width
            videoHeight = height
            videoDecoder?.applyConfig(sps, pps, width, height)
            Log.i("Host changed the video config to ${width}x$height")
        }

        override fun onAudioStatus(json: org.json.JSONObject) {
            Log.i("Host audio status: ${json.optString("state")} ${json.optString("reason")}")
        }

        override fun onInputStatus(json: org.json.JSONObject) {
            Log.i("Host input: ${json.optString("mode")} available=${json.optBoolean("available")}")
            ClientBus.updateState { copy(inputForwarding = json.optBoolean("available", false)) }
        }

        override fun onStats(json: org.json.JSONObject) {
            // Host statistics: displayed next to the client's own numbers.
        }

        override fun onPong(rttMs: Long) {
            // Keepalive RTT; the input-channel pong drives the latency estimate.
        }

        override fun onClosed(reason: String) {
            stopSession(reason)
        }
    }

    // -------------------------------------------------------------- media plane

    private fun onVideoFrame(frame: FrameAssembler.AssembledFrame) {
        val decoder = videoDecoder ?: return
        if (frame.config) {
            val hevc = session?.videoMime?.contains("hevc", true) == true
            val (sps, pps) = AnnexB.spsPps(frame.data, hevc)
            decoder.applyConfig(sps, pps, videoWidth, videoHeight)
            return
        }
        lastCaptureWallMs = frame.captureWallMs
        val accepted = decoder.submit(
            data = frame.data,
            offset = 0,
            size = frame.data.size,
            ptsUs = frame.ptsUs,
            isKeyframe = frame.keyframe
        )
        if (!accepted) {
            framesDropped++
            requestKeyframeIfNeeded()
        } else {
            ClientBus.updateState { copy(videoReady = true) }
        }
    }

    private fun onAudioFrame(frame: FrameAssembler.AssembledFrame) {
        val negotiated = session ?: return
        if (frame.config) {
            val decoder = audioDecoder ?: return
            if (!audioPlaying) {
                audioPlaying = decoder.start(frame.data)
                Log.i("Audio decoder started: $audioPlaying")
            }
            return
        }
        if (!audioPlaying) return
        audioDecoder?.submit(frame.data, frame.ptsUs)
    }

    private fun onVideoDropped(frameId: Int, missingFragments: Int) {
        framesDropped += missingFragments.coerceAtLeast(1).toLong()
        requestKeyframeIfNeeded()
    }

    private fun onFrameRendered(ptsUs: Long) {
        fpsMeter.frame()
        if (lastCaptureWallMs > 0) {
            val hostTime = clockSync.clientToHost(System.currentTimeMillis())
            val estimate = (hostTime - lastCaptureWallMs).toFloat()
            if (estimate in 0f..2_000f) {
                lastLatencyMs = latency.add(estimate)
            }
        }
    }

    private fun onPong(
        clientSendMs: Long,
        hostReceiveMs: Long,
        hostSendMs: Long,
        clientReceiveMs: Long
    ) {
        clockSync.onSample(clientSendMs, hostReceiveMs, hostSendMs, clientReceiveMs)
    }

    private fun requestKeyframeIfNeeded() {
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lastKeyframeRequestMs < 400) return
        lastKeyframeRequestMs = now
        controlClient?.requestKeyframe()
        streamClient?.requestResync()
        videoDecoder?.requestResync()
    }

    // ------------------------------------------------------------------- stats

    private fun startStats() {
        statsJob?.cancel()
        statsJob = lifecycleScope.launch {
            while (isActive) {
                delay(500)
                streamClient?.sendPing()
                delay(500)
                val stats = streamClient?.videoStats()
                val decoder = videoDecoder
                val clientStats = ClientStats(
                    fps = fpsMeter.fps(),
                    pingMs = clockSync.rttMs(),
                    bitrateBps = stats?.bitrateBps() ?: 0L,
                    resolution = if (videoWidth > 0) "${videoWidth}x${videoHeight}" else "",
                    droppedFrames = framesDropped + (decoder?.framesDropped ?: 0L),
                    packetLoss = stats?.lossRatioAndReset() ?: 0f,
                    decodeMs = 0f,
                    latencyMs = lastLatencyMs,
                    decoderName = decoder?.decoderName ?: "",
                    hardwareDecoder = decoder?.hardware ?: false,
                    audioPlaying = audioPlaying && (audioDecoder?.playing == true)
                )
                ClientBus.setStats(clientStats)
                controlClient?.sendClientStats(
                    fps = clientStats.fps,
                    dropped = clientStats.droppedFrames,
                    dropsPerSec = 0f,
                    loss = clientStats.packetLoss,
                    latencyMs = clientStats.latencyMs,
                    rttMs = clientStats.pingMs
                )
            }
        }
    }

    // ---------------------------------------------------------------- plumbing

    fun attachSurface(surface: Surface?) {
        pendingSurface = surface
        videoDecoder?.setSurface(surface)
    }

    fun sendInput(event: InputEvent) {
        streamClient?.sendInput(event)
    }

    fun requestKeyframe() {
        controlClient?.requestKeyframe()
    }

    private fun decodeBase64(value: String?): ByteArray? {
        if (value.isNullOrBlank()) return null
        return runCatching { Base64.decode(value, Base64.DEFAULT) }.getOrNull()
    }

    private fun fail(message: String) {
        Log.w("Client session failed: $message")
        ClientBus.updateState { copy(phase = ClientPhase.ERROR, message = message) }
        stopSession("failed")
    }

    private fun stopSession(reason: String) {
        Log.i("Stopping client session: $reason")
        statsJob?.cancel()
        statsJob = null
        controlClient?.stop(reason)
        controlClient = null
        streamClient?.close()
        streamClient = null
        videoDecoder?.stop()
        videoDecoder = null
        audioDecoder?.stop()
        audioDecoder = null
        audioPlaying = false
        framesDropped = 0L
        fpsMeter.reset()
        latency.reset()
        clockSync.reset()
        ClientBus.updateState {
            copy(
                phase = ClientPhase.IDLE,
                videoReady = false,
                message = if (reason == "client_stopped") null else message
            )
        }
        ClientBus.resetStats()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    override fun onDestroy() {
        ClientController.attach(null)
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.neurio.lanstream.client.START"
        const val ACTION_STOP = "com.neurio.lanstream.client.STOP"
        const val EXTRA_HOST = "host_address"
        const val EXTRA_PORT = "host_port"
        const val EXTRA_CODE = "pairing_code"
        const val EXTRA_HOST_NAME = "host_name"

        fun startIntent(
            context: Context,
            host: String,
            port: Int,
            code: String,
            hostName: String
        ): Intent = Intent(context, ClientSessionService::class.java).apply {
            action = ACTION_START
            putExtra(EXTRA_HOST, host)
            putExtra(EXTRA_PORT, port)
            putExtra(EXTRA_CODE, code)
            putExtra(EXTRA_HOST_NAME, hostName)
        }

        fun stopIntent(context: Context): Intent =
            Intent(context, ClientSessionService::class.java).apply { action = ACTION_STOP }
    }
}
