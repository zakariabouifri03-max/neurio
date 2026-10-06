package com.neurio.lanstream.core

import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max

class NetworkStats {
    private val encodedFrames = AtomicLong(0)
    private val sentFrames = AtomicLong(0)
    private val sentBytes = AtomicLong(0)
    private val droppedFrames = AtomicLong(0)
    private val receivedFrames = AtomicLong(0)
    private val receivedBytes = AtomicLong(0)
    private val decodedFrames = AtomicLong(0)
    private val lostFrames = AtomicLong(0)
    private var lastSnapshotNanos = System.nanoTime()

    fun encoded(bytes: Int) {
        encodedFrames.incrementAndGet()
        if (bytes <= 0) droppedFrames.incrementAndGet()
    }

    fun sent(bytes: Int) {
        sentFrames.incrementAndGet()
        sentBytes.addAndGet(bytes.toLong())
    }

    fun dropped() { droppedFrames.incrementAndGet() }
    fun received(bytes: Int) { receivedFrames.incrementAndGet(); receivedBytes.addAndGet(bytes.toLong()) }
    fun decoded() { decodedFrames.incrementAndGet() }
    fun lost(count: Long = 1) { lostFrames.addAndGet(count.coerceAtLeast(0)) }

    @Synchronized
    fun snapshot(resetWindow: Boolean = true): StatsSnapshot {
        val now = System.nanoTime()
        val elapsed = max(0.001, (now - lastSnapshotNanos) / 1_000_000_000.0)
        val frames = if (resetWindow) encodedFrames.getAndSet(0) else encodedFrames.get()
        val txFrames = if (resetWindow) sentFrames.getAndSet(0) else sentFrames.get()
        val txBytes = if (resetWindow) sentBytes.getAndSet(0) else sentBytes.get()
        val rxFrames = if (resetWindow) receivedFrames.getAndSet(0) else receivedFrames.get()
        val rxBytes = if (resetWindow) receivedBytes.getAndSet(0) else receivedBytes.get()
        val decoded = if (resetWindow) decodedFrames.getAndSet(0) else decodedFrames.get()
        val dropped = if (resetWindow) droppedFrames.getAndSet(0) else droppedFrames.get()
        val lost = if (resetWindow) lostFrames.getAndSet(0) else lostFrames.get()
        if (resetWindow) lastSnapshotNanos = now
        return StatsSnapshot(
            encodedFps = frames / elapsed,
            sentFps = txFrames / elapsed,
            txMbps = txBytes * 8.0 / elapsed / 1_000_000.0,
            receivedFps = rxFrames / elapsed,
            rxMbps = rxBytes * 8.0 / elapsed / 1_000_000.0,
            decodedFps = decoded / elapsed,
            droppedFrames = dropped,
            lostFrames = lost,
        )
    }
}

data class StatsSnapshot(
    val encodedFps: Double,
    val sentFps: Double,
    val txMbps: Double,
    val receivedFps: Double,
    val rxMbps: Double,
    val decodedFps: Double,
    val droppedFrames: Long,
    val lostFrames: Long,
)
