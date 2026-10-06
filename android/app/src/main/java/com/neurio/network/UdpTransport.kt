package com.neurio.network

import com.neurio.common.AppLog
import com.neurio.common.Protocol
import com.neurio.common.SessionSecurity
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress

/** One received, authenticated datagram. */
data class UdpPacket(
    val header: Protocol.UdpHeader,
    val data: ByteArray,
    val payloadOffset: Int,
    val payloadLength: Int,
    val from: InetSocketAddress
)

/**
 * Authenticated UDP transport shared by video, audio, input and fast control.
 * Every outgoing datagram is signed with the session token; every incoming
 * datagram is verified before dispatch.
 */
class UdpTransport(
    private val token: ByteArray,
    private val sessionId: Int,
    existingSocket: DatagramSocket? = null
) {
    companion object {
        private const val TAG = "UdpTransport"
        private const val BUF_SIZE = 4 * 1024 * 1024
    }

    val socket: DatagramSocket = existingSocket ?: DatagramSocket(null).apply {
        bind(InetSocketAddress(0))
    }

    val localPort: Int get() = socket.localPort

    @Volatile
    var running = false
        private set

    private var rxThread: Thread? = null

    private val sendLock = Any()
    private val sendBuffer = ByteArray(Protocol.MAX_DATAGRAM + Protocol.AUTH_SIZE)

    var onPacket: ((UdpPacket) -> Unit)? = null

    fun start() {
        if (running) return
        running = true
        try {
            socket.sendBufferSize = BUF_SIZE
            socket.receiveBufferSize = BUF_SIZE
        } catch (e: Exception) {
            AppLog.w(TAG, "could not enlarge socket buffers: ${e.message}")
        }
        val t = Thread { rxLoop() }
        t.name = "neurio-udp-rx"
        t.isDaemon = true
        rxThread = t
        t.start()
    }

    private fun rxLoop() {
        val buf = ByteArray(Protocol.MAX_DATAGRAM + Protocol.AUTH_SIZE + 64)
        val packet = DatagramPacket(buf, buf.size)
        while (running) {
            try {
                packet.length = buf.size
                socket.receive(packet)
            } catch (e: Exception) {
                if (running) AppLog.w(TAG, "receive error: ${e.message}")
                break
            }
            val len = packet.length
            if (len < Protocol.HEADER_SIZE + Protocol.AUTH_SIZE) continue
            val header = Protocol.readHeader(buf, len) ?: continue
            if (header.sessionId != sessionId) continue
            if (!SessionSecurity.verify(token, buf, len)) continue
            val payloadOff = Protocol.HEADER_SIZE
            val payloadLen = len - Protocol.HEADER_SIZE - Protocol.AUTH_SIZE
            if (payloadLen < 0) continue
            val from = packet.socketAddress as? InetSocketAddress ?: continue
            try {
                onPacket?.invoke(
                    UdpPacket(header, buf.copyOf(len), payloadOff, payloadLen, from)
                )
            } catch (e: Exception) {
                AppLog.w(TAG, "packet handler error", e)
            }
        }
        AppLog.d(TAG, "rx loop ended")
    }

    fun send(
        type: Int,
        flags: Int,
        subtype: Int,
        seq: Int,
        payload: ByteArray,
        payloadOffset: Int,
        payloadLength: Int,
        dest: InetSocketAddress
    ) {
        if (!running && !socket.isBound) return
        synchronized(sendLock) {
            val total = Protocol.HEADER_SIZE + payloadLength + Protocol.AUTH_SIZE
            if (total > sendBuffer.size) {
                AppLog.w(TAG, "datagram too large: $total")
                return
            }
            val buf = java.nio.ByteBuffer.wrap(sendBuffer).order(java.nio.ByteOrder.BIG_ENDIAN)
            Protocol.writeHeader(buf, type, flags, subtype, sessionId, seq)
            buf.put(payload, payloadOffset, payloadLength)
            SessionSecurity.sign(token, sendBuffer, Protocol.HEADER_SIZE + payloadLength)
            try {
                socket.send(DatagramPacket(sendBuffer, total, dest))
            } catch (e: Exception) {
                AppLog.w(TAG, "send error: ${e.message}")
            }
        }
    }

    fun close() {
        running = false
        try {
            socket.close()
        } catch (ignored: Exception) {
        }
    }
}
