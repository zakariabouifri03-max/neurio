package com.vyro.play.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.ImageLoader
import com.vyro.core.model.PlaybackQuality
import com.vyro.core.model.ThemeMode
import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.UserSettings
import com.vyro.play.domain.repository.HistoryRepository
import com.vyro.play.domain.repository.SearchHistoryRepository
import com.vyro.play.domain.repository.SettingsRepository
import com.vyro.play.domain.usecase.ApiKeyStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Where the API key currently in use comes from. */
enum class ApiKeySource { BUILT_IN, USER_SUPPLIED, NONE }

data class SettingsUiState(
    val settings: UserSettings = UserSettings.DEFAULT,
    val apiKeySource: ApiKeySource = ApiKeySource.NONE,
    val message: String? = null,
)

@HiltViewModel
class SettingsViewModel
    @Inject
    constructor(
        private val settingsRepository: SettingsRepository,
        private val searchHistoryRepository: SearchHistoryRepository,
        private val historyRepository: HistoryRepository,
        private val apiKeyStatus: ApiKeyStatus,
        private val imageLoader: ImageLoader,
    ) : ViewModel() {

        private val message = MutableStateFlow<String?>(null)

        val uiState: StateFlow<SettingsUiState> =
            combine(
                settingsRepository.settings,
                settingsRepository.effectiveApiKey,
                message,
            ) { settings, override, notice ->
                SettingsUiState(
                    settings = settings,
                    apiKeySource =
                        when {
                            override.isNotBlank() -> ApiKeySource.USER_SUPPLIED
                            apiKeyStatus.isConfigured() -> ApiKeySource.BUILT_IN
                            else -> ApiKeySource.NONE
                        },
                    message = notice,
                )
            }.stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = SettingsUiState(),
            )

        fun setThemeMode(mode: ThemeMode) = update { it.copy(themeMode = mode) }

        fun setDynamicColor(enabled: Boolean) = update { it.copy(dynamicColor = enabled) }

        fun setPureBlack(enabled: Boolean) = update { it.copy(pureBlack = enabled) }

        fun setReducedAnimations(enabled: Boolean) = update { it.copy(reducedAnimations = enabled) }

        fun setPreferredQuality(quality: PlaybackQuality) = update { it.copy(preferredQuality = quality) }

        fun setCaptionsEnabled(enabled: Boolean) = update { it.copy(captionsEnabled = enabled) }

        fun setCaptionsLanguage(code: String) = update { it.copy(captionsLanguage = code) }

        fun setAutoplayNext(enabled: Boolean) = update { it.copy(autoplayNext = enabled) }

        fun setThumbnailQuality(quality: ThumbnailQuality) = update { it.copy(thumbnailQuality = quality) }

        fun setDataSaver(enabled: Boolean) = update { it.copy(dataSaver = enabled) }

        fun setSafeSearch(enabled: Boolean) = update { it.copy(safeSearch = enabled) }

        fun setRegion(code: String) = update { it.copy(regionCode = code) }

        fun setRememberSearchHistory(enabled: Boolean) = update { it.copy(rememberSearchHistory = enabled) }

        fun setHistoryLimit(limit: Int) =
            update {
                it.copy(
                    maxHistoryEntries =
                        limit.coerceIn(
                            UserSettings.MIN_HISTORY_ENTRIES,
                            UserSettings.MAX_HISTORY_ENTRIES,
                        ),
                )
            }

        fun saveApiKey(key: String) {
            viewModelScope.launch {
                if (key.isBlank()) {
                    settingsRepository.clearApiKeyOverride()
                } else {
                    settingsRepository.setApiKeyOverride(key)
                }
            }
        }

        fun clearSearchHistory() {
            viewModelScope.launch { searchHistoryRepository.clear() }
        }

        fun clearWatchHistory() {
            viewModelScope.launch { historyRepository.clear() }
        }

        fun clearImageCache() {
            imageLoader.memoryCache?.clear()
            imageLoader.diskCache?.clear()
            message.value = "Image cache cleared"
        }

        fun consumeMessage() {
            message.value = null
        }

        private fun update(transform: (UserSettings) -> UserSettings) {
            viewModelScope.launch { settingsRepository.update(transform) }
        }
    }
