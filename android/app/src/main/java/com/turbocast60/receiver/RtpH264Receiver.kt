package com.turbocast60.receiver

import com.turbocast60.protocol.RtpH264Reassembler
import com.turbocast60.protocol.SecureVideoCipher
import java.io.Closeable
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicBoolean

class RtpH264Receiver(
    private val cipher: SecureVideoCipher,
    private val decoder: H264SurfaceDecoder,
    private val onRequestIdr: () -> Unit,
    private val onStats: (lossPercent: Double, decodedFps: Double, queueDrops: Long) -> Unit
) : Closeable {
    private val running = AtomicBoolean(false)
    private val socket = DatagramSocket(0).apply {
        receiveBufferSize = 2 * 1024 * 1024
        soTimeout = 1_000
    }
    private val reassembler = RtpH264Reassembler(
        onAccessUnit = decoder::offer,
        onLoss = { },
        onIdrNeeded = onRequestIdr
    )
    private var receiveThread: Thread? = null
    private var statsThread: Thread? = null

    val localPort: Int get() = socket.localPort

    fun start() {
        if (!running.compareAndSet(false, true)) return
        receiveThread = Thread(::receiveLoop, "TurboCast-RTP-recv").apply { isDaemon = true; start() }
        statsThread = Thread(::statsLoop, "TurboCast-RTP-stats").apply { isDaemon = true; start() }
    }

    fun configure(width: Int, height: Int, fps: Int, sps: ByteArray, pps: ByteArray) {
        decoder.configure(width, height, fps, sps, pps)
    }

    fun attachSurface(surface: android.view.Surface?) = decoder.attachSurface(surface)

    private fun receiveLoop() {
        val backing = ByteArray(1500)
        while (running.get()) {
            try {
                val datagram = DatagramPacket(backing, backing.size)
                socket.receive(datagram)
                val protectedPacket = backing.copyOf(datagram.length)
                val rtp = cipher.unprotect(protectedPacket) ?: continue
                reassembler.accept(rtp)
            } catch (_: SocketTimeoutException) {
                continue
            } catch (_: java.net.SocketException) {
                if (running.get()) continue
            } catch (_: Throwable) {
                // Malformed or unauthenticated LAN packets are discarded without logging payloads.
            }
        }
    }

    private fun statsLoop() {
        while (running.get()) {
            try { Thread.sleep(2_000) } catch (_: InterruptedException) { return }
            if (!running.get()) return
            val (received, lost) = reassembler.packetStatsAndReset()
            val total = received + lost
            val loss = if (total > 0) (lost * 100.0 / total).coerceIn(0.0, 100.0) else 0.0
            onStats(loss, decoder.decodedFps, decoder.queueDrops)
        }
    }

    override fun close() {
        if (!running.getAndSet(false)) return
        runCatching { socket.close() }
        receiveThread?.interrupt()
        statsThread?.interrupt()
        runCatching { receiveThread?.join(300) }
        runCatching { statsThread?.join(300) }
        decoder.close()
    }
}
