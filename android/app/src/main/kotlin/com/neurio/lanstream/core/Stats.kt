package com.neurio.lanstream.core

import kotlin.math.max

/** Rolling bytes/second meter with a 500 ms evaluation window. */
class BitrateMeter {
    private var windowStartMs = 0L
    private var bytes = 0L
    private var currentBps = 0L

    fun add(bytes: Long) {
        val now = System.currentTimeMillis()
        if (windowStartMs == 0L) windowStartMs = now
        this.bytes += bytes
        evaluate(now)
    }

    fun bps(nowMs: Long = System.currentTimeMillis()): Long {
        evaluate(nowMs)
        return currentBps
    }

    private fun evaluate(now: Long) {
        if (windowStartMs == 0L) {
            windowStartMs = now
            return
        }
        val elapsed = now - windowStartMs
        if (elapsed >= 500) {
            currentBps = (bytes * 8L * 1000L) / max(1L, elapsed)
            bytes = 0L
            windowStartMs = now
        }
    }

    fun reset() {
        bytes = 0L
        currentBps = 0L
        windowStartMs = 0L
    }
}

/** Rolling frames/second meter, same idea. */
class FpsMeter {
    private var windowStartMs = 0L
    private var frames = 0
    private var currentFps = 0f

    fun frame() {
        frames++
        evaluate(System.currentTimeMillis())
    }

    fun fps(nowMs: Long = System.currentTimeMillis()): Float {
        evaluate(nowMs)
        return currentFps
    }

    private fun evaluate(now: Long) {
        if (windowStartMs == 0L) {
            windowStartMs = now
            return
        }
        val elapsed = now - windowStartMs
        if (elapsed >= 500) {
            currentFps = frames * 1000f / elapsed.toFloat()
            frames = 0
            windowStartMs = now
        }
    }

    fun reset() {
        frames = 0
        currentFps = 0f
        windowStartMs = 0L
    }
}

/**
 * Sequence-number gap detector for the UDP media channels.
 * Sequence numbers are 32 bit and wrap, so all comparisons are done on the
 * signed difference (valid as long as the gap is < 2^31 packets).
 */
class LossTracker {
    private var initialised = false
    private var highest = 0
    private var received = 0L
    private var lost = 0L
    private var lastResetMs = System.currentTimeMillis()
    private var lastRatio = 0f

    @Synchronized
    fun onSequence(seq: Int) {
        if (!initialised) {
            initialised = true
            highest = seq
            received++
            return
        }
        val diff = seq - highest
        when {
            diff == 0 -> return
            diff > 0 -> {
                if (diff > 1) lost += (diff - 1).toLong()
                received++
                highest = seq
            }
            else -> {
                // Late / reordered packet: not counted as loss, it arrived.
                received++
            }
        }
    }

    /** Loss ratio (0..1) since the last call; resets the window. */
    @Synchronized
    fun ratioAndReset(nowMs: Long = System.currentTimeMillis()): Float {
        val total = received + lost
        lastRatio = if (total == 0L) 0f else lost.toFloat() / total.toFloat()
        received = 0L
        lost = 0L
        lastResetMs = nowMs
        return lastRatio
    }

    /** Current loss ratio, refreshing at most once per second. */
    @Synchronized
    fun ratio(nowMs: Long = System.currentTimeMillis()): Float {
        if (nowMs - lastResetMs < 1000) return lastRatio
        return ratioAndReset(nowMs)
    }
}

/**
 * Estimates the wall-clock offset between the two phones so the client can
 * report a *real* one-way latency (capture on host -> rendered on client).
 *
 * Uses the standard NTP-style 4 timestamp exchange:
 *   t0 = client send, t1 = host receive, t2 = host send, t3 = client receive
 *   offset(host - client) = ((t1 - t0) + (t2 - t3)) / 2
 * and keeps the sample with the smallest RTT (least queueing noise).
 */
class ClockSync {
    @Volatile
    private var bestRttMs = Long.MAX_VALUE

    @Volatile
    private var offsetMs = 0L

    @Volatile
    private var lastRttMs = 0L

    private var samples = 0

    @Synchronized
    fun onSample(t0ClientMs: Long, t1HostMs: Long, t2HostMs: Long, t3ClientMs: Long) {
        val hostProcessing = max(0L, t2HostMs - t1HostMs)
        val rtt = max(0L, (t3ClientMs - t0ClientMs) - hostProcessing)
        lastRttMs = rtt
        samples++
        // Allow the estimate to re-converge if the network got much better.
        val stale = bestRttMs != Long.MAX_VALUE && rtt < bestRttMs - 25
        if (rtt < bestRttMs || stale || samples % 30 == 0) {
            bestRttMs = rtt
            offsetMs = ((t1HostMs - t0ClientMs) + (t2HostMs - t3ClientMs)) / 2L
        }
    }

    fun rttMs(): Long = if (bestRttMs == Long.MAX_VALUE) 0L else bestRttMs

    /** Convert a client wall-clock reading into the host's wall clock. */
    fun clientToHost(clientMs: Long): Long = clientMs + offsetMs

    fun offsetMs(): Long = offsetMs

    fun reset() {
        bestRttMs = Long.MAX_VALUE
        offsetMs = 0L
        lastRttMs = 0L
        samples = 0
    }
}

/** Tiny exponential moving average used for jitter / decode time / latency. */
class Ema(private val alpha: Float = 0.2f) {
    private var value: Float? = null

    fun add(sample: Float): Float {
        val next = value?.let { it + alpha * (sample - it) } ?: sample
        value = next
        return next
    }

    fun get(): Float = value ?: 0f

    fun reset() {
        value = null
    }
}
