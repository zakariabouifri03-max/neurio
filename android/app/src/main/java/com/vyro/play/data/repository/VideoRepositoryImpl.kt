package com.vyro.play.data.repository

import com.vyro.core.domain.PagingReducer
import com.vyro.core.model.Outcome
import com.vyro.core.model.Video
import com.vyro.core.model.VideoPage
import com.vyro.play.data.remote.YouTubeRemoteDataSource
import com.vyro.play.domain.repository.SettingsRepository
import com.vyro.play.domain.repository.VideoRepository
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VideoRepositoryImpl
    @Inject
    constructor(
        private val remote: YouTubeRemoteDataSource,
        private val settingsRepository: SettingsRepository,
    ) : VideoRepository {
        override suspend fun trending(
            pageToken: String?,
            maxResults: Int,
            regionCode: String?,
        ): Outcome<VideoPage> {
            val settings = settingsRepository.settings.first()
            return remote.trending(pageToken, maxResults, regionCode ?: settings.regionCode)
        }

        override suspend fun search(
            query: String,
            pageToken: String?,
            maxResults: Int,
            regionCode: String?,
        ): Outcome<VideoPage> {
            val settings = settingsRepository.settings.first()
            val page =
                remote.search(
                    query = query,
                    pageToken = pageToken,
                    maxResults = maxResults,
                    regionCode = regionCode ?: settings.regionCode,
                    safeSearch = settings.safeSearch,
                )
            if (page !is Outcome.Success) return page

            // `search.list` omits duration and view counts; one extra `videos.list`
            // call fills them in for the whole page (well within quota).
            return Outcome.Success(page.data.copy(items = enrich(page.data.items)))
        }

        override suspend fun details(videoIds: List<String>): Outcome<List<Video>> = remote.details(videoIds)

        override suspend fun related(
            videoId: String,
            title: String,
            pageToken: String?,
        ): Outcome<VideoPage> {
            val settings = settingsRepository.settings.first()
            val query = relatedQueryFrom(title)
            val page =
                remote.search(
                    query = query,
                    pageToken = pageToken,
                    maxResults = 12,
                    regionCode = settings.regionCode,
                    safeSearch = settings.safeSearch,
                )
            if (page !is Outcome.Success) return page
            val filtered =
                page.data.copy(
                    items = PagingReducer.append(emptyList(), page.data.items.filter { it.id != videoId }),
                )
            return Outcome.Success(filtered)
        }

        /**
         * Builds a "more like this" query from the most significant words of the title.
         * Cheap, and importantly it does not require a second paid API product.
         */
        private fun relatedQueryFrom(title: String): String {
            val stopWords = setOf("the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "official", "video")
            val words =
                title
                    .split(Regex("[^\\p{L}\\p{N}']+"))
                    .filter { it.length > 2 && it.lowercase() !in stopWords }
            return words.take(5).joinToString(" ").ifBlank { title.take(60) }
        }

        private suspend fun enrich(items: List<Video>): List<Video> {
            val missing = items.filterNot { it.detailsResolved }.map { it.id }
            if (missing.isEmpty()) return items

            return when (val result = remote.details(missing)) {
                is Outcome.Success -> {
                    val byId = result.data.associateBy { it.id }
                    items.map { item -> byId[item.id] ?: item }
                }
                else -> items
            }
        }
    }
