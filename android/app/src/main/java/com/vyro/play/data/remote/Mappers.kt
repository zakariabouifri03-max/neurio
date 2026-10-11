package com.vyro.play.data.remote

import com.vyro.core.model.Thumbnails
import com.vyro.core.model.Video
import com.vyro.core.model.VideoPage
import com.vyro.core.util.Iso8601DateTime
import com.vyro.core.util.Iso8601Duration
import com.vyro.play.data.remote.dto.PageInfoDto
import com.vyro.play.data.remote.dto.SearchItemDto
import com.vyro.play.data.remote.dto.SnippetDto
import com.vyro.play.data.remote.dto.ThumbnailsDto
import com.vyro.play.data.remote.dto.VideoItemDto
import com.vyro.play.data.remote.dto.VideosResponseDto

/** DTO -> domain mapping. Kept out of the UI so screens never touch wire models. */

fun ThumbnailsDto.toDomain(): Thumbnails =
    Thumbnails(
        defaultUrl = defaultUrl?.url.orEmpty(),
        mediumUrl = medium?.url,
        highUrl = high?.url,
        standardUrl = standard?.url,
        maxResUrl = maxres?.url,
    )

fun SnippetDto.toThumbnails(): Thumbnails = (thumbnails ?: ThumbnailsDto()).toDomain()

fun SnippetDto.isLiveBroadcast(): Boolean = liveBroadcastContent == "live"

fun SearchItemDto.toDomain(): Video? {
    val videoId = id?.videoId ?: return null
    val snippet = snippet ?: return null
    return Video(
        id = videoId,
        title = snippet.title.orEmpty().decodeHtmlEntities(),
        description = snippet.description.orEmpty(),
        channelId = snippet.channelId.orEmpty(),
        channelTitle = snippet.channelTitle.orEmpty(),
        publishedAtMillis = Iso8601DateTime.parseEpochMillis(snippet.publishedAt),
        publishedAtRaw = snippet.publishedAt.orEmpty(),
        thumbnails = snippet.toThumbnails(),
        durationMillis = 0L,
        viewCount = 0L,
        likeCount = 0L,
        commentCount = 0L,
        isLive = snippet.isLiveBroadcast(),
        detailsResolved = false,
    )
}

fun VideoItemDto.toDomain(): Video? {
    val videoId = id ?: return null
    val snippet = snippet
    return Video(
        id = videoId,
        title = snippet?.title.orEmpty().decodeHtmlEntities(),
        description = snippet?.description.orEmpty(),
        channelId = snippet?.channelId.orEmpty(),
        channelTitle = snippet?.channelTitle.orEmpty(),
        publishedAtMillis = Iso8601DateTime.parseEpochMillis(snippet?.publishedAt),
        publishedAtRaw = snippet?.publishedAt.orEmpty(),
        thumbnails = snippet?.toThumbnails() ?: Thumbnails.EMPTY,
        durationMillis = Iso8601Duration.parseToMillis(contentDetails?.duration),
        viewCount = statistics?.viewCount?.toLongOrNull() ?: 0L,
        likeCount = statistics?.likeCount?.toLongOrNull() ?: 0L,
        commentCount = statistics?.commentCount?.toLongOrNull() ?: 0L,
        isLive = snippet?.isLiveBroadcast() ?: false,
        detailsResolved = true,
    )
}

fun VideosResponseDto.toPage(): VideoPage =
    VideoPage(
        items = items.mapNotNull { it.toDomain() },
        nextPageToken = nextPageToken,
        totalResults = pageInfo.totalResults(),
    )

fun PageInfoDto?.totalResults(): Long = this?.totalResults ?: 0L

/**
 * YouTube HTML-escapes titles and descriptions (`&amp;`, `&#39;`, `&quot;`).
 * Only the handful of entities the API actually emits are handled, which is much
 * cheaper than loading an HTML parser into the process.
 */
fun String.decodeHtmlEntities(): String {
    if (indexOf('&') == -1) return this
    return this
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&#x27;", "'")
}
