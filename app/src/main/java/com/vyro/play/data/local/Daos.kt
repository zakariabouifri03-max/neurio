package com.vyro.play.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface FavoriteDao {
    @Query("SELECT * FROM favorites ORDER BY addedAtEpochMs DESC")
    fun observeAll(): Flow<List<FavoriteVideoEntity>>

    @Query("SELECT id FROM favorites")
    fun observeFavoriteIds(): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FavoriteVideoEntity)

    @Query("DELETE FROM favorites WHERE id = :videoId")
    suspend fun deleteById(videoId: String)

    @Query("SELECT EXISTS(SELECT 1 FROM favorites WHERE id = :videoId)")
    suspend fun isFavorite(videoId: String): Boolean

    @Query("DELETE FROM favorites")
    suspend fun clearAll()
}

@Dao
interface WatchHistoryDao {
    @Query("SELECT * FROM watch_history ORDER BY watchedAtEpochMs DESC LIMIT 200")
    fun observeAll(): Flow<List<WatchHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: WatchHistoryEntity)

    @Query("UPDATE watch_history SET lastPositionSeconds = :positionSeconds, watchedAtEpochMs = :watchedAt WHERE id = :historyId")
    suspend fun updateProgress(historyId: String, positionSeconds: Long, watchedAt: Long)

    @Query("SELECT lastPositionSeconds FROM watch_history WHERE id = :historyId LIMIT 1")
    suspend fun getLastPositionSeconds(historyId: String): Long?

    @Query("DELETE FROM watch_history WHERE id = :historyId")
    suspend fun deleteById(historyId: String)

    @Query("DELETE FROM watch_history")
    suspend fun clearAll()
}

@Dao
interface SearchHistoryDao {
    @Query("SELECT * FROM search_history ORDER BY searchedAtEpochMs DESC LIMIT 30")
    fun observeRecent(): Flow<List<SearchHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SearchHistoryEntity)

    @Query("DELETE FROM search_history WHERE queryNormalized = :queryNormalized")
    suspend fun deleteByQuery(queryNormalized: String)

    @Query("DELETE FROM search_history")
    suspend fun clearAll()
}

@Dao
interface ApiCacheDao {
    @Query("SELECT * FROM api_cache WHERE cacheKey = :cacheKey LIMIT 1")
    suspend fun getByKey(cacheKey: String): ApiCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ApiCacheEntity)

    @Query("DELETE FROM api_cache WHERE cachedAtEpochMs < :minAllowedEpochMs")
    suspend fun deleteExpiredBefore(minAllowedEpochMs: Long)

    @Query("SELECT COUNT(*) FROM api_cache")
    fun observeCacheCount(): Flow<Int>

    @Query("DELETE FROM api_cache")
    suspend fun clearAll()
}

@Dao
interface SavedLocalVideoDao {
    @Query("SELECT * FROM saved_local_videos ORDER BY dateAddedSeconds DESC")
    fun observeAll(): Flow<List<SavedLocalVideoEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SavedLocalVideoEntity)

    @Query("UPDATE saved_local_videos SET lastPositionMs = :positionMs WHERE uri = :uri")
    suspend fun updatePosition(uri: String, positionMs: Long)

    @Query("DELETE FROM saved_local_videos WHERE uri = :uri")
    suspend fun deleteByUri(uri: String)

    @Query("DELETE FROM saved_local_videos")
    suspend fun clearAll()
}
