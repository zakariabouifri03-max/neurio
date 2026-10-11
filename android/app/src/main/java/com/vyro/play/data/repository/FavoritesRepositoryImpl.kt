package com.vyro.play.data.repository

import com.vyro.core.model.Video
import com.vyro.play.data.local.FavoriteEntity
import com.vyro.play.data.local.FavoriteDao
import com.vyro.play.domain.repository.FavoritesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FavoritesRepositoryImpl
    @Inject
    constructor(
        private val dao: FavoriteDao,
    ) : FavoritesRepository {
        override fun observeAll(): Flow<List<Video>> =
            dao.observeAll().map { entities -> entities.map { it.toDomain() } }

        override fun observeIds(): Flow<Set<String>> =
            dao.observeIds().map { ids -> ids.toSet() }

        override suspend fun add(video: Video) {
            withContext(Dispatchers.IO) { dao.upsert(video.toEntity()) }
        }

        override suspend fun remove(videoId: String) {
            withContext(Dispatchers.IO) { dao.delete(videoId) }
        }

        override suspend fun toggle(video: Video): Boolean =
            withContext(Dispatchers.IO) {
                if (dao.exists(video.id)) {
                    dao.delete(video.id)
                    false
                } else {
                    dao.upsert(video.toEntity())
                    true
                }
            }

        override suspend fun isFavorite(videoId: String): Boolean =
            withContext(Dispatchers.IO) { dao.exists(videoId) }

        override suspend fun clear() {
            withContext(Dispatchers.IO) { dao.clear() }
        }
    }

/**
 * Persists a single, already-resolved thumbnail URL rather than the whole
 * [com.vyro.core.model.Thumbnails] set: the row is re-rendered from the same URL the
 * user last saw, and the quality preference is re-applied through Coil when needed.
 */
internal fun thumbnailUrlFor(video: Video): String =
    com.vyro.core.util.ThumbnailUrls.pick(
        video.thumbnails,
        com.vyro.core.model.ThumbnailQuality.HIGH,
    ).ifBlank { com.vyro.core.util.ThumbnailUrls.hqDefault(video.id) }

internal fun Video.toEntity(): FavoriteEntity =
    FavoriteEntity(
        videoId = id,
        title = title,
        description = description,
        channelId = channelId,
        channelTitle = channelTitle,
        publishedAtMillis = publishedAtMillis,
        thumbnailUrl = thumbnailUrlFor(this),
        durationMillis = durationMillis,
        viewCount = viewCount,
        isLive = isLive,
        addedAtMillis = System.currentTimeMillis(),
    )

internal fun FavoriteEntity.toDomain(): Video =
    Video(
        id = videoId,
        title = title,
        description = description,
        channelId = channelId,
        channelTitle = channelTitle,
        publishedAtMillis = publishedAtMillis,
        publishedAtRaw = "",
        thumbnails =
            com.vyro.core.model.Thumbnails(
                defaultUrl = thumbnailUrl,
                mediumUrl = thumbnailUrl,
                highUrl = thumbnailUrl,
                standardUrl = null,
                maxResUrl = null,
            ),
        durationMillis = durationMillis,
        viewCount = viewCount,
        likeCount = 0L,
        commentCount = 0L,
        isLive = isLive,
        detailsResolved = durationMillis > 0L,
    )
