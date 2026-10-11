package com.vyro.play

import com.vyro.core.model.Outcome
import com.vyro.play.data.remote.decodeHtmlEntities
import com.vyro.play.data.remote.toDomain
import com.vyro.play.data.remote.toPage
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the exact wire shape of the YouTube Data API v3 responses against our DTOs.
 *
 * These fixtures are trimmed copies of real responses; if Google adds a field the
 * `ignoreUnknownKeys` setting keeps the app working, and this test proves it.
 */
class DtoMappingTest {

    private val json =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            isLenient = true
        }

    @Test
    fun searchResponseMapsToDomain() {
        val response = json.decodeFromString<com.vyro.play.data.remote.dto.SearchResponseDto>(SEARCH_JSON)

        assertEquals("CAUQAA", response.nextPageToken)
        assertEquals(1_000_000L, response.pageInfo?.totalResults)

        val video = response.items.single().toDomain()
        checkNotNull(video)

        assertEquals("dQw4w9WgXcQ", video.id)
        assertEquals("Tom & Jerry 'Best Of'", video.title)
        assertEquals("UC1234567890", video.channelId)
        assertEquals("Classic Cartoons", video.channelTitle)
        assertEquals(1_710_148_500_000L, video.publishedAtMillis)
        assertEquals("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", video.thumbnails.highUrl)
        assertNull(video.thumbnails.maxResUrl)
        assertFalse(video.isLive)
        assertFalse(video.detailsResolved)
        assertEquals(0L, video.durationMillis)
        assertEquals(0L, video.viewCount)
    }

    @Test
    fun liveBroadcastIsDetected() {
        val response = json.decodeFromString<com.vyro.play.data.remote.dto.SearchResponseDto>(LIVE_JSON)
        assertTrue(checkNotNull(response.items.single().toDomain()).isLive)
    }

    @Test
    fun itemWithoutVideoIdIsSkipped() {
        val response = json.decodeFromString<com.vyro.play.data.remote.dto.SearchResponseDto>(CHANNEL_RESULT_JSON)
        assertTrue(response.items.single().toDomain() == null)
    }

    @Test
    fun videosResponseResolvesDurationAndStatistics() {
        val response = json.decodeFromString<com.vyro.play.data.remote.dto.VideosResponseDto>(VIDEOS_JSON)
        val page = response.toPage()

        assertEquals(1L, page.totalResults)
        val video = page.items.single()

        assertEquals(3_723_000L, video.durationMillis) // PT1H2M3S
        assertEquals(1_234_567L, video.viewCount)
        assertEquals(42_000L, video.likeCount)
        assertEquals(7L, video.commentCount)
        assertTrue(video.detailsResolved)
        assertEquals("https://i.ytimg.com/vi/vid1/maxresdefault.jpg", video.thumbnails.maxResUrl)
    }

    @Test
    fun unknownJsonFieldsAreIgnored() {
        val response =
            json.decodeFromString<com.vyro.play.data.remote.dto.VideosResponseDto>(
                """{"brandNewGoogleField":{"nested":1},"items":[]}""",
            )
        assertTrue(response.items.isEmpty())
    }

    @Test
    fun missingStatisticsAreCoercedToZero() {
        val response =
            json.decodeFromString<com.vyro.play.data.remote.dto.VideosResponseDto>(
                """{"items":[{"id":"a","snippet":{"title":"no stats"}}]}""",
            )
        val video = checkNotNull(response.items.single().toDomain())
        assertEquals(0L, video.viewCount)
        assertEquals(0L, video.likeCount)
        assertEquals(0L, video.durationMillis)
        assertEquals("no stats", video.title)
    }

    @Test
    fun htmlEntitiesAreDecoded() {
        assertEquals("Rock & Roll", "Rock &amp; Roll".decodeHtmlEntities())
        assertEquals("It's fine", "It&#39;s fine".decodeHtmlEntities())
        assertEquals("a \"b\" c", "a &quot;b&quot; c".decodeHtmlEntities())
        assertEquals("plain title", "plain title".decodeHtmlEntities())
    }

    @Test
    fun outcomeHelpersBehaveAsExpected() {
        val success: Outcome<String> = Outcome.Success("ok")
        val failure: Outcome<String> = Outcome.Failure(com.vyro.core.model.AppError.Offline)

        assertEquals("ok", success.dataOrNull())
        assertNull(failure.dataOrNull())
        assertTrue(failure.errorOrNull() is com.vyro.core.model.AppError.Offline)
        assertEquals(Outcome.Success(2), Outcome.Success(1).map { it + 1 })
        assertTrue(Outcome.Loading.map { it } is Outcome.Loading)
    }

    private companion object {
        const val SEARCH_JSON = """
{
  "kind": "youtube#searchListResponse",
  "etag": "etag-1",
  "nextPageToken": "CAUQAA",
  "regionCode": "US",
  "pageInfo": { "totalResults": 1000000, "resultsPerPage": 1 },
  "items": [
    {
      "kind": "youtube#searchResult",
      "etag": "etag-item",
      "id": { "kind": "youtube#video", "videoId": "dQw4w9WgXcQ" },
      "snippet": {
        "publishedAt": "2024-03-11T09:15:00Z",
        "channelId": "UC1234567890",
        "title": "Tom &amp; Jerry &#39;Best Of&#39;",
        "description": "A description",
        "channelTitle": "Classic Cartoons",
        "liveBroadcastContent": "none",
        "thumbnails": {
          "default": { "url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg", "width": 120, "height": 90 },
          "medium": { "url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", "width": 320, "height": 180 },
          "high": { "url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", "width": 480, "height": 360 }
        }
      }
    }
  ]
}
"""

        const val LIVE_JSON = """
{
  "items": [
    {
      "id": { "videoId": "live1" },
      "snippet": {
        "title": "Live now",
        "channelTitle": "News",
        "publishedAt": "2024-03-11T09:15:00Z",
        "liveBroadcastContent": "live",
        "thumbnails": { "high": { "url": "https://i.ytimg.com/vi/live1/hqdefault.jpg" } }
      }
    }
  ]
}
"""

        const val CHANNEL_RESULT_JSON = """
{
  "items": [
    {
      "id": { "kind": "youtube#channel", "channelId": "UCzzz" },
      "snippet": { "title": "A channel", "thumbnails": {} }
    }
  ]
}
"""

        const val VIDEOS_JSON = """
{
  "kind": "youtube#videoListResponse",
  "pageInfo": { "totalResults": 1, "resultsPerPage": 1 },
  "items": [
    {
      "kind": "youtube#video",
      "id": "vid1",
      "snippet": {
        "publishedAt": "2024-01-02T03:04:05Z",
        "channelId": "UCabc",
        "title": "A full video",
        "description": "Full details",
        "channelTitle": "Channel One",
        "liveBroadcastContent": "none",
        "thumbnails": {
          "default": { "url": "https://i.ytimg.com/vi/vid1/default.jpg" },
          "maxres": { "url": "https://i.ytimg.com/vi/vid1/maxresdefault.jpg" }
        }
      },
      "contentDetails": {
        "duration": "PT1H2M3S",
        "dimension": "2d",
        "definition": "hd",
        "caption": "true"
      },
      "statistics": {
        "viewCount": "1234567",
        "likeCount": "42000",
        "favoriteCount": "0",
        "commentCount": "7"
      }
    }
  ]
}
"""
    }
}
