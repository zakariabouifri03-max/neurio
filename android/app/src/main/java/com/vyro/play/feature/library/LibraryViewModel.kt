package com.vyro.play.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vyro.core.domain.WatchHistoryPolicy
import com.vyro.core.model.HistorySort
import com.vyro.core.model.LocalVideo
import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.UserSettings
import com.vyro.core.model.Video
import com.vyro.core.model.WatchHistoryEntry
import com.vyro.play.domain.repository.FavoritesRepository
import com.vyro.play.domain.repository.HistoryRepository
import com.vyro.play.domain.repository.LocalMediaRepository
import com.vyro.play.domain.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class LibraryTab(val label: String) {
    FAVORITES("Favorites"),
    HISTORY("History"),
    OFFLINE("Offline"),
    LOCAL("My videos"),
}

data class LibraryUiState(
    val favorites: List<Video> = emptyList(),
    val history: List<WatchHistoryEntry> = emptyList(),
    val localVideos: List<LocalVideo> = emptyList(),
    val favoriteIds: Set<String> = emptySet(),
    val historySort: HistorySort = HistorySort.RECENT,
    val thumbnailQuality: ThumbnailQuality = ThumbnailQuality.MEDIUM,
    val isScanning: Boolean = false,
    val hasScanned: Boolean = false,
)

@HiltViewModel
class LibraryViewModel
    @Inject
    constructor(
        private val favoritesRepository: FavoritesRepository,
        private val historyRepository: HistoryRepository,
        private val localMediaRepository: LocalMediaRepository,
        settingsRepository: SettingsRepository,
    ) : ViewModel() {

        private val localVideos = MutableStateFlow<List<LocalVideo>>(emptyList())
        private val isScanning = MutableStateFlow(false)
        private val hasScanned = MutableStateFlow(false)
        private val historySort = MutableStateFlow(HistorySort.RECENT)

        /** Local-file scanning flags, folded so [uiState] stays within five flows. */
        private data class LocalState(
            val videos: List<LocalVideo> = emptyList(),
            val isScanning: Boolean = false,
            val hasScanned: Boolean = false,
        )

        private val localState: StateFlow<LocalState> =
            combine(localVideos, isScanning, hasScanned) { videos, scanning, scanned ->
                LocalState(videos = videos, isScanning = scanning, hasScanned = scanned)
            }.stateIn(viewModelScope, SharingStarted.Eagerly, LocalState())

        val uiState: StateFlow<LibraryUiState> =
            combine(
                favoritesRepository.observeAll(),
                historyRepository.observe(),
                favoritesRepository.observeIds(),
                localState,
            ) { favorites, history, favoriteIds, local ->
                LibraryUiState(
                    favorites = favorites,
                    history = history,
                    favoriteIds = favoriteIds,
                    localVideos = local.videos,
                    isScanning = local.isScanning,
                    hasScanned = local.hasScanned,
                )
            }.withSortAndSettings(historySort, settingsRepository.settings)
                .stateIn(
                    scope = viewModelScope,
                    started = SharingStarted.WhileSubscribed(5_000),
                    initialValue = LibraryUiState(),
                )

        fun scanLocalVideos() {
            if (isScanning.value) return
            viewModelScope.launch {
                isScanning.value = true
                localVideos.value = localMediaRepository.scan()
                hasScanned.value = true
                isScanning.value = false
            }
        }

        fun setHistorySort(sort: HistorySort) {
            historySort.value = sort
        }

        fun removeFromHistory(videoId: String) {
            viewModelScope.launch { historyRepository.remove(videoId) }
        }

        fun clearHistory() {
            viewModelScope.launch { historyRepository.clear() }
        }

        fun removeFavorite(videoId: String) {
            viewModelScope.launch { favoritesRepository.remove(videoId) }
        }

        fun clearFavorites() {
            viewModelScope.launch { favoritesRepository.clear() }
        }
}

/**
 * Applies the current sort order and merges user settings into the state without
 * exceeding the five-flow limit of [combine].
 */
private fun Flow<LibraryUiState>.withSortAndSettings(
    sort: Flow<HistorySort>,
    settings: Flow<UserSettings>,
): Flow<LibraryUiState> =
    combine(this, sort, settings) { state, historySort, userSettings ->
        state.copy(
            history = WatchHistoryPolicy.sorted(state.history, historySort),
            historySort = historySort,
            thumbnailQuality = userSettings.thumbnailQuality,
        )
    }
