package com.neurio

import com.neurio.common.NetworkStats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkStatsTest {

    @Test
    fun rttAveragesTowardsSamples() {
        val stats = NetworkStats()
        repeat(10) { stats.recordRtt(20.0) }
        assertTrue(Math.abs(stats.snapshotRttMs() - 20.0) < 2.0)
    }

    @Test
    fun detectsSequenceGapsAsLoss() {
        val stats = NetworkStats()
        var nano = 1_000_000_000L
        // 100 packets, drop every 10th
        var seq = 0
        for (i in 0 until 100) {
            seq++
            if (seq % 10 == 0) {
                seq++ // simulate a lost packet
            }
            nano += 2_000_000 // 2ms apart -> window rolls a few times
            stats.recordVideoPacket(seq, 1200, nano)
        }
        val loss = stats.cumulativeLossPct()
        assertTrue("expected ~9% loss, got $loss", loss in 5.0..15.0)
    }

    @Test
    fun noLossOnContiguousStream() {
        val stats = NetworkStats()
        var nano = 1_000_000_000L
        for (seq in 0 until 500) {
            nano += 1_000_000
            stats.recordVideoPacket(seq, 1200, nano)
        }
        assertEquals(0.0, stats.cumulativeLossPct(), 0.001)
    }

    @Test
    fun bitrateWindowProducesNonZeroRate() {
        val stats = NetworkStats()
        var nano = 0L
        // 2200 packets x 0.5ms > 1s so the 1-second bitrate window rolls.
        for (seq in 0 until 2200) {
            nano += 500_000 // 0.5ms
            stats.recordVideoPacket(seq, 1200, nano)
        }
        assertTrue(stats.snapshotBitrateMbps() > 5.0)
    }
}
