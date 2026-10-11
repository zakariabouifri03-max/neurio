package com.vyro.play.data.repository

import android.net.Uri
import com.vyro.play.BuildConfig
import com.vyro.play.data.local.ApiCacheEntity
import com.vyro.play.data.local.FavoriteVideoEntity
import com.vyro.play.data.local.SavedLocalVideoEntity
import com.vyro.play.data.local.SearchHistoryEntity
import com.vyro.play.data.local.VyroPlayDatabase
import com.vyro.play.data.local.WatchHistoryEntity
import com.vyro.play.data.localvideo.LocalVideoManager
import com.vyro.play.data.remote.YouTubeApiService
import com.vyro.play.data.remote.YouTubeMetadataParser
import com.vyro.play.model.ApiResult
import com.vyro.play.model.DiscoveryCategory
import com.vyro.play.model.LocalVideoFile
import com.vyro.play.model.QuotaCachePolicy
import com.vyro.play.model.SafeSearchMode
import com.vyro.play.model.SearchHistoryEntry
import com.vyro.play.model.WatchHistoryItem
import com.vyro.play.model.YouTubeVideo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class VyroRepository(
    private val database: VyroPlayDatabase,
    private val apiService: YouTubeApiService,
    private val localVideoManager: LocalVideoManager
) {
    private val favoriteDao = database.favoriteDao()
    private val watchHistoryDao = database.watchHistoryDao()
    private val searchHistoryDao = database.searchHistoryDao()
    private val apiCacheDao = database.apiCacheDao()
    private val savedLocalVideoDao = database.savedLocalVideoDao()

    val favoritesFlow: Flow<List<YouTubeVideo>> = favoriteDao.observeAll().map { list ->
        list.map { it.toDomain() }
    }

    val favoriteIdsFlow: Flow<Set<String>> = favoriteDao.observeFavoriteIds().map { it.toSet() }

    val watchHistoryFlow: Flow<List<WatchHistoryItem>> = watchHistoryDao.observeAll().map { list ->
        list.map { it.toDomain() }
    }

    val searchHistoryFlow: Flow<List<SearchHistoryEntry>> = searchHistoryDao.observeRecent().map { list ->
        list.map { it.toDomain() }
    }

    val cachedQueryCountFlow: Flow<Int> = apiCacheDao.observeCacheCount()

    val savedLocalVideosFlow: Flow<List<LocalVideoFile>> = savedLocalVideoDao.observeAll().map { list ->
        list.map { it.toDomain() }
    }

    fun resolveEffectiveApiKey(customApiKey: String): String {
        val fromSettings = customApiKey.trim()
        if (fromSettings.isNotEmpty()) return fromSettings
        return BuildConfig.YOUTUBE_API_KEY.trim()
    }

    suspend fun evictExpiredApiCache() {
        val minAllowed = System.currentTimeMillis() - QuotaCachePolicy.CACHE_TTL_MS
        runCatching { apiCacheDao.deleteExpiredBefore(minAllowed) }
    }

    /**
     * Searches YouTube Data API v3 with policy-compliant 15-minute response caching.
     */
    suspend fun searchVideos(
        query: String,
        customApiKey: String,
        safeSearch: SafeSearchMode,
        preferHighDef: Boolean = false,
        forceRefresh: Boolean = false,
        recordSearchHistory: Boolean = true
    ): ApiResult<List<YouTubeVideo>> {
        val cleanQuery = query.trim()
        if (cleanQuery.isEmpty()) {
            return ApiResult.Success(emptyList())
        }

        // Check if the query is actually a direct YouTube URL or 11-char Video ID
        val directVideoId = YouTubeMetadataParser.extractVideoId(cleanQuery)
        val effectiveKey = resolveEffectiveApiKey(customApiKey)
        if (directVideoId != null && (cleanQuery.contains("youtube.com") || cleanQuery.contains("youtu.be") || cleanQuery.length == 11)) {
            when (val single = apiService.fetchSingleVideoByUrlOrId(cleanQuery, effectiveKey)) {
                is ApiResult.Success -> {
                    if (recordSearchHistory) {
                        saveSearchQuery(cleanQuery, 1)
                    }
                    return ApiResult.Success(listOf(single.data), fromCache = false)
                }
                is ApiResult.Error -> {
                    if (effectiveKey.isEmpty()) return single
                }
            }
        }

        val now = System.currentTimeMillis()
        val cacheKey = QuotaCachePolicy.normalizeSearchCacheKey(cleanQuery, safeSearch, preferHighDef)

        if (!forceRefresh) {
            val cached = runCatching { apiCacheDao.getByKey(cacheKey) }.getOrNull()
            if (cached != null && !QuotaCachePolicy.isExpired(cached.cachedAtEpochMs, now)) {
                val decoded = runCatching {
                    YouTubeMetadataParser.deserializeVideoListFromJson(cached.responseJson)
                }.getOrDefault(emptyList())
                if (decoded.isNotEmpty()) {
                    if (recordSearchHistory) {
                        saveSearchQuery(cleanQuery, decoded.size)
                    }
                    return ApiResult.Success(decoded, fromCache = true)
                }
            }
        }

        return when (
            val networkResult = apiService.searchVideos(
                query = cleanQuery,
                apiKey = effectiveKey,
                safeSearch = safeSearch,
                preferHighDef = preferHighDef
            )
        ) {
            is ApiResult.Success -> {
                if (networkResult.data.isNotEmpty()) {
                    runCatching {
                        apiCacheDao.upsert(
                            ApiCacheEntity(
                                cacheKey = cacheKey,
                                responseJson = YouTubeMetadataParser.serializeVideoListToJson(networkResult.data),
                                cachedAtEpochMs = now
                            )
                        )
                    }
                }
                if (recordSearchHistory) {
                    saveSearchQuery(cleanQuery, networkResult.data.size)
                }
                networkResult
            }
            is ApiResult.Error -> {
                // If offline, serve non-expired cached result if available
                val cached = runCatching { apiCacheDao.getByKey(cacheKey) }.getOrNull()
                if (cached != null && !QuotaCachePolicy.isExpired(cached.cachedAtEpochMs, now)) {
                    val decoded = runCatching {
                        YouTubeMetadataParser.deserializeVideoListFromJson(cached.responseJson)
                    }.getOrDefault(emptyList())
                    if (decoded.isNotEmpty()) {
                        return ApiResult.Success(decoded, fromCache = true)
                    }
                }
                networkResult
            }
        }
    }

    /**
     * Loads discovery category videos using YouTube Data API v3 (`videos.list` mostPopular or `search.list`).
     */
    suspend fun loadCategoryVideos(
        category: DiscoveryCategory,
        customApiKey: String,
        regionCode: String,
        safeSearch: SafeSearchMode,
        forceRefresh: Boolean = false
    ): ApiResult<List<YouTubeVideo>> {
        val effectiveKey = resolveEffectiveApiKey(customApiKey)
        if (category == DiscoveryCategory.TRENDING || category.videoCategoryId != null && !category.preferHighDef) {
            val now = System.currentTimeMillis()
            val cacheKey = QuotaCachePolicy.normalizeTrendingCacheKey(regionCode, category.videoCategoryId)
            if (!forceRefresh) {
                val cached = runCatching { apiCacheDao.getByKey(cacheKey) }.getOrNull()
                if (cached != null && !QuotaCachePolicy.isExpired(cached.cachedAtEpochMs, now)) {
                    val decoded = runCatching {
                        YouTubeMetadataParser.deserializeVideoListFromJson(cached.responseJson)
                    }.getOrDefault(emptyList())
                    if (decoded.isNotEmpty()) {
                        return ApiResult.Success(decoded, fromCache = true)
                    }
                }
            }

            val popularResult = apiService.getPopularVideos(
                apiKey = effectiveKey,
                regionCode = regionCode,
                videoCategoryId = category.videoCategoryId
            )
            if (popularResult is ApiResult.Success && popularResult.data.isNotEmpty()) {
                runCatching {
                    apiCacheDao.upsert(
                        ApiCacheEntity(
                            cacheKey = cacheKey,
                            responseJson = YouTubeMetadataParser.serializeVideoListToJson(popularResult.data),
                            cachedAtEpochMs = now
                        )
                    )
                }
                return popularResult
            }
        }

        return searchVideos(
            query = category.defaultQuery,
            customApiKey = customApiKey,
            safeSearch = safeSearch,
            preferHighDef = category.preferHighDef,
            forceRefresh = forceRefresh,
            recordSearchHistory = false
        )
    }

    suspend fun resolveVideoFromUrlOrId(
        urlOrId: String,
        customApiKey: String
    ): ApiResult<YouTubeVideo> {
        val effectiveKey = resolveEffectiveApiKey(customApiKey)
        return apiService.fetchSingleVideoByUrlOrId(urlOrId, effectiveKey)
    }

    suspend fun validateApiKey(candidateKey: String): ApiResult<Boolean> {
        return apiService.validateApiKey(candidateKey)
    }

    // ---- Favorites ----

    suspend fun toggleFavorite(video: YouTubeVideo): Boolean {
        val exists = favoriteDao.isFavorite(video.id)
        return if (exists) {
            favoriteDao.deleteById(video.id)
            false
        } else {
            favoriteDao.upsert(FavoriteVideoEntity.fromDomain(video))
            true
        }
    }

    suspend fun removeFavorite(videoId: String) {
        favoriteDao.deleteById(videoId)
    }

    suspend fun clearAllFavorites() {
        favoriteDao.clearAll()
    }

    // ---- Watch History ----

    suspend fun recordYouTubeWatch(
        video: YouTubeVideo,
        positionSeconds: Long = 0L,
        pauseHistory: Boolean = false
    ) {
        if (pauseHistory) return
        val historyId = "yt:${video.id}"
        val existingPos = watchHistoryDao.getLastPositionSeconds(historyId) ?: 0L
        val effectivePos = if (positionSeconds > 0L) positionSeconds else existingPos

        watchHistoryDao.upsert(
            WatchHistoryEntity(
                id = historyId,
                videoId = video.id,
                title = video.title,
                channelOrFolder = video.channelTitle,
                thumbnailUrl = video.thumbnailMediumUrl.ifBlank { video.thumbnailHighUrl },
                durationFormatted = video.durationFormatted,
                durationSeconds = video.durationSeconds,
                lastPositionSeconds = effectivePos,
                watchedAtEpochMs = System.currentTimeMillis(),
                sourceType = "YOUTUBE",
                localUri = "",
                qualityBadge = video.qualityBadgeText
            )
        )
    }

    suspend fun updateYouTubeProgress(
        videoId: String,
        positionSeconds: Long,
        pauseHistory: Boolean = false
    ) {
        if (pauseHistory || positionSeconds <= 0L) return
        watchHistoryDao.updateProgress(
            historyId = "yt:$videoId",
            positionSeconds = positionSeconds,
            watchedAt = System.currentTimeMillis()
        )
    }

    suspend fun recordLocalVideoWatch(
        localVideo: LocalVideoFile,
        positionMs: Long = 0L,
        pauseHistory: Boolean = false
    ) {
        val posSec = (positionMs / 1000L).coerceAtLeast(0L)
        val durSec = (localVideo.durationMs / 1000L).coerceAtLeast(0L)
        if (!pauseHistory) {
            watchHistoryDao.upsert(
                WatchHistoryEntity(
                    id = "local:${localVideo.uri}",
                    videoId = "",
                    title = localVideo.displayName,
                    channelOrFolder = localVideo.folderName,
                    thumbnailUrl = localVideo.uri,
                    durationFormatted = localVideo.durationFormatted,
                    durationSeconds = durSec,
                    lastPositionSeconds = posSec,
                    watchedAtEpochMs = System.currentTimeMillis(),
                    sourceType = "LOCAL",
                    localUri = localVideo.uri,
                    qualityBadge = localVideo.resolution
                )
            )
        }
        savedLocalVideoDao.updatePosition(localVideo.uri, positionMs)
    }

    suspend fun deleteWatchHistoryItem(historyId: String) {
        watchHistoryDao.deleteById(historyId)
    }

    suspend fun clearWatchHistory() {
        watchHistoryDao.clearAll()
    }

    // ---- Search History ----

    private suspend fun saveSearchQuery(query: String, resultCount: Int) {
        val clean = query.trim()
        if (clean.isEmpty()) return
        searchHistoryDao.upsert(
            SearchHistoryEntity(
                queryNormalized = clean.lowercase(),
                displayQuery = clean,
                searchedAtEpochMs = System.currentTimeMillis(),
                resultCount = resultCount
            )
        )
    }

    suspend fun deleteSearchHistoryQuery(query: String) {
        searchHistoryDao.deleteByQuery(query.trim().lowercase())
    }

    suspend fun clearSearchHistory() {
        searchHistoryDao.clearAll()
    }

    // ---- API Cache ----

    suspend fun clearApiCache() {
        apiCacheDao.clearAll()
    }

    // ---- Local Device & SAF Videos ----

    suspend fun scanDeviceMediaStoreVideos(): List<LocalVideoFile> {
        return localVideoManager.scanDeviceVideos()
    }

    suspend fun importPickedVideoUris(uris: List<Uri>): List<LocalVideoFile> {
        val imported = mutableListOf<LocalVideoFile>()
        for (uri in uris) {
            val resolved = localVideoManager.resolvePickedVideoUri(uri)
            if (resolved != null) {
                savedLocalVideoDao.upsert(SavedLocalVideoEntity.fromDomain(resolved))
                imported.add(resolved)
            }
        }
        return imported
    }

    suspend fun removeSavedLocalVideo(uri: String) {
        savedLocalVideoDao.deleteByUri(uri)
    }
}
