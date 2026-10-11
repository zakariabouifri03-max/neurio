package com.vyro.core

import com.vyro.core.domain.QualityResolver
import com.vyro.core.model.NetworkClass
import com.vyro.core.model.PlaybackQuality
import kotlin.test.Test
import kotlin.test.assertEquals

class QualityResolverTest {
    private val all = PlaybackQuality.entries.toList()

    @Test
    fun autoOnWifiCanReach4K() {
        assertEquals(
            PlaybackQuality.UHD_4K,
            QualityResolver.resolve(PlaybackQuality.AUTO, all, NetworkClass.UNMETERED_WIFI, false),
        )
    }

    @Test
    fun autoOnFastMobileCapsAt1080p() {
        assertEquals(
            PlaybackQuality.FULL_HD,
            QualityResolver.resolve(PlaybackQuality.AUTO, all, NetworkClass.FAST, false),
        )
    }

    @Test
    fun autoDowngradesOnSlowAndMeteredLinks() {
        assertEquals(
            PlaybackQuality.SD_HIGH,
            QualityResolver.resolve(PlaybackQuality.AUTO, all, NetworkClass.SLOW, false),
        )
        assertEquals(
            PlaybackQuality.HD,
            QualityResolver.resolve(PlaybackQuality.AUTO, all, NetworkClass.METERED, false),
        )
    }

    @Test
    fun dataSaverCapsAt480pExceptOnWifi() {
        assertEquals(
            PlaybackQuality.SD_HIGH,
            QualityResolver.resolve(PlaybackQuality.UHD_4K, all, NetworkClass.METERED, true),
        )
        assertEquals(
            PlaybackQuality.UHD_4K,
            QualityResolver.resolve(
                PlaybackQuality.UHD_4K,
                all,
                NetworkClass.UNMETERED_WIFI,
                true,
            ),
        )
    }

    @Test
    fun fallsBackToNearestLowerAvailableStream() {
        val sdOnly =
            listOf(
                PlaybackQuality.SD,
                PlaybackQuality.SD_HIGH,
                PlaybackQuality.AUTO,
            )
        assertEquals(
            PlaybackQuality.SD_HIGH,
            QualityResolver.resolve(PlaybackQuality.UHD_4K, sdOnly, NetworkClass.FAST, false),
        )
    }

    @Test
    fun returnsAutoWhenNothingIsKnown() {
        assertEquals(
            PlaybackQuality.AUTO,
            QualityResolver.resolve(PlaybackQuality.FULL_HD, emptyList(), NetworkClass.FAST, false),
        )
    }
}
