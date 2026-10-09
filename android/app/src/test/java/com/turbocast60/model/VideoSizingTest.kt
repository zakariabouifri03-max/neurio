package com.turbocast60.model

import org.junit.Assert.assertEquals
import org.junit.Test

class VideoSizingTest {
    @Test fun preservesLandscapeAspectAndUsesEvenDimensions() {
        assertEquals(1280 to 576, VideoSizing.fit(2400, 1080, 1280))
    }

    @Test fun preservesPortraitAspectAndUsesEvenDimensions() {
        assertEquals(576 to 1280, VideoSizing.fit(1080, 2400, 1280))
    }

    @Test fun doesNotUpscaleSmallScreens() {
        assertEquals(800 to 600, VideoSizing.fit(800, 600, 1920))
    }

    @Test fun adaptsOnlyAfterMeasuredReceiverFeedback() {
        val controller = AdaptiveBitrateController(StreamProfile.ADAPTIVE)
        val first = controller.onFeedback(lossPercent = 0.0, rttMs = 40, nowMs = 1)
        val second = controller.onFeedback(lossPercent = 0.0, rttMs = 40, nowMs = 2)
        assertEquals(AdaptationKind.KEEP, first.kind)
        assertEquals(AdaptationKind.KEEP, second.kind)
        val degraded = controller.onFeedback(lossPercent = 12.0, rttMs = 320, nowMs = 3)
        assertEquals(AdaptationKind.LOWER_QUALITY, degraded.kind)
        assertEquals(1280, degraded.longEdge)
        assertEquals(30, degraded.fps)
    }
}
