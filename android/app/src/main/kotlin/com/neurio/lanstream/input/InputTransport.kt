package com.neurio.lanstream.input

import com.neurio.lanstream.core.Log
import com.neurio.lanstream.net.MediaHeader
import com.neurio.lanstream.net.Protocol
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress

/**
 * Client -> host input channel.
 *
 * Fire and forget UDP: a dropped touch packet is far less annoying than a
 * retransmit that arrives 40 ms late. Sequence numbers are still tracked so the
 * UI can show real packet loss.
 */
class InputTransport(
    private val socket: DatagramSocket,
    destination: InetSocketAddress,
    private val sessionId: Int,
    private val token: Int
) {
    private val scratch = ByteArray(Protocol.MAX_DATAGRAM)
    private val header = MediaHeader(
        channel = Protocol.CHANNEL_INPUT,
        sessionId = sessionId,
        token = token
    )
    private val packet = DatagramPacket(scratch, scratch.size, destination)

    @Volatile
    private var seq = 0

    var destination: InetSocketAddress = destination
        set(value) {
            field = value
            packet.address = value.address
            packet.port = value.port
        }

    @Synchronized
    fun send(event: InputEvent) {
        sendRaw(InputWire.typeOf(event), InputWire.encode(event), System.currentTimeMillis())
    }

    /** Ping used for RTT + clock offset estimation (host answers on this socket). */
    @Synchronized
    fun sendPing() {
        sendRaw(Protocol.INPUT_PING, null, System.currentTimeMillis())
    }

    @Synchronized
    fun sendRaw(type: Byte, payload: ByteArray?, timestampMs: Long) {
        header.apply {
            codec = type
            flags = Protocol.FLAG_FIRST or Protocol.FLAG_LAST
            this.seq = this@InputTransport.seq++
            frameId = 0
            ptsUs = timestampMs
            captureWallMs = timestampMs
            fragIndex = 0
            fragCount = 1
        }
        header.writeTo(scratch)
        val length = if (payload == null) {
            Protocol.HEADER_SIZE
        } else {
            val copy = minOf(payload.size, Protocol.MAX_PAYLOAD)
            System.arraycopy(payload, 0, scratch, Protocol.HEADER_SIZE, copy)
            Protocol.HEADER_SIZE + copy
        }
        packet.length = length
        try {
            socket.send(packet)
        } catch (t: Throwable) {
            Log.w("Input send failed: ${t.message}")
        }
    }
}

/**
 * Host side of the input channel.
 *
 * Every datagram is checked against the authenticated session before it is
 * handed to [onEvent], so a device that never completed the pairing handshake
 * cannot inject touches.
 */
class InputReceiver(
    private val sessionId: Int,
    private val token: Int,
    private val onEvent: (InputEvent) -> Unit,
    private val onPing: (clientSendMs: Long, hostReceiveMs: Long) -> Unit,
    private val onRejected: () -> Unit = {}
) {
    @Volatile
    var packetsReceived = 0L
        private set

    @Volatile
    var lastEventMs = 0L
        private set

    fun accept(header: MediaHeader, buffer: ByteArray, offset: Int, length: Int): Boolean {
        if (header.channel != Protocol.CHANNEL_INPUT) return false
        if (header.sessionId != sessionId || header.token != token) {
            onRejected()
            return false
        }
        packetsReceived++
        lastEventMs = System.currentTimeMillis()
        when (header.codec) {
            Protocol.INPUT_PING -> onPing(header.ptsUs, System.currentTimeMillis())
            Protocol.INPUT_PONG -> Unit
            else -> {
                val event = InputWire.decode(header.codec, buffer, offset, length, header.ptsUs)
                if (event != null) onEvent(event)
            }
        }
        return true
    }
}
