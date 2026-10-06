package com.neurio.lanstream.net

import com.neurio.lanstream.core.BitrateMeter
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.input.InputReceiver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * One media channel: fragments access units, sends them, keeps byte/packet
 * counters for the statistics overlay.
 */
class MediaSender(
    socket: DatagramSocket,
    destination: InetSocketAddress,
    channel: Byte,
    codec: Byte,
    private val sessionId: Int,
    private val token: Int
) {
    private val sender = UdpSender(socket, destination)
    private val fragmenter = Fragmenter(channel, codec, sessionId, token) { buffer, length ->
        sender.send(buffer, length)
    }

    private var seq = 0

    val bytesSent: Long get() = sender.bytesSent
    val packetsSent: Long get() = sender.packetsSent
    val sendFailures: Long get() = sender.failures

    fun setDestination(address: InetAddress, port: Int) {
        sender.destination = InetSocketAddress(address, port)
    }

    fun sendFrame(
        payload: ByteArray,
        ptsUs: Long,
        captureWallMs: Long,
        keyframe: Boolean,
        config: Boolean = false,
        length: Int = payload.size
    ) {
        seq++
        fragmenter.send(payload, ptsUs, captureWallMs, keyframe, config, length)
    }

    fun resetCounters() {
        fragmenter.reset()
    }
}

/**
 * Host side of the media + input transport.
 *
 * Ports are fixed on the host (the client learns them from the control
 * handshake) while the destination is set once the client says which ephemeral
 * ports it is listening on.
 */
class StreamServer(private val sessionId: Int, private val token: Int) {

    private var videoSocket: DatagramSocket? = null
    private var audioSocket: DatagramSocket? = null
    private var inputSocket: DatagramSocket? = null

    private var videoSender: MediaSender? = null
    private var audioSender: MediaSender? = null
    private var inputSender: MediaSender? = null

    private var inputJob: Job? = null

    @Volatile
    private var lastInputSource: InetSocketAddress? = null

    val videoBitrate = BitrateMeter()
    val audioBitrate = BitrateMeter()

    @Volatile
    var videoBytesSent: Long = 0L
        private set

    @Volatile
    var rejectedPackets: Long = 0L
        private set

    fun video(): MediaSender? = videoSender
    fun audio(): MediaSender? = audioSender

    fun open(hostVideoMime: String, hostAudioMime: String) {
        close()
        val vSocket = Udp.bind(Protocol.VIDEO_PORT)
        val aSocket = Udp.bind(Protocol.AUDIO_PORT)
        val iSocket = Udp.bind(Protocol.INPUT_PORT)
        videoSocket = vSocket
        audioSocket = aSocket
        inputSocket = iSocket
        val placeholder = InetSocketAddress(0)
        videoSender = MediaSender(
            vSocket, placeholder, Protocol.CHANNEL_VIDEO,
            Protocol.codecForMime(hostVideoMime), sessionId, token
        )
        audioSender = MediaSender(
            aSocket, placeholder, Protocol.CHANNEL_AUDIO,
            Protocol.codecForMime(hostAudioMime), sessionId, token
        )
        inputSender = MediaSender(
            iSocket, placeholder, Protocol.CHANNEL_INPUT, Protocol.INPUT_PONG, sessionId, token
        )
        Log.i("Stream server opened (video=${Protocol.VIDEO_PORT}, audio=${Protocol.AUDIO_PORT}, input=${Protocol.INPUT_PORT})")
    }

    fun setClient(client: InetAddress, videoPort: Int, audioPort: Int, inputPort: Int) {
        videoSender?.setDestination(client, videoPort)
        audioSender?.setDestination(client, audioPort)
        if (inputPort > 0) {
            lastInputSource = InetSocketAddress(client, inputPort)
        }
        Log.i("Stream destination -> $client (video=$videoPort audio=$audioPort input=$inputPort)")
    }

    fun startInputReceiver(scope: CoroutineScope, receiver: InputReceiver) {
        val socket = inputSocket ?: return
        inputJob?.cancel()
        inputJob = scope.launch(Dispatchers.IO) {
            val udp = UdpReceiver(socket, onPacket = { header, buffer, offset, length, from ->
                lastInputSource = from
                val accepted = when (header.channel) {
                    Protocol.CHANNEL_INPUT -> receiver.accept(header, buffer, offset, length)
                    else -> {
                        rejectedPackets++
                        false
                    }
                }
                if (!accepted) rejectedPackets++
            })
            udp.loop()
        }
    }

    /** Answers an input-channel ping so the client can measure RTT + clock offset. */
    fun sendPong(clientSendMs: Long, hostReceiveMs: Long) {
        val destination = lastInputSource ?: return
        val socket = inputSocket ?: return
        val hostSendMs = System.currentTimeMillis()
        val payload = ByteArray(24)
        // payload: clientSendMs(8), hostReceive(8), hostSend(8)
        java.nio.ByteBuffer.wrap(payload).apply {
            putLong(clientSendMs)
            putLong(hostReceiveMs)
            putLong(hostSendMs)
        }
        val buffer = ByteArray(Protocol.HEADER_SIZE + payload.size)
        MediaHeader(
            channel = Protocol.CHANNEL_INPUT,
            codec = Protocol.INPUT_PONG,
            flags = Protocol.FLAG_FIRST or Protocol.FLAG_LAST,
            sessionId = sessionId,
            token = token,
            ptsUs = clientSendMs,
            captureWallMs = hostSendMs
        ).writeTo(buffer)
        System.arraycopy(payload, 0, buffer, Protocol.HEADER_SIZE, payload.size)
        val packet = java.net.DatagramPacket(buffer, buffer.size, destination.address, destination.port)
        runCatching { socket.send(packet) }
            .onFailure { Log.w("Pong send failed: ${it.message}") }
    }

    fun updateCounters() {
        val bytes = (videoSender?.bytesSent ?: 0L)
        videoBitrate.add(bytes - videoBytesSent)
        videoBytesSent = bytes
    }

    fun close() {
        inputJob?.cancel()
        inputJob = null
        videoSender = null
        audioSender = null
        inputSender = null
        runCatching { videoSocket?.close() }
        runCatching { audioSocket?.close() }
        runCatching { inputSocket?.close() }
        videoSocket = null
        audioSocket = null
        inputSocket = null
        lastInputSource = null
        videoBitrate.reset()
        audioBitrate.reset()
        videoBytesSent = 0L
    }
}
