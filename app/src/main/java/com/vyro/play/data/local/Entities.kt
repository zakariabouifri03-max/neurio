package com.vyro.play.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.vyro.play.model.LocalVideoFile
import com.vyro.play.model.SearchHistoryEntry
import com.vyro.play.model.WatchHistoryItem
import com.vyro.play.model.WatchSourceType
import com.vyro.play.model.YouTubeVideo

@Entity(tableName = "favorites")
data class FavoriteVideoEntity(
    @PrimaryKey val id: String,
    val title: String,
    val description: String,
    val channelId: String,
    val channelTitle: String,
    val publishedAt: String,
    val publishedRelative: String,
    val thumbnailMediumUrl: String,
    val thumbnailHighUrl: String,
    val thumbnailMaxResUrl: String,
    val durationIso: String,
    val durationFormatted: String,
    val durationSeconds: Long,
    val viewCount: Long,
    val viewCountFormatted: String,
    val likeCount: Long,
    val likeCountFormatted: String,
    val definition: String,
    val supports4KHint: Boolean,
    val hasCaptions: Boolean,
    val addedAtEpochMs: Long
) {
    fun toDomain(): YouTubeVideo = YouTubeVideo(
        id = id,
        title = title,
        description = description,
        channelId = channelId,
        channelTitle = channelTitle,
        publishedAt = publishedAt,
        publishedRelative = publishedRelative,
        thumbnailMediumUrl = thumbnailMediumUrl,
        thumbnailHighUrl = thumbnailHighUrl,
        thumbnailMaxResUrl = thumbnailMaxResUrl,
        durationIso = durationIso,
        durationFormatted = durationFormatted,
        durationSeconds = durationSeconds,
        viewCount = viewCount,
        viewCountFormatted = viewCountFormatted,
        likeCount = likeCount,
        likeCountFormatted = likeCountFormatted,
        definition = definition,
        supports4KHint = supports4KHint,
        hasCaptions = hasCaptions
    )

    companion object {
        fun fromDomain(video: YouTubeVideo, addedAtEpochMs: Long = System.currentTimeMillis()): FavoriteVideoEntity {
            return FavoriteVideoEntity(
                id = video.id,
                title = video.title,
                description = video.description,
                channelId = video.channelId,
                channelTitle = video.channelTitle,
                publishedAt = video.publishedAt,
                publishedRelative = video.publishedRelative,
                thumbnailMediumUrl = video.thumbnailMediumUrl,
                thumbnailHighUrl = video.thumbnailHighUrl,
                thumbnailMaxResUrl = video.thumbnailMaxResUrl,
                durationIso = video.durationIso,
                durationFormatted = video.durationFormatted,
                durationSeconds = video.durationSeconds,
                viewCount = video.viewCount,
                viewCountFormatted = video.viewCountFormatted,
                likeCount = video.likeCount,
                likeCountFormatted = video.likeCountFormatted,
                definition = video.definition,
                supports4KHint = video.supports4KHint,
                hasCaptions = video.hasCaptions,
                addedAtEpochMs = addedAtEpochMs
            )
        }
    }
}

@Entity(tableName = "watch_history")
data class WatchHistoryEntity(
    @PrimaryKey val id: String,
    val videoId: String,
    val title: String,
    val channelOrFolder: String,
    val thumbnailUrl: String,
    val durationFormatted: String,
    val durationSeconds: Long,
    val lastPositionSeconds: Long,
    val watchedAtEpochMs: Long,
    val sourceType: String,
    val localUri: String,
    val qualityBadge: String
) {
    fun toDomain(): WatchHistoryItem = WatchHistoryItem(
        id = id,
        title = title,
        channelOrFolder = channelOrFolder,
        thumbnailUrl = thumbnailUrl,
        durationFormatted = durationFormatted,
        durationSeconds = durationSeconds,
        lastPositionSeconds = lastPositionSeconds,
        watchedAtEpochMs = watchedAtEpochMs,
        sourceType = if (sourceType == "LOCAL") WatchSourceType.LOCAL else WatchSourceType.YOUTUBE,
        localUri = localUri,
        qualityBadge = qualityBadge
    )
}

@Entity(tableName = "search_history")
data class SearchHistoryEntity(
    @PrimaryKey val queryNormalized: String,
    val displayQuery: String,
    val searchedAtEpochMs: Long,
    val resultCount: Int
) {
    fun toDomain(): SearchHistoryEntry = SearchHistoryEntry(
        query = displayQuery,
        searchedAtEpochMs = searchedAtEpochMs,
        resultCount = resultCount
    )
}

@Entity(tableName = "api_cache")
data class ApiCacheEntity(
    @PrimaryKey val cacheKey: String,
    val responseJson: String,
    val cachedAtEpochMs: Long
)

@Entity(tableName = "saved_local_videos")
data class SavedLocalVideoEntity(
    @PrimaryKey val uri: String,
    val displayName: String,
    val sizeBytes: Long,
    val sizeFormatted: String,
    val durationMs: Long,
    val durationFormatted: String,
    val mimeType: String,
    val dateAddedSeconds: Long,
    val resolution: String,
    val folderName: String,
    val lastPositionMs: Long
) {
    fun toDomain(): LocalVideoFile = LocalVideoFile(
        uri = uri,
        displayName = displayName,
        sizeBytes = sizeBytes,
        sizeFormatted = sizeFormatted,
        durationMs = durationMs,
        durationFormatted = durationFormatted,
        mimeType = mimeType,
        dateAddedSeconds = dateAddedSeconds,
        resolution = resolution,
        folderName = folderName,
        lastPositionMs = lastPositionMs,
        isUserPicked = true
    )

    companion object {
        fun fromDomain(file: LocalVideoFile): SavedLocalVideoEntity = SavedLocalVideoEntity(
            uri = file.uri,
            displayName = file.displayName,
            sizeBytes = file.sizeBytes,
            sizeFormatted = file.sizeFormatted,
            durationMs = file.durationMs,
            durationFormatted = file.durationFormatted,
            mimeType = file.mimeType,
            dateAddedSeconds = file.dateAddedSeconds,
            resolution = file.resolution,
            folderName = file.folderName,
            lastPositionMs = file.lastPositionMs
        )
    }
}
