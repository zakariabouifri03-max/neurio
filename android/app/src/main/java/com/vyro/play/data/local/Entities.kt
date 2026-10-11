package com.vyro.play.data.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Local persistence models.
 *
 * Only primitive columns are stored: every timestamp is epoch millis and every rich
 * object is flattened at write time, which keeps the schema trivially migratable and
 * avoids shipping a type converter.
 */

@Entity(
    tableName = "favorites",
    indices = [Index(value = ["added_at"], name = "idx_favorites_added_at")],
)
data class FavoriteEntity(
    @PrimaryKey
    @ColumnInfo(name = "video_id")
    val videoId: String,
    @ColumnInfo(name = "title")
    val title: String,
    @ColumnInfo(name = "description")
    val description: String,
    @ColumnInfo(name = "channel_id")
    val channelId: String,
    @ColumnInfo(name = "channel_title")
    val channelTitle: String,
    @ColumnInfo(name = "published_at")
    val publishedAtMillis: Long,
    @ColumnInfo(name = "thumbnail_url")
    val thumbnailUrl: String,
    @ColumnInfo(name = "duration_millis")
    val durationMillis: Long,
    @ColumnInfo(name = "view_count")
    val viewCount: Long,
    @ColumnInfo(name = "is_live")
    val isLive: Boolean,
    @ColumnInfo(name = "added_at")
    val addedAtMillis: Long,
)

@Entity(
    tableName = "watch_history",
    indices = [Index(value = ["last_watched_at"], name = "idx_history_last_watched")],
)
data class HistoryEntity(
    @PrimaryKey
    @ColumnInfo(name = "video_id")
    val videoId: String,
    @ColumnInfo(name = "title")
    val title: String,
    @ColumnInfo(name = "channel_title")
    val channelTitle: String,
    @ColumnInfo(name = "thumbnail_url")
    val thumbnailUrl: String,
    @ColumnInfo(name = "duration_millis")
    val durationMillis: Long,
    @ColumnInfo(name = "last_watched_at")
    val lastWatchedMillis: Long,
    @ColumnInfo(name = "watch_count")
    val watchCount: Int,
    @ColumnInfo(name = "progress_millis")
    val progressMillis: Long,
)

@Entity(
    tableName = "search_history",
    indices = [Index(value = ["updated_at"], name = "idx_search_updated_at")],
)
data class SearchQueryEntity(
    @PrimaryKey
    @ColumnInfo(name = "query")
    val text: String,
    @ColumnInfo(name = "updated_at")
    val updatedAtMillis: Long,
    @ColumnInfo(name = "use_count")
    val useCount: Int,
)
