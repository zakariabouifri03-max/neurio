package com.vyro.core

import com.vyro.core.domain.PagingReducer
import com.vyro.core.domain.SearchHistoryPolicy
import com.vyro.core.domain.WatchHistoryPolicy
import com.vyro.core.model.HistorySort
import com.vyro.core.model.SearchQuery
import com.vyro.core.model.Video
import com.vyro.core.model.VideoPage
import com.vyro.core.model.WatchHistoryEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PolicyTest {
    private fun video(id: String) =
        Video(
            id = id,
            title = "t$id",
            description = "",
            channelId = "c",
            channelTitle = "ch",
            publishedAtMillis = 0L,
            publishedAtRaw = "",
            thumbnails = com.vyro.core.model.Thumbnails.EMPTY,
            durationMillis = 0L,
            viewCount = 0L,
            likeCount = 0L,
            commentCount = 0L,
            isLive = false,
        )

    @Test
    fun searchHistoryDedupeIsCaseInsensitiveAndRefreshesTimestamp() {
        var history = emptyList<SearchQuery>()
        history = SearchHistoryPolicy.merged(history, "compose", 100L, 20)
        history = SearchHistoryPolicy.merged(history, "kotlin", 200L, 20)
        history = SearchHistoryPolicy.merged(history, "Compose", 300L, 20)

        assertEquals(2, history.size)
        assertEquals("Compose", history[0].text)
        assertEquals(2, history[0].useCount)
        assertEquals(300L, history[0].updatedAtMillis)
        assertEquals("kotlin", history[1].text)
    }

    @Test
    fun searchHistoryRespectsLimitAndRejectsShortQueries() {
        var history = emptyList<SearchQuery>()
        for (i in 1..10) {
            history = SearchHistoryPolicy.merged(history, "query$i", i.toLong(), 5)
        }
        assertEquals(5, history.size)
        assertEquals("query10", history[0].text)

        val untouched = SearchHistoryPolicy.merged(history, " a ", 999L, 5)
        assertEquals(history, untouched)
    }

    @Test
    fun searchSuggestionsRankByUseCount() {
        val history =
            listOf(
                SearchQuery("alpha", 1L, 1),
                SearchQuery("android", 2L, 5),
                SearchQuery("alpha beta", 3L, 3),
            )
        val suggestions = SearchHistoryPolicy.suggestions(history, "alp")
        assertEquals(2, suggestions.size)
        assertEquals("alpha beta", suggestions[0].text)
    }

    @Test
    fun watchHistoryMergesByVideoIdAndCountsRewatches() {
        val entry = { id: String, time: Long ->
            WatchHistoryEntry(id, "title $id", "channel", "", 100_000L, time)
        }
        var history = emptyList<WatchHistoryEntry>()
        history = WatchHistoryPolicy.merged(history, entry("a", 10L), 50)
        history = WatchHistoryPolicy.merged(history, entry("b", 20L), 50)
        history = WatchHistoryPolicy.merged(history, entry("a", 30L), 50)

        assertEquals(2, history.size)
        assertEquals("a", history[0].videoId)
        assertEquals(2, history[0].watchCount)
    }

    @Test
    fun watchHistorySortsByRecencyOrWatchCount() {
        val a = WatchHistoryEntry("a", "a", "", "", 10L, 100L, watchCount = 7)
        val b = WatchHistoryEntry("b", "b", "", "", 10L, 200L, watchCount = 1)
        assertEquals(
            listOf("b", "a"),
            WatchHistoryPolicy.sorted(listOf(a, b), HistorySort.RECENT).map { it.videoId },
        )
        assertEquals(
            listOf("a", "b"),
            WatchHistoryPolicy.sorted(listOf(a, b), HistorySort.MOST_WATCHED).map { it.videoId },
        )
    }

    @Test
    fun watchProgressIsClamped() {
        val partial = WatchHistoryEntry("a", "a", "", "", 100L, 1L, progressMillis = 40L)
        val overshoot = WatchHistoryEntry("b", "b", "", "", 100L, 1L, progressMillis = 999L)
        val noDuration = WatchHistoryEntry("c", "c", "", "", 0L, 1L, progressMillis = 50L)
        assertEquals(0.4f, WatchHistoryPolicy.progressFraction(partial))
        assertEquals(1f, WatchHistoryPolicy.progressFraction(overshoot))
        assertEquals(0f, WatchHistoryPolicy.progressFraction(noDuration))
        assertTrue(WatchHistoryPolicy.isCompleted(overshoot))
        assertFalse(WatchHistoryPolicy.isCompleted(partial))
    }

    @Test
    fun pagingDropsDuplicatesAndDetectsPrefetch() {
        var list = listOf(video("1"), video("2"))
        list = PagingReducer.append(list, VideoPage(listOf(video("2"), video("3")), null, 3))
        assertEquals(listOf("1", "2", "3"), list.map { it.id })
        assertTrue(PagingReducer.shouldPrefetch(24, 30))
        assertFalse(PagingReducer.shouldPrefetch(5, 30))
    }
}
