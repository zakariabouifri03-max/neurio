package com.neurio.common

/** Exponentially weighted moving average. Not thread-safe by itself. */
class Ewma(private val alpha: Double, initial: Double = 0.0) {
    var value: Double = initial
        private set
    private var primed = false

    fun add(sample: Double) {
        if (!primed) {
            value = sample
            primed = true
        } else {
            value = alpha * sample + (1 - alpha) * value
        }
    }
}

/** Immutable view over current link / pipeline health, used by UI + adaptation. */
data class StatsSnapshot(
    val active: Boolean,
    val role: String,
    val rttMs: Double,
    val lossPct: Double,
    val jitterMs: Double,
    val bitrateMbps: Double,
    val fps: Double,
    val decodeMs: Double,
    val encodeMs: Double,
    val width: Int,
    val height: Int,
    val dropped: Int,
    val batteryTempC: Double
) {
    companion object {
        val IDLE = StatsSnapshot(
            active = false, role = "-", rttMs = 0.0, lossPct = 0.0, jitterMs = 0.0,
            bitrateMbps = 0.0, fps = 0.0, decodeMs = 0.0, encodeMs = 0.0,
            width = 0, height = 0, dropped = 0, batteryTempC = 0.0
        )
    }
}

/**
 * In-process publish/observe bus so the Performance screen and the HUD pills
 * can show live stats no matter which component produced them.
 */
object PerfBus {
    @Volatile
    var latest: StatsSnapshot = StatsSnapshot.IDLE
        private set

    private val listeners = java.util.concurrent.CopyOnWriteArrayList<(StatsSnapshot) -> Unit>()

    fun publish(snapshot: StatsSnapshot) {
        latest = snapshot
        for (l in listeners) {
            try {
                l(snapshot)
            } catch (ignored: Exception) {
            }
        }
    }

    /** @return a handle whose invoke removes the observer again. */
    fun observe(listener: (StatsSnapshot) -> Unit): () -> Unit {
        listeners.add(listener)
        listener(latest)
        return { listeners.remove(listener) }
    }
}

/**
 * Client-side link measurement: RTT (UDP ping/pong), packet loss from video
 * sequence gaps, inter-arrival jitter and received bitrate. Pure JVM so it is
 * covered by unit tests.
 */
class NetworkStats {
    private val rtt = Ewma(0.35)
    private val jitter = Ewma(0.2)

    private var lastVideoSeq = -1
    private var windowReceived = 0L
    private var windowLost = 0L
    private var windowStartNano = 0L
    private var windowBytes = 0L

    private var totalLost = 0L
    private var totalExpected = 0L

    private val lock = Any()

    var currentVideoWidth: Int = 0
    var currentVideoHeight: Int = 0

    fun recordRtt(ms: Double) = synchronized(lock) { rtt.add(ms.coerceAtLeast(0.0)) }

    /** Feed every received video packet; gaps in seq are counted as loss. */
    fun recordVideoPacket(seq: Int, bytes: Int, arrivalNano: Long) = synchronized(lock) {
        if (windowStartNano == 0L) {
            windowStartNano = arrivalNano
        }
        if (lastVideoSeq >= 0) {
            val gap = seq - lastVideoSeq
            if (gap in 1..5000) {
                windowReceived++
                totalExpected++
                if (gap > 1) {
                    val lost = gap - 1
                    windowLost += lost
                    totalLost += lost
                    totalExpected += lost
                }
                val interMs = (arrivalNano - lastArrivalNano) / 1_000_000.0
                if (lastArrivalNano > 0 && interMs < 500) {
                    jitter.add(Math.abs(interMs - lastInterMs))
                }
                lastInterMs = interMs
            } else if (gap <= 0) {
                // duplicate or reordered packet: still bytes, no loss accounting
            } else {
                windowReceived++
                totalExpected++
            }
        } else {
            windowReceived++
            totalExpected++
        }
        lastArrivalNano = arrivalNano
        lastVideoSeq = seq
        windowBytes += bytes

        // Roll the 1s window forward.
        val elapsed = arrivalNano - windowStartNano
        if (elapsed >= 1_000_000_000L) {
            recentLossPct = if (windowReceived + windowLost > 0)
                100.0 * windowLost / (windowReceived + windowLost) else 0.0
            recentBitrateMbps = windowBytes * 8.0 / (elapsed / 1_000_000.0) / 1000.0
            windowReceived = 0
            windowLost = 0
            windowBytes = 0
            windowStartNano = arrivalNano
        }
    }

    private var lastArrivalNano = 0L
    private var lastInterMs = 0.0

    var recentLossPct: Double = 0.0
        private set
    var recentBitrateMbps: Double = 0.0
        private set

    fun snapshotLossPct(): Double = synchronized(lock) { recentLossPct }
    fun snapshotRttMs(): Double = synchronized(lock) { rtt.value }
    fun snapshotJitterMs(): Double = synchronized(lock) { jitter.value }
    fun snapshotBitrateMbps(): Double = synchronized(lock) { recentBitrateMbps }
    fun cumulativeLossPct(): Double = synchronized(lock) {
        if (totalExpected == 0L) 0.0 else 100.0 * totalLost / totalExpected
    }

    fun reset() = synchronized(lock) {
        lastVideoSeq = -1
        windowReceived = 0; windowLost = 0; windowBytes = 0
        windowStartNano = 0L; lastArrivalNano = 0L
        recentLossPct = 0.0; recentBitrateMbps = 0.0
    }
}
