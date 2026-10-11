package com.vyro.play.data.remote

import com.vyro.play.model.ApiErrorCode
import com.vyro.play.model.ApiResult
import com.vyro.play.model.YouTubeVideo
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Pure Kotlin + org.json parser and serializer for YouTube Data API v3 responses,
 * official YouTube oEmbed metadata, ISO-8601 durations, and URL extraction.
 */
object YouTubeMetadataParser {

    private val VIDEO_ID_REGEX = Regex("^[a-zA-Z0-9_-]{11}$")
    private val URL_PATTERNS = listOf(
        Regex("(?:youtube\\.com/watch\\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})"),
        Regex("(?:youtu\\.be/)([a-zA-Z0-9_-]{11})"),
        Regex("(?:youtube\\.com/embed/)([a-zA-Z0-9_-]{11})"),
        Regex("(?:youtube\\.com/shorts/)([a-zA-Z0-9_-]{11})"),
        Regex("(?:youtube\\.com/live/)([a-zA-Z0-9_-]{11})"),
        Regex("(?:youtube-nocookie\\.com/embed/)([a-zA-Z0-9_-]{11})")
    )

    private val ISO_DURATION_REGEX =
        Regex("^P(?:(\\d+)D)?(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?)?$")

    /**
     * Extracts an 11-character YouTube video ID from a raw ID or any official YouTube URL.
     * Returns null if the input is not a valid YouTube video URL or ID.
     */
    fun extractVideoId(input: String?): String? {
        if (input.isNullOrBlank()) return null
        val trimmed = input.trim()
        if (VIDEO_ID_REGEX.matches(trimmed)) {
            return trimmed
        }
        for (pattern in URL_PATTERNS) {
            val match = pattern.find(trimmed)
            if (match != null && match.groupValues.size > 1) {
                val candidate = match.groupValues[1]
                if (VIDEO_ID_REGEX.matches(candidate)) {
                    return candidate
                }
            }
        }
        return null
    }

    /**
     * Parses an ISO-8601 duration string (e.g. "PT1H23M45S", "PT4M5S", "PT50S", "P0D")
     * into total seconds.
     */
    fun parseIsoDurationSeconds(isoDuration: String?): Long {
        if (isoDuration.isNullOrBlank()) return 0L
        val normalized = isoDuration.trim().uppercase(Locale.US)
        if (normalized == "P0D" || normalized == "PT0S") return 0L
        val match = ISO_DURATION_REGEX.matchEntire(normalized) ?: return 0L
        val days = match.groupValues[1].toLongOrNull() ?: 0L
        val hours = match.groupValues[2].toLongOrNull() ?: 0L
        val minutes = match.groupValues[3].toLongOrNull() ?: 0L
        val seconds = match.groupValues[4].toLongOrNull() ?: 0L
        return (days * 86400L) + (hours * 3600L) + (minutes * 60L) + seconds
    }

    /**
     * Formats total seconds into a compact timestamp (e.g. "1:23:45" or "4:05").
     */
    fun formatDurationSeconds(totalSeconds: Long, isLive: Boolean = false): String {
        if (isLive) return "LIVE"
        if (totalSeconds <= 0L) return "0:00"
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L
        return if (hours > 0L) {
            String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format(Locale.US, "%d:%02d", minutes, seconds)
        }
    }

    /**
     * Formats a raw view/like count into a compact human-readable string (e.g. "1.5M", "42.8K").
     */
    fun formatCompactCount(count: Long): String {
        if (count < 0L) return "0"
        return when {
            count >= 1_000_000_000L -> String.format(Locale.US, "%.1fB", count / 1_000_000_000.0)
                .replace(".0B", "B")
            count >= 1_000_000L -> String.format(Locale.US, "%.1fM", count / 1_000_000.0)
                .replace(".0M", "M")
            count >= 1_000L -> String.format(Locale.US, "%.1fK", count / 1_000.0)
                .replace(".0K", "K")
            else -> count.toString()
        }
    }

    /**
     * Formats byte size into human-readable KB / MB / GB.
     */
    fun formatFileSize(bytes: Long): String {
        if (bytes <= 0L) return "0 B"
        val kb = bytes / 1024.0
        val mb = kb / 1024.0
        val gb = mb / 1024.0
        return when {
            gb >= 1.0 -> String.format(Locale.US, "%.2f GB", gb)
            mb >= 1.0 -> String.format(Locale.US, "%.1f MB", mb)
            kb >= 1.0 -> String.format(Locale.US, "%.0f KB", kb)
            else -> "$bytes B"
        }
    }

    /**
     * Formats an ISO-8601 date string (e.g. "2026-08-14T10:30:00Z") into a clean date label.
     */
    fun formatPublishedDate(publishedAt: String?): String {
        if (publishedAt.isNullOrBlank()) return ""
        val clean = publishedAt.trim()
        return if (clean.length >= 10) clean.substring(0, 10) else clean
    }

    /**
     * Detects whether a video has 4K / Ultra HD indicators in its metadata or tags.
     */
    fun detect4KSupportHint(
        title: String,
        description: String,
        tags: List<String>,
        definition: String
    ): Boolean {
        if (!definition.equals("hd", ignoreCase = true)) return false
        val combined = buildString {
            append(title.lowercase(Locale.US))
            append(' ')
            append(description.take(300).lowercase(Locale.US))
            append(' ')
            tags.forEach {
                append(it.lowercase(Locale.US))
                append(' ')
            }
        }
        return combined.contains("4k") ||
            combined.contains("2160p") ||
            combined.contains("uhd") ||
            combined.contains("ultra hd") ||
            combined.contains("8k")
    }

    /**
     * Extracts ordered video IDs from a `youtube/v3/search` JSON response.
     */
    fun parseSearchVideoIds(searchJson: String): List<String> {
        val root = JSONObject(searchJson)
        val items = root.optJSONArray("items") ?: return emptyList()
        val ids = mutableListOf<String>()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            val idField = item.opt("id")
            val videoId = when (idField) {
                is JSONObject -> idField.optString("videoId", "")
                is String -> idField
                else -> ""
            }.trim()
            if (videoId.isNotEmpty() && !ids.contains(videoId)) {
                ids.add(videoId)
            }
        }
        return ids
    }

    /**
     * Parses a `youtube/v3/search` response directly into fallback `YouTubeVideo` objects
     * if a follow-up `videos.list` call is not made or partially returns.
     */
    fun parseSearchFallbackVideos(searchJson: String): List<YouTubeVideo> {
        val root = JSONObject(searchJson)
        val items = root.optJSONArray("items") ?: return emptyList()
        val result = mutableListOf<YouTubeVideo>()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            val idObj = item.optJSONObject("id")
            val videoId = idObj?.optString("videoId", "")?.trim().orEmpty()
            if (videoId.isEmpty()) continue
            val snippet = item.optJSONObject("snippet") ?: continue
            result.add(parseVideoFromSnippetAndDetails(videoId, snippet, null, null))
        }
        return result
    }

    /**
     * Parses a `youtube/v3/videos?part=snippet,contentDetails,statistics` JSON response
     * into full `YouTubeVideo` models.
     */
    fun parseVideosListResponse(videosJson: String): List<YouTubeVideo> {
        val root = JSONObject(videosJson)
        val items = root.optJSONArray("items") ?: return emptyList()
        val videos = mutableListOf<YouTubeVideo>()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            val id = item.optString("id", "").trim()
            if (id.isEmpty()) continue
            val snippet = item.optJSONObject("snippet") ?: JSONObject()
            val contentDetails = item.optJSONObject("contentDetails")
            val statistics = item.optJSONObject("statistics")
            videos.add(parseVideoFromSnippetAndDetails(id, snippet, contentDetails, statistics))
        }
        return videos
    }

    private fun parseVideoFromSnippetAndDetails(
        id: String,
        snippet: JSONObject,
        contentDetails: JSONObject?,
        statistics: JSONObject?
    ): YouTubeVideo {
        val title = decodeHtmlEntities(snippet.optString("title", "Untitled Video"))
        val description = snippet.optString("description", "")
        val channelId = snippet.optString("channelId", "")
        val channelTitle = decodeHtmlEntities(snippet.optString("channelTitle", "YouTube Creator"))
        val publishedAt = snippet.optString("publishedAt", "")
        val liveBroadcastContent = snippet.optString("liveBroadcastContent", "none")
        val isLive = liveBroadcastContent.equals("live", ignoreCase = true)

        val thumbnails = snippet.optJSONObject("thumbnails")
        val medThumb = thumbnails?.optJSONObject("medium")?.optString("url")
            ?.ifBlank { null } ?: "https://i.ytimg.com/vi/$id/mqdefault.jpg"
        val highThumb = thumbnails?.optJSONObject("high")?.optString("url")
            ?.ifBlank { null } ?: "https://i.ytimg.com/vi/$id/hqdefault.jpg"
        val maxResThumb = thumbnails?.optJSONObject("maxres")?.optString("url")
            ?.ifBlank { null }
            ?: thumbnails?.optJSONObject("standard")?.optString("url")?.ifBlank { null }
            ?: "https://i.ytimg.com/vi/$id/maxresdefault.jpg"

        val tagsArray = snippet.optJSONArray("tags")
        val tags = mutableListOf<String>()
        if (tagsArray != null) {
            for (t in 0 until minOf(tagsArray.length(), 15)) {
                val tag = tagsArray.optString(t, "").trim()
                if (tag.isNotEmpty()) tags.add(tag)
            }
        }

        val durationIso = contentDetails?.optString("duration", "PT0S") ?: "PT0S"
        val durationSeconds = parseIsoDurationSeconds(durationIso)
        val durationFormatted = formatDurationSeconds(durationSeconds, isLive)
        val definition = contentDetails?.optString("definition", "hd") ?: "hd"
        val captionStr = contentDetails?.optString("caption", "false") ?: "false"
        val hasCaptions = captionStr.equals("true", ignoreCase = true)

        val viewCount = statistics?.optString("viewCount", "0")?.toLongOrNull() ?: 0L
        val likeCount = statistics?.optString("likeCount", "0")?.toLongOrNull() ?: 0L

        val supports4K = detect4KSupportHint(title, description, tags, definition)

        return YouTubeVideo(
            id = id,
            title = title,
            description = description,
            channelId = channelId,
            channelTitle = channelTitle,
            publishedAt = publishedAt,
            publishedRelative = formatPublishedDate(publishedAt),
            thumbnailMediumUrl = medThumb,
            thumbnailHighUrl = highThumb,
            thumbnailMaxResUrl = maxResThumb,
            durationIso = durationIso,
            durationFormatted = durationFormatted,
            durationSeconds = durationSeconds,
            viewCount = viewCount,
            viewCountFormatted = "${formatCompactCount(viewCount)} views",
            likeCount = likeCount,
            likeCountFormatted = formatCompactCount(likeCount),
            definition = definition,
            supports4KHint = supports4K,
            hasCaptions = hasCaptions,
            isLiveContent = isLive,
            tags = tags
        )
    }

    /**
     * Parses YouTube's official keyless oEmbed response (`https://www.youtube.com/oembed`)
     * into a real `YouTubeVideo` object when a user opens a direct video URL/ID.
     */
    fun parseOEmbedResponse(videoId: String, oembedJson: String): YouTubeVideo {
        val obj = JSONObject(oembedJson)
        val title = obj.optString("title", "YouTube Video ($videoId)")
        val authorName = obj.optString("author_name", "YouTube Channel")
        val thumbUrl = obj.optString("thumbnail_url", "https://i.ytimg.com/vi/$videoId/hqdefault.jpg")
        val supports4K = detect4KSupportHint(title, "", emptyList(), "hd")

        return YouTubeVideo(
            id = videoId,
            title = title,
            description = "Loaded via Official YouTube Player ($authorName). Configure a YouTube Data API v3 key in Settings for full search, channel stats, and duration metadata.",
            channelId = "",
            channelTitle = authorName,
            publishedAt = "",
            publishedRelative = "Direct Play",
            thumbnailMediumUrl = "https://i.ytimg.com/vi/$videoId/mqdefault.jpg",
            thumbnailHighUrl = thumbUrl,
            thumbnailMaxResUrl = "https://i.ytimg.com/vi/$videoId/maxresdefault.jpg",
            durationIso = "PT0S",
            durationFormatted = "LIVE / PLAY",
            durationSeconds = 0L,
            viewCount = 0L,
            viewCountFormatted = "Official Player",
            likeCount = 0L,
            likeCountFormatted = "",
            definition = "hd",
            supports4KHint = supports4K,
            hasCaptions = true,
            isLiveContent = false,
            tags = emptyList()
        )
    }

    /**
     * Parses an HTTP error response from YouTube Data API v3 into a structured `ApiResult.Error`.
     */
    fun parseApiError(httpCode: Int, errorBody: String?): ApiResult.Error {
        if (errorBody.isNullOrBlank()) {
            return ApiResult.Error(
                message = "YouTube API request failed with HTTP $httpCode.",
                errorCode = ApiErrorCode.HTTP_ERROR
            )
        }
        return try {
            val root = JSONObject(errorBody)
            val errObj = root.optJSONObject("error")
            val message = errObj?.optString("message")
                ?.takeIf { it.isNotBlank() }
                ?: "YouTube Data API error (HTTP $httpCode)"
            val errorsArr = errObj?.optJSONArray("errors")
            val firstReason = errorsArr?.optJSONObject(0)?.optString("reason", "").orEmpty()

            val code = when {
                firstReason.equals("keyInvalid", ignoreCase = true) ||
                    firstReason.equals("badRequest", ignoreCase = true) && message.contains("API key", ignoreCase = true) ->
                    ApiErrorCode.INVALID_API_KEY
                firstReason.equals("quotaExceeded", ignoreCase = true) ||
                    firstReason.equals("dailyLimitExceeded", ignoreCase = true) ||
                    firstReason.equals("rateLimitExceeded", ignoreCase = true) ->
                    ApiErrorCode.QUOTA_EXCEEDED
                httpCode == 400 || httpCode == 401 -> ApiErrorCode.INVALID_API_KEY
                httpCode == 403 && message.contains("quota", ignoreCase = true) -> ApiErrorCode.QUOTA_EXCEEDED
                httpCode == 404 -> ApiErrorCode.VIDEO_NOT_FOUND
                else -> ApiErrorCode.HTTP_ERROR
            }
            ApiResult.Error(
                message = "$message${if (firstReason.isNotEmpty()) " [$firstReason]" else ""}",
                errorCode = code
            )
        } catch (_: Exception) {
            ApiResult.Error(
                message = "YouTube Data API returned HTTP $httpCode.",
                errorCode = ApiErrorCode.HTTP_ERROR
            )
        }
    }

    /**
     * Serializes a list of `YouTubeVideo` items to JSON for policy-compliant short-TTL Room caching.
     */
    fun serializeVideoListToJson(videos: List<YouTubeVideo>): String {
        val arr = JSONArray()
        for (v in videos) {
            val obj = JSONObject().apply {
                put("id", v.id)
                put("title", v.title)
                put("description", v.description)
                put("channelId", v.channelId)
                put("channelTitle", v.channelTitle)
                put("publishedAt", v.publishedAt)
                put("publishedRelative", v.publishedRelative)
                put("thumbnailMediumUrl", v.thumbnailMediumUrl)
                put("thumbnailHighUrl", v.thumbnailHighUrl)
                put("thumbnailMaxResUrl", v.thumbnailMaxResUrl)
                put("durationIso", v.durationIso)
                put("durationFormatted", v.durationFormatted)
                put("durationSeconds", v.durationSeconds)
                put("viewCount", v.viewCount)
                put("viewCountFormatted", v.viewCountFormatted)
                put("likeCount", v.likeCount)
                put("likeCountFormatted", v.likeCountFormatted)
                put("definition", v.definition)
                put("supports4KHint", v.supports4KHint)
                put("hasCaptions", v.hasCaptions)
                put("isLiveContent", v.isLiveContent)
                put("tags", JSONArray(v.tags))
            }
            arr.put(obj)
        }
        return arr.toString()
    }

    /**
     * Deserializes a list of `YouTubeVideo` items from cached JSON.
     */
    fun deserializeVideoListFromJson(json: String): List<YouTubeVideo> {
        if (json.isBlank()) return emptyList()
        val arr = JSONArray(json)
        val list = mutableListOf<YouTubeVideo>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val tagsArr = obj.optJSONArray("tags")
            val tags = mutableListOf<String>()
            if (tagsArr != null) {
                for (t in 0 until tagsArr.length()) {
                    val tag = tagsArr.optString(t, "")
                    if (tag.isNotBlank()) tags.add(tag)
                }
            }
            list.add(
                YouTubeVideo(
                    id = obj.optString("id", ""),
                    title = obj.optString("title", ""),
                    description = obj.optString("description", ""),
                    channelId = obj.optString("channelId", ""),
                    channelTitle = obj.optString("channelTitle", ""),
                    publishedAt = obj.optString("publishedAt", ""),
                    publishedRelative = obj.optString("publishedRelative", ""),
                    thumbnailMediumUrl = obj.optString("thumbnailMediumUrl", ""),
                    thumbnailHighUrl = obj.optString("thumbnailHighUrl", ""),
                    thumbnailMaxResUrl = obj.optString("thumbnailMaxResUrl", ""),
                    durationIso = obj.optString("durationIso", "PT0S"),
                    durationFormatted = obj.optString("durationFormatted", "0:00"),
                    durationSeconds = obj.optLong("durationSeconds", 0L),
                    viewCount = obj.optLong("viewCount", 0L),
                    viewCountFormatted = obj.optString("viewCountFormatted", "0 views"),
                    likeCount = obj.optLong("likeCount", 0L),
                    likeCountFormatted = obj.optString("likeCountFormatted", "0"),
                    definition = obj.optString("definition", "hd"),
                    supports4KHint = obj.optBoolean("supports4KHint", false),
                    hasCaptions = obj.optBoolean("hasCaptions", false),
                    isLiveContent = obj.optBoolean("isLiveContent", false),
                    tags = tags
                )
            )
        }
        return list
    }

    private fun decodeHtmlEntities(text: String): String {
        return text
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
    }
}
