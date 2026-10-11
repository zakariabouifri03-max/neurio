package com.vyro.play.data.repository

import com.vyro.core.domain.WatchHistoryPolicy
import com.vyro.core.model.WatchHistoryEntry
import com.vyro.play.data.local.HistoryDao
import com.vyro.play.data.local.HistoryEntity
import com.vyro.play.domain.repository.HistoryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class HistoryRepositoryImpl
    @Inject
    constructor(
        private val dao: HistoryDao,
    ) : HistoryRepository {
        override fun observe(): Flow<List<WatchHistoryEntry>> =
            dao.observeAll().map { entities -> entities.map { it.toDomain() } }

        override suspend fun record(entry: WatchHistoryEntry) {
            withContext(Dispatchers.IO) {
                val existing = dao.find(entry.videoId)
                val merged =
                    if (existing == null) {
                        entry
                    } else {
                        entry.copy(
                            watchCount = existing.watchCount + 1,
                            progressMillis =
                                if (entry.progressMillis > 0L) entry.progressMillis else existing.progressMillis,
                        )
                    }
                dao.upsert(merged.toEntity())
            }
        }

        override suspend fun find(videoId: String): WatchHistoryEntry? =
            withContext(Dispatchers.IO) { dao.find(videoId)?.toDomain() }

        override suspend fun remove(videoId: String) {
            withContext(Dispatchers.IO) { dao.delete(videoId) }
        }

        override suspend fun clear() {
            withContext(Dispatchers.IO) { dao.clear() }
        }

        override suspend fun trimTo(limit: Int) {
            withContext(Dispatchers.IO) { dao.keepNewest(limit) }
        }
    }

internal fun WatchHistoryEntry.toEntity(): HistoryEntity =
    HistoryEntity(
        videoId = videoId,
        title = title,
        channelTitle = channelTitle,
        thumbnailUrl = thumbnailUrl,
        durationMillis = durationMillis,
        lastWatchedMillis = lastWatchedMillis,
        watchCount = watchCount.coerceAtLeast(1),
        progressMillis = progressMillis.coerceAtLeast(0L),
    )

internal fun HistoryEntity.toDomain(): WatchHistoryEntry =
    WatchHistoryEntry(
        videoId = videoId,
        title = title,
        channelTitle = channelTitle,
        thumbnailUrl = thumbnailUrl,
        durationMillis = durationMillis,
        lastWatchedMillis = lastWatchedMillis,
        watchCount = watchCount,
        progressMillis = progressMillis,
    )

/** Exposed so the player can reuse the same merge rules before upserting. */
internal fun WatchHistoryEntry.mergedWith(previous: WatchHistoryEntry?): WatchHistoryEntry =
    if (previous == null) {
        this
    } else {
        copy(
            watchCount = previous.watchCount + 1,
            progressMillis = if (progressMillis > 0L) progressMillis else previous.progressMillis,
        )
    }

/** Fraction of the video the user has watched, 0f..1f. */
fun WatchHistoryEntry.progress(): Float = WatchHistoryPolicy.progressFraction(this)
