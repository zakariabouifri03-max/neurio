package com.vyro.play.domain.repository

import com.vyro.core.model.LocalVideo
import com.vyro.core.model.NetworkClass
import com.vyro.core.model.Outcome
import com.vyro.core.model.SearchQuery
import com.vyro.core.model.UserSettings
import com.vyro.core.model.Video
import com.vyro.core.model.VideoPage
import com.vyro.core.model.WatchHistoryEntry
import kotlinx.coroutines.flow.Flow

/** Read access to the YouTube Data API v3. All methods are main-safe. */
interface VideoRepository {
    /** `videos?chart=mostPopular` for the given region. */
    suspend fun trending(
        pageToken: String? = null,
        maxResults: Int = 24,
        regionCode: String? = null,
    ): Outcome<VideoPage>

    /** `search?type=video`. */
    suspend fun search(
        query: String,
        pageToken: String? = null,
        maxResults: Int = 24,
        regionCode: String? = null,
    ): Outcome<VideoPage>

    /** `videos?id=...` — used to enrich search hits with duration and statistics. */
    suspend fun details(videoIds: List<String>): Outcome<List<Video>>

    /** Videos related to [videoId] (same query, excluding the video itself). */
    suspend fun related(
        videoId: String,
        title: String,
        pageToken: String? = null,
    ): Outcome<VideoPage>
}

interface FavoritesRepository {
    fun observeAll(): Flow<List<Video>>

    /** Cheap set of ids used to tint the heart icon without diffing whole objects. */
    fun observeIds(): Flow<Set<String>>

    suspend fun add(video: Video)

    suspend fun remove(videoId: String)

    /** @return true when the video is now a favorite. */
    suspend fun toggle(video: Video): Boolean

    suspend fun isFavorite(videoId: String): Boolean

    suspend fun clear()
}

interface HistoryRepository {
    fun observe(): Flow<List<WatchHistoryEntry>>

    suspend fun record(entry: WatchHistoryEntry)

    /** Single lookup used to resume playback where the user left off. */
    suspend fun find(videoId: String): WatchHistoryEntry?

    suspend fun remove(videoId: String)

    suspend fun clear()

    suspend fun trimTo(limit: Int)
}

interface SearchHistoryRepository {
    fun observe(): Flow<List<SearchQuery>>

    suspend fun record(query: String)

    suspend fun remove(query: SearchQuery)

    suspend fun clear()
}

interface SettingsRepository {
    val settings: Flow<UserSettings>

    /** Resolved key: a user supplied override wins over the build-time key. */
    val effectiveApiKey: Flow<String>

    suspend fun update(transform: (UserSettings) -> UserSettings)

    suspend fun setApiKeyOverride(key: String)

    suspend fun clearApiKeyOverride()
}

interface LocalMediaRepository {
    /** Queries MediaStore for video files owned by the user. */
    suspend fun scan(): List<LocalVideo>
}

interface ConnectivityRepository {
    val networkClass: Flow<NetworkClass>

    fun current(): NetworkClass
}
