package com.neurio

import com.neurio.common.QualityReport
import com.neurio.common.QualityTier
import com.neurio.host.AdaptationController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AdaptationControllerTest {

    private fun healthy(fps: Double = 60.0) =
        QualityReport(rttMs = 5.0, lossPct = 0.0, jitterMs = 1.0, decodeMs = 8.0, fps = fps, width = 1280, height = 720)

    private fun degraded(loss: Double = 0.5, rtt: Double = 20.0) =
        QualityReport(rttMs = rtt, lossPct = loss, jitterMs = 4.0, decodeMs = 12.0, fps = 58.0, width = 1280, height = 720)

    @Test
    fun stableLinkKeepsTier() {
        val controller = AdaptationController(QualityTier.GOOD)
        var t = 0L
        repeat(3) {
            t += 1000
            val decision = controller.onReport(healthy(), t)
            assertTrue(decision is AdaptationController.Decision.None)
        }
        assertEquals(QualityTier.GOOD, controller.tier)
    }

    @Test
    fun hardLossDropsTier() {
        val controller = AdaptationController(QualityTier.GOOD)
        val decision = controller.onReport(degraded(loss = 9.0), 10_000)
        assertTrue(decision is AdaptationController.Decision.Tier)
        assertEquals(QualityTier.WEAK, controller.tier)
    }

    @Test
    fun softLossFirstReducesBitrate() {
        val controller = AdaptationController(QualityTier.GOOD)
        val initial = controller.bitrateKbps
        val decision = controller.onReport(degraded(loss = 3.0), 10_000)
        assertTrue(decision is AdaptationController.Decision.Bitrate)
        assertTrue(controller.bitrateKbps < initial)
    }

    @Test
    fun upgradeAfterSustainedGoodReports() {
        val controller = AdaptationController(QualityTier.WEAK)
        var upgraded: AdaptationController.Decision? = null
        var t = 0L
        // Needs UPGRADE_STREAK good reports and the upgrade cooldown.
        repeat(AdaptationController.UPGRADE_STREAK + 2) {
            t += AdaptationController.COOLDOWN_MS + 500
            val decision = controller.onReport(healthy(fps = 30.0), t)
            if (decision is AdaptationController.Decision.Tier && upgraded == null) {
                upgraded = decision
            }
        }
        assertTrue("expected an upgrade decision, got $upgraded", upgraded is AdaptationController.Decision.Tier)
        assertEquals(QualityTier.GOOD, controller.tier)
    }

    @Test
    fun noOscillationWithinChangeGap() {
        val controller = AdaptationController(QualityTier.GOOD)
        val first = controller.onReport(degraded(loss = 9.0), 10_000)
        assertTrue(first is AdaptationController.Decision.Tier)
        val second = controller.onReport(degraded(loss = 9.0), 10_500) // inside gap
        assertTrue(second is AdaptationController.Decision.None)
    }

    @Test
    fun floorTierDegradesBitrateInsteadOfNothing() {
        val controller = AdaptationController(QualityTier.VERY_WEAK)
        val decision = controller.onReport(degraded(loss = 9.0), 10_000)
        assertTrue(decision is AdaptationController.Decision.Bitrate)
    }
}
