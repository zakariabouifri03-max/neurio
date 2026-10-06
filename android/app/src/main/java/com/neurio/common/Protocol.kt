package com.neurio.common

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Neurio LAN streaming protocol.
 *
 * UDP datagram layout (all fields big-endian):
 *
 * ```
 * offset  size  field
 * 0       2     magic 0x4E53 ("NS")
 * 2       1     protocol version (1)
 * 3       1     packet type (TYPE_VIDEO / TYPE_AUDIO / TYPE_INPUT / TYPE_PING / TYPE_PONG / TYPE_CONTROL)
 * 4       1     flags (FLAG_KEYFRAME, FLAG_CONFIG)
 * 5       1     subtype (CONTROL_* subtypes, otherwise 0)
 * 6       2     reserved (0)
 * 8       4     session id (issued at pairing; spoofing barrier on the LAN)
 * 12      4     sequence number (per stream)
 * 16      ...   type specific payload
 * last    8     HMAC-SHA258(sessionToken, datagram[0 .. len-8]) truncated to 8 bytes
 * ```
 *
 * Video payload: [frameId u32][ptsUs u64][fragIndex u16][fragCount u16][slice bytes]
 * Audio payload: [ptsUs u64][frame bytes]
 * Input payload: see [InputEvent]
 * Ping payload:  [sendMs u64][echoMs u64 (0 for PING, echoed value for PONG)]
 *
 * This file is pure JVM Kotlin (no Android imports) so the protocol logic is
 * covered by unit tests.
 */
object Protocol {
    const val MAGIC: Int = 0x4E53
    const val VERSION: Int = 1

    const val TYPE_VIDEO: Int = 1
    const val TYPE_AUDIO: Int = 2
    const val TYPE_INPUT: Int = 3
    const val TYPE_PING: Int = 4
    const val TYPE_PONG: Int = 5
    const val TYPE_CONTROL: Int = 6

    const val HEADER_SIZE: Int = 16
    const val AUTH_SIZE: Int = 8

    /** Keep datagrams under the common LAN MTU to avoid IP fragmentation. */
    const val MAX_DATAGRAM: Int = 1400
    const val VIDEO_META_SIZE: Int = 16
    const val AUDIO_META_SIZE: Int = 8
    const val INPUT_PAYLOAD_SIZE: Int = 24

    const val FLAG_KEYFRAME: Int = 0x01
    const val FLAG_CONFIG: Int = 0x02

    const val CONTROL_IDR_REQUEST: Int = 1
    const val CONTROL_QUALITY_REPORT: Int = 2
    const val CONTROL_KEEPALIVE: Int = 3
    const val CONTROL_ADAPT: Int = 4

    // ---- Input event types -------------------------------------------------
    const val INPUT_TOUCH_DOWN: Int = 1
    const val INPUT_TOUCH_MOVE: Int = 2
    const val INPUT_TOUCH_UP: Int = 3
    const val INPUT_AXIS: Int = 4
    const val INPUT_BUTTON: Int = 5
    const val INPUT_KEY: Int = 6
    const val INPUT_TAP: Int = 7

    // ---- Axis ids ----------------------------------------------------------
    const val AXIS_JOYSTICK: Int = 1

    // ---- Button ids --------------------------------------------------------
    const val BTN_A: Int = 1
    const val BTN_B: Int = 2
    const val BTN_X: Int = 3
    const val BTN_Y: Int = 4
    const val BTN_L1: Int = 5
    const val BTN_R1: Int = 6
    const val BTN_L2: Int = 7
    const val BTN_R2: Int = 8
    const val BTN_START: Int = 9
    const val BTN_SELECT: Int = 10
    const val BTN_DP_UP: Int = 11
    const val BTN_DP_DOWN: Int = 12
    const val BTN_DP_LEFT: Int = 13
    const val BTN_DP_RIGHT: Int = 14

    // -----------------------------------------------------------------------

    data class UdpHeader(
        val type: Int,
        val flags: Int,
        val subtype: Int,
        val sessionId: Int,
        val seq: Int
    )

    data class VideoMeta(
        val frameId: Int,
        val ptsUs: Long,
        val fragIndex: Int,
        val fragCount: Int
    )

    /** One user-input event. Coordinates are normalized 0..1 relative to the stream. */
    data class InputEvent(
        val evType: Int,
        val code: Int,
        val flags: Int,
        val x: Float,
        val y: Float,
        val value: Float,
        val seq: Int,
        val tsMs: Int
    ) {
        fun encode(buf: ByteBuffer) {
            buf.put(evType.toByte())
            buf.put(code.toByte())
            buf.put(flags.toByte())
            buf.put(0)
            buf.putFloat(x)
            buf.putFloat(y)
            buf.putFloat(value)
            buf.putInt(seq)
            buf.putInt(tsMs)
        }

        companion object {
            fun decode(buf: ByteBuffer): InputEvent {
                val evType = buf.get().toInt() and 0xFF
                val code = buf.get().toInt() and 0xFF
                val flags = buf.get().toInt() and 0xFF
                buf.get()
                val x = buf.float
                val y = buf.float
                val value = buf.float
                val seq = buf.int
                val tsMs = buf.int
                return InputEvent(evType, code, flags, x, y, value, seq, tsMs)
            }
        }
    }

    fun newBuffer(capacity: Int): ByteBuffer =
        ByteBuffer.allocate(capacity).order(ByteOrder.BIG_ENDIAN)

    fun wrap(data: ByteArray, offset: Int, length: Int): ByteBuffer =
        ByteBuffer.wrap(data, offset, length).order(ByteOrder.BIG_ENDIAN)

    fun writeHeader(
        buf: ByteBuffer,
        type: Int,
        flags: Int,
        subtype: Int,
        sessionId: Int,
        seq: Int
    ) {
        buf.putShort(MAGIC.toShort())
        buf.put(VERSION.toByte())
        buf.put(type.toByte())
        buf.put(flags.toByte())
        buf.put(subtype.toByte())
        buf.putShort(0)
        buf.putInt(sessionId)
        buf.putInt(seq)
    }

    /** @return parsed header or null when the datagram is not a Neurio packet. */
    fun readHeader(data: ByteArray, length: Int): UdpHeader? {
        if (length < HEADER_SIZE + AUTH_SIZE) return null
        val buf = wrap(data, 0, length)
        val magic = buf.short.toInt() and 0xFFFF
        if (magic != MAGIC) return null
        val version = buf.get().toInt() and 0xFF
        if (version != VERSION) return null
        val type = buf.get().toInt() and 0xFF
        val flags = buf.get().toInt() and 0xFF
        val subtype = buf.get().toInt() and 0xFF
        buf.short // reserved
        val sessionId = buf.int
        val seq = buf.int
        return UdpHeader(type, flags, subtype, sessionId, seq)
    }

    fun writeVideoMeta(buf: ByteBuffer, meta: VideoMeta) {
        buf.putInt(meta.frameId)
        buf.putLong(meta.ptsUs)
        buf.put(meta.fragIndex.toShort().toByte())
        buf.put((meta.fragIndex shr 8).toByte())
        buf.put(meta.fragCount.toShort().toByte())
        buf.put((meta.fragCount shr 8).toByte())
    }

    fun readVideoMeta(buf: ByteBuffer): VideoMeta {
        val frameId = buf.int
        val ptsUs = buf.long
        val lo1 = buf.get().toInt() and 0xFF
        val hi1 = buf.get().toInt() and 0xFF
        val lo2 = buf.get().toInt() and 0xFF
        val hi2 = buf.get().toInt() and 0xFF
        return VideoMeta(frameId, ptsUs, lo1 or (hi1 shl 8), lo2 or (hi2 shl 8))
    }
}

/**
 * Quality report sent client -> host once per second over UDP CONTROL.
 * Serialized as compact key=value pairs to stay JSON-free (pure JVM testable).
 */
data class QualityReport(
    val rttMs: Double,
    val lossPct: Double,
    val jitterMs: Double,
    val decodeMs: Double,
    val fps: Double,
    val width: Int,
    val height: Int
) {
    fun encode(): ByteArray =
        ("rtt=$rttMs;loss=$lossPct;jit=$jitterMs;dec=$decodeMs;fps=$fps;w=$width;h=$height")
            .toByteArray(Charsets.UTF_8)

    companion object {
        fun decode(data: ByteArray, offset: Int, length: Int): QualityReport? {
            return try {
                val s = String(data, offset, length, Charsets.UTF_8)
                val map = HashMap<String, String>()
                for (part in s.split(';')) {
                    val idx = part.indexOf('=')
                    if (idx > 0) map[part.substring(0, idx)] = part.substring(idx + 1)
                }
                QualityReport(
                    rttMs = map["rtt"]?.toDouble() ?: return null,
                    lossPct = map["loss"]?.toDouble() ?: return null,
                    jitterMs = map["jit"]?.toDouble() ?: return null,
                    decodeMs = map["dec"]?.toDouble() ?: return null,
                    fps = map["fps"]?.toDouble() ?: return null,
                    width = map["w"]?.toInt() ?: return null,
                    height = map["h"]?.toInt() ?: return null
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
