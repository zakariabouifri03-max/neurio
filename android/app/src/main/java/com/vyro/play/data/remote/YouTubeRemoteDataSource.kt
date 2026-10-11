package com.vyro.play.data.remote

import com.vyro.core.domain.YouTubeQueryBuilder
import com.vyro.core.model.AppError
import com.vyro.core.model.Outcome
import com.vyro.core.model.Video
import com.vyro.core.model.VideoPage
import com.vyro.play.BuildConfig
import com.vyro.play.domain.repository.SettingsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thin, cancellable wrapper around the two YouTube Data API v3 endpoints the app needs.
 *
 * Notes
 *  - The API key is resolved per request so a key entered in Settings takes effect
 *    immediately, without restarting the app.
 *  - Responses are cached by OkHttp for five minutes, which keeps quota usage down on
 *    orientation changes and back-navigation (allowed: the response is still rendered
 *    through the official player, nothing is re-distributed).
 *  - `search` results do not contain duration or statistics, so [details] is called
 *    afterwards to enrich them.
 */
@Singleton
class YouTubeRemoteDataSource
    @Inject
    constructor(
        private val client: OkHttpClient,
        private val json: Json,
        private val settingsRepository: SettingsRepository,
    ) {
        private val errorMapper = ApiErrorMapper(json)

        suspend fun trending(
            pageToken: String?,
            maxResults: Int,
            regionCode: String,
        ): Outcome<VideoPage> {
            val key = apiKey() ?: return Outcome.Failure(AppError.MissingApiKey)
            return execute(YouTubeQueryBuilder.mostPopular(key, pageToken, maxResults, regionCode)) { body ->
                json.decodeFromString<com.vyro.play.data.remote.dto.VideosResponseDto>(body).toPage()
            }
        }

        suspend fun search(
            query: String,
            pageToken: String?,
            maxResults: Int,
            regionCode: String,
            safeSearch: Boolean,
        ): Outcome<VideoPage> {
            val key = apiKey() ?: return Outcome.Failure(AppError.MissingApiKey)
            return execute(
                YouTubeQueryBuilder.search(
                    apiKey = key,
                    query = query,
                    pageToken = pageToken,
                    maxResults = maxResults,
                    safeSearch = safeSearch,
                    regionCode = regionCode,
                ),
            ) { body ->
                val dto = json.decodeFromString<com.vyro.play.data.remote.dto.SearchResponseDto>(body)
                val videos = dto.items.mapNotNull { it.toDomain() }
                VideoPage(
                    items = videos,
                    nextPageToken = dto.nextPageToken,
                    totalResults = dto.pageInfo.totalResults(),
                )
            }
        }

        suspend fun details(videoIds: List<String>): Outcome<List<Video>> {
            if (videoIds.isEmpty()) return Outcome.Success(emptyList())
            val key = apiKey() ?: return Outcome.Failure(AppError.MissingApiKey)
            // The API accepts at most 50 comma separated ids.
            return execute(YouTubeQueryBuilder.videos(key, videoIds)) { body ->
                json.decodeFromString<com.vyro.play.data.remote.dto.VideosResponseDto>(body)
                    .items
                    .mapNotNull { it.toDomain() }
            }
        }

        /** @return the resolved key, or null when the user has not configured one. */
        private suspend fun apiKey(): String? {
            val override = settingsRepository.effectiveApiKey.first()
            val resolved = override.ifBlank { BuildConfig.YOUTUBE_API_KEY }
            return resolved.trim().ifBlank { null }
        }

        private suspend fun <T> execute(
            url: String,
            parse: (String) -> T,
        ): Outcome<T> =
            withContext(Dispatchers.IO) {
                val request =
                    Request.Builder()
                        .url(url)
                        .header("Accept", "application/json")
                        .get()
                        .build()

                val response =
                    try {
                        client.newCall(request).execute()
                    } catch (throwable: Throwable) {
                        return@withContext Outcome.Failure(errorMapper.mapTransport(throwable))
                    }

                response.use { raw ->
                    val body = raw.body?.string().orEmpty()
                    if (!raw.isSuccessful) {
                        return@withContext Outcome.Failure(errorMapper.mapHttp(raw, body))
                    }
                    if (body.isBlank()) {
                        return@withContext Outcome.Failure(AppError.Parsing)
                    }
                    val parsed =
                        try {
                            parse(body)
                        } catch (throwable: Throwable) {
                            return@withContext Outcome.Failure(AppError.Parsing)
                        }
                    Outcome.Success(parsed)
                }
            }
    }
