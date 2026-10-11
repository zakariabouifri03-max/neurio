package com.vyro.core.model

/** One row of the local search-history table. */
data class SearchQuery(
    val text: String,
    val updatedAtMillis: Long,
    val useCount: Int = 1,
)

/** One row of the local watch-history table. */
data class WatchHistoryEntry(
    val videoId: String,
    val title: String,
    val channelTitle: String,
    val thumbnailUrl: String,
    val durationMillis: Long,
    val lastWatchedMillis: Long,
    val watchCount: Int = 1,
    val progressMillis: Long = 0L,
)

/** A video file found on the device by the local-media scanner. */
data class LocalVideo(
    val uri: String,
    val displayName: String,
    val durationMillis: Long,
    val sizeBytes: Long,
    val dateAddedMillis: Long,
    val bucketName: String?,
    val width: Int,
    val height: Int,
) {
    /** `2160p`, `1080p`, `480p`, ... derived from the shorter edge, or `SD` when unknown. */
    val qualityLabel: String
        get() {
            val shortEdge = minOf(width, height)
            return if (shortEdge <= 0) "SD" else "${shortEdge}p"
        }
}
