package com.vyro.play.domain.usecase

import com.vyro.core.model.UserSettings
import com.vyro.core.model.Video
import com.vyro.core.model.WatchHistoryEntry
import com.vyro.play.domain.repository.FavoritesRepository
import com.vyro.play.domain.repository.HistoryRepository
import com.vyro.play.domain.repository.SettingsRepository
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * @return true when a YouTube Data API key is available, either compiled into the build
 * (from `local.properties`) or supplied by the user in Settings.
 */
@Singleton
class ApiKeyStatus
    @Inject
    constructor(
        private val settingsRepository: SettingsRepository,
        @Named("buildTimeApiKey") private val buildTimeApiKey: String,
    ) {
        suspend fun isConfigured(): Boolean {
            if (buildTimeApiKey.isNotBlank()) return true
            return settingsRepository.effectiveApiKey.first().isNotBlank()
        }

        suspend fun resolvedKey(): String {
            val override = settingsRepository.effectiveApiKey.first()
            return override.ifBlank { buildTimeApiKey }
        }
    }

/** Adds or removes a favorite and reports the resulting state. */
@Singleton
class ToggleFavoriteUseCase
    @Inject
    constructor(
        private val favoritesRepository: FavoritesRepository,
    ) {
        suspend operator fun invoke(video: Video): Boolean = favoritesRepository.toggle(video)
    }

/**
 * Records (or refreshes) a watch-history entry and trims the table to the user's limit.
 */
@Singleton
class RecordWatchUseCase
    @Inject
    constructor(
        private val historyRepository: HistoryRepository,
        private val settingsRepository: SettingsRepository,
    ) {
        suspend operator fun invoke(entry: WatchHistoryEntry) {
            historyRepository.record(entry)
            val settings: UserSettings = settingsRepository.settings.first()
            historyRepository.trimTo(settings.maxHistoryEntries)
        }
    }

/** Removes a single history entry. */
@Singleton
class RemoveFromHistoryUseCase
    @Inject
    constructor(
        private val historyRepository: HistoryRepository,
    ) {
        suspend operator fun invoke(videoId: String) = historyRepository.remove(videoId)
    }
