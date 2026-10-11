package com.vyro.play.model

/**
 * Core domain models for VYRO PLAY.
 * All properties are immutable vals so the Kotlin 2.0 Compose Compiler
 * treats these models as stable, minimizing recomposition on low-end devices.
 */

data class YouTubeVideo(
    val id: String,
    val title: String,
    val description: String,
    val channelId: String,
    val channelTitle: String,
    val publishedAt: String,
    val publishedRelative: String,
    val thumbnailMediumUrl: String,
    val thumbnailHighUrl: String,
    val thumbnailMaxResUrl: String,
    val durationIso: String,
    val durationFormatted: String,
    val durationSeconds: Long,
    val viewCount: Long,
    val viewCountFormatted: String,
    val likeCount: Long,
    val likeCountFormatted: String,
    val definition: String, // "hd" or "sd"
    val supports4KHint: Boolean,
    val hasCaptions: Boolean,
    val isLiveContent: Boolean = false,
    val tags: List<String> = emptyList()
) {
    /**
     * Selects the optimal thumbnail URL based on whether low-end device mode
     * or metered network data-saver mode is active.
     */
    fun bestThumbnailUrl(lowEndOrDataSaver: Boolean): String {
        return if (lowEndOrDataSaver) {
            thumbnailMediumUrl.ifBlank { thumbnailHighUrl }
        } else {
            thumbnailHighUrl.ifBlank { thumbnailMaxResUrl.ifBlank { thumbnailMediumUrl } }
        }
    }

    val qualityBadgeText: String
        get() = when {
            isLiveContent -> "LIVE"
            supports4KHint -> "4K ULTRA HD"
            definition.equals("hd", ignoreCase = true) -> "HD"
            else -> "SD"
        }
}

/**
 * Official YouTube IFrame Player quality levels.
 * Supports up to 2160p 4K (hd2160) when available on the video stream.
 */
enum class VideoQualityOption(
    val ytCode: String,
    val label: String,
    val badge: String,
    val description: String
) {
    AUTO("auto", "Auto (Adaptive)", "AUTO", "Automatically adapts to connection speed and screen size"),
    UHD_4K("hd2160", "2160p Ultra HD (4K)", "4K", "Maximum clarity on 4K-capable videos and fast Wi-Fi"),
    QHD_2K("hd1440", "1440p Quad HD (2K)", "2K", "Crisp high-bitrate playback for high-DPI displays"),
    FHD_1080P("hd1080", "1080p Full HD", "1080p", "Standard high definition with balanced bandwidth"),
    HD_720P("hd720", "720p HD", "720p", "Smooth HD playback ideal for mid-range & low-end phones"),
    SD_480P("large", "480p Standard", "480p", "Reduced data consumption for mobile networks"),
    SD_360P("medium", "360p Data Saver", "360p", "Minimal memory & data footprint for low-end devices"),
    SD_240P("small", "240p Ultra Saver", "240p", "Lowest bandwidth usage for slow connections");

    companion object {
        fun fromYtCode(code: String?): VideoQualityOption {
            if (code.isNullOrBlank()) return AUTO
            return entries.firstOrNull { it.ytCode.equals(code.trim(), ignoreCase = true) } ?: AUTO
        }
    }
}

enum class PlaybackSpeedOption(val rate: Float, val label: String) {
    SPEED_0_5(0.5f, "0.5x"),
    SPEED_0_75(0.75f, "0.75x"),
    SPEED_1_0(1.0f, "1.0x (Normal)"),
    SPEED_1_25(1.25f, "1.25x"),
    SPEED_1_5(1.5f, "1.5x"),
    SPEED_1_75(1.75f, "1.75x"),
    SPEED_2_0(2.0f, "2.0x")
}

enum class ThemeMode(val label: String) {
    DARK("Dark Obsidian (Purple & Cyan)"),
    LIGHT("Light Violet & Cyan"),
    SYSTEM("Follow System Theme")
}

enum class SafeSearchMode(val apiParam: String, val label: String) {
    MODERATE("moderate", "Moderate (Default)"),
    STRICT("strict", "Strict"),
    NONE("none", "Unrestricted")
}

enum class DiscoveryCategory(
    val id: String,
    val label: String,
    val defaultQuery: String,
    val videoCategoryId: String? = null,
    val preferHighDef: Boolean = false
) {
    TRENDING("trending", "Trending Now", "trending 4K official", null, false),
    ULTRA_HD_4K("4k_hdr", "4K Ultra HD", "4K Ultra HD 2160p HDR demo", null, true),
    MUSIC("music", "Music", "official music video 4K", "10", false),
    GAMING("gaming", "Gaming", "gaming 4K 60fps gameplay", "20", false),
    TECH("tech", "Tech & AI", "technology review smartphones AI", "28", false),
    SCIENCE("science", "Science & Space", "NASA space documentary 4K", "28", true),
    NATURE("nature", "Nature 4K", "nature wildlife 4K 60fps", null, true),
    CODING("coding", "Kotlin & Dev", "Android Kotlin Jetpack Compose tutorial", "28", false)
}

data class LocalVideoFile(
    val uri: String,
    val displayName: String,
    val sizeBytes: Long,
    val sizeFormatted: String,
    val durationMs: Long,
    val durationFormatted: String,
    val mimeType: String,
    val dateAddedSeconds: Long,
    val resolution: String,
    val folderName: String,
    val lastPositionMs: Long = 0L,
    val isUserPicked: Boolean = false
)

enum class WatchSourceType {
    YOUTUBE,
    LOCAL
}

data class WatchHistoryItem(
    val id: String,
    val title: String,
    val channelOrFolder: String,
    val thumbnailUrl: String,
    val durationFormatted: String,
    val durationSeconds: Long,
    val lastPositionSeconds: Long,
    val watchedAtEpochMs: Long,
    val sourceType: WatchSourceType,
    val localUri: String = "",
    val qualityBadge: String = "HD"
) {
    val progressFraction: Float
        get() = if (durationSeconds > 0L) {
            (lastPositionSeconds.toFloat() / durationSeconds.toFloat()).coerceIn(0f, 1f)
        } else {
            0f
        }
}

data class SearchHistoryEntry(
    val query: String,
    val searchedAtEpochMs: Long,
    val resultCount: Int
)

data class NetworkState(
    val isOnline: Boolean = true,
    val isWifi: Boolean = true,
    val isMetered: Boolean = false,
    val connectionLabel: String = "Online (Wi-Fi)"
)

data class AppSettings(
    val themeMode: ThemeMode = ThemeMode.DARK,
    val preferredQuality: VideoQualityOption = VideoQualityOption.UHD_4K,
    val captionsEnabledByDefault: Boolean = false,
    val captionsLanguage: String = "en",
    val lowEndPerformanceMode: Boolean = false,
    val safeSearchMode: SafeSearchMode = SafeSearchMode.MODERATE,
    val autoplayEnabled: Boolean = true,
    val pauseWatchHistory: Boolean = false,
    val regionCode: String = "US",
    val customApiKey: String = ""
)

sealed class ApiResult<out T> {
    data class Success<T>(val data: T, val fromCache: Boolean = false) : ApiResult<T>()
    data class Error(
        val message: String,
        val errorCode: ApiErrorCode = ApiErrorCode.UNKNOWN,
        val isRecoverable: Boolean = true
    ) : ApiResult<Nothing>()
}

enum class ApiErrorCode {
    MISSING_API_KEY,
    INVALID_API_KEY,
    QUOTA_EXCEEDED,
    NETWORK_OFFLINE,
    VIDEO_NOT_FOUND,
    HTTP_ERROR,
    UNKNOWN
}

/**
 * Policy-compliant short-term cache policy for YouTube Data API v3 responses.
 * Caches search/metadata responses for up to 15 minutes to prevent redundant
 * quota depletion on device rotation or back-navigation, while strictly
 * avoiding permanent scraping or unauthorized stream storage.
 */
object QuotaCachePolicy {
    const val CACHE_TTL_MS: Long = 15L * 60L * 1000L // 15 minutes
    const val MAX_CACHE_ENTRIES: Int = 60

    fun normalizeSearchCacheKey(
        query: String,
        safeSearch: SafeSearchMode,
        preferHighDef: Boolean
    ): String {
        val cleanQuery = query.trim().lowercase().replace(Regex("\\s+"), " ")
        return "search:v1:$cleanQuery:${safeSearch.apiParam}:hd=$preferHighDef"
    }

    fun normalizeTrendingCacheKey(regionCode: String, categoryId: String?): String {
        return "trending:v1:${regionCode.trim().uppercase()}:${categoryId ?: "all"}"
    }

    fun isExpired(cachedAtEpochMs: Long, nowEpochMs: Long): Boolean {
        if (cachedAtEpochMs <= 0L) return true
        return (nowEpochMs - cachedAtEpochMs) > CACHE_TTL_MS
    }
}
