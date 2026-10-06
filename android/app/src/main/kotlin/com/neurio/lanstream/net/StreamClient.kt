package com.neurio.lanstream.net

import com.neurio.lanstream.core.BitrateMeter
import com.neurio.lanstream.core.LossTracker
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.input.InputEvent
import com.neurio.lanstream.input.InputTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.ByteBuffer

/** One incoming media channel: validation, loss tracking, reassembly, stats. */
class MediaReceiver(
    private val socket: DatagramSocket,
    private val sessionId: Int,
    private val token: Int,
    private val channel: Byte,
    private val onFrame: (FrameAssembler.AssembledFrame) -> Unit,
    private val onDropped: (frameId: Int, missingFragments: Int) -> Unit
) {
    private val assembler = FrameAssembler(onFrame, onDropped)
    private val loss = LossTracker()
    private val bitrate = BitrateMeter()

    @Volatile
    var lastPacketMs: Long = 0L
        private set

    @Volatile
    var frames: Long = 0L
        private set

    private var job: Job? = null

    fun start(scope: CoroutineScope) {
        job?.cancel()
        job = scope.launch(Dispatchers.IO) {
            val receiver = UdpReceiver(socket, onPacket = { header, buffer, offset, length, _ ->
                onPacket(header, buffer, offset, length)
            }, onBadPacket = { Log.v("Dropped a non-Neurio datagram") })
            receiver.loop()
        }
    }

    private fun onPacket(header: MediaHeader, buffer: ByteArray, offset: Int, length: Int) {
        if (header.channel != channel) return
        if (header.sessionId != sessionId || header.token != token) return
        lastPacketMs = System.currentTimeMillis()
        loss.onSequence(header.seq)
        bitrate.add(length.toLong())
        assembler.accept(header, buffer, offset, length)
        if (header.isFirst && header.fragIndex == 0) frames++
    }

    fun lossRatio(): Float = loss.ratio()

    fun lossRatioAndReset(): Float = loss.ratioAndReset()

    fun bitrateBps(): Long = bitrate.bps()

    fun dropPending() {
        assembler.dropPending()
    }

    fun stop() {
        job?.cancel()
        job = null
        runCatching { socket.close() }
    }
}

/**
 * Client side of the media + input transport.
 *
 * Three ephemeral UDP ports are opened and reported to the host in the `ready`
 * control message, which is what makes NAT-less LAN streaming work even when a
 * fixed port is already taken on the phone.
 */
class StreamClient(private val sessionId: Int, private val token: Int) {

    data class Ports(val video: Int, val audio: Int, val input: Int)

    private var videoSocket: DatagramSocket? = null
    private var audioSocket: DatagramSocket? = null
    private var inputSocket: DatagramSocket? = null

    private var videoReceiver: MediaReceiver? = null
    private var audioReceiver: MediaReceiver? = null

    @Volatile
    var inputTransport: InputTransport? = null
        private set

    private var inputJob: Job? = null

    fun open(): Ports {
        close()
        val vSocket = Udp.ephemeral()
        val aSocket = Udp.ephemeral()
        val iSocket = Udp.ephemeral()
        videoSocket = vSocket
        audioSocket = aSocket
        inputSocket = iSocket
        return Ports(vSocket.localPort, aSocket.localPort, iSocket.localPort)
    }

    fun start(
        scope: CoroutineScope,
        host: InetAddress,
        inputPort: Int,
        videoMime: String,
        onVideoFrame: (FrameAssembler.AssembledFrame) -> Unit,
        onAudioFrame: (FrameAssembler.AssembledFrame) -> Unit,
        onVideoDropped: (frameId: Int, missing: Int) -> Unit,
        onPong: (clientSendMs: Long, hostReceiveMs: Long, hostSendMs: Long, clientReceiveMs: Long) -> Unit
    ) {
        val vSocket = videoSocket ?: return
        val aSocket = audioSocket ?: return
        val iSocket = inputSocket ?: return

        videoReceiver = MediaReceiver(
            socket = vSocket,
            sessionId = sessionId,
            token = token,
            channel = Protocol.CHANNEL_VIDEO,
            onFrame = onVideoFrame,
            onDropped = onVideoDropped
        ).also { it.start(scope) }

        audioReceiver = MediaReceiver(
            socket = aSocket,
            sessionId = sessionId,
            token = token,
            channel = Protocol.CHANNEL_AUDIO,
            onFrame = onAudioFrame,
            onDropped = { _, _ -> }
        ).also { it.start(scope) }

        inputTransport = InputTransport(
            socket = iSocket,
            destination = InetSocketAddress(host, inputPort),
            sessionId = sessionId,
            token = token
        )

        inputJob = scope.launch(Dispatchers.IO) {
            val receiver = UdpReceiver(iSocket, onPacket = { header, buffer, offset, length, _ ->
                val mine = header.sessionId == sessionId && header.token == token
                if (mine && header.codec == Protocol.INPUT_PONG && length >= 24) {
                    val bb = ByteBuffer.wrap(buffer, offset, 24)
                    val clientSendMs = bb.long
                    val hostReceiveMs = bb.long
                    val hostSendMs = bb.long
                    onPong(clientSendMs, hostReceiveMs, hostSendMs, System.currentTimeMillis())
                }
            })
            receiver.loop()
        }
        Log.i("Stream client started (video=${videoMime}, inputPort=$inputPort)")
    }

    fun videoStats(): MediaReceiver? = videoReceiver
    fun audioStats(): MediaReceiver? = audioReceiver

    fun sendInput(event: InputEvent) {
        inputTransport?.send(event)
    }

    fun sendPing() {
        inputTransport?.sendPing()
    }

    fun requestResync() {
        videoReceiver?.dropPending()
    }

    fun close() {
        inputJob?.cancel()
        inputJob = null
        videoReceiver?.stop()
        audioReceiver?.stop()
        videoReceiver = null
        audioReceiver = null
        inputTransport = null
        runCatching { videoSocket?.close() }
        runCatching { audioSocket?.close() }
        runCatching { inputSocket?.close() }
        videoSocket = null
        audioSocket = null
        inputSocket = null
    }
}
