package com.turbocast60.network

import android.util.Base64
import com.turbocast60.protocol.EncodedAccessUnit
import com.turbocast60.protocol.PairingHandshake
import com.turbocast60.protocol.RtpH264Packetizer
import com.turbocast60.protocol.SecureControlChannel
import org.json.JSONObject
import java.io.Closeable
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class ReceiverFeedback(
    val packetLossPercent: Double,
    val decodedFps: Double,
    val queueDrops: Long
)

interface DirectSenderListener {
    fun onFeedback(feedback: ReceiverFeedback)
    fun onRoundTripTime(rttMs: Long)
    fun onKeyFrameRequested()
    fun onRemoteError(message: String)
}

/** Secure control + encrypted H.264/RTP media to the companion TV receiver on the same LAN. */
class DirectSenderSession(
    private val listener: DirectSenderListener
) : Closeable {
    private var socket: Socket? = null
    private var channel: SecureControlChannel? = null
    private var videoSocket: DatagramSocket? = null
    private var receiverAddress: InetAddress? = null
    private var receiverVideoPort: Int = -1
    private var packetizer: RtpH264Packetizer? = null
    private var controlThread: Thread? = null
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "TurboCast-ping").apply { isDaemon = true } }
    private val pingSequence = AtomicLong(0)
    private val sentPings = ConcurrentHashMap<Long, Long>()
    @Volatile private var closed = false

    fun connect(host: String, port: Int, pairingCode: String) {
        val controlSocket = Socket()
        controlSocket.tcpNoDelay = true
        controlSocket.keepAlive = true
        controlSocket.connect(InetSocketAddress(host, port), 7_000)
        socket = controlSocket
        val secure = PairingHandshake.asClient(controlSocket, pairingCode)
        channel = secure
        receiverAddress = InetAddress.getByName(host)
        val ready = secure.read()
        check(ready.optString("type") == "READY") {
            ready.optString("message", "The receiver did not accept the connection")
        }
        receiverVideoPort = ready.getInt("udpPort")
        videoSocket = DatagramSocket().apply { sendBufferSize = 2 * 1024 * 1024 }
        packetizer = RtpH264Packetizer(secure.newVideoCipher())
        controlThread = Thread(::readControl, "TurboCast-control").apply { isDaemon = true; start() }
        scheduler.scheduleAtFixedRate({ sendPing() }, 0, 2, TimeUnit.SECONDS)
    }

    fun sendFormat(width: Int, height: Int, fps: Int, bitrate: Int, sps: ByteArray, pps: ByteArray) {
        channel?.send(
            JSONObject()
                .put("type", "CONFIG")
                .put("width", width)
                .put("height", height)
                .put("fps", fps)
                .put("bitrate", bitrate)
                .put("sps", Base64.encodeToString(sps, Base64.NO_WRAP))
                .put("pps", Base64.encodeToString(pps, Base64.NO_WRAP))
        )
    }

    fun sendAccessUnit(unit: EncodedAccessUnit) {
        val datagramSocket = videoSocket ?: return
        val address = receiverAddress ?: return
        val packets = packetizer?.packetize(unit) ?: return
        packets.forEach { bytes ->
            if (closed) return
            runCatching {
                datagramSocket.send(DatagramPacket(bytes, bytes.size, address, receiverVideoPort))
            }
        }
    }

    fun updateBitrate(bitsPerSecond: Int) {
        runCatching { channel?.send(JSONObject().put("type", "BITRATE").put("bps", bitsPerSecond)) }
    }

    private fun sendPing() {
        if (closed) return
        val id = pingSequence.incrementAndGet()
        sentPings[id] = android.os.SystemClock.elapsedRealtime()
        runCatching { channel?.send(JSONObject().put("type", "PING").put("id", id)) }
        sentPings.keys.removeIf { key -> key < id - 6 }
    }

    private fun readControl() {
        try {
            while (!closed) {
                val message = channel?.read() ?: return
                when (message.optString("type")) {
                    "PONG" -> {
                        val sentAt = sentPings.remove(message.optLong("id"))
                        if (sentAt != null) listener.onRoundTripTime((android.os.SystemClock.elapsedRealtime() - sentAt).coerceAtLeast(0))
                    }
                    "STATS" -> listener.onFeedback(
                        ReceiverFeedback(
                            packetLossPercent = message.optDouble("lossPercent", 0.0),
                            decodedFps = message.optDouble("decodedFps", 0.0),
                            queueDrops = message.optLong("queueDrops", 0L)
                        )
                    )
                    "REQUEST_IDR" -> listener.onKeyFrameRequested()
                    "ERROR" -> listener.onRemoteError(message.optString("message", "Receiver error"))
                }
            }
        } catch (t: Throwable) {
            if (!closed) listener.onRemoteError("Receiver connection was interrupted")
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        scheduler.shutdownNow()
        runCatching { channel?.send(JSONObject().put("type", "STOP")) }
        runCatching { channel?.close() }
        runCatching { videoSocket?.close() }
        runCatching { socket?.close() }
        controlThread?.interrupt()
        channel = null
        videoSocket = null
        socket = null
    }
}
