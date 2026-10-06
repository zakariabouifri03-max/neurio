package com.neurio.network

import com.neurio.common.Protocol
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger

/** Client side: fire-and-forget UDP input events, optimized for minimum latency. */
class InputPacketizer(private val transport: UdpTransport) {

    private val seq = AtomicInteger(0)

    @Volatile
    var destination: InetSocketAddress? = null

    fun send(event: Protocol.InputEvent) {
        val dest = destination ?: return
        val payload = ByteArray(Protocol.INPUT_PAYLOAD_SIZE)
        val buf = java.nio.ByteBuffer.wrap(payload).order(java.nio.ByteOrder.BIG_ENDIAN)
        event.copy(seq = seq.getAndIncrement()).encode(buf)
        transport.send(
            Protocol.TYPE_INPUT, 0, 0, event.seq,
            payload, 0, payload.size, dest
        )
    }
}

/** Host side: receives input events for the session. */
class InputReceiver {
    var onEvent: ((Protocol.InputEvent, InetSocketAddress) -> Unit)? = null

    private var lastEventNano = 0L
    private var rateBucket = 0
    private var windowStartNano = 0L

    companion object {
        /** Hard cap so a misbehaving client cannot flood the injector. */
        private const val MAX_EVENTS_PER_SECOND = 400
    }

    fun onPacket(pkt: UdpPacket) {
        if (pkt.payloadLength < Protocol.INPUT_PAYLOAD_SIZE) return
        val now = System.nanoTime()
        if (now - windowStartNano > 1_000_000_000L) {
            windowStartNano = now
            rateBucket = 0
        }
        rateBucket++
        if (rateBucket > MAX_EVENTS_PER_SECOND) return
        // 1ms guard against duplicate bursts.
        if (now - lastEventNano < 500_000L && pkt.header.seq == lastSeq) return
        lastSeq = pkt.header.seq
        lastEventNano = now

        val buf = Protocol.wrap(pkt.data, pkt.payloadOffset, pkt.payloadLength)
        val event = try {
            Protocol.InputEvent.decode(buf)
        } catch (e: Exception) {
            return
        }
        onEvent?.invoke(event, pkt.from)
    }

    private var lastSeq = -1
}
