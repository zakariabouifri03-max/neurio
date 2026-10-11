package com.vyro.play.data

import com.google.gson.annotations.SerializedName
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.GET
import retrofit2.http.Query
import java.io.IOException

interface YouTubeApi {
    @GET("youtube/v3/search") suspend fun search(
        @Query("part") part: String = "snippet", @Query("q") query: String,
        @Query("type") type: String = "video,channel", @Query("maxResults") max: Int = 20,
        @Query("pageToken") page: String? = null, @Query("key") key: String
    ): SearchResponse
    @GET("youtube/v3/videos") suspend fun videos(
        @Query("part") part: String = "snippet,contentDetails,statistics",
        @Query("id") ids: String? = null, @Query("chart") chart: String? = null,
        @Query("regionCode") region: String? = null, @Query("maxResults") max: Int? = null,
        @Query("pageToken") page: String? = null, @Query("key") key: String
    ): VideoResponse
}

data class Thumbnails(val high: Thumb? = null, val medium: Thumb? = null, @SerializedName("default") val standard: Thumb? = null)
data class Thumb(val url: String = "")
data class Snippet(val title: String = "", val channelTitle: String = "", val description: String = "", val publishedAt: String = "", val thumbnails: Thumbnails? = null)
data class ResourceId(val videoId: String? = null, val channelId: String? = null)
data class SearchItem(val id: ResourceId? = null, val snippet: Snippet? = null)
data class SearchResponse(val items: List<SearchItem>? = null, val nextPageToken: String? = null)
data class VideoDetails(val duration: String? = null)
data class VideoStats(val viewCount: String? = null)
data class VideoItem(val id: String? = null, val snippet: Snippet? = null, val contentDetails: VideoDetails? = null, val statistics: VideoStats? = null)
data class VideoResponse(val items: List<VideoItem>? = null, val nextPageToken: String? = null)

data class VideoCard(val id: String, val title: String, val channel: String, val thumbnail: String, val isChannel: Boolean = false, val duration: String = "", val views: String = "", val published: String = "") {
    fun saved() = SavedVideo(id, title, channel, thumbnail)
}
data class Page(val items: List<VideoCard>, val next: String?)

fun Snippet?.image(): String = this?.thumbnails?.high?.url ?: this?.thumbnails?.medium?.url ?: this?.thumbnails?.standard?.url ?: ""
fun VideoItem.card(): VideoCard? {
    val videoId = id?.takeIf { it.matches(Regex("[a-zA-Z0-9_-]{11}")) } ?: return null
    return VideoCard(videoId, snippet?.title.orEmpty(), snippet?.channelTitle.orEmpty(), snippet.image(), duration = contentDetails?.duration.orEmpty(), views = statistics?.viewCount.orEmpty(), published = snippet?.publishedAt.orEmpty())
}
fun SearchItem.card(): VideoCard? {
    val videoId = id?.videoId?.takeIf { it.matches(Regex("[a-zA-Z0-9_-]{11}")) }
    val channelId = id?.channelId?.takeIf { it.matches(Regex("UC[a-zA-Z0-9_-]{22}")) }
    val identifier = videoId ?: channelId ?: return null
    return VideoCard(identifier, snippet?.title.orEmpty(), snippet?.channelTitle.orEmpty(), snippet.image(), isChannel = videoId == null, published = snippet?.publishedAt.orEmpty())
}

class VideoRepository(private val dao: LibraryDao, private val preferences: Preferences,
    private val api: YouTubeApi = Retrofit.Builder().baseUrl("https://www.googleapis.com/").addConverterFactory(GsonConverterFactory.create()).build().create(YouTubeApi::class.java)) {
    val favorites = dao.favorites()
    val history = dao.history()
    val locals = dao.locals()
    val searches = dao.searches()
    val settings = preferences.settings
    val localCount = dao.localCount()

    suspend fun search(query: String, key: String, page: String? = null): Page {
        require(query.isNotBlank()) { "Enter a search term" }
        require(key.isNotBlank()) { "Add a YouTube Data API key in Settings to search." }
        val response = api.search(query = query, page = page, key = key)
        val cards = response.items.orEmpty().mapNotNull { it.card() }
        // A single batched details lookup supplies real duration and view count without N requests.
        val ids = cards.filterNot { it.isChannel }.map { it.id }
        val details = if (ids.isEmpty()) emptyMap() else api.videos(ids = ids.joinToString(","), key = key).items.orEmpty().mapNotNull { it.card() }.associateBy { it.id }
        return Page(cards.map { details[it.id] ?: it }, response.nextPageToken?.takeIf { it.isNotBlank() })
    }
    suspend fun popular(key: String, page: String? = null): Page {
        require(key.isNotBlank()) { "Add a YouTube Data API key in Settings to see popular videos." }
        val response = api.videos(chart = "mostPopular", region = "US", max = 20, page = page, key = key)
        return Page(response.items.orEmpty().mapNotNull { it.card() }, response.nextPageToken?.takeIf { it.isNotBlank() })
    }
    suspend fun favorite(card: VideoCard) {
        val old = dao.find(card.id)
        dao.save((old ?: card.saved()).copy(favorite = !(old?.favorite ?: false)))
    }
    suspend fun watched(card: VideoCard, enabled: Boolean) {
        if (!enabled) return
        val old = dao.find(card.id)
        dao.save((old ?: card.saved()).copy(lastWatched = System.currentTimeMillis()))
    }
    suspend fun addLocal(uri: String, name: String) {
        val id = "local:$uri"
        if (dao.find(id) == null) dao.save(SavedVideo(id, name, "On this device", "", localUri = uri))
    }
    suspend fun position(id: String, ms: Long, duration: Long, enabled: Boolean) {
        if (!enabled) return
        dao.find(id)?.let { dao.save(it.copy(positionMs = ms.coerceAtLeast(0), durationMs = duration.coerceAtLeast(0), lastWatched = System.currentTimeMillis())) }
    }
    suspend fun removeLocal(id: String) { dao.delete(id) }
    suspend fun removeHistory(id: String) { dao.removeHistory(id) }
    suspend fun clearHistory() { dao.clearHistory() }
    suspend fun searchTerm(term: String) { if (term.isNotBlank()) dao.saveSearch(RecentSearch(term.trim(), System.currentTimeMillis())) }
    suspend fun removeSearch(term: String) { dao.removeSearch(term) }
    suspend fun clearSearches() { dao.clearSearches() }
    suspend fun existing(id: String) = dao.find(id)
    suspend fun setKey(key: String) = preferences.key(key)
    suspend fun setTheme(value: String) = preferences.theme(value)
    suspend fun setQuality(value: String) = preferences.quality(value)
    suspend fun setHistory(value: Boolean) = preferences.history(value)
    suspend fun setWarnings(value: Boolean) = preferences.warnings(value)
}

fun Throwable.friendly(): String = when (this) {
    is HttpException -> when (code()) {
        400 -> "The request or API key is invalid. Check your key and API restrictions."
        403 -> "YouTube API access was denied or quota was reached. Check your Google Cloud project."
        404 -> "This video is unavailable."
        429 -> "Too many requests. Try again later."
        else -> "YouTube returned HTTP ${code()}. Try again later."
    }
    is IOException -> "Could not connect. Check your internet connection and try again."
    else -> message ?: "Something went wrong. Please try again."
}
