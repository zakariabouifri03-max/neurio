package com.vyro.play.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vyro.core.domain.PagingReducer
import com.vyro.core.model.AppError
import com.vyro.core.model.ExploreCategory
import com.vyro.core.model.NetworkClass
import com.vyro.core.model.Outcome
import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.UserSettings
import com.vyro.core.model.Video
import com.vyro.play.domain.repository.ConnectivityRepository
import com.vyro.play.domain.repository.FavoritesRepository
import com.vyro.play.domain.repository.SettingsRepository
import com.vyro.play.domain.repository.VideoRepository
import com.vyro.play.domain.usecase.ApiKeyStatus
import com.vyro.play.domain.usecase.ToggleFavoriteUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val feed: Outcome<List<Video>> = Outcome.Loading,
    val favoriteIds: Set<String> = emptySet(),
    val network: NetworkClass = NetworkClass.UNMETERED_WIFI,
    val thumbnailQuality: ThumbnailQuality = ThumbnailQuality.MEDIUM,
    val category: ExploreCategory = ExploreCategory.TRENDING,
    val isRefreshing: Boolean = false,
    val isAppending: Boolean = false,
    val endReached: Boolean = false,
    val apiKeyMissing: Boolean = false,
    val reducedAnimations: Boolean = false,
)

/** Volatile pagination flags, kept together so the UI can observe a single object. */
private data class PagingState(
    val category: ExploreCategory = ExploreCategory.TRENDING,
    val isRefreshing: Boolean = false,
    val isAppending: Boolean = false,
    val endReached: Boolean = false,
    val apiKeyMissing: Boolean = false,
)

@HiltViewModel
class HomeViewModel
    @Inject
    constructor(
        private val videoRepository: VideoRepository,
        private val favoritesRepository: FavoritesRepository,
        settingsRepository: SettingsRepository,
        connectivityRepository: ConnectivityRepository,
        private val toggleFavorite: ToggleFavoriteUseCase,
        private val apiKeyStatus: ApiKeyStatus,
    ) : ViewModel() {

        private val feed = MutableStateFlow<Outcome<List<Video>>>(Outcome.Loading)
        private val category = MutableStateFlow(ExploreCategory.TRENDING)
        private val isRefreshing = MutableStateFlow(false)
        private val isAppending = MutableStateFlow(false)
        private val endReached = MutableStateFlow(false)
        private val apiKeyMissing = MutableStateFlow(false)

        private var nextPageToken: String? = null
        private var loadingJob: Job? = null

        private val paging: StateFlow<PagingState> =
            combine(category, isRefreshing, isAppending, endReached, apiKeyMissing) { values ->
                PagingState(
                    category = values[0] as ExploreCategory,
                    isRefreshing = values[1] as Boolean,
                    isAppending = values[2] as Boolean,
                    endReached = values[3] as Boolean,
                    apiKeyMissing = values[4] as Boolean,
                )
            }.stateIn(viewModelScope, SharingStarted.Eagerly, PagingState())

        val uiState: StateFlow<HomeUiState> =
            combine(
                feed,
                favoritesRepository.observeIds(),
                connectivityRepository.networkClass,
                paging,
                settingsRepository.settings,
            ) { feed, favoriteIds, network, paging, settings ->
                HomeUiState(
                    feed = feed,
                    favoriteIds = favoriteIds,
                    network = network,
                    thumbnailQuality = settings.thumbnailQuality,
                    category = paging.category,
                    isRefreshing = paging.isRefreshing,
                    isAppending = paging.isAppending,
                    endReached = paging.endReached,
                    apiKeyMissing = paging.apiKeyMissing,
                    reducedAnimations = settings.reducedAnimations,
                )
            }.stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = HomeUiState(),
            )

        init {
            refresh()
        }

        fun refresh() {
            loadingJob?.cancel()
            nextPageToken = null
            endReached.value = false
            isRefreshing.value = true
            load(reset = true)
        }

        fun selectCategory(next: ExploreCategory) {
            if (next == category.value && feed.value is Outcome.Success) return
            category.value = next
            nextPageToken = null
            endReached.value = false
            feed.value = Outcome.Loading
            load(reset = true)
        }

        fun loadMore() {
            if (isAppending.value || isRefreshing.value) return
            if (endReached.value || nextPageToken == null) return
            isAppending.value = true
            load(reset = false)
        }

        fun toggleFavorite(video: Video) {
            viewModelScope.launch { toggleFavorite.invoke(video) }
        }

        /** Called by the UI when it scrolls near the end of the list. */
        fun onVisibleIndexChanged(index: Int) {
            val items = (feed.value as? Outcome.Success)?.data ?: return
            if (PagingReducer.shouldPrefetch(index, items.size)) loadMore()
        }

        private fun load(reset: Boolean) {
            loadingJob?.cancel()
            loadingJob =
                viewModelScope.launch {
                    if (!apiKeyStatus.isConfigured()) {
                        apiKeyMissing.value = true
                        isRefreshing.value = false
                        isAppending.value = false
                        feed.value = Outcome.Failure(AppError.MissingApiKey)
                        return@launch
                    }
                    apiKeyMissing.value = false

                    val current = category.value
                    val token = if (reset) null else nextPageToken

                    val page =
                        if (current == ExploreCategory.TRENDING) {
                            videoRepository.trending(pageToken = token)
                        } else {
                            videoRepository.search(query = current.query, pageToken = token)
                        }

                    when (page) {
                        is Outcome.Success -> {
                            val existing =
                                if (reset) emptyList() else (feed.value as? Outcome.Success)?.data.orEmpty()
                            feed.value = Outcome.Success(PagingReducer.append(existing, page.data.items))
                            nextPageToken = page.data.nextPageToken
                            endReached.value = page.data.nextPageToken == null
                        }

                        is Outcome.Failure -> if (reset) feed.value = page else Unit
                        Outcome.Loading -> Unit
                    }

                    isRefreshing.value = false
                    isAppending.value = false
                }
        }
    }
