package com.vyro.play.data.local

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface FavoriteDao {
    @Query("SELECT * FROM favorites ORDER BY added_at DESC")
    fun observeAll(): Flow<List<FavoriteEntity>>

    @Query("SELECT video_id FROM favorites")
    fun observeIds(): Flow<List<String>>

    @Query("SELECT EXISTS(SELECT 1 FROM favorites WHERE video_id = :videoId)")
    suspend fun exists(videoId: String): Boolean

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FavoriteEntity)

    @Query("DELETE FROM favorites WHERE video_id = :videoId")
    suspend fun delete(videoId: String)

    @Query("DELETE FROM favorites")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM favorites")
    suspend fun count(): Int
}

@Dao
interface HistoryDao {
    @Query("SELECT * FROM watch_history ORDER BY last_watched_at DESC")
    fun observeAll(): Flow<List<HistoryEntity>>

    @Query("SELECT * FROM watch_history WHERE video_id = :videoId LIMIT 1")
    suspend fun find(videoId: String): HistoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: HistoryEntity)

    @Query("DELETE FROM watch_history WHERE video_id = :videoId")
    suspend fun delete(videoId: String)

    @Query("DELETE FROM watch_history")
    suspend fun clear()

    /** Keeps only the newest [limit] rows so the file never grows without bound. */
    @Query(
        """
        DELETE FROM watch_history
        WHERE video_id NOT IN (
            SELECT video_id FROM watch_history
            ORDER BY last_watched_at DESC
            LIMIT :limit
        )
        """,
    )
    suspend fun keepNewest(limit: Int)

    @Query("SELECT COUNT(*) FROM watch_history")
    suspend fun count(): Int
}

@Dao
interface SearchQueryDao {
    @Query("SELECT * FROM search_history ORDER BY updated_at DESC")
    fun observeAll(): Flow<List<SearchQueryEntity>>

    @Query("SELECT * FROM search_history WHERE query = :text LIMIT 1")
    suspend fun find(text: String): SearchQueryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SearchQueryEntity)

    @Update
    suspend fun update(entity: SearchQueryEntity)

    @Query("DELETE FROM search_history WHERE query = :text")
    suspend fun delete(text: String)

    @Query("DELETE FROM search_history")
    suspend fun clear()

    @Transaction
    suspend fun record(
        entity: SearchQueryEntity,
        limit: Int,
    ) {
        val existing = find(entity.text)
        if (existing == null) {
            upsert(entity)
        } else {
            update(
                existing.copy(
                    updatedAtMillis = entity.updatedAtMillis,
                    useCount = existing.useCount + 1,
                ),
            )
        }
        keepNewest(limit)
    }

    @Query(
        """
        DELETE FROM search_history
        WHERE query NOT IN (
            SELECT query FROM search_history
            ORDER BY updated_at DESC
            LIMIT :limit
        )
        """,
    )
    suspend fun keepNewest(limit: Int)
}

@Database(
    entities = [
        FavoriteEntity::class,
        HistoryEntity::class,
        SearchQueryEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class VyroDatabase : RoomDatabase() {
    abstract fun favoriteDao(): FavoriteDao

    abstract fun historyDao(): HistoryDao

    abstract fun searchQueryDao(): SearchQueryDao

    companion object {
        const val NAME = "vyro-play.db"
    }
}
