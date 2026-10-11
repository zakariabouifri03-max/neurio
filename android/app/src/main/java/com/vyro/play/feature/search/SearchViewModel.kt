package com.vyro.play.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vyro.core.domain.PagingReducer
import com.vyro.core.domain.SearchHistoryPolicy
import com.vyro.core.model.AppError
import com.vyro.core.model.NetworkClass
import com.vyro.core.model.Outcome
import com.vyro.core.model.SearchQuery
import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.UserSettings
import com.vyro.core.model.Video
import com.vyro.play.domain.repository.ConnectivityRepository
import com.vyro.play.domain.repository.FavoritesRepository
import com.vyro.play.domain.repository.SearchHistoryRepository
import com.vyro.play.domain.repository.SettingsRepository
import com.vyro.play.domain.repository.VideoRepository
import com.vyro.play.domain.usecase.ApiKeyStatus
import com.vyro.play.domain.usecase.ToggleFavoriteUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SearchUiState(
    val query: String = "",
    val submittedQuery: String = "",
    val results: Outcome<List<Video>> = Outcome.Loading,
    val favoriteIds: Set<String> = emptySet(),
    val history: List<SearchQuery> = emptyList(),
    val suggestions: List<SearchQuery> = emptyList(),
    val thumbnailQuality: ThumbnailQuality = ThumbnailQuality.MEDIUM,
    val rememberHistory: Boolean = true,
    val isSearching: Boolean = false,
    val isAppending: Boolean = false,
    val endReached: Boolean = false,
    val apiKeyMissing: Boolean = false,
    val network: NetworkClass = NetworkClass.UNMETERED_WIFI,
)

private data class SearchInternalState(
    val isSearching: Boolean = false,
    val isAppending: Boolean = false,
    val endReached: Boolean = false,
    val apiKeyMissing: Boolean = false,
)

@OptIn(FlowPreview::class)
@HiltViewModel
class SearchViewModel
    @Inject
    constructor(
        private val videoRepository: VideoRepository,
        private val favoritesRepository: FavoritesRepository,
        private val searchHistoryRepository: SearchHistoryRepository,
        private val settingsRepository: SettingsRepository,
        connectivityRepository: ConnectivityRepository,
        private val toggleFavorite: ToggleFavoriteUseCase,
        private val apiKeyStatus: ApiKeyStatus,
    ) : ViewModel() {

        private val query = MutableStateFlow("")
        private val submittedQuery = MutableStateFlow("")
        private val results = MutableStateFlow<Outcome<List<Video>>>(Outcome.Loading)
        private val progress = MutableStateFlow(SearchInternalState())

        private var nextPageToken: String? = null
        private var searchJob: Job? = null

        private val history: StateFlow<List<SearchQuery>> =
            searchHistoryRepository.observe()
                .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

        /**
         * Typing triggers a search after a short pause. The threshold keeps single
         * characters from burning API quota.
         */
        private val debouncedQuery =
            query
                .debounce(TYPING_DEBOUNCE_MS)
                .distinctUntilChanged()
                .onEach { typed ->
                    if (typed.trim().length >= MIN_QUERY_LENGTH) submitInternal(typed, remember = false)
                }

        /** Everything that changes while the user types, folded into one object. */
        private data class SearchCore(
            val query: String = "",
            val submittedQuery: String = "",
            val results: Outcome<List<Video>> = Outcome.Loading,
            val progressState: SearchInternalState = SearchInternalState(),
        )

        private val core: StateFlow<SearchCore> =
            combine(query, submittedQuery, results, progress) { typed, submitted, outcome, progressState ->
                SearchCore(
                    query = typed,
                    submittedQuery = submitted,
                    results = outcome,
                    progressState = progressState,
                )
            }.stateIn(viewModelScope, SharingStarted.Eagerly, SearchCore())

        val uiState: StateFlow<SearchUiState> =
            combine(
                core,
                favoritesRepository.observeIds(),
                history,
                settingsRepository.settings,
                connectivityRepository.networkClass,
            ) { core, favoriteIds, historyList, settings, network ->
                SearchUiState(
                    query = core.query,
                    submittedQuery = core.submittedQuery,
                    results = core.results,
                    favoriteIds = favoriteIds,
                    history = historyList,
                    suggestions = SearchHistoryPolicy.suggestions(historyList, core.query),
                    thumbnailQuality = settings.thumbnailQuality,
                    rememberHistory = settings.rememberSearchHistory,
                    isSearching = core.progressState.isSearching,
                    isAppending = core.progressState.isAppending,
                    endReached = core.progressState.endReached,
                    apiKeyMissing = core.progressState.apiKeyMissing,
                    network = network,
                )
            }.stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = SearchUiState(),
            )

        init {
            viewModelScope.launch { debouncedQuery.collect { /* handled in onEach */ } }
        }

        fun onQueryChange(value: String) {
            query.value = value
            if (value.isEmpty()) {
                searchJob?.cancel()
                results.value = Outcome.Loading
                submittedQuery.value = ""
                nextPageToken = null
                progress.value = progress.value.copy(endReached = false, isSearching = false)
            }
        }

        /** Explicit submit (IME action or suggestion tap). */
        fun submit(
            text: String,
            remember: Boolean = true,
        ) {
            viewModelScope.launch { submitInternal(text, remember) }
        }

        private suspend fun submitInternal(
            text: String,
            remember: Boolean,
        ) {
            val normalised = SearchHistoryPolicy.normalise(text)
            if (normalised.length < MIN_QUERY_LENGTH) return

            searchJob?.cancel()
            submittedQuery.value = normalised
            nextPageToken = null
            progress.value = progress.value.copy(isSearching = true, endReached = false)

            if (remember && settingsRepository.settings.first().rememberSearchHistory) {
                searchHistoryRepository.record(normalised)
            }

            searchJob =
                viewModelScope.launch {
                    if (!apiKeyStatus.isConfigured()) {
                        progress.value = progress.value.copy(apiKeyMissing = true, isSearching = false)
                        results.value = Outcome.Failure(AppError.MissingApiKey)
                        return@launch
                    }
                    progress.value = progress.value.copy(apiKeyMissing = false)

                    when (val page = videoRepository.search(query = normalised, pageToken = null)) {
                        is Outcome.Success -> {
                            results.value = Outcome.Success(page.data.items)
                            nextPageToken = page.data.nextPageToken
                            progress.value =
                                progress.value.copy(
                                    isSearching = false,
                                    endReached = page.data.nextPageToken == null,
                                )
                        }

                        is Outcome.Failure -> {
                            results.value = page
                            progress.value = progress.value.copy(isSearching = false)
                        }

                        Outcome.Loading -> Unit
                    }
                }
        }

        fun loadMore() {
            val state = progress.value
            if (state.isSearching || state.isAppending || state.endReached) return
            val token = nextPageToken ?: return
            val text = submittedQuery.value
            if (text.isBlank()) return

            progress.value = state.copy(isAppending = true)
            searchJob =
                viewModelScope.launch {
                    when (val page = videoRepository.search(query = text, pageToken = token)) {
                        is Outcome.Success -> {
                            val existing = (results.value as? Outcome.Success)?.data.orEmpty()
                            results.value = Outcome.Success(PagingReducer.append(existing, page.data.items))
                            nextPageToken = page.data.nextPageToken
                            progress.value =
                                progress.value.copy(
                                    isAppending = false,
                                    endReached = page.data.nextPageToken == null,
                                )
                        }

                        is Outcome.Failure -> progress.value = progress.value.copy(isAppending = false)
                        Outcome.Loading -> Unit
                    }
                }
        }

        fun retry() {
            val text = submittedQuery.value
            if (text.isBlank()) return
            submit(text, remember = false)
        }

        fun removeHistoryEntry(entry: SearchQuery) {
            viewModelScope.launch { searchHistoryRepository.remove(entry) }
        }

        fun clearHistory() {
            viewModelScope.launch { searchHistoryRepository.clear() }
        }

        fun toggleFavorite(video: Video) {
            viewModelScope.launch { toggleFavorite.invoke(video) }
        }

        fun onVisibleIndexChanged(index: Int) {
            val items = (results.value as? Outcome.Success)?.data ?: return
            if (PagingReducer.shouldPrefetch(index, items.size)) loadMore()
        }

        private companion object {
            const val TYPING_DEBOUNCE_MS = 600L
            const val MIN_QUERY_LENGTH = 2
        }
    }
