package com.neurio.client

import com.neurio.common.AppLog
import com.neurio.common.NetworkStats
import com.neurio.common.Protocol
import com.neurio.common.QualityReport
import com.neurio.common.StreamConfig
import com.neurio.network.AudioDepacketizer
import com.neurio.network.ControlChannel
import com.neurio.network.ControlMessage
import com.neurio.network.ControlTypes
import com.neurio.network.InputPacketizer
import com.neurio.network.UdpPacket
import com.neurio.network.UdpTransport
import com.neurio.network.VideoDepacketizer
import org.json.JSONObject
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** What STARTED tells the client about the pipeline. */
data class StreamStarted(
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrateKbps: Int,
    val videoMime: String,
    val audioMime: String,
    val audioSampleRate: Int,
    val audioChannels: Int,
    val audioActual: String,
    val inputAdapter: String,
    val inputActive: Boolean,
    val inputLimitations: List<String>
)

/**
 * Client-side orchestrator: TCP control + authenticated UDP media/input.
 * Video frames are handed to the hardware decoder; input events go straight
 * out over UDP for minimum latency.
 */
class StreamClient {

    companion object {
        private const val TAG = "StreamClient"
        private const val CONNECT_TIMEOUT_MS = 3500
        private const val PING_PERIOD_MS = 500L
        private const val QUALITY_PERIOD_MS = 1000L
    }

    interface Listener {
        fun onConnecting(host: String)
        fun onPaired(hostName: String)
        fun onStarted(started: StreamStarted)
        fun onAdapt(width: Int, height: Int, fps: Int, bitrateKbps: Int)
        fun onDisconnected(reason: String)
        fun onError(message: String)
    }

    var listener: Listener? = null

    val stats = NetworkStats()
    val videoDepacketizer = VideoDepacketizer()
    val audioDepacketizer = AudioDepacketizer()

    /** Set by the player UI: decoded-ready frames + audio frames. */
    var onVideoFrame: ((data: ByteArray, size: Int, ptsUs: Long, key: Boolean, config: Boolean) -> Unit)? = null
    var onAudioFrame: ((data: ByteArray, size: Int, ptsUs: Long, config: Boolean) -> Unit)? = null

    /** Supplied by the player UI for the quality report (decoder feedback). */
    var decoderFpsProvider: () -> Double = { 0.0 }
    var decoderMsProvider: () -> Double = { 0.0 }

    @Volatile
    var connected = false
        private set

    @Volatile
    var streaming = false
        private set

    var hostName: String = ""
        private set
    var started: StreamStarted? = null
        private set

    private var control: ControlChannel? = null
    private var transport: UdpTransport? = null
    private var inputPacketizer: InputPacketizer? = null
    private var sessionId = 0
    private var hostMediaAddress: InetSocketAddress? = null
    private var pingSeq = AtomicInteger(0)
    private val pingTimes = HashMap<Int, Long>()

    private val workers = Executors.newFixedThreadPool(3) { r ->
        Thread(r, "neurio-client").apply { isDaemon = true }
    }

    private var pingThread: Thread? = null
    private var qualityThread: Thread? = null

    // ------------------------------------------------------------------ connect

    fun connect(
        address: InetSocketAddress,
        pairingCode: String,
        clientName: String,
        preferred: StreamConfig
    ) {
        workers.execute {
            connectBlocking(address, pairingCode, clientName, preferred)
        }
    }

    private fun connectBlocking(
        address: InetSocketAddress,
        pairingCode: String,
        clientName: String,
        preferred: StreamConfig
    ) {
        try {
            listener?.onConnecting("${address.address.hostAddress}:${address.port}")

            val socket = Socket()
            socket.tcpNoDelay = true
            socket.connect(address, CONNECT_TIMEOUT_MS)
            val channel = ControlChannel(socket)
            control = channel

            // Bind our UDP socket up-front so we can advertise the port.
            val udpSocket = DatagramSocket(null).apply {
                bind(InetSocketAddress(0))
            }
            val udpPort = udpSocket.localPort

            channel.send(ControlMessage.of(ControlTypes.HELLO) {
                put("name", clientName)
                put("udpPort", udpPort)
            })
            val ack = channel.readBlocking()
            if (ack == null || ack.type != ControlTypes.HELLO_ACK) {
                fail("Host did not answer HELLO")
                return
            }
            hostName = ack.body.optString("hostName", "Host")
            if (ack.body.optBoolean("busy", false)) {
                fail("Host is busy with another player")
                return
            }

            channel.send(ControlMessage.of(ControlTypes.PAIR_REQ) {
                put("code", pairingCode)
            })
            val pair = channel.readBlocking()
            if (pair == null) {
                fail("No pairing answer")
                return
            }
            when (pair.type) {
                ControlTypes.PAIR_FAIL -> {
                    fail("Pairing rejected: wrong code?")
                    return
                }
                ControlTypes.PAIR_OK -> Unit
                else -> {
                    fail("Unexpected pairing answer ${pair.type}")
                    return
                }
            }

            sessionId = pair.body.optInt("sessionId", 0)
            val tokenHex = pair.body.optString("tokenHex", "")
            val mediaPort = pair.body.optInt("mediaPort", 0)
            val token = com.neurio.common.SessionSecurity.fromHex(tokenHex)
            if (sessionId == 0 || token == null || mediaPort <= 0) {
                fail("Malformed pairing answer")
                return
            }
            hostMediaAddress = InetSocketAddress(address.address, mediaPort)

            val tx = UdpTransport(token, sessionId, udpSocket)
            transport = tx
            tx.onPacket = { pkt -> dispatch(pkt) }
            tx.start()

            val input = InputPacketizer(tx)
            input.destination = hostMediaAddress
            inputPacketizer = input

            connected = true
            listener?.onPaired(hostName)

            // Ask the host to start the pipeline. The reader thread must NOT
            // run yet: this handshake reads synchronously from the socket.
            channel.send(ControlMessage.of(ControlTypes.START) {
                put("tier", preferred.tier.name)
                put("codec", preferred.codec.name)
                put("audio", preferred.audioMode.name)
                put("maxBitrateKbps", preferred.maxBitrateKbps)
            })
            val startedMsg = channel.readBlocking()
            if (startedMsg == null || startedMsg.type == ControlTypes.ERROR) {
                fail("Host refused to start: ${startedMsg?.body?.optString("reason", "unknown")}")
                return
            }
            if (startedMsg.type != ControlTypes.STARTED) {
                fail("Unexpected answer ${startedMsg.type}")
                return
            }
            applyStarted(startedMsg.body)

            channel.startReader({ msg -> onControl(msg) }, {
                connected = false
                streaming = false
                listener?.onDisconnected("Connection closed")
            })
        } catch (e: Exception) {
            fail("Connection failed: ${e.message}")
        }
    }

    private fun applyStarted(body: JSONObject) {
        val s = StreamStarted(
            width = body.optInt("width", 1280),
            height = body.optInt("height", 720),
            fps = body.optInt("fps", 60),
            bitrateKbps = body.optInt("bitrateKbps", 8000),
            videoMime = body.optString("videoMime", "video/avc"),
            audioMime = body.optString("audioMime", ""),
            audioSampleRate = body.optInt("audioSampleRate", 48000),
            audioChannels = body.optInt("audioChannels", 2),
            audioActual = body.optString("audioActual", "NONE"),
            inputAdapter = body.optString("inputAdapter", ""),
            inputActive = body.optBoolean("inputActive", false),
            inputLimitations = run {
                val arr = body.optJSONArray("inputLimitations")
                val out = ArrayList<String>()
                if (arr != null) for (i in 0 until arr.length()) out.add(arr.optString(i, ""))
                out
            }
        )
        started = s
        stats.currentVideoWidth = s.width
        stats.currentVideoHeight = s.height
        stats.reset()
        streaming = true
        startBackgroundLoops()
        listener?.onStarted(s)
    }

    private fun fail(message: String) {
        AppLog.w(TAG, message)
        teardown()
        listener?.onError(message)
    }

    // ------------------------------------------------------------------ runtime

    private fun dispatch(pkt: UdpPacket) {
        when (pkt.header.type) {
            Protocol.TYPE_VIDEO -> {
                stats.recordVideoPacket(pkt.header.seq, pkt.payloadLength, System.nanoTime())
                videoDepacketizer.onPacket(pkt)
            }
            Protocol.TYPE_AUDIO -> audioDepacketizer.onPacket(pkt)
            Protocol.TYPE_PONG -> handlePong(pkt)
            else -> Unit
        }
    }

    private fun handlePong(pkt: UdpPacket) {
        if (pkt.payloadLength < 16) return
        synchronized(pingTimes) {
            val sentAt = pingTimes.remove(pkt.header.seq) ?: return
            val rtt = (System.nanoTime() - sentAt) / 1_000_000.0
            if (rtt >= 0) stats.recordRtt(rtt)
        }
    }

    private fun onControl(msg: ControlMessage) {
        when (msg.type) {
            ControlTypes.ADAPT -> {
                val w = msg.body.optInt("width", 1280)
                val h = msg.body.optInt("height", 720)
                val fps = msg.body.optInt("fps", 60)
                val kbps = msg.body.optInt("bitrateKbps", 8000)
                stats.currentVideoWidth = w
                stats.currentVideoHeight = h
                AppLog.i(TAG, "host adapting to ${w}x${h}@$fps")
                listener?.onAdapt(w, h, fps, kbps)
            }
            ControlTypes.ERROR -> {
                listener?.onError(msg.body.optString("reason", "host error"))
            }
            else -> Unit
        }
    }

    private fun startBackgroundLoops() {
        videoDepacketizer.onFrame = { data, size, pts, key, config ->
            onVideoFrame?.invoke(data, size, pts, key, config)
        }
        videoDepacketizer.onLoss = { requestKeyFrame() }
        audioDepacketizer.onFrame = { data, size, pts, config ->
            onAudioFrame?.invoke(data, size, pts, config)
        }

        pingThread = Thread {
            val payload = ByteArray(16)
            val buf = java.nio.ByteBuffer.wrap(payload).order(java.nio.ByteOrder.BIG_ENDIAN)
            while (connected) {
                val dest = hostMediaAddress
                val tx = transport
                if (dest != null && tx != null) {
                    val seq = pingSeq.getAndIncrement()
                    synchronized(pingTimes) { pingTimes[seq] = System.nanoTime() }
                    buf.clear()
                    buf.putLong(System.currentTimeMillis())
                    buf.putLong(0L)
                    tx.send(Protocol.TYPE_PING, 0, 0, seq, payload, 0, payload.size, dest)
                    // Trim stale entries.
                    synchronized(pingTimes) {
                        if (pingTimes.size > 64) pingTimes.clear()
                    }
                }
                try {
                    Thread.sleep(PING_PERIOD_MS)
                } catch (e: InterruptedException) {
                    break
                }
            }
        }.apply {
            name = "neurio-ping"
            isDaemon = true
            start()
        }

        qualityThread = Thread {
            while (connected) {
                try {
                    Thread.sleep(QUALITY_PERIOD_MS)
                } catch (e: InterruptedException) {
                    break
                }
                val dest = hostMediaAddress ?: continue
                val tx = transport ?: continue
                videoDepacketizer.tick(System.currentTimeMillis())
                val report = QualityReport(
                    rttMs = stats.snapshotRttMs(),
                    lossPct = stats.snapshotLossPct(),
                    jitterMs = stats.snapshotJitterMs(),
                    decodeMs = decoderMsProvider(),
                    fps = decoderFpsProvider(),
                    width = stats.currentVideoWidth,
                    height = stats.currentVideoHeight
                )
                val payload = report.encode()
                tx.send(
                    Protocol.TYPE_CONTROL, 0, Protocol.CONTROL_QUALITY_REPORT, 0,
                    payload, 0, payload.size, dest
                )
            }
        }.apply {
            name = "neurio-quality"
            isDaemon = true
            start()
        }
    }

    fun requestKeyFrame() {
        val dest = hostMediaAddress ?: return
        val tx = transport ?: return
        tx.send(
            Protocol.TYPE_CONTROL, 0, Protocol.CONTROL_IDR_REQUEST, 0,
            ByteArray(0), 0, 0, dest
        )
    }

    fun sendInput(event: Protocol.InputEvent) {
        inputPacketizer?.send(event)
    }

    fun disconnect(reason: String = "user left") {
        if (!connected) return
        try {
            control?.send(ControlMessage.of(ControlTypes.BYE))
        } catch (ignored: Exception) {
        }
        teardown()
        listener?.onDisconnected(reason)
    }

    private fun teardown() {
        connected = false
        streaming = false
        try {
            pingThread?.interrupt()
        } catch (ignored: Exception) {
        }
        try {
            qualityThread?.interrupt()
        } catch (ignored: Exception) {
        }
        pingThread = null
        qualityThread = null
        try {
            transport?.close()
        } catch (ignored: Exception) {
        }
        transport = null
        inputPacketizer = null
        try {
            control?.close()
        } catch (ignored: Exception) {
        }
        control = null
    }
}
