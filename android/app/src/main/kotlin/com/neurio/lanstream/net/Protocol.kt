package com.neurio.lanstream.net

import java.nio.ByteBuffer

/**
 * Wire protocol of the prototype.
 *
 * Three independent UDP channels (video / audio / input) plus one TCP control
 * channel used for pairing, capability exchange and keepalive. Every datagram
 * starts with the same 44 byte header so a single parser can demux them, and
 * every datagram carries the session id + session token so unknown senders are
 * dropped before they reach the codec or the input injector.
 *
 *   Control   TCP  47621  length-prefixed JSON (pairing, config, keepalive)
 *   Video     UDP  47622  fragmented H.264/H.265 access units
 *   Audio     UDP  47623  AAC access units (one datagram per AU, tiny)
 *   Input     UDP  47624  touch / key / gamepad events + ping-pong
 *   Discovery UDP  47620  broadcast beacon + ping (see discovery/UdpBeacon)
 *
 * Header layout (big endian, 44 bytes):
 *
 *   0  int32  magic  "NUR1"
 *   4  uint8  version
 *   5  uint8  channel  (1 video, 2 audio, 3 input)
 *   6  uint8  flags    (bit0 first frag, bit1 last frag, bit2 codec config, bit3 keyframe)
 *   7  uint8  codec    (0 H264, 1 H265, 2 AAC) / input event type
 *   8  int32  sessionId
 *   12 int32  session token
 *   16 int32  packet sequence (per channel, monotonic)
 *   20 int32  frame id (constant across the fragments of one access unit)
 *   24 int64  presentationTimeUs (monotonic on the host) / client send time for input
 *   32 int64  captureWallMs (host wall clock, used for end-to-end latency)
 *   40 uint16 fragment index
 *   42 uint16 fragment count
 */
object Protocol {
    const val VERSION = 1
    const val MAGIC = 0x4E555231 // "NUR1"

    const val SERVICE_TYPE = "_neurio._tcp."

    const val BEACON_PORT = 47620
    const val CONTROL_PORT = 47621
    const val VIDEO_PORT = 47622
    const val AUDIO_PORT = 47623
    const val INPUT_PORT = 47624

    const val HEADER_SIZE = 44
    /** Keeps a full datagram under the typical 1500 byte LAN MTU. */
    const val MAX_PAYLOAD = 1150
    const val MAX_DATAGRAM = HEADER_SIZE + MAX_PAYLOAD

    const val CHANNEL_VIDEO: Byte = 1
    const val CHANNEL_AUDIO: Byte = 2
    const val CHANNEL_INPUT: Byte = 3

    const val FLAG_FIRST = 0x01
    const val FLAG_LAST = 0x02
    const val FLAG_CONFIG = 0x04
    const val FLAG_KEYFRAME = 0x08

    const val CODEC_H264: Byte = 0
    const val CODEC_H265: Byte = 1
    const val CODEC_AAC: Byte = 2
    const val CODEC_OPUS: Byte = 3

    // Input event types reuse the "codec" byte.
    const val INPUT_TOUCH_DOWN: Byte = 1
    const val INPUT_TOUCH_MOVE: Byte = 2
    const val INPUT_TOUCH_UP: Byte = 3
    const val INPUT_KEY_DOWN: Byte = 4
    const val INPUT_KEY_UP: Byte = 5
    const val INPUT_GAMEPAD: Byte = 6
    const val INPUT_PING: Byte = 7
    const val INPUT_PONG: Byte = 8

    const val CONTROL_MAX_MESSAGE = 64 * 1024

    fun codecForMime(mime: String): Byte {
        val m = mime.lowercase()
        return when {
            "hevc" in m || "h265" in m -> CODEC_H265
            "avc" in m || "h264" in m -> CODEC_H264
            "aac" in m || "mp4a" in m -> CODEC_AAC
            "opus" in m -> CODEC_OPUS
            else -> CODEC_H264
        }
    }

    fun mimeForCodec(codec: Byte): String = when (codec) {
        CODEC_H265 -> "video/hevc"
        CODEC_AAC -> "audio/mp4a-latm"
        CODEC_OPUS -> "audio/opus"
        else -> "video/avc"
    }
}

/** Mutable view over the 44 byte datagram header. */
class MediaHeader(
    var channel: Byte = 0,
    var codec: Byte = 0,
    var flags: Int = 0,
    var sessionId: Int = 0,
    var token: Int = 0,
    var seq: Int = 0,
    var frameId: Int = 0,
    var ptsUs: Long = 0L,
    var captureWallMs: Long = 0L,
    var fragIndex: Int = 0,
    var fragCount: Int = 0
) {
    val isFirst: Boolean get() = flags and Protocol.FLAG_FIRST != 0
    val isLast: Boolean get() = flags and Protocol.FLAG_LAST != 0
    val isConfig: Boolean get() = flags and Protocol.FLAG_CONFIG != 0
    val isKeyframe: Boolean get() = flags and Protocol.FLAG_KEYFRAME != 0
    val singleFragment: Boolean get() = fragCount <= 1

    fun first(value: Boolean = true): MediaHeader = apply {
        flags = if (value) flags or Protocol.FLAG_FIRST else flags and Protocol.FLAG_FIRST.inv()
    }

    fun last(value: Boolean = true): MediaHeader = apply {
        flags = if (value) flags or Protocol.FLAG_LAST else flags and Protocol.FLAG_LAST.inv()
    }

    fun keyframe(value: Boolean = true): MediaHeader = apply {
        flags = if (value) flags or Protocol.FLAG_KEYFRAME else flags and Protocol.FLAG_KEYFRAME.inv()
    }

    fun config(value: Boolean = true): MediaHeader = apply {
        flags = if (value) flags or Protocol.FLAG_CONFIG else flags and Protocol.FLAG_CONFIG.inv()
    }

    /** Serialises into [dst] (which must be at least HEADER_SIZE long). */
    fun writeTo(dst: ByteArray) {
        val bb = ByteBuffer.wrap(dst)
        bb.putInt(Protocol.MAGIC)
        bb.put(Protocol.VERSION.toByte())
        bb.put(channel)
        bb.put(flags.toByte())
        bb.put(codec)
        bb.putInt(sessionId)
        bb.putInt(token)
        bb.putInt(seq)
        bb.putInt(frameId)
        bb.putLong(ptsUs)
        bb.putLong(captureWallMs)
        bb.putShort(fragIndex.toShort())
        bb.putShort(fragCount.toShort())
    }

    companion object {
        /** Returns null when the datagram is not a Neurio packet (bad magic/version). */
        fun parse(src: ByteArray, length: Int): MediaHeader? {
            if (length < Protocol.HEADER_SIZE) return null
            val bb = ByteBuffer.wrap(src, 0, Protocol.HEADER_SIZE)
            if (bb.getInt() != Protocol.MAGIC) return null
            if (bb.get().toInt() != Protocol.VERSION) return null
            val channel = bb.get()
            val flags = bb.get().toInt() and 0xFF
            val codec = bb.get()
            val sessionId = bb.getInt()
            val token = bb.getInt()
            val seq = bb.getInt()
            val frameId = bb.getInt()
            val ptsUs = bb.long
            val captureWallMs = bb.long
            val fragIndex = bb.short.toInt() and 0xFFFF
            val fragCount = bb.short.toInt() and 0xFFFF
            return MediaHeader(
                channel = channel,
                codec = codec,
                flags = flags,
                sessionId = sessionId,
                token = token,
                seq = seq,
                frameId = frameId,
                ptsUs = ptsUs,
                captureWallMs = captureWallMs,
                fragIndex = fragIndex,
                fragCount = fragCount
            )
        }
    }
}
