package com.neurio.lanstream.protocol

import com.neurio.lanstream.model.AudioStreamConfig
import com.neurio.lanstream.model.VideoStreamConfig
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.DatagramPacket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ceil

object LanProtocol {
    const val TCP_PORT = 47620
    const val DISCOVERY_PORT = 47621
    const val VIDEO_PORT = 47622
    const val MAX_CONTROL_FRAME = 2 * 1024 * 1024

    const val HELLO = 1
    const val AUTH = 2
    const val AUTH_OK = 3
    const val AUTH_FAIL = 4

    const val VIDEO_CONFIG = 16
    const val AUDIO_CONFIG = 17
    const val INPUT = 20
    const val PING = 21
    const val PONG = 22
    const val CLIENT_STATS = 23
    const val REQUEST_KEYFRAME = 24
    const val DISCONNECT = 25
    const val HOST_STATS = 26

    const val MEDIA_VIDEO = 1
    const val MEDIA_AUDIO = 2
    const val FLAG_KEY_FRAME = 1
    const val MEDIA_MAGIC = 0x4E4C5356 // NLSV
    const val DISCOVERY_MAGIC = 0x4E4C5344 // NLSD
    const val DISCOVERY_ADVERTISEMENT = 1
    const val DISCOVERY_PING = 2
    const val DISCOVERY_PONG = 3

    const val MEDIA_HEADER_BYTES = 22
    const val MEDIA_MAX_DATAGRAM_BYTES = 1200
    const val MEDIA_FRAGMENT_PAYLOAD = MEDIA_MAX_DATAGRAM_BYTES - MEDIA_HEADER_BYTES - 16 // AES-GCM tag

    fun writeClearFrame(out: DataOutputStream, type: Int, writeBody: DataOutputStream.() -> Unit = {}) {
        val frame = ByteArrayOutputStream().use { bytes ->
            DataOutputStream(bytes).use { data ->
                data.writeByte(type)
                data.writeBody()
            }
            bytes.toByteArray()
        }
        if (frame.size > MAX_CONTROL_FRAME) throw IllegalArgumentException("Control frame too large")
        out.writeInt(frame.size)
        out.write(frame)
        out.flush()
    }

    fun readClearFrame(input: DataInputStream): ControlFrame {
        val length = input.readInt()
        if (length < 1 || length > MAX_CONTROL_FRAME) throw IllegalArgumentException("Invalid control frame size: $length")
        val frame = ByteArray(length)
        input.readFully(frame)
        return ControlFrame(frame[0].toInt() and 0xff, DataInputStream(ByteArrayInputStream(frame, 1, frame.size - 1)))
    }

    fun writeString(out: DataOutputStream, value: String, maxChars: Int = 256) {
        val bytes = value.take(maxChars).toByteArray(Charsets.UTF_8)
        out.writeShort(bytes.size)
        out.write(bytes)
    }

    fun readString(input: DataInputStream, maxBytes: Int = 1024): String {
        val size = input.readUnsignedShort()
        if (size > maxBytes) throw IllegalArgumentException("String too long")
        val bytes = ByteArray(size)
        input.readFully(bytes)
        return bytes.toString(Charsets.UTF_8)
    }

    fun writeSizedBytes(out: DataOutputStream, bytes: ByteArray, max: Int = 1 shl 20) {
        require(bytes.size <= max) { "Byte array too large" }
        out.writeInt(bytes.size)
        out.write(bytes)
    }

    fun readSizedBytes(input: DataInputStream, max: Int = 1 shl 20): ByteArray {
        val size = input.readInt()
        if (size < 0 || size > max) throw IllegalArgumentException("Invalid byte array size")
        val bytes = ByteArray(size)
        input.readFully(bytes)
        return bytes
    }

    fun writeVideoConfig(out: DataOutputStream, token: ByteArray, config: VideoStreamConfig) {
        out.write(token)
        out.writeInt(config.width)
        out.writeInt(config.height)
        out.writeInt(config.fps)
        out.writeInt(config.targetBitrate)
        writeSizedBytes(out, config.csd0, 64 * 1024)
        writeSizedBytes(out, config.csd1, 64 * 1024)
    }

    fun readVideoConfig(input: DataInputStream): Pair<ByteArray, VideoStreamConfig> {
        val token = ByteArray(32).apply { input.readFully(this) }
        val width = input.readInt().coerceIn(64, 4096)
        val height = input.readInt().coerceIn(64, 4096)
        val fps = input.readInt().coerceIn(1, 120)
        val bitrate = input.readInt().coerceIn(250_000, 100_000_000)
        val csd0 = readSizedBytes(input, 64 * 1024)
        val csd1 = readSizedBytes(input, 64 * 1024)
        return token to VideoStreamConfig(width, height, fps, bitrate, csd0, csd1)
    }

    fun writeAudioConfig(out: DataOutputStream, token: ByteArray, config: AudioStreamConfig) {
        out.write(token)
        out.writeInt(config.sampleRate)
        out.writeInt(config.channelCount)
        writeSizedBytes(out, config.csd0, 64 * 1024)
    }

    fun readAudioConfig(input: DataInputStream): Pair<ByteArray, AudioStreamConfig> {
        val token = ByteArray(32).apply { input.readFully(this) }
        val rate = input.readInt().coerceIn(8_000, 192_000)
        val channels = input.readInt().coerceIn(1, 2)
        val csd0 = readSizedBytes(input, 64 * 1024)
        return token to AudioStreamConfig(rate, channels, csd0)
    }

    fun packetizeMedia(
        mediaType: Int,
        flags: Int,
        sequence: Int,
        presentationTimeUs: Long,
        accessUnit: ByteArray,
        mediaKey: ByteArray,
    ): List<ByteArray> {
        require(mediaType == MEDIA_VIDEO || mediaType == MEDIA_AUDIO)
        if (accessUnit.isEmpty()) return emptyList()
        val count = ceil(accessUnit.size.toDouble() / MEDIA_FRAGMENT_PAYLOAD).toInt().coerceAtLeast(1)
        if (count > 2048) return emptyList()
        val packets = ArrayList<ByteArray>(count)
        for (index in 0 until count) {
            val start = index * MEDIA_FRAGMENT_PAYLOAD
            val end = minOf(start + MEDIA_FRAGMENT_PAYLOAD, accessUnit.size)
            val header = ByteBuffer.allocate(MEDIA_HEADER_BYTES).order(ByteOrder.BIG_ENDIAN)
                .putInt(MEDIA_MAGIC)
                .put(mediaType.toByte())
                .put(flags.toByte())
                .putInt(sequence)
                .putLong(presentationTimeUs)
                .putShort(index.toShort())
                .putShort(count.toShort())
                .array()
            val nonce = mediaNonce(mediaType, sequence, index)
            val encrypted = PairingCrypto.encrypt(mediaKey, nonce, header, accessUnit.copyOfRange(start, end))
            packets += header + encrypted
        }
        return packets
    }

    fun parseMediaDatagram(datagram: DatagramPacket, mediaKey: ByteArray): MediaFragment? {
        val length = datagram.length
        if (length < MEDIA_HEADER_BYTES + 16 || length > MEDIA_MAX_DATAGRAM_BYTES) return null
        return try {
            val raw = datagram.data.copyOfRange(datagram.offset, datagram.offset + length)
            val header = raw.copyOfRange(0, MEDIA_HEADER_BYTES)
            val input = ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN)
            if (input.int != MEDIA_MAGIC) return null
            val mediaType = input.get().toInt() and 0xff
            val flags = input.get().toInt() and 0xff
            if (mediaType != MEDIA_VIDEO && mediaType != MEDIA_AUDIO) return null
            val sequence = input.int
            val pts = input.long
            val index = input.short.toInt() and 0xffff
            val count = input.short.toInt() and 0xffff
            if (count !in 1..2048 || index !in 0 until count) return null
            val encrypted = raw.copyOfRange(MEDIA_HEADER_BYTES, raw.size)
            val plain = PairingCrypto.decrypt(mediaKey, mediaNonce(mediaType, sequence, index), header, encrypted)
            MediaFragment(mediaType, flags, sequence, pts, index, count, plain)
        } catch (_: Exception) {
            null
        }
    }

    private fun mediaNonce(type: Int, sequence: Int, fragment: Int): ByteArray =
        ByteBuffer.allocate(12).order(ByteOrder.BIG_ENDIAN)
            .putInt(if (type == MEDIA_VIDEO) 0x56494430 else 0x41554430) // VID0 / AUD0
            .putInt(sequence)
            .putShort(fragment.toShort())
            .putShort(0)
            .array()
}

data class MediaFragment(
    val mediaType: Int,
    val flags: Int,
    val sequence: Int,
    val presentationTimeUs: Long,
    val fragmentIndex: Int,
    val fragmentCount: Int,
    val payload: ByteArray,
)
