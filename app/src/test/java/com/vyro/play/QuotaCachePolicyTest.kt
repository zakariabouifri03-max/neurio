package com.vyro.play

import com.vyro.play.model.QuotaCachePolicy
import com.vyro.play.model.SafeSearchMode
import com.vyro.play.model.VideoQualityOption
import com.vyro.play.model.WatchHistoryItem
import com.vyro.play.model.WatchSourceType
import com.vyro.play.model.YouTubeVideo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuotaCachePolicyTest {

    @Test
    fun normalizeSearchCacheKey_isCaseAndWhitespaceInsensitive() {
        val k1 = QuotaCachePolicy.normalizeSearchCacheKey("  Kotlin   Compose 4K ", SafeSearchMode.MODERATE, true)
        val k2 = QuotaCachePolicy.normalizeSearchCacheKey("kotlin compose 4k", SafeSearchMode.MODERATE, true)
        assertEquals(k1, k2)
    }

    @Test
    fun isExpired_enforces15MinuteTtlPolicy() {
        val now = 1_700_000_000_000L
        val fiveMinutesAgo = now - (5L * 60L * 1000L)
        val twentyMinutesAgo = now - (20L * 60L * 1000L)

        assertFalse(QuotaCachePolicy.isExpired(fiveMinutesAgo, now))
        assertTrue(QuotaCachePolicy.isExpired(twentyMinutesAgo, now))
        assertTrue(QuotaCachePolicy.isExpired(0L, now))
    }

    @Test
    fun bestThumbnailUrl_usesMediumThumbnailOnLowEndMode() {
        val video = YouTubeVideo(
            id = "test1234567",
            title = "Sample 4K Test",
            description = "",
            channelId = "ch1",
            channelTitle = "Creator",
            publishedAt = "2026-01-01",
            publishedRelative = "2026-01-01",
            thumbnailMediumUrl = "https://i.ytimg.com/vi/test1234567/mqdefault.jpg",
            thumbnailHighUrl = "https://i.ytimg.com/vi/test1234567/hqdefault.jpg",
            thumbnailMaxResUrl = "https://i.ytimg.com/vi/test1234567/maxresdefault.jpg",
            durationIso = "PT2M",
            durationFormatted = "2:00",
            durationSeconds = 120L,
            viewCount = 1000L,
            viewCountFormatted = "1K views",
            likeCount = 50L,
            likeCountFormatted = "50",
            definition = "hd",
            supports4KHint = true,
            hasCaptions = true
        )

        assertEquals(
            "https://i.ytimg.com/vi/test1234567/mqdefault.jpg",
            video.bestThumbnailUrl(lowEndOrDataSaver = true)
        )
        assertEquals(
            "https://i.ytimg.com/vi/test1234567/hqdefault.jpg",
            video.bestThumbnailUrl(lowEndOrDataSaver = false)
        )
    }

    @Test
    fun videoQualityOption_mapsOfficialYouTubeQualityCodes() {
        assertEquals(VideoQualityOption.UHD_4K, VideoQualityOption.fromYtCode("hd2160"))
        assertEquals(VideoQualityOption.QHD_2K, VideoQualityOption.fromYtCode("hd1440"))
        assertEquals(VideoQualityOption.FHD_1080P, VideoQualityOption.fromYtCode("hd1080"))
        assertEquals(VideoQualityOption.HD_720P, VideoQualityOption.fromYtCode("hd720"))
        assertEquals(VideoQualityOption.SD_480P, VideoQualityOption.fromYtCode("large"))
        assertEquals(VideoQualityOption.SD_360P, VideoQualityOption.fromYtCode("medium"))
        assertEquals(VideoQualityOption.AUTO, VideoQualityOption.fromYtCode("unknown"))
    }

    @Test
    fun watchHistoryItem_computesProgressFractionSafely() {
        val item = WatchHistoryItem(
            id = "yt:aqz-KE-bpKQ",
            title = "Big Buck Bunny",
            channelOrFolder = "Blender",
            thumbnailUrl = "",
            durationFormatted = "10:00",
            durationSeconds = 600L,
            lastPositionSeconds = 150L,
            watchedAtEpochMs = 1000L,
            sourceType = WatchSourceType.YOUTUBE
        )
        assertEquals(0.25f, item.progressFraction, 0.001f)
    }
}
