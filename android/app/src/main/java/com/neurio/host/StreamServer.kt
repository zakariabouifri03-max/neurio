package com.neurio.host

import android.content.Context
import android.media.projection.MediaProjection
import android.os.Build
import com.neurio.common.AppLog
import com.neurio.common.AudioMode
import com.neurio.common.PerfBus
import com.neurio.common.Protocol
import com.neurio.common.QualityReport
import com.neurio.common.StatsSnapshot
import com.neurio.common.StreamConfig
import com.neurio.network.AudioPacketizer
import com.neurio.network.ControlChannel
import com.neurio.network.ControlMessage
import com.neurio.network.ControlTypes
import com.neurio.network.DiscoveryService
import com.neurio.network.HostSession
import com.neurio.network.InputReceiver
import com.neurio.network.PairingService
import com.neurio.network.SessionManager
import com.neurio.network.SessionState
import com.neurio.network.UdpPacket
import com.neurio.network.UdpTransport
import com.neurio.network.VideoPacketizer
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.Timer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * Host-side orchestrator:
 * discovery -> pairing -> session -> capture/encode/send -> adapt -> teardown.
 *
 * Only VIDEO / AUDIO / INPUT / SESSION DATA cross the network. Game files
 * never leave the host.
 */
class StreamServer(private val context: Context) : PairingService.Callbacks {

    companion object {
        private const val TAG = "StreamServer"
        const val TCP_PORT = PairingService.DEFAULT_PORT
    }

    /** UI-facing callbacks, invoked on the main thread. */
    interface Listener {
        fun onPairingCode(code: String)
        fun onClientPaired(name: String)
        fun onClientLost(reason: String)
        fun onStreamStarted(config: StreamConfig)
        fun onStreamStopped(reason: String)
        fun onAudioStatus(mode: AudioCapture.Actual, silent: Boolean)
        fun onLog(message: String)
        fun onAdapted(config: StreamConfig)
    }

    var listener: Listener? = null
    var projection: MediaProjection? = null
    var gameLabel: String = ""

    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    private var discovery: DiscoveryService? = null
    private var pairing: PairingService? = null
    private val sessions = SessionManager()

    private var control: ControlChannel? = null
    private var transport: UdpTransport? = null
    private var videoPacketizer: VideoPacketizer? = null
    private var audioPacketizer: AudioPacketizer? = null
    private val inputReceiver = InputReceiver()

    private var encoder: VideoEncoder? = null
    private val capture = ScreenCapture(context)
    private val audio = AudioCapture(context)
    private var inputAdapter: GameInputAdapter = NullInputAdapter()

    private var adaptation: AdaptationController? = null
    private var config: StreamConfig? = null

    @Volatile
    private var pairingCode: String = com.neurio.common.SessionSecurity.generatePairingCode()

    @Volatile
    var running: Boolean = false
        private set

    @Volatile
    var streaming: Boolean = false
        private set

    private var statsTimer: Timer? = null
    private val framesSent = AtomicLong(0)
    private val bytesSent = AtomicLong(0)
    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "neurio-server").apply { isDaemon = true }
    }

    val inputAdapterInfo: GameInputAdapter get() = inputAdapter

    // ------------------------------------------------------------------ setup

    fun start(initial: StreamConfig) {
        if (running) return
        running = true
        pairingCode = com.neurio.common.SessionSecurity.generatePairingCode()
        post { listener?.onPairingCode(pairingCode) }
        log("server starting on tcp/$TCP_PORT")

        inputAdapter = TouchInjectionAdapter(context)
        val dm = context.resources.displayMetrics
        inputAdapter.start(dm.widthPixels, dm.heightPixels)

        val disc = DiscoveryService(context)
        discovery = disc
        disc.register(
            serviceName = hostDisplayName(),
            port = TCP_PORT,
            attrs = mapOf(
                DiscoveryService.TXT_PROTO to "1",
                DiscoveryService.TXT_STATE to "idle",
                DiscoveryService.TXT_GAME to gameLabel,
                DiscoveryService.TXT_DEVICE to Build.MODEL
            ),
            onRegistered = { log("NSD registered as $it") },
            onError = { log("NSD: $it") }
        )

        val ps = PairingService(TCP_PORT, this)
        pairing = ps
        ps.start()
        startStatsTimer()
    }

    fun stop() {
        if (!running) return
        running = false
        log("server stopping")
        teardownStream("server stopped")
        teardownClient("server stopped")
        executor.execute {
            try {
                pairing?.stop()
                pairing = null
                discovery?.unregister()
                discovery?.stopDiscovery()
                discovery = null
            } catch (e: Exception) {
                AppLog.w(TAG, "stop error", e)
            }
        }
        inputAdapter.stop()
        statsTimer?.cancel()
        statsTimer = null
        PerfBus.publish(StatsSnapshot.IDLE)
    }

    val currentPairingCode: String get() = pairingCode

    fun regeneratePairingCode() {
        pairingCode = com.neurio.common.SessionSecurity.generatePairingCode()
        post { listener?.onPairingCode(pairingCode) }
    }

    fun hostDisplayName(): String =
        (Build.MODEL ?: "Android").ifBlank { "Android host" }

    private fun log(msg: String) {
        AppLog.i(TAG, msg)
        post { listener?.onLog(msg) }
    }

    private fun post(action: () -> Unit) {
        mainHandler.post {
            try {
                action()
            } catch (e: Exception) {
                AppLog.w(TAG, "listener error", e)
            }
        }
    }

    // ------------------------------------------------- PairingService.Callbacks

    override fun pairingCode(): String = pairingCode

    override fun isBusy(): Boolean = sessions.isBusy

    override fun onClientPaired(channel: ControlChannel, clientName: String, clientUdpPort: Int) {
        executor.execute { handlePaired(channel, clientName, clientUdpPort) }
    }

    private fun handlePaired(channel: ControlChannel, clientName: String, clientUdpPort: Int) {
        teardownClient("replaced by new client")
        val clientIp = channel.socket.inetAddress ?: run {
            channel.close()
            return
        }
        val session = sessions.create(clientName, InetSocketAddress(clientIp, clientUdpPort))
        log("session ${Integer.toHexString(session.sessionId)} for $clientName udp/$clientUdpPort")

        val tx = UdpTransport(session.token, session.sessionId)
        transport = tx
        tx.onPacket = { pkt -> dispatchUdp(pkt) }
        tx.start()

        val vp = VideoPacketizer(tx)
        vp.destination = session.clientAddress
        videoPacketizer = vp
        val ap = AudioPacketizer(tx)
        ap.destination = session.clientAddress
        audioPacketizer = ap

        inputReceiver.onEvent = { event, _ -> inputAdapter.onInput(event) }

        channel.remoteName = clientName
        control = channel
        channel.send(ControlMessage.of(ControlTypes.PAIR_OK) {
            put("sessionId", session.sessionId)
            put("tokenHex", session.tokenHex)
            put("mediaPort", tx.localPort)
            put("hostName", hostDisplayName())
        })
        channel.startReader({ msg -> onControlMessage(session, msg) }, {
            post {
                listener?.onClientLost("control channel closed")
            }
            teardownStream("client disconnected")
            sessions.clear()
            control = null
        })

        session.state = SessionState.PAIRED
        post { listener?.onClientPaired(clientName) }
        updateNsdState("paired")
    }

    // ---------------------------------------------------------- control plane

    private fun onControlMessage(session: HostSession, msg: ControlMessage) {
        when (msg.type) {
            ControlTypes.START -> executor.execute { handleStart(session, msg.body) }
            ControlTypes.STOP -> executor.execute {
                teardownStream("client requested stop")
            }
            ControlTypes.BYE -> {
                log("client said bye")
                teardownStream("client left")
                teardownClient("client left")
            }
            else -> AppLog.d(TAG, "unhandled control ${msg.type}")
        }
    }

    private fun handleStart(session: HostSession, body: JSONObject) {
        val projectionLocal = projection
        if (projectionLocal == null) {
            control?.send(ControlMessage.of(ControlTypes.ERROR) { put("reason", "no_projection") })
            return
        }
        val tier = runCatching {
            com.neurio.common.QualityTier.valueOf(body.optString("tier", "GOOD"))
        }.getOrDefault(com.neurio.common.QualityTier.GOOD)
        val codec = com.neurio.common.VideoCodec.fromPref(body.optString("codec", "H264"))
        val audioMode = runCatching {
            AudioMode.valueOf(body.optString("audio", "AUTO"))
        }.getOrDefault(AudioMode.AUTO)
        val maxBitrate = body.optInt("maxBitrateKbps", tier.bitrateKbps)

        val cfg = StreamConfig(tier, codec, audioMode, maxBitrate)
        config = cfg
        session.config = cfg

        teardownMediaOnly()
        startPipeline(session, cfg)
    }

    private fun startPipeline(session: HostSession, cfg: StreamConfig) {
        val projectionLocal = projection ?: return
        log("starting pipeline ${cfg.width}x${cfg.height}@${cfg.fps} ${cfg.bitrateKbps}kbps ${cfg.codec.label}")

        val enc = VideoEncoder(cfg.codec.mime)
        encoder = enc
        enc.onConfig = { csd -> videoPacketizer?.sendConfig(csd) }
        enc.onEncoded = { data, size, pts, key ->
            videoPacketizer?.sendFrame(data, size, pts, key)
            framesSent.incrementAndGet()
            bytesSent.addAndGet(size.toLong())
        }
        enc.start(cfg.width, cfg.height, cfg.fps, cfg.bitrateKbps)

        val surface = enc.inputSurface
        if (surface == null) {
            log("encoder produced no input surface; aborting pipeline")
            control?.send(ControlMessage.of(ControlTypes.ERROR) { put("reason", "no_encoder_surface") })
            return
        }
        capture.start(projectionLocal, cfg.width, cfg.height, surface)

        audio.onConfig = { csd -> audioPacketizer?.sendConfig(csd) }
        audio.onEncoded = { data, size, pts ->
            audioPacketizer?.sendAudio(data, size, pts)
            bytesSent.addAndGet(size.toLong())
        }
        audio.onSilenceDetected = {
            post { listener?.onAudioStatus(audio.actual, true) }
            log("game audio is silent: title did not allow playback capture")
        }
        val actualAudio = audio.start(cfg.audioMode, projectionLocal)
        post { listener?.onAudioStatus(actualAudio, false) }

        adaptation = AdaptationController(cfg.tier, cfg.bitrateKbps)
        session.state = SessionState.STREAMING
        streaming = true
        updateNsdState("streaming")

        control?.send(ControlMessage.of(ControlTypes.STARTED) {
            put("width", cfg.width)
            put("height", cfg.height)
            put("fps", cfg.fps)
            put("bitrateKbps", cfg.bitrateKbps)
            put("videoMime", cfg.codec.mime)
            put("audioMime", if (actualAudio == AudioCapture.Actual.NONE) "" else audio.mime)
            put("audioSampleRate", audio.sampleRate)
            put("audioChannels", audio.channels)
            put("audioActual", actualAudio.name)
            put("inputAdapter", inputAdapter.name)
            put("inputActive", inputAdapter.active)
            put("inputLimitations", org.json.JSONArray(inputAdapter.limitations))
        })
        // New decoder on the client needs a keyframe quickly.
        mainHandler.postDelayed({ enc.requestKeyFrame() }, 300)
        post { listener?.onStreamStarted(cfg) }
    }

    private fun dispatchUdp(pkt: UdpPacket) {
        when (pkt.header.type) {
            Protocol.TYPE_PING -> {
                // Echo with our timestamp appended.
                transport?.send(
                    Protocol.TYPE_PONG, 0, 0, pkt.header.seq,
                    pkt.data, pkt.payloadOffset, pkt.payloadLength, pkt.from
                )
            }
            Protocol.TYPE_INPUT -> inputReceiver.onPacket(pkt)
            Protocol.TYPE_CONTROL -> handleFastControl(pkt)
            else -> Unit
        }
    }

    private fun handleFastControl(pkt: UdpPacket) {
        when (pkt.header.subtype) {
            Protocol.CONTROL_IDR_REQUEST -> {
                encoder?.requestKeyFrame()
            }
            Protocol.CONTROL_QUALITY_REPORT -> {
                val report = QualityReport.decode(pkt.data, pkt.payloadOffset, pkt.payloadLength)
                    ?: return
                executor.execute { applyQualityReport(report) }
            }
            Protocol.CONTROL_KEEPALIVE -> Unit
            else -> Unit
        }
    }

    private fun applyQualityReport(report: QualityReport) {
        val controller = adaptation ?: return
        val cfg = config ?: return
        when (val decision = controller.onReport(report, System.currentTimeMillis())) {
                    is AdaptationController.Decision.Bitrate -> {
                        encoder?.setBitrate(decision.kbps)
                        cfg.maxBitrateKbps = decision.kbps
                    }
                    is AdaptationController.Decision.Tier -> {
                        val session = sessions.active ?: return
                        log("adapting to ${decision.tier.label}")
                        control?.send(ControlMessage.of(ControlTypes.ADAPT) {
                            put("width", decision.tier.width)
                            put("height", decision.tier.height)
                            put("fps", decision.tier.fps)
                            put("bitrateKbps", decision.tier.bitrateKbps)
                        })
                        cfg.tier = decision.tier
                        cfg.maxBitrateKbps = decision.tier.bitrateKbps
                        config = cfg
                        teardownMediaOnly()
                        startPipeline(session, cfg)
                        post { listener?.onAdapted(cfg.copy()) }
                    }
            is AdaptationController.Decision.None -> Unit
        }
    }

    // ---------------------------------------------------------------- teardown

    private fun teardownMediaOnly() {
        streaming = false
        try {
            capture.stop()
        } catch (e: Exception) {
            AppLog.w(TAG, "capture stop", e)
        }
        try {
            encoder?.stop()
        } catch (e: Exception) {
            AppLog.w(TAG, "encoder stop", e)
        }
        encoder = null
        try {
            audio.stop()
        } catch (e: Exception) {
            AppLog.w(TAG, "audio stop", e)
        }
    }

    private fun teardownStream(reason: String) {
        val wasStreaming = streaming
        teardownMediaOnly()
        if (wasStreaming) {
            post { listener?.onStreamStopped(reason) }
        }
        updateNsdState(if (sessions.isBusy) "paired" else "idle")
    }

    private fun teardownClient(reason: String) {
        try {
            control?.close()
        } catch (ignored: Exception) {
        }
        control = null
        try {
            transport?.close()
        } catch (ignored: Exception) {
        }
        transport = null
        videoPacketizer = null
        audioPacketizer = null
        sessions.clear()
        adaptation = null
        config = null
    }

    private fun updateNsdState(state: String) {
        // Re-registering NSD mid-session is disruptive; TXT state is best-effort.
        AppLog.d(TAG, "nsd state -> $state")
    }

    // ------------------------------------------------------------- stats loop

    private fun startStatsTimer() {
        var lastFrames = 0L
        var lastBytes = 0L
        var lastNano = System.nanoTime()
        statsTimer = Timer("neurio-host-stats", true)
        statsTimer?.scheduleAtFixedRate(object : java.util.TimerTask() {
            override fun run() {
                val now = System.nanoTime()
                val frames = framesSent.get()
                val bytes = bytesSent.get()
                val dt = ((now - lastNano) / 1_000_000_000.0).coerceAtLeast(0.2)
                val fps = (frames - lastFrames) / dt
                val mbps = (bytes - lastBytes) * 8.0 / dt / 1_000_000.0
                lastFrames = frames
                lastBytes = bytes
                lastNano = now

                val cfg = config
                val session = sessions.active
                PerfBus.publish(
                    StatsSnapshot(
                        active = streaming,
                        role = "HOST",
                        rttMs = -1.0,
                        lossPct = -1.0,
                        jitterMs = -1.0,
                        bitrateMbps = mbps,
                        fps = fps,
                        decodeMs = -1.0,
                        encodeMs = encoder?.encodeLatencyMs ?: -1.0,
                        width = cfg?.width ?: 0,
                        height = cfg?.height ?: 0,
                        dropped = 0,
                        batteryTempC = readBatteryTempC()
                    )
                )
                if (session != null && streaming) {
                    // Light keepalive so NAT tables / wifi power save stay warm.
                    transport?.send(
                        Protocol.TYPE_CONTROL, 0, Protocol.CONTROL_KEEPALIVE, 0,
                        ByteArray(0), 0, 0, session.clientAddress
                    )
                }
            }
        }, 1000L, 1000L)
    }

    private fun readBatteryTempC(): Double {
        return try {
            val intent = context.registerReceiver(
                null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED)
            )
            val temp = intent?.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
            temp / 10.0
        } catch (e: Exception) {
            0.0
        }
    }
}
