package com.vyro.play.feature.player

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vyro.core.model.AppError
import com.vyro.core.model.NetworkClass
import com.vyro.core.model.Outcome
import com.vyro.core.model.UserSettings
import com.vyro.core.model.Video
import com.vyro.core.model.WatchHistoryEntry
import com.vyro.play.domain.repository.FavoritesRepository
import com.vyro.play.domain.repository.HistoryRepository
import com.vyro.play.domain.repository.SettingsRepository
import com.vyro.play.domain.repository.VideoRepository
import com.vyro.play.domain.usecase.RecordWatchUseCase
import com.vyro.play.domain.usecase.ToggleFavoriteUseCase
import com.vyro.play.ui.navigation.Args
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.math.abs

data class PlayerUiState(
    val videoId: String = "",
    val video: Outcome<Video> = Outcome.Loading,
    val related: Outcome<List<Video>> = Outcome.Loading,
    val isFavorite: Boolean = false,
    val settings: UserSettings = UserSettings.DEFAULT,
    val network: NetworkClass = NetworkClass.UNMETERED_WIFI,
    val resumeSeconds: Float = 0f,
)

@HiltViewModel
class PlayerViewModel
    @Inject
    constructor(
        private val videoRepository: VideoRepository,
        favoritesRepository: FavoritesRepository,
        private val historyRepository: HistoryRepository,
        private val recordWatch: RecordWatchUseCase,
        settingsRepository: SettingsRepository,
        connectivityRepository: com.vyro.play.domain.repository.ConnectivityRepository,
        private val toggleFavorite: ToggleFavoriteUseCase,
        savedStateHandle: SavedStateHandle,
    ) : ViewModel() {

        val videoId: String = savedStateHandle[Args.VIDEO_ID] ?: ""

        private val video = MutableStateFlow<Outcome<Video>>(Outcome.Loading)
        private val related = MutableStateFlow<Outcome<List<Video>>>(Outcome.Loading)
        private val resumeSeconds = MutableStateFlow(0f)

        /** Last position written to the database; avoids a write every 100 ms. */
        private var lastSavedSeconds = 0f
        private var latestVideo: Video? = null

        val uiState: StateFlow<PlayerUiState> =
            combine(
                video,
                related,
                favoritesRepository.observeIds(),
                settingsRepository.settings,
                connectivityRepository.networkClass,
                resumeSeconds,
            ) { videoOutcome, relatedOutcome, favoriteIds, settings, network, resume ->
                PlayerUiState(
                    videoId = videoId,
                    video = videoOutcome,
                    related = relatedOutcome,
                    isFavorite = favoriteIds.contains(videoId),
                    settings = settings,
                    network = network,
                    resumeSeconds = resume,
                )
            }.stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = PlayerUiState(videoId = videoId),
            )

        init {
            load()
        }

        fun retry() = load()

        private fun load() {
            if (videoId.isBlank()) {
                video.value = Outcome.Failure(AppError.NotFound)
                return
            }
            viewModelScope.launch {
                video.value = Outcome.Loading
                related.value = Outcome.Loading
                video.value =
                    when (val result = videoRepository.details(listOf(videoId))) {
                        is Outcome.Success -> {
                            val found = result.data.firstOrNull { it.id == videoId }
                            if (found == null) {
                                Outcome.Failure(AppError.NotFound)
                            } else {
                                Outcome.Success(found)
                            }
                        }

                        is Outcome.Failure -> result
                        Outcome.Loading -> Outcome.Loading
                    }

                val current = (video.value as? Outcome.Success)?.data
                if (current != null) {
                    latestVideo = current
                    val previous = historyRepository.find(videoId)
                    val duration = current.durationMillis
                    val previousSeconds = previous?.progressMillis?.div(1000f) ?: 0f
                    // Do not resume within the last 5% - the video is effectively over.
                    resumeSeconds.value =
                        if (duration > 0L && previousSeconds < duration / 1000f * 0.95f) previousSeconds else 0f

                    related.value = videoRepository.related(videoId = videoId, title = current.title)
                }
            }
        }

        /**
         * Persists watch progress. Called from the player's `onCurrentSecond` callback
         * (roughly every 100 ms), so writes are throttled.
         */
        fun onProgress(seconds: Float) {
            val current = latestVideo ?: return
            if (seconds <= 0f) return
            if (abs(seconds - lastSavedSeconds) < PROGRESS_SAVE_INTERVAL_SECONDS) return
            lastSavedSeconds = seconds

            viewModelScope.launch {
                recordWatch(
                    WatchHistoryEntry(
                        videoId = current.id,
                        title = current.title,
                        channelTitle = current.channelTitle,
                        thumbnailUrl = com.vyro.core.util.ThumbnailUrls.pick(
                            current.thumbnails,
                            com.vyro.core.model.ThumbnailQuality.MEDIUM,
                        ),
                        durationMillis = current.durationMillis,
                        lastWatchedMillis = System.currentTimeMillis(),
                        watchCount = 1,
                        progressMillis = (seconds * 1000f).toLong(),
                    ),
                )
            }
        }

        fun onPlaybackStarted() {
            val current = latestVideo ?: return
            viewModelScope.launch {
                recordWatch(
                    WatchHistoryEntry(
                        videoId = current.id,
                        title = current.title,
                        channelTitle = current.channelTitle,
                        thumbnailUrl = com.vyro.core.util.ThumbnailUrls.pick(
                            current.thumbnails,
                            com.vyro.core.model.ThumbnailQuality.MEDIUM,
                        ),
                        durationMillis = current.durationMillis,
                        lastWatchedMillis = System.currentTimeMillis(),
                        watchCount = 1,
                        progressMillis = 0L,
                    ),
                )
            }
        }

        fun toggleFavorite() {
            val current = latestVideo ?: return
            viewModelScope.launch { toggleFavorite.invoke(current) }
        }

        private companion object {
            const val PROGRESS_SAVE_INTERVAL_SECONDS = 10f
        }
    }
