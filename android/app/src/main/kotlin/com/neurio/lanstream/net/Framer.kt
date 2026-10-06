package com.neurio.lanstream.net

import kotlin.math.min

/**
 * Splits an encoded access unit into MTU-sized datagrams.
 *
 * The scratch buffer is reused (single producer thread) so a 60 fps stream does
 * not allocate ~1500 byte arrays hundreds of times per second.
 */
class Fragmenter(
    private val channel: Byte,
    private val codec: Byte,
    private val sessionId: Int,
    private val token: Int,
    private val sink: (buffer: ByteArray, length: Int) -> Unit
) {
    private val scratch = ByteArray(Protocol.MAX_DATAGRAM)
    private val header = MediaHeader(channel = channel, codec = codec, sessionId = sessionId, token = token)

    @Volatile
    private var seq = 0

    @Volatile
    private var frameId = 0

    @Synchronized
    fun send(
        payload: ByteArray,
        ptsUs: Long,
        captureWallMs: Long,
        keyframe: Boolean,
        config: Boolean = false,
        length: Int = payload.size
    ) {
        if (length <= 0) return
        val fragCount = ((length + Protocol.MAX_PAYLOAD - 1) / Protocol.MAX_PAYLOAD).coerceAtLeast(1)
        val id = ++frameId
        var offset = 0
        for (index in 0 until fragCount) {
            val chunk = min(Protocol.MAX_PAYLOAD, length - offset)
            header.apply {
                flags = 0
                this.seq = this@Fragmenter.seq++
                this.frameId = id
                this.ptsUs = ptsUs
                this.captureWallMs = captureWallMs
                this.fragIndex = index
                this.fragCount = fragCount
            }
            header.first(index == 0).last(index == fragCount - 1)
            header.keyframe(keyframe && index == 0).config(config)
            header.writeTo(scratch)
            System.arraycopy(payload, offset, scratch, Protocol.HEADER_SIZE, chunk)
            sink(scratch, Protocol.HEADER_SIZE + chunk)
            offset += chunk
        }
    }

    fun reset() {
        seq = 0
        frameId = 0
    }
}

/**
 * Reassembles datagrams back into access units.
 *
 * Policy is deliberately lateness-hostile: as soon as a *newer* frame id shows
 * up, the previous incomplete frame is abandoned (and reported as dropped) and
 * the decoder is told to wait for the next keyframe. Queueing late frames would
 * only add latency to a live game stream.
 */
class FrameAssembler(
    private val onFrame: (frame: AssembledFrame) -> Unit,
    private val onDropped: (frameId: Int, missingFragments: Int) -> Unit
) {

    data class AssembledFrame(
        val data: ByteArray,
        val ptsUs: Long,
        val captureWallMs: Long,
        val keyframe: Boolean,
        val config: Boolean,
        val frameId: Int
    )

    private class Builder(val frameId: Int, val fragCount: Int) {
        val slots = arrayOfNulls<ByteArray>(fragCount)
        var received = 0
        var bytes = 0

        fun add(index: Int, src: ByteArray, offset: Int, length: Int): Boolean {
            if (index < 0 || index >= fragCount) return false
            if (slots[index] != null) return false
            val copy = ByteArray(length)
            System.arraycopy(src, offset, copy, 0, length)
            slots[index] = copy
            received++
            bytes += length
            return true
        }

        fun assemble(): ByteArray {
            val out = ByteArray(bytes)
            var pos = 0
            for (slot in slots) {
                if (slot == null) continue
                System.arraycopy(slot, 0, out, pos, slot.size)
                pos += slot.size
            }
            return out
        }
    }

    private var current: Builder? = null

    @Synchronized
    fun accept(header: MediaHeader, buffer: ByteArray, payloadOffset: Int, payloadLength: Int) {
        if (header.fragCount <= 0 || header.fragCount > MAX_FRAGMENTS) return

        if (header.isConfig) {
            val copy = ByteArray(payloadLength)
            System.arraycopy(buffer, payloadOffset, copy, 0, payloadLength)
            onFrame(
                AssembledFrame(
                    data = copy,
                    ptsUs = header.ptsUs,
                    captureWallMs = header.captureWallMs,
                    keyframe = false,
                    config = true,
                    frameId = header.frameId
                )
            )
            return
        }

        val active = current
        if (active == null || active.frameId != header.frameId) {
            if (active != null) {
                val newer = header.frameId - active.frameId > 0
                if (newer) {
                    onDropped(active.frameId, active.fragCount - active.received)
                    current = null
                } else {
                    // Fragment of an already abandoned frame -> ignore.
                    return
                }
            }
            current = Builder(header.frameId, header.fragCount)
        }

        val builder = current ?: return
        if (builder.add(header.fragIndex, buffer, payloadOffset, payloadLength) &&
            builder.received == builder.fragCount
        ) {
            current = null
            onFrame(
                AssembledFrame(
                    data = builder.assemble(),
                    ptsUs = header.ptsUs,
                    captureWallMs = header.captureWallMs,
                    keyframe = header.isKeyframe,
                    config = false,
                    frameId = header.frameId
                )
            )
        }
    }

    /** Called after a loss so we do not feed a broken access unit to the decoder. */
    fun dropPending() {
        current = null
    }

    companion object {
        private const val MAX_FRAGMENTS = 4096
    }
}
