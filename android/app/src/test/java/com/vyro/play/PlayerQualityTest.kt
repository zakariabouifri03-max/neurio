package com.vyro.play

import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.PlayerConstants
import com.vyro.core.model.NetworkClass
import com.vyro.core.model.PlaybackQuality
import com.vyro.core.domain.QualityResolver
import com.vyro.play.feature.player.mapQuality
import com.vyro.play.feature.player.parseQualityLevels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Covers the bridge between the IFrame player's quality strings and the domain model. */
class PlayerQualityTest {

    @Test
    fun parsesQualityLevelsFromJavascript() {
        val parsed = parseQualityLevels("""[\"hd720\",\"hd1080\",\"highres\"]""")
        assertEquals(
            listOf(PlaybackQuality.HD, PlaybackQuality.FULL_HD, PlaybackQuality.UHD_4K),
            parsed,
        )
    }

    @Test
    fun parsesSingleLevel() {
        assertEquals(listOf(PlaybackQuality.HD), parseQualityLevels("""[\"hd720\"]"""))
    }

    @Test
    fun emptyOrMissingInputYieldsNoLevels() {
        assertTrue(parseQualityLevels(null).isEmpty())
        assertTrue(parseQualityLevels("").isEmpty())
        assertTrue(parseQualityLevels("[]").isEmpty())
        assertTrue(parseQualityLevels("null").isEmpty())
    }

    @Test
    fun unknownLevelFallsBackToAuto() {
        assertEquals(listOf(PlaybackQuality.AUTO), parseQualityLevels("""[\"somethingNew\"]"""))
    }

    @Test
    fun mapsEveryLibraryQuality() {
        assertEquals(PlaybackQuality.LOW, mapQuality(PlayerConstants.PlaybackQuality.SMALL))
        assertEquals(PlaybackQuality.SD, mapQuality(PlayerConstants.PlaybackQuality.MEDIUM))
        assertEquals(PlaybackQuality.SD_HIGH, mapQuality(PlayerConstants.PlaybackQuality.LARGE))
        assertEquals(PlaybackQuality.HD, mapQuality(PlayerConstants.PlaybackQuality.HD720))
        assertEquals(PlaybackQuality.FULL_HD, mapQuality(PlayerConstants.PlaybackQuality.HD1080))
        assertEquals(PlaybackQuality.UHD_4K, mapQuality(PlayerConstants.PlaybackQuality.HIGH_RES))
        assertEquals(PlaybackQuality.AUTO, mapQuality(PlayerConstants.PlaybackQuality.DEFAULT))
        assertEquals(PlaybackQuality.AUTO, mapQuality(PlayerConstants.PlaybackQuality.UNKNOWN))
    }

    @Test
    fun fourKIsSelectedOnlyWhenTheStreamExists() {
        val without4K = listOf(PlaybackQuality.HD, PlaybackQuality.FULL_HD)
        assertEquals(
            PlaybackQuality.FULL_HD,
            QualityResolver.resolve(
                preferred = PlaybackQuality.UHD_4K,
                available = without4K,
                network = NetworkClass.UNMETERED_WIFI,
                dataSaver = false,
            ),
        )

        val with4K = without4K + PlaybackQuality.UHD_4K
        assertEquals(
            PlaybackQuality.UHD_4K,
            QualityResolver.resolve(
                preferred = PlaybackQuality.UHD_4K,
                available = with4K,
                network = NetworkClass.UNMETERED_WIFI,
                dataSaver = false,
            ),
        )
    }

    @Test
    fun rawValuesMatchTheIFramePlayerApi() {
        assertEquals("highres", PlaybackQuality.UHD_4K.rawValue)
        assertEquals("hd1080", PlaybackQuality.FULL_HD.rawValue)
        assertEquals("hd720", PlaybackQuality.HD.rawValue)
        assertEquals("auto", PlaybackQuality.AUTO.rawValue)
    }
}
