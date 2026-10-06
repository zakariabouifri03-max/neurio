package com.neurio.network

import com.neurio.common.Protocol
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger

/** Host side: one encoded audio frame per datagram (small, never fragmented). */
class AudioPacketizer(private val transport: UdpTransport) {

    companion object {
        val MAX_FRAME: Int =
            Protocol.MAX_DATAGRAM - Protocol.HEADER_SIZE - Protocol.AUTH_SIZE - Protocol.AUDIO_META_SIZE
    }

    private val seq = AtomicInteger(0)

    @Volatile
    var destination: InetSocketAddress? = null

    fun sendConfig(csd: ByteArray) {
        val dest = destination ?: return
        if (csd.size > MAX_FRAME) return
        val payload = ByteArray(Protocol.AUDIO_META_SIZE + csd.size)
        val buf = java.nio.ByteBuffer.wrap(payload).order(java.nio.ByteOrder.BIG_ENDIAN)
        buf.putLong(0L)
        System.arraycopy(csd, 0, payload, Protocol.AUDIO_META_SIZE, csd.size)
        transport.send(
            Protocol.TYPE_AUDIO, Protocol.FLAG_CONFIG, 0, seq.getAndIncrement(),
            payload, 0, payload.size, dest
        )
    }

    fun sendAudio(data: ByteArray, size: Int, ptsUs: Long) {
        val dest = destination ?: return
        if (size > MAX_FRAME) return
        val payload = ByteArray(Protocol.AUDIO_META_SIZE + size)
        val buf = java.nio.ByteBuffer.wrap(payload).order(java.nio.ByteOrder.BIG_ENDIAN)
        buf.putLong(ptsUs)
        System.arraycopy(data, 0, payload, Protocol.AUDIO_META_SIZE, size)
        transport.send(
            Protocol.TYPE_AUDIO, 0, 0, seq.getAndIncrement(),
            payload, 0, payload.size, dest
        )
    }
}

/** Client side: unwraps audio datagrams; ordering is best-effort (AudioTrack absorbs jitter). */
class AudioDepacketizer {
    var onFrame: ((data: ByteArray, size: Int, ptsUs: Long, config: Boolean) -> Unit)? = null

    private var lastSeq = -1

    fun onPacket(pkt: UdpPacket) {
        if (pkt.payloadLength < Protocol.AUDIO_META_SIZE) return
        // Drop heavily reordered packets; AudioTrack cannot use them anyway.
        if (lastSeq >= 0 && pkt.header.seq < lastSeq - 64) return
        if (pkt.header.seq > lastSeq) lastSeq = pkt.header.seq

        val buf = Protocol.wrap(pkt.data, pkt.payloadOffset, pkt.payloadLength)
        val ptsUs = buf.long
        val size = pkt.payloadLength - Protocol.AUDIO_META_SIZE
        if (size <= 0) return
        val data = ByteArray(size)
        System.arraycopy(pkt.data, pkt.payloadOffset + Protocol.AUDIO_META_SIZE, data, 0, size)
        val isConfig = (pkt.header.flags and Protocol.FLAG_CONFIG) != 0
        onFrame?.invoke(data, size, ptsUs, isConfig)
    }
}
