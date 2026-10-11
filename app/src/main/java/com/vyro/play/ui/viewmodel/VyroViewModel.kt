package com.vyro.play.ui.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.vyro.play.BuildConfig
import com.vyro.play.data.preferences.SettingsDataStore
import com.vyro.play.data.repository.VyroRepository
import com.vyro.play.model.ApiErrorCode
import com.vyro.play.model.ApiResult
import com.vyro.play.model.AppSettings
import com.vyro.play.model.DiscoveryCategory
import com.vyro.play.model.LocalVideoFile
import com.vyro.play.model.NetworkState
import com.vyro.play.model.SafeSearchMode
import com.vyro.play.model.SearchHistoryEntry
import com.vyro.play.model.ThemeMode
import com.vyro.play.model.VideoQualityOption
import com.vyro.play.model.WatchHistoryItem
import com.vyro.play.model.WatchSourceType
import com.vyro.play.model.YouTubeVideo
import com.vyro.play.network.NetworkMonitor
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class VyroUiState(
    val searchQuery: String = "",
    val activeCategory: DiscoveryCategory = DiscoveryCategory.TRENDING,
    val videos: List<YouTubeVideo> = emptyList(),
    val isLoading: Boolean = false,
    val isFromCache: Boolean = false,
    val errorMessage: String? = null,
    val errorCode: ApiErrorCode? = null,
    val activeYouTubeVideo: YouTubeVideo? = null,
    val activeYouTubeStartSeconds: Long = 0L,
    val activeLocalVideo: LocalVideoFile? = null,
    val isFullscreen: Boolean = false,
    val deviceLocalVideos: List<LocalVideoFile> = emptyList(),
    val isScanningLocalVideos: Boolean = false,
    val hasMediaVideoPermission: Boolean = false,
    val apiKeyValidationMessage: String? = null,
    val isValidatingApiKey: Boolean = false,
    val statusBannerMessage: String? = null
) {
    val hasActivePlayer: Boolean
        get() = activeYouTubeVideo != null || activeLocalVideo != null
}

class VyroViewModel(
    private val repository: VyroRepository,
    private val settingsStore: SettingsDataStore,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    private val _uiState = MutableStateFlow(VyroUiState())
    val uiState: StateFlow<VyroUiState> = _uiState.asStateFlow()

    val settingsState: StateFlow<AppSettings> = settingsStore.settingsFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AppSettings())

    val favoritesState: StateFlow<List<YouTubeVideo>> = repository.favoritesFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val favoriteIdsState: StateFlow<Set<String>> = repository.favoriteIdsFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val watchHistoryState: StateFlow<List<WatchHistoryItem>> = repository.watchHistoryFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val searchHistoryState: StateFlow<List<SearchHistoryEntry>> = repository.searchHistoryFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val savedLocalVideosState: StateFlow<List<LocalVideoFile>> = repository.savedLocalVideosFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val cachedQueryCountState: StateFlow<Int> = repository.cachedQueryCountFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    val networkState: StateFlow<NetworkState> = networkMonitor.networkStateFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), NetworkState())

    private var activeFetchJob: Job? = null
    private var lastSavedProgressSec: Long = -1L

    init {
        viewModelScope.launch {
            repository.evictExpiredApiCache()
            val initialSettings = settingsStore.settingsFlow.first()
            val effectiveKey = repository.resolveEffectiveApiKey(initialSettings.customApiKey)
            if (effectiveKey.isNotEmpty()) {
                selectCategory(DiscoveryCategory.TRENDING, forceRefresh = false)
            } else {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorCode = ApiErrorCode.MISSING_API_KEY,
                        errorMessage = "Configure your YouTube Data API v3 Key in Settings (or local.properties) to search live YouTube videos, or tap 'Play URL / ID' to play any YouTube video immediately."
                    )
                }
            }
        }
    }

    fun hasConfiguredApiKey(customKey: String = settingsState.value.customApiKey): Boolean {
        return repository.resolveEffectiveApiKey(customKey).isNotEmpty()
    }

    fun updateSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun executeSearch(query: String = _uiState.value.searchQuery, forceRefresh: Boolean = false) {
        val clean = query.trim()
        if (clean.isEmpty()) return
        _uiState.update {
            it.copy(
                searchQuery = clean,
                isLoading = true,
                errorMessage = null,
                errorCode = null
            )
        }
        activeFetchJob?.cancel()
        activeFetchJob = viewModelScope.launch {
            val currentSettings = settingsState.value
            val result = repository.searchVideos(
                query = clean,
                customApiKey = currentSettings.customApiKey,
                safeSearch = currentSettings.safeSearchMode,
                preferHighDef = currentSettings.preferredQuality == VideoQualityOption.UHD_4K,
                forceRefresh = forceRefresh,
                recordSearchHistory = true
            )
            applyVideoListResult(result)
        }
    }

    fun selectCategory(category: DiscoveryCategory, forceRefresh: Boolean = false) {
        _uiState.update {
            it.copy(
                activeCategory = category,
                isLoading = true,
                errorMessage = null,
                errorCode = null
            )
        }
        activeFetchJob?.cancel()
        activeFetchJob = viewModelScope.launch {
            val currentSettings = settingsState.value
            val result = repository.loadCategoryVideos(
                category = category,
                customApiKey = currentSettings.customApiKey,
                regionCode = currentSettings.regionCode,
                safeSearch = currentSettings.safeSearchMode,
                forceRefresh = forceRefresh
            )
            applyVideoListResult(result)
        }
    }

    fun refreshCurrentFeed() {
        val q = _uiState.value.searchQuery.trim()
        if (q.isNotEmpty()) {
            executeSearch(q, forceRefresh = true)
        } else {
            selectCategory(_uiState.value.activeCategory, forceRefresh = true)
        }
    }

    private fun applyVideoListResult(result: ApiResult<List<YouTubeVideo>>) {
        when (result) {
            is ApiResult.Success -> {
                _uiState.update {
                    it.copy(
                        videos = result.data,
                        isLoading = false,
                        isFromCache = result.fromCache,
                        errorMessage = if (result.data.isEmpty()) "No videos matched your search. Try another query or category." else null,
                        errorCode = null
                    )
                }
            }
            is ApiResult.Error -> {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isFromCache = false,
                        errorMessage = result.message,
                        errorCode = result.errorCode
                    )
                }
            }
        }
    }

    // ---- Playback Control ----

    fun playYouTubeVideo(video: YouTubeVideo, startSeconds: Long = 0L) {
        lastSavedProgressSec = -1L
        _uiState.update {
            it.copy(
                activeYouTubeVideo = video,
                activeYouTubeStartSeconds = startSeconds,
                activeLocalVideo = null
            )
        }
        viewModelScope.launch {
            repository.recordYouTubeWatch(
                video = video,
                positionSeconds = startSeconds,
                pauseHistory = settingsState.value.pauseWatchHistory
            )
        }
    }

    fun playYouTubeByUrlOrId(urlOrId: String) {
        val clean = urlOrId.trim()
        if (clean.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(statusBannerMessage = "Resolving YouTube video...") }
            when (val res = repository.resolveVideoFromUrlOrId(clean, settingsState.value.customApiKey)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(statusBannerMessage = null) }
                    playYouTubeVideo(res.data, 0L)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(statusBannerMessage = res.message) }
                }
            }
        }
    }

    fun onYouTubePlaybackProgress(currentSeconds: Long, durationSeconds: Long) {
        val active = _uiState.value.activeYouTubeVideo ?: return
        if (currentSeconds - lastSavedProgressSec >= 5L || (currentSeconds > 0L && lastSavedProgressSec < 0L)) {
            lastSavedProgressSec = currentSeconds
            viewModelScope.launch {
                val updatedVideo = if (durationSeconds > 0L && active.durationSeconds == 0L) {
                    active.copy(durationSeconds = durationSeconds)
                } else {
                    active
                }
                repository.recordYouTubeWatch(
                    video = updatedVideo,
                    positionSeconds = currentSeconds,
                    pauseHistory = settingsState.value.pauseWatchHistory
                )
            }
        }
    }

    fun playLocalVideo(localVideo: LocalVideoFile) {
        _uiState.update {
            it.copy(
                activeLocalVideo = localVideo,
                activeYouTubeVideo = null
            )
        }
        viewModelScope.launch {
            repository.recordLocalVideoWatch(
                localVideo = localVideo,
                positionMs = localVideo.lastPositionMs,
                pauseHistory = settingsState.value.pauseWatchHistory
            )
        }
    }

    fun onLocalVideoProgress(positionMs: Long, durationMs: Long) {
        val active = _uiState.value.activeLocalVideo ?: return
        viewModelScope.launch {
            val updated = if (durationMs > 0L && active.durationMs == 0L) {
                active.copy(durationMs = durationMs, lastPositionMs = positionMs)
            } else {
                active.copy(lastPositionMs = positionMs)
            }
            repository.recordLocalVideoWatch(
                localVideo = updated,
                positionMs = positionMs,
                pauseHistory = settingsState.value.pauseWatchHistory
            )
        }
    }

    fun resumeFromWatchHistory(item: WatchHistoryItem) {
        if (item.sourceType == WatchSourceType.LOCAL && item.localUri.isNotBlank()) {
            val saved = savedLocalVideosState.value.firstOrNull { it.uri == item.localUri }
                ?: _uiState.value.deviceLocalVideos.firstOrNull { it.uri == item.localUri }
                ?: LocalVideoFile(
                    uri = item.localUri,
                    displayName = item.title,
                    sizeBytes = 0L,
                    sizeFormatted = "Local File",
                    durationMs = item.durationSeconds * 1000L,
                    durationFormatted = item.durationFormatted,
                    mimeType = "video/*",
                    dateAddedSeconds = item.watchedAtEpochMs / 1000L,
                    resolution = item.qualityBadge,
                    folderName = item.channelOrFolder,
                    lastPositionMs = item.lastPositionSeconds * 1000L
                )
            playLocalVideo(saved.copy(lastPositionMs = item.lastPositionSeconds * 1000L))
        } else {
            val videoId = item.id.removePrefix("yt:")
            val existing = _uiState.value.videos.firstOrNull { it.id == videoId }
                ?: favoritesState.value.firstOrNull { it.id == videoId }
                ?: YouTubeVideo(
                    id = videoId,
                    title = item.title,
                    description = "",
                    channelId = "",
                    channelTitle = item.channelOrFolder,
                    publishedAt = "",
                    publishedRelative = "",
                    thumbnailMediumUrl = item.thumbnailUrl,
                    thumbnailHighUrl = item.thumbnailUrl,
                    thumbnailMaxResUrl = item.thumbnailUrl,
                    durationIso = "PT0S",
                    durationFormatted = item.durationFormatted,
                    durationSeconds = item.durationSeconds,
                    viewCount = 0L,
                    viewCountFormatted = "",
                    likeCount = 0L,
                    likeCountFormatted = "",
                    definition = "hd",
                    supports4KHint = item.qualityBadge.contains("4K"),
                    hasCaptions = true
                )
            playYouTubeVideo(existing, startSeconds = item.lastPositionSeconds)
        }
    }

    fun closePlayer() {
        _uiState.update {
            it.copy(
                activeYouTubeVideo = null,
                activeLocalVideo = null,
                isFullscreen = false
            )
        }
    }

    fun setFullscreen(fullscreen: Boolean) {
        _uiState.update { it.copy(isFullscreen = fullscreen) }
    }

    // ---- Favorites ----

    fun toggleFavorite(video: YouTubeVideo) {
        viewModelScope.launch {
            val added = repository.toggleFavorite(video)
            _uiState.update {
                it.copy(
                    statusBannerMessage = if (added) "Added to Favorites" else "Removed from Favorites"
                )
            }
        }
    }

    fun removeFavorite(videoId: String) {
        viewModelScope.launch {
            repository.removeFavorite(videoId)
        }
    }

    fun clearAllFavorites() {
        viewModelScope.launch {
            repository.clearAllFavorites()
            _uiState.update { it.copy(statusBannerMessage = "All favorites cleared") }
        }
    }

    // ---- History & Cache ----

    fun deleteWatchHistoryItem(historyId: String) {
        viewModelScope.launch {
            repository.deleteWatchHistoryItem(historyId)
        }
    }

    fun clearWatchHistory() {
        viewModelScope.launch {
            repository.clearWatchHistory()
            _uiState.update { it.copy(statusBannerMessage = "Watch history cleared") }
        }
    }

    fun deleteSearchHistoryItem(query: String) {
        viewModelScope.launch {
            repository.deleteSearchHistoryQuery(query)
        }
    }

    fun clearSearchHistory() {
        viewModelScope.launch {
            repository.clearSearchHistory()
            _uiState.update { it.copy(statusBannerMessage = "Search history cleared") }
        }
    }

    fun clearApiCache() {
        viewModelScope.launch {
            repository.clearApiCache()
            _uiState.update { it.copy(statusBannerMessage = "YouTube API cache cleared") }
        }
    }

    // ---- Offline & Local Videos ----

    fun onMediaVideoPermissionResult(granted: Boolean) {
        _uiState.update { it.copy(hasMediaVideoPermission = granted) }
        if (granted) {
            scanDeviceVideos()
        }
    }

    fun scanDeviceVideos() {
        viewModelScope.launch {
            _uiState.update { it.copy(isScanningLocalVideos = true) }
            val scanned = repository.scanDeviceMediaStoreVideos()
            _uiState.update {
                it.copy(
                    deviceLocalVideos = scanned,
                    isScanningLocalVideos = false
                )
            }
        }
    }

    fun onLocalVideosPicked(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            val imported = repository.importPickedVideoUris(uris)
            val firstVideo = imported.firstOrNull()
            if (firstVideo != null) {
                playLocalVideo(firstVideo)
            }
        }
    }

    fun removeSavedLocalVideo(uri: String) {
        viewModelScope.launch {
            repository.removeSavedLocalVideo(uri)
        }
    }

    // ---- Settings & API Key ----

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { settingsStore.setThemeMode(mode) }
    }

    fun setPreferredQuality(quality: VideoQualityOption) {
        viewModelScope.launch { settingsStore.setPreferredQuality(quality) }
    }

    fun setCaptionsEnabled(enabled: Boolean) {
        viewModelScope.launch { settingsStore.setCaptionsEnabled(enabled) }
    }

    fun setCaptionsLanguage(lang: String) {
        viewModelScope.launch { settingsStore.setCaptionsLanguage(lang) }
    }

    fun setLowEndPerformanceMode(enabled: Boolean) {
        viewModelScope.launch { settingsStore.setLowEndPerformanceMode(enabled) }
    }

    fun setSafeSearchMode(mode: SafeSearchMode) {
        viewModelScope.launch { settingsStore.setSafeSearchMode(mode) }
    }

    fun setAutoplayEnabled(enabled: Boolean) {
        viewModelScope.launch { settingsStore.setAutoplayEnabled(enabled) }
    }

    fun setPauseWatchHistory(paused: Boolean) {
        viewModelScope.launch { settingsStore.setPauseWatchHistory(paused) }
    }

    fun setRegionCode(regionCode: String) {
        viewModelScope.launch { settingsStore.setRegionCode(regionCode) }
    }

    fun saveAndValidateApiKey(apiKeyInput: String) {
        val clean = apiKeyInput.trim()
        viewModelScope.launch {
            settingsStore.setCustomApiKey(clean)
            if (clean.isEmpty() && BuildConfig.YOUTUBE_API_KEY.isBlank()) {
                _uiState.update {
                    it.copy(
                        apiKeyValidationMessage = "Custom API key cleared.",
                        isValidatingApiKey = false
                    )
                }
                return@launch
            }
            val effective = repository.resolveEffectiveApiKey(clean)
            _uiState.update {
                it.copy(
                    isValidatingApiKey = true,
                    apiKeyValidationMessage = "Verifying YouTube Data API v3 key..."
                )
            }
            when (val res = repository.validateApiKey(effective)) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isValidatingApiKey = false,
                            apiKeyValidationMessage = "API Key verified! Loading live YouTube feed...",
                            errorCode = null,
                            errorMessage = null
                        )
                    }
                    refreshCurrentFeed()
                }
                is ApiResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isValidatingApiKey = false,
                            apiKeyValidationMessage = "API Key verification failed: ${res.message}"
                        )
                    }
                }
            }
        }
    }

    fun dismissStatusBanner() {
        _uiState.update { it.copy(statusBannerMessage = null) }
    }

    companion object {
        fun provideFactory(
            repository: VyroRepository,
            settingsStore: SettingsDataStore,
            networkMonitor: NetworkMonitor
        ): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                return VyroViewModel(repository, settingsStore, networkMonitor) as T
            }
        }
    }
}
