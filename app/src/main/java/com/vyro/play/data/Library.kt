package com.vyro.play.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "videos")
data class SavedVideo(
    @PrimaryKey val id: String,
    val title: String,
    val channel: String,
    val thumbnail: String,
    val localUri: String = "",
    val favorite: Boolean = false,
    val lastWatched: Long = 0,
    val positionMs: Long = 0,
    val durationMs: Long = 0
)

@Entity(tableName = "searches") data class RecentSearch(@PrimaryKey val term: String, val at: Long)

@Dao interface LibraryDao {
    @Query("SELECT * FROM videos WHERE favorite = 1 ORDER BY title") fun favorites(): Flow<List<SavedVideo>>
    @Query("SELECT * FROM videos WHERE lastWatched > 0 ORDER BY lastWatched DESC") fun history(): Flow<List<SavedVideo>>
    @Query("SELECT * FROM videos WHERE localUri != '' ORDER BY title") fun locals(): Flow<List<SavedVideo>>
    @Query("SELECT * FROM searches ORDER BY at DESC LIMIT 15") fun searches(): Flow<List<RecentSearch>>
    @Query("SELECT * FROM videos WHERE id = :id LIMIT 1") suspend fun find(id: String): SavedVideo?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun save(video: SavedVideo)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveSearch(search: RecentSearch)
    @Query("DELETE FROM searches") suspend fun clearSearches()
    @Query("DELETE FROM searches WHERE term = :term") suspend fun removeSearch(term: String)
    @Query("UPDATE videos SET lastWatched = 0, positionMs = 0 WHERE id = :id") suspend fun removeHistory(id: String)
    @Query("UPDATE videos SET lastWatched = 0, positionMs = 0") suspend fun clearHistory()
    @Query("DELETE FROM videos WHERE id = :id") suspend fun delete(id: String)
    @Query("SELECT COUNT(*) FROM videos WHERE localUri != ''") fun localCount(): Flow<Int>
}

@Database(entities = [SavedVideo::class, RecentSearch::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() { abstract fun libraryDao(): LibraryDao }
