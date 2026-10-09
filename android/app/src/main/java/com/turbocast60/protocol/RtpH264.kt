package com.turbocast60.protocol

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.SecureRandom
import kotlin.math.min

 data class EncodedAccessUnit(
    val presentationTimeUs: Long,
    val nals: List<ByteArray>,
    val keyFrame: Boolean
) {
    fun annexBBytes(): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        nals.forEach { nal ->
            out.write(byteArrayOf(0, 0, 0, 1))
            out.write(nal)
        }
        return out.toByteArray()
    }
}

object H264NalUnits {
    fun parse(data: ByteArray): List<ByteArray> {
        if (data.isEmpty()) return emptyList()
        val hasAnnexBPrefix = (data.size >= 4 && data[0] == 0.toByte() && data[1] == 0.toByte() && data[2] == 0.toByte() && data[3] == 1.toByte()) ||
            (data.size >= 3 && data[0] == 0.toByte() && data[1] == 0.toByte() && data[2] == 1.toByte())
        if (!hasAnnexBPrefix) {
            parseLengthPrefixed(data, 4)?.let { return it }
            parseLengthPrefixed(data, 2)?.let { return it }
        }
        val starts = ArrayList<Pair<Int, Int>>()
        var index = 0
        while (index + 3 <= data.size) {
            val prefix = when {
                index + 4 <= data.size && data[index] == 0.toByte() && data[index + 1] == 0.toByte() &&
                    data[index + 2] == 0.toByte() && data[index + 3] == 1.toByte() -> 4
                data[index] == 0.toByte() && data[index + 1] == 0.toByte() && data[index + 2] == 1.toByte() -> 3
                else -> 0
            }
            if (prefix != 0) {
                starts += index to prefix
                index += prefix
            } else index++
        }
        if (starts.isNotEmpty()) {
            return starts.mapIndexedNotNull { i, (start, prefix) ->
                val end = starts.getOrNull(i + 1)?.first ?: data.size
                if (end <= start + prefix) null else data.copyOfRange(start + prefix, end)
            }
        }

        return listOf(data.copyOf())
    }

    private fun parseLengthPrefixed(data: ByteArray, lengthBytes: Int): List<ByteArray>? {
        val result = ArrayList<ByteArray>()
        var offset = 0
        while (offset + lengthBytes <= data.size) {
            var size = 0
            repeat(lengthBytes) { size = (size shl 8) or (data[offset + it].toInt() and 0xff) }
            offset += lengthBytes
            if (size <= 0 || size > data.size - offset) return null
            result += data.copyOfRange(offset, offset + size)
            offset += size
        }
        return result.takeIf { it.isNotEmpty() && offset == data.size }
    }

    fun parameterSets(vararg codecSpecificData: ByteArray?): Pair<ByteArray?, ByteArray?> {
        var sps: ByteArray? = null
        var pps: ByteArray? = null
        codecSpecificData.filterNotNull().forEach { bytes ->
            parse(bytes).forEach { nal ->
                if (nal.isNotEmpty()) when (nal[0].toInt() and 0x1f) {
                    7 -> sps = nal
                    8 -> pps = nal
                }
            }
        }
        return sps to pps
    }
}

/** RFC 6184 single-NAL/FU-A packetization over RTP/UDP with a small datagram ceiling. */
class RtpH264Packetizer(
    private val videoCipher: SecureVideoCipher? = null,
    private val mtu: Int = 1200,
    ssrc: Int = SecureRandom().nextInt()
) {
    private var sequence = SecureRandom().nextInt(0x1_0000)
    private val ssrcValue = ssrc

    @Synchronized
    fun packetize(accessUnit: EncodedAccessUnit): List<ByteArray> {
        val maxRtpPayload = mtu - 12 - if (videoCipher != null) 24 else 0
        require(maxRtpPayload > 100) { "MTU too small for secure RTP" }
        val timestamp = ((accessUnit.presentationTimeUs * 90L) / 1000L) and 0xffff_ffffL
        val payloads = ArrayList<ByteArray>()
        accessUnit.nals.filter { it.isNotEmpty() && (it[0].toInt() and 0x1f) !in setOf(7, 8, 9) }.forEach { nal ->
            if (nal.size <= maxRtpPayload) {
                payloads += nal
            } else {
                val indicator = nal[0].toInt() and 0xe0
                val nalType = nal[0].toInt() and 0x1f
                val chunkLimit = maxRtpPayload - 2
                var offset = 1
                while (offset < nal.size) {
                    val count = min(chunkLimit, nal.size - offset)
                    val start = offset == 1
                    val end = offset + count == nal.size
                    val fuIndicator = (indicator or 28).toByte()
                    val fuHeader = (nalType or (if (start) 0x80 else 0) or (if (end) 0x40 else 0)).toByte()
                    payloads += byteArrayOf(fuIndicator, fuHeader) + nal.copyOfRange(offset, offset + count)
                    offset += count
                }
            }
        }
        return payloads.mapIndexed { index, payload ->
            val last = index == payloads.lastIndex
            val header = ByteBuffer.allocate(12).order(ByteOrder.BIG_ENDIAN)
                .put(0x80.toByte())
                .put(((if (last) 0x80 else 0) or 96).toByte())
                .putShort((sequence++ and 0xffff).toShort())
                .putInt(timestamp.toInt())
                .putInt(ssrcValue)
                .array()
            val packet = header + payload
            videoCipher?.protect(packet) ?: packet
        }
    }
}

/** Small-latency H.264 RTP reassembler. A damaged access unit is dropped and requests an IDR. */
class RtpH264Reassembler(
    private val onAccessUnit: (EncodedAccessUnit) -> Unit,
    private val onLoss: (Long) -> Unit,
    private val onIdrNeeded: () -> Unit
) {
    private var expectedSequence: Int? = null
    private var currentTimestamp: Long? = null
    private var currentNals = ArrayList<ByteArray>()
    private var fragmentedNal: java.io.ByteArrayOutputStream? = null
    private var damaged = false
    private var receivedPackets = 0L
    private var lostPackets = 0L
    private var lastFeedbackNs = System.nanoTime()

    @Synchronized
    fun accept(raw: ByteArray) {
        if (raw.size < 13 || (raw[0].toInt() and 0xc0) != 0x80) return
        val csrcCount = raw[0].toInt() and 0x0f
        val extension = (raw[0].toInt() and 0x10) != 0
        val headerBytes = 12 + csrcCount * 4
        if (raw.size < headerBytes) return
        var payloadOffset = headerBytes
        if (extension) {
            if (raw.size < payloadOffset + 4) return
            val extensionWords = ((raw[payloadOffset + 2].toInt() and 0xff) shl 8) or (raw[payloadOffset + 3].toInt() and 0xff)
            payloadOffset += 4 + extensionWords * 4
        }
        if ((raw[0].toInt() and 0x20) != 0) {
            val padding = raw.last().toInt() and 0xff
            if (padding <= 0 || padding > raw.size - payloadOffset) return
        }
        val payloadEnd = raw.size - if ((raw[0].toInt() and 0x20) != 0) (raw.last().toInt() and 0xff) else 0
        if (payloadOffset >= payloadEnd) return

        val buffer = ByteBuffer.wrap(raw).order(ByteOrder.BIG_ENDIAN)
        val marker = (raw[1].toInt() and 0x80) != 0
        val sequence = buffer.getShort(2).toInt() and 0xffff
        val timestamp = buffer.getInt(4).toLong() and 0xffff_ffffL
        receivedPackets++
        expectedSequence?.let { expected ->
            if (sequence != expected) {
                val gap = (sequence - expected + 0x1_0000) and 0xffff
                if (gap in 1..0x7fff) {
                    lostPackets += gap.toLong()
                    damaged = true
                    fragmentedNal = null
                } else if (gap != 0) {
                    // A late/reordered packet belongs to an access unit already abandoned.
                    return
                }
            }
        }
        expectedSequence = (sequence + 1) and 0xffff

        if (currentTimestamp != null && timestamp != currentTimestamp) {
            if (!damaged) finish(previousTimestamp = currentTimestamp!!)
            else requestIdr()
            resetUnit()
        }
        currentTimestamp = timestamp
        if (damaged) {
            if (marker) resetUnit(keepTimestamp = true)
            feedbackIfDue()
            return
        }

        val payload = raw.copyOfRange(payloadOffset, payloadEnd)
        val type = payload[0].toInt() and 0x1f
        when (type) {
            in 1..23 -> currentNals += payload
            24 -> parseStapA(payload)
            28 -> parseFuA(payload)
            else -> damaged = true
        }

        if (marker) {
            if (fragmentedNal != null) damaged = true
            if (!damaged) finish(timestamp)
            else requestIdr()
            resetUnit(keepTimestamp = true)
        }
        feedbackIfDue()
    }

    @Synchronized
    fun packetStatsAndReset(): Pair<Long, Long> {
        val result = receivedPackets to lostPackets
        receivedPackets = 0
        lostPackets = 0
        return result
    }

    private fun parseStapA(payload: ByteArray) {
        var offset = 1
        while (offset + 2 <= payload.size) {
            val size = ((payload[offset].toInt() and 0xff) shl 8) or (payload[offset + 1].toInt() and 0xff)
            offset += 2
            if (size <= 0 || offset + size > payload.size) {
                damaged = true
                return
            }
            currentNals += payload.copyOfRange(offset, offset + size)
            offset += size
        }
        if (offset != payload.size) damaged = true
    }

    private fun parseFuA(payload: ByteArray) {
        if (payload.size < 3) {
            damaged = true
            return
        }
        val fuIndicator = payload[0].toInt() and 0xff
        val fuHeader = payload[1].toInt() and 0xff
        val start = (fuHeader and 0x80) != 0
        val end = (fuHeader and 0x40) != 0
        if (start) {
            if (fragmentedNal != null) damaged = true
            fragmentedNal = java.io.ByteArrayOutputStream().apply {
                write((fuIndicator and 0xe0) or (fuHeader and 0x1f))
                write(payload, 2, payload.size - 2)
            }
        } else {
            val current = fragmentedNal
            if (current == null) {
                damaged = true
                return
            }
            current.write(payload, 2, payload.size - 2)
        }
        if (end) {
            val completed = fragmentedNal?.toByteArray()
            if (completed == null) damaged = true else currentNals += completed
            fragmentedNal = null
        }
    }

    private fun finish(previousTimestamp: Long) {
        if (currentNals.isEmpty()) return
        val nals = currentNals
        val hasIdr = nals.any { it.isNotEmpty() && (it[0].toInt() and 0x1f) == 5 }
        // RTP 90 kHz timestamps map to a decoder presentation clock in microseconds.
        onAccessUnit(EncodedAccessUnit(previousTimestamp * 1_000_000L / 90_000L, nals, hasIdr))
    }

    private fun requestIdr() {
        onLoss(lostPackets)
        onIdrNeeded()
    }

    private fun feedbackIfDue() {
        val now = System.nanoTime()
        if (now - lastFeedbackNs >= 2_000_000_000L) {
            lastFeedbackNs = now
            onLoss(lostPackets)
        }
    }

    private fun resetUnit(keepTimestamp: Boolean = false) {
        currentNals = ArrayList()
        fragmentedNal = null
        damaged = false
        if (!keepTimestamp) currentTimestamp = null
    }
}
