package com.neurio.network

import com.neurio.common.AppLog
import com.neurio.common.Protocol
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger

/**
 * Host side: fragments encoded frames into MTU-safe authenticated datagrams.
 * Fragments of one frame carry the same frameId so the client can reassemble
 * out of order. No per-frame screenshots are ever encoded; the input is the
 * continuous hardware encoder output.
 */
class VideoPacketizer(private val transport: UdpTransport) {

    companion object {
        private const val TAG = "VideoPacketizer"
        val SLICE_SIZE: Int =
            Protocol.MAX_DATAGRAM - Protocol.HEADER_SIZE - Protocol.AUTH_SIZE - Protocol.VIDEO_META_SIZE
    }

    private val seq = AtomicInteger(0)
    private var frameId = 0

    @Volatile
    var destination: InetSocketAddress? = null

    private val meta = ByteArray(Protocol.VIDEO_META_SIZE)

    fun sendConfig(csd: ByteArray) {
        val dest = destination ?: return
        if (csd.size > SLICE_SIZE) {
            AppLog.w(TAG, "config too large (${csd.size}), skipping")
            return
        }
        frameId++
        val payload = ByteArray(Protocol.VIDEO_META_SIZE + csd.size)
        val metaBuf = java.nio.ByteBuffer.wrap(payload).order(java.nio.ByteOrder.BIG_ENDIAN)
        Protocol.writeVideoMeta(metaBuf, Protocol.VideoMeta(frameId, 0L, 0, 1))
        System.arraycopy(csd, 0, payload, Protocol.VIDEO_META_SIZE, csd.size)
        transport.send(
            Protocol.TYPE_VIDEO, Protocol.FLAG_CONFIG, 0, seq.getAndIncrement(),
            payload, 0, payload.size, dest
        )
    }

    fun sendFrame(data: ByteArray, size: Int, ptsUs: Long, keyFrame: Boolean) {
        val dest = destination ?: return
        frameId++
        val fragCount = (size + SLICE_SIZE - 1) / SLICE_SIZE
        var offset = 0
        for (i in 0 until fragCount) {
            val slice = minOf(SLICE_SIZE, size - offset)
            val metaBuf = java.nio.ByteBuffer.wrap(meta).order(java.nio.ByteOrder.BIG_ENDIAN)
            metaBuf.clear()
            Protocol.writeVideoMeta(metaBuf, Protocol.VideoMeta(frameId, ptsUs, i, fragCount))
            val payload = ByteArray(Protocol.VIDEO_META_SIZE + slice)
            System.arraycopy(meta, 0, payload, 0, Protocol.VIDEO_META_SIZE)
            System.arraycopy(data, offset, payload, Protocol.VIDEO_META_SIZE, slice)
            transport.send(
                Protocol.TYPE_VIDEO,
                if (keyFrame) Protocol.FLAG_KEYFRAME else 0,
                0,
                seq.getAndIncrement(),
                payload, 0, payload.size, dest
            )
            offset += slice
        }
    }
}

/**
 * Client side: reassembles fragments into full frames and feeds them to the
 * hardware decoder. Incomplete frames are timed out; when the lost data was
 * part of a keyframe (or loss persists) an IDR is requested.
 */
class VideoDepacketizer {

    companion object {
        private const val TAG = "VideoDepacketizer"
        private const val FRAME_TIMEOUT_MS = 150L
        private const val MAX_PENDING_FRAMES = 12
    }

    var onFrame: ((data: ByteArray, size: Int, ptsUs: Long, key: Boolean, config: Boolean) -> Unit)? = null
    var onLoss: (() -> Unit)? = null

    private class FragBuf(
        val frameId: Int,
        val fragCount: Int,
        val ptsUs: Long,
        val key: Boolean,
        val createdMs: Long
    ) {
        val parts = arrayOfNulls<ByteArray>(fragCount)
        var got = 0
        var totalSize = 0
    }

    private val lock = Any()
    private val pending = HashMap<Int, FragBuf>()
    private var lossStreak = 0

    fun onPacket(pkt: UdpPacket) {
        val buf = Protocol.wrap(pkt.data, pkt.payloadOffset, pkt.payloadLength)
        if (pkt.payloadLength < Protocol.VIDEO_META_SIZE) return
        val meta = Protocol.readVideoMeta(buf) ?: return
        val isConfig = (pkt.header.flags and Protocol.FLAG_CONFIG) != 0
        val isKey = (pkt.header.flags and Protocol.FLAG_KEYFRAME) != 0

        if (isConfig) {
            val data = ByteArray(pkt.payloadLength - Protocol.VIDEO_META_SIZE)
            System.arraycopy(
                pkt.data, pkt.payloadOffset + Protocol.VIDEO_META_SIZE,
                data, 0, data.size
            )
            onFrame?.invoke(data, data.size, 0L, true, true)
            return
        }

        if (meta.fragCount <= 0 || meta.fragIndex >= meta.fragCount) return

        var complete: FragBuf? = null
        synchronized(lock) {
            var frag = pending[meta.frameId]
            if (frag == null) {
                if (pending.size >= MAX_PENDING_FRAMES) dropOldestLocked()
                frag = FragBuf(
                    meta.frameId, meta.fragCount, meta.ptsUs, isKey,
                    System.currentTimeMillis()
                )
                pending[meta.frameId] = frag
            }
            if (frag.parts[meta.fragIndex] != null) return // duplicate
            val slice = ByteArray(pkt.payloadLength - Protocol.VIDEO_META_SIZE)
            System.arraycopy(
                pkt.data, pkt.payloadOffset + Protocol.VIDEO_META_SIZE,
                slice, 0, slice.size
            )
            frag.parts[meta.fragIndex] = slice
            frag.totalSize += slice.size
            frag.got++

            if (frag.got == frag.fragCount) {
                pending.remove(meta.frameId)
                lossStreak = 0
                complete = frag
            }
        }

        val frag = complete ?: return
        val full = ByteArray(frag.totalSize)
        var off = 0
        for (p in frag.parts) {
            if (p == null) return
            System.arraycopy(p, 0, full, off, p.size)
            off += p.size
        }
        onFrame?.invoke(full, full.size, frag.ptsUs, frag.key, false)
    }

    private fun dropOldestLocked() {
        val oldest = pending.values.minByOrNull { it.createdMs } ?: return
        pending.remove(oldest.frameId)
        if (oldest.key) requestIdr("dropped stale keyframe")
    }

    /** Call periodically (~50ms). Times out incomplete frames. */
    fun tick(nowMs: Long) {
        var lostKey = false
        var anyExpired = false
        synchronized(lock) {
            val expired = pending.values.filter { nowMs - it.createdMs > FRAME_TIMEOUT_MS }
            if (expired.isEmpty()) return
            anyExpired = true
            for (f in expired) {
                pending.remove(f.frameId)
                lostKey = lostKey || f.key
            }
        }
        if (!anyExpired) return
        if (lostKey) {
            requestIdr("keyframe fragments lost")
        } else {
            lossStreak++
            if (lossStreak >= 4) requestIdr("persistent fragment loss")
        }
    }

    private fun requestIdr(reason: String) {
        AppLog.d(TAG, "requesting IDR: $reason")
        lossStreak = 0
        onLoss?.invoke()
    }
}
