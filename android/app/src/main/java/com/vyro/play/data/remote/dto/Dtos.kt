package com.vyro.play.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire models for the YouTube Data API v3 endpoints used by VYRO PLAY.
 *
 * `ignoreUnknownKeys` is enabled on the [kotlinx.serialization.json.Json] instance so a
 * new field on Google's side can never crash the app.
 */

// ---------------------------------------------------------------- search.list
@Serializable
data class SearchResponseDto(
    @SerialName("kind") val kind: String? = null,
    @SerialName("etag") val etag: String? = null,
    @SerialName("nextPageToken") val nextPageToken: String? = null,
    @SerialName("prevPageToken") val prevPageToken: String? = null,
    @SerialName("regionCode") val regionCode: String? = null,
    @SerialName("pageInfo") val pageInfo: PageInfoDto? = null,
    @SerialName("items") val items: List<SearchItemDto> = emptyList(),
)

@Serializable
data class SearchItemDto(
    @SerialName("kind") val kind: String? = null,
    @SerialName("etag") val etag: String? = null,
    @SerialName("id") val id: SearchResourceIdDto? = null,
    @SerialName("snippet") val snippet: SnippetDto? = null,
)

@Serializable
data class SearchResourceIdDto(
    @SerialName("kind") val kind: String? = null,
    @SerialName("videoId") val videoId: String? = null,
    @SerialName("channelId") val channelId: String? = null,
    @SerialName("playlistId") val playlistId: String? = null,
)

// ---------------------------------------------------------------- videos.list
@Serializable
data class VideosResponseDto(
    @SerialName("kind") val kind: String? = null,
    @SerialName("etag") val etag: String? = null,
    @SerialName("nextPageToken") val nextPageToken: String? = null,
    @SerialName("pageInfo") val pageInfo: PageInfoDto? = null,
    @SerialName("items") val items: List<VideoItemDto> = emptyList(),
)

@Serializable
data class VideoItemDto(
    @SerialName("kind") val kind: String? = null,
    @SerialName("etag") val etag: String? = null,
    @SerialName("id") val id: String? = null,
    @SerialName("snippet") val snippet: SnippetDto? = null,
    @SerialName("contentDetails") val contentDetails: ContentDetailsDto? = null,
    @SerialName("statistics") val statistics: StatisticsDto? = null,
)

@Serializable
data class ContentDetailsDto(
    @SerialName("duration") val duration: String? = null,
    @SerialName("dimension") val dimension: String? = null,
    @SerialName("definition") val definition: String? = null,
    @SerialName("caption") val caption: String? = null,
    @SerialName("licensedContent") val licensedContent: Boolean? = null,
    @SerialName("projection") val projection: String? = null,
)

@Serializable
data class StatisticsDto(
    @SerialName("viewCount") val viewCount: String? = null,
    @SerialName("likeCount") val likeCount: String? = null,
    @SerialName("dislikeCount") val dislikeCount: String? = null,
    @SerialName("favoriteCount") val favoriteCount: String? = null,
    @SerialName("commentCount") val commentCount: String? = null,
)

// --------------------------------------------------------------- shared parts
@Serializable
data class PageInfoDto(
    @SerialName("totalResults") val totalResults: Long? = null,
    @SerialName("resultsPerPage") val resultsPerPage: Int? = null,
)

@Serializable
data class SnippetDto(
    @SerialName("publishedAt") val publishedAt: String? = null,
    @SerialName("channelId") val channelId: String? = null,
    @SerialName("title") val title: String? = null,
    @SerialName("description") val description: String? = null,
    @SerialName("thumbnails") val thumbnails: ThumbnailsDto? = null,
    @SerialName("channelTitle") val channelTitle: String? = null,
    @SerialName("tags") val tags: List<String>? = null,
    @SerialName("categoryId") val categoryId: String? = null,
    @SerialName("liveBroadcastContent") val liveBroadcastContent: String? = null,
    @SerialName("defaultLanguage") val defaultLanguage: String? = null,
    @SerialName("defaultAudioLanguage") val defaultAudioLanguage: String? = null,
)

@Serializable
data class ThumbnailsDto(
    @SerialName("default") val defaultUrl: ThumbnailDto? = null,
    @SerialName("medium") val medium: ThumbnailDto? = null,
    @SerialName("high") val high: ThumbnailDto? = null,
    @SerialName("standard") val standard: ThumbnailDto? = null,
    @SerialName("maxres") val maxres: ThumbnailDto? = null,
)

@Serializable
data class ThumbnailDto(
    @SerialName("url") val url: String? = null,
    @SerialName("width") val width: Int? = null,
    @SerialName("height") val height: Int? = null,
)

// ------------------------------------------------------------------- errors
@Serializable
data class ApiErrorResponseDto(
    @SerialName("error") val error: ApiErrorDto? = null,
)

@Serializable
data class ApiErrorDto(
    @SerialName("code") val code: Int? = null,
    @SerialName("message") val message: String? = null,
    @SerialName("status") val status: String? = null,
    @SerialName("errors") val errors: List<ApiErrorItemDto>? = null,
)

@Serializable
data class ApiErrorItemDto(
    @SerialName("domain") val domain: String? = null,
    @SerialName("reason") val reason: String? = null,
    @SerialName("message") val message: String? = null,
    @SerialName("locationType") val locationType: String? = null,
    @SerialName("location") val location: String? = null,
)
