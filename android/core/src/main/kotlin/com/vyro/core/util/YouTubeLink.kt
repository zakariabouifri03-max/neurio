package com.vyro.core.util

/** Helpers for recognising and producing YouTube links. */
object YouTubeLink {
    private const val ID_CHARS = 11

    private val patterns =
        listOf(
            Regex("""(?:youtube\.com/watch\?(?:.*&)?v=)([\w-]{11})"""),
            Regex("""(?:youtube\.com/embed/)([\w-]{11})"""),
            Regex("""(?:youtube\.com/shorts/)([\w-]{11})"""),
            Regex("""(?:youtube\.com/live/)([\w-]{11})"""),
            Regex("""(?:youtu\.be/)([\w-]{11})"""),
            Regex("""(?:youtube\.com/v/)([\w-]{11})"""),
        )

    /** Extracts an 11 character video id from any supported YouTube URL shape. */
    fun extractVideoId(input: String?): String? {
        val value = input?.trim() ?: return null
        if (value.isEmpty()) return null
        if (isBareVideoId(value)) return value
        for (pattern in patterns) {
            val id = pattern.find(value)?.groupValues?.getOrNull(1)
            if (id != null && isBareVideoId(id)) return id
        }
        return null
    }

    fun isBareVideoId(value: String): Boolean =
        value.length == ID_CHARS && value.all { it.isLetterOrDigit() || it == '_' || it == '-' }

    fun watchUrl(videoId: String): String = "https://www.youtube.com/watch?v=$videoId"

    fun channelUrl(channelId: String): String = "https://www.youtube.com/channel/$channelId"
}

/** Thumbnail URL construction, including the data-saver aware "pick the cheapest usable one". */
object ThumbnailUrls {
    private const val BASE = "https://i.ytimg.com/vi"

    fun forVideo(
        videoId: String,
        quality: com.vyro.core.model.ThumbnailQuality,
    ): String = "$BASE/$videoId/${quality.suffix}.jpg"

    fun hqDefault(videoId: String): String = "$BASE/$videoId/hqdefault.jpg"

    /**
     * Picks the best available thumbnail for the requested quality, falling back to
     * progressively better (then worse) images when a resolution is missing.
     */
    fun pick(
        thumbnails: com.vyro.core.model.Thumbnails,
        quality: com.vyro.core.model.ThumbnailQuality,
    ): String {
        val ordered =
            when (quality) {
                com.vyro.core.model.ThumbnailQuality.MAX ->
                    listOf(
                        thumbnails.maxResUrl,
                        thumbnails.standardUrl,
                        thumbnails.highUrl,
                        thumbnails.mediumUrl,
                        thumbnails.defaultUrl,
                    )
                com.vyro.core.model.ThumbnailQuality.HIGH ->
                    listOf(
                        thumbnails.standardUrl,
                        thumbnails.highUrl,
                        thumbnails.mediumUrl,
                        thumbnails.defaultUrl,
                    )
                com.vyro.core.model.ThumbnailQuality.MEDIUM ->
                    listOf(
                        thumbnails.highUrl,
                        thumbnails.mediumUrl,
                        thumbnails.defaultUrl,
                    )
                com.vyro.core.model.ThumbnailQuality.LOW ->
                    listOf(
                        thumbnails.mediumUrl,
                        thumbnails.defaultUrl,
                        thumbnails.highUrl,
                    )
            }
        return ordered.firstOrNull { !it.isNullOrBlank() } ?: thumbnails.defaultUrl
    }
}
