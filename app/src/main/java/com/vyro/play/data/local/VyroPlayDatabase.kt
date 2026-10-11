package com.vyro.play.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        FavoriteVideoEntity::class,
        WatchHistoryEntity::class,
        SearchHistoryEntity::class,
        ApiCacheEntity::class,
        SavedLocalVideoEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class VyroPlayDatabase : RoomDatabase() {
    abstract fun favoriteDao(): FavoriteDao
    abstract fun watchHistoryDao(): WatchHistoryDao
    abstract fun searchHistoryDao(): SearchHistoryDao
    abstract fun apiCacheDao(): ApiCacheDao
    abstract fun savedLocalVideoDao(): SavedLocalVideoDao

    companion object {
        @Volatile
        private var INSTANCE: VyroPlayDatabase? = null

        fun getInstance(context: Context): VyroPlayDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    VyroPlayDatabase::class.java,
                    "vyro_play_db"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
