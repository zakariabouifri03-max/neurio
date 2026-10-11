package com.vyro.core

import com.vyro.core.domain.YouTubeQueryBuilder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class YouTubeQueryBuilderTest {
    private val key = "TEST_KEY"

    @Test
    fun searchUrlContainsRequiredParameters() {
        val url = YouTubeQueryBuilder.search(apiKey = key, query = "compose tutorial")
        assertTrue(url.startsWith("https://www.googleapis.com/youtube/v3/search?"))
        assertTrue(url.contains("part=snippet"))
        assertTrue(url.contains("type=video"))
        assertTrue(url.contains("q=compose%20tutorial"))
        assertTrue(url.contains("key=TEST_KEY"))
        assertTrue(url.contains("safeSearch=none"))
    }

    @Test
    fun searchUrlAppendsPageTokenWhenPresent() {
        val first = YouTubeQueryBuilder.search(apiKey = key, query = "a")
        val second = YouTubeQueryBuilder.search(apiKey = key, query = "a", pageToken = "CAUQAA")
        assertTrue(!first.contains("pageToken"))
        assertTrue(second.contains("pageToken=CAUQAA"))
    }

    @Test
    fun searchUrlHonoursSafeSearchAndMaxResults() {
        val url =
            YouTubeQueryBuilder.search(
                apiKey = key,
                query = "x",
                safeSearch = true,
                maxResults = 100,
            )
        assertTrue(url.contains("safeSearch=strict"))
        assertTrue(url.contains("maxResults=50"), "maxResults must be clamped to the API limit")
    }

    @Test
    fun videosUrlJoinsDistinctIds() {
        val url =
            YouTubeQueryBuilder.videos(apiKey = key, videoIds = listOf("aaa", "bbb", "aaa"))
        assertTrue(url.contains("id=aaa%2Cbbb"))
        assertTrue(url.contains("part=snippet%2CcontentDetails%2Cstatistics"))
    }

    @Test
    fun mostPopularUrlUsesChartParameter() {
        val url = YouTubeQueryBuilder.mostPopular(apiKey = key, regionCode = "DE")
        assertTrue(url.contains("chart=mostPopular"))
        assertTrue(url.contains("regionCode=DE"))
    }

    @Test
    fun percentEncoderEscapesReservedCharacters() {
        assertEquals(
            "a%20b%26c%3Dd%2Fe",
            YouTubeQueryBuilder.percentEncode("a b&c=d/e"),
        )
        assertEquals(
            "%C3%A9t%C3%A9",
            YouTubeQueryBuilder.percentEncode("été"),
        )
    }
}
