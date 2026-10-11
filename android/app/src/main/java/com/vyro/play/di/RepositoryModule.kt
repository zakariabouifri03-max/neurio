package com.vyro.play.di

import com.vyro.play.data.repository.FavoritesRepositoryImpl
import com.vyro.play.data.repository.HistoryRepositoryImpl
import com.vyro.play.data.repository.SearchHistoryRepositoryImpl
import com.vyro.play.data.repository.SettingsRepositoryImpl
import com.vyro.play.data.repository.VideoRepositoryImpl
import com.vyro.play.domain.repository.FavoritesRepository
import com.vyro.play.domain.repository.HistoryRepository
import com.vyro.play.domain.repository.LocalMediaRepository
import com.vyro.play.domain.repository.SearchHistoryRepository
import com.vyro.play.domain.repository.SettingsRepository
import com.vyro.play.domain.repository.VideoRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds
    @Singleton
    abstract fun bindVideoRepository(impl: VideoRepositoryImpl): VideoRepository

    @Binds
    @Singleton
    abstract fun bindFavoritesRepository(impl: FavoritesRepositoryImpl): FavoritesRepository

    @Binds
    @Singleton
    abstract fun bindHistoryRepository(impl: HistoryRepositoryImpl): HistoryRepository

    @Binds
    @Singleton
    abstract fun bindSearchHistoryRepository(impl: SearchHistoryRepositoryImpl): SearchHistoryRepository

    @Binds
    @Singleton
    abstract fun bindSettingsRepository(impl: SettingsRepositoryImpl): SettingsRepository

    @Binds
    @Singleton
    abstract fun bindLocalMediaRepository(impl: com.vyro.play.data.repository.LocalMediaRepositoryImpl): LocalMediaRepository
}
