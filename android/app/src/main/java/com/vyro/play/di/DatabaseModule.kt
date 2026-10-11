package com.vyro.play.di

import android.content.Context
import androidx.room.Room
import com.vyro.play.data.local.FavoriteDao
import com.vyro.play.data.local.HistoryDao
import com.vyro.play.data.local.SearchQueryDao
import com.vyro.play.data.local.VyroDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context,
    ): VyroDatabase =
        Room.databaseBuilder(context, VyroDatabase::class.java, VyroDatabase.NAME)
            // Destructive migration is acceptable while the schema is at version 1;
            // the data is a local cache of favorites/history that can be rebuilt.
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun provideFavoriteDao(db: VyroDatabase): FavoriteDao = db.favoriteDao()

    @Provides
    fun provideHistoryDao(db: VyroDatabase): HistoryDao = db.historyDao()

    @Provides
    fun provideSearchQueryDao(db: VyroDatabase): SearchQueryDao = db.searchQueryDao()
}
