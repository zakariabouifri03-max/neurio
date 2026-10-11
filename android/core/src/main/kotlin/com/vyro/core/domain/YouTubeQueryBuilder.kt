package com.vyro.core.domain

/**
 * Builds YouTube Data API v3 request URLs.
 *
 * Kept in `:core` (pure Kotlin) so the exact wire format can be unit tested without
 * spinning up an Android instrumented test.
 */
object YouTubeQueryBuilder {
    const val BASE_URL = "https://www.googleapis.com/youtube/v3/"
    const val MAX_RESULTS_LIMIT = 50

    /**
     * `GET search?part=snippet&type=video&...`
     */
    fun search(
        apiKey: String,
        query: String,
        pageToken: String? = null,
        maxResults: Int = 25,
        order: String = "relevance",
        safeSearch: Boolean = false,
        regionCode: String = "US",
    ): String {
        val params =
            linkedMapOf(
                "part" to "snippet",
                "type" to "video",
                "maxResults" to maxResults.coerceIn(1, MAX_RESULTS_LIMIT).toString(),
                "order" to order,
                "q" to query,
                "regionCode" to regionCode,
                "safeSearch" to if (safeSearch) "strict" else "none",
                "videoEmbeddable" to "true",
                "key" to apiKey,
            )
        if (!pageToken.isNullOrBlank()) params["pageToken"] = pageToken
        return BASE_URL + "search?" + encode(params)
    }

    /**
     * `GET videos?part=snippet,contentDetails,statistics&id=...`
     *
     * Used both for "most popular" browsing and to enrich search results with
     * duration and view counts (which `search` does not return).
     */
    fun videos(
        apiKey: String,
        videoIds: List<String>,
        pageToken: String? = null,
    ): String {
        val params =
            linkedMapOf(
                "part" to "snippet,contentDetails,statistics",
                "id" to videoIds.distinct().joinToString(","),
                "key" to apiKey,
            )
        if (!pageToken.isNullOrBlank()) params["pageToken"] = pageToken
        return BASE_URL + "videos?" + encode(params)
    }

    /**
     * `GET videos?chart=mostPopular` - the home screen's "Trending now" feed.
     */
    fun mostPopular(
        apiKey: String,
        pageToken: String? = null,
        maxResults: Int = 25,
        regionCode: String = "US",
        videoCategoryId: String? = null,
    ): String {
        val params =
            linkedMapOf(
                "part" to "snippet,contentDetails,statistics",
                "chart" to "mostPopular",
                "maxResults" to maxResults.coerceIn(1, MAX_RESULTS_LIMIT).toString(),
                "regionCode" to regionCode,
                "key" to apiKey,
            )
        if (!videoCategoryId.isNullOrBlank()) params["videoCategoryId"] = videoCategoryId
        if (!pageToken.isNullOrBlank()) params["pageToken"] = pageToken
        return BASE_URL + "videos?" + encode(params)
    }

    /** RFC 3986 form encoding. Hand-rolled so `:core` stays free of java.net. */
    fun encode(params: Map<String, String>): String {
        val builder = StringBuilder()
        var first = true
        for ((key, value) in params) {
            if (!first) builder.append('&')
            first = false
            builder.append(percentEncode(key)).append('=').append(percentEncode(value))
        }
        return builder.toString()
    }

    private const val UNRESERVED =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"

    fun percentEncode(value: String): String {
        val builder = StringBuilder(value.length)
        for (byte in value.toByteArray(Charsets.UTF_8)) {
            val char = byte.toInt().toChar()
            if (char in UNRESERVED) {
                builder.append(char)
            } else {
                builder.append('%')
                val hex = (byte.toInt() and 0xFF).toString(16).uppercase()
                if (hex.length == 1) builder.append('0')
                builder.append(hex)
            }
        }
        return builder.toString()
    }
}
