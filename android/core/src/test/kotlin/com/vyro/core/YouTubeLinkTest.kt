package com.vyro.core

import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.Thumbnails
import com.vyro.core.util.ThumbnailUrls
import com.vyro.core.util.YouTubeLink
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class YouTubeLinkTest {
    @Test
    fun extractsIdFromWatchUrl() {
        assertEquals(
            "dQw4w9WgXcQ",
            YouTubeLink.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        )
        assertEquals(
            "dQw4w9WgXcQ",
            YouTubeLink.extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s"),
        )
    }

    @Test
    fun extractsIdFromShortAndEmbedUrls() {
        assertEquals("dQw4w9WgXcQ", YouTubeLink.extractVideoId("https://youtu.be/dQw4w9WgXcQ"))
        assertEquals(
            "dQw4w9WgXcQ",
            YouTubeLink.extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
        )
        assertEquals(
            "dQw4w9WgXcQ",
            YouTubeLink.extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
        )
    }

    @Test
    fun acceptsBareIdsAndRejectsJunk() {
        assertEquals("dQw4w9WgXcQ", YouTubeLink.extractVideoId("dQw4w9WgXcQ"))
        assertNull(YouTubeLink.extractVideoId("https://vimeo.com/12345"))
        assertNull(YouTubeLink.extractVideoId(""))
        assertNull(YouTubeLink.extractVideoId(null))
    }

    @Test
    fun buildsWatchAndChannelUrls() {
        assertEquals("https://www.youtube.com/watch?v=abc", YouTubeLink.watchUrl("abc"))
        assertEquals("https://www.youtube.com/channel/uc1", YouTubeLink.channelUrl("uc1"))
    }

    @Test
    fun thumbnailPickerFallsBackGracefully() {
        val full =
            Thumbnails(
                defaultUrl = "d",
                mediumUrl = "m",
                highUrl = "h",
                standardUrl = "s",
                maxResUrl = "x",
            )
        assertEquals("x", ThumbnailUrls.pick(full, ThumbnailQuality.MAX))
        assertEquals("s", ThumbnailUrls.pick(full, ThumbnailQuality.HIGH))
        assertEquals("h", ThumbnailUrls.pick(full, ThumbnailQuality.MEDIUM))
        assertEquals("m", ThumbnailUrls.pick(full, ThumbnailQuality.LOW))

        val sparse = Thumbnails("", null, null, null, null)
        assertEquals("", ThumbnailUrls.pick(sparse, ThumbnailQuality.MAX))
        assertEquals(
            "https://i.ytimg.com/vi/abc/hqdefault.jpg",
            ThumbnailUrls.hqDefault("abc"),
        )
    }
}
