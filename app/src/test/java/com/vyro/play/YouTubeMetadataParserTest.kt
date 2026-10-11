package com.vyro.play

import com.vyro.play.data.remote.YouTubeMetadataParser
import com.vyro.play.model.ApiErrorCode
import com.vyro.play.model.ApiResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class YouTubeMetadataParserTest {

    @Test
    fun extractVideoId_handlesAllOfficialUrlFormatsAndRawIds() {
        assertEquals("dQw4w9WgXcQ", YouTubeMetadataParser.extractVideoId("dQw4w9WgXcQ"))
        assertEquals(
            "aqz-KE-bpKQ",
            YouTubeMetadataParser.extractVideoId("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=12s")
        )
        assertEquals(
            "aqz-KE-bpKQ",
            YouTubeMetadataParser.extractVideoId("https://m.youtube.com/watch?v=aqz-KE-bpKQ")
        )
        assertEquals(
            "LXb3EKWsInQ",
            YouTubeMetadataParser.extractVideoId("https://youtu.be/LXb3EKWsInQ?si=abc123")
        )
        assertEquals(
            "LXb3EKWsInQ",
            YouTubeMetadataParser.extractVideoId("https://www.youtube.com/embed/LXb3EKWsInQ")
        )
        assertEquals(
            "LXb3EKWsInQ",
            YouTubeMetadataParser.extractVideoId("https://www.youtube.com/shorts/LXb3EKWsInQ")
        )
        assertNull(YouTubeMetadataParser.extractVideoId(""))
        assertNull(YouTubeMetadataParser.extractVideoId("not a valid id"))
    }

    @Test
    fun parseIsoDurationSeconds_and_formatDurationSeconds_workCorrectly() {
        assertEquals(253L, YouTubeMetadataParser.parseIsoDurationSeconds("PT4M13S"))
        assertEquals("4:13", YouTubeMetadataParser.formatDurationSeconds(253L))

        assertEquals(3725L, YouTubeMetadataParser.parseIsoDurationSeconds("PT1H2M5S"))
        assertEquals("1:02:05", YouTubeMetadataParser.formatDurationSeconds(3725L))

        assertEquals(45L, YouTubeMetadataParser.parseIsoDurationSeconds("PT45S"))
        assertEquals("0:45", YouTubeMetadataParser.formatDurationSeconds(45L))

        assertEquals(0L, YouTubeMetadataParser.parseIsoDurationSeconds("P0D"))
        assertEquals("LIVE", YouTubeMetadataParser.formatDurationSeconds(0L, isLive = true))
    }

    @Test
    fun formatCompactCount_and_formatFileSize_formatAccurately() {
        assertEquals("0", YouTubeMetadataParser.formatCompactCount(0L))
        assertEquals("842", YouTubeMetadataParser.formatCompactCount(842L))
        assertEquals("12.4K", YouTubeMetadataParser.formatCompactCount(12_400L))
        assertEquals("3.5M", YouTubeMetadataParser.formatCompactCount(3_500_000L))
        assertEquals("1.2B", YouTubeMetadataParser.formatCompactCount(1_200_000_000L))

        assertEquals("512 B", YouTubeMetadataParser.formatFileSize(512L))
        assertEquals("1.0 MB", YouTubeMetadataParser.formatFileSize(1024L * 1024L))
    }

    @Test
    fun parseSearchAndVideosResponse_parses4KAndCaptionsMetadata() {
        val sampleSearchJson = """
            {
              "items": [
                { "id": { "kind": "youtube#video", "videoId": "LXb3EKWsInQ" } },
                { "id": { "kind": "youtube#video", "videoId": "aqz-KE-bpKQ" } }
              ]
            }
        """.trimIndent()

        val ids = YouTubeMetadataParser.parseSearchVideoIds(sampleSearchJson)
        assertEquals(listOf("LXb3EKWsInQ", "aqz-KE-bpKQ"), ids)

        val sampleVideosJson = """
            {
              "items": [
                {
                  "id": "LXb3EKWsInQ",
                  "snippet": {
                    "publishedAt": "2026-06-15T14:00:00Z",
                    "channelId": "UC_channel_1",
                    "title": "COSTA RICA IN 4K 60fps HDR (Ultra HD)",
                    "description": "Shot in 2160p 4K Ultra HD.",
                    "channelTitle": "Jacob + Katie Schwarz",
                    "tags": ["4K", "HDR", "2160p"],
                    "thumbnails": {
                      "medium": { "url": "https://i.ytimg.com/vi/LXb3EKWsInQ/mqdefault.jpg" },
                      "high": { "url": "https://i.ytimg.com/vi/LXb3EKWsInQ/hqdefault.jpg" },
                      "maxres": { "url": "https://i.ytimg.com/vi/LXb3EKWsInQ/maxresdefault.jpg" }
                    }
                  },
                  "contentDetails": {
                    "duration": "PT5M14S",
                    "definition": "hd",
                    "caption": "true"
                  },
                  "statistics": {
                    "viewCount": "148500000",
                    "likeCount": "920000"
                  }
                }
              ]
            }
        """.trimIndent()

        val videos = YouTubeMetadataParser.parseVideosListResponse(sampleVideosJson)
        assertEquals(1, videos.size)
        val v = videos.first()
        assertEquals("LXb3EKWsInQ", v.id)
        assertEquals("COSTA RICA IN 4K 60fps HDR (Ultra HD)", v.title)
        assertEquals("Jacob + Katie Schwarz", v.channelTitle)
        assertEquals(314L, v.durationSeconds)
        assertEquals("5:14", v.durationFormatted)
        assertTrue(v.supports4KHint)
        assertTrue(v.hasCaptions)
        assertEquals("4K ULTRA HD", v.qualityBadgeText)
        assertEquals("148.5M views", v.viewCountFormatted)

        // Verify round-trip JSON cache serialization
        val cachedJson = YouTubeMetadataParser.serializeVideoListToJson(videos)
        val restored = YouTubeMetadataParser.deserializeVideoListFromJson(cachedJson)
        assertEquals(1, restored.size)
        assertEquals(v.id, restored.first().id)
        assertEquals(v.title, restored.first().title)
        assertTrue(restored.first().supports4KHint)
    }

    @Test
    fun parseApiError_identifiesInvalidKeyAndQuotaExceeded() {
        val invalidKeyBody = """
            {
              "error": {
                "code": 400,
                "message": "API key not valid. Please pass a valid API key.",
                "errors": [
                  { "reason": "keyInvalid", "message": "API key not valid." }
                ]
              }
            }
        """.trimIndent()

        val err1 = YouTubeMetadataParser.parseApiError(400, invalidKeyBody)
        assertEquals(ApiErrorCode.INVALID_API_KEY, err1.errorCode)

        val quotaBody = """
            {
              "error": {
                "code": 403,
                "message": "The request cannot be completed because you have exceeded your quota.",
                "errors": [
                  { "reason": "quotaExceeded" }
                ]
              }
            }
        """.trimIndent()

        val err2 = YouTubeMetadataParser.parseApiError(403, quotaBody)
        assertEquals(ApiErrorCode.QUOTA_EXCEEDED, err2.errorCode)
    }

    @Test
    fun parseOEmbedResponse_parsesRealOEmbedMetadata() {
        val oembedJson = """
            {
              "title": "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film",
              "author_name": "Blender Foundation",
              "thumbnail_url": "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg"
            }
        """.trimIndent()
        val video = YouTubeMetadataParser.parseOEmbedResponse("aqz-KE-bpKQ", oembedJson)
        assertNotNull(video)
        assertEquals("aqz-KE-bpKQ", video.id)
        assertEquals("Blender Foundation", video.channelTitle)
        assertTrue(video.supports4KHint)
        assertFalse(video.isLiveContent)
    }
}
