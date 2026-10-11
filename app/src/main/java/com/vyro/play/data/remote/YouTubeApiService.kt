package com.vyro.play.data.remote

import com.vyro.play.BuildConfig
import com.vyro.play.model.ApiErrorCode
import com.vyro.play.model.ApiResult
import com.vyro.play.model.SafeSearchMode
import com.vyro.play.model.YouTubeVideo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Official YouTube Data API v3 HTTP client powered by OkHttp.
 * Uses real Google API endpoints (youtube/v3/search and youtube/v3/videos)
 * plus YouTube's official oEmbed endpoint for direct URL/ID lookups.
 */
class YouTubeApiService(
    private val okHttpClient: OkHttpClient = defaultOkHttpClient()
) {
    private val baseUrl: String = BuildConfig.YOUTUBE_API_BASE_URL

    suspend fun searchVideos(
        query: String,
        apiKey: String,
        safeSearch: SafeSearchMode = SafeSearchMode.MODERATE,
        preferHighDef: Boolean = false,
        maxResults: Int = 20
    ): ApiResult<List<YouTubeVideo>> = withContext(Dispatchers.IO) {
        val cleanKey = apiKey.trim()
        if (cleanKey.isEmpty()) {
            return@withContext ApiResult.Error(
                message = "YouTube Data API v3 key is not configured yet. Add your API key in Settings or local.properties to search YouTube, or paste any YouTube URL/Video ID to play directly.",
                errorCode = ApiErrorCode.MISSING_API_KEY
            )
        }

        val searchUrlBuilder = "$baseUrl/search".toHttpUrlOrNull()?.newBuilder()
            ?: return@withContext ApiResult.Error("Invalid API base URL", ApiErrorCode.UNKNOWN)

        searchUrlBuilder
            .addQueryParameter("part", "snippet")
            .addQueryParameter("type", "video")
            .addQueryParameter("videoEmbeddable", "true")
            .addQueryParameter("maxResults", maxResults.coerceIn(1, 50).toString())
            .addQueryParameter("q", query.trim())
            .addQueryParameter("safeSearch", safeSearch.apiParam)
            .addQueryParameter("key", cleanKey)

        if (preferHighDef) {
            searchUrlBuilder.addQueryParameter("videoDefinition", "high")
        }

        val searchRequest = Request.Builder()
            .url(searchUrlBuilder.build())
            .header("Accept", "application/json")
            .get()
            .build()

        try {
            okHttpClient.newCall(searchRequest).execute().use { response ->
                val bodyStr = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext YouTubeMetadataParser.parseApiError(response.code, bodyStr)
                }

                val videoIds = YouTubeMetadataParser.parseSearchVideoIds(bodyStr)
                if (videoIds.isEmpty()) {
                    return@withContext ApiResult.Success(emptyList())
                }

                // Enrich with contentDetails (ISO duration, HD/SD, captions) and statistics (views, likes)
                when (val detailsResult = fetchVideosByIds(videoIds, cleanKey)) {
                    is ApiResult.Success -> {
                        if (detailsResult.data.isNotEmpty()) {
                            return@withContext detailsResult
                        }
                        val fallback = YouTubeMetadataParser.parseSearchFallbackVideos(bodyStr)
                        return@withContext ApiResult.Success(fallback)
                    }
                    is ApiResult.Error -> {
                        val fallback = YouTubeMetadataParser.parseSearchFallbackVideos(bodyStr)
                        if (fallback.isNotEmpty()) {
                            return@withContext ApiResult.Success(fallback)
                        }
                        return@withContext detailsResult
                    }
                }
            }
        } catch (e: IOException) {
            ApiResult.Error(
                message = "Network error while contacting YouTube Data API v3: ${e.localizedMessage ?: "Check your internet connection."}",
                errorCode = ApiErrorCode.NETWORK_OFFLINE
            )
        } catch (e: Exception) {
            ApiResult.Error(
                message = "Unexpected error parsing YouTube search response: ${e.localizedMessage ?: "Unknown error"}",
                errorCode = ApiErrorCode.UNKNOWN
            )
        }
    }

    suspend fun getPopularVideos(
        apiKey: String,
        regionCode: String = "US",
        videoCategoryId: String? = null,
        maxResults: Int = 20
    ): ApiResult<List<YouTubeVideo>> = withContext(Dispatchers.IO) {
        val cleanKey = apiKey.trim()
        if (cleanKey.isEmpty()) {
            return@withContext ApiResult.Error(
                message = "YouTube Data API v3 key is required for trending discovery. Configure your key in Settings or local.properties.",
                errorCode = ApiErrorCode.MISSING_API_KEY
            )
        }

        val urlBuilder = "$baseUrl/videos".toHttpUrlOrNull()?.newBuilder()
            ?: return@withContext ApiResult.Error("Invalid API base URL", ApiErrorCode.UNKNOWN)

        urlBuilder
            .addQueryParameter("part", "snippet,contentDetails,statistics")
            .addQueryParameter("chart", "mostPopular")
            .addQueryParameter("regionCode", regionCode.trim().uppercase().ifEmpty { "US" })
            .addQueryParameter("maxResults", maxResults.coerceIn(1, 50).toString())
            .addQueryParameter("key", cleanKey)

        if (!videoCategoryId.isNullOrBlank()) {
            urlBuilder.addQueryParameter("videoCategoryId", videoCategoryId.trim())
        }

        val request = Request.Builder()
            .url(urlBuilder.build())
            .header("Accept", "application/json")
            .get()
            .build()

        try {
            okHttpClient.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext YouTubeMetadataParser.parseApiError(response.code, bodyStr)
                }
                val videos = YouTubeMetadataParser.parseVideosListResponse(bodyStr)
                ApiResult.Success(videos)
            }
        } catch (e: IOException) {
            ApiResult.Error(
                message = "Unable to reach YouTube Data API v3: ${e.localizedMessage ?: "Offline"}",
                errorCode = ApiErrorCode.NETWORK_OFFLINE
            )
        } catch (e: Exception) {
            ApiResult.Error(
                message = "Failed to parse popular videos: ${e.localizedMessage ?: "Unknown error"}",
                errorCode = ApiErrorCode.UNKNOWN
            )
        }
    }

    suspend fun fetchVideosByIds(
        videoIds: List<String>,
        apiKey: String
    ): ApiResult<List<YouTubeVideo>> = withContext(Dispatchers.IO) {
        if (videoIds.isEmpty()) return@withContext ApiResult.Success(emptyList())
        val cleanKey = apiKey.trim()
        val urlBuilder = "$baseUrl/videos".toHttpUrlOrNull()?.newBuilder()
            ?: return@withContext ApiResult.Error("Invalid API base URL", ApiErrorCode.UNKNOWN)

        urlBuilder
            .addQueryParameter("part", "snippet,contentDetails,statistics")
            .addQueryParameter("id", videoIds.joinToString(","))
            .addQueryParameter("key", cleanKey)

        val request = Request.Builder()
            .url(urlBuilder.build())
            .header("Accept", "application/json")
            .get()
            .build()

        try {
            okHttpClient.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext YouTubeMetadataParser.parseApiError(response.code, bodyStr)
                }
                val videos = YouTubeMetadataParser.parseVideosListResponse(bodyStr)
                ApiResult.Success(videos)
            }
        } catch (e: IOException) {
            ApiResult.Error(
                message = "Network error fetching video details: ${e.localizedMessage ?: "Offline"}",
                errorCode = ApiErrorCode.NETWORK_OFFLINE
            )
        }
    }

    /**
     * Resolves a single YouTube video from a URL or 11-character ID.
     * Uses YouTube Data API v3 when an API key is configured, and falls back
     * to YouTube's official public oEmbed endpoint when no API key is set.
     */
    suspend fun fetchSingleVideoByUrlOrId(
        urlOrId: String,
        apiKey: String
    ): ApiResult<YouTubeVideo> = withContext(Dispatchers.IO) {
        val videoId = YouTubeMetadataParser.extractVideoId(urlOrId)
            ?: return@withContext ApiResult.Error(
                message = "Could not extract a valid 11-character YouTube Video ID from \"$urlOrId\".",
                errorCode = ApiErrorCode.VIDEO_NOT_FOUND
            )

        val cleanKey = apiKey.trim()
        if (cleanKey.isNotEmpty()) {
            when (val res = fetchVideosByIds(listOf(videoId), cleanKey)) {
                is ApiResult.Success -> {
                    val found = res.data.firstOrNull()
                    if (found != null) {
                        return@withContext ApiResult.Success(found)
                    }
                }
                is ApiResult.Error -> {
                    // Fall through to official oEmbed so the user can still play the video ID
                }
            }
        }

        // Official YouTube oEmbed lookup (keyless public metadata endpoint)
        val oembedUrl = "https://www.youtube.com/oembed".toHttpUrlOrNull()?.newBuilder()
            ?.addQueryParameter("url", "https://www.youtube.com/watch?v=$videoId")
            ?.addQueryParameter("format", "json")
            ?.build()

        if (oembedUrl != null) {
            val req = Request.Builder().url(oembedUrl).get().build()
            try {
                okHttpClient.newCall(req).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    if (resp.isSuccessful && body.isNotBlank()) {
                        val video = YouTubeMetadataParser.parseOEmbedResponse(videoId, body)
                        return@withContext ApiResult.Success(video)
                    }
                }
            } catch (_: Exception) {
                // If offline or blocked, still construct a playable official video reference
            }
        }

        ApiResult.Success(
            YouTubeMetadataParser.parseOEmbedResponse(
                videoId = videoId,
                oembedJson = """{"title":"YouTube Video ($videoId)","author_name":"YouTube"}"""
            )
        )
    }

    suspend fun validateApiKey(candidateKey: String): ApiResult<Boolean> = withContext(Dispatchers.IO) {
        val cleanKey = candidateKey.trim()
        if (cleanKey.isEmpty()) {
            return@withContext ApiResult.Error(
                message = "API key cannot be empty.",
                errorCode = ApiErrorCode.MISSING_API_KEY
            )
        }
        val url = "$baseUrl/videos".toHttpUrlOrNull()?.newBuilder()
            ?.addQueryParameter("part", "id")
            ?.addQueryParameter("chart", "mostPopular")
            ?.addQueryParameter("maxResults", "1")
            ?.addQueryParameter("key", cleanKey)
            ?.build()
            ?: return@withContext ApiResult.Error("Invalid URL", ApiErrorCode.UNKNOWN)

        val request = Request.Builder().url(url).get().build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    ApiResult.Success(true)
                } else {
                    YouTubeMetadataParser.parseApiError(response.code, bodyStr)
                }
            }
        } catch (e: IOException) {
            ApiResult.Error(
                message = "Network error while verifying API key: ${e.localizedMessage ?: "Offline"}",
                errorCode = ApiErrorCode.NETWORK_OFFLINE
            )
        }
    }

    companion object {
        fun defaultOkHttpClient(): OkHttpClient {
            return OkHttpClient.Builder()
                .connectTimeout(12, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(12, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }
    }
}
