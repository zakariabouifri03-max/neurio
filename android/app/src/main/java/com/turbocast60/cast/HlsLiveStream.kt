package com.turbocast60.cast

import com.turbocast60.protocol.EncodedAccessUnit
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.DataOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.ArrayDeque
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** In-memory rolling MPEG-TS HLS store. No screen frames are written to disk. */
class HlsLiveStore(private val windowSize: Int = 8) {
    data class Segment(val sequence: Long, val durationSeconds: Double, val bytes: ByteArray)
    private val lock = Any()
    private val segments = ArrayDeque<Segment>()
    private var nextSequence = 0L

    fun publish(durationSeconds: Double, bytes: ByteArray): Segment = synchronized(lock) {
        val segment = Segment(nextSequence++, durationSeconds.coerceAtLeast(0.1), bytes)
        segments.addLast(segment)
        while (segments.size > windowSize) segments.removeFirst()
        segment
    }

    fun get(sequence: Long): Segment? = synchronized(lock) { segments.firstOrNull { it.sequence == sequence } }

    fun playlist(token: String): ByteArray = synchronized(lock) {
        val snapshot = segments.toList()
        val firstSequence = snapshot.firstOrNull()?.sequence ?: nextSequence
        val targetDuration = maxOf(2, snapshot.maxOfOrNull { it.durationSeconds.toInt() + 1 } ?: 2)
        buildString {
            appendLine("#EXTM3U")
            appendLine("#EXT-X-VERSION:3")
            appendLine("#EXT-X-TARGETDURATION:$targetDuration")
            appendLine("#EXT-X-MEDIA-SEQUENCE:$firstSequence")
            appendLine("#EXT-X-INDEPENDENT-SEGMENTS")
            snapshot.forEach { segment ->
                appendLine("#EXTINF:${"%.3f".format(java.util.Locale.US, segment.durationSeconds)},")
                appendLine("/live/$token/seg-${segment.sequence}.ts")
            }
        }.toByteArray(StandardCharsets.UTF_8)
    }

    fun clear() = synchronized(lock) { segments.clear() }
}

/** Creates short MPEG-TS segments at IDR boundaries for the official Cast Default Media Receiver. */
class HlsMpegTsSegmenter(
    private val store: HlsLiveStore,
    private val targetSegmentUs: Long = 1_500_000L
) {
    private var width = 0
    private var height = 0
    private var sps: ByteArray? = null
    private var pps: ByteArray? = null
    private var writer: MpegTsWriter? = null
    private var segmentStartUs: Long? = null
    private var lastPtsUs: Long? = null

    @Synchronized
    fun configure(width: Int, height: Int, sps: ByteArray, pps: ByteArray) {
        this.width = width
        this.height = height
        this.sps = sps.copyOf()
        this.pps = pps.copyOf()
    }

    @Synchronized
    fun add(unit: EncodedAccessUnit): Boolean {
        if (width <= 0 || height <= 0 || sps == null || pps == null) return false
        if (writer == null && !unit.keyFrame) return false // HLS segments must begin on an IDR frame.
        var publishedSegment = false
        if (writer != null && unit.keyFrame && unit.presentationTimeUs - (segmentStartUs ?: unit.presentationTimeUs) >= targetSegmentUs) {
            publishCurrent(unit.presentationTimeUs)
            publishedSegment = true
        }
        if (writer == null) {
            writer = MpegTsWriter()
            segmentStartUs = unit.presentationTimeUs
        }
        val suppliedTypes = unit.nals.mapNotNull { nal -> nal.firstOrNull()?.toInt()?.and(0x1f) }.toSet()
        val nals = ArrayList<ByteArray>()
        if (7 !in suppliedTypes) sps?.let(nals::add)
        if (8 !in suppliedTypes) pps?.let(nals::add)
        nals += unit.nals.filter { nal -> nal.isNotEmpty() && (nal[0].toInt() and 0x1f) !in setOf(7, 8, 9) }
        writer?.writeAccessUnit(nals, unit.presentationTimeUs)
        lastPtsUs = unit.presentationTimeUs
        return publishedSegment
    }

    @Synchronized
    fun finish() {
        if (writer != null) publishCurrent(lastPtsUs ?: segmentStartUs ?: 0L)
        writer = null
        segmentStartUs = null
        lastPtsUs = null
    }

    private fun publishCurrent(endPtsUs: Long) {
        val current = writer ?: return
        val start = segmentStartUs ?: endPtsUs
        val duration = ((endPtsUs - start).coerceAtLeast(100_000L) + 33_333L) / 1_000_000.0
        store.publish(duration, current.bytes())
        writer = MpegTsWriter()
        segmentStartUs = endPtsUs
    }
}

private class MpegTsWriter {
    private val output = ByteArrayOutputStream()
    private val counters = HashMap<Int, Int>()

    fun writeAccessUnit(nals: List<ByteArray>, presentationTimeUs: Long) {
        if (nals.isEmpty()) return
        writePsi(0x0000, patSection())
        writePsi(0x1000, pmtSection())
        val elementaryStream = ByteArrayOutputStream()
        nals.forEach { nal ->
            elementaryStream.write(byteArrayOf(0, 0, 0, 1))
            elementaryStream.write(nal)
        }
        val pts90k = ((presentationTimeUs.coerceAtLeast(0) * 90L) / 1000L) and 0x1ffff_ffffL
        val pes = ByteArrayOutputStream()
        DataOutputStream(pes).apply {
            write(byteArrayOf(0, 0, 1, 0xE0.toByte()))
            writeShort(0) // video PES size is allowed to be unbounded
            writeByte(0x80)
            writeByte(0x80) // PTS only
            writeByte(5)
            write(encodePts(pts90k))
            write(elementaryStream.toByteArray())
        }
        writePayloadPackets(0x0100, pes.toByteArray(), payloadUnitStart = true, pcrBase = pts90k)
    }

    fun bytes(): ByteArray = output.toByteArray()

    private fun writePsi(pid: Int, section: ByteArray) {
        writePayloadPackets(pid, byteArrayOf(0) + section, payloadUnitStart = true)
    }

    private fun writePayloadPackets(pid: Int, payload: ByteArray, payloadUnitStart: Boolean, pcrBase: Long? = null) {
        var offset = 0
        var first = true
        while (offset < payload.size) {
            val usePcr = first && pcrBase != null
            val remaining = payload.size - offset
            val count = minOf(if (usePcr) 176 else 184, remaining)
            val packet = ByteArray(188) { 0xff.toByte() }
            packet[0] = 0x47
            packet[1] = (((if (first && payloadUnitStart) 0x40 else 0) or ((pid shr 8) and 0x1f))).toByte()
            packet[2] = pid.toByte()
            val counter = counters[pid] ?: 0
            counters[pid] = (counter + 1) and 0x0f
            if (count == 184) {
                packet[3] = (0x10 or counter).toByte()
                System.arraycopy(payload, offset, packet, 4, count)
            } else {
                val adaptationLength = 183 - count
                packet[3] = (0x30 or counter).toByte()
                packet[4] = adaptationLength.toByte()
                if (adaptationLength > 0) {
                    packet[5] = if (usePcr) 0x10 else 0 // PCR flag if present; no other adaptation fields
                    if (usePcr) System.arraycopy(encodePcr(pcrBase!!), 0, packet, 6, 6)
                    val firstStuffingByte = if (usePcr) 12 else 6
                    for (index in firstStuffingByte until 5 + adaptationLength) packet[index] = 0xff.toByte()
                }
                System.arraycopy(payload, offset, packet, 5 + adaptationLength, count)
            }
            output.write(packet)
            offset += count
            first = false
        }
    }

    private fun encodePcr(base90k: Long): ByteArray {
        val base = base90k and 0x1ffff_ffffL
        return byteArrayOf(
            (base ushr 25).toByte(),
            (base ushr 17).toByte(),
            (base ushr 9).toByte(),
            (base ushr 1).toByte(),
            (((base and 1L) shl 7) or 0x7eL).toByte(),
            0
        )
    }

    private fun encodePts(pts: Long): ByteArray = byteArrayOf(
        (0x20 or (((pts ushr 30) and 0x07) shl 1) or 1).toByte(),
        (pts ushr 22).toByte(),
        ((((pts ushr 15) and 0x7f) shl 1) or 1).toByte(),
        (pts ushr 7).toByte(),
        (((pts and 0x7f) shl 1) or 1).toByte()
    )

    private fun patSection(): ByteArray = withCrc(
        byteArrayOf(0x00, 0xB0.toByte(), 0x0D, 0x00, 0x01, 0xC1.toByte(), 0x00, 0x00, 0x00, 0x01, 0xE1.toByte(), 0x00)
    )

    private fun pmtSection(): ByteArray = withCrc(
        byteArrayOf(
            0x02, 0xB0.toByte(), 0x12, 0x00, 0x01, 0xC1.toByte(), 0x00, 0x00,
            0xE1.toByte(), 0x00, 0xF0.toByte(), 0x00, 0x1B, 0xE1.toByte(), 0x00, 0xF0.toByte(), 0x00
        )
    )

    private fun withCrc(section: ByteArray): ByteArray {
        var crc = 0xffff_ffffL
        section.forEach { byte ->
            crc = crc xor ((byte.toInt() and 0xff).toLong() shl 24)
            repeat(8) { crc = if ((crc and 0x8000_0000L) != 0L) (crc shl 1) xor 0x04c1_1db7L else crc shl 1 }
            crc = crc and 0xffff_ffffL
        }
        return section + byteArrayOf((crc ushr 24).toByte(), (crc ushr 16).toByte(), (crc ushr 8).toByte(), crc.toByte())
    }
}

/** Minimal local HTTP origin for Chromecast's HLS client. It serves only a random, per-session path. */
class HlsHttpServer(private val store: HlsLiveStore) : Closeable {
    private val running = AtomicBoolean(false)
    private val token = ByteArray(16).also(SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) }
    private val clients = ThreadPoolExecutor(2, 8, 30, TimeUnit.SECONDS, ArrayBlockingQueue(24))
    private val activeClients = java.util.concurrent.ConcurrentHashMap.newKeySet<Socket>()
    @Volatile private var server: ServerSocket? = null
    private var acceptThread: Thread? = null

    val port: Int get() = server?.localPort ?: -1
    val path: String get() = "/live/$token/live.m3u8"

    fun start() {
        if (!running.compareAndSet(false, true)) return
        val socket = ServerSocket(0)
        socket.soTimeout = 1_000
        server = socket
        acceptThread = Thread({
            while (running.get()) {
                try {
                    val client = socket.accept()
                    activeClients.add(client)
                    runCatching {
                        clients.execute {
                            try { serve(client) } finally { activeClients.remove(client) }
                        }
                    }.onFailure {
                        activeClients.remove(client)
                        runCatching { client.close() }
                    }
                } catch (_: SocketTimeoutException) {
                    continue
                } catch (_: Throwable) {
                    if (running.get()) continue
                }
            }
        }, "TurboCast-HLS-http").apply { isDaemon = true; start() }
    }

    private fun serve(client: Socket) {
        client.use { socket ->
            socket.soTimeout = 2_000
            val input = socket.getInputStream().bufferedReader(StandardCharsets.US_ASCII)
            val request = input.readLine()?.split(' ') ?: return
            if (request.size < 2 || request[0] != "GET") {
                respond(socket, 405, "text/plain", "Method not allowed".toByteArray())
                return
            }
            val pathOnly = request[1].substringBefore('?')
            val body: ByteArray
            val contentType: String
            if (pathOnly == path) {
                body = store.playlist(token)
                contentType = "application/vnd.apple.mpegurl"
            } else if (pathOnly.startsWith("/live/$token/seg-") && pathOnly.endsWith(".ts")) {
                val sequence = pathOnly.removePrefix("/live/$token/seg-").removeSuffix(".ts").toLongOrNull()
                val segment = sequence?.let(store::get)
                if (segment == null) {
                    respond(socket, 404, "text/plain", ByteArray(0))
                    return
                }
                body = segment.bytes
                contentType = "video/mp2t"
            } else {
                respond(socket, 404, "text/plain", ByteArray(0))
                return
            }
            respond(socket, 200, contentType, body)
        }
    }

    private fun respond(socket: Socket, status: Int, contentType: String, body: ByteArray) {
        val phrase = if (status == 200) "OK" else if (status == 405) "Method Not Allowed" else "Not Found"
        val header = "HTTP/1.1 $status $phrase\r\n" +
            "Content-Type: $contentType\r\n" +
            "Content-Length: ${body.size}\r\n" +
            "Cache-Control: no-store, no-cache, must-revalidate\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Connection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(header.toByteArray(StandardCharsets.US_ASCII))
            write(body)
            flush()
        }
    }

    override fun close() {
        if (!running.getAndSet(false)) return
        runCatching { server?.close() }
        acceptThread?.interrupt()
        runCatching { acceptThread?.join(400) }
        activeClients.toList().forEach { runCatching { it.close() } }
        activeClients.clear()
        clients.shutdownNow()
        server = null
        acceptThread = null
    }
}
