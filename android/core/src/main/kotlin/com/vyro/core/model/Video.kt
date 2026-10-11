package com.vyro.core.model

/**
 * Domain model for a YouTube video.
 *
 * Every field is already normalised (durations in milliseconds, counts as [Long],
 * dates as epoch millis) so that the UI layer never has to parse anything.
 */
data class Video(
    val id: String,
    val title: String,
    val description: String,
    val channelId: String,
    val channelTitle: String,
    val publishedAtMillis: Long,
    val publishedAtRaw: String,
    val thumbnails: Thumbnails,
    val durationMillis: Long,
    val viewCount: Long,
    val likeCount: Long,
    val commentCount: Long,
    val isLive: Boolean,
    /** True when the extra `videos` detail request filled in duration/statistics. */
    val detailsResolved: Boolean = durationMillis > 0L || viewCount > 0L,
)

data class Thumbnails(
    val defaultUrl: String,
    val mediumUrl: String?,
    val highUrl: String?,
    val standardUrl: String?,
    val maxResUrl: String?,
) {
    companion object {
        val EMPTY =
            Thumbnails(
                defaultUrl = "",
                mediumUrl = null,
                highUrl = null,
                standardUrl = null,
                maxResUrl = null,
            )
    }
}

/** A single page of search results, with the opaque token used to fetch the next one. */
data class VideoPage(
    val items: List<Video>,
    val nextPageToken: String?,
    val totalResults: Long,
)

/** Lightweight value object for a channel (used on the "Explore" row). */
data class Channel(
    val id: String,
    val title: String,
    val thumbnailUrl: String,
    val subscriberCount: Long,
)
